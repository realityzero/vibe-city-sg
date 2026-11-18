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
 * exclusions (landmark footprints: rings of [x, z]), clearings (landmark plazas: {x, z, r}), placed (pieces landmarks
 * set out themselves), pip(x, z, ring),
 * setTag(name), and what the building loop collected: shopFronts, piers,
 * shopGoods, shopBacks, hdbBlocks, colonnade. Returns { pieces: Float32Array of (kind, x, y, z, yaw, h), obstacles: Float32Array
 * of (x, z, radius, solid), counts }.
 */
export function buildStreetscape(ctx) {
  const { city, M, maskAt, occAt, occMark, roadGrid, RG, pip } = ctx;
  const K = new Kit(), pieces = [], out = [], counts = {};
  const put = (kind, x, z, yaw, h, r, solid, y = 0) => {
    pieces.push(KIND[kind], x, y, z, yaw, h);
    if (r > 0) { out.push(x, z, r, solid ? 1 : 0); occMark(x, z, r + 0.5); }
    counts[kind] = (counts[kind] || 0) + 1;
  };
  // something to walk round at local (lx, lz) of a piece placed at (x, z, yaw)
  const obstacle = (x, z, yaw, lx, lz, r, solid) => out.push(x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z - lx * Math.sin(yaw) + lz * Math.cos(yaw), r, solid ? 1 : 0);
  // pieces a landmark sets out itself, on its own ground (Clarke Quay's bar terraces): [kind, x, z, yaw, h]
  for (const [kind, x, z, yaw, h] of ctx.placed) put(kind, x, z, yaw, h, kind === 'barTable' ? 1.0 : 0, false);

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
  // landmark ground: their footprints (the city leaves those buildings out) and plazas, by 50 m cell
  const ZC = 50, zones = new Map();
  const zone = (x0, z0, x1, z1, item) => {
    for (let gx = Math.floor(x0 / ZC); gx <= Math.floor(x1 / ZC); gx++) for (let gz = Math.floor(z0 / ZC); gz <= Math.floor(z1 / ZC); gz++) {
      const k = gx * 100003 + gz; let a = zones.get(k); if (!a) zones.set(k, a = []); a.push(item);
    }
  };
  for (const ring of ctx.exclusions) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const p of ring) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]); }
    zone(x0, z0, x1, z1, { ring });
  }
  for (const c of ctx.clearings) zone(c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r, c);
  // within r of a landmark's plaza or inside its footprint
  const landmark = (x, z, r) => {
    for (let gx = Math.floor((x - r) / ZC); gx <= Math.floor((x + r) / ZC); gx++) for (let gz = Math.floor((z - r) / ZC); gz <= Math.floor((z + r) / ZC); gz++) {
      const a = zones.get(gx * 100003 + gz); if (!a) continue;
      for (const c of a) if (c.ring ? pip(x, z, c.ring) : (x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + r) ** 2) return true;
    }
    return false;
  };
  // free ground of radius r: land, nothing built or planted, no road, no landmark plaza
  const free = (x, z, r) => {
    if (maskAt(x, z) < 200 || occAt(x, z) >= 110) return false;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (occAt(px, pz) >= 110 || maskAt(px, pz) < 200) return false;
    }
    return roadsClear(x, z, r) && !landmark(x, z, r);
  };
  // ...and a walking strip along the facades (shop doors, lobbies) left clear
  const offWalls = (x, z, d) => {
    for (let k = 0; k < 8; k++) if (occAt(x + Math.cos(k * Math.PI / 4) * d, z + Math.sin(k * Math.PI / 4) * d) === 255) return false;
    return true;
  };

  // what is around a point, rasterised at 8 m: 1 food (restaurants, cafes, food courts, bars) within 28 m,
  // 2 a shopfront within 16 m
  const NC = 8, NW = Math.ceil((M.xmax - M.xmin) / NC), NH = Math.ceil((M.zmax - M.zmin) / NC), around = new Uint8Array(NW * NH);
  const stamp = (x, z, r, bit) => {
    for (let j = Math.max(0, Math.floor((z - r - M.zmin) / NC)); j <= Math.min(NH - 1, Math.floor((z + r - M.zmin) / NC)); j++)
      for (let i = Math.max(0, Math.floor((x - r - M.xmin) / NC)); i <= Math.min(NW - 1, Math.floor((x + r - M.xmin) / NC)); i++)
        if ((M.xmin + (i + 0.5) * NC - x) ** 2 + (M.zmin + (j + 0.5) * NC - z) ** 2 < r * r) around[j * NW + i] |= bit;
  };
  const FOOD = new Set(['food_court', 'restaurant', 'cafe', 'fast_food', 'marketplace', 'bar', 'pub']);
  for (const p of city.pois) if (FOOD.has(p.k)) stamp(p.x, p.z, 28, 1);
  for (let i = 0; i < ctx.shopFronts.length; i += 2) stamp(ctx.shopFronts[i], ctx.shopFronts[i + 1], 16, 2);
  const aroundAt = (x, z) => { const i = Math.floor((x - M.xmin) / NC), j = Math.floor((z - M.zmin) / NC); return i < 0 || j < 0 || i >= NW || j >= NH ? 0 : around[j * NW + i]; };

  // open paving: ground mask B 255 plaza, 220 sidewalk, 150 the apron round buildings (200 is a car park)
  const paved = (x, z) => { const b = maskAt(x, z, 2); return b >= 140 && (b < 190 || b >= 215); };

  // ---- open paving: eating out near food and shopfronts, planters and benches elsewhere
  // (an integer hash per cell: ~600k cells, a sine-based one cost more than everything placed)
  const cellHash = (i, j, k) => { let v = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x2545f491); v = Math.imul(v ^ (v >>> 15), 0x85ebca6b); v ^= v >>> 13; v = Math.imul(v, 0xc2b2ae35); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
  const S = 6.5, NI = Math.floor((M.xmax - M.xmin) / S), NJ = Math.floor((M.zmax - M.zmin) / S);
  for (let j = 0; j < NJ; j++) for (let i = 0; i < NI; i++) {
    const h = cellHash(i, j, 1); if (h >= 0.3) continue; // (no cell above that gets anything)
    const x = M.xmin + (i + 0.5) * S, z = M.zmin + (j + 0.5) * S;
    const px = x + (cellHash(i, j, 2) - 0.5) * S * 0.5, pz = z + (cellHash(i, j, 3) - 0.5) * S * 0.5;
    if (!paved(px, pz)) continue;
    const a = aroundAt(px, pz), food = (a & 1) > 0, shops = (a & 2) > 0;
    if ((food || shops) && h < (food ? 0.3 : 0.2)) {
      // a few tables in a loose row, some under an umbrella; now and then a pushcart beside them
      if (occAt(px, pz) >= 110 || !roadsClear(px, pz, -2.6)) continue; // (every table of the row would be too close to a road)
      const yaw = hash(px, pz) * Math.PI, ux = Math.sin(yaw + Math.PI / 2), uz = Math.cos(yaw + Math.PI / 2);
      const n = 2 + Math.floor(hash(pz, px) * 3);
      for (let k = 0; k < n; k++) {
        const tx = px + ux * (k - (n - 1) / 2) * 2.5, tz = pz + uz * (k - (n - 1) / 2) * 2.5, hk = hash(tx, tz);
        if (!offWalls(tx, tz, 2.0) || !free(tx, tz, 1.15)) continue;
        put('kopitiam', tx, tz, yaw + hk, hk, 1.0, false);
        if (hk < 0.4) put('umbrella', tx, tz, hk * 6, hk * 2.5, 0, false);
      }
      if (h < 0.06 && offWalls(px + uz * 2.6, pz - ux * 2.6, 2.0) && free(px + uz * 2.6, pz - ux * 2.6, 1.1)) put('cart', px + uz * 2.6, pz - ux * 2.6, yaw, h * 9, 1.0, true);
    } else if (h < (maskAt(px, pz, 2) >= 250 ? 0.11 : 0.06)) {
      const yaw = Math.round(hash(pz, x) * 4) * Math.PI / 2;
      if (!offWalls(px, pz, 2.0) || !free(px, pz, 1.2)) continue;
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
    put('pot', f[0], f[1], h * 9, h * 3.5, 0, false, 0.12); // (on the five-foot-way's raised floor)
  }
  for (const [x, z, yaw] of ctx.shopGoods) {
    const h = hash(x * 2.1, z * 1.3); if (h > 0.35) continue;
    put('goods', x, z, yaw, h * 2.8, 0, false, 0.12);
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
      if (occAt(x, z) >= 110 || maskAt(x, z) < 200 || !roadsClear(x, z, -3.5) || landmark(x, z, 0)) return false;
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
    if (!linkClear(best.ax + ux * 3.5, best.az + uz * 3.5, best.bx - ux * 3.5, best.bz - uz * 3.5)) continue;
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
      if (occAt(px, pz) >= 110 || maskAt(px, pz) < 200 || maskAt(px, pz, 2) === 200 || landmark(px, pz, 0)) return false;
    }
    return roadsClear(x, z, Math.hypot(hx, hz) - 2.4);
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
