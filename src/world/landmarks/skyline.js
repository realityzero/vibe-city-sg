// Modern CBD icons: CapitaSpring (Green Oasis + rooftop garden), Guoco Tower (finned glass, stepped crown),
// Oasia Hotel Downtown (red mesh + creepers + sky-garden voids), PARKROYAL COLLECTION Pickering (contoured terraces,
// sky gardens with palms), The Pinnacle@Duxton (7 towers + 26th/50th storey skybridges), Marina One (green Heart +
// louvred residences) and wave crowns on the Marina Bay Financial Centre towers.
import {
  THREE, U, Bucket, materials, facadeMaterial, nightGlowMaterial, extrudeFootprint, ringOf, areaCentroid, signedArea, centroidOf,
  exclusionsForBuildings, rng, lerp, smooth, canvasTexture, offsetRing, capGeometry, blobTree, palmGeometry, pca, rectPoly, resampleRing,
} from './common.js';

// raw OSM outlines whose 3D parts hide them in city.json (so the city builder never renders them)
const CAPITASPRING_SITE = [[82.5, 318.4], [81.1, 321.6], [82.4, 326.6], [85.8, 329.7], [82.5, 331.9], [111.9, 382.8], [117.5, 393.4], [120.2, 394.6], [122.7, 395.4], [125.3, 395.7], [127.9, 395.7], [130.3, 395.3], [132.5, 394.2], [134.9, 392.2], [137.1, 390.7], [138.5, 388.5], [140, 385.6], [140, 371.5], [140, 334.9], [140, 293.6], [148.5, 229.3], [143.9, 221.3], [135.7, 219.3], [131.7, 221.9], [121, 281.8], [118, 301], [105.6, 313.8], [93.8, 314.9], [89.4, 313.7], [85.4, 314.9]];
const PICKERING_SITE = [[-381.5, 125.9], [-365.3, 96.8], [-351.8, 104.2], [-335, 113.3], [-319.9, 121.6], [-289.6, 138.1], [-274.4, 146.4], [-244.1, 162.9], [-228.9, 171.2], [-228.1, 171.6], [-227.5, 173.8], [-231.7, 182.3], [-234.3, 183.4], [-236.1, 187.5], [-235.4, 189.6], [-240.9, 199.9], [-244.7, 200.8], [-245.3, 200.4], [-260.5, 192.2], [-290.8, 175.5], [-305.7, 167.4], [-336.1, 150.7], [-351, 142.5]];
const PINNACLE_PODIUM = [[-860.4, 967.4], [-860.6, 976.6], [-863.7, 981.5], [-868, 983.8], [-885.4, 993.4], [-872.5, 1014.3], [-905.8, 1034.5], [-918.6, 1013.6], [-921.1, 1015.1], [-908.4, 1086.9], [-908.3, 1087.5], [-896.9, 1153], [-891.5, 1161.4], [-873, 1126.2], [-853.6, 1136.3], [-848.5, 1133.2], [-858, 1113.8], [-821.8, 1096.3], [-812.3, 1115.7], [-796.1, 1070.6], [-817.5, 1081.1], [-836.1, 1043.8], [-814.7, 1033.3], [-822.4, 1022.1], [-838.6, 1040.3], [-868.4, 1014.3], [-852.2, 996.1], [-854.9, 992.7], [-856.7, 967.2]];
const PINNACLE_TOWERS = [[[-814.7, 1033.3], [-796.1, 1070.6], [-817.5, 1081.1], [-836.1, 1043.8]], [[-905.8, 1034.5], [-872.5, 1014.3], [-885.4, 993.4], [-918.6, 1013.6]], [[-862.2, 1196.9], [-851, 1235.1], [-871.9, 1241.1], [-883, 1202.9], [-880.4, 1202.2], [-866.1, 1198.1]], [[-848.3, 1244.5], [-842, 1280.3], [-863.8, 1284.4], [-864.1, 1282.9], [-870.3, 1248.3]], [[-812.3, 1115.7], [-848.5, 1133.2], [-858, 1113.8], [-821.8, 1096.3]], [[-872.2, 1171.5], [-853.6, 1136.3], [-873, 1126.2], [-891.5, 1161.4], [-888.1, 1163.2], [-874.4, 1170.3]], [[-822.4, 1022.1], [-852.2, 996.1], [-868.4, 1014.3], [-838.6, 1040.3]]];

