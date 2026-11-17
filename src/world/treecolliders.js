// Tree trunks are solid around the player: a pool of static cylinders follows Tommy (60,000 trees can't all live in
// the physics world). They sit a little ahead of a fast car so it meets the trunk, not the leaves. Group PROP: cars
// and Tommy hit them, wheel rays and the camera ray don't (a trunk sweeping through the camera ray would jolt the view).
import { G, groups } from '../physics/physics.js';

export const CELL = 40; // m, grid cell of the tree lookup (also used by core/occluders.js)

export class TreeColliders {
  constructor(game, veg, { pool = 150, radius = 50 } = {}) {
    this.game = game; this.veg = veg; this.radius = radius;
    this.grid = new Map();
    for (let i = 0; i < veg.count; i++) {
      const k = Math.floor(veg.pos[i * 2] / CELL) * 100003 + Math.floor(veg.pos[i * 2 + 1] / CELL);
      let a = this.grid.get(k); if (!a) this.grid.set(k, a = []); a.push(i);
    }
    const P = game.physics, R = P.R;
    this.pool = [];
    for (let i = 0; i < pool; i++) {
      const c = P.world.createCollider(R.ColliderDesc.cylinder(1.8, 0.3).setTranslation(0, -500 - i * 4, 0)
        .setFriction(0.6).setCollisionGroups(groups(G.PROP, G.VEHICLE | G.CHAR)));
      this.pool.push({ c, tree: -1, parked: true });
    }
    this.at = new Map(); // tree index -> pool slot
    this.t = 0; this.cx = 1e9; this.cz = 1e9;
    this._cand = [];
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
    const veg = this.veg, r = this.radius, C = this._cand; C.length = 0;
    for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++)
      for (let gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++) {
        const a = this.grid.get(gx * 100003 + gz); if (!a) continue;
        for (const i of a) { const d = Math.hypot(veg.pos[i * 2] - x, veg.pos[i * 2 + 1] - z); if (d < r) C.push(i, d); }
      }
    // nearest first (pairs: index, distance)
    const order = []; for (let k = 0; k < C.length; k += 2) order.push(k);
    order.sort((a, b) => C[a + 1] - C[b + 1]);
    const want = new Set(); for (let k = 0; k < Math.min(order.length, this.pool.length); k++) want.add(C[order[k]]);
    // free slots whose tree left the set, then place the newcomers
    const free = [];
    for (const s of this.pool) if (s.tree < 0 || !want.has(s.tree)) { if (s.tree >= 0) this.at.delete(s.tree); s.tree = -1; free.push(s); }
    for (const i of want) {
      if (this.at.has(i)) continue;
      const s = free.pop(); if (!s) break;
      const sc = veg.scale[i];
      s.c.setRadius(Math.min(0.55, Math.max(0.14, 0.17 * sc)));
      s.c.setTranslation({ x: veg.pos[i * 2], y: 1.8, z: veg.pos[i * 2 + 1] });
      s.tree = i; s.parked = false; this.at.set(i, s);
    }
    for (const s of free) if (s.tree < 0 && !s.parked) { s.c.setTranslation({ x: 0, y: -500, z: 0 }); s.parked = true; }
  }
}
