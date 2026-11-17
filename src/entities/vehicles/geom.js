// Geometry helpers for procedural vehicles: part accumulation into a single uber-attribute
// geometry, lofted grids, implicit-region clipping (for lights/decals that hug curved bodies).
import * as THREE from 'three';
import { MAT } from './material.js';

const _v = new THREE.Vector3(), _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

/** Accumulates part geometries tagged with uber-material surface types, then merges them. */
export class PartBuilder {
  constructor(atlas) {
    this.atlas = atlas;
    this.parts = [];
    this.whiteUV = atlas ? atlas.whiteUV : [0.004, 0.004];
  }

  /**
   * @param {THREE.BufferGeometry} geo
   * @param {string} mat key of MAT
   * @param {{matrix?:THREE.Matrix4, color?:number, emit?:number, uv?:(p:THREE.Vector3,n:THREE.Vector3)=>[number,number], uvRect?:[number,number,number,number], rough?:number, metal?:number, cc?:number, mirror?:boolean}} o
   */
  add(geo, mat, o = {}) {
    const M = MAT[mat];
    if (!M) throw new Error('unknown vehicle material ' + mat);
    let g = geo;
    if (o.matrix) { g = g.clone(); g.applyMatrix4(o.matrix); }
    if (!g.attributes.normal) g.computeVertexNormals();
    const pos = g.attributes.position, nrm = g.attributes.normal, n = pos.count;
    let idx;
    if (g.index) idx = Uint32Array.from(g.index.array);
    else { idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; }
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), UV = new Float32Array(n * 2);
    const C = new Float32Array(n * 3), MP = new Float32Array(n * 4), E = new Float32Array(n * 4);
    const col = o.color != null ? new THREE.Color(o.color) : M.lin;
    const em = o.emit != null ? new THREE.Color(o.emit) : M.emitLin;
    const rough = o.rough ?? M.rough, metal = o.metal ?? M.metal, cc = o.cc ?? M.cc, flag = o.flag ?? M.flag;
    const srcUV = g.attributes.uv;
    for (let i = 0; i < n; i++) {
      P[i * 3] = pos.getX(i); P[i * 3 + 1] = pos.getY(i); P[i * 3 + 2] = pos.getZ(i);
      N[i * 3] = nrm.getX(i); N[i * 3 + 1] = nrm.getY(i); N[i * 3 + 2] = nrm.getZ(i);
      if (o.uv) {
        _v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); _n.set(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
        const uv = o.uv(_v, _n); UV[i * 2] = uv[0]; UV[i * 2 + 1] = uv[1];
      } else if (o.uvRect && srcUV) {
        const [u0, v0, u1, v1] = o.uvRect;
        UV[i * 2] = u0 + srcUV.getX(i) * (u1 - u0); UV[i * 2 + 1] = v0 + (1 - srcUV.getY(i)) * (v1 - v0);
      } else { UV[i * 2] = this.whiteUV[0]; UV[i * 2 + 1] = this.whiteUV[1]; }
      C[i * 3] = col.r; C[i * 3 + 1] = col.g; C[i * 3 + 2] = col.b;
      MP[i * 4] = rough; MP[i * 4 + 1] = metal; MP[i * 4 + 2] = cc; MP[i * 4 + 3] = flag;
      if (em) { E[i * 4] = em.r; E[i * 4 + 1] = em.g; E[i * 4 + 2] = em.b; }
      E[i * 4 + 3] = M.ch;
    }
    this.parts.push({ P, N, UV, C, MP, E, idx, mat });
    if (o.mirror) {
      // mirrored copy across x = 0 (flip winding)
      const P2 = P.slice(), N2 = N.slice(), idx2 = idx.slice();
      for (let i = 0; i < n; i++) { P2[i * 3] = -P2[i * 3]; N2[i * 3] = -N2[i * 3]; }
      for (let i = 0; i < idx2.length; i += 3) { const t = idx2[i + 1]; idx2[i + 1] = idx2[i + 2]; idx2[i + 2] = t; }
      let UV2 = UV;
      if (o.uv) {
        UV2 = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) { _v.set(P2[i * 3], P2[i * 3 + 1], P2[i * 3 + 2]); _n.set(N2[i * 3], N2[i * 3 + 1], N2[i * 3 + 2]); const uv = o.uv(_v, _n); UV2[i * 2] = uv[0]; UV2[i * 2 + 1] = uv[1]; }
      }
      this.parts.push({ P: P2, N: N2, UV: UV2, C, MP, E, idx: idx2, mat });
    }
    if (g !== geo) g.dispose();
    return this;
  }

  get triangleCount() { return this.parts.reduce((s, p) => s + p.idx.length / 3, 0); }

  build() {
    let nv = 0, ni = 0;
    for (const p of this.parts) { nv += p.P.length / 3; ni += p.idx.length; }
    const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), UV = new Float32Array(nv * 2);
    const C = new Float32Array(nv * 3), MP = new Float32Array(nv * 4), E = new Float32Array(nv * 4);
    const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let ov = 0, oi = 0;
    for (const p of this.parts) {
      const n = p.P.length / 3;
      P.set(p.P, ov * 3); N.set(p.N, ov * 3); UV.set(p.UV, ov * 2); C.set(p.C, ov * 3); MP.set(p.MP, ov * 4); E.set(p.E, ov * 4);
      for (let i = 0; i < p.idx.length; i++) I[oi + i] = p.idx[i] + ov;
      ov += n; oi += p.idx.length;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setAttribute('matp', new THREE.BufferAttribute(MP, 4));
    g.setAttribute('emit', new THREE.BufferAttribute(E, 4));
    g.setIndex(new THREE.BufferAttribute(I, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

/**
 * Concatenates built PartBuilder geometries into `target`, tagging each source's vertices with its part id (the rig's
 * float attribute `part`, see material.js). A lone source keeps its own attribute buffers (nothing copied or uploaded
 * twice) and only gains the tag; otherwise the first source comes first in the merged arrays and is rebuilt as a view
 * of them, so its data isn't held twice.
 * @param {{geometry: THREE.BufferGeometry, part: number}[]} sources
 */
export function mergeParts(sources, target = new THREE.BufferGeometry()) {
  const first = sources[0].geometry, names = Object.keys(first.attributes);
  const nv = sources.reduce((s, p) => s + p.geometry.attributes.position.count, 0);
  const tag = new Float32Array(nv);
  if (sources.length === 1) {
    for (const k of names) target.setAttribute(k, first.attributes[k]);
    target.setIndex(first.index);
    tag.fill(sources[0].part);
  } else {
    const ni = sources.reduce((s, p) => s + p.geometry.index.count, 0);
    const I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    for (const k of names) {
      const a = first.attributes[k], out = new a.array.constructor(nv * a.itemSize);
      let o = 0;
      for (const { geometry: g } of sources) { out.set(g.attributes[k].array, o); o += g.attributes[k].array.length; }
      target.setAttribute(k, new THREE.BufferAttribute(out, a.itemSize, a.normalized));
    }
    let ov = 0, oi = 0;
    for (const { geometry: g, part } of sources) {
      const n = g.attributes.position.count, idx = g.index.array;
      for (let i = 0; i < idx.length; i++) I[oi + i] = idx[i] + ov;
      tag.fill(part, ov, ov + n);
      ov += n; oi += idx.length;
    }
    target.setIndex(new THREE.BufferAttribute(I, 1));
    const n = first.attributes.position.count;
    for (const k of names) { const a = target.attributes[k]; first.setAttribute(k, new THREE.BufferAttribute(a.array.subarray(0, n * a.itemSize), a.itemSize, a.normalized)); }
    first.setIndex(new THREE.BufferAttribute(I.subarray(0, first.index.count), 1));
  }
  target.setAttribute('part', new THREE.BufferAttribute(tag, 1));
  return target;
}

/**
 * Grid surface from rows of points (rows = stations, columns = section loop).
 * Normals are smooth within the grid. `flip` reverses winding.
 */
export function gridGeometry(rows, flip = false, fixedNormal = null) {
  const R = rows.length, Cn = rows[0].length;
  const pos = new Float32Array(R * Cn * 3);
  for (let i = 0; i < R; i++) for (let j = 0; j < Cn; j++) { const p = rows[i][j]; pos.set([p[0], p[1], p[2]], (i * Cn + j) * 3); }
  const idx = [];
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < Cn - 1; j++) {
    const a = i * Cn + j, b = (i + 1) * Cn + j, c = (i + 1) * Cn + j + 1, d = i * Cn + j + 1;
    if (flip) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  if (fixedNormal) {
    const nn = new Float32Array(R * Cn * 3);
    for (let i = 0; i < R * Cn; i++) nn.set(fixedNormal, i * 3);
    g.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
  } else g.computeVertexNormals();
  return g;
}

/** Extract a subset of quads from a grid (by predicate on row/col of the quad) as a new geometry with shared normals. */
export function gridSubset(geo, cols, pred) {
  const idx = geo.index.array, out = [];
  for (let k = 0; k < idx.length; k += 6) {
    // quads are emitted as 6 indices; first index is the quad's (i, j) corner
    const a = idx[k], i = Math.floor(a / cols), j = a % cols;
    if (pred(i, j)) for (let q = 0; q < 6; q++) out.push(idx[k + q]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', geo.attributes.position);
  g.setAttribute('normal', geo.attributes.normal);
  g.setIndex(out);
  return compact(g);
}

/** Removes unused vertices from an indexed geometry (keeps position/normal/uv). */
export function compact(g) {
  const idx = g.index.array, map = new Map(), names = Object.keys(g.attributes);
  const data = Object.fromEntries(names.map(n => [n, []]));
  const ni = new Uint32Array(idx.length);
  for (let k = 0; k < idx.length; k++) {
    const v = idx[k];
    let m = map.get(v);
    if (m === undefined) {
      m = map.size; map.set(v, m);
      for (const n of names) { const a = g.attributes[n]; for (let c = 0; c < a.itemSize; c++) data[n].push(a.array[v * a.itemSize + c]); }
    }
    ni[k] = m;
  }
  const o = new THREE.BufferGeometry();
  for (const n of names) o.setAttribute(n, new THREE.BufferAttribute(new Float32Array(data[n]), g.attributes[n].itemSize));
  o.setIndex(new THREE.BufferAttribute(ni, 1));
  return o;
}

/** Flat polygon cap (contour of [x,y] in the plane z = const). */
export function capGeometry(contour, z, normalZ) {
  const pts = [];
  for (const p of contour) { const q = pts[pts.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-5) pts.push(p); }
  if (pts.length > 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-5) pts.pop();
  const v2 = pts.map(p => new THREE.Vector2(p[0], p[1]));
  let tris = THREE.ShapeUtils.triangulateShape(v2, []);
  const pos = new Float32Array(pts.length * 3), nrm = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => { pos.set([p[0], p[1], z], i * 3); nrm.set([0, 0, normalZ], i * 3); });
  const idx = [];
  for (const t of tris) {
    // ensure facing
    const a = pts[t[0]], b = pts[t[1]], c = pts[t[2]];
    const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if ((cr > 0) === (normalZ > 0)) idx.push(t[0], t[1], t[2]); else idx.push(t[0], t[2], t[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Clips the triangles of `surfaces` to the region where every constraint f(p, n) <= 0,
 * offsetting the result along the normal. Used for lights, intakes and decals.
 */
const _cn = new THREE.Vector3(), _vp = new THREE.Vector3(), _vn = new THREE.Vector3();
const SP = [new Float64Array(192), new Float64Array(192)], SN = [new Float64Array(192), new Float64Array(192)], VALS = new Float64Array(64);
export function clipRegion(surfaces, constraints, offset = 0.003) {
  const outP = [], outN = [];
  const emit = (p, nrm) => { const nn = _cn.copy(nrm).normalize(); outP.push(p.x + nn.x * offset, p.y + nn.y * offset, p.z + nn.z * offset); outN.push(nn.x, nn.y, nn.z); };
  const A = new THREE.Vector3(), B = new THREE.Vector3(), Cc = new THREE.Vector3();
  const nA = new THREE.Vector3(), nB = new THREE.Vector3(), nC = new THREE.Vector3();
  for (const geo of surfaces) {
    const pos = geo.attributes.position, nrm = geo.attributes.normal;
    const idx = geo.index ? geo.index.array : null;
    const triCount = idx ? idx.length / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const ia = idx ? idx[t * 3] : t * 3, ib = idx ? idx[t * 3 + 1] : t * 3 + 1, ic = idx ? idx[t * 3 + 2] : t * 3 + 2;
      A.fromBufferAttribute(pos, ia); B.fromBufferAttribute(pos, ib); Cc.fromBufferAttribute(pos, ic);
      nA.fromBufferAttribute(nrm, ia); nB.fromBufferAttribute(nrm, ib); nC.fromBufferAttribute(nrm, ic);
      // allocation-free walk while the triangle is still unclipped (same order and tests as the general path below):
      // nearly every body triangle is rejected by an early constraint, and building clones for each one made this the
      // load's biggest allocator (~4 GB per load across all vehicle types)
      let k = 0;
      for (; k < constraints.length; k++) {
        const f = constraints[k], va = f(A, nA), vb = f(B, nB), vc = f(Cc, nC);
        if (va <= 0 && vb <= 0 && vc <= 0) continue;
        if (va > 0 && vb > 0 && vc > 0) k = -1;
        break;
      }
      if (k < 0) continue; // rejected whole
      if (k === constraints.length) { // inside every constraint: emitted unchanged
        emit(A, nA); emit(B, nB); emit(Cc, nC);
        continue;
      }
      // straddles constraint k: Sutherland–Hodgman over flat scratch arrays (no per-vertex objects), same arithmetic
      // as Vector3.lerp / normalize
      let n = 3, cur = 0;
      const P0 = SP[0], N0 = SN[0];
      P0[0] = A.x; P0[1] = A.y; P0[2] = A.z; P0[3] = B.x; P0[4] = B.y; P0[5] = B.z; P0[6] = Cc.x; P0[7] = Cc.y; P0[8] = Cc.z;
      N0[0] = nA.x; N0[1] = nA.y; N0[2] = nA.z; N0[3] = nB.x; N0[4] = nB.y; N0[5] = nB.z; N0[6] = nC.x; N0[7] = nC.y; N0[8] = nC.z;
      for (let c = k; c < constraints.length && n; c++) {
        const f = constraints[c], P = SP[cur], N = SN[cur];
        let allIn = true, allOut = true;
        for (let i = 0; i < n; i++) { _vp.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); _vn.set(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]); const v = VALS[i] = f(_vp, _vn); if (v <= 0) allOut = false; else allIn = false; }
        if (allIn) continue;
        if (allOut) { n = 0; break; }
        const Q = SP[cur ^ 1], M = SN[cur ^ 1];
        let m = 0;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n, va = VALS[i], vb = VALS[j];
          if (va <= 0) { for (let q = 0; q < 3; q++) { Q[m * 3 + q] = P[i * 3 + q]; M[m * 3 + q] = N[i * 3 + q]; } m++; }
          if ((va <= 0) !== (vb <= 0)) {
            const t = va / (va - vb);
            for (let q = 0; q < 3; q++) { Q[m * 3 + q] = P[i * 3 + q] + (P[j * 3 + q] - P[i * 3 + q]) * t; M[m * 3 + q] = N[i * 3 + q] + (N[j * 3 + q] - N[i * 3 + q]) * t; }
            m++;
          }
        }
        n = m; cur ^= 1;
      }
      if (n < 3) continue;
      const P = SP[cur], N = SN[cur];
      for (let i = 1; i + 1 < n; i++) for (const v of [0, i, i + 1]) {
        _vp.set(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); _vn.set(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]); emit(_vp, _vn);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(outP), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(outN), 3));
  return g;
}

/** Rounded box (centered), radius r, seg segments per corner. */
export function roundedBox(w, h, d, r = 0.02, seg = 2) {
  const shape = new THREE.Shape();
  const x0 = -w / 2 + r, x1 = w / 2 - r, y0 = -h / 2 + r, y1 = h / 2 - r;
  shape.moveTo(x0, -h / 2); shape.lineTo(x1, -h / 2); shape.quadraticCurveTo(w / 2, -h / 2, w / 2, y0);
  shape.lineTo(w / 2, y1); shape.quadraticCurveTo(w / 2, h / 2, x1, h / 2); shape.lineTo(x0, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, y1); shape.lineTo(-w / 2, y0); shape.quadraticCurveTo(-w / 2, -h / 2, x0, -h / 2);
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.001, d - 2 * r), bevelEnabled: r > 0, bevelThickness: r, bevelSize: r * 0.9, bevelSegments: seg, curveSegments: seg });
  g.translate(0, 0, -(d - 2 * r) / 2);
  g.deleteAttribute('uv');
  return g;
}

export function box(w, h, d) { const g = new THREE.BoxGeometry(w, h, d); g.deleteAttribute('uv'); return g; }
export function cyl(rt, rb, h, seg = 12, open = false) { const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open); g.deleteAttribute('uv'); return g; }
export function sphere(r, ws = 12, hs = 8) { const g = new THREE.SphereGeometry(r, ws, hs); g.deleteAttribute('uv'); return g; }
export function plane(w, h, keepUV = true) { const g = new THREE.PlaneGeometry(w, h); if (!keepUV) g.deleteAttribute('uv'); return g; }

/** Tube along points with radius r. */
export function tube(points, r, seg = 6, tubular = 12) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, tubular, r, seg, false);
  g.deleteAttribute('uv');
  return g;
}

export const M4 = {
  t: (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z),
  trs: (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz)),
};

/** Monotone cubic interpolation through [[t, y], ...] (sorted by t). */
export function monotone(points) {
  const n = points.length;
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  if (n === 1) return () => ys[0];
  const d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const tau = 3 / Math.sqrt(s); m[i] = tau * a * d[i]; m[i + 1] = tau * b * d[i]; }
  }
  return t => {
    if (t <= xs[0]) return ys[0];
    if (t >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (t > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], s = (t - xs[i]) / h;
    const h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
    return h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1];
  };
}

export function seeded(seed = 1) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
