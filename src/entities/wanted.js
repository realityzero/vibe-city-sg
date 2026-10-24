// Wanted level (SPF police): heat from crimes, pursuing patrol cars with a simple pursuit driver, busted logic.
import * as THREE from 'three';
import { Vehicle } from './vehicle.js';
import { Aircraft } from './aircraft.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _f = new THREE.Vector3();

class PoliceUnit {
  constructor(game, pos, yaw) {
    this.game = game;
    this.v = new Vehicle(game, 'police', { position: pos, yaw });
    this.v.sirenOn = true; this.v.driver = 'ai';
    this.v.locked = true;
    game.vehicles.push(this.v);
    if (game.audio?.createEngine) this.v.engine = game.audio.createEngine({ type: 'police' });
    this.stuck = 0; this.reverseT = 0;
  }
  update(dt, target, targetVel) {
    const v = this.v;
    const pos = v.position;
    _a.copy(target).addScaledVector(targetVel, Math.min(1.2, pos.distanceTo(target) / 30));
    _b.subVectors(_a, pos); _b.y = 0;
    const dist = _b.length();
    _f.set(0, 0, -1).applyQuaternion(v.quaternion); _f.y = 0; _f.normalize();
    let ang = Math.atan2(_f.x * _b.z - _f.z * _b.x, _f.x * _b.x + _f.z * _b.z); // + = target to the right
    // obstacle avoidance
    const P = this.game.physics;
    const look = 8 + v.speed * 0.8;
    const hitL = P.raycast({ x: pos.x, y: pos.y + 0.8, z: pos.z }, new THREE.Vector3(_f.x * 0.94 - _f.z * 0.34, 0, _f.z * 0.94 + _f.x * 0.34).normalize(), look);
    const hitR = P.raycast({ x: pos.x, y: pos.y + 0.8, z: pos.z }, new THREE.Vector3(_f.x * 0.94 + _f.z * 0.34, 0, _f.z * 0.94 - _f.x * 0.34).normalize(), look);
    if (hitL && (!hitR || hitL.toi < hitR.toi)) ang -= 0.6 * (1 - hitL.toi / look);
    if (hitR && (!hitL || hitR.toi < hitL.toi)) ang += 0.6 * (1 - hitR.toi / look);
    let steer = THREE.MathUtils.clamp(-ang * 1.8, -1, 1);
    let thr = dist > 12 ? 1 : dist > 6 ? 0.4 : 0, brk = dist < 6 && v.speed > 3 ? 1 : 0;
    if (Math.abs(ang) > 1.6 && dist > 10) { thr = 0.6; }
    if (thr > 0.3 && v.speed < 1) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt);
    if (this.stuck > 1.6) { this.reverseT = 1.4; this.stuck = 0; }
    if (this.reverseT > 0) { this.reverseT -= dt; thr = 0; brk = 1; steer = -steer; }
    v.setDriverControls({ throttle: thr, brake: brk, steer, handbrake: false }, dt);
    return dist;
  }
  dispose() { const i = this.game.vehicles.indexOf(this.v); if (i >= 0) this.game.vehicles.splice(i, 1); this.v.dispose(); }
}

// SPF Air Wing: circles above the player at 3+ stars, searchlight at night
class PoliceHeli {
  constructor(game, pos) {
    this.game = game;
    this.v = new Aircraft(game, 'heli_police', { position: pos, yaw: 0 });
    this.v.driver = 'ai'; this.v.locked = true; this.v.rpm = 1;
    game.vehicles.push(this.v);
    if (game.audio?.createEngine) this.v.engine = game.audio.createEngine({ type: 'heli' });
    this.phase = Math.random() * 6;
  }
  update(dt, target) {
    const v = this.v, p = v.position;
    this.phase += dt * 0.25;
    const goal = new THREE.Vector3(target.x + Math.cos(this.phase) * 45, Math.max(target.y, 0) + 55, target.z + Math.sin(this.phase) * 45);
    const lv = v.body.linvel();
    const toT = new THREE.Vector3(goal.x - p.x, 0, goal.z - p.z);
    const want = toT.multiplyScalar(0.35); if (want.length() > 28) want.setLength(28);
    const dv = new THREE.Vector3(want.x - lv.x, 0, want.z - lv.z);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(v.quaternion); f.y = 0; f.normalize();
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const fc = THREE.MathUtils.clamp(dv.dot(f) * 0.12, -1, 1), rc = THREE.MathUtils.clamp(dv.dot(r) * 0.12, -1, 1);
    const toP = new THREE.Vector3(target.x - p.x, 0, target.z - p.z).normalize();
    const yawErr = Math.atan2(f.x * toP.z - f.z * toP.x, f.dot(toP));
    v.setDriverControls({ throttle: Math.max(0, fc), brake: Math.max(0, -fc), strafe: rc, steer: THREE.MathUtils.clamp(-yawErr * 1.5, -1, 1), up: p.y < goal.y - 3, down: p.y > goal.y + 3 }, dt);
    return p.distanceTo(target);
  }
  dispose() { const i = this.game.vehicles.indexOf(this.v); if (i >= 0) this.game.vehicles.splice(i, 1); this.v.dispose(); }
}

