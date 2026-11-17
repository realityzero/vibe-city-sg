// Converts the cached Overpass JSON into compact game data:
//   public/data/city.json   buildings, roads, traffic graph, trees, POIs (local metres, x = east, z = south)
//   public/data/ground.png  2 m/px mask: R land(255)/pond(128)/water(0), G vegetation, B paving
// Data © OpenStreetMap contributors, ODbL.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { elevateBridges, validateBridges } from './bridge-decks.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, 'cache');
const outDir = join(here, '..', 'public', 'data');

const BBOX = { s: 1.268, w: 103.822, n: 1.306, e: 103.876 };
const LAT0 = 1.287, LON0 = 103.849;
const KX = Math.cos(LAT0 * Math.PI / 180) * 111320;
const KZ = 110574;
const proj = (lat, lon) => [(lon - LON0) * KX, -(lat - LAT0) * KZ];
const [XMIN, ZMAX] = proj(BBOX.s, BBOX.w);
const [XMAX, ZMIN] = proj(BBOX.n, BBOX.e);
const RES = 2;
const W = Math.ceil((XMAX - XMIN) / RES), H = Math.ceil((ZMAX - ZMIN) / RES);

const load = async n => existsSync(join(cache, `${n}.json`)) ? JSON.parse(await readFile(join(cache, `${n}.json`), 'utf8')).elements : [];
const r1 = v => Math.round(v * 10) / 10;
const key = g => `${g.lat.toFixed(7)},${g.lon.toFixed(7)}`;

// ---------- geometry helpers ----------
function ringArea(r) { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function pointInRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function centroid(r) { let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return [x / r.length, z / r.length]; }
function dropClosing(r) { if (r.length > 1) { const a = r[0], b = r[r.length - 1]; if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) r.pop(); } return r; }
function simplifyRing(r, eps = 0.15) {
  // drop near-duplicate and collinear vertices
  const out = [];
  for (const p of r) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push(p); }
  if (out.length > 3) { const a = out[0], b = out[out.length - 1]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps) out.pop(); }
  return out;
}

