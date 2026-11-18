// City height field: the static city rendered once, straight down, into a 2.5 m/px height texture. The city shaders
// use it for two things the 340 m sun shadow map can't do:
//   - far-field sun shadows: ray-march toward the sun through the height field beyond the shadow map's box, so towers
//     shade the streets and blocks around them all the way to the horizon (aerial views, long avenues);
//   - street-canyon sky occlusion: how much sky a point sees past the neighbouring buildings, darkening narrow streets,
//     courtyards and the feet of towers (ambient/sky light only — direct sun is handled above).
// One render at load (~0.1 s), then ~20 bilinear taps per city pixel.
import * as THREE from 'three';
import { SHADOW_EDGE } from './shadowfilter.js';

export const HF = {
  tex: { value: null },
  rect: { value: new THREE.Vector4(0, 0, 1, 1) },   // uv = (xz - rect.xy) * rect.zw
  on: { value: 0 },
  shadowCenter: { value: new THREE.Vector3() },       // where the shadow map is centred (sky.js keeps this current)
  shadowR: { value: 170 },
};

export const HF_GLSL = /* glsl */`
uniform sampler2D uHF; uniform vec4 uHFRect; uniform float uHFOn; uniform vec3 uHFShadowC; uniform float uHFShadowR;
// 1 where the sun's shadow map has no data, so the height field must shade: the map's box covers only what the camera
// sees of the shadow circle, up to low roofs (shadowfit.js), and its shadows fade out across the box's edge band
// (shadowfilter.js). A macro: vDirectionalShadowCoord is declared further down the fragment shader.
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
#define hfMapOut() (1.0 - smoothstep(0.0, ${SHADOW_EDGE.toFixed(3)}, min(min(vDirectionalShadowCoord[0].x, 1.0 - vDirectionalShadowCoord[0].x), min(vDirectionalShadowCoord[0].y, 1.0 - vDirectionalShadowCoord[0].y))))
#else
#define hfMapOut() 0.0
#endif
float hfH(vec2 xz) { return texture2D(uHF, (xz - uHFRect.xy) * uHFRect.zw).r; }
// sun visibility from the height field (1 lit, 0 shadowed), soft with distance along the ray
float hfSunVis(vec3 p, vec3 n, vec3 L) {
  if (L.y < 0.02) return 1.0;
  vec3 o = p + n * 0.6;
  float vis = 1.0, t = 4.0;
  // 13 steps growing 1.45x reach ~0.9 km along the ray: long low-sun shadows of the CBD towers; stop once the ray
  // is above everything in the city
  for (int i = 0; i < 13; i++) {
    vec3 q = o + L * t;
    if (q.y > 320.0) break;
    float h = hfH(q.xz);
    vis = min(vis, clamp((q.y - h) / (0.6 + t * 0.03), 0.0, 1.0));
    if (vis < 0.02) break; // fully in shadow already
    t *= 1.45;
  }
  return vis;
}
// fraction of the sky seen past nearby buildings (6 directions x 2 radii, only on the side the surface faces)
float hfSkyVis(vec3 p, vec3 n) {
  float occ = 0.0, wsum = 0.0;
  vec2 nxz = n.xz; float vert = 1.0 - smoothstep(0.55, 0.85, abs(n.y));
  for (int i = 0; i < 6; i++) {
    float a = float(i) * 1.0472 + 0.3;
    vec2 d = vec2(cos(a), sin(a));
    float w = mix(1.0, smoothstep(-0.15, 0.35, dot(d, nxz)), vert);
    float e1 = max(0.0, hfH(p.xz + d * 6.0) - p.y) / 6.0;
    float e2 = max(0.0, hfH(p.xz + d * 18.0) - p.y) / 18.0;
    float e3 = max(0.0, hfH(p.xz + d * 50.0) - p.y) / 50.0;
    // tangent of the horizon elevation in that direction -> blocked share of that sky slice (sin^2 of the angle)
    float sl = max(max(e1, e2), e3);
    occ += w * sl * sl / (1.0 + sl * sl);
    wsum += w;
  }
  return 1.0 - occ / max(wsum, 1e-3);
}
`;

export function bakeHeightField(renderer, scene, objects, { xmin, zmin, xmax, zmax, res = 2.5, top = 700 } = {}) {
  const w = Math.min(4096, Math.ceil((xmax - xmin) / res)), h = Math.min(4096, Math.ceil((zmax - zmin) / res));
  const depthRT = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
  depthRT.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
  const near = 1, far = top + 50;
  const cam = new THREE.OrthographicCamera(xmin, xmax, -zmin, -zmax, near, far);
  cam.position.set(0, top, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  cam.layers.enableAll();
  // only the static city: hide everything else at the top level, depth only
  const keep = new Set(objects), hidden = [];
  for (const o of scene.children) if (!keep.has(o) && o.visible) { o.visible = false; hidden.push(o); }
  const prevOverride = scene.overrideMaterial, prevRT = renderer.getRenderTarget(), prevShadow = renderer.shadowMap.enabled;
  const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  scene.overrideMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  renderer.shadowMap.enabled = false;
  renderer.setRenderTarget(depthRT); renderer.setClearColor(0x000000, 0); renderer.clear();
  renderer.render(scene, cam);
  scene.overrideMaterial.dispose(); scene.overrideMaterial = prevOverride;
  renderer.shadowMap.enabled = prevShadow;
  for (const o of hidden) o.visible = true;
  // depth -> metres in a filterable half-float texture
  const hRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RedFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { tDepth: { value: depthRT.depthTexture }, uTop: { value: top }, uNear: { value: near }, uFar: { value: far } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    // ortho depth is linear; nothing drawn (depth 1) = sea level
    fragmentShader: 'uniform sampler2D tDepth; uniform float uTop, uNear, uFar; varying vec2 vUv; void main() { float d = texture2D(tDepth, vUv).r; float hgt = d >= 0.99999 ? -1.4 : uTop - (uNear + d * (uFar - uNear)); gl_FragColor = vec4(max(hgt, -1.4), 0.0, 0.0, 1.0); }',
    depthTest: false, depthWrite: false,
  }));
  const qs = new THREE.Scene(); qs.add(quad);
  renderer.setRenderTarget(hRT); renderer.render(qs, cam);
  renderer.setRenderTarget(prevRT); renderer.setClearColor(prevClear, prevAlpha);
  quad.geometry.dispose(); quad.material.dispose(); depthRT.depthTexture.dispose(); depthRT.dispose();
  // texture v runs from z = zmax (v = 0, bottom of the ortho view) to zmin (v = 1): flipped in the rect
  HF.tex.value = hRT.texture;
  HF.rect.value.set(xmin, zmax, 1 / (xmax - xmin), -1 / (zmax - zmin));
  HF.on.value = 1;
  return { rt: hRT, w, h };
}
