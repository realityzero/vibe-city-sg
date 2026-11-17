// Gardens by the Bay: Supertree Grove (instanced), OCBC Skyway, Flower Dome and Cloud Forest gridshell conservatories.
import {
  THREE, U, Bucket, materials, canvasTexture, rng, lerp, smooth, ringOf, areaCentroid, resampleRing, exclusionsForBuildings,
  tubeAlong, circlePoly, signedArea, domeGeometry,
} from './common.js';

// Supertree Grove trees (x, z, height) from the OSM building:part stacks
const GROVE = [
  [1662, 559, 50], [1688, 517, 45], [1639, 599, 36], [1684, 591, 41], [1631, 630, 36], [1714, 498, 41],
  [1715, 580, 41], [1722, 532, 41], [1705, 553, 41], [1652, 505, 41], [1623, 520, 41], [1610, 553, 41],
];
// Golden / Silver garden supertrees (approximate positions south of the grove)
const OUTLIERS = [[1745, 655, 28], [1770, 640, 25], [1758, 676, 26], [1555, 640, 27], [1580, 662, 25], [1540, 668, 26]];

const LATTICE_TEX = 256;
function latticeTexture() {
  return canvasTexture(LATTICE_TEX, LATTICE_TEX, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 9; ctx.lineCap = 'round';
    for (let i = -4; i <= 8; i++) {
      ctx.beginPath(); ctx.moveTo(i * w / 4, 0); ctx.lineTo(i * w / 4 + w, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i * w / 4, h); ctx.lineTo(i * w / 4 + w, 0); ctx.stroke();
    }
    ctx.lineWidth = 6;
    for (let j = 0; j <= 4; j++) { ctx.beginPath(); ctx.moveTo(0, j * h / 4); ctx.lineTo(w, j * h / 4); ctx.stroke(); }
  }, { srgb: false });
}
function foliageTexture() {
  // the trunks' vertical gardens: ferns, bromeliads and orchids in many greens, with purple / pink / yellow flowers
  return canvasTexture(256, 256, (ctx, w, h) => {
    const R = rng(77);
    ctx.fillStyle = '#3f6f2e'; ctx.fillRect(0, 0, w, h);
    const cols = ['#4f8a34', '#5f9e3c', '#3a6528', '#77a845', '#8fb84e', '#2f5a24', '#6a2f6e', '#b35a9a', '#d96ea6', '#e8c64a', '#c44f3a'];
    for (let i = 0; i < 1900; i++) {
      ctx.fillStyle = cols[(R() < 0.82 ? R() * 6 : 6 + R() * 5) | 0];
      const x = R() * w, y = R() * h, r = 2 + R() * 6, ry = r * (0.6 + R() * 0.8), a = R() * 3;
      for (const ox of [0, x < 8 ? w : x > w - 8 ? -w : null]) if (ox !== null) { ctx.beginPath(); ctx.ellipse(x + ox, y, r, ry, a, 0, Math.PI * 2); ctx.fill(); }
    }
  });
}