// Joins member ways into closed rings (multipolygon assembly).
function assembleRings(ways) {
  const segs = ways.map(w => w.slice());
  const rings = [];
  while (segs.length) {
    let ring = segs.shift();
    let guard = 0;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 10000) {
      const endK = key(ring[ring.length - 1]);
      let found = -1, rev = false;
      for (let i = 0; i < segs.length; i++) {
        if (key(segs[i][0]) === endK) { found = i; break; }
        if (key(segs[i][segs[i].length - 1]) === endK) { found = i; rev = true; break; }
      }
      if (found < 0) break;
      let s = segs.splice(found, 1)[0];
      if (rev) s = s.slice().reverse();
      ring = ring.concat(s.slice(1));
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

// Returns [{outer, holes}] in projected coords for way or multipolygon relation.
function polygonsOf(el) {
  if (el.type === 'way') {
    if (!el.geometry || el.geometry.length < 4) return [];
    return [{ outer: dropClosing(el.geometry.map(g => proj(g.lat, g.lon))), holes: [] }];
  }
  if (el.type === 'relation' && el.members) {
    const outers = assembleRings(el.members.filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry).map(m => m.geometry))
      .map(r => dropClosing(r.map(g => proj(g.lat, g.lon))));
    const inners = assembleRings(el.members.filter(m => m.type === 'way' && m.role === 'inner' && m.geometry).map(m => m.geometry))
      .map(r => dropClosing(r.map(g => proj(g.lat, g.lon))));
    const polys = outers.map(o => ({ outer: o, holes: [] }));
    for (const h of inners) {
      const c = h[0];
      const p = polys.find(pp => pointInRing(c[0], c[1], pp.outer));
      if (p) p.holes.push(h);
    }
    return polys;
  }
  return [];
}

// ---------- raster ----------
const mask = new Uint8Array(W * H * 4);
const R = 0, G = 1, B = 2;
for (let i = 0; i < W * H; i++) { mask[i * 4] = 255; mask[i * 4 + 3] = 255; }
const toPx = (x, z) => [(x - XMIN) / RES - 0.5, (z - ZMIN) / RES - 0.5];

function fillRings(rings, cb) {
  // even-odd scanline fill; cb(index) per pixel
  let zmin = Infinity, zmax = -Infinity;
  const edges = [];
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const a = toPx(...r[i]), b = toPx(...r[(i + 1) % r.length]);
      edges.push([a[0], a[1], b[0], b[1]]);
      zmin = Math.min(zmin, a[1]); zmax = Math.max(zmax, a[1]);
    }
  }
  const j0 = Math.max(0, Math.ceil(zmin)), j1 = Math.min(H - 1, Math.floor(zmax));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    xs.length = 0;
    for (const [x0, z0, x1, z1] of edges) {
      if ((z0 > j) !== (z1 > j)) xs.push(x0 + (j - z0) * (x1 - x0) / (z1 - z0));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(xs[k])), i1 = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let i = i0; i <= i1; i++) cb(j * W + i);
    }
  }
}
function strokeLine(pts, radiusM, cb) {
  const rad = radiusM / RES;
  for (let s = 0; s + 1 < pts.length; s++) {
    const [ax, az] = toPx(...pts[s]), [bx, bz] = toPx(...pts[s + 1]);
    const len = Math.hypot(bx - ax, bz - az);
    const minI = Math.max(0, Math.floor(Math.min(ax, bx) - rad - 1)), maxI = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + rad + 1));
    const minJ = Math.max(0, Math.floor(Math.min(az, bz) - rad - 1)), maxJ = Math.min(H - 1, Math.ceil(Math.max(az, bz) + rad + 1));
    for (let j = minJ; j <= maxJ; j++) for (let i = minI; i <= maxI; i++) {
      let t = len > 0 ? ((i - ax) * (bx - ax) + (j - az) * (bz - az)) / (len * len) : 0;
      t = Math.max(0, Math.min(1, t));
      const dx = i - (ax + t * (bx - ax)), dz = j - (az + t * (bz - az));
      if (dx * dx + dz * dz <= rad * rad) cb(j * W + i);
    }
  }
}

// ---------- water ----------
console.time('water');
const waterEls = await load('water');
{
  const barrier = new Uint8Array(W * H);
  const seeds = [];
  for (const el of waterEls) {
    if (el.tags?.natural !== 'coastline' || !el.geometry) continue;
    const pts = el.geometry.map(g => proj(g.lat, g.lon));
    strokeLine(pts, 1.6, i => { barrier[i] = 1; });
    for (let s = 0; s + 1 < pts.length; s++) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
      if (l < 1) continue;
      // land is on the left of the way direction (north-up map); in x-east/z-south coords right = (-dz, dx)
      const mx = (ax + bx) / 2 + (-dz / l) * 6, mz = (az + bz) / 2 + (dx / l) * 6;
      const [pi, pj] = toPx(mx, mz);
      const i = Math.round(pi), j = Math.round(pj);
      if (i >= 0 && j >= 0 && i < W && j < H) seeds.push(j * W + i);
    }
  }
  const sea = new Uint8Array(W * H);
  const stack = [];
  for (const s of seeds) if (!barrier[s] && !sea[s]) { sea[s] = 1; stack.push(s); }
  while (stack.length) {
    const p = stack.pop(); const i = p % W, j = (p / W) | 0;
    const nb = [i > 0 ? p - 1 : -1, i < W - 1 ? p + 1 : -1, j > 0 ? p - W : -1, j < H - 1 ? p + W : -1];
    for (const q of nb) if (q >= 0 && !sea[q] && !barrier[q]) { sea[q] = 1; stack.push(q); }
  }
  let seaCount = 0;
  for (let i = 0; i < W * H; i++) if (sea[i]) { mask[i * 4 + R] = 0; seaCount++; }
  console.log(`sea pixels ${(seaCount / (W * H) * 100).toFixed(1)}%`);

  for (const el of waterEls) {
    const t = el.tags || {};
    const isArea = t.natural === 'water' || ['riverbank', 'dock'].includes(t.waterway) || (t.waterway && el.type === 'relation');
    if (!isArea) continue;
    for (const poly of polygonsOf(el)) {
      if (poly.outer.length < 3) continue;
      const area = Math.abs(ringArea(poly.outer));
      const small = area < 15000 && !['river', 'reservoir', 'canal'].includes(t.water) && !t.waterway;
      fillRings([poly.outer, ...poly.holes], i => { mask[i * 4 + R] = small ? Math.min(mask[i * 4 + R], 128) : 0; });
    }
  }
}
console.timeEnd('water');

