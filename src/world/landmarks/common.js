// Shared helpers for the procedural landmarks: material library, geometry buckets, frames, footprint utils.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U } from '../../gfx/globals.js';

export { THREE, U };

// ---------------------------------------------------------------- random / math
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = t => t * t * (3 - 2 * t);

/** Local frame: origin (x,z), local +x along unit dir (ux,uz) in world, local +z = (-uz, ux) rotated accordingly. */
export function frameMatrix(x, z, ux, uz, y = 0) {
  const theta = Math.atan2(-uz, ux);
  const m = new THREE.Matrix4().makeRotationY(theta);
  m.setPosition(x, y, z);
  return m;
}
export function frameFromAngle(x, z, theta, y = 0) {
  const m = new THREE.Matrix4().makeRotationY(theta);
  m.setPosition(x, y, z);
  return m;
}

// ---------------------------------------------------------------- footprints from city.json
export function ringOf(b) { const r = []; for (let i = 0; i < b.p.length; i += 2) r.push([b.p[i], b.p[i + 1]]); return r; }
export function centroidOf(r) { let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return [x / r.length, z / r.length]; }
export function areaCentroid(r) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; const c = p[0] * q[1] - q[0] * p[1]; a += c; cx += (p[0] + q[0]) * c; cz += (p[1] + q[1]) * c; }
  if (Math.abs(a) < 1e-6) return centroidOf(r);
  return [cx / (3 * a), cz / (3 * a)];
}
export function signedArea(r) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
export function pointInRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export function circlePoly(x, z, r, n = 24) { const out = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; out.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); } return out; }
export function rectPoly(x, z, hx, hz, theta = 0) {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([a, b]) => [x + a * c + b * s, z - a * s + b * c]);
}
/** Exclusion polygons for a list of city buildings: the footprint itself plus a tiny square at its vertex-average centroid. */
export function exclusionsForBuildings(list) {
  const out = [];
  for (const b of list) {
    const r = ringOf(b);
    out.push(r);
    const [cx, cz] = centroidOf(r);
    out.push([[cx - 1.5, cz - 1.5], [cx + 1.5, cz - 1.5], [cx + 1.5, cz + 1.5], [cx - 1.5, cz + 1.5]]);
  }
  return out;
}
/** Resample a closed ring to n points evenly spaced by arc length. */
export function resampleRing(r, n) {
  const segs = []; let total = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; const l = Math.hypot(q[0] - p[0], q[1] - p[1]); segs.push(l); total += l; }
  const out = []; let si = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const target = k / n * total;
    while (acc + segs[si] < target && si < r.length - 1) { acc += segs[si]; si++; }
    const t = segs[si] > 0 ? (target - acc) / segs[si] : 0;
    const p = r[si], q = r[(si + 1) % r.length];
    out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
  }
  return out;
}
/** Principal axis of a ring: {c:[x,z], dir:[ux,uz], len, wid}. */
export function pca(r) {
  const [cx, cz] = centroidOf(r); let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of r) { const dx = x - cx, dz = z - cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ux = Math.cos(ang), uz = Math.sin(ang);
  let mn = 1e9, mx = -1e9, mn2 = 1e9, mx2 = -1e9;
  for (const [x, z] of r) { const u = (x - cx) * ux + (z - cz) * uz, v = -(x - cx) * uz + (z - cz) * ux; mn = Math.min(mn, u); mx = Math.max(mx, u); mn2 = Math.min(mn2, v); mx2 = Math.max(mx2, v); }
  return { c: [cx + ux * (mn + mx) / 2 - uz * (mn2 + mx2) / 2, cz + uz * (mn + mx) / 2 + ux * (mn2 + mx2) / 2], dir: [ux, uz], len: mx - mn, wid: mx2 - mn2 };
}