// canonical 50 m Supertree: a slender planted trunk (concrete core in a vertical garden) flaring into a wide steel
// funnel canopy with radial branches and a rim, a planted bowl on top
const ST_H = 50, ST_CANOPY = 32;
const trunkR = y => 1.9 + 1.1 * Math.exp(-y / 2.2) + 1.4 * Math.pow(smooth(Math.min(1, Math.max(0, (y - 18) / (ST_CANOPY - 18)))), 1.4);
const canopyR = t => trunkR(ST_CANOPY) + 9.6 * Math.pow(t, 1.5);
function supertreeTemplate() {
  const H = ST_H, top = ST_CANOPY;
  const prof = []; for (let i = 0; i <= 26; i++) { const y = i / 26 * (top + 1); prof.push(new THREE.Vector2(trunkR(y), y)); }
  const skin = new THREE.LatheGeometry(prof, 24);
  const su = skin.attributes.uv.array; for (let i = 0; i < su.length; i += 2) { su[i] *= 3; su[i + 1] *= 6; }
  const trunkLattice = new THREE.LatheGeometry(prof.map(p => new THREE.Vector2(p.x + 0.35, p.y)), 24);
  const tu = trunkLattice.attributes.uv.array; for (let i = 0; i < tu.length; i += 2) { tu[i] *= 3.5; tu[i + 1] *= 6.5; }
  // canopy: a funnel of lattice from the top of the trunk out to the rim
  const cprof = []; for (let i = 0; i <= 16; i++) { const t = i / 16; cprof.push(new THREE.Vector2(canopyR(t), top + t * (H - top))); }
  const canopy = new THREE.LatheGeometry(cprof, 40);
  const cu = canopy.attributes.uv.array; for (let i = 0; i < cu.length; i += 2) { cu[i] *= 14; cu[i + 1] *= 3; }
  const ribs = [];
  for (let k = 0; k < 16; k++) {
    const a = k / 16 * Math.PI * 2;
    ribs.push(tubeAlong(cprof.filter((_, i) => i % 2 === 0).map(p => new THREE.Vector3(Math.cos(a) * (p.x + 0.15), p.y, Math.sin(a) * (p.x + 0.15))), 0.24, 4));
  }
  const ring2 = new THREE.TorusGeometry(cprof[8].x + 0.15, 0.26, 5, 40); ring2.rotateX(Math.PI / 2); ring2.translate(0, cprof[8].y, 0);
  const rim = new THREE.TorusGeometry(cprof[16].x + 0.1, 0.4, 6, 48); rim.rotateX(Math.PI / 2); rim.translate(0, H, 0);
  // the planted crown: a shallow bowl closing the trunk under the funnel
  const bowl = new THREE.CylinderGeometry(trunkR(top + 1) + 0.6, trunkR(top + 1), 1.0, 24); bowl.translate(0, top + 0.6, 0);
  return { trunk: mergeList([skin, bowl]), lattice: mergeList([trunkLattice, canopy]), ribs: mergeList([...ribs, ring2]), rim };
}

function mergeList(list) {
  const out = list.map(g => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2)); return n; });
  return mergeSimple(out);
}
function mergeSimple(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); uv.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

// Supertree night lighting: each tree is washed from its foot by coloured uplights (the planted trunk glows, fading
// up its height), points of LED light sit on the lattice nodes (dots option), the canopy's steel catches a faint wash
// and its rim glows. Emission is tinted per instance (instanceColor) and fades with U.night; the shared uniforms below
// are driven by update() (calmer between shows, vivid during Garden Rhapsody).
const SHOW = { wash: { value: 0.25 }, dotI: { value: 2.0 }, dotDen: { value: 0.35 } };
// The lattice (lattice option) is shaped by its texture's alpha only (the steel keeps its colour). Up close it's a
// cutout with a pixel-wide anti-aliased edge; as the bars' spacing nears a few pixels a hard cutout aliased into moire,
// so the alpha hands over to the bars' average coverage (the mip-filtered alpha) and blends — hence transparent.
const LATTICE_ALPHA = /* glsl */`
  float latA = texture2D(map, vMapUv).a;
  float lod = log2(max(fwidth(vMapUv.x), fwidth(vMapUv.y)) * ${LATTICE_TEX}.0 + 1e-6), fw = fwidth(latA) + 1e-4;
  diffuseColor.a = mix(smoothstep(alphaTest - fw * 0.5, alphaTest + fw * 0.5, latA), latA, smoothstep(2.0, 3.5, lod));
  if (diffuseColor.a < 0.004) discard;`;
function showMaterial(params, glow, { dots = false, uplit = false, lattice = false } = {}) {
  const m = new THREE.MeshStandardMaterial(params);
  const uGlow = { value: glow };
  m.userData.glow = uGlow;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uNight: U.night, uGlow, uWash: SHOW.wash, uDotI: SHOW.dotI, uDotDen: SHOW.dotDen });
    if (uplit) sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vStY;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvStY = position.y / ${ST_H.toFixed(1)};`);
    if (lattice) sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '').replace('#include <alphatest_fragment>', LATTICE_ALPHA);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uNight, uGlow, uWash, uDotI, uDotDen;${uplit ? '\nvarying float vStY;' : ''}`)
      .replace('#include <color_fragment>', '')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
