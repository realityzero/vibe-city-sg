// Parametric car body: a lofted lower body (with real wheel arches) plus a lofted greenhouse.
// Everything is driven by side-profile curves over t ∈ [0,1] (front → rear).
// Coordinates: forward -z, up +y, origin on the ground midway between the axles.
import * as THREE from 'three';
import { gridGeometry, gridSubset, capGeometry, clipRegion, monotone } from './geom.js';

const EPS_T = 2e-5;

export function makeProfile(def) {
  const L = def.L, zF = -def.wb / 2 - def.fo, zR = zF + L;
  const ys = monotone(def.shoulder), crown = monotone(def.crown), sill = monotone(def.sill);
  const tumble = monotone(def.tumble ?? [[0, 0.03], [1, 0.03]]);
  const tub = def.tub ? monotone(def.tub) : null;
  const axles = def.axles ?? [-def.wb / 2, def.wb / 2];
  const R = def.archR ?? def.wr + 0.065;
  const wy = def.archY ?? def.wr;
  const flare = def.flare ?? 0.012;
  const tOf = z => (z - zF) / L;
  const zOf = t => zF + t * L;
  function hw(t) {
    const d = t * L;
    const { rf, mf, rr, mr } = def.plan;
    let p = 1;
    if (d < rf) p = mf + (1 - mf) * Math.sqrt(Math.max(0, 1 - (1 - d / rf) ** 2));
    const dr = L - d;
    if (dr < rr) p = Math.min(p, mr + (1 - mr) * Math.sqrt(Math.max(0, 1 - (1 - dr / rr) ** 2)));
    const z = zOf(t);
    let fl = 0;
    for (const a of axles) { const q = (z - a) / (R * 1.7); if (Math.abs(q) < 1) fl = Math.max(fl, (1 - q * q) ** 2); }
    return def.W / 2 * p * (1 - flare * (1 - fl));
  }
  function arch(t) {
    const z = zOf(t); let y = 0;
    for (const a of axles) { const dz = z - a; if (Math.abs(dz) < R) y = Math.max(y, wy + Math.sqrt(R * R - dz * dz)); }
    return y;
  }
  return { def, L, zF, zR, hw, arch, ys, crown, sill, tumble, tub, axles, R, wy, tOf, zOf };
}

/** Half cross-section of the lower body at t: points from bottom centre → side → top centre. */
export function lowerSection(P, t, n) {
  const def = P.def;
  const hw = P.hw(t), yb = P.sill(t), ya = P.arch(t), ys = P.ys(t), crown = Math.max(0, P.crown(t)), tum = P.tumble(t);
  const ybA = Math.max(yb, ya);
  const span = Math.max(0.02, ys - ybA);
  const br = Math.min(def.br ?? 0.05, span * 0.3);
  const sr = Math.max(0.004, Math.min(def.sr ?? 0.07, span * 0.45, hw * 0.3));
  const xin = Math.min(def.track / 2 - def.ww / 2 - 0.035, hw - br - 0.02);
  const xs = hw * (1 - tum);
  const bulge = (def.bulge ?? 0.012) * hw;
  const pts = [[0, yb], [xin, yb], [xin, ybA], [hw - br, ybA]];
  const iCorner = pts.length - 1;
  for (let i = 1; i <= n.corner; i++) { const a = -Math.PI / 2 + (i / n.corner) * Math.PI / 2; pts.push([hw - br + Math.cos(a) * br, ybA + br + Math.sin(a) * br]); }
  const iSide = pts.length - 1;
  const y0 = ybA + br, y1 = Math.max(y0, ys - sr);
  const sideExp = def.sideExp ?? 2;
  for (let i = 1; i <= n.side; i++) {
    const f = i / n.side;
    pts.push([hw + (xs - hw) * Math.pow(f, sideExp) + bulge * Math.sin(Math.PI * f), y0 + (y1 - y0) * f]);
  }
  const iShoulder = pts.length - 1;
  for (let i = 1; i <= n.shoulder; i++) { const a = (i / n.shoulder) * Math.PI / 2; pts.push([xs - sr + Math.cos(a) * sr, y1 + Math.sin(a) * sr]); }
  const iTop = pts.length - 1;
  const xt = xs - sr;
  const tubF = P.tub ? Math.min(1, Math.max(0, P.tub(t))) : 0;
  const depth = def.tubDepth ?? 0.4, rim = def.tubRim ?? 0.07;
  for (let i = 1; i <= n.top; i++) {
    const f = i / n.top;
    const x = xt * (1 - f);
    let px = x, py = ys + crown * (1 - (x / Math.max(1e-6, xt)) ** 2);
    if (tubF > 0) {
      let qx, qy;
      if (i === 1) { qx = xt - rim; qy = ys; }
      else if (i === 2) { qx = xt - rim - 0.015; qy = ys - depth; }
      else { const g = (i - 2) / (n.top - 2); qx = (xt - rim - 0.015) * (1 - g); qy = ys - depth; }
      px = px + (qx - px) * tubF; py = py + (qy - py) * tubF;
    }
    pts.push([px, py]);
  }
  return { pts, iCorner, iSide, iShoulder, iTop, hw, ys, ybA };
}

