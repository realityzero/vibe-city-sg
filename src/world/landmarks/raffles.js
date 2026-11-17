// Raffles Place's signature towers in their own cladding (the city's generic glass made them one dark cluster): the OUB
// Centre (One Raffles Place: two triangular aluminium prisms split by a slot), UOB Plaza One and Two (stacked octagons
// turned 45 degrees, silver aluminium with ribbon windows) and Republic Plaza (pink-grey granite with blue glass in
// vertical strips, its chamfered tiers stepping in to a lit crown). The massing is OSM's building parts.
import { THREE, Bucket, facadeMaterial, nightGlowMaterial, extrudeFootprint, ringOf, centroidOf, pointInRing, offsetRing, rectPoly, exclusionsForBuildings } from './common.js';

// parts by site: centroid inside the zone, a building part taller than the podiums around it
const SITES = {
  oub: { zone: rectPoly(233, 258, 28, 28), minH: 100 },
  uob1: { zone: rectPoly(135, 170, 30, 30), minH: 100 },
  uob2: { zone: rectPoly(242, 175, 22, 24), minH: 100 },
  republic: { zone: rectPoly(214, 443, 26, 26), minH: 100 },
};
const SLOT = 0.7; // half width of the OUB's slot between its prisms

const sidesOnly = (ring, y0, y1) => extrudeFootprint(ring, y0, y1, { top: false });

export function buildRaffles(city) {
  const parts = {};
  for (const [k, s] of Object.entries(SITES)) parts[k] = city.buildings.filter(b => b.pt && b.h >= s.minH && pointInRing(...centroidOf(ringOf(b)), s.zone));
  // champagne aluminium with punched windows; silver aluminium with ribbon windows; granite with glass strips
  const oubSkin = facadeMaterial({ wall: 0xcbc4c2, glass: 0x34404a, cell: [1.7, 3.6], frame: [0.2, 0.26, 0.2], lit: 0.5, seed: 81, wallRough: 0.4, wallMetal: 0.65, glassMetal: 0.5, litIntensity: 1.8 });
  const uobSkin = facadeMaterial({ wall: 0xb9bec1, glass: 0x48606c, cell: [3.0, 3.9], frame: [0.015, 0.3, 0.12], lit: 0.5, seed: 82, wallRough: 0.35, wallMetal: 0.7, glassMetal: 0.5, litIntensity: 1.8 });
  const republicSkin = facadeMaterial({ wall: 0xc3b8b1, glass: 0x3f6378, cell: [2.2, 3.9], frame: [0.27, 0.02, 0.02], lit: 0.5, seed: 83, wallRough: 0.45, wallMetal: 0.15, glassMetal: 0.55, litIntensity: 1.8 });
  const crown = nightGlowMaterial(0xf2f6ff, 2.4, { base: 0xdfe3e6, rough: 0.35, metal: 0.6 });
  const B = new Bucket(), colliders = [], tops = [];
  const add = (skin, b, ring = ringOf(b)) => {
    B.add(skin, extrudeFootprint(ring, b.m || 0, b.h));
    if (!b.m) { const g = extrudeFootprint(ring, 0, Math.min(b.h, 40)); colliders.push({ type: 'trimesh', vertices: new Float32Array(g.attributes.position.array), indices: new Uint32Array([...Array(g.attributes.position.count).keys()]) }); }
    tops.push([ring, b]);
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
  // a line of light round the roof edges of each tower's crown tiers
  for (const [ring, b] of tops) {
    const site = Object.values(parts).find(list => list.includes(b)), top = Math.max(...site.map(o => o.h));
    if (b.h > top - 30) B.add(crown, sidesOnly(offsetRing(ring, 0.06), b.h - 0.7, b.h));
  }
  const meshes = B.build({ name: 'raffles' });
  const group = new THREE.Group(); group.name = 'RafflesPlace';
  meshes.forEach(m => group.add(m));
  return {
    group, colliders, reflective: meshes,
    exclusions: exclusionsForBuildings(Object.values(parts).flat()),
    pois: [
      { id: 'oub', name: 'One Raffles Place (OUB Centre)', x: 233, y: 0, z: 258 },
      { id: 'uobplaza', name: 'UOB Plaza', x: 135, y: 0, z: 170 },
      { id: 'republicplaza', name: 'Republic Plaza', x: 214, y: 0, z: 443 },
    ],
  };
}