export class Wanted {
  constructor(game) {
    this.game = game;
    this.spot = new THREE.SpotLight(0xe8f0ff, 0, 220, 0.2, 0.6, 1);
    game.scene.add(this.spot, this.spot.target);
    this.level = 0;
    this.units = [];
    this.coolT = 0;
    this.bustT = 0;
    this.spawnT = 0;
    this.enabled = true;
    this.suppress = 0; // missions can block police temporarily
    this.buildCameras();
  }

  // Red-light / enforcement cameras (Singapore has them at busy junctions): about one in ten signalised junctions on
  // the bigger roads, on a pole at the corner. They see crimes within ~32 m.
  buildCameras() {
    const net = this.game.roadnet, cams = [];
    const h = i => { const v = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return v - Math.floor(v); };
    for (const n of net.nodes) {
      if (!n.signal || !n.edges.some(e => e.c <= 3) || h(n.id) > 0.1) continue;
      const sw = net.nearestSidewalk(n.x + 4, n.z + 4, 30);
      if (!sw) continue;
      cams.push({ x: sw.pos.x, z: sw.pos.z, r: 32 });
    }
    this.cameras = cams;
    if (!cams.length) return;
    const pole = new THREE.CylinderGeometry(0.07, 0.09, 5.2, 6).translate(0, 2.6, 0);
    const arm = new THREE.BoxGeometry(0.08, 0.08, 0.9).translate(0, 5.0, -0.4);
    const box = new THREE.BoxGeometry(0.34, 0.3, 0.62).translate(0, 4.85, -0.85);
    const geo = mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed(), box.toNonIndexed()]);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x8f969c, roughness: 0.45, metalness: 0.6 }), cams.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    cams.forEach((c, i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h(i + 7) * Math.PI * 2); m.compose(new THREE.Vector3(c.x, 0, c.z), q, new THREE.Vector3(1, 1, 1)); mesh.setMatrixAt(i, m); });
    mesh.name = 'enforcementCameras';
    this.game.scene.add(mesh);
  }

  /** Who saw a crime at `pos`? A police car, a pursuing unit or the Air Wing with a clear line of sight, or an
   * enforcement camera covering the spot — GTA rules: no witness, no stars. */
  witness(pos) {
    const P = this.game.physics, o = { x: 0, y: 0, z: 0 }, d = { x: 0, y: 0, z: 0 };
    const sees = (from, range, eye = 1.4) => {
      const dx = pos.x - from.x, dz = pos.z - from.z, dy = (pos.y + 1) - (from.y + eye), L = Math.hypot(dx, dy, dz);
      if (L > range) return false;
      if (L < 6) return true;
      o.x = from.x; o.y = from.y + eye; o.z = from.z; d.x = dx / L; d.y = dy / L; d.z = dz / L;
      const hit = P.raycast(o, d, L - 1.5); // buildings and bridges block the view
      return !hit;
    };
    for (const u of this.units) if (!u.v.exploded && sees(u.v.position, 110)) return 'police';
    if (this.heli && !this.heli.v.exploded && sees(this.heli.v.position, 260, -1.5)) return 'police';
    for (const c of this.game.traffic?.cars || []) if (c.type === 'police' && c.state === 'drive' && sees(c.pos, 75)) return 'police';
    for (const cam of this.cameras || []) if (Math.hypot(pos.x - cam.x, pos.z - cam.z) < cam.r) return 'camera';
    return null;
  }

  /** a crime: raises the wanted level only if it was witnessed (see witness()); returns who saw it */
  crime(amount, reason, pos) {
    if (!this.enabled || this.suppress > 0 || !pos) return null;
    const w = this.witness(pos);
    if (w) this.add(amount, w === 'camera' ? `${reason} — caught on an enforcement camera` : `${reason} — the police saw that`);
    return w;
  }
  get stars() { return Math.min(5, Math.floor(this.level + 1e-6)); }
  add(amount, reason) {
    if (!this.enabled || this.suppress > 0) return;
    const before = this.stars;
    this.level = Math.min(5, this.level + amount);
    this.coolT = 0;
    if (this.stars > before) { this.game.audio?.sfx?.('wanted_up'); if (reason) this.game.ui?.toast?.(`WANTED: ${reason}`); }
  }
  clear() { this.level = 0; for (const u of this.units) u.dispose(); this.units = []; this.bustT = 0; this.heli?.dispose(); this.heli = null; this.spot.intensity = 0; }

  update(dt) {
    const game = this.game, player = game.player;
    if (!player) return;
    if (this.suppress > 0) this.suppress -= dt;
    const want = this.stars === 0 ? 0 : Math.min(4, this.stars);
    // spawn units on roads around the player, out of sight
    this.spawnT -= dt;
    if (this.units.length < want && this.spawnT <= 0) {
      this.spawnT = 2.5;
      const pp = player.position;
      const lanes = game.roadnet.lanesNear(pp.x, pp.z, 260).filter(l => l.cls <= 5);
      for (let k = 0; k < 10 && lanes.length; k++) {
        const l = lanes[Math.floor(Math.random() * lanes.length)];
        const s = l.s0 + Math.random() * Math.max(1, l.s1 - l.s0);
        const p = l.path.sample(s, new THREE.Vector3(), _f);
        const d = p.distanceTo(pp);
        if (d < 110 || d > 260) continue;
        if (game.traffic.cars.some(c => c.pos.distanceTo(p) < 9) || game.vehicles.some(v => v.position.distanceTo(p) < 9)) continue;
        this.units.push(new PoliceUnit(game, p, Math.atan2(-_f.x, -_f.z)));
        break;
      }
    }
    const pv = player.vehicle;
    const tVel = new THREE.Vector3();
    if (pv) { const lv = pv.body.linvel(); tVel.set(lv.x, 0, lv.z); }
    let nearest = 1e9;
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      const d = u.update(dt, player.position, tVel);
      nearest = Math.min(nearest, d);
      if ((this.stars === 0 && d > 120) || d > 420 || u.v.health < 0) { u.dispose(); this.units.splice(i, 1); }
    }
    // air support from 3 stars
    if (this.stars >= 3 && !this.heli) {
      const pp = player.position, a = Math.random() * Math.PI * 2;
      this.heli = new PoliceHeli(game, new THREE.Vector3(pp.x + Math.cos(a) * 300, Math.max(0, pp.y) + 80, pp.z + Math.sin(a) * 300));
    }
    if (this.heli) {
      const d = this.heli.update(dt, player.position);
      const night = game.U.night.value;
      this.spot.intensity = night > 0.2 ? 900 * night : 0;
      this.spot.position.copy(this.heli.v.position).add(new THREE.Vector3(0, -1.5, 0));
      this.spot.target.position.copy(player.position);
      this.heli.v.model.setLights?.({ head: true, siren: true, spot: night > 0.2 });
      const sl = this.heli.v.model.spotlight;
      if (sl) { const tgt = player.position.clone(); const w = new THREE.Vector3(); sl.getWorldPosition(w); sl.lookAt(w.clone().multiplyScalar(2).sub(tgt)); }
      if (this.stars < 2 || this.heli.v.exploded) { this.heli.dispose(); this.heli = null; this.spot.intensity = 0; }
    }
    // cool down when no unit is close
    if (this.level > 0) {
      if (nearest > 90) { this.coolT += dt; if (this.coolT > 14) { this.level = Math.max(0, Math.floor(this.level - 0.001)); this.coolT = 0; game.audio?.sfx?.('ui_back'); } }
      else this.coolT = Math.max(0, this.coolT - dt * 2);
    }
    // busted: police close and player (nearly) stationary
    if (this.stars > 0 && nearest < 7 && player.speed < 1.6) this.bustT += dt; else this.bustT = Math.max(0, this.bustT - dt);
    if (this.bustT > (pv ? 2.5 : 1.5)) { this.bustT = 0; game.events.emit('playerBusted'); }
    this.searching = this.level > 0 && nearest > 90;
  }
}
