// Heritage & Chinatown landmarks: Lau Pa Sat (octagonal Victorian market + clock tower), Raffles Hotel (white colonial,
// red roofs), Cavenagh & Anderson bridges, Buddha Tooth Relic Temple, Sri Mariamman Temple gopuram.
import {
  THREE, Bucket, materials, facadeMaterial, nightGlowMaterial, extrudeFootprint, ringOf, areaCentroid, signedArea, centroidOf,
  exclusionsForBuildings, rng, strut, tubeAlong, canvasTexture, pointInRing,
} from './common.js';

const LAUPASAT = [[128, 700.1], [135.6, 727.4], [163.1, 742.6], [187.7, 733], [200.7, 711.6], [198.7, 697.4], [196.9, 685], [184.3, 677.5], [171.9, 670], [154.6, 673.7], [142, 676.4], [134.6, 689]];
const BUDDHA = [[-498.5, 609.3], [-557.1, 577.4], [-564.2, 590.3], [-572.3, 605], [-514.1, 636.6], [-512.8, 634.3], [-502.3, 639.9], [-495.7, 627.3], [-489.3, 616.2], [-499.3, 610.7]];
const CAVENAGH = { a: [357.4, 20.4], b: [388.1, 74.3], h: 2.2 };
const ANDERSON = { a: [420.2, -55.2], b: [474.9, -11.5], offsets: [-6.6, 4.6, 15.8], h: 2.2 };

function edgesOf(ring) {
  const r = signedArea(ring) < 0 ? ring.slice().reverse() : ring;
  const out = [];
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length]; const dx = q[0] - p[0], dz = q[1] - p[1]; const l = Math.hypot(dx, dz);
    out.push({ p, q, l, d: [dx / l, dz / l], n: [dz / l, -dx / l] });
  }
  return out;
}
function insetRing(ring, k) { const c = areaCentroid(ring); return ring.map(([x, z]) => [c[0] + (x - c[0]) * k, c[1] + (z - c[1]) * k]); }
/** Hipped roof approximation: shrink the ring towards its centroid while rising. */
function hipRoof(ring, y0, rise, shrink = 0.35, overhang = 1.04) {
  const c = areaCentroid(ring);
  const base = ring.map(([x, z]) => [c[0] + (x - c[0]) * overhang, c[1] + (z - c[1]) * overhang]);
  const top = ring.map(([x, z]) => [c[0] + (x - c[0]) * shrink, c[1] + (z - c[1]) * shrink]);
  const pos = [];
  for (let i = 0; i < base.length; i++) {
    const j = (i + 1) % base.length;
    const a = [base[i][0], y0, base[i][1]], b = [base[j][0], y0, base[j][1]], cc = [top[j][0], y0 + rise, top[j][1]], d = [top[i][0], y0 + rise, top[i][1]];
    pos.push(...a, ...b, ...cc, ...a, ...cc, ...d);
  }
  const tris = THREE.ShapeUtils.triangulateShape(top.map(p => new THREE.Vector2(p[0], p[1])), []);
  for (const t of tris) for (const k of t) pos.push(top[k][0], y0 + rise, top[k][1]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  // make normals point up
  const nn = g.attributes.normal.array, pp = g.attributes.position.array;
  for (let t = 0; t < pp.length / 9; t++) {
    if (nn[t * 9 + 1] < 0) { for (let q = 0; q < 3; q++) { const A = t * 9 + 3 + q, Bq = t * 9 + 6 + q; [pp[A], pp[Bq]] = [pp[Bq], pp[A]]; } }
  }
  g.computeVertexNormals();
  return g;
}

function lauPaSat(B) {
  const M = materials();
  const c = areaCentroid(LAUPASAT);
  const ring = [];
  const R0 = 35;
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + Math.PI / 8 + 0.12; ring.push([c[0] + Math.cos(a) * R0, c[1] + Math.sin(a) * R0]); }
  const wallMat = facadeMaterial({ wall: 0xf1e9d2, glass: 0x2f3a33, cell: [3.4, 6.2], frame: [0.18, 0.08, 0.12], lit: 0.9, seed: 41, warm: 0xffd08a, litIntensity: 1.6, wallRough: 0.7, glassMetal: 0.2, glassRough: 0.6 });
  B.add(wallMat, extrudeFootprint(ring, 0, 6.2));
  B.add(M.roofGrey, hipRoof(ring, 6.2, 4.8, 0.52, 1.06));
  const inner = insetRing(ring, 0.5);
  B.add(wallMat, extrudeFootprint(inner, 10.8, 13.6, { top: false }));
  B.add(M.roofGrey, hipRoof(inner, 13.6, 3.2, 0.32, 1.08));
  // clock tower
  const sh = new THREE.CylinderGeometry(3.4, 3.6, 14, 8); sh.translate(c[0], 21, c[1]); B.add(M.white, sh);
  const belt = new THREE.CylinderGeometry(4.1, 4.1, 0.8, 8); belt.translate(c[0], 25, c[1]); B.add(M.stone, belt);
  const spire = new THREE.ConeGeometry(3.9, 9, 8); spire.translate(c[0], 32.5, c[1]); B.add(M.roofGrey, spire);
  const fin = new THREE.CylinderGeometry(0.08, 0.08, 3, 4); fin.translate(c[0], 38.5, c[1]); B.add(M.darkSteel, fin);
  const face = nightGlowMaterial(0xfff4d8, 2.0, { base: 0xf5f3ea, rough: 0.5, day: 0 });
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + 0.12 + Math.PI / 8;
    const d = new THREE.CircleGeometry(1.5, 20); d.rotateY(-a + Math.PI / 2); d.translate(c[0] + Math.cos(a) * 3.65, 23, c[1] + Math.sin(a) * 3.65);
    B.add(face, d);
  }
  // cast-iron arcade posts around the perimeter
  for (const e of edgesOf(ring)) {
    for (let i = 1; i < 6; i++) {
      const t = i / 6; const g = new THREE.CylinderGeometry(0.22, 0.22, 6.2, 6); g.translate(e.p[0] + e.d[0] * e.l * t + e.n[0] * 0.5, 3.1, e.p[1] + e.d[1] * e.l * t + e.n[1] * 0.5);
      B.add(M.darkSteel, g);
    }
  }
  return c;
}

