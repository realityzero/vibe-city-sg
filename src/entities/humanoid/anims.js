// Procedural animation library for the hero rig. A pose is a Float32Array of per-bone Euler XYZ angles
// (19 bones × 3) followed by a hips translation offset (3). Conventions (character faces -z):
//   +x on a limb swings it forward; knees bend with -x on the lower leg; elbows bend with +x on the lower arm;
//   +x on spine/head tilts back/up (so lean forward / look down = -x); arm abduction = -z (left) / +z (right).
import { B } from './body.js';

export const NB = 19;
export const POSE_LEN = NB * 3 + 3;
const HP = NB * 3;
const PI = Math.PI;
const clamp01 = x => Math.max(0, Math.min(1, x));
const sm = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

function set(P, b, x, y = 0, z = 0) { P[b * 3] = x; P[b * 3 + 1] = y; P[b * 3 + 2] = z; }
function add(P, b, x, y = 0, z = 0) { P[b * 3] += x; P[b * 3 + 1] += y; P[b * 3 + 2] += z; }
function hips(P, x, y, z) { P[HP] = x; P[HP + 1] = y; P[HP + 2] = z; }
/** side: -1 left, +1 right. abd > 0 lifts the arm away from the body; twist > 0 rotates the (bent) forearm in toward the body midline. */
function arm(P, side, fwd, abd, elbow, twist = 0, hand = 0, handZ = 0, forearmZ = 0) {
  const L = side < 0;
  set(P, L ? B.upperArmL : B.upperArmR, fwd, L ? -twist : twist, L ? -abd : abd);
  set(P, L ? B.lowerArmL : B.lowerArmR, elbow, 0, L ? -forearmZ : forearmZ);
  set(P, L ? B.handL : B.handR, hand, 0, L ? -handZ : handZ);
}
function leg(P, side, fwd, knee, foot = 0, abd = 0) {
  const L = side < 0;
  set(P, L ? B.upperLegL : B.upperLegR, fwd, 0, L ? -abd : abd);
  set(P, L ? B.lowerLegL : B.lowerLegR, -knee);
  set(P, L ? B.footL : B.footR, foot);
}
// smooth value noise for idle variation
function noise1(t, seed) {
  const i = Math.floor(t), f = t - i;
  const h = n => { const s = Math.sin((n + seed * 13.37) * 127.1) * 43758.5453; return s - Math.floor(s); };
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u) * 2 - 1;
}

function idle(P, t, c) {
  const br = Math.sin(t * 2 * PI / 3.8);
  const sway = Math.sin(t * 2 * PI / 7.3 + c.seed);
  hips(P, sway * 0.012, br * 0.003 - 0.004, 0);
  set(P, B.hips, 0, 0.02 * noise1(t * 0.1, c.seed), sway * 0.022);
  set(P, B.spine, -0.02 + 0.012 * br, 0, -sway * 0.012);
  set(P, B.chest, 0.02 * br, 0, -sway * 0.01);
  set(P, B.neck, 0.02, 0.1 * noise1(t * 0.13, c.seed + 3), 0);
  set(P, B.head, 0.03 * noise1(t * 0.21, c.seed + 7) - 0.02, 0.18 * noise1(t * 0.11, c.seed + 1), 0.03 * noise1(t * 0.17, c.seed + 5));
  set(P, B.shoulderL, 0, 0, 0.01 * br); set(P, B.shoulderR, 0, 0, -0.01 * br);
  arm(P, -1, 0.04 + 0.015 * br, 0.08, 0.2 + 0.02 * br, 0.15, 0.08);
  arm(P, 1, 0.05 + 0.015 * br, 0.075, 0.22 + 0.02 * br, 0.15, 0.08);
  leg(P, -1, 0.02 - sway * 0.015, 0.04 + Math.max(0, sway) * 0.07, 0.02 - Math.max(0, sway) * 0.05, 0.03 + sway * 0.022);
  leg(P, 1, 0.02 + sway * 0.015, 0.04 + Math.max(0, -sway) * 0.07, 0.02 - Math.max(0, -sway) * 0.05, 0.03 - sway * 0.022);
}