// ---------- green / paving ----------
const greenEls = await load('green');
const ponds = [];
for (const el of greenEls) {
  const t = el.tags || {};
  let g = 0, b = 0, land = false;
  if (['park', 'garden', 'common', 'nature_reserve', 'dog_park', 'recreation_ground', 'village_green'].includes(t.leisure) || ['grass', 'meadow', 'village_green', 'recreation_ground', 'cemetery'].includes(t.landuse) || ['grassland', 'heath'].includes(t.natural)) g = 255;
  else if (['forest'].includes(t.landuse) || ['wood', 'scrub', 'wetland'].includes(t.natural)) g = 180;
  else if (t.leisure === 'pitch' || t.leisure === 'golf_course') g = 100;
  else if (t.leisure === 'playground') b = 120;
  else if (t.amenity === 'parking') b = 200;
  else if (t['area:highway'] || t.landuse === 'construction' || t.landuse === 'railway') b = 180;
  else if (t.man_made === 'pier' || t.man_made === 'breakwater') { land = true; b = 230; }
  else if (t.landuse === 'religious' || t.leisure === 'sports_centre') b = 150;
  else continue;
  for (const poly of polygonsOf(el)) {
    if (poly.outer.length < 3) continue;
    fillRings([poly.outer, ...poly.holes], i => {
      if (land) mask[i * 4 + R] = 255;
      if (g) { mask[i * 4 + G] = Math.max(mask[i * 4 + G], g === 100 ? (mask[i * 4 + G] || 100) : g); }
      if (b) mask[i * 4 + B] = Math.max(mask[i * 4 + B], b);
    });
  }
  if ((t.man_made === 'pier') && el.type === 'way' && el.geometry && key(el.geometry[0]) !== key(el.geometry[el.geometry.length - 1])) {
    strokeLine(el.geometry.map(g => proj(g.lat, g.lon)), 2, i => { mask[i * 4 + R] = 255; mask[i * 4 + B] = 230; });
  }
}

// ---------- buildings ----------
console.time('buildings');
const bEls = await load('buildings');
const parseNum = v => { if (v == null) return NaN; const m = String(v).replace(',', '.').match(/-?[\d.]+/); return m ? parseFloat(m[0]) : NaN; };
const parseColor = v => {
  if (!v) return -1;
  v = String(v).trim().toLowerCase();
  const named = { white: 0xf2f2ee, black: 0x2a2a2a, grey: 0x9a9a9a, gray: 0x9a9a9a, red: 0xb5483b, brown: 0x8a5a3b, yellow: 0xf0d36b, blue: 0x6b8fbf, green: 0x6f9e6a, beige: 0xe0d2b4, orange: 0xe08a3c, pink: 0xeab0c0, cream: 0xf3ead2, silver: 0xc0c4c8, maroon: 0x7a2f2f, lightgrey: 0xc8c8c8, darkgrey: 0x555555, tan: 0xd2b48c, ivory: 0xfffff0, purple: 0x8a6bb0, gold: 0xd4af37 };
  if (named[v] != null) return named[v];
  const m = v.match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/);
  if (!m) return -1;
  let h = m[1]; if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return parseInt(h, 16);
};
const ROOF = { flat: 0, gabled: 1, hipped: 2, pyramidal: 3, dome: 4, round: 5, skillion: 6, onion: 4, mansard: 2, equal_hipped: 3, side_hipped: 2, 'hipped-and-gabled': 2, 'round hipped': 2 };
// style ids consumed by the facade shader
const STYLE = { glass: 0, office: 1, resi: 2, hdb: 3, shophouse: 4, lowrise: 5, civic: 6, parking: 7, canopy: 8, industrial: 9, station: 10 };