// ---------------------------------------------------------------- geometry buckets
/** Collects geometries per material and merges them into a single mesh per material. */
export class Bucket {
  constructor() { this.parts = new Map(); }
  add(mat, geo, matrix) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'facade'].includes(k)) g.deleteAttribute(k);
    if (matrix) g.applyMatrix4(matrix);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    return this;
  }
  /** Returns array of meshes (one per material). */
  build({ castShadow = true, receiveShadow = true, name = '' } = {}) {
    const meshes = [];
    for (const [mat, list] of this.parts) {
      // unify attribute sets
      const need = { color: list.some(g => g.attributes.color), facade: list.some(g => g.attributes.facade) };
      for (const g of list) {
        const n = g.attributes.position.count;
        if (need.color && !g.attributes.color) { const c = new Float32Array(n * 3).fill(1); g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); }
        if (need.facade && !g.attributes.facade) g.setAttribute('facade', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      }
      const merged = mergeGeometries(list, false);
      merged.computeBoundingSphere(); merged.computeBoundingBox();
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = castShadow; m.receiveShadow = receiveShadow; m.name = name;
      m.matrixAutoUpdate = false; m.updateMatrix();
      meshes.push(m);
    }
    return meshes;
  }
}

export function triCount(obj) {
  let t = 0;
  obj.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry; const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    t += n * (o.isInstancedMesh ? o.count : 1);
  });
  return Math.round(t);
}

// ---------------------------------------------------------------- geometry primitives
/**
 * Extrude a closed profile (in local (a, y) plane, a = local z) along local x from x0 to x1.
 * facade attribute: (x along extrusion, y) on sides, (a, y) on caps. smoothAngle merges normals below threshold.
 */
