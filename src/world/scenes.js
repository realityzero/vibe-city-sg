// Living-city "scenes": posed crowds + props that appear at the right place and time.
//  - Satay Street: Boon Tat Street beside Lau Pa Sat closes to traffic 19:00–02:00, fills with tables, smoking grills, diners
//  - Merlion: tourists taking photos, all day
//  - Supertree Grove: crowds for Garden Rhapsody (19:45 / 20:45)
//  - Raffles Place: office lunch crowd 12:00–14:00
//  - Seating: people at the tables the city builder set out (hawker centres, kopitiams, void-deck chess tables, wakes and
//    weddings) and behind the hawker stalls, with the queue at each centre's famous stall
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U } from '../gfx/globals.js';
import { KINDS, SEATS, CHOPE } from './streetpieces.js';

const inWindow = (t, a, b) => (a <= b ? t >= a && t < b : t >= a || t < b);
const col = (geo, hex) => { const g = geo.index ? geo.toNonIndexed() : geo; const c = new THREE.Color(hex); const a = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g; };

export class Scenes {
  constructor(game) {
    this.game = game;
    this.list = [];
    const L = game.landmarks?.pois || [];
    const poi = id => L.find(p => p.id === id);
    this.buildSatay();
    const merlion = poi('merlion');
    if (merlion) this.list.push({ id: 'merlion', c: new THREE.Vector3(merlion.x, 0, merlion.z), window: [7, 23], gen: () => this.ring(merlion, 9, 22, 22, ['film', 'film', 'idle_phone', 'wave', 'idle', 'cheer'], 'tourist') });
    const st = poi('supertrees');
    if (st) {
      const show = t => inWindow(t, 19.6, 20.08) || inWindow(t, 20.6, 21.08);
      this.list.push({ id: 'rhapsody', c: new THREE.Vector3(st.x, 0, st.z), when: show, gen: () => this.scatter(st, 55, 46, ['idle', 'idle', 'idle_phone', 'clap'], ['tourist', 'male', 'female', 'student']) });
    }
    this.list.push({ id: 'rafflesplace', c: new THREE.Vector3(60, 0, 330), window: [12, 14], gen: () => this.scatter({ x: 60, z: 330 }, 35, 30, ['talk', 'idle_phone', 'sit_eat', 'idle'], ['office_m', 'office_f']) });
    for (const s of this.list) { s.active = false; s.peds = []; }
    this.seating = new Seating(game);
  }

  // ---------------------------------------------------------------- generators
  free(x, z) { const c = this.game.city; return !c.isWater(x, z) && c.maskAt(x, z, 2) > 100 || (!c.isWater(x, z) && c.maskAt(x, z, 1) > 200); }
  ring(center, r0, r1, n, anims, variant) {
    const out = [];
    for (let i = 0, tries = 0; out.length < n && tries < 400; tries++) {
      const a = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      if (this.game.city.isWater(x, z)) continue;
      out.push({ x, z, yaw: Math.atan2(-(center.x - x), -(center.z - z)) + (Math.random() - 0.5) * 0.4, anim: anims[Math.floor(Math.random() * anims.length)], variant });
    }
    return out;
  }
  scatter(center, r, n, anims, variants) {
    const out = [];
    for (let tries = 0; out.length < n && tries < 500; tries++) {
      const x = center.x + (Math.random() - 0.5) * 2 * r, z = center.z + (Math.random() - 0.5) * 2 * r;
      if (this.game.city.isWater(x, z)) continue;
      if (this.game.physics.raycast({ x, y: 30, z }, { x: 0, y: -1, z: 0 }, 40)?.point.y > 0.6) continue; // not inside buildings
      out.push({ x, z, yaw: Math.random() * Math.PI * 2, anim: anims[Math.floor(Math.random() * anims.length)], variant: variants[Math.floor(Math.random() * variants.length)] });
    }
    return out;
  }

