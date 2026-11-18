// Street-life director: every 20-40 s it stages one small Singapore moment 25-60 m ahead of the camera, where it will
// be seen: an otter family crossing the riverside promenade while people film them, junglefowl strutting across a
// road (traffic waits), a jaywalking delivery rider, two uncles arguing at the kerb with onlookers recording.
// Scenes reuse the crowd (people already on the street are recruited; newcomers only appear out of sight) and share
// one "find a visible spot" helper; each is a small script ({ at, update(dt) -> still running, end() }) that ends by
// handing everyone back to the crowd.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CROWD_ANIM as A } from '../entities/humanoid/index.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3(), _d = new THREE.Vector3();

// ------------------------------------------------------------------ critters
function painted(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo, c = new THREE.Color(hex), a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv');
  return g;
}
const at = (geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => geo.applyMatrix4(_m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz)));

// facing -z like the crowd; legs hang from their hip (origin) and swing about x
const SPECIES = {
  otter: {
    body: () => mergeGeometries([
      painted(at(new THREE.CapsuleGeometry(0.11, 0.42, 4, 10), 0, 0.17, -0.02, Math.PI / 2), 0x4a3426),
      painted(at(new THREE.SphereGeometry(0.1, 10, 8), 0, 0.15, -0.05, 0, 0, 0, 0.95, 0.75, 2.4), 0x7d644c), // pale belly
      painted(at(new THREE.SphereGeometry(0.085, 10, 8), 0, 0.22, -0.36, 0, 0, 0, 1, 0.9, 1.1), 0x4a3426),
      painted(at(new THREE.SphereGeometry(0.05, 8, 6), 0, 0.2, -0.43, 0, 0, 0, 1, 0.8, 1), 0x8a7058),
      painted(at(new THREE.SphereGeometry(0.014, 5, 4), 0, 0.215, -0.475), 0x111111),
      painted(at(new THREE.ConeGeometry(0.07, 0.45, 8), 0, 0.14, 0.45, -Math.PI / 2 - 0.15), 0x4a3426),
    ]),
    leg: () => painted(at(new THREE.CylinderGeometry(0.032, 0.026, 0.13, 6), 0, -0.065, 0), 0x3b2a1f),
    legs: [[-0.07, 0.13, -0.24, 0], [0.07, 0.13, -0.24, Math.PI], [-0.07, 0.13, 0.17, Math.PI], [0.07, 0.13, 0.17, 0]],
    cycle: 0.42, swing: 0.7, pitch: 0.12, bob: 0.03,
  },
  rooster: {
    body: () => mergeGeometries([
      painted(at(new THREE.SphereGeometry(0.12, 10, 8), 0, 0.33, 0, 0, 0, 0, 0.9, 1, 1.35), 0xa8481d),
      painted(at(new THREE.SphereGeometry(0.06, 8, 6), 0, 0.47, -0.13), 0xc4642a),
      painted(at(new THREE.BoxGeometry(0.016, 0.05, 0.07), 0, 0.53, -0.13), 0xd42a1e), // comb
      painted(at(new THREE.SphereGeometry(0.018, 5, 4), 0, 0.43, -0.17, 0, 0, 0, 0.8, 1.6, 0.8), 0xd42a1e), // wattle
      painted(at(new THREE.ConeGeometry(0.016, 0.05, 5), 0, 0.465, -0.2, -Math.PI / 2), 0xd9b648),
      painted(at(new THREE.SphereGeometry(0.11, 8, 6), 0, 0.46, 0.15, -0.7, 0, 0, 0.35, 1.5, 0.8), 0x1c2a1c), // tail sickles
      painted(at(new THREE.SphereGeometry(0.09, 8, 6), 0, 0.31, 0, 0, 0, 0, 1.25, 0.8, 1.1), 0x6b2c14), // wings
    ]),
    leg: () => painted(at(new THREE.CylinderGeometry(0.012, 0.01, 0.23, 4), 0, -0.115, 0), 0x9c8a5a),
    legs: [[-0.045, 0.24, 0, 0], [0.045, 0.24, 0, Math.PI]],
    cycle: 0.55, swing: 0.5, pitch: 0.06, bob: 0.015,
  },
  hen: {
    body: () => mergeGeometries([
      painted(at(new THREE.SphereGeometry(0.1, 10, 8), 0, 0.27, 0, 0, 0, 0, 0.9, 0.95, 1.3), 0x7a5a36),
      painted(at(new THREE.SphereGeometry(0.05, 8, 6), 0, 0.38, -0.11), 0x8a6a42),
      painted(at(new THREE.ConeGeometry(0.013, 0.04, 5), 0, 0.375, -0.16, -Math.PI / 2), 0xd9b648),
      painted(at(new THREE.SphereGeometry(0.07, 8, 6), 0, 0.33, 0.12, -0.6, 0, 0, 0.4, 1.0, 0.7), 0x4f3a24),
    ]),
    leg: () => painted(at(new THREE.CylinderGeometry(0.011, 0.009, 0.19, 4), 0, -0.095, 0), 0x9c8a5a),
    legs: [[-0.04, 0.2, 0, 0], [0.04, 0.2, 0, Math.PI]],
    cycle: 0.5, swing: 0.45, pitch: 0.05, bob: 0.012,
  },
};

