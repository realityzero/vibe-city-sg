// AI traffic: cars follow lanes (left-hand traffic), obey signals, keep distance (IDM), yield at junctions,
// react to the player, get knocked about (switch to dynamic physics), and stream in/out around the camera — spent where
// it looks, as many as the hour of the day puts on the road.
// How they move: every driver (own temperament: acceleration, braking, headway, cornering, reaction time) plans its
// speed for the bends ahead — settling at a comfortable cornering speed before a turn, not inside it — and each car
// is a kinematic bicycle: the rear axle rolls along its heading while the front wheels steer by pure pursuit of the
// route a little ahead, so bodies swing through corners rather than pivot on the lane line. Bodies roll, dive and
// squat on a damped spring; indicators blink before and through turns.
import * as THREE from 'three';
import { FILTER } from '../physics/physics.js';
import { clearLine } from '../core/visibility.js';
import { VEHICLE_SPECS, pickTrafficType, TrafficRenderer } from './vehicles/index.js';
import { Parking } from '../world/parking.js';

const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3(), _k = new THREE.Vector3(), _q = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _sphere = new THREE.Sphere(new THREE.Vector3(), 3), _m4 = new THREE.Matrix4();
const _lights = { head: false, brake: false, siren: false, indicatorL: false, indicatorR: false };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrap = a => (a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a); // for |a| < 3π
const STEER_RATE = 1.4; // rad/s at the road wheels: a calm driver's hands
const FAR = 140, FARTHER = 200; // m from the camera: beyond, cars are driven every 2nd / 3rd frame
const POP = 170; // m: nearer than this nobody appears in plain view (unless at a camera cut, or where a building hides it)
const NEAR = 90; // m: out of view but nearer than this a car stays (the camera may turn); further behind it is recycled
// share of the quota on the road by hour: morning and evening rush, a lull after midnight
const HOURLY = [0.45, 0.35, 0.3, 0.3, 0.35, 0.5, 0.75, 0.95, 1, 0.95, 0.85, 0.85, 0.9, 0.9, 0.85, 0.85, 0.9, 1, 1, 0.95, 0.9, 0.85, 0.75, 0.6];
const CLASS_W = [1, 1, 0.9, 0.75, 0.6, 0.35]; // spawn chance per lane by road class: big roads carry the traffic
const MERGE = 12; // m: a car merging into one's lane counts as in front once this close to the merge (not from afar)
const LOOK0 = 1, LOOKV = 0.35; // pure-pursuit distance from the rear axle: wheelbase + LOOK0 + LOOKV * speed (m)
// indicator for a connector: + right, - left (U-turns go right: left-hand traffic)
const turnSide = conn => (!conn || Math.abs(conn.turn) < 0.5 ? 0 : conn.turn > 0 ? 1 : -1);
// lanes moved across going from lane a into lane b, each placed from the middle of its carriageway (lanes added or
// dropped share out about the middle)
const laneShift = (a, b) => Math.abs(a.idx - (a.nLanes - 1) / 2 - b.idx + (b.nLanes - 1) / 2);
const SIDE = 2.8; // m centre to centre: two lanes closer than this can't each take a car side by side
const _a = new THREE.Vector3(), NONE = Object.freeze([]);
/** over how many metres (from its end if `end`, else from its start) lane a runs within SIDE of lane b's last / first
 * 60 m, 0 if it doesn't: where a road joins or leaves another at a shallow angle the lanes of both run into / out of
 * the junction overlapping (and some roads' stop lines lie on another road's lane) */
