// Clarke Quay: the five blocks of 1880s riverside godowns, two storeys under rows of orange clay-tiled gables, each
// unit painted its own pastel, bars open on the ground floors; the "Angels" (big umbrella canopies on masts) over the
// paved streets between the blocks and the "Bluebells" (lily-pad umbrellas with a glowing rim) over the dining along
// the river walk. The OSM blocks (15 m slabs the city drew as 4-storey shophouses, and the street canopy as a solid
// block) are rebuilt here. The walls are drawn by the city's own facade shader (materials.js: weathering, cornices,
// pilasters, signboards, shutters, open shopfronts trading by the clock) with records of their own, so the night neon
// and the light pools (world/nightglow.js) follow this bay grid, not the OSM outlines.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  THREE, U, Bucket, materials, nightGlowMaterial, uplitMaterial, ringOf, signedArea, pointInRing, pca, offsetRing,
  exclusionsForBuildings, extrudeFootprint, footprintClearing, canvasTexture, rng,
} from './common.js';

// A Merchants' Court, B The Foundry, C The Cannery, D, the two river-corner units of A, E Traders Market (two parts)
const BLOCKS = [1039, 13, 8356, 1038, 1041, 1040, 11, 1042];
const STREETS = 8358, STREET_ROOF = 8357; // the covered street network between the blocks, and a low roof inside it
const EAVE = 8.4, PITCH = Math.tan(27 * Math.PI / 180), BAY = 8.6, UNIT = 12; // unit: a godown's frontage along a gable
const FLOOR = EAVE / 2;  // two storeys (the facade shader's floor height)
const PIECE = UNIT / 2;  // eave walls are cut every 6 m: the facade shader paints a wall over 8 m as a terrace of shops
const OVERHANG = 0.55, ROOF_T = 0.22;
const RIVER_WALK = [[-434.6, -276.5], [-444.8, -280.4], [-453.2, -287.3], [-463, -313.1], [-466.1, -329.3], [-468.7, -342.4], [-470.1, -349.8], [-474.3, -391.2], [-477.6, -403], [-489, -414.5], [-503, -425.5], [-514.2, -435.1], [-539, -455.5]];
const BLUEBELL_SPACING = 12.5, BLUEBELL_H = 3.8;
const ANGEL_H = 12.6, ANGEL_GRID = 13;
const TILE_M = 2; // metres of roof (and of paving) one texture repeat covers

const PASTELS = [0xf0b0bf, 0xcfe08f, 0xf2dc8e, 0xa3c4e4, 0xc4ade0, 0x9fd8c0, 0xf2bf98, 0x98d0d8];
// the Angels' rims at night: each canopy keeps its own colour
const ANGEL_GLOW = [0xff5fb4, 0x8f6bff, 0x4fc8ff, 0xffb05a];

const lin = hex => new THREE.Color(hex); // (three converts sRGB hex to linear)
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

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

/** flat-shaded triangles per material, wound to face the normal they were given (uv optional) */
class Tris {
  constructor() { this.by = new Map(); }
  tri(mat, a, b, c, n, uv = null) {
    if (!this.by.has(mat)) this.by.set(mat, { pos: [], uv: [] });
    const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2], fx = c[0] - a[0], fy = c[1] - a[1], fz = c[2] - a[2];
    const flip = (ey * fz - ez * fy) * n[0] + (ez * fx - ex * fz) * n[1] + (ex * fy - ey * fx) * n[2] < 0;
    const L = this.by.get(mat);
    L.pos.push(...a, ...(flip ? c : b), ...(flip ? b : c));
    if (uv) L.uv.push(...uv[0], ...(flip ? uv[2] : uv[1]), ...(flip ? uv[1] : uv[2]));
  }
  quad(mat, a, b, c, d, n) { this.tri(mat, a, b, c, n); this.tri(mat, a, c, d, n); }
  addTo(B) {
    for (const [mat, L] of this.by) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(L.pos, 3));
      if (L.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(L.uv, 2));
      g.computeVertexNormals();
      B.add(mat, g);
    }
  }
}

/**
 * Walls for the city's facade shader: position, normal, colour (linear), aWall (metres along the wall, height) and
 * aRec, an index into this landmark's own facade records (8 floats each, the city builder's layout: style, seed, floor
 * height, base | wall length, wall top, block number, accent + 16 * facade flag + 128 * building use). City appends
 * the records to its table and offsets aRec to match.
 */