/** small instanced animals (two draws per species while any are out) */
class Critters {
  constructor(scene, max = 8) {
    this.list = [];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    this.kinds = {};
    for (const [name, S] of Object.entries(SPECIES)) {
      const body = new THREE.InstancedMesh(S.body(), mat, max), legs = new THREE.InstancedMesh(S.leg(), mat, max * S.legs.length);
      for (const m of [body, legs]) { m.count = 0; m.visible = false; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.name = 'critter_' + name; scene.add(m); }
      this.kinds[name] = { S, body, legs, max };
    }
  }
  add(kind, x, y, z, yaw) {
    const c = { kind, pos: new THREE.Vector3(x, y, z), yaw, moving: false, peck: 0, phase: Math.random() * 10 };
    this.list.push(c);
    return c;
  }
  clear() { this.list.length = 0; }
  update(dt) {
    for (const K of Object.values(this.kinds)) K.n = 0;
    for (const c of this.list) {
      const K = this.kinds[c.kind], S = K.S; if (K.n >= K.max) continue;
      if (c.moving) c.phase += dt / S.cycle;
      const ph = c.phase * Math.PI * 2, mv = c.moving ? 1 : 0;
      const pitch = mv * S.pitch * Math.sin(ph * 2) + c.peck * 0.6;
      _m.compose(_v.set(c.pos.x, c.pos.y + mv * S.bob * Math.abs(Math.sin(ph)), c.pos.z), _q.setFromEuler(_e.set(-pitch, c.yaw, 0, 'YXZ')), _s.set(1, 1, 1));
      K.body.setMatrixAt(K.n, _m);
      const base = _m.clone();
      S.legs.forEach(([lx, ly, lz, off], k) => {
        const sw = mv * S.swing * Math.sin(ph + off);
        K.legs.setMatrixAt(K.n * S.legs.length + k, _m.copy(base).multiply(new THREE.Matrix4().compose(_v.set(lx, ly, lz), _q.setFromEuler(_e.set(sw, 0, 0)), _s)));
      });
      K.n++;
    }
    for (const K of Object.values(this.kinds)) {
      K.body.count = K.n; K.legs.count = K.n * K.S.legs.length; K.body.visible = K.legs.visible = K.n > 0;
      if (K.n) { K.body.instanceMatrix.needsUpdate = true; K.legs.instanceMatrix.needsUpdate = true; }
    }
  }
}

// ------------------------------------------------------------------ the director
export class StreetLife {
  constructor(game, peds) {
    this.game = game; this.peds = peds;
    this.critters = new Critters(game.scene);
    this.event = null;
    this.focus = null; // stageAt(): where the next spot() must be
    this.t = rnd(12, 25);
  }

