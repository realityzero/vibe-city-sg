// Ambient pedestrians: a GPU-instanced crowd on the sidewalks, footways and plazas around the viewer.
// People are spent where the camera looks: walkers are placed in (or just beside) the view, out of sight or far enough
// that they don't pop, and whoever drops out of sight is recycled. Who you meet depends on the district and the hour;
// everyone walks at their own pace and stops for their own reasons (window shopping, phones, a look around), groups
// chat outside shops, bars and MRT exits, commuters sit at bus stops, tourists pose at the landmarks, joggers do the
// park and waterfront loops at dawn and dusk, umbrellas open when it rains. Fast cars send people diving out of the
// way; crashes, explosions and stunts get filmed on phones (event 'filmed' { count, pos, kind }).
import * as THREE from 'three';
import { Crowd, randomLook, CROWD_ACC, CROWD_ANIM as A } from './humanoid/index.js';
import { districtAt } from '../ui/index.js';
import { Walkways } from './walkways.js';
import { StreetLife } from '../world/streetlife.js';
import { U } from '../gfx/globals.js';

// who you meet where: CBD suits, Chinatown aunties & uncles, tourists at the bay, students around Bras Basah
const MIX = {
  'Downtown Core': [['office_m', 4], ['office_f', 4], ['male', 1], ['female', 1], ['tourist', 1]],
  'Raffles Place': [['office_m', 5], ['office_f', 4], ['tourist', 1]],
  'Tanjong Pagar': [['office_m', 3], ['office_f', 3], ['auntie', 1], ['uncle', 1], ['male', 1], ['female', 1]],
  'Chinatown': [['auntie', 3], ['uncle', 3], ['tourist', 3], ['male', 1], ['female', 1]],
  'Marina Bay': [['tourist', 5], ['male', 2], ['female', 2], ['office_m', 1]],
  'Marina Centre': [['tourist', 4], ['male', 2], ['female', 2], ['student', 1]],
  'Gardens by the Bay': [['tourist', 6], ['male', 1], ['female', 1]],
  'Bras Basah': [['student', 4], ['male', 2], ['female', 2], ['tourist', 1]],
  'Bugis': [['student', 3], ['male', 2], ['female', 3], ['auntie', 1]],
  'Kampong Glam': [['tourist', 3], ['male', 2], ['female', 2], ['uncle', 1]],
  'Clarke Quay': [['male', 3], ['female', 3], ['tourist', 3], ['office_m', 1]],
  'Boat Quay': [['office_m', 2], ['tourist', 3], ['male', 2], ['female', 2]],
  'Tiong Bahru': [['auntie', 3], ['uncle', 3], ['male', 2], ['female', 2]],
};
const DEFAULT_MIX = [['male', 3], ['female', 3], ['auntie', 1], ['uncle', 1], ['office_m', 1], ['office_f', 1], ['student', 1], ['tourist', 1]];
const NIGHTLIFE = new Set(['Clarke Quay', 'Boat Quay', 'Chinatown', 'Kampong Glam', 'Bugis', 'Marina Bay']);
// share of the crowd out on the street by hour: quiet small hours, the commute, lunch and after-work peaks
const HOURLY = [0.22, 0.16, 0.12, 0.1, 0.1, 0.14, 0.3, 0.6, 0.85, 0.75, 0.75, 0.85, 1, 1, 0.85, 0.8, 0.85, 0.95, 1, 0.95, 0.85, 0.7, 0.5, 0.35];
const inHours = (t, a, b) => (a <= b ? t >= a && t < b : t >= a || t < b);

// walking pace (m/s), how often they stop (per second) and how many walk staring at their phone
const HABITS = {
  office_m: { pace: [1.35, 1.65], stops: 0.008, phone: 0.25 }, office_f: { pace: [1.3, 1.55], stops: 0.01, phone: 0.25 },
  student: { pace: [1.2, 1.5], stops: 0.02, phone: 0.35 }, male: { pace: [1.1, 1.5], stops: 0.02, phone: 0.2 },
  female: { pace: [1.05, 1.45], stops: 0.025, phone: 0.2 }, tourist: { pace: [0.8, 1.15], stops: 0.05, phone: 0.12 },
  auntie: { pace: [0.85, 1.05], stops: 0.035, phone: 0.05 }, uncle: { pace: [0.9, 1.2], stops: 0.03, phone: 0.05 },
  delivery: { pace: [1.55, 1.85], stops: 0.01, phone: 0.45 }, jogger: { pace: [2.6, 3.3], stops: 0.004, phone: 0 },
};
// ground covered per unit of gait cadence by a 1.78 m person (the crowd shader's walk / run cycles)
const WALK_STRIDE = 1.25, RUN_STRIDE = 3.0, FLEE_SPEED = 5.2;
const UMBRELLAS = [0x111111, 0x1f2a44, 0xc92a2a, 0x2b8a3e, 0xe9ecef, 0xf08c00, 0x7048e8, 0x1c7ed6, 0xe64980];

