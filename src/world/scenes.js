// Living-city "scenes": posed crowds + props that appear at the right place and time.
//  - Satay Street: Boon Tat Street beside Lau Pa Sat closes to traffic 19:00–02:00, fills with tables, smoking grills, diners
//  - Merlion: tourists taking photos, all day
//  - Supertree Grove: crowds for Garden Rhapsody (19:45 / 20:45)
//  - Raffles Place: office lunch crowd 12:00–14:00
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U } from '../gfx/globals.js';

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
    if (merlion) this.list.push({ id: 'merlion', c: new THREE.Vector3(merlion.x, 0, merlion.z), window: [7, 23], gen: () => this.ring(merlion, 9, 22, 22, ['idle_phone', 'idle_phone', 'wave', 'idle', 'cheer'], 'tourist') });
    const st = poi('supertrees');
    if (st) {
      const show = t => inWindow(t, 19.6, 20.08) || inWindow(t, 20.6, 21.08);
      this.list.push({ id: 'rhapsody', c: new THREE.Vector3(st.x, 0, st.z), when: show, gen: () => this.scatter(st, 55, 46, ['idle', 'idle', 'idle_phone', 'clap'], ['tourist', 'male', 'female', 'student']) });
    }
    this.list.push({ id: 'rafflesplace', c: new THREE.Vector3(60, 0, 330), window: [12, 14], gen: () => this.scatter({ x: 60, z: 330 }, 35, 30, ['talk', 'idle_phone', 'sit_eat', 'idle'], ['office_m', 'office_f']) });
    for (const s of this.list) { s.active = false; s.peds = []; }
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
    const lanes = net.lanes.filter(l => l.edge.n === 'Boon Tat Street' && Math.hypot(l.path.p[0][0] - lps.x, l.path.p[0][2] - lps.z) < 260);
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
    const g = this.game, t = g.sky.time, P = g.player.position, peds = g.peds;
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
    if (this.grillMat) this.grillMat.emissiveIntensity = 3 + Math.sin(U.time.value * 7) * 0.8;
    // satay smoke
    if (this.satayGroup?.visible && g.fx && Math.hypot(P.x - 47, P.z - 686) < 200) {
      this.smokeT = (this.smokeT || 0) - dt;
      if (this.smokeT <= 0) { this.smokeT = 0.08; const gr = this.satayGrills[Math.floor(Math.random() * this.satayGrills.length)]; g.fx.grillSmoke((this._sp ||= new THREE.Vector3()).set(gr[0] + (Math.random() - 0.5) * 1.4, 1, gr[1])); }
    }
  }
}
