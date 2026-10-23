// Street dressing: Chinatown red lantern strings across the shophouse streets, bus shelters at every OSM bus stop
// (with glowing ad panels at night), all instanced.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U } from '../gfx/globals.js';

const CHINATOWN = /^(Pagoda Street|Temple Street|Smith Street|Trengganu Street|Sago Street|Mosque Street|Erskine Road|Club Street|Ann Siang Road|Keong Saik Road|Bukit Pasoh Road)$/;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();

// instances kept only between r0 and `radius` from the camera (refilled when the camera has moved); several meshes
// can share one set (same transforms)
class NearSet {
  constructor(meshes, radius, r0 = 0) { this.meshes = meshes; this.radius = radius; this.r0 = r0; this.x = []; this.z = []; this.m = []; this.at = new THREE.Vector3(1e9, 0, 0); for (const im of meshes) { im.count = 0; im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); } }
  add(x, z, m) { this.x.push(x); this.z.push(z); this.m.push(m.toArray(new Float32Array(16))); }
  refresh(cam) {
    if (Math.hypot(cam.x - this.at.x, cam.z - this.at.z) < 25) return;
    this.at.copy(cam);
    const R2 = this.radius * this.radius, r2 = this.r0 * this.r0; let n = 0;
    const arrs = this.meshes.map(im => im.instanceMatrix.array);
    for (let i = 0; i < this.x.length; i++) { const d2 = (this.x[i] - cam.x) ** 2 + (this.z[i] - cam.z) ** 2; if (d2 < R2 && d2 >= r2) { for (const a of arrs) a.set(this.m[i], n * 16); n++; } }
    for (const im of this.meshes) { im.count = n; const a = im.instanceMatrix; a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(16, n * 16)); a.needsUpdate = true; }
  }
}

function colorGeo(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo; const c = new THREE.Color(hex);
  const a = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g;
}
function adTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512; const g = c.getContext('2d');
  const ads = [['#ff3fa4', 'KOPI.AI', 'knows your order\nbefore you do'], ['#2fe6ff', 'CHOPECHAIN', 'tissue packets\nare over'], ['#ffd23f', 'DURIANDASH', '15 min. by drone.\nsorry neighbours'], ['#7dff6a', 'WEHUSTLE', 'hot desks\ncold brew'], ['#ff6a3d', 'SNATCH', 'rides. food.\nvibes.']];
  const [col, title, sub] = ads[Math.floor(Math.random() * ads.length)];
  const gr = g.createLinearGradient(0, 0, 0, 512); gr.addColorStop(0, '#120822'); gr.addColorStop(1, col); g.fillStyle = gr; g.fillRect(0, 0, 256, 512);
  g.fillStyle = '#fff'; g.font = 'bold 40px Arial'; g.textAlign = 'center'; g.fillText(title, 128, 120);
  g.font = '22px Arial'; sub.split('\n').forEach((l, i) => g.fillText(l, 128, 170 + i * 30));
  g.strokeStyle = col; g.lineWidth = 8; g.strokeRect(8, 8, 240, 496);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// expressway direction signs (green, white text, route shields)