class FacadeWalls {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.wall = []; this.rec = []; this.records = []; }
  record(f1, f2) { this.records.push(...f1, ...f2); return this.records.length / 8 - 1; }
  /** a wall polygon (convex, in order) on the vertical plane through a along d (unit), facing n; s = metres from a */
  poly(a, d, n, pts, col, rec) {
    const v = pts.map(([s, y]) => [a[0] + d[0] * s, y, a[1] + d[1] * s, s, y]);
    for (let k = 1; k + 1 < v.length; k++) {
      const [p, q, r] = [v[0], v[k], v[k + 1]];
      // wound counter-clockwise seen from outside
      const cross = ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) * n[2] - ((q[2] - p[2]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[2] - p[2])) * n[0];
      for (const w of cross < 0 ? [p, r, q] : [p, q, r]) {
        this.pos.push(w[0], w[1], w[2]); this.nor.push(n[0], 0, n[2]); this.col.push(col.r, col.g, col.b); this.wall.push(w[3], w[4]); this.rec.push(rec);
      }
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aWall', new THREE.Float32BufferAttribute(this.wall, 2));
    g.setAttribute('aRec', new THREE.Float32BufferAttribute(this.rec, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// orange clay pan tiles, ~0.25 m barrels in 0.33 m courses: shading of each barrel, the shadow under every course's
// lip, a tile-to-tile tone (canvas x: along the ridge, y: down the slope; TILE_M metres a repeat)
function roofTileTexture() {
  const t = canvasTexture(256, 256, (ctx, w, h) => {
    const R = rng(29), cols = 8, rows = 6, tw = w / cols, th = h / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = c * tw, y = r * th, k = R();
      const base = k < 0.06 ? [176, 92, 58] : k < 0.12 ? [222, 128, 74] : [206 + R() * 18 - 9, 112 + R() * 14 - 7, 66 + R() * 10 - 5];
      const g = ctx.createLinearGradient(x, 0, x + tw, 0);
      g.addColorStop(0, `rgb(${base.map(v => Math.round(v * 0.62))})`); g.addColorStop(0.45, `rgb(${base.map(v => Math.round(Math.min(255, v * 1.12)))})`);
      g.addColorStop(0.75, `rgb(${base.map(Math.round)})`); g.addColorStop(1, `rgb(${base.map(v => Math.round(v * 0.55))})`);
      ctx.fillStyle = g; ctx.fillRect(x, y, tw, th);
      // the lip of the course above throws a shadow, the tile's own nose is lit
      const s = ctx.createLinearGradient(0, y, 0, y + th * 0.3);
      s.addColorStop(0, 'rgba(40,14,6,0.55)'); s.addColorStop(1, 'rgba(40,14,6,0)');
      ctx.fillStyle = s; ctx.fillRect(x, y, tw, th * 0.3);
      ctx.fillStyle = 'rgba(255,214,170,0.22)'; ctx.fillRect(x + tw * 0.2, y + th * 0.9, tw * 0.6, th * 0.1);
    }
  }, { aniso: 8 });
  t.flipY = false; // (canvas rows run down the slope, as uv.y does)
  return t;
}
// the streets between the godowns: basket-weave clay pavers, warm greys with a few terracotta
function pavingTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const R = rng(31), n = 8, s = w / n;
    ctx.fillStyle = '#6a625a'; ctx.fillRect(0, 0, w, h);
    const tone = () => { const k = R(); return k < 0.2 ? [172, 128, 102] : k < 0.6 ? [164, 156, 146] : k < 0.85 ? [146, 138, 128] : [184, 174, 158]; };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = i * s, y = j * s, along = (i + j) % 2 === 0;
      for (let k = 0; k < 2; k++) {
        const f = 0.93 + R() * 0.14, c = tone().map(v => Math.round(v * f));
        ctx.fillStyle = `rgb(${c})`;
        if (along) ctx.fillRect(x + 1, y + k * s / 2 + 1, s - 2, s / 2 - 2); else ctx.fillRect(x + k * s / 2 + 1, y + 1, s / 2 - 2, s - 2);
      }
    }
  }, { aniso: 8 });
}

