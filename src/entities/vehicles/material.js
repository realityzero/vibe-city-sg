// "Uber" vehicle material: one MeshPhysicalMaterial drives every part of a vehicle.
// Per-vertex attributes carry the surface type so a whole car is a single draw call:
//   color  vec3  base colour (linear)           matp vec4  (roughness, metalness, clearcoat, flag)
//   emit   vec4  (emissive rgb, light channel)   uv   vec2  atlas lookup (white texel for plain parts)
// flag: 0 plain, 1 body paint (multiplied by the per-car paint colour), 2 decal (alpha-tested texture).
// Light channels: 1 head, 2 tail/brake, 3 indicator L, 4 indicator R, 5 reverse, 6 siren red,
//                 7 siren blue, 8 taxi sign (green free / red hired), 9 always-on display, 10 DRL,
//                 11 nav light (steady), 12 white strobe, 13 red anti-collision beacon.
// Per-car state comes from instanced attributes (iPaint vec3, iLights vec4) or uniforms (uPaint, uLights).
// iLights = (head 0..1, brake 0..1, siren 0/1, bits: 1 indL, 2 indR, 4 reverse, 8 taxi hired).
import * as THREE from 'three';
import { markMoving } from '../../gfx/taa.js';

export const vehicleTime = { value: 0 };

const lin = hex => new THREE.Color(hex);

export const MAT = {
  paint: { color: 0xffffff, rough: 0.3, metal: 0.25, cc: 1, flag: 1 },
  paintMatte: { color: 0xffffff, rough: 0.55, metal: 0.05, cc: 0.3, flag: 1 },
  // tinted glazing: a dark dielectric with a clear-coat sheen (reflections come from Fresnel, not a metal mirror)
  glass: { color: 0x1d242b, rough: 0.03, metal: 0.12, cc: 1 },
  glassDark: { color: 0x0e1216, rough: 0.03, metal: 0.12, cc: 1 },
  black: { color: 0x141414, rough: 0.6, metal: 0, cc: 0 },
  trim: { color: 0x0c0c0c, rough: 0.25, metal: 0.2, cc: 0.8 },
  chrome: { color: 0xf0f0f0, rough: 0.05, metal: 1, cc: 0 },
  alloy: { color: 0xc4c8cc, rough: 0.2, metal: 1, cc: 0.6 },
  darkAlloy: { color: 0x3a3d40, rough: 0.3, metal: 1, cc: 0.6 },
  steel: { color: 0x7a7e82, rough: 0.45, metal: 0.9, cc: 0 },
  rubber: { color: 0x1a1a1a, rough: 0.9, metal: 0, cc: 0 },
  tread: { color: 0x101010, rough: 0.95, metal: 0, cc: 0 },
  under: { color: 0x0a0a0a, rough: 0.95, metal: 0, cc: 0 },
  interior: { color: 0x26231f, rough: 0.85, metal: 0, cc: 0 },
  leather: { color: 0x6b3f26, rough: 0.55, metal: 0, cc: 0.2 },
  grille: { color: 0x0b0b0b, rough: 0.35, metal: 0.6, cc: 0.5 },
  disc: { color: 0x5c5c5c, rough: 0.35, metal: 0.9, cc: 0 },
  caliper: { color: 0xc8161b, rough: 0.35, metal: 0.2, cc: 0.8 },
  canvas: { color: 0x2f6b45, rough: 0.95, metal: 0, cc: 0 },
  plastic: { color: 0x2a2a2a, rough: 0.5, metal: 0, cc: 0.2 },
  painted: { color: 0x808080, rough: 0.45, metal: 0.1, cc: 0.4 },
  hivis: { color: 0xff7a1a, rough: 0.8, metal: 0, cc: 0 },
  hardhat: { color: 0xffd21a, rough: 0.4, metal: 0, cc: 0.6 },
  decal: { color: 0xffffff, rough: 0.32, metal: 0.15, cc: 1, flag: 2 },
  decalMatte: { color: 0xffffff, rough: 0.6, metal: 0.05, cc: 0, flag: 2 },
  head: { color: 0x9fb0bc, rough: 0.05, metal: 0.55, cc: 1, emit: 0xfff4e0, ch: 1 },
  drl: { color: 0xeef2ff, rough: 0.1, metal: 0.3, cc: 1, emit: 0xdde6ff, ch: 10 },
  tail: { color: 0x5e0507, rough: 0.08, metal: 0.2, cc: 1, emit: 0xff0202, ch: 2 },
  indL: { color: 0x9a5208, rough: 0.08, metal: 0.2, cc: 1, emit: 0xff7a10, ch: 3 },
  indR: { color: 0x9a5208, rough: 0.08, metal: 0.2, cc: 1, emit: 0xff7a10, ch: 4 },
  rev: { color: 0xc8c8c8, rough: 0.06, metal: 0.4, cc: 1, emit: 0xffffff, ch: 5 },
  sirenR: { color: 0x6a0608, rough: 0.1, metal: 0.1, cc: 1, emit: 0xff1008, ch: 6 },
  sirenB: { color: 0x061060, rough: 0.1, metal: 0.1, cc: 1, emit: 0x1040ff, ch: 7 },
  taxiSign: { color: 0xffffff, rough: 0.3, metal: 0, cc: 0.5, emit: 0xffffff, ch: 8, flag: 2 },
  display: { color: 0xffffff, rough: 0.3, metal: 0, cc: 0.5, emit: 0xffa020, ch: 9, flag: 2 },
  navRed: { color: 0x6a0606, rough: 0.1, metal: 0.1, cc: 1, emit: 0xff1010, ch: 11 },
  navGreen: { color: 0x066a20, rough: 0.1, metal: 0.1, cc: 1, emit: 0x10ff50, ch: 11 },
  navWhite: { color: 0xd8d8d0, rough: 0.1, metal: 0.1, cc: 1, emit: 0xfff2d8, ch: 11 },
  strobe: { color: 0xdedede, rough: 0.1, metal: 0.2, cc: 1, emit: 0xffffff, ch: 12 },
  beacon: { color: 0x700808, rough: 0.1, metal: 0.1, cc: 1, emit: 0xff1a08, ch: 13 },
  wood: { color: 0x8a5a2e, rough: 0.7, metal: 0, cc: 0.2 },
  nonskid: { color: 0xdedbd2, rough: 0.85, metal: 0, cc: 0 },
  rotor: { color: 0x1c1c1e, rough: 0.45, metal: 0.4, cc: 0.3 },
  skin: { color: 0xb9805a, rough: 0.7, metal: 0, cc: 0 },
  cloth: { color: 0x334455, rough: 0.9, metal: 0, cc: 0 },
};
for (const k in MAT) {
  const m = MAT[k];
  m.lin = lin(m.color);
  m.emitLin = m.emit != null ? lin(m.emit) : null;
  m.flag ??= 0; m.ch ??= 0;
}

