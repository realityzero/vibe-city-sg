// Life on the water: river taxis (bumboats) plying the Singapore River and Marina Bay, a DUCKtours amphibious bus
// circling the bay, and ships at anchor in the strait. Boats follow fixed loops down the middle of the channel (keeping
// to starboard on the river, so the two directions pass), slow for the bends, keep their distance from the boat ahead
// and stop for anything in their way (the player's boat, a swimmer, a moored craft) — after a while they nudge it
// aside, as a ferry would. They are solid (kinematic bodies) and each pushes a wake. Bumboats are instances of the
// traffic renderer's pool (one draw for all of them); the duck, the two kinds of ship and the wakes are one draw each.
// tests/scratch/boatroutes.mjs checks every loop and anchorage against the water mask.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FILTER } from '../physics/physics.js';
import { WATER_LEVEL } from '../core/constants.js';
import { U } from '../gfx/globals.js';

// Singapore River from Robertson Quay down past Clarke Quay and Boat Quay to the mouth (channel middle, from the water
// mask), the loop round Marina Bay it joins, and an inner bay loop for the duck
const RIVER = [[-646, -429], [-584, -452], [-570, -450], [-526, -408], [-514, -379], [-514, -360], [-509, -328], [-489, -281], [-438, -244], [-332, -286], [-296, -306], [-204, -324], [-142, -316], [-84, -296], [2, -252], [47, -221], [98, -116], [108, -71], [135, -20], [180, 30], [224, 76], [274, 90], [374, 48], [426, -12], [447, -36], [511, -115], [540, -125]];
const BAY = [[600, -120], [700, -150], [840, -140], [910, -120], [1000, -40], [1040, 40], [980, 140], [870, 210], [860, 360], [800, 480], [750, 600], [700, 560], [690, 420], [700, 260], [690, 120], [690, 20], [650, -80]];
const INNER = [[760, -70], [870, -80], [930, 0], [900, 110], [820, 190], [760, 260], [740, 170], [730, 40]];
const TURN = [-680, -427]; // where the river taxis turn round, upstream of Robertson Quay
const KEEP = 6; // m to starboard of the river's middle
// ships at anchor in the strait (x, z, heading, kind 0 container ship / 1 tanker): they lie to the same tide
export const ANCHORAGE = [[450, 1900, 1.2, 0], [750, 1950, 1.25, 1], [2850, 1500, 1.15, 0], [2900, 900, 1.2, 1], [2700, 1900, 1.3, 0], [2400, 2000, 1.18, 0]];
const STEP = 2; // m between route samples

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _c = new THREE.Color();
const LIGHTS = { head: false };

/** points offset `off` m to the right of the direction of travel along polyline P */
function offsetLine(P, off) {
  return P.map((p, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [p[0] - dz / l * off, p[1] + dx / l * off]; // right of (dx, dz) with x east, z south
  });
}

