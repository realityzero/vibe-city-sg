// Assembles a lofted car from a design: body, greenhouse, lights, decals and details.
import * as THREE from 'three';
import { PartBuilder, roundedBox, box, cyl, M4, sphere } from './geom.js';
import { Atlas } from './atlas.js';
import { buildBody, patch } from './body.js';

const clamp01 = v => Math.min(1, Math.max(0, v));

/** Constraint helpers (each returns f(p, n) <= 0 inside). */
export const C = {
  axMin: a => p => a - Math.abs(p.x),
  axMax: a => p => Math.abs(p.x) - a,
  yMin: a => p => a - p.y,
  yMax: a => p => p.y - a,
  zMin: a => p => a - p.z,
  zMax: a => p => p.z - a,
  /** y relative to shoulder line: ys(t)+lo <= y <= ys(t)+hi */
  shoulderBand: (P, lo, hi) => [p => (P.ys(P.tOf(p.z)) + lo) - p.y, p => p.y - (P.ys(P.tOf(p.z)) + hi)],
  /** front: z < zF + d(ax) with linear sweep from (ax0,d0) to (ax1,d1) */
  frontSweep: (P, ax0, d0, ax1, d1) => p => p.z - (P.zF + d0 + (d1 - d0) * clamp01((Math.abs(p.x) - ax0) / (ax1 - ax0))),
  rearSweep: (P, ax0, d0, ax1, d1) => p => (P.zR - d0 - (d1 - d0) * clamp01((Math.abs(p.x) - ax0) / (ax1 - ax0))) - p.z,
  facing: (dx, dy, dz, min) => (p, n) => min - (n.x * Math.sign(p.x || 1) * dx + n.y * dy + n.z * dz),
  facingZ: (dz, min) => (p, n) => min - n.z * dz,
  sideFacing: min => (p, n) => min - Math.abs(n.x),
};

export function assembleCar(design, lod = 'high', opts = {}) {
  const atlas = new Atlas();
  const pb = new PartBuilder(atlas);
  const body = buildBody(pb, design.body, lod);
  if (design.prePaint) design.prePaint(atlas);
  const { P, G, surfaces } = body;
  const hi = lod === 'high';
  const S = surfaces.lower.concat(hi ? surfaces.caps : surfaces.capsRaw);

  // ---- lights (geometry patches hugging the body) ----
  for (const L of design.lights?.(P, G, C, hi) ?? []) patch(pb, L.surf === 'green' && surfaces.green ? [surfaces.green.geo] : S, L.mat, L.c, { offset: L.offset ?? 0.004, uv: L.uv ? p => L.uv(p, atlas) : undefined });

  // ---- livery decals: painted into the atlas, mapped procedurally in the shader (FRAG_DECAL) ----
  const yMax = design.decalYMax ?? 1.2;
  const W = design.body.W;
  const yF = design.frontYMax ?? 1.1;
  if (design.paintSide) for (const side of ['R', 'L']) atlas.draw(side === 'R' ? 'sideR' : 'sideL', (c, w, h) => design.paintSide(c, {
    side, w, h, P, G,
    x: z => (side === 'R' ? (P.zR - z) : (z - P.zF)) / P.L * w,
    y: y => (yMax - y) / yMax * h,
    xt: t => (side === 'R' ? (P.zR - P.zOf(t)) : (P.zOf(t) - P.zF)) / P.L * w,
    sy: y => y / yMax * h, sx: d => d / P.L * w,
  }));
  if (design.paintFront) atlas.draw('front', (c, w, h) => design.paintFront(c, { w, h, P, x: x => (W / 2 - x) / W * w, y: y => (yF - y) / yF * h, sx: d => d / W * w, sy: d => d / yF * h }));
  if (design.paintRear) atlas.draw('rear', (c, w, h) => design.paintRear(c, { w, h, P, x: x => (x + W / 2) / W * w, y: y => (yF - y) / yF * h, sx: d => d / W * w, sy: d => d / yF * h }));
  const decal = { zF: P.zF, L: P.L, yMax, W, yF, frontDepth: design.frontDecalDepth ?? 0.3, rearDepth: design.rearDecalDepth ?? 0.3 };

  if (design.paintSigns) design.paintSigns(atlas);
  // ---- standard details ----
  const det = { pb, P, G, hi, atlas, design, C, surfaces };
  if (G && design.mirrors !== false) addMirrors(det);
  if (G && hi && design.wipers !== false) addWipers(det);
  if (design.details) design.details(det);
  if (design.exhaust !== false) addExhaust(det);

  // ---- interior (only visible through transparent glass / open tops) ----
  let glassGeo = null;
  if (hi && (design.body.transparentGlass || design.openTop)) addInterior(det);
  if (hi && surfaces.green?.glassParts.length) {
    const gpb = new PartBuilder(atlas);
    for (const g of surfaces.green.glassParts) gpb.add(g, 'glass', { rough: 0.02, metal: 0.12, color: 0x1a2229 });
    glassGeo = gpb.build();
  }
  const geometry = pb.build();
  return { geometry, glassGeo, atlas, P, G, decal, popups: det.popups, tris: geometry.index.count / 3 + (glassGeo ? glassGeo.index.count / 3 : 0) };
}