const VERT_PARS = /* glsl */`
varying vec3 vLP;
varying vec3 vLN;
attribute vec4 matp;
attribute vec4 emit;
varying vec4 vMatP;
varying vec4 vEmit;
varying vec4 vLights;
varying float vPhase;
#ifdef USE_INSTANCING
  attribute vec3 iPaint;
  attribute vec4 iLights;
#else
  uniform vec3 uPaint;
  uniform vec4 uLights;
#endif
`;
const VERT_COLOR = /* glsl */`
vMatP = matp; vEmit = emit; vLP = position; vLN = normal;
#ifdef USE_INSTANCING
  vec3 paintC = iPaint; vLights = iLights; vPhase = float(gl_InstanceID) * 0.6180339;
#else
  vec3 paintC = uPaint; vLights = uLights; vPhase = 0.0;
#endif
if (matp.w > 0.5 && matp.w < 1.5) vColor.rgb *= paintC;
`;
const FRAG_PARS = /* glsl */`
varying vec3 vLP;
varying vec3 vLN;
uniform vec4 uDecalA; // zF, L, yMax (side), W
uniform vec4 uDecalB; // yMax (front/rear), front depth, rear depth, enabled
uniform vec4 uDecalC; // yMin (side), yMin (front/rear)
uniform vec4 uRectSR; uniform vec4 uRectSL; uniform vec4 uRectF; uniform vec4 uRectR;
varying vec4 vMatP;
varying vec4 vEmit;
varying vec4 vLights;
varying float vPhase;
uniform float uVTime;
`;
// Livery decals on painted surfaces, mapped procedurally from object-space position (no extra geometry).
const FRAG_DECAL = /* glsl */`
#ifdef USE_MAP
{
  vec3 n = normalize(vLN);
  float zR = uDecalA.x + uDecalA.y;
  vec2 fS = vec2(vLP.x >= 0.0 ? (zR - vLP.z) / uDecalA.y : (vLP.z - uDecalA.x) / uDecalA.y, (uDecalA.z - vLP.y) / (uDecalA.z - uDecalC.x));
  vec4 rS = vLP.x >= 0.0 ? uRectSR : uRectSL;
  vec2 uvS = rS.xy + clamp(fS, 0.0, 1.0) * rS.zw;
  vec2 uvF = uRectF.xy + clamp(vec2((uDecalA.w * 0.5 - vLP.x) / uDecalA.w, (uDecalB.x - vLP.y) / (uDecalB.x - uDecalC.y)), 0.0, 1.0) * uRectF.zw;
  vec2 uvR = uRectR.xy + clamp(vec2((vLP.x + uDecalA.w * 0.5) / uDecalA.w, (uDecalB.x - vLP.y) / (uDecalB.x - uDecalC.y)), 0.0, 1.0) * uRectR.zw;
  vec2 gSx = dFdx(uvS), gSy = dFdy(uvS), gFx = dFdx(uvF), gFy = dFdy(uvF), gRx = dFdx(uvR), gRy = dFdy(uvR);
  float side = step(0.3, abs(n.x));
  float front = (1.0 - side) * step(n.z, -0.25) * step(vLP.z, uDecalA.x + uDecalB.y);
  float rear = (1.0 - side) * step(0.25, n.z) * step(zR - uDecalB.z, vLP.z);
  vec2 uv = side > 0.5 ? uvS : (front > 0.5 ? uvF : uvR);
  vec2 gx = side > 0.5 ? gSx : (front > 0.5 ? gFx : gRx);
  vec2 gy = side > 0.5 ? gSy : (front > 0.5 ? gFy : gRy);
  vec4 dcl = textureGrad(map, uv, gx, gy);
  float isPaint = step(0.5, vMatP.w) * step(vMatP.w, 1.5);
  float use = max(side, max(front, rear)) * isPaint * uDecalB.w;
  diffuseColor.rgb = mix(diffuseColor.rgb, dcl.rgb, dcl.a * use);
}
#endif
`;
const FRAG_EMIT = /* glsl */`
{
  float ch = floor(vEmit.a + 0.5);
  if (ch > 0.5) {
    float head = vLights.x, brake = vLights.y, siren = vLights.z, bits = vLights.w;
    float indL = mod(bits, 2.0);
    float indR = mod(floor(bits * 0.5), 2.0);
    float rev = mod(floor(bits * 0.25), 2.0);
    float hired = mod(floor(bits * 0.125), 2.0);
    float blink = step(0.5, fract(uVTime * 1.45 + vPhase));
    float ts = uVTime * 7.0 + vPhase * 5.0;
    float half_ = step(0.5, fract(ts * 0.25));
    float flick = step(0.35, fract(ts));
    float sA = half_ * flick, sB = (1.0 - half_) * flick;
    vec3 ec = vEmit.rgb;
    float k = 0.0;
    if (ch < 1.5) k = head * 9.0;
    else if (ch < 2.5) k = head * 1.1 + brake * 6.0;
    else if (ch < 3.5) k = indL * blink * 7.0;
    else if (ch < 4.5) k = indR * blink * 7.0;
    else if (ch < 5.5) k = rev * 4.0;
    else if (ch < 6.5) k = siren * sA * 14.0;
    else if (ch < 7.5) k = siren * sB * 14.0;
    else if (ch < 8.5) { k = 3.5; ec = mix(vec3(0.12, 1.0, 0.25), vec3(1.0, 0.1, 0.05), hired); }
    else if (ch < 9.5) k = 3.0;
    else if (ch < 10.5) k = 2.0 + head * 3.0;
    else if (ch < 11.5) k = 0.4 + head * 4.0;                                        // nav light (steady, own colour)
    else if (ch < 12.5) { float st = fract(uVTime * 0.8 + vPhase); k = head * 22.0 * (step(st, 0.05) + step(0.12, st) * step(st, 0.17)); } // white double strobe
    else { float bt = fract(uVTime * 1.1 + vPhase * 0.3); k = max(head, siren) * 12.0 * smoothstep(0.0, 0.05, bt) * (1.0 - smoothstep(0.1, 0.3, bt)); } // red anti-collision beacon
    #ifdef USE_MAP
      vec3 tex = sampledDiffuseColor.rgb;
    #else
      vec3 tex = vec3(1.0);
    #endif
    totalEmissiveRadiance += ec * k * tex;
  }
}
`;

