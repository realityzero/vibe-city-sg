// Clarke Quay: the five blocks of 1880s riverside godowns, two storeys under rows of clay-tiled gables, each unit painted
// its own pastel; the "Angels" (big umbrella canopies on masts) over the streets between the blocks and the "Bluebells"
// (lily-pad umbrellas with a glowing rim) over the dining along the river walk. The OSM blocks (15 m slabs the city drew
// as 4-storey shophouses, and the street canopy as a solid block) are rebuilt here.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  THREE, U, Bucket, materials, nightGlowMaterial, uplitMaterial, ringOf, centroidOf, signedArea, pointInRing, pca, offsetRing,
  exclusionsForBuildings, extrudeFootprint, rng, footprintClearing,
} from './common.js';

// A Merchants' Court, B The Foundry, C The Cannery, D, the two river-corner units of A, E Traders Market (two parts)
const BLOCKS = [1039, 13, 8356, 1038, 1041, 1040, 11, 1042];
const STREETS = 8358, STREET_ROOF = 8357; // the covered street network between the blocks, and a low roof inside it
const EAVE = 8.4, PITCH = Math.tan(27 * Math.PI / 180), BAY = 8.6, UNIT = 12; // unit: a godown's frontage along a gable
const OVERHANG = 0.55, ROOF_T = 0.22;
const RIVER_WALK = [[-434.6, -276.5], [-444.8, -280.4], [-453.2, -287.3], [-463, -313.1], [-466.1, -329.3], [-468.7, -342.4], [-470.1, -349.8], [-474.3, -391.2], [-477.6, -403], [-489, -414.5], [-503, -425.5], [-514.2, -435.1], [-539, -455.5]];
const BLUEBELL_SPACING = 12.5, BLUEBELL_H = 3.8;
const ANGEL_H = 12.6, ANGEL_GRID = 13;

const PASTELS = [0xf2b4c2, 0xd0e398, 0xf3df9a, 0xa7c9e6, 0xc7b2e2, 0xa4dac4, 0xf3c39f, 0x9dd4db];
const SHUTTERS = [0x2f5a48, 0x2a6b72, 0x6e2c33, 0xe6e0d2, 0x3d4c69];
const TILES = [0xa5583b, 0x96503a, 0xb26444];

/** keep the part of a ring where nx*x + nz*z <= d (Sutherland-Hodgman against one half-plane) */
function clipHalf(ring, nx, nz, d) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const dp = nx * p[0] + nz * p[1] - d, dq = nx * q[0] + nz * q[1] - d;
    if (dp <= 0) out.push(p);
    if (dp * dq < 0) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}

/** flat-shaded triangles per material, wound to face the normal they were given */
class Tris {
  constructor() { this.by = new Map(); }
  tri(mat, a, b, c, n) {
    if (!this.by.has(mat)) this.by.set(mat, []);
    const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2], fx = c[0] - a[0], fy = c[1] - a[1], fz = c[2] - a[2];
    const flip = (ey * fz - ez * fy) * n[0] + (ez * fx - ex * fz) * n[1] + (ex * fy - ey * fx) * n[2] < 0;
    this.by.get(mat).push(...a, ...(flip ? c : b), ...(flip ? b : c));
  }
  quad(mat, a, b, c, d, n) { this.tri(mat, a, b, c, n); this.tri(mat, a, c, d, n); }
  addTo(B) {
    for (const [mat, pos] of this.by) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
      B.add(mat, g);
    }
  }
}

function godownMaterials() {
  const M = materials();
  const std = (color, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    // pastel render, washed in its own colour by the floodlights at night
    walls: PASTELS.map(c => uplitMaterial(c, 0.3, { y0: 0, y1: 11, floor: 0.3, base: c, rough: 0.85 })),
    trim: uplitMaterial(0xfff0dc, 0.3, { y0: 0, y1: 11, floor: 0.3, base: 0xf1eee8, rough: 0.6 }),
    mullion: std(0x3b3a36, 0.5, 0.3),
    shutters: SHUTTERS.map(c => std(c, 0.7)),
    window: std(0x2a2624, 0.6),
    windowLit: nightGlowMaterial(0xffc98a, 1.0, { base: 0x2a2624, rough: 0.6 }),
    // bars and restaurants behind the ground-floor glazing: a warm room by day, glowing at night
    shopfront: nightGlowMaterial(0xffbf80, 1.0, { base: 0x2c2b29, rough: 0.12, metal: 0.4, day: 0.05 }),
    tiles: TILES.map(c => std(c, 0.82)),
    ridge: std(0x7c4330, 0.8),
    soffit: std(0x6a5244, 0.85),
  };
}

