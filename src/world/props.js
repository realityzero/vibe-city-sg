// Street furniture: LED street lamps (and the baked street-light map the road/ground shaders light themselves with),
// working traffic lights.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U } from '../gfx/globals.js';
import { STREET } from '../gfx/materials.js';
import { REFLECT_LAYER } from './water.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3(), _d = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Street-light map over the whole city (2.5 m/px): ground illuminance summed over every lamp (1 under a lamp head,
// sqrt-encoded over 0..4). Sampled by the road and ground shaders, so pools of light fall where the lamps actually
// stand, on carriageways, footways, plazas and verges alike.
class LightMap {
  constructor(meta, res = 2.5) {
    this.res = res; this.x0 = meta.xmin; this.z0 = meta.zmin;
    this.W = Math.ceil((meta.xmax - meta.xmin) / res); this.H = Math.ceil((meta.zmax - meta.zmin) / res);
    this.e = new Float32Array(this.W * this.H);
  }
  // point light at height ht (m) with relative intensity k: E = k (1 + (r/ht)^2)^-2 (cut-off LED optics)
  add(x, z, ht = 9, k = 1) {
    const { res, W, H, e } = this, R = ht * 2.6, ci = (x - this.x0) / res, cj = (z - this.z0) / res, rp = Math.ceil(R / res);
    const i0 = Math.max(0, Math.floor(ci - rp)), i1 = Math.min(W - 1, Math.ceil(ci + rp)), j0 = Math.max(0, Math.floor(cj - rp)), j1 = Math.min(H - 1, Math.ceil(cj + rp));
    const ih = 1 / (ht * ht);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = (i + 0.5 - ci) * res, dz = (j + 0.5 - cj) * res, q = 1 + (dx * dx + dz * dz) * ih;
      e[j * W + i] += k / (q * q);
    }
  }
  upload() {
    const { W, H, e } = this, px = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) px[i] = Math.round(Math.sqrt(Math.min(1, e[i] / 4)) * 255);
    const tex = this.tex || (this.tex = new THREE.DataTexture(px, W, H, THREE.RedFormat, THREE.UnsignedByteType));
    tex.image.data = px; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true; tex.flipY = false; tex.needsUpdate = true;
    tex.userData.releaseSource = true; // (both uploads happen before the first frame)
    STREET.lamp.value = tex; STREET.lampOrigin.value.set(this.x0, this.z0); STREET.lampSize.value.set(W * this.res, H * this.res);
  }
}

