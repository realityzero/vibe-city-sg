// Tommy Vercetti: on-foot character controller, swimming, vehicle enter/exit (carjacking), health, money, wanted level.
import * as THREE from 'three';
import { FILTER } from '../physics/physics.js';
import { WATER_LEVEL } from '../core/constants.js';
import { createHumanoid } from './humanoid/index.js';
import { Vehicle } from './vehicle.js';

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();
const DOWN = { x: 0, y: -1, z: 0 }, Q0 = { x: 0, y: 0, z: 0, w: 1 };

export class Player {
  constructor(game, { position = new THREE.Vector3(), facing = 0 } = {}) {
    this.game = game;
    this.model = createHumanoid({ preset: 'tommy', lod: 'high' });
    this.root = this.model.root;
    this.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    game.scene.add(this.root);
    this.position = new THREE.Vector3().copy(position);
    this.facing = facing;
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.grounded = true;
    this.speed = 0;
    this.state = 'foot';
    this.vehicle = null;
    this.maxHealth = 150; // tougher than a 1986 Tommy: a crash or a nearby blast shouldn't end the night
    this.health = this.maxHealth; this.armor = 0;
    this.money = 0;
    this.wanted = 0;
    this.controlsEnabled = true;
    this.anim = '';
    const P = game.physics, R = P.R;
    this.body = P.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y + 0.95, position.z));
    this.collider = P.world.createCollider(R.ColliderDesc.capsule(0.55, 0.32).setCollisionGroups(FILTER.char), this.body);
    this.cc = P.world.createCharacterController(0.03);
    this.cc.enableAutostep(0.45, 0.2, false);
    this.cc.enableSnapToGround(0.4);
    this.cc.setMaxSlopeClimbAngle(50 * Math.PI / 180);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    this.cc.setCharacterMass(80);
    this.enterT = 0;
    this.setAnim('idle');
  }

  setAnim(name, opts) { if (this.anim !== name) { this.anim = name; this.model.setAnim?.(name, opts); } }

  teleport(p, facing) {
    if (this.vehicle) {
      const v = this.vehicle;
      v.grace = Math.max(v.grace || 0, 0.8);
      v.body.setTranslation({ x: p.x, y: p.y + 0.3, z: p.z }, true);
      const yaw = facing ?? v.yaw();
      v.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
      v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      v.pose?.snap();
    }
    this.position.copy(p);
    if (facing != null) this.facing = facing;
    this.body.setTranslation({ x: p.x, y: p.y + 0.95, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + 0.95, z: p.z });
    this.vy = 0;
    this.swimming = false; this.climb = null;
    this.game.cameraRig.target.set(p.x, p.y + 1.5, p.z);
    this.game.cameraRig.yaw = this.facing;
  }

  update(dt, input) {
    const game = this.game;
    if (this.state === 'dead') { this.model.update?.(dt); return; }
    if (this.vehicle) return this.updateInVehicle(dt, input);
    if (this.state === 'entering') return this.updateEntering(dt);
    if (this.climb) return this.updateClimb(dt);
    // ---- on foot
    const rig = game.cameraRig;
    const en = this.controlsEnabled;
    let mx = en ? input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']) : 0;
    let mz = en ? input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) : 0;
    const gp = input.gamepad();
    if (gp && en) { if (Math.abs(gp.axes[0]) > 0.15) mx = gp.axes[0]; if (Math.abs(gp.axes[1]) > 0.15) mz = -gp.axes[1]; }
    const ts = input.stick; if (ts?.active && en) { mx = ts.x; mz = ts.y; }
    rig.groundForward(_f); _r.set(-_f.z, 0, _f.x);
    _v.set(0, 0, 0).addScaledVector(_f, mz).addScaledVector(_r, mx);
    const mag = Math.min(1, _v.length());
    const sprint = en && (input.down('ShiftLeft', 'ShiftRight') || (gp?.buttons[0]?.pressed));
    const walk = en && input.down('AltLeft', 'ControlLeft');
    if (this.swimming) return this.updateSwim(dt, input, mag, sprint, en);
    const maxSp = sprint ? 7.4 : walk ? 1.6 : 4.3;
    if (mag > 0.01) _v.normalize().multiplyScalar(maxSp * mag);
    // accelerate horizontal velocity
    const k = Math.min(1, dt * (this.grounded ? 12 : 2));
    this.vel.x += (_v.x - this.vel.x) * k; this.vel.z += (_v.z - this.vel.z) * k;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.speed > 0.3 && mag > 0.01) {
      const want = Math.atan2(-this.vel.x, -this.vel.z);
      let d = want - this.facing; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, dt * 12);
    }
    // gravity / jump
    if (this.grounded && en && input.hit('Space')) { this.vy = 5.2; this.grounded = false; game.audio?.sfx?.('jump', { volume: 0.4 }); }
    this.vy -= 18 * dt;
    const mv = this.sweep(this.vel.x * dt, this.vy * dt, this.vel.z * dt);
    const wasGrounded = this.grounded;
    this.grounded = this.cc.computedGrounded();
    if (this.grounded && this.vy < 0) {
      if (!wasGrounded && this.vy < -8) game.audio?.sfx?.('land', { volume: 0.5 });
      if (!wasGrounded && this.vy < -16) this.damage((-this.vy - 16) * 9, 'fell');
      this.vy = -1;
    }
    this.vy = Math.max(this.vy, -55);
    this.moveBy(mv);
    // anims
    if (this.punchT > 0) this.updatePunch(dt);
    else if (!this.grounded && this.vy < -3) this.setAnim('fall');
    else if (!this.grounded) this.setAnim('jump');
    else if (this.speed > 6) this.setAnim('sprint');
    else if (this.speed > 2.4) this.setAnim('run');
    else if (this.speed > 0.4) this.setAnim('walk');
    else this.setAnim(this.idleAnim || 'idle');
    this.root.position.copy(this.position);
    this.root.rotation.set(0, this.facing, 0);
    this.model.update?.(dt);
    // footsteps
    if (this.grounded && this.speed > 1) {
      this.stepT = (this.stepT || 0) + dt * this.speed * 0.55;
      if (this.stepT > 1) { this.stepT = 0; game.audio?.sfx?.(game.U.wet.value > 0.3 ? 'footstep_wet' : 'footstep', { volume: 0.25 }); }
    }
    // into the water (off a quay, a bridge, a sinking car): swim
    if (this.position.y < WATER_LEVEL - 0.6) this.enterWater();
    // enter vehicle
    else if (en && input.hit('KeyF')) this.tryEnterVehicle();
    else if (en && input.hit('Attack') && this.grounded && !(this.punchT > 0)) { this.punchT = 0.5; this.punchHit = false; this.setAnim('punch', { restart: true, blend: 0.08 }); }
  }

  // fists (the weapon on the HUD): a jab that knocks over whoever is right in front. Police only care if they saw it.
  updatePunch(dt) {
    this.punchT -= dt;
    if (this.punchHit || this.punchT > 0.34) return;
    this.punchHit = true;
    const g = this.game, fx = -Math.sin(this.facing), fz = -Math.cos(this.facing);
    let best = null, bd = 1.9;
    for (const p of g.peds?.peds || []) {
      if (p.state === 'knocked') continue;
      const dx = p.pos.x - this.position.x, dz = p.pos.z - this.position.z, d = Math.hypot(dx, dz);
      if (d < bd && (dx * fx + dz * fz) / (d || 1) > 0.45 && Math.abs(p.pos.y - this.position.y) < 1.2) { bd = d; best = p; }
    }
    g.audio?.sfx?.('punch', { position: this.position, volume: best ? 0.9 : 0.25 });
    if (!best) return;
    best.state = 'knocked'; best.knockT = 2.2; best.yaw = Math.atan2(fx, fz);
    best.pos.x += fx * 0.6; best.pos.z += fz * 0.6;
    g.bark?.('hit', best.pos, 1);
    g.wanted?.crime(1, 'Assault', best.pos);
  }

  /** sweep the capsule by (dx,dy,dz) with the character controller; returns the movement it allows */
  sweep(dx, dy, dz) {
    // sweep from where the previous frame left Tommy (the pending kinematic target), not the last stepped pose
    const cp = this.collider.translation(), nt = this.body.nextTranslation();
    this.collider.setTranslation(nt);
    try { this.cc.computeColliderMovement(this.collider, { x: dx, y: dy, z: dz }, this.game.physics.R.QueryFilterFlags.EXCLUDE_SENSORS, FILTER.char); }
    finally { this.collider.setTranslation(cp); }
    return this.cc.computedMovement();
  }

  moveBy(mv) {
    // continue from the last kinematic target, not the body: on frames without a physics step (120 Hz displays,
    // dt jitter) the body hasn't moved there yet and the previous frame's movement would be lost
    const t = this.body.nextTranslation();
    const nx = t.x + mv.x, ny = t.y + mv.y, nz = t.z + mv.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.position.set(nx, ny - 0.9, nz);
  }

  enterWater() {
    const game = this.game, big = this.vy < -9;
    this.swimming = true; this.swimT = 0; this.crawl = this.speed > 2 ? 1 : 0; this.grounded = false;
    game.audio?.sfx?.(big ? 'splash_big' : 'splash', { position: this.position, volume: big ? 1 : 0.6 });
    _v.set(this.position.x, WATER_LEVEL, this.position.z); game.fx?.splash?.(_v, big ? 0.8 : 0.35);
    this.vy = Math.max(this.vy, -7);
    if (!game._toldSwim) {
      game._toldSwim = true;
      game.ui.help('Tommy finally learned to swim. <b>WASD</b> swim, <b>Shift</b> faster. Swim into a low edge (or press <b>Space</b> at one) to <b>climb out</b>; <b>F</b> by a boat to climb aboard.', 9000);
    }
  }

  // ---- in the water: Tommy floats at the surface and swims (slower than he runs). Pushing into a low edge, or Space
  // at one, hauls him out; walking up a slipway or beach just wades out.
  updateSwim(dt, input, mag, sprint, en) {
    const game = this.game;
    if (mag > 0.01) _v.normalize().multiplyScalar((sprint ? 3.4 : 2.1) * mag);
    const k = Math.min(1, dt * 2.2);
    this.vel.x += (_v.x - this.vel.x) * k; this.vel.z += (_v.z - this.vel.z) * k;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.speed > 0.2 && mag > 0.01) {
      const want = Math.atan2(-this.vel.x, -this.vel.z);
      let d = want - this.facing; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * Math.min(1, dt * 5);
    }
    // buoyancy: a damped spring to the float height (shoulders out treading water, back awash in the crawl), so a
    // plunge off a bridge goes under and bobs back up
    this.swimT += dt;
    this.crawl += ((this.speed > 0.9 ? 1 : 0) - this.crawl) * Math.min(1, dt * 3);
    const floatY = WATER_LEVEL - 1.3 + 0.36 * this.crawl + 0.04 * Math.sin(this.swimT * 2.3);
    this.vy += ((floatY - this.position.y) * 16 - this.vy * 6) * dt;
    // the drawn shore is the wall: the land sheet overhangs the bank, and swimming under it would hide Tommy
    const c = game.city, px = this.position.x, pz = this.position.z;
    let dx = this.vel.x * dt, dz = this.vel.z * dt;
    if (c.isWater(px, pz)) {
      if (dx && !c.isWater(px + dx + Math.sign(dx) * 0.45, pz)) { dx = 0; this.vel.x = 0; }
      if (dz && !c.isWater(px + dx, pz + dz + Math.sign(dz) * 0.45)) { dz = 0; this.vel.z = 0; }
    }
    this.moveBy(this.sweep(dx, this.vy * dt, dz));
    this.root.position.copy(this.position); this.root.rotation.set(0, this.facing, 0);
    this.setAnim(this.crawl > 0.5 ? 'swim' : 'tread');
    this.model.setSpeed?.(this.crawl > 0.5 ? 0.7 + this.speed * 0.12 : 1);
    this.model.update?.(dt);
    if (this.crawl > 0.5 && (this.strokeT = (this.strokeT || 0) + dt * (0.7 + this.speed * 0.12) / 0.75) > 1) {
      this.strokeT = 0;
      game.audio?.sfx?.('wave_slap', { position: this.position, volume: 0.3 });
      _v.set(this.position.x, WATER_LEVEL, this.position.z); game.fx?.spray?.(_v, _f.set(0, 0, 0), 2);
    }
    // waded out up a slipway or a beach
    if (this.cc.computedGrounded() && this.position.y > WATER_LEVEL - 0.5) { this.swimming = false; return; }
    if (!en) return;
    const jump = input.hit('Space');
    this.ledgeT = (this.ledgeT || 0) - dt;
    if (jump || (mag > 0.3 && this.ledgeT <= 0)) {
      this.ledgeT = 0.15;
      const a = mag > 0.3 ? Math.atan2(-_v.x, -_v.z) : this.facing;
      const ledge = this.findLedge(-Math.sin(a), -Math.cos(a), jump ? 2.6 : 1.8);
      if (ledge) return this.startClimb(ledge);
    }
    if (input.hit('KeyF')) this.tryEnterVehicle();
  }

  /** dry, level ground within `reach` metres along (dx,dz) that a swimmer can haul himself onto — a quay, steps, a
   * pontoon — or null. Railings and kerbs on the way are vaulted; walls, and edges more than ~2.6 m above the water,
   * are not. */
  findLedge(dx, dz, reach = 1.8) {
    const P = this.game.physics, p = this.position;
    for (let s = 0.5; s <= reach; s += 0.3) {
      const x = p.x + dx * s, z = p.z + dz * s;
      const h = P.raycast({ x, y: WATER_LEVEL + 4, z }, DOWN, 7, FILTER.charRay);
      if (!h) continue;
      const y = h.point.y;
      if (h.toi < 0.05 || y > WATER_LEVEL + 3) return null; // a wall, a building, a bridge parapet
      if (y < WATER_LEVEL + 0.6 || Math.abs(h.normal.y) < 0.8) continue; // still the underwater bank or a steep face
      if (y > WATER_LEVEL + 2.6) continue; // a railing or bollard top: look past it
      if (!this.fits(x, y, z)) continue;
      // nothing taller than a railing between Tommy and the spot
      if (P.raycast({ x: p.x, y: y + 1.45, z: p.z }, { x: dx, y: 0, z: dz }, s, FILTER.charRay)) return null;
      return new THREE.Vector3(x, y, z);
    }
    return null;
  }

  /** is there room for Tommy standing with his feet at (x,y,z)? */
  fits(x, y, z) {
    let hit = false;
    this.game.physics.world.intersectionsWithShape({ x, y: y + 1.0, z }, Q0, this.collider.shape, () => { hit = true; return false; }, undefined, FILTER.char, this.collider);
    return !hit;
  }

  startClimb(to) {
    this.swimming = false;
    this.climb = { t: 0, from: this.position.clone(), to };
    this.facing = Math.atan2(-(to.x - this.position.x), -(to.z - this.position.z));
    this.vel.set(0, 0, 0); this.vy = 0; this.speed = 0;
    this.setAnim('climb_out');
    this.game.audio?.sfx?.('splash', { position: this.position, volume: 0.35 });
  }

  // hands on the edge and up out of the water first, then over onto the ledge (kinematic: no sweep, the spot was checked)
  updateClimb(dt) {
    const c = this.climb, k = Math.min(1, (c.t += dt) / 1.1);
    const up = THREE.MathUtils.smootherstep(k, 0, 0.6), fw = THREE.MathUtils.smootherstep(k, 0.25, 1);
    this.position.set(c.from.x + (c.to.x - c.from.x) * fw, c.from.y + (c.to.y + 0.04 - c.from.y) * up, c.from.z + (c.to.z - c.from.z) * fw);
    this.body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y + 0.9, z: this.position.z });
    this.root.position.copy(this.position); this.root.rotation.set(0, this.facing, 0);
    this.model.update?.(dt);
    if (k >= 1) { this.climb = null; this.grounded = true; this.vy = -1; this.setAnim('idle'); this.game.audio?.sfx?.('footstep_wet', { volume: 0.4 }); }
  }

  nearestEnterable(maxD = 4.5) {
    let best = null, bd = maxD;
    for (const v of this.game.vehicles) {
      if (v.exploded || v.locked || (this.swimming && !v.isBoat)) continue;
      // boats moor against a quay whose solid edge sits back from the waterline: step aboard from a little further
      const d = v.position.distanceTo(this.position) - v.spec.length * 0.25 - (v.isBoat ? 3 : 0); if (d < bd) { bd = d; best = { kind: 'vehicle', v }; }
    }
    const car = !this.swimming && this.game.traffic?.nearestCar(this.position, Math.max(1, bd + 1.5));
    if (car && car.pos.distanceTo(this.position) - car.spec.length * 0.25 < bd) best = { kind: 'traffic', car };
    return best;
  }

  tryEnterVehicle() {
    const n = this.nearestEnterable();
    if (!n) return false;
    let v;
    if (n.kind === 'traffic') {
      const st = this.game.traffic.take(n.car);
      const yaw = st.yaw;
      v = new Vehicle(this.game, st.type, { position: st.position, yaw, color: st.color, velocity: { x: -Math.sin(yaw) * st.speed * 0.3, y: 0, z: -Math.cos(yaw) * st.speed * 0.3 } });
      v.transient = true; // abandoned stolen cars get cleaned up once far away
      this.game.vehicles.push(v);
      // evicted driver flees (a parked car has nobody in it)
      if (!st.parked) this.game.peds?.spawnFleeing?.(v.doorPosition(new THREE.Vector3()), this.position);
      this.game.events.emit('carjack', v);
      if (st.type === 'police' && !st.parked) this.game.wanted?.add(2, 'Stole a police car'); // the officer you threw out saw you
      else this.game.wanted?.crime(1, st.parked ? 'Car theft' : 'Carjacking', st.position);
    } else v = n.v;
    this.state = 'entering'; this.swimming = false;
    this.enterT = 0;
    this.enterTarget = v;
    this.enterFrom = this.position.clone();
    this.setAnim('enter_car');
    this.game.audio?.sfx?.('door_open', { position: v.position });
    return true;
  }

  updateEntering(dt) {
    const v = this.enterTarget;
    this.enterT += dt;
    const door = v.doorPosition(_v);
    const k = Math.min(1, this.enterT / 0.45);
    this.position.lerpVectors(this.enterFrom, door, k);
    this.facing = v.yaw();
    this.root.position.copy(this.position); this.root.rotation.set(0, this.facing, 0);
    this.model.update?.(dt);
    if (this.enterT > 0.75) {
      this.vehicle = v; v.driver = 'player';
      this.state = 'vehicle';
      this.game.physics.world.removeCollider(this.collider, false); this.collider = null;
      this.setAnim('drive');
      this.game.audio?.sfx?.('door_close', { position: v.position });
      if (!v.engine && this.game.audio?.createEngine) v.engine = this.game.audio.createEngine({ type: v.spec.engineSound || 'sedan' });
      this.game.audio?.sfx?.('engine_start', { position: v.position, volume: 0.6 });
      this.game.events.emit('enterVehicle', v);
    }
  }

  enterVehicleImmediate(v) {
    if (this.vehicle) this.exitVehicle();
    this.vehicle = v; v.driver = 'player'; this.state = 'vehicle';
    if (this.collider) { this.game.physics.world.removeCollider(this.collider, false); this.collider = null; }
    if (!v.engine && this.game.audio?.createEngine) v.engine = this.game.audio.createEngine({ type: v.spec.engineSound || 'sedan' });
    this.setAnim('drive');
    this.game.events.emit('enterVehicle', v);
  }

  updateInVehicle(dt, input) {
    const v = this.vehicle;
    const en = this.controlsEnabled;
    const gp = input.gamepad();
    let thr = en && input.down('KeyW', 'ArrowUp') ? 1 : 0, brk = en && input.down('KeyS', 'ArrowDown') ? 1 : 0;
    let steer = en ? input.axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']) : 0;
    if (gp && en) { thr = Math.max(thr, gp.buttons[7]?.value || 0); brk = Math.max(brk, gp.buttons[6]?.value || 0); const ax = gp.axes[0] || 0; if (Math.abs(ax) > 0.12) steer = -Math.sign(ax) * (Math.abs(ax) - 0.12) / 0.88; }
    // on-screen stick: steer with x; pushing it up / down also works the pedals (or use the GAS / BRAKE buttons)
    const ts = input.stick;
    if (ts?.active && en) { steer = -ts.x; thr = Math.max(thr, THREE.MathUtils.clamp((ts.y - 0.3) / 0.5, 0, 1)); brk = Math.max(brk, THREE.MathUtils.clamp((-ts.y - 0.3) / 0.5, 0, 1)); }
    const air = !!v.isAircraft;
    if (this.autopilot && (thr || brk || Math.abs(steer) > 0.5)) { this.autopilot.disengage('Manual override. Claudia is hurt but understands.'); }
    if (!this.autopilot) v.setDriverControls({
      throttle: thr, brake: brk, steer,
      handbrake: !air && en && (input.down('Space') || gp?.buttons[0]?.pressed),
      up: air && en && (input.down('Space') || gp?.buttons[5]?.pressed),
      down: air && en && (input.down('ShiftLeft', 'ShiftRight') || gp?.buttons[4]?.pressed),
      strafe: air && en ? input.axis(['KeyQ'], ['KeyE']) : 0,
    }, dt);
    if (en && input.hit('KeyH')) { if (v.type === 'police') v.sirenOn = !v.sirenOn; else if (!air) this.game.audio?.sfx?.('horn', { position: v.position }); }
    if (en && input.hit('KeyL')) v.lightsOn = !v.lightsOn;
    if (en && !air && input.hit('KeyQ')) this.game.audio?.radio?.prev?.();
    if (en && !air && input.hit('KeyE')) this.game.audio?.radio?.next?.();
    // flip if stuck upside down
    const up = _v.set(0, 1, 0).applyQuaternion(v.quaternion);
    if (up.y < 0.3 && v.speed < 2) { this.flipT = (this.flipT || 0) + dt; if (this.flipT > 2.5 || input.hit('KeyR')) { v.flipUpright(); this.flipT = 0; } } else this.flipT = 0;
    this.position.copy(v.position);
    this.speed = v.speed;
    this.facing = v.yaw();
    // seat pose (remote-controlled drones: Tommy stays on the pavement with his phone)
    if (v.spec.kind === 'drone' && this.remoteHome) {
      this.root.position.copy(this.remoteHome); this.root.rotation.set(0, this.remoteFacing || 0, 0); this.setAnim('phone');
    } else {
      this.setAnim(/^bike|jetski/.test(v.type) ? 'ride' : 'drive');
      if (this.model.params) this.model.params.steer = THREE.MathUtils.clamp(-(v.steer || 0) * 2.5, -1, 1);
    }
    this.root.visible = v.spec.kind === 'drone' || v.type === 'stinger' || v.isBike || this.game.cameraRig.mode === 2 ? true : v.type !== 'bus';
    this.model.update?.(dt);
    if (v.inWater > 0.9 || v.ditched) { this.exitVehicle(true); }
    if (en && input.hit('KeyF')) {
      if (v.isBoat) { if (v.speed < 4) this.exitVehicle(); } // onto the quay if there's one alongside, else over the side
      else if (v.isAircraft || v.speed < 9) this.exitVehicle();
    }
  }

  /** seat Tommy in the vehicle at its rendered (interpolated) pose: runs after the vehicles sync, otherwise he is
   * drawn where the car was last frame (half a metre behind at speed, jittering against the body) */
  syncSeat() {
    const v = this.vehicle;
    if (!v || (v.spec.kind === 'drone' && this.remoteHome)) return;
    const seat = v.spec.seats?.[0] || { x: 0.37, y: 0.5, z: 0.2 };
    this.root.position.set(seat.x, seat.y - 0.45, seat.z).applyQuaternion(v.quaternion).add(v.position);
    this.root.quaternion.copy(v.quaternion);
    this.position.copy(v.position);
  }

  exitVehicle(force = false) {
    const v = this.vehicle; if (!v) return;
    const P = this.game.physics, R = P.R;
    const door = v.doorPosition(new THREE.Vector3());
    if (v.isBoat) {
      const sh = v.shoreSpot();
      if (sh) door.copy(sh).setY(0.05);
      else door.set(-(v.spec.width / 2 + 1.1), 0, 0).applyQuaternion(v.quaternion).add(v.position).setY(WATER_LEVEL - 1.2); // over the side
    }
    else if (v.spec.kind === 'drone' && this.remoteHome) door.copy(this.remoteHome);
    else if (v.isAircraft) door.y = v.position.y + 0.3;
    else {
      door.y = Math.max(v.position.y, 0) + 0.05;
      // if door side blocked, exit on the other side
      const hit = P.raycast({ x: v.position.x, y: v.position.y + 1, z: v.position.z }, new THREE.Vector3().subVectors(door, v.position).setY(0).normalize(), v.spec.width / 2 + 0.9);
      if (hit) door.copy(new THREE.Vector3(-(v.spec.width / 2 + 0.8), 0, 0).applyQuaternion(v.quaternion).add(v.position));
    }
    v.driver = null;
    v.setDriverControls({ throttle: 0, brake: 0, steer: 0, handbrake: true }, 0.016);
    if (v.isAircraft) v.powered = false;
    this.vehicle = null;
    this.state = 'foot';
    this.root.visible = true;
    this.collider = P.world.createCollider(R.ColliderDesc.capsule(0.55, 0.32).setCollisionGroups(FILTER.char), this.body);
    this.teleport(door, v.yaw());
    this.game.cameraRig.yaw = v.yaw();
    this.setAnim('idle');
    this.game.audio?.sfx?.('door_close', { position: door });
    this.game.events.emit('exitVehicle', v);
  }

  damage(amount, reason) {
    if (this.state === 'dead') return;
    const a = Math.min(this.armor, amount * 0.66); this.armor -= a; amount -= a;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.game.events.emit('playerDied', reason);
  }
}
