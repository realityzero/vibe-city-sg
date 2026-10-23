// GPU-instanced pedestrian crowd: one draw call (+1 shadow) for hundreds of people.
// Limbs are animated in the vertex shader from per-instance (anim, phase, speed); body shape, clothes,
// hair style and accessories vary per instance. Built on MeshStandardMaterial so lighting/shadows/fog match.
import * as THREE from 'three';
import { withLampField } from '../../gfx/lampfield.js';
import { MeshBuilder } from './builder.js';
import { makeRest, makeShape, headRadius, headPoint, HEAD_C, HAIR_STYLES, hairShellRadius, EYE_DIR } from './body.js';
import { getAtlas, cellRect, PATTERN_LIST } from './atlas.js';
import { mulberry, SKIN, HAIR } from './presets.js';

// crowd joints
const J = { hips: 0, torso: 1, head: 2, uaL: 3, laL: 4, uaR: 5, laR: 6, ulL: 7, llL: 8, ulR: 9, llR: 10, ftL: 11, ftR: 12 };
// colour parts
const P = { skin: 0, torso: 1, arm: 2, leg: 3, hair: 4, shoe: 5, dark: 7, acc: 8, lips: 9, brow: 10, bottom: 12, acc2: 13, white: 14 };
// optional pieces
export const CROWD_HAIR = { short: 1, long: 2, bob: 3, bun: 4, bald: 5 };
export const CROWD_ACC = { backpack: 1 << 1, bag: 1 << 2, cap: 1 << 3, visor: 1 << 4, lanyard: 1 << 5, glasses: 1 << 7 };
export const CROWD_ANIM = { idle: 0, walk: 1, run: 2, flee: 3, knocked: 4, idle_phone: 5, walk_phone: 6, sit: 7, sit_eat: 8, clap: 9, wave: 10, cheer: 11, talk: 12 };
const PIECE = { always: 0, skirt: 6, backpack: 7, bag: 8, cap: 9, visor: 10, lanyard: 11, phone: 12, glasses: 13 };

const wrapU = u => u - Math.floor(u);
const lerp = (a, b, t) => a + (b - a) * t;