function godownMaterials() {
  const M = materials();
  const std = (color, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    trim: uplitMaterial(0xfff0dc, 0.3, { y0: 0, y1: 11, floor: 0.3, base: 0xf1eee8, rough: 0.6 }),
    window: std(0x2a2624, 0.6),
    // (same shader as the Merlion plaza's granite: a map on a standard material, no program of its own)
    tiles: new THREE.MeshStandardMaterial({ map: roofTileTexture(), roughness: 0.72, metalness: 0 }),
    ridge: std(0xb8643e, 0.75),
    // painted timber soffits and fascias (a dark soffit read as a black slab overhead)
    soffit: std(0xd9cbb4, 0.8),
    fascia: std(0xefe9df, 0.6),
    mast: M.darkSteel,
  };
}

/**
 * One block of godowns: rows of gabled units across the block's long axis. H(u) is the roof over the footprint, a
 * row of gables (eave at the valleys, ridge mid-bay) continued linearly past the end walls into the eaves overhang.
 * Returns the block's shopfronts (wall pieces, for the neon) as { a, b, n, id }.
 */
function godownBlock(T, W, ring, mats, seed) {
  const r = signedArea(ring) < 0 ? ring.slice().reverse() : ring.slice();
  const P = pca(r), [ux, uz] = P.dir, [cx, cz] = P.c;
  const nb = Math.max(1, Math.round(P.len / BAY)), bw = P.len / nb, u0 = -P.len / 2, rise = bw / 2 * PITCH;
  const U_ = (x, z) => (x - cx) * ux + (z - cz) * uz, V_ = (x, z) => -(x - cx) * uz + (z - cz) * ux;
  const bayOf = u => Math.min(nb - 1, Math.max(0, Math.floor((u - u0) / bw)));
  const H = u => { const k = bayOf(u), f = (u - u0) / bw - k; return EAVE + rise * (1 - Math.abs(2 * f - 1)); };
  const unitHash = (bay, v) => { const k = Math.floor(v / UNIT) + 97; return ((bay * 7919 + k * 104729 + seed * 31) >>> 0) % 9973; };
  // breakpoints of a segment p->q: the roof profile's kinks (half bays) and every PIECE along the block's width
  const breaks = (p, q, step = PIECE) => {
    const ts = [0, 1], up = U_(...p), uq = U_(...q), vp = V_(...p), vq = V_(...q);
    for (let k = 1; k < nb * 2; k++) { const uk = u0 + k * bw / 2, t = (uk - up) / (uq - up); if (t > 1e-4 && t < 1 - 1e-4) ts.push(t); }
    for (let k = Math.ceil(Math.min(vp, vq) / step); k * step < Math.max(vp, vq); k++) { const t = (k * step - vp) / (vq - vp); if (t > 1e-4 && t < 1 - 1e-4) ts.push(t); }
    return ts.sort((a, b) => a - b);
  };
  const fronts = [];

  // ---- walls: a two-storey shopfront per piece (style 4, flag 1: signboards over the shopfronts, retail use) under
  // the plain gable above the eave (style 11), one godown unit's colour, seed and shutters
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
    if (l < 0.3) continue;
    const d = [dx / l, dz / l], n = [dz / l, 0, -dx / l]; // (positive area, z south: outward)
    const ts = breaks(p, q);
    for (let k = 0; k < ts.length - 1; k++) {
      const s0 = ts[k] * l, s1 = ts[k + 1] * l, len = s1 - s0;
      if (len < 0.05) continue;
      const a = [p[0] + d[0] * s0, p[1] + d[1] * s0], b = [p[0] + d[0] * s1, p[1] + d[1] * s1], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const uh = unitHash(bayOf(U_(...m)), V_(...m)), col = lin(PASTELS[uh % PASTELS.length]), unitSeed = hash(uh * 0.71 + seed);
      const accent = (uh >> 3) % 8, ha = H(U_(...a)), hb = H(U_(...b));
      const shop = W.record([4, unitSeed, FLOOR, 0], [len, EAVE, 0, accent + 16 * 1 + 128 * 1]);
      W.poly(a, d, n, [[0, 0], [len, 0], [len, EAVE], [0, EAVE]], col, shop);
      if (ha > EAVE + 0.01 || hb > EAVE + 0.01) W.poly(a, d, n, [[0, EAVE], [len, EAVE], [len, hb], [0, ha]], col, W.record([11, unitSeed, FLOOR, 0], [len, Math.max(ha, hb), 0, accent]));
      if (len > 2.5) fronts.push({ a, b, n: [n[0], n[2]], id: uh + seed * 0.37 });
    }
    // a louvred vent high in each gable this wall crosses
    if (l < 3.2) continue;
    const at = (s, y, off = 0) => [p[0] + d[0] * s + n[0] * off, y, p[1] + d[1] * s + n[2] * off];
    for (let k = 0; k < nb; k++) {
      const ur = u0 + (k + 0.5) * bw, up = U_(...p), uq = U_(...q), t = (ur - up) / (uq - up);
      if (!(t > 0.08 && t < 0.92) || Math.abs(uq - up) < l * 0.5) continue;
      const s = t * l, y = EAVE + rise * 0.42;
      T.quad(mats.trim, at(s - 0.6, y - 0.5, 0.04), at(s + 0.6, y - 0.5, 0.04), at(s + 0.6, y + 0.5, 0.04), at(s - 0.6, y + 0.5, 0.04), n);
      T.quad(mats.window, at(s - 0.45, y - 0.36, 0.07), at(s + 0.45, y - 0.36, 0.07), at(s + 0.45, y + 0.36, 0.07), at(s - 0.45, y + 0.36, 0.07), n);
    }
  }

  // ---- roof: one plane per half bay over the overhanging outline, clay tiles on top (uv: along the ridge, down the
  // slope), painted soffit below, a white fascia board round it
  const rr = offsetRing(r, OVERHANG);
  const cu = cx * ux + cz * uz, slope = Math.sqrt(1 + PITCH * PITCH);
  const lines = [-1e4]; for (let k = 1; k < nb * 2; k++) lines.push(u0 + k * bw / 2); lines.push(1e4);
  for (let k = 0; k < lines.length - 1; k++) {
    const piece = clipHalf(clipHalf(rr, ux, uz, lines[k + 1] + cu), -ux, -uz, -(lines[k] + cu));
    if (piece.length < 3) continue;
    const tris = THREE.ShapeUtils.triangulateShape(piece.map(p => new THREE.Vector2(p[0], p[1])), []);
    const ridgeU = u0 + (bayOf((Math.max(lines[k], u0) + Math.min(lines[k + 1], -u0)) / 2) + 0.5) * bw;
    for (const [a, b, c] of tris) {
      const v = [a, b, c].map(j => { const [x, z] = piece[j]; return [x, H(U_(x, z)), z]; });
      const uv = v.map(([x, , z]) => [V_(x, z) / TILE_M, Math.abs(U_(x, z) - ridgeU) * slope / TILE_M]);
      T.tri(mats.tiles, ...v.map(p => [p[0], p[1] + ROOF_T, p[2]]), [0, 1, 0], uv);
      T.tri(mats.soffit, ...v.map(p => [p[0], p[1] + 0.02, p[2]]), [0, -1, 0]);
    }
  }
  for (let i = 0; i < rr.length; i++) {
    const p = rr[i], q = rr[(i + 1) % rr.length], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz);
    if (l < 0.05) continue;
    const n = [dz / l, 0, -dx / l], ts = breaks(p, q, 1e9);
    for (let k = 0; k < ts.length - 1; k++) {
      const a = [p[0] + dx * ts[k], 0, p[1] + dz * ts[k]], b = [p[0] + dx * ts[k + 1], 0, p[1] + dz * ts[k + 1]];
      const ha = H(U_(a[0], a[2])), hb = H(U_(b[0], b[2]));
      T.quad(mats.fascia, [a[0], ha - 0.06, a[2]], [b[0], hb - 0.06, b[2]], [b[0], hb + ROOF_T + 0.02, b[2]], [a[0], ha + ROOF_T + 0.02, a[2]], n);
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
      const Wp = (v, du, dy) => [cx + ux * (ur + du) - uz * v, y + dy, cz + uz * (ur + du) + ux * v];
      const v0 = hits[h], v1 = hits[h + 1], e = 0.2;
      T.quad(mats.ridge, Wp(v0, -e, -0.08), Wp(v1, -e, -0.08), Wp(v1, 0, 0.14), Wp(v0, 0, 0.14), [-ux, 0.6, -uz]);
      T.quad(mats.ridge, Wp(v0, e, -0.08), Wp(v1, e, -0.08), Wp(v1, 0, 0.14), Wp(v0, 0, 0.14), [ux, 0.6, uz]);
    }
  }
  return fronts;
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

