// Everyday Singapore at street level, placed while the city is built: kopitiam tables, beer-brand umbrellas, planters,
// benches, shared bikes and pushcarts on open paving; potted plants along the five-foot-ways and aircon condensers on
// shophouse back walls; HDB estates get stone tables in their void decks, covered linkways between blocks, a playground
// and a fitness corner; hawker centres get tables all round their colonnade.
// The pieces are instanced on the main thread (world/streetfurniture.js: one draw call, near the camera only); this
// returns where they go. Linkways, one of a kind each, are written straight into the chunk's near-detail structure
// geometry. Placement is hash-seeded (the builder's sequential rand() would move every tree placed after it) and keeps
// clear of buildings, carriageways and the sidewalk lines beside them, footways, trees and landmark plazas. Every piece
// people would walk into is listed (x, z, radius, solid): pedestrians step round them and the solid ones get colliders
// near the player (world/treecolliders.js).
import { Kit, C, KINDS, hash, pick, linkway } from '../streetpieces.js';

const KIND = Object.fromEntries(KINDS.map((k, i) => [k, i]));

// ---------------------------------------------------------------- placement
/**
 * ctx (from the city builder): city, M (meta), maskAt, occAt, occMark(x, z, r), roadGrid + RG, chunk(x, z) -> chunk,
 * excluded(x, z), clearings [{x, z, r}], setTag(name), and what the building loop collected: shopFronts, piers,
 * shopBacks, hdbBlocks, colonnade. Returns { pieces: Float32Array of (kind, x, y, z, yaw, h), obstacles: Float32Array
 * of (x, z, radius, solid), counts }.
 */