  update(dt) {
    const g = this.game;
    if (this.event && !this.event.update(dt)) { this.event.end(); this.event = null; this.critters.clear(); this.t = rnd(20, 40); }
    this.critters.update(dt);
    if (this.event || (this.t -= dt) > 0) return;
    this.t = 3; // nothing fitted: look again shortly
    const v = g.player.vehicle; if ((v && Math.abs(v.speed) > 14) || g.cameraRig?.override) return; // whizzing past, or a cutscene
    const tm = g.sky.time, order = [this.otters, this.fowl, this.jaywalker, this.argument].sort(() => Math.random() - 0.5);
    for (const stage of order) { const ev = stage.call(this, tm); if (ev) { this.event = ev; return; } }
  }

  /** a point on a footpath 25-60 m ahead in plain view (nothing in between), optionally filtered */
  spot(filter, { min = 25, max = 60, tries = 12, foot } = {}) {
    if (this.focus) return this.spotAt(this.focus, filter, foot);
    const P = this.peds, V = P.viewer, f = P._fwd, cam = this.game.camera.position;
    for (let k = 0; k < tries; k++) {
      const a = Math.atan2(f.y, f.x) + (Math.random() - 0.5) * P.hfov * 0.7, d = rnd(min, max);
      const sn = P.walkways.snap(V.x + Math.cos(a) * d, V.z + Math.sin(a) * d, 10, foot === undefined ? null : w => !!w.foot === foot);
      if (!sn) continue;
      sn.w.path.sample(sn.s, _p, _d);
      const dist = Math.hypot(_p.x - V.x, _p.z - V.z);
      if (dist < min * 0.8 || dist > max * 1.1 || !P.inView(_p.x, 0, _p.z)) continue;
      _v.set(_p.x - cam.x, 1 - cam.y, _p.z - cam.z); const L = _v.length();
      if (this.game.physics.raycast(cam, _v.multiplyScalar(1 / L), L - 1)) continue;
      const s = { w: sn.w, s: sn.s, x: _p.x, z: _p.z, dx: _d.x, dz: _d.z };
      if (!filter || filter(s)) return s;
    }
    return null;
  }

  /** Stage one scene right now around `at` (a point by the road ahead) instead of wherever the director would look:
   *  the first drive's scripted beats (missions/firstdrive.js). Returns the scene, or null if it doesn't fit there (the
   *  time of day is ignored: the beat was asked for). A scene already running gives way only to one that fits. */
  stageAt(kind, at) {
    const prev = this.event, had = this.critters.list.length;
    let ev = null;
    this.focus = at;
    try { ev = this[kind](12); } finally { this.focus = null; }
    if (!ev) return null;
    if (prev) { prev.end(); this.critters.list.splice(0, had); } // (its animals were the first in the list)
    this.event = ev;
    return ev;
  }

  /** the footpath point nearest `at`, if it is in plain view (stageAt's spot) */
  spotAt(at, filter, foot) {
    const P = this.peds, cam = this.game.camera.position;
    const sn = P.walkways.snap(at.x, at.z, 8, foot === undefined ? null : w => !!w.foot === foot);
    if (!sn) return null;
    sn.w.path.sample(sn.s, _p, _d);
    if (!P.inView(_p.x, 0, _p.z)) return null;
    _v.set(_p.x - cam.x, 1 - cam.y, _p.z - cam.z); const L = _v.length();
    if (this.game.physics.raycast(cam, _v.multiplyScalar(1 / L), L - 1)) return null;
    const s = { w: sn.w, s: sn.s, x: _p.x, z: _p.z, dx: _d.x, dz: _d.z };
    return !filter || filter(s) ? s : null;
  }

  /** people near (x,z) walking along a footpath (not mid-crossing), nearest first: recruits for a scene */
  bystanders(x, z, r, n, exclude = []) {
    return this.peds.peds.filter(p => !p.pose && !p.script && !p.hailing && !p.cluster && p.state === 'walk' && !p.target && !exclude.includes(p) && Math.hypot(p.pos.x - x, p.pos.z - z) < r)
      .sort((a, b) => Math.hypot(a.pos.x - x, a.pos.z - z) - Math.hypot(b.pos.x - x, b.pos.z - z)).slice(0, n);
  }

