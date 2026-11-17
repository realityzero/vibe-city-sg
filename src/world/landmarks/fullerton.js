// The Merlion's neighbours on Fullerton Road: The Fullerton Hotel (1928 General Post Office: a granite block with a
// giant Doric colonnade over a rusticated base, an attic storey, the rooftop Lighthouse and a flagpole), One Fullerton
// (the low glass pavilion of 2000 curving along the bay under deep monopitch roofs) and the kiosk in Merlion Park.
import {
  THREE, Bucket, materials, facadeMaterial, nightGlowMaterial, uplitMaterial, extrudeFootprint, ringOf, areaCentroid,
  signedArea, exclusionsForBuildings, offsetRing, capGeometry, fixWinding, footprintClearing,
} from './common.js';

const FULLERTON = [[413.3, 86], [413.2, 78.7], [413.1, 71.5], [417.3, 64.9], [432.7, 38.8], [438.3, 29.5], [443.9, 23.1], [462.3, 23.7], [470.8, 28.7], [470.9, 33.4], [473.4, 33.9], [474.2, 56.6], [479.7, 56.6], [479.6, 62.2], [487.9, 62.3], [491.2, 69.9], [492.3, 79.1], [491.8, 90.5], [487.9, 101.4], [479.2, 101.3], [479, 106.7], [473, 106.7], [470.9, 137], [468.3, 137.2], [467.9, 142.3], [464.2, 142.4], [465.1, 147.3], [455.1, 149.3], [445.2, 151.3], [444.3, 146.3], [440.3, 147.2], [434.3, 134], [431.6, 135.3], [413.7, 95.7], [417.5, 93.5]];
const FULLERTON_PARTS = [5838, 5840];
const FULLERTON_ARCADE = 8320; // an unnamed sliver on the river side the city drew as an 18 m slab
const BAYW = 4.6, BASE_H = 6.2, COL_TOP = 21.8, ENT_TOP = 25, ATTIC0 = 26.2, ATTIC1 = 30.2, COL_OUT = 1.7;

// One Fullerton's parts: [OSM id, roof slope direction (compass degrees, downhill) for the monopitch ones]
const ONE_FULLERTON = [[5842, 199], [5834], [5841], [5833], [5835, 19], [5837, 19], [5836, 19]];
const MERLION_KIOSK = 7707;

function edgesOf(ring) {
  const r = signedArea(ring) < 0 ? ring.slice().reverse() : ring;
  return r.map((p, i) => {
    const q = r[(i + 1) % r.length], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
    return { p, q, l, d: [dx / l, dz / l], n: [dz / l, -dx / l] };
  });
}

/** Walls along every edge between y0 and y1, the facade u counted in whole bays per edge so windows centre between the
 * columns; facade y from `fy0` at y0. */
