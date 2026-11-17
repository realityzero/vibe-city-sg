// Tree trunks are solid around the player: a pool of static cylinders follows Tommy (60,000 trees can't all live in
// the physics world). They sit a little ahead of a fast car so it meets the trunk, not the leaves. Group PROP: cars
// and Tommy hit them, wheel rays and the camera ray don't (a trunk sweeping through the camera ray would jolt the view).
// Street furniture (city.furniture.obstacles, from the city builder's streetscape.js) shares the job: the sturdy pieces
// (planters, benches, pushcarts, bike racks, stone tables) get cylinders from a second pool, and every piece is
// something people walk round (trunkNear).
import { G, groups } from '../physics/physics.js';

export const CELL = 40; // m, grid cell of the tree lookup (also used by core/occluders.js)
const cellKey = (x, z) => Math.floor(x / CELL) * 100003 + Math.floor(z / CELL);

export class TreeColliders {
  constructor(game, veg, { pool = 150, furniturePool = 40, radius = 50 } = {}) {
    this.game = game; this.veg = veg; this.radius = radius;
    this.grid = new Map();
    for (let i = 0; i < veg.count; i++) {
      const k = cellKey(veg.pos[i * 2], veg.pos[i * 2 + 1]);
      let a = this.grid.get(k); if (!a) this.grid.set(k, a = []); a.push(i);
    }
    this.furn = game.city.furniture?.obstacles || new Float32Array(0); // (x, z, radius, solid) per piece
    this.fGrid = new Map();
    for (let i = 0; i < this.furn.length; i += 4) {
      const k = cellKey(this.furn[i], this.furn[i + 1]);
      let a = this.fGrid.get(k); if (!a) this.fGrid.set(k, a = []); a.push(i);
    }
    const P = game.physics, R = P.R;
    const make = (n, halfH, y0) => Array.from({ length: n }, (_, i) => ({
      c: P.world.createCollider(R.ColliderDesc.cylinder(halfH, 0.3).setTranslation(0, y0 - i * 4, 0).setFriction(0.6).setCollisionGroups(groups(G.PROP, G.VEHICLE | G.CHAR))),
      item: -1, parked: true,
    }));
    this.trees = { pool: make(pool, 1.8, -500), at: new Map() };
    this.pieces = { pool: make(furniturePool, 0.5, -900), at: new Map() }; // (knee-to-waist high: a planter, a bench)
    this.t = 0; this.cx = 1e9; this.cz = 1e9;
    this._cand = [];
  }

  /** is a tree trunk within r of (x,z), or street furniture in the way? (any tree or piece, collider or not: for
   * placing and steering people; r is a person's clearance from a trunk, ~1 m, and furniture counts with its own
   * footprint radius plus what r leaves over the trunk's) */
  trunkNear(x, z, r) {
    const pos = this.veg.pos, F = this.furn, pad = Math.max(0.3, r - 0.6);
    for (let gx = Math.floor((x - r - 2) / CELL); gx <= Math.floor((x + r + 2) / CELL); gx++)
      for (let gz = Math.floor((z - r - 2) / CELL); gz <= Math.floor((z + r + 2) / CELL); gz++) {
        const a = this.grid.get(gx * 100003 + gz);
        if (a) for (const i of a) if (Math.hypot(pos[i * 2] - x, pos[i * 2 + 1] - z) < r) return true;
        const f = this.fGrid.get(gx * 100003 + gz);
        if (f) for (const i of f) if (Math.hypot(F[i] - x, F[i + 1] - z) < F[i + 2] + pad) return true;
      }
    return false;
  }

  update(dt) {
    this.t -= dt;
    const p = this.game.player, v = p.vehicle;
    if (!p || (v && (v.isBoat || v.isAircraft))) return;
    // centre slightly ahead of a moving car
    let x = p.position.x, z = p.position.z;
    if (v) { const lv = v.body.linvel(); x += lv.x * 0.6; z += lv.z * 0.6; }
    if (this.t > 0 && Math.hypot(x - this.cx, z - this.cz) < 6) return;
    this.t = 0.2; this.cx = x; this.cz = z;
    const veg = this.veg, F = this.furn;
    this._fill(this.trees, this.grid, x, z, i => veg.pos[i * 2], i => veg.pos[i * 2 + 1], i => Math.min(0.55, Math.max(0.14, 0.17 * veg.scale[i])), 1.8);
    this._fill(this.pieces, this.fGrid, x, z, i => (F[i + 3] > 0 ? F[i] : NaN), i => F[i + 1], i => Math.min(1.1, F[i + 2] * 0.8), 0.5);
  }

  // give the nearest items (x(i) NaN: skip) a cylinder each from the set's pool, park the rest
  _fill(set, grid, x, z, ix, iz, ir, y) {
    const r = this.radius, C = this._cand; C.length = 0;
    for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++)
      for (let gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++) {
        const a = grid.get(gx * 100003 + gz); if (!a) continue;
        for (const i of a) { const d = Math.hypot(ix(i) - x, iz(i) - z); if (d < r) C.push(i, d); }
      }
    // nearest first (pairs: index, distance)
    const order = []; for (let k = 0; k < C.length; k += 2) order.push(k);
    order.sort((a, b) => C[a + 1] - C[b + 1]);
    const want = new Set(); for (let k = 0; k < Math.min(order.length, set.pool.length); k++) want.add(C[order[k]]);
    // free slots whose item left the set, then place the newcomers
    const free = [];
    for (const s of set.pool) if (s.item < 0 || !want.has(s.item)) { if (s.item >= 0) set.at.delete(s.item); s.item = -1; free.push(s); }
    for (const i of want) {
      if (set.at.has(i)) continue;
      const s = free.pop(); if (!s) break;
      s.c.setRadius(ir(i));
      s.c.setTranslation({ x: ix(i), y, z: iz(i) });
      s.item = i; s.parked = false; set.at.set(i, s);
    }
    for (const s of free) if (s.item < 0 && !s.parked) { s.c.setTranslation({ x: 0, y: -500, z: 0 }); s.parked = true; }
  }
}