/**
 * One block of godowns: rows of gabled units across the block's long axis. H(u) is the roof over the footprint, a
 * row of gables (eave at the valleys, ridge mid-bay) continued linearly past the end walls into the eaves overhang.
 */
function godownBlock(T, ring, mats, seed) {
  const r = signedArea(ring) < 0 ? ring.slice().reverse() : ring.slice();
  const P = pca(r), [ux, uz] = P.dir, [cx, cz] = P.c;
  const nb = Math.max(1, Math.round(P.len / BAY)), bw = P.len / nb, u0 = -P.len / 2, rise = bw / 2 * PITCH;
  const U_ = (x, z) => (x - cx) * ux + (z - cz) * uz, V_ = (x, z) => -(x - cx) * uz + (z - cz) * ux;
  const bayOf = u => Math.min(nb - 1, Math.max(0, Math.floor((u - u0) / bw)));
  const H = u => { const k = bayOf(u), f = (u - u0) / bw - k; return EAVE + rise * (1 - Math.abs(2 * f - 1)); };
  const R = rng(seed);
  const unitHash = (bay, v) => { const k = Math.floor(v / UNIT) + 97; return ((bay * 7919 + k * 104729 + seed * 31) >>> 0) % 9973; };
  const wallOf = (bay, v) => mats.walls[unitHash(bay, v) % mats.walls.length];
  const shutterOf = (bay, v) => mats.shutters[(unitHash(bay, v) >> 3) % mats.shutters.length];
  // breakpoints of a segment p->q where the roof profile or the unit colour changes
  const breaks = (p, q) => {
    const ts = [0, 1], up = U_(...p), uq = U_(...q), vp = V_(...p), vq = V_(...q);
    for (let k = 1; k < nb * 2; k++) { const uk = u0 + k * bw / 2, t = (uk - up) / (uq - up); if (t > 1e-4 && t < 1 - 1e-4) ts.push(t); }
    for (let k = Math.ceil(Math.min(vp, vq) / UNIT); k * UNIT < Math.max(vp, vq); k++) { const t = (k * UNIT - vp) / (vq - vp); if (t > 1e-4 && t < 1 - 1e-4) ts.push(t); }
    return ts.sort((a, b) => a - b);
  };

  // ---- walls, bands and openings
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
    if (l < 0.3) continue;
    const d = [dx / l, dz / l], n = [dz / l, 0, -dx / l]; // (positive area, z south: outward)
    const at = (s, y, off = 0) => [p[0] + d[0] * s + n[0] * off, y, p[1] + d[1] * s + n[2] * off];
    const ts = breaks(p, q);
    for (let k = 0; k < ts.length - 1; k++) {
      const s0 = ts[k] * l, s1 = ts[k + 1] * l, a = at(s0, 0), b = at(s1, 0), m = at((s0 + s1) / 2, 0);
      const mat = wallOf(bayOf(U_(m[0], m[2])), V_(m[0], m[2]));
      T.quad(mat, a, b, at(s1, H(U_(b[0], b[2]))), at(s0, H(U_(a[0], a[2]))), n);
      // signboard band over the shopfronts, cornice under the eaves
      T.quad(mats.trim, at(s0, 3.85, 0.04), at(s1, 3.85, 0.04), at(s1, 4.45, 0.04), at(s0, 4.45, 0.04), n);
      T.quad(mats.trim, at(s0, EAVE - 0.5, 0.05), at(s1, EAVE - 0.5, 0.05), at(s1, EAVE - 0.05, 0.05), at(s0, EAVE - 0.05, 0.05), n);
    }
    if (l < 3.2) continue;
    const nw = Math.max(1, Math.floor((l - 0.8) / 3.6)), step = (l - 0.8) / nw;
    for (let w = 0; w < nw; w++) {
      const s = 0.4 + step * (w + 0.5), c = at(s, 0), bay = bayOf(U_(c[0], c[2])), v = V_(c[0], c[2]);
      const box = (mat, hw, y0, y1, off) => T.quad(mat, at(s - hw, y0, off), at(s + hw, y0, off), at(s + hw, y1, off), at(s - hw, y1, off), n);
      // ground floor: glazed shopfront in a white frame
      box(mats.trim, Math.min(1.5, step / 2 - 0.25), 0.15, 3.75, 0.03);
      const gw = Math.min(1.35, step / 2 - 0.4);
      box(mats.shopfront, gw, 0.3, 3.6, 0.07);
      box(mats.mullion, 0.04, 0.3, 3.6, 0.09); // door mullion and transom
      box(mats.mullion, gw, 2.75, 2.83, 0.09);
      // upper floor: tall window in a white surround with its louvred shutters folded back
      box(mats.trim, 0.78, 4.95, 7.45, 0.04);
      box(R() < 0.35 ? mats.windowLit : mats.window, 0.62, 5.1, 7.25, 0.08);
      for (const sg of [-1, 1]) T.quad(shutterOf(bay, v), at(s + sg * 0.66, 5.1, 0.1), at(s + sg * 1.28, 5.1, 0.1), at(s + sg * 1.28, 7.25, 0.1), at(s + sg * 0.66, 7.25, 0.1), n);
    }
    // a louvred vent high in each gable this wall crosses
    for (let k = 0; k < nb; k++) {
      const ur = u0 + (k + 0.5) * bw, up = U_(...p), uq = U_(...q), t = (ur - up) / (uq - up);
      if (!(t > 0.08 && t < 0.92) || Math.abs(uq - up) < l * 0.5) continue;
      const s = t * l, y = EAVE + rise * 0.42;
      T.quad(mats.trim, at(s - 0.6, y - 0.5, 0.04), at(s + 0.6, y - 0.5, 0.04), at(s + 0.6, y + 0.5, 0.04), at(s - 0.6, y + 0.5, 0.04), n);
      T.quad(mats.window, at(s - 0.45, y - 0.36, 0.07), at(s + 0.45, y - 0.36, 0.07), at(s + 0.45, y + 0.36, 0.07), at(s - 0.45, y + 0.36, 0.07), n);
    }
  }

  // ---- roof: one plane per half bay over the overhanging outline, tiled on top, timber soffit below, fascia round it
  const rr = offsetRing(r, OVERHANG);
  const cu = cx * ux + cz * uz;
  const lines = [-1e4]; for (let k = 1; k < nb * 2; k++) lines.push(u0 + k * bw / 2); lines.push(1e4);
  for (let k = 0; k < lines.length - 1; k++) {
    const piece = clipHalf(clipHalf(rr, ux, uz, lines[k + 1] + cu), -ux, -uz, -(lines[k] + cu));
    if (piece.length < 3) continue;
    const tris = THREE.ShapeUtils.triangulateShape(piece.map(p => new THREE.Vector2(p[0], p[1])), []);
    const tile = mats.tiles[(bayOf((Math.max(lines[k], u0) + Math.min(lines[k + 1], -u0)) / 2) + seed) % mats.tiles.length];
    for (const [a, b, c] of tris) {
      const v = [a, b, c].map(j => { const [x, z] = piece[j]; return [x, H(U_(x, z)), z]; });
      const up = [0, 1, 0], down = [0, -1, 0];
      T.tri(tile, ...v.map(p => [p[0], p[1] + ROOF_T, p[2]]), up);
      T.tri(mats.soffit, ...v.map(p => [p[0], p[1] + 0.02, p[2]]), down);
    }
  }
  for (let i = 0; i < rr.length; i++) {
    const p = rr[i], q = rr[(i + 1) % rr.length], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
    if (l < 0.05) continue;
    const n = [dz / l, 0, -dx / l], ts = breaks(p, q);
    for (let k = 0; k < ts.length - 1; k++) {
      const a = [p[0] + dx * ts[k], 0, p[1] + dz * ts[k]], b = [p[0] + dx * ts[k + 1], 0, p[1] + dz * ts[k + 1]];
      const ha = H(U_(a[0], a[2])), hb = H(U_(b[0], b[2]));
      T.quad(mats.soffit, [a[0], ha, a[2]], [b[0], hb, b[2]], [b[0], hb + ROOF_T, b[2]], [a[0], ha + ROOF_T, a[2]], n);
    }
  }
  // ridge capping along each ridge line, where it crosses the roof outline
  for (let k = 0; k < nb; k++) {
    const ur = u0 + (k + 0.5) * bw, hits = [];
    for (let i = 0; i < rr.length; i++) {
      const p = rr[i], q = rr[(i + 1) % rr.length], up = U_(...p), uq = U_(...q);
      if ((up - ur) * (uq - ur) < 0) { const t = (ur - up) / (uq - up); hits.push(V_(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)); }
    }
    hits.sort((a, b) => a - b);
    const y = EAVE + rise + ROOF_T;
    for (let h = 0; h + 1 < hits.length; h += 2) {
      const W = (v, du, dy) => [cx + ux * (ur + du) - uz * v, y + dy, cz + uz * (ur + du) + ux * v];
      const v0 = hits[h], v1 = hits[h + 1], e = 0.2;
      T.quad(mats.ridge, W(v0, -e, -0.08), W(v1, -e, -0.08), W(v1, 0, 0.14), W(v0, 0, 0.14), [-ux, 0.6, -uz]);
      T.quad(mats.ridge, W(v0, e, -0.08), W(v1, e, -0.08), W(v1, 0, 0.14), W(v0, 0, 0.14), [ux, 0.6, uz]);
    }
  }
}

function umbrellaMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xf3f1f6, roughness: 0.5, metalness: 0.0, side: THREE.DoubleSide, transparent: true, opacity: 0.4, depthWrite: false });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uNight = U.night; sh.uniforms.uTime = U.time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float phase;\nvarying float vRim, vPhase;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRim = uv.y; vPhase = phase;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight, uTime;\nvarying float vRim, vPhase;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nfloat rim = smoothstep(0.86, 0.97, vRim);\ndiffuseColor.a = mix(diffuseColor.a, 0.95, rim);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  // hue drifting between blue, violet and pink, each umbrella a little out of step with its neighbours
  float h = mix(0.6, 0.95, 0.5 + 0.5 * sin(6.2832 * (uTime * 0.02 + vPhase)));
  vec3 c = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  c = mix(vec3(1.0), c, 0.78);
  totalEmissiveRadiance = c * (0.16 + 1.8 * rim) * uNight;
}`);
  };
  mat.customProgramCacheKey = () => 'lmumbrella';
  return mat;
}

/** shortest distance from (x, z) to any edge of the rings */
function distToRings(x, z, rings) {
  let d = Infinity;
  for (const r of rings) for (let i = 0; i < r.length; i++) {
    const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length], ex = bx - ax, ez = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return d;
}

/** The Bluebells along the river walk: each sized to the walk between the godowns' eaves and the quay edge, centred on
 * it, and kept clear of every wall. */
function bluebellSpots(walls, isWater) {
  const inWall = (x, z) => walls.some(r => pointInRing(x, z, r));
  const spots = [];
  let s0 = 0;
  for (let i = 0; i < RIVER_WALK.length - 1; i++) {
    const [ax, az] = RIVER_WALK[i], [bx, bz] = RIVER_WALK[i + 1], l = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / l, dz = (bz - az) / l;
    let s = s0;
    for (; s < l; s += BLUEBELL_SPACING) {
      const px = ax + dx * s, pz = az + dz * s;
      // the river side of the frontage, then the walk across it: the run of open ground that ends at the water
      let wx = -dz, wz = dx;
      const reach = sgn => { for (let k = 1; k <= 30; k++) if (isWater(px + wx * sgn * k, pz + wz * sgn * k)) return k; return 99; };
      if (reach(-1) < reach(1)) { wx = -wx; wz = -wz; }
      let a = null, e = null;
      for (let t = -20; t <= 30; t += 0.5) {
        const x = px + wx * t, z = pz + wz * t;
        if (isWater(x, z)) { if (a !== null) e = t - 1.2; break; } // (stop short of the quay wall)
        if (!inWall(x, z)) { if (a === null) a = t; } else a = null;
      }
      if (a === null || e === null) continue;
      a += OVERHANG + 0.6; // clear of the eaves
      if (e - a < 5) continue;
      const m = (a + e) / 2, x = px + wx * m, z = pz + wz * m;
      const r = Math.min(4.3, (e - a) / 2 - 0.3, distToRings(x, z, walls) - OVERHANG - 0.6);
      if (r < 2.4 || spots.some(p => Math.hypot(p.x - x, p.z - z) < p.r + r + 1)) continue;
      spots.push({ x, z, r });
    }
    s0 = s - l;
  }
  return spots;
}

/** The Angels: big umbrellas on masts down the covered streets, at the height of the old street canopy (OSM 15 m) and
 * clear of the gables. */
function angelSpots(street) {
  if (!street) return [];
  const P = pca(street), [ux, uz] = P.dir, spots = [];
  for (let a = -P.len / 2; a <= P.len / 2; a += ANGEL_GRID) for (let b = -P.wid / 2; b <= P.wid / 2; b += ANGEL_GRID) {
    const x = P.c[0] + ux * a - uz * b, z = P.c[1] + uz * a + ux * b;
    if (!pointInRing(x, z, street)) continue;
    const d = distToRings(x, z, [street]);
    if (d < 2.2) continue;
    spots.push({ x, z, r: Math.min(8.5, d + 3.5) });
  }
  return spots;
}

function umbrellaMesh(spots, B) {
  // a shallow translucent dome with a lip (uv.y: 0 at the pole, 1 at the rim), on a slim pole
  const prof = []; for (let i = 0; i <= 8; i++) { const t = i / 8; prof.push(new THREE.Vector2(Math.max(0.05, t), 1.1 * (1 - t * t) - (t > 0.92 ? (t - 0.92) * 2.5 : 0))); }
  const parts = [];
  spots.forEach((p, i) => {
    const k = p.r / 4.3, g = new THREE.LatheGeometry(prof, p.r > 5 ? 28 : 20); g.scale(p.r, k, p.r); g.translate(p.x, p.h, p.z);
    g.setAttribute('phase', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill((i * 0.37) % 1), 1));
    parts.push(g);
    const mast = p.r > 5 ? 0.22 : 0.12;
    B.add(materials().darkSteel, new THREE.CylinderGeometry(mast * 0.8, mast, p.h + 0.9 * k, 6).translate(p.x, (p.h + 0.9 * k) / 2, p.z));
  });
  if (!parts.length) return null;
  const mesh = new THREE.Mesh(mergeGeometries(parts, false), umbrellaMaterial());
  mesh.name = 'clarke-quay-umbrellas'; mesh.receiveShadow = true;
  return mesh;
}

export function buildClarkeQuay(city, quality, renderer, env = {}) {
  const byId = new Map(city.buildings.map(b => [b.id, b]));
  const blocks = BLOCKS.map(id => byId.get(id)).filter(Boolean);
  const mats = godownMaterials();
  const T = new Tris();
  const walls = blocks.map(b => ringOf(b));
  walls.forEach((r, i) => godownBlock(T, r, mats, 11 + i * 7));
  const B = new Bucket();
  T.addTo(B);
  const street = byId.get(STREETS) ? ringOf(byId.get(STREETS)) : null;
  const angels = angelSpots(street).map(p => ({ ...p, h: ANGEL_H }));
  const bluebells = env.isWater ? bluebellSpots(walls, env.isWater).map(p => ({ ...p, h: BLUEBELL_H })) : [];
  const umbrellas = umbrellaMesh([...angels, ...bluebells], B);
  const meshes = B.build({ name: 'clarke-quay' });
  const group = new THREE.Group(); group.name = 'ClarkeQuay';
  meshes.forEach(m => group.add(m));
  if (umbrellas) group.add(umbrellas);
  const colliders = walls.map(r => {
    const g = extrudeFootprint(r, 0, EAVE);
    return { type: 'trimesh', vertices: new Float32Array(g.attributes.position.array), indices: new Uint32Array([...Array(g.attributes.position.count).keys()]) };
  });
  const exList = [...blocks, byId.get(STREETS), byId.get(STREET_ROOF)].filter(Boolean);
  return {
    group, colliders, reflective: [...meshes, umbrellas].filter(Boolean), // (glowing umbrellas on the river)
    exclusions: exclusionsForBuildings(exList),
    clearings: [...[...bluebells, ...angels].map(p => ({ x: p.x, z: p.z, r: p.r + 1 })), ...[...walls, street].filter(Boolean).map(r => footprintClearing(r, 1.5))],
    pois: [{ id: 'clarkequay', name: 'Clarke Quay', x: -470, y: 0, z: -360 }],
  };
}