export function extrudeProfile(profile, x0, x1, { caps = true, smoothDeg = 25 } = {}) {
  const pos = [], nor = [], fac = [];
  const n = profile.length;
  // orientation: make CCW in (a,y)
  let area = 0; for (let i = 0; i < n; i++) { const p = profile[i], q = profile[(i + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; }
  const P = area < 0 ? profile.slice().reverse() : profile;
  // per-edge normals in (a,y): for CCW polygon outward normal of edge (p->q) is (dy, -da)
  const en = [];
  for (let i = 0; i < n; i++) { const p = P[i], q = P[(i + 1) % n]; const da = q[0] - p[0], dy = q[1] - p[1]; const l = Math.hypot(da, dy) || 1; en.push([dy / l, -da / l]); }
  const cosT = Math.cos(smoothDeg * Math.PI / 180);
  const vn = (i, e) => { // normal at vertex i for edge e (smooth with neighbour if angle small)
    const prev = (i === e) ? (e - 1 + n) % n : (e + 1) % n;
    const a = en[e], b = en[prev];
    if (a[0] * b[0] + a[1] * b[1] > cosT) { const x = a[0] + b[0], y = a[1] + b[1]; const l = Math.hypot(x, y); return [x / l, y / l]; }
    return a;
  };
  let s = 0; // arc length along profile for facade u on sides? we use x for sides
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n; const p = P[i], q = P[j];
    const np = vn(i, i), nq = vn(j, i);
    // quad (x0,p) (x1,p) (x1,q) (x0,q); local coords: (x, y, z=a)
    const v = [[x0, p[1], p[0], np], [x1, p[1], p[0], np], [x1, q[1], q[0], nq], [x0, q[1], q[0], nq]];
    for (const k of [0, 2, 1, 0, 3, 2]) { const w = v[k]; pos.push(w[0], w[1], w[2]); nor.push(0, w[3][1], w[3][0]); fac.push(w[0], w[1]); }
    s += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  if (caps) {
    const tris = THREE.ShapeUtils.triangulateShape(P.map(p => new THREE.Vector2(p[0], p[1])), []);
    for (const [a, b, c] of tris) {
      for (const k of [a, b, c]) { pos.push(x1, P[k][1], P[k][0]); nor.push(1, 0, 0); fac.push(P[k][0], P[k][1]); }
      for (const k of [a, c, b]) { pos.push(x0, P[k][1], P[k][0]); nor.push(-1, 0, 0); fac.push(P[k][0], P[k][1]); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('facade', new THREE.Float32BufferAttribute(fac, 2));
  return g;
}

/** Fix winding so faces point along their normals (mesh built with arbitrary ordering). */
export function fixWinding(g) {
  const p = g.attributes.position.array, n = g.attributes.normal.array;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), fn = new THREE.Vector3(), vn = new THREE.Vector3();
  const swap = (arr, i, j, size) => { for (let k = 0; k < size; k++) { const t = arr[i * size + k]; arr[i * size + k] = arr[j * size + k]; arr[j * size + k] = t; } };
  for (let t = 0; t < p.length / 9; t++) {
    a.fromArray(p, t * 9); b.fromArray(p, t * 9 + 3); c.fromArray(p, t * 9 + 6);
    fn.subVectors(b, a).cross(c.clone().sub(a));
    vn.fromArray(n, t * 9).add(c.fromArray(n, t * 9 + 3)).add(c.fromArray(n, t * 9 + 6));
    if (fn.dot(vn) < 0) {
      for (const [attr, size] of Object.values(g.attributes).map(at => [at.array, at.itemSize])) swap(attr, t * 3 + 1, t * 3 + 2, size);
    }
  }
  return g;
}

/** Extrude a footprint ring (world x,z) between y0 and y1; walls get facade (perimeter metres, y). */
export function extrudeFootprint(ring, y0, y1, { top = true, bottom = false } = {}) {
  const r = signedArea(ring) < 0 ? ring.slice().reverse() : ring.slice(); // ensure positive area (CCW in x,z => clockwise seen from above)
  const pos = [], nor = [], fac = [];
  let u = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    const dx = q[0] - p[0], dz = q[1] - p[1]; const l = Math.hypot(dx, dz) || 1;
    // positive signed area in (x,z) with z south: outward normal = (dz, -dx)/l
    const nx = dz / l, nz = -dx / l;
    const v = [[p[0], y0, p[1], u], [q[0], y0, q[1], u + l], [q[0], y1, q[1], u + l], [p[0], y1, p[1], u]];
    for (const k of [0, 1, 2, 0, 2, 3]) { const w = v[k]; pos.push(w[0], w[1], w[2]); nor.push(nx, 0, nz); fac.push(w[3], w[1]); }
    u += l;
  }
  const tris = THREE.ShapeUtils.triangulateShape(r.map(p => new THREE.Vector2(p[0], p[1])), []);
  if (top) for (const [a, b, c] of tris) for (const k of [a, b, c]) { pos.push(r[k][0], y1, r[k][1]); nor.push(0, 1, 0); fac.push(r[k][0], r[k][1]); }
  if (bottom) for (const [a, b, c] of tris) for (const k of [a, c, b]) { pos.push(r[k][0], y0, r[k][1]); nor.push(0, -1, 0); fac.push(r[k][0], r[k][1]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('facade', new THREE.Float32BufferAttribute(fac, 2));
  return fixWinding(g);
}

/** Thin tube along points (array of Vector3), radius r, radial segments. */
export function tubeAlong(points, r, radial = 6, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  return new THREE.TubeGeometry(curve, Math.max(2, points.length * 2), r, radial, closed);
}
/** Straight cylinder between two points. */
export function strut(a, b, r, radial = 5) {
  const d = new THREE.Vector3().subVectors(b, a); const len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, radial, 1, true);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

/** Grid surface from a function f(i/(nu), j/(nv)) -> Vector3, normals computed. */
export function paramSurface(fn, nu, nv) {
  const pos = [], uv = [], idx = [];
  const v3 = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { fn(i / nu, j / nv, v3); pos.push(v3.x, v3.y, v3.z); uv.push(i / nu, j / nv); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Dome over a footprint ring: returns {geo (with uv in metres), heightAt(x,z)} */
export function domeGeometry(ring, H, { sides = 0.7, n = 120, k = 18, skew = null } = {}) {
  let r = signedArea(ring) < 0 ? ring.slice().reverse() : ring.slice();
  r = resampleRing(r, n);
  const c = areaCentroid(r);
  const rows = [];
  for (let j = 0; j <= k; j++) {
    const th = j / k * Math.PI / 2;
    const sc = Math.pow(Math.cos(th), sides);
    const row = [];
    for (let i = 0; i < n; i++) {
      const [x, z] = r[i];
      const px = c[0] + (x - c[0]) * sc, pz = c[1] + (z - c[1]) * sc;
      let y = H * Math.sin(th);
      if (skew) y *= skew(x, z);
      row.push(new THREE.Vector3(px, y, pz));
    }
    rows.push(row);
  }
  const pos = [], uv = [];
  // arc lengths for uv in metres
  const perim = rows.map(row => { const acc = [0]; for (let i = 1; i <= n; i++) acc.push(acc[i - 1] + row[i % n].distanceTo(row[i - 1])); return acc; });
  const merid = [new Array(n).fill(0)];
  for (let j = 1; j <= k; j++) merid.push(rows[j].map((p, i) => merid[j - 1][i] + p.distanceTo(rows[j - 1][i])));
  for (let j = 0; j < k; j++) for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n;
    const a = rows[j][i], b = rows[j][i1], cc = rows[j + 1][i], d = rows[j + 1][i1];
    const ua = perim[j][i], ub = perim[j][i + 1], uc = perim[j + 1][i] * (perim[j][n] / Math.max(1e-3, perim[j + 1][n])), ud = perim[j + 1][i + 1] * (perim[j][n] / Math.max(1e-3, perim[j + 1][n]));
    const va = merid[j][i], vb = merid[j][i1], vc = merid[j + 1][i], vd = merid[j + 1][i1];
    pos.push(a.x, a.y, a.z, cc.x, cc.y, cc.z, b.x, b.y, b.z, b.x, b.y, b.z, cc.x, cc.y, cc.z, d.x, d.y, d.z);
    uv.push(ua, va, uc, vc, ub, vb, ub, vb, uc, vc, ud, vd);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  // make normals point outward (away from centroid / up)
  const p = geo.attributes.position.array, nn = geo.attributes.normal.array;
  let dot = 0; for (let i = 0; i < p.length; i += 3) dot += (p[i] - c[0]) * nn[i] + p[i + 1] * nn[i + 1] + (p[i + 2] - c[1]) * nn[i + 2];
  if (dot < 0) {
    for (let t = 0; t < p.length / 9; t++) for (let q = 0; q < 3; q++) { const A = t * 9 + 3 + q, Bq = t * 9 + 6 + q; [p[A], p[Bq]] = [p[Bq], p[A]]; }
    const u2 = geo.attributes.uv.array; for (let t = 0; t < u2.length / 6; t++) for (let q = 0; q < 2; q++) { const A = t * 6 + 2 + q, Bq = t * 6 + 4 + q; [u2[A], u2[Bq]] = [u2[Bq], u2[A]]; }
    geo.computeVertexNormals();
  }
  return { geo, c, rows };
}


/** Offset a ring outward (positive d) along vertex normals; d may be a function (i, n) -> metres. */
export function offsetRing(ring, d) {
  const r = signedArea(ring) < 0 ? ring.slice().reverse() : ring.slice();
  const n = r.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = r[(i - 1 + n) % n], b = r[i], c = r[(i + 1) % n];
    let e1x = b[0] - a[0], e1z = b[1] - a[1], l1 = Math.hypot(e1x, e1z) || 1; e1x /= l1; e1z /= l1;
    let e2x = c[0] - b[0], e2z = c[1] - b[1], l2 = Math.hypot(e2x, e2z) || 1; e2x /= l2; e2z /= l2;
    // outward normals for positive-area ring in x/z: (dz, -dx)
    let nx = e1z + e2z, nz = -e1x - e2x; const ln = Math.hypot(nx, nz) || 1; nx /= ln; nz /= ln;
    const cosHalf = Math.max(0.35, nx * e1z - nz * e1x);
    const dd = (typeof d === 'function' ? d(i, n) : d) / cosHalf;
    out.push([b[0] + nx * dd, b[1] + nz * dd]);
  }
  return out;
}
/** Flat polygon (world ring) at height y, facing up (or down). */
export function capGeometry(ring, y, down = false) {
  const tris = THREE.ShapeUtils.triangulateShape(ring.map(p => new THREE.Vector2(p[0], p[1])), []);
  const pos = [];
  for (const t of tris) for (const k of (down ? [t[0], t[2], t[1]] : t)) pos.push(ring[k][0], y, ring[k][1]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const nn = g.attributes.normal.array;
  let flip = false; for (let i = 1; i < nn.length; i += 9) { if ((nn[i] < 0) !== down) { flip = true; break; } }
  if (flip) { const pp = g.attributes.position.array; for (let t = 0; t < pp.length / 9; t++) for (let q = 0; q < 3; q++) { const A = t * 9 + 3 + q, B2 = t * 9 + 6 + q; [pp[A], pp[B2]] = [pp[B2], pp[A]]; } g.computeVertexNormals(); }
  return g;
}
function colorize(g, col) { const c = new Float32Array(g.attributes.position.count * 3); for (let k = 0; k < c.length; k += 3) { c[k] = col.r; c[k + 1] = col.g; c[k + 2] = col.b; } g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); return g; }
/** Small tree (trunk + blob canopy) with vertex colours, base at (x,y,z). */
export function blobTree(x, y, z, s = 1, R = Math.random) {
  const trunk = colorize(new THREE.CylinderGeometry(0.12 * s, 0.18 * s, 2.2 * s, 5).translate(x, y + 1.1 * s, z), new THREE.Color(0x5a4632));
  const crown = new THREE.IcosahedronGeometry(1.4 * s, 1); crown.scale(1, 0.75 + R() * 0.2, 1); crown.translate(x, y + 2.6 * s, z);
  colorize(crown, new THREE.Color().setHSL(0.26 + R() * 0.08, 0.45, 0.2 + R() * 0.1));
  return [trunk.index ? trunk.toNonIndexed() : trunk, crown.index ? crown.toNonIndexed() : crown];
}
/** Palm tree with vertex colours. */
export function palmGeometry(x, y, z, h = 6, R = Math.random) {
  const out = [];
  const lean = (R() - 0.5) * 0.3;
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, h, 6); trunk.translate(0, h / 2, 0); trunk.rotateZ(lean); trunk.translate(x, y, z);
  out.push(colorize(trunk, new THREE.Color(0x7a6650)).toNonIndexed());
  const top = new THREE.Vector3(x - Math.sin(lean) * h, y + Math.cos(lean) * h, z);
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2 + R();
    const f = new THREE.PlaneGeometry(0.7, 3.2, 1, 3); f.translate(0, 1.6, 0);
    const pa = f.attributes.position; for (let k = 0; k < pa.count; k++) { const yy = pa.getY(k); pa.setZ(k, -0.12 * yy * yy); }
    f.rotateX(-1.0 - R() * 0.4); f.rotateY(a); f.translate(top.x, top.y, top.z);
    f.computeVertexNormals();
    out.push(colorize(f, new THREE.Color().setHSL(0.27 + R() * 0.05, 0.5, 0.25 + R() * 0.08)).toNonIndexed());
  }
  return out;
}

// ---------------------------------------------------------------- textures
export function canvasTexture(w, h, draw, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- materials
const GLSL_HASH = /* glsl */`
float lmHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
`;

/**
 * Facade material with procedural window grid driven by the `facade` attribute (metres along wall, metres up).
 * opts: wall, glass colors; cell [colW, floorH]; frame [marginX, sill, head]; lit fraction; warm/cool lights.
 */
export function facadeMaterial(opts = {}) {
  const o = Object.assign({
    wall: 0xe8e6e0, glass: 0x5d7480, cell: [3.6, 3.5], frame: [0.08, 0.12, 0.1], lit: 0.45,
    // curtain-wall glass is a dielectric: dark at normal incidence, sky-reflective at grazing angles (0.85 read as a mirror)
    warm: 0xffc27a, cool: 0xcfe4ff, litIntensity: 2.2, seed: 1, glassRough: 0.08, wallRough: 0.6, glassMetal: 0.3, wallMetal: 0.05,
    bands: 0, // horizontal spandrel band strength
    yMin: 0, groundLit: 0, wallGlow: 0, wallGlowColor: 0xfff1dc,
    accent: 0, accentA: 0x3f7fbf, accentB: 0xe08a3c,
  }, opts);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.2 });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uNight = U.night;
    sh.uniforms.uWall = { value: new THREE.Color(o.wall) };
    sh.uniforms.uGlass = { value: new THREE.Color(o.glass) };
    sh.uniforms.uCell = { value: new THREE.Vector2(...o.cell) };
    sh.uniforms.uFrame = { value: new THREE.Vector3(...o.frame) };
    sh.uniforms.uLit = { value: o.lit };
    sh.uniforms.uWarm = { value: new THREE.Color(o.warm) };
    sh.uniforms.uCool = { value: new THREE.Color(o.cool) };
    sh.uniforms.uLitI = { value: o.litIntensity };
    sh.uniforms.uSeed = { value: o.seed };
    sh.uniforms.uRough = { value: new THREE.Vector4(o.glassRough, o.wallRough, o.glassMetal, o.wallMetal) };
    sh.uniforms.uBands = { value: o.bands };
    sh.uniforms.uYMin = { value: o.yMin };
    sh.uniforms.uWallGlow = { value: new THREE.Color(o.wallGlowColor).multiplyScalar(o.wallGlow) };
    sh.uniforms.uAccent = { value: o.accent };
    sh.uniforms.uAccA = { value: new THREE.Color(o.accentA) };
    sh.uniforms.uAccB = { value: new THREE.Color(o.accentB) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 facade;\nvarying vec2 vFacade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = facade;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vFacade;
uniform float uNight, uLit, uLitI, uSeed, uBands, uYMin;
uniform vec3 uWall, uGlass, uFrame, uWarm, uCool, uWallGlow, uAccA, uAccB; uniform float uAccent;
uniform vec2 uCell; uniform vec4 uRough;
${GLSL_HASH}
float fWin, fFar; vec2 fId, fF;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 c = vFacade / uCell; fId = floor(c); vec2 f = fract(c); fF = f;
  float aa = fwidth(c.x) + fwidth(c.y);
  float wx = smoothstep(uFrame.x - aa, uFrame.x + aa, f.x) * (1.0 - smoothstep(1.0 - uFrame.x - aa, 1.0 - uFrame.x + aa, f.x));
  float wy = smoothstep(uFrame.y - aa, uFrame.y + aa, f.y) * (1.0 - smoothstep(1.0 - uFrame.z - aa, 1.0 - uFrame.z + aa, f.y));
  fWin = wx * wy * step(uYMin, vFacade.y);
  // cells smaller than a pixel: blend to the average window coverage instead of aliasing into sparkle
  fFar = smoothstep(0.3, 0.9, max(fwidth(c.x), fwidth(c.y)));
  fWin = mix(fWin, (1.0 - 2.0 * uFrame.x) * (1.0 - uFrame.y - uFrame.z) * step(uYMin, vFacade.y), fFar);
  float grime = 0.92 + 0.08 * lmHash(floor(vFacade * vec2(0.5, 0.25)) + uSeed);
  vec3 wall = uWall * grime;
  { float ah = lmHash(fId * 0.73 + 17.0 + uSeed); if (ah < uAccent) wall = mix(uAccA, uAccB, step(0.5, lmHash(fId + 5.0))) * grime; }
  float band = uBands * (1.0 - wy);
  wall = mix(wall, wall * 0.8, band);
  float tint = 0.85 + 0.3 * lmHash(fId + uSeed * 7.0);
  diffuseColor.rgb *= mix(wall, uGlass * tint, fWin);
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(uRough.y, uRough.x, fWin);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(uRough.w, uRough.z, fWin);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  // occupancy clusters by floor and by groups of rooms (whole floors dark, a corridor of lit suites), not salt-and-pepper;
  // many lit rooms have curtains drawn (dim, warm)
  float floorOcc = 0.55 + 0.9 * lmHash(vec2(fId.y, uSeed * 3.0));
  float h = lmHash(fId * 1.37 + uSeed) / floorOcc;
  float on = step(h, uLit) * fWin * uNight;
  vec3 lc = mix(uWarm, uCool, step(0.72, lmHash(fId + 3.1 + uSeed)));
  float dh = lmHash(fId * 2.1 + 9.0);
  float dim = dh < 0.45 ? 0.18 + 0.2 * dh : 0.55 + 0.45 * dh;
  // a room's light falls off toward its side walls and the ceiling line: soft panes, not solid lit rectangles
  float pane = (0.55 + 0.45 * smoothstep(0.0, 0.42, min(fF.x, 1.0 - fF.x))) * (0.75 + 0.25 * (1.0 - fF.y));
  vec3 cell = lc * on * uLitI * dim * pane;
  // far away: the mean of the above (no per-room hash sparkle)
  cell = mix(cell, mix(uWarm, uCool, 0.28) * uLit * uLitI * 0.62 * fWin * uNight, fFar);
  totalEmissiveRadiance += cell;
  totalEmissiveRadiance += uWallGlow * (1.0 - fWin) * uNight;
}`);
  };
  mat.customProgramCacheKey = () => 'lmfacade3';
  return mat;
}

/** Emissive "light" material whose intensity follows U.night (and optional base daytime glow). */
export function nightGlowMaterial(color, intensity = 3, { day = 0, base = 0x222222, rough = 0.5, metal = 0.0, side = THREE.FrontSide, transparent = false, opacity = 1 } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: base, roughness: rough, metalness: metal, emissive: new THREE.Color(color), emissiveIntensity: intensity, side, transparent, opacity });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uNight = U.night;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance *= mix(${day.toFixed(3)}, 1.0, uNight);`);
  };
  mat.customProgramCacheKey = () => 'lmglow' + day.toFixed(3);
  return mat;
}

/** Surface washed by floodlights from below at night: emission strongest at the foot (y0) and fading out by y1,
 * over a small uniform floor — the white petals / facades that are lit, rather than glowing, in night photos. */
export function uplitMaterial(color, intensity = 1, { y0 = 0, y1 = 40, floor = 0.05, base = 0xeeeeee, rough = 0.5, metal = 0.0, side = THREE.FrontSide, map = null } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: base, roughness: rough, metalness: metal, emissive: new THREE.Color(color), emissiveIntensity: intensity, side, map, emissiveMap: map });
  mat.onBeforeCompile = sh => {
    sh.uniforms.uNight = U.night;
    sh.uniforms.uUp = { value: new THREE.Vector3(y0, y1, floor) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vUpY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUpY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight; uniform vec3 uUp; varying float vUpY;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  { float k = 1.0 - smoothstep(uUp.x, uUp.y, vUpY); totalEmissiveRadiance *= uNight * (uUp.z + (1.0 - uUp.z) * k * k); }`);
  };
  mat.customProgramCacheKey = () => 'lmuplit';
  return mat;
}

let _lib = null;
export function materials() {
  if (_lib) return _lib;
  _lib = {
    white: new THREE.MeshStandardMaterial({ color: 0xf1eee8, roughness: 0.62, metalness: 0.02 }),
    whiteSmooth: new THREE.MeshStandardMaterial({ color: 0xf7f6f2, roughness: 0.35, metalness: 0.05 }),
    stone: new THREE.MeshStandardMaterial({ color: 0xd9d1c0, roughness: 0.8, metalness: 0.0 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.85, metalness: 0.0 }),
    darkConcrete: new THREE.MeshStandardMaterial({ color: 0x6e6c68, roughness: 0.9, metalness: 0.0 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xc9ced3, roughness: 0.32, metalness: 0.9 }),
    darkSteel: new THREE.MeshStandardMaterial({ color: 0x3c4249, roughness: 0.45, metalness: 0.75 }),
    rustSteel: new THREE.MeshStandardMaterial({ color: 0x5a3b35, roughness: 0.6, metalness: 0.55 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x86a3b4, roughness: 0.06, metalness: 0.92 }),
    darkGlass: new THREE.MeshStandardMaterial({ color: 0x2c3a44, roughness: 0.05, metalness: 0.95 }),
    clearGlass: new THREE.MeshPhysicalMaterial({ color: 0xcfe6ee, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
    terracotta: new THREE.MeshStandardMaterial({ color: 0xa9553a, roughness: 0.7, metalness: 0.0 }),
    roofGrey: new THREE.MeshStandardMaterial({ color: 0x5e6266, roughness: 0.6, metalness: 0.4 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd8a83c, roughness: 0.25, metalness: 1.0 }),
    foliage: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0, vertexColors: true, side: THREE.DoubleSide }),
    planter: new THREE.MeshStandardMaterial({ color: 0x4b7a32, roughness: 0.92 }),
    patina: new THREE.MeshStandardMaterial({ color: 0x5f9a86, roughness: 0.55, metalness: 0.35 }),
    pool: new THREE.MeshStandardMaterial({ color: 0x1d8fb6, roughness: 0.05, metalness: 0.3, emissive: 0x0a4a66, emissiveIntensity: 0.25 }),
    water: new THREE.MeshStandardMaterial({ color: 0x24434c, roughness: 0.04, metalness: 0.6 }),
    deck: new THREE.MeshStandardMaterial({ color: 0x8c7a66, roughness: 0.75, metalness: 0.0 }),
    paving: new THREE.MeshStandardMaterial({ color: 0xbdb5a8, roughness: 0.85, metalness: 0.0 }),
    warmLight: nightGlowMaterial(0xffd7a0, 4.0),
    whiteLight: nightGlowMaterial(0xffffff, 5.0),
    coolLight: nightGlowMaterial(0xbfe0ff, 4.0),
  };
  return _lib;
}