const facadeUV = (g, k = 1 / 12) => { const f = g.attributes.facade.array; const uv = new Float32Array(f.length); for (let i = 0; i < f.length; i++) uv[i] = f[i] * k; g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); return g; };
const sidesOnly = (ring, y0, y1) => extrudeFootprint(ring, y0, y1, { top: false });

/** Oriented-box collider from a ring (PCA). */
function boxCollider(ring, y0, y1) {
  const P = pca(ring);
  return { type: 'box', center: [P.c[0], (y0 + y1) / 2, P.c[1]], half: [P.len / 2, (y1 - y0) / 2, P.wid / 2], yaw: Math.atan2(-P.dir[1], P.dir[0]) };
}

function oasiaTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const R = rng(12);
    ctx.fillStyle = '#b8473c'; ctx.fillRect(0, 0, w, h);
    // perforated aluminium mesh in red/pink/orange panels
    const cols = ['#c4503f', '#d0614c', '#e07b55', '#c9475a', '#b13f3a', '#d86e63'];
    for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) { ctx.fillStyle = cols[(R() * cols.length) | 0]; ctx.fillRect(x + 1, y + 1, 30, 30); }
    ctx.fillStyle = 'rgba(40,10,10,0.35)';
    for (let y = 2; y < h; y += 6) for (let x = (y / 6 % 2) * 3; x < w; x += 6) ctx.fillRect(x, y, 2, 2);
    // creepers climbing in vertical tendrils
    for (let i = 0; i < 26; i++) {
      let x = R() * w; const len = 60 + R() * 200; let y = h - R() * 40;
      for (let s = 0; s < len; s += 3) {
        x += (R() - 0.5) * 3; y -= 3;
        const yy = ((y % h) + h) % h;
        ctx.fillStyle = `hsl(${95 + R() * 30},${45 + R() * 20}%,${22 + R() * 15}%)`;
        ctx.beginPath(); ctx.ellipse(x, yy, 3 + R() * 5, 2 + R() * 4, R() * 3, 0, Math.PI * 2); ctx.fill();
      }
    }
  });
}