#ifdef USE_COLOR
 ${uplit ? `// the lights' colour on the planting: strong at the foot, a glow left up under the canopy
 float k = 1.0 - smoothstep(0.0, 0.62, vStY);
 vec3 e = vColor.rgb * uGlow * uWash * diffuseColor.rgb * (0.35 + 2.6 * k * k);` : `float lineMask = (totalEmissiveRadiance.r + totalEmissiveRadiance.g + totalEmissiveRadiance.b + 0.001) / 3.0;
 vec3 e = vColor.rgb * uGlow * uWash * lineMask;`}
 ${dots ? `{
   // LED nodes where the diagonal lattice bars cross (a 45-degree grid in UV), a share of them lit
   vec2 lp = vec2(vMapUv.x + vMapUv.y, vMapUv.x - vMapUv.y) * 4.0;
   vec2 cid = floor(lp + 0.5); vec2 f = lp - cid;
   float px = max(fwidth(lp.x), fwidth(lp.y));
   float on = step(fract(sin(dot(cid, vec2(12.9898, 78.233))) * 43758.5453), uDotDen);
   float d = 1.0 - smoothstep(0.07, 0.07 + max(0.06, px), length(f));
   // far away the dots are sub-pixel: their average instead of sparkle
   d = mix(d * on, uDotDen * 0.05, smoothstep(0.25, 0.6, px));
   e += vColor.rgb * uDotI * d;
 }` : ''}
 totalEmissiveRadiance = e * uNight;
#else
 totalEmissiveRadiance *= uNight;
#endif`);
  };
  m.customProgramCacheKey = () => 'lmshow3' + (dots ? 'd' : '') + (uplit ? 'u' : '') + (lattice ? 'l' : '');
  return m;
}

