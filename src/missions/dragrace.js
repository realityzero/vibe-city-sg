// Ah Beng's drag race. At night, stopped first at a red light with a lane free beside you, sometimes a lime hatchback
// with neon underglow rolls up alongside and revs: flash your lights (L, or FLASH on touch) to take him on. The start
// lights count down with the real signal, it's ~400 m to a line down the road (going early loses), cash and hype for
// the win; a loss costs nothing but pride (event 'dragRace': won or not). Ah Beng drives a PathDriver (no traffic code involved); his car is a normal
// physics vehicle made when he shows up, the underglow one additive quad made at load.
import * as THREE from 'three';
import { Vehicle } from '../entities/vehicle.js';
import { PathDriver } from '../entities/aiDriver.js';

const LENGTH = 400;          // m from the stop line to the finish
const PRIZE = 800;           // S$
const COOL = 150;            // s between challenges
const ASK_MIN = 7;           // s of red left for him to roll up and ask
const COLOR = 0x86e21c, GLOW = 0xff2fd0; // lime paint, magenta underglow
const ASK = ['Eh bro, wanna try or not?', 'Your car can go one or not?', 'Oi, one round lah!'];
const WON = ['Wah, your car steady!', 'Swee lah, you win.', 'Walao, next time I tune my car!'];
const LOST = ['Your car got engine or not?', 'Go home practise lah!', 'Steady, steady. Too slow only.'];
const pick = a => a[Math.floor(Math.random() * a.length)];
const _v = new THREE.Vector3(), _d = new THREE.Vector3();

export class DragRace {
  constructor(game) {
    this.game = game;
    this.state = 'idle';
    this.coolT = 20; this.checkT = 0;
    this.hold = { x: 0, z: 0, r: 1.2 };
    this.chance = 0.6; // of him showing up at a light that qualifies (else not for COOL / 6 s)
    this.glow = makeGlow(game.scene);
    this.accepted = false;
    addEventListener('keydown', e => { if (e.code === 'KeyL' && !e.repeat && !e.__cheatTyping && this.state === 'ask') this.accepted = true; });
  }

  /** true while Ah Beng waits for an answer (touch shows FLASH) */
  get asking() { return this.state === 'ask'; }

  update(dt) {
    const g = this.game, P = g.player, v = P.vehicle;
    this.coolT -= dt;
    if (this.beng) {
      this.glow.follow(this.beng, g, g.U.night.value);
      // traffic only waits for what is in its obstacle list (it would shove a physics car out of its lane)
      this.hold.x = this.beng.position.x; this.hold.z = this.beng.position.z; g.traffic.obstacles.push(this.hold);
    }
    if (this.state === 'idle') {
      if (this.coolT > 0 || (this.checkT -= dt) > 0) return;
      this.checkT = 0.5;
      if (this.canAsk(v)) { if (Math.random() < this.chance) this.rollUp(); else this.coolT = COOL / 6; }
      return;
    }
    // anything that ends the street race: out of the car, a mission, the police
    const off = !v || v !== this.car || g.missions.active || g.wanted.stars > 0 || P.state === 'dead' || !P.controlsEnabled;
    if (off && this.state !== 'done') return this.finish(null);
    this.t += dt;
    if (this.state === 'arrive') this.arrive();
    else if (this.state === 'ask') this.ask(dt);
    else if (this.state === 'count') this.count(dt);
    else if (this.state === 'race') this.race();
    else if (this.state === 'done' && (this.far() || this.t > 90)) this.clear();
  }