/** A closed loop through waypoints (Catmull-Rom), resampled every STEP m, with the speed each bend allows */
export class Loop {
  constructor(pts, aLat = 0.35) {
    const dense = [], n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], d = pts[(i + 2) % n], L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      for (let k = 0, m = Math.max(2, Math.ceil(L)); k < m; k++) {
        const t = k / m, t2 = t * t, t3 = t2 * t, f = (A, B, C, D) => 0.5 * (2 * B + (C - A) * t + (2 * A - 5 * B + 4 * C - D) * t2 + (3 * B - A - 3 * C + D) * t3);
        dense.push(f(a[0], p1[0], p2[0], d[0]), f(a[1], p1[1], p2[1], d[1]));
      }
    }
    // even spacing by arc length
    const cum = [0]; for (let i = 2; i < dense.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(dense[i] - dense[i - 2], dense[i + 1] - dense[i - 1]));
    const total = cum[cum.length - 1] + Math.hypot(dense[0] - dense[dense.length - 2], dense[1] - dense[dense.length - 1]);
    const N = Math.floor(total / STEP); this.n = N; this.length = N * STEP;
    this.x = new Float32Array(N); this.z = new Float32Array(N);
    for (let i = 0, j = 0; i < N; i++) {
      const s = i * this.length / N; while (j < cum.length - 1 && cum[j + 1] < s) j++;
      const j2 = (j + 1) % cum.length, s1 = j + 1 < cum.length ? cum[j + 1] : total, t = (s - cum[j]) / Math.max(1e-6, s1 - cum[j]);
      this.x[i] = dense[j * 2] + (dense[j2 * 2] - dense[j * 2]) * t; this.z[i] = dense[j * 2 + 1] + (dense[j2 * 2 + 1] - dense[j * 2 + 1]) * t;
    }
    // bend speeds (turn over ±10 m), then braking room before each bend
    const v = this.vcap = new Float32Array(N), h = i => Math.atan2(this.z[(i + 1) % N] - this.z[i], this.x[(i + 1) % N] - this.x[i]);
    for (let i = 0; i < N; i++) { let d = h((i + 5) % N) - h((i - 5 + N) % N); d = Math.abs(Math.atan2(Math.sin(d), Math.cos(d))); v[i] = Math.sqrt(aLat * 20 / Math.max(d, 1e-3)); }
    for (let pass = 0; pass < 2; pass++) for (let i = N - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[(i + 1) % N] ** 2 + 2 * 0.25 * STEP));
  }
  wrap(s) { return ((s % this.length) + this.length) % this.length; }
  /** position (y 0) at arc length s; returns the heading (yaw, model -z forward) */
  at(s, out) {
    const f = this.wrap(s) / STEP, i = Math.floor(f) % this.n, j = (i + 1) % this.n, t = f - Math.floor(f);
    out.set(this.x[i] + (this.x[j] - this.x[i]) * t, 0, this.z[i] + (this.z[j] - this.z[i]) * t);
    return Math.atan2(-(this.x[j] - this.x[i]), -(this.z[j] - this.z[i]));
  }
  cap(s) { return this.vcap[Math.floor(this.wrap(s) / STEP) % this.n]; }
}

// ------------------------------------------------------------------ models (vertex-coloured, shared material)
function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo, c = _c.set(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv');
  return g;
}
const boxAt = (w, h, d, x, y, z, hex) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
/** a hull in plan (half-width at each fraction of the length from the bow) extruded from y0 to y1; bow at -z */
function hull(L, halfW, y0, y1, hex) {
  const s = new THREE.Shape(), pts = [];
  for (const [t, w] of halfW) pts.push([w, -L / 2 + t * L]);
  s.moveTo(0, -L / 2); for (const [x, z] of pts) s.lineTo(x, z); for (let i = pts.length - 1; i >= 0; i--) s.lineTo(-pts[i][0], pts[i][1]);
  const g = new THREE.ExtrudeGeometry(s, { depth: y1 - y0, bevelEnabled: false });
  g.rotateX(Math.PI / 2); g.translate(0, y1, 0); // shape (x, y) -> plan (x, z); extruded downwards from y1
  return colored(g, hex);
}

