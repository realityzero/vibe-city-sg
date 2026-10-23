// Builds all static city geometry off the main thread:
// building walls/roofs (chunked), road ribbons + junctions + bridges, footways, seawalls, tree placements, physics meshes.
// Output buffers are transferred back to the main thread.
import earcut from 'earcut';

const STYLE = { glass: 0, office: 1, resi: 2, hdb: 3, shophouse: 4, lowrise: 5, civic: 6, parking: 7, canopy: 8, industrial: 9, station: 10, plain: 11 };
const LANE_W = 3.3;

// triangle counts per geometry category (build stats; TAG is set around each generator)
let TAG = 'misc'; const TC = {};
let rngState = 12345;
const rand = () => { rngState = (rngState * 1664525 + 1013904223) >>> 0; return rngState / 4294967296; };
const hash1 = n => { let x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

self.onmessage = async e => {
  if (e.data.type === 'build') {
    try { await build(e.data); }
    catch (err) { self.postMessage({ type: 'error', message: err.message, stack: err.stack }); }
  }
};

// ---------- growable buffers ----------
class Buf {
  constructor(n = 1 << 14) { this.a = new Float32Array(n); this.n = 0; }
  push(...v) { if (this.n + v.length > this.a.length) this.grow(this.n + v.length); for (let i = 0; i < v.length; i++) this.a[this.n++] = v[i]; }
  grow(min) { let s = this.a.length * 2; while (s < min) s *= 2; const b = new Float32Array(s); b.set(this.a.subarray(0, this.n)); this.a = b; }
  out() { return this.a.slice(0, this.n); }
}
class IBuf {
  constructor(n = 1 << 14) { this.a = new Uint32Array(n); this.n = 0; }
  push(...v) { if (this.n + v.length > this.a.length) { let s = this.a.length * 2; while (s < this.n + v.length) s *= 2; const b = new Uint32Array(s); b.set(this.a.subarray(0, this.n)); this.a = b; } for (let i = 0; i < v.length; i++) this.a[this.n++] = v[i]; }
  out() { return this.a.slice(0, this.n); }
}
class Geo {
  constructor(layout) { this.layout = layout; this.b = {}; for (const k in layout) this.b[k] = new Buf(); this.idx = new IBuf(); this.vc = 0; }
  // v: object of arrays per attribute name
  vert(v) { for (const k in this.layout) this.b[k].push(...v[k]); return this.vc++; }
  tri(a, b, c) { this.idx.push(a, b, c); TC[TAG] = (TC[TAG] || 0) + 1; }
  empty() { return this.vc === 0; }
  out() { const o = { attributes: {}, index: this.idx.out(), count: this.vc }; for (const k in this.layout) o.attributes[k] = { array: this.b[k].out(), itemSize: this.layout[k] }; return o; }
}
const WALL_LAYOUT = { position: 3, normal: 3, color: 3, aWall: 2, aF1: 4, aF2: 4 };
const ROOF_LAYOUT = { position: 3, normal: 3, color: 3, aRoof: 4 };
const ROAD_LAYOUT = { position: 3, normal: 3, aRoad: 4, aLanes: 4, aJunc: 4 };
const SIMPLE_LAYOUT = { position: 3, normal: 3, color: 3 };

// ---------- geometry helpers ----------
function area2(r) { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a; }
function pip(x, z, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
function ringOf(flat) { const r = []; for (let i = 0; i < flat.length; i += 2) r.push([flat[i], flat[i + 1]]); return r; }
function centroidOf(r) { let a = 0, cx = 0, cz = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; const f = p[0] * q[1] - q[0] * p[1]; a += f; cx += (p[0] + q[0]) * f; cz += (p[1] + q[1]) * f; } if (Math.abs(a) < 1e-6) { let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return [x / r.length, z / r.length]; } return [cx / (3 * a), cz / (3 * a)]; }
// minimum-area oriented bounding box: {cx, cz, ux, uz (long axis unit), L (long), Wd (short)}
function obb(r) {
  let best = null;
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    let ux = q[0] - p[0], uz = q[1] - p[1]; const l = Math.hypot(ux, uz); if (l < 0.5) continue; ux /= l; uz /= l;
    let mina = Infinity, maxa = -Infinity, minb = Infinity, maxb = -Infinity;
    for (const s of r) { const a = s[0] * ux + s[1] * uz, b = -s[0] * uz + s[1] * ux; mina = Math.min(mina, a); maxa = Math.max(maxa, a); minb = Math.min(minb, b); maxb = Math.max(maxb, b); }
    const ar = (maxa - mina) * (maxb - minb);
    if (!best || ar < best.area) {
      const ca = (mina + maxa) / 2, cb = (minb + maxb) / 2;
      best = { area: ar, cx: ca * ux - cb * uz, cz: ca * uz + cb * ux, ux, uz, A: maxa - mina, B: maxb - minb };
    }
  }
  if (!best) return null;
  if (best.B > best.A) { // make u the long axis
    const { ux, uz } = best; best.ux = -uz; best.uz = ux; [best.A, best.B] = [best.B, best.A];
  }
  return { cx: best.cx, cz: best.cz, ux: best.ux, uz: best.uz, L: best.A, Wd: best.B, area: best.area };
}
// inward offset of a CCW ring with a per-edge distance D[i] (edge i = r[i]→r[i+1]); null if it degenerates
function recessRing(r, D) {
  const n = r.length, out = [], dmax = Math.max(...D);
  const dir = i => { const p = r[i], q = r[(i + 1) % n]; const ex = q[0] - p[0], ez = q[1] - p[1], l = Math.hypot(ex, ez) || 1; return [ex / l, ez / l]; };
  for (let i = 0; i < n; i++) {
    const ip = (i - 1 + n) % n, dp = dir(ip), dn = dir(i);
    const a = [r[i][0] - dp[1] * D[ip], r[i][1] + dp[0] * D[ip]], b = [r[i][0] - dn[1] * D[i], r[i][1] + dn[0] * D[i]];
    const cr = dp[0] * dn[1] - dp[1] * dn[0];
    let v;
    if (Math.abs(cr) < 0.2) v = D[i] >= D[ip] ? b : a;
    else { const t = ((b[0] - a[0]) * dn[1] - (b[1] - a[1]) * dn[0]) / cr; v = [a[0] + dp[0] * t, a[1] + dp[1] * t]; }
    if (Math.hypot(v[0] - r[i][0], v[1] - r[i][1]) > dmax * 3.2) return null;
    out.push(v);
  }
  const A0 = area2(r), A1 = area2(out);
  return A1 > 0.35 * A0 ? out : null;
}
const c3 = hex => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
const srgbToLin = c => c.map(v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------- palettes ----------
const PAL = {
  glass: [0x5d7f8f, 0x34506b, 0x8d9aa3, 0x6a5d4f, 0x4f7466, 0x2d3640, 0x7894a8, 0x506a7c, 0x9fb3bd],
  office: [0xd9d4c7, 0xc9c6bd, 0xb8b4aa, 0xe6e1d3, 0xa9a59b, 0xcfc4b0, 0x9c9a94],
  resi: [0xf1ede4, 0xe9e2d0, 0xdcd6cb, 0xf3e7d3, 0xe0e6e8, 0xd8cfc0],
  hdb: [0xf2efe6, 0xefe9da, 0xe8e4dc, 0xe9eef0, 0xf1e6d6, 0xe4ece0, 0xf3e3df, 0xe6e3ee, 0xf4ecd2],
  hdbAccent: [0xd9534f, 0x3f88c5, 0x5cb85c, 0xf0ad4e, 0x8e6bb5, 0x2bb3a6, 0xe27a3f, 0xc94c7c],
  shophouse: [0xa8d8b9, 0xf4b6c2, 0xf6e3a1, 0xa9d6e5, 0xf7c59f, 0xc9b6e4, 0xf3efe0, 0xe8a87c, 0xb5e0d3, 0xf9d5a7, 0xd4e09b, 0x9ec5e8, 0xefb1a1],
  lowrise: [0xe5dfd2, 0xd6cfc1, 0xcfc9bd, 0xe9e4da, 0xc4bfb4, 0xddd2bd],
  civic: [0xf4f1ea, 0xefe9dc, 0xf7f3e8],
  industrial: [0xb7b9b5, 0xa3a7a6, 0xc6c2b8],
  parking: [0xd6d3cb, 0xcfccc4],
  station: [0x8f9aa0],
  canopy: [0xc2c4c2, 0x9fa3a4],
};
const ROOF_DEFAULT = { flat: 0x9b9891, terracotta: 0xa4553a, dark: 0x5b5d60, green: 0x5e8a6e };
const ROOF_CLAY = [0x9c5b36, 0x8f5a3a, 0xa86a42, 0x7f523a, 0x936147, 0x8a5a40, 0xa07050, 0x6f5548, 0xb06a40, 0x80604e, 0x94603c, 0x7a4e34];
const pick = (arr, s) => arr[Math.floor(s * arr.length) % arr.length];

// ---------- mask ----------
async function loadMask(url) {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return { w: bmp.width, h: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
}

async function build({ cityUrl, groundUrl, exclusions = [], chunkSize = 300, quality = 'high' }) {
  const t0 = performance.now();
  const progress = (p, label) => self.postMessage({ type: 'progress', p, label });
  progress(0.02, 'Downloading OpenStreetMap Singapore');
  const [city, mask] = await Promise.all([fetch(cityUrl).then(r => r.json()), loadMask(groundUrl)]);
  const M = city.meta;
  const res = M.res;
  const maskAt = (x, z, ch = 0) => {
    const i = Math.round((x - M.xmin) / res - 0.5), j = Math.round((z - M.zmin) / res - 0.5);
    if (i < 0 || j < 0 || i >= mask.w || j >= mask.h) return ch === 0 ? 255 : 0;
    return mask.data[(j * mask.w + i) * 4 + ch];
  };
  const nCx = Math.ceil((M.xmax - M.xmin) / chunkSize), nCz = Math.ceil((M.zmax - M.zmin) / chunkSize);
  // chunk keys allow cells outside the map (procedural outskirts beyond the OSM bbox)
  const chunkKey = (x, z) => {
    const cx = Math.floor((x - M.xmin) / chunkSize), cz = Math.floor((z - M.zmin) / chunkSize);
    return (cz + 50) * 1000 + (cx + 50);
  };
  // outskirts use 3x coarser chunks (fewer draw calls for distant filler estates)
  const coarseKey = (x, z) => {
    const cs = chunkSize * 3, cx = Math.floor((x - M.xmin) / cs), cz = Math.floor((z - M.zmin) / cs);
    return 900000 + (cz + 50) * 1000 + (cx + 50);
  };
  const chunks = new Map();
  const chunk = k => {
    // wallsNear / structNear: street-level detail (colonnade pillars, five-foot-way floors, laundry poles, walkway posts)
    // that the main thread only draws for nearby chunks
    if (!chunks.has(k)) chunks.set(k, { walls: new Geo(WALL_LAYOUT), roofs: new Geo(ROOF_LAYOUT), roads: new Geo(ROAD_LAYOUT), foot: new Geo(ROAD_LAYOUT), struct: new Geo(SIMPLE_LAYOUT), wallsNear: new Geo(WALL_LAYOUT), structNear: new Geo(SIMPLE_LAYOUT), phys: { pos: new Buf(), idx: new IBuf(), vc: 0 } });
    return chunks.get(k);
  };
  // physics triangle soup per chunk (buildings + bridge decks)
  const physQuad = (ch, a, b, c, d) => { const P = ch.phys; const base = P.vc; P.pos.push(...a, ...b, ...c, ...d); P.vc += 4; P.idx.push(base, base + 1, base + 2, base, base + 2, base + 3); };
  const physTri = (ch, a, b, c) => { const P = ch.phys; const base = P.vc; P.pos.push(...a, ...b, ...c); P.vc += 3; P.idx.push(base, base + 1, base + 2); };

  // occupancy grid for tree placement (2 m)
  const occ = new Uint8Array(mask.w * mask.h);
  const occFillRing = (ring, val) => {
    let zmin = Infinity, zmax = -Infinity;
    for (const p of ring) { zmin = Math.min(zmin, p[1]); zmax = Math.max(zmax, p[1]); }
    const j0 = Math.max(0, Math.ceil((zmin - M.zmin) / res - 0.5)), j1 = Math.min(mask.h - 1, Math.floor((zmax - M.zmin) / res - 0.5));
    const xs = [];
    for (let j = j0; j <= j1; j++) {
      const z = M.zmin + (j + 0.5) * res; xs.length = 0;
      for (let i = 0, n = ring.length; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n]; if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + (z - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - M.xmin) / res - 0.5)), i1 = Math.min(mask.w - 1, Math.floor((xs[k + 1] - M.xmin) / res - 0.5));
        for (let i = i0; i <= i1; i++) occ[j * mask.w + i] = val;
      }
    }
  };
  const occStroke = (pts, rad, val) => {
    for (let s = 0; s + 1 < pts.length; s++) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
      const len = Math.hypot(bx - ax, bz - az); const n = Math.max(1, Math.ceil(len / res));
      for (let k = 0; k <= n; k++) {
        const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n;
        const ci = (x - M.xmin) / res - 0.5, cj = (z - M.zmin) / res - 0.5, rr = rad / res;
        for (let j = Math.max(0, Math.floor(cj - rr)); j <= Math.min(mask.h - 1, Math.ceil(cj + rr)); j++)
          for (let i = Math.max(0, Math.floor(ci - rr)); i <= Math.min(mask.w - 1, Math.ceil(ci + rr)); i++)
            if ((i - ci) ** 2 + (j - cj) ** 2 <= rr * rr) occ[j * mask.w + i] = Math.max(occ[j * mask.w + i], val);
      }
    }
  };
  const occAt = (x, z) => { const i = Math.round((x - M.xmin) / res - 0.5), j = Math.round((z - M.zmin) / res - 0.5); if (i < 0 || j < 0 || i >= mask.w || j >= mask.h) return 255; return occ[j * mask.w + i]; };

  // ---- road proximity grid: which building edges face a street (shophouse five-foot-ways / shopfronts)
  const RG = 24, roadGrid = new Map();
  for (let ri = 0; ri < city.roads.length; ri++) {
    const r = city.roads[ri];
    if (r.y && r.y.some(v => v > 3)) continue; // flyovers/bridges don't front buildings
    for (let i = 0; i + 1 < r.p.length / 2; i++) {
      const ax = r.p[i * 2], az = r.p[i * 2 + 1], bx = r.p[i * 2 + 2], bz = r.p[i * 2 + 3];
      for (let gx = Math.floor(Math.min(ax, bx) / RG); gx <= Math.floor(Math.max(ax, bx) / RG); gx++)
        for (let gz = Math.floor(Math.min(az, bz) / RG); gz <= Math.floor(Math.max(az, bz) / RG); gz++) {
          const k = gx * 100003 + gz; let l = roadGrid.get(k); if (!l) roadGrid.set(k, l = []); l.push(ri, i);
        }
    }
  }
  // clearance (m) from a point to the nearest road kerb; back lanes (service) and sidewalks are penalised
  const roadScore = (x, z) => {
    let best = 1e9; const gx = Math.floor(x / RG), gz = Math.floor(z / RG);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const l = roadGrid.get((gx + dx) * 100003 + gz + dz); if (!l) continue;
      for (let k = 0; k < l.length; k += 2) {
        const r = city.roads[l[k]], i = l[k + 1];
        const ax = r.p[i * 2], az = r.p[i * 2 + 1], bx = r.p[i * 2 + 2], bz = r.p[i * 2 + 3];
        const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
        const d = Math.hypot(x - ax - vx * t, z - az - vz * t) - r.w / 2 + (r.c === 7 ? 7 : r.c === 9 ? 2.5 : 0);
        if (d < best) best = d;
      }
    }
    return best;
  };

  // ---- keep buildings off the carriageway: OSM outlines often poke a corner a metre or two into the road, where cars
  // hit a wall that isn't there visually. Ground-touching footprint vertices inside a drivable road (not bridges,
  // flyovers or covered roads) are pushed out to its kerb line, perpendicular to the nearest segment, so the rendered
  // and the physics walls agree. Deep overlaps (a road genuinely running under a building) are left alone.
  let kerbPushed = 0;
  const clearOfRoads = ring => {
    for (let pass = 0; pass < 2; pass++) for (const v of ring) {
      const gx = Math.floor(v[0] / RG), gz = Math.floor(v[1] / RG);
      let best = 0, bfx = 0, bfz = 0, bd = 0, bhw = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const l = roadGrid.get((gx + dx) * 100003 + gz + dz); if (!l) continue;
        for (let k = 0; k < l.length; k += 2) {
          const r = city.roads[l[k]];
          if (r.c > 7 || r.b || r.cv) continue;
          const i = l[k + 1], ax = r.p[i * 2], az = r.p[i * 2 + 1], vx = r.p[i * 2 + 2] - ax, vz = r.p[i * 2 + 3] - az, L2 = vx * vx + vz * vz || 1;
          const t = Math.max(0, Math.min(1, ((v[0] - ax) * vx + (v[1] - az) * vz) / L2));
          const fx = ax + vx * t, fz = az + vz * t, d = Math.hypot(v[0] - fx, v[1] - fz), hw = r.w / 2;
          const pen = hw - 0.2 - d;
          if (pen > best && hw - d <= (r.c === 7 ? 1.5 : 4) && d > 1e-3) { best = pen; bfx = fx; bfz = fz; bd = d; bhw = hw; }
        }
      }
      if (best > 0) { const k = (bhw + 0.05) / bd; v[0] = bfx + (v[0] - bfx) * k; v[1] = bfz + (v[1] - bfz) * k; kerbPushed++; }
    }
  };

  // ================= BUILDINGS =================
  progress(0.1, 'Raising the skyline');
  const excl = exclusions.map(p => p.map(q => [q[0], q[1]]));
  const excluded = (x, z) => excl.some(p => pip(x, z, p));
  let nb = 0, wallTris = 0, roofTris = 0;
  const buildingInfo = []; // for main thread: footprint centroid/height (used by radar, missions, vegetation)
  // ---- procedural outskirts: HDB estates and condos beyond the OSM bbox so the skyline doesn't end
  const outskirts = [];
  {
    const W2 = mask.w, H2 = mask.h;
    const clampLand = (x, z) => {
      const i = Math.min(W2 - 1, Math.max(0, Math.round((x - M.xmin) / res))), j = Math.min(H2 - 1, Math.max(0, Math.round((z - M.zmin) / res)));
      return mask.data[(j * W2 + i) * 4] > 200;
    };
    let oid = 1e6; const R = 2400, step = 58;
    for (let z = M.zmin - R; z < M.zmax + R; z += step) for (let x = M.xmin - R; x < M.xmax + R; x += step) {
      const inside = x > M.xmin - 40 && x < M.xmax + 40 && z > M.zmin - 40 && z < M.zmax + 40;
      if (inside) continue;
      const jx = x + (rand() - 0.5) * 18, jz = z + (rand() - 0.5) * 18;
      if (!clampLand(jx, jz)) continue;
      // also require land a bit further out along the same direction (avoid sea strips)
      if (rand() < 0.3) continue;
      const estate = Math.floor(jx / 420) * 7 + Math.floor(jz / 420) * 13;
      const ang = (hash1(estate) < 0.5 ? 0 : Math.PI / 2) + (hash1(estate * 1.7) - 0.5) * 0.5 + (rand() < 0.2 ? Math.PI / 2 : 0);
      const kind = rand();
      let L, Wd, h, style, levels;
      if (kind < 0.62) { L = 48 + rand() * 26; Wd = 12 + rand() * 3; levels = 12 + Math.floor(rand() * 14); h = levels * 2.85 + 3; style = STYLE.hdb; }
      else if (kind < 0.82) { L = 22 + rand() * 6; Wd = 22 + rand() * 6; levels = 16 + Math.floor(rand() * 24); h = levels * 2.85 + 3; style = STYLE.hdb; }
      else if (kind < 0.94) { L = 26 + rand() * 12; Wd = 26 + rand() * 10; levels = 24 + Math.floor(rand() * 20); h = levels * 3.2; style = STYLE.resi; }
      else { L = 30 + rand() * 30; Wd = 20 + rand() * 20; levels = 3; h = 10 + rand() * 6; style = STYLE.lowrise; }
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const pts = [[-L / 2, -Wd / 2], [L / 2, -Wd / 2], [L / 2, Wd / 2], [-L / 2, Wd / 2]].map(([u, v]) => [jx + u * ca - v * sa, jz + u * sa + v * ca]);
      outskirts.push({ id: oid++, p: pts.flat(), h, s: style, l: levels, noPhys: true });
    }
  }
  for (const b of city.buildings.concat(outskirts)) {
    let outer = ringOf(b.p);
    if (outer.length < 3) continue;
    if (!b.noPhys && (b.m || 0) < 3) clearOfRoads(outer);
    const [cx, cz] = centroidOf(outer);
    if (excluded(cx, cz)) continue;
    if (area2(outer) < 0) outer.reverse();
    const holes = (b.ho || []).map(ringOf).filter(h => h.length >= 3).map(h => (area2(h) > 0 ? h.reverse() : h));
    const seed = hash1(b.id + 0.5);
    const style = b.s;
    const top = b.h;
    const base = b.m || 0;
    const ch = chunk(b.noPhys ? coarseKey(cx, cz) : chunkKey(cx, cz));
    // colours
    let wallHex = b.c;
    let palette = style === STYLE.glass ? PAL.glass : style === STYLE.office ? PAL.office : style === STYLE.resi ? PAL.resi : style === STYLE.hdb ? PAL.hdb : style === STYLE.shophouse ? PAL.shophouse : style === STYLE.civic ? PAL.civic : style === STYLE.industrial ? PAL.industrial : style === STYLE.parking ? PAL.parking : style === STYLE.station ? PAL.station : style === STYLE.canopy ? PAL.canopy : PAL.lowrise;
    if (wallHex == null || wallHex < 0) wallHex = pick(palette, seed);
    let wallCol = srgbToLin(c3(wallHex));
    if (style === STYLE.glass && b.c != null) wallCol = mixc(wallCol, srgbToLin(c3(pick(PAL.glass, seed))), 0.5);
    // accent colour packed into aF2.w as hue index for HDB/shophouse shutters, + 128 * building use (tools/building-uses.mjs:
    // only retail/unknown buildings get shopfronts and signboards; hospitals, schools, offices, hotels... get lobbies)
    const accent = Math.floor(hash1(b.id * 3.1) * 8) + 128 * (b.u || 0);
    // aF2.z: the block number from an OSM name like "Blk 5" (hospital entrance plaques), 0 when there is none
    const blkM = b.n && /^(?:Blk|Block)\s*(\d{1,3})\b/i.exec(b.n), blockNo = blkM ? +blkM[1] : 0;
    let roofShape = b.r || 0;
    let roofH = roofShape ? (b.rh || 2) : 0;
    if (style === STYLE.shophouse && !roofShape && top < 18 && seed < 0.85) { roofShape = 1; roofH = Math.min(3.2, 1.2 + seed * 2.5); }
    // shophouses: the OSM height usually includes the roof; keep the pitch modest and extend the walls so every floor shows
    let topAdj = top;
    if (style === STYLE.shophouse && roofShape) { roofH = Math.min(roofH, Math.max(1.4, (top - base) * 0.22)); topAdj = top + roofH * 0.6; }
    const area = Math.abs(area2(outer)) / 2;
    let floorH = style === STYLE.shophouse ? 3.9 : style === STYLE.glass ? 4.1 : style === STYLE.office ? 3.9 : style === STYLE.parking ? 3.0 : style === STYLE.hdb ? 2.85 : style === STYLE.civic ? 5.0 : 3.25;
    // (distant procedural outskirts skip the parapet: its inner faces are sub-pixel there, ~90k triangles)
    const flatParapet = !roofShape && top - base > 7 && style !== STYLE.canopy && style !== STYLE.station && !b.noPhys;
    const wallTop = roofShape ? Math.max(base + 1, topAdj - roofH) : top;
    if (style === STYLE.shophouse) floorH = Math.max(2.9, (wallTop - Math.max(base, 0)) / Math.max(1, Math.round(b.l || 2)));
    // tall towers get a hollow crown: the facade runs on past the roof slab (hides the plant, finishes the skyline)
    const crownH = flatParapet && (style === STYLE.glass || style === STYLE.office) && top > 90 && !b.noPhys ? Math.min(12, 2.5 + seed * 7 + (top - 90) * 0.02) : 0;
    const roofY = flatParapet ? top - Math.max(0.9, crownH) : wallTop;
    const y0 = base > 0.01 ? base : -0.4;
    const f1 = [style, seed, floorH, base];
    const gBase = Math.max(base, 0);

    // ---- per-edge facade flags, packed into aF2.w as accent + 16*flag (+ 128*use):
    // 1 shophouse front above the five-foot-way (signboard), 2 recessed shopfront, 3 HDB void-deck back wall,
    // 4 HDB common-corridor side, 5 HDB end wall (painted block number)
    const nE = outer.length, eFlag = new Array(nE).fill(0);
    const edgeN = i => { const p = outer[i], q = outer[(i + 1) % nE]; const ex = q[0] - p[0], ez = q[1] - p[1], len = Math.hypot(ex, ez) || 1; return [ez / len, -ex / len, len]; };
    let recess = null, H1 = 0;
    const isShop = style === STYLE.shophouse && !b.noPhys && base < 0.5 && wallTop - gBase > floorH * 1.7;
    const isHdb = style === STYLE.hdb;
    if (isShop) {
      // the edge facing the best street becomes the five-foot-way front
      let bi = -1, bs = 8.5;
      for (let i = 0; i < nE; i++) {
        const [nx, nz, len] = edgeN(i); if (len < 2.8 || len > 90) continue;
        const p = outer[i], q = outer[(i + 1) % nE];
        const sc = roadScore((p[0] + q[0]) / 2 + nx * 1.5, (p[1] + q[1]) / 2 + nz * 1.5);
        if (sc < bs) { bs = sc; bi = i; }
      }
      if (bi >= 0) {
        const D = new Array(nE).fill(0); D[bi] = 1.9 + seed * 0.5;
        const r2 = recessRing(outer, D);
        if (r2) { recess = { ring: r2, D, pw: 0.5, step: 5.2, first: true }; eFlag[bi] = 1; }
      }
    }
    let hdbO = null, hdbSlab = false;
    if (isHdb) {
      hdbO = obb(outer);
      hdbSlab = !!hdbO && hdbO.L > hdbO.Wd * 1.8;
      const corr = hash1(b.id * 5.3) < 0.5 ? 1 : -1;
      for (let i = 0; i < nE; i++) {
        const [nx, nz, len] = edgeN(i);
        if (!hdbO) break;
        const du = nx * hdbO.ux + nz * hdbO.uz, dv = nx * -hdbO.uz + nz * hdbO.ux;
        if (hdbSlab) { if (Math.abs(du) > 0.8 && len > 6 && len < 26) eFlag[i] = 5; else if (dv * corr > 0.8 && len > 16) eFlag[i] = 4; }
        else if (len > 10 && len < 34 && hash1(b.id + i * 1.7) < 0.5) eFlag[i] = 5;
      }
      if (!b.noPhys && base < 0.5 && top > 14 && !holes.length) {
        const r2 = recessRing(outer, new Array(nE).fill(2.1));
        if (r2) recess = { ring: r2, D: new Array(nE).fill(2.1), pw: 0.75, step: 6.5, first: false };
      }
    }
    if (recess) H1 = gBase + floorH;

    const OT = b.noPhys ? 'o.' : '';
    const addWalls = (ring, yA, yB, f1x, colour, inward = false, flags = null, tag = 'w.main') => {
      TAG = OT + tag;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        const ex = q[0] - p[0], ez = q[1] - p[1]; const len = Math.hypot(ex, ez); if (len < 0.05) continue;
        let nx = ez / len, nz = -ex / len;
        if (inward) { nx = -nx; nz = -nz; }
        const f2 = [len, wallTop, blockNo, accent + 16 * (flags ? flags[i] : 0)];
        const n = [nx, 0, nz];
        const a = ch.walls.vert({ position: [p[0], yA, p[1]], normal: n, color: colour, aWall: [0, yA], aF1: f1x, aF2: f2 });
        const bb = ch.walls.vert({ position: [q[0], yA, q[1]], normal: n, color: colour, aWall: [len, yA], aF1: f1x, aF2: f2 });
        const c = ch.walls.vert({ position: [q[0], yB, q[1]], normal: n, color: colour, aWall: [len, yB], aF1: f1x, aF2: f2 });
        const d = ch.walls.vert({ position: [p[0], yB, p[1]], normal: n, color: colour, aWall: [0, yB], aF1: f1x, aF2: f2 });
        if (!inward) { ch.walls.tri(a, c, bb); ch.walls.tri(a, d, c); }
        else { ch.walls.tri(a, bb, c); ch.walls.tri(a, c, d); }
        wallTris += 2;
        if (!inward && yB - yA > 1.5 && !b.noPhys) physQuad(ch, [p[0], Math.max(yA, -0.5), p[1]], [q[0], Math.max(yA, -0.5), q[1]], [q[0], yB, q[1]], [p[0], yB, p[1]]);
      }
    };
    // generic wall-material quad (winding chosen from the normal), uv = aWall
    const wQuad = (A, B, C, Dq, n, col, uvA, uvB, uvC, uvD, f1x, f2, g = ch.walls) => {
      const i0 = g.vert({ position: A, normal: n, color: col, aWall: uvA, aF1: f1x, aF2: f2 });
      const i1 = g.vert({ position: B, normal: n, color: col, aWall: uvB, aF1: f1x, aF2: f2 });
      const i2 = g.vert({ position: C, normal: n, color: col, aWall: uvC, aF1: f1x, aF2: f2 });
      const i3 = g.vert({ position: Dq, normal: n, color: col, aWall: uvD, aF1: f1x, aF2: f2 });
      const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
      if ((uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] >= 0) { g.tri(i0, i1, i2); g.tri(i0, i2, i3); }
      else { g.tri(i0, i2, i1); g.tri(i0, i3, i2); }
      wallTris += 2;
    };
    // square column (4 faces, wall material style 13) + its collider
    const pillar = (pcx, pcz, ux, uz, w, yA, yB, f2) => {
      const h = w / 2, vx = -uz, vz = ux, fP = [13, seed, floorH, base];
      const C = [[-h, -h], [h, -h], [h, h], [-h, h]].map(([a, q]) => [pcx + ux * a + vx * q, pcz + uz * a + vz * q]);
      for (let k = 0; k < 4; k++) {
        const P0 = C[k], Q0 = C[(k + 1) % 4];
        let nx = Q0[1] - P0[1], nz = -(Q0[0] - P0[0]); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
        if (nx * ((P0[0] + Q0[0]) / 2 - pcx) + nz * ((P0[1] + Q0[1]) / 2 - pcz) < 0) { nx = -nx; nz = -nz; }
        wQuad([P0[0], yA, P0[1]], [Q0[0], yA, Q0[1]], [Q0[0], yB, Q0[1]], [P0[0], yB, P0[1]], [nx, 0, nz], wallCol, [k * w, yA], [k * w + w, yA], [k * w + w, yB], [k * w, yB], fP, f2, ch.wallsNear);
        physQuad(ch, [P0[0], yA, P0[1]], [Q0[0], yA, Q0[1]], [Q0[0], yB, Q0[1]], [P0[0], yB, P0[1]]);
      }
    };

    if (recess) {
      // upper floors stand on the original outline; the ground floor steps back behind a colonnade
      addWalls(outer, H1, wallTop, f1, wallCol, false, eFlag);
      addWalls(recess.ring, y0, H1, f1, wallCol, false, recess.D.map((d, i) => d > 0 ? (isShop ? 2 : 3) : eFlag[i]), 'w.recess');
      const FLOOR_Y = 0.12;
      for (let i = 0; i < nE; i++) {
        if (!(recess.D[i] > 0)) continue;
        const j = (i + 1) % nE, p = outer[i], q = outer[j], p2 = recess.ring[i], q2 = recess.ring[j];
        const ex = q[0] - p[0], ez = q[1] - p[1], len = Math.hypot(ex, ez); if (len < 0.6) continue;
        const ux = ex / len, uz = ez / len, inx = -uz, inz = ux;
        const fl = isShop ? 2 : 3, f2 = [len, wallTop, blockNo, accent + 16 * fl];
        const uvOf = P => [(P[0] - p[0]) * ux + (P[1] - p[1]) * uz, (P[0] - p[0]) * inx + (P[1] - p[1]) * inz];
        // soffit (plaster ceiling with lamps), tiled floor raised one step, and the step's riser
        TAG = 'w.ffw';
        wQuad([p[0], H1, p[1]], [q[0], H1, q[1]], [q2[0], H1, q2[1]], [p2[0], H1, p2[1]], [0, -1, 0], wallCol, uvOf(p), uvOf(q), uvOf(q2), uvOf(p2), [12, seed, floorH, base], f2);
        if (gBase < 0.5) {
          const flCol = srgbToLin(c3(isShop ? 0xb9a58e : 0xb4b2ac));
          wQuad([p[0], FLOOR_Y, p[1]], [q[0], FLOOR_Y, q[1]], [q2[0], FLOOR_Y, q2[1]], [p2[0], FLOOR_Y, p2[1]], [0, 1, 0], flCol, uvOf(p), uvOf(q), uvOf(q2), uvOf(p2), [14, seed, floorH, base], f2, ch.wallsNear);
          wQuad([p[0], -0.3, p[1]], [q[0], -0.3, q[1]], [q[0], FLOOR_Y, q[1]], [p[0], FLOOR_Y, p[1]], [-inx, 0, -inz], flCol, [0, -0.3], [len, -0.3], [len, FLOOR_Y], [0, FLOOR_Y], [11, seed, floorH, base], f2, ch.wallsNear);
          physQuad(ch, [p[0], FLOOR_Y, p[1]], [q[0], FLOOR_Y, q[1]], [q2[0], FLOOR_Y, q2[1]], [p2[0], FLOOR_Y, p2[1]]);
          physQuad(ch, [p[0], -0.3, p[1]], [q[0], -0.3, q[1]], [q[0], FLOOR_Y, q[1]], [p[0], FLOOR_Y, p[1]]);
        }
        const pw = recess.pw, nP = Math.max(2, Math.round(len / recess.step) + 1); TAG = 'w.pillar';
        for (let k = recess.first ? 0 : 1; k < nP; k++) {
          const t = pw / 2 + 0.02 + (len - pw - 0.04) * k / (nP - 1);
          pillar(p[0] + ux * t + inx * (pw / 2 + 0.03), p[1] + uz * t + inz * (pw / 2 + 0.03), ux, uz, pw, y0, H1, f2);
        }
      }
    } else addWalls(outer, y0, wallTop, f1, wallCol, false, eFlag);
    for (const h of holes) addWalls(h, y0, wallTop, f1, wallCol, false, null, 'w.hole');
    if (flatParapet) {
      const pf = [STYLE.plain, seed, floorH, base];
      addWalls(outer, roofY, top, pf, wallCol, true, null, 'w.parapet');
    }
    TAG = OT + 'r.main';
    // roof colour
    let roofHex = b.rc;
    if (roofHex == null || roofHex < 0) {
      // weathered Marseille/clay tiles in many shades, the odd re-roofed grey one
      if (roofShape && (style === STYLE.shophouse || style === STYLE.civic || style === STYLE.lowrise)) roofHex = seed < 0.88 ? pick(ROOF_CLAY, hash1(b.id * 2.3)) : ROOF_DEFAULT.dark;
      else if (roofShape) roofHex = ROOF_DEFAULT.dark;
      else roofHex = ROOF_DEFAULT.flat;
    }
    let roofCol = srgbToLin(c3(roofHex));
    // OSM roof:colour "red" etc. reads as plastic: pull pitched heritage roofs towards weathered clay
    if (roofShape && b.rc != null && b.rc >= 0) {
      const rc = c3(b.rc), sat = Math.max(...rc) - Math.min(...rc);
      if (style === STYLE.shophouse || style === STYLE.civic || style === STYLE.lowrise || sat > 0.45) roofCol = mixc(roofCol, srgbToLin(c3(pick(ROOF_CLAY, hash1(b.id * 2.3)))), 0.75);
    }
    const rv = 0.85 + hash1(b.id * 7.7) * 0.3; roofCol = roofCol.map(v => v * rv);
    const roofAttr = [style, seed, roofShape ? 1 : 0, 0];

    // flat roof / cap (also used under pitched roofs as base)
    const addFlat = (ringO, ringsH, y, down = false) => {
      const flat = [], holeIdx = [];
      for (const p of ringO) flat.push(p[0], p[1]);
      for (const h of ringsH) { holeIdx.push(flat.length / 2); for (const p of h) flat.push(p[0], p[1]); }
      const tris = earcut(flat, holeIdx.length ? holeIdx : undefined);
      const baseV = ch.roofs.vc;
      const ny = down ? -1 : 1;
      for (let i = 0; i < flat.length; i += 2) ch.roofs.vert({ position: [flat[i], y, flat[i + 1]], normal: [0, ny, 0], color: roofCol, aRoof: roofAttr });
      for (let t = 0; t < tris.length; t += 3) {
        const ia = tris[t], ib = tris[t + 1], ic = tris[t + 2];
        const a2 = (flat[ib * 2] - flat[ia * 2]) * (flat[ic * 2 + 1] - flat[ia * 2 + 1]) - (flat[ic * 2] - flat[ia * 2]) * (flat[ib * 2 + 1] - flat[ia * 2 + 1]);
        // up-facing triangles need negative signed area in (x,z)
        const flip = down ? a2 < 0 : a2 > 0;
        if (flip) ch.roofs.tri(baseV + ia, baseV + ic, baseV + ib); else ch.roofs.tri(baseV + ia, baseV + ib, baseV + ic);
        if (!down && !b.noPhys) physTri(ch, [flat[ia * 2], y, flat[ia * 2 + 1]], [flat[ib * 2], y, flat[ib * 2 + 1]], [flat[ic * 2], y, flat[ic * 2 + 1]]);
        roofTris++;
      }
    };
    const roofTri = (a, bb, c, colour = roofCol) => {
      // computes face normal, ensures it points up/outward
      let ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      let A = a, B = bb, C = c;
      if (ny < 0) { B = c; C = bb; nx = -nx; ny = -ny; nz = -nz; }
      const i0 = ch.roofs.vert({ position: A, normal: [nx, ny, nz], color: colour, aRoof: roofAttr });
      const i1 = ch.roofs.vert({ position: B, normal: [nx, ny, nz], color: colour, aRoof: roofAttr });
      const i2 = ch.roofs.vert({ position: C, normal: [nx, ny, nz], color: colour, aRoof: roofAttr });
      ch.roofs.tri(i0, i1, i2); roofTris++;
    };
    const gableEnd = (a, bb, c) => {
      // vertical triangle in wall material (plain)
      const pt = TAG; TAG = 'w.gable';
      let nx = (bb[2] - a[2]), nz = -(bb[0] - a[0]); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
      const f2 = [1, top, 1, accent], pf = [STYLE.plain, seed, floorH, base];
      const i0 = ch.walls.vert({ position: a, normal: [nx, 0, nz], color: wallCol, aWall: [0, a[1]], aF1: pf, aF2: f2 });
      const i1 = ch.walls.vert({ position: bb, normal: [nx, 0, nz], color: wallCol, aWall: [1, bb[1]], aF1: pf, aF2: f2 });
      const i2 = ch.walls.vert({ position: c, normal: [nx, 0, nz], color: wallCol, aWall: [0.5, c[1]], aF1: pf, aF2: f2 });
      ch.walls.tri(i0, i2, i1); ch.walls.tri(i0, i1, i2); // double sided (cheap; orientation-agnostic)
      TAG = pt;
    };

    let roofDone = false;
    if (roofShape === 1 || roofShape === 2) {
      const o = obb(outer);
      // shophouse roofs pitch front-to-back: ridge parallel to the street front (across the narrow plot)
      if (o && style === STYLE.shophouse) {
        const fi = eFlag.indexOf(1);
        let alongShort = o.L > o.Wd * 1.4 && o.Wd < 10;
        if (fi >= 0) { const p = outer[fi], q = outer[(fi + 1) % nE]; const fx = q[0] - p[0], fz = q[1] - p[1], fl = Math.hypot(fx, fz) || 1; alongShort = Math.abs((fx * o.ux + fz * o.uz) / fl) < 0.5; }
        if (alongShort) { const ux0 = o.ux; o.ux = -o.uz; o.uz = ux0; [o.L, o.Wd] = [o.Wd, o.L]; }
      }
      if (o && o.area > 0 && area / o.area > 0.78 && o.Wd > 2) {
        const ov = 0.35; // eave overhang
        const L = o.L / 2 + ov, Wh = o.Wd / 2 + ov;
        const ux = o.ux, uz = o.uz, vx = -uz, vz = ux;
        const P = (a, bq, y) => [o.cx + ux * a + vx * bq, y, o.cz + uz * a + vz * bq];
        const ridgeIn = roofShape === 2 ? Math.min(Wh, L * 0.9) : 0;
        const e = wallTop, r = topAdj;
        const c1 = P(-L, -Wh, e), c2 = P(L, -Wh, e), c3 = P(L, Wh, e), c4 = P(-L, Wh, e);
        const r1 = P(-L + ridgeIn, 0, r), r2 = P(L - ridgeIn, 0, r);
        roofTri(c1, c2, r2); roofTri(c1, r2, r1);
        roofTri(c3, c4, r1); roofTri(c3, r1, r2);
        if (roofShape === 2) { roofTri(c2, c3, r2); roofTri(c4, c1, r1); }
        else { gableEnd(P(L - ov, -Wh + ov, e), P(L - ov, Wh - ov, e), P(L - ov, 0, r)); gableEnd(P(-L + ov, Wh - ov, e), P(-L + ov, -Wh + ov, e), P(-L + ov, 0, r)); }
        addFlat(outer, holes, e - 0.01, false);
        roofDone = true;
      } else roofShape = outer.length <= 12 ? 3 : 0;
    }
    if (!roofDone && roofShape === 3 && !holes.length) {
      const apex = [cx, topAdj, cz];
      for (let i = 0; i < outer.length; i++) { const p = outer[i], q = outer[(i + 1) % outer.length]; roofTri([p[0], wallTop, p[1]], [q[0], wallTop, q[1]], apex); }
      roofDone = true;
    }
    if (!roofDone && (roofShape === 4 || roofShape === 5) && !holes.length) {
      const N = 7; let prev = outer.map(p => [p[0], wallTop, p[1]]);
      for (let k = 1; k <= N; k++) {
        const th = (k / N) * Math.PI / 2; const s = Math.cos(th), y = wallTop + roofH * Math.sin(th);
        const cur = outer.map(p => [cx + (p[0] - cx) * s, y, cz + (p[1] - cz) * s]);
        for (let i = 0; i < outer.length; i++) {
          const j = (i + 1) % outer.length;
          // smooth-ish normals: radial direction blended with up
          const quad = [prev[i], prev[j], cur[j], cur[i]];
          roofTri(quad[0], quad[1], quad[2]); if (k < N) roofTri(quad[0], quad[2], quad[3]);
        }
        prev = cur;
      }
      roofDone = true;
    }
    TAG = OT + 'r.main';
    if (!roofDone) addFlat(outer, holes, roofY);
    if (base > 0.5) addFlat(outer, holes, base, true);

    // ---- rooftops: lift-motor room, plant (AC condensers, water tanks, cooling towers), antenna masts, and
    // flat "decal" quads in the roof material: 20 helipad, 21 pool, 22 roof garden, 23 solar array (uv in aRoof.zw)
    const flatTop = !roofShape && style !== STYLE.canopy && style !== STYLE.parking && style !== STYLE.station;
    const ro = flatTop && top > 9 && area > 120 ? obb(outer) : null;
    if (ro && pip(ro.cx, ro.cz, outer)) {
      const ux = ro.ux, uz = ro.uz, vx = -uz, vz = ux;
      const P = (a, q) => [ro.cx + ux * a + vx * q, ro.cz + uz * a + vz * q];
      const inside = (a, q, ha, hq) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([sa, sq]) => { const [x, z] = P(a + sa * ha, q + sq * hq); return pip(x, z, outer); });
      const lrand = (k) => hash1(b.id * 13.1 + k * 7.7);
      const S = ch.struct;
      // lift-motor room on mid/high-rise roofs (wall material so it gets the facade weathering)
      if (top > 28 && area > 300 && (!b.noPhys || seed < 0.4)) {
        TAG = OT + 'liftroom';
        const L = Math.min(ro.L * (0.25 + seed * 0.2), 16) / 2, Wd = Math.min(ro.Wd * 0.3, 9) / 2, hh = 3 + seed * 2.5;
        let box = [P(-L, -Wd), P(L, -Wd), P(L, Wd), P(-L, Wd)];
        if (area2(box) < 0) box.reverse();
        const pf = [STYLE.plain, seed, 3, roofY];
        const col = isHdb ? wallCol : srgbToLin(c3(pick(PAL.lowrise, seed * 3.3)));
        for (let i = 0; i < 4; i++) {
          const p = box[i], q = box[(i + 1) % 4]; const ex = q[0] - p[0], ez = q[1] - p[1], len = Math.hypot(ex, ez); const n = [ez / len, 0, -ex / len];
          wQuad([p[0], roofY, p[1]], [q[0], roofY, q[1]], [q[0], roofY + hh, q[1]], [p[0], roofY + hh, p[1]], n, col, [0, roofY], [len, roofY], [len, roofY + hh], [0, roofY + hh], pf, [len, roofY + hh, 1, accent]);
        }
        const rc = srgbToLin(c3(0x8c8a85));
        const i0 = ch.roofs.vert({ position: [box[0][0], roofY + hh, box[0][1]], normal: [0, 1, 0], color: rc, aRoof: roofAttr });
        const i1 = ch.roofs.vert({ position: [box[1][0], roofY + hh, box[1][1]], normal: [0, 1, 0], color: rc, aRoof: roofAttr });
        const i2 = ch.roofs.vert({ position: [box[2][0], roofY + hh, box[2][1]], normal: [0, 1, 0], color: rc, aRoof: roofAttr });
        const i3 = ch.roofs.vert({ position: [box[3][0], roofY + hh, box[3][1]], normal: [0, 1, 0], color: rc, aRoof: roofAttr });
        ch.roofs.tri(i0, i2, i1); ch.roofs.tri(i0, i3, i2);
        // HDB: big painted water tank on the lift room roof
        if (isHdb && !b.noPhys) { const [tx, tz] = P(L * 0.3, 0); boxGeo(S, tx, roofY + hh, tz, Math.min(L, 2.6), 2.2, Math.min(Wd, 1.8), srgbToLin(c3(0xbfc3c4))); }
      }
      // decal quad helper (in the roof material, 6 cm above the slab)
      const decal = (kind, a, q, ha, hq, rot = 0) => {
        TAG = OT + 'r.decal';
        const y = roofY + 0.06, col = roofCol;
        const cs = Math.cos(rot), sn = Math.sin(rot);
        const corner = (sa, sq) => { const la = sa * ha * cs - sq * hq * sn, lq = sa * ha * sn + sq * hq * cs; return P(a + la, q + lq); };
        const pts = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
        const ids = pts.map((pt, k) => ch.roofs.vert({ position: [pt[0], y, pt[1]], normal: [0, 1, 0], color: col, aRoof: [kind, seed, uvs[k][0], uvs[k][1]] }));
        // up-facing: pick winding from the signed area in (x,z)
        const a2 = (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[2][0] - pts[0][0]) * (pts[1][1] - pts[0][1]);
        if (a2 > 0) { ch.roofs.tri(ids[0], ids[2], ids[1]); ch.roofs.tri(ids[0], ids[3], ids[2]); } else { ch.roofs.tri(ids[0], ids[1], ids[2]); ch.roofs.tri(ids[0], ids[2], ids[3]); }
        roofTris += 2;
      };
      const r0 = b.noPhys ? -1 : lrand(1); // no roof decals on the distant outskirts
      if (r0 < 0) { /* outskirts */ }
      else if ((style === STYLE.glass || style === STYLE.office) && top > 150 && ro.L > 26 && ro.Wd > 24 && inside(0, 0, 10, 10)) decal(20, 0, 0, 10, 10);
      else if (style === STYLE.resi && top > 30 && r0 < 0.45 && ro.L > 24 && ro.Wd > 14 && inside(0, 0, Math.min(14, ro.L * 0.3), Math.min(5, ro.Wd * 0.2))) decal(21, 0, 0, Math.min(14, ro.L * 0.3), Math.min(5, ro.Wd * 0.2));
      else if (isHdb && ro.L > 16 && ro.Wd > 9) { // SolarNova: PV arrays on HDB roofs
        const ha = ro.L * 0.42, hq = ro.Wd * 0.36;
        if (inside(0, 0, ha, hq)) decal(23, 0, 0, ha, hq); else if (inside(0, 0, ha * 0.6, hq * 0.6)) decal(23, 0, 0, ha * 0.6, hq * 0.6);
      } else if ((style === STYLE.office || style === STYLE.civic || style === STYLE.resi || style === STYLE.glass) && r0 > 0.82 && top < 140 && ro.L > 18 && ro.Wd > 14 && inside(0, 0, ro.L * 0.3, ro.Wd * 0.3)) decal(22, 0, 0, ro.L * 0.3, ro.Wd * 0.3);
      else if ((style === STYLE.industrial || style === STYLE.lowrise) && r0 < 0.3 && ro.L > 12 && ro.Wd > 8 && inside(0, 0, ro.L * 0.38, ro.Wd * 0.34)) decal(23, 0, 0, ro.L * 0.38, ro.Wd * 0.34);
      // plant: condensers / tanks / cooling towers scattered on the slab (struct boxes, merged per chunk)
      TAG = OT + 's.plant';
      if (!b.noPhys && !isHdb && top > 12) {
        const nBox = Math.min(7, Math.floor(area / 260) + (style === STYLE.office || style === STYLE.glass ? 2 : 0));
        for (let k = 0; k < nBox; k++) {
          const a = (lrand(k + 10) - 0.5) * ro.L * 0.8, q = (lrand(k + 20) - 0.5) * ro.Wd * 0.8;
          const big = lrand(k + 30) < 0.25;
          const ha = big ? 1.8 + lrand(k + 40) * 1.5 : 0.6 + lrand(k + 40) * 0.6, hq = big ? 1.4 + lrand(k + 50) : 0.5 + lrand(k + 50) * 0.4;
          if (!inside(a, q, ha + 0.6, hq + 0.6)) continue;
          const [x, z] = P(a, q);
          const kind = lrand(k + 60);
          const col = srgbToLin(c3(kind < 0.45 ? 0xd2d4d2 : kind < 0.7 ? 0x9da4a8 : kind < 0.85 ? 0x6f7a80 : 0x5a7d9a));
          boxGeo(S, x, roofY, z, ha, (big ? 2.2 : 0.9) + lrand(k + 70) * 0.8, hq, col);
        }
      }
      // antenna masts / lightning spires on the tallest towers
      if (top > 160 && !b.noPhys && seed > 0.35) {
        TAG = 's.mast';
        const h = 8 + seed * 14, [x, z] = P(ro.L * 0.15, 0);
        boxGeo(S, x, roofY, z, 0.25, h + (top - roofY), 0.25, srgbToLin(c3(0xb0b4b8)));
        boxGeo(S, x, roofY, z, 0.9, 1.2, 0.9, srgbToLin(c3(0x8a8f94)));
      }
    }
    // ---- HDB laundry poles (bamboo/steel poles out of service-yard windows, some with washing)
    if (isHdb && !b.noPhys && hdbO && (b.l || 0) > 3) {
      TAG = 's.laundry';
      const S = ch.structNear, levels = Math.min(b.l, 25), wh = floorH;
      const CLOTH = [0xe23b3b, 0x2f6fd6, 0xf2f2ee, 0xf2c230, 0x3ca55c, 0xe87ab0, 0x222222, 0x8a5cc8, 0xff8a3d].map(h => srgbToLin(c3(h)));
      const poleCol = srgbToLin(c3(0xb8bcbf));
      for (let i = 0; i < nE; i++) {
        if (eFlag[i] === 4 || eFlag[i] === 5) continue;
        const [nx, nz, len] = edgeN(i); if (len < 10) continue;
        const p = outer[i], ux = (outer[(i + 1) % nE][0] - p[0]) / len, uz = (outer[(i + 1) % nE][1] - p[1]) / len;
        const nCols = Math.max(1, Math.floor(len / 3.0 + 0.5)), cw = len / nCols;
        for (let f = 1; f < levels; f++) for (let c = 0; c < nCols; c++) {
          const hr = hash1(b.id * 3.7 + f * 31.3 + c * 7.1 + i * 101.9);
          if (hr > 0.085) continue;
          const u = (c + 0.5) * cw, y = gBase + f * wh + wh * 0.72;
          const bx = p[0] + ux * u, bz = p[1] + uz * u;
          // pole sticks straight out 1.6 m; three thin quads (cheap prism)
          const L = 1.6, ex = bx + nx * L, ez = bz + nz * L, t = 0.035;
          quadGeo(S, [bx, y - t, bz], [ex, y - t, ez], [ex, y + t, ez], [bx, y + t, bz], [ux, 0, uz], poleCol, true);
          quadGeo(S, [bx - ux * t, y + t, bz - uz * t], [ex - ux * t, y + t, ez - uz * t], [ex + ux * t, y + t, ez + uz * t], [bx + ux * t, y + t, bz + uz * t], [0, 1, 0], poleCol);
          // washing: 1-3 garments hanging below the pole
          if (hr < 0.06) {
            const nG = 1 + Math.floor(hash1(hr * 999) * 3);
            for (let g = 0; g < nG; g++) {
              const s0 = 0.25 + g * 0.45, s1 = s0 + 0.32 + hash1(hr * 77 + g) * 0.1, drop = 0.45 + hash1(hr * 55 + g) * 0.45;
              const col = CLOTH[Math.floor(hash1(hr * 333 + g * 9) * CLOTH.length)];
              const ax = bx + nx * s0, az = bz + nz * s0, cx2 = bx + nx * s1, cz2 = bz + nz * s1;
              quadGeo(S, [ax, y - drop, az], [cx2, y - drop, cz2], [cx2, y - t, cz2], [ax, y - t, az], [ux, 0, uz], col, true);
            }
          }
        }
      }
    }
    if (base < 3 && !b.noPhys) occFillRing(outer, 255);
    if (!b.noPhys) buildingInfo.push(b.id, cx, cz, top, style);
    nb++;
    if (nb % 1500 === 0) progress(0.1 + 0.35 * Math.min(1, nb / (city.buildings.length + outskirts.length)), 'Raising the skyline');
  }

  // ================= ROADS =================
  console.log(`[city] ${kerbPushed} building footprint vertices pushed out of carriageways to the kerb line`);
  progress(0.5, 'Paving the roads');
  TAG = 'roads';
  const kp = (x, z) => `${x.toFixed(1)},${z.toFixed(1)}`;
  const use = new Map(), halfW = new Map();
  const roads = city.roads;
  for (const r of roads) {
    if (r.c >= 8) continue;
    const n = r.p.length / 2;
    for (let i = 0; i < n; i++) {
      const k = kp(r.p[i * 2], r.p[i * 2 + 1]);
      use.set(k, (use.get(k) || 0) + ((i === 0 || i === n - 1) ? 1 : 2));
      halfW.set(k, Math.max(halfW.get(k) || 0, r.w / 2));
    }
  }
  const isJunction = k => (use.get(k) || 0) > 2;
  const juncR = k => (halfW.get(k) || 3) + 1.2;

  const ribbon = (r, geo, opts) => {
    const n = r.p.length / 2;
    const P = []; for (let i = 0; i < n; i++) P.push([r.p[i * 2], r.p[i * 2 + 1]]);
    const Y = r.y || null;
    const hw = r.w / 2;
    // cumulative length
    const S = [0]; for (let i = 1; i < n; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    // junction distances
    const jIdx = [];
    for (let i = 0; i < n; i++) { const k = kp(P[i][0], P[i][1]); if (opts.junctions && isJunction(k)) jIdx.push(i); }
    const distBehind = new Array(n).fill(1e4), distAhead = new Array(n).fill(1e4), rBehind = new Array(n).fill(0), rAhead = new Array(n).fill(0);
    let last = -1;
    for (let i = 0; i < n; i++) { if (jIdx.includes(i)) last = i; if (last >= 0) { distBehind[i] = S[i] - S[last]; rBehind[i] = juncR(kp(P[last][0], P[last][1])); } }
    last = -1;
    for (let i = n - 1; i >= 0; i--) { if (jIdx.includes(i)) last = i; if (last >= 0) { distAhead[i] = S[last] - S[i]; rAhead[i] = juncR(kp(P[last][0], P[last][1])); } }
    // per-vertex offset directions (miter)
    const base0 = geo.vc;
    for (let i = 0; i < n; i++) {
      let dx0 = 0, dz0 = 0, dx1 = 0, dz1 = 0;
      if (i > 0) { dx0 = P[i][0] - P[i - 1][0]; dz0 = P[i][1] - P[i - 1][1]; const l = Math.hypot(dx0, dz0) || 1; dx0 /= l; dz0 /= l; }
      if (i < n - 1) { dx1 = P[i + 1][0] - P[i][0]; dz1 = P[i + 1][1] - P[i][1]; const l = Math.hypot(dx1, dz1) || 1; dx1 /= l; dz1 /= l; }
      if (i === 0) { dx0 = dx1; dz0 = dz1; } if (i === n - 1) { dx1 = dx0; dz1 = dz0; }
      let tx = dx0 + dx1, tz = dz0 + dz1; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      // right vector = (-tz, tx)
      let rx = -tz, rz = tx;
      const cosHalf = Math.max(0.35, rx * (-dz1) + rz * dx1);
      const m = 1 / cosHalf;
      const y = (Y ? Y[i] : 0) + opts.y;
      // slope normal
      let ny = 1, nx = 0, nz = 0;
      if (Y) { const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1); const ds = S[i1] - S[i0]; if (ds > 0) { const g = (Y[i1] - Y[i0]) / ds; nx = -tx * g; nz = -tz * g; const l = Math.hypot(nx, 1, nz); nx /= l; ny = 1 / l; nz /= l; } }
      const lanes = [r.lf || 0, r.lb || 0, r.c, r.o ? 1 : 0];
      const junc = [distBehind[i], distAhead[i], rBehind[i], rAhead[i]];
      geo.vert({ position: [P[i][0] - rx * hw * m, y, P[i][1] - rz * hw * m], normal: [nx, ny, nz], aRoad: [-hw, S[i], r.w, opts.kind], aLanes: lanes, aJunc: junc });
      geo.vert({ position: [P[i][0] + rx * hw * m, y, P[i][1] + rz * hw * m], normal: [nx, ny, nz], aRoad: [hw, S[i], r.w, opts.kind], aLanes: lanes, aJunc: junc });
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base0 + i * 2, b = a + 1, c = a + 2, d = a + 3; // a=left_i b=right_i c=left_i+1 d=right_i+1
      // up-facing: (a, b, d) & (a, d, c)? verify orientation via signed area
      geo.tri(a, b, c); geo.tri(b, d, c);
    }
    return { P, S, Y, hw };
  };

  const elevatedParts = []; // for physics & structure
  for (const r of roads) {
    const n = r.p.length / 2; if (n < 2) continue;
    if (r.n && /^(The Helix|OCBC Skyway)$/i.test(r.n)) continue; // replaced by hand-built landmarks
    // chunk by midpoint
    const mi = Math.floor(n / 2);
    const ch = chunk(chunkKey(r.p[mi * 2], r.p[mi * 2 + 1]));
    const isDrive = r.c < 8;
    const geo = isDrive ? ch.roads : ch.foot;
    // render order heights: major roads on top
    const yOff = isDrive ? 0.05 + (7 - Math.min(7, r.c)) * 0.004 : (r.x ? 0.072 : 0.03);
    const kind = isDrive ? 0 : (r.x ? 2 : (r.st ? 3 : 1));
    const info = ribbon(r, geo, { y: yOff, junctions: isDrive, kind });
    if (isDrive && !r.b) occStroke(info.P, r.w / 2 + 0.8, 200);
    if (r.b && r.y) elevatedParts.push({ r, info, ch, isDrive });
    // covered walkway canopy
    TAG = 'roads';
    if (!isDrive && r.cv && !r.b && r.c === 9) {
      TAG = 's.walkway';
      const P = info.P; const hw = 1.6, yC = 3.0;
      const colR = srgbToLin(c3(0x7d8a8f)), colP = srgbToLin(c3(0x9aa3a6));
      for (let i = 0; i < P.length - 1; i++) {
        const [ax, az] = P[i], [bx, bz] = P[i + 1]; const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz); if (l < 0.5) continue;
        const rx = -dz / l * hw, rz = dx / l * hw;
        const s = ch.struct;
        const v0 = s.vert({ position: [ax - rx, yC, az - rz], normal: [0, 1, 0], color: colR }), v1 = s.vert({ position: [ax + rx, yC, az + rz], normal: [0, 1, 0], color: colR });
        const v2 = s.vert({ position: [bx - rx, yC, bz - rz], normal: [0, 1, 0], color: colR }), v3 = s.vert({ position: [bx + rx, yC, bz + rz], normal: [0, 1, 0], color: colR });
        s.tri(v0, v2, v1); s.tri(v1, v2, v3);
        const w0 = s.vert({ position: [ax - rx, yC, az - rz], normal: [0, -1, 0], color: colR }), w1 = s.vert({ position: [ax + rx, yC, az + rz], normal: [0, -1, 0], color: colR });
        const w2 = s.vert({ position: [bx - rx, yC, bz - rz], normal: [0, -1, 0], color: colR }), w3 = s.vert({ position: [bx + rx, yC, bz + rz], normal: [0, -1, 0], color: colR });
        s.tri(w0, w1, w2); s.tri(w1, w3, w2);
        // posts every ~6 m on one side
        const np = Math.floor(l / 6);
        for (let k = 0; k <= np; k++) {
          const f = np ? k / np : 0; const px = ax + dx * f + rx * 0.9, pz = az + dz * f + rz * 0.9;
          boxGeo(ch.structNear, px, 0, pz, 0.08, yC, 0.08, colP, false);
        }
      }
    }
  }
  // junction discs
  TAG = 'roads';
  const juncDone = new Set();
  for (const r of roads) {
    if (r.c >= 8 || r.b) continue;
    const n = r.p.length / 2;
    for (let i = 0; i < n; i++) {
      const x = r.p[i * 2], z = r.p[i * 2 + 1]; const k = kp(x, z);
      if (!isJunction(k) || juncDone.has(k)) continue; juncDone.add(k);
      const rad = (halfW.get(k) || 3) * 1.05; const ch = chunk(chunkKey(x, z)); const g = ch.roads;
      const SEG = 16; const c0 = g.vert({ position: [x, 0.048, z], normal: [0, 1, 0], aRoad: [0, 0, rad * 2, 4], aLanes: [0, 0, 5, 0], aJunc: [0, 0, 99, 99] });
      for (let s = 0; s < SEG; s++) { const a = s / SEG * Math.PI * 2; g.vert({ position: [x + Math.cos(a) * rad, 0.048, z + Math.sin(a) * rad], normal: [0, 1, 0], aRoad: [0, 0, rad * 2, 4], aLanes: [0, 0, 5, 0], aJunc: [0, 0, 99, 99] }); }
      for (let s = 0; s < SEG; s++) g.tri(c0, c0 + 1 + ((s + 1) % SEG), c0 + 1 + s);
    }
  }
  // bridge structure: deck sides, parapets, pillars + physics decks
  TAG = 's.bridge';
  const concrete = srgbToLin(c3(0xb9b6ae)), concreteDark = srgbToLin(c3(0x8d8a83));
  for (const { r, info, ch, isDrive } of elevatedParts) {
    const { P, Y, hw } = info; const s = ch.struct;
    const maxY = Math.max(...Y);
    const thick = isDrive ? 1.1 : 0.5, parH = isDrive ? 0.95 : 1.1;
    let lastPillar = -1e9, S = 0;
    for (let i = 0; i < P.length - 1; i++) {
      const [ax, az] = P[i], [bx, bz] = P[i + 1]; const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz); if (l < 0.05) continue;
      const rx = -dz / l, rz = dx / l; const ya = Y[i] + 0.05, yb = Y[i + 1] + 0.05;
      const bottomA = Math.max(maxY > 2.5 ? ya - thick : -1.6, -1.6), bottomB = Math.max(maxY > 2.5 ? yb - thick : -1.6, -1.6);
      for (const side of [-1, 1]) {
        const ox = rx * hw * side, oz = rz * hw * side;
        // outer side face
        quadGeo(s, [ax + ox, bottomA, az + oz], [bx + ox, bottomB, bz + oz], [bx + ox, yb + parH, bz + oz], [ax + ox, ya + parH, az + oz], [rx * side, 0, rz * side], concrete);
        // inner parapet face
        const ix = rx * (hw - 0.3) * side, iz = rz * (hw - 0.3) * side;
        quadGeo(s, [bx + ix, yb, bz + iz], [ax + ix, ya, az + iz], [ax + ix, ya + parH, az + iz], [bx + ix, yb + parH, bz + iz], [-rx * side, 0, -rz * side], concrete);
        // parapet top
        quadGeo(s, [ax + ix, ya + parH, az + iz], [bx + ix, yb + parH, bz + iz], [bx + ox, yb + parH, bz + oz], [ax + ox, ya + parH, az + oz], [0, 1, 0], concrete);
        // physics: parapet walls
        physQuad(ch, [ax + ix, ya, az + iz], [bx + ix, yb, bz + iz], [bx + ix, yb + parH + 0.4, bz + iz], [ax + ix, ya + parH + 0.4, az + iz]);
      }
      // underside
      if (maxY > 2.5) quadGeo(s, [ax + rx * hw, ya - thick, az + rz * hw], [bx + rx * hw, yb - thick, bz + rz * hw], [bx - rx * hw, yb - thick, bz - rz * hw], [ax - rx * hw, ya - thick, az - rz * hw], [0, -1, 0], concreteDark);
      // physics: deck
      physQuad(ch, [ax - rx * hw, ya, az - rz * hw], [ax + rx * hw, ya, az + rz * hw], [bx + rx * hw, yb, bz + rz * hw], [bx - rx * hw, yb, bz - rz * hw]);
      // pillars
      for (let d = 0; d < l; d += 2) {
        const sAt = S + d; const yy = ya + (yb - ya) * (d / l);
        if (yy > 3.5 && sAt - lastPillar > 32) {
          lastPillar = sAt; const px = ax + dx * d / l, pz = az + dz * d / l;
          if (isDrive) { boxGeo(s, px - rx * hw * 0.45, -1.6, pz - rz * hw * 0.45, 0.7, yy - thick + 1.6, 0.7, concrete); if (hw > 6) boxGeo(s, px + rx * hw * 0.45, -1.6, pz + rz * hw * 0.45, 0.7, yy - thick + 1.6, 0.7, concrete); }
          else boxGeo(s, px, -1.6, pz, 0.25, yy - thick + 1.6, 0.25, concrete);
        }
      }
      S += l;
    }
  }

  // ================= SEAWALLS (marching squares on land mask) =================
  progress(0.7, 'Filling Marina Bay');
  const TH = 160;
  const wallCol = srgbToLin(c3(0xa49d90));
  const segs = [];
  for (let j = 0; j < mask.h - 1; j++) {
    for (let i = 0; i < mask.w - 1; i++) {
      const v00 = mask.data[(j * mask.w + i) * 4], v10 = mask.data[(j * mask.w + i + 1) * 4], v01 = mask.data[((j + 1) * mask.w + i) * 4], v11 = mask.data[((j + 1) * mask.w + i + 1) * 4];
      const c = (v00 > TH ? 1 : 0) | (v10 > TH ? 2 : 0) | (v11 > TH ? 4 : 0) | (v01 > TH ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const X = k => M.xmin + (k + 0.5) * res, Z = k => M.zmin + (k + 0.5) * res;
      const lerp = (a, b) => (TH - a) / (b - a);
      const top = [X(i + lerp(v00, v10)), Z(j)], right = [X(i + 1), Z(j + lerp(v10, v11))], bottom = [X(i + lerp(v01, v11)), Z(j + 1)], left = [X(i), Z(j + lerp(v00, v01))];
      const L = { 1: [[left, top]], 2: [[top, right]], 3: [[left, right]], 4: [[right, bottom]], 5: [[left, top], [right, bottom]], 6: [[top, bottom]], 7: [[left, bottom]], 8: [[bottom, left]], 9: [[bottom, top]], 10: [[top, right], [bottom, left]], 11: [[bottom, right]], 12: [[right, left]], 13: [[right, top]], 14: [[top, left]] }[c];
      for (const s of L) segs.push(s);
    }
  }
  TAG = 's.seawall';
  // chain the 2 m marching-squares segments into polylines and simplify them (Douglas-Peucker, 0.5 m): straight
  // quays become a few long quads instead of hundreds; one face, towards the water (the land side is buried)
  const sk = p => p[0].toFixed(3) + ',' + p[1].toFixed(3);
  const ends = new Map(); const usedS = new Uint8Array(segs.length);
  segs.forEach(([a, b], i) => { for (const p of [a, b]) { const k = sk(p); let l = ends.get(k); if (!l) ends.set(k, l = []); l.push(i); } });
  const nextSeg = (p, from) => { const l = ends.get(sk(p)); if (l) for (const i of l) if (!usedS[i] && i !== from) return i; return -1; };
  const simplify = (pts, tol) => {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [i0, i1] = stack.pop(); const [ax, az] = pts[i0], [bx, bz] = pts[i1]; const vx = bx - ax, vz = bz - az, L = Math.hypot(vx, vz) || 1e-9;
      let best = -1, bd = tol;
      for (let i = i0 + 1; i < i1; i++) { const d = Math.abs((pts[i][0] - ax) * vz - (pts[i][1] - az) * vx) / L; if (d > bd) { bd = d; best = i; } }
      if (best > 0) { keep[best] = 1; stack.push([i0, best], [best, i1]); }
    }
    return pts.filter((_, i) => keep[i]);
  };
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (usedS[s0]) continue;
    usedS[s0] = 1;
    const line = [segs[s0][0], segs[s0][1]];
    // extend forwards from the tail, then backwards from the head
    for (let cur = s0, tail = segs[s0][1]; ;) { const n = nextSeg(tail, cur); if (n < 0) break; usedS[n] = 1; const [a, b] = segs[n]; tail = sk(a) === sk(tail) ? b : a; line.push(tail); cur = n; }
    for (let cur = s0, head = segs[s0][0]; ;) { const n = nextSeg(head, cur); if (n < 0) break; usedS[n] = 1; const [a, b] = segs[n]; head = sk(a) === sk(head) ? b : a; line.unshift(head); cur = n; }
    const pts = simplify(line, 0.5);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const ch = chunk(chunkKey((a[0] + b[0]) / 2, (a[1] + b[1]) / 2));
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); if (l < 0.01) continue;
      let nx = dz / l, nz = -dx / l;
      const mx = (a[0] + b[0]) / 2 + nx * 1.5, mz = (a[1] + b[1]) / 2 + nz * 1.5;
      if (maskAt(mx, mz) > TH) { nx = -nx; nz = -nz; }
      quadGeo(ch.struct, [a[0], -4, a[1]], [b[0], -4, b[1]], [b[0], 0.02, b[1]], [a[0], 0.02, a[1]], [nx, 0, nz], wallCol);
    }
  }

  // ================= TREES =================
  progress(0.8, 'Planting rain trees');
  // types: 0 rain tree (wide), 1 angsana/tembusu (medium), 2 palm, 3 shrub/bush, 4 slim tree (yellow flame)
  const trees = [];
  const place = (x, z, type, scale, minGap = 0) => {
    if (maskAt(x, z) < 200) return false;
    if (occAt(x, z) >= 200) return false;
    trees.push(x, z, type, scale, rand() * Math.PI * 2);
    occStroke([[x, z], [x, z]], minGap || 2.5, 120);
    return true;
  };
  for (let i = 0; i < city.trees.length; i += 2) place(city.trees[i], city.trees[i + 1], rand() < 0.6 ? 0 : 1, 0.8 + rand() * 0.5);
  // street trees along drivable roads
  for (const r of roads) {
    if (r.c > 5 || r.b) continue;
    const n = r.p.length / 2; const hw = r.w / 2;
    let acc = rand() * 10;
    const spacing = r.c <= 2 ? 15 : 18;
    for (let i = 0; i < n - 1; i++) {
      const ax = r.p[i * 2], az = r.p[i * 2 + 1], bx = r.p[i * 2 + 2], bz = r.p[i * 2 + 3];
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz); if (l < 1) continue;
      const rx = -dz / l, rz = dx / l;
      while (acc < l) {
        const f = acc / l; const x = ax + dx * f, z = az + dz * f;
        const nearJ = isJunction(kp(ax, az)) && acc < 14 || isJunction(kp(bx, bz)) && l - acc < 14;
        if (!nearJ) {
          for (const side of [-1, 1]) {
            const off = hw + 2.2 + rand() * 0.6;
            const tx = x + rx * off * side, tz = z + rz * off * side;
            const nearWater = maskAt(tx + rx * side * 25, tz + rz * side * 25) < 200;
            const type = nearWater && rand() < 0.7 ? 2 : (r.c <= 3 ? (rand() < 0.7 ? 0 : 1) : (rand() < 0.5 ? 1 : (rand() < 0.5 ? 0 : 4)));
            place(tx, tz, type, 0.75 + rand() * 0.45, 4);
          }
        }
        acc += spacing * (0.8 + rand() * 0.4);
      }
      acc -= l;
    }
  }
  // parks & woods
  for (let z = M.zmin + 5; z < M.zmax; z += 7) {
    for (let x = M.xmin + 5; x < M.xmax; x += 7) {
      const jx = x + (rand() - 0.5) * 6, jz = z + (rand() - 0.5) * 6;
      const g = maskAt(jx, jz, 1);
      if (g >= 240) { if (rand() < 0.42) place(jx, jz, rand() < 0.45 ? 0 : (rand() < 0.6 ? 1 : (rand() < 0.5 ? 3 : 2)), 0.7 + rand() * 0.6, 3); }
      else if (g >= 170) { if (rand() < 0.85) place(jx, jz, rand() < 0.5 ? 1 : (rand() < 0.5 ? 0 : 3), 0.7 + rand() * 0.6, 2); }
      else if (g < 50 && maskAt(jx, jz, 2) < 100 && maskAt(jx, jz) > 200 && rand() < 0.06) place(jx, jz, rand() < 0.5 ? 3 : 1, 0.6 + rand() * 0.4, 3);
    }
  }

  // ================= OUTPUT =================
  progress(0.9, 'Uploading city to GPU');
  const transfer = [];
  const outChunks = [];
  for (const [k, ch] of chunks) {
    const coarse = k >= 900000, kk = coarse ? k - 900000 : k, size = coarse ? chunkSize * 3 : chunkSize;
    const cx = (kk % 1000) - 50, cz = Math.floor(kk / 1000) - 50;
    const o = { key: k, cx, cz, x0: M.xmin + cx * size, z0: M.zmin + cz * size, size };
    for (const name of ['walls', 'roofs', 'roads', 'foot', 'struct', 'wallsNear', 'structNear']) {
      if (ch[name].empty()) continue;
      const g = ch[name].out();
      o[name] = g;
      for (const a of Object.values(g.attributes)) transfer.push(a.array.buffer);
      transfer.push(g.index.buffer);
    }
    if (ch.phys.vc) { o.phys = { vertices: ch.phys.pos.out(), indices: ch.phys.idx.out() }; transfer.push(o.phys.vertices.buffer, o.phys.indices.buffer); }
    outChunks.push(o);
  }
  const treeArr = new Float32Array(trees); transfer.push(treeArr.buffer);
  const binfo = new Float32Array(buildingInfo); transfer.push(binfo.buffer);
  self.postMessage({ type: 'done', chunks: outChunks, trees: treeArr, buildingInfo: binfo, stats: { buildings: nb, wallTris, roofTris, kerbPushed, tc: TC, trees: trees.length / 5, ms: Math.round(performance.now() - t0) }, nCx, nCz }, transfer);
}