const XWAY = {
  'Ayer Rajah Expressway': [['AYE', 'Jurong · Tuas · Keppel'], ['AYE', 'City · Marina Coastal Expy']],
  'Central Expressway': [['CTE', 'Ang Mo Kio · Seletar Expy'], ['CTE', 'Chinatown · Outram']],
  'East Coast Parkway': [['ECP', 'Changi Airport · Marine Parade'], ['ECP', 'City · Marina Bay']],
  'Marina Coastal Expressway': [['MCE', 'Tuas · Keppel Viaduct'], ['MCE', 'Changi · ECP']],
  'Nicoll Highway': [['', 'Kallang · Stadium'], ['', 'City Hall · Bras Basah']],
  'Kallang Paya Lebar Expressway': [['KPE', 'Tampines · Paya Lebar'], ['KPE', 'City · ECP']],
};
function signTexture(code, text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 192; const g = c.getContext('2d');
  g.fillStyle = '#0b6b3a'; g.fillRect(0, 0, 512, 192);
  g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(8, 8, 496, 176);
  let x = 30;
  if (code) { g.fillStyle = '#fff'; g.fillRect(28, 46, 120, 70); g.fillStyle = '#0b6b3a'; g.font = 'bold 54px Arial'; g.textAlign = 'center'; g.fillText(code, 88, 102); x = 170; }
  g.fillStyle = '#fff'; g.textAlign = 'left'; g.font = 'bold 36px Arial';
  const parts = text.split(' · ');
  parts.forEach((t, i) => g.fillText(t, x, 70 + i * 46));
  g.font = 'bold 44px Arial'; g.fillText('↑', 470, 160);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export class StreetProps {
  constructor(game) {
    this.game = game;
    this.signMats = [];
    this.meshes = [];
    const scene = game.scene, data = game.city.data;
    // ---------------- lantern strings
    const lanterns = [], strings = [];
    for (const r of data.roads) {
      if (!r.n || !CHINATOWN.test(r.n) || r.b) continue;
      const pts = []; for (let i = 0; i < r.p.length; i += 2) pts.push([r.p[i], r.p[i + 1]]);
      const half = r.w / 2 + 3.2;
      let acc = 4;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1]; const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 1) continue;
        const rx = -dz / L, rz = dx / L;
        while (acc < L) {
          const f = acc / L, cx = ax + dx * f, cz = az + dz * f;
          const n = Math.max(4, Math.round(half * 2 / 1.5));
          let prev = null;
          for (let k = 0; k <= n; k++) {
            const t = k / n, off = -half + t * half * 2;
            const y = 6.6 - Math.sin(t * Math.PI) * 0.9;
            const p = new THREE.Vector3(cx + rx * off, y, cz + rz * off);
            if (prev) strings.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
            prev = p;
            if (k > 0 && k < n) lanterns.push(p.x, p.y - 0.45, p.z);
          }
          acc += 7.5;
        }
        acc -= L;
      }
    }
    if (lanterns.length) {
      const body = new THREE.SphereGeometry(0.32, 8, 6); body.scale(1, 1.18, 1);
      const capT = new THREE.CylinderGeometry(0.16, 0.2, 0.08, 8, 1, true); capT.translate(0, 0.38, 0);
      const capB = capT.clone(); capB.translate(0, -0.76, 0);
      const tassel = new THREE.CylinderGeometry(0.03, 0.06, 0.35, 4, 1, true); tassel.translate(0, -0.6, 0);
      const geo = mergeGeometries([colorGeo(body, 0xd4141a), colorGeo(capT, 0xd8a52a), colorGeo(capB, 0xd8a52a), colorGeo(tassel, 0xffcf40)]);
      this.lanternMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, emissive: 0xff1a08, emissiveIntensity: 0.2 });
      const im = new THREE.InstancedMesh(geo, this.lanternMat, lanterns.length / 3);
      // far lanterns (a few pixels): a plain low-poly red ball with the gold rim colour baked in
      const farGeo = colorGeo(new THREE.SphereGeometry(0.34, 5, 4).scale(1, 1.18, 1), 0xd4141a);
      const imFar = new THREE.InstancedMesh(farGeo, this.lanternMat, lanterns.length / 3);
      this.lanternSet = new NearSet([im], 110); this.lanternFar = new NearSet([imFar], 420, 110);
      for (let i = 0; i < lanterns.length / 3; i++) { _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 0.7); _p.set(lanterns[i * 3], lanterns[i * 3 + 1], lanterns[i * 3 + 2]); _m.compose(_p, _q, _s); this.lanternSet.add(_p.x, _p.z, _m); this.lanternFar.add(_p.x, _p.z, _m); }
      imFar.castShadow = false; imFar.receiveShadow = true; scene.add(imFar); this.meshes.push(imFar);
      im.castShadow = false; im.receiveShadow = true;
      scene.add(im);
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(strings, 3));
      const ls = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a1a10 }));
      scene.add(ls);
      this.lanterns = { im, ls, n: lanterns.length / 3 }; this.meshes.push(im, ls);
    }
    // ---------------- bus shelters
    const stops = data.pois.filter(p => p.k === 'bus_stop');
    const placed = [];
    for (const st of stops) {
      const sw = game.roadnet.nearestSidewalk(st.x, st.z, 30);
      if (!sw || sw.dist > 12) continue;
      const yaw = Math.atan2(-sw.dir.x, -sw.dir.z);
      // shelter faces the road
      const facing = Math.atan2(sw.toRoad.x, sw.toRoad.z);
      placed.push({ x: sw.pos.x, z: sw.pos.z, yaw: facing, name: st.n });
    }
    this.stops = placed;
    if (placed.length) {
      const parts = [];
      const roof = new THREE.BoxGeometry(5.2, 0.12, 2.0); roof.translate(0, 2.75, -0.2); parts.push(colorGeo(roof, 0x6d7478));
      for (const x of [-2.4, 2.4]) { const post = new THREE.CylinderGeometry(0.06, 0.06, 2.75, 6); post.translate(x, 1.375, -0.9); parts.push(colorGeo(post, 0x3d4246)); }
      const back = new THREE.BoxGeometry(4.8, 1.9, 0.04); back.translate(0, 1.25, -0.95); parts.push(colorGeo(back, 0x9fb3bd));
      const bench = new THREE.BoxGeometry(3.2, 0.08, 0.45); bench.translate(-0.4, 0.48, -0.65); parts.push(colorGeo(bench, 0x8a6a4a));
      const sign = new THREE.BoxGeometry(0.5, 0.7, 0.05); sign.translate(2.3, 3.2, 0.7); parts.push(colorGeo(sign, 0x1a5e3a));
      const pole = new THREE.CylinderGeometry(0.04, 0.04, 3.2, 5); pole.translate(2.3, 1.6, 0.7); parts.push(colorGeo(pole, 0x5a5f63));
      const geo = mergeGeometries(parts);
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.3 });
      const im = new THREE.InstancedMesh(geo, mat, placed.length);
      const adGeo = new THREE.PlaneGeometry(1.1, 1.75); adGeo.translate(2.0, 1.25, -0.92);
      this.adMat = new THREE.MeshStandardMaterial({ map: adTexture(), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0, roughness: 0.3 });
      this.adMat.emissiveMap = this.adMat.map;
      const ads = new THREE.InstancedMesh(adGeo, this.adMat, placed.length);
      this.shelterSet = new NearSet([im, ads], 600);
      placed.forEach(s => { _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw); _p.set(s.x, 0, s.z); this.shelterSet.add(s.x, s.z, _m.compose(_p, _q, _s)); });
      im.castShadow = true; im.receiveShadow = true;
      scene.add(im, ads);
      this.meshes.push(im, ads);
    }
    this.addGantries();
  }
  addGantries() {
    const g = this.game, scene = g.scene;
    const steel = new THREE.MeshStandardMaterial({ color: 0x8f969c, metalness: 0.7, roughness: 0.45 });
    const placed = [];
    for (const e of g.roadnet.edges) {
      const signs = XWAY[e.n]; if (!signs || e.len < 260 || e.c > 2) continue;
      if (placed.some(p => Math.hypot(p[0] - e.p[0], p[1] - e.p[1]) < 650)) continue;
      const k = Math.floor(e.p.length / 4) * 2; if (k + 3 >= e.p.length) continue;
      const x = e.p[k], z = e.p[k + 1], dx = e.p[k + 2] - x, dz = e.p[k + 3] - z, L = Math.hypot(dx, dz); if (L < 1) continue;
      const y0 = e.y ? e.y[k / 2] : 0;
      const yaw = Math.atan2(-dx / L, -dz / L);
      const hw = e.hw + 0.8;
      const grp = new THREE.Group(); grp.position.set(x, y0, z); grp.rotation.y = yaw;
      for (const sx of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7.2, 0.4), steel); post.position.set(sx * hw, 3.6, 0); grp.add(post); }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.6, 0.5, 0.5), steel); beam.position.y = 6.9; grp.add(beam);
      const [code, text] = signs[e.lf >= e.lb ? 0 : 1];
      const mat = new THREE.MeshStandardMaterial({ map: signTexture(code, text), roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0 });
      mat.emissiveMap = mat.map; this.signMats.push(mat);
      const w = Math.min(hw * 1.6, 9), sign = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.375), mat);
      sign.position.set(0, 6.9, 0.28); sign.rotation.y = 0; grp.add(sign);
      // the sign faces oncoming traffic (towards +z in the gantry frame = behind the direction of travel)
      grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
      scene.add(grp);
      this.meshes.push(grp);
      placed.push([x, z]);
    }
  }

  update() {
    const cam = this.game.camera.position;
    this.lanternSet?.refresh(cam); this.lanternFar?.refresh(cam); this.shelterSet?.refresh(cam);
    if (this.lanterns) this.lanterns.ls.visible = this.lanterns.im.count + this.lanternFar.meshes[0].count > 0;
    const n = U.night.value;
    for (const m of this.signMats) m.emissiveIntensity = 0.05 + n * 0.5;
    if (this.lanternMat) this.lanternMat.emissiveIntensity = 0.12 + n * 1.15;
    if (this.adMat) this.adMat.emissiveIntensity = 0.25 + n * 1.4;
  }
}
