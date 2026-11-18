// Driving juice, tied to the hype economy: near misses (passing a car or a pedestrian within a metre at speed) pay cash
// and a little hype, with a CLOSE SHAVE popup, a whoosh and a quick FOV kick (chained ones multiply); sparks and a
// grind where the bodywork scrapes; a shake and 0.3 s of slow motion on a big crash; speed lines while the Kopi Gao
// boost burns. Everything is pooled and created at load: nothing is allocated per frame.
import * as THREE from 'three';

const SLOTS = 8;            // cars / pedestrians tracked through a pass at once
const NEAR = 1.0;           // m of clearance that counts as a near miss (pedestrians: NEAR_PED)
const NEAR_PED = 1.2;
const MIN_SPEED = 12;       // m/s (~43 km/h) of the player's car
const MIN_REL = 9;          // m/s closing speed on a car
const CHAIN = 4;            // s to keep a combo going
const SLOWMO = 0.3, SLOWMO_SCALE = 0.3, BIG_CRASH = 150; // s of real time, sim speed, vehicleImpact damage

const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Juice {
  constructor(game) {
    this.game = game;
    this.slots = Array.from({ length: SLOTS }, () => ({ obj: null, ped: false, min: 99, gap: 99, rel: 0, spd: 0, seen: 0, touched: false }));
    this.paid = new Map(); // car/pedestrian -> time paid: one pass pays once
    this.frame = 0; this.combo = 0; this.lastT = -99; this.impactT = -99;
    this.sparkT = 0; this.scrapeT = 0; this.slowT = 0;
    this.lines = new SpeedLines(game.scene);
    this._cp = new THREE.Vector3(); this._hasCp = false;
    // first contact of the pair, on the vehicle's side, in the vehicle collider's frame (flipped: the vehicle is the
    // manifold's second collider). Called per manifold; a trimesh pair has several, most of them empty.
    this._manifold = (m, flipped) => {
      if (this._hasCp || m.numContacts() < 1) return;
      const l = flipped ? m.localContactPoint2(0) : m.localContactPoint1(0);
      if (l) { this._cp.set(l.x, l.y, l.z); this._hasCp = true; }
    };
    game.events.on('vehicleImpact', e => this.impact(e));
    game.events.on('pedHit', p => { for (const s of this.slots) if (s.obj === p) s.touched = true; });
  }

  /** dt: simulated time (slow motion included), realDt: wall-clock frame time */
  update(dt, realDt) {
    const g = this.game, P = g.player, v = P.vehicle, now = performance.now() / 1000;
    this.frame++;
    // big-crash slow motion runs on real time (and gives way to a stunt replay, which owns simScale too)
    if (this.slowT > 0) { this.slowT -= realDt; if (this.slowT <= 0 && g.simScale === SLOWMO_SCALE) g.simScale = 1; }
    this.lines.update(realDt, g.camera, g.R, P.vehicle && g.hype?.boostOn ? Math.min(1, v.speed / 30) : 0);
    const car = v && !v.isBoat && !v.isAircraft && !v.exploded;
    if (!car || !P.controlsEnabled || P.autopilot || v.speed < MIN_SPEED * 0.7) { this.release(); return; }
    // the player's car as an oriented box on the ground plane
    const q = v.quaternion, fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const fl = Math.hypot(fx, fz) || 1, ax = fx / fl, az = fz / fl;
    const hw = v.spec.width * 0.5, hl = v.spec.length * 0.5, cx = v.position.x, cz = v.position.z;
    const vx = ax * v.forwardSpeed, vz = az * v.forwardSpeed;
    for (const c of g.traffic.cars) {
      if (c.state === 'wreck') continue;
      const dx = c.pos.x - cx, dz = c.pos.z - cz;
      if (dx * dx + dz * dz > 144) continue;
      const bx = -Math.sin(c.yaw), bz = -Math.cos(c.yaw), kv = c.kv;
      const gap = boxGap(cx, cz, ax, az, hw, hl, c.pos.x, c.pos.z, bx, bz, c.spec.width * 0.5, c.len * 0.5);
      this.track(c, false, gap, kv ? Math.hypot(vx - kv.x, vz - kv.z) : v.speed, v.speed);
    }
    for (const p of g.peds.peds) {
      if (p.state === 'knocked') continue;
      const dx = p.pos.x - cx, dz = p.pos.z - cz;
      if (dx * dx + dz * dz > 64) continue;
      this.track(p, true, boxGap(cx, cz, ax, az, hw, hl, p.pos.x, p.pos.z, 1, 0, 0.3, 0.3), v.speed, v.speed);
    }
    // a pass is over once the other has dropped out of range (or opened the gap again): pay out the close ones
    for (const s of this.slots) {
      if (!s.obj) continue;
      if (s.seen === this.frame && !(s.min < (s.ped ? NEAR_PED : NEAR) && s.gap > 3)) continue;
      const ok = !s.touched && s.min > 0.02 && s.min < (s.ped ? NEAR_PED : NEAR) && s.spd >= MIN_SPEED && (s.ped || s.rel > MIN_REL) &&
        now - this.impactT > 0.6 && !this.paid.has(s.obj);
      if (ok) this.nearMiss(s, v, now);
      s.obj = null;
    }
    if (this.paid.size > 32) for (const [o, t] of this.paid) if (now - t > 20) this.paid.delete(o);
  }

  // follow one car / pedestrian through the pass: the closest clearance, and the closing and own speed at that moment
  track(obj, ped, gap, rel, spd) {
    let free = null;
    for (const s of this.slots) {
      if (s.obj === obj) { s.seen = this.frame; s.gap = gap; if (gap < s.min) { s.min = gap; s.rel = rel; s.spd = spd; } return; }
      if (!s.obj && !free) free = s;
    }
    if (!free || gap > 2.5) return; // (only start following once it's close)
    free.obj = obj; free.ped = ped; free.min = gap; free.gap = gap; free.rel = rel; free.spd = spd; free.seen = this.frame; free.touched = gap <= 0;
  }
  release() { for (const s of this.slots) s.obj = null; }

  nearMiss(s, v, now) {
    const g = this.game;
    this.paid.set(s.obj, now);
    this.combo = now - this.lastT < CHAIN ? Math.min(5, this.combo + 1) : 1;
    this.lastT = now;
    const kmh = v.speed * 3.6, cash = 5 * Math.round((15 + kmh * 0.35) * this.combo / 5);
    g.addMoney(cash);
    g.hype?.bump(0.0015 * this.combo);
    g.cameraRig.kick(3 + this.combo);
    g.ui.closeShave?.(cash, this.combo);
    g.audio?.sfx?.('whoosh', { position: s.obj.pos, volume: Math.min(1, 0.5 + kmh / 200) });
    if (s.ped) g.bark('nearmiss', s.obj.pos, 2);
  }

  impact({ vehicle, damage, other }) {
    const g = this.game;
    if (vehicle !== g.player.vehicle) return;
    this.impactT = performance.now() / 1000;
    for (const s of this.slots) if (s.obj && !s.ped && s.obj.collider?.handle === other) s.touched = true;
    if (damage > BIG_CRASH && !vehicle.isAircraft && !vehicle.isBoat) {
      g.cameraRig.shake(1.3);
      if (g.simScale === 1 || g.simScale === SLOWMO_SCALE) { g.simScale = SLOWMO_SCALE; this.slowT = SLOWMO; }
      this.sparks(vehicle, other, 14);
    }
  }

  /** every contact-force event of a physics vehicle (Vehicle.onImpact): sparks and a grind where the player scrapes */
  contact(vehicle, other, force) {
    const g = this.game;
    if (vehicle !== g.player.vehicle || vehicle.isBoat || vehicle.isAircraft || vehicle.speed < 4) return;
    const now = performance.now();
    if (now - this.sparkT < 45) return;
    this.sparkT = now;
    this.sparks(vehicle, other, Math.min(12, 3 + force / (vehicle.spec.mass * 10)));
    if (now - this.scrapeT > 260) { this.scrapeT = now; g.audio?.sfx?.('scrape', { position: vehicle.position, volume: Math.min(1, 0.35 + vehicle.speed / 30) }); }
  }

  // sparks at the contact point, thrown back along the car's travel
  sparks(vehicle, other, n) {
    const g = this.game, W = g.physics.world, col = W.getCollider(other);
    this._hasCp = false;
    if (col) W.contactPair(vehicle.collider, col, this._manifold);
    if (!this._hasCp) return;
    const t = vehicle.collider.translation(), r = vehicle.collider.rotation();
    this._cp.applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).add(_v.set(t.x, t.y, t.z));
    _v.set(0, 0, -1).applyQuaternion(vehicle.quaternion).multiplyScalar(-Math.min(14, vehicle.speed * 0.5));
    g.fx.sparks(_p.copy(this._cp), _v, n);
  }
}

