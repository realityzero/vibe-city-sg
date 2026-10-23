// Arcade helicopter (and delivery drone): rotor spin-up, collective lift, attitude PD controller (tilt to move),
// yaw rate control, ground effect, crash damage. Fly it over the OSM-built city.
import * as THREE from 'three';
import { FILTER, PoseInterp } from '../physics/physics.js';
import { WATER_LEVEL } from '../core/constants.js';
import { VEHICLE_SPECS, createVehicleModel } from './vehicles/index.js';

const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();

const FALLBACK = {
  heli: { name: 'Vibe Air Maverick', kind: 'heli', length: 12, width: 2.6, height: 3.4, mass: 1600, maxSpeed: 62, liftPower: 1.35, maxClimb: 9, yawRate: 1.5, engineSound: 'heli', seats: [{ x: 0.45, y: 1.0, z: -1.2 }] },
  heli_police: { name: 'SPF Air Wing', kind: 'heli', length: 12, width: 2.6, height: 3.4, mass: 1700, maxSpeed: 66, liftPower: 1.4, maxClimb: 10, yawRate: 1.6, engineSound: 'heli', seats: [{ x: 0.45, y: 1.0, z: -1.2 }] },
  drone: { name: 'DurianDash Drone', kind: 'drone', length: 1.6, width: 1.6, height: 0.6, mass: 25, maxSpeed: 22, liftPower: 1.5, maxClimb: 7, yawRate: 2.4, engineSound: 'drone', seats: [{ x: 0, y: 0.3, z: 0 }] },
};

function fallbackModel(spec) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.35, metalness: 0.3 });
  const cab = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), mat); cab.scale.set(1, 0.9, 1.6); cab.position.set(0, 1.6, -0.8); g.add(cab);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 6, 8), mat); boom.rotation.x = Math.PI / 2; boom.position.set(0, 1.9, 3.2); g.add(boom);
  const main = new THREE.Group(); main.position.set(0, 2.9, -0.6);
  for (let i = 0; i < 4; i++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.04, 5.5), new THREE.MeshStandardMaterial({ color: 0x222222 })); bl.rotation.y = i * Math.PI / 2; bl.position.set(0, 0, 0); main.add(bl); }
  g.add(main);
  const tail = new THREE.Group(); tail.position.set(0.3, 2.2, 6.1);
  for (let i = 0; i < 2; i++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.4, 0.15), new THREE.MeshStandardMaterial({ color: 0x222222 })); bl.rotation.x = i * Math.PI / 2; tail.add(bl); }
  g.add(tail);
  return { root: g, rotors: { main, tail }, setLights() { }, update() { }, dispose() { } };
}

