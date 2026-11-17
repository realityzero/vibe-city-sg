// Where can Tommy (or a car) be put down? Respawns, fast travel and long teleports go through here so nobody lands
// inside a building (back-face-culled walls read as flat cardboard and the colliders trap you), in a courtyard, in the
// water or inside a collider. A point is clear when it is outside every ground-level building footprint (grid-indexed
// from city.json; courtyard holes count as inside — they're usually unreachable), on land, and the occupant's shape
// (a person, or the actual vehicle's collider) overlaps nothing. Pedestrian spots must also connect to a sidewalk on
// foot. Otherwise the nearest clear point along the network wins; null if there is none.
import * as THREE from 'three';
import { FILTER } from '../physics/physics.js';

const CELL = 40, S = 2.5; // building index cell; walkability grid step (global, so flood results can be shared)

export class SafeSpots {
  constructor(game) {
    this.game = game;
    this.grid = new Map();
    this.B = [];
    for (const b of game.city.data.buildings) {
      if ((b.m || 0) > 2.2 || b.h < 2.5) continue; // canopies, link bridges and raised blocks leave the ground walkable
      const p = b.p; let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
      const k = this.B.push({ p, x0, z0, x1, z1 }) - 1;
      for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++)
        for (let gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++) {
          const key = gx * 100003 + gz; let a = this.grid.get(key); if (!a) this.grid.set(key, a = []); a.push(k);
        }
    }
    const R = game.physics.R;
    this.person = new R.Ball(0.45);
    this._q = { x: 0, y: 0, z: 0, w: 1 }; this._q0 = { x: 0, y: 0, z: 0, w: 1 };
    this.memo = new Map();
  }

  insideBuilding(x, z, pad = 0.7) {
    const seen = this._seen || (this._seen = new Set()); seen.clear();
    for (let gx = Math.floor((x - pad) / CELL); gx <= Math.floor((x + pad) / CELL); gx++)
      for (let gz = Math.floor((z - pad) / CELL); gz <= Math.floor((z + pad) / CELL); gz++) {
        const a = this.grid.get(gx * 100003 + gz); if (!a) continue;
        for (const k of a) {
          if (seen.has(k)) continue; seen.add(k);
          const b = this.B[k];
          if (x < b.x0 - pad || x > b.x1 + pad || z < b.z0 - pad || z > b.z1 + pad) continue;
          if (pip(x, z, b.p) || pip(x + pad, z, b.p) || pip(x - pad, z, b.p) || pip(x, z + pad, b.p) || pip(x, z - pad, b.p)) return true;
        }
      }
    return false;
  }

  /** vehicle: a Vehicle (its own collider shape is tested where Player.teleport would put it) or false */
  clear(x, z, { vehicle = false, yaw = 0, pad } = {}) {
    const g = this.game;
    if (g.city.isWater(x, z) || this.insideBuilding(x, z, pad ?? (vehicle ? 2.2 : 0.7))) return false;
    let hit = false;
    const q = this._q; q.y = Math.sin(yaw / 2); q.w = Math.cos(yaw / 2);
    const col = vehicle?.collider;
    const shape = col ? col.shape : this.person;
    const y = col ? 0.3 + (col.translationWrtParent()?.y ?? 1) : 1.0;
    g.physics.world.intersectionsWithShape({ x, y, z }, q, shape, () => { hit = true; return false; }, undefined, FILTER.char, col || undefined);
    return !hit;
  }

  /** can a pedestrian walk from (x,z) to a sidewalk? Flood fill over a global 2.5 m grid, every step swept with the
   * body shape (a thin wall between two clear cells blocks it). `cache` shares results between calls of one search:
   * a successful flood marks everything it reached as connected, an exhausted one as enclosed. */
  reachesSidewalk(x, z, cache = new Map(), maxCells = 1400) {
    const ci = Math.round(x / S), cj = Math.round(z / S), start = ci * 100003 + cj;
    if (cache.has(start)) return cache.get(start);
    const goal = new Set();
    for (const sw of this.game.roadnet.sidewalksNear(x, z, 90)) {
      const P = sw.path;
      for (let i = 0; i < P.n - 1; i++) {
        const ax = P.x(i), az = P.z(i), bx = P.x(i + 1), bz = P.z(i + 1), L = Math.hypot(bx - ax, bz - az);
        for (let s = 0; s <= L; s += S) { const t = L ? s / L : 0; goal.add(Math.round((ax + (bx - ax) * t) / S) * 100003 + Math.round((az + (bz - az) * t) / S)); }
      }
    }
    const W = this.game.physics.world, vel = { x: 0, y: 0, z: 0 };
    const seen = new Set([start]), q = [start];
    let result = null;
    for (let h = 0; h < q.length; h++) {
      if (h >= maxCells) { result = undefined; break; }
      const k = q[h];
      if (goal.has(k) || cache.get(k) === true) { result = true; break; }
      const i = Math.round(k / 100003), j = k - i * 100003;
      if (Math.abs(i - ci) >= 28 || Math.abs(j - cj) >= 28) { result = true; break; } // open ground for 70 m: a park
      for (const [di, dj] of DIRS) {
        const n = (i + di) * 100003 + (j + dj);
        if (seen.has(n)) continue;
        seen.add(n);
        if (cache.get(n) === false) continue;
        if (!this.clear((i + di) * S, (j + dj) * S, { pad: 0.35 })) continue;
        vel.x = di * S; vel.z = dj * S;
        if (W.castShape({ x: i * S, y: 1, z: j * S }, this._q0, vel, this.person, 0, 1, true, undefined, FILTER.char)) continue;
        q.push(n);
      }
    }
    if (result === null) result = false; // exhausted: an enclosed pocket
    if (result !== undefined) for (const k of q) cache.set(k, result);
    return !!result;
  }

  /** nearest clear point to `pos` (a new Vector3), or null if there's none within `radius` */
  find(pos, { vehicle = false, yaw = 0, radius = 220, pad } = {}) {
    const key = `${Math.round(pos.x)},${Math.round(pos.z)},${vehicle ? vehicle.type || 'v' : 'p'},${pad}`;
    const hit = this.memo.get(key);
    if (hit && this.clear(hit.x, hit.z, { vehicle, yaw, pad })) return hit.clone();
    const r = this._find(pos, { vehicle, yaw, radius, pad });
    if (r && !vehicle) { if (this.memo.size > 200) this.memo.clear(); this.memo.set(key, r.clone()); }
    return r;
  }

  _find(pos, { vehicle, yaw, radius, pad }) {
    const out = new THREE.Vector3(pos.x, 0, pos.z), reach = new Map();
    const ok = (x, z) => this.clear(x, z, { vehicle, yaw, pad }) && (vehicle || this.reachesSidewalk(x, z, reach));
    if (ok(pos.x, pos.z)) return out;
    // open ground right next to the target first (plazas, parks: Gardens by the Bay has no sidewalks for 200 m)
    for (let r = 3; r <= 110; r += r < 40 ? 3 : 6) for (let a = 0, na = r < 40 ? 16 : 32; a < na; a++) {
      const x = pos.x + Math.cos((a + r * 0.37) / na * Math.PI * 2) * r, z = pos.z + Math.sin((a + r * 0.37) / na * Math.PI * 2) * r;
      if (ok(x, z)) return out.set(x, 0, z);
    }
    // then every 3 m along nearby sidewalks (or lane centres for vehicles), nearest first
    const net = this.game.roadnet, C = [];
    const lines = vehicle ? net.lanesNear(pos.x, pos.z, radius).map(l => l.path) : net.sidewalksNear(pos.x, pos.z, radius).map(s => s.path);
    for (const P of lines) for (let i = 0; i < P.n - 1; i++) {
      const ax = P.x(i), az = P.z(i), bx = P.x(i + 1), bz = P.z(i + 1), L = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s <= L; s += 3) { const t = L ? s / L : 0, x = ax + (bx - ax) * t, z = az + (bz - az) * t; C.push([x, z, (x - pos.x) ** 2 + (z - pos.z) ** 2]); }
    }
    C.sort((a, b) => a[2] - b[2]);
    for (let i = 0; i < Math.min(C.length, 600); i++) if (this.clear(C[i][0], C[i][1], { vehicle, yaw, pad })) return out.set(C[i][0], 0, C[i][1]);
    // nothing along the network: spiral outwards
    for (let r = 4; r <= radius; r += 4) for (let a = 0; a < 16; a++) {
      const x = pos.x + Math.cos(a / 16 * Math.PI * 2) * r, z = pos.z + Math.sin(a / 16 * Math.PI * 2) * r;
      if (ok(x, z)) return out.set(x, 0, z);
    }
    return null;
  }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function pip(x, z, p) {
  let c = false;
  for (let i = 0, n = p.length / 2, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
  }
  return c;
}