  buildSatay() {
    const g = this.game, net = g.roadnet;
    const lps = { x: 167, z: 706 };
    const lanes = net.lanes.filter(l => l.edge.n === 'Boon Tat Street' && Math.hypot(l.path.x(0) - lps.x, l.path.z(0) - lps.z) < 260);
    if (!lanes.length) return;
    this.satayLanes = lanes;
    // tables along the street centreline, stalls with grills along one kerb
    const tables = [], grills = [];
    const seen = new Set();
    for (const l of lanes) {
      const e = l.edge; if (seen.has(e)) continue; seen.add(e);
      const pts = []; for (let i = 0; i < e.p.length; i += 2) pts.push([e.p[i], e.p[i + 1]]);
      let acc = 3;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1]; const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz); if (len < 1) continue;
        const rx = -dz / len, rz = dx / len;
        while (acc < len) {
          const f = acc / len, cx = ax + dx * f, cz = az + dz * f;
          for (const off of [-1.6, 1.6]) tables.push([cx + rx * off, cz + rz * off]);
          if (Math.random() < 0.5) grills.push([cx + rx * (e.hw - 0.8), cz + rz * (e.hw - 0.8), Math.atan2(rx, rz)]);
          acc += 3.4;
        }
        acc -= len;
      }
    }
    this.satayTables = tables; this.satayGrills = grills;
    // instanced props
    const table = mergeGeometries([col(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 16).translate(0, 0.74, 0), 0xe8e4dc), col(new THREE.CylinderGeometry(0.05, 0.05, 0.72, 6).translate(0, 0.36, 0), 0x777777)]);
    const stool = col(new THREE.CylinderGeometry(0.18, 0.15, 0.45, 10).translate(0, 0.225, 0), 0xd83a3a);
    const grill = mergeGeometries([col(new THREE.BoxGeometry(1.8, 0.85, 0.6).translate(0, 0.425, 0), 0x3a3a3a), col(new THREE.BoxGeometry(2.2, 0.08, 1.3).translate(0, 2.3, -0.2), 0xd8d0c0), col(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 5).translate(-1, 1.15, -0.7), 0x888888), col(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 5).translate(1, 1.15, -0.7), 0x888888)]);
    const coals = col(new THREE.BoxGeometry(1.7, 0.05, 0.5).translate(0, 0.875, 0), 0x2a0a00);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    this.grillMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: 0xff5a10, emissiveIntensity: 0 });
    const tIM = new THREE.InstancedMesh(table, mat, tables.length), sIM = new THREE.InstancedMesh(stool, mat, tables.length * 4), gIM = new THREE.InstancedMesh(grill, mat, grills.length), cIM = new THREE.InstancedMesh(coals, this.grillMat, grills.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    tables.forEach(([x, z], i) => {
      tIM.setMatrixAt(i, m.compose(p.set(x, 0.05, z), q.identity(), one));
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.3; sIM.setMatrixAt(i * 4 + k, m.compose(p.set(x + Math.cos(a) * 0.85, 0.05, z + Math.sin(a) * 0.85), q.identity(), one)); }
    });
    grills.forEach(([x, z, yaw], i) => { m.compose(p.set(x, 0.05, z), q.setFromAxisAngle(up, yaw), one); gIM.setMatrixAt(i, m); cIM.setMatrixAt(i, m); });
    this.satayGroup = new THREE.Group(); this.satayGroup.add(tIM, sIM, gIM, cIM); this.satayGroup.visible = false;
    for (const o of [tIM, sIM, gIM]) { o.castShadow = true; o.receiveShadow = true; }
    g.scene.add(this.satayGroup);
    this.list.push({
      id: 'satay', c: new THREE.Vector3(lps.x - 120, 0, lps.z - 20), window: [19, 2], props: this.satayGroup,
      gen: () => {
        const out = [];
        tables.forEach(([x, z], i) => { for (let k = 0; k < 4; k++) if (Math.random() < 0.55) { const a = k * Math.PI / 2 + 0.3; out.push({ x: x + Math.cos(a) * 0.85, z: z + Math.sin(a) * 0.85, yaw: Math.atan2(Math.cos(a), Math.sin(a)), anim: 'sit_eat', variant: ['office_m', 'office_f', 'tourist', 'male', 'female', 'uncle'][Math.floor(Math.random() * 6)], y: 0.05 }); } });
        grills.forEach(([x, z, yaw]) => out.push({ x: x - Math.sin(yaw) * 0.9, z: z - Math.cos(yaw) * 0.9, yaw: yaw + Math.PI, anim: 'talk', variant: 'uncle' }));
        return out.slice(0, 110);
      },
    });
  }

  // ---------------------------------------------------------------- runtime
  update(dt) {
    const g = this.game, t = g.sky.time, peds = g.peds, P = peds.viewer; // around the camera, like the rest of the crowd
    for (const s of this.list) {
      const timeOk = s.when ? s.when(t) : inWindow(t, s.window[0], s.window[1]);
      const near = Math.hypot(P.x - s.c.x, P.z - s.c.z) < 220;
      if (s.props) s.props.visible = timeOk;
      if (s.id === 'satay' && this.satayLanes) for (const l of this.satayLanes) l.closed = timeOk;
      const want = timeOk && near;
      if (want && !s.active) {
        s.active = true;
        s.peds = s.gen().map(d => peds.addPose(d)).filter(Boolean);
      } else if (!want && s.active) {
        s.active = false;
        for (const p of s.peds) { const i = peds.peds.indexOf(p); if (i >= 0) peds.peds.splice(i, 1); }
        s.peds = [];
      }
    }
    this.seating.update(dt);
    if (this.grillMat) this.grillMat.emissiveIntensity = 3 + Math.sin(U.time.value * 7) * 0.8;
    // satay smoke
    if (this.satayGroup?.visible && g.fx && Math.hypot(P.x - 47, P.z - 686) < 200) {
      this.smokeT = (this.smokeT || 0) - dt;
      if (this.smokeT <= 0) { this.smokeT = 0.08; const gr = this.satayGrills[Math.floor(Math.random() * this.satayGrills.length)]; g.fx.grillSmoke((this._sp ||= new THREE.Vector3()).set(gr[0] + (Math.random() - 0.5) * 1.4, 1, gr[1])); }
    }
  }
}