export class Aircraft {
  constructor(game, type, { position, yaw = 0, color } = {}) {
    this.game = game; this.type = type; this.isAircraft = true;
    this.spec = { ...(FALLBACK[type] || FALLBACK.heli), ...(VEHICLE_SPECS[type] || {}) };
    const s = this.spec;
    try { this.model = createVehicleModel(type, { color, lod: 'high' }); } catch { this.model = fallbackModel(s); }
    if (!this.model.rotors) this.model.rotors = fallbackModel(s).rotors;
    this.root = this.model.root;
    this.root.position.set(position.x, position.y, position.z); this.root.rotation.set(0, yaw, 0);
    this.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    game.scene.add(this.root);
    this.health = 1000; this.exploded = false; this.driver = null; this.locked = false;
    this.rpm = 0; this.speed = 0; this.forwardSpeed = 0; this.grace = 1.5;
    this.ctl = { pitch: 0, roll: 0, yaw: 0, lift: 0 };
    const P = game.physics, R = P.R;
    this.body = P.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(position.x, position.y + 0.2, position.z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }).setLinearDamping(0.15).setAngularDamping(2.5).setCcdEnabled(true).setCanSleep(false));
    this.pose = new PoseInterp(this.body, THREE);
    const drone = s.kind === 'drone';
    const hx = drone ? 0.7 : 1.1, hy = drone ? 0.25 : 1.1, hz = drone ? 0.7 : 2.4;
    this.collider = P.world.createCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(0, hy + 0.05, drone ? 0 : -0.4)
      .setFriction(0.8).setRestitution(0.05).setCollisionGroups(FILTER.vehicle)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(s.mass * 6)
      .setMassProperties(s.mass, { x: 0, y: hy * 0.7, z: 0 }, { x: s.mass * (hy * hy + hz * hz) / 3, y: s.mass * (hx * hx + hz * hz) / 3, z: s.mass * (hx * hx + hy * hy) / 3 }, { x: 0, y: 0, z: 0, w: 1 }), this.body);
    if (!drone) { // tail boom
      P.world.createCollider(R.ColliderDesc.cuboid(0.25, 0.3, 2.6).setTranslation(0, 1.9, 4.2).setCollisionGroups(FILTER.vehicle).setMass(1), this.body);
    }
    P.contactHandlers.set(this.collider.handle, (other, force) => this.onImpact(other, force));
    this.inertia = s.mass * (hx * hx + hz * hz) / 3;
  }
  get position() { return this.root.position; }
  get quaternion() { return this.root.quaternion; }
  yaw() { const f = _v.set(0, 0, -1).applyQuaternion(this.root.quaternion); return Math.atan2(-f.x, -f.z); }
  get altitude() { return this.root.position.y; }

  setDriverControls(c, dt) {
    const k = Math.min(1, dt * 5);
    this.ctl.pitch += ((c.throttle || 0) - (c.brake || 0) - this.ctl.pitch) * k;
    this.ctl.roll += ((c.strafe || 0) - this.ctl.roll) * k;
    this.ctl.yaw += ((c.steer || 0) - this.ctl.yaw) * k;
    this.ctl.lift = (c.up ? 1 : 0) - (c.down ? 1 : 0);
    this.powered = !!this.driver && !this.exploded;
  }

  physicsStep(dt) {
    const s = this.spec, b = this.body;
    b.resetForces(false); b.resetTorques(false);
    if (this.grace > 0) this.grace -= dt;
    this.rpm += ((this.powered ? 1 : 0) - this.rpm) * Math.min(1, dt * (this.powered ? 0.45 : 0.25));
    const t = b.translation(), r = b.rotation(); _q.set(r.x, r.y, r.z, r.w);
    const lv = b.linvel(), av = b.angvel();
    this.speed = Math.hypot(lv.x, lv.y, lv.z);
    _u.set(0, 1, 0).applyQuaternion(_q);           // body up (rotor thrust axis)
    _f.set(0, 0, -1).applyQuaternion(_q);          // body forward
    this.forwardSpeed = lv.x * _f.x + lv.z * _f.z;
    if (t.y < WATER_LEVEL + 0.5) { // ditched in the bay
      b.addForce({ x: -lv.x * s.mass, y: s.mass * 9.81 * 0.6 - lv.y * s.mass, z: -lv.z * s.mass }, true);
      this.rpm *= 0.95; this.ditched = true;
    }
    if (this.rpm < 0.05) return;
    const m = s.mass, g = 9.81;
    // collective: hover + climb/descend, with a soft ceiling and ground effect
    const groundH = Math.max(0, t.y); // approx (no terrain)
    const ge = 1 + 0.15 * Math.max(0, 1 - groundH / 6);
    const vyTarget = this.ctl.lift * s.maxClimb;
    const ceiling = Math.max(0, 1 - Math.max(0, t.y - 520) / 120);
    const liftMag = Math.max(0, (m * g + (vyTarget - lv.y) * m * 1.6) * ge) * this.rpm * ceiling / Math.max(0.35, _u.y);
    b.addForce({ x: _u.x * liftMag, y: _u.y * liftMag, z: _u.z * liftMag }, true);
    // extra forward assist so it feels responsive (arcade)
    const assist = m * 3.2 * this.rpm;
    const fh = _v.set(_f.x, 0, _f.z).normalize();
    _r.set(-fh.z, 0, fh.x);
    b.addForce({ x: (fh.x * this.ctl.pitch + _r.x * this.ctl.roll) * assist, y: 0, z: (fh.z * this.ctl.pitch + _r.z * this.ctl.roll) * assist }, true);
    // drag (top speed)
    const k = m * 0.012;
    b.addForce({ x: -lv.x * Math.abs(lv.x) * k, y: -lv.y * Math.abs(lv.y) * k * 2, z: -lv.z * Math.abs(lv.z) * k }, true);
    // attitude: desired pitch/roll from stick, PD towards it; yaw rate from A/D
    const maxTilt = s.kind === 'drone' ? 0.45 : 0.32;
    const desiredUp = new THREE.Vector3(0, 1, 0).addScaledVector(fh, this.ctl.pitch * Math.tan(maxTilt)).addScaledVector(_r, this.ctl.roll * Math.tan(maxTilt) - this.ctl.yaw * 0.12 * Math.min(1, this.speed / 15)).normalize();
    const err = new THREE.Vector3().crossVectors(_u, desiredUp);
    const I = this.inertia;
    b.addTorque({ x: (err.x * 18 - av.x * 4.5) * I * this.rpm, y: ((this.ctl.yaw * s.yawRate) - av.y) * I * 4 * this.rpm, z: (err.z * 18 - av.z * 4.5) * I * this.rpm }, true);
  }

  onImpact(other, force) {
    if (this.grace > 0) return;
    const dmg = Math.max(0, force / (this.spec.mass * 9.81) - 5) * 7;
    if (dmg > 3) {
      this.health -= dmg;
      this.game.audio?.sfx?.(dmg > 60 ? 'crash_heavy' : 'crash_light', { position: this.root.position, volume: Math.min(1, dmg / 80) });
      this.game.events?.emit?.('vehicleImpact', { vehicle: this, damage: dmg, other });
      if (this.health < 0 && !this.exploded) this.explode();
    }
  }
  explode() {
    this.exploded = true; this.rpm = 0;
    this.game.audio?.sfx?.('explosion', { position: this.root.position });
    this.game.fx?.explosion?.(this.root.position);
    if (this.driver === 'player') this.game.events.emit('playerDied', 'crashed');
  }

  sync(dt) {
    this.pose.apply(this.root, this.game.physics.alpha);
    const rot = this.model.rotors;
    if ('rotorSpeed' in this.model) this.model.rotorSpeed = this.rpm * (this.spec.kind === 'drone' ? 120 : 44);
    else if (rot) {
      const spin = this.rpm * dt * (this.spec.kind === 'drone' ? 90 : 38);
      if (rot.main) rot.main.rotation.y += spin;
      if (rot.tail) rot.tail.rotation.x += spin * 1.6;
      if (rot.props) for (const [i, p] of rot.props.entries()) p.rotation.y += spin * (i % 2 ? 1 : -1);
    }
    this.model.setLights?.({ head: (this.game.U?.night.value ?? 0) > 0.3, siren: this.type === 'heli_police' });
    this.model.update?.(dt);
    if (this.engine) this.engine.update({ rpm: this.rpm * (0.8 + 0.2 * Math.abs(this.ctl.lift)), throttle: this.rpm, speed: this.speed, position: this.root.position, skid: 0 });
  }
  doorPosition(out = new THREE.Vector3()) { return out.set(this.spec.width / 2 + 1.2, 0, -0.8).applyQuaternion(this.root.quaternion).add(this.root.position); }
  flipUpright() { const t = this.body.translation(); const yaw = this.yaw(); this.body.setTranslation({ x: t.x, y: t.y + 1, z: t.z }, true); this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true); this.body.setAngvel({ x: 0, y: 0, z: 0 }, true); this.pose.snap(); }
  dispose() {
    const P = this.game.physics;
    P.contactHandlers.delete(this.collider.handle);
    P.world.removeRigidBody(this.body);
    this.game.scene.remove(this.root);
    this.model.dispose?.(); this.engine?.dispose?.();
  }
}
