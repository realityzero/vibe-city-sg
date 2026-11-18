// Temporal anti-aliasing at the internal resolution, ahead of bloom and tone mapping (so the glow and the exposure
// see a stable frame too). Each frame the scene is drawn with a different sub-pixel offset of the projection (Halton
// 2,3); this pass reprojects last frame's result onto the new frame from the depth buffer and the two camera poses —
// the static city lands exactly where it was — clips it to the new frame's 3x3 neighbourhood (whatever changed, lit up
// or was uncovered can't leave a trail) and blends ~1/10 of the new frame in. Edges and sub-pixel detail (Supertree
// lattice, railings, roof tiles, leaf shadows, the Esplanade's spikes) are averaged over many offsets instead of crawling.
// Things that move on their own (cars, people) have no motion vectors, and a small one's 3x3 neighbourhood always
// holds the background it is crossing, so clipping alone would let them fade in like ghosts. Their materials write a
// stencil mark instead (markMoving), and the resolve runs once per mark:
//  - the static world (0): reprojected history, except where a moving thing stood last frame (that is its trail) —
//    the history's alpha remembers where they were;
//  - moving things (MOVING): last frame's pixel at the same place if a moving thing was there too, clipped hard and
//    weighted lightly; otherwise none;
//  - the player's vehicle (CARRIED, see carry()): one rigid body whose two poses are known, so its pixels are
//    reprojected exactly through them and accumulate like the static world, whatever the camera does.
// Memory: one RGBA16F history at the internal resolution (~1.7 MB on an iPhone 12), plus the stencil bits.
import * as THREE from 'three';
import { Pass } from 'postprocessing';

export const MOVING = 1, CARRIED = 2;