  /** onlookers stop and film whatever is at get() for t seconds */
  film(list, get, t) { for (const p of list) { p.film = { x: 0, z: 0, get, delay: rnd(0.2, 1.5), back: 'walk', yaw: p.yaw }; p.state = 'film'; p.t = t * rnd(0.7, 1); } }

  /** when the viewer has moved on or looks away, a scene's leftovers can go */
  gone(x, z) { const P = this.peds, V = P.viewer; return Math.hypot(x - V.x, z - V.z) > P.view * 1.2 || !P.inView(x, 0, z, 3); }

  // ---------------------------------------------------------------- otters
  otters(tm) {
    if (tm < 6.5 || tm > 19.5) return null;
    const city = this.game.city;
    // metres from (x,z) along (nx,nz) to the water's edge, if it's close
    const shore = (x, z, nx, nz) => { for (let k = 2; k <= 10; k++) if (city.isWater(x + nx * k, z + nz * k)) return k; return 0; };
    // a waterfront footpath with water within a few metres on one side
    const s = this.spot(s => {
      for (const side of [1, -1]) { const nx = -s.dz * side, nz = s.dx * side, k = shore(s.x, s.z, nx, nz); if (k) { s.nx = nx; s.nz = nz; s.wk = k; return true; } }
      return false;
    });
    if (!s) return null;
    // the family's run: up out of the water, ~14 m along the path, back in
    const L = s.w.path.length, dir = s.s + 16 < L ? 1 : -1, s1 = Math.max(0, Math.min(L, s.s + dir * 14));
    s.w.path.sample(s1, _p); const ex = _p.x, ez = _p.z, ek = shore(ex, ez, s.nx, s.nz);
    if (!ek) return null;
    const P = (x, z, k, y = 0) => new THREE.Vector3(x + s.nx * k, y, z + s.nz * k);
    const route = [P(s.x, s.z, s.wk + 1.5, -1.8), P(s.x, s.z, s.wk - 0.6), P(s.x, s.z, 0.5), P(ex, ez, 0.5), P(ex, ez, ek - 0.6), P(ex, ez, ek + 1.5, -1.8)];
    if (city.isWater(route[2].x, route[2].z) || city.isWater(route[3].x, route[3].z)) return null;
    const n = 4 + Math.floor(Math.random() * 3), pack = [];
    for (let i = 0; i < n; i++) pack.push({ c: this.critters.add('otter', route[0].x, route[0].y, route[0].z, 0), lag: i * rnd(0.55, 0.9) + (i ? 0.4 : 0), side: i ? rnd(-0.35, 0.35) : 0 });
    const lead = pack[0].c, fans = this.bystanders(s.x, s.z, 28, 4);
    this.film(fans, () => lead.pos, 14);
    let t = 0;
    const seg = route.slice(1).map((p, i) => p.distanceTo(route[i])), total = seg.reduce((a, b) => a + b, 0), speed = 1.7;
    return {
      at: route[2],
      update: dt => {
        t += dt;
        for (const o of pack) {
          let d = Math.max(0, (t - o.lag) * speed), i = 0;
          while (i < seg.length - 1 && d > seg[i]) d -= seg[i++];
          const a = route[i], b = route[i + 1], f = Math.min(1, d / seg[i]);
          o.c.pos.lerpVectors(a, b, f); o.c.yaw = yawTo(b.x - a.x, b.z - a.z); o.c.moving = (t - o.lag) * speed < total;
          if (i === 2) { o.c.pos.x += s.nx * o.side; o.c.pos.z += s.nz * o.side; } // a loose file along the path
          if (!o.c.moving) o.c.pos.y = -3; // dived
        }
        return (t - pack[n - 1].lag) * speed < total + 0.5;
      },
      end: () => {},
    };
  }