export function buildGardens(city, quality) {
  const M = materials();
  const group = new THREE.Group(); group.name = 'GardensByTheBay';
  const lat = latticeTexture();
  const steelCol = 0x56393f; // weathered purple-brown steel
  const latticeMat = showMaterial({ color: steelCol, roughness: 0.55, metalness: 0.5, map: lat, alphaTest: 0.45, transparent: true, side: THREE.DoubleSide, forceSinglePass: true, emissive: 0xffffff, emissiveMap: lat }, 1.0, { dots: true, lattice: true });
  const ribMat = showMaterial({ color: steelCol, roughness: 0.5, metalness: 0.55, emissive: 0xffffff }, 0.2);
  const rimMat = showMaterial({ color: 0x3d2a30, roughness: 0.5, metalness: 0.6, emissive: 0xffffff }, 3.6);
  const trunkMat = showMaterial({ map: foliageTexture(), roughness: 0.9, metalness: 0 }, 4.0, { uplit: true });
  const T = supertreeTemplate();

  const trees = [...GROVE, ...(quality === 'low' ? [] : OUTLIERS)];
  const n = trees.length;
  const mk = (geo, mat, cast = true) => {
    const im = new THREE.InstancedMesh(geo, mat, n);
    im.castShadow = cast; im.receiveShadow = true;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    trees.forEach(([x, z, h], i) => {
      const k = h / ST_H;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i * 1.7) % (Math.PI * 2));
      s.set(k * (0.9 + 0.1 * k), k, k * (0.9 + 0.1 * k));
      p.set(x, 0, z);
      im.setMatrixAt(i, m4.compose(p, q, s));
      im.setColorAt(i, new THREE.Color(1, 1, 1));
    });
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
    group.add(im);
    return im;
  };
  const showMeshes = [mk(T.trunk, trunkMat), mk(T.lattice, latticeMat), mk(T.ribs, ribMat), mk(T.rim, rimMat, false)];

  // ---- observatory on the 50 m tree, OCBC Skyway
  const B = new Bucket();
  const obs = new THREE.CylinderGeometry(11.5, 9, 2.2, 32); obs.translate(GROVE[0][0], 49.5, GROVE[0][1]);
  B.add(M.white, obs);
  const obsGlass = new THREE.CylinderGeometry(11.6, 11.6, 3, 32, 1, true); obsGlass.translate(GROVE[0][0], 51.8, GROVE[0][1]);
  B.add(M.darkGlass, obsGlass);
  const skyRoad = city.roads.find(r => r.n === 'OCBC Skyway');
  const skyPts = [];
  if (skyRoad) for (let i = 0; i < skyRoad.p.length; i += 2) skyPts.push([skyRoad.p[i], skyRoad.p[i + 1]]);
  if (skyPts.length > 1) {
    const deckY = 22, w = 1.4;
    const pos = [], rail = [];
    for (let i = 0; i < skyPts.length - 1; i++) {
      const [ax, az] = skyPts[i], [bx, bz] = skyPts[i + 1];
      const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz); if (l < 0.01) continue;
      const nx = -dz / l * w, nz = dx / l * w;
      pos.push(ax - nx, deckY, az - nz, bx + nx, deckY, bz + nz, bx - nx, deckY, bz - nz, ax - nx, deckY, az - nz, ax + nx, deckY, az + nz, bx + nx, deckY, bz + nz);
      for (const sgn of [-1, 1]) {
        const px = ax + nx * sgn, pz = az + nz * sgn, qx = bx + nx * sgn, qz = bz + nz * sgn;
        rail.push(px, deckY, pz, qx, deckY, qz, qx, deckY + 1.2, qz, px, deckY, pz, qx, deckY + 1.2, qz, px, deckY + 1.2, pz);
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    const nn = g.attributes.normal.array; for (let i = 0; i < nn.length; i += 3) { nn[i] = 0; nn[i + 1] = 1; nn[i + 2] = 0; }
    B.add(M.steel, g);
    const under = g.clone(); under.translate(0, -0.35, 0); const un = under.attributes.normal.array; for (let i = 1; i < un.length; i += 3) un[i] = -1;
    B.add(M.darkSteel, under);
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rail, 3)); rg.computeVertexNormals();
    const railMat = new THREE.MeshStandardMaterial({ color: 0xdfe8ea, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
    B.add(railMat, rg);
  }

  // ---- conservatories
  const byName = n => city.buildings.find(b => b.n === n);
  const fd = byName('Flower Dome'), cf = byName('Cloud Forest');
  const gridTex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(214,230,236,0.5)'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(245,247,248,1)'; ctx.lineWidth = 5;
    for (let i = -2; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * w / 2, 0); ctx.lineTo(i * w / 2 + w, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i * w / 2, h); ctx.lineTo(i * w / 2 + w, 0); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.stroke();
  }, { srgb: true });
  gridTex.repeat.set(1 / 7, 1 / 7);
  // silvery glass shells that still read from across the bay; lit from inside at night
  const domeGlass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: gridTex, roughness: 0.12, metalness: 0.2, transparent: true, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.6, emissive: 0xdce8ff, emissiveIntensity: 0.16 });
  domeGlass.onBeforeCompile = sh => {
    sh.uniforms.uNight = U.night;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= uNight;');
  };
  domeGlass.customProgramCacheKey = () => 'lmdome';
  const domeInner = new THREE.MeshStandardMaterial({ color: 0x47703a, roughness: 0.9, vertexColors: true });
  const domeExclusions = [];
  const domeMeshes = [];
  const R = rng(5);
  if (fd) {
    const ring = ringOf(fd);
    const pc = areaCentroid(ring);
    const { geo, c } = domeGeometry(ring, 38, { sides: 0.55, skew: (x, z) => 0.82 + 0.18 * Math.max(-1, Math.min(1, ((x - pc[0]) * 0.39 + (z - pc[1]) * 0.92) / 70)) });
    const dm = new THREE.Mesh(geo, domeGlass); dm.renderOrder = 2; domeMeshes.push(dm);
    // external steel arches across the short axis
    const ax = [Math.cos(22.5 * Math.PI / 180), Math.sin(22.5 * Math.PI / 180)];
    const ray = new THREE.Raycaster(); const tmpMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    for (let k = -4; k <= 4; k++) {
      const pts = [];
      for (let s = -60; s <= 60; s += 3) {
        const x = c[0] + ax[0] * k * 17 - ax[1] * s, z = c[1] + ax[1] * k * 17 + ax[0] * s;
        ray.set(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0));
        const hit = ray.intersectObject(tmpMesh)[0];
        if (hit) pts.push(new THREE.Vector3(x, hit.point.y + 1.2, z));
      }
      if (pts.length > 4) {
        pts.unshift(new THREE.Vector3(pts[0].x, 0, pts[0].z)); pts.push(new THREE.Vector3(pts[pts.length - 1].x, 0, pts[pts.length - 1].z));
        B.add(M.white, tubeAlong(pts, 0.7, 6));
      }
    }
    // interior: terraces with trees and flower beds
    addInterior(B, ring, c, 12, R, domeInner, 26);
    domeExclusions.push(fd);
  }
  if (cf) {
    const ring = ringOf(cf);
    const { geo, c } = domeGeometry(ring, 58, { sides: 0.42 });
    const dm = new THREE.Mesh(geo, domeGlass); dm.renderOrder = 2; domeMeshes.push(dm);
    // the Cloud Mountain
    const mprof = []; for (let i = 0; i <= 14; i++) { const t = i / 14; mprof.push(new THREE.Vector2(lerp(24, 9, Math.pow(t, 0.7)) * (t < 0.98 ? 1 : 0.4), t * 42)); }
    const mt = new THREE.LatheGeometry(mprof, 24);
    const mp = mt.attributes.position; const col = [];
    for (let i = 0; i < mp.count; i++) {
      const x = mp.getX(i), y = mp.getY(i), z = mp.getZ(i); const a = Math.atan2(z, x);
      const bump = 1 + 0.12 * Math.sin(a * 5 + y * 0.3) + 0.08 * Math.sin(a * 11 - y * 0.5);
      mp.setXYZ(i, x * bump, y, z * bump);
      const g = 0.5 + 0.5 * Math.sin(a * 7 + y * 0.2); col.push(lerp(0.2, 0.35, g), lerp(0.42, 0.55, g), lerp(0.18, 0.25, g));
    }
    mt.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); mt.computeVertexNormals();
    mt.translate(c[0], 0, c[1]);
    B.add(domeInner, mt);
    // aerial walkway rings around the mountain
    for (const [y, r] of [[18, 22], [30, 17]]) { const t = new THREE.TorusGeometry(r, 0.5, 4, 40); t.rotateX(Math.PI / 2); t.translate(c[0], y, c[1]); B.add(M.darkSteel, t); }
    // waterfall
    const wf = new THREE.PlaneGeometry(5, 36); wf.translate(c[0] - 21, 18, c[1]); wf.rotateY(0);
    B.add(new THREE.MeshStandardMaterial({ color: 0xe8f4f8, roughness: 0.2, emissive: 0x99bbcc, emissiveIntensity: 0.15 }), wf);
    domeExclusions.push(cf);
  }
  const staticMeshes = B.build({ name: 'gardens' });
  staticMeshes.forEach(m => group.add(m));
  domeMeshes.forEach(m => { m.castShadow = false; m.receiveShadow = false; group.add(m); });

  // ---- exclusions: OSM supertree parts, skyway (rendered here), domes
  const grove = city.buildings.filter(b => b.c === 0x76c82e);
  const exclusions = exclusionsForBuildings([...grove, ...domeExclusions]);

  const colliders = trees.map(([x, z, h]) => ({ type: 'cylinder', center: [x, h * 0.3, z], radius: 2.6 * h / ST_H, halfHeight: h * 0.3 }));
  for (const d of [fd, cf]) if (d) { const c = areaCentroid(ringOf(d)); colliders.push({ type: 'cylinder', center: [c[0], 12, c[1]], radius: d === fd ? 45 : 38, halfHeight: 12 }); }

  // lighting: calm, slowly drifting purples/blues between shows; Garden Rhapsody (19:45 and 20:45, 15 min) runs fast
  // colour waves across the grove with more and brighter nodes
  const col = new THREE.Color();
  const palette = [[0.78, 0.9], [0.9, 0.95], [0.6, 0.9], [0.08, 0.95], [0.33, 0.8], [0.52, 0.9]];
  const idle = [[0.76, 0.75], [0.84, 0.8], [0.66, 0.7], [0.56, 0.65]];
  let showK = 0;
  function update(dt, env) {
    if (U.night.value <= 0.01) return;
    const t = U.time.value, h = env?.time ?? 12;
    const show = (h >= 19.75 && h < 20) || (h >= 20.75 && h < 21) || env?.forceShow;
    showK += ((show ? 1 : 0) - showK) * Math.min(1, dt * 1.5);
    SHOW.wash.value = lerp(0.22, 0.55, showK);
    SHOW.dotDen.value = lerp(0.3, 0.75, showK);
    SHOW.dotI.value = lerp(2.2, 4.5, showK);
    rimMat.userData.glow.value = lerp(1.0, 3.6, showK);
    ribMat.userData.glow.value = lerp(0.04, 0.35, showK);
    const phase = Math.floor(t / 8) % palette.length;
    const blend = smooth(Math.min(1, (t % 8) / 2));
    const [h0, s0] = palette[(phase + palette.length - 1) % palette.length], [h1, s1] = palette[phase];
    for (let i = 0; i < n; i++) {
      const wave = 0.55 + 0.45 * Math.sin(t * 2.2 - i * 0.9);
      const hs = lerp(h0, h1, blend) + 0.04 * Math.sin(i * 1.3 + t * 0.5);
      const [ih, is] = idle[(i + Math.floor(t / 20)) % idle.length];
      const hue = showK > 0.5 ? hs : ih + 0.03 * Math.sin(t * 0.1 + i);
      col.setHSL(((hue % 1) + 1) % 1, lerp(is, lerp(s0, s1, blend), showK), lerp(0.42, 0.5 * wave + 0.15, showK));
      for (const m of showMeshes) m.setColorAt(i, col);
    }
    for (const m of showMeshes) m.instanceColor.needsUpdate = true;
  }

  return {
    group, exclusions, colliders, update,
    reflective: [...staticMeshes],
    // the grove stands in an open plaza (park trees around it buried the trunks); the garden outliers in small lawns
    clearings: [{ x: 1666, z: 564, r: 105 }, ...trees.slice(GROVE.length).map(([x, z, h]) => ({ x, z, r: canopyR(1) * h / ST_H + 4 }))],
    pois: [
      { id: 'supertrees', name: 'Supertree Grove', x: 1665, y: 0, z: 555 },
      { id: 'skyway', name: 'OCBC Skyway', x: 1640, y: 22, z: 560 },
      { id: 'flowerdome', name: 'Flower Dome', x: 1745, y: 0, z: 275 },
      { id: 'cloudforest', name: 'Cloud Forest', x: 1897, y: 0, z: 345 },
    ],
  };
}

function addInterior(B, ring, c, n, R, mat, maxH) {
  const blob = new THREE.IcosahedronGeometry(1, 1);
  for (let i = 0; i < 70; i++) {
    const a = R() * Math.PI * 2, rr = Math.sqrt(R()) * 0.75;
    // point inside ring by shrinking a random boundary point toward centroid
    const p = ring[(R() * ring.length) | 0];
    const x = c[0] + (p[0] - c[0]) * rr, z = c[1] + (p[1] - c[1]) * rr;
    const s = 1.5 + R() * 2.6;
    const g = blob.clone(); g.scale(s, s * (0.9 + R() * 0.5), s); g.translate(x, s * 0.7, z);
    const colr = new THREE.Color().setHSL(0.22 + R() * 0.15, 0.5, 0.25 + R() * 0.15);
    if (R() < 0.15) colr.setHSL(0.9 + R() * 0.1, 0.55, 0.5);
    const cs = new Float32Array(g.attributes.position.count * 3); for (let k = 0; k < cs.length; k += 3) { cs[k] = colr.r; cs[k + 1] = colr.g; cs[k + 2] = colr.b; }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cs, 3));
    B.add(mat, g);
  }
}
