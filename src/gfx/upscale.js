// In-engine upscale for phones: the frame is rendered and post-processed at the internal resolution (~0.8 x CSS
// pixels); this pass draws the canvas at 1.5 x CSS pixels with AMD FSR 1 (iPhone 12: 675x312 -> 1266x585, which the
// browser takes the rest of the way). Before, the browser stretched the 675x312 canvas ~3.75x with a bilinear
// filter: soft, with every stair-step magnified.
//  1. At the internal resolution: RCAS (contrast-adaptive sharpening, limited per pixel to its neighbours' range: no
//     halos), plus EASU's edge analysis of each texel (direction and length of the luma '+' around it) into a second
//     target. FSR sharpens after the upscale; here temporal AA has already removed the sub-pixel noise RCAS would
//     amplify, and at a sixth of the pixels it costs next to nothing (side by side the two orders look the same).
//  2. EASU (edge-adaptive spatial upsampling) to the canvas: a Lanczos-2 kernel stretched along the local edge and
//     clamped to the 2x2 nearest texels so it can't ring. The edge terms EASU blends bilinearly from the 4 nearest
//     texels come from one filtered fetch of the analysis; where those texels are flat (sky, walls, road) the result
//     is a plain bilinear blend.
// Colour is sqrt-encoded in between (close to the display's gamma, where FSR is tuned; 8 bits per channel suffice).
import * as THREE from 'three';
import { Pass } from 'postprocessing';

const VERT = 'void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }';

const RCAS = /* glsl */`
uniform sampler2D tInput; // the post-processed frame (linear)
uniform float uSharpen;   // 0 off .. 1 full strength
layout(location = 0) out highp vec4 outColor; // sharpened, sqrt-encoded
layout(location = 1) out highp vec4 outEdge;  // EASU's edge terms: direction (x, y; 0.5 = none), length
vec3 tap(ivec2 p) { return sqrt(max(texelFetch(tInput, p, 0).rgb, 0.0)); }
float luma(vec3 c) { return c.b * 0.5 + (c.r * 0.5 + c.g); }
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy), lim = textureSize(tInput, 0) - 1;
  vec3 b = tap(clamp(p + ivec2(0, 1), ivec2(0), lim)), d = tap(clamp(p - ivec2(1, 0), ivec2(0), lim)), e = tap(p);
  vec3 f = tap(clamp(p + ivec2(1, 0), ivec2(0), lim)), h = tap(clamp(p - ivec2(0, 1), ivec2(0), lim));
  vec3 mn = min(min(b, d), min(f, h)), mx = max(max(b, d), max(f, h));
  vec3 hitMin = min(mn, e) / (4.0 * mx + 1e-4), hitMax = (1.0 - max(mx, e)) / (4.0 * mn - 4.0 - 1e-4);
  vec3 l = max(-hitMin, hitMax);
  // noise guard: a pixel standing out of its neighbours' range on its own is sharpened half as much
  const vec3 W = vec3(0.25, 0.5, 0.25);
  float lb = dot(b, W), ld = dot(d, W), lf = dot(f, W), lh = dot(h, W), le = dot(e, W);
  float range = max(max(max(lb, ld), max(lf, lh)), le) - min(min(min(lb, ld), min(lf, lh)), le);
  float nz = 1.0 - 0.5 * clamp(abs(0.25 * (lb + ld + lf + lh) - le) / (range + 1e-4), 0.0, 1.0);
  float lobe = max(-0.1875, min(max(l.r, max(l.g, l.b)), 0.0)) * uSharpen * nz;
  outColor = vec4((lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0), 1.0);
  // edge direction (luma differences across the texel) and length (how much of a single step the '+' is)
  float L = luma(b), D = luma(d), E = luma(e), F = luma(f), H = luma(h);
  vec2 dir = vec2(F - D, L - H);
  float lenX = clamp(abs(dir.x) / max(max(abs(F - E), abs(E - D)), 1e-4), 0.0, 1.0);
  float lenY = clamp(abs(dir.y) / max(max(abs(L - E), abs(E - H)), 1e-4), 0.0, 1.0);
  outEdge = vec4(dir * 0.25 + 0.5, 0.5 * (lenX * lenX + lenY * lenY), 1.0);
}`;

