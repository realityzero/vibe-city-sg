// Raffles Place's signature towers in their own cladding (the city's generic glass made them one dark cluster): the OUB
// Centre (One Raffles Place: two triangular aluminium prisms split by a slot), UOB Plaza One and Two (stacked octagons
// turned 45 degrees, silver aluminium with ribbon windows) and Republic Plaza (pink-grey granite with blue glass in
// vertical strips, its chamfered tiers stepping in to a lit crown). Round the bay the skyline's other icons: OUE
// Bayfront (aluminium, its glass crown tilted up away from the water), The Sail (blue glass banded in white, the tops
// raked like sails) and Suntec City's four towers round the Fountain of Wealth (raked crowns rising away from it). The
// massing is OSM's building parts; each tower's foot gets a canopy over the pavement.
import {
  THREE, Bucket, materials, facadeMaterial, nightGlowMaterial, extrudeFootprint, ringOf, centroidOf, pointInRing, offsetRing, rectPoly,
  exclusionsForBuildings, signedArea, fixWinding,
} from './common.js';

// parts by site: centroid inside the zone, a building part taller than the podiums around it
const SITES = {
  oub: { zone: rectPoly(233, 258, 28, 28), minH: 100 },
  uob1: { zone: rectPoly(135, 170, 30, 30), minH: 100 },
  uob2: { zone: rectPoly(242, 175, 22, 24), minH: 100 },
  republic: { zone: rectPoly(214, 443, 26, 26), minH: 100 },
};
const SLOT = 0.7; // half width of the OUB's slot between its prisms

const sidesOnly = (ring, y0, y1) => extrudeFootprint(ring, y0, y1, { top: false });
const OUE_BAYFRONT = 6802, THE_SAIL = [5414, 5409], SUNTEC_TOWER5 = 6975;
// Suntec City towers 1-4, foot to crown (OSM parts 0-90, 90-150, 150-181 m)
const SUNTEC = [[6976, 5699, 945], [6977, 5698, 944], [6978, 5697, 946], [6979, 5700, 5696]];

/** a geometry from flat position / normal arrays (and an optional facade attribute), wound to face its normals */
function tris(pos, nor, fac = null) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (fac) g.setAttribute('facade', new THREE.Float32BufferAttribute(fac, 2));
  return fixWinding(g);
}

/** A crown raked up from y0 across the ring towards dir ([x, z], unit) by `rise`: walls in the tower's skin, the sloping
 *  roof in dark glass, a line of light along its rim */
function rakedCrown(B, skin, roofMat, rimMat, ring, y0, rise, dir) {
  const r = signedArea(ring) < 0 ? ring.slice().reverse() : ring.slice();
  const pr = r.map(([x, z]) => x * dir[0] + z * dir[1]), lo = Math.min(...pr), span = Math.max(...pr) - lo;
  const top = (x, z) => y0 + rise * Math.min(1, Math.max(0, (x * dir[0] + z * dir[1] - lo) / span));
  const wall = [], wn = [], wf = [], rim = [], rn = [];
  let u = 0;
  const rr = offsetRing(r, 0.06);
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]), n = [(q[1] - p[1]) / l, 0, -(q[0] - p[0]) / l];
    const tp = top(...p), tq = top(...q);
    for (const [x, y, z, fu] of [[p[0], y0, p[1], u], [q[0], y0, q[1], u + l], [q[0], tq, q[1], u + l], [p[0], y0, p[1], u], [q[0], tq, q[1], u + l], [p[0], tp, p[1], u]]) { wall.push(x, y, z); wn.push(...n); wf.push(fu, y); }
    const a = rr[i], b = rr[(i + 1) % r.length];
    for (const [x, z, y] of [[a[0], a[1], tp - 0.8], [b[0], b[1], tq - 0.8], [b[0], b[1], tq + 0.05], [a[0], a[1], tp - 0.8], [b[0], b[1], tq + 0.05], [a[0], a[1], tp + 0.05]]) { rim.push(x, y, z); rn.push(...n); }
    u += l;
  }
  B.add(skin, tris(wall, wn, wf));
  B.add(rimMat, tris(rim, rn));
  const k = rise / span, up = new THREE.Vector3(-dir[0] * k, 1, -dir[1] * k).normalize(), roof = [], roofN = [];
  for (const t of THREE.ShapeUtils.triangulateShape(r.map(p => new THREE.Vector2(p[0], p[1])), [])) for (const j of t) { roof.push(r[j][0], top(...r[j]), r[j][1]); roofN.push(up.x, up.y, up.z); }
  B.add(roofMat, tris(roof, roofN));
}

/** convex hull of points [x, z] (monotone chain) */
function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = list => { const h = []; for (const q of list) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q); } h.pop(); return h; };
  return [...half(p), ...half(p.slice().reverse())];
}

/** A canopy over the pavement at a tower's foot (the street front: the edge nearest a road, stopping short of its
 *  kerb), so it doesn't come down to the pavement as one sheet of glass */