// places people gather (POI kind -> hotspot type) and the hours they're busy
const HOTSPOT_KIND = {
  restaurant: 'shop', cafe: 'shop', fast_food: 'shop', convenience: 'shop', department_store: 'shop', mall: 'shop', theatre: 'shop', cinema: 'shop',
  food_court: 'hawker', marketplace: 'hawker', bar: 'bar', pub: 'bar',
  attraction: 'sight', viewpoint: 'sight', museum: 'sight', artwork: 'sight', gallery: 'sight', place_of_worship: 'sight',
};
const BUSY = {
  shop: t => inHours(t, 8, 22) ? 1 : 0.15, hawker: t => inHours(t, 7, 14) || inHours(t, 17, 21.5) ? 1 : 0.25, bar: t => inHours(t, 18, 2) ? 1 : 0.1,
  sight: t => inHours(t, 8, 20) ? 1 : inHours(t, 20, 23) ? 0.5 : 0.1, landmark: t => inHours(t, 7.5, 22.5) ? 1 : 0.15,
  bus: t => inHours(t, 6, 24) ? 1 : 0.1, mrt: t => inHours(t, 6, 24) ? 1 : 0.1,
};
const LANDMARKS = new Set(['merlion', 'flyer', 'mbs', 'esplanade', 'supertrees', 'artscience', 'fullerton', 'clarkequay', 'raffles', 'buddhatooth', 'mariamman', 'sultanmosque', 'nationalgallery', 'victoria', 'laupasat', 'cityhall', 'standrews', 'flowerdome', 'cloudforest']);

const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Matrix4(), _sphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
const rnd = (a, b) => a + Math.random() * (b - a);
const pickW = list => { let tot = 0; for (const [, w] of list) tot += w; let r = Math.random() * tot; for (const [v, w] of list) { r -= w; if (r <= 0) return v; } return list[0][0]; };
const yawTo = (dx, dz) => Math.atan2(-dx, -dz); // crowd yaw that faces along (dx, dz)

export class Pedestrians {
  constructor(game, { max = 160 } = {}) {
    this.game = game;
    this.walkways = new Walkways(game);
    this.maxWalkers = max;
    this.max = max + 140; // extra capacity for posed scene crowds and staged street scenes
    // the same people per square metre of view on every preset: the phone's 80 cover a 75 m view, 150 cover ~100 m
    this.view = Math.round(75 * Math.sqrt(max / 80));
    this.keep = this.view * 1.35;   // beyond this anyone not pinned is recycled, seen or not (a few pixels tall)
    this.popDist = this.view * 0.55; // nearer than this nobody appears in plain sight
    this.crowd = new Crowd(this.max, { lod: ['low', 'medium'].includes(game.R?.qualityName) ? 'low' : 'high' }); // low LOD = 45% fewer triangles
    this.crowd.mesh.layers?.enable?.(0);
    game.scene.add(this.crowd.mesh);
    this.peds = [];
    this.clusters = [];
    this.spawnT = 0;
    this.recenter = 0; // set by Game.relocate: the new area fills at once behind the fade
    this.cut = 0;      // the camera jumped (a cut, a teleport): fill the new view as it is, no pop-in to avoid
    this.viewer = new THREE.Vector3();
    this.frustum = new THREE.Frustum();
    this._fwd = new THREE.Vector2(0, -1);
    this._lastViewer = null;
    this._carPrev = new THREE.Vector3(); this._carVel = new THREE.Vector3();
    this._o = { x: 0, y: 0, z: 0, yaw: 0, anim: 0, phase: 0, speed: 1, look: undefined, knockAt: undefined };
    // hotspots: shopfronts, hawker centres, bars, sights, landmarks, bus stops (+ MRT exits once Ambient exists)
    this.hotspots = new Map();
    for (const p of game.city.data.pois || []) { const k = HOTSPOT_KIND[p.k]; if (k) this._addHotspot({ x: p.x, z: p.z, kind: k }); }
    for (const p of game.landmarks?.pois || []) if (LANDMARKS.has(p.id)) this._addHotspot({ x: p.x, z: p.z, kind: 'landmark', id: p.id });
    for (const s of game.streetProps?.stops || []) this._addHotspot({ x: s.x, z: s.z, kind: 'bus', yaw: s.yaw });
    this.life = new StreetLife(game, this);
    const ev = game.events;
    ev.on('trafficWreck', car => this.spectacle(car.pos, 'crash'));
    ev.on('explosion', pos => this.spectacle(pos, 'explosion'));
    ev.on('stunt', () => this.spectacle(game.player.position, 'stunt', true));
    ev.on('pedHit', p => this.spectacle(p.pos, 'hit'));
  }

  _addHotspot(h) {
    h.until = 0;
    const k = Math.floor(h.x / 60) * 100003 + Math.floor(h.z / 60);
    let a = this.hotspots.get(k); if (!a) this.hotspots.set(k, a = []); a.push(h);
  }

  // ------------------------------------------------------------------ visibility
  inView(x, y, z, r = 1.1) { _sphere.center.set(x, y + 0.9, z); _sphere.radius = r; return this.frustum.intersectsSphere(_sphere); }
  /** could someone appear at (x,z) right now without being seen popping in? */
  unseen(x, z, d) {
    if (this.seeding || d > this.popDist || !this.inView(x, 0, z)) return true;
    const c = this.game.camera.position; _d.set(x - c.x, 1.2 - c.y, z - c.z); const L = _d.length(); _d.multiplyScalar(1 / L);
    return !!this.game.physics.raycast(c, _d, L - 1); // behind a building
  }

  // ------------------------------------------------------------------ people
  pickVariant(x, z, t) {
    const night = !inHours(t, 6, 21), meal = inHours(t, 11, 14) || inHours(t, 17.5, 21.5);
    const mix = (MIX[districtAt(x, z)] || DEFAULT_MIX).map(([v, w]) =>
      [v, w * (night ? ({ office_m: 0.25, office_f: 0.25, auntie: 0.35, student: 0.3 }[v] ?? 1) : 1)]);
    mix.push(['delivery', meal ? 0.7 : 0.25]);
    return pickW(mix);
  }