/** Greenhouse half-section at t. */
export function greenSection(P, G, t, n) {
  const hw = P.hw(t), tum = P.tumble(t);
  const sr = Math.min(P.def.sr ?? 0.07, hw * 0.3);
  const yB = P.ys(t) + Math.max(0, P.crown(t)) * 0.0;
  const xB = hw * (1 - tum) - sr - G.inset;
  const yR = G.roofY(t, yB), xR = Math.min(xB, G.roofHW(t, xB));
  const h = Math.max(0, yR - yB);
  const er = Math.min(G.edgeR, h * 0.5, xR * 0.5);
  const pts = [[xB, yB]];
  for (let i = 1; i <= n.side; i++) {
    const f = i / n.side;
    const x = xB + (xR - xB) * f + G.bow * Math.sin(Math.PI * f) * Math.min(1, h / 0.3);
    pts.push([x, yB + (yR - er - yB) * f]);
  }
  const iSideEnd = pts.length - 1;
  for (let i = 1; i <= n.edge; i++) { const a = (i / n.edge) * Math.PI / 2; pts.push([xR - er + Math.cos(a) * er, yR - er + Math.sin(a) * er]); }
  const iRoof = pts.length - 1;
  const xr0 = xR - er;
  for (let i = 1; i <= n.roof; i++) { const f = i / n.roof; const x = xr0 * (1 - f); pts.push([x, yR + G.crown * Math.min(1, h / 0.25) * (1 - (x / Math.max(1e-6, xr0)) ** 2)]); }
  return { pts, iSideEnd, iRoof };
}

function loop(half, z) {
  const out = half.map(p => [p[0], p[1], z]);
  for (let i = half.length - 2; i >= 0; i--) out.push([-half[i][0], half[i][1], z]);
  return out;
}
const halfIndex = (k, N) => (k < N ? k : 2 * N - 2 - k);

/** Builds a greenhouse descriptor from def.green with defaults. */
export function makeGreen(P, g) {
  const H = g.H;
  const roofDrop = g.roofDrop ?? 0.025;
  const ws = g.wsCurve ?? 1.6, rg = g.rgCurve ?? 1.4;
  const G = {
    ...g, inset: g.inset ?? 0.03, edgeR: g.edgeR ?? 0.07, bow: g.bow ?? 0.02, crown: g.crown ?? 0.025,
    roofY(t, yB) {
      if (t <= g.t0 || t >= g.t3) return yB;
      if (t < g.t1) { const f = (t - g.t0) / (g.t1 - g.t0); return yB + (H - roofDrop - yB) * (1 - Math.pow(1 - f, ws)); }
      if (t <= g.t2) { const f = (t - g.t1) / (g.t2 - g.t1); return H - roofDrop * (2 * f - 1) ** 2; }
      const f = (t - g.t2) / (g.t3 - g.t2); return H - roofDrop - (H - roofDrop - yB) * Math.pow(f, rg);
    },
    roofHW(t, xB) {
      const rw = P.def.W / 2 * g.roofW;
      if (t < g.t1) { const f = Math.max(0, (t - g.t0) / (g.t1 - g.t0)); return xB + (rw - xB) * (1 - Math.pow(1 - f, 2.2)); }
      if (t <= g.t2) { const f = (t - g.t1) / (g.t2 - g.t1); return rw * (1 - (g.roofTaper ?? 0.03) * f); }
      const f = Math.min(1, (t - g.t2) / (g.t3 - g.t2)); const r2 = rw * (1 - (g.roofTaper ?? 0.03));
      return r2 + (xB * (g.rearBaseW ?? 0.92) - r2) * Math.pow(f, 1.6);
    },
  };
  return G;
}

/**
 * Builds the body surfaces and adds them to the PartBuilder.
 * Returns { surfaces: {lower:[geo...], caps:[geo...], green: geo|null}, P, G } for later light/decal clipping.
 */