function raffles(B, city) {
  const M = materials();
  const zone = [[545, -810], [690, -810], [690, -930], [545, -930]];
  const list = city.buildings.filter(b => { const c = centroidOf(ringOf(b)); return pointInRing(c[0], c[1], zone) && b.h <= 22; });
  const wall = facadeMaterial({ wall: 0xf6f3ea, glass: 0x34433b, cell: [3.6, 4.2], frame: [0.26, 0.18, 0.14], lit: 0.75, seed: 51, warm: 0xffe0a8, litIntensity: 1.9, wallRough: 0.6, glassRough: 0.5, glassMetal: 0.1 });
  const roof = new THREE.MeshStandardMaterial({ color: 0xb4502f, roughness: 0.65 });
  for (const b of list) {
    const r = ringOf(b);
    const h = Math.max(9, Math.min(b.h, 14));
    B.add(wall, extrudeFootprint(r, 0, h));
    const area = Math.abs(signedArea(r));
    B.add(roof, hipRoof(r, h, Math.min(5, Math.sqrt(area) * 0.18), 0.55, 1.05));
  }
  return list;
}

function bridges(B, M) {
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.45, metalness: 0.4 });
  // Cavenagh (1869): white suspension chains between cast-iron pylons
  {
    const { a, b, h } = CAVENAGH; const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); const d = [dx / L, dz / L], n = [-d[1], d[0]];
    const deck = t => h * Math.sin(Math.PI * t);
    for (const s of [-1, 1]) {
      const off = s * 3.4;
      const pts = [];
      for (let i = 0; i <= 24; i++) { const t = i / 24; const y = deck(t) + 1.2 + 5.2 * Math.pow(2 * t - 1, 2); pts.push(new THREE.Vector3(a[0] + d[0] * L * t + n[0] * off, y, a[1] + d[1] * L * t + n[1] * off)); }
      B.add(white, tubeAlong(pts, 0.22, 6));
      for (let i = 2; i < 23; i += 2) { const t = i / 24; const p = pts[i]; B.add(white, strut(new THREE.Vector3(p.x, deck(t) + 0.2, p.z), p, 0.05, 4)); }
      for (const t of [0, 1]) {
        const x = a[0] + d[0] * L * t + n[0] * off, z = a[1] + d[1] * L * t + n[1] * off;
        const py = new THREE.BoxGeometry(0.9, 7.2, 0.9); py.translate(x, 3.6, z); B.add(white, py);
        const lamp = new THREE.SphereGeometry(0.4, 10, 8); lamp.translate(x, 7.6, z); B.add(M.warmLight, lamp);
      }
    }
  }
  // Anderson (1910): three steel bowstring arches
  {
    const { a, b, offsets, h } = ANDERSON; const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); const d = [dx / L, dz / L], n = [-d[1], d[0]];
    const deck = t => h * Math.sin(Math.PI * t);
    const steel = new THREE.MeshStandardMaterial({ color: 0xc9ccc8, roughness: 0.5, metalness: 0.6 });
    for (const off of offsets) {
      const P = (t, y) => new THREE.Vector3(a[0] + d[0] * L * t + n[0] * off, y, a[1] + d[1] * L * t + n[1] * off);
      const top = [], bot = [];
      for (let i = 0; i <= 20; i++) { const t = i / 20; top.push(P(t, deck(t) + 0.6 + 9.5 * (1 - Math.pow(2 * t - 1, 2)))); bot.push(P(t, deck(t) + 0.4)); }
      B.add(steel, tubeAlong(top, 0.35, 6)); B.add(steel, tubeAlong(bot, 0.3, 6));
      for (let i = 1; i < 20; i++) { B.add(steel, strut(bot[i], top[i], 0.12, 4)); if (i < 19) B.add(steel, strut(bot[i], top[i + 1], 0.09, 4)); }
    }
  }
}