  makePed(variant, pos, extra) {
    const look = randomLook(Math.floor(Math.random() * 1e6), variant);
    const H = HABITS[variant] || HABITS.male;
    const p = {
      variant, look, pos: pos.clone(), yaw: 0, state: 'walk', sw: null, s: 0, dir: 1, lat: 0, target: null, slot: -1,
      phase: Math.random() * 10, speed: rnd(H.pace[0], H.pace[1]), stops: H.stops * rnd(0.5, 1.5), walkAnim: variant === 'jogger' ? A.run : A.walk,
      idleT: 0, idleAnim: A.idle, knockT: 0, knockAt: 0, lastAnim: -1, fleeFrom: null, t: 0, anim: A.idle, sitting: false,
      umbrellaTh: variant === 'jogger' || variant === 'delivery' || Math.random() < 0.2 ? 2 : rnd(0.08, 0.35), // rain level that opens it
      ...extra,
    };
    if (variant !== 'jogger' && Math.random() < H.phone) { p.walkAnim = A.walk_phone; p.speed *= 0.85; }
    if (variant === 'auntie' && p.state === 'walk' && Math.random() < (inHours(this.game.sky.time, 7, 12) ? 0.6 : 0.35)) { look.acc |= CROWD_ACC.trolley; p.walkAnim = A.walk; p.speed = rnd(0.8, 0.95); look.colors.acc2 = [0x7a1f2b, 0x1f2a44, 0x2b5a3a, 0x5c3d6e][Math.floor(Math.random() * 4)]; }
    if (p.umbrellaTh < 1) look.umbrellaColor = UMBRELLAS[Math.floor(Math.random() * UMBRELLAS.length)];
    p.hs = look.height / 1.78;
    this.peds.push(p);
    return p;
  }

  /** a walker somewhere on the network, biased into the view; seeding fills the whole view at once */
  spawnWalker() {
    const W = this.walkways, V = this.viewer, f = this._fwd;
    let a, d;
    if (Math.random() < 0.8) { a = Math.atan2(f.y, f.x) + (Math.random() - 0.5) * (this.hfov + 0.5); d = rnd(8, this.view); }
    else { a = Math.random() * Math.PI * 2; d = rnd(10, this.view * 0.5); } // around and behind: there when the camera turns
    const sn = W.snap(V.x + Math.cos(a) * d, V.z + Math.sin(a) * d, 14);
    if (!sn) return null;
    sn.w.path.sample(sn.s, _p);
    const dist = Math.hypot(_p.x - V.x, _p.z - V.z);
    if (dist > this.view || (dist < 6 && !this.seeding) || !this.unseen(_p.x, _p.z, dist)) return null;
    const t = this.game.sky.time, park = sn.w.foot && (this.game.city.maskAt(_p.x, _p.z, 1) > 150 || this.nearWater(_p.x, _p.z));
    const variant = park && (inHours(t, 6, 9.5) || inHours(t, 17, 20.5)) && Math.random() < 0.4 ? 'jogger' : this.pickVariant(_p.x, _p.z, t);
    const p = this.makePed(variant, _p, { sw: sn.w, s: sn.s, dir: Math.random() < 0.5 ? 1 : -1 });
    p.lat = (Math.random() * 2 - 1) * sn.w.half;
    return p;
  }

  nearWater(x, z) { const c = this.game.city; return c.isWater(x + 12, z) || c.isWater(x - 12, z) || c.isWater(x, z + 12) || c.isWater(x, z - 12); }

  // a stationary ped for scenes (seated diners, tourists taking photos...)
  addPose(d) {
    if (this.peds.length >= this.max) return null;
    const p = this.makePed(d.variant || 'male', _p.set(d.x, d.y || 0, d.z), { state: 'pose', pose: true, yaw: d.yaw });
    p.poseAnim = typeof d.anim === 'string' ? (A[d.anim] ?? 0) : d.anim;
    return p;
  }

  /** a person staged by the street-life director: stays put and does what it's told until released */
  addScripted(variant, x, z, yaw, anim) {
    if (this.peds.length >= this.max) return null;
    const p = this.makePed(variant, _p.set(x, 0, z), { state: 'script', script: true, yaw });
    p.anim = typeof anim === 'string' ? (A[anim] ?? 0) : anim;
    return p;
  }
  /** hand a scripted person back to the crowd: they walk off to the nearest footpath */
  release(p) { p.script = false; this.leave(p); }

  remove(p) { const i = this.peds.indexOf(p); if (i >= 0) this.peds.splice(i, 1); this.detach(p); }
  detach(p) { if (p.cluster) { const m = p.cluster.members, j = m.indexOf(p); if (j >= 0) m.splice(j, 1); p.cluster = null; } p.sitting = false; }

  spawnFleeing(pos, from) {
    const p = this.makePed(this.pickVariant(pos.x, pos.z, this.game.sky.time), pos, { state: 'flee', fleeFrom: from.clone(), t: 6, speed: FLEE_SPEED });
    this.game.bark?.('carjacked', pos, 0);
    return p;
  }

  // ------------------------------------------------------------------ groups at hotspots
  spawnCluster() {
    const V = this.viewer, f = this._fwd, t = this.game.sky.time, now = performance.now();
    const list = this._hsList || (this._hsList = []); list.length = 0;
    const r = this.view, c = 60;
    for (let gx = Math.floor((V.x - r) / c); gx <= Math.floor((V.x + r) / c); gx++)
      for (let gz = Math.floor((V.z - r) / c); gz <= Math.floor((V.z + r) / c); gz++) {
        const a = this.hotspots.get(gx * 100003 + gz); if (!a) continue;
        for (const h of a) {
          if (h.until > now) continue;
          const dx = h.x - V.x, dz = h.z - V.z, d = Math.hypot(dx, dz);
          if (d > r || d < 8) continue;
          const ahead = (dx * f.x + dz * f.y) / d;
          if (ahead < 0.5 && d > r * 0.5) continue; // far behind: wasted
          if (Math.random() < BUSY[h.kind](t)) list.push(h);
        }
      }
    if (!list.length) return 0;
    const h = list[Math.floor(Math.random() * list.length)];
    h.until = now + 15000; // tried: leave it a while even if no spot fits
    const made = h.kind === 'bus' ? this.busStop(h, t) : h.kind === 'landmark' ? this.photoGroup(h, 12, 40) : h.kind === 'sight' && Math.random() < 0.6 ? this.photoGroup(h, 4, 14) : this.gathering(h, t);
    if (made) h.until = now + rnd(60000, 150000);
    return made;
  }