function footCanopy(B, mats, ring, kerb, y = 5.2) {
  const r = signedArea(ring) < 0 ? ring.slice().reverse() : ring.slice();
  let best = null, bd = 25;
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (l < 10) continue;
    const n = [(q[1] - p[1]) / l, -(q[0] - p[0]) / l], mx = (p[0] + q[0]) / 2 + n[0] * 4, mz = (p[1] + q[1]) / 2 + n[1] * 4;
    const d = kerb(mx, mz);
    if (d < bd) { bd = d; best = { p, q, l, n }; }
  }
  const depth = Math.min(3.4, bd + 3.4);
  if (!best || depth < 1.6) return;
  const { p, q, l, n } = best, w = Math.min(l * 0.6, 28) / l, t0 = 0.5 - w / 2, t1 = 0.5 + w / 2;
  const at = (t, o) => [p[0] + (q[0] - p[0]) * t + n[0] * o, p[1] + (q[1] - p[1]) * t + n[1] * o];
  const c = [at(t0, 0), at(t1, 0), at(t1, depth), at(t0, depth)];
  const slab = extrudeFootprint(c, y, y + 0.4, { bottom: true });
  B.add(mats.slab, slab);
  // its soffit glows at night, a line of light along the front edge
  const e = [at(t0, depth - 0.25), at(t1, depth - 0.25), at(t1, depth + 0.02), at(t0, depth + 0.02)];
  B.add(mats.light, extrudeFootprint(e, y - 0.06, y + 0.02, { top: false, bottom: true }));
}