function gait(P, t, o, c) {
  const ph = (t / o.T) * 2 * PI;
  for (const [side, off] of [[-1, 0], [1, PI]]) {
    const p = ph + off;
    const s = Math.sin(p);
    const thigh = o.thigh * s + o.bias;
    const knee = o.kneeSt + o.knee * Math.pow(Math.max(0, Math.cos(p + 0.5)), 2) + o.kneeLand * Math.pow(Math.max(0, Math.sin(p - 0.25)), 6);
    let foot = knee - thigh - o.bias * 0.5;
    foot -= o.push * Math.pow(Math.max(0, -Math.sin(p - 0.5)), 3);   // toe-off
    foot += o.heel * Math.pow(Math.max(0, Math.sin(p + 0.35)), 4);   // heel strike
    leg(P, side, thigh, knee, foot, 0.025);
    const as = -Math.sin(p);
    arm(P, side, o.arm * as + o.armBias, 0.08 + o.armOut, o.elbow + o.elbowSwing * Math.max(0, as), 0.2, 0.1);
  }
  hips(P, 0, o.bob * Math.cos(2 * ph) - o.bob * 0.6 - o.drop, 0);
  set(P, B.hips, 0.0, -o.twist * Math.sin(ph), 0.035 * Math.sin(ph) * o.roll);
  set(P, B.spine, -o.lean * 0.6, o.twist * 0.7 * Math.sin(ph), 0);
  set(P, B.chest, -o.lean * 0.4 + 0.015 * Math.cos(2 * ph), o.twist * 0.8 * Math.sin(ph), 0);
  set(P, B.neck, o.lean * 0.4, -o.twist * 0.5 * Math.sin(ph), 0);
  set(P, B.head, o.lean * 0.4 - 0.02 * Math.cos(2 * ph), -o.twist * 0.6 * Math.sin(ph), 0);
}
const WALK = { T: 1.06, thigh: 0.40, bias: 0.02, knee: 0.95, kneeSt: 0.07, kneeLand: 0.12, push: 0.35, heel: 0.12, arm: 0.30, armBias: 0.02, armOut: 0, elbow: 0.22, elbowSwing: 0.28, lean: 0.03, bob: 0.024, drop: 0.0, twist: 0.10, roll: 1 };
const RUN = { T: 0.72, thigh: 0.66, bias: 0.16, knee: 1.75, kneeSt: 0.22, kneeLand: 0.3, push: 0.5, heel: 0.05, arm: 0.62, armBias: 0.1, armOut: 0.05, elbow: 1.35, elbowSwing: 0.2, lean: 0.18, bob: 0.045, drop: 0.04, twist: 0.16, roll: 0.6 };
const SPRINT = { T: 0.62, thigh: 0.82, bias: 0.22, knee: 1.95, kneeSt: 0.25, kneeLand: 0.3, push: 0.6, heel: 0.0, arm: 0.88, armBias: 0.15, armOut: 0.05, elbow: 1.45, elbowSwing: 0.15, lean: 0.28, bob: 0.05, drop: 0.06, twist: 0.2, roll: 0.5 };

function sitBase(P) {
  hips(P, 0, -0.44, 0.02);
  set(P, B.hips, 0, 0, 0);
  set(P, B.spine, 0.04); set(P, B.chest, -0.02);
  leg(P, -1, 1.52, 1.5, 0.0, 0.06); leg(P, 1, 1.52, 1.5, 0.0, 0.06);
  arm(P, -1, 0.3, 0.12, 0.95, 0.3, 0.1); arm(P, 1, 0.3, 0.12, 0.95, 0.3, 0.1);
}
function phoneArm(P, t) {
  arm(P, 1, 0.38, 0.62, 2.45, -0.15, -0.2, 0.1, 0);
  set(P, B.shoulderR, 0, 0, 0.12);
  add(P, B.head, 0, 0.05, 0.12);
}

// keyframed sequences: list of [time, fn(P)] — interpolated with smoothstep
function keyframes(P, t, frames, c) {
  let i = 0;
  while (i < frames.length - 2 && t > frames[i + 1][0]) i++;
  const [t0, f0] = frames[i], [t1, f1] = frames[Math.min(i + 1, frames.length - 1)];
  const k = t1 > t0 ? sm(t0, t1, t) : 1;
  const A = c.tmpA, Bp = c.tmpB;
  A.fill(0); Bp.fill(0);
  f0(A, t, c); f1(Bp, t, c);
  for (let j = 0; j < POSE_LEN; j++) P[j] = lerp(A[j], Bp[j], k);
}