/** DUCKtours amphibious bus afloat: yellow tub, white rub rail, blue canopy on posts, wheels at the waterline */
function duckGeometry() {
  const parts = [hull(10.4, [[0.08, 0.9], [0.22, 1.2], [0.9, 1.25], [1, 1.2]], -0.6, 1.25, 0xf2c418), boxAt(2.56, 0.14, 8.6, 0, 1.3, 0.6, 0xf4f1e8)];
  for (const z of [-2.6, 0.6, 3.4]) for (const x of [-1.32, 1.32]) parts.push(colored(new THREE.CylinderGeometry(0.55, 0.55, 0.32, 10).rotateZ(Math.PI / 2).translate(x, 0.05, z), 0x18181a));
  parts.push(boxAt(2.3, 0.7, 1.0, 0, 1.7, -2.9, 0x1f63c6)); // cab front
  parts.push(boxAt(2.2, 0.55, 0.06, 0, 2.3, -2.4, 0x253038)); // windscreen
  for (const z of [-2.3, 0, 2.3, 4.6]) for (const x of [-1.15, 1.15]) parts.push(boxAt(0.07, 1.55, 0.07, x, 2.1, z, 0xe8e8e8));
  parts.push(boxAt(2.6, 0.12, 7.4, 0, 2.92, 1.15, 0x1f63c6), boxAt(2.64, 0.22, 7.44, 0, 2.78, 1.15, 0xf2c418));
  for (const x of [-0.6, 0.6]) parts.push(boxAt(0.9, 0.5, 6.4, x, 1.55, 1.3, 0xd23a2a)); // seats
  return mergeGeometries(parts);
}

/** container ship (kind 0) or tanker (1), ~190 m: hull, accommodation block and funnel aft, boxes or deck pipework */
function shipGeometry(kind) {
  const L = kind ? 180 : 200, parts = [hull(L, [[0.04, 6], [0.12, 13], [0.25, 16], [0.9, 16], [1, 14]], -10, 10, kind ? 0x7a1f1a : 0x1c2c44)];
  parts.push(boxAt(30, 0.6, L * 0.86, 0, 10.2, L * 0.05, kind ? 0x9a3a2a : 0x6a6e70));
  const az = L * 0.4; // accommodation aft
  parts.push(boxAt(26, 16, 12, 0, 18, az, 0xf2f0ea), boxAt(30, 1.2, 4, 0, 26.6, az - 6, 0xf2f0ea), boxAt(6, 9, 6, 0, 30, az + 3, kind ? 0x2a2a2a : 0xc8202a));
  if (kind) { parts.push(boxAt(2.5, 2.5, L * 0.6, 0, 12, -L * 0.08, 0x8a8f92), boxAt(14, 6, 6, 0, 13, -L * 0.42, 0xf2f0ea)); }
  else {
    const cols = [0xc8202a, 0x1d4f8a, 0xe8e6e0, 0xe07a1a, 0x2d7a46, 0x6a6e70, 0x18355e, 0x9a2a1a];
    let k = 0;
    for (let z = -L * 0.4; z < az - 14; z += 13) {
      const tiers = 2 + ((k * 7) % 3);
      for (let t = 0; t < tiers; t++) for (let x = -12; x <= 12; x += 8) parts.push(boxAt(7.6, 2.5, 12.2, x, 11.8 + t * 2.6, z, cols[(k * 3 + t * 5 + Math.round(x)) & 7]));
      k++;
    }
  }
  return mergeGeometries(parts);
}