const EASU = /* glsl */`
precision mediump float; // colours and weights in half precision (twice the ALU rate on Apple GPUs); positions highp
uniform mediump sampler2D tColor; // sharpened, sqrt-encoded (sampled at texel centres: bilinear = exact, edges clamped)
uniform mediump sampler2D tEdge;  // the edge terms, blended bilinearly by the fetch
uniform highp vec2 uScale;        // input size / output size
uniform highp vec2 uTexel;        // 1 / input size
highp vec2 uvF;
#define TAP(x, y) textureLodOffset(tColor, uvF, 0.0, ivec2(x, y)).rgb
float luma(vec3 c) { return c.b * 0.5 + (c.r * 0.5 + c.g); }

// one tap of the rotated, anisotropic Lanczos-2 approximation
void accumulate(inout vec3 aC, inout float aW, vec2 off, vec2 dir, vec2 len2, float lob, float clp, vec3 c) {
  vec2 v = vec2(off.x * dir.x + off.y * dir.y, off.y * dir.x - off.x * dir.y) * len2;
  float d2 = min(dot(v, v), clp);
  float wB = 0.4 * d2 - 1.0, wA = lob * d2 - 1.0;
  float w = (1.5625 * wB * wB - 0.5625) * (wA * wA);
  aC += c * w; aW += w;
}

void main() {
  highp vec2 pp = gl_FragCoord.xy * uScale - 0.5, fp = floor(pp);
  uvF = (fp + 0.5) * uTexel;
  vec2 f = vec2(pp - fp);
  //    b c
  //  e F g h
  //  i j k l
  //    n o
  vec3 F = TAP(0, 0), g = TAP(1, 0), j = TAP(0, 1), k = TAP(1, 1);
  vec3 lo = min(min(F, g), min(j, k)), hi = max(max(F, g), max(j, k));
  vec3 c4;
  if (luma(hi - lo) < 1.0 / 64.0) c4 = mix(mix(F, g, f.x), mix(j, k, f.x), f.y); // flat: nothing to adapt to
  else {
    vec3 b = TAP(0, -1), c = TAP(1, -1), e = TAP(-1, 0), h = TAP(2, 0);
    vec3 i = TAP(-1, 1), l = TAP(2, 1), n = TAP(0, 2), o = TAP(1, 2);
    vec3 an = texture2D(tEdge, (pp + 0.5) * uTexel).xyz; // the 4 nearest texels' edge terms, bilinearly weighted
    vec2 dir = an.xy * 4.0 - 2.0;
    float dirR = dot(dir, dir), len = an.z * an.z;
    dir = dirR < 1.0 / 32768.0 ? vec2(1.0, 0.0) : dir * inversesqrt(dirR);
    // stretch the kernel along the edge (1 on axis-aligned edges, sqrt 2 on diagonals) and shorten it across
    float stretch = 1.0 / max(abs(dir.x), abs(dir.y));
    vec2 len2 = vec2(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
    float lob = 0.5 - 0.29 * len, clp = 1.0 / lob;
    vec3 aC = vec3(0.0); float aW = 0.0;
    accumulate(aC, aW, vec2(0.0, -1.0) - f, dir, len2, lob, clp, b);
    accumulate(aC, aW, vec2(1.0, -1.0) - f, dir, len2, lob, clp, c);
    accumulate(aC, aW, vec2(-1.0, 1.0) - f, dir, len2, lob, clp, i);
    accumulate(aC, aW, vec2(0.0, 1.0) - f, dir, len2, lob, clp, j);
    accumulate(aC, aW, vec2(0.0, 0.0) - f, dir, len2, lob, clp, F);
    accumulate(aC, aW, vec2(-1.0, 0.0) - f, dir, len2, lob, clp, e);
    accumulate(aC, aW, vec2(1.0, 1.0) - f, dir, len2, lob, clp, k);
    accumulate(aC, aW, vec2(2.0, 1.0) - f, dir, len2, lob, clp, l);
    accumulate(aC, aW, vec2(2.0, 0.0) - f, dir, len2, lob, clp, h);
    accumulate(aC, aW, vec2(1.0, 0.0) - f, dir, len2, lob, clp, g);
    accumulate(aC, aW, vec2(1.0, 2.0) - f, dir, len2, lob, clp, o);
    accumulate(aC, aW, vec2(0.0, 2.0) - f, dir, len2, lob, clp, n);
    c4 = clamp(aC / aW, lo, hi); // dering: stay within the 4 nearest texels
  }
  gl_FragColor = vec4(c4 * c4, 1.0);
  #include <colorspace_fragment>
}`;

export class UpscalePass extends Pass {
  constructor() {
    super('UpscalePass');
    this.needsSwap = false;
    this.sharpen = 0.8;
    // the sharpened frame and its edge terms (8 bits a channel, ~0.8 MB apiece on an iPhone 12)
    this.analysis = new THREE.WebGLRenderTarget(1, 1, { count: 2, depthBuffer: false });
    for (const t of this.analysis.textures) t.generateMipmaps = false;
    const mat = (fragmentShader, uniforms, glslVersion = null) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, glslVersion, depthTest: false, depthWrite: false });
    this.rcas = mat(RCAS, { tInput: { value: null }, uSharpen: { value: 0 } }, THREE.GLSL3);
    this.easu = mat(EASU, { tColor: { value: this.analysis.textures[0] }, tEdge: { value: this.analysis.textures[1] }, uScale: { value: new THREE.Vector2(1, 1) }, uTexel: { value: new THREE.Vector2(1, 1) } });
    this.fullscreenMaterial = this.rcas;
    this._size = new THREE.Vector2();
  }

  setSize(width, height) { this.analysis.setSize(width, height); }

  render(renderer, inputBuffer) {
    const out = renderer.getDrawingBufferSize(this._size), { width: w, height: h } = this.analysis;
    this.rcas.uniforms.tInput.value = inputBuffer.texture; this.rcas.uniforms.uSharpen.value = this.sharpen;
    this.fullscreenMaterial = this.rcas;
    renderer.setRenderTarget(this.analysis);
    renderer.render(this.scene, this.camera);
    this.easu.uniforms.uScale.value.set(w / out.x, h / out.y);
    this.easu.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.fullscreenMaterial = this.easu;
    renderer.setRenderTarget(null);
    renderer.clear(true, false, false); // (a tile GPU then starts the canvas blank instead of loading last frame's)
    renderer.render(this.scene, this.camera);
  }

  dispose() { super.dispose(); this.analysis.dispose(); this.rcas.dispose(); this.easu.dispose(); }
}