  // ------------------------------------------------------------------------------------------- the challenge
  /** at night, in a car, stopped first at a red with ASK_MIN s of it left, a free lane on the right, a straight ahead */
  canAsk(v) {
    const g = this.game, tm = g.sky.time;
    if (!v || v.isBoat || v.isAircraft || v.isBike || v.speed > 0.6 || !(tm >= 20 || tm < 4.5)) return false;
    if (g.missions.active || g.activities?.busy || g.taxi?.onDuty || g.wanted.stars > 0 || !g.player.controlsEnabled || g.player.autopilot) return false;
    const q = v.quaternion, fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y)), fl = Math.hypot(fx, fz) || 1;
    const h = g.fines.laneUnder(v.position.x, v.position.z, fx / fl, fz / fl, 2.2); if (!h) return false;
    const lane = h.lane, s = h.s, node = g.roadnet.nodes[lane.to];
    if (!node.signal || lane.s1 - lane.s0 < 60 || lane.s1 - s > 14 || lane.s1 - s < 1 || this.redLeft(lane) < ASK_MIN) return false;
    if (lane.cars.some(c => c.s > s && c.s < lane.s1 + 2)) return false; // first in the queue
    // the lane to the right (the overtaking side), free from 90 m back to the line
    const side = g.roadnet.lanesNear(v.position.x, v.position.z, 20).find(l => l.edge === lane.edge && l.to === lane.to && l.idx === lane.idx + 1);
    if (!side || side.cars.some(c => c.s > s - 90 && c.s < side.s1 + 2)) return false;
    const ss = project(side, v.position.x, v.position.z);
    if (ss - 40 < 2) return false;
    const route = straight(side, ss, side.s1 - ss + LENGTH + 30); if (!route) return false; // (he brakes past the line)
    side.path.sample(ss - 40, _v, _d);
    if (g.vehicles.some(o => o.position.distanceTo(_v) < 8)) return false;
    Object.assign(this, { lane, side, ss, route, car: v, line: finishLine(route, side.s1 - ss + LENGTH) });
    return true;
  }

  /** seconds of red left on a lane's signal (0 unless red) */
  redLeft(lane) {
    const n = this.game.roadnet.nodes[lane.to], t = n.signal.t, local = (lane.phase || 0) === 0 ? t : (t + 23) % 46;
    return local >= 21 ? 46 - local : 0;
  }

  rollUp() {
    const g = this.game, side = this.side, ss = this.ss;
    side.path.sample(ss - 40, _v, _d);
    const beng = this.beng = new Vehicle(g, 'stinger', { position: _v, yaw: Math.atan2(-_d.x, -_d.z), color: COLOR });
    beng.driver = 'ai'; beng.locked = true;
    g.vehicles.push(beng);
    if (g.audio?.createEngine) beng.engine = g.audio.createEngine({ type: 'sports' });
    // up to the line beside the player (the driver brakes ~4 m short of its route's end and rolls a little)
    const pts = []; for (let s = ss - 40; s <= ss + 1; s += 4) { side.path.sample(s, _v); pts.push([_v.x, _v.z]); }
    this.drive(pts, 0.15, 0.4);
    this.state = 'arrive'; this.t = 0; this.accepted = false;
  }

  drive(route, speed, aggression) {
    const g = this.game;
    this.stopDriving();
    const drv = this.drv = new PathDriver(g, this.beng, route, { speed, aggression });
    // at the end of a route: the handbrake holds him (a held brake pedal would reverse him once stopped)
    this.step = h => { if (this.beng.exploded) return; if (drv.done) this.beng.setDriverControls({ throttle: 0, brake: this.beng.speed > 1 ? 1 : 0, steer: 0, handbrake: true }, h); else drv.update(h); };
    g.physics.onStep(this.step);
  }
  stopDriving() {
    const cbs = this.game.physics.stepCallbacks, i = cbs.indexOf(this.step); if (i >= 0) cbs.splice(i, 1);
    this.step = null;
  }

  arrive() {
    const g = this.game;
    if (this.t > 14 || this.redLeft(this.lane) < 3) return this.finish(null); // couldn't get there in time
    if (!this.drv.done || this.beng.speed > 0.5) return;
    g.bark('admire', this.beng.position, 2, { text: pick(ASK) });
    this.state = 'ask'; this.t = 0; this.revT = 0;
    g.ui.raceLights({ title: 'Ah Beng wants to race', sub: g.touch?.on ? 'Tap <b>FLASH</b> to take him on' : 'Flash your lights — <b>L</b> — to take him on' });
  }

  ask(dt) {
    const g = this.game;
    this.revs(dt);
    if (this.accepted) {
      this.state = 'count'; this.t = 0; this.lit = -1;
      g.ui.raceLights({ title: `Street race · ${LENGTH} m`, sub: 'Go on <em>green</em>. Jump it and you lose.', lights: 0 });
      return;
    }
    if (this.redLeft(this.lane) < 2.5 || this.car.speed > 2) {
      g.bark('admire', this.beng.position, 2, { text: 'Chicken lah!' });
      this.finish(null);
    }
  }

  // Ah Beng blips the throttle while he waits (the engine note follows rpm)
  revs(dt) {
    if ((this.revT -= dt) > 0) return;
    this.revT = 0.9 + Math.random() * 0.8; this.beng.rpm = 0.75 + Math.random() * 0.2;
  }

  count(dt) {
    const g = this.game, left = this.redLeft(this.lane);
    this.revs(dt);
    if (project(this.lane, this.car.position.x, this.car.position.z) > this.lane.s1 + 0.5) {
      g.bark('admire', this.beng.position, 2, { text: 'Eh, jump start! Cheat lah!' });
      return this.finish(false, 'Jump start');
    }
    const lit = left <= 0 ? 4 : left <= 1 ? 3 : left <= 2 ? 2 : left <= 3 ? 1 : 0;
    if (lit === this.lit) return;
    this.lit = lit;
    if (lit === 4) {
      g.audio?.sfx?.('race_go', { volume: 0.8 });
      g.ui.raceLights({ title: 'Go!', sub: `<b>${LENGTH} m</b>`, go: true });
      this.drive(this.route, 0.62, 1); // (~150 km/h by the line: quick, not suicidal)
      this.state = 'race'; this.t = 0;
      return;
    }
    if (lit) g.audio?.sfx?.('race_beep', { volume: 0.7 });
    g.ui.raceLights({ title: `Street race · ${LENGTH} m`, sub: 'Go on <em>green</em>. Jump it and you lose.', lights: lit });
  }

  race() {
    const g = this.game, [fx, fz, dx, dz] = this.line;
    const toGo = o => (fx - o.position.x) * dx + (fz - o.position.z) * dz;
    const me = toGo(this.car), him = toGo(this.beng);
    if (me <= 0 || him <= 0) return this.finish(me <= him);
    if (this.t > 1.2) g.ui.raceLights({ title: me < him ? 'Ahead' : 'Ah Beng ahead', sub: `<b>${Math.max(0, Math.round(me))} m</b> to go` });
    if (this.t > 45 || me > LENGTH + 150) this.finish(false);
  }

  /** won (true), lost (false) or called off (null) */
  finish(won, why) {
    const g = this.game;
    if (won !== null) g.events.emit('dragRace', won);
    if (won === true) {
      g.addMoney(PRIZE);
      g.hype?.bump(0.01, 'Your street race went viral on TikTok');
      g.ui.stunt.show({ title: 'Ah Beng Defeated', lines: [`${LENGTH} m: ${this.t.toFixed(2)} s`], reward: PRIZE });
      g.bark('admire', this.beng.position, 2, { text: pick(WON) });
      g.ui.raceLights(null);
    } else if (won === false) {
      g.ui.raceLights({ title: why || 'Ah Beng wins', sub: `"${pick(LOST)}"` });
      setTimeout(() => { if (this.state !== 'ask' && this.state !== 'count' && this.state !== 'race') g.ui.raceLights(null); }, 3500);
    } else g.ui.raceLights(null);
    this.coolT = COOL;
    if (!this.beng) return this.clear();
    // he drives off down the road either way (and is gone once out of sight)
    if (this.state !== 'race') this.drive(this.route, 0.7, 0.6);
    this.state = 'done'; this.t = 0;
  }

  far() {
    const g = this.game, p = this.beng.position;
    return p.distanceTo(g.player.position) > 160 && !g.traffic.seen(p);
  }

  clear() {
    const g = this.game;
    this.stopDriving();
    if (this.beng) {
      const i = g.vehicles.indexOf(this.beng); if (i >= 0) g.vehicles.splice(i, 1);
      this.beng.dispose(); this.beng = null;
    }
    this.glow.hide();
    this.state = 'idle'; this.car = null;
  }
}

