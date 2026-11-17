// Marina Bay Sands: three 55-storey towers (straight west leg + curved east leg), the 340 m SkyPark "ship",
// and the rippling podium roofs. Positions derived from the OSM footprints of the towers / SkyPark.
import {
  THREE, U, Bucket, materials, facadeMaterial, nightGlowMaterial, extrudeProfile, frameMatrix, rng, smooth, lerp,
  ringOf, exclusionsForBuildings, signedArea, fixWinding, extrudeFootprint, capGeometry,
} from './common.js';

// local frame: +x = along the tower line (NNE), +z = east (towards Gardens by the Bay)
const AX = [0.397, -0.918];
const ORIGIN = [1309.0 + 0.918 * 2, 330.8 + 0.397 * 2];
const TOWERS = [-160, -50, 60];
const TW = 26;            // half width of a tower along the line
const TOP = 191;          // tower top / SkyPark underside
const DECK = 198.5;       // SkyPark deck level
const LEG = 14;           // leg thickness
const SPLAY = 27, JOIN = 74;

const offEast = y => (y < JOIN ? SPLAY * Math.pow(1 - y / JOIN, 2) : 0);

function skyParkHalfWidth(u) {
  const S = -196, N = 146, body = 19;
  if (u < S + 14) { const t = (u - S) / 14; return body * Math.sqrt(Math.max(0, 1 - Math.pow(1 - t, 2))) * 0.85 + body * 0.15 * t; }
  if (u > 84) { const t = (u - 84) / (N - 84); return Math.max(0.5, body * Math.pow(Math.max(0, 1 - Math.pow(t, 2.4)), 0.55) * (1 - 0.25 * t)); }
  return body;
}

