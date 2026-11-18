// Sub-texel ground class edges for public/data/ground.png (alpha channel).
//
// The mask is a 2 m/px raster, so a lawn, plaza or quay edge read straight from it steps in 2 m blocks or, filtered,
// melts into soft blobs. Every texel's class (water, vegetation, pitch, bare ground, and each paving type; the same
// classOf() the ground shader runs on R, G, B) also gets the signed distance from its centre to the edge of that class's
// region, measured on the vector geometry the raster was drawn from (OSM polygons, road and pier strokes, building aprons,
// the coastline): positive inside, negative when the true edge leaves the texel centre outside. Bilinearly interpolated
// over the four texels round a pixel, that distance reproduces a straight edge exactly wherever it falls, so the shader
// draws crisp, sub-texel edges (and kerbs, coping and edging bands at a known distance from them) at no memory cost.
// R, G and B stay exactly as they were: everything that queries the mask on the CPU sees the same data.
//
// Alpha = 127.5 + s / SMAX * 127.5 (s in metres, clamped to +-SMAX); 255 where no other class is within a texel.

export const SMAX = 3;
const BIG = 1e9;

// ground classes (the shader's groundClass() must agree)
export const CLS = { water: 0, veg: 1, plaza: 2, sidewalk: 3, carpark: 4, apron: 5, pitch: 6, bare: 7 };
export function classOf(r, g, b) {
  if (r < 160) return CLS.water;
  if (g >= 140) return CLS.veg;
  if (b >= 112) return b >= 243 ? CLS.plaza : b >= 212 ? CLS.sidewalk : b >= 191 ? CLS.carpark : CLS.apron;
  return g >= 50 ? CLS.pitch : CLS.bare;
}

// ---------- small geometry kernels ----------
function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
  let t = L2 > 0 ? ((px - ax) * vx + (pz - az) * vz) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}
// signed distance to a convex CCW polygon (flat [x0,z0,x1,z1,...]): exact inside and outside
function convexSd(px, pz, P) {
  const n = P.length / 2; let inside = -BIG, out = BIG, isIn = true;
  for (let i = 0; i < n; i++) {
    const ax = P[i * 2], az = P[i * 2 + 1], bx = P[((i + 1) % n) * 2], bz = P[((i + 1) % n) * 2 + 1];
    const ex = bx - ax, ez = bz - az, l = Math.hypot(ex, ez) || 1;
    // outward normal of a CCW ring in x/z (z south): (ez, -ex)
    const d = ((px - ax) * ez - (pz - az) * ex) / l;
    if (d > 0) isIn = false;
    if (d > inside) inside = d;
    const sd = segDist(px, pz, ax, az, bx, bz); if (sd < out) out = sd;
  }
  return isIn ? inside : out;
}
function hull(pts) { // monotone chain
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop(); return lo.concat(up);
}
function ringArea2(flat) { let a = 0; const n = flat.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += flat[i * 2] * flat[j * 2 + 1] - flat[j * 2] * flat[i * 2 + 1]; } return a; }
// orient so convexSd's outward normal (ez, -ex) points out: that wants positive signed area
function orient(flat) { if (ringArea2(flat) < 0) { const r = []; for (let i = flat.length / 2 - 1; i >= 0; i--) r.push(flat[i * 2], flat[i * 2 + 1]); return r; } return flat; }

// uniform grid of item ids over a world box
class Grid {
  constructor(cell) { this.cell = cell; this.m = new Map(); }
  key(i, j) { return i * 100003 + j; }
  insert(id, x0, z0, x1, z1) {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
      const k = this.key(i, j); let l = this.m.get(k); if (!l) this.m.set(k, l = []); l.push(id);
    }
  }
  at(x, z) { return this.m.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) || null; }
}

