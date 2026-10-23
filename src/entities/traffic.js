// AI traffic: cars follow lanes (left-hand traffic), obey signals, keep distance (IDM), yield at junctions,
// react to the player, get knocked about (switch to dynamic physics), and stream in/out around the player.
import * as THREE from 'three';
import { FILTER } from '../physics/physics.js';
import { VEHICLE_SPECS, pickTrafficType, TrafficRenderer } from './vehicles/index.js';

const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _k = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _m = new THREE.Matrix4();
const _lights = { head: false, brake: false, siren: false };
const UP = new THREE.Vector3(0, 1, 0);

let carIds = 0;
export class Traffic {
  constructor(game, { target = 90, radius = 340 } = {}) {
    this.game = game;
    this.net = game.roadnet;
    this.target = target;
    this.radius = radius;
    this.cars = [];
    this.renderer = new TrafficRenderer(game.scene, { maxPerType: 72 });
    this.obstacles = []; // {x, z, r} dynamic obstacles (player, peds)
    this.spawnTimer = 0;
    this.enabled = true;
    game.physics.onStep(h => this.fixedStep(h));
  }

  pickNext(lane) {
    let opts = lane.next; if (!opts.length) return null;
    const open = opts.filter(o => !o.lane.closed); if (open.length) opts = open;
    // prefer going straight on bigger roads
    let tot = 0; const w = opts.map(o => { const s = Math.abs(o.turn) < 0.5 ? 3 : 1; const c = o.lane.cls <= lane.cls ? 1.5 : 1; const v = s * c; tot += v; return v; });
    let r = Math.random() * tot; for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i]; }
    return opts[0];
  }

  spawnAt(lane, s, type = pickTrafficType(), color) {
    const spec = VEHICLE_SPECS[type];
    if (!spec) return null;
    color ??= spec.colours[Math.floor(Math.random() * spec.colours.length)];
    const P = this.game.physics, R = P.R;
    lane.path.sample(s, _p, _d);
    const yaw = Math.atan2(-_d.x, -_d.z);
    const body = P.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(_p.x, _p.y, _p.z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }));
    const hh = spec.height / 2 * 0.9;
    const col = P.world.createCollider(R.ColliderDesc.cuboid(spec.width / 2 * 0.92, hh, spec.length / 2 * 0.95).setTranslation(0, hh + 0.15, 0).setCollisionGroups(FILTER.traffic).setFriction(0.4)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(2000).setMass(spec.mass), body);
    const car = {
      id: carIds++, type, color, spec, body, collider: col, lane, s, mode: 'lane', conn: null, cs: 0,
      speed: Math.min(lane.speed, 8 + Math.random() * 6), vmax: lane.speed * (0.8 + Math.random() * 0.3), len: spec.length,
      pos: _p.clone(), yaw, wheelSpin: 0, steer: 0, brake: false, wait: 0, honkT: 0, state: 'drive', rid: this.renderer.add(type, color),
      siren: type === 'police' && Math.random() < 0.15,
    };
    car.nextConn = this.pickNext(lane);
    lane.cars.push(car);
    this.cars.push(car);
    P.contactHandlers.set(col.handle, (other, force) => this.onHit(car, other, force));
    return car;
  }

  fixedStep(h) {
    for (const c of this.cars) {
      if (c.state !== 'drive' || !c.kv) continue;
      c.kt += h;
      _k.copy(c.pos).addScaledVector(c.kv, c.kt);
      c.body.setNextKinematicTranslation(_k);
      c.body.setNextKinematicRotation(c.kq);
    }
  }

  despawn(car) {
    const P = this.game.physics;
    if (car.lane) { const i = car.lane.cars.indexOf(car); if (i >= 0) car.lane.cars.splice(i, 1); }
    if (car.connNode) car.connNode.occ.delete(car);
    P.contactHandlers.delete(car.collider.handle);
    P.world.removeRigidBody(car.body);
    this.renderer.remove(car.rid);
    const i = this.cars.indexOf(car); if (i >= 0) this.cars.splice(i, 1);
  }

  onHit(car, other, force) {
    if (car.state === 'wreck') return;
    const player = this.game.player;
    const pv = player?.vehicle;
    if (pv && other === pv.collider.handle && force > 8000) this.wreck(car);
  }

  wreck(car) {
    if (car.state === 'wreck') return;
    const P = this.game.physics, R = P.R;
    car.state = 'wreck'; car.wreckT = 0;
    if (car.lane) { const i = car.lane.cars.indexOf(car); if (i >= 0) car.lane.cars.splice(i, 1); }
    if (car.connNode) car.connNode.occ.delete(car);
    car.body.setBodyType(R.RigidBodyType.Dynamic, true);
    car.body.setLinearDamping(0.6); car.body.setAngularDamping(1.2);
    const v = car.speed; _d.set(-Math.sin(car.yaw), 0, -Math.cos(car.yaw)).multiplyScalar(v);
    car.body.setLinvel({ x: _d.x, y: 0, z: _d.z }, true);
    car.collider.setCollisionGroups(FILTER.vehicle);
    this.game.events?.emit('trafficWreck', car);
    if (Math.random() < 0.6) this.game.audio?.sfx?.('horn', { position: car.pos, volume: 0.8 });
  }

  /** remove a car from AI and hand its state to the caller (carjacking) */
  take(car) {
    const st = { type: car.type, color: car.color, position: car.pos.clone(), yaw: car.yaw, speed: car.state === 'drive' ? car.speed : 0 };
    if (car.state === 'wreck') { const t = car.body.translation(); st.position.set(t.x, t.y, t.z); const r = car.body.rotation(); _q.set(r.x, r.y, r.z, r.w); _e.setFromQuaternion(_q); st.yaw = _e.y; }
    this.despawn(car);
    return st;
  }

  nearestCar(pos, maxD = 5) {
    let best = null, bd = maxD;
    for (const c of this.cars) { const d = c.pos.distanceTo(pos); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  // distance ahead along the car's route to the nearest blocking thing
  leaderGap(car) {
    let gap = 1e9, leaderSpeed = 0;
    const half = car.len / 2;
    if (car.mode === 'lane') {
      for (const o of car.lane.cars) {
        if (o === car || o.mode !== 'lane') continue;
        const d = o.s - car.s - half - o.len / 2;
        if (d > -1.5 && d < gap) { gap = d; leaderSpeed = o.speed; }
      }
      // cars in the connector / start of next lane
      const remain = car.lane.s1 - car.s;
      if (remain < 40 && car.nextConn) {
        const nl = car.nextConn.lane;
        for (const o of nl.cars) { if (o.mode !== 'lane') continue; const d = remain + car.nextConn.path.length + (o.s - nl.s0) - half - o.len / 2; if (d < gap) { gap = d; leaderSpeed = o.speed; } }
        for (const o of this.net.nodes[car.lane.to].occ || []) { if (o.conn === car.nextConn) { const d = remain + o.cs - half - o.len / 2; if (d < gap) { gap = d; leaderSpeed = o.speed; } } }
        // signals
        const sig = this.net.signalFor(car.lane);
        if (sig === 'red' || (sig === 'amber' && remain > car.speed * 1.2)) { const d = remain - half - 1; if (d < gap) { gap = Math.max(0, d); leaderSpeed = 0; } }
        // unsignalised junction: yield if occupied by crossing traffic
        if (sig === 'none' && this.net.nodes[car.lane.to].degree >= 3) {
          const node = this.net.nodes[car.lane.to];
          for (const o of node.occ || []) if (o.fromLane !== car.lane && o.conn?.lane !== car.nextConn.lane && car.wait < 4) { const d = remain - half - 0.5; if (d < gap) { gap = Math.max(0, d); leaderSpeed = 0; } break; }
        }
      }
    } else {
      const remain = car.conn.path.length - car.cs;
      for (const o of this.net.nodes[car.connNodeId].occ) { if (o !== car && o.conn === car.conn && o.cs > car.cs) { const d = o.cs - car.cs - half - o.len / 2; if (d < gap) { gap = d; leaderSpeed = o.speed; } } }
      const nl = car.conn.lane;
      for (const o of nl.cars) { if (o.mode !== 'lane') continue; const d = remain + (o.s - nl.s0) - half - o.len / 2; if (d < gap) { gap = d; leaderSpeed = o.speed; } }
    }
    // dynamic obstacles (player, pedestrians) in a forward cone
    const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
    for (const ob of this.obstacles) {
      const dx = ob.x - car.pos.x, dz = ob.z - car.pos.z;
      const ahead = dx * fx + dz * fz; if (ahead < 0 || ahead > 35) continue;
      const lat = Math.abs(dx * -fz + dz * fx);
      if (lat < 1.3 + (ob.r || 0.5)) { const d = ahead - half - (ob.r || 0.5) - 0.8; if (d < gap) { gap = Math.max(0, d); leaderSpeed = 0; car.blockedByPlayer = ob.player; } }
    }
    const r = this._lg || (this._lg = { gap: 0, leaderSpeed: 0 }); r.gap = gap; r.leaderSpeed = leaderSpeed; // reused: callers destructure immediately
    return r;
  }

  update(dt) {
    if (!this.enabled) return;
    const net = this.net;
    if (!this._occInit) { for (const n of net.nodes) if (!n.occ) n.occ = new Set(); this._occInit = true; }
    net.updateSignals(dt);
    const pp = this.game.player?.position || this.game.camera.position;
    // spawn / despawn
    this.spawnTimer -= dt;
    this.recenter = (this.recenter || 0) - dt; // after a relocation: seed the new area at once (behind the fade)
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.08;
      let active = 0; for (const c of this.cars) if (c.state === 'drive') active++;
      // after a teleport / at start, seed the area immediately (nobody is watching yet)
      const seeding = this.recenter > 0 || active < this.target * 0.35;
      if (active < this.target) {
        const lanes = net.lanesNear(pp.x, pp.z, this.radius).filter(l => l.cls <= 5 && l.s1 - l.s0 > 20 && !l.closed);
        // prefer bigger roads: they carry more traffic
        for (let k = 0; k < (seeding ? 30 : 6) && lanes.length; k++) {
          const l = lanes[Math.floor(Math.random() * lanes.length)];
          if (l.cls >= 5 && Math.random() < 0.5) continue;
          const s = l.s0 + Math.random() * (l.s1 - l.s0);
          l.path.sample(s, _p);
          const d = Math.hypot(_p.x - pp.x, _p.z - pp.z);
          if (d < (seeding ? 25 : 60) || d > this.radius) continue;
          if (l.cars.some(o => Math.abs(o.s - s) < 14)) continue;
          if (!seeding && d < 180 && this.inView(_p)) continue;
          this.spawnAt(l, s);
          if (!seeding) break;
        }
      }
    }
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      const d = Math.hypot(c.pos.x - pp.x, c.pos.z - pp.z);
      if (d > this.radius + 60 && !c.keep) { this.despawn(c); continue; }
      if (c.state === 'wreck') {
        c.wreckT += dt;
        const t = c.body.translation(), r = c.body.rotation();
        c.pos.set(t.x, t.y, t.z); _q.set(r.x, r.y, r.z, r.w);
        this.renderer.setTransform(c.rid, c.pos, _q, c.wheelSpin, 0, { head: this.game.U.night.value > 0.3, brake: false, siren: false });
        if (c.wreckT > 60 && d > 120) this.despawn(c);
        continue;
      }
      this.drive(c, dt);
    }
    this.renderer.update(dt);
  }

  inView(p) {
    const cam = this.game.camera; _d.subVectors(p, cam.position); const f = this._f || (this._f = new THREE.Vector3()); cam.getWorldDirection(f);
    return _d.normalize().dot(f) > 0.45;
  }

  drive(c, dt) {
    const { gap, leaderSpeed } = this.leaderGap(c);
    // IDM
    const v0 = c.mode === 'conn' ? Math.min(c.vmax, 9 - Math.min(5, Math.abs(c.conn.turn) * 3)) : c.vmax;
    const a = 2.2, b = 3.5, s0 = 2.2, T = 1.2;
    const dv = c.speed - leaderSpeed;
    const sStar = s0 + c.speed * T + c.speed * dv / (2 * Math.sqrt(a * b));
    let acc = a * (1 - Math.pow(c.speed / Math.max(1, v0), 4) - Math.pow(Math.max(0, sStar) / Math.max(0.1, gap), 2));
    acc = Math.max(-9, acc);
    c.speed = Math.max(0, c.speed + acc * dt);
    if (gap < 0.3) c.speed = Math.min(c.speed, 0.5);
    c.brake = acc < -1 || c.speed < 0.2;
    if (c.speed < 0.3) c.wait += dt; else c.wait = 0;
    // horn when the player blocks
    if (c.blockedByPlayer && c.wait > 2.5 && (c.honkT -= dt) <= 0) { c.honkT = 3 + Math.random() * 3; this.game.audio?.sfx?.('horn', { position: c.pos, volume: 0.7 }); }
    c.blockedByPlayer = false;
    const ds = c.speed * dt;
    if (c.mode === 'lane') {
      c.s += ds;
      if (c.s >= c.lane.s1) {
        const over = c.s - c.lane.s1;
        const conn = c.nextConn || this.pickNext(c.lane);
        const i = c.lane.cars.indexOf(c); if (i >= 0) c.lane.cars.splice(i, 1);
        if (!conn) { this.despawn(c); return; }
        c.mode = 'conn'; c.conn = conn; c.cs = over; c.fromLane = c.lane; c.connNodeId = c.lane.to;
        c.connNode = this.net.nodes[c.lane.to]; c.connNode.occ.add(c);
      }
    } else {
      c.cs += ds;
      if (c.cs >= c.conn.path.length) {
        const nl = c.conn.lane;
        c.connNode.occ.delete(c); c.connNode = null;
        c.mode = 'lane'; c.lane = nl; c.s = nl.s0 + (c.cs - c.conn.path.length); c.conn = null;
        nl.cars.push(c);
        c.vmax = nl.speed * (0.8 + Math.random() * 0.3);
        c.nextConn = this.pickNext(nl);
      }
    }
    // pose
    if (c.mode === 'lane') c.lane.path.sample(c.s, _p, _d); else c.conn.path.sample(c.cs, _p, _d);
    const yaw = Math.atan2(-_d.x, -_d.z);
    let dy = yaw - c.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    c.steer = THREE.MathUtils.clamp(dy / Math.max(dt, 1e-3) * 0.12, -0.5, 0.5);
    c.yaw += dy * Math.min(1, dt * 10);
    c.pos.copy(_p);
    const pitch = Math.asin(THREE.MathUtils.clamp(_d.y, -0.3, 0.3));
    _e.set(pitch, c.yaw, 0, 'YXZ'); _q.setFromEuler(_e);
    // the collider follows in fixedStep(): per physics step along this velocity (a frame with two steps or none would
    // otherwise give the kinematic body 0 / 2x its real speed, and side-swipes would feel random)
    (c.kv || (c.kv = new THREE.Vector3())).copy(_d).multiplyScalar(c.speed); c.kt = 0;
    (c.kq || (c.kq = new THREE.Quaternion())).copy(_q);
    c.wheelSpin -= ds / (c.spec.wheelRadius || 0.33);
    const L = _lights; L.head = this.game.U.night.value > 0.3; L.brake = c.brake; L.siren = c.siren;
    this.renderer.setTransform(c.rid, c.pos, _q, c.wheelSpin, c.steer, L);
  }
}