/** Marks a material as drawing something that moves on its own (see above). Render state only: no new program. */
export function markMoving(material, mark = MOVING) {
  Object.assign(material, { stencilWrite: true, stencilRef: mark, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
  return material;
}

const halton = (i, b) => { let f = 1, r = 0; for (; i > 0; i = Math.floor(i / b)) { f /= b; r += f * (i % b); } return r; };
const JITTER = Array.from({ length: 8 }, (_, i) => [halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5]);

const FRAG = /* glsl */`
uniform sampler2D tColor;   // this frame, drawn with the jitter (linear HDR)
uniform sampler2D tDepth;   // this frame's depth
uniform sampler2D tHistory; // last frame's result (linear HDR; alpha 1 where a moving thing was)
uniform mat4 uReproject;    // this frame's NDC -> last frame's clip space (both without jitter): the static world
uniform mat4 uCarry;        // the same for points riding on the carried vehicle
uniform vec2 uJitter;       // this frame's sub-pixel offset, pixels
uniform float uReset;
varying vec2 vUv;

// blending and clipping run on a reversibly tone-mapped colour: a street lamp 20x over white mustn't outweigh its
// neighbours (fireflies, aliased bright edges)
vec3 compress(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }
vec3 expand(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-3); }
vec3 toYCoCg(vec3 c) { return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25))); }
vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }

// Catmull-Rom history fetch from 5 bilinear taps: a sharp resample, so the image doesn't soften frame after frame
vec3 sampleHistory(vec2 uv, vec2 size) {
  vec2 p = uv * size, t1 = floor(p - 0.5) + 0.5, f = p - t1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2, t12 = (t1 + w2 / w12) / size, t0 = (t1 - 1.0) / size, t3 = (t1 + 2.0) / size;
  vec3 c = texture2D(tHistory, vec2(t12.x, t0.y)).rgb * (w12.x * w0.y) + texture2D(tHistory, vec2(t0.x, t12.y)).rgb * (w0.x * w12.y)
    + texture2D(tHistory, t12).rgb * (w12.x * w12.y) + texture2D(tHistory, vec2(t3.x, t12.y)).rgb * (w3.x * w12.y)
    + texture2D(tHistory, vec2(t12.x, t3.y)).rgb * (w12.x * w3.y);
  return max(c / (w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y), 0.0);
}

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy), lim = textureSize(tColor, 0) - 1;
  vec2 size = vec2(lim + 1);
  // the 3x3 neighbourhood: its colour moments (the clip box) and this frame resampled at the pixel centre (the jitter
  // undone: a Blackman-Harris-like reconstruction)
  vec3 m1 = vec3(0.0), m2 = vec3(0.0), mn = vec3(1e9), mx = vec3(-1e9), cur = vec3(0.0);
  float wsum = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 c = toYCoCg(compress(texelFetch(tColor, clamp(px + ivec2(x, y), ivec2(0), lim), 0).rgb));
    m1 += c; m2 += c * c; mn = min(mn, c); mx = max(mx, c);
    vec2 o = vec2(x, y) - uJitter;
    float w = exp(-2.29 * dot(o, o));
    cur += c * w; wsum += w;
  }
  cur /= wsum;
  vec3 mu = m1 / 9.0, sigma = sqrt(max(m2 / 9.0 - mu * mu, 0.0));
#ifdef MOVING
  // last frame at this very pixel, if a moving thing was there too
  vec4 last = texture2D(tHistory, vUv);
  float alpha = last.a > 0.5 ? 0.5 : 1.0, gamma = 1.0;
  vec3 h = toYCoCg(compress(last.rgb));
#else
  // reprojected through both camera poses (and, riding on the carried vehicle, both of its poses)
  #ifdef CARRIED
  vec4 pc = uCarry * vec4(vUv * 2.0 - 1.0, texelFetch(tDepth, px, 0).r * 2.0 - 1.0, 1.0);
  #else
  vec4 pc = uReproject * vec4(vUv * 2.0 - 1.0, texelFetch(tDepth, px, 0).r * 2.0 - 1.0, 1.0);
  #endif
  vec2 uv = pc.xy / pc.w * 0.5 + 0.5;
  bool onScreen = pc.w > 0.0 && all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)));
  // a history resampled frame after frame softens: the faster the view sweeps across, the more of the new frame goes
  // in and the tighter the box (a still view averages ~10 jittered frames; driving past foliage, ~3)
  float motion = clamp(length((uv - vUv) * size) / 10.0, 0.0, 1.0);
  float gamma = mix(1.25, 0.85, motion), alpha = mix(0.1, 0.3, motion);
  // history only from the same kind of surface: none where a moving thing stood last frame (its trail), and for the
  // vehicle, only its own last image
  float was = texture2D(tHistory, uv).a;
  #ifdef CARRIED
  alpha = onScreen && was > 0.5 ? alpha : 1.0;
  #else
  alpha = onScreen ? max(alpha, was) : 1.0;
  #endif
  vec3 h = toYCoCg(compress(sampleHistory(uv, size)));
#endif
  if (uReset > 0.5) alpha = 1.0;
  // clip the history toward the box centre (not a per-channel clamp: keeps its hue)
  vec3 lo = max(mn, mu - gamma * sigma), hi = min(mx, mu + gamma * sigma);
  vec3 centre = 0.5 * (hi + lo), ext = max(0.5 * (hi - lo), vec3(1e-4)), v = h - centre;
  vec3 a = abs(v / ext);
  float m = max(a.x, max(a.y, a.z));
  if (m > 1.0) h = centre + v / m;
#if defined(MOVING) || defined(CARRIED)
  gl_FragColor = vec4(expand(max(fromYCoCg(mix(h, cur, alpha)), 0.0)), 1.0);
#else
  gl_FragColor = vec4(expand(max(fromYCoCg(mix(h, cur, alpha)), 0.0)), 0.0);
#endif
}`;

const VERT = 'varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }';

export class TAAPass extends Pass {
  /** @param {THREE.PerspectiveCamera} view the scene camera (jittered while the RenderPass draws) */
  constructor(view) {
    super('TAAPass');
    this.view = view;
    this.needsDepthTexture = true;
    this.needsSwap = true;
    // last frame's result, copied in after the resolve (no ping-pong pair)
    this.history = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.history.texture.generateMipmaps = false;
    const uniforms = {
      tColor: { value: null }, tDepth: { value: null }, tHistory: { value: this.history.texture },
      uReproject: { value: new THREE.Matrix4() }, uCarry: { value: new THREE.Matrix4() }, uJitter: { value: new THREE.Vector2() }, uReset: { value: 1 },
    };
    // one draw per stencil mark (the stencil test picks the pixels; nothing is written to it)
    const resolve = (mark, defines) => new THREE.ShaderMaterial({ uniforms, defines, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
      stencilWrite: true, stencilWriteMask: 0, stencilRef: mark, stencilFunc: THREE.EqualStencilFunc });
    this.resolves = [resolve(0, {}), resolve(MOVING, { MOVING: '' }), resolve(CARRIED, { CARRIED: '' })];
    this.fullscreenMaterial = this.resolves[0];
    this.frame = 0;
    this.saved = new THREE.Matrix4(); this.savedInv = new THREE.Matrix4();
    this.viewProj = new THREE.Matrix4(); this.prevViewProj = new THREE.Matrix4(); this.prevPos = new THREE.Vector3();
    this.carried = null; this.carriedPose = new THREE.Matrix4(); this.prevCarriedPose = null;
    this.reset = true;
  }

  /** marks the player's vehicle: its pixels are reprojected through its own two poses (see above) */
  carry(object) {
    if (object === this.carried) return;
    this.carried?.traverse(o => { if (o.material?.stencilRef === CARRIED) o.material.stencilRef = MOVING; });
    object?.traverse(o => { if (o.material?.stencilRef === MOVING) o.material.stencilRef = CARRIED; });
    this.carried = object; this.prevCarriedPose = null;
  }

  setDepthTexture(depthTexture) { this.resolves[0].uniforms.tDepth.value = depthTexture; }
  setSize(width, height) { this.history.setSize(width, height); this.reset = true; }

  /** offsets the projection by this frame's sub-pixel jitter (the RenderPass draws with it); returns true if applied */
  jitter() {
    const cam = this.view, w = this.history.width, h = this.history.height;
    if (w < 2) return false;
    cam.updateMatrixWorld();
    this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const [jx, jy] = JITTER[this.frame++ % JITTER.length];
    this.resolves[0].uniforms.uJitter.value.set(jx, jy);
    this.saved.copy(cam.projectionMatrix); this.savedInv.copy(cam.projectionMatrixInverse);
    const e = cam.projectionMatrix.elements;
    e[8] -= 2 * jx / w; e[9] -= 2 * jy / h; // shifts the image by (jx, jy) pixels
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    return true;
  }
  unjitter() { this.view.projectionMatrix.copy(this.saved); this.view.projectionMatrixInverse.copy(this.savedInv); }

  render(renderer, inputBuffer, outputBuffer) {
    const U = this.resolves[0].uniforms, cam = this.view, gl = renderer.getContext(), props = renderer.properties;
    const { width: w, height: h } = this.history;
    // a cut (teleport, cutscene shot change) starts over rather than blending two unrelated views
    U.uReset.value = this.reset || cam.position.distanceToSquared(this.prevPos) > 400 ? 1 : 0;
    U.tColor.value = inputBuffer.texture;
    const toWorld = U.uReproject.value.copy(this.viewProj).invert();
    // the carried vehicle: from this frame's view into its own frame, out to the world at its last pose (just taken
    // over: as if it stood still)
    if (this.carried) this.carriedPose.copy(this.carried.matrixWorld);
    U.uCarry.value.copy(this.carriedPose).invert().premultiply(this.prevCarriedPose ?? this.carriedPose).premultiply(this.prevViewProj).multiply(toWorld);
    toWorld.premultiply(this.prevViewProj);
    // the scene's stencil marks next to the output, then one resolve per mark
    renderer.setRenderTarget(outputBuffer);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, props.get(inputBuffer).__webglFramebuffer);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.STENCIL_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    for (const m of this.resolves) { this.fullscreenMaterial = m; renderer.render(this.scene, this.camera); }
    // keep this frame's result for the next one
    renderer.setRenderTarget(this.history);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, props.get(outputBuffer).__webglFramebuffer);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    renderer.setRenderTarget(null);
    this.prevViewProj.copy(this.viewProj); this.prevPos.copy(cam.position);
    if (this.carried) (this.prevCarriedPose ??= new THREE.Matrix4()).copy(this.carriedPose);
    this.reset = false;
  }

  dispose() { super.dispose(); this.history.dispose(); for (const m of this.resolves) m.dispose(); }
}