/** [xmin, zmin, xmax, zmax] of the rings, grown by pad */
function bounds(rings, pad) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const r of rings) for (const [x, z] of r) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
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

/** The Bluebells: shallow translucent domes with a lip (uv.y: 0 at the pole, 1 at the rim) on slim poles */
function bluebellMesh(spots, B, mats) {
  const prof = []; for (let i = 0; i <= 8; i++) { const t = i / 8; prof.push(new THREE.Vector2(Math.max(0.05, t), 1.1 * (1 - t * t) - (t > 0.92 ? (t - 0.92) * 2.5 : 0))); }
  const parts = spots.map((p, i) => {
    const k = p.r / 4.3, g = new THREE.LatheGeometry(prof, 20); g.scale(p.r, k, p.r); g.translate(p.x, p.h, p.z);
    g.setAttribute('phase', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill((i * 0.37) % 1), 1));
    B.add(mats.mast, new THREE.CylinderGeometry(0.1, 0.12, p.h + 0.9 * k, 6).translate(p.x, (p.h + 0.9 * k) / 2, p.z));
    return g;
  });
  if (!parts.length) return null;
  const mesh = new THREE.Mesh(mergeGeometries(parts, false), umbrellaMaterial());
  mesh.name = 'clarke-quay-bluebells'; mesh.receiveShadow = true;
  return mesh;
}

