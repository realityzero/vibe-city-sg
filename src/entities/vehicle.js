// Drivable vehicle: Rapier ray-cast vehicle controller + procedural model sync, damage, water, lights.
import * as THREE from 'three';
import { FILTER, PoseInterp } from '../physics/physics.js';
import { WATER_LEVEL } from '../core/constants.js';
import { VEHICLE_SPECS, createVehicleModel } from './vehicles/index.js';

const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export class Vehicle {
  constructor(game, type, { position, yaw = 0, color, velocity, model } = {}) {
    this.game = game;
    this.type = type;
    this.spec = VEHICLE_SPECS[type] || VEHICLE_SPECS.sedan;
    const s = this.spec;
    this.model = model || createVehicleModel(type, { color, lod: 'high' });
    this.root = this.model.root;
    this.root.position.set(position.x, position.y + 0.15, position.z);
    this.root.rotation.set(0, yaw, 0);
    game.scene.add(this.root);
    this.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // durability varies by model and a little per car (some taxis have seen things)
    this.maxHealth = Math.round((s.hp || 1700) * (0.88 + Math.random() * 0.27));
    this.health = this.maxHealth;
    this.onFire = 0;
    this.exploded = false;
    this.driver = null;
    this.sirenOn = false;
    this.lightsOn = false;
    this.steer = 0;
    this.throttle = 0; this.brake = 0;
    this.rpm = 0; this.gear = 1;
    this.skid = 0;
    this.inWater = 0;
    this.lastImpact = 0;
    this.grace = 1.2; // ignore spawn-overlap impacts

    const P = game.physics, R = P.R;
    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y + 0.15, position.z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setLinearDamping(0.05).setAngularDamping(0.8).setCcdEnabled(true).setCanSleep(true);
    this.body = P.world.createRigidBody(bodyDesc);
    this.pose = new PoseInterp(this.body, THREE);
    if (velocity) this.body.setLinvel(velocity, true);
    const isBike = this.isBike = type === 'bike' || type === 'bike_grub';
    const clearance = s.wheelRadius * (isBike ? 0.8 : 1.05);
    const hh = Math.max(0.25, (s.height - clearance) / 2 * 0.86);
    const hx = s.width / 2 * (isBike ? 0.6 : 0.94), hz = s.length / 2 * 0.95;
    // centre of mass low between the axles (setMassProperties takes it in the collider's frame, which sits clearance+hh up)
    const colY = clearance + hh;
    const comY = isBike ? 0.42 : type === 'bus' ? 1.15 : type === 'lorry' ? 0.8 : s.wheelRadius + 0.12;
    this.inertia = { pitch: s.mass * (hh * hh + hz * hz) / 3, yaw: s.mass * (hx * hx + hz * hz) / 3, roll: s.mass * (hx * hx + hh * hh) / 3 };
    const cd = R.ColliderDesc.cuboid(hx, hh, hz).setTranslation(0, colY, 0)
      .setFriction(0.35).setRestitution(0.05).setCollisionGroups(FILTER.vehicle)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(s.mass * 6)
      .setMassProperties(s.mass, { x: 0, y: comY - colY, z: 0 }, { x: this.inertia.pitch, y: this.inertia.yaw, z: this.inertia.roll }, { x: 0, y: 0, z: 0, w: 1 });
    this.collider = P.world.createCollider(cd, this.body);
    P.contactHandlers.set(this.collider.handle, (other, force) => this.onImpact(other, force));

    // wheels
    const vc = this.vc = P.world.createVehicleController(this.body);
    vc.setIndexForwardAxis = 2;
    const heavy = type === 'bus' || type === 'lorry';
    this.restLen = isBike ? 0.25 : (heavy ? 0.38 : 0.3);
    const wr = s.wheelRadius;
    const connY = wr + this.restLen * 0.75;
    const tw = isBike ? 0.18 : s.track / 2, wb = s.wheelBase / 2;
    this.wheelPos = [[tw, -wb], [-tw, -wb], [tw, wb], [-tw, wb]];
    for (const [x, z] of this.wheelPos) vc.addWheel({ x, y: connY, z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, this.restLen, wr);
    // Rapier scales spring/damper by chassis mass: stiffness 32 on four wheels ~ a 1.8 Hz heave mode; damping near 0.9
    // of critical so kerbs and throttle/brake transfers settle in one bounce instead of wobbling
    const stiff = heavy ? 50 : type === 'infernus' ? 40 : 32;
    const damp = heavy ? [6.4, 7.0] : type === 'infernus' ? [5.8, 6.2] : [5.0, 5.5];
    this.baseSlip = 1.9 * s.grip;
    for (let i = 0; i < 4; i++) {
      vc.setWheelSuspensionStiffness(i, stiff);
      vc.setWheelSuspensionCompression(i, damp[0]);
      vc.setWheelSuspensionRelaxation(i, damp[1]);
      vc.setWheelMaxSuspensionForce(i, s.mass * 9.81 * 1.6);
      vc.setWheelMaxSuspensionTravel(i, heavy ? 0.26 : isBike ? 0.16 : 0.18);
      vc.setWheelFrictionSlip(i, this.baseSlip);
      vc.setWheelSideFrictionStiffness(i, 0.85);
    }
    this.connY = connY;
    this.spin = [0, 0, 0, 0];
    this.speed = 0;
    this.forwardSpeed = 0;
    this.engine = null;
    // driver inputs (set any time by player/AI) and their smoothed values (advanced per physics step)
    this.ctl = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.thrIn = 0; this.revIn = 0; this.hbIn = 0; this.revHold = 0; this.support = 0; this.yawSign = 1;
    this._f = new THREE.Vector3(); this._r = new THREE.Vector3(); this._u = new THREE.Vector3(); this._w = new THREE.Vector3(); this._a = new THREE.Vector3();
  }

  get position() { return this.root.position; }
  get quaternion() { return this.root.quaternion; }

  /** store the driver's wishes; they are applied (ramped, rate-limited) every fixed physics step */
  setDriverControls(c /* {throttle, brake, steer, handbrake} */) {
    const k = this.ctl;
    k.throttle = c.throttle || 0; k.brake = c.brake || 0; k.steer = c.steer || 0; k.handbrake = !!c.handbrake;
  }

  _applyControls(h) {
    const s = this.spec, vc = this.vc, c = this.ctl;
    const approach = (x, goal, rate) => x + THREE.MathUtils.clamp(goal - x, -rate * h, rate * h);
    const dead = this.exploded || this.inWater > 0.5;
    const fwd = this.forwardSpeed, sp = Math.abs(fwd);
    // steering: lock limited by a lateral-acceleration budget (keyboard taps at 100 km/h no longer ask the tyres for
    // 8 g), slower at speed, returns to centre faster than it turns in
    const lock = Math.min(s.steerMax, Math.atan(13 * s.grip * s.wheelBase / Math.max(20, sp * sp)) * (this.isBike ? 1.2 : 1));
    const target = THREE.MathUtils.clamp(c.steer, -1, 1) * lock;
    const rate = THREE.MathUtils.lerp(2.4, 0.9, THREE.MathUtils.clamp(sp / 35, 0, 1)) * (Math.abs(target) < Math.abs(this.steer) ? 1.7 : 1);
    this.steer = approach(this.steer, target, rate);
    vc.setWheelSteering(0, this.steer); vc.setWheelSteering(1, this.steer);
    // pedals ramp in over ~0.2 s (no instant torque step), release quicker
    const thrGoal = dead ? 0 : c.throttle, revGoal = dead ? 0 : c.brake;
    // parked cars are allowed to sleep (continuous forces don't wake them); any driver input does
    if ((thrGoal > 0 || revGoal > 0 || c.steer) && this.body.isSleeping()) this.body.wakeUp();
    this.thrIn = approach(this.thrIn, thrGoal, thrGoal > this.thrIn ? 5 : 9);
    this.revIn = approach(this.revIn, revGoal, revGoal > this.revIn ? 7 : 10);
    this.hbIn = approach(this.hbIn, c.handbrake ? 1 : 0, c.handbrake ? 8 : 3);
    let engine = 0, brake = 0;
    // reverse only after coming (nearly) to rest and holding S briefly; braking wins when both pedals are down
    this.revHold = revGoal > 0 && fwd < 0.35 ? this.revHold + h : 0;
    if (this.revIn > 0.01 && fwd > 0.35) brake = s.brake * this.revIn;
    else if (this.revIn > 0.01 && this.revHold > 0.2 && !(thrGoal > 0)) engine = -s.enginePower * 0.55 * this.revIn * Math.max(0, 1 - Math.max(0, -fwd) / 14);
    if (this.thrIn > 0.01 && !brake && engine >= 0) {
      if (fwd < -0.35) brake = s.brake * 0.6 * this.thrIn;
      else {
        const top = Math.max(0, 1 - Math.pow(Math.max(0, fwd) / s.maxSpeed, 2.2));
        const launch = 1.25 - 0.25 * THREE.MathUtils.smoothstep(sp, 4, 10);
        engine = s.enginePower * this.thrIn * top * launch;
      }
    }
    if (thrGoal > 0 && revGoal > 0) { engine = 0; brake = Math.max(brake, s.brake * this.revIn); } // both pedals: brake
    if (!engine && !brake) brake = s.brake * 0.04; // rolling resistance / engine braking
    this.throttle = this.thrIn; this.brake = brake > s.brake * 0.2 ? 1 : 0; this.reversing = engine < 0;
    // controller forward is +z, so forward drive = negative force. Brakes are impulses (N·s per step).
    const front = this.type === 'infernus' || this.type === 'stinger' ? 0.25 : 0.5;
    for (let i = 0; i < 4; i++) {
      const rear = i >= 2;
      const cut = brake > 0 || (rear && this.hbIn > 0.02);
      vc.setWheelEngineForce(i, cut ? 0 : -engine * (rear ? 1 - front : front) / 2);
      vc.setWheelBrake(i, (brake / 4 + (rear ? this.hbIn * s.brake * 0.35 : 0)) * h);
      if (rear) vc.setWheelFrictionSlip(i, this.baseSlip * (1 - 0.5 * this.hbIn));
    }
    this.handbrake = this.hbIn > 0.5 ? 1 : 0;
  }

  physicsStep(h) {
    const body = this.body;
    // Rapier user forces persist across steps: clear them before re-applying this step's forces
    body.resetForces(false); body.resetTorques(false);
    if (this.grace > 0) this.grace -= h;
    // longitudinal (signed) and horizontal speed from the chassis frame: the controller's own speed is the signed
    // magnitude of the whole velocity, which flips sign in a slide and counts vertical motion
    const r = body.rotation(); _q.set(r.x, r.y, r.z, r.w);
    const f = this._f.set(0, 0, -1).applyQuaternion(_q); f.y = 0; f.normalize();
    const v = body.linvel();
    this.forwardSpeed = v.x * f.x + v.z * f.z;
    this.speed = Math.hypot(v.x, v.z);
    this._applyControls(h);
    this.vc.updateVehicle(h, undefined, FILTER.wheels);
    let contacts = 0;
    for (let i = 0; i < 4; i++) if (this.vc.wheelIsInContact(i)) contacts++;
    const grounded = this.grounded = contacts > 0;
    this.support += (contacts / 4 - this.support) * (1 - Math.exp(-h / 0.08));
    const sleeping = body.isSleeping();
    if (grounded && !sleeping) {
      // a little aero downforce, faded in with wheel support (no step when one wheel touches down)
      const down = Math.min(5, 0.002 * this.speed * this.speed) * this.support;
      if (down > 0.01) body.addForce({ x: 0, y: -this.spec.mass * down, z: 0 }, false);
      const av = body.angvel();
      if (this.isBike) {
        // motorbike balance: PD on roll toward a lean set by steering x speed, and on pitch (anti-wheelie/stoppie);
        // gains are accelerations, scaled by the real roll/pitch inertia and capped so it can't flick tick-to-tick
        const up = this._u.set(0, 1, 0).applyQuaternion(_q);
        const right = this._r.set(-f.z, 0, f.x);
        this.leanGoal = (this.leanGoal || 0) + (THREE.MathUtils.clamp(-this.steer * Math.min(1, this.speed / 12) * 1.1, -0.5, 0.5) - (this.leanGoal || 0)) * (1 - Math.exp(-h / 0.15));
        const want = this._w.set(0, 1, 0).addScaledVector(right, Math.tan(this.leanGoal)).normalize();
        const along = this._a.crossVectors(up, want).dot(f);
        const rollRate = av.x * f.x + av.z * f.z;
        const rollAcc = THREE.MathUtils.clamp(64 * along - 16 * rollRate, -60, 60) * this.support;
        const f3y = this._a.set(0, 0, -1).applyQuaternion(_q).y;
        const pitch = Math.asin(THREE.MathUtils.clamp(f3y, -1, 1));
        const pitchRate = av.x * right.x + av.z * right.z;
        const pitchAcc = THREE.MathUtils.clamp(-49 * pitch - 14 * pitchRate, -45, 45) * this.support;
        const tq = rollAcc * this.inertia.roll, tp = pitchAcc * this.inertia.pitch;
        body.addTorque({ x: f.x * tq + right.x * tp, y: 0, z: f.z * tq + right.z * tp }, false);
      } else if (this.hbIn < 0.3 && this.speed > 3) {
        // yaw stability: nudge the yaw rate toward what the steering geometry asks for (damps fishtailing and the
        // twitch after a keyboard tap; fades out under handbrake so drifts still work)
        const want = this.yawSign * this.forwardSpeed / this.spec.wheelBase * Math.tan(this.steer);
        const acc = THREE.MathUtils.clamp((want - av.y) * 1.6, -2.5, 2.5) * this.support * (1 - this.hbIn);
        body.addTorque({ x: 0, y: this.inertia.yaw * acc, z: 0 }, false);
      }
    } else if (!grounded) {
      // gentle self-righting in the air
      _v.set(0, 1, 0).applyQuaternion(_q);
      const ax = this._a.crossVectors(_v, _up).multiplyScalar(this.spec.mass * 2.5);
      body.addTorque(ax, false);
    }
    // water: buoyancy + drag, engine dies
    const t = body.translation();
    if (t.y < WATER_LEVEL + 0.4) {
      this.inWater = Math.min(1, this.inWater + h * 0.8);
      const depth = WATER_LEVEL + 0.4 - t.y;
      body.addForce({ x: -v.x * this.spec.mass * 1.2, y: this.spec.mass * 9.81 * Math.min(0.9, depth * 0.6) - v.y * this.spec.mass * 1.5, z: -v.z * this.spec.mass * 1.2 }, true);
    }
    // tyre skid amount for audio/marks
    let slip = 0;
    for (let i = 0; i < 4; i++) slip = Math.max(slip, Math.abs(this.vc.wheelSideImpulse(i) || 0));
    this.skid = THREE.MathUtils.clamp((slip / (this.spec.mass * 0.02) - 0.6) * 0.8, 0, 1) * (this.speed > 4 ? 1 : 0);
    if (this.handbrake && this.speed > 6) this.skid = Math.max(this.skid, 0.8);
  }

  onImpact(other, force) {
    if (this.grace > 0) return;
    const now = performance.now();
    // scrapes and kerb knocks are free; a solid hit costs a few hundred, a head-on at speed most of a sedan
    const dmg = Math.max(0, force / (this.spec.mass * 9.81) - 12) * 3.6;
    if (dmg > 2) {
      this.health -= dmg;
      if (now - this.lastImpact > 180) {
        this.lastImpact = now;
        this.game.audio?.sfx?.(dmg > 60 ? 'crash_heavy' : 'crash_light', { position: this.root.position, volume: Math.min(1, dmg / 80) });
        this.game.events?.emit?.('vehicleImpact', { vehicle: this, damage: dmg, other });
      }
    }
  }

  sync(dt) {
    this.pose.apply(this.root, this.game.physics.alpha);
    const wheels = this.model.wheels, pivots = this.model.wheelPivots;
    if (wheels) {
      const two = wheels.length === 2;
      for (let i = 0; i < 4; i++) {
        if (two && (i === 1 || i === 3)) continue;
        const j = two ? (i < 2 ? 0 : 1) : i;
        const w = wheels[j]; if (!w) continue;
        const susp = this.vc.wheelSuspensionLength(i) ?? this.restLen;
        const rot = this.vc.wheelRotation(i) ?? 0;
        w.rotation.x = rot;
        const piv = pivots?.[j];
        if (piv) { if (i < 2) piv.rotation.y = this.steer; piv.position.y = this.connY - susp; }
      }
    }
    const night = this.game.U?.night.value ?? 0;
    this.model.setLights?.({ head: night > 0.3 || this.lightsOn, brake: this.brake > 0, reverse: this.reversing, siren: this.sirenOn, taxiSign: this.driver === 'player' ? 'hired' : 'free' });
    this.model.update?.(dt);
    // engine audio
    if (this.engine) {
      const gearSpeeds = [0, 12, 22, 34, 48, 64, 90];
      const sp = Math.abs(this.forwardSpeed);
      let g = 1; while (g < 6 && sp > gearSpeeds[g] * (this.spec.maxSpeed / 60)) g++;
      const lo = gearSpeeds[g - 1] * (this.spec.maxSpeed / 60), hi = gearSpeeds[g] * (this.spec.maxSpeed / 60);
      const target = 0.15 + 0.85 * THREE.MathUtils.clamp((sp - lo) / Math.max(1, hi - lo), 0, 1) * (0.6 + 0.4 * this.throttle);
      this.rpm += (target - this.rpm) * Math.min(1, dt * 8);
      this.engine.update({ rpm: this.rpm, throttle: this.throttle, speed: sp, position: this.root.position, skid: this.skid, siren: this.sirenOn });
    }
  }

  // world-space position of the driver door (right-hand drive => +x side)
  doorPosition(out = new THREE.Vector3()) {
    const side = this.spec.doorSide === 'left' ? -1 : 1;
    out.set(side * (this.spec.width / 2 + 0.7), 0, -0.2).applyQuaternion(this.root.quaternion).add(this.root.position);
    return out;
  }

  flipUpright() {
    const t = this.body.translation(), r = this.body.rotation(); _q.set(r.x, r.y, r.z, r.w);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(_q); const yaw = Math.atan2(-fwd.x, -fwd.z);
    this.body.setTranslation({ x: t.x, y: t.y + 1.5, z: t.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true); this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.pose.snap();
  }

  yaw() { const f = _v.set(0, 0, -1).applyQuaternion(this.root.quaternion); return Math.atan2(-f.x, -f.z); }

  dispose() {
    const P = this.game.physics;
    P.contactHandlers.delete(this.collider.handle);
    P.world.removeVehicleController(this.vc);
    P.world.removeRigidBody(this.body);
    this.game.scene.remove(this.root);
    this.model.dispose?.();
    this.engine?.dispose?.();
  }
}