function buddhaTooth(B) {
  const red = new THREE.MeshStandardMaterial({ color: 0x9e2a22, roughness: 0.6 });
  const tile = new THREE.MeshStandardMaterial({ color: 0x3b3430, roughness: 0.55, metalness: 0.2 });
  const gold = materials().gold;
  const wallMat = facadeMaterial({ wall: 0xa8332a, glass: 0x2c1f1a, cell: [3.2, 3.6], frame: [0.25, 0.2, 0.15], lit: 0.8, seed: 61, warm: 0xffb060, litIntensity: 2.2, wallRough: 0.6, glassMetal: 0.1, glassRough: 0.6 });
  const levels = [[0, 7.5, 1.0], [7.5, 6.0, 0.94], [13.5, 5.5, 0.86], [19, 5.0, 0.76]];
  levels.forEach(([y0, hgt, k], i) => {
    const r = insetRing(BUDDHA, k);
    B.add(wallMat, extrudeFootprint(r, y0, y0 + hgt - 1.4));
    // flared eave: wide shallow roof with upturned rim
    B.add(tile, hipRoof(r, y0 + hgt - 1.4, i === levels.length - 1 ? 5.5 : 1.6, i === levels.length - 1 ? 0.25 : 0.86, 1.16));
    const rim = extrudeFootprint(insetRing(BUDDHA, k * 1.17), y0 + hgt - 1.55, y0 + hgt - 1.25, { top: false });
    B.add(gold, rim);
  });
  const c = areaCentroid(BUDDHA);
  const finial = new THREE.ConeGeometry(0.6, 3.2, 8); finial.translate(c[0], 31.2, c[1]); B.add(gold, finial);
  void red;
}