const rawB = [];
for (const el of bEls) {
  const t = el.tags || {};
  const isPart = !!t['building:part'];
  const btype = t.building || t['building:part'] || 'yes';
  if (['no', 'construction', 'proposed', 'demolished', 'ruins'].includes(btype) && !isPart) continue;
  if (t.location === 'underground' || parseNum(t.layer) < 0 && !t.height) continue;
  for (const poly of polygonsOf(el)) {
    const outer = simplifyRing(poly.outer);
    if (outer.length < 3) continue;
    const area = Math.abs(ringArea(outer));
    if (area < 4) continue;
    rawB.push({ el, t, isPart, btype, outer, holes: poly.holes.map(h => simplifyRing(h)).filter(h => h.length >= 3), area });
  }
}
// outlines that contain parts are replaced by their parts (Simple 3D Buildings rule)
{
  const cell = 50, grid = new Map();
  for (const b of rawB) if (b.isPart) {
    const c = centroid(b.outer); b.c = c;
    const k = `${Math.floor(c[0] / cell)},${Math.floor(c[1] / cell)}`;
    if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b);
  }
  for (const b of rawB) {
    if (b.isPart) continue;
    let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
    for (const [x, z] of b.outer) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
    let has = false, ground = false, minPart = Infinity;
    for (let gx = Math.floor(minx / cell); gx <= Math.floor(maxx / cell); gx++)
      for (let gz = Math.floor(minz / cell); gz <= Math.floor(maxz / cell); gz++)
        for (const p of grid.get(`${gx},${gz}`) || []) if (pointInRing(p.c[0], p.c[1], b.outer)) {
          has = true;
          const pm = parseNum(p.t.min_height) > 0 ? parseNum(p.t.min_height) : (parseNum(p.t['building:min_level']) > 0 ? parseNum(p.t['building:min_level']) * 3.3 : 0);
          if (pm < 3) ground = true; else minPart = Math.min(minPart, pm);
        }
    b.hasParts = has;
    // parts that only cover the upper floors (roof crowns etc.): keep the outline as the body below them
    if (has && !ground && minPart < Infinity) b.capH = minPart;
  }
}
let seed = 1337;
const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const buildings = [];
let bid = 0;
// ids must stay stable for landmark exclusions: bodies under elevated-only parts are appended at the end
const order = rawB.filter(b => !b.hasParts).concat(rawB.filter(b => b.hasParts && b.capH));
for (const b of order) {
  const { t, btype, area } = b;
  let height = parseNum(t.height);
  const levels = parseNum(t['building:levels']);
  const roofLevels = parseNum(t['roof:levels']);
  let minH = parseNum(t.min_height);
  const minLevel = parseNum(t['building:min_level']);
  if (!(minH >= 0)) minH = minLevel > 0 ? minLevel * 3.3 : 0;
  if (!(height > 0)) {
    if (levels > 0) height = levels * 3.3 + (roofLevels > 0 ? roofLevels * 2 : 0) + (levels > 6 ? 2 : 0.6);
    else if (btype === 'roof') height = 4.5;
    else if (['train_station', 'transportation'].includes(btype)) height = 5;
    else if (['house', 'detached', 'semidetached_house', 'terrace'].includes(btype)) height = 8 + rand() * 3;
    else if (area < 250) height = 9 + rand() * 4;
    else if (area < 900) height = 11 + rand() * 9;
    else height = 14 + rand() * 22;
  }
  if (btype === 'roof') minH = Math.max(minH, height - 1.0);
  if (b.capH) { height = b.capH + 0.3; minH = 0; }
  if (height <= minH + 0.5) height = minH + 3;
  const roofShape = b.capH ? 0 : (ROOF[t['roof:shape']] ?? 0);
  let roofH = parseNum(t['roof:height']);
  if (!(roofH > 0)) roofH = roofShape ? Math.min(6, Math.sqrt(area) * 0.25) : 0;
  roofH = Math.min(roofH, (height - minH) * 0.8);

  const lv = levels > 0 ? levels : Math.max(1, Math.round(height / 3.4));
  const material = t['building:material'] || '';
  const res = t.residential || t.commercial || '';
  let style;
  if (btype === 'roof') style = STYLE.canopy;
  else if (['train_station', 'transportation'].includes(btype)) style = STYLE.station;
  else if (btype === 'parking' || t.amenity === 'parking' || t.parking === 'multi-storey') style = STYLE.parking;
  else if (/hdb/i.test(res) && height > 16) style = STYLE.hdb;
  else if (['church', 'cathedral', 'temple', 'mosque', 'public', 'civic', 'government', 'museum', 'chapel', 'shrine', 'religious', 'courthouse', 'school', 'university', 'college'].includes(btype)) style = STYLE.civic;
  else if (['industrial', 'warehouse', 'service', 'storage_tank', 'hangar'].includes(btype)) style = STYLE.industrial;
  else if (height >= 45 && (material === 'glass' || ['commercial', 'office', 'yes', 'hotel', 'retail', 'mixed_use', 'bank'].includes(btype))) style = (material === 'concrete' && rand() < 0.5) ? STYLE.office : STYLE.glass;
  else if (['residential', 'apartments', 'dormitory'].includes(btype) && height > 18) style = /hdb/i.test(res) ? STYLE.hdb : STYLE.resi;
  else if (height <= 17 && area < 700 && lv <= 4 && !['hotel', 'office', 'hospital', 'school'].includes(btype)) style = STYLE.shophouse;
  else if (height <= 20) style = STYLE.lowrise;
  else style = rand() < 0.5 ? STYLE.office : (height > 40 ? STYLE.glass : STYLE.office);

  const o = {
    id: bid++,
    p: b.outer.flatMap(([x, z]) => [r1(x), r1(z)]),
    h: r1(height), s: style, l: lv,
  };
  if (minH > 0) o.m = r1(minH);
  if (b.holes.length) o.ho = b.holes.map(h => h.flatMap(([x, z]) => [r1(x), r1(z)]));
  const col = parseColor(t['building:colour']);
  const rcol = parseColor(t['roof:colour']);
  if (col >= 0) o.c = col;
  if (rcol >= 0) o.rc = rcol;
  if (roofShape) { o.r = roofShape; o.rh = r1(roofH); }
  if (t.name) o.n = t.name;
  if (b.isPart) o.pt = 1;
  buildings.push(o);
  // building apron paving in the mask
  if (!b.isPart && height > 3 && minH < 3) fillRings([b.outer], i => { mask[i * 4 + B] = Math.max(mask[i * 4 + B], 1); });
}
console.timeEnd('buildings');
console.log('buildings', buildings.length);