export function buildRaffles(city) {
  const parts = {};
  for (const [k, s] of Object.entries(SITES)) parts[k] = city.buildings.filter(b => b.pt && b.h >= s.minH && pointInRing(...centroidOf(ringOf(b)), s.zone));
  // champagne aluminium with punched windows; silver aluminium with ribbon windows; granite with glass strips
  const oubSkin = facadeMaterial({ wall: 0xcbc4c2, glass: 0x34404a, cell: [1.7, 3.6], frame: [0.2, 0.26, 0.2], lit: 0.5, seed: 81, wallRough: 0.4, wallMetal: 0.65, glassMetal: 0.5, litIntensity: 1.8 });
  const uobSkin = facadeMaterial({ wall: 0xb9bec1, glass: 0x48606c, cell: [3.0, 3.9], frame: [0.015, 0.3, 0.12], lit: 0.5, seed: 82, wallRough: 0.35, wallMetal: 0.7, glassMetal: 0.5, litIntensity: 1.8 });
  const republicSkin = facadeMaterial({ wall: 0xc3b8b1, glass: 0x3f6378, cell: [2.2, 3.9], frame: [0.27, 0.02, 0.02], lit: 0.5, seed: 83, wallRough: 0.45, wallMetal: 0.15, glassMetal: 0.55, litIntensity: 1.8 });
  // blue glass banded with white spandrels and balconies (The Sail, Suntec City)
  const bandSkin = facadeMaterial({ wall: 0xe8edef, glass: 0x3b6a86, cell: [2.6, 3.4], frame: [0.03, 0.34, 0.06], lit: 0.5, seed: 84, wallRough: 0.45, glassMetal: 0.45, litIntensity: 1.7 });
  const crown = nightGlowMaterial(0xf2f6ff, 2.4, { base: 0xdfe3e6, rough: 0.35, metal: 0.6 });
  const M = materials(), canopy = { slab: new THREE.MeshStandardMaterial({ color: 0x8f969c, roughness: 0.4, metalness: 0.6 }), light: nightGlowMaterial(0xfff1dc, 1.6, { base: 0xe8e8e4, rough: 0.5 }) };
  const byId = new Map(city.buildings.map(b => [b.id, b]));
  const roads = city.roads.filter(r => r.c < 7);
  // distance from a point to the nearest kerb (the roads in this part of town)
  const near = roads.filter(r => r.p.some((v, i) => i % 2 ? v > -1100 && v < 800 : v > 0 && v < 1400));
  const kerb = (x, z) => { let d = 1e9; for (const r of near) for (let i = 0; i + 3 < r.p.length; i += 2) { const ax = r.p[i], az = r.p[i + 1], vx = r.p[i + 2] - ax, vz = r.p[i + 3] - az, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1))); d = Math.min(d, Math.hypot(x - ax - vx * t, z - az - vz * t) - r.w / 2); } return d; };
  const B = new Bucket(), colliders = [], tops = [], extra = [];
  const add = (skin, b, ring = ringOf(b), lit = true) => {
    B.add(skin, extrudeFootprint(ring, b.m || 0, b.h));
    if (!b.m) { const g = extrudeFootprint(ring, 0, Math.min(b.h, 40)); colliders.push({ type: 'trimesh', vertices: new Float32Array(g.attributes.position.array), indices: new Uint32Array([...Array(g.attributes.position.count).keys()]) }); }
    if (lit) tops.push([ring, b]);
  };
  // OUB Centre: the two prisms meet on a diagonal; each gives up SLOT there for the dark slot between them
  if (parts.oub.length === 2) {
    const [ra, rb] = parts.oub.map(ringOf), shared = ra.filter(p => rb.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.5));
    if (shared.length >= 2) {
      const [p, q] = [shared[0], shared[shared.length - 1]], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
      const nx = -dz / l, nz = dx / l, side = r => Math.sign(r.reduce((s, v) => s + (v[0] - p[0]) * nx + (v[1] - p[1]) * nz, 0));
      // pull every vertex on the diagonal off it, away into its own prism
      const pull = r => { const sg = side(r); return r.map(v => Math.abs((v[0] - p[0]) * nx + (v[1] - p[1]) * nz) < 0.5 ? [v[0] + nx * SLOT * sg, v[1] + nz * SLOT * sg] : v); };
      parts.oub.forEach(o => add(oubSkin, o, pull(ringOf(o))));
      const slot = [[p[0] + nx * SLOT, p[1] + nz * SLOT], [q[0] + nx * SLOT, q[1] + nz * SLOT], [q[0] - nx * SLOT, q[1] - nz * SLOT], [p[0] - nx * SLOT, p[1] - nz * SLOT]];
      B.add(nightGlowMaterial(0xcfe0ff, 0.25, { base: 0x1d2329, rough: 0.2, metal: 0.6 }), extrudeFootprint(slot, 0, Math.min(...parts.oub.map(o => o.h)) - 0.5, { top: false }));
    } else parts.oub.forEach(o => add(oubSkin, o));
  }
  for (const o of parts.uob1) add(uobSkin, o);
  for (const o of parts.uob2) add(uobSkin, o);
  for (const o of parts.republic) add(republicSkin, o);
  // OUE Bayfront: champagne aluminium, a glass crown raked up away from the bay
  const oue = byId.get(OUE_BAYFRONT);
  if (oue) {
    const r = ringOf(oue);
    add(oubSkin, { ...oue, h: oue.h - 10 }, r, false);
    rakedCrown(B, oubSkin, M.darkGlass, crown, offsetRing(r, -1.2), oue.h - 10, 16, [-1, 0]);
    extra.push(oue);
  }
  // The Sail: two banded blue towers, their tops raked up towards the bay like a pair of sails
  for (const id of THE_SAIL) {
    const b = byId.get(id); if (!b) continue;
    add(bandSkin, b, ringOf(b), false);
    rakedCrown(B, bandSkin, M.darkGlass, crown, ringOf(b), b.h, 18, [0.71, -0.71]);
    extra.push(b);
  }
  // Suntec City: four 45-storey towers round the Fountain of Wealth, crowns raked up away from it; tower 5 low and flat
  const suntec = SUNTEC.map(ids => ids.map(id => byId.get(id))).filter(t => t.every(Boolean));
  if (suntec.length) {
    const fc = suntec.map(t => centroidOf(ringOf(t[2]))).reduce((a, c) => [a[0] + c[0] / suntec.length, a[1] + c[1] / suntec.length], [0, 0]);
    for (const t of suntec) {
      for (const b of t) add(bandSkin, b, ringOf(b), false);
      const r = ringOf(t[2]), [cx, cz] = centroidOf(r), l = Math.hypot(cx - fc[0], cz - fc[1]);
      rakedCrown(B, bandSkin, M.darkGlass, crown, r, t[2].h, 12, [(cx - fc[0]) / l, (cz - fc[1]) / l]);
      extra.push(...t);
    }
    const t5 = byId.get(SUNTEC_TOWER5);
    if (t5) { add(bandSkin, t5); extra.push(t5); }
  }
  // a canopy over the pavement at the foot of every tower (round the outline of its parts that stand on the ground)
  for (const site of [...Object.values(parts), ...extra.map(b => [b])].filter(l => l.some(b => !b.m))) footCanopy(B, canopy, hull(site.filter(b => !b.m).flatMap(ringOf)), kerb);
  // a line of light round the roof edges of each tower's crown tiers
  for (const [ring, b] of tops) {
    const site = Object.values(parts).find(list => list.includes(b)) || [b], top = Math.max(...site.map(o => o.h));
    if (b.h > top - 30) B.add(crown, sidesOnly(offsetRing(ring, 0.06), b.h - 0.7, b.h));
  }
  const meshes = B.build({ name: 'raffles' });
  const group = new THREE.Group(); group.name = 'RafflesPlace';
  meshes.forEach(m => group.add(m));
  return {
    group, colliders, reflective: meshes,
    exclusions: exclusionsForBuildings([...Object.values(parts).flat(), ...extra]),
    pois: [
      { id: 'oub', name: 'One Raffles Place (OUB Centre)', x: 233, y: 0, z: 258 },
      { id: 'uobplaza', name: 'UOB Plaza', x: 135, y: 0, z: 170 },
      { id: 'republicplaza', name: 'Republic Plaza', x: 214, y: 0, z: 443 },
      { id: 'ouebayfront', name: 'OUE Bayfront', x: 432, y: 0, z: 457 },
      { id: 'thesail', name: 'The Sail @ Marina Bay', x: 433, y: 0, z: 660 },
      { id: 'suntec', name: 'Suntec City', x: 1130, y: 0, z: -905 },
    ],
  };
}
