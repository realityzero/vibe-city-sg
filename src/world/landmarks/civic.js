// Civic district around the Padang + Kampong Glam + Marina Barrage:
// National Gallery (Old Supreme Court dome & portico, City Hall colonnade), Victoria Theatre & Concert Hall clock tower,
// St Andrew's Cathedral (white Gothic, 63 m spire), Sultan Mosque (golden onion domes + minarets),
// Marina Barrage (green roof, spiral walk, crest gates).
import {
  THREE, U, Bucket, materials, facadeMaterial, nightGlowMaterial, extrudeFootprint, ringOf, areaCentroid, signedArea, centroidOf,
  exclusionsForBuildings, rng, lerp, smooth, offsetRing, capGeometry, pca, resampleRing, pointInRing, strut, tubeAlong, canvasTexture,
} from './common.js';

const CITY_HALL = [[304.3, -471.6], [345.8, -448.3], [359.3, -440.7], [350.8, -425.8], [349.1, -426.7], [308.5, -355.5], [310.1, -354.6], [299.6, -336.1], [295, -328], [276, -338.6], [250.6, -352.9], [240, -358.9]];
const OLD_SUPREME = [[273.6, -334.5], [276, -338.6], [295, -328], [287.6, -314.8], [283, -307], [285.4, -305.6], [284.3, -303.8], [285.9, -302.9], [285.3, -301.8], [272.9, -279.7], [272.4, -278.9], [271, -279.7], [269.9, -277.8], [267.3, -279.2], [263.2, -271.6], [254.8, -257.1], [235.8, -267.7], [235, -266.3], [211.9, -285], [202.2, -292.9], [240, -358.9], [250.6, -352.9], [248.5, -348.8]];
const VICTORIA = [[288.6, -194.1], [298.5, -187.4], [294.6, -181.7], [318.3, -165.6], [321.9, -170.9], [329, -166], [324.3, -159.2], [330.3, -155.1], [321.5, -142.3], [315.3, -146.5], [299.9, -124.3], [305.7, -120.3], [296.9, -107.6], [291.4, -111.4], [286.6, -104.5], [279.2, -109.6], [280.9, -112.1], [248.5, -134.2], [252.1, -139.4], [246.4, -143.3], [256.9, -158.6], [261.7, -155.3], [264.7, -159.6], [266.9, -158.2], [271.8, -165.3], [270.3, -166.3], [274.5, -172.4], [269.3, -175.9], [280.5, -192.2], [285.1, -189.1]];
const VIC_HOLE = [[294, -139.3], [299.2, -146.8], [287.9, -154.4], [282.8, -146.9]];
const DAM = { a: [2503, 724], b: [2752, 545] };