function quadGeo(g, a, b, c, d, n, col, doubleSided = false) {
  const i0 = g.vert({ position: a, normal: n, color: col }), i1 = g.vert({ position: b, normal: n, color: col }), i2 = g.vert({ position: c, normal: n, color: col }), i3 = g.vert({ position: d, normal: n, color: col });
  // pick winding so that face normal matches n
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
  if (fx * n[0] + fy * n[1] + fz * n[2] >= 0 || doubleSided) { g.tri(i0, i1, i2); g.tri(i0, i2, i3); }
  if (fx * n[0] + fy * n[1] + fz * n[2] < 0 || doubleSided) {
    if (doubleSided) {
      const nn = [-n[0], -n[1], -n[2]];
      const j0 = g.vert({ position: a, normal: nn, color: col }), j1 = g.vert({ position: b, normal: nn, color: col }), j2 = g.vert({ position: c, normal: nn, color: col }), j3 = g.vert({ position: d, normal: nn, color: col });
      g.tri(j0, j2, j1); g.tri(j0, j3, j2);
    } else { g.tri(i0, i2, i1); g.tri(i0, i3, i2); }
  }
}
function boxGeo(g, x, y, z, hx, h, hz, col, top = true) {
  const x0 = x - hx, x1 = x + hx, z0 = z - hz, z1 = z + hz, y0 = y, y1 = y + h;
  quadGeo(g, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], col);
  quadGeo(g, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], col);
  quadGeo(g, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], col);
  quadGeo(g, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], col);
  if (top) quadGeo(g, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], col);
}