export function buildBody(pb, def, lod) {
  const P = makeProfile(def);
  const hi = lod === 'high';
  const n = hi ? { corner: 3, side: 6, shoulder: 4, top: 9 } : { corner: 1, side: 2, shoulder: 2, top: 3 };
  const count = hi ? Math.round(P.L * 17) : Math.max(18, Math.round(Math.min(P.L, 6) * 6));
  let ts = [];
  for (let i = 0; i <= count; i++) ts.push(i / count);
  const edges = [];
  for (const a of P.axles) {
    for (const s of [-1, 1]) { const te = P.tOf(a + s * P.R); if (te > 0 && te < 1) edges.push({ t: te, entering: s < 0 }); }
    const k = hi ? 18 : 7;
    for (let i = 1; i < k; i++) ts.push(P.tOf(a - P.R + 2 * P.R * i / k));
  }
  // extra stations at the nose/tail for crisp rounding
  for (const t of hi ? [0.004, 0.01, 0.02, 0.03, 0.97, 0.98, 0.99, 0.996] : [0.015, 0.985]) ts.push(t);
  if (def.extraT) ts.push(...def.extraT);
  ts = [...new Set(ts.map(t => Math.round(t * 1e6) / 1e6))].filter(t => t >= 0 && t <= 1).sort((a, b) => a - b);
  edges.sort((a, b) => a.t - b.t);
  // remove stations within EPS of edges, then split
  ts = ts.filter(t => edges.every(e => Math.abs(t - e.t) > EPS_T * 2));
  const segs = []; let cur = [];
  let ei = 0;
  for (const t of ts) {
    while (ei < edges.length && edges[ei].t < t) {
      cur.push(edges[ei].t - EPS_T); segs.push({ ts: cur }); segs.push({ wall: edges[ei] });
      cur = [edges[ei].t + EPS_T]; ei++;
    }
    cur.push(t);
  }
  segs.push({ ts: cur });

  const lower = [], unders = [];
  const meta = lowerSection(P, 0.5, n);
  const N = meta.pts.length;
  const sectionAt = t => lowerSection(P, t, n);
  const classifyLower = (tm, h) => {
    if (h < meta.iCorner) return 'under';
    if (P.tub && P.tub(tm) > 0.5 && h >= meta.iTop + 1) return 'interior';
    return 'paint';
  };
  const addGrid = (rows, tsSeg, fixedNormal) => {
    const geo = gridGeometry(rows, false, fixedNormal);
    const cols = rows[0].length;
    for (const key of ['paint', 'under', 'interior']) {
      const sub = gridSubset(geo, cols, (i, j) => classifyLower((tsSeg[i] + tsSeg[i + 1]) / 2, Math.min(halfIndex(j, N), halfIndex(j + 1, N))) === key);
      if (!sub.index.count) continue;
      pb.add(sub, key === 'paint' ? (def.bodyMat ?? 'paint') : key);
      if (key === 'paint') lower.push(sub); else unders.push(sub);
    }
  };
  for (const s of segs) {
    if (s.wall) {
      const rows = [loop(sectionAt(s.wall.t - EPS_T).pts, P.zOf(s.wall.t - EPS_T)), loop(sectionAt(s.wall.t + EPS_T).pts, P.zOf(s.wall.t + EPS_T))];
      const geo = gridGeometry(rows, false, [0, 0, s.wall.entering ? 1 : -1]);
      pb.add(geo, 'under');
      continue;
    }
    if (s.ts.length < 2) continue;
    const rows = s.ts.map(t => loop(sectionAt(t).pts, P.zOf(t)));
    addGrid(rows, s.ts, null);
  }
  // caps
  const capF = capGeometry(sectionAt(0).pts.concat(sectionAt(0).pts.slice(0, -1).reverse().map(p => [-p[0], p[1]])), P.zF, -1);
  const capR = capGeometry(sectionAt(1).pts.concat(sectionAt(1).pts.slice(0, -1).reverse().map(p => [-p[0], p[1]])), P.zR, 1);
  pb.add(capF, def.bodyMat ?? 'paint'); pb.add(capR, def.bodyMat ?? 'paint');

  // greenhouse
  let green = null, G = null;
  if (def.green) {
    G = makeGreen(P, def.green);
    const g = def.green;
    const gn = hi ? { side: 6, edge: 3, roof: 6 } : { side: 2, edge: 1, roof: 2 };
    const gc = hi ? Math.round((g.t3 - g.t0) * P.L * 20) : Math.max(8, Math.round((g.t3 - g.t0) * P.L * 5));
    let gts = [];
    for (let i = 0; i <= gc; i++) gts.push(g.t0 + (g.t3 - g.t0) * i / gc);
    const breaks = [g.t1, g.t2, g.sideStart, g.sideEnd, ...(g.pillars || []).flatMap(p => [p[0], p[1]])].filter(x => x != null && x > g.t0 && x < g.t3);
    gts.push(...breaks);
    gts = [...new Set(gts.map(t => Math.round(t * 1e6) / 1e6))].sort((a, b) => a - b);
    const gmeta = greenSection(P, G, (g.t1 + g.t2) / 2, gn);
    const GN = gmeta.pts.length;
    const rows = gts.map(t => loop(greenSection(P, G, t, gn).pts, P.zOf(t)));
    const geo = gridGeometry(rows, false);
    const cols = rows[0].length;
    const inPillar = t => (g.pillars || []).some(p => t > p[0] && t < p[1]);
    const classify = (t, h) => {
      if (g.open && (t > g.t1 + 0.0005 || h < gmeta.iSideEnd)) return null;
      if (h >= gmeta.iRoof) {
        if (t < g.t1 - 0.002) return 'glass';
        if (t > g.t2 + 0.002) return g.rearGlass === false ? (g.roofMat ?? 'paint') : 'glass';
        return g.sunroof && t > g.sunroof[0] && t < g.sunroof[1] && h >= gmeta.iRoof + 1 ? 'glassDark' : (g.roofMat ?? 'paint');
      }
      if (h >= gmeta.iSideEnd) return t < g.t1 ? (g.aPillar ?? 'paint') : t > g.t2 ? (g.cPillar ?? 'paint') : (g.roofMat ?? 'paint');
      if (t < g.sideStart || t > g.sideEnd) return g.cPillar ?? 'paint';
      if (inPillar(t)) return g.bPillar ?? 'trim';
      if (g.sideGlassMax != null && h >= g.sideGlassMax) return g.roofMat ?? 'paint';
      return 'glass';
    };
    green = { geo, glassParts: [] };
    const keys = new Set();
    for (let i = 0; i < gts.length - 1; i++) for (let h = 0; h < GN; h++) keys.add(classify((gts[i] + gts[i + 1]) / 2, h));
    for (const key of keys) {
      if (key == null) continue;
      const sub = gridSubset(geo, cols, (i, j) => classify((gts[i] + gts[i + 1]) / 2, Math.min(halfIndex(j, GN), halfIndex(j + 1, GN))) === key);
      if (!sub.index.count) continue;
      if (key === 'glass' && hi && def.transparentGlass) green.glassParts.push(sub);
      else pb.add(sub, key);
      if (key !== 'glass') lower.push(sub);
    }
    green.meta = gmeta;
  }
  return { P, G, surfaces: { lower, caps: hi ? [subdivide(capF, 2), subdivide(capR, 2)] : [capF, capR], capsRaw: [capF, capR], unders, green } };
}