const baseGeos = {};
function buildCrowdGeometry(lod = 'high') {
  const lo = lod === 'low';
  const b = new MeshBuilder();
  const rest = makeRest({});
  const shape = makeShape({});
  const D = (joint, part, extra = {}) => ({ w: [[0, 1]], joint, part, ...extra });
  // torso
  const ys = [1.525, 1.502, 1.48, 1.456, 1.42, 1.36, 1.29, 1.23, 1.16, 1.10, 1.04, 0.98, 0.92, 0.875, 0.845, 0.828];
  const rings = ys.map(y => { const t = shape.torso(y); return { c: [0, y, t.zc], rx: t.rx + (y > 0.95 && y < 1.44 ? 0.006 : 0), rz: t.rz + (y > 0.95 && y < 1.44 ? 0.005 : 0), m: th => { const c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th)); return 1 / Math.pow(c ** 2.4 + s ** 2.4, 1 / 2.4); }, zf: th => (t.rx > 0 ? shape.torsoZF(th, y) : 0) }; });
  b.tube(rings, lo ? 9 : 14, (r, th, p) => D(p[1] < 0.99 ? J.hips : J.torso, P.torso, { uv: [wrapU((th - Math.PI / 2) / (Math.PI * 2)), Math.min(1, Math.max(0, (1.53 - p[1]) / 0.72))] }));
  // neck
  b.tube([[1.605, 0.92], [1.56, 1.0], [1.505, 1.06], [1.475, 1.18]].map(([y, k]) => ({ c: [0, y, 0.014], rx: 0.056 * k, rz: 0.053 * k })), lo ? 5 : 8, (r, th, p) => D(p[1] > 1.53 ? J.head : J.torso, P.skin));
  // arms + deltoids + hands
  const ARMY = [1.472, 1.468, 1.45, 1.41, 1.35, 1.29, 1.23, 1.185, 1.155, 1.12, 1.06, 1.00, 0.95, 0.92, 0.898, 0.882];
  for (const s of [-1, 1]) {
    const L = s < 0;
    const ua = rest[L ? 'upperArmL' : 'upperArmR'], hd = rest[L ? 'handL' : 'handR'];
    const ax = y => lerp(hd[0], ua[0], (y - hd[1]) / (ua[1] - hd[1])), az = y => lerp(hd[2], ua[2], (y - hd[1]) / (ua[1] - hd[1]));
    b.tube(ARMY.map(y => ({ c: [ax(y), y, az(y)], rx: shape.armR(y) + (y > 0.9 ? 0.006 : 0), rz: (shape.armR(y) + (y > 0.9 ? 0.006 : 0)) * (y < 1.12 ? 0.88 : 0.96) })).filter((_, i, a) => !lo || i % 2 === 0 || i === a.length - 1), lo ? 5 : 7,
      (r, th, p) => D(p[1] > 1.17 ? (L ? J.uaL : J.uaR) : (L ? J.laL : J.laR), P.arm, { uv: [wrapU(th / (Math.PI * 2) * 0.33 + (L ? 0.1 : 0.5)), Math.min(1, (1.5 - p[1]) / 0.72)] }));
    b.ellipsoid([ua[0] + s * 0.004, 1.418, ua[2] + 0.002], [0.062, 0.058, 0.06], lo ? 3 : 5, lo ? 5 : 8, (d, p) => D(L ? J.uaL : J.uaR, P.arm, { uv: [0.2 + d[0] * 0.05, 0.1] }));
    b.ellipsoid([hd[0] + s * 0.002, hd[1] - 0.06, hd[2]], [0.019, 0.055, 0.038], lo ? 3 : 5, lo ? 5 : 7, D(L ? J.laL : J.laR, P.skin));
    if (!lo) b.ellipsoid([hd[0] - s * 0.008, hd[1] - 0.05, hd[2] - 0.038], [0.009, 0.025, 0.009], 3, 5, D(L ? J.laL : J.laR, P.skin));
  }
  // legs + shoes
  const LEGY = [0.995, 0.985, 0.945, 0.86, 0.78, 0.70, 0.62, 0.56, 0.515, 0.47, 0.41, 0.34, 0.27, 0.20, 0.14, 0.10, 0.075, 0.06];
  for (const s of [-1, 1]) {
    const L = s < 0;
    const ul = rest[L ? 'upperLegL' : 'upperLegR'], ft = rest[L ? 'footL' : 'footR'];
    const lx = y => lerp(ft[0], ul[0], (y - ft[1]) / (ul[1] - ft[1])), lz = y => lerp(ft[2], ul[2], (y - ft[1]) / (ul[1] - ft[1]));
    b.tube(LEGY.map(y => { const r = shape.legR(y) + (y > 0.1 && y < 0.99 ? 0.008 : 0); return { c: [lx(y), y, lz(y)], rx: r, rz: r, m: th => 1 + 0.12 * Math.exp(-(((y - 0.37) / 0.08) ** 2)) * Math.max(0, Math.sin(th)) ** 2 }; }).filter((_, i, a) => !lo || i % 2 === 0 || i === a.length - 1), lo ? 6 : 8,
      (r, th, p) => D(p[1] > 0.515 ? (L ? J.ulL : J.ulR) : p[1] > 0.09 ? (L ? J.llL : J.llR) : (L ? J.ftL : J.ftR), P.leg));
    const cx = ft[0] + s * 0.004, cz = ft[2] - 0.062;
    b.sphere([cx, 0.05, cz], d => {
      let A = 0.048, Bv = 0.05, C = 0.13;
      if (d[2] < 0) { Bv *= 1 - 0.42 * (-d[2]) ** 1.5; A *= 1 - 0.12 * (-d[2]); }
      const n = d[1] < 0 ? 5 : 2.3;
      return 1 / Math.pow(Math.abs(d[0] / A) ** n + Math.abs(d[1] / Bv) ** n + Math.abs(d[2] / C) ** n, 1 / n);
    }, lo ? 3 : 5, lo ? 6 : 9, () => D(L ? J.ftL : J.ftR, P.shoe));
  }
  // head + face
  b.sphere(HEAD_C, d => headRadius(d), lo ? 7 : 10, lo ? 8 : 12, () => D(J.head, P.skin));
  for (const s of [-1, 1]) {
    if (lo) { const e = headPoint(EYE_DIR(s), 0, 0.002); b.ellipsoid([e[0], e[1], e[2]], [0.01, 0.007, 0.004], 2, 4, D(J.head, P.dark)); continue; }
    const e = headPoint(EYE_DIR(s), 0, 0.002);
    b.ellipsoid([e[0], e[1], e[2]], [0.009, 0.0065, 0.004], 2, 5, D(J.head, P.dark));
    b.ellipsoid([e[0] + s * 0.004, e[1] + 0.02, e[2] + 0.002], [0.02, 0.0045, 0.005], 2, 5, D(J.head, P.brow));
    { const ep = headPoint([s, -0.03, 0.06]); b.ellipsoid([ep[0] + s * 0.002, ep[1], ep[2]], [0.011, 0.027, 0.018], 3, 5, D(J.head, P.skin)); }
  }
  const nb = headPoint([0, 0.02, -1]);
  if (!lo) b.ellipsoid([0, 1.65, nb[2] - 0.004], [0.011, 0.026, 0.014], 3, 5, D(J.head, P.skin), [-0.3, 0, 0]);
  const lp = headPoint([0, -0.46, -0.89]);
  if (!lo) b.ellipsoid([0, lp[1], lp[2] + 0.002], [0.02, 0.008, 0.008], 2, 6, D(J.head, P.lips));
  // hair variants
  const hairPieces = [['short', 1], ['long', 2], ['bob', 3], ['bun', 4], ['bald', 5]];
  for (const [name, piece] of hairPieces) {
    const st = HAIR_STYLES[name];
    b.sphere(HEAD_C, d => hairShellRadius(st, d) + 0.002, lo ? 7 : 10, lo ? 8 : 12, () => D(J.head, P.hair, { piece }));
    if (name === 'long') b.tube([[1.72, 0, 0, 0.04], [1.71, 0.07, 0.04, 0.045], [1.62, 0.095, 0.05, 0.065], [1.50, 0.11, 0.035, 0.085], [1.40, 0.11, 0.025, 0.095], [1.395, 0, 0, 0.095]].map(([y, rx, rz, z]) => ({ c: [0, y, z], rx, rz })), 8, (r, th, p) => D(p[1] > 1.56 ? J.head : J.torso, P.hair, { piece }));
    if (name === 'bun') b.ellipsoid([0, HEAD_C[1] + 0.055, HEAD_C[2] + 0.1], [0.038, 0.034, 0.036], 4, 6, D(J.head, P.hair, { piece }));
  }
  // skirt (A-line, follows hips)
  b.tube([0.975, 0.95, 0.88, 0.80, 0.70, 0.60, 0.53, 0.528, 0.56].map((y, i, a) => {
    const t = shape.torso(Math.max(y, 0.9)); const k = Math.min(1, Math.max(0, (0.975 - y) / 0.445));
    const rx = i >= 7 ? (i === 7 ? t.rx + 0.065 : 0) : t.rx + 0.012 + 0.06 * k;
    return { c: [0, y, t.zc + 0.005], rx, rz: i >= 7 ? (i === 7 ? t.rz + 0.07 : 0) : t.rz + 0.012 + 0.065 * k };
  }), 12, () => D(J.hips, P.bottom, { piece: PIECE.skirt }));
  // backpack + straps
  {
    const bz = 0.125 + 0.075;
    b.sphere([0, 1.21, bz], d => 1 / Math.pow(Math.abs(d[0] / 0.145) ** 4 + Math.abs(d[1] / 0.2) ** 4 + Math.abs(d[2] / 0.075) ** 4, 0.25), 6, 10, () => D(J.torso, P.acc, { piece: PIECE.backpack }));
    for (const s of [-1, 1]) b.pathTube([[s * 0.1, 1.36, 0.13], [s * 0.11, 1.45, 0.07], [s * 0.105, 1.47, -0.02], [s * 0.1, 1.42, -0.11], [s * 0.1, 1.28, -0.13], [s * 0.11, 1.12, -0.12]], 0.012, 4, false, () => D(J.torso, P.acc, { piece: PIECE.backpack }));
  }
  // bag in the left hand
  {
    const hd = rest.handL;
    b.geometry(new THREE.BoxGeometry(0.06, 0.22, 0.2), new THREE.Matrix4().makeTranslation(hd[0] - 0.01, 0.62, hd[2]), () => D(J.laL, P.acc2, { piece: PIECE.bag }));
    b.limb([hd[0] - 0.01, 0.73, hd[2] - 0.06], [hd[0] - 0.01, 0.84, hd[2]], 0.005, 0.005, 3, 2, () => D(J.laL, P.acc2, { piece: PIECE.bag }));
    b.limb([hd[0] - 0.01, 0.84, hd[2]], [hd[0] - 0.01, 0.73, hd[2] + 0.06], 0.005, 0.005, 3, 2, () => D(J.laL, P.acc2, { piece: PIECE.bag }));
  }
  // cap
  b.sphere([0, HEAD_C[1] + 0.022, HEAD_C[2] - 0.002], d => headRadius(d) + 0.016, 5, 10, () => D(J.head, P.acc, { piece: PIECE.cap }), { phi0: 0, phi1: 1.55 });
  b.sphere([0, HEAD_C[1] + 0.035, HEAD_C[2] - 0.115], () => [0.072, 0.006, 0.06], 2, 10, () => D(J.head, P.acc, { piece: PIECE.cap }), { matrix: new THREE.Matrix4().makeRotationX(0.18) });
  // visor
  b.tube([[HEAD_C[1] + 0.06, 1.0], [HEAD_C[1] + 0.035, 1.02]].map(([y, k]) => ({ c: [0, y, HEAD_C[2] + 0.005], rx: 0.106 * k, rz: 0.122 * k })), 12, () => D(J.head, P.white, { piece: PIECE.visor }));
  b.sphere([0, HEAD_C[1] + 0.04, HEAD_C[2] - 0.14], () => [0.085, 0.006, 0.07], 2, 10, () => D(J.head, P.acc, { piece: PIECE.visor }), { matrix: new THREE.Matrix4().makeRotationX(0.22) });
  // lanyard + card
  {
    const pts = [];
    for (let i = 0; i < 20; i++) {
      const th = i / 20 * Math.PI * 2, fr = Math.max(0, -Math.sin(th)), y = 1.48 - 0.24 * Math.pow(fr, 5);
      const t = shape.torso(y), c = Math.abs(Math.cos(th)), s2 = Math.abs(Math.sin(th)), m = 1 / Math.pow(c ** 2.4 + s2 ** 2.4, 1 / 2.4);
      pts.push([Math.cos(th) * (t.rx + 0.012) * m, y, t.zc + Math.sin(th) * (t.rz + 0.012) * m + shape.torsoZF(th, y)]);
    }
    b.pathTube(pts, 0.005, 3, true, () => D(J.torso, P.acc2, { piece: PIECE.lanyard }));
    b.geometry(new THREE.BoxGeometry(0.056, 0.086, 0.004), new THREE.Matrix4().makeTranslation(0, 1.205, -0.142), () => D(J.torso, P.white, { piece: PIECE.lanyard }));
  }
  // phone in the right hand (shown for phone anims)
  {
    const hd = rest.handR;
    b.geometry(new THREE.BoxGeometry(0.012, 0.15, 0.075), new THREE.Matrix4().makeTranslation(hd[0] - 0.022, 0.82, hd[2] - 0.035), () => D(J.laR, P.dark, { piece: PIECE.phone }));
  }
  // glasses
  for (const s of [-1, 1]) {
    const e = headPoint(EYE_DIR(s));
    b.geometry(new THREE.TorusGeometry(0.02, 0.003, 3, 8), new THREE.Matrix4().makeTranslation(e[0], e[1], e[2] - 0.012), () => D(J.head, P.dark, { piece: PIECE.glasses }));
  }
  const g = b.toGeometry({ skin: false, crowd: true });
  g.computeBoundingSphere();
  return g;
}