/** Onion dome lathe (radius r, height h) with finial. */
function onion(r, h, seg = 24) {
  const pts = [];
  const N = 18;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const rr = r * (t < 0.35 ? 1 + 0.18 * Math.sin(t / 0.35 * Math.PI / 2) : 1.18 * Math.pow(Math.cos((t - 0.35) / 0.65 * Math.PI / 2), 0.85));
    pts.push(new THREE.Vector2(Math.max(0.02, rr), t * h));
  }
  const g = new THREE.LatheGeometry(pts, seg);
  const fin = new THREE.CylinderGeometry(0.05 * r, 0.12 * r, 0.35 * h, 6); fin.translate(0, h + 0.17 * h, 0);
  return [g, fin];
}
/** Gabled roof over a near-rectangular ring (PCA), eaves at y0, ridge rise relative to width. */
function gableRoof(ring, y0, pitch = 0.45, overhang = 0.6) {
  const P = pca(ring); const [ux, uz] = P.dir; const vx = -uz, vz = ux;
  const hl = P.len / 2 + overhang, hw = P.wid / 2 + overhang, rise = P.wid * pitch;
  const C = (a, b, y) => [P.c[0] + ux * a + vx * b, y, P.c[1] + uz * a + vz * b];
  const A = C(-hl, -hw, y0), B = C(hl, -hw, y0), Cc = C(hl, hw, y0), D = C(-hl, hw, y0), E = C(-hl, 0, y0 + rise), F = C(hl, 0, y0 + rise);
  const pos = [...A, ...B, ...F, ...A, ...F, ...E, ...Cc, ...D, ...E, ...Cc, ...E, ...F, ...A, ...E, ...D, ...B, ...Cc, ...F];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  // outward/upward orientation
  const pp = g.attributes.position.array, nn = g.attributes.normal.array;
  for (let t = 0; t < pp.length / 9; t++) {
    const cx = (pp[t * 9] + pp[t * 9 + 3] + pp[t * 9 + 6]) / 3, cy = (pp[t * 9 + 1] + pp[t * 9 + 4] + pp[t * 9 + 7]) / 3, cz = (pp[t * 9 + 2] + pp[t * 9 + 5] + pp[t * 9 + 8]) / 3;
    const out = (cx - P.c[0]) * nn[t * 9] + (cy - y0) * nn[t * 9 + 1] + (cz - P.c[1]) * nn[t * 9 + 2];
    if (out < 0) for (let q = 0; q < 3; q++) { const a = t * 9 + 3 + q, b = t * 9 + 6 + q; [pp[a], pp[b]] = [pp[b], pp[a]]; }
  }
  g.computeVertexNormals();
  return g;
}
/** Row of classical columns along a ring edge segment (from p to q), standing `out` metres in front of the wall. */
function colonnade(B, mat, p, q, n, y0, y1, out, rCol = 0.7) {
  const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz); const nx = dz / l, nz = -dx / l;
  const col = new THREE.CylinderGeometry(rCol * 0.88, rCol, y1 - y0, 14); col.translate(0, (y1 + y0) / 2, 0);
  const cap = new THREE.BoxGeometry(rCol * 2.6, 0.7, rCol * 2.6); cap.translate(0, y1 + 0.35, 0);
  const base = new THREE.BoxGeometry(rCol * 2.6, 0.8, rCol * 2.6); base.translate(0, y0 + 0.4, 0);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n; const x = p[0] + dx * t + nx * out, z = p[1] + dz * t + nz * out;
    for (const g of [col, cap, base]) B.add(mat, g.clone().translate(x, 0, z));
  }
  const ang = Math.atan2(-dz, dx);
  const ent = new THREE.BoxGeometry(l + 1, 2.4, out * 2 + 1.5); ent.rotateY(ang); ent.translate((p[0] + q[0]) / 2 + nx * out * 0.5, y1 + 1.9, (p[1] + q[1]) / 2 + nz * out * 0.5);
  B.add(mat, ent);
  return { nx, nz, ang, l };
}
/** Outward-facing edge (positive-area ring) whose normal best matches (dirx, dirz) and with length > minLen. */
function bestEdge(ring, dirx, dirz, minLen = 15) {
  const r = signedArea(ring) < 0 ? ring.slice().reverse() : ring;
  let best = null, bs = -2;
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length]; const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
    if (l < minLen) continue;
    const s = (dz / l) * dirx + (-dx / l) * dirz;
    if (s > bs) { bs = s; best = [p, q]; }
  }
  return best;
}