// clearance between two boxes on the ground plane (centre, unit forward, half width, half length): the largest
// separation along the four edge normals — 0 or less when they touch
function boxGap(ax, az, afx, afz, ahw, ahl, bx, bz, bfx, bfz, bhw, bhl) {
  let gap = -Infinity;
  for (let k = 0; k < 4; k++) {
    // axis: a's forward, a's right, b's forward, b's right
    const nx = k === 0 ? afx : k === 1 ? -afz : k === 2 ? bfx : -bfz, nz = k === 0 ? afz : k === 1 ? afx : k === 2 ? bfz : bfx;
    const ra = ahl * Math.abs(afx * nx + afz * nz) + ahw * Math.abs(-afz * nx + afx * nz);
    const rb = bhl * Math.abs(bfx * nx + bfz * nz) + bhw * Math.abs(-bfz * nx + bfx * nz);
    const d = Math.abs((bx - ax) * nx + (bz - az) * nz) - ra - rb;
    if (d > gap) gap = d;
  }
  return gap;
}

// Kopi Gao speed lines: thin streaks rushing past the lens, laid out in view space (a tunnel around the view axis that
// stays clear of the car) so they need no matrices; additive, one draw, hidden when the boost is off.
const LINES = 64, TUNNEL = 24;
class SpeedLines {
  constructor(scene) {
    const seed = new Float32Array(LINES * 4 * 4), corner = new Float32Array(LINES * 4 * 2), idx = [];
    for (let i = 0; i < LINES; i++) {
      // around the view axis, more at the sides than top and bottom; random depth phase and length
      const a = (i / LINES) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const r = 3.2 + Math.random() * 3.2, ph = Math.random(), len = 0.6 + Math.random() * 0.8;
      for (let k = 0; k < 4; k++) {
        seed.set([a, r, ph, len], (i * 4 + k) * 4);
        corner.set([k >> 1, (k & 1) * 2 - 1], (i * 4 + k) * 2);
      }
      const o = i * 4; idx.push(o, o + 1, o + 2, o + 2, o + 1, o + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINES * 4 * 3), 3)); // (unused: placed in the shader)
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    geo.setIndex(idx);
    this.uniforms = { uRun: { value: 0 }, uAmt: { value: 0 }, uLen: { value: 6 }, uW: { value: 0.003 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec4 aSeed; attribute vec2 aCorner; uniform float uRun; uniform float uAmt; uniform float uLen; uniform float uW; varying float vA;
        void main() {
          float u = mod(aSeed.z * ${TUNNEL}.0 - uRun, ${TUNNEL}.0);            // 0 at the lens .. TUNNEL far
          float z = -2.5 - u - aCorner.x * uLen * aSeed.w;                    // the tail trails away from the lens
          vec2 dir = vec2(cos(aSeed.x), sin(aSeed.x) * 0.62);                 // a wide, flat tunnel
          vec3 p = vec3(dir * aSeed.y, z) + vec3(-dir.y, dir.x, 0.0) * aCorner.y * uW * -z;
          vA = uAmt * (1.0 - aCorner.x) * smoothstep(0.0, 3.0, u) * (1.0 - smoothstep(${TUNNEL - 10}.0, ${TUNNEL}.0, u));
          gl_Position = projectionMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: 'varying float vA; void main() { gl_FragColor = vec4(vec3(1.0, 0.86, 0.95) * 1.6 * vA, vA); }',
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 16;
    scene.add(this.mesh);
    this.amt = 0;
  }
  update(dt, camera, R, target) {
    this.amt += (target - this.amt) * Math.min(1, dt * (target > this.amt ? 6 : 3));
    this.mesh.visible = this.amt > 0.01;
    if (!this.mesh.visible) return;
    const u = this.uniforms;
    u.uAmt.value = this.amt * 0.4;
    u.uRun.value = (u.uRun.value + dt * 60 * (0.5 + this.amt)) % 1e4;
    u.uLen.value = 3 + this.amt * 7;
    // a hairline: 1/700 of the screen height (never under 0.8 px), at any field of view
    const H = R?.height || innerHeight;
    u.uW.value = Math.max(0.8, H / 700) * 2 * Math.tan(camera.getEffectiveFOV() * Math.PI / 360) / H;
  }
}