// dilate building footprints (marked as B=1) into paved aprons
{
  const src = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) src[i] = mask[i * 4 + B] === 1 ? 1 : 0;
  const tmp = new Uint8Array(W * H), r = 3;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let v = 0; for (let k = -r; k <= r && !v; k++) { const ii = i + k; if (ii >= 0 && ii < W && src[j * W + ii]) v = 1; }
    tmp[j * W + i] = v;
  }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let v = 0; for (let k = -r; k <= r && !v; k++) { const jj = j + k; if (jj >= 0 && jj < H && tmp[jj * W + i]) v = 1; }
    const p = (j * W + i) * 4;
    if (mask[p + B] === 1) mask[p + B] = 150;
    if (v && mask[p + G] < 150) mask[p + B] = Math.max(mask[p + B], 150);
  }
}

// ---------- roads ----------
console.time('roads');
const roadEls = await load('roads');
const DRIVE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'road']);
const FOOT = new Set(['footway', 'pedestrian', 'cycleway', 'path', 'steps', 'track']);
const CLASS = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, unclassified: 5, residential: 5, living_street: 6, road: 5, service: 7, motorway_link: 1, trunk_link: 2, primary_link: 3, secondary_link: 4, tertiary_link: 4, pedestrian: 8, footway: 9, cycleway: 9, path: 9, steps: 9, track: 9 };
const SPEED = [25, 20, 16, 14, 12, 10, 7, 7, 3, 2]; // m/s target for AI per class
const DEFAULT_LANES = { motorway: 3, trunk: 3, primary: 4, secondary: 2, tertiary: 2, unclassified: 2, residential: 2, living_street: 1, road: 2, service: 1, motorway_link: 1, trunk_link: 1, primary_link: 1, secondary_link: 1, tertiary_link: 1 };
const LANE_W = 3.3;