const VERT_PARS = /* glsl */`
attribute vec4 aJP;
attribute vec4 iPose;
attribute vec4 iAnim;
attribute vec4 iCol0;
attribute vec4 iCol1;
attribute vec4 iStyle;
attribute vec4 iBody;
uniform float uCrowdTime;
flat varying vec4 vC0;
flat varying vec4 vC1;
flat varying vec4 vCS;
varying vec3 vCRY;
#define CPI 3.14159265
mat3 crX(float a) { float c = cos(a), s = sin(a); return mat3(1.,0.,0., 0.,c,s, 0.,-s,c); }
mat3 crY(float a) { float c = cos(a), s = sin(a); return mat3(c,0.,-s, 0.,1.,0., s,0.,c); }
mat3 crZ(float a) { float c = cos(a), s = sin(a); return mat3(c,s,0., -s,c,0., 0.,0.,1.); }
mat3 crE(vec3 e) { return crX(e.x) * crY(e.y) * crZ(e.z); }
float crBump(float x, float c, float w) { float d = (x - c) / w; return exp(-d * d); }
float crHash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float crNoise(float t, float s) { float i = floor(t), f = fract(t); float u = f * f * (3. - 2. * f); return mix(crHash(i + s * 13.37), crHash(i + 1. + s * 13.37), u) * 2. - 1.; }
struct CPose { vec3 hips; vec3 hipT; vec3 torso; vec3 head; vec3 uaL; vec3 laL; vec3 uaR; vec3 laR; vec3 ulL; vec3 llL; vec3 ftL; vec3 ulR; vec3 llR; vec3 ftR; };
void crArm(inout CPose P, float side, float fwd, float abd, float elbow, float fz) {
  if (side < 0.) { P.uaL = vec3(fwd, -0.15, -abd); P.laL = vec3(elbow, 0., -fz); }
  else { P.uaR = vec3(fwd, 0.15, abd); P.laR = vec3(elbow, 0., fz); }
}
void crLeg(inout CPose P, float side, float fwd, float knee, float foot) {
  if (side < 0.) { P.ulL = vec3(fwd, 0., -0.025); P.llL = vec3(-knee, 0., 0.); P.ftL = vec3(foot, 0., 0.); }
  else { P.ulR = vec3(fwd, 0., 0.025); P.llR = vec3(-knee, 0., 0.); P.ftR = vec3(foot, 0., 0.); }
}
void crIdle(inout CPose P, float t, float seed) {
  float br = sin(t * 1.65 + seed);
  float sway = sin(t * 0.86 + seed * 3.);
  P.hipT = vec3(sway * 0.012, br * 0.003 - 0.004, 0.);
  P.hips = vec3(0., 0., sway * 0.022);
  P.torso = vec3(-0.01 + 0.015 * br, 0., -sway * 0.02);
  P.head = vec3(0.02 * crNoise(t * 0.2, seed) - 0.02, 0.3 * crNoise(t * 0.12, seed + 1.), 0.02 * crNoise(t * 0.17, seed + 2.));
  crArm(P, -1., 0.04 + 0.015 * br, 0.08, 0.2, 0.); crArm(P, 1., 0.05 + 0.015 * br, 0.08, 0.22, 0.);
  crLeg(P, -1., 0.02 - sway * 0.015, 0.04 + max(0., sway) * 0.07, 0.02 - max(0., sway) * 0.05);
  crLeg(P, 1., 0.02 + sway * 0.015, 0.04 + max(0., -sway) * 0.07, 0.02 - max(0., -sway) * 0.05);
}
void crGait(inout CPose P, float ph, float thigh, float bias, float knee, float kst, float arm, float elbow, float lean, float bob, float twist) {
  for (int k = 0; k < 2; k++) {
    float side = k == 0 ? -1. : 1.;
    float p = ph + float(k) * CPI;
    float s = sin(p);
    float th = thigh * s + bias;
    float kn = kst + knee * pow(max(0., cos(p + 0.5)), 2.) + 0.12 * pow(max(0., sin(p - 0.25)), 6.);
    float ft = kn - th - bias * 0.5 - 0.35 * pow(max(0., -sin(p - 0.5)), 3.);
    crLeg(P, side, th, kn, ft);
    float as = -s;
    crArm(P, side, arm * as + bias * 0.6, 0.08, elbow + 0.28 * max(0., as), 0.);
  }
  P.hipT = vec3(0., bob * cos(2. * ph) - bob * 0.6 - lean * 0.15, 0.);
  P.hips = vec3(0., -twist * sin(ph), 0.035 * sin(ph));
  P.torso = vec3(-lean, twist * 1.4 * sin(ph), 0.);
  P.head = vec3(lean * 0.8 - 0.02 * cos(2. * ph), -twist * 0.5 * sin(ph), 0.);
}
void crSit(inout CPose P) {
  P.hipT = vec3(0., -0.44, 0.02); P.hips = vec3(0.); P.torso = vec3(-0.06, 0., 0.);
  crLeg(P, -1., 1.52, 1.5, 0.); crLeg(P, 1., 1.52, 1.5, 0.);
  P.ulL.z = -0.08; P.ulR.z = 0.08;
  crArm(P, -1., 0.55, 0.1, 1.2, 0.); crArm(P, 1., 0.55, 0.1, 1.2, 0.);
}
void crPhone(inout CPose P) { crArm(P, 1., 0.3, 0.02, 1.5, 0.); P.uaR.y = 0.55; P.head.x -= 0.42; P.head.y += 0.1; }
CPose crowdPose(int anim, float t, float ph0, float spd, float seed) {
  CPose P;
  P.hips = vec3(0.); P.hipT = vec3(0.); P.torso = vec3(0.); P.head = vec3(0.);
  P.uaL = vec3(0.); P.laL = vec3(0.); P.uaR = vec3(0.); P.laR = vec3(0.);
  P.ulL = vec3(0.); P.llL = vec3(0.); P.ftL = vec3(0.); P.ulR = vec3(0.); P.llR = vec3(0.); P.ftR = vec3(0.);
  if (anim == 1 || anim == 6) {
    crGait(P, (t * spd / 1.06 + ph0) * 2. * CPI, 0.40, 0.02, 0.95, 0.07, 0.30, 0.22, 0.03, 0.024, 0.10);
    if (anim == 6) crPhone(P);
  } else if (anim == 2 || anim == 3) {
    float ph = (t * spd / 0.72 + ph0) * 2. * CPI;
    crGait(P, ph, 0.66, 0.16, 1.75, 0.22, 0.62, 1.35, 0.18, 0.045, 0.16);
    if (anim == 3) { crArm(P, -1., 0.9 + 0.5 * sin(ph * 1.3), 0.7, 0.7 + 0.3 * sin(ph), 0.); crArm(P, 1., 1.0 + 0.5 * sin(ph * 1.3 + 2.), 0.75, 0.6, 0.); P.head.y += 0.9 * max(0., sin(t * 1.7 + seed)); }
  } else if (anim == 4) {
    float k = t - ph0; // seconds since knocked
    float f = smoothstep(0., 0.4, k);
    float up = smoothstep(2.4, 2.9, k);
    float st = smoothstep(2.9, 3.5, k);
    float lie = f * (1. - up);
    P.hips = vec3(1.53 * lie + 0.15 * up * (1. - st), 0., 0.05 * lie);
    P.hipT = vec3(0., -0.83 * lie - 0.80 * up * (1. - st) - 0.3 * sin(st * CPI), 0.08 * lie);
    float sitLeg = 1.4 * up * (1. - st);
    crLeg(P, -1., 0.04 * lie + sitLeg + 1.2 * sin(st * CPI), 0.12 * lie + 0.4 * up * (1. - st) + 1.8 * sin(st * CPI), 0.25 * lie + 0.5 * sin(st * CPI));
    crLeg(P, 1., 0.18 * lie + sitLeg * 0.9 + 1.0 * sin(st * CPI), 0.35 * lie + 1.2 * up * (1. - st) + 1.5 * sin(st * CPI), 0.2 * lie + 0.5 * sin(st * CPI));
    P.torso = vec3(-0.3 * up * (1. - st) - 0.35 * sin(st * CPI), 0., 0.);
    crArm(P, -1., -0.1 * lie - 0.5 * up * (1. - st) + 0.5 * sin(st * CPI), 1.05 * lie + 0.3 * up, 0.35 * lie + 0.3, 0.);
    crArm(P, 1., 0.1 * lie - 0.5 * up * (1. - st) + 0.4 * sin(st * CPI), 0.8 * lie + 0.3 * up, 0.6 * lie + 0.3, 0.);
    P.head = vec3(-0.08 * lie + 0.25 * sin(st * CPI), 0.3 * lie * sin(k * 0.7), 0.);
  } else if (anim == 7 || anim == 8) {
    crSit(P);
    P.head = vec3(-0.08 + 0.05 * crNoise(t * 0.3, seed), 0.3 * crNoise(t * 0.1, seed + 2.), 0.);
    if (anim == 8) { float e = pow(max(0., sin(t * 1.6 + seed * 5.)), 4.); P.laR.x = 1.2 + 0.95 * e; P.uaR.x = 0.55 + 0.2 * e; P.head.x -= 0.1 * e; }
  } else if (anim == 9) {
    crIdle(P, t, seed);
    float c = sin(t * 22. + seed);
    crArm(P, -1., 0.75, -0.28 + 0.12 * c, 1.3, 0.); crArm(P, 1., 0.75, -0.28 + 0.12 * c, 1.3, 0.);
    P.head.x += 0.1;
  } else if (anim == 10) {
    crIdle(P, t, seed);
    crArm(P, 1., 0.25, 2.45, 0.35, 0.45 * sin(t * 8. + seed));
  } else if (anim == 11) {
    float b = abs(sin(t * 5. + seed));
    P.hipT = vec3(0., -0.06 + 0.1 * b, 0.);
    crLeg(P, -1., 0.25 * (1. - b), 0.45 * (1. - b), 0.15 * (1. - b) - 0.3 * b); crLeg(P, 1., 0.25 * (1. - b), 0.45 * (1. - b), 0.15 * (1. - b) - 0.3 * b);
    crArm(P, -1., 0.3, 2.7 + 0.15 * sin(t * 10.), 0.25, 0.); crArm(P, 1., 0.3, 2.7 + 0.15 * sin(t * 10. + 1.), 0.25, 0.);
    P.head.x = 0.25;
  } else if (anim == 12) {
    crIdle(P, t, seed);
    crArm(P, 1., 0.45 + 0.18 * sin(t * 2.1 + seed), 0.18, 1.25 + 0.3 * sin(t * 3.3), 0.);
    crArm(P, -1., 0.25 + 0.15 * crNoise(t * 0.9, seed + 4.), 0.15, 0.9 + 0.35 * max(0., crNoise(t * 0.7, seed + 6.)), 0.);
    P.head += vec3(0.05 * sin(t * 2.7), 0.1 * sin(t * 0.9), 0.);
  } else {
    crIdle(P, t, seed);
    if (anim == 5) crPhone(P);
  }
  return P;
}
void crowdXform(inout vec3 p, inout vec3 n) {
  int j = int(aJP.x + 0.5);
  int piece = int(aJP.z + 0.5);
  int anim = int(iAnim.x + 0.5);
  int hairStyle = int(iStyle.x + 0.5);
  int mask = int(iStyle.w + 0.5);
  bool vis = piece == 0 || (piece <= 5 && piece == hairStyle) || (piece == 6 && int(iStyle.z + 0.5) == 2)
    || (piece >= 7 && piece <= 11 && (mask & (1 << (piece - 6))) != 0) || (piece == 12 && (anim == 5 || anim == 6)) || (piece == 13 && (mask & 128) != 0);
  if (!vis) { p = vec3(0.); n = vec3(0., 1., 0.); return; }
  float fem = iBody.z, g = iBody.y, gp = max(g, 0.);
  float y = p.y;
  // body shape
  if (j <= 1) {
    float kx = 1. - 0.12 * fem * smoothstep(1.36, 1.44, y) - 0.13 * fem * crBump(y, 1.12, 0.07) + 0.08 * fem * crBump(y, 0.93, 0.06);
    float gk = 1. + 0.22 * g * smoothstep(1.46, 1.38, y);
    float kz = (1. - 0.07 * fem * crBump(y, 1.12, 0.07)) * (1. + 0.25 * g * smoothstep(1.46, 1.38, y));
    float fr = clamp(-n.z, 0., 1.);
    p.x *= kx * gk;
    p.z = p.z * kz - fem * 0.034 * crBump(y, 1.295, 0.05) * fr * fr * fr - 0.075 * gp * crBump(y, 1.07, 0.11) * fr * fr + (0.02 * fem + 0.015 * gp) * crBump(y, 0.905, 0.055) * clamp(n.z, 0., 1.);
  }
  float dsx = -0.017 * fem + 0.024 * gp, dlx = 0.005 * fem + 0.016 * gp;
  float side = (j == 3 || j == 4 || j == 7 || j == 8 || j == 11) ? -1. : 1.;
  if (j >= 3 && j <= 6) p.x += side * dsx;
  if (j >= 7) { float cx = side * (0.09 + dlx); p.x += side * dlx; p.x = cx + (p.x - cx) * (1. + 0.2 * gp); p.z *= 1. + 0.2 * gp; }
  CPose P = crowdPose(anim, uCrowdTime, iAnim.y, iAnim.z, iAnim.w);
  vec3 shoulder = vec3(side * (0.183 + dsx), 1.445, 0.004), elbow = vec3(side * (0.204 + dsx), 1.155, 0.012);
  vec3 hip = vec3(side * (0.09 + dlx), 0.935, 0.), knee = vec3(side * (0.093 + dlx), 0.515, 0.006), ankle = vec3(side * (0.095 + dlx), 0.088, 0.014);
  bool L = side < 0.;
  mat3 R;
  if (j >= 11) { R = crE(L ? P.ftL : P.ftR); p = R * (p - ankle) + ankle; n = R * n; }
  if (j == 8 || j == 10 || j >= 11) { R = crE(L ? P.llL : P.llR); p = R * (p - knee) + knee; n = R * n; }
  if (j >= 7) { R = crE(L ? P.ulL : P.ulR); p = R * (p - hip) + hip; n = R * n; }
  if (j == 4 || j == 6) { R = crE(L ? P.laL : P.laR); p = R * (p - elbow) + elbow; n = R * n; }
  if (j >= 3 && j <= 6) { R = crE(L ? P.uaL : P.uaR); p = R * (p - shoulder) + shoulder; n = R * n; }
  if (j == 2) { R = crE(P.head); p = R * (p - vec3(0., 1.52, 0.008)) + vec3(0., 1.52, 0.008); n = R * n; }
  if (j >= 1 && j <= 6) { R = crE(P.torso); p = R * (p - vec3(0., 1.04, 0.)) + vec3(0., 1.04, 0.); n = R * n; }
  R = crE(P.hips); p = R * (p - vec3(0., 0.96, 0.)) + vec3(0., 0.96, 0.) + P.hipT; n = R * n;
  // instance transform
  p *= iBody.x;
  R = crY(iPose.w); p = R * p + iPose.xyz; n = R * n;
}
`;

