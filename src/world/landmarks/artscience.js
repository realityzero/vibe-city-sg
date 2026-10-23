// ArtScience Museum: a white lotus / open hand of ten curved "fingers" rising from a central bowl on a lily pond.
import { THREE, Bucket, materials, nightGlowMaterial, uplitMaterial, exclusionsForBuildings, circlePoly, lerp, smooth, rng } from './common.js';

const C = [1132, 100.3];
// azimuth (deg, from +x towards +z) and horizontal reach of each petal, from the OSM footprint extents
const PETALS = [[0, 50], [36, 52], [72, 47], [108, 39], [144, 32], [180, 29], [216, 31], [252, 38], [288, 45], [324, 54]];

function petalGeometry(az, reach, seed) {
  const R = rng(seed);
  const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  const r0 = 9, y0 = 7.5;
  const L = reach - r0;
  const tipH = 6 + reach * 0.88 + R() * 3;
  // centre line in the radial/height plane: quadratic bezier (rises gently then sweeps up)
  const B0 = new THREE.Vector2(r0, y0), B1 = new THREE.Vector2(r0 + L * 0.62, y0 + 1.5), B2 = new THREE.Vector2(r0 + L * 1.05, tipH);
  const bez = t => new THREE.Vector2().addScaledVector(B0, (1 - t) * (1 - t)).addScaledVector(B1, 2 * (1 - t) * t).addScaledVector(B2, t * t);
  const bezD = t => new THREE.Vector2().addScaledVector(B1.clone().sub(B0), 2 * (1 - t)).addScaledVector(B2.clone().sub(B1), 2 * t).normalize();
  const Wmax = 11 + reach * 0.07;
  const width = t => Wmax * (0.7 + 0.45 * Math.sin(Math.PI * Math.min(1, 0.1 + t * 0.9)) - 0.5 * t * t);
  const th = 1.6;
  const nt = 22, ns = 12;
  const top = [], bot = [];
  for (let i = 0; i <= nt; i++) {
    const t = i / nt; const c = bez(t), d = bezD(t);
    const nUp = new THREE.Vector2(-d.y, d.x); // normal in (r,y) plane, pointing up/inwards
    const w = width(t); const sag = w * 0.16;
    const rowT = [], rowB = [];
    for (let j = 0; j <= ns; j++) {
      const s = j / ns * 2 - 1;
      const lift = sag * s * s;
      const rr = c.x + nUp.x * lift, yy = c.y + nUp.y * lift;
      const p = new THREE.Vector3(C[0], 0, C[1]).addScaledVector(dir, rr).addScaledVector(side, s * w / 2); p.y = yy;
      rowT.push(p);
      const q = p.clone().addScaledVector(dir, -nUp.x * th); q.y -= nUp.y * th;
      rowB.push(q);
    }
    top.push(rowT); bot.push(rowB);
  }
  const pos = [];
  const tri = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let i = 0; i < nt; i++) for (let j = 0; j < ns; j++) {
    tri(top[i][j], top[i + 1][j], top[i][j + 1]); tri(top[i][j + 1], top[i + 1][j], top[i + 1][j + 1]);
    tri(bot[i][j], bot[i][j + 1], bot[i + 1][j]); tri(bot[i][j + 1], bot[i + 1][j + 1], bot[i + 1][j]);
  }
  for (let i = 0; i < nt; i++) for (const j of [0, ns]) {
    const a = top[i][j], b = top[i + 1][j], c = bot[i][j], d = bot[i + 1][j];
    if (j === 0) { tri(a, c, b); tri(b, c, d); } else { tri(a, b, c); tri(b, d, c); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  // tip skylight cap
  const cap = [];
  const tt = top[nt], bb = bot[nt];
  for (let j = 0; j < ns; j++) { cap.push(tt[j].x, tt[j].y, tt[j].z, bb[j].x, bb[j].y, bb[j].z, tt[j + 1].x, tt[j + 1].y, tt[j + 1].z, tt[j + 1].x, tt[j + 1].y, tt[j + 1].z, bb[j].x, bb[j].y, bb[j].z, bb[j + 1].x, bb[j + 1].y, bb[j + 1].z); }
  const capGeo = new THREE.BufferGeometry(); capGeo.setAttribute('position', new THREE.Float32BufferAttribute(cap, 3)); capGeo.computeVertexNormals();
  return { geo, capGeo, tipH };
}

export function buildArtScience(city) {
  const M = materials();
  // at night the white petals are washed by floodlights from the lily pond (bright at the base, falling off upward),
  // not glowing pink all over; the glass skylights at the petal tips stay softly lit
  const shell = uplitMaterial(0xfff1e4, 0.3, { y0: 2, y1: 30, floor: 0.04, base: 0xf3f1ec, rough: 0.32, metal: 0.05, side: THREE.DoubleSide });
  const tipGlass = nightGlowMaterial(0xfff2d6, 1.1, { base: 0x40505a, rough: 0.1, metal: 0.5 });
  const B = new Bucket();
  PETALS.forEach(([deg, reach], i) => {
    const { geo, capGeo } = petalGeometry(deg * Math.PI / 180, reach, 100 + i);
    B.add(shell, geo); B.add(tipGlass, capGeo);
  });
  // central bowl and base
  const bowl = new THREE.LatheGeometry([[0, 0], [13, 0], [14, 3], [12.5, 8.5], [8, 9.2], [2, 6], [0, 5.5]].map(([x, y]) => new THREE.Vector2(x, y)), 40);
  bowl.translate(C[0], 0, C[1]);
  B.add(shell, bowl);
  // lily pond
  const pond = new THREE.CircleGeometry(48, 48); pond.rotateX(-Math.PI / 2); pond.translate(C[0] + 6, 0.06, C[1] + 4);
  B.add(M.water, pond);
  const R = rng(9);
  const pad = new THREE.CircleGeometry(1, 7); pad.rotateX(-Math.PI / 2);
  const lily = new THREE.MeshStandardMaterial({ color: 0x4f7a32, roughness: 0.7 });
  for (let i = 0; i < 70; i++) {
    const a = R() * Math.PI * 2, r = 16 + R() * 30;
    const g = pad.clone(); const s = 0.6 + R() * 0.9; g.scale(s, 1, s); g.translate(C[0] + 6 + Math.cos(a) * r, 0.1, C[1] + 4 + Math.sin(a) * r);
    B.add(lily, g);
  }
  const meshes = B.build({ name: 'artscience' });
  const group = new THREE.Group(); group.name = 'ArtScienceMuseum';
  meshes.forEach(m => group.add(m));
  const ids = new Set();
  const asBuildings = city.buildings.filter(b => {
    if (/ArtScience/i.test(b.n || '')) return true;
    let cx = 0, cz = 0; const n = b.p.length / 2; for (let i = 0; i < b.p.length; i += 2) { cx += b.p[i]; cz += b.p[i + 1]; } cx /= n; cz /= n;
    return Math.hypot(cx - C[0] - 13, cz - C[1] - 8) < 42 && b.h < 40;
  });
  asBuildings.forEach(b => ids.add(b.id));
  return {
    group,
    exclusions: [circlePoly(C[0] + 8, C[1] + 4, 38, 28), ...exclusionsForBuildings(asBuildings)],
    colliders: [{ type: 'cylinder', center: [C[0], 5, C[1]], radius: 14, halfHeight: 5 }],
    pois: [{ id: 'artscience', name: 'ArtScience Museum', x: C[0] - 20, y: 0, z: C[1] }],
    reflective: meshes,
  };
}