  newCluster(x, z, life) { const c = { x, z, t: life, members: [], speaker: 0, speakT: 0 }; this.clusters.push(c); return c; }
  addMember(c, variant, x, z, yaw, anim) {
    const p = this.makePed(variant, _p.set(x, 0, z), { state: 'stand', cluster: c, yaw, anim });
    c.members.push(p);
    return p;
  }
  /** a free spot for one more person near (x,z) */
  freeSpot(x, z) { const g = this.game; return !g.city.isWater(x, z) && !g.safe.insideBuilding(x, z, 0.35) && !this.walkways.onRoad(x, z, 0.4) && !g.treeColliders?.trunkNear(x, z, 0.9); }

  /** open pedestrian paving (squares, promenades): strollers criss-crossing it, people waiting, small groups */
  spawnPlaza() {
    const V = this.viewer, f = this._fwd, t = this.game.sky.time;
    const a = Math.atan2(f.y, f.x) + (Math.random() - 0.5) * (this.hfov + 0.3), d = rnd(8, this.view * 0.8);
    const x = V.x + Math.cos(a) * d, z = V.z + Math.sin(a) * d;
    if (!this.plaza(x, z) || !this.walkways.standable(x, z) || !this.unseen(x, z, d)) return 0;
    const r = Math.random(), variant = this.pickVariant(x, z, t);
    if (r < 0.55) { const p = this.makePed(variant, _p.set(x, 0, z), { roam: 2 + Math.floor(Math.random() * 4) }); this.wander(p); return 1; }
    const c = this.newCluster(x, z, rnd(15, 50));
    if (r < 0.8) this.addMember(c, variant, x, z, Math.random() * 6.28, variant === 'tourist' ? A.film : Math.random() < 0.5 ? A.idle_phone : A.idle);
    else this.chatRing(c, x, z, 2 + Math.floor(Math.random() * 2), () => this.pickVariant(x, z, t));
    if (!c.members.length) { this.clusters.splice(this.clusters.indexOf(c), 1); return 0; }
    return c.members.length;
  }
  plaza(x, z) { return this.game.city.maskAt(x, z, 2) >= 220; } // ground mask: pavement / plaza paving (the carriageway is ruled out by freeSpot)

  /** next leg of a stroll across open paving; after a few legs, head for the nearest footpath */
  wander(p) {
    if (p.lost) { p.state = 'idle'; p.idleT = 1e9; return; } // nowhere to go: stays put until recycled out of sight
    if (p.roam-- > 0) for (let k = 0; k < 6; k++) {
      const a = Math.random() * Math.PI * 2, d = rnd(8, 25), x = p.pos.x + Math.cos(a) * d, z = p.pos.z + Math.sin(a) * d;
      if (!this.plaza(x, z)) continue;
      let clear = true; for (let s = 1; s <= 4 && clear; s++) clear = this.freeSpot(p.pos.x + (x - p.pos.x) * s / 4, p.pos.z + (z - p.pos.z) * s / 4);
      if (clear) { p.target = (p.target || new THREE.Vector3()).set(x, 0, z); return; }
    }
    this.leave(p);
  }

  /** 2-4 people chatting in a ring around (cx,cz), turned towards each other */
  chatRing(c, cx, cz, n, variant) {
    const R = 0.55 + n * 0.08, a0 = Math.random() * 6.28;
    for (let i = 0; i < n; i++) {
      const a = a0 + i / n * Math.PI * 2 + rnd(-0.25, 0.25), sx = cx + Math.cos(a) * R, sz = cz + Math.sin(a) * R;
      if (this.freeSpot(sx, sz)) this.addMember(c, variant(), sx, sz, yawTo(cx - sx, cz - sz) + rnd(-0.25, 0.25), A.idle);
    }
    c.chat = true;
  }