export function buildCivic(city, quality) {
  const M = materials();
  const R = rng(77);
  const B = new Bucket();
  const byId = new Map(city.buildings.map(b => [b.id, b]));
  const has = id => byId.has(id);
  const ring = id => ringOf(byId.get(id));
  const exList = [], colliders = [], extraEx = [];

  const civicWall = facadeMaterial({ wall: 0xeee8da, glass: 0x2e3a3f, cell: [4.2, 5.2], frame: [0.3, 0.2, 0.18], lit: 0.7, seed: 81, warm: 0xffdcaa, litIntensity: 1.8, wallRough: 0.7, glassMetal: 0.2, glassRough: 0.4, wallGlow: 0.12 });
  const gothicWall = facadeMaterial({ wall: 0xf5f3ee, glass: 0x2b3e5a, cell: [3.6, 10], frame: [0.36, 0.18, 0.12], lit: 0.9, seed: 82, warm: 0xffc890, litIntensity: 1.6, wallRough: 0.6, glassMetal: 0.2, glassRough: 0.3, wallGlow: 0.15 });
  const stone = M.stone;
  const domeGlow = nightGlowMaterial(0xfff0d0, 0.55, { base: 0x5f9a86, rough: 0.5, metal: 0.4 });
  const goldGlow = nightGlowMaterial(0xffd27a, 0.35, { base: 0xd8a83c, rough: 0.25, metal: 1.0 });
  const whiteGlow = nightGlowMaterial(0xfff4e2, 0.35, { base: 0xf4f2ec, rough: 0.6 });
  const slate = new THREE.MeshStandardMaterial({ color: 0xa3a8ab, roughness: 0.6, metalness: 0.15 });
  const clockTex = canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#f7f3e6'; ctx.beginPath(); ctx.arc(64, 64, 62, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1d1d1d'; ctx.lineWidth = 6; ctx.stroke();
    ctx.fillStyle = '#1d1d1d'; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; ctx.fillRect(64 + Math.cos(a) * 50 - 3, 64 + Math.sin(a) * 50 - 3, 6, 6); }
    ctx.lineCap = 'round'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(64, 64); ctx.lineTo(64, 28); ctx.stroke();
    ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(64, 64); ctx.lineTo(92, 74); ctx.stroke();
  }, { repeat: false });
  const clockFace = nightGlowMaterial(0xfff6e0, 1.6, { base: 0xffffff, rough: 0.5 });
  clockFace.map = clockTex; clockFace.emissiveMap = clockTex;

  // ======================= National Gallery: Old Supreme Court dome + portico
  {
    const c = [265.6, -297.8];
    const drum = new THREE.CylinderGeometry(9.4, 9.6, 7, 32); drum.translate(c[0], 23.5, c[1]); B.add(whiteGlow, drum);
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; const g = new THREE.CylinderGeometry(0.35, 0.4, 6.6, 8); g.translate(c[0] + Math.cos(a) * 9.75, 23.5, c[1] + Math.sin(a) * 9.75); B.add(stone, g); }
    const ring1 = new THREE.CylinderGeometry(10.3, 10.3, 0.8, 32); ring1.translate(c[0], 27.2, c[1]); B.add(stone, ring1);
    const dome = new THREE.SphereGeometry(9.3, 36, 14, 0, Math.PI * 2, 0, Math.PI / 2); dome.scale(1, 1.08, 1); dome.translate(c[0], 27.5, c[1]); B.add(domeGlow, dome);
    const lan = new THREE.CylinderGeometry(1.7, 1.9, 3.4, 12); lan.translate(c[0], 38.6, c[1]); B.add(stone, lan);
    const lanDome = new THREE.SphereGeometry(1.9, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2); lanDome.translate(c[0], 40.3, c[1]); B.add(domeGlow, lanDome);
    const fin = new THREE.ConeGeometry(0.25, 1.8, 8); fin.translate(c[0], 43, c[1]); B.add(M.gold, fin);
    // Corinthian portico facing the Padang (east)
    const e = bestEdge(OLD_SUPREME, 0.9, 0.35, 10);
    if (e) {
      const [p, q] = e; const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
      const a = [mid[0] - dx / l * 13, mid[1] - dz / l * 13], b = [mid[0] + dx / l * 13, mid[1] + dz / l * 13];
      const { nx, nz, ang } = colonnade(B, stone, a, b, 8, 3.2, 17.5, 4.5, 0.75);
      // pediment
      const shape = new THREE.Shape(); shape.moveTo(-14, 0); shape.lineTo(14, 0); shape.lineTo(0, 4.6); shape.lineTo(-14, 0);
      const ped = new THREE.ExtrudeGeometry(shape, { depth: 9, bevelEnabled: false }); ped.translate(0, 0, -4.5); ped.rotateY(ang); ped.translate(mid[0] + nx * 2.3, 20.3, mid[1] + nz * 2.3);
      B.add(stone, ped);
      const steps = new THREE.BoxGeometry(28, 3.2, 8); steps.rotateY(ang); steps.translate(mid[0] + nx * 6, 1.6, mid[1] + nz * 6); B.add(stone, steps);
    }
    for (const id of [5515, 5516, 5518]) if (has(id)) exList.push(byId.get(id));
  }

  // ======================= City Hall (rebuilt to full height with the 18-column colonnade)
  {
    B.add(civicWall, extrudeFootprint(CITY_HALL, 0, 24));
    B.add(stone, extrudeFootprint(offsetRing(CITY_HALL, 0.6), 24, 25.4));
    B.add(civicWall, extrudeFootprint(offsetRing(CITY_HALL, -2.5), 25.4, 29));
    const e = bestEdge(CITY_HALL, 0.87, 0.49, 30);
    if (e) {
      const [p, q] = e; const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
      const a = [p[0] + dx / l * 4, p[1] + dz / l * 4], b = [q[0] - dx / l * 4, q[1] - dz / l * 4];
      const { nx, nz, ang } = colonnade(B, stone, a, b, 18, 4.2, 20.5, 3.8, 0.8);
      const steps = new THREE.BoxGeometry(l - 6, 4.2, 9); steps.rotateY(ang); steps.translate((p[0] + q[0]) / 2 + nx * 5.5, 2.1, (p[1] + q[1]) / 2 + nz * 5.5); B.add(stone, steps);
    }
    if (has(6921)) exList.push(byId.get(6921));
    extraEx.push(CITY_HALL);
    colliders.push({ type: 'trimesh', ...trimeshOf(extrudeFootprint(CITY_HALL, 0, 24)) });
  }

  // ======================= Victoria Theatre & Concert Hall clock tower
  {
    let c = areaCentroid(VICTORIA);
    const P = pca(VICTORIA);
    if (pointInRing(c[0], c[1], VIC_HOLE)) c = [c[0] - P.dir[1] * 11, c[1] + P.dir[0] * 11];
    const ang = Math.atan2(-P.dir[1], P.dir[0]);
    const shaft = new THREE.BoxGeometry(7.5, 30, 7.5); shaft.rotateY(ang); shaft.translate(c[0], 15 + 15, c[1]); B.add(whiteGlow, shaft);
    const belt = new THREE.BoxGeometry(8.6, 1, 8.6); belt.rotateY(ang); belt.translate(c[0], 44.5, c[1]); B.add(stone, belt);
    const top = new THREE.BoxGeometry(6.6, 5, 6.6); top.rotateY(ang); top.translate(c[0], 47.5, c[1]); B.add(whiteGlow, top);
    const spire = new THREE.ConeGeometry(4.2, 6.5, 4); spire.rotateY(ang + Math.PI / 4); spire.translate(c[0], 53.2, c[1]); B.add(slate, spire);
    for (let k = 0; k < 4; k++) {
      const a = ang + k * Math.PI / 2;
      for (const off of [-1.6, 1.6]) {
        const w = new THREE.BoxGeometry(0.4, 4.2, 1.1); w.rotateY(a); 
        w.translate(c[0] + Math.cos(a) * 3.7 + Math.sin(a) * off, 35, c[1] - Math.sin(a) * 3.7 + Math.cos(a) * off); B.add(M.darkGlass, w);
      }
      const d = new THREE.CircleGeometry(2.1, 24);
      d.rotateY(a + Math.PI / 2); d.translate(c[0] + Math.cos(a) * 3.8, 40.5, c[1] - Math.sin(a) * 3.8);
      B.add(clockFace, d);
    }
    colliders.push({ type: 'box', center: [c[0], 28, c[1]], half: [3.8, 28, 3.8], yaw: ang });
  }

  // ======================= St Andrew's Cathedral
  if (has(6929)) {
    const nave = ring(6929);
    B.add(gothicWall, extrudeFootprint(nave, 0, 10.5));
    for (const id of [6935, 6936]) if (has(id)) B.add(slate, gableRoof(ring(id), 10.5, 0.55, 0.5));
    // west tower + spire
    let tc = [349, -561.5];
    if (has(6934)) tc = areaCentroid(ring(6934));
    const tw = new THREE.BoxGeometry(10, 26, 10); const P = pca(nave); const ang = Math.atan2(-P.dir[1], P.dir[0]);
    tw.rotateY(ang); tw.translate(tc[0], 13, tc[1]); B.add(gothicWall, tw);
    const spire = new THREE.ConeGeometry(4.6, 37, 8); spire.rotateY(Math.PI / 8 + ang); spire.translate(tc[0], 26 + 18.5, tc[1]); B.add(whiteGlow, spire);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ox = Math.cos(ang) * sx * 4.6 + Math.sin(ang) * sz * 4.6, oz = -Math.sin(ang) * sx * 4.6 + Math.cos(ang) * sz * 4.6;
      const pin = new THREE.ConeGeometry(0.8, 7, 6); pin.translate(tc[0] + ox, 29.5, tc[1] + oz); B.add(M.white, pin);
    }
    for (const id of [6929, 6933, 6934, 6935, 6936]) if (has(id)) exList.push(byId.get(id));
    colliders.push({ type: 'box', center: [tc[0], 13, tc[1]], half: [5, 13, 5], yaw: ang }, { type: 'box', center: [P.c[0], 6, P.c[1]], half: [P.len / 2, 6, P.wid / 2], yaw: Math.atan2(-P.dir[1], P.dir[0]) });
  }

  // ======================= Sultan Mosque (Masjid Sultan): golden onion domes + minarets
  {
    const domes = [6889, 7620].filter(has), drums = [6888, 7619].filter(has);
    for (const id of domes) {
      const r0 = ring(id); const c = areaCentroid(r0); const rad = Math.sqrt(Math.abs(signedArea(r0)) / Math.PI);
      const drum = new THREE.CylinderGeometry(rad * 0.98, rad * 1.02, 6, 8); drum.translate(c[0], 14, c[1]); B.add(M.white, drum);
      const band = new THREE.CylinderGeometry(rad * 1.06, rad * 1.06, 0.6, 24); band.translate(c[0], 17.1, c[1]); B.add(M.white, band);
      const [g, fin] = onion(rad, rad * 1.55, 28); g.translate(c[0], 17.4, c[1]); fin.translate(c[0], 17.4, c[1]);
      B.add(goldGlow, g); B.add(M.gold, fin);
      colliders.push({ type: 'cylinder', center: [c[0], 12, c[1]], radius: rad, halfHeight: 12 });
    }
    for (const id of [6834, 7614, 7615, 7616].filter(has)) {
      const r0 = ring(id); const c = areaCentroid(r0); const rad = Math.max(1.6, Math.sqrt(Math.abs(signedArea(r0)) / Math.PI) * 0.8);
      const shaft = new THREE.CylinderGeometry(rad * 0.85, rad, 23, 8); shaft.translate(c[0], 11.5, c[1]); B.add(M.white, shaft);
      const bal = new THREE.CylinderGeometry(rad * 1.35, rad * 1.1, 0.8, 8); bal.translate(c[0], 18, c[1]); B.add(M.white, bal);
      const ring2 = new THREE.CylinderGeometry(rad * 1.1, rad * 1.1, 0.5, 8); ring2.translate(c[0], 22.8, c[1]); B.add(M.white, ring2);
      const [g, fin] = onion(rad * 1.05, rad * 2.3, 16); g.translate(c[0], 23, c[1]); fin.translate(c[0], 23, c[1]);
      B.add(goldGlow, g); B.add(M.gold, fin);
      colliders.push({ type: 'cylinder', center: [c[0], 13, c[1]], radius: rad, halfHeight: 13 });
    }
    for (const id of [7617, 7618, 7621, 7622].filter(has)) {
      const r0 = ring(id); const c = areaCentroid(r0); const rad = 1.4;
      const shaft = new THREE.CylinderGeometry(rad, rad, 14, 8); shaft.translate(c[0], 7, c[1]); B.add(M.white, shaft);
      const [g, fin] = onion(rad, rad * 2.2, 12); g.translate(c[0], 14, c[1]); fin.translate(c[0], 14, c[1]); B.add(goldGlow, g); B.add(M.gold, fin);
    }
    for (const id of [...domes, ...drums, 6834, 7614, 7615, 7616, 7617, 7618, 7621, 7622]) if (has(id)) exList.push(byId.get(id));
  }

  // ======================= Marina Barrage: sloping green roof with a spiral walk, crest gates across the channel
  if (has(290)) {
    const site = resampleRing(ring(290), 96);
    const P = pca(site); const [ux, uz] = P.dir;
    // roof rises from the reservoir side up towards the sea
    const hAt = (x, z) => { const u = ((x - P.c[0]) * ux + (z - P.c[1]) * uz) / (P.len / 2); return 1.2 + 11.5 * Math.min(1, Math.max(0, (u + 1) / 2)); };
    const r = signedArea(site) < 0 ? site.slice().reverse() : site;
    const wall = [], roofPos = [];
    for (let i = 0; i < r.length; i++) {
      const p = r[i], q = r[(i + 1) % r.length]; const hp = hAt(p[0], p[1]), hq = hAt(q[0], q[1]);
      wall.push(p[0], 0, p[1], q[0], 0, q[1], q[0], hq, q[1], p[0], 0, p[1], q[0], hq, q[1], p[0], hp, p[1]);
    }
    const tris = THREE.ShapeUtils.triangulateShape(r.map(p => new THREE.Vector2(p[0], p[1])), []);
    for (const t of tris) for (const k of t) roofPos.push(r[k][0], hAt(r[k][0], r[k][1]), r[k][1]);
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wall, 3)); wg.computeVertexNormals();
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(roofPos, 3)); rg.computeVertexNormals();
    if (rg.attributes.normal.getY(0) < 0) { const pp = rg.attributes.position.array; for (let t = 0; t < pp.length / 9; t++) for (let q = 0; q < 3; q++) { const a = t * 9 + 3 + q, b = t * 9 + 6 + q; [pp[a], pp[b]] = [pp[b], pp[a]]; } rg.computeVertexNormals(); }
    // walls outward
    { const pp = wg.attributes.position.array, nn = wg.attributes.normal.array; for (let t = 0; t < pp.length / 9; t++) { const cx = (pp[t * 9] + pp[t * 9 + 3]) / 2, cz = (pp[t * 9 + 2] + pp[t * 9 + 5]) / 2; if ((cx - P.c[0]) * nn[t * 9] + (cz - P.c[1]) * nn[t * 9 + 2] < 0) for (let q = 0; q < 3; q++) { const a = t * 9 + 3 + q, b = t * 9 + 6 + q; [pp[a], pp[b]] = [pp[b], pp[a]]; } } wg.computeVertexNormals(); }
    const grass = new THREE.MeshStandardMaterial({ color: 0x5c8f3a, roughness: 0.95 });
    B.add(M.darkGlass, wg); B.add(grass, rg);
    // spiral walkway wrapped round a circular courtyard
    const cc = P.c; const pts = [];
    for (let t = 0; t <= 1.0001; t += 1 / 120) {
      const a = t * Math.PI * 4.2; const rr = 8 + 34 * t; const x = cc[0] + Math.cos(a) * rr, z = cc[1] + Math.sin(a) * rr;
      if (!pointInRing(x, z, r)) continue;
      pts.push(new THREE.Vector3(x, hAt(x, z) + 0.25, z));
    }
    // flat path ribbon draped over the roof
    if (pts.length > 2) {
      const pos = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1]; const d = new THREE.Vector3().subVectors(b, a); d.y = 0; d.normalize(); const n = new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(1.3);
        pos.push(a.x - n.x, a.y, a.z - n.z, b.x + n.x, b.y, b.z + n.z, b.x - n.x, b.y, b.z - n.z, a.x - n.x, a.y, a.z - n.z, a.x + n.x, a.y, a.z + n.z, b.x + n.x, b.y, b.z + n.z);
      }
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); pg.computeVertexNormals();
      const nn2 = pg.attributes.normal.array; for (let i = 0; i < nn2.length; i += 3) if (nn2[i + 1] < 0) { nn2[i] *= -1; nn2[i + 1] *= -1; nn2[i + 2] *= -1; }
      B.add(M.paving, pg);
    }
    exList.push(byId.get(290));
    colliders.push({ type: 'trimesh', ...trimeshOf(wg) }, { type: 'trimesh', ...trimeshOf(rg) });
    // crest gates and piers across the channel
    const [ax, az] = DAM.a, [bx, bz] = DAM.b; const L = Math.hypot(bx - ax, bz - az); const dx = (bx - ax) / L, dz = (bz - az) / L; const nx = dz, nz = -dx;
    const ang = Math.atan2(-dz, dx);
    const piers = 10;
    const gateMat = new THREE.MeshStandardMaterial({ color: 0x40505c, roughness: 0.45, metalness: 0.7 });
    for (let i = 0; i <= piers; i++) {
      const t = i / piers; const x = ax + dx * L * t, z = az + dz * L * t;
      const pier = new THREE.BoxGeometry(3.2, 11, 16); pier.rotateY(ang); pier.translate(x, 5.5 - 5, z); B.add(M.concrete, pier);
      if (i < piers) {
        const sp = L / piers - 3.2; const gate = new THREE.CylinderGeometry(9, 9, sp, 16, 1, true, -0.45, 0.9);
        gate.rotateZ(Math.PI / 2); gate.rotateY(ang); gate.translate(x + dx * (L / piers / 2) - nx * 3, -6.2, z + dz * (L / piers / 2) - nz * 3);
        B.add(gateMat, gate);
        const deck = new THREE.BoxGeometry(L / piers, 0.8, 5.5); deck.rotateY(ang); deck.translate(x + dx * (L / piers / 2), 5.6, z + dz * (L / piers / 2)); B.add(M.concrete, deck);
      }
      colliders.push({ type: 'box', center: [x, 0.5, z], half: [1.6, 5.5, 8], yaw: ang });
    }
  }

  const meshes = B.build({ name: 'civic' });
  const group = new THREE.Group(); group.name = 'CivicDistrict';
  meshes.forEach(m => group.add(m));
  return {
    group, colliders, reflective: meshes,
    exclusions: [...extraEx, ...exclusionsForBuildings(exList.filter(Boolean))],
    pois: [
      { id: 'nationalgallery', name: 'National Gallery Singapore', x: 300, y: 0, z: -350 },
      { id: 'cityhall', name: 'City Hall', x: 340, y: 0, z: -400 },
      { id: 'victoria', name: 'Victoria Theatre & Concert Hall', x: 288, y: 0, z: -150 },
      { id: 'standrews', name: "St Andrew's Cathedral", x: 360, y: 0, z: -590 },
      { id: 'sultanmosque', name: 'Masjid Sultan', x: 1112, y: 0, z: -1683 },
      { id: 'barrage', name: 'Marina Barrage', x: 2420, y: 12, z: 700 },
    ],
  };
}

function trimeshOf(g) {
  const p = g.attributes.position.array;
  return { vertices: new Float32Array(p), indices: new Uint32Array([...Array(p.length / 3).keys()]) };
}