/** The Angels: an opaque membrane disc (a shallow dome over a flatter underside, washed from below at night) with a
 * band of light round its rim, on a mast with a few struts. All palette materials: part of the landmark's one draw. */
function angels(spots, B, mats) {
  const under = uplitMaterial(0xfff1e2, 0.55, { y0: ANGEL_H - 1, y1: ANGEL_H + 1.5, floor: 0.35, base: 0xf4f1ea, rough: 0.7 });
  const top = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.55 });
  const rims = ANGEL_GLOW.map(c => nightGlowMaterial(c, 2.2, { base: 0xf4f1ea, rough: 0.5 }));
  spots.forEach((p, i) => {
    const seg = 28, y = ANGEL_H;
    // lathe profiles (radius, height): the dome over the rim band, the underside rising to the mast
    const dome = []; for (let k = 0; k <= 6; k++) { const t = k / 6; dome.push(new THREE.Vector2(p.r * (1 - t) + 0.05, y + 0.35 + 1.1 * Math.sin(t * Math.PI / 2))); }
    B.add(top, new THREE.LatheGeometry(dome, seg).translate(p.x, 0, p.z));
    const und = []; for (let k = 0; k <= 4; k++) { const t = k / 4; und.push(new THREE.Vector2(0.05 + p.r * t, y + 0.9 * (1 - t) * (1 - t))); }
    B.add(under, new THREE.LatheGeometry(und, seg).translate(p.x, 0, p.z));
    B.add(rims[i % rims.length], new THREE.CylinderGeometry(p.r, p.r, 0.35, seg, 1, true).translate(p.x, y + 0.175, p.z));
    B.add(mats.mast, new THREE.CylinderGeometry(0.18, 0.24, y + 0.9, 8).translate(p.x, (y + 0.9) / 2, p.z));
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + i, c = Math.cos(a), s = Math.sin(a), L = p.r * 0.62;
      const g = new THREE.CylinderGeometry(0.05, 0.05, Math.hypot(L, 2.6), 4);
      g.rotateZ(-Math.atan2(L, 2.6)).translate(L / 2, y - 1.4, 0).rotateY(-a).translate(p.x, 0, p.z);
      B.add(mats.mast, g);
    }
  });
}

/** Bar tables (with parasols out in the open) along the shopfronts facing the streets and the river walk, and round
 * each Bluebell: returned as street furniture placements and the seats people sit on at night. */
