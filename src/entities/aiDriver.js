// AI driver for physics vehicles: follows a polyline route with look-ahead steering, curvature-based speed,
// raycast obstacle avoidance and stuck recovery. Used by race opponents and chase targets.
import * as THREE from 'three';

const _f = new THREE.Vector3(), _t = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion();

export class PathDriver {
  constructor(game, vehicle, route /* [[x,z]...] */, { loop = false, speed = 1, aggression = 1 } = {}) {
    this.game = game; this.v = vehicle; this.loop = loop; this.speedMul = speed; this.aggr = aggression;
    this.setRoute(route);
    this.stuck = 0; this.reverseT = 0; this.done = false;
  }
  setRoute(route) {
    this.route = route.map(p => new THREE.Vector2(p[0], p[1]));
    this.cum = [0];
    for (let i = 1; i < this.route.length; i++) this.cum.push(this.cum[i - 1] + this.route[i].distanceTo(this.route[i - 1]));
    this.total = this.cum[this.cum.length - 1];
    this.idx = 0; this.progress = 0; this.done = false;
  }
  pointAt(s, out = new THREE.Vector2()) {
    if (this.loop) s = ((s % this.total) + this.total) % this.total; else s = Math.min(this.total, Math.max(0, s));
    let i = 1; while (i < this.cum.length - 1 && this.cum[i] < s) i++;
    const a = this.route[i - 1], b = this.route[i]; const seg = this.cum[i] - this.cum[i - 1] || 1;
    return out.copy(a).lerp(b, (s - this.cum[i - 1]) / seg);
  }
  // project the vehicle onto the route near the previous progress
  project(px, pz) {
    let best = this.progress, bd = Infinity;
    const lo = Math.max(0, this.idx - 2), hi = Math.min(this.route.length - 1, this.idx + 12);
    for (let i = lo; i < hi; i++) {
      const a = this.route[i], b = this.route[i + 1]; const dx = b.x - a.x, dz = b.y - a.y, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.y) * dz) / L2));
      const d = Math.hypot(a.x + dx * t - px, a.y + dz * t - pz);
      if (d < bd) { bd = d; best = this.cum[i] + Math.sqrt(L2) * t; this.idx = i; }
    }
    if (this.loop && this.idx >= this.route.length - 3) { /* wrap handled by lap logic in caller */ }
    this.progress = best; this.offRoute = bd;
    return best;
  }
  update(dt) {
    const v = this.v; if (!v || v.exploded) return;
    // steer from the simulated body (this runs inside the fixed step; the drawn root is interpolated, a step behind)
    const bt = v.body.translation(), br = v.body.rotation();
    const pos = _p.set(bt.x, bt.y, bt.z);
    const s = this.project(pos.x, pos.z);
    if (!this.loop && s >= this.total - 4) { this.done = true; v.setDriverControls({ throttle: 0, brake: 1, steer: 0, handbrake: false }, dt); return; }
    const sp = Math.max(0, v.forwardSpeed);
    const look = 7 + sp * 0.55;
    const tgt = this.pointAt(s + look);
    _f.set(0, 0, -1).applyQuaternion(_q.set(br.x, br.y, br.z, br.w)); _f.y = 0; _f.normalize();
    _t.set(tgt.x - pos.x, 0, tgt.y - pos.z);
    let ang = Math.atan2(_f.x * _t.z - _f.z * _t.x, _f.x * _t.x + _f.z * _t.z);
    // curvature ahead -> target speed
    const p1 = this.pointAt(s + look + 15), p2 = this.pointAt(s + look + 35);
    const a1 = Math.atan2(p1.y - tgt.y, p1.x - tgt.x), a2 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    let curv = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
    const vmax = v.spec.maxSpeed * this.speedMul;
    const target = Math.min(vmax, 8 + (1.2 - Math.min(1.2, curv)) * vmax * 0.8) * (0.85 + 0.15 * this.aggr);
    // obstacle avoidance
    const P = this.game.physics;
    const o = { x: pos.x, y: pos.y + 0.8, z: pos.z };
    const L = 6 + sp * 0.6;
    const dl = new THREE.Vector3(_f.x * 0.95 - _f.z * 0.3, 0, _f.z * 0.95 + _f.x * 0.3).normalize();
    const dr = new THREE.Vector3(_f.x * 0.95 + _f.z * 0.3, 0, _f.z * 0.95 - _f.x * 0.3).normalize();
    const hl = P.raycast(o, dl, L), hr = P.raycast(o, dr, L);
    if (hl) ang -= 0.5 * (1 - hl.toi / L);
    if (hr) ang += 0.5 * (1 - hr.toi / L);
    let steer = THREE.MathUtils.clamp(-ang * 2.0, -1, 1);
    let thr = sp < target ? 1 : 0, brk = sp > target + 3 ? 1 : 0;
    if (Math.abs(ang) > 1.2) { thr = 0.5; }
    if (thr > 0.5 && sp < 1.0) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 0.5);
    if (this.stuck > 1.5) { this.reverseT = 1.2; this.stuck = 0; }
    if (this.reverseT > 0) { this.reverseT -= dt; thr = 0; brk = 1; steer = -steer; }
    v.setDriverControls({ throttle: thr, brake: brk, steer, handbrake: false }, dt);
  }
}
