// Boats & jet skis: Rapier rigid body floating on multi-point buoyancy, anisotropic water drag, stern thrust,
// rudder yaw, banking in turns, spray. Getting out steps onto the quay when one is alongside, else over the side.
import * as THREE from 'three';
import { FILTER, PoseInterp } from '../physics/physics.js';
import { WATER_LEVEL } from '../core/constants.js';
import { VEHICLE_SPECS, createVehicleModel } from './vehicles/index.js';
import { U } from '../gfx/globals.js';

const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _p = new THREE.Vector3();

const FALLBACK = {
  jetski: { name: 'Jet Ski', kind: 'boat', length: 3.2, width: 1.2, height: 1.1, mass: 380, maxSpeed: 26, enginePower: 7000, draft: 0.35, turnRate: 1.6, engineSound: 'jetski', seats: [{ x: 0, y: 0.5, z: 0.3 }] },
  speedboat: { name: 'Squalo', kind: 'boat', length: 9, width: 2.6, height: 1.8, mass: 2600, maxSpeed: 30, enginePower: 30000, draft: 0.6, turnRate: 0.9, engineSound: 'boat', seats: [{ x: 0.5, y: 0.6, z: 0.5 }] },
  bumboat: { name: 'River Bumboat', kind: 'boat', length: 11, width: 3.2, height: 2.8, mass: 7000, maxSpeed: 9, enginePower: 22000, draft: 0.8, turnRate: 0.5, engineSound: 'boat', seats: [{ x: 0, y: 0.7, z: 4.2 }] },
};

function fallbackModel(spec) {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(spec.width, spec.height * 0.6, spec.length), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.3, metalness: 0.2 }));
  hull.position.y = spec.height * 0.1; g.add(hull);
  return { root: g, wheels: [], setLights() { }, update() { }, dispose() { } };
}