// ---------------------------------------------------------------- seating
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const bump = (t, a, b, ramp = 0.75) => smooth(a - ramp, a + 0.25, t) * (1 - smooth(b - 0.25, b + 0.75, t));
// how busy the tables are: breakfast, the lunch crush (filling from before eleven), dinner (0..1)
const meals = t => Math.max(0.55 * bump(t, 7, 9), bump(t, 11.5, 14, 1.25), 0.9 * bump(t, 18, 21));
// share of hawker stalls trading at an hour: a stall is open while its seed is below it (materials.js lights the
// boards with the same rule: shopOpenFrac with early = 1)
const stallsOpen = t => 0.025 + 0.925 * smooth(5.4, 7.8, t) * (1 - smooth(21.2, 23.5, t));
const yawTo = (dx, dz) => Math.atan2(-dx, -dz); // crowd yaw facing along (dx, dz)
const CELL = 24, NEAR = 14, HALL_FLOOR = 0.12;

/**
 * People at the tables the city builder set out and behind the hawker stalls, around the camera. A table (or stall)
 * fills when it comes within reach ahead of the camera (or right beside it), out of sight where its people would pop
 * in, and empties once it has fallen behind, unseen; how many sit depends on the hour. They are posed members of the
 * instanced crowd: no draw calls of their own.
 */
class Seating {
  constructor(game) {
    const fur = game.city.furniture || {}, F = this.F = fur.pieces || new Float32Array(0), S = this.S = fur.stalls || new Float32Array(0);
    this.game = game;
    const kind = Object.fromEntries(KINDS.map((k, i) => [k, i]));
    this.kind = { [kind.kopitiam]: 'kopitiam', [kind.hawkerTable]: 'hawkerTable', [kind.stoneTable]: 'stoneTable', [kind.tent]: 'tent' };
    // tables (piece index) and stalls (-1 - stall index) by cell
    this.grid = new Map();
    const add = (x, z, id) => { const k = Math.floor(x / CELL) * 100003 + Math.floor(z / CELL); let a = this.grid.get(k); if (!a) this.grid.set(k, a = []); a.push(id); };
    for (let i = 0; i < F.length / 6; i++) if (this.kind[F[i * 6]]) add(F[i * 6 + 1], F[i * 6 + 3], i);
    for (let i = 0; i < S.length / 5; i++) add(S[i * 5], S[i * 5 + 1], -1 - i);
    this.active = new Map();   // id -> its people
    this.placed = 0;
    const phone = game.peds.maxWalkers < 100;
    this.budget = phone ? 70 : 110; this.reach = phone ? 55 : 75;
    this.t = 0; this._c = []; this.at = new THREE.Vector3(1e9, 0, 0); this.fresh = false;
  }