/**
 * mask: RGBA Uint8Array (R, G, B final; A is written), sea: Uint8Array flood-fill flags, geometry in world metres:
 *   polys   [{ rings: [[[x, z], ...], ...] (even-odd), g, b, land (pier: makes land over water), water }]
 *   strokes [{ pts: [[x, z], ...], r, b, land }]
 *   aprons  [{ ring: [[x, z], ...], r }]   building footprint, paved out to an L-infinity distance r (B = 150)
 *   coast   [[[x, z], ...]]                coastline ways (land on the left), barrier half-width coastR
 */
export function bakeGroundSdf({ mask, sea, W, H, RES, XMIN, ZMIN, polys, strokes, aprons, coast, coastR }) {
  const t0 = Date.now();
  const cx = i => XMIN + (i + 0.5) * RES, cz = j => ZMIN + (j + 0.5) * RES;
  const cls = new Uint8Array(W * H);
  for (let t = 0; t < W * H; t++) cls[t] = classOf(mask[t * 4], mask[t * 4 + 1], mask[t * 4 + 2]);

  // ---- polygons: per-row crossing tables (the same even-odd rule as the rasteriser, so membership at texel centres
  // matches it exactly), an edge grid for distances, a bbox grid for membership
  const P = polys.map(p => {
    const edges = [];
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const r of p.rings) for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length]; edges.push(a[0], a[1], b[0], b[1]);
      x0 = Math.min(x0, a[0]); x1 = Math.max(x1, a[0]); z0 = Math.min(z0, a[1]); z1 = Math.max(z1, a[1]);
    }
    const j0 = Math.max(0, Math.ceil((z0 - ZMIN) / RES - 0.5)), j1 = Math.min(H - 1, Math.floor((z1 - ZMIN) / RES - 0.5));
    const rowOff = new Int32Array(Math.max(0, j1 - j0 + 2)), xs = [];
    for (let j = j0; j <= j1; j++) {
      rowOff[j - j0] = xs.length; const z = cz(j), row = [];
      for (let e = 0; e < edges.length; e += 4) { const az = edges[e + 1], bz = edges[e + 3]; if ((az > z) !== (bz > z)) row.push(edges[e] + (z - az) * (edges[e + 2] - edges[e]) / (bz - az)); }
      row.sort((a, b) => a - b); for (const x of row) xs.push(x);
    }
    rowOff[Math.max(0, j1 - j0 + 1)] = xs.length;
    return { ...p, edges: new Float64Array(edges), x0, z0, x1, z1, j0, j1, rowOff, xs: new Float64Array(xs) };
  });
  const polyIn = (q, i, j) => {
    if (j < q.j0 || j > q.j1) return false;
    const x = cx(i); let n = 0;
    for (let k = q.rowOff[j - q.j0]; k < q.rowOff[j - q.j0 + 1]; k++) if (q.xs[k] <= x) n++; else break;
    return (n & 1) === 1;
  };
  const polyBox = new Grid(32), polyEdge = new Grid(8);
  P.forEach((q, id) => {
    polyBox.insert(id, q.x0, q.z0, q.x1, q.z1);
    for (let e = 0; e < q.edges.length; e += 4) polyEdge.insert(id * 1e6 + e / 4, Math.min(q.edges[e], q.edges[e + 2]) - SMAX, Math.min(q.edges[e + 1], q.edges[e + 3]) - SMAX, Math.max(q.edges[e], q.edges[e + 2]) + SMAX, Math.max(q.edges[e + 1], q.edges[e + 3]) + SMAX);
  });

  // ---- strokes: a segment grid (reach r + SMAX)
  const strokeSeg = new Grid(8);
  strokes.forEach((s, id) => {
    for (let k = 0; k + 1 < s.pts.length; k++) {
      const [ax, az] = s.pts[k], [bx, bz] = s.pts[k + 1], m = s.r + SMAX;
      strokeSeg.insert(id * 1e5 + k, Math.min(ax, bx) - m, Math.min(az, bz) - m, Math.max(ax, bx) + m, Math.max(az, bz) + m);
    }
  });

  // ---- aprons: footprint (ray-cast) + one convex "edge swept by the square" hexagon per edge
  const A = aprons.map(a => {
    const ring = a.ring, n = ring.length, hexes = [];
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n], h = a.r, pts = [];
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { pts.push([p[0] + sx * h, p[1] + sz * h], [q[0] + sx * h, q[1] + sz * h]); }
      hexes.push(orient(hull(pts).flat()));
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]);
    }
    return { ring, hexes, x0: x0 - a.r, z0: z0 - a.r, x1: x1 + a.r, z1: z1 + a.r };
  });
  const apronBox = new Grid(32);
  A.forEach((a, id) => apronBox.insert(id, a.x0 - SMAX, a.z0 - SMAX, a.x1 + SMAX, a.z1 + SMAX));
  const ringIn = (ring, x, z) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, zi] = ring[i], [xj, zj] = ring[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };

  // ---- coastline: segment grid; the sea lies on the right of each way, past the rasteriser's barrier (coastR)
  const coastSegs = [];
  for (const pts of coast) for (let k = 0; k + 1 < pts.length; k++) coastSegs.push(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]);
  const coastGrid = new Grid(8), coastReach = coastR + SMAX + 1;
  for (let s = 0; s < coastSegs.length; s += 4) coastGrid.insert(s, Math.min(coastSegs[s], coastSegs[s + 2]) - coastReach, Math.min(coastSegs[s + 1], coastSegs[s + 3]) - coastReach, Math.max(coastSegs[s], coastSegs[s + 2]) + coastReach, Math.max(coastSegs[s + 1], coastSegs[s + 3]) + coastReach);
  // signed side of the nearest coastline segment (+1 sea side); at a shared vertex the segment the point sits most
  // squarely beside decides
  const coastSide = (x, z, list) => {
    let bd = BIG, side = 0, bq = -1;
    for (const s of list) {
      const ax = coastSegs[s], az = coastSegs[s + 1], bx = coastSegs[s + 2], bz = coastSegs[s + 3];
      const d = segDist(x, z, ax, az, bx, bz); if (d > bd + 1e-6) continue;
      const vx = bx - ax, vz = bz - az, l = Math.hypot(vx, vz) || 1, c = ((x - ax) * vz - (z - az) * vx) / l; // > 0: right of the way
      const q = Math.abs(c) / Math.max(d, 1e-9);
      if (d < bd - 1e-6 || q > bq) { bd = d; side = c >= 0 ? 1 : -1; bq = q; }
    }
    return [bd, side];
  };

  // ---- per band texel: features near it, the class they make, the distance to the nearest change of class
  const F = { n: 0, sd: new Float64Array(256), mem: new Uint8Array(256), g: new Uint8Array(256), b: new Uint8Array(256), land: new Uint8Array(256), water: new Uint8Array(256), sea: new Uint8Array(256) };
  const add = (sd, g, b, land, water, seaF) => { const k = F.n++; F.sd[k] = sd; F.mem[k] = sd < 0 ? 1 : 0; F.g[k] = g; F.b[k] = b; F.land[k] = land; F.water[k] = water; F.sea[k] = seaF; };
  const evalClass = () => {
    let seaM = 0, wat = 0, land = 0, G = 0, B = 0;
    for (let k = 0; k < F.n; k++) {
      if (!F.mem[k]) continue;
      if (F.sea[k]) seaM = 1; if (F.water[k]) wat = 1; if (F.land[k]) land = 1;
      if (F.g[k] > G) G = F.g[k]; if (F.b[k] > B) B = F.b[k];
    }
    return classOf((seaM || wat) && !land ? 0 : 255, G, B);
  };
  const order = new Int32Array(256);
  // smallest |sd| at which the class turns into (want = true) / away from (want = false) class c: single features
  // crossed one at a time, then the features the point is inside left in order of their nearest edge (a union's inside)
  const reach = (c, want) => {
    let best = BIG;
    for (let k = 0; k < F.n; k++) {
      const d = Math.abs(F.sd[k]); if (d >= best || d >= SMAX) continue;
      F.mem[k] ^= 1; const c1 = evalClass(); F.mem[k] ^= 1;
      if ((c1 === c) === want) best = d;
    }
    let m = 0; for (let k = 0; k < F.n; k++) if (F.mem[k] && -F.sd[k] < SMAX) order[m++] = k;
    const idx = Array.from(order.subarray(0, m)).sort((a, b) => F.sd[b] - F.sd[a]);
    for (let q = 0; q < idx.length; q++) {
      const d = -F.sd[idx[q]]; if (d >= best) break;
      F.mem[idx[q]] = 0;
      if ((evalClass() === c) === want) { best = d; break; }
    }
    for (const k of idx) F.mem[k] = 1;
    return best;
  };

  let band = 0, mismatched = 0;
  const near = new Map();
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const t = j * W + i, c = cls[t];
    let edge = false;
    for (let dj = -1; dj <= 1 && !edge; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
      if (cls[jj * W + ii] !== c) { edge = true; break; }
    }
    if (!edge) { mask[t * 4 + 3] = 255; continue; }
    band++;
    const x = cx(i), z = cz(j);
    F.n = 0;
    // polygons
    near.clear();
    for (const e of polyEdge.at(x, z) || []) {
      const id = Math.floor(e / 1e6), k = (e - id * 1e6) * 4, E = P[id].edges;
      const d = segDist(x, z, E[k], E[k + 1], E[k + 2], E[k + 3]);
      if (d < (near.get(id) ?? BIG)) near.set(id, d);
    }
    for (const id of polyBox.at(x, z) || []) {
      const q = P[id]; if (x < q.x0 - SMAX || x > q.x1 + SMAX || z < q.z0 - SMAX || z > q.z1 + SMAX) continue;
      const inside = polyIn(q, i, j), d = near.get(id) ?? BIG;
      if (!inside && d >= SMAX) continue;
      add(inside ? -d : d, q.g || 0, q.b || 0, q.land ? 1 : 0, q.water ? 1 : 0, 0);
    }
    // strokes
    near.clear();
    for (const e of strokeSeg.at(x, z) || []) {
      const id = Math.floor(e / 1e5), k = e - id * 1e5, s = strokes[id], a = s.pts[k], b = s.pts[k + 1];
      const d = segDist(x, z, a[0], a[1], b[0], b[1]) - s.r;
      if (d < (near.get(id) ?? BIG)) near.set(id, d);
    }
    for (const [id, d] of near) { const s = strokes[id]; add(d, 0, s.b || 0, s.land ? 1 : 0, 0, 0); }
    // building aprons
    for (const id of apronBox.at(x, z) || []) {
      const a = A[id]; if (x < a.x0 - SMAX || x > a.x1 + SMAX || z < a.z0 - SMAX || z > a.z1 + SMAX) continue;
      let sd;
      if (ringIn(a.ring, x, z)) sd = -BIG;
      else { sd = BIG; for (const hx of a.hexes) { const v = convexSd(x, z, hx); if (v < sd) sd = v; } }
      if (sd < SMAX) add(sd, 0, 150, 0, 0, 0);
    }
    // the sea: its edge from the coastline where one is near (and agrees with the flood fill), else the flood fill
    const cl = coastGrid.at(x, z);
    let seaSd = sea[t] ? -BIG : BIG;
    if (cl) {
      const [d, side] = coastSide(x, z, cl);
      const sd = coastR - side * d;
      if (d < coastReach && (sd < 0) === !!sea[t]) seaSd = sd;
    }
    add(seaSd, 0, 0, 0, 0, 1);

    const c0 = evalClass();
    let s;
    if (c0 === c) s = Math.min(SMAX, reach(c, false));
    else { mismatched++; const d = reach(c, true); s = d < BIG ? -Math.min(SMAX, d) : 0; }
    mask[t * 4 + 3] = Math.max(0, Math.min(255, Math.round(127.5 + s / SMAX * 127.5)));
  }
  console.log(`ground sdf: ${band} edge texels (${(band / (W * H) * 100).toFixed(1)}%), ${mismatched} off the raster's class, ${Date.now() - t0} ms`);
}