// --------------------------------------------------------------------------------------------- road helpers
/** arc length of lane's nearest point to (x,z) */
function project(lane, x, z) {
  const P = lane.path.st.xyz, o = lane.path.o, n = lane.path.n;
  let bd = Infinity, bs = 0;
  for (let i = 0; i < n - 1; i++) {
    const q = (o + i) * 3, ax = P[q], az = P[q + 2], dx = P[q + 3] - ax, dz = P[q + 5] - az, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), ex = ax + dx * t - x, ez = az + dz * t - z;
    if (ex * ex + ez * ez < bd) { bd = ex * ex + ez * ez; bs = lane.path.arc(i) + Math.sqrt(L2) * t; }
  }
  return bs;
}

/** [x, z, dx, dz]: the point `at` m along a [[x,z], ...] route and its direction there */
function finishLine(route, at) {
  for (let i = 0; i < route.length - 1; i++) {
    const [ax, az] = route[i], dx = route[i + 1][0] - ax, dz = route[i + 1][1] - az, L = Math.hypot(dx, dz) || 1;
    if (at <= L) return [ax + dx * at / L, az + dz * at / L, dx / L, dz / L];
    at -= L;
  }
  const [x, z] = route[route.length - 1]; return [x, z, 0, 0];
}

/** [[x,z], ...] from lane at s straight on for `len` m (straight-most connectors; null if the road bends away >25°) */
function straight(lane, s, len) {
  const pts = [];
  let l = lane, a = s, run = 0, d0 = null;
  for (let hop = 0; hop < 8 && run < len; hop++) {
    for (let u = a; u <= l.s1 && run < len; u += 6, run += 6) {
      l.path.sample(u, _v, _d); pts.push([_v.x, _v.z]);
      if (!d0) d0 = [_d.x, _d.z]; else if (_d.x * d0[0] + _d.z * d0[1] < 0.9) return null;
    }
    if (run >= len) break;
    let best = null; for (const o of l.next) if (Math.abs(o.turn) < 0.3 && (!best || Math.abs(o.lane.idx - l.idx) < Math.abs(best.lane.idx - l.idx))) best = o;
    if (!best) return null;
    const c = best.path; for (let k = 1; k < c.n; k++) { pts.push([c.x(k), c.z(k)]); }
    run += c.length; l = best.lane; a = l.s0;
  }
  return pts.length > 2 ? pts : null;
}