const isWaterAt = (x, z) => {
  const [pi, pj] = toPx(x, z); const i = Math.round(pi), j = Math.round(pj);
  if (i < 0 || j < 0 || i >= W || j >= H) return false;
  return mask[(j * W + i) * 4] < 200;
};

const roadsRaw = [];
for (const el of roadEls) {
  const t = el.tags || {};
  const hw = t.highway;
  if (!el.geometry || el.geometry.length < 2) continue;
  const drive = DRIVE.has(hw) || (hw === 'service' && !['parking_aisle', 'drive-through', 'emergency_access'].includes(t.service));
  const foot = FOOT.has(hw);
  if (!drive && !foot) continue;
  if (t.tunnel && t.tunnel !== 'no') continue;
  const layer = parseNum(t.layer) || 0;
  if (layer < 0) continue;
  if (t.area === 'yes') {
    if (hw === 'pedestrian' || hw === 'footway') fillRings([dropClosing(el.geometry.map(g => proj(g.lat, g.lon)))], i => { mask[i * 4 + B] = 255; });
    continue;
  }
  const pts = el.geometry.map(g => proj(g.lat, g.lon));
  let oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || hw === 'motorway' || /_link$/.test(hw) && t.oneway !== 'no' || t.junction === 'roundabout';
  if (t.oneway === '-1') { pts.reverse(); oneway = true; }
  if (t.oneway === 'no') oneway = false;
  let lanes = parseNum(t.lanes);
  if (!(lanes > 0)) lanes = drive ? (hw === 'service' ? 1 : (DEFAULT_LANES[hw] || 2)) : 0;
  if (!oneway && lanes < 2 && drive && hw !== 'service') lanes = 2;
  let lf, lb;
  if (oneway) { lf = lanes; lb = 0; }
  else {
    lf = parseNum(t['lanes:forward']); lb = parseNum(t['lanes:backward']);
    if (!(lf > 0) || !(lb > 0)) { lf = Math.ceil(lanes / 2); lb = Math.max(1, lanes - lf); }
  }
  let width;
  if (drive) width = hw === 'service' ? (oneway ? 3.6 : 5) : (lf + lb) * LANE_W + 0.6;
  else width = hw === 'pedestrian' ? 6 : hw === 'steps' ? 2.5 : hw === 'cycleway' ? 2.5 : 2.4;
  const bridge = t.bridge && t.bridge !== 'no' ? 1 : 0;
  const cls = CLASS[hw] ?? 5;
  roadsRaw.push({ el, t, pts, drive, foot, cls, hw, lf, lb, width, oneway, bridge, layer, covered: t.covered === 'yes', name: t.name || '', footType: t.footway || '' });
}

// bridge decks (tools/bridge-decks.mjs): deck profiles on the spans, ramps lifted onto the ground ways that meet them
{
  const { inserts, stats } = elevateBridges(roadsRaw, isWaterAt);
  for (const [after, r] of inserts) roadsRaw.splice(roadsRaw.indexOf(after) + 1, 0, r);
  console.log('bridges', JSON.stringify(stats));
}