export class Props {
  constructor(game) {
    this.game = game;
    const net = game.roadnet, city = game.city;
    const lamps = [];
    // street lamps along carriageways (both sides, staggered)
    for (const e of net.edges) {
      if (e.c > 5 || e.y) continue;
      const pts = []; for (let i = 0; i < e.p.length; i += 2) pts.push([e.p[i], e.p[i + 1]]);
      let acc = 12;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1]; const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz); if (l < 1) continue;
        const rx = -dz / l, rz = dx / l;
        while (acc < l) {
          const f = acc / l; const side = (lamps.length % 2) ? 1 : -1;
          const x = ax + dx * f + rx * (e.hw + 0.7) * side, z = az + dz * f + rz * (e.hw + 0.7) * side;
          if (!city.isWater(x, z)) lamps.push({ x, z, yaw: Math.atan2(rx * side, rz * side) });
          acc += 34;
        }
        acc -= l;
      }
    }
    this.lamps = lamps;
    // geometry: tapered pole + arm + LED head (open-ended: the caps are never seen)
    const pole = new THREE.CylinderGeometry(0.07, 0.12, 9, 6, 1, true); pole.translate(0, 4.5, 0);
    const arm = new THREE.CylinderGeometry(0.05, 0.05, 2.2, 5, 1, true); arm.rotateX(Math.PI / 2 - 0.15); arm.translate(0, 8.9, -1.0);
    const head = new THREE.BoxGeometry(0.34, 0.12, 0.8); head.translate(0, 9.05, -2.1);
    const lampGeo = mergeGeometries([pole, arm].map(g => g.toNonIndexed()));
    const metal = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.5, metalness: 0.7 });
    // ~10k lamps city-wide: only the ones near the camera are instanced (poles to POLE_R, glowing heads further at night)
    this.lampM = lamps.map(l => { _q.setFromAxisAngle(UP, l.yaw); _p.set(l.x, 0, l.z); return _m.compose(_p, _q, _s).toArray(new Float32Array(16)); });
    this.lampGrid = new Map();
    lamps.forEach((l, i) => { const k = Math.floor(l.x / 100) * 100003 + Math.floor(l.z / 100); let c = this.lampGrid.get(k); if (!c) this.lampGrid.set(k, c = []); c.push(i); });
    this.lampMesh = new THREE.InstancedMesh(lampGeo, metal, Math.min(lamps.length, 2400));
    this.headMat = new THREE.MeshStandardMaterial({ color: 0x444444, emissive: 0xfff0dc, emissiveIntensity: 0, roughness: 0.4 });
    this.headMesh = new THREE.InstancedMesh(head, this.headMat, Math.min(lamps.length, 6000));
    this.lampMesh.castShadow = false; // thin poles: their shadows cost far more than they're worth
    for (const m of [this.lampMesh, this.headMesh]) { m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); game.scene.add(m); }
    this.headMesh.layers.enable(REFLECT_LAYER); // glowing heads show (as streaks) in wet roads and the bay
    this.lampAt = new THREE.Vector3(1e9, 0, 0); this.lampNight = -1;
    // street-light map: every lamp head (arm reaches 2.1 m over the road), plus brighter junction lighting
    this.light = new LightMap(city.meta);
    for (const l of lamps) this.light.add(l.x - Math.sin(l.yaw) * 2.1, l.z - Math.cos(l.yaw) * 2.1, 9, 1);
    for (const n of net.nodes) if (n.degree >= 3 && n.maxHalfW >= 5) this.light.add(n.x, n.z, 12, n.signal ? 0.5 : 0.3);

    // traffic lights at signalised junctions, SG style: a kerb pole at the stop line with a black three-aspect head
    // (visors, backplate) facing the approaching traffic and a red/green-man pedestrian head facing across the road;
    // wide approaches get an L-shaped mast with a second head hung over the lanes
    const tl = [];
    for (const n of net.nodes) {
      if (!n.signal) continue;
      for (const l of n.inc) {
        if (l.idx !== 0) continue; // one installation per approach, on the kerb (left) side
        l.path.sample(l.s1, _p, _d);
        const rx = -_d.z, rz = _d.x; // right of travel
        const x = _p.x - rx * 2.45, z = _p.z - rz * 2.45; // 0.5 m behind the kerb
        const mast = l.nLanes >= 2 && l.edge.hw >= 6;
        tl.push({ lane: l, x, z, f: Math.atan2(-_d.x, -_d.z), mast, reach: mast ? Math.min(l.nLanes * 3.3 - 0.4, 8.5) : 0 });
      }
    }
    this.tl = tl;
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3f43, roughness: 0.55, metalness: 0.5 });
    const black = 0x16181a;
    const tbox = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
    // head (origin at its centre, lenses facing +z): housing, backplate, a hood over each lens, mounting bracket
    const headParts = [tbox(0.34, 0.98, 0.26, 0, 0, 0), tbox(0.58, 1.18, 0.025, 0, 0, -0.14), tbox(0.1, 0.12, 0.2, 0, 0, -0.24)];
    for (const y of [0.31, 0, -0.31]) headParts.push(tbox(0.3, 0.02, 0.2, 0, y + 0.13, 0.23), tbox(0.02, 0.17, 0.2, -0.145, y + 0.05, 0.23), tbox(0.02, 0.17, 0.2, 0.145, y + 0.05, 0.23));
    const headGeo = mergeGeometries(headParts);
    const headMat = new THREE.MeshStandardMaterial({ color: black, roughness: 0.5, metalness: 0.2 });
    const tPoleG = new THREE.CylinderGeometry(0.085, 0.1, 1, 8, 1, true).translate(0, 0.5, 0);
    const tArmG = new THREE.CylinderGeometry(0.06, 0.07, 1, 6, 1, true).rotateZ(Math.PI / 2).translate(0.5, 0, 0);
    const pedGeo = mergeGeometries([tbox(0.3, 0.62, 0.2, 0, 0, 0), tbox(0.28, 0.02, 0.14, 0, 0.16, 0.16), tbox(0.28, 0.02, 0.14, 0, -0.14, 0.16)]);
    const mk = (geo, mat, cap) => { const m = new THREE.InstancedMesh(geo, mat, Math.max(1, cap)); m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); game.scene.add(m); return m; };
    const nMast = tl.filter(t => t.mast).length;
    this.tlPole = mk(tPoleG, steel, tl.length); this.tlArm = mk(tArmG, steel, nMast);
    this.tlHead = mk(headGeo, headMat, tl.length + nMast); this.tlPed = mk(pedGeo, headMat, tl.length);
    const lampG = new THREE.CircleGeometry(0.105, 12);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true });
    this.tlLamps = [];
    const cols = [0xff2a1a, 0xffb21a, 0x2aff6a];
    for (let k = 0; k < 3; k++) {
      const m = mk(lampG.clone().translate(0, 0.31 - k * 0.31, 0.135), lampMat, tl.length + nMast);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, tl.length + nMast) * 3), 3);
      this.tlLamps.push({ m, col: new THREE.Color(cols[k]) });
    }
    // pedestrian aspects: standing red man (top), walking green man (bottom)
    const pc = document.createElement('canvas'); pc.width = 128; pc.height = 64; const g = pc.getContext('2d');
    const man = (ox, walk) => {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(ox + 32, 12, 6, 0, 7); g.fill();
      g.lineCap = 'round'; g.strokeStyle = '#fff'; g.lineWidth = 7;
      const ln = (a, b, c, d) => { g.beginPath(); g.moveTo(ox + a, b); g.lineTo(ox + c, d); g.stroke(); };
      ln(32, 22, 32, 40);
      if (walk) { ln(32, 40, 22, 56); ln(32, 40, 42, 55); ln(32, 25, 22, 36); ln(32, 25, 42, 34); } else { ln(29, 40, 28, 57); ln(35, 40, 36, 57); ln(30, 25, 26, 40); ln(34, 25, 38, 40); }
    };
    man(0, false); man(64, true);
    const pTex = new THREE.CanvasTexture(pc); pTex.colorSpace = THREE.SRGBColorSpace;
    const panel = (u0, y) => { const q = new THREE.PlaneGeometry(0.22, 0.22).translate(0, y, 0.105); const uv = q.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * 0.5); return q; };
    const pedMat = new THREE.MeshBasicMaterial({ map: pTex, alphaTest: 0.4, toneMapped: true });
    this.tlPedLamps = [{ m: mk(panel(0, 0.15), pedMat, tl.length), col: new THREE.Color(0xff3020) }, { m: mk(panel(0.5, -0.15), pedMat, tl.length), col: new THREE.Color(0x30ff80) }];
    for (const L of this.tlPedLamps) L.m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, tl.length) * 3), 3);
    // per-installation matrices (face oncoming traffic: local +z towards the approaching cars, local +x over the lanes)
    const comp = (x, y, z, yaw, sx = 1, sy = 1, sz = 1) => { _q.setFromAxisAngle(UP, yaw); return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)).toArray(new Float32Array(16)); };
    for (const t of tl) {
      const cx = Math.cos(t.f), sx = -Math.sin(t.f); // local +x in world (right of travel)
      const fx = Math.sin(t.f), fz = Math.cos(t.f);
      t.pole = comp(t.x, 0, t.z, t.f, 1, t.mast ? 6.6 : 4.4, 1);
      t.heads = [comp(t.x + fx * 0.22, 3.25, t.z + fz * 0.22, t.f)];
      if (t.mast) { t.arm = comp(t.x, 6.3, t.z, t.f, t.reach, 1, 1); t.heads.push(comp(t.x + cx * t.reach * 0.92 + fx * 0.1, 5.75, t.z + sx * t.reach * 0.92 + fz * 0.1, t.f)); }
      t.ped = comp(t.x + cx * 0.2, 2.35, t.z + sx * 0.2, t.f + Math.PI / 2); // faces across the road (+x)
    }
    _s.set(1, 1, 1);
    this.tlNear = []; this.tlHeads = []; // near installations, and their heads (lamp instances follow tlHeads)
    this.tlT = 0;
    this.light.upload(); // StreetDetail adds its linkway/bridge lights and uploads again
  }

  // refill the lamp instances around the camera (poles near, heads further out once they glow)
  refreshLamps(cam, night) {
    const POLE_R = 650, HEAD_R = night ? 1800 : POLE_R;
    const pa = this.lampMesh.instanceMatrix.array, ha = this.headMesh.instanceMatrix.array, capP = this.lampMesh.instanceMatrix.count, capH = this.headMesh.instanceMatrix.count;
    let np = 0, nh = 0;
    const c0x = Math.floor((cam.x - HEAD_R) / 100), c1x = Math.floor((cam.x + HEAD_R) / 100), c0z = Math.floor((cam.z - HEAD_R) / 100), c1z = Math.floor((cam.z + HEAD_R) / 100);
    for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const cell = this.lampGrid.get(cx * 100003 + cz); if (!cell) continue;
      for (const i of cell) {
        const l = this.lamps[i], d2 = (l.x - cam.x) ** 2 + (l.z - cam.z) ** 2;
        if (d2 < POLE_R * POLE_R && np < capP) pa.set(this.lampM[i], 16 * np++);
        if (d2 < HEAD_R * HEAD_R && nh < capH) ha.set(this.lampM[i], 16 * nh++);
      }
    }
    // traffic lights within 450 m
    const near = this.tlNear, heads = this.tlHeads; near.length = 0; heads.length = 0;
    let na = 0;
    for (const t of this.tl) {
      if ((t.x - cam.x) ** 2 + (t.z - cam.z) ** 2 > 450 * 450) continue;
      const i = near.length; near.push(t);
      this.tlPole.instanceMatrix.array.set(t.pole, i * 16); this.tlPed.instanceMatrix.array.set(t.ped, i * 16);
      for (const L of this.tlPedLamps) L.m.instanceMatrix.array.set(t.ped, i * 16);
      if (t.arm) this.tlArm.instanceMatrix.array.set(t.arm, 16 * na++);
      for (const h of t.heads) { const j = heads.length; heads.push(t); this.tlHead.instanceMatrix.array.set(h, j * 16); for (const L of this.tlLamps) L.m.instanceMatrix.array.set(h, j * 16); }
    }
    const sets = [[this.lampMesh, np], [this.headMesh, nh], [this.tlPole, near.length], [this.tlPed, near.length], [this.tlArm, na], [this.tlHead, heads.length],
      ...this.tlLamps.map(L => [L.m, heads.length]), ...this.tlPedLamps.map(L => [L.m, near.length])];
    for (const [m, n] of sets) { m.count = n; const a = m.instanceMatrix; a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(16, n * 16)); a.needsUpdate = true; }
    this.tlT = 0; // recolour the new set right away
    this.lampAt.copy(cam); this.lampNight = night;
  }

  update(dt) {
    const night = U.night.value;
    this.headMat.emissiveIntensity = night * 5;
    const cam = this.game.camera.position;
    const lit = night > 0.2;
    if (Math.hypot(cam.x - this.lampAt.x, cam.z - this.lampAt.z) > 40 || lit !== this.lampNight) this.refreshLamps(cam, lit);
    // traffic light states
    this.tlT -= dt;
    if (this.tlT <= 0) {
      this.tlT = 0.2;
      const net = this.game.roadnet;
      const dim = 0.06;
      this.tlHeads.forEach((t, i) => {
        const st = net.signalFor(t.lane);
        const on = st === 'red' ? 0 : st === 'amber' ? 1 : 2;
        this.tlLamps.forEach((L, k) => { const c = L.col, f = k === on ? 4 : dim; L.m.instanceColor.setXYZ(i, c.r * f, c.g * f, c.b * f); });
      });
      // pedestrians crossing this approach walk while its traffic is held (the green man blinks out the last seconds)
      this.tlNear.forEach((t, i) => {
        const sg = net.nodes[t.lane.to].signal, local = net.allGreen ? 0 : (t.lane.phase || 0) === 0 ? sg.t : (sg.t + 23) % 46; // roadnet's 46 s cycle
        const walk = local >= 22 && local < 45;
        const [R, G] = this.tlPedLamps, blink = walk && local >= 39 && (U.time.value % 0.8) < 0.4;
        R.m.instanceColor.setXYZ(i, ...(walk ? [R.col.r * dim, R.col.g * dim, R.col.b * dim] : [R.col.r * 3, R.col.g * 3, R.col.b * 3]));
        G.m.instanceColor.setXYZ(i, ...(walk && !blink ? [G.col.r * 3, G.col.g * 3, G.col.b * 3] : [G.col.r * dim, G.col.g * dim, G.col.b * dim]));
      });
      for (const L of this.tlLamps) { const a = L.m.instanceColor; a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(3, this.tlHeads.length * 3)); a.needsUpdate = true; }
      for (const L of this.tlPedLamps) { const a = L.m.instanceColor; a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(3, this.tlNear.length * 3)); a.needsUpdate = true; }
    }
  }
}