export function buildSkyline(city, quality) {
  const M = materials();
  const R = rng(2026);
  const B = new Bucket();
  const byId = new Map(city.buildings.map(b => [b.id, b]));
  const ring = id => ringOf(byId.get(id));
  const has = id => byId.has(id);

  // ---- materials (shared across the cluster)
  const finGlass = facadeMaterial({ wall: 0xe4e7e8, glass: 0x415a68, cell: [1.6, 4.2], frame: [0.17, 0.035, 0.02], lit: 0.55, seed: 71, litIntensity: 2.0, wallGlow: 0.08, glassRough: 0.05 });
  const pickGlass = facadeMaterial({ wall: 0xf3f3ef, glass: 0x38545e, cell: [3.0, 3.6], frame: [0.04, 0.24, 0.1], lit: 0.6, seed: 72, warm: 0xffe2b0, litIntensity: 2.0 });
  const hdb = facadeMaterial({ wall: 0xd6d3cc, glass: 0x2f383d, cell: [2.6, 2.94], frame: [0.16, 0.28, 0.2], lit: 0.5, seed: 73, litIntensity: 1.7, wallRough: 0.85, glassMetal: 0.3, glassRough: 0.3, accent: 0.05, accentA: 0xaab8c4, accentB: 0xd9ccb2, warm: 0xfff0c8, cool: 0xe8f4ff });
  const louvre = facadeMaterial({ wall: 0xf4f4f0, glass: 0x34444c, cell: [2.4, 3.3], frame: [0.05, 0.42, 0.05], lit: 0.5, seed: 74, litIntensity: 1.9 });
  const oTex = oasiaTexture();
  const oasiaMesh = new THREE.MeshStandardMaterial({ map: oTex, roughness: 0.75, metalness: 0.25, emissive: 0xff5a3c, emissiveMap: oTex });
  oasiaMesh.onBeforeCompile = sh => { sh.uniforms.uNight = U.night; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.22 * uNight;'); };
  oasiaMesh.customProgramCacheKey = () => 'lmoasia';
  const uplight = nightGlowMaterial(0xb8ffcf, 0.5, { base: 0x4b7a32, rough: 0.92 });       // planted terraces, glowing at night
  const crownLight = nightGlowMaterial(0xe8f4ff, 2.2, { base: 0xdfe4e6, rough: 0.3, metal: 0.6 }); // a lit crown, not a white-out
  const warmBand = nightGlowMaterial(0xffe7c2, 0.7, { base: 0xf2f2ee, rough: 0.5 });       // white slab edges washed with light at night
  const voidGlow = nightGlowMaterial(0xfff0d0, 0.75, { base: 0x2a3034, rough: 0.6 });       // ceilings of open sky gardens
  const exList = [];
  const colliders = [];
  const fins = [];   // instanced vertical fins: {x, z, y0, y1, ang}

  const addFins = (r, y0, y1, spacing = 2.2) => {
    const rr = signedArea(r) < 0 ? r.slice().reverse() : r;
    for (let i = 0; i < rr.length; i++) {
      const p = rr[i], q = rr[(i + 1) % rr.length]; const dx = q[0] - p[0], dz = q[1] - p[1]; const l = Math.hypot(dx, dz);
      if (l < 3) continue;
      const nx = dz / l, nz = -dx / l; const ang = Math.atan2(-dz, dx);
      const n = Math.max(1, Math.floor(l / spacing));
      for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; fins.push({ x: p[0] + dx * t + nx * 0.4, z: p[1] + dz * t + nz * 0.4, y0, y1, ang }); }
    }
  };
  const planterTop = (r, y, trees = 0, palms = 0, scale = 1) => {
    B.add(uplight, capGeometry(r, y));
    const c = areaCentroid(r);
    for (let i = 0; i < trees + palms; i++) {
      const p = r[(R() * r.length) | 0]; const k = 0.25 + R() * 0.55;
      const x = c[0] + (p[0] - c[0]) * k, z = c[1] + (p[1] - c[1]) * k;
      const parts = i < trees ? blobTree(x, y, z, scale * (0.8 + R() * 0.5), R) : palmGeometry(x, y, z, 4 + R() * 3, R);
      for (const g of parts) B.add(M.foliage, g);
    }
  };

  // ===================================================== CapitaSpring (88 Market St, 280 m)
  if (has(7585)) {
    const T = ring(7585);
    B.add(finGlass, extrudeFootprint(CAPITASPRING_SITE, 0, 22));
    B.add(M.planter, capGeometry(CAPITASPRING_SITE, 22.05));
    const oasis0 = 92, oasis1 = 114, top = 268;
    B.add(finGlass, extrudeFootprint(T, 22, oasis0, { top: false }));
    B.add(finGlass, extrudeFootprint(T, oasis1, top));
    addFins(T, 26, oasis0); addFins(T, oasis1, top - 0.5);
    // Green Oasis: four open storeys of jungle wrapped round a central core, with slender columns
    B.add(M.white, extrudeFootprint(offsetRing(T, 0.3), oasis0, oasis0 + 0.9));
    B.add(voidGlow, capGeometry(T, oasis1 - 0.05, true));
    B.add(M.darkGlass, extrudeFootprint(offsetRing(T, -9), oasis0, oasis1, { top: false }));
    planterTop(offsetRing(T, -0.5), oasis0 + 0.95, 44, 6, 1.8);
    B.add(M.planter, extrudeFootprint(offsetRing(T, -9.2), oasis0 + 1, oasis1 - 1, { top: false }));
    for (const [x, z] of resampleRing(T, 22)) { const g = new THREE.CylinderGeometry(0.45, 0.45, oasis1 - oasis0, 8); g.translate(x, (oasis0 + oasis1) / 2, z); B.add(M.white, g); }
    // hanging vines down the oasis edge
    B.add(M.planter, sidesOnly(offsetRing(T, 0.25), oasis1 - 3.2, oasis1 - 0.2));
    // rooftop sky garden inside an open frame + crown lights
    planterTop(T, top, 14, 0, 1.1);
    for (const [x, z] of resampleRing(T, 18)) { const g = new THREE.BoxGeometry(0.5, 12, 0.5); g.translate(x, top + 6, z); B.add(M.white, g); }
    B.add(crownLight, sidesOnly(offsetRing(T, 0.05), top + 11, top + 12));
    B.add(crownLight, sidesOnly(offsetRing(T, 0.05), top - 0.6, top));
    exList.push(byId.get(7585));
    colliders.push(boxCollider(CAPITASPRING_SITE, 0, 22), boxCollider(T, 22, 280));
  }

  // ===================================================== Guoco Tower (Tanjong Pagar, 290 m)
  if (has(5706) && has(5709)) {
    const low = ring(5706), up = ring(5709), annex = has(5710) ? ring(5710) : null;
    B.add(finGlass, extrudeFootprint(low, 0, 180, { top: true }));
    if (annex) { B.add(finGlass, extrudeFootprint(annex, 0, 100)); planterTop(annex, 100.05, 8, 0); }
    B.add(finGlass, extrudeFootprint(up, 180, 282));
    addFins(low, 8, 180, 1.9); addFins(up, 180, 282, 1.9);
    // stepped crown: three receding tiers with lit edges
    const c1 = offsetRing(up, -2.5), c2 = offsetRing(up, -6);
    B.add(finGlass, extrudeFootprint(c1, 282, 286.5)); B.add(finGlass, extrudeFootprint(c2, 286.5, 290));
    for (const [r, y] of [[up, 282], [c1, 286.5], [c2, 290]]) B.add(crownLight, sidesOnly(offsetRing(r, 0.06), y - 0.5, y));
    exList.push(...[5706, 5709, 5710].filter(has).map(i => byId.get(i)));
    colliders.push(boxCollider(low, 0, 180), boxCollider(up, 180, 290));
    if (annex) colliders.push(boxCollider(annex, 0, 100));
  }

  // ===================================================== Oasia Hotel Downtown (red mesh, sky gardens)
  if (has(5708)) {
    const O = ring(5708);
    const P = pca(O);
    const ux = P.dir[0], uz = P.dir[1], vx = -uz, vz = ux;
    const corner = (su, sv, s = 6.5) => { const hx = P.len / 2 - s - 4.5, hz = P.wid / 2 - s - 4.5; return rectPoly(P.c[0] + ux * su * hx + vx * sv * hz, P.c[1] + uz * su * hx + vz * sv * hz, s, s, Math.atan2(-uz, ux)); };
    const cores = [corner(1, 1), corner(1, -1), corner(-1, 1), corner(-1, -1)];
    const solids = [[0, 26], [32, 64], [74, 118], [130, 172]];
    const voids = [[26, 32], [64, 74], [118, 130], [172, 193]];
    for (const [a, b] of solids) {
      B.add(oasiaMesh, facadeUV(extrudeFootprint(O, a, b, { top: false })));
      B.add(M.concrete, capGeometry(O, a + 0.05, true));
      B.add(M.concrete, capGeometry(O, b, false));
    }
    for (const [a, b] of voids) {
      for (const c of cores) B.add(oasiaMesh, facadeUV(extrudeFootprint(c, a, b, { top: b === 193 })));
      B.add(M.planter, extrudeFootprint(offsetRing(O, -14), a, b, { top: false }));
      planterTop(offsetRing(O, -0.8), a + 0.1, 16, 4, 1.6);
      if (b !== 193) B.add(voidGlow, capGeometry(O, b - 0.05, true));
    }
    // open crown frame at the top
    B.add(oasiaMesh, facadeUV(sidesOnly(O, 189, 193)));
    B.add(oasiaMesh, facadeUV(sidesOnly(offsetRing(O, -1.2), 189, 193)));
    exList.push(byId.get(5708));
    colliders.push(boxCollider(O, 0, 193));
  }

  // ===================================================== PARKROYAL COLLECTION Pickering
  if (has(5725)) {
    // contoured, terraced podium (five wavy "rice terraces" stepping back with cascading greenery)
    const site = resampleRing(PICKERING_SITE, 140);
    const terraceRings = [];
    for (let k = 0; k < 6; k++) {
      const phase = k * 1.3;
      terraceRings.push(offsetRing(site, (i, n) => -(k * 1.5 + (k ? 1.1 + 1.1 * Math.sin(i / n * Math.PI * 14 + phase) + 0.6 * Math.sin(i / n * Math.PI * 5 - phase) : 0))));
    }
    for (let k = 0; k < 5; k++) {
      const y0 = k * 5.2, y1 = y0 + 4.2;
      B.add(M.darkGlass, sidesOnly(terraceRings[k], y0, y1));
      B.add(warmBand, sidesOnly(offsetRing(terraceRings[k], 0.7), y1, y1 + 1.0));
      B.add(M.planter, sidesOnly(offsetRing(terraceRings[k], 0.75), y1 - 1.6, y1));
      B.add(uplight, capGeometry(offsetRing(terraceRings[k], 0.7), y1 + 1.0));
    }
    // three tower blocks with horizontal white bands
    for (const id of [5721, 5722, 5723, 5724, 5725]) if (has(id)) {
      const b = byId.get(id); const r = ring(id);
      B.add(pickGlass, extrudeFootprint(r, 26, b.h));
      planterTop(r, b.h + 0.05, 3, 4);
      colliders.push(boxCollider(r, 26, b.h));
    }
    // sky gardens: curvy white-edged terraces with palms and cascading plants
    for (const id of [8381, 8382, 8383, 8384, 8385, 8386, 8387, 8388, 8389, 8390, 8391, 8392, 8393, 8394, 8395]) if (has(id)) {
      const b = byId.get(id); const r = ring(id); const y = b.m || 32.6;
      B.add(warmBand, extrudeFootprint(offsetRing(r, 0.4), y - 0.4, y + 0.9, { top: false, bottom: true }));
      B.add(M.planter, sidesOnly(offsetRing(r, 0.45), y - 2.2, y - 0.4));
      planterTop(r, y + 0.9, 1, 3);
    }
    exList.push(...[5721, 5722, 5723, 5724, 5725, 7740, 8381, 8382, 8383, 8384, 8385, 8386, 8387, 8388, 8389, 8390, 8391, 8392, 8393, 8394, 8395].filter(has).map(i => byId.get(i)));
    colliders.push(boxCollider(PICKERING_SITE, 0, 26));
  }

  // ===================================================== The Pinnacle@Duxton (7 towers, skybridges at 26th & 50th)
  {
    B.add(M.concrete, extrudeFootprint(PINNACLE_PODIUM, 0, 6, { top: false }));
    B.add(uplight, capGeometry(PINNACLE_PODIUM, 6));
    for (const r of PINNACLE_TOWERS) {
      B.add(hdb, extrudeFootprint(r, 0, 150));
      colliders.push(boxCollider(r, 0, 150));
    }
    const bridgeIds = [];
    for (let id = 8323; id <= 8338; id++) if (has(id)) bridgeIds.push(id);
    for (const id of bridgeIds) {
      const b = byId.get(id); const r = ring(id); const y0 = b.m;
      B.add(M.concrete, extrudeFootprint(r, y0, y0 + 2.2));
      B.add(warmBand, sidesOnly(offsetRing(r, 0.15), y0 + 1.6, y0 + 2.2));
      B.add(M.planter, capGeometry(offsetRing(r, -0.8), y0 + 2.3));
      if (y0 > 140) for (let i = 0; i < 2; i++) { const c = centroidOf(r); for (const g of blobTree(c[0] + (R() - 0.5) * 6, y0 + 2.2, c[1] + (R() - 0.5) * 6, 1.1, R)) B.add(M.foliage, g); }
    }
    // roof plant rooms of each tower (OSM parts 150-156)
    for (const id of [5418, 5419, 5420, 5435, 5436, 5437, 5438, 5439]) if (has(id)) { const b = byId.get(id); B.add(M.concrete, extrudeFootprint(ring(id), b.m, b.h)); exList.push(b); }
    // sky park railings along the 50th storey: crown light at night
    for (const r of PINNACLE_TOWERS) B.add(crownLight, sidesOnly(offsetRing(r, 0.1), 149.4, 150));
    exList.push(...bridgeIds.map(i => byId.get(i)));
  }

  // ===================================================== Marina One: louvred residences + the green Heart
  {
    for (const id of [6168, 6169]) if (has(id)) {
      const b = byId.get(id); const r = ring(id);
      B.add(louvre, extrudeFootprint(r, 0, b.h));
      for (let y = 14; y < b.h - 6; y += 13.2) {
        const lr = offsetRing(r, 1.1);
        B.add(warmBand, sidesOnly(lr, y, y + 0.7));
        B.add(M.planter, capGeometry(lr, y + 0.72));
      }
      planterTop(r, b.h + 0.05, 10, 0);
      exList.push(b); colliders.push(boxCollider(r, 0, b.h));
    }
    // the Heart: terraced garden valley rising towards the four towers
    const hc = [451, 1080];
    const shape = (rad, k) => { const out = []; for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2; const rr = rad * (1 + 0.13 * Math.sin(3 * a + k) + 0.06 * Math.sin(5 * a - k * 0.7)); out.push([hc[0] + Math.cos(a) * rr, hc[1] + Math.sin(a) * rr]); } return out; };
    B.add(M.planter, capGeometry(shape(15, 0), 0.15));
    for (let k = 0; k < 5; k++) {
      const outer = shape(31 - k * 0.2, k * 0.3), inner = shape(15 + k * 3.2, k * 0.6), h = 4 + k * 5;
      // annulus top
      const tris = THREE.ShapeUtils.triangulateShape(outer.map(p => new THREE.Vector2(p[0], p[1])), [inner.map(p => new THREE.Vector2(p[0], p[1]))]);
      const all = [...outer, ...inner]; const pos = [];
      for (const t of tris) for (const q of t) pos.push(all[q][0], h, all[q][1]);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
      const nn = g.attributes.normal.array; if (nn[1] < 0) { for (let i = 0; i < nn.length; i++) nn[i] = -nn[i]; const pp = g.attributes.position.array; for (let t = 0; t < pp.length / 9; t++) for (let q = 0; q < 3; q++) { const A = t * 9 + 3 + q, B2 = t * 9 + 6 + q; [pp[A], pp[B2]] = [pp[B2], pp[A]]; } g.computeVertexNormals(); }
      B.add(uplight, g);
      B.add(warmBand, sidesOnly(inner, h - 1.0, h));
      B.add(M.darkGlass, sidesOnly(offsetRing(inner, -0.2), h - 5, h - 1));
      for (let i = 0; i < 6; i++) { const p = inner[(R() * inner.length) | 0]; const a = R(); const x = lerp(p[0], hc[0] + (p[0] - hc[0]) * 1.6, a * 0.4 + 0.1), z = lerp(p[1], hc[1] + (p[1] - hc[1]) * 1.6, a * 0.4 + 0.1); for (const gg of blobTree(x, h, z, 1.2, R)) B.add(M.foliage, gg); }
    }
  }

  // ===================================================== MBFC wave crowns (Tower 1, Tower 2, Marina Bay Residences)
  for (const id of [156, 157, 158]) if (has(id)) {
    const b = byId.get(id); const r = ring(id); const P = pca(r);
    const top = (x, z) => { const u = ((x - P.c[0]) * P.dir[0] + (z - P.c[1]) * P.dir[1]) / (P.len / 2); return b.h + 3 + 12 * smooth(Math.min(1, Math.max(0, (u + 1) / 2))); };
    const rr = signedArea(r) < 0 ? r.slice().reverse() : r;
    const pos = [];
    for (let i = 0; i < rr.length; i++) {
      const p = rr[i], q = rr[(i + 1) % rr.length]; const tp = top(p[0], p[1]), tq = top(q[0], q[1]);
      pos.push(p[0], b.h, p[1], q[0], b.h, q[1], q[0], tq, q[1], p[0], b.h, p[1], q[0], tq, q[1], p[0], tp, p[1]);
    }
    const tris = THREE.ShapeUtils.triangulateShape(rr.map(p => new THREE.Vector2(p[0], p[1])), []);
    for (const t of tris) for (const k of t) pos.push(rr[k][0], top(rr[k][0], rr[k][1]), rr[k][1]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    // orient: walls outward, top upward
    const nn = g.attributes.normal.array, pp = g.attributes.position.array; const c = areaCentroid(r);
    for (let t = 0; t < pp.length / 9; t++) {
      const cx = (pp[t * 9] + pp[t * 9 + 3] + pp[t * 9 + 6]) / 3, cz = (pp[t * 9 + 2] + pp[t * 9 + 5] + pp[t * 9 + 8]) / 3;
      const isTop = t >= rr.length * 2;
      const want = isTop ? nn[t * 9 + 1] : (cx - c[0]) * nn[t * 9] + (cz - c[1]) * nn[t * 9 + 2];
      if (want < 0) for (let q = 0; q < 3; q++) { const A = t * 9 + 3 + q, B2 = t * 9 + 6 + q; [pp[A], pp[B2]] = [pp[B2], pp[A]]; }
    }
    g.computeVertexNormals();
    B.add(M.darkGlass, g);
    // lit rim tracing the sloped top
    const rim = [];
    for (let i = 0; i < rr.length; i++) { const p = rr[i], q = rr[(i + 1) % rr.length]; const tp = top(p[0], p[1]), tq = top(q[0], q[1]); rim.push(p[0], tp - 0.8, p[1], q[0], tq - 0.8, q[1], q[0], tq, q[1], p[0], tp - 0.8, p[1], q[0], tq, q[1], p[0], tp, p[1]); }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rim, 3)); rg.computeVertexNormals();
    B.add(crownLight, rg);
  }

  // ---- instanced fins (one draw call for every finned tower)
  const finGeo = new THREE.BoxGeometry(0.22, 1, 0.75); finGeo.translate(0, 0.5, 0);
  const finMat = new THREE.MeshStandardMaterial({ color: 0xeff1f1, roughness: 0.35, metalness: 0.7 });
  const finInst = new THREE.InstancedMesh(finGeo, finMat, fins.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  fins.forEach((f, i) => { q.setFromAxisAngle(Y, f.ang); s.set(1, f.y1 - f.y0, 1); p.set(f.x, f.y0, f.z); finInst.setMatrixAt(i, m4.compose(p, q, s)); });
  finInst.instanceMatrix.needsUpdate = true; finInst.computeBoundingSphere(); finInst.castShadow = true; finInst.receiveShadow = true;

  const meshes = B.build({ name: 'skyline' });
  const group = new THREE.Group(); group.name = 'CBDSkyline';
  meshes.forEach(m => group.add(m)); group.add(finInst);
  const extra = [];
  extra.push(CAPITASPRING_SITE, PICKERING_SITE, ...PINNACLE_TOWERS);
  return {
    group, colliders, reflective: meshes,
    exclusions: [...extra, ...exclusionsForBuildings(exList.filter(Boolean))],
    pois: [
      { id: 'capitaspring', name: 'CapitaSpring', x: 125, y: 0, z: 300 },
      { id: 'guoco', name: 'Guoco Tower', x: -369, y: 0, z: 1102 },
      { id: 'oasia', name: 'Oasia Hotel Downtown', x: -515, y: 0, z: 1230 },
      { id: 'pickering', name: 'PARKROYAL COLLECTION Pickering', x: -300, y: 0, z: 160 },
      { id: 'pinnacle', name: 'The Pinnacle@Duxton', x: -860, y: 0, z: 1140 },
      { id: 'pinnacle_skybridge', name: 'Pinnacle@Duxton 50th Storey Skybridge', x: -858, y: 150, z: 1127 },
      { id: 'marinaone', name: 'Marina One', x: 451, y: 0, z: 1080 },
      { id: 'mbfc', name: 'Marina Bay Financial Centre', x: 580, y: 0, z: 790 },
    ],
  };
}