function wakeTexture() {
  const W = 64, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W * 2 - 1, v = (y + 0.5) / H, au = Math.abs(u);
    // two arms spreading off the stern (the Kelvin wedge) and a churned strip down the middle, fading astern
    const arm = Math.exp(-(((au - 0.12 - v * 0.85) / (0.06 + 0.12 * v)) ** 2)) * (1 - v) ** 1.4;
    const mid = Math.exp(-((u / (0.1 + 0.25 * v)) ** 2)) * (1 - v) ** 2 * 0.9;
    const a = Math.min(1, arm * 0.8 + mid), i = (y * W + x) * 4;
    img.data[i] = 235; img.data[i + 1] = 245; img.data[i + 2] = 250; img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ the fleet
const KINDS = {
  bumboat: { len: 11, width: 2.9, height: 2.4, vmax: [3.2, 4.4] },
  duck: { len: 10.4, width: 2.6, height: 3, vmax: [2.6, 3.2] },
};

export class Boats {
  constructor(game) {
    this.game = game;
    const river = offsetLine(RIVER, KEEP), back = offsetLine(RIVER.slice().reverse(), KEEP);
    this.main = new Loop([...river, ...BAY, ...back, TURN]);
    this.inner = new Loop(INNER);
    this.list = [];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 }); // as the bus shelters: one program
    this.duckMesh = new THREE.InstancedMesh(duckGeometry(), mat, 1);
    this.duckMesh.castShadow = this.duckMesh.receiveShadow = true; this.duckMesh.name = 'duckTour';
    this.ships = [0, 1].map(kind => {
      const at = ANCHORAGE.filter(a => a[3] === kind), m = new THREE.InstancedMesh(shipGeometry(kind), mat, at.length);
      at.forEach(([x, z, yaw], i) => m.setMatrixAt(i, _m.compose(_p.set(x, WATER_LEVEL, z), _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), _s.set(1, 1, 1))));
      m.castShadow = false; m.receiveShadow = true; m.name = 'shipsAtAnchor'; m.computeBoundingSphere();
      return m;
    });
    // wakes: additive foam on the water astern, faded with speed and by night
    const wg = new THREE.PlaneGeometry(1, 1); wg.rotateX(-Math.PI / 2); wg.translate(0, 0, 0.5); // from the stern back
    this.wakes = new THREE.InstancedMesh(wg, new THREE.MeshBasicMaterial({ map: wakeTexture(), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }), 16);
    this.wakes.setColorAt(0, _c.setRGB(1, 1, 1)); this.wakes.count = 0; this.wakes.frustumCulled = false; this.wakes.renderOrder = 3; this.wakes.name = 'boatWakes';
    game.scene.add(this.duckMesh, ...this.ships, this.wakes);
    // ten river taxis round the river and the bay, one more and the duck on the inner loop
    const R = game.traffic.renderer, colours = [0xb8262c, 0xb8262c, 0xb8262c, 0x1d4f8a, 0x2d6a4f];
    for (let i = 0; i < 10; i++) this._add('bumboat', this.main, (i + Math.random() * 0.4) / 10 * this.main.length, R.add('bumboat', colours[i % colours.length], { pool: false }));
    this._add('bumboat', this.inner, this.inner.length / 2, R.add('bumboat', 0xb8262c, { pool: false }));
    this._add('duck', this.inner, 0, 0);
    // the ships are solid too (a speedboat can reach them)
    const P = game.physics, Rp = P.R;
    for (const [x, z, yaw, kind] of ANCHORAGE) {
      const L = kind ? 180 : 200;
      P.world.createCollider(Rp.ColliderDesc.cuboid(15, 20, L / 2).setTranslation(x, WATER_LEVEL, z).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }).setCollisionGroups(FILTER.static));
    }
    game.physics.onStep(h => this.fixedStep(h));
  }

  _add(kind, loop, s, rid) {
    const K = KINDS[kind], P = this.game.physics, R = P.R;
    const b = { kind, loop, s, rid, len: K.len, width: K.width, v: 0, vmax: K.vmax[0] + Math.random() * (K.vmax[1] - K.vmax[0]), wait: 0, phase: Math.random() * 6.28, pos: new THREE.Vector3(), yaw: loop.at(s, _p), kv: new THREE.Vector3(), kt: 0 };
    b.pos.copy(_p).setY(WATER_LEVEL);
    b.body = P.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(b.pos.x, b.pos.y, b.pos.z));
    P.world.createCollider(R.ColliderDesc.cuboid(K.width / 2, K.height / 2, K.len / 2).setTranslation(0, K.height / 2 - 0.5, 0).setCollisionGroups(FILTER.traffic), b.body);
    this.list.push(b);
  }

  fixedStep(h) {
    for (const b of this.list) {
      b.kt += h;
      b.body.setNextKinematicTranslation(_p.copy(b.pos).addScaledVector(b.kv, b.kt));
      b.body.setNextKinematicRotation(_q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, b.yaw));
    }
  }

  /** distance to the nearest thing in b's way within 45 m ahead (another boat, the player's craft, a swimmer), and
   * whether it is one of the fleet (they never wait on each other for long: the loops don't cross) */
  _gap(b) {
    const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
    let gap = 1e9, fleet = true;
    const test = (x, z, len, width, own) => {
      const dx = x - b.pos.x, dz = z - b.pos.z, ahead = dx * fx + dz * fz;
      if (ahead <= 0 || ahead > 45 + len / 2) return;
      if (Math.abs(dx * fz - dz * fx) > (b.width + width) / 2 + 2.5) return;
      const d = ahead - (b.len + len) / 2; if (d < gap) { gap = d; fleet = own; }
    };
    for (const o of this.list) if (o !== b) test(o.pos.x, o.pos.z, o.len, o.width, true);
    const g = this.game, pl = g.player;
    for (const v of g.vehicles) if (v.isBoat) test(v.position.x, v.position.z, v.spec.length, v.spec.width, false);
    if (pl?.swimming) test(pl.position.x, pl.position.z, 1, 1, false);
    return { gap, fleet };
  }

  update(dt) {
    if (!(dt > 0)) return;
    const t = U.time.value, night = U.night.value, R = this.game.traffic.renderer;
    LIGHTS.head = night > 0.3;
    let w = 0;
    for (const b of this.list) {
      // speed: the bend's, and room to stop short of whatever is ahead; blocked by a non-fleet craft for a while, it
      // creeps on and nudges it aside
      const { gap, fleet } = this._gap(b);
      let want = Math.min(b.vmax, b.loop.cap(b.s + b.v * 4), Math.sqrt(Math.max(0, 2 * 0.3 * (gap - 8))));
      if (gap < 12 && !fleet && (b.wait += dt) > 5) want = Math.max(want, 0.6); else if (gap >= 12) b.wait = 0;
      b.v += THREE.MathUtils.clamp(want - b.v, -0.8 * dt, 0.3 * dt);
      b.s = b.loop.wrap(b.s + b.v * dt);
      // the hull lies along the loop between bow and stern, rides the swell a little, leans into the turn
      const yaw = b.loop.at(b.s, _p), inv = 1 / dt;
      const turn = Math.atan2(Math.sin(yaw - b.yaw), Math.cos(yaw - b.yaw));
      b.yaw += turn * Math.min(1, dt * 2);
      const y = WATER_LEVEL + 0.06 * Math.sin(t * 1.1 + b.phase);
      b.kv.set((_p.x - b.pos.x) * inv, (y - b.pos.y) * inv, (_p.z - b.pos.z) * inv); b.kt = 0;
      b.pos.set(_p.x, y, _p.z);
      _q.setFromEuler(_e.set(0.012 * Math.sin(t * 0.9 + b.phase * 2), b.yaw, 0.02 * Math.sin(t * 0.7 + b.phase) - turn * 0.5));
      if (b.kind === 'duck') { const D = this.duckMesh; D.setMatrixAt(0, _m.compose(b.pos, _q, _s.set(1, 1, 1))); D.instanceMatrix.needsUpdate = true; D.computeBoundingSphere(); }
      else R.setTransform(b.rid, b.pos, _q, 0, 0, LIGHTS);
      // wake astern, as long as the boat makes way
      if (b.v > 0.3 && w < 16) {
        const k = Math.min(1, b.v / 4), f = k * (1 - 0.75 * night);
        _p.set(b.pos.x + Math.sin(b.yaw) * b.len * 0.45, WATER_LEVEL + 0.1, b.pos.z + Math.cos(b.yaw) * b.len * 0.45);
        this.wakes.setMatrixAt(w, _m.compose(_p, _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, b.yaw), _s.set(b.len * (1.2 + 1.6 * k), 1, b.len * (1.6 + 2.2 * k))));
        this.wakes.setColorAt(w++, _c.setRGB(f, f, f));
      }
    }
    this.wakes.count = w;
    this.wakes.instanceMatrix.needsUpdate = true; if (this.wakes.instanceColor) this.wakes.instanceColor.needsUpdate = true;
  }
}