// sidewalk paving in the ground mask along drivable roads (not on bridges)
for (const r of roadsRaw) {
  if (r.bridge) continue;
  if (r.drive && r.hw !== 'service') strokeLine(r.pts, r.width / 2 + 3.2, i => { if (mask[i * 4] > 200) mask[i * 4 + B] = Math.max(mask[i * 4 + B], 220); });
  else if (r.drive) strokeLine(r.pts, r.width / 2 + 0.8, i => { if (mask[i * 4] > 200) mask[i * 4 + B] = Math.max(mask[i * 4 + B], 200); });
  else if (r.foot && (r.hw === 'pedestrian' || r.width >= 4)) strokeLine(r.pts, r.width / 2 + 2.5, i => { if (mask[i * 4] > 200 && mask[i * 4 + G] < 200) mask[i * 4 + B] = Math.max(mask[i * 4 + B], 255); });
  else if (r.foot) strokeLine(r.pts, r.width / 2 + 0.6, i => { if (mask[i * 4] > 200 && mask[i * 4 + G] < 200) mask[i * 4 + B] = Math.max(mask[i * 4 + B], 220); });
}

const roads = roadsRaw.map(r => {
  const o = { p: r.pts.flatMap(([x, z]) => [r1(x), r1(z)]), c: r.cls, w: r1(r.width) };
  if (r.drive) { o.lf = r.lf; o.lb = r.lb; }
  if (r.oneway) o.o = 1;
  if (r.bridge) { o.b = 1; o.y = r.y.map(r1); }
  if (r.covered) o.cv = 1;
  if (r.name) o.n = r.name;
  if (r.footType === 'crossing' || r.t.crossing) o.x = 1;
  if (r.hw === 'steps') o.st = 1;
  return o;
});
console.timeEnd('roads');
// every deck must stand: no dip to the ground mid-structure, no step where spans meet, no ramp steeper than its grade
{
  const bad = validateBridges(roadsRaw.map(r => ({ ...r, pts: r.pts.map(([x, z]) => [r1(x), r1(z)]), y: r.y.map(r1) })));
  if (bad.length) { console.error(`bridge decks: ${bad.length} problems\n  ${bad.join('\n  ')}`); process.exit(1); }
}

// ---------- traffic graph (drivable, non-service) ----------
const graph = (() => {
  const kp = p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const use = new Map();
  const ways = roadsRaw.filter(r => r.drive && r.hw !== 'service');
  for (const r of ways) r.pts.forEach((p, i) => { const k = kp(p); use.set(k, (use.get(k) || 0) + ((i === 0 || i === r.pts.length - 1) ? 1 : 2)); });
  const nodes = [], nodeIdx = new Map();
  const nid = p => { const k = kp(p); if (!nodeIdx.has(k)) { nodeIdx.set(k, nodes.length); nodes.push([r1(p[0]), r1(p[1])]); } return nodeIdx.get(k); };
  const edges = [];
  for (const r of ways) {
    let start = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const isNode = i === r.pts.length - 1 || use.get(kp(r.pts[i])) > 2;
      if (!isNode) continue;
      const seg = r.pts.slice(start, i + 1), ys = r.y.slice(start, i + 1);
      let len = 0; for (let s = 1; s < seg.length; s++) len += Math.hypot(seg[s][0] - seg[s - 1][0], seg[s][1] - seg[s - 1][1]);
      if (len > 0.5) {
        const e = { a: nid(seg[0]), b: nid(seg[seg.length - 1]), p: seg.flatMap(([x, z]) => [r1(x), r1(z)]), lf: r.lf, lb: r.lb, c: r.cls, v: SPEED[r.cls], len: r1(len) };
        if (r.bridge) e.y = ys.map(r1);
        if (r.name) e.n = r.name;
        edges.push(e);
      }
      start = i;
    }
  }
  return { nodes, edges };
})();
console.log('graph', graph.nodes.length, 'nodes', graph.edges.length, 'edges');

// ---------- trees ----------
const treeEls = await load('trees');
const trees = [];
for (const el of treeEls) {
  if (el.type === 'node') { const [x, z] = proj(el.lat, el.lon); trees.push(r1(x), r1(z)); }
  else if (el.geometry) {
    const pts = el.geometry.map(g => proj(g.lat, g.lon));
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); const n = Math.max(1, Math.floor(d / 9));
      for (let s = 0; s < n; s++) { const f = s / n; trees.push(r1(pts[i - 1][0] + f * (pts[i][0] - pts[i - 1][0])), r1(pts[i - 1][1] + f * (pts[i][1] - pts[i - 1][1]))); }
    }
  }
}

