// AI traffic: cars follow lanes (left-hand traffic), obey signals, keep distance (IDM), yield at junctions,
// react to the player, get knocked about (switch to dynamic physics), and stream in/out around the player.
// How they move: every driver (own temperament: acceleration, braking, headway, cornering, reaction time) plans its
// speed for the bends ahead — settling at a comfortable cornering speed before a turn, not inside it — and each car
// is a kinematic bicycle: the rear axle rolls along its heading while the front wheels steer by pure pursuit of the
// route a little ahead, so bodies swing through corners rather than pivot on the lane line. Bodies roll, dive and
// squat on a damped spring; indicators blink before and through turns.
import * as THREE from 'three';
import { FILTER } from '../physics/physics.js';
import { clearLine } from '../core/visibility.js';
import { VEHICLE_SPECS, pickTrafficType, TrafficRenderer } from './vehicles/index.js';

const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3(), _k = new THREE.Vector3(), _q = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _lights = { head: false, brake: false, siren: false, indicatorL: false, indicatorR: false };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrap = a => (a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a); // for |a| < 3π
const STEER_RATE = 1.4; // rad/s at the road wheels: a calm driver's hands
const FAR = 140, FARTHER = 200; // m from the camera: beyond, cars are driven every 2nd / 3rd frame
const MERGE = 12; // m: a car merging into one's lane counts as in front once this close to the merge (not from afar)
const LOOK0 = 1, LOOKV = 0.35; // pure-pursuit distance from the rear axle: wheelbase + LOOK0 + LOOKV * speed (m)
// indicator for a connector: + right, - left (U-turns go right: left-hand traffic)
const turnSide = conn => (!conn || Math.abs(conn.turn) < 0.5 ? 0 : conn.turn > 0 ? 1 : -1);

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
    this.clock = 0; // s of traffic time: junction entry order (first come, first through)
    this.frame = 0;
    this.recycleT = 0;
    // the route ahead of the car being driven: up to 6 (path, from s, to s, speed limit or 0) segments, see _route()
    this._rp = new Array(6).fill(null); this._ra = new Float64Array(6); this._rb = new Float64Array(6); this._rv = new Float64Array(6); this._rn = 0;
    game.physics.onStep(h => this.fixedStep(h));
  }

  pickNext(lane) {
    let opts = lane.next; if (!opts.length) return null;
    const open = opts.filter(o => !o.lane.closed); if (open.length) opts = open;
    // prefer going straight on bigger roads; hairpins (tighter than most cars' lock) only when there is nothing else
    let tot = 0; const w = opts.map(o => { const a = Math.abs(o.turn), s = a < 0.5 ? 3 : a > 2.4 ? 0.02 : 1; const c = o.lane.cls <= lane.cls ? 1.5 : 1; const v = s * c; tot += v; return v; });
    let r = Math.random() * tot; for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i]; }
    return opts[0];
  }

  spawnAt(lane, s, type = pickTrafficType(), color) {
    const spec = VEHICLE_SPECS[type];
    if (!spec) return null;
    color ??= spec.colours[Math.floor(Math.random() * spec.colours.length)];
    const P = this.game.physics, R = P.R;
    lane.path.sample(s, _p, _d);
    const yaw = Math.atan2(-_d.x, -_d.z), wb = spec.wheelBase;
    const body = P.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(_p.x, _p.y, _p.z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }));
    const hh = spec.height / 2 * 0.9;
    const col = P.world.createCollider(R.ColliderDesc.cuboid(spec.width / 2 * 0.92, hh, spec.length / 2 * 0.95).setTranslation(0, hh + 0.15, 0).setCollisionGroups(FILTER.traffic).setFriction(0.4)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(2000).setMass(spec.mass), body);
    // temperament: one 0..1 "hurry" with some scatter per trait; heavy vehicles pull away and corner gently
    const hurry = Math.random(), jit = () => (Math.random() - 0.5) * 0.3, heavy = spec.mass > 3000;
    const vf = 0.82 + 0.26 * clamp(hurry + jit(), 0, 1);
    const car = {
      id: carIds++, type, color, spec, body, collider: col, lane, s, mode: 'lane', conn: null, cs: 0,
      speed: Math.min(lane.speed, 8 + Math.random() * 6), vf, vmax: lane.speed * vf * (this.kiasu ? 1.6 : 1), len: spec.length,
      aMax: (heavy ? 1.0 : 1.5) + 1.2 * clamp(hurry + jit(), 0, 1), bComf: (heavy ? 1.3 : 1.6) + 0.9 * clamp(hurry + jit(), 0, 1),
      headway: 1.65 - 0.65 * clamp(hurry + jit(), 0, 1), gap0: 2.8 - 1.0 * clamp(hurry + jit(), 0, 1),
      aLat: (heavy ? 1.4 : 1.8) + 1.1 * clamp(hurry + jit(), 0, 1), react: 1.2 - 0.8 * clamp(hurry + jit(), 0, 1) + Math.random() * 0.1,
      pos: _p.clone(), yaw, rx: _p.x + Math.sin(yaw) * wb / 2, rz: _p.z + Math.cos(yaw) * wb / 2, // rear axle
      wheelSpin: 0, steer: 0, acc: 0, go: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0, lag: 0,
      brake: false, committed: null, wait: 0, honkT: 0, state: 'drive', rid: this.renderer.add(type, color),
      siren: type === 'police' && Math.random() < 0.15,
    };
    // the next two junctions are decided ahead (speed planning and indicators look that far)
    car.nextConn = this.pickNext(lane);
    car.nextConn2 = car.nextConn && this.pickNext(car.nextConn.lane);
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
    let gap = 1e9, leaderSpeed = 0, person = false;
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
        // cars in the junction: on our connector; just gone out of our lane on another one (still right in front);
        // merging into the lane we are heading for and nearer that merge
        const rc = remain + car.nextConn.path.length;
        for (const o of this.net.nodes[car.lane.to].occ || []) {
          let d = 1e9;
          if (o.conn === car.nextConn || (o.fromLane === car.lane && o.cs < o.len + 4)) d = remain + o.cs - half - o.len / 2;
          else if (o.conn.lane === nl) { const ro = o.conn.path.length - o.cs; if (ro < rc && ro < MERGE) d = rc - ro - half - o.len / 2; }
          if (d < gap) { gap = d; leaderSpeed = o.speed; }
        }
        // signals: stop for amber / red unless too close to stop smoothly — then the driver is committed and goes on
        const sig = this.net.signalFor(car.lane), canStop = remain - half - 1 > car.speed * car.speed / 6;
        if (sig === 'amber' || sig === 'red') {
          if (sig === 'amber' && !canStop) car.committed = car.lane;
          else if (car.speed < 2) car.committed = null; // held up short of the line after all: wait for the next green
          if (car.committed !== car.lane) { const d = remain - half - 1; if (d < gap) { gap = Math.max(0, d); leaderSpeed = 0; } }
        }
        if ((canStop || car.speed < 1) && car.wait < 8) {
          // unsignalised junction: yield if occupied by crossing traffic (unless already too close to stop)
          const node = this.net.nodes[car.lane.to];
          if (sig === 'none' && node.degree >= 3 && car.wait < 4) {
            for (const o of node.occ || []) if (o.fromLane !== car.lane && o.conn?.lane !== car.nextConn.lane) { const d = remain - half - 0.5; if (d < gap) { gap = Math.max(0, d); leaderSpeed = 0; } break; }
          }
          // anyone in the junction standing across our way (cross traffic clearing it at the start of green, a turn
          // across ours): wait at the line
          if (node.occ?.size && this._across(car, node.occ, car.nextConn.path, 0, 1e9) < 1e9) { const d = remain - half - 0.5; if (d < gap) { gap = Math.max(0, d); leaderSpeed = 0; } }
        }
      }
    } else {
      const remain = car.conn.path.length - car.cs, nl = car.conn.lane;
      // ahead on our connector, or on another one out of the same lane while the two still overlap; merging into our
      // lane and nearer the merge (strict orders: nobody waits for someone who waits for them)
      for (const o of this.net.nodes[car.connNodeId].occ) {
        if (o === car) continue;
        let d = 1e9;
        if ((o.conn === car.conn || (o.fromLane === car.fromLane && o.cs < o.len + 4)) && o.cs > car.cs) d = o.cs - car.cs - half - o.len / 2;
        else if (o.conn.lane === nl) { const ro = o.conn.path.length - o.cs; if (ro < remain && ro < MERGE) d = remain - ro - half - o.len / 2; }
        if (d < gap) { gap = d; leaderSpeed = o.speed; }
      }
      for (const o of nl.cars) { if (o.mode !== 'lane') continue; const d = remain + (o.s - nl.s0) - half - o.len / 2; if (d < gap) { gap = d; leaderSpeed = o.speed; } }
      // a car that came into the junction before us and stands across our way: give way to it
      const d = this._across(car, this.net.nodes[car.connNodeId].occ, car.conn.path, car.cs, car.connT);
      if (d < gap) { gap = Math.max(0, d); leaderSpeed = 0; }
    }
    // dynamic obstacles (player, pedestrians) in a forward cone
    const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
    for (const ob of this.obstacles) {
      const dx = ob.x - car.pos.x, dz = ob.z - car.pos.z;
      const ahead = dx * fx + dz * fz; if (ahead < 0 || ahead > 35) continue;
      const lat = Math.abs(dx * -fz + dz * fx);
      if (lat < 1.3 + (ob.r || 0.5)) { const d = ahead - half - (ob.r || 0.5) - 0.8; if (d < gap) { gap = Math.max(0, d); leaderSpeed = 0; car.blockedByPlayer = ob.player; person = true; } }
    }
    const r = this._lg || (this._lg = { gap: 0, leaderSpeed: 0, person: false }); r.gap = gap; r.leaderSpeed = leaderSpeed; r.person = person; // reused: callers destructure immediately
    return r;
  }

  /** distance along `path` from arc length `from` to the first car among `occ` (that entered the junction before time
   * `since`) whose body is in our way within the next 25 m; 1e9 if none. First come, first through: a car never waits
   * for one that came in after it, so nobody waits in a circle. */
  _across(car, occ, path, from, since) {
    let gap = 1e9;
    for (const o of occ) {
      if (o === car || o.connT >= since) continue;
      const w = (car.spec.width + o.spec.width) * 0.5 + 0.3, ox = o.pos.x, oz = o.pos.z;
      for (let i = 0; i < path.n - 1; i++) {
        const s0 = path.arc(i), s1 = path.arc(i + 1);
        if (s1 < from) continue; if (s0 > from + 25) break;
        const ax = path.x(i), az = path.z(i), dx = path.x(i + 1) - ax, dz = path.z(i + 1) - az, L2 = dx * dx + dz * dz || 1;
        const t = clamp(((ox - ax) * dx + (oz - az) * dz) / L2, 0, 1), px = ax + dx * t - ox, pz = az + dz * t - oz;
        if (px * px + pz * pz < w * w) { const d = s0 + (s1 - s0) * t - from - car.len / 2 - o.spec.width / 2; if (d > -car.len / 2 && d < gap) gap = d; break; }
      }
    }
    return gap;
  }

  update(dt) {
    if (!this.enabled) return;
    this.clock += dt;
    const net = this.net;
    if (!this._occInit) { for (const n of net.nodes) if (!n.occ) n.occ = new Set(); this._occInit = true; }
    net.updateSignals(dt);
    const pp = this.game.player?.position || this.game.camera.position, cam = this.game.camera.position;
    // spawn / despawn
    this.spawnTimer -= dt;
    this.recenter = (this.recenter || 0) - dt; // after a relocation: seed the new area at once (behind the fade)
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.08;
      let active = 0; for (const c of this.cars) if (c.state === 'drive') active++;
      // after a teleport / at start, seed the area immediately (nobody is watching yet)
      const seeding = this.recenter > 0 || active < this.target * 0.35;
      // a full quota with cars far behind the camera: let one go now and then, so the next appears where it's seen
      if (!seeding && active >= this.target && (this.recycleT -= 0.08) <= 0) {
        this.recycleT = 1.5;
        let far = null, fd = 140;
        for (const c of this.cars) { if (c.state !== 'drive' || c.keep) continue; const d = Math.hypot(c.pos.x - pp.x, c.pos.z - pp.z); if (d > fd && !this.inView(c.pos, 0)) { far = c; fd = d; } }
        if (far) { this.despawn(far); active--; }
      }
      if (active < this.target) {
        const lanes = net.lanesNear(pp.x, pp.z, this.radius).filter(l => l.cls <= 5 && l.s1 - l.s0 > 20 && !l.closed);
        let rays = 1; // sight test (two ray casts) for one in-view spot per tick at most
        // prefer bigger roads: they carry more traffic
        for (let k = 0; k < (seeding ? 30 : 6) && lanes.length; k++) {
          const l = lanes[Math.floor(Math.random() * lanes.length)];
          if (l.cls >= 5 && Math.random() < 0.5) continue;
          const s = l.s0 + Math.random() * (l.s1 - l.s0);
          l.path.sample(s, _p);
          const d = Math.hypot(_p.x - pp.x, _p.z - pp.z);
          if (d < (seeding ? 25 : 60) || d > this.radius) continue;
          if (l.cars.some(o => Math.abs(o.s - s) < 14)) continue;
          if (!seeding) {
            // ahead of the camera rather than behind it; within 180 m in view only where a building hides the spot
            const seen = this.inView(_p, 0);
            if (!seen && Math.random() < 0.5) continue;
            if (seen && d < 180 && this.inView(_p) && (!rays-- || clearLine(this.game, cam, _k.set(_p.x, _p.y + 1.2, _p.z)))) continue;
          }
          this.spawnAt(l, s);
          if (!seeding) break;
        }
      }
    }
    this.frame = (this.frame + 1) % 6000;
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
      // far off (a few pixels on a phone, and past the headlight pools) a car is driven every 2nd or 3rd frame
      const dx = c.pos.x - cam.x, dz = c.pos.z - cam.z, d2 = dx * dx + dz * dz, every = d2 > FARTHER * FARTHER ? 3 : d2 > FAR * FAR ? 2 : 1;
      if (every > 1 && (c.id + this.frame) % every) { c.lag += dt; continue; }
      this.drive(c, dt + c.lag); c.lag = 0;
    }
    this.renderer.update(dt);
  }

  inView(p, cos = 0.45) {
    const cam = this.game.camera; _d.subVectors(p, cam.position); const f = this._f || (this._f = new THREE.Vector3()); cam.getWorldDirection(f);
    return _d.normalize().dot(f) > cos;
  }

  /** the route ahead of car c as segments (path, from s, to s, lane speed or 0): where it is, then two junctions on */
  _route(c) {
    const P = this._rp, A = this._ra, B = this._rb, V = this._rv;
    let n = 0;
    if (c.mode === 'lane') { P[n] = c.lane.path; A[n] = c.s; B[n] = c.lane.s1; V[n++] = 0; }
    else { P[n] = c.conn.path; A[n] = c.cs; B[n] = c.conn.path.length; V[n++] = 0; const l = c.conn.lane; P[n] = l.path; A[n] = l.s0; B[n] = l.s1; V[n++] = l.speed; }
    for (let k = 0, x = c.nextConn; k < 2 && x; k++, x = c.nextConn2) {
      P[n] = x.path; A[n] = 0; B[n] = x.path.length; V[n++] = 0;
      const l = x.lane; P[n] = l.path; A[n] = l.s0; B[n] = l.s1; V[n++] = l.speed;
    }
    this._rn = n;
  }

  /** the point `d` m along the current route from the car's progress point */
  _routeAt(d, out) {
    const P = this._rp, A = this._ra, B = this._rb, n = this._rn;
    let k = 0, s = A[0] + d;
    while (s > B[k] && k < n - 1) { s = A[k + 1] + (s - B[k]); k++; }
    return P[k].sample(s, out);
  }

  /** the fastest the driver may go now and still settle, braking gently, into every bend ahead at its cornering speed
   * (and into a slower road's speed by the time it gets there) */
  _bendLimit(c) {
    const P = this._rp, A = this._ra, B = this._rb, V = this._rv, n = this._rn, b2 = 2 * c.bComf * 0.7;
    const horizon = c.speed * c.speed / b2 + 15, half = c.len * 0.5, aLat = c.aLat;
    const l0 = 1.5 * (c.spec.wheelBase + LOOK0), lv = 1.5 * LOOKV; // pursuit rounds a lone kink off over ~1.5x its look-ahead
    let lim = c.vmax, d0 = 0;
    for (let k = 0; k < n && d0 < horizon; k++) {
      const a = A[k], b = B[k], bends = P[k].bends();
      for (let i = 0; i < bends.length; i += 4) {
        // bend [from s, to s, total turn, length]: the car turns it over its length, or over the stretch its pursuit
        // rounds it off to if that is longer (a lone kink): the cornering speed v solves
        // v² * turn = aLat * max(length, l0 + lv * v)
        const sa = bends[i], th = bends[i + 2], len = bends[i + 3];
        if (bends[i + 1] < a - half || sa > b) continue; // behind the car, or past this segment's end
        let vc2 = aLat * len / th;
        if (len < l0 + lv * Math.sqrt(vc2)) { const q = lv * aLat, vc = (q + Math.sqrt(q * q + 4 * th * aLat * l0)) / (2 * th); vc2 = vc * vc; }
        const v2 = vc2 + b2 * Math.max(0, d0 + sa - a - half);
        if (v2 < lim * lim) lim = Math.sqrt(v2);
      }
      if (V[k] && k) { const vl = V[k] * c.vf * (this.kiasu ? 1.6 : 1), v2 = vl * vl + b2 * d0; if (v2 < lim * lim) lim = Math.sqrt(v2); }
      d0 += Math.max(0, b - a);
    }
    return lim;
  }

  drive(c, dt) {
    const { gap, leaderSpeed, person } = this.leaderGap(c);
    this._route(c);
    // --- speed: IDM car-following with the driver's own parameters; the free-road term aims at the bend-planned limit
    // and sheds any excess gently (its (v / v0)^4 alone would brake at up to -9 m/s² when the limit drops)
    const v = c.speed, vRef = Math.max(1.5, this._bendLimit(c));
    const free = Math.max(-c.bComf * 1.4, c.aMax * (1 - (v / vRef) ** 4));
    const sStar = c.gap0 + v * c.headway + v * (v - leaderSpeed) / (2 * Math.sqrt(c.aMax * c.bComf));
    let acc = Math.max(-9, free - c.aMax * (Math.max(0, sStar) / Math.max(0.1, gap)) ** 2);
    // standing: when the way clears (green, the car in front pulls away) the driver needs a moment — down a queue the
    // delays add up, so a queue ripples into motion instead of leaving as one block
    if (v < 0.4 && acc > 0.3) { c.go += dt; if (c.go < c.react) acc = Math.min(acc, 0); } else c.go = 0;
    // pedal smoothing (jerk limit): gentle onto and off the brake, but an urgent stop is not delayed
    const j = (acc > c.acc ? 3.5 : acc < -3 ? 30 : 6) * dt;
    c.acc += clamp(acc - c.acc, -j, j);
    c.speed = Math.max(0, v + c.acc * dt);
    if (c.speed === 0 && c.acc < 0) c.acc = 0; // held on the brake: no deceleration (nor dive) at a standstill
    // last resort against overlapping another car (someone who appeared right in front); for a person stepping out the
    // full emergency stop above has to do
    if (gap < 0.3 && !person) c.speed = Math.min(c.speed, 0.5);
    c.brake = c.acc < -0.8 || c.speed < 0.2;
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
        c.mode = 'conn'; c.conn = conn; c.cs = over; c.fromLane = c.lane; c.connNodeId = c.lane.to; c.connT = this.clock;
        c.connNode = this.net.nodes[c.lane.to]; c.connNode.occ.add(c);
        c.nextConn = c.nextConn2 || this.pickNext(conn.lane);
        c.nextConn2 = c.nextConn && this.pickNext(c.nextConn.lane);
        this._route(c);
      } else this._ra[0] = c.s;
    } else {
      c.cs += ds;
      if (c.cs >= c.conn.path.length) {
        const nl = c.conn.lane;
        c.connNode.occ.delete(c); c.connNode = null;
        c.mode = 'lane'; c.lane = nl; c.s = nl.s0 + (c.cs - c.conn.path.length); c.conn = null;
        nl.cars.push(c);
        c.vmax = nl.speed * c.vf * (this.kiasu ? 1.6 : 1);
        c.nextConn ??= this.pickNext(nl);
        this._route(c);
      } else this._ra[0] = c.cs;
    }
    // --- pose: kinematic bicycle. Pure pursuit: steer the front wheels so the rear axle arcs onto a point on the
    // route ahead (further at speed); the heading changes only as the car rolls, by ds * tan(steer) / wheelbase.
    const sp = c.spec, wb = sp.wheelBase, ld = wb + LOOK0 + LOOKV * c.speed;
    this._routeAt(ld - wb / 2, _t); // the progress point is the body centre; the rear axle is half a wheelbase back
    // the arc to the target has curvature 2 * left / dist² (left: the target's offset from the heading line, + left)
    const tx = _t.x - c.rx, tz = _t.z - c.rz, left = tz * Math.sin(c.yaw) - tx * Math.cos(c.yaw);
    const want = clamp(Math.atan2(2 * wb * left, Math.max(1, tx * tx + tz * tz)), -sp.steerMax, sp.steerMax);
    c.steer += clamp(want - c.steer, -STEER_RATE * dt, STEER_RATE * dt);
    const dyaw = ds * Math.tan(c.steer) / wb, ym = c.yaw + dyaw / 2;
    c.rx -= Math.sin(ym) * ds; c.rz -= Math.cos(ym) * ds; c.yaw = wrap(c.yaw + dyaw);
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    let cx = c.rx + fx * wb / 2, cz = c.rz + fz * wb / 2;
    // keep the AI's progress where the body is (it cuts corners a little, so it would drift ahead of it)
    if (c.mode === 'lane') c.lane.path.sample(c.s, _p, _d); else c.conn.path.sample(c.cs, _p, _d);
    const dh = Math.sqrt(_d.x * _d.x + _d.z * _d.z) || 1, ux = _d.x / dh, uz = _d.z / dh, ex = cx - _p.x, ez = cz - _p.z;
    const along = clamp(ex * ux + ez * uz, -1, 1) * Math.min(1, dt * 5);
    if (c.mode === 'lane') c.s += along; else c.cs = Math.max(0, c.cs + along);
    // safety net: a car that ends up far off its line (a turn much tighter than its lock, say) is eased back onto it
    const off = ex * -uz + ez * ux;
    if (Math.abs(off) > 5) { const k = (off - Math.sign(off) * 5) * Math.min(1, dt * 2); c.rx += uz * k; c.rz -= ux * k; cx += uz * k; cz -= ux * k; }
    // body: roll with the cornering force, dive under braking, squat pulling away — on a damped spring
    const h = Math.min(dt, 0.05), aLat = c.speed * c.speed * Math.tan(c.steer) / wb, bike = !sp.track;
    const rollT = bike ? Math.atan(aLat / 9.81) : clamp(-aLat * 0.0075 * sp.height / 1.45, -0.05, 0.05);
    const pitchT = bike ? 0 : clamp(c.acc * (c.acc < 0 ? 0.0065 : 0.0045), -0.03, 0.02);
    c.rollV += (64 * (rollT - c.roll) - 9.6 * c.rollV) * h; c.roll += c.rollV * h;
    c.pitchV += (81 * (pitchT - c.pitch) - 9 * c.pitchV) * h; c.pitch += c.pitchV * h;
    // the collider follows in fixedStep(): per physics step along this velocity (a frame with two steps or none would
    // otherwise give the kinematic body 0 / 2x its real speed, and side-swipes would feel random)
    const kv = c.kv || (c.kv = new THREE.Vector3()), inv = 1 / Math.max(dt, 1e-3);
    kv.set((cx - c.pos.x) * inv, (_p.y - c.pos.y) * inv, (cz - c.pos.z) * inv); c.kt = 0;
    c.pos.set(cx, _p.y, cz);
    const slope = Math.asin(clamp(_d.y, -0.3, 0.3)), kq = c.kq || (c.kq = new THREE.Quaternion());
    kq.setFromEuler(_e.set(slope, c.yaw, 0, 'YXZ'));
    if (bike) _q.setFromEuler(_e.set(slope, c.yaw, c.roll, 'YXZ')); else _q.copy(kq);
    const tilt = !bike && Math.abs(c.pitch) + Math.abs(c.roll) > 2e-4 ? _qt.setFromEuler(_e.set(c.pitch, 0, c.roll, 'YXZ')) : null;
    c.wheelSpin -= ds / (sp.wheelRadius || 0.33);
    // indicators: ~2.5 s (at least 12 m) before a turn, and through it
    const side = c.mode === 'conn' ? turnSide(c.conn) : c.lane.s1 - c.s < Math.max(12, c.speed * 2.5) ? turnSide(c.nextConn) : 0;
    const L = _lights; L.head = this.game.U.night.value > 0.3; L.brake = c.brake; L.siren = c.siren; L.indicatorL = side < 0; L.indicatorR = side > 0;
    this.renderer.setTransform(c.rid, c.pos, _q, c.wheelSpin, c.steer, L, tilt);
  }
}