  // ---------------------------------------------------------------- junglefowl
  fowl(tm) {
    if (tm < 6.5 || tm > 19) return null;
    const g = this.game, city = g.city;
    // a street with greenery: they come out of the verge, cross, and go back into the green on the far side
    const s = this.spot(s => !s.w.foot && city.maskAt(s.x, s.z, 1) > 120, { foot: false });
    if (!s) return null;
    const side = s.w.side, rx = s.dz * side, rz = -s.dx * side; // towards the road
    const width = 2 * (s.w.edge.hw + 2);
    const a = new THREE.Vector3(s.x - rx * 1.5, 0, s.z - rz * 1.5), b = new THREE.Vector3(s.x + rx * (width + 1.5), 0, s.z + rz * (width + 1.5));
    if (city.isWater(b.x, b.z) || g.safe.insideBuilding(b.x, b.z, 0.3)) return null;
    const birds = [['rooster', 0]];
    for (let i = 0, n = 2 + Math.floor(Math.random() * 2); i < n; i++) birds.push(['hen', 1.2 + i * rnd(0.9, 1.6)]);
    const flock = birds.map(([k, lag]) => ({ c: this.critters.add(k, a.x + rnd(-0.6, 0.6), 0, a.z + rnd(-0.6, 0.6), yawTo(rx, rz)), lag, off: rnd(-0.7, 0.7), d: 0, pause: 0 }));
    const len = a.distanceTo(b);
    this.film(this.bystanders(s.x, s.z, 20, 2), () => flock[0].c.pos, 10);
    let t = 0;
    return {
      at: a,
      update: dt => {
        t += dt;
        const obstacles = g.traffic?.obstacles;
        let done = true;
        for (const o of flock) {
          if (t < o.lag) { done = false; continue; }
          // strut, stop, peck, strut on
          if (o.pause > 0) { o.pause -= dt; o.c.moving = false; o.c.peck = Math.max(0, Math.sin(o.pause * 5)); }
          else { o.c.peck = 0; o.c.moving = o.d < len; o.d = Math.min(len, o.d + 0.75 * dt); if (Math.random() < dt * 0.35) o.pause = rnd(0.6, 1.6); }
          const f = o.d / len;
          o.c.pos.set(a.x + (b.x - a.x) * f - rz * o.off, 0, a.z + (b.z - a.z) * f + rx * o.off);
          if (o.d < len) done = false;
          if (f > 0.05 && f < 0.95) obstacles?.push({ x: o.c.pos.x, z: o.c.pos.z, r: 0.5 }); // traffic waits for them
        }
        return !done || !this.gone(b.x, b.z) && t < 40;
      },
      end: () => {},
    };
  }

  // ---------------------------------------------------------------- jaywalking delivery rider
  jaywalker(tm) {
    if (tm < 7 || tm > 23) return null;
    const g = this.game;
    const s = this.spot(s => !s.w.foot && s.w.edge.hw > 3 && !g.safe.insideBuilding(s.x, s.z, 0.3), { foot: false });
    if (!s) return null;
    const side = s.w.side, rx = s.dz * side, rz = -s.dx * side, width = 2 * (s.w.edge.hw + 2);
    const b = new THREE.Vector3(s.x + rx * width, 0, s.z + rz * width);
    if (g.city.isWater(b.x, b.z) || g.safe.insideBuilding(b.x, b.z, 0.3)) return null;
    // someone already on this pavement, else a rider who walks in from out of sight
    let p = this.bystanders(s.x, s.z, 14, 1).find(q => q.sw === s.w);
    if (p) { this.peds.detach(p); p.state = 'script'; p.script = true; p.anim = A.walk; }
    else {
      const back = this.peds.viewer; if (!this.peds.unseen(s.x, s.z, Math.hypot(s.x - back.x, s.z - back.z))) return null;
      p = this.peds.addScripted('delivery', s.x, s.z, 0, A.walk_phone); if (!p) return null;
    }
    const legs = [new THREE.Vector3(s.x, 0, s.z), b];
    let k = 0, honked = false, t = 0;
    return {
      at: new THREE.Vector3().lerpVectors(legs[0], b, 0.5),
      update: dt => {
        t += dt;
        const to = legs[k]; _v.subVectors(to, p.pos); _v.y = 0; const l = _v.length();
        const v = k ? 1.9 : p.speed;
        if (l < 0.3) { if (++k >= legs.length) return false; }
        else { _v.multiplyScalar(1 / l); p.pos.addScaledVector(_v, Math.min(l, v * dt)); p.yaw = yawTo(_v.x, _v.z); }
        p.anim = p.variant === 'delivery' && !p.umbrella ? A.walk_phone : A.walk;
        p.cadence = v;
        if (k === 1) {
          g.traffic?.obstacles?.push({ x: p.pos.x, z: p.pos.z, r: 0.5 });
          if (!honked) for (const c of g.traffic?.cars || []) if (c.pos.distanceTo(p.pos) < 22) { honked = true; g.audio?.sfx?.('horn', { position: c.pos, volume: 0.8 }); g.bark?.('nearmiss', p.pos, 2, { text: 'Walao, almost kena!' }); break; }
        }
        return t < 30;
      },
      end: () => { p.cadence = 0; if (this.peds.peds.includes(p)) this.peds.release(p); },
    };
  }