  update(dt) {
    const peds = this.game.peds, V = peds.viewer;
    // a camera cut (or a relocation, or any jump faster than a car) starts over: nobody sees the old tables empty or
    // the new ones fill
    const fresh = peds.seeding || Math.hypot(V.x - this.at.x, V.z - this.at.z) > 25;
    if (fresh && !this.fresh) for (const id of [...this.active.keys()]) this._release(id);
    this.fresh = fresh; this.at.copy(V);
    if ((this.t -= dt) > 0 && !fresh) return;
    this.t = 0.3;
    const f = peds._fwd, half = peds.hfov / 2 + 0.35, R = this.reach, t = this.game.sky.time;
    const cand = this._c; cand.length = 0;
    for (let gx = Math.floor((V.x - R) / CELL); gx <= Math.floor((V.x + R) / CELL); gx++)
      for (let gz = Math.floor((V.z - R) / CELL); gz <= Math.floor((V.z + R) / CELL); gz++) {
        const a = this.grid.get(gx * 100003 + gz); if (!a) continue;
        for (const id of a) {
          const dx = this._x(id) - V.x, dz = this._z(id) - V.z, d = Math.hypot(dx, dz);
          // ahead (the view cone and a margin, so a slow pan finds its tables already taken) or right beside the camera
          if (d < R && (d < NEAR || Math.abs(Math.atan2(dx * f.y - dz * f.x, dx * f.x + dz * f.y)) < half)) cand.push(d, id);
        }
      }
    const want = new Set();
    for (let k = 1; k < cand.length; k += 2) want.add(cand[k]);
    // let go of what fell behind, once nobody can see it go
    for (const [id, people] of this.active) if (!want.has(id) && !this._seen(people, V, peds)) this._release(id);
    // fill the nearest new ones, within the budget (in plain sight only beyond the pop-in distance); when it's spent,
    // a nearer table takes the people of the farthest one nobody is looking at
    const order = []; for (let k = 0; k < cand.length; k += 2) if (!this.active.has(cand[k + 1])) order.push(k);
    order.sort((a, b) => cand[a] - cand[b]);
    for (const k of order) {
      const d = cand[k], id = cand[k + 1], x = this._x(id), z = this._z(id);
      if (!fresh && d < peds.popDist && peds.inView(x, 0, z, 1.6)) continue;
      if (this.placed >= this.budget && !this._evict(d, V, peds)) break;
      const people = (id >= 0 ? this._table(id, t) : this._stall(-1 - id, t)).map(o => peds.addPose(o)).filter(Boolean);
      this.active.set(id, people); this.placed += people.length;
    }
  }

  // whoever's about at that hour, though few delivery riders sit down to eat (they collect and go)
  _diner(x, z, t) { const v = this.game.peds.pickVariant(x, z, t); return v === 'delivery' && Math.random() < 0.8 ? 'male' : v; }
  _x(id) { return id >= 0 ? this.F[id * 6 + 1] : this.S[(-1 - id) * 5]; }
  _z(id) { return id >= 0 ? this.F[id * 6 + 3] : this.S[(-1 - id) * 5 + 1]; }
  _release(id) {
    const people = this.active.get(id);
    for (const p of people) this.game.peds.remove(p);
    this.placed -= people.length; this.active.delete(id);
  }
  /** make room for a table at distance d: release the farthest unseen one at least 10 m further off */
  _evict(d, V, peds) {
    let far = null, fd = d + 10;
    for (const [id, people] of this.active) {
      const dd = Math.hypot(this._x(id) - V.x, this._z(id) - V.z);
      if (dd > fd && people.length && !this._seen(people, V, peds)) { far = id; fd = dd; }
    }
    if (far === null) return false;
    this._release(far);
    return true;
  }

  _seen(people, V, peds) { const p = people[0]; return !!p && Math.hypot(p.pos.x - V.x, p.pos.z - V.z) < peds.popDist && peds.inView(p.pos.x, p.pos.y, p.pos.z, 1.6); }