export function buildStreetscape(ctx) {
  const { city, M, maskAt, occAt, occMark, roadGrid, RG, excluded, clearings } = ctx;
  const K = new Kit(), pieces = [], out = [], counts = {};
  const put = (kind, x, z, yaw, h, r, solid, y = 0) => {
    pieces.push(KIND[kind], x, y, z, yaw, h);
    if (r > 0) { out.push(x, z, r, solid ? 1 : 0); occMark(x, z, r + 0.5); }
    counts[kind] = (counts[kind] || 0) + 1;
  };
  // something to walk round at local (lx, lz) of a piece placed at (x, z, yaw)
  const obstacle = (x, z, yaw, lx, lz, r, solid) => out.push(x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z - lx * Math.sin(yaw) + lz * Math.cos(yaw), r, solid ? 1 : 0);

  // carriageways keep the sidewalk line beside them (hw + 2 m) and a little more clear; footways keep their line clear
  const roadsClear = (x, z, pad) => {
    const gx = Math.floor(x / RG), gz = Math.floor(z / RG);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const l = roadGrid.get((gx + dx) * 100003 + gz + dz); if (!l) continue;
      for (let k = 0; k < l.length; k += 2) {
        const r = city.roads[l[k]], i = l[k + 1];
        const ax = r.p[i * 2], az = r.p[i * 2 + 1], vx = r.p[i * 2 + 2] - ax, vz = r.p[i * 2 + 3] - az, L2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
        const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
        const need = r.c < 7 ? r.w / 2 + 4.0 : r.c === 7 ? r.w / 2 + 1.8 : 2.4;
        if (d < need + pad) return false;
      }
    }
    return true;
  };
  const inClearing = (x, z, r) => clearings.some(c => (x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + r) ** 2);
  // free ground of radius r: land, nothing built or planted, no road, no landmark plaza
  const free = (x, z, r) => {
    if (maskAt(x, z) < 200 || excluded(x, z) || inClearing(x, z, r)) return false;
    if (occAt(x, z) >= 110) return false;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (occAt(px, pz) >= 110 || maskAt(px, pz) < 200) return false;
    }
    return roadsClear(x, z, r);
  };
  // ...and a walking strip along the facades (shop doors, lobbies) left clear
  const offWalls = (x, z, d) => {
    for (let k = 0; k < 8; k++) if (occAt(x + Math.cos(k * Math.PI / 4) * d, z + Math.sin(k * Math.PI / 4) * d) === 255) return false;
    return true;
  };

  // what is around a point: food stalls / shopfronts / stops
  const PG = 40, poiGrid = new Map();
  const FOOD = new Set(['food_court', 'restaurant', 'cafe', 'fast_food', 'marketplace', 'bar', 'pub']);
  for (const p of city.pois) {
    const kind = FOOD.has(p.k) ? 1 : p.k === 'bus_stop' || p.k === 'subway_entrance' ? 2 : 0; if (!kind) continue;
    const key = Math.floor(p.x / PG) * 100003 + Math.floor(p.z / PG); let a = poiGrid.get(key); if (!a) poiGrid.set(key, a = []); a.push(p.x, p.z, kind);
  }
  const poiNear = (x, z, kind, r) => {
    for (let gx = Math.floor((x - r) / PG); gx <= Math.floor((x + r) / PG); gx++) for (let gz = Math.floor((z - r) / PG); gz <= Math.floor((z + r) / PG); gz++) {
      const a = poiGrid.get(gx * 100003 + gz); if (!a) continue;
      for (let i = 0; i < a.length; i += 3) if (a[i + 2] === kind && (a[i] - x) ** 2 + (a[i + 1] - z) ** 2 < r * r) return true;
    }
    return false;
  };
  const shopGrid = new Map();
  for (let i = 0; i < ctx.shopFronts.length; i += 2) { const x = ctx.shopFronts[i], z = ctx.shopFronts[i + 1], key = Math.floor(x / PG) * 100003 + Math.floor(z / PG); let a = shopGrid.get(key); if (!a) shopGrid.set(key, a = []); a.push(x, z); }
  const shopNear = (x, z, r) => {
    for (let gx = Math.floor((x - r) / PG); gx <= Math.floor((x + r) / PG); gx++) for (let gz = Math.floor((z - r) / PG); gz <= Math.floor((z + r) / PG); gz++) {
      const a = shopGrid.get(gx * 100003 + gz); if (!a) continue;
      for (let i = 0; i < a.length; i += 2) if ((a[i] - x) ** 2 + (a[i + 1] - z) ** 2 < r * r) return true;
    }
    return false;
  };

  // open paving: ground mask B 255 plaza, 220 sidewalk, 150 the apron round buildings (200 is a car park)
  const paved = (x, z) => { const b = maskAt(x, z, 2); return b >= 140 && (b < 190 || b >= 215); };

  // ---- open paving: eating out near food and shopfronts, planters and benches elsewhere
  const S = 6.5;
  for (let z = M.zmin + S / 2; z < M.zmax; z += S) for (let x = M.xmin + S / 2; x < M.xmax; x += S) {
    const h = hash(x * 0.37, z * 0.53);
    const px = x + (hash(x, z + 1.7) - 0.5) * S * 0.5, pz = z + (hash(x + 2.3, z) - 0.5) * S * 0.5;
    if (!paved(px, pz)) continue;
    const food = poiNear(px, pz, 1, 28), shops = shopNear(px, pz, 16);
    if ((food || shops) && h < (food ? 0.5 : 0.3)) {
      // a few tables in a loose row, some under an umbrella; now and then a pushcart beside them
      const yaw = hash(px, pz) * Math.PI, ux = Math.sin(yaw + Math.PI / 2), uz = Math.cos(yaw + Math.PI / 2);
      const n = 2 + Math.floor(hash(pz, px) * 3);
      for (let k = 0; k < n; k++) {
        const tx = px + ux * (k - (n - 1) / 2) * 2.5, tz = pz + uz * (k - (n - 1) / 2) * 2.5, hk = hash(tx, tz);
        if (!free(tx, tz, 1.15) || !offWalls(tx, tz, 2.8)) continue;
        put('kopitiam', tx, tz, yaw + hk, hk, 1.0, false);
        if (hk < 0.4) put('umbrella', tx, tz, hk * 6, hk * 2.5, 0, false);
      }
      if (h < 0.06 && free(px + uz * 2.6, pz - ux * 2.6, 1.1) && offWalls(px + uz * 2.6, pz - ux * 2.6, 2.6)) put('cart', px + uz * 2.6, pz - ux * 2.6, yaw, h * 9, 1.0, true);
    } else if (h < (maskAt(px, pz, 2) >= 250 ? 0.11 : 0.06)) {
      const yaw = Math.round(hash(pz, x) * 4) * Math.PI / 2;
      if (!free(px, pz, 1.2) || !offWalls(px, pz, 2.8)) continue;
      put('planter', px, pz, yaw, hash(px + 5, pz), 0.85, true);
      const bx = px + Math.sin(yaw) * 1.35, bz = pz + Math.cos(yaw) * 1.35;
      if (h < 0.06 && free(bx, bz, 0.9)) put('bench', bx, bz, yaw, 0, 0.8, true);
    }
  }
  // ---- shared bikes parked by MRT exits and bus stops
  for (const p of city.pois) {
    if (p.k !== 'subway_entrance' && p.k !== 'bus_stop') continue;
    const h = hash(p.x * 1.3, p.z * 0.7); if (h > 0.45) continue;
    for (let k = 0; k < 6; k++) {
      const a = (h * 7 + k) * 1.1, d = 5 + k * 1.5, x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (!paved(x, z) || !free(x, z, 1.6)) continue;
      put('bikes', x, z, a, h * 2.2, 1.4, true); break;
    }
  }
  // ---- shophouses: potted plants by the five-foot-way piers, aircon condensers on the back walls
  for (const f of ctx.piers) {
    const h = hash(f[0] * 1.7, f[1] * 2.9); if (h > 0.28) continue;
    put('pot', f[0], f[1], h * 9, h * 3.5, 0, false);
  }
  for (const w of ctx.shopBacks) {
    const [px, pz, qx, qz, nx, nz, y0, fh, floors] = w, len = Math.hypot(qx - px, qz - pz), units = Math.max(1, Math.round(len / 5.5));
    const yaw = Math.atan2(nx, nz);
    for (let u = 0; u < units; u++) for (let f = 0; f < floors; f++) {
      const h = hash(px + u * 3.1 + f * 7.7, pz + u * 1.3); if (h > 0.45) continue;
      const t = (u + 0.25 + h * 1.1) / units, x = px + (qx - px) * t + nx * 0.02, z = pz + (qz - pz) * t + nz * 0.02;
      put('condenser', x, z, yaw, 0, 0, false, y0 + f * fh + (f ? 0.5 : 2.6));
    }
  }

  // ---- HDB estates: void-deck tables, linkways between neighbouring blocks, one playground + fitness corner each
  for (const [x, z, yaw, kind] of ctx.colonnade) put(kind, x, z, yaw, hash(x, z), 1.0, kind === 'stoneTable');
  const B = ctx.hdbBlocks;
  // nothing built or planted in the way and no carriageway crossed (footways are fine: the linkway shelters one)
  const linkClear = (ax, az, bx, bz) => {
    const L = Math.hypot(bx - ax, bz - az), n = Math.ceil(L / 1.5);
    for (let k = 0; k <= n; k++) {
      const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n;
      if (occAt(x, z) >= 110 || maskAt(x, z) < 200 || excluded(x, z) || !roadsClear(x, z, -3.5)) return false;
    }
    return true;
  };
  // closest pair of points between two outlines (vertex of one to edge of the other)
  const closest = (A, Bq) => {
    let best = null;
    for (const [P, Q, flip] of [[A, Bq, false], [Bq, A, true]]) for (const v of P) for (let i = 0; i < Q.length; i++) {
      const a = Q[i], b = Q[(i + 1) % Q.length], vx = b[0] - a[0], vz = b[1] - a[1], L2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((v[0] - a[0]) * vx + (v[1] - a[1]) * vz) / L2)), x = a[0] + vx * t, z = a[1] + vz * t, d = Math.hypot(v[0] - x, v[1] - z);
      if (!best || d < best.d) best = flip ? { d, ax: x, az: z, bx: v[0], bz: v[1] } : { d, ax: v[0], az: v[1], bx: x, bz: z };
    }
    return best;
  };
  const linked = new Set();
  for (let i = 0; i < B.length; i++) {
    let best = null, bj = -1;
    for (let j = 0; j < B.length; j++) {
      if (j === i || Math.hypot(B[i].cx - B[j].cx, B[i].cz - B[j].cz) > 90) continue;
      const c = closest(B[i].ring, B[j].ring); if (c.d < 6 || c.d > 42) continue;
      if (!best || c.d < best.d) { best = c; bj = j; }
    }
    if (!best || linked.has(Math.min(i, bj) * 100000 + Math.max(i, bj))) continue;
    // from the edge of one void deck to the other's
    const dx = best.bx - best.ax, dz = best.bz - best.az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    if (!linkClear(best.ax + ux * 2.5, best.az + uz * 2.5, best.bx - ux * 2.5, best.bz - uz * 2.5)) continue;
    linked.add(Math.min(i, bj) * 100000 + Math.max(i, bj));
    ctx.setTag('s.linkway');
    linkway(K.at(ctx.chunk(best.ax + dx / 2, best.az + dz / 2).structNear, best.ax - ux * 0.1, 0, best.az - uz * 0.1, Math.atan2(dx, dz)), L + 0.2, pick(C.linkRoof, hash(best.ax, best.az)));
    counts.linkway = (counts.linkway || 0) + 1;
  }
  // estates: blocks within 80 m of each other
  const est = B.map((_, i) => i), root = i => (est[i] === i ? i : (est[i] = root(est[i])));
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) if (Math.hypot(B[i].cx - B[j].cx, B[i].cz - B[j].cz) < 80) est[root(i)] = root(j);
  const groups = new Map(); B.forEach((b, i) => { const r = root(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(b); });
  // a rectangle hx x hz turned to yaw, clear all over (ground, buildings, trees, roads, footways)
  const rectFree = (x, z, yaw, hx, hz) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let a = -hx; a <= hx + 0.01; a += 2) for (let b = -hz; b <= hz + 0.01; b += 2) {
      const px = x + a * c + b * s, pz = z - a * s + b * c;
      if (occAt(px, pz) >= 110 || maskAt(px, pz) < 200 || maskAt(px, pz, 2) === 200 || excluded(px, pz)) return false;
    }
    return !inClearing(x, z, Math.hypot(hx, hz)) && roadsClear(x, z, Math.hypot(hx, hz) - 2.4);
  };
  const spot = (cx, cz, yaw, hx, hz) => {
    for (let r = 8; r < 130; r += 5) for (let k = 0, n = Math.ceil(r / 3); k < n; k++) {
      const a = (k / n + hash(cx, cz)) * Math.PI * 2, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (rectFree(x, z, yaw, hx, hz)) return [x, z];
    }
    return null;
  };
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    let cx = 0, cz = 0; for (const b of g) { cx += b.cx / g.length; cz += b.cz / g.length; }
    const yaw = Math.atan2(g[0].ux, g[0].uz), h = hash(cx, cz);
    const pg = spot(cx, cz, yaw, 7.2, 5.7);
    if (pg) {
      put('playground', pg[0], pg[1], yaw, h, 0, false); occMark(pg[0], pg[1], 7.5);
      obstacle(pg[0], pg[1], yaw, 0, 0, 1.7, true); obstacle(pg[0], pg[1], yaw, 2.4, 0, 1.0, false); obstacle(pg[0], pg[1], yaw, -3.6, 2.8, 1.6, false);
    }
    const fc = spot(pg ? pg[0] : cx, pg ? pg[1] : cz, yaw, 4.3, 2.8);
    if (fc) {
      put('fitness', fc[0], fc[1], yaw, hash(cz, cx), 0, false); occMark(fc[0], fc[1], 4.5);
      obstacle(fc[0], fc[1], yaw, -2.3, -1.2, 0.9, false); obstacle(fc[0], fc[1], yaw, 0.1, 0.5, 1.0, false); obstacle(fc[0], fc[1], yaw, 2.4, -0.4, 1.0, false);
    }
  }
  return { pieces: new Float32Array(pieces), obstacles: new Float32Array(out), counts };
}