const FRAG_PARS = /* glsl */`
flat varying vec4 vC0;
flat varying vec4 vC1;
flat varying vec4 vCS;
varying vec3 vCRY;
uniform sampler2D uCrowdAtlas;
uniform vec4 uPatRect[8];
vec3 crUnpack(float f) { uint u = uint(f + 0.5); vec3 c = vec3(float((u >> 16u) & 255u), float((u >> 8u) & 255u), float(u & 255u)) / 255.; return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
`;

let atlasRef = null;
function patchMaterial(mat, isDepth, uniforms) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS);
    if (isDepth) {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = vec3(position); vec3 crN = vec3(0., 1., 0.); crowdXform(transformed, crN);');
      return;
    }
    sh.vertexShader = sh.vertexShader
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(normal); vec3 crPos = vec3(position); crowdXform(crPos, objectNormal);')
      .replace('#include <begin_vertex>', `vec3 transformed = crPos;
        vC0 = iCol0; vC1 = iCol1;
        float sl = iStyle.y < 0.5 ? 9.0 : (iStyle.y < 1.5 ? 1.255 : 0.925);
        float pl = iStyle.z < 0.5 ? 0.6 : (iStyle.z < 1.5 ? 0.1 : 0.56);
        float hem = iBody.w >= 10.0 ? 0.955 : 0.868;
        vCS = vec4(aJP.y, sl, pl, hem);
        vCRY = vec3(position.y, uv);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <color_fragment>', `
        int part = int(vCS.x + 0.5);
        float ry = vCRY.x;
        vec3 cSkin = crUnpack(vC0.x), cTop = crUnpack(vC0.y), cBot = crUnpack(vC0.z), cHair = crUnpack(vC0.w);
        vec3 col = cSkin; bool isTop = false; float crRough = 0.85;
        if (part == 0) { col = cSkin; crRough = 0.6; }
        else if (part == 1) { isTop = ry > vCS.w; col = isTop ? cTop : cBot; }
        else if (part == 2) { isTop = ry > vCS.y; col = isTop ? cTop : cSkin; crRough = isTop ? 0.85 : 0.6; }
        else if (part == 3) { col = ry > vCS.z ? cBot : cSkin; crRough = ry > vCS.z ? 0.88 : 0.6; }
        else if (part == 4) { col = cHair; crRough = 0.5; }
        else if (part == 5) { vec3 sh = crUnpack(vC1.x); col = ry < 0.022 ? mix(sh, vec3(0.75), 0.5) : sh; crRough = 0.5; }
        else if (part == 7) { col = vec3(0.012); crRough = 0.2; }
        else if (part == 8) { col = crUnpack(vC1.y); }
        else if (part == 9) { col = cSkin * vec3(0.8, 0.55, 0.52); crRough = 0.45; }
        else if (part == 10) { col = cHair * 0.5; }
        else if (part == 12) { col = cBot; }
        else if (part == 13) { col = crUnpack(vC1.z); crRough = 0.5; }
        else { col = vec3(0.9); }
        int pat = int(vC1.w + 0.5);
        if (isTop && pat > 0) { vec4 r = uPatRect[pat]; col *= texture2D(uCrowdAtlas, r.xy + clamp(vCRY.yz, 0.0, 1.0) * r.zw).rgb; }
        diffuseColor.rgb = col;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = crRough;');
  };
  mat.customProgramCacheKey = () => isDepth ? 'vc-crowd-depth' : 'vc-crowd';
}