// Hero rig: a hero vehicle's moving parts (wheels, pop-up lamps, rotor blades) are drawn with its body. Each vertex
// names its part in the `part` attribute (0 = rigid body) and uPart[] holds every part's matrix from its own frame into
// vehicle space (all zeros = hidden). The wheel geometry is drawn once per wheel by an instanced draw without instanced
// attributes: wheel i reads slot 2i (part 1: spins and steers) and 2i + 1 (part 2: steers only, the caliper).
// Body parts use slots WHEEL_SLOTS.. (part = slot + 1).
export const RIG_SLOTS = 12, WHEEL_SLOTS = 8;
const RIG_PARS = /* glsl */`
attribute float part;
uniform mat4 uPart[${RIG_SLOTS}];
mat4 rigPart() { int s = int(part + 0.5) - 1 + 2 * gl_InstanceID; return s < 0 ? mat4(1.0) : uPart[s]; }
`;

/**
 * Creates the uber material. instanced=true reads per-instance attributes; otherwise uniforms
 * (material.userData.uPaint / uLights) that the caller mutates. rig=true moves vertices by part (see RIG_PARS;
 * material.userData.uPart, geometry attribute `part`).
 */
export function createVehicleMaterial(atlas, { instanced = false, transparent = false, rig = false } = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, map: atlas || null,
    roughness: 0.5, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06,
    alphaTest: 0.5, envMapIntensity: 1,
  });
  if (transparent) { m.transparent = true; m.alphaTest = 0; m.opacity = 0.82; m.depthWrite = false; }
  markMoving(m); // (vehicles move on their own: temporal AA treats their pixels apart, gfx/taa.js)
  m.userData.uPaint = { value: new THREE.Color(1, 1, 1) };
  m.userData.uLights = { value: new THREE.Vector4(0, 0, 0, 0) };
  if (rig) m.userData.uPart = { value: Array.from({ length: RIG_SLOTS }, () => new THREE.Matrix4()) };
  const U = m.userData.decal = {
    uDecalA: { value: new THREE.Vector4(-2, 4, 1.2, 1.8) }, uDecalB: { value: new THREE.Vector4(1.1, 0.3, 0.3, 0) }, uDecalC: { value: new THREE.Vector4(0, 0, 0, 0) },
    uRectSR: { value: new THREE.Vector4() }, uRectSL: { value: new THREE.Vector4() }, uRectF: { value: new THREE.Vector4() }, uRectR: { value: new THREE.Vector4() },
  };
  m.onBeforeCompile = shader => {
    shader.uniforms.uVTime = vehicleTime;
    if (!instanced) { shader.uniforms.uPaint = m.userData.uPaint; shader.uniforms.uLights = m.userData.uLights; }
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <color_vertex>', '#include <color_vertex>\n' + VERT_COLOR);
    if (rig) {
      shader.uniforms.uPart = m.userData.uPart;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + RIG_PARS)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nmat4 partM = rigPart();\nobjectNormal = mat3(partM) * objectNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = (partM * vec4(transformed, 1.0)).xyz;');
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_DECAL)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vMatP.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMatP.y;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat = saturate(clearcoat * vMatP.z);\n#endif')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_EMIT);
  };
  m.customProgramCacheKey = () => `vehicleUber_${instanced ? 1 : 0}_${transparent ? 1 : 0}${rig ? '_rig' : ''}`;
  return m;
}