function gopuram(B, base) {
  // Sri Mariamman Temple: six-tier tapering tower with colourful sculpture bands and a barrel-vault crown
  const tex = canvasTexture(256, 128, (ctx, w, h) => {
    const R = rng(8);
    const cols = ['#e04b3c', '#f2b632', '#3aa1d8', '#59b55a', '#e7e1d0', '#c23ba0', '#f07f2e', '#2f6fb0'];
    ctx.fillStyle = '#e8dcc4'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const x = (i % 14) * (w / 14) + 2, y = (i / 14 | 0) * (h / 5) + 4;
      ctx.fillStyle = cols[(R() * cols.length) | 0];
      ctx.beginPath(); ctx.ellipse(x + 7, y + 6, 4, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(x + 3, y + 10, 8, 12);
    }
    ctx.fillStyle = 'rgba(120,60,30,0.6)'; for (let j = 0; j < 5; j++) ctx.fillRect(0, j * h / 5, w, 2);
  });
  tex.repeat.set(2, 1);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
  const c = base.c, ang = base.ang, w0 = 11, d0 = 5.5;
  let y = 0;
  for (let i = 0; i < 6; i++) {
    const k = 1 - i * 0.12, hgt = i === 0 ? 4.5 : 2.2;
    const g = new THREE.BoxGeometry(w0 * k, hgt, d0 * Math.max(0.55, k)); g.translate(0, y + hgt / 2, 0);
    // map uv over the faces
    const uv = g.attributes.uv.array; for (let q = 0; q < uv.length; q += 2) { uv[q] *= 1; uv[q + 1] = uv[q + 1] * 0.2 + (i % 5) * 0.2; }
    g.rotateY(ang); g.translate(c[0], 0, c[1]);
    B.add(mat, g);
    y += hgt;
  }
  const crown = new THREE.CylinderGeometry(1.8, 1.8, w0 * 0.42, 16, 1, false, 0, Math.PI); crown.rotateZ(Math.PI / 2); crown.rotateY(ang); crown.translate(c[0], y, c[1]);
  B.add(mat, crown);
  for (let i = -2; i <= 2; i++) { const k = new THREE.ConeGeometry(0.28, 1.2, 8); k.translate(i * 0.9, y + 2.2, 0); k.rotateY(ang); k.translate(c[0], 0, c[1]); B.add(materials().gold, k); }
}

export function buildHeritage(city) {
  const M = materials();
  const B = new Bucket();
  const lps = lauPaSat(B);
  const rafflesList = raffles(B, city);
  bridges(B, M);
  buddhaTooth(B);
  const gop = city.buildings.find(b => b.id === 6879);
  let gopBase = { c: [-401.2, 484.2], ang: 0 };
  if (gop) { const r = ringOf(gop); const c = centroidOf(r); const dx = r[1][0] - r[0][0], dz = r[1][1] - r[0][1]; gopBase = { c, ang: Math.atan2(-dz, dx) }; }
  gopuram(B, gopBase);
  const meshes = B.build({ name: 'heritage' });
  const group = new THREE.Group(); group.name = 'Heritage';
  meshes.forEach(m => group.add(m));

  // exclusions: Lau Pa Sat parts, Raffles wings, Buddha Tooth, gopuram base
  const byIds = ids => city.buildings.filter(b => ids.includes(b.id));
  const nearC = (x, z, r, filt = () => true) => city.buildings.filter(b => { const c = centroidOf(ringOf(b)); return Math.hypot(c[0] - x, c[1] - z) < r && filt(b); });
  const exList = [
    ...byIds([5932, 5933, 5934, 5935, 5936, 5937, 6879]),
    ...nearC(lps[0], lps[1], 36, b => b.h < 15),
    ...rafflesList,
    ...city.buildings.filter(b => /Buddha Tooth/.test(b.n || '')),
  ];
  const exclusions = [LAUPASAT, BUDDHA, ...exclusionsForBuildings(exList)];
  const colliders = [];
  for (const ring of [LAUPASAT, BUDDHA]) { const c = areaCentroid(ring); const r = Math.sqrt(Math.abs(signedArea(ring)) / Math.PI) * 0.9; colliders.push({ type: 'cylinder', center: [c[0], 10, c[1]], radius: r, halfHeight: 10 }); }
  return {
    group, exclusions, colliders, reflective: meshes,
    pois: [
      { id: 'laupasat', name: 'Lau Pa Sat', x: lps[0], y: 0, z: lps[1] },
      { id: 'raffles', name: 'Raffles Hotel', x: 640, y: 0, z: -835 },
      { id: 'cavenagh', name: 'Cavenagh Bridge', x: 372.7, y: 2, z: 47.4 },
      { id: 'anderson', name: 'Anderson Bridge', x: 447, y: 2, z: -33 },
      { id: 'buddhatooth', name: 'Buddha Tooth Relic Temple', x: -530, y: 0, z: 608 },
      { id: 'mariamman', name: 'Sri Mariamman Temple', x: gopBase.c[0], y: 0, z: gopBase.c[1] },
    ],
  };
}