const packRGB = hex => (hex >>> 0) & 0xffffff;

/**
 * Instanced crowd. Usage:
 *   const crowd = new Crowd(400); scene.add(crowd.mesh);
 *   crowd.set(i, { x, y, z, yaw, anim: 'walk' | 1, speed: 1, phase: 0.3, look: Crowd.randomLook(seed, 'office_f') });
 *   crowd.setCount(n); crowd.update(dt) // once per frame
 * yaw: rotation about +y; yaw = 0 faces -z; facing vector = (-sin yaw, 0, -cos yaw).
 * speed: gait cadence multiplier (1 ≈ 1.35 m/s walk, 1 ≈ 3.8 m/s run).
 */
export class Crowd {
  constructor(maxCount = 400, opts = {}) {
    const lod = opts.lod || 'high';
    const baseGeo = baseGeos[lod] || (baseGeos[lod] = buildCrowdGeometry(lod));
    this.max = maxCount;
    const g = new THREE.InstancedBufferGeometry();
    for (const k of Object.keys(baseGeo.attributes)) g.setAttribute(k, baseGeo.attributes[k]);
    g.setIndex(baseGeo.index);
    const mk = (name) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(maxCount * 4), 4); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    this.aPose = mk('iPose'); this.aAnim = mk('iAnim'); this.aCol0 = mk('iCol0'); this.aCol1 = mk('iCol1'); this.aStyle = mk('iStyle'); this.aBody = mk('iBody');
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    this.geometry = g;
    this.uniforms = { uCrowdTime: { value: 0 }, uCrowdAtlas: { value: getAtlas() }, uPatRect: { value: PATTERN_LIST.map(c => cellRect(c)) } };
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
    patchMaterial(this.material, false, this.uniforms);
    withLampField(this.material); // pedestrians under a street lamp are lit by it
    this.depthMaterial = new THREE.MeshDepthMaterial();
    patchMaterial(this.depthMaterial, true, this.uniforms);
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.customDepthMaterial = this.depthMaterial;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.name = 'crowd';
    this.count = 0;
    this.time = 0;
    this._lastAnim = new Int16Array(maxCount).fill(-1);
    this._dirtyLook = false;
    for (let i = 0; i < maxCount; i++) this._writeLook(i, Crowd.randomLook(i * 7919 + 13));
  }

  static randomLook(seed, variant) { return randomLook(seed, variant); }

  set(i, o) {
    if (i >= this.max) return;
    const p = this.aPose.array, a = this.aAnim.array;
    if (o.x !== undefined) { p[i * 4] = o.x; p[i * 4 + 1] = o.y ?? 0; p[i * 4 + 2] = o.z; }
    if (o.yaw !== undefined) p[i * 4 + 3] = o.yaw;
    if (o.anim !== undefined) {
      const an = typeof o.anim === 'string' ? (CROWD_ANIM[o.anim] ?? 0) : o.anim;
      a[i * 4] = an;
      if (an === 4 && this._lastAnim[i] !== 4) a[i * 4 + 1] = this.time; // knocked start time
      else if (an !== 4) a[i * 4 + 1] = o.phase ?? a[i * 4 + 1];
      this._lastAnim[i] = an;
    } else if (o.phase !== undefined && a[i * 4] !== 4) a[i * 4 + 1] = o.phase;
    if (o.speed !== undefined) a[i * 4 + 2] = o.speed;
    if (o.look || o.variant || o.colors) {
      const look = o.look || randomLook(o.seed ?? i, o.variant);
      if (o.colors) look.colors = { ...look.colors, ...o.colors };
      this._writeLook(i, look);
    }
  }
  _writeLook(i, L) {
    const c0 = this.aCol0.array, c1 = this.aCol1.array, st = this.aStyle.array, bd = this.aBody.array, an = this.aAnim.array;
    const C = L.colors;
    c0[i * 4] = packRGB(C.skin); c0[i * 4 + 1] = packRGB(C.top); c0[i * 4 + 2] = packRGB(C.bottom); c0[i * 4 + 3] = packRGB(C.hair);
    c1[i * 4] = packRGB(C.shoes); c1[i * 4 + 1] = packRGB(C.acc ?? 0x333333); c1[i * 4 + 2] = packRGB(C.acc2 ?? 0xc92a2a); c1[i * 4 + 3] = L.pattern || 0;
    st[i * 4] = L.hair; st[i * 4 + 1] = L.sleeve; st[i * 4 + 2] = L.pants; st[i * 4 + 3] = L.acc || 0;
    bd[i * 4] = L.height / 1.78; bd[i * 4 + 1] = L.girth || 0; bd[i * 4 + 2] = L.fem || 0; bd[i * 4 + 3] = L.tucked ? 10 : 0;
    an[i * 4 + 3] = (L.seed ?? i) % 97;
    this._dirtyLook = true;
  }
  setCount(n) { this.count = Math.min(n, this.max); this.geometry.instanceCount = this.count; }

  update(dt) {
    this.time += dt;
    this.uniforms.uCrowdTime.value = this.time;
    for (const a of [this.aPose, this.aAnim]) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, this.count) * 4); a.needsUpdate = true; }
    if (this._dirtyLook) { this.aCol0.needsUpdate = this.aCol1.needsUpdate = this.aStyle.needsUpdate = this.aBody.needsUpdate = true; this._dirtyLook = false; }
    // bounding sphere around all active instances (keeps frustum culling correct)
    const p = this.aPose.array, n = this.count;
    const bs = this.geometry.boundingSphere;
    if (!n) { bs.radius = 0; return; }
    let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    for (let i = 0; i < n; i++) { const x = p[i * 4], y = p[i * 4 + 1], z = p[i * 4 + 2]; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; if (z < minz) minz = z; if (z > maxz) maxz = z; }
    bs.center.set((minx + maxx) / 2, (miny + maxy) / 2 + 0.9, (minz + maxz) / 2);
    bs.radius = Math.hypot(maxx - minx, maxy - miny, maxz - minz) / 2 + 2;
  }
  dispose() { this.mesh.removeFromParent(); this.geometry.dispose(); this.material.dispose(); this.depthMaterial.dispose(); }
}