  /** shopfront window-shoppers / queue, chatting groups outside hawker centres and (at night) bars, MRT meet-ups */
  gathering(h, t) {
    const W = this.walkways, sn = W.snap(h.x, h.z, 22);
    if (!sn) return 0;
    sn.w.path.sample(sn.s, _p, _d);
    // step off the walking line towards the place (or away from the kerb), onto the pavement in front of it
    let ox = h.x - _p.x, oz = h.z - _p.z; const ol = Math.hypot(ox, oz);
    if (ol > 0.5) { ox /= ol; oz /= ol; } else if (!sn.w.foot) { ox = -_d.z * sn.w.side; oz = _d.x * sn.w.side; } else { ox = -_d.z; oz = _d.x; }
    let cx = 0, cz = 0, ok = false;
    for (const k of [1.6, 0.9, 0]) { cx = _p.x + ox * k; cz = _p.z + oz * k; if (W.standable(cx, cz)) { ok = true; break; } }
    const V = this.viewer, d = Math.hypot(cx - V.x, cz - V.z);
    if (!ok || !this.unseen(cx, cz, d)) return 0;
    const variant = () => h.kind === 'mrt' ? this.pickVariant(cx, cz, t) : h.kind === 'bar' ? (Math.random() < 0.5 ? 'male' : 'female') : this.pickVariant(cx, cz, t);
    const c = this.newCluster(cx, cz, rnd(25, 80));
    const facing = yawTo(ox, oz); // looking at the shop
    if (h.kind === 'shop' && Math.random() < 0.45) {
      // window shopping / waiting for a table: one or two looking in, side by side
      const n = Math.random() < 0.6 ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const sx = cx + -oz * (i - (n - 1) / 2) * 0.7, sz = cz + ox * (i - (n - 1) / 2) * 0.7;
        if (this.freeSpot(sx, sz)) this.addMember(c, variant(), sx, sz, facing + rnd(-0.3, 0.3), Math.random() < 0.35 ? A.idle_phone : A.idle);
      }
    } else this.chatRing(c, cx, cz, 2 + Math.floor(Math.random() * (h.kind === 'bar' ? 3 : 2.4)), variant);
    if (!c.members.length) { this.clusters.splice(this.clusters.indexOf(c), 1); return 0; }
    return c.members.length;
  }

  /** commuters on the bench of a bus shelter, more standing by the kerb */
  busStop(h) {
    const V = this.viewer, d = Math.hypot(h.x - V.x, h.z - V.z);
    if (!this.unseen(h.x, h.z, d)) return 0;
    const c = this.newCluster(h.x, h.z, rnd(40, 120));
    const cs = Math.cos(h.yaw), sn = Math.sin(h.yaw), at = (lx, lz) => [h.x + lx * cs + lz * sn, h.z - lx * sn + lz * cs];
    const face = h.yaw + Math.PI; // the shelter opens to the road
    const seats = [-1.5, -0.4, 0.7].filter(() => Math.random() < 0.45);
    for (const lx of seats) { const [x, z] = at(lx, -0.72); if (!this.freeSpot(x, z)) continue; const p = this.addMember(c, this.pickVariant(x, z, this.game.sky.time), x, z, face, Math.random() < 0.4 ? A.sit_eat : A.sit); p.sitting = true; p.look.acc &= ~CROWD_ACC.trolley; }
    for (let i = 0, n = Math.floor(Math.random() * 3); i < n; i++) {
      const [x, z] = at(rnd(-2.2, 2.4), rnd(0.2, 1.1));
      if (this.freeSpot(x, z)) this.addMember(c, this.pickVariant(x, z, this.game.sky.time), x, z, face + rnd(-0.6, 0.6), Math.random() < 0.5 ? A.idle_phone : A.idle);
    }
    if (!c.members.length) { this.clusters.splice(this.clusters.indexOf(c), 1); return 0; }
    return c.members.length;
  }

  /** tourists at a landmark: one takes the photo, the rest pose with the landmark behind them */
  photoGroup(h, r0, r1) {
    const V = this.viewer, W = this.walkways;
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2, R = rnd(r0, r1), x = h.x + Math.cos(a) * R, z = h.z + Math.sin(a) * R;
      const d = Math.hypot(x - V.x, z - V.z);
      if (d > this.view || !W.standable(x, z) || !this.unseen(x, z, d)) continue;
      // the poser line faces away from the landmark; the photographer stands a few metres further out, facing them
      const ox = Math.cos(a), oz = Math.sin(a), px = x + ox * 3.2, pz = z + oz * 3.2;
      if (!this.freeSpot(px, pz)) continue;
      const c = this.newCluster(x, z, rnd(18, 40));
      this.addMember(c, 'tourist', px, pz, yawTo(-ox, -oz), A.film);
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const s = (i - (n - 1) / 2) * 0.62, sx = x - oz * s, sz = z + ox * s;
        if (this.freeSpot(sx, sz)) this.addMember(c, Math.random() < 0.8 ? 'tourist' : 'female', sx, sz, yawTo(ox, oz) + rnd(-0.2, 0.2), [A.wave, A.cheer, A.idle, A.wave][Math.floor(Math.random() * 4)]).poser = true;
      }
      c.photo = true;
      return c.members.length;
    }
    return 0;
  }

  /** leave a spot: walk to the nearest footpath and carry on from there (or vanish once nobody's looking) */
  leave(p) {
    this.detach(p);
    const sn = this.walkways.snap(p.pos.x, p.pos.z, 25);
    p.state = 'walk';
    if (!sn) { p.sw = null; p.lost = true; return; }
    p.sw = sn.w; p.s = sn.s; p.dir = Math.random() < 0.5 ? 1 : -1; p.lat = (Math.random() * 2 - 1) * sn.w.half;
    p.target = this.pathPoint(p, new THREE.Vector3());
  }
  pathPoint(p, out) {
    p.sw.path.sample(p.s, out, _d);
    const fx = _d.x * p.dir, fz = _d.z * p.dir;
    return out.set(out.x - fz * p.lat, 0, out.z + fx * p.lat);
  }

  // ------------------------------------------------------------------ reactions
  /** something worth filming happened at pos: the people around turn, raise their phones and record */
  spectacle(pos, kind, followPlayer = false) {
    const V = this.viewer; if (Math.hypot(pos.x - V.x, pos.z - V.z) > this.keep) return;
    const near = [];
    for (const p of this.peds) {
      if (p.pose || p.script || p.hailing || p.crossing || !['walk', 'idle', 'stand'].includes(p.state)) continue;
      const d = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z);
      if (d > 45) continue;
      if (kind === 'explosion' && d < 10) this.flee(p, pos, 4);
      else if (Math.random() < (kind === 'stunt' ? 0.75 : 0.6)) near.push([d, p]);
    }
    if (!near.length) return;
    // the nearest dozen or so get their phones out; the rest carry on
    near.sort((a, b) => a[0] - b[0]);
    const filmers = near.slice(0, 16);
    for (const [, p] of filmers) { p.film = { x: pos.x, z: pos.z, follow: followPlayer, delay: rnd(0.3, 2), back: p.state, yaw: p.yaw }; p.state = 'film'; p.t = rnd(6, 12); }
    this.game.events.emit('filmed', { count: filmers.length, pos: pos.clone(), kind });
    if (kind !== 'hit') this.game.bark?.(kind === 'stunt' ? 'hit' : 'nearmiss', filmers[0][1].pos, 3, { text: kind === 'stunt' ? 'You think this one Vice City is it?' : 'Wah, so fast for what?' });
  }

  flee(p, from, t = 4) { p.state = 'flee'; p.t = t; p.fleeFrom = (p.fleeFrom || new THREE.Vector3()).copy(from); }

  /** get out of the way of a car: a sideways dive (falls, gets back up) */
  dive(p, sx, sz) { p.state = 'dive'; p.t = 3.5; p.diveX = sx; p.diveZ = sz; p.yaw = yawTo(-sx, -sz); }

  /** move by (dx,dz) unless that ends inside a building or the water (then slide along one axis, or stop) */
  tryMove(p, dx, dz) {
    const g = this.game, ok = (x, z) => !g.city.isWater(x, z) && !g.safe.insideBuilding(x, z, 0.25);
    if (ok(p.pos.x + dx, p.pos.z + dz)) { p.pos.x += dx; p.pos.z += dz; return true; }
    if (ok(p.pos.x + dx, p.pos.z)) { p.pos.x += dx; return true; }
    if (ok(p.pos.x, p.pos.z + dz)) { p.pos.z += dz; return true; }
    return false;
  }

  /** back to what they were doing before a fright (groups have broken up by then: everyone walks on) */
  resume(p) {
    if (p.pose) { p.state = 'pose'; return; }
    if (p.sw) { p.state = 'walk'; p.target = this.pathPoint(p, p.target || new THREE.Vector3()); return; }
    this.leave(p);
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    const game = this.game, cam = game.camera, V = this.viewer, crowd = this.crowd;
    // the viewer: where the camera is and which way it looks (the crowd lives around the camera, not the player)
    V.set(cam.position.x, 0, cam.position.z);
    const e = cam.matrixWorld.elements; this._fwd.set(-e[8], -e[10]); if (this._fwd.lengthSq() < 1e-6) this._fwd.set(0, -1); this._fwd.normalize();
    this.hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * cam.aspect);
    this.frustum.setFromProjectionMatrix(_m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    if (!this._lastViewer || this._lastViewer.distanceToSquared(V) > 60 * 60) { this.cut = 1; this.spawnT = 0; }
    (this._lastViewer ||= new THREE.Vector3()).copy(V);
    this.recenter -= dt; this.cut -= dt;
    this.seeding = this.recenter > 0 || this.cut > 0;
    // footways around the viewer get vetted a little each frame (all at once behind a relocation's fade)
    this.walkways.prepare(V.x, V.z, this.view + 20, this.recenter > 0 ? 40 : this.cut > 0 ? 4 : 0.35);
    this._mrtHotspots();

    const pp = game.player?.position || cam.position;
    const pv = game.player?.vehicle;
    // spawn towards a time-of-day / weather target
    const t = game.sky.time, district = this._district(V);
    let dens = HOURLY[Math.floor(t) % 24] + (HOURLY[(Math.floor(t) + 1) % 24] - HOURLY[Math.floor(t) % 24]) * (t % 1);
    if (NIGHTLIFE.has(district) && inHours(t, 19, 2)) dens = Math.max(dens, 0.95);
    const target = Math.round(this.maxWalkers * dens * (1 - 0.35 * U.rain.value));
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.1;
      let ambient = 0, standing = 0;
      for (const p of this.peds) if (!p.pose && !p.script) { ambient++; if (p.cluster) standing++; }
      for (let k = 0, n = this.seeding ? 24 : 3; k < n && ambient < target && this.peds.length < this.max - 6; k++) {
        const r = Math.random();
        if (r < 0.3 && standing < target * 0.45) { const c = this.spawnCluster(); ambient += c; standing += c; }
        else if (r < 0.45) { const c = this.spawnPlaza(); ambient += c; if (c > 1) standing += c; }
        else if (this.spawnWalker()) ambient++;
      }
    }
    // the player's car: velocity from its motion (reversing, drifting and sliding included)
    let carSpeed = 0;
    if (pv && dt > 0) { this._carVel.subVectors(pv.position, this._carPrev).divideScalar(dt); this._carVel.y = 0; carSpeed = this._carVel.length(); }
    if (pv) this._carPrev.copy(pv.position);
    const cvx = carSpeed > 0.1 ? this._carVel.x / carSpeed : 0, cvz = carSpeed > 0.1 ? this._carVel.z / carSpeed : 0;
    const halfW = pv ? pv.spec.width * 0.5 : 0;
    // crossing pedestrians are obstacles for traffic (people on the pavement are never in a lane)
    const obstacles = game.traffic ? (game.traffic.obstacles = game.traffic.obstacles || []) : [];
    obstacles.length = 0;
    if (game.player) obstacles.push({ x: pp.x, z: pp.z, r: pv ? pv.spec.width * 0.6 : 0.5, player: true });
    this.updateClusters(dt);
    this.life.update(dt);

    let n = 0;
    const o = this._o;
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      const vx = p.pos.x - V.x, vz = p.pos.z - V.z, vd = Math.hypot(vx, vz);
      // recycle: far away, or out of sight beyond the near ring (their budget is better spent in view)
      if (!p.pose && !p.script && !p.hailing && !p.cluster && (vd > this.keep || (vd > this.popDist && !this.inView(p.pos.x, p.pos.y, p.pos.z)) || (p.lost && !this.inView(p.pos.x, p.pos.y, p.pos.z)))) { this.peds.splice(i, 1); continue; }
      const dx = p.pos.x - pp.x, dz = p.pos.z - pp.z, dist = Math.hypot(dx, dz);
      // react to the player's vehicle
      if (pv && carSpeed > 3.5 && p.state !== 'knocked' && p.state !== 'dive' && dist < 40) {
        const ahead = dx * cvx + dz * cvz, side = dx * -cvz + dz * cvx;
        if (dist < pv.spec.length * 0.5 + 0.6) {
          this.detach(p); p.state = 'knocked'; p.knockT = 2.6; p.yaw = Math.atan2(dx, dz);
          _d.set(dx, 0, dz).normalize().multiplyScalar(Math.min(6, carSpeed * 0.25)); this.tryMove(p, _d.x, _d.z);
          game.audio?.sfx?.('punch', { position: p.pos, volume: 0.8 });
          game.events.emit('pedHit', p);
          game.bark?.('hit', p.pos, 1);
          game.wanted?.crime(1, 'Hit a pedestrian', p.pos); // only if police or a camera saw it
        } else if (carSpeed > 6 && ahead > 0 && ahead < carSpeed * 1.4 && Math.abs(side) < halfW + 1.5 && p.state !== 'flee') {
          // in the car's path: dive clear if it's about to arrive, else run out of the way
          const s = side >= 0 ? 1 : -1;
          this.detach(p);
          if (ahead < carSpeed * 0.6 && Math.random() < 0.75) this.dive(p, -cvz * s, cvx * s);
          else this.flee(p, _p.set(p.pos.x - -cvz * s * 6, 0, p.pos.z - cvx * s * 6), 2.5);
          game.bark?.('nearmiss', p.pos, 4);
        } else if (dist < 14 && carSpeed > 9 && (p.state === 'walk' || p.state === 'pose' || p.state === 'stand') && Math.random() < dt * 3) {
          this.detach(p); this.flee(p, pp, 4);
          if (dist < 8) game.bark?.('nearmiss', p.pos, 4);
        }
      }
      let anim = A.idle, speed = 1;
      switch (p.state) {
        case 'walk': {
          if (p.target) {
            _d.subVectors(p.target, p.pos); _d.y = 0; const l = _d.length();
            if (l < 0.35) { p.target = null; if (!p.sw) this.wander(p); }
            else { _d.multiplyScalar(1 / l); p.pos.addScaledVector(_d, Math.min(l, p.speed * dt)); p.yaw = yawTo(_d.x, _d.z); }
            if (p.crossing) obstacles.push({ x: p.pos.x, z: p.pos.z, r: 0.4 });
          } else if (p.sw) {
            p.crossing = false;
            p.s += p.dir * p.speed * dt;
            if (p.s < 0 || p.s > p.sw.path.length) this.atEnd(p);
            else {
              p.sw.path.sample(p.s, _p, _d);
              const fx = _d.x * p.dir, fz = _d.z * p.dir;
              p.pos.set(_p.x - fz * p.lat, 0, _p.z + fx * p.lat);
              p.yaw = yawTo(fx, fz);
              if (p.sw.cross) obstacles.push({ x: p.pos.x, z: p.pos.z, r: 0.4 });
              if (Math.random() < dt * p.stops) this.pause(p, fx, fz);
            }
          } else this.wander(p);
          anim = p.walkAnim === A.walk_phone && p.umbrella ? A.walk : p.walkAnim;
          speed = p.speed / ((anim === A.run ? RUN_STRIDE : WALK_STRIDE) * p.hs);
          break;
        }
        case 'idle':
          p.idleT -= dt; if (p.idleT <= 0) p.state = 'walk';
          anim = p.umbrella && (p.idleAnim === A.idle_phone || p.idleAnim === A.film) ? A.idle : p.idleAnim;
          break;
        case 'stand': anim = p.umbrella && (p.anim === A.idle_phone || p.anim === A.film) ? A.idle : p.anim; break;
        case 'pose': anim = p.poseAnim; break;
        case 'script': anim = p.anim; if (p.cadence) speed = p.cadence / (WALK_STRIDE * p.hs); break;
        case 'film': {
          const F = p.film; if (F.follow) { F.x = pp.x; F.z = pp.z; } else if (F.get) { const q = F.get(); F.x = q.x; F.z = q.z; }
          p.yaw = yawTo(F.x - p.pos.x, F.z - p.pos.z);
          F.delay -= dt; anim = F.delay > 0 || p.umbrella || p.look.acc & CROWD_ACC.trolley ? A.idle : A.film; // hands full: just watch
          p.t -= dt;
          if (p.t <= 0) { p.film = null; p.yaw = F.yaw; if (F.back === 'stand' && p.cluster) p.state = 'stand'; else if (F.back === 'idle') { p.state = 'idle'; p.idleT = rnd(1, 3); } else this.resume(p); }
          break;
        }
        case 'flee': {
          p.t -= dt;
          _d.subVectors(p.pos, p.fleeFrom || pp); _d.y = 0; _d.normalize();
          if (this.tryMove(p, _d.x * FLEE_SPEED * dt, _d.z * FLEE_SPEED * dt)) p.yaw = yawTo(_d.x, _d.z);
          anim = A.flee; speed = FLEE_SPEED / (RUN_STRIDE * p.hs);
          if (p.t <= 0) this.resume(p);
          break;
        }
        case 'dive': {
          const k = 3.5 - p.t; p.t -= dt;
          if (k < 0.45) this.tryMove(p, p.diveX * 4.5 * dt, p.diveZ * 4.5 * dt);
          anim = A.knocked;
          if (p.t <= 0) this.resume(p);
          break;
        }
        case 'knocked': p.knockT -= dt; anim = A.knocked; if (p.knockT <= 0) { this.flee(p, pp, 5); } break;
      }
      // umbrellas go up (and down) as the rain passes, each person at their own threshold
      const wantUmb = U.rain.value > p.umbrellaTh && !p.sitting && (p.state === 'walk' || p.state === 'idle' || p.state === 'stand');
      if (wantUmb !== !!p.umbrella && (wantUmb || U.rain.value < p.umbrellaTh * 0.6 || p.state !== 'walk')) {
        p.umbrella = wantUmb;
        if (wantUmb) { p.look.acc |= CROWD_ACC.umbrella; p.look.colors.acc2 = p.look.umbrellaColor; } else p.look.acc &= ~CROWD_ACC.umbrella;
        p.slot = -1;
      }
      o.x = p.pos.x; o.y = p.pos.y; o.z = p.pos.z; o.yaw = p.yaw; o.anim = anim; o.phase = p.phase; o.speed = speed;
      if (anim === A.knocked && p.lastAnim !== A.knocked) p.knockAt = crowd.time; // a fall starts now (also when knocked by a punch)
      p.lastAnim = anim;
      o.knockAt = anim === A.knocked ? p.knockAt : undefined;
      o.look = undefined;
      if (p.slot !== n) { o.look = p.look; p.slot = n; }
      crowd.set(n++, o);
    }
    crowd.setCount(n);
    crowd.update(dt);
  }

  _district(V) {
    // district lookups are point-in-polygon tests: refresh only when the viewer has moved on
    if (!this._dPos || this._dPos.distanceToSquared(V) > 400) { (this._dPos ||= new THREE.Vector3()).copy(V); this._dName = districtAt(V.x, V.z); }
    return this._dName;
  }

  _mrtHotspots() {
    if (this._mrt || !this.game.ambient) return;
    this._mrt = true;
    for (const s of this.game.ambient.stations) this._addHotspot({ x: s.pos.x, z: s.pos.z, kind: 'mrt' });
  }

  /** a path ran out: carry on along the next one (across the junction for sidewalks) or turn back */
  atEnd(p) {
    const w = p.sw, endX = p.s > 0 ? w.ends[1][0] : w.ends[0][0], endZ = p.s > 0 ? w.ends[1][1] : w.ends[0][1];
    p.s = Math.max(0, Math.min(w.path.length, p.s));
    const nx = this.walkways.next(w, endX, endZ);
    if (!nx) { p.dir *= -1; return; }
    p.lat = (Math.random() * 2 - 1) * nx.w.half;
    // walk straight over to where the next path starts (for sidewalks that's crossing the street)
    p.sw = nx.w; p.s = nx.s; p.dir = nx.dir;
    p.target = this.pathPoint(p, p.target || new THREE.Vector3());
    p.crossing = !w.foot && !nx.w.foot && Math.hypot(p.target.x - p.pos.x, p.target.z - p.pos.z) > 4;
  }

  /** stop for a moment: window shopping, a look at the phone, a look around (tourists: a photo) */
  pause(p, fx, fz) {
    if (p.variant === 'jogger' || p.variant === 'delivery') return;
    const r = Math.random();
    p.state = 'idle'; p.idleT = rnd(3, 10); p.idleAnim = A.idle;
    if (!p.sw.foot && r < 0.4 && (p.variant !== 'office_m' || r < 0.15)) {
      // turn to the shop windows (away from the road)
      const ox = -fz * p.sw.side * p.dir, oz = fx * p.sw.side * p.dir;
      p.yaw = yawTo(ox, oz); p.idleT = rnd(4, 12);
    } else if (p.variant === 'tourist' && r < 0.7) { p.idleAnim = A.film; p.yaw += rnd(-1.6, 1.6); }
    else if (r < 0.7 && !(p.look.acc & CROWD_ACC.trolley)) p.idleAnim = A.idle_phone;
    else p.yaw += rnd(-0.8, 0.8);
  }

  updateClusters(dt) {
    const V = this.viewer;
    for (let i = this.clusters.length - 1; i >= 0; i--) {
      const c = this.clusters[i];
      c.t -= dt;
      const d = Math.hypot(c.x - V.x, c.z - V.z), seen = this.inView(c.x, 0, c.z, 2.5);
      if (!c.members.length || ((d > this.keep || (d > this.popDist && !seen)) && c.members.every(p => p.state === 'stand'))) {
        for (const p of c.members) { const j = this.peds.indexOf(p); if (j >= 0) this.peds.splice(j, 1); p.cluster = null; }
        this.clusters.splice(i, 1); continue;
      }
      if (c.t <= 0) { for (const p of c.members.slice()) if (p.state === 'stand') this.leave(p); continue; }
      // conversation: one talks, the others listen (someone always half on their phone); photographers swap poses
      if (c.chat && (c.speakT -= dt) <= 0) {
        c.speakT = rnd(2.5, 6); c.speaker = Math.floor(Math.random() * c.members.length);
        c.members.forEach((p, k) => { if (p.state === 'stand') p.anim = k === c.speaker ? A.talk : (Math.random() < 0.2 ? A.idle_phone : A.idle); });
      } else if (c.photo && (c.speakT -= dt) <= 0) {
        c.speakT = rnd(3, 6);
        for (const p of c.members) if (p.poser && p.state === 'stand') p.anim = [A.wave, A.cheer, A.idle, A.wave, A.clap][Math.floor(Math.random() * 5)];
      }
    }
  }
}