// ---------- rail (MRT viaducts above ground) + POIs ----------
const railEls = await load('rail');
const rail = [];
for (const el of railEls) {
  const t = el.tags || {};
  if (!el.geometry || (t.tunnel && t.tunnel !== 'no') || (parseNum(t.layer) < 0)) continue;
  if (!['subway', 'light_rail', 'rail', 'monorail'].includes(t.railway) && !t.aerialway) continue;
  rail.push({ p: el.geometry.flatMap(g => proj(g.lat, g.lon).map(r1)), k: t.railway || 'aerial', b: t.bridge ? 1 : 0, n: t.name || '' });
}
const poiEls = await load('pois');
const pois = [];
for (const el of poiEls) {
  const t = el.tags || {};
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  if (lat == null) continue;
  const [x, z] = proj(lat, lon);
  if (x < XMIN || x > XMAX || z < ZMIN || z > ZMAX) continue;
  const kind = t.highway || t.amenity || t.tourism || t.shop || t.office || t.railway || t.public_transport || '';
  if (!kind) continue;
  if (['street_lamp', 'traffic_signals', 'bus_stop'].includes(t.highway)) { pois.push({ k: t.highway, x: r1(x), z: r1(z), ...(t.name ? { n: t.name } : {}) }); continue; }
  if (!t.name) continue;
  pois.push({ k: kind, x: r1(x), z: r1(z), n: t.name });
}

// ---------- river centreline (for ambient boats) ----------
const riverWays = waterEls.filter(e => e.type === 'way' && e.tags?.waterway === 'river' && e.tags?.name === 'Singapore River' && e.geometry);
const riverChains = (() => {
  // join chains end-to-end (they are not closed rings)
  const segs = riverWays.map(w => w.geometry.map(g => proj(g.lat, g.lon)));
  const kk = p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  let chains = segs.map(s => s.slice());
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < chains.length; i++) for (let j = 0; j < chains.length; j++) {
      if (i === j) continue;
      const a = chains[i], b = chains[j];
      if (kk(a[a.length - 1]) === kk(b[0])) { chains[i] = a.concat(b.slice(1)); chains.splice(j, 1); merged = true; break outer; }
      if (kk(a[a.length - 1]) === kk(b[b.length - 1])) { chains[i] = a.concat(b.slice().reverse().slice(1)); chains.splice(j, 1); merged = true; break outer; }
    }
  }
  chains.sort((a, b) => b.length - a.length);
  return chains.slice(0, 2).map(c => c.flatMap(([x, z]) => [r1(x), r1(z)]));
})();

// ---------- write ----------
await mkdir(outDir, { recursive: true });
const city = {
  meta: { lat0: LAT0, lon0: LON0, kx: KX, kz: KZ, bbox: BBOX, xmin: r1(XMIN), xmax: r1(XMAX), zmin: r1(ZMIN), zmax: r1(ZMAX), res: RES, w: W, h: H, attribution: '© OpenStreetMap contributors (ODbL)' },
  buildings, roads, graph, trees, rail, pois, river: riverChains,
};
const json = JSON.stringify(city);
await writeFile(join(outDir, 'city.json'), json);
console.log(`city.json ${(json.length / 1e6).toFixed(2)} MB; roads ${roads.length}, trees ${trees.length / 2}, rail ${rail.length}, pois ${pois.length}`);

// PNG writer (RGBA8, filter 0)
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let j = 0; j < H; j++) { raw[j * (W * 4 + 1)] = 0; Buffer.from(mask.buffer, j * W * 4, W * 4).copy(raw, j * (W * 4 + 1) + 1); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
await writeFile(join(outDir, 'ground.png'), png);
console.log(`ground.png ${W}x${H} ${(png.length / 1e6).toFixed(2)} MB`);