// ---------- Singapore pedestrian looks ----------
const pick = (r, a) => a[(r() * a.length) | 0];
const PAT = Object.fromEntries(PATTERN_LIST.map((n, i) => [n, i]));
const VARIANTS = ['office_m', 'office_m', 'office_f', 'office_f', 'auntie', 'uncle', 'tourist', 'student', 'male', 'male', 'female', 'female'];
export function randomLook(seed = 1, variant) {
  const r = mulberry((seed * 2654435761) >>> 0);
  variant = variant || pick(r, VARIANTS);
  const asian = [SKIN.chinese, SKIN.chinese, SKIN.chinese, SKIN.chinese, SKIN.malay, SKIN.malay, SKIN.indian, SKIN.indian, SKIN.tan];
  const L = { variant, seed, colors: { skin: pick(r, asian), top: 0xffffff, bottom: 0x2e3138, hair: HAIR.black, shoes: 0x1a1412, acc: 0x343a40, acc2: pick(r, [0xc92a2a, 0x1c7ed6, 0x2b8a3e, 0xf08c00]) }, hair: 1, sleeve: 1, pants: 1, acc: 0, height: 1.72, girth: 0, fem: 0, pattern: 0, tucked: false };
  const C = L.colors;
  const brightTops = [0xffffff, 0xffffff, 0x111111, 0x111111, 0x8d99ae, 0x1f2a44, 0x264653, 0xc92a2a, 0x2b8a3e, 0xf2c94c, 0xf4a261, 0x1c7ed6, 0xffc9c9, 0x63e6be, 0xe9ecef, 0x495057, 0xd0bfff, 0x74c0fc];
  switch (variant) {
    case 'office_m':
      C.top = pick(r, [0xffffff, 0xffffff, 0xdbe7f5, 0xcfe0f5, 0xf1f3f5, 0xe7f5ff]); L.pattern = r() < 0.3 ? PAT.stripes : 0; L.sleeve = r() < 0.7 ? 2 : 1; L.tucked = true;
      C.bottom = pick(r, [0x1f2a44, 0x2e3138, 0x111111, 0x495057]); C.shoes = pick(r, [0x111111, 0x3b2a20]); L.hair = 1; L.height = 1.66 + r() * 0.14; L.girth = (r() - 0.4) * 0.5;
      if (r() < 0.55) L.acc |= CROWD_ACC.lanyard; if (r() < 0.2) L.acc |= CROWD_ACC.glasses; if (r() < 0.15) L.acc |= CROWD_ACC.backpack; break;
    case 'office_f':
      L.fem = 1; C.top = pick(r, [0xffffff, 0xf8f0e3, 0xdbe7f5, 0xffc9c9, 0xd0bfff, 0x111111, 0xfff3bf]); L.sleeve = r() < 0.6 ? 1 : 2; L.pants = r() < 0.5 ? 2 : 1; L.tucked = r() < 0.5;
      C.bottom = pick(r, [0x1f2a44, 0x2e3138, 0x111111, 0x868e96, 0xe9ecef]); C.shoes = pick(r, [0x111111, 0xd9c2a7, 0x7a1f2b]); L.hair = pick(r, [2, 2, 4, 3]); L.height = 1.55 + r() * 0.12; L.girth = (r() - 0.5) * 0.3;
      C.hair = pick(r, [HAIR.black, HAIR.black, HAIR.darkBrown, HAIR.brown]); if (r() < 0.45) L.acc |= CROWD_ACC.lanyard; if (r() < 0.35) L.acc |= CROWD_ACC.bag; break;
    case 'auntie':
      L.fem = 1; L.pattern = r() < 0.6 ? PAT.floral : (r() < 0.5 ? PAT.batik : 0); C.top = L.pattern ? 0xffffff : pick(r, [0xff8787, 0xffd43b, 0x74c0fc, 0xb197fc]); L.sleeve = 1; L.pants = 1;
      C.bottom = pick(r, [0x343a40, 0x495057, 0x1f2a44, 0x5c4b3a]); C.shoes = pick(r, [0x3a2e2a, 0x111111, 0xd6336c]); L.hair = 3; C.hair = pick(r, [0x2a2220, 0x2a2220, HAIR.grey]);
      L.height = 1.48 + r() * 0.1; L.girth = 0.35 + r() * 0.4; if (r() < 0.4) L.acc |= CROWD_ACC.visor; if (r() < 0.55) L.acc |= CROWD_ACC.bag; C.acc = 0x2f9e44; C.acc2 = pick(r, [0xf08c00, 0xe03131, 0xffffff]); break;
    case 'uncle':
      L.sleeve = r() < 0.6 ? 0 : 1; C.top = L.sleeve === 0 ? 0xf3f1ea : pick(r, [0xffffff, 0x74c0fc, 0xadb5bd, 0xffe066]); L.pants = 0; C.bottom = pick(r, [0x2f3b4c, 0x5c4b3a, 0x495057, 0x1f2a44]);
      C.shoes = pick(r, [0x2b55a3, 0x3b2a20, 0x111111]); L.hair = pick(r, [5, 5, 1]); C.hair = pick(r, [HAIR.grey, HAIR.white, HAIR.grey, HAIR.black]); L.height = 1.6 + r() * 0.1; L.girth = 0.25 + r() * 0.4; break;
    case 'tourist':
      C.skin = pick(r, [SKIN.pale, SKIN.light, SKIN.light, SKIN.tan, SKIN.chinese]); L.pattern = r() < 0.5 ? pick(r, [PAT.tourist, PAT.hawaii]) : 0; C.top = L.pattern ? 0xffffff : pick(r, brightTops);
      L.pants = r() < 0.75 ? 0 : 1; C.bottom = pick(r, [0xc8b48a, 0x868e96, 0x3d5f93, 0x2f3b4c]); C.shoes = pick(r, [0xffffff, 0x868e96, 0x111111]);
      L.fem = r() < 0.45 ? 1 : 0; L.hair = L.fem ? pick(r, [2, 4]) : 1; C.hair = pick(r, [HAIR.blonde, HAIR.brown, HAIR.auburn, HAIR.black]); L.height = L.fem ? 1.6 + r() * 0.12 : 1.72 + r() * 0.15; L.girth = (r() - 0.3) * 0.7;
      if (r() < 0.5) L.acc |= CROWD_ACC.cap; if (r() < 0.6) L.acc |= CROWD_ACC.backpack; C.acc = pick(r, [0x1c7ed6, 0xe03131, 0x343a40, 0xf8f9fa]); break;
    case 'student':
      L.fem = r() < 0.5 ? 1 : 0; C.top = 0xf8f9fa; L.tucked = true; L.pants = L.fem ? 2 : 0; C.bottom = pick(r, [0x24345c, 0x1f2a44, 0x8d6e4a]); C.shoes = 0xffffff;
      L.hair = L.fem ? pick(r, [2, 4]) : 1; L.height = 1.5 + r() * 0.18; L.girth = -0.15; L.acc |= CROWD_ACC.backpack; C.acc = pick(r, [0x343a40, 0x1c7ed6, 0xe64980, 0x2b8a3e]); break;
    case 'female':
      L.fem = 1; C.top = pick(r, brightTops); L.pattern = r() < 0.15 ? pick(r, [PAT.floral, PAT.batik]) : 0; if (L.pattern) C.top = 0xffffff; L.sleeve = pick(r, [0, 1, 1, 2]);
      L.pants = pick(r, [0, 1, 2, 2]); C.bottom = pick(r, [0x3d5f93, 0x111111, 0xe9ecef, 0xc8b48a, 0x1f2a44]); C.shoes = pick(r, [0xffffff, 0x111111, 0xd9c2a7]);
      L.hair = pick(r, [2, 2, 3, 4]); C.hair = pick(r, [HAIR.black, HAIR.darkBrown, HAIR.brown, 0x6b3a1f]); L.height = 1.52 + r() * 0.16; L.girth = (r() - 0.45) * 0.5;
      if (r() < 0.35) L.acc |= CROWD_ACC.bag; if (r() < 0.12) L.acc |= CROWD_ACC.glasses; break;
    default: // male
      C.top = pick(r, brightTops); L.pattern = r() < 0.12 ? pick(r, [PAT.batik, PAT.tourist]) : 0; if (L.pattern) C.top = 0xffffff; L.sleeve = pick(r, [1, 1, 1, 2, 0]);
      L.pants = pick(r, [0, 1, 1]); C.bottom = pick(r, [0x3d5f93, 0x2b3f66, 0x111111, 0xc8b48a, 0x495057]); C.shoes = pick(r, [0xffffff, 0x111111, 0x868e96, 0x3b2a20]);
      L.hair = pick(r, [1, 1, 1, 5]); C.hair = pick(r, [HAIR.black, HAIR.black, HAIR.darkBrown]); L.height = 1.64 + r() * 0.17; L.girth = (r() - 0.4) * 0.6;
      if (r() < 0.2) L.acc |= CROWD_ACC.backpack; if (r() < 0.12) L.acc |= CROWD_ACC.cap; if (r() < 0.12) L.acc |= CROWD_ACC.glasses;
  }
  return L;
}