const standF = (P, t, c) => idle(P, t, c);
const fallingF = (P, t) => {
  hips(P, 0, -0.3, 0.12); set(P, B.hips, 0.9); set(P, B.spine, -0.2); set(P, B.head, -0.4);
  arm(P, -1, 0.9, 1.3, 0.5); arm(P, 1, 1.1, 1.1, 0.6);
  leg(P, -1, 0.5, 0.5, 0.2); leg(P, 1, 0.3, 0.3, 0.2);
};
const lyingF = (P, t) => {
  hips(P, 0, -0.83, 0.1); set(P, B.hips, 1.53, 0, 0.05); set(P, B.spine, 0.02); set(P, B.chest, 0.02); set(P, B.neck, -0.05); set(P, B.head, -0.08, 0.3 * Math.sin(t * 0.7), 0);
  arm(P, -1, -0.1, 1.05, 0.35, 0, 0); arm(P, 1, 0.1, 0.8, 0.6, 0, 0);
  leg(P, -1, 0.04, 0.12, 0.25, 0.12); leg(P, 1, 0.18, 0.35, 0.2, 0.05);
};
const sitUpF = (P) => {
  hips(P, 0, -0.80, 0.05); set(P, B.hips, 0.15); set(P, B.spine, -0.25); set(P, B.chest, -0.1); set(P, B.head, -0.15);
  arm(P, -1, -0.5, 0.35, 0.2); arm(P, 1, -0.5, 0.35, 0.2);
  leg(P, -1, 1.25, 0.6, 0.0, 0.1); leg(P, 1, 1.0, 1.4, 0.2, 0.05);
};
const crouchUpF = (P) => {
  hips(P, 0, -0.38, -0.05); set(P, B.hips, -0.2); set(P, B.spine, -0.35); set(P, B.chest, -0.1); set(P, B.head, 0.3);
  arm(P, -1, 0.5, 0.25, 0.6); arm(P, 1, 0.4, 0.25, 0.6);
  leg(P, -1, 1.35, 1.95, 0.55); leg(P, 1, 1.0, 1.6, 0.6);
};