function addMirrors({ pb, P, G, hi, design }) {
  const g = design.body.green;
  const t = g.t0 + (g.mirrorT ?? 0.03);
  const z = P.zOf(t);
  const xB = P.hw(t) * (1 - P.tumble(t)) - (design.body.sr ?? 0.07);
  const y = P.ys(t) + (g.mirrorY ?? 0.1);
  const mw = design.mirrorSize ?? [0.2, 0.11, 0.08];
  const housing = hi ? roundedBox(mw[0], mw[1], mw[2], 0.025, 3) : box(mw[0], mw[1], mw[2]);
  const mat = g.mirrorMat ?? 'paint';
  pb.add(housing, mat, { matrix: M4.trs(xB + 0.03 + mw[0] / 2 + 0.03, y, z + 0.02, 0, -0.12, 0), mirror: true });
  if (hi) {
    const glass = box(mw[0] * 0.85, mw[1] * 0.78, 0.004);
    pb.add(glass, 'chrome', { matrix: M4.trs(xB + 0.03 + mw[0] / 2 + 0.03, y, z + 0.02 + mw[2] / 2 + 0.001, 0, -0.12, 0), mirror: true });
    const ind = box(mw[0] * 0.5, 0.012, 0.01);
    pb.add(ind, 'indR', { matrix: M4.trs(xB + 0.06 + mw[0] / 2 + 0.04, y - mw[1] * 0.3, z + 0.02 - mw[2] / 2 - 0.002, 0, -0.12, 0) });
    pb.add(ind, 'indL', { matrix: M4.trs(-(xB + 0.06 + mw[0] / 2 + 0.04), y - mw[1] * 0.3, z + 0.02 - mw[2] / 2 - 0.002, 0, 0.12, 0) });
  }
  const stalk = box(0.08, 0.035, 0.05);
  pb.add(stalk, 'trim', { matrix: M4.trs(xB + 0.06, y - 0.03, z + 0.03), mirror: true });
}

function addWipers({ pb, P, G, design }) {
  const g = design.body.green;
  const t = g.t0 + 0.012, z = P.zOf(t), y = P.ys(t) + 0.03;
  for (const [x, rot] of [[0.05, 0.08], [-0.55, 0.05]]) {
    const arm = box(0.55, 0.012, 0.018);
    pb.add(arm, 'black', { matrix: M4.trs(x + 0.27, y, z + 0.02, 0, rot, 0) });
  }
}

function addExhaust({ pb, P, design, hi }) {
  const ex = design.exhaust ?? { x: [-0.45], r: 0.035 };
  for (const x of ex.x) {
    const c = cyl(ex.r, ex.r, 0.14, hi ? 14 : 6, true); c.rotateX(Math.PI / 2);
    pb.add(c, 'chrome', { matrix: M4.t(x, ex.y ?? (P.sill(1) - 0.03 + ex.r), P.zR - 0.04) });
    const inner = new THREE.CircleGeometry(ex.r * 0.85, hi ? 12 : 6); inner.deleteAttribute('uv');
    pb.add(inner, 'under', { matrix: M4.t(x, ex.y ?? (P.sill(1) - 0.03 + ex.r), P.zR + 0.01) });
  }
}

function addInterior({ pb, P, G, design }) {
  const g = design.body.green ?? design.body.cockpit;
  const tDash = (g.t0 ?? 0.35) + 0.02;
  const yBelt = P.ys(0.5);
  const floor = design.openTop ? yBelt - (design.body.tubDepth ?? 0.4) : P.sill(0.5) + (design.floorH ?? 0.12);
  const hw = P.hw(0.5) * 0.82;
  const zDash = P.zOf(tDash) + 0.25;
  pb.add(box(hw * 2, 0.22, 0.45), 'interior', { matrix: M4.t(0, yBelt - 0.05, zDash) });
  // steering wheel (right-hand drive)
  const sw = new THREE.TorusGeometry(0.18, 0.018, 6, 20); sw.deleteAttribute('uv');
  pb.add(sw, 'black', { matrix: M4.trs(0.37, yBelt + 0.06, zDash + 0.32, -0.45, 0, 0) });
  const seatZ = design.seatZ ?? [zDash + 0.85];
  const k = design.seatH ?? 1;
  for (const zs of seatZ) for (const x of [0.37, -0.37]) {
    pb.add(roundedBox(0.48, 0.12, 0.5, 0.04, 2), design.seatMat ?? 'interior', { matrix: M4.t(x, floor + 0.22 * k, zs) });
    pb.add(roundedBox(0.46, 0.56 * k, 0.12, 0.04, 2), design.seatMat ?? 'interior', { matrix: M4.trs(x, floor + 0.55 * k, zs + 0.27, -0.25, 0, 0) });
    pb.add(roundedBox(0.24, 0.15, 0.1, 0.03, 2), design.seatMat ?? 'interior', { matrix: M4.trs(x, floor + 0.9 * k, zs + 0.34, -0.15, 0, 0) });
  }
  if (design.rearBench) {
    const zb = design.rearBench;
    pb.add(roundedBox(hw * 1.8, 0.14, 0.5, 0.04, 2), 'interior', { matrix: M4.t(0, floor + 0.22, zb) });
    pb.add(roundedBox(hw * 1.8, 0.52, 0.14, 0.04, 2), 'interior', { matrix: M4.trs(0, floor + 0.52, zb + 0.27, -0.2, 0, 0) });
  }
}