// --------------------------------------------------------------------------------------------- underglow
// One soft magenta rounded rectangle on the road under Ah Beng's car (additive, so it only shows in the dark); made at
// load so its program is compiled in the warm-up.
function makeGlow(scene) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(GLOW) }, uAmt: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: 'varying vec2 vP; void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uAmt; varying vec2 vP;
      void main() {
        vec2 q = abs(vP) - vec2(0.75, 1.9); float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);  // car-sized box
        float a = exp(-max(d, 0.0) * 2.6) * (d < 0.0 ? 0.75 : 1.0) * (1.0 - smoothstep(0.7, 1.0, max(abs(vP.x) / 1.8, abs(vP.y) / 3.1)));  // fading out before the quad edge
        gl_FragColor = vec4(uColor * a * uAmt, 1.0);
      }`,
  });
  // (the plane stays in its own xy, which the shader reads; the mesh lays it flat and turns it with the car)
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 6.2), mat);
  mesh.rotation.order = 'YXZ'; mesh.rotation.x = -Math.PI / 2;
  mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 2;
  scene.add(mesh);
  const u = mat.uniforms;
  return {
    follow(v, g, night) {
      mesh.visible = night > 0.05 && !v.exploded;
      if (!mesh.visible) return;
      mesh.position.set(v.position.x, v.position.y + 0.1, v.position.z); // (the body origin is at the wheels contact; the road deck sits a few cm up)
      mesh.rotation.y = v.yaw();
      u.uAmt.value = 1.6 * night * (0.85 + 0.15 * Math.sin(g.U.time.value * 7));
    },
    hide() { mesh.visible = false; },
  };
}