function alongside(a, b, end) {
  const P = b.path, from = end ? b.s1 - 60 : b.s0, to = end ? b.s1 : b.s0 + 60;
  let z = 0;
  for (let k = 0; k <= 40 && k <= a.s1 - a.s0; k++) {
    a.path.sample(end ? a.s1 - k : a.s0 + k, _a);
    let d2 = 1e9;
    for (let i = 0; i < P.n - 1; i++) {
      if (P.arc(i + 1) < from) continue;
      if (P.arc(i) > to) break;
      const ax = P.x(i), az = P.z(i), dx = P.x(i + 1) - ax, dz = P.z(i + 1) - az, t = clamp(((_a.x - ax) * dx + (_a.z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      if (Math.abs(P.y(i) + (P.y(i + 1) - P.y(i)) * t - _a.y) > 2.5) continue; // (one above the other)
      const ex = ax + dx * t - _a.x, ez = az + dz * t - _a.z; d2 = Math.min(d2, ex * ex + ez * ez);
    }
    if (d2 < SIDE * SIDE) z = k + 1; else if (k > 4) break;
  }
  return z;
}
/** is car o near enough to car c to be beside it? */
const beside = (c, o) => { const dx = o.pos.x - c.pos.x, dz = o.pos.z - c.pos.z, r = (c.len + o.len) / 2 + SIDE; return dx * dx + dz * dz < r * r; };

let carIds = 0;
export class Traffic {
  constructor(game, { target = 90, radius = 340, farFrom = 170, parked = { max: 28, radius: 140 } } = {}) {
    this.game = game;
    this.net = game.roadnet;
    this.target = target;
    this.radius = radius;
    // beyond farFrom m from the camera (and 100 m from the player) a car is a far stand-in: no physics body, drawn as a
    // painted box (a few pixels: most of the city's traffic, for little of its cost)
    this.farFrom = farFrom;
    this.cars = [];
    this.renderer = new TrafficRenderer(game.scene, { maxPerType: 72, maxFar: 200 });
    this.obstacles = []; // {x, z, r} dynamic obstacles (player, peds)
    this.spawnTimer = 0;
    this.enabled = true;
    this.clock = 0; // s of traffic time: junction entry order (first come, first through)
    this.frame = 0;
    this.recenter = 0; // set by Game.relocate: the new area fills at once behind the fade
    this.cut = 0;      // the camera jumped (a cut, a teleport): fill the new view as it is, no pop-in to avoid
    // the viewer: where the camera is and which way it looks (traffic lives around the camera, not the player)
    this.viewer = new THREE.Vector3(); this.fwd = new THREE.Vector2(0, -1); this.frustum = new THREE.Frustum();
    this._lastViewer = null;
    this._lanes = [];
    this.parking = new Parking(game, parked);
    // the route ahead of the car being driven: up to 6 (path, from s, to s, speed limit or 0) segments, see _route()
    this._rp = new Array(6).fill(null); this._ra = new Float64Array(6); this._rb = new Float64Array(6); this._rv = new Float64Array(6); this._rn = 0;
    // per lane id: other roads' lanes alongside it at its end / its start (see _joins / _splits)
    this._jn = new Array(this.net.lanes.length); this._sp = new Array(this.net.lanes.length);
    this._kp = new Array(this.net.lanes.length); // per lane id: the connectors out of it that keep to the lane (_keep)
    game.physics.onStep(h => this.fixedStep(h));
  }

  /** other roads' lanes running into lane l's junction alongside it, closer than SIDE: [{ lane, here: m before l's end,
   * there: m before its end }] (worked out the first time it's needed) */
  _joins(l) { return (this._jn[l.id] ??= this._alongside(l, this.net.nodes[l.to].inc, true)); }
  /** other roads' lanes running out of lane l's start junction alongside it: [{ lane, here: m after l's start, there }] */
  _splits(l) { return (this._sp[l.id] ??= this._alongside(l, this.net.nodes[l.from].out, false)); }
  _alongside(l, lanes, end) {
    let out = NONE;
    for (const b of lanes) {
      if (b.edge === l.edge) continue;
      const here = alongside(l, b, end), there = here && alongside(b, l, end);
      if (!there) continue;
      if (out === NONE) out = [];
      out.push({ lane: b, here, there });
    }
    return out;
  }
  /** does lane m join lane l's junction alongside it? */
  _joined(l, m) { for (const j of this._joins(l)) if (j.lane === m) return true; return false; }

  /** the connectors out of lane l a driver keeps to its lane by (where a road just carries on, or splits, every lane links
   * to every lane: hopping across them cuts through the cars alongside, and across the gore where a road splits). Into
   * a road that carries on, the lanes nearest this one's place across the carriageway; where roads split or merge, the
   * lanes nearest where this one ends (the far branch is for the lanes on its side) */
  _keep(l) {
    let k = this._kp[l.id];
    if (k) return k;
    const node = this.net.nodes[l.to], straight = l.next.filter(o => Math.abs(o.turn) < 0.5);
    const split = straight.some(o => o.lane.edge !== straight[0].lane.edge);
    const merge = !split && straight.length && node.inc.some(m => m.edge !== l.edge && m.next.some(o => o.lane.edge === straight[0].lane.edge && Math.abs(o.turn) < 0.5));
    if (split || merge) {
      l.path.sample(l.s1, _a, _d);
      const ax = _a.x, az = _a.z, dx = _d.x, dz = _d.z, lat = o => { o.lane.path.sample(o.lane.s0, _a); return Math.abs(dx * (_a.z - az) - dz * (_a.x - ax)); };
      const min = Math.min(...straight.map(lat));
      k = l.next.filter(o => Math.abs(o.turn) >= 0.5 || lat(o) < min + 1);
    } else k = l.next.filter(o => !l.next.some(p => p.lane.edge === o.lane.edge && laneShift(l, p.lane) < laneShift(l, o.lane) - 0.25));
    return (this._kp[l.id] = k);
  }

  /** the connector a car (optional: a bus keeps to kerb lanes) takes at the end of `lane` */
  pickNext(lane, car) {
    let opts = this._keep(lane); if (!opts.length) return null;
    const open = opts.filter(o => !o.lane.closed); if (open.length) opts = open;
    // prefer going straight on bigger roads; hairpins (tighter than most cars' lock) only when there is nothing else
    const kerb = car?.stops ? 4 : 1;
    let tot = 0; const w = opts.map(o => { const a = Math.abs(o.turn), s = a < 0.5 ? 3 : a > 2.4 ? 0.02 : 1; const c = o.lane.cls <= lane.cls ? 1.5 : 1; const v = s * c * (o.lane.idx ? 1 : kerb); tot += v; return v; });
    let r = Math.random() * tot; for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i]; }
    return opts[0];
  }

  spawnAt(lane, s, type = pickTrafficType(), color, speed) {
    const spec = VEHICLE_SPECS[type];
    if (!spec) return null;
    color ??= spec.colours[Math.floor(Math.random() * spec.colours.length)];
    lane.path.sample(s, _p, _d);
    const yaw = Math.atan2(-_d.x, -_d.z), wb = spec.wheelBase, far = this._isFar(_p, true);
    // temperament: one 0..1 "hurry" with some scatter per trait; heavy vehicles pull away and corner gently
    const hurry = Math.random(), jit = () => (Math.random() - 0.5) * 0.3, heavy = spec.mass > 3000;
    const vf = 0.82 + 0.26 * clamp(hurry + jit(), 0, 1);
    const car = {
      id: carIds++, type, color, spec, body: null, collider: null, far, lane, s, mode: 'lane', conn: null, cs: 0,
      speed: speed ?? Math.min(lane.speed, 8 + Math.random() * 6), vf, vmax: lane.speed * vf * (this.kiasu ? 1.6 : 1), len: spec.length,
      aMax: (heavy ? 1.0 : 1.5) + 1.2 * clamp(hurry + jit(), 0, 1), bComf: (heavy ? 1.3 : 1.6) + 0.9 * clamp(hurry + jit(), 0, 1),
      headway: 1.65 - 0.65 * clamp(hurry + jit(), 0, 1), gap0: 2.8 - 1.0 * clamp(hurry + jit(), 0, 1),
      aLat: (heavy ? 1.4 : 1.8) + 1.1 * clamp(hurry + jit(), 0, 1), react: 1.2 - 0.8 * clamp(hurry + jit(), 0, 1) + Math.random() * 0.1,
      pos: _p.clone(), yaw, rx: _p.x + Math.sin(yaw) * wb / 2, rz: _p.z + Math.cos(yaw) * wb / 2, // rear axle
      wheelSpin: 0, steer: 0, acc: 0, go: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0, lag: 0,
      brake: false, committed: null, wait: 0, honkT: 0, state: 'drive', rid: this.renderer.add(type, color, { far }),
      siren: type === 'police' && Math.random() < 0.15,
      // buses pull up at the stops on their lane: the stop ahead, how long they have stood there / will stand
      stops: type === 'bus', stopS: null, dwell: 0, dwellFor: 8 + Math.random() * 10, servedLane: null, servedS: 0, pullOut: 0,
      zipT: null, // when it came up to where another road's lane runs in alongside its own (its turn there, see leaderGap)
    };
    // the next two junctions are decided ahead (speed planning and indicators look that far)
    car.nextConn = this.pickNext(lane, car);
    car.nextConn2 = car.nextConn && this.pickNext(car.nextConn.lane, car);
    lane.cars.push(car);
    this.cars.push(car);
    if (!far) this._addBody(car);
    return car;
  }

  /** a parked car at a Parking spot: no AI, a body only near the player */
  park(spot) {
    const spec = VEHICLE_SPECS[spot.type];
    _p.set(spot.x, 0, spot.z);
    const far = this._isFar(_p, true);
    const car = {
      id: carIds++, type: spot.type, color: spot.color, spec, body: null, collider: null, far, lane: null, s: 0, mode: 'lane', conn: null, cs: 0,
      speed: 0, len: spec.length, pos: _p.clone(), yaw: spot.yaw, kq: new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, spot.yaw),
      wheelSpin: 0, steer: 0, state: 'parked', rid: this.renderer.add(spot.type, spot.color, { far }),
    };
    this.cars.push(car);
    this._pose(car);
    return car;
  }

  /** draw a car that is not being driven where it stands (a parked car, or one just swapped to / from its stand-in) */
  _pose(car) {
    const L = _lights; L.head = car.state === 'drive' && this.game.U.night.value > 0.3; L.brake = car.state === 'drive' && car.brake; L.siren = !!car.siren; L.indicatorL = L.indicatorR = false;
    this.renderer.setTransform(car.rid, car.pos, car.kq, car.wheelSpin, car.steer, L);
  }

  /** should a car at p be a far stand-in? (with some hysteresis once it exists) */
  _isFar(p, fresh) {
    const cam = this.game.camera.position, pp = this.game.player?.position || cam, k = fresh ? 0 : 15;
    return Math.hypot(p.x - cam.x, p.z - cam.z) > this.farFrom + k && Math.hypot(p.x - pp.x, p.z - pp.z) > 100 + k;
  }

  /** the car's kinematic body, where it is now */
  _addBody(car) {
    const P = this.game.physics, R = P.R, spec = car.spec, p = car.pos, yaw = car.yaw;
    car.body = P.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }));
    const hh = spec.height / 2 * 0.9;
    car.collider = P.world.createCollider(R.ColliderDesc.cuboid(spec.width / 2 * 0.92, hh, spec.length / 2 * 0.95).setTranslation(0, hh + 0.15, 0).setCollisionGroups(FILTER.traffic).setFriction(0.4)
      .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(2000).setMass(spec.mass), car.body);
    P.contactHandlers.set(car.collider.handle, (other, force) => this.onHit(car, other, force));
  }

  _dropBody(car) {
    if (!car.body) return;
    const P = this.game.physics;
    P.contactHandlers.delete(car.collider.handle);
    P.world.removeRigidBody(car.body);
    car.body = car.collider = null;
  }

  /** swap a car between the full model (with a body) and its far stand-in */
  _setFar(car, far) {
    if (far === car.far) return;
    car.far = far;
    this.renderer.remove(car.rid);
    car.rid = this.renderer.add(car.type, car.color, { far });
    if (car.kq) this._pose(car);
    if (far) this._dropBody(car); else if (car.state !== 'parked') this._addBody(car);
  }

  fixedStep(h) {
    for (const c of this.cars) {
      if (c.state !== 'drive' || !c.kv || !c.body) continue;
      c.kt += h;
      _k.copy(c.pos).addScaledVector(c.kv, c.kt);
      c.body.setNextKinematicTranslation(_k);
      c.body.setNextKinematicRotation(c.kq);
    }
  }

  despawn(car) {
    if (car.lane) { const i = car.lane.cars.indexOf(car); if (i >= 0) car.lane.cars.splice(i, 1); }
    if (car.connNode) car.connNode.occ.delete(car);
    this._dropBody(car);
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
    this._setFar(car, false);
    if (!car.body) this._addBody(car); // a parked car away from the player
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
    const st = { type: car.type, color: car.color, position: car.pos.clone(), yaw: car.yaw, speed: car.state === 'drive' ? car.speed : 0, parked: car.state === 'parked' };
    if (car.state === 'wreck') { const t = car.body.translation(); st.position.set(t.x, t.y, t.z); const r = car.body.rotation(); _q.set(r.x, r.y, r.z, r.w); _e.setFromQuaternion(_q); st.yaw = _e.y; }
    this.despawn(car);
    return st;
  }

  nearestCar(pos, maxD = 5) {
    let best = null, bd = maxD;
    for (const c of this.cars) { const d = c.pos.distanceTo(pos); if (d < bd) { bd = d; best = c; } }
    return best;
  }

  /** leaderGap's running nearest: car o, d m ahead */
  _lead(o, d) { if (d < this._gap) { this._gap = d; this._gs = o.speed; } }

  /** cars on lane `L` (its start `base` m ahead of the car), and on other roads' lanes leaving alongside it while still
   * in the stretch where the two overlap */
  _onLane(car, L, base) {
    const half = car.len / 2;
    for (const o of L.cars) if (o !== car) this._lead(o, base + (o.s - L.s0) - half - o.len / 2);
    for (const j of this._splits(L)) for (const o of j.lane.cars) { const go = o.s - j.lane.s0; if (go - o.len / 2 < j.there) this._lead(o, base + go - half - o.len / 2); }
  }

  /** cars on the route past the end of lane `l` (`base` m ahead of the car): in the junction (on connector `x`; just
   * gone out of `l`, or of a lane alongside it, on another one: still right in front; merging into the lane `x` leads
   * to and nearer that merge), along that lane, and on through the junction after it (`x2`) while within `horizon` —
   * the lanes between the nodes of a big junction are a few metres long, and the car beyond one is right in front */
  _ahead(car, l, x, x2, base, horizon) {
    const half = car.len / 2;
    for (let k = 0; k < 2 && x && base < horizon && base < this._gap + 10; k++) {
      const nl = x.lane, rc = base + x.path.length, node = this.net.nodes[l.to];
      for (const o of node.occ) if (o !== car && (o.conn === x || ((o.fromLane === l || this._joined(l, o.fromLane)) && o.cs < o.len + 4))) this._lead(o, base + o.cs - half - o.len / 2);
      this._merging(car, node, nl, rc);
      this._onLane(car, nl, rc);
      base = rc + nl.s1 - nl.s0; l = nl; x = k ? null : x2;
    }
  }

  /** cars heading into lane `nl` through junction `node`, in it or (unless we are in it ourselves: in the junction
   * nobody waits for those still to come in) still on their lanes, nearer the merge than our `r` m: in front, in turn
   * like a zip, once close to it — or right beside us (two lanes running into one, long connectors converging) */
  _merging(car, node, nl, r) {
    const half = car.len / 2;
    for (const o of node.occ) if (o !== car && o.conn.lane === nl) { const ro = o.conn.path.length - o.cs; if (ro < r && (ro < MERGE || beside(car, o))) this._lead(o, r - ro - half - o.len / 2); }
    if (r < 40 && car.connNode !== node) for (const m of node.inc) for (const o of m.cars) {
      // (on a lane running in alongside ours: they take turns as they came, see leaderGap)
      if (o === car || o.nextConn?.lane !== nl || (car.mode === 'lane' && car.lane.to === node.id && this._joined(car.lane, m))) continue;
      const ro = m.s1 - o.s + o.nextConn.path.length;
      if ((ro < r || (ro === r && o.id > car.id)) && (ro < MERGE || beside(car, o))) this._lead(o, r - ro - half - o.len / 2);
    }
  }

  /** leaderGap: something that will not move off (a stop line, a car across our way, a person) d m ahead */
  _stop(d) { if (d < this._gap) { this._gap = Math.max(0, d); this._gs = 0; } }

  // distance ahead along the car's route to the nearest blocking thing
  leaderGap(car) {
    const half = car.len / 2, horizon = 40 + 1.5 * car.speed;
    this._gap = 1e9; this._gs = 0;
    let person = false;
    if (car.mode === 'lane') {
      // anyone on the lane ahead of our middle, however close (one that got into us still has to be let go first)
      const L = car.lane, remain = L.s1 - car.s, gone = car.s - L.s0;
      for (const o of L.cars) if (o !== car && (o.s > car.s || (o.s === car.s && o.id > car.id))) this._lead(o, o.s - car.s - half - o.len / 2);
      // where another road's lane runs in alongside ours, a car takes its turn (zipT) on coming up to where the two
      // overlap: those on it that came up before us go first, like a zip (by distance to the junction — or to the merge
      // for one heading into the same lane as us — would starve us: its lane may be shorter than our queue); where one
      // runs out alongside, its cars further along it are in front while the two still overlap
      for (const j of this._joins(L)) {
        if (remain - half >= j.here + 10) continue;
        if (car.zipT === null) car.zipT = this.clock;
        for (const o of j.lane.cars) {
          if (o.zipT === null || o.zipT > car.zipT || (o.zipT === car.zipT && o.id > car.id)) continue;
          const same = car.nextConn && o.nextConn?.lane === car.nextConn.lane;
          this._lead(o, remain - (j.lane.s1 - o.s) + (same ? car.nextConn.path.length - o.nextConn.path.length : 0) - half - o.len / 2);
        }
      }
      for (const j of this._splits(L)) if (gone - half < j.here) for (const o of j.lane.cars) { const go = o.s - j.lane.s0; if (go > gone && go - o.len / 2 < j.there) this._lead(o, go - gone - half - o.len / 2); }
      if (remain < horizon && car.nextConn) {
        this._ahead(car, car.lane, car.nextConn, car.nextConn2, remain, horizon);
        // signals: stop for amber / red unless too close to stop smoothly — then the driver is committed and goes on
        const sig = this.net.signalFor(car.lane), canStop = remain - half - 1 > car.speed * car.speed / 6;
        if (sig === 'amber' || sig === 'red') {
          if (sig === 'amber' && !canStop) car.committed = car.lane;
          else if (car.speed < 2) car.committed = null; // held up short of the line after all: wait for the next green
          if (car.committed !== car.lane) this._stop(remain - half - 1);
        }
        const node = this.net.nodes[car.lane.to];
        if ((canStop || car.speed < 1) && car.wait < 8) {
          // unsignalised junction: yield if occupied by crossing traffic (unless already too close to stop)
          if (sig === 'none' && node.degree >= 3 && car.wait < 4) {
            for (const o of node.occ) if (o.fromLane !== car.lane && o.conn.lane !== car.nextConn.lane) { this._stop(remain - half - 0.5); break; }
          }
          // anyone in the junction standing across our way (cross traffic clearing it at the start of green, a turn
          // across ours): wait at the line
          if (node.occ.size && this._across(car, node.occ, car.nextConn.path, 0, 1e9) < 1e9) this._stop(remain - half - 0.5);
        } else if (node.occ.size && car.wait < 8) this._stop(remain + this._across(car, node.occ, car.nextConn.path, 0, 1e9, car.lane)); // too late for the line: short of them
      }
      // a bus pulls up with its middle at the shelter
      if (car.stops) {
        const sb = car.stopS = this._nextStop(car);
        if (sb !== null) this._stop(sb - car.s + car.gap0);
      }
    } else {
      const remain = car.conn.path.length - car.cs, nl = car.conn.lane, occ = this.net.nodes[car.connNodeId].occ;
      // ahead on our connector, or on another one out of the same lane while the two still overlap; merging into our
      // lane and nearer the merge (strict orders: nobody waits for someone who waits for them)
      for (const o of occ) {
        if (o === car || o.cs <= car.cs) continue;
        // (out of a lane alongside ours into the same lane as us: _merging orders the two)
        if (o.conn === car.conn || (o.cs < o.len + 4 && (o.fromLane === car.fromLane || (o.conn.lane !== nl && this._joined(car.fromLane, o.fromLane))))) this._lead(o, o.cs - car.cs - half - o.len / 2);
      }
      this._merging(car, car.connNode, nl, remain);
      this._onLane(car, nl, remain);
      if (car.nextConn) this._ahead(car, nl, car.nextConn, car.nextConn2, remain + nl.s1 - nl.s0, horizon);
      // a car that came into the junction before us and stands across our way: give way to it (one heading into the
      // same lane takes its turn at the merge instead)
      this._stop(this._across(car, occ, car.conn.path, car.cs, car.connT, null, nl));
    }
    // dynamic obstacles (player, pedestrians) in a forward cone
    const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
    for (const ob of this.obstacles) {
      const dx = ob.x - car.pos.x, dz = ob.z - car.pos.z;
      const ahead = dx * fx + dz * fz; if (ahead < 0 || ahead > 35) continue;
      const lat = Math.abs(dx * -fz + dz * fx);
      if (lat < 1.3 + (ob.r || 0.5)) { const d = ahead - half - (ob.r || 0.5) - 0.8; if (d < this._gap) { this._stop(d); car.blockedByPlayer = ob.player; person = true; } }
    }
    const r = this._lg || (this._lg = { gap: 0, leaderSpeed: 0, person: false }); r.gap = this._gap; r.leaderSpeed = this._gs; r.person = person; // reused: callers destructure immediately
    return r;
  }

  /** distance along `path` from arc length `from` to the first car among `occ` (that entered the junction before time
   * `since`, not out of lane `except` nor into lane `into`) whose body is in our way within the next 25 m; 1e9 if none.
   * First come, first through: a car never waits for one that came in after it, so nobody waits in a circle. */
  _across(car, occ, path, from, since, except, into) {
    let gap = 1e9;
    for (const o of occ) {
      if (o === car || o.connT >= since || o.fromLane === except || o.conn.lane === into) continue;
      const ox = o.pos.x, oz = o.pos.z, fx = -Math.sin(o.yaw), fz = -Math.cos(o.yaw), hl = o.len / 2, hw = o.spec.width / 2;
      for (let i = 0; i < path.n - 1; i++) {
        const s0 = path.arc(i), s1 = path.arc(i + 1);
        if (s1 < from) continue; if (s0 > from + 25) break;
        const ax = path.x(i), az = path.z(i), dx = path.x(i + 1) - ax, dz = path.z(i + 1) - az, L = Math.sqrt(dx * dx + dz * dz) || 1;
        const t = clamp(((ox - ax) * dx + (oz - az) * dz) / (L * L), 0, 1), px = ax + dx * t - ox, pz = az + dz * t - oz;
        // its body's reach across our path and along it (a car crossing at right angles reaches its half length across)
        const c = Math.abs(fx * dz - fz * dx) / L, k = Math.abs(fx * dx + fz * dz) / L, w = car.spec.width / 2 + c * hl + k * hw + 0.3;
        if (px * px + pz * pz < w * w) { const d = s0 + (s1 - s0) * t - from - car.len / 2 - (k * hl + c * hw); if (d > -car.len / 2 && d < gap) gap = d; break; }
      }
    }
    return gap;
  }

  /** cars on the road now: the quota scaled by the hour */
  quota() {
    const t = this.game.sky?.time ?? 12, h = Math.floor(t) % 24;
    return Math.round(this.target * (HOURLY[h] + (HOURLY[(h + 1) % 24] - HOURLY[h]) * (t % 1)));
  }

  update(dt) {
    if (!this.enabled) return;
    this.clock += dt;
    const net = this.net;
    if (!this._occInit) { for (const n of net.nodes) if (!n.occ) n.occ = new Set(); this._occInit = true; }
    if (!this.stops) this._busStops();
    net.updateSignals(dt);
    const pp = this.game.player?.position || this.game.camera.position, cam = this.game.camera.position;
    // the viewer: where the camera is and which way it looks
    const V = this.viewer, f = this.fwd, ce = this.game.camera.matrixWorld.elements;
    V.set(cam.x, 0, cam.z); f.set(-ce[8], -ce[10]); if (f.lengthSq() < 1e-6) f.set(0, -1); f.normalize();
    this.frustum.setFromProjectionMatrix(_m4.multiplyMatrices(this.game.camera.projectionMatrix, this.game.camera.matrixWorldInverse));
    if (!this._lastViewer || this._lastViewer.distanceToSquared(V) > 60 * 60) { this.cut = 1; this.spawnTimer = 0; this._inView = null; }
    (this._lastViewer ||= new THREE.Vector3()).copy(V);
    this.recenter -= dt; this.cut -= dt;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) { this.spawnTimer = 0.08; this._stream(); }
    this.frame = (this.frame + 1) % 6000;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.state === 'parked') {
        // stand-in when far, solid when the player is near (a few times a second)
        if ((c.id + this.frame) % 8) continue;
        if (c.far !== this._isFar(c.pos, c.far)) this._setFar(c, !c.far);
        const near = Math.hypot(c.pos.x - pp.x, c.pos.z - pp.z) < 60;
        if (near && !c.body) this._addBody(c); else if (!near && c.body) this._dropBody(c);
        continue;
      }
      if (c.state === 'wreck') {
        c.wreckT += dt;
        const t = c.body.translation(), r = c.body.rotation();
        c.pos.set(t.x, t.y, t.z); _q.set(r.x, r.y, r.z, r.w);
        this.renderer.setTransform(c.rid, c.pos, _q, c.wheelSpin, 0, { head: this.game.U.night.value > 0.3, brake: false, siren: false });
        if (c.wreckT > 60 && Math.hypot(c.pos.x - pp.x, c.pos.z - pp.z) > 120 && !this.seen(c.pos)) this.despawn(c);
        continue;
      }
      if (c.far !== this._isFar(c.pos, c.far)) this._setFar(c, !c.far);
      // far off (a few pixels on a phone, and past the headlight pools) a car is driven every 2nd or 3rd frame, a far
      // stand-in every 3rd or 4th — in between it rolls on along its heading
      const dx = c.pos.x - cam.x, dz = c.pos.z - cam.z, d2 = dx * dx + dz * dz;
      const every = c.far ? (d2 > FARTHER * FARTHER ? 4 : 3) : d2 > FARTHER * FARTHER ? 3 : d2 > FAR * FAR ? 2 : 1;
      if (every > 1 && (c.id + this.frame) % every) {
        c.lag += dt;
        if (c.far && c.kq) { const k = c.speed * c.lag; this.renderer.setTransform(c.rid, _k.set(c.pos.x - Math.sin(c.yaw) * k, c.pos.y, c.pos.z - Math.cos(c.yaw) * k), c.kq); }
        continue;
      }
      this.drive(c, dt + c.lag); c.lag = 0;
    }
    this.parking.update(dt);
    this.renderer.update(dt);
  }

  /** is p (a car-sized sphere about it) inside the view frustum? */
  seen(p) { _sphere.center.set(p.x, p.y + 1, p.z); return this.frustum.intersectsSphere(_sphere); }

  /** Spawning and recycling, a few times a second. The quota is spent where the camera looks: cars appear in view
   * beyond POP (or behind a building), just off the edges of the view ahead, and near the camera; cars left behind it
   * out of sight are let go so the next one appears where it is seen. After a cut or a relocation the new view is
   * filled at once, with queues at red lights and buses at their stops. */
  _stream() {
    const V = this.viewer, f = this.fwd, R = this.radius, quota = this.quota();
    let active = 0; for (const c of this.cars) if (c.state === 'drive') active++;
    const filling = this.recenter > 0 || this.cut > 0, seeding = filling || active < quota * 0.35;
    // recycle: out of sight and behind the camera beyond the near ring, or out of range (all of them at a cut, the
    // two furthest gone otherwise once the quota is nearly spent)
    let n1 = null, n2 = null, w1 = 0, w2 = 0;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i]; if (c.keep || c.state === 'parked') continue;
      const dx = c.pos.x - V.x, dz = c.pos.z - V.z, d = Math.hypot(dx, dz);
      if (c.state === 'wreck') { if (d > R + 60 && !this.seen(c.pos)) this.despawn(c); continue; }
      if (d < NEAR || (d < R && (dx * f.x + dz * f.y) > -0.25 * d)) continue;
      const seen = this.seen(c.pos);
      if (seen && d < R + 60) continue;
      if (filling || d > R) { this.despawn(c); active--; continue; }
      if (d > w1) { n2 = n1; w2 = w1; n1 = c; w1 = d; } else if (d > w2) { n2 = c; w2 = d; }
    }
    if (!filling && active >= quota - 2) for (const c of [n1, n2]) if (c) { this.despawn(c); active--; }
    if (active >= quota) return;
    if (filling && !this._seeded) { this._seeded = true; this._seedStops(); }
    if (!filling) this._seeded = false;
    let lanes = this.net.lanesNear(V.x, V.z, R, this._lanes);
    // at a cut, draw from the lanes in the picture
    if (filling) lanes = this._inView || (this._inView = lanes.filter(l => this._laneSeen(l)));
    else this._inView = null;
    if (!lanes.length) return;
    const pp = this.game.player?.position || V;
    this._rays = 1; // sight test (two ray casts) for one in-view spot per tick at most
    for (let k = 0, got = 0, n = seeding ? 60 : 16; k < n && active < quota && got < (seeding ? 60 : 2); k++) {
      const l = lanes[Math.floor(Math.random() * lanes.length)];
      if (l.cls > 5 || l.closed || l.s1 - l.s0 < 20 || Math.random() > CLASS_W[l.cls]) continue;
      // at a cut, a red light gets its queue
      const queue = filling && this.net.signalFor(l) === 'red';
      const s = queue ? l.s1 - 1 : l.s0 + 8 + Math.random() * (l.s1 - l.s0 - 12);
      l.path.sample(s, _p);
      const d = Math.hypot(_p.x - V.x, _p.z - V.z);
      if (d > R || Math.hypot(_p.x - pp.x, _p.z - pp.z) < 25) continue;
      if (!this._unseen(_p, d, filling, l)) continue;
      const n = queue ? this._queue(l) : this._spawnFlowing(l, s);
      active += n; got += n;
    }
  }

  /** is some of lane l in view (from the camera's last position)? */
  _laneSeen(l) {
    for (let k = 0; k < 4; k++) { l.path.sample(l.s0 + (l.s1 - l.s0) * k / 3, _t); if (this.seen(_t)) return true; }
    return false;
  }

  /** could a car appear at p on lane l (d m from the viewer) without being seen popping in, and is it worth it there? */
  _unseen(p, d, filling, l) {
    const V = this.viewer, f = this.fwd, ahead = ((p.x - V.x) * f.x + (p.z - V.z) * f.y) / Math.max(d, 1);
    if (this.seen(p)) return filling || d > POP || (this._rays-- > 0 && !clearLine(this.game, this.game.camera.position, _k.set(p.x, p.y + 1.2, p.z)));
    // out of view: on a lane that runs into the picture, just off its edges ahead, or close by (the camera may turn) —
    // not at a cut: then the quota goes into the picture
    if (filling) return d < NEAR && Math.random() < 0.3;
    if (ahead > 0.2 || (d < NEAR && Math.random() < 0.5)) return true;
    l.path.sample(l.s1, _t);
    return this.seen(_t);
  }

  /** no car on lane l within [s - back, s + ahead] */
  _clear(l, s, back, ahead) {
    for (const o of l.cars) if (o.s > s - back && o.s < s + ahead) return false;
    return true;
  }

  /** room on lane l at s for a car doing v: its following distance to the car ahead (and room to brake for a slow
   * one), and for the car behind (on the lane, or coming into it out of the junction) to keep its own or stop */
  _room(l, s, v) {
    // is car o, d m ahead of s (behind: d < 0), too close?
    const near = (o, d) => (d > 0 ? d < 8 + v * 1.4 || (o.speed < v * 0.6 && d < 14 + v * v / 4) : -d < 8 + Math.max(o.speed * 1.4, o.speed * o.speed / 5));
    for (const o of l.cars) if (near(o, o.s - s)) return false;
    // on another road's lane alongside this one where they join or part, a car is as near as if it were on this one
    for (const j of this._joins(l)) for (const o of j.lane.cars) if (near(o, l.s1 - s - (j.lane.s1 - o.s))) return false;
    for (const j of this._splits(l)) for (const o of j.lane.cars) if (near(o, o.s - j.lane.s0 - (s - l.s0))) return false;
    // coming into the lane out of the junction behind, or gone out of it into the one ahead
    for (const o of this.net.nodes[l.from].occ) if (o.conn.lane === l && near(o, -(s - l.s0 + o.conn.path.length - o.cs))) return false;
    for (const o of this.net.nodes[l.to].occ) if (o.fromLane === l && near(o, l.s1 - s + o.cs)) return false;
    return true;
  }

  /** may a car doing v appear at s on lane l? Never within 25 m of the player (nor of their car: a queue or a platoon
   * reaches back from where it was placed), and with room there */
  _canSpawn(l, s, v) {
    const P = this.game.player, pp = P?.vehicle?.position || P?.position;
    if (pp) { l.path.sample(s, _a); if (Math.hypot(_a.x - pp.x, _a.z - pp.z) < 25) return false; }
    return this._room(l, s, v);
  }

  /** a car (and on an expressway its platoon) under way at s on lane l; returns how many appeared */
  _spawnFlowing(l, s) {
    const fast = l.cls <= 1;
    let v = l.speed * (fast ? 0.8 + Math.random() * 0.15 : 0.45 + Math.random() * 0.35);
    // room to keep its distance, and to stop at the light ahead
    if (!this._canSpawn(l, s, v)) return 0;
    const sig = this.net.signalFor(l);
    if (sig === 'red' || sig === 'amber') v = Math.min(v, Math.sqrt(Math.max(0, 3 * (l.s1 - s - 6))));
    if (!this.spawnAt(l, s, this._pickType(l), undefined, v)) return 0;
    if (!fast) return 1;
    // expressways flow in platoons: a few more upstream in this lane and the ones beside it
    let n = 1;
    const sibs = this.net.nodes[l.from].out.filter(o => o.edge === l.edge && o.to === l.to);
    for (let k = 1 + Math.floor(Math.random() * 4), so = s; k > 0; k--) {
      const o = sibs[Math.floor(Math.random() * sibs.length)] || l;
      so -= 10 + v * 1.3 + Math.random() * 10;
      if (so < o.s0 + 8 || !this._canSpawn(o, so, v)) continue;
      o.path.sample(so, _t);
      const d = Math.hypot(_t.x - this.viewer.x, _t.z - this.viewer.z);
      if (this.seen(_t) && d < POP && this.cut <= 0 && this.recenter <= 0) continue;
      if (this.spawnAt(o, so, this._pickType(o), undefined, v * (0.9 + Math.random() * 0.1))) n++;
    }
    return n;
  }

  /** a queue standing at a red light at the end of lane l (seeded at a cut) */
  _queue(l) {
    let s = l.s1 - 1, n = 0;
    for (let k = 1 + Math.floor(Math.random() * 5); k > 0; k--) {
      const type = this._pickType(l), half = VEHICLE_SPECS[type].length / 2;
      s -= half;
      if (s < l.s0 + half || !this._clear(l, s, half + 4, half + 4) || !this._canSpawn(l, s - half, 0)) break;
      if (!this.spawnAt(l, s, type, undefined, 0)) break;
      n++; s -= half + 2 + Math.random() * 1.5;
    }
    return n;
  }

  _pickType(l) {
    // double-deckers keep to the kerb lane (where the stops are), and are commoner on a road with a stop ahead
    if (l.busStops && Math.random() < 0.12) return 'bus';
    let t = pickTrafficType();
    if (t === 'bus' && l.idx !== 0) t = pickTrafficType();
    return t === 'bus' && l.idx !== 0 ? 'sedan' : t;
  }

  /** bus stops (StreetProps shelters) on the kerb lanes beside them: lane.busStops = arc lengths where a bus pulls up */
  _busStops() {
    this.stops = [];
    for (const st of this.game.streetProps?.stops || []) {
      const fx = Math.sin(st.yaw), fz = Math.cos(st.yaw); // the shelter faces the road
      const n = this.net.nearestLane(st.x + fx * 4, st.z + fz * 4, 12, l => l.idx === 0 && l.cls <= 5);
      if (!n || n.dist > 6) continue;
      const l = n.lane;
      // the kerb on the left of the lane (left-hand traffic), and room to pull up clear of the junctions
      if ((st.x - n.pos.x) * n.dir.z - (st.z - n.pos.z) * n.dir.x <= 0 || n.s < l.s0 + 12 || n.s > l.s1 - 8) continue;
      // nor where another road's lane runs alongside (a slip road joining): a standing bus would block it
      let clear = true;
      for (const k of [-6, 0, 6]) { l.path.sample(n.s + k, _t); if ((this.net.nearestLane(_t.x, _t.z, 8, o => o.edge !== l.edge)?.dist ?? 99) < 4.5) clear = false; }
      if (!clear) continue;
      (l.busStops ||= []).push(n.s);
      l.busStops.sort((a, b) => a - b);
      this.stops.push({ lane: l, s: n.s, x: n.pos.x, z: n.pos.z });
    }
  }

  /** at a cut: buses standing at some of the stops in view */
  _seedStops() {
    const V = this.viewer, pp = this.game.player?.position || V;
    for (const st of this.stops) {
      if (Math.random() < 0.4 || Math.hypot(st.x - V.x, st.z - V.z) > POP || Math.hypot(st.x - pp.x, st.z - pp.z) < 25) continue;
      _p.set(st.x, 0, st.z);
      if (!this.seen(_p) || !this._clear(st.lane, st.s, 14, 10)) continue;
      const c = this.spawnAt(st.lane, st.s, 'bus', undefined, 0);
      if (c) c.dwell = Math.random() * 6;
    }
  }

  /** the stop this bus pulls up at next on its lane (arc length), or null */
  _nextStop(c) {
    const st = c.lane.busStops;
    if (!st) return null;
    for (const s of st) {
      if (s < c.s - 3 || (c.servedLane === c.lane && s <= c.servedS)) continue;
      // too close to pull up smoothly when first seen: drive on to the next one
      if (s !== c.stopS && s - c.s < c.speed * c.speed / (2 * c.bComf) - 1) { c.servedLane = c.lane; c.servedS = s; continue; }
      return s;
    }
    return null;
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
    // a bus at its stop stands a while with the doors open, then indicates and pulls out
    if (c.stops) {
      if (c.mode === 'lane' && c.stopS !== null && c.stopS - c.s < 3 && c.speed < 0.3) {
        if ((c.dwell += dt) > c.dwellFor) { c.servedLane = c.lane; c.servedS = c.stopS; c.stopS = null; c.dwell = 0; c.dwellFor = 8 + Math.random() * 10; c.pullOut = 3; }
      } else c.pullOut = Math.max(0, c.pullOut - dt);
    }
    // horn when the player blocks
    if (c.blockedByPlayer && c.wait > 2.5 && (c.honkT -= dt) <= 0) { c.honkT = 3 + Math.random() * 3; this.game.audio?.sfx?.('horn', { position: c.pos, volume: 0.7 }); }
    c.blockedByPlayer = false;
    const ds = c.speed * dt;
    if (c.mode === 'lane') {
      c.s += ds;
      if (c.s >= c.lane.s1) {
        const over = c.s - c.lane.s1;
        const conn = c.nextConn || this.pickNext(c.lane, c);
        const i = c.lane.cars.indexOf(c); if (i >= 0) c.lane.cars.splice(i, 1);
        if (!conn) { this.despawn(c); return; }
        c.mode = 'conn'; c.conn = conn; c.cs = over; c.fromLane = c.lane; c.connNodeId = c.lane.to; c.connT = this.clock; c.zipT = null;
        c.connNode = this.net.nodes[c.lane.to]; c.connNode.occ.add(c);
        c.nextConn = c.nextConn2 || this.pickNext(conn.lane, c);
        c.nextConn2 = c.nextConn && this.pickNext(c.nextConn.lane, c);
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
        c.nextConn ??= this.pickNext(nl, c);
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
    let side = c.mode === 'conn' ? turnSide(c.conn) : c.lane.s1 - c.s < Math.max(12, c.speed * 2.5) ? turnSide(c.nextConn) : 0;
    // a bus: left into the stop, right pulling out of it
    if (c.stops) side = c.mode === 'lane' && c.stopS !== null ? (c.stopS - c.s > 3 ? (c.stopS - c.s < 45 ? -1 : side) : c.dwell > c.dwellFor - 2.5 ? 1 : 0) : c.pullOut > 0 ? 1 : side;
    const L = _lights; L.head = this.game.U.night.value > 0.3; L.brake = c.brake; L.siren = c.siren; L.indicatorL = side < 0; L.indicatorR = side > 0;
    this.renderer.setTransform(c.rid, c.pos, _q, c.wheelSpin, c.steer, L, tilt);
  }
}