function terraces(fronts, walls, bluebells, angelList, city, isWater) {
  const [x0, z0, x1, z1] = bounds(walls, 40);
  const roads = city.roads.filter(r => r.c < 7 && r.p.some((v, i) => i % 2 ? v > z0 && v < z1 : v > x0 && v < x1));
  const nearRoad = (x, z) => roads.some(r => { for (let i = 0; i + 3 < r.p.length; i += 2) { const ax = r.p[i], az = r.p[i + 1], vx = r.p[i + 2] - ax, vz = r.p[i + 3] - az, L2 = vx * vx + vz * vz || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)); if (Math.hypot(x - ax - vx * t, z - az - vz * t) < r.w / 2 + 2) return true; } return false; });
  const pieces = [], seats = [], taken = [];
  const free = (x, z, r) => !isWater(x, z) && !walls.some(w => pointInRing(x, z, w)) && distToRings(x, z, walls) > 1.6 && !taken.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < r) && !nearRoad(x, z);
  const covered = (x, z) => [...angelList, ...bluebells].some(p => Math.hypot(p.x - x, p.z - z) < p.r);
  const table = (x, z, yaw, h, parasol) => {
    pieces.push(['barTable', x, z, yaw, h]);
    if (parasol) pieces.push(['parasol', x, z, yaw, hash(x * 3.1 + z)]);
    taken.push([x, z]);
    // the chairs (streetpieces.js barTable: two facing across local z, four on every side for h >= 0.5)
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const [lx, lz] of h < 0.5 ? [[0, 0.62], [0, -0.62]] : [[0, 0.62], [0, -0.62], [0.62, 0], [-0.62, 0]]) {
      const ox = lx * c + lz * s, oz = -lx * s + lz * c;
      seats.push([x + ox, z + oz, Math.atan2(ox, oz)]); // (facing the table: a seated pose looks along -yaw)
    }
  };
  for (const f of fronts) {
    const dx = f.b[0] - f.a[0], dz = f.b[1] - f.a[1], len = Math.hypot(dx, dz), yaw = Math.atan2(f.n[0], f.n[1]);
    // only fronts with room for a terrace and the walk past it (no other block within 6 m)
    for (let s = 1.4; s < len - 1.2; s += 2.6) {
      const x = f.a[0] + dx * s / len + f.n[0] * 2.2, z = f.a[1] + dz * s / len + f.n[1] * 2.2;
      if (distToRings(f.a[0] + dx * s / len + f.n[0] * 6, f.a[1] + dz * s / len + f.n[1] * 6, walls) < 4 || !free(x, z, 2.3)) continue;
      const h = hash(x * 0.37 + z * 1.3);
      if (h < 0.3) continue; // a gap for the door
      table(x, z, yaw, h, !covered(x, z) && h > 0.55);
    }
  }
  for (const b of bluebells) for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + b.x, x = b.x + Math.cos(a) * b.r * 0.55, z = b.z + Math.sin(a) * b.r * 0.55;
    if (free(x, z, 2.0)) table(x, z, a, hash(x + z * 7.1), false);
  }
  return { pieces, seats };
}

/** the precinct's paving: the streets under the Angels and the alleys between the blocks (ground within a few metres
 * of two of them), sampled on a 1 m grid and outlined by marching squares (runs of whole cells merged), uv in texture
 * repeats */
function pavingGeometry(walls, street, isWater) {
  const pos = [], y = 0.045, c = 1, [x0, z0, x1, z1] = bounds(walls, 0);
  const boxes = walls.map(r => bounds([r], 6));
  const nearBlocks = (x, z) => {
    let n = 0;
    for (let i = 0; i < walls.length; i++) { const b = boxes[i]; if (x > b[0] && x < b[2] && z > b[1] && z < b[3] && distToRings(x, z, [walls[i]]) < 6) n++; }
    return n;
  };
  const paved = (x, z) => !isWater(x, z) && !walls.some(r => pointInRing(x, z, r)) && ((street && pointInRing(x, z, street)) || nearBlocks(x, z) >= 2);
  const nx = Math.ceil((x1 - x0) / c) + 1, nz = Math.ceil((z1 - z0) / c) + 1, inside = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) inside[j * nx + i] = paved(x0 + i * c, z0 + j * c) ? 1 : 0;
  const polygon = pts => { for (let k = 1; k + 1 < pts.length; k++) for (const p of [pts[0], pts[k + 1], pts[k]]) pos.push(p[0], y, p[1]); };
  for (let j = 0; j + 1 < nz; j++) {
    let run = -1;
    for (let i = 0; i < nx; i++) {
      const za = z0 + j * c, xa = x0 + i * c;
      const k = [inside[j * nx + i], inside[j * nx + i + 1], inside[(j + 1) * nx + i + 1], inside[(j + 1) * nx + i]];
      const full = i + 1 < nx && k[0] && k[1] && k[2] && k[3];
      if (full) { if (run < 0) run = xa; continue; }
      if (run >= 0) { polygon([[run, za], [xa, za], [xa, za + c], [run, za + c]]); run = -1; }
      if (i + 1 >= nx || !(k[0] || k[1] || k[2] || k[3])) continue;
      // a boundary cell: its paved corners and the midpoints of the edges where paving starts or stops, in order
      const corner = [[xa, za], [xa + c, za], [xa + c, za + c], [xa, za + c]], pts = [];
      for (let e = 0; e < 4; e++) {
        const f = (e + 1) % 4;
        if (k[e]) pts.push(corner[e]);
        if (k[e] !== k[f]) pts.push([(corner[e][0] + corner[f][0]) / 2, (corner[e][1] + corner[f][1]) / 2]);
      }
      polygon(pts);
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2).map((_, i) => pos[(i >> 1) * 3 + (i & 1) * 2] / TILE_M), 2));
  return g;
}