function bayWalls(edges, y0, y1, fy0 = 0) {
  const pos = [], nor = [], fac = [];
  for (const e of edges) {
    const nb = Math.max(1, Math.round(e.l / BAYW)), u1 = nb * BAYW;
    const v = [[e.p[0], y0, e.p[1], 0], [e.q[0], y0, e.q[1], u1], [e.q[0], y1, e.q[1], u1], [e.p[0], y1, e.p[1], 0]];
    for (const k of [0, 1, 2, 0, 2, 3]) { const w = v[k]; pos.push(w[0], w[1], w[2]); nor.push(e.n[0], 0, e.n[1]); fac.push(w[3], w[1] - y0 + fy0); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('facade', new THREE.Float32BufferAttribute(fac, 2));
  return fixWinding(g);
}

/** A box spanning an edge (t0..t1 of its length), from `off0` to `off1` out of the wall, between y0 and y1. */
function edgeBox(e, t0, t1, off0, off1, y0, y1) {
  const g = new THREE.BoxGeometry(e.l * (t1 - t0), y1 - y0, off1 - off0);
  g.rotateY(Math.atan2(-e.d[1], e.d[0]));
  const s = e.l * (t0 + t1) / 2, o = (off0 + off1) / 2;
  return g.translate(e.p[0] + e.d[0] * s + e.n[0] * o, (y0 + y1) / 2, e.p[1] + e.d[1] * s + e.n[1] * o);
}

/** Round-headed opening (a panel with a semicircular top) on an edge at distance s, facing out. */
function archPanel(e, s, w, y0, y1, off) {
  const shape = new THREE.Shape(); const r = w / 2;
  shape.moveTo(-r, y0); shape.lineTo(r, y0); shape.lineTo(r, y1 - r); shape.absarc(0, y1 - r, r, 0, Math.PI, false); shape.lineTo(-r, y0);
  const g = new THREE.ShapeGeometry(shape, 8);
  g.rotateY(Math.atan2(-e.d[1], e.d[0]) + Math.PI); // (the shape's face, +z, turned outward)
  return g.translate(e.p[0] + e.d[0] * s + e.n[0] * off, 0, e.p[1] + e.d[1] * s + e.n[1] * off);
}

function fullertonHotel(B) {
  const M = materials();
  // warm granite washed golden by its floodlights at night, the windows of a hotel behind
  const granite = facadeMaterial({ wall: 0xcdc3ae, glass: 0x4c575e, cell: [BAYW, 4.1], frame: [0.3, 0.24, 0.2], lit: 0.6, seed: 31, warm: 0xffd9a0, litIntensity: 1.8, wallRough: 0.8, glassRough: 0.15, glassMetal: 0.45, wallGlow: 0.2, wallGlowColor: 0xffcf8f, wallGlowY: [0, 24, 0.5] });
  const stone = uplitMaterial(0xffc98a, 0.42, { y0: 0, y1: 32, floor: 0.35, base: 0xd6ccb8, rough: 0.75 });
  const rustic = uplitMaterial(0xffc98a, 0.42, { y0: 0, y1: 32, floor: 0.35, base: 0xc4b9a3, rough: 0.85 });
  const joint = new THREE.MeshStandardMaterial({ color: 0x9c917f, roughness: 0.9 });
  const lobby = nightGlowMaterial(0xffcd8c, 1.6, { base: 0x2c2b29, rough: 0.2, metal: 0.3, day: 0.2 });
  const edges = edgesOf(FULLERTON);
  // ---- rusticated base: banded granite, a round-headed opening per bay
  B.add(rustic, extrudeFootprint(FULLERTON, 0, BASE_H, { top: false }));
  for (const e of edges) {
    for (let y = 0.9; y < BASE_H - 0.3; y += 0.9) B.add(joint, edgeBox(e, 0, 1, -0.02, 0.04, y - 0.06, y + 0.06));
    if (e.l < 3) continue;
    const nb = Math.max(1, Math.round(e.l / BAYW));
    for (let i = 0; i < nb; i++) B.add(lobby, archPanel(e, (i + 0.5) * e.l / nb, Math.min(2.1, e.l / nb - 1), 0.35, 5.0, 0.06));
  }
  // ---- piano nobile to the frieze: windows in bays, and on the long faces the giant order standing out from a loggia
  B.add(granite, bayWalls(edges, BASE_H, 22.6));
  B.add(stone, extrudeFootprint(FULLERTON, 22.6, ENT_TOP, { top: false }));
  const shaft = new THREE.CylinderGeometry(0.6, 0.7, COL_TOP - BASE_H - 1.1, 16); shaft.translate(0, (BASE_H + 0.7 + COL_TOP - 0.4) / 2, 0);
  const torus = new THREE.CylinderGeometry(0.86, 0.9, 0.4, 16); torus.translate(0, BASE_H + 0.5, 0);
  const plinth = new THREE.BoxGeometry(1.9, 0.3, 1.9); plinth.translate(0, BASE_H + 0.15, 0);
  const echinus = new THREE.CylinderGeometry(0.88, 0.6, 0.4, 16); echinus.translate(0, COL_TOP - 0.2, 0);
  const abacus = new THREE.BoxGeometry(1.95, 0.4, 1.95); abacus.translate(0, COL_TOP + 0.2, 0);
  for (const e of edges) {
    const faceEast = e.n[0] > 0.55, faceNorth = e.n[1] < -0.55, faceSouth = e.n[1] > 0.55;
    if (e.l < 10 || (!faceEast && !faceNorth && !faceSouth)) continue;
    const nb = Math.max(1, Math.round(e.l / BAYW)), ang = Math.atan2(-e.d[1], e.d[0]);
    for (let i = 1; i < nb; i++) {
      const s = i * e.l / nb, x = e.p[0] + e.d[0] * s + e.n[0] * COL_OUT, z = e.p[1] + e.d[1] * s + e.n[1] * COL_OUT;
      for (const g of [shaft, torus, plinth, echinus, abacus]) B.add(stone, g.clone().rotateY(ang).translate(x, 0, z));
    }
    // loggia floor with its balustrade, and the entablature carried over the columns
    B.add(stone, edgeBox(e, 0, 1, 0, COL_OUT + 1.1, BASE_H - 0.35, BASE_H));
    B.add(stone, edgeBox(e, 0, 1, COL_OUT - 0.15, COL_OUT + 0.15, BASE_H, BASE_H + 1.05));
    B.add(stone, edgeBox(e, 0, 1, -0.1, COL_OUT + 1.1, COL_TOP + 0.4, ENT_TOP));
    B.add(stone, edgeBox(e, 0, 1, -0.1, COL_OUT + 1.6, ENT_TOP, ENT_TOP + 0.5));
  }
  // ---- cornice, attic storey, parapet, roof with the atrium skylight
  B.add(stone, extrudeFootprint(offsetRing(FULLERTON, 1.1), ENT_TOP, ENT_TOP + 0.5, { bottom: true }));
  B.add(stone, extrudeFootprint(offsetRing(FULLERTON, 0.5), ENT_TOP + 0.5, ATTIC0, { top: false }));
  B.add(M.concrete, capGeometry(offsetRing(FULLERTON, 0.5), ATTIC0));
  const attic = offsetRing(FULLERTON, -1.5);
  B.add(granite, bayWalls(edgesOf(attic), ATTIC0, ATTIC1, 0.6));
  B.add(stone, extrudeFootprint(offsetRing(attic, 0.35), ATTIC1, ATTIC1 + 0.9));
  const c = areaCentroid(FULLERTON), sky = [[-18, -9], [8, -9], [8, 9], [-18, 9]].map(([x, z]) => [c[0] + x, c[1] + z]);
  B.add(M.glass, extrudeFootprint(sky, ATTIC1, ATTIC1 + 2.2));
  // the Lighthouse: a glazed drum on the bay corner of the roof, its beacon lit at night
  const lx = c[0] + 18, lz = c[1] - 4;
  B.add(nightGlowMaterial(0xffdcaa, 1.4, { base: 0x384048, rough: 0.1, metal: 0.6 }), new THREE.CylinderGeometry(4, 4, 4, 20).translate(lx, ATTIC1 + 2.9, lz));
  B.add(M.roofGrey, new THREE.ConeGeometry(4.6, 2, 20).translate(lx, ATTIC1 + 5.9, lz));
  B.add(M.warmLight, new THREE.SphereGeometry(0.6, 12, 8).translate(lx, ATTIC1 + 7.2, lz));
  // flagpole over the bay front, flying the state flag (red over white)
  const fx = 491.6 - 3, fz = 80;
  B.add(M.white, new THREE.CylinderGeometry(0.09, 0.14, 14, 8).translate(fx, ATTIC1 + 7, fz));
  B.add(M.gold, new THREE.SphereGeometry(0.22, 10, 8).translate(fx, ATTIC1 + 14.1, fz));
  const flag = (y0, color) => {
    const g = new THREE.BoxGeometry(3.6, 1.2, 0.03, 8, 1, 1), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + 0.25 * Math.sin((p.getX(i) + 1.8) * 1.6));
    g.computeVertexNormals(); g.translate(fx + 1.8 + 0.12, y0 + 0.6, fz);
    B.add(new THREE.MeshStandardMaterial({ color, roughness: 0.8 }), g);
  };
  flag(ATTIC1 + 12.6, 0xd52b2b); flag(ATTIC1 + 11.4, 0xf4f2ee);
}

/** One Fullerton: glass on slim mullions under deep overhanging roofs, monopitch where OSM says so. */
function oneFullerton(B, byId) {
  const glass = facadeMaterial({ wall: 0xc8ced1, glass: 0x3c545c, cell: [2.6, 4.2], frame: [0.035, 0.04, 0.05], lit: 1, vary: 0.35, seed: 37, warm: 0xffcf98, cool: 0xffe4c0, litIntensity: 0.7, glassRough: 0.05, glassMetal: 0.45, wallRough: 0.4, wallMetal: 0.5 });
  const roof = new THREE.MeshStandardMaterial({ color: 0xd5d3ce, roughness: 0.5, metalness: 0.35 });
  const soffit = nightGlowMaterial(0xffe2c0, 0.35, { base: 0xbfc1c0, rough: 0.6 }); // downlights under the eaves
  const fascia = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.45, metalness: 0.2 });
  const rings = [];
  for (const [id, deg] of ONE_FULLERTON) {
    const b = byId.get(id); if (!b) continue;
    const r = ringOf(b), base = b.m || 0, rh = deg !== undefined ? (b.rh || 3) : 0;
    rings.push(r);
    // roof plane: full height on the uphill side, rh lower on the downhill side
    const dx = Math.sin(deg * Math.PI / 180), dz = -Math.cos(deg * Math.PI / 180);
    const proj = r.map(([x, z]) => x * dx + z * dz), lo = Math.min(...proj), hi = Math.max(...proj);
    const top = (x, z) => rh ? b.h - rh * ((x * dx + z * dz) - lo) / (hi - lo || 1) : b.h;
    const rr = signedArea(r) < 0 ? r.slice().reverse() : r;
    const pos = [], nor = [], fac = []; let u = 0;
    for (let i = 0; i < rr.length; i++) {
      const p = rr[i], q = rr[(i + 1) % rr.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, nx = (q[1] - p[1]) / l, nz = -(q[0] - p[0]) / l;
      const v = [[p[0], base, p[1], u], [q[0], base, q[1], u + l], [q[0], top(q[0], q[1]) - 0.3, q[1], u + l], [p[0], top(p[0], p[1]) - 0.3, p[1], u]];
      for (const k of [0, 1, 2, 0, 2, 3]) { const w = v[k]; pos.push(w[0], w[1], w[2]); nor.push(nx, 0, nz); fac.push(w[3], w[1]); }
      u += l;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('facade', new THREE.Float32BufferAttribute(fac, 2));
    B.add(glass, fixWinding(g));
    if (base > 0) B.add(soffit, capGeometry(r, base, true));
    // the roof slab oversails the glass by 1.6 m: tilted top, soffit with downlights, white fascia
    const over = offsetRing(r, 1.6), lift = (gg, dy) => { const a = gg.attributes.position; for (let i = 0; i < a.count; i++) a.setY(i, top(a.getX(i), a.getZ(i)) + dy); gg.computeVertexNormals(); return gg; };
    B.add(roof, lift(capGeometry(over, 0), 0.25));
    B.add(soffit, lift(capGeometry(over, 0, true), -0.3));
    const edge = extrudeFootprint(over, 0, 1, { top: false }), ep = edge.attributes.position;
    for (let i = 0; i < ep.count; i++) ep.setY(i, top(ep.getX(i), ep.getZ(i)) + (ep.getY(i) > 0.5 ? 0.25 : -0.3));
    edge.computeVertexNormals();
    B.add(fascia, edge);
  }
  return rings;
}

/** The Merlion Park kiosk: a single low white pavilion, its long sides glazed, under a thin oversailing roof slab (OSM
 * has no height; the city drew 4 storeys). */
function kiosk(B, byId) {
  const b = byId.get(MERLION_KIOSK); if (!b) return null;
  const r = ringOf(b), M = materials();
  const glaze = nightGlowMaterial(0xffc98e, 0.35, { base: 0x2e3436, rough: 0.12, metal: 0.4, day: 0.05 });
  B.add(M.white, extrudeFootprint(r, 0, 2.7, { top: false }));
  for (const e of edgesOf(r)) if (e.l > 5) B.add(glaze, edgeBox(e, 0.06, 0.94, 0, 0.05, 0.8, 2.4));
  B.add(M.white, extrudeFootprint(offsetRing(r, 0.9), 2.7, 3.05, { bottom: true }));
  return r;
}

export function buildFullerton(city) {
  const byId = new Map(city.buildings.map(b => [b.id, b]));
  const B = new Bucket();
  fullertonHotel(B);
  const ofRings = oneFullerton(B, byId);
  const kioskRing = kiosk(B, byId);
  const meshes = B.build({ name: 'fullerton' });
  const group = new THREE.Group(); group.name = 'Fullerton';
  meshes.forEach(m => group.add(m));
  const trimesh = g => ({ type: 'trimesh', vertices: new Float32Array(g.attributes.position.array), indices: new Uint32Array([...Array(g.attributes.position.count).keys()]) });
  const colliders = [trimesh(extrudeFootprint(FULLERTON, 0, ENT_TOP)), ...ofRings.map(r => trimesh(extrudeFootprint(r, 0, 12)))];
  if (kioskRing) colliders.push(trimesh(extrudeFootprint(kioskRing, 0, 3)));
  const exList = [...FULLERTON_PARTS, FULLERTON_ARCADE, MERLION_KIOSK, ...ONE_FULLERTON.map(p => p[0])].map(id => byId.get(id)).filter(Boolean);
  return {
    group, colliders, reflective: meshes,
    exclusions: [FULLERTON, ...exclusionsForBuildings(exList.concat(city.buildings.filter(b => /^The Fullerton Hotel$|^One Fullerton$/.test(b.n || ''))))],
    // (trees stand back from the eaves: One Fullerton's roof oversails its glass by 1.6 m)
    clearings: [footprintClearing(FULLERTON, 2.5), ...[...ofRings, kioskRing].filter(Boolean).map(r => footprintClearing(r, 5))],
    pois: [
      { id: 'fullerton', name: 'The Fullerton Hotel', x: 490, y: 0, z: 85 },
      { id: 'onefullerton', name: 'One Fullerton', x: 556, y: 0, z: 136 },
    ],
  };
}