export const ANIMS = {
  idle: { loop: true, fn: idle },
  walk: { loop: true, fn: (P, t, c) => gait(P, t, WALK, c) },
  run: { loop: true, fn: (P, t, c) => gait(P, t, RUN, c) },
  sprint: { loop: true, fn: (P, t, c) => gait(P, t, SPRINT, c) },
  flee: {
    loop: true, fn: (P, t, c) => {
      gait(P, t, RUN, c);
      const ph = t / RUN.T * 2 * PI;
      arm(P, -1, 0.9 + 0.5 * Math.sin(ph * 1.3), 0.7, 0.7 + 0.3 * Math.sin(ph)); arm(P, 1, 1.0 + 0.5 * Math.sin(ph * 1.3 + 2), 0.75, 0.6);
      add(P, B.head, 0.1, 0.9 * Math.max(0, Math.sin(t * 1.7)), 0); add(P, B.neck, 0, 0.4 * Math.max(0, Math.sin(t * 1.7)), 0);
    },
  },
  jump: {
    loop: false, dur: 0.9, fn: (P, t, c) => keyframes(P, t, [
      [0, standF],
      [0.16, P2 => { hips(P2, 0, -0.16, 0); set(P2, B.spine, -0.3); leg(P2, -1, 0.75, 1.2, 0.4); leg(P2, 1, 0.7, 1.2, 0.45); arm(P2, -1, -0.6, 0.15, 0.4); arm(P2, 1, -0.6, 0.15, 0.4); }],
      [0.32, P2 => { hips(P2, 0, 0.05, 0); set(P2, B.spine, 0.05); leg(P2, -1, 0.15, 0.1, -0.4); leg(P2, 1, -0.1, 0.15, -0.5); arm(P2, -1, 1.6, 0.4, 0.4); arm(P2, 1, 1.5, 0.4, 0.4); }],
      [0.9, P2 => { hips(P2, 0, 0, 0); set(P2, B.spine, -0.1); leg(P2, -1, 0.75, 1.1, 0.2); leg(P2, 1, 0.4, 0.8, 0.2); arm(P2, -1, 0.6, 0.7, 0.6); arm(P2, 1, 0.5, 0.7, 0.6); }],
    ], c),
  },
  fall: {
    loop: true, fn: (P, t) => {
      hips(P, 0, 0, 0); set(P, B.spine, -0.08 + 0.05 * Math.sin(t * 5)); set(P, B.head, 0.15);
      arm(P, -1, 0.6 + 0.4 * Math.sin(t * 7), 1.3 + 0.3 * Math.sin(t * 9), 0.5); arm(P, 1, 0.6 + 0.4 * Math.sin(t * 7 + 2), 1.3 + 0.3 * Math.sin(t * 8 + 1), 0.5);
      leg(P, -1, 0.5 + 0.35 * Math.sin(t * 6), 0.6 + 0.3 * Math.sin(t * 6 + 1), 0.2); leg(P, 1, 0.5 + 0.35 * Math.sin(t * 6 + PI), 0.6 + 0.3 * Math.sin(t * 6 + PI + 1), 0.2);
    },
  },
  // front crawl: body pitched flat (hips is the root, so the whole rig tips forward about the pelvis), arms windmill
  // half a cycle apart — pull under the chest from overhead to the hip, high-elbow recovery over the water — with a
  // body roll into each pull, a breath to the side every other stroke and a flutter kick
  swim: {
    loop: true, fn: (P, t) => {
      const T = 1.5, ph = t / T * 2 * PI;
      set(P, B.hips, -1.38, 0.2 * Math.sin(ph), 0);
      set(P, B.spine, 0.04); set(P, B.chest, 0.03, 0.08 * Math.sin(ph), 0);
      const br = Math.max(0, Math.sin(ph * 0.5 + 0.6)) ** 3;
      set(P, B.neck, 0.5); set(P, B.head, 0.38 - 0.1 * br, 0.75 * br, 0);
      for (const [side, off] of [[-1, 0], [1, 0.5]]) {
        const u = ((t / T + off) % 1 + 1) % 1;
        if (u < 0.55) { const k = u / 0.55; arm(P, side, PI * (1 - k), 0.12, 0.25 + 0.55 * Math.sin(k * PI), 0.2); }
        else { const k = (u - 0.55) / 0.45; arm(P, side, -PI * k, 0.35 + 0.45 * Math.sin(k * PI), 0.4 + 1.2 * Math.sin(k * PI), 0.4); }
      }
      for (const [side, off] of [[-1, 0], [1, PI]]) { const s = Math.sin(ph * 3 + off); leg(P, side, 0.1 + 0.2 * s, 0.22 + 0.2 * Math.max(0, -s), -0.75, 0.04); }
    },
  },
  // treading water: upright, hands sculling out to the sides, legs cycling slowly, head bobbing just above the surface
  tread: {
    loop: true, fn: (P, t) => {
      const ph = t / 1.7 * 2 * PI;
      hips(P, 0, 0.02 * Math.sin(ph * 2), 0);
      set(P, B.hips, -0.12); set(P, B.spine, -0.06); set(P, B.chest, 0.02); set(P, B.neck, 0.05); set(P, B.head, 0.12 + 0.03 * Math.sin(ph * 2), 0.25 * Math.sin(t * 0.45), 0);
      for (const side of [-1, 1]) arm(P, side, 0.55 + 0.12 * Math.sin(ph * 2), 0.95 + 0.25 * Math.sin(ph * 2 + side), 0.55, 0.35 * Math.sin(ph * 2), 0.25 * Math.sin(ph * 2 + 1));
      for (const [side, off] of [[-1, 0], [1, PI]]) leg(P, side, 0.55 + 0.35 * Math.sin(ph + off), 0.95 + 0.55 * Math.sin(ph + off + 1.2), 0.35, 0.12);
    },
  },
  // hauling out of the water onto a quay: reach for the edge, pull up on straight arms, knee onto the ledge, stand
  climb_out: {
    loop: false, dur: 1.1, fn: (P, t, c) => keyframes(P, t, [
      [0, P2 => { hips(P2, 0, -0.05, 0); set(P2, B.spine, -0.1); set(P2, B.head, 0.25); arm(P2, -1, 2.7, 0.3, 0.3); arm(P2, 1, 2.7, 0.3, 0.3); leg(P2, -1, 0.3, 0.6, 0.3); leg(P2, 1, 0.1, 0.4, 0.3); }],
      [0.3, P2 => { hips(P2, 0, -0.05, 0); set(P2, B.spine, -0.35); set(P2, B.head, 0.2); arm(P2, -1, 1.2, 0.35, 1.5); arm(P2, 1, 1.2, 0.35, 1.5); leg(P2, -1, 0.4, 0.8, 0.3); leg(P2, 1, 0.2, 0.6, 0.3); }],
      [0.55, P2 => { hips(P2, 0, -0.1, 0); set(P2, B.hips, -0.3); set(P2, B.spine, -0.6); set(P2, B.head, 0.35); arm(P2, -1, 0.3, 0.3, 0.15); arm(P2, 1, 0.3, 0.3, 0.15); leg(P2, -1, 1.55, 2.0, 0.4); leg(P2, 1, 0.2, 0.5, 0.3); }],
      [0.8, crouchUpF],
      [1.1, standF],
    ], c),
  },
  // a right jab from a guard: wind up, snap the fist out with the shoulder and hips turning into it, recover
  punch: {
    loop: false, dur: 0.5, fn: (P, t, c) => keyframes(P, t, [
      [0, P2 => { idle(P2, t, c); arm(P2, -1, 0.9, 0.25, 1.9, 0.5); arm(P2, 1, 0.8, 0.3, 2.0, 0.5); }],
      [0.1, P2 => { hips(P2, 0, -0.04, 0); set(P2, B.hips, 0, 0.25); set(P2, B.chest, -0.05, 0.25); arm(P2, -1, 1.0, 0.25, 1.9, 0.5); arm(P2, 1, 0.5, 0.35, 2.2, 0.4); leg(P2, -1, 0.25, 0.3, 0.05); leg(P2, 1, -0.1, 0.15, 0); }],
      [0.2, P2 => { hips(P2, 0, -0.05, -0.05); set(P2, B.hips, 0, -0.3); set(P2, B.spine, -0.1, -0.2); set(P2, B.chest, -0.05, -0.35); set(P2, B.head, 0.05, 0.3); arm(P2, -1, 1.1, 0.25, 1.9, 0.5); arm(P2, 1, 1.55, 0.05, 0.1, 0.1); leg(P2, -1, 0.35, 0.35, 0.05); leg(P2, 1, -0.2, 0.2, 0.1); }],
      [0.32, P2 => { hips(P2, 0, -0.05, -0.05); set(P2, B.hips, 0, -0.25); set(P2, B.chest, -0.05, -0.3); set(P2, B.head, 0.05, 0.25); arm(P2, -1, 1.0, 0.25, 1.9, 0.5); arm(P2, 1, 1.5, 0.05, 0.2, 0.1); leg(P2, -1, 0.3, 0.3, 0.05); leg(P2, 1, -0.15, 0.2, 0.1); }],
      [0.5, standF],
    ], c),
  },
  land: {
    loop: false, dur: 0.5, fn: (P, t, c) => keyframes(P, t, [
      [0, P2 => { hips(P2, 0, -0.22, 0.02); set(P2, B.spine, -0.35); leg(P2, -1, 0.95, 1.4, 0.45); leg(P2, 1, 0.8, 1.35, 0.55); arm(P2, -1, 0.7, 0.6, 0.6); arm(P2, 1, 0.7, 0.6, 0.6); }],
      [0.5, standF],
    ], c),
  },
  sit: { loop: true, fn: (P, t, c) => { sitBase(P); const br = Math.sin(t * 2 * PI / 4); add(P, B.chest, 0.015 * br); set(P, B.head, -0.05 + 0.03 * noise1(t * 0.2, c.seed), 0.25 * noise1(t * 0.1, c.seed + 2)); } },
  sit_type: {
    loop: true, fn: (P, t, c) => {
      sitBase(P);
      set(P, B.spine, -0.1); set(P, B.chest, -0.06); set(P, B.neck, -0.08); set(P, B.head, -0.2 + 0.03 * noise1(t * 0.4, c.seed), 0.08 * noise1(t * 0.3, c.seed + 1));
      const tl = Math.sin(t * 17 + c.seed) * 0.5 + Math.sin(t * 23.3) * 0.5, tr = Math.sin(t * 19.1 + 1.3) * 0.5 + Math.sin(t * 13.7) * 0.5;
      arm(P, -1, 0.42 + 0.02 * tl, 0.1, 1.45 + 0.04 * tl, 0.35, 0.12 + 0.12 * Math.max(0, tl), 0.15);
      arm(P, 1, 0.42 + 0.02 * tr, 0.1, 1.45 + 0.04 * tr, 0.35, 0.12 + 0.12 * Math.max(0, tr), 0.15);
    },
  },
  drive: {
    loop: true, fn: (P, t, c) => {
      sitBase(P);
      hips(P, 0, -0.5, 0.05);
      set(P, B.spine, 0.12); set(P, B.chest, -0.02);
      const st = c.steer || 0;
      leg(P, -1, 1.25, 1.0, -0.1, 0.1); leg(P, 1, 1.3, 0.85, -0.25, 0.06);
      arm(P, -1, 0.95 + st * 0.3, 0.25 - st * 0.15, 0.55 - st * 0.2, 0.2, 0.1);
      arm(P, 1, 0.95 - st * 0.3, 0.25 + st * 0.15, 0.55 + st * 0.2, 0.2, 0.1);
      set(P, B.chest, -0.02, 0, -st * 0.05); set(P, B.head, 0, st * 0.25 + 0.15 * noise1(t * 0.2, c.seed), st * 0.05);
    },
  },
  // motorbike / jet ski: straddling, leaning forward, hands low on the bars
  ride: {
    loop: true, fn: (P, t, c) => {
      sitBase(P);
      hips(P, 0, -0.36, 0.06);
      set(P, B.spine, 0.3); set(P, B.chest, 0.12);
      const st = c.steer || 0;
      leg(P, -1, 1.05, 1.55, -0.3, 0.32); leg(P, 1, 1.05, 1.55, -0.3, 0.32);
      arm(P, -1, 0.85 + st * 0.18, 0.32, 0.55 - st * 0.15, 0.25, 0.15);
      arm(P, 1, 0.85 - st * 0.18, 0.32, 0.55 + st * 0.15, 0.25, 0.15);
      set(P, B.head, -0.28, st * 0.2 + 0.08 * noise1(t * 0.3, c.seed), 0);
    },
  },
  talk: {
    loop: true, fn: (P, t, c) => {
      idle(P, t, c);
      const a = Math.sin(t * 2.1 + c.seed), b2 = Math.sin(t * 3.3), d = noise1(t * 0.8, c.seed + 9);
      arm(P, 1, 0.45 + 0.18 * a, 0.18 + 0.1 * d, 1.25 + 0.3 * b2, 0.4, 0.2 * Math.sin(t * 4.1), 0.2);
      arm(P, -1, 0.25 + 0.15 * noise1(t * 0.9, c.seed + 4), 0.15, 0.9 + 0.35 * Math.max(0, noise1(t * 0.7, c.seed + 6)), 0.4, 0.1);
      add(P, B.head, 0.05 * Math.sin(t * 2.7), 0.1 * Math.sin(t * 0.9), 0);
      add(P, B.chest, 0, 0.06 * a, 0);
    },
  },
  phone: { loop: true, fn: (P, t, c) => { idle(P, t, c); phoneArm(P, t); } },
  wave: {
    loop: true, fn: (P, t, c) => {
      idle(P, t, c);
      arm(P, 1, 0.35, 2.2, 0.9, -0.3, 0, 0.1, 0.45 * Math.sin(t * 8));
      add(P, B.head, 0.05, 0.1, 0.05);
    },
  },
  cheer: {
    loop: true, fn: (P, t, c) => {
      const b2 = Math.abs(Math.sin(t * 5));
      hips(P, 0, -0.06 + 0.1 * b2, 0);
      leg(P, -1, 0.25 * (1 - b2), 0.45 * (1 - b2), 0.15 * (1 - b2) - 0.3 * b2); leg(P, 1, 0.25 * (1 - b2), 0.45 * (1 - b2), 0.15 * (1 - b2) - 0.3 * b2);
      arm(P, -1, 0.3, 2.7 + 0.15 * Math.sin(t * 10), 0.25); arm(P, 1, 0.3, 2.7 + 0.15 * Math.sin(t * 10 + 1), 0.25);
      set(P, B.head, 0.25); set(P, B.chest, 0.08);
    },
  },
  enter_car: {
    loop: false, dur: 1.1, fn: (P, t, c) => keyframes(P, t, [
      [0, standF],
      [0.35, P2 => { hips(P2, 0, -0.08, 0); set(P2, B.spine, -0.25, 0.2); leg(P2, 1, 0.9, 1.0, 0.1, 0.25); leg(P2, -1, 0.1, 0.15, 0); arm(P2, 1, 0.8, 0.5, 0.6); arm(P2, -1, 0.5, 0.2, 0.9); }],
      [0.75, P2 => { hips(P2, 0, -0.32, 0); set(P2, B.spine, -0.45, 0.3); set(P2, B.head, -0.2); leg(P2, 1, 1.3, 1.4, 0.0, 0.2); leg(P2, -1, 0.6, 1.0, 0.1); arm(P2, 1, 0.9, 0.3, 0.7); arm(P2, -1, 0.7, 0.2, 0.9); }],
      [1.1, P2 => { sitBase(P2); hips(P2, 0, -0.5, 0.05); arm(P2, -1, 0.9, 0.25, 0.55); arm(P2, 1, 0.9, 0.25, 0.55); }],
    ], c),
  },
  exit_car: {
    loop: false, dur: 1.0, fn: (P, t, c) => keyframes(P, t, [
      [0, P2 => { sitBase(P2); hips(P2, 0, -0.5, 0.05); }],
      [0.35, P2 => { hips(P2, 0, -0.32, 0); set(P2, B.spine, -0.45, -0.3); set(P2, B.head, 0.1); leg(P2, -1, 1.2, 1.3, 0.1, 0.2); leg(P2, 1, 0.6, 1.0, 0.1); arm(P2, -1, 0.9, 0.5, 0.5); arm(P2, 1, 0.5, 0.2, 0.7); }],
      [0.7, P2 => { hips(P2, 0, -0.08, 0); set(P2, B.spine, -0.15, -0.1); leg(P2, -1, 0.4, 0.4, 0.1, 0.1); leg(P2, 1, 0.2, 0.3, 0); arm(P2, -1, 0.5, 0.3, 0.4); arm(P2, 1, 0.2, 0.15, 0.3); }],
      [1.0, standF],
    ], c),
  },
  knocked: {
    loop: false, dur: 3.6, fn: (P, t, c) => keyframes(P, t, [
      [0, standF], [0.32, fallingF], [0.62, lyingF], [2.35, lyingF], [2.85, sitUpF], [3.25, crouchUpF], [3.6, standF],
    ], c),
  },
  handshake: {
    loop: true, fn: (P, t, c) => {
      idle(P, t, c);
      arm(P, 1, 0.75 + 0.07 * Math.sin(t * 11), 0.02, 0.5 + 0.05 * Math.sin(t * 11), 0.5, -0.1, 0.3);
      add(P, B.chest, -0.03, 0.08, 0); add(P, B.head, -0.05, 0.05, 0);
    },
  },
  point: {
    loop: true, fn: (P, t, c) => {
      idle(P, t, c);
      arm(P, 1, 1.42, 0.12, 0.08, 0.2, 0.05, 0);
      add(P, B.chest, 0, 0.12, 0); add(P, B.head, 0.03, 0.1, 0);
    },
  },
  dance: {
    loop: true, fn: (P, t, c) => {
      const bt = t * 2 * PI / 1.0; // ~120 bpm (two beats per cycle)
      const b2 = Math.abs(Math.sin(bt));
      hips(P, 0.05 * Math.sin(bt), -0.04 - 0.05 * b2, 0);
      set(P, B.hips, 0, 0.15 * Math.sin(bt), 0.1 * Math.sin(bt));
      set(P, B.spine, -0.05, -0.12 * Math.sin(bt), -0.08 * Math.sin(bt));
      set(P, B.chest, 0.03, -0.1 * Math.sin(bt), -0.05 * Math.sin(bt));
      set(P, B.head, 0.1 * Math.sin(bt * 2), 0.1 * Math.sin(bt), 0.08 * Math.sin(bt));
      leg(P, -1, 0.2 + 0.2 * Math.max(0, Math.sin(bt)), 0.25 + 0.4 * Math.max(0, Math.sin(bt)), 0.0, 0.08);
      leg(P, 1, 0.2 + 0.2 * Math.max(0, -Math.sin(bt)), 0.25 + 0.4 * Math.max(0, -Math.sin(bt)), 0.0, 0.08);
      arm(P, -1, 0.7 + 0.6 * Math.sin(bt), 0.35, 1.5, 0.3, 0.2); arm(P, 1, 0.7 - 0.6 * Math.sin(bt), 0.35, 1.5, 0.3, 0.2);
    },
  },
};

export function samplePose(name, t, ctx, out) {
  const a = ANIMS[name] || ANIMS.idle;
  out.fill(0);
  a.fn(out, a.loop ? t : Math.min(t, a.dur), ctx);
}