export function buildClarkeQuay(city, quality, renderer, env = {}) {
  const byId = new Map(city.buildings.map(b => [b.id, b]));
  const blocks = BLOCKS.map(id => byId.get(id)).filter(Boolean);
  const mats = godownMaterials();
  const T = new Tris(), W = new FacadeWalls();
  const walls = blocks.map(b => ringOf(b));
  const fronts = walls.flatMap((r, i) => godownBlock(T, W, r, mats, 11 + i * 7));
  const B = new Bucket();
  T.addTo(B);
  const street = byId.get(STREETS) ? ringOf(byId.get(STREETS)) : null;
  const angelList = angelSpots(street);
  angels(angelList, B, mats);
  const isWater = env.isWater || (() => false);
  const bluebells = env.isWater ? bluebellSpots(walls, env.isWater).map(p => ({ ...p, h: BLUEBELL_H })) : [];
  const umbrellas = bluebellMesh(bluebells, B, mats);
  const meshes = B.build({ name: 'clarke-quay' });
  const group = new THREE.Group(); group.name = 'ClarkeQuay';
  meshes.forEach(m => group.add(m));
  if (umbrellas) group.add(umbrellas);
  const wallGeo = W.geometry();
  const facade = new THREE.Mesh(wallGeo, env.facade);
  facade.name = 'clarke-quay-walls'; facade.castShadow = facade.receiveShadow = true; facade.matrixAutoUpdate = false;
  group.add(facade);
  const pave = pavingGeometry(walls, street, isWater);
  if (pave) {
    const m = new THREE.Mesh(pave, new THREE.MeshStandardMaterial({ map: pavingTexture(), roughness: 0.82, metalness: 0 }));
    m.name = 'clarke-quay-paving'; m.receiveShadow = true; m.matrixAutoUpdate = false; group.add(m);
  }
  const { pieces, seats } = terraces(fronts, walls, bluebells, angelList, city, isWater);
  const colliders = walls.map(r => {
    const g = extrudeFootprint(r, 0, EAVE);
    return { type: 'trimesh', vertices: new Float32Array(g.attributes.position.array), indices: new Uint32Array([...Array(g.attributes.position.count).keys()]) };
  });
  const exList = [...blocks, byId.get(STREETS), byId.get(STREET_ROOF)].filter(Boolean);
  return {
    group, colliders, reflective: [...meshes, umbrellas, facade].filter(Boolean), // (glowing umbrellas on the river)
    exclusions: exclusionsForBuildings(exList),
    clearings: [...[...bluebells, ...angelList].map(p => ({ x: p.x, z: p.z, r: p.r + 1 })), ...[...walls, street].filter(Boolean).map(r => footprintClearing(r, 1.5))],
    facades: [{ geometry: wallGeo, records: new Float32Array(W.records) }],
    // the godowns' shopfronts for the night neon and light pools: this bay grid, two floors of FLOOR, eaves at EAVE
    fronts: fronts.map(f => ({ ...f, fh: FLOOR, wallTop: EAVE, flat: false, nightlife: true, shopUse: true, eave: null })),
    furniture: pieces,
    pois: [{ id: 'clarkequay', name: 'Clarke Quay', x: -470, y: 0, z: -360, seats }],
  };
}