/** Clip helper bound to body surfaces: adds a patch for the given material and constraints. */
export function patch(pb, surfaces, mat, constraints, o = {}) {
  // clip each half separately so |x|-based constraints stay linear inside every triangle
  const out = [];
  for (const s of [1, -1]) {
    const geo = clipRegion(surfaces, [p => -s * p.x, ...constraints], o.offset ?? 0.004);
    if (geo.attributes.position.count) { pb.add(geo, mat, o); out.push(geo); }
  }
  return out;
}

/** Midpoint-subdivided copy of a geometry (used only as a clipping surface for big flat caps). */
export function subdivide(geo, levels = 3) {
  let P = [], N = [];
  const pos = geo.attributes.position, nrm = geo.attributes.normal, idx = geo.index.array;
  for (let i = 0; i < idx.length; i++) { P.push([pos.getX(idx[i]), pos.getY(idx[i]), pos.getZ(idx[i])]); N.push([nrm.getX(idx[i]), nrm.getY(idx[i]), nrm.getZ(idx[i])]); }
  for (let l = 0; l < levels; l++) {
    const P2 = [], N2 = [];
    for (let i = 0; i < P.length; i += 3) {
      const [a, b, c] = [P[i], P[i + 1], P[i + 2]], n = N[i];
      const m = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2, (u[2] + v[2]) / 2];
      const ab = m(a, b), bc = m(b, c), ca = m(c, a);
      for (const t of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]) { P2.push(...t); N2.push(n, n, n); }
    }
    P = P2; N = N2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P.flat()), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N.flat()), 3));
  return g;
}