  // ---------------------------------------------------------------- two uncles arguing
  argument(tm) {
    if (tm < 7.5 || tm > 22.5) return null;
    const s = this.spot(s => !s.w.foot, { min: 22, max: 50, foot: false });
    if (!s) return null;
    // the two nearest on this pavement square up (just off the walking line), whoever else is near stops to film
    const [p1, p2] = this.bystanders(s.x, s.z, 22, 6).filter(q => q.sw === s.w);
    if (!p2) return null;
    const fans = this.bystanders(s.x, s.z, 22, 4, [p1, p2]);
    const ox = -s.dz * s.w.side, oz = s.dx * s.w.side;
    const mid = new THREE.Vector3(s.x + ox * 0.6, 0, s.z + oz * 0.6);
    const spots = [new THREE.Vector3(mid.x - s.dx * 0.65, 0, mid.z - s.dz * 0.65), new THREE.Vector3(mid.x + s.dx * 0.65, 0, mid.z + s.dz * 0.65)];
    for (const q of [p1, p2]) { this.peds.detach(q); q.state = 'script'; q.script = true; q.anim = A.walk; }
    this.film(fans, () => mid, 16);
    const LINES = [['nearmiss', 'Can or not?!'], ['hit', 'Oi! You blind ah?'], ['hit', 'Cannot like that one lah!'], ['auntie', "Don't anyhow ah!"], ['nearmiss', 'Drive like that, confirm kena saman!'], ['hit', 'Eh hello, got pedestrian here one!']];
    let t = 0, sayT = 1.5, line = 0;
    const life = rnd(16, 24);
    return {
      at: mid,
      update: dt => {
        t += dt;
        [p1, p2].forEach((q, i) => {
          const to = spots[i]; _v.subVectors(to, q.pos); _v.y = 0; const l = _v.length();
          if (l > 0.25) { _v.multiplyScalar(1 / l); q.pos.addScaledVector(_v, Math.min(l, q.speed * dt)); q.yaw = yawTo(_v.x, _v.z); q.anim = A.walk; q.cadence = q.speed; }
          else { const o = spots[1 - i]; q.yaw = yawTo(o.x - q.pos.x, o.z - q.pos.z); q.anim = A.argue; q.cadence = 0; }
        });
        if ((sayT -= dt) <= 0 && p1.anim === A.argue) {
          sayT = rnd(2.5, 4.5); const [kind, text] = LINES[line++ % LINES.length], who = line % 2 ? p1 : p2;
          this.game.bark?.(kind, who.pos, 1.5, { text, voice: who.variant === 'auntie' || who.variant === 'female' || who.variant === 'office_f' ? 'auntie' : 'uncle' });
        }
        return t < life;
      },
      end: () => { for (const q of [p1, p2]) { q.cadence = 0; if (this.peds.peds.includes(q)) this.peds.release(q); } },
    };
  }
}