/** Shadow-depth twin of a rig material (object.customDepthMaterial): the same parts in the same places. The shadow
 * renderer copies map / alphaTest over from the drawn material, as it does for its own depth material. */
export function createRigDepthMaterial(rigMaterial) {
  const m = new THREE.MeshDepthMaterial();
  m.onBeforeCompile = shader => {
    shader.uniforms.uPart = rigMaterial.userData.uPart;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + RIG_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = (rigPart() * vec4(transformed, 1.0)).xyz;');
  };
  m.customProgramCacheKey = () => 'vehicleRigDepth';
  return m;
}

/** Configures procedural livery decal mapping (see FRAG_DECAL). d = {zF, L, yMax, W, yF, frontDepth, rearDepth}, atlas = Atlas */
export function setDecalParams(m, d, atlas) {
  const U = m.userData.decal;
  if (!d) { U.uDecalB.value.w = 0; return; }
  U.uDecalA.value.set(d.zF, d.L, d.yMax, d.W);
  U.uDecalB.value.set(d.yF, d.frontDepth, d.rearDepth, 1);
  U.uDecalC.value.set(d.yMin ?? 0, d.yMinF ?? 0, 0, 0);
  const r = (name, v) => { const [x0, y0, x1, y1] = atlas.rect(name); const px = 1 / 1024; v.set(x0 + px, y0 + px, (x1 - x0) - 2 * px, (y1 - y0) - 2 * px); };
  r('sideR', U.uRectSR.value); r('sideL', U.uRectSL.value); r('front', U.uRectF.value); r('rear', U.uRectR.value);
}

/** Packs light flags into the iLights/uLights vec4 layout. */
export function packLights(l = {}, out = [0, 0, 0, 0]) {
  out[0] = l.head ? 1 : 0;
  out[1] = l.brake ? 1 : 0;
  out[2] = l.siren ? 1 : 0;
  out[3] = (l.indicatorL ? 1 : 0) + (l.indicatorR ? 2 : 0) + (l.reverse ? 4 : 0) + (l.taxiSign === 'hired' ? 8 : 0);
  return out;
}