  /** who sits at piece i at hour t: [{x, y, z, yaw, anim, variant}] */
  _table(i, t) {
    const F = this.F, o = i * 6, kind = this.kind[F[o]], x = F[o + 1], y = F[o + 2], z = F[o + 3], yaw = F[o + 4], h = F[o + 5];
    const c = Math.cos(yaw), s = Math.sin(yaw), at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    const peds = this.game.peds, out = [], late = smooth(22.5, 23.5, t) + 1 - smooth(5, 6.5, t);
    const seat = (lx, lz, fx, fz, anim, variant) => {
      const [px, pz] = at(lx, lz), [qx, qz] = at(fx, fz);
      out.push({ x: px, y, z: pz, yaw: yawTo(qx - px, qz - pz), anim, variant: variant || this._diner(px, pz, t) });
    };
    const stand = (lx, lz, anim, variant) => { const [px, pz] = at(lx, lz), r = Math.hypot(lx, lz) || 1, [qx, qz] = at(lx * 0.2 / r, lz * 0.2 / r); out.push({ x: px, y, z: pz, yaw: yawTo(qx - px, qz - pz), anim, variant }); };
    if (kind === 'hawkerTable' || kind === 'kopitiam') {
      // hawker centres fill to 40-70% at meal times and never quite empty by day; coffee shops have their morning kopi
      // crowd; both all but empty after closing
      const busy = (kind === 'hawkerTable' ? 0.08 + 0.12 * bump(t, 8, 18) + 0.5 * meals(t) : 0.06 + 0.25 * bump(t, 6.5, 11) + 0.35 * meals(t)) * (1 - 0.85 * Math.min(1, late));
      const chope = kind === 'hawkerTable' ? CHOPE[Math.floor(Math.min(11, h * 12) / 4)] : [];
      SEATS[kind].forEach(([lx, lz], k) => { if (!chope.includes(k) && Math.random() < busy) seat(lx, lz, 0, 0, Math.random() < 0.8 ? 'sit_eat' : 'sit'); });
    } else if (kind === 'stoneTable') {
      if (h >= 0.5 && t > 8 && t < 21.5 && Math.random() < 0.8) {
        // a game of xiangqi: two uncles at the board, a few more standing over them with opinions
        const S4 = SEATS.stoneTable;
        seat(S4[0][0], S4[0][1], 0, 0, 'sit_eat', 'uncle'); seat(S4[2][0], S4[2][1], 0, 0, 'sit', 'uncle');
        const n = 1 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n; k++) { const a = Math.PI / 2 + (k - (n - 1) / 2) * 0.7 + (k % 2) * Math.PI, r = 1.25 + Math.random() * 0.3; stand(Math.cos(a) * r, Math.sin(a) * r, ['argue', 'talk', 'idle'][k % 3], 'uncle'); }
      } else if (Math.random() < 0.45 * (1 - late)) SEATS.stoneTable.forEach(([lx, lz], k) => { if (k % 2 === 0 && Math.random() < 0.6) seat(lx, lz, 0, 0, Math.random() < 0.5 ? 'sit' : 'sit_eat'); });
    } else if (kind === 'tent') {
      // a wake gathers in the evening, a wedding over lunch and dinner
      const wed = h >= 0.5, busy = wed ? 0.65 * Math.max(bump(t, 11.5, 15), bump(t, 18.5, 22)) : 0.15 + 0.35 * bump(t, 17, 23.5);
      for (const [lx, lz, fx, fz] of SEATS.tent[wed ? 1 : 0]) if (Math.random() < busy) seat(lx, lz, fx, fz, wed ? 'sit_eat' : 'sit', wed ? (Math.random() < 0.5 ? 'female' : 'male') : null);
    }
    return out;
  }

  /** the hawker behind stall i's counter while it trades, and the queue at a centre's famous stall */
  _stall(i, t) {
    const S = this.S, o = i * 5, x = S[o], z = S[o + 1], yaw = S[o + 2], famous = S[o + 3] > 0.5, seed = S[o + 4];
    if (seed > stallsOpen(t)) return [];
    const c = Math.cos(yaw), s = Math.sin(yaw), at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    const out = [], face = yawTo(s, c), back = yawTo(-s, -c);
    const add = (lx, lz, yw, anim, variant) => { const [px, pz] = at(lx, lz); out.push({ x: px, y: HALL_FLOOR, z: pz, yaw: yw, anim, variant }); };
    add(-0.3 + seed * 0.6, -1.05, face, seed < 0.6 ? 'talk' : 'idle', 'hawker');
    if (seed < 0.3) add(0.9, -1.9, face + 0.6, 'idle', 'hawker');
    if (famous) {
      // the queue for the famous one: out into the aisle, everyone checking their phone
      const n = Math.round(1 + 4 * meals(t) + Math.random());
      for (let k = 0; k < n; k++) add(0.4 + (Math.random() - 0.5) * 0.2, 0.75 + k * 0.62, back + (Math.random() - 0.5) * 0.4, Math.random() < 0.6 ? 'idle_phone' : 'idle', this.game.peds.pickVariant(x, z, t));
    }
    return out;
  }
}