export class Boat {
  constructor(game, type, { position, yaw = 0, color } = {}) {
    this.game = game;
    this.type = type;
    this.isBoat = true;
    this.spec = { ...(FALLBACK[type] || FALLBACK.speedboat), ...(VEHICLE_SPECS[type] || {}) };
    const s = this.spec;
    try { this.model = createVehicleModel(type, { color, lod: 'high' }); } catch { this.model = fallbackModel(s); }
    this.root = this.model.root;
    this.root.position.set(position.x, WATER_LEVEL, position.z); this.root.rotation.set(0, yaw, 0);
    this.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    game.scene.add(this.root);
    this.health = 1000; this.exploded = false; this.driver = null; this.locked = false;
    this.speed = 0; this.forwardSpeed = 0; this.throttle = 0; this.steer = 0; this.grace = 1;
    const P = game.physics, R = P.R;
    this.body = P.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(position.x, WATER_LEVEL + 0.2, position.z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }).setLinearDamping(0.1).setAngularDamping(1.5).setCcdEnabled(true));
    this.pose = new PoseInterp(this.body, THREE);
    const hx = s.width / 2 * 0.9, hz = s.length / 2 * 0.92, hh = Math.max(0.3, s.height * 0.3);
    this.half = { hx, hz, hh };
    this.collider = P.world.createCollider(R.ColliderDesc.cuboid(hx, hh, hz).setTranslation(0, hh - s.draft, 0)
      .setFriction(0.3).setRestitution(0.1).setCollisionGroups(FILTER.vehicle)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(s.mass * 8)
      .setMassProperties(s.mass, { x: 0, y: -s.draft * 0.6, z: 0 }, { x: s.mass * (hh * hh + hz * hz) / 3, y: s.mass * (hx * hx + hz * hz) / 3, z: s.mass * (hx * hx + hh * hh) / 3 }, { x: 0, y: 0, z: 0, w: 1 }), this.body);
    P.contactHandlers.set(this.collider.handle, (other, force) => this.onImpact(other, force));
    // buoyancy sample points (local): hull bottom grid
    this.pts = [];
    for (const fx of [-0.8, 0.8]) for (const fz of [-0.85, 0, 0.85]) this.pts.push(new THREE.Vector3(fx * hx, -s.draft, fz * hz));
    this.spray = 0;
  }
  get position() { return this.root.position; }
  get quaternion() { return this.root.quaternion; }
  yaw() { const f = _v.set(0, 0, -1).applyQuaternion(this.root.quaternion); return Math.atan2(-f.x, -f.z); }
  waveHeight(x, z, t) { return Math.sin(x * 0.11 + t * 1.3) * 0.06 + Math.sin(z * 0.17 - t * 1.7) * 0.05 + Math.sin((x + z) * 0.31 + t * 2.3) * 0.03; }

  setDriverControls(c, dt) {
    this.throttle = this.exploded ? 0 : (c.throttle || 0) - (c.brake || 0) * 0.45;
    const target = (c.steer || 0);
    this.steer += (target - this.steer) * Math.min(1, dt * 4);
  }

  physicsStep(dt) {
    const s = this.spec, b = this.body;
    b.resetForces(false); b.resetTorques(false);
    if (this.grace > 0) this.grace -= dt;
    const t = b.translation(), r = b.rotation(); _q.set(r.x, r.y, r.z, r.w);
    const lv = b.linvel(), av = b.angvel();
    const time = U.time.value;
    const g = 9.81, perPt = s.mass * g / this.pts.length;
    let submerged = 0;
    for (const lp of this.pts) {
      _p.copy(lp).applyQuaternion(_q).add(t);
      const depth = WATER_LEVEL + this.waveHeight(_p.x, _p.z, time) - _p.y;
      if (depth <= 0) continue;
      submerged++;
      // point velocity = v + w x r
      _w.subVectors(_p, t);
      const pvx = lv.x + av.y * _w.z - av.z * _w.y, pvy = lv.y + av.z * _w.x - av.x * _w.z, pvz = lv.z + av.x * _w.y - av.y * _w.x;
      const f = perPt * Math.min(2.5, 1.25 * depth / s.draft) - pvy * perPt * 0.25;
      b.addForceAtPoint({ x: -pvx * perPt * 0.01, y: f, z: -pvz * perPt * 0.01 }, { x: _p.x, y: _p.y, z: _p.z }, true);
    }
    this.inWaterFrac = submerged / this.pts.length;
    const fwd = _v.set(0, 0, -1).applyQuaternion(_q); fwd.y = 0; fwd.normalize();
    const right = _w.set(-fwd.z, 0, fwd.x);
    const vf = lv.x * fwd.x + lv.z * fwd.z, vr = lv.x * right.x + lv.z * right.z;
    this.forwardSpeed = vf; this.speed = Math.hypot(lv.x, lv.z);
    if (submerged) {
      const k = this.inWaterFrac;
      // anisotropic drag: boats slide forward easily, resist sideways
      const df = -vf * Math.abs(vf) * s.mass * 0.012 - vf * s.mass * 0.05;
      const dr = -vr * s.mass * 1.6;
      b.addForce({ x: (fwd.x * df + right.x * dr) * k, y: 0, z: (fwd.z * df + right.z * dr) * k }, true);
      // stern thrust
      const top = Math.max(0, 1 - Math.pow(Math.max(0, vf) / s.maxSpeed, 2));
      const thrust = this.throttle * s.enginePower * (this.throttle > 0 ? top : 1) * k;
      b.addForce({ x: fwd.x * thrust, y: 0, z: fwd.z * thrust }, true);
      // rudder: yaw torque scales with speed (and a little at standstill for jet skis)
      const steerAuth = Math.min(1, Math.abs(vf) / 6) + (this.type === 'jetski' ? 0.3 : 0.1);
      const yawRate = this.steer * s.turnRate * steerAuth * Math.sign(vf || 1);
      const inertia = s.mass * (this.half.hx ** 2 + this.half.hz ** 2) / 3;
      b.addTorque({ x: 0, y: (yawRate - av.y) * inertia * 3, z: 0 }, true);
      // keep upright and bank into turns: tilt the desired up-vector towards the inside of the turn
      const bank = this.steer * Math.min(1, Math.abs(vf) / 10) * 0.3;
      const upB = new THREE.Vector3(0, 1, 0).applyQuaternion(_q);
      const upD = new THREE.Vector3(-right.x * bank, 1, -right.z * bank).normalize();
      const tq = new THREE.Vector3().crossVectors(upB, upD).multiplyScalar(inertia * 6);
      b.addTorque({ x: tq.x, y: 0, z: tq.z }, true);
    }
    this.spray = submerged ? Math.min(1, this.speed / 12) : 0;
  }

  onImpact(other, force) {
    if (this.grace > 0) return;
    const dmg = Math.max(0, force / (this.spec.mass * 9.81) - 8) * 4;
    if (dmg > 3) { this.health -= dmg; this.game.audio?.sfx?.(dmg > 50 ? 'crash_heavy' : 'wave_slap', { position: this.root.position, volume: Math.min(1, dmg / 60) }); this.game.events?.emit?.('vehicleImpact', { vehicle: this, damage: dmg, other }); }
  }

  sync(dt) {
    this.pose.apply(this.root, this.game.physics.alpha);
    this.model.setLights?.({ head: (this.game.U?.night.value ?? 0) > 0.3 });
    this.model.update?.(dt);
    if (this.engine) this.engine.update({ rpm: 0.2 + 0.8 * Math.min(1, Math.abs(this.throttle) * 0.6 + this.speed / this.spec.maxSpeed * 0.6), throttle: Math.abs(this.throttle), speed: this.speed, position: this.root.position, skid: this.spray * 0.3 });
  }

  // nearest dry land spot to step onto (null when there's none alongside: Tommy goes over the side and swims)
  // (solid ground only: the physics height field is conservative, so the drawn waterline can be ~4 m ahead of it)
  shoreSpot(maxD = 11) {
    const c = this.game.city, p = this.root.position, P = this.game.physics;
    for (let r = 1.5; r <= maxD; r += 1.5) for (let a = 0; a < 16; a++) {
      const x = p.x + Math.cos(a / 16 * Math.PI * 2) * r, z = p.z + Math.sin(a / 16 * Math.PI * 2) * r;
      if (c.isWater(x, z) || c.isWater(x + (x - p.x) * 0.15, z + (z - p.z) * 0.15)) continue;
      const h = P.raycast({ x, y: 6, z }, { x: 0, y: -1, z: 0 }, 12);
      if (h && h.point.y > -0.25) return new THREE.Vector3(x, h.point.y, z);
    }
    return null;
  }
  doorPosition(out = new THREE.Vector3()) { const s = this.shoreSpot(); return s ? out.copy(s) : out.copy(this.root.position); }
  flipUpright() { const t = this.body.translation(); const yaw = this.yaw(); this.body.setTranslation({ x: t.x, y: WATER_LEVEL + 0.3, z: t.z }, true); this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true); this.pose.snap(); }
  dispose() {
    const P = this.game.physics;
    P.contactHandlers.delete(this.collider.handle);
    P.world.removeRigidBody(this.body);
    this.game.scene.remove(this.root);
    this.model.dispose?.(); this.engine?.dispose?.();
  }
}