const LASER_WIDTH = 0.45, LASER_MIN_PX = 1.4;
/** n beams of length `len` (world space) drawn as one mesh: ribbons facing the camera, origin[i] / dir[i] set per frame */
class Lasers {
  constructor(n, len) {
    this.origin = Array.from({ length: n }, () => new THREE.Vector3());
    this.dir = Array.from({ length: n }, () => new THREE.Vector3(0, 1, 0));
    const SEG = 8, beam = [], idx = [];
    for (let i = 0; i < n; i++) for (let k = 0; k <= SEG; k++) {
      const v = beam.length / 3;
      beam.push(i, k / SEG, -1, i, k / SEG, 1);
      if (k < SEG) idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(beam.length), 3)); // (placed in the shader)
    g.setAttribute('beam', new THREE.Float32BufferAttribute(beam, 3));
    g.setIndex(idx);
    this.uniforms = {
      uOrigin: { value: this.origin }, uDir: { value: this.dir }, uLen: { value: len }, uColor: { value: new THREE.Color(0x33ff88) },
      uOpacity: { value: 0 }, uPxH: { value: 1000 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        attribute vec3 beam; // beam index, distance along it (0..1), side of the ribbon (-1 / 1)
        uniform vec3 uOrigin[${n}], uDir[${n}]; uniform float uLen, uPxH;
        varying float vFade, vAcross;
        void main() {
          int i = int(beam.x + 0.5);
          vec4 mv = viewMatrix * vec4(uOrigin[i] + uDir[i] * (beam.y * uLen), 1.0);
          vec3 across = normalize(cross((viewMatrix * vec4(uDir[i], 0.0)).xyz, mv.xyz));
          // at least LASER_MIN_PX wide: metres per pixel at this depth from the projection and the target height
          float w = max(${LASER_WIDTH.toFixed(2)}, ${LASER_MIN_PX.toFixed(2)} * 2.0 * -mv.z / (projectionMatrix[1][1] * uPxH));
          mv.xyz += across * beam.z * w * 0.5;
          vFade = pow(1.0 - beam.y, 1.6); vAcross = beam.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; uniform float uOpacity;
        varying float vFade, vAcross;
        void main() { gl_FragColor = vec4(uColor * vFade * uOpacity * (1.0 - vAcross * vAcross), 1.0); }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.name = 'mbs-lasers'; this.mesh.frustumCulled = false; this.mesh.visible = false;
    // the render target being drawn (main or a post pass target) sets the pixel size
    const size = new THREE.Vector2();
    this.mesh.onBeforeRender = r => { const rt = r.getRenderTarget(); this.uniforms.uPxH.value = rt ? rt.height : r.getDrawingBufferSize(size).y; };
  }
}

export function buildMBS(city, quality) {
  const M = materials();
  // hotel towers at night: mostly dark glass with scattered warm rooms (many curtained), no glowing spandrels
  const towerMat = facadeMaterial({ wall: 0xd5dadc, glass: 0x3d5462, cell: [2.15, 3.47], frame: [0.02, 0.3, 0.02], lit: 0.24, seed: 3, bands: 1, litIntensity: 1.5, warm: 0xffb36b, glassRough: 0.06, wallGlow: 0.025 });
  const innerMat = facadeMaterial({ wall: 0x9aa3a8, glass: 0x2e3b42, cell: [3.0, 3.47], frame: [0.1, 0.3, 0.05], lit: 0.25, seed: 5, litIntensity: 1.6 });
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xe9ebec, roughness: 0.4, metalness: 0.35 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0xb59e80, roughness: 0.75 });
  const planter = new THREE.MeshStandardMaterial({ color: 0x4d7a35, roughness: 0.9 });
  // SkyPark at night: a crisp line of light under the hull and a softly washed edge band, not a white-out bar
  const underGlow = nightGlowMaterial(0xf4f1ff, 1.4, { base: 0xdfe3e6, rough: 0.4 });
  const bandGlow = nightGlowMaterial(0xfff4e6, 0.35, { base: 0xe9ebec, rough: 0.4, metal: 0.35 });
  const roofMetal = new THREE.MeshStandardMaterial({ color: 0xe4e6e6, roughness: 0.45, metalness: 0.35 });
  const roofGlass = new THREE.MeshStandardMaterial({ color: 0x9fb3ba, roughness: 0.1, metalness: 0.7 });
  // retail / expo glazing: tall panes, nearly all lit at night (not an office grid of lit and dark rooms)
  const podGlass = facadeMaterial({ wall: 0xd8dcde, glass: 0x5d7b86, cell: [4.5, 5.5], frame: [0.03, 0.06, 0.04], lit: 0.97, seed: 11, warm: 0xffeccc, cool: 0xfff4e0, litIntensity: 1.0, curtains: 0.05 });
  const pavilionMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.5 });

  const F = frameMatrix(ORIGIN[0], ORIGIN[1], AX[0], AX[1]);
  const B = new Bucket();

  // ---- towers
  const legSamples = 28;
  for (const uc of TOWERS) {
    const u0 = uc - TW, u1 = uc + TW;
    // west leg (straight) outer face a=-17, inner a=-3
    B.add(towerMat, extrudeProfile([[-17, 0], [-3, 0], [-3, TOP], [-17, TOP]], u0, u1), F);
    // east leg: curved, leaning onto the west leg
    const prof = [];
    for (let i = 0; i <= legSamples; i++) { const y = TOP * Math.pow(i / legSamples, 1.6); prof.push([17 + offEast(y), y]); }
    for (let i = legSamples; i >= 0; i--) { const y = TOP * Math.pow(i / legSamples, 1.6); prof.push([3 + offEast(y), y]); }
    // profile must be a simple polygon ordered around: outer edge up, inner edge down
    B.add(towerMat, extrudeProfile(prof.map(([a, y]) => [a, y]), u0, u1, { smoothDeg: 20 }), F);
    // the slot between the legs (dark recessed glass) + atrium glass at the base
    B.add(innerMat, extrudeProfile([[-3, JOIN], [3, JOIN], [3, TOP], [-3, TOP]], u0 + 1.5, u1 - 1.5), F);
    const atr = [];
    for (let i = 0; i <= 12; i++) { const y = JOIN * i / 12; atr.push([3 + offEast(y), y]); }
    atr.push([-3, JOIN], [-3, 0]);
    B.add(innerMat, extrudeProfile(atr, u0 + 3, u1 - 3), F);
    // crown slab under the SkyPark
    B.add(hullMat, extrudeProfile([[-18, TOP - 1.5], [18, TOP - 1.5], [18, TOP + 0.2], [-18, TOP + 0.2]], u0 - 0.5, u1 + 0.5), F);
  }

  // ---- SkyPark: deck, edge band, hull
  const N = 90;
  const us = []; for (let i = 0; i <= N; i++) us.push(lerp(-196, 146, i / N));
  const outline = [];
  for (const u of us) outline.push([u, -skyParkHalfWidth(u)]);
  for (let i = us.length - 1; i >= 0; i--) outline.push([us[i], skyParkHalfWidth(us[i])]);
  const yBottom = u => (u > 84 ? lerp(TOP - 0.5, TOP + 4.5, smooth(Math.min(1, (u - 84) / 62))) : TOP - 0.5);
  {
    const pos = [], nor = [], fac = [];
    // top deck
    const tris = THREE.ShapeUtils.triangulateShape(outline.map(p => new THREE.Vector2(p[0], p[1])), []);
    for (const t of tris) for (const k of t) { pos.push(outline[k][0], DECK, outline[k][1]); nor.push(0, 1, 0); fac.push(outline[k][0], outline[k][1]); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    B.add(deckMat, fixWinding(g), F);
    // edge band + hull loft (top ring at DECK-2 -> bottom ring inset)
    const ring = outline;
    const n = ring.length;
    const band = [], bandN = [], hull = [], hullN = [];
    const inset = 3.5;
    const bot = ring.map(([u, a]) => { const w = skyParkHalfWidth(u); const s = w > inset + 0.5 ? (w - inset) / w : 0.3; return [u, a * s, yBottom(u)]; });
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n; const p = ring[i], q = ring[j];
      const du = q[0] - p[0], da = q[1] - p[1]; const l = Math.hypot(du, da) || 1;
      const nx = da / l, nz = -du / l; // outward (ring is CW/CCW unknown; fixWinding handles)
      const quad = (A, Bq, C, D, arr, narr, nn) => { for (const v of [A, Bq, C, A, C, D]) { arr.push(...v); narr.push(...nn); } };
      quad([p[0], DECK - 2.2, p[1]], [q[0], DECK - 2.2, q[1]], [q[0], DECK + 1.1, q[1]], [p[0], DECK + 1.1, p[1]], band, bandN, [nx, 0, nz]);
      const pb = bot[i], qb = bot[j];
      quad([pb[0], pb[2], pb[1]], [qb[0], qb[2], qb[1]], [q[0], DECK - 2.2, q[1]], [p[0], DECK - 2.2, p[1]], hull, hullN, [nx * 0.6, -0.8, nz * 0.6]);
    }
    // outward check for band normals using signed area
    const sA = signedArea(ring.map(([u, a]) => [u, a]));
    const flip = sA < 0 ? -1 : 1;
    for (let i = 0; i < bandN.length; i += 3) { bandN[i] *= flip; bandN[i + 2] *= flip; }
    for (let i = 0; i < hullN.length; i += 3) { hullN[i] *= flip; hullN[i + 2] *= flip; }
    const gb = new THREE.BufferGeometry(); gb.setAttribute('position', new THREE.Float32BufferAttribute(band, 3)); gb.setAttribute('normal', new THREE.Float32BufferAttribute(bandN, 3));
    B.add(bandGlow, fixWinding(gb), F);
    const gh = new THREE.BufferGeometry(); gh.setAttribute('position', new THREE.Float32BufferAttribute(hull, 3)); gh.setAttribute('normal', new THREE.Float32BufferAttribute(hullN, 3));
    B.add(hullMat, fixWinding(gh), F);
    // underside plate
    const bt = THREE.ShapeUtils.triangulateShape(bot.map(p => new THREE.Vector2(p[0], p[1])), []);
    const up = [], un = [];
    for (const t of bt) for (const k of t) { up.push(bot[k][0], bot[k][2], bot[k][1]); un.push(0, -1, 0); }
    const gu = new THREE.BufferGeometry(); gu.setAttribute('position', new THREE.Float32BufferAttribute(up, 3)); gu.setAttribute('normal', new THREE.Float32BufferAttribute(un, 3));
    B.add(hullMat, fixWinding(gu), F);
    // underside light strips along both bottom edges
    const strip = (side) => {
      const sp = [], sn = [];
      for (let i = 0; i < us.length - 1; i++) {
        const ua = us[i], ub = us[i + 1];
        const wa = skyParkHalfWidth(ua), wb = skyParkHalfWidth(ub);
        const sa = wa > inset + 0.5 ? wa - inset : wa * 0.3, sb = wb > inset + 0.5 ? wb - inset : wb * 0.3;
        const A = [ua, yBottom(ua) - 0.05, side * sa], Bq = [ub, yBottom(ub) - 0.05, side * sb];
        const C = [ub, yBottom(ub) - 0.05, side * (sb - 1.2)], D = [ua, yBottom(ua) - 0.05, side * (sa - 1.2)];
        for (const v of [A, Bq, C, A, C, D]) { sp.push(...v); sn.push(0, -1, 0); }
      }
      const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); g2.setAttribute('normal', new THREE.Float32BufferAttribute(sn, 3));
      return fixWinding(g2);
    };
    B.add(underGlow, strip(1), F); B.add(underGlow, strip(-1), F);
  }
  // infinity pool along the west (city-facing) edge, in three basins
  for (const [a0, a1] of [[-186, -136], [-133, -84], [-81, -32]]) {
    const g = new THREE.BoxGeometry(a1 - a0, 0.3, 9.5);
    g.translate((a0 + a1) / 2, DECK + 0.05, -12.5);
    B.add(M.pool, g, F);
  }
  // planter strips (greenery along the east edge and the spine of the deck)
  for (const [u0, u1, a, w] of [[-190, 80, 15.2, 2.6], [-180, -40, -5.5, 1.6], [-20, 70, 0.5, 2.0]]) {
    const g = new THREE.BoxGeometry(u1 - u0, 0.7, w); g.translate((u0 + u1) / 2, DECK + 0.35, a);
    B.add(planter, g, F);
  }
  // pavilions and gardens on the deck
  const R = rng(42);
  for (const [u0, len, a] of [[-20, 26, 8], [12, 18, 9], [40, 34, 7], [92, 22, 2], [-120, 14, 10], [-70, 16, 10]]) {
    const g = new THREE.CylinderGeometry(1, 1, 1, 16, 1);
    // barrel-vault pavilion
    const shape = new THREE.Shape(); shape.moveTo(-4, 0); shape.lineTo(4, 0); shape.quadraticCurveTo(4, 4.5, 0, 5.2); shape.quadraticCurveTo(-4, 4.5, -4, 0);
    const pg = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 8 });
    pg.rotateY(Math.PI / 2); pg.translate(u0, DECK, a);
    B.add(pavilionMat, pg, F);
    g.dispose();
  }
  // trees on the deck
  const treeGeo = new THREE.IcosahedronGeometry(1, 1);
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, 2.4, 5);
  for (let i = 0; i < (quality === 'low' ? 18 : 46); i++) {
    const u = lerp(-188, 80, R());
    const a = lerp(-2, 16, R());
    if (a < 0 && u < -30) continue;
    const s = 1.4 + R() * 1.2;
    const t = treeGeo.clone(); t.scale(s, s * 0.8, s); t.translate(u, DECK + 2.4 + s * 0.6, a);
    const col = new THREE.Color().setHSL(0.27 + R() * 0.06, 0.45, 0.22 + R() * 0.08);
    const c = new Float32Array(t.attributes.position.count * 3); for (let k = 0; k < c.length; k += 3) { c[k] = col.r; c[k + 1] = col.g; c[k + 2] = col.b; }
    t.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    B.add(M.foliage, t, F);
    const tr = trunkGeo.clone(); tr.translate(u, DECK + 1.2, a); B.add(M.deck, tr, F);
  }

  // ---- podium: the Shoppes / Expo blocks (OSM 7323-7325, drawn by the city as 25 m office slabs) rebuilt as glazed
  // 16.5 m podiums under the four rippling wave roofs that replace the OSM skillion strips 7053..7095
  const byId = new Map(city.buildings.map(b => [b.id, b]));
  const PODIUM = [7323, 7324, 7325], PODIUM_H = 16.5;
  const podiumColliders = [];
  for (const id of PODIUM) {
    const b = byId.get(id); if (!b) continue;
    const r = ringOf(b);
    B.add(podGlass, extrudeFootprint(r, 0, PODIUM_H, { top: false }));
    B.add(roofMetal, capGeometry(r, PODIUM_H));
    const g = extrudeFootprint(r, 0, PODIUM_H);
    podiumColliders.push({ type: 'trimesh', vertices: new Float32Array(g.attributes.position.array), indices: new Uint32Array([...Array(g.attributes.position.count).keys()]) });
  }
  const groups = [[7053, 7062], [7063, 7068], [7069, 7082], [7083, 7095]];
  const waveIds = [];
  const pcaOf = b => {
    const r = ringOf(b); let cx = 0, cz = 0; for (const p of r) { cx += p[0]; cz += p[1]; } cx /= r.length; cz /= r.length;
    let sxx = 0, szz = 0, sxz = 0; for (const [x, z] of r) { const dx = x - cx, dz = z - cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
    const a = 0.5 * Math.atan2(2 * sxz, sxx - szz); const ux = Math.cos(a), uz = Math.sin(a);
    let mn = 1e9, mx = -1e9, mn2 = 1e9, mx2 = -1e9;
    for (const [x, z] of r) { const u = (x - cx) * ux + (z - cz) * uz, v = -(x - cx) * uz + (z - cz) * ux; mn = Math.min(mn, u); mx = Math.max(mx, u); mn2 = Math.min(mn2, v); mx2 = Math.max(mx2, v); }
    let dx = ux, dz = uz; if (dx < 0) { dx = -dx; dz = -dz; } // point roughly east (away from the bay)
    return { c: [cx + ux * (mn + mx) / 2 - uz * (mn2 + mx2) / 2, cz + uz * (mn + mx) / 2 + ux * (mn2 + mx2) / 2], d: [dx, dz], len: mx - mn, wid: mx2 - mn2, h: b.h };
  };
  for (const [g0, g1] of groups) {
    const strips = [];
    for (let id = g0; id <= g1; id++) { const b = byId.get(id); if (b) { strips.push(pcaOf(b)); waveIds.push(id); } }
    if (strips.length < 2) continue;
    // densify between strips
    const rows = [];
    for (let k = 0; k < strips.length; k++) {
      const s = strips[k];
      // extend the outer strips half a width outward along the group direction so the roof covers the slices
      rows.push(s);
      if (k < strips.length - 1) {
        const t = strips[k + 1];
        for (const f of [1 / 3, 2 / 3]) rows.push({ c: [lerp(s.c[0], t.c[0], f), lerp(s.c[1], t.c[1], f)], d: [lerp(s.d[0], t.d[0], f), lerp(s.d[1], t.d[1], f)], len: lerp(s.len, t.len, f), h: lerp(s.h, t.h, f) });
      }
    }
    const cols = 16;
    const P = (row, t) => {
      const l = Math.hypot(row.d[0], row.d[1]);
      const dx = row.d[0] / l, dz = row.d[1] / l;
      const x = row.c[0] + dx * (t - 0.5) * row.len, z = row.c[1] + dz * (t - 0.5) * row.len;
      const y = 15 + (row.h - 15) * (0.32 + 0.68 * Math.sin(Math.min(1, t * 1.05) * Math.PI * 0.5));
      return [x, y, z];
    };
    const pos = [], nor = [];
    const push = (a, b, c) => { pos.push(...a, ...b, ...c); };
    for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < cols; c++) {
      const a = P(rows[r], c / cols), b = P(rows[r], (c + 1) / cols), cc = P(rows[r + 1], c / cols), d = P(rows[r + 1], (c + 1) / cols);
      push(a, cc, b); push(b, cc, d);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    // ensure normals point up
    const nn = geo.attributes.normal.array; let up = 0; for (let i = 1; i < nn.length; i += 3) up += nn[i];
    if (up < 0) { const p2 = geo.attributes.position.array; for (let i = 0; i < p2.length; i += 9) for (let k = 0; k < 3; k++) { const t = p2[i + 3 + k]; p2[i + 3 + k] = p2[i + 6 + k]; p2[i + 6 + k] = t; } geo.computeVertexNormals(); }
    B.add(roofMetal, geo);
    // glass skylight ribs: thin raised strips every third row
    for (let r = 1; r < rows.length - 1; r += 3) {
      const sp = [];
      for (let c = 0; c < cols; c++) {
        const a = P(rows[r], c / cols), b = P(rows[r], (c + 1) / cols);
        const w = 1.6; const row = rows[r]; const l = Math.hypot(row.d[0], row.d[1]);
        const nx = -row.d[1] / l * w, nz = row.d[0] / l * w;
        const A = [a[0] - nx, a[1] + 0.25, a[2] - nz], Bq = [b[0] - nx, b[1] + 0.25, b[2] - nz], C = [b[0] + nx, b[1] + 0.25, b[2] + nz], D = [a[0] + nx, a[1] + 0.25, a[2] + nz];
        sp.push(...A, ...C, ...Bq, ...A, ...D, ...C);
      }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.computeVertexNormals();
      const n2 = sg.attributes.normal.array; let u2 = 0; for (let i = 1; i < n2.length; i += 3) u2 += n2[i];
      if (u2 < 0) for (let i = 0; i < n2.length; i++) n2[i] = -n2[i];
      B.add(roofGlass, sg);
    }
    // glazed walls under the highest edge (t = 1) and along the first/last strips, a clerestory over the podium roof
    // along the lowest edge
    const wall = [], wallF = [];
    const addWall = (pts, y0 = 0) => {
      let s = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1]; const l = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const q = [[a[0], y0, a[2], s], [b[0], y0, b[2], s + l], [b[0], b[1], b[2], s + l], [a[0], a[1], a[2], s]];
        for (const k of [0, 1, 2, 0, 2, 3]) { wall.push(q[k][0], q[k][1], q[k][2]); wallF.push(q[k][3], q[k][1]); }
        s += l;
      }
    };
    addWall(rows.map(r => P(r, 1)));
    addWall([...Array(cols + 1).keys()].map(c => P(rows[0], c / cols)));
    addWall([...Array(cols + 1).keys()].map(c => P(rows[rows.length - 1], c / cols)));
    addWall(rows.map(r => P(r, 0)), PODIUM_H);
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wall, 3)); wg.setAttribute('facade', new THREE.Float32BufferAttribute(wallF, 2));
    wg.computeVertexNormals();
    // double-sided feel: duplicate reversed
    const wp = wg.attributes.position.array, wf = wg.attributes.facade.array;
    const rp = new Float32Array(wp.length), rf = new Float32Array(wf.length);
    for (let i = 0; i < wp.length / 9; i++) { for (const [d, s] of [[0, 0], [1, 2], [2, 1]]) { rp.set(wp.subarray((i * 3 + s) * 3, (i * 3 + s) * 3 + 3), (i * 3 + d) * 3); rf.set(wf.subarray((i * 3 + s) * 2, (i * 3 + s) * 2 + 2), (i * 3 + d) * 2); } }
    const wg2 = new THREE.BufferGeometry(); wg2.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); wg2.setAttribute('facade', new THREE.Float32BufferAttribute(rf, 2)); wg2.computeVertexNormals();
    B.add(podGlass, wg); B.add(podGlass, wg2);
  }

  const meshes = B.build({ name: 'mbs' });
  const group = new THREE.Group(); group.name = 'MarinaBaySands';
  for (const m of meshes) group.add(m);

  // ---- Spectra light & water show: thin additive beams from the SkyPark fanning out over the bay toward the Event
  // Plaza waterfront (shallow angles, sweeping), fading along their length like light scattered by humid air.
  // All beams are one mesh of camera-facing ribbons: a 0.45 m beam is a fraction of a pixel across the bay on a phone
  // (it broke up into dashes), so each ribbon is widened to at least LASER_MIN_PX on screen.
  const spectra = (city.pois || []).find(p => p.n === 'Spectra') || { x: 994.4, z: 285.8 };
  const lasers = new Lasers(8, 900);
  const aims = [];
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Vector3(lerp(-150, 90, i / 7), DECK + 1, -12).applyMatrix4(F);
    lasers.origin[i].copy(p);
    // home azimuth: toward the Event Plaza, spread a little per beam
    aims.push(Math.atan2(spectra.x - p.x, spectra.z - p.z) + (i - 3.5) * 0.07);
  }
  const beams = lasers.mesh;
  group.add(beams);

  // colliders: legs as boxes (curved leg approximated by stacked boxes), crown/skypark
  const colliders = [...podiumColliders];
  const yaw = Math.atan2(-AX[1], AX[0]);
  const toWorld = (u, y, a) => new THREE.Vector3(u, y, a).applyMatrix4(F);
  for (const uc of TOWERS) {
    const c = toWorld(uc, TOP / 2, -10); colliders.push({ type: 'box', center: [c.x, c.y, c.z], half: [TW, TOP / 2, 7], yaw });
    for (let k = 0; k < 4; k++) {
      const y0 = k * JOIN / 4, y1 = (k + 1) * JOIN / 4; const a = 10 + offEast((y0 + y1) / 2);
      const cc = toWorld(uc, (y0 + y1) / 2, a); colliders.push({ type: 'box', center: [cc.x, cc.y, cc.z], half: [TW, (y1 - y0) / 2, 7.5], yaw });
    }
    const cu = toWorld(uc, (JOIN + TOP) / 2, 10); colliders.push({ type: 'box', center: [cu.x, cu.y, cu.z], half: [TW, (TOP - JOIN) / 2, 7], yaw });
  }
  { const c = toWorld(-25, (TOP + DECK) / 2, 0); colliders.push({ type: 'box', center: [c.x, c.y, c.z], half: [171, (DECK - TOP) / 2 + 0.5, 19], yaw }); }

  const ex = exclusionsForBuildings(city.buildings.filter(b => [153, 154, 830, 831, ...PODIUM].includes(b.id) || waveIds.includes(b.id) || /^Marina Bay Sands Tower|^SkyPark$/.test(b.n || '')));
  const sky = toWorld(110, DECK + 1, 0), lobby = toWorld(-50, 0, -30), base = toWorld(-50, 0, 0);
  const pois = [
    { id: 'mbs', name: 'Marina Bay Sands', x: base.x, y: 0, z: base.z },
    { id: 'mbs_lobby', name: 'Marina Bay Sands Hotel Lobby', x: lobby.x, y: 0, z: lobby.z },
    { id: 'skypark', name: 'Sands SkyPark', x: sky.x, y: sky.y, z: sky.z },
  ];

  function update(dt, env) {
    const t = U.time.value;
    // Spectra light & water show at 20:00 and 21:00 (env.forceShow for testing)
    const h = env.time ?? 12;
    const show = (h >= 20 && h < 20.25) || (h >= 21 && h < 21.25) || env.forceShow;
    const u = lasers.uniforms;
    u.uOpacity.value += ((show ? 0.5 : 0) - u.uOpacity.value) * Math.min(1, dt * 2);
    beams.visible = u.uOpacity.value > 0.01;
    if (beams.visible) {
      u.uColor.value.setHSL((t * 0.05) % 1, 1, 0.55);
      for (let i = 0; i < aims.length; i++) {
        const phase = i * 0.7, az = aims[i] + Math.sin(t * 0.45 + phase) * 0.55;
        // from slightly down onto the water to a few degrees above the horizon
        const tilt = -0.2 + 0.26 * (0.5 + 0.5 * Math.sin(t * 0.31 + phase * 1.7));
        lasers.dir[i].set(Math.sin(az) * Math.cos(tilt), Math.sin(tilt), Math.cos(az) * Math.cos(tilt));
      }
    }
  }

  // (the beams mirror in the bay too)
  return { group, exclusions: ex, colliders, pois, reflective: [...meshes, beams], update };
}
