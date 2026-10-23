// Grid-surface mesh builder used for procedural humans. Every surface is a (rows × cols) grid with
// finite-difference normals; vertices carry skin weights plus crowd tags (joint / part / piece).
import * as THREE from 'three';
import { WHITE_UV } from './atlas.js';

const DEF_RM = [0.7, 0, 0];
const WHITE = [1, 1, 1];

export class MeshBuilder {
  constructor(boneToJoint = null) {
    this.boneToJoint = boneToJoint; // crowd mode: maps bone index -> crowd joint index
    this.P = []; this.N = []; this.UV = []; this.C = []; this.RM = []; this.SI = []; this.SW = []; this.JP = []; this.I = []; this.GA = []; this.GB = []; this.hasGar = false;
  }
  get n() { return this.P.length / 3; }

  vertex(p, nrm, d) {
    this.P.push(p[0], p[1], p[2]);
    this.N.push(nrm[0], nrm[1], nrm[2]);
    const uv = d.uv || WHITE_UV; this.UV.push(uv[0], uv[1]);
    const c = d.col || WHITE; this.C.push(c[0], c[1], c[2]);
    const rm = d.rm || DEF_RM; this.RM.push(rm[0], rm[1], rm[2]);
    if (d.gar) { this.GA.push(d.gar[0], d.gar[1], d.gar[2], d.gar[3]); this.GB.push(d.gar2[0], d.gar2[1], d.gar2[2], d.gar2[3]); this.hasGar = true; }
    else { this.GA.push(0, 0, 0, 0); this.GB.push(0, 0, 0, 0); }
    let w = d.w || [[0, 1]];
    if (w.length > 4) w = w.slice().sort((a, b) => b[1] - a[1]).slice(0, 4);
    let s = 0; for (const x of w) s += x[1];
    let dom = w[0][0], domW = -1;
    for (let k = 0; k < 4; k++) {
      if (k < w.length) { this.SI.push(w[k][0]); this.SW.push(w[k][1] / s); if (w[k][1] > domW) { domW = w[k][1]; dom = w[k][0]; } }
      else { this.SI.push(0); this.SW.push(0); }
    }
    const joint = d.joint ?? (this.boneToJoint ? this.boneToJoint[dom] : 0);
    this.JP.push(joint, d.part ?? 0, d.piece ?? 0, d.local ? 1 : 0);
    return this.n - 1;
  }

  /**
   * Generic grid surface. pos(r, c) -> [x,y,z]; data(r, c, p, n) -> vertex data.
   * cols wrap when `closed`; a seam column is duplicated so UVs can run 0..1.
   * center(r, c) gives an interior point used to orient normals outward.
   */
  grid(rows, cols, pos, data, center, closed = true) {
    const P = [];
    for (let r = 0; r < rows; r++) { const row = []; for (let c = 0; c < cols; c++) row.push(pos(r, c)); P.push(row); }
    const N = [];
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const len = a => Math.hypot(a[0], a[1], a[2]);
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const cp = closed ? (c + 1) % cols : Math.min(cols - 1, c + 1), cm = closed ? (c - 1 + cols) % cols : Math.max(0, c - 1);
        const rp = Math.min(rows - 1, r + 1), rm = Math.max(0, r - 1);
        let tu = sub(P[r][cp], P[r][cm]);
        let tv = sub(P[rp][c], P[rm][c]);
        // at poles the u tangent collapses: borrow from the neighbouring row
        if (len(tu) < 1e-7) { const rr = r === 0 ? Math.min(rows - 1, 1) : Math.max(0, r - 1); tu = sub(P[rr][cp], P[rr][cm]); }
        let n = cross(tu, tv);
        const ctr = center(r, c);
        const out = sub(P[r][c], ctr);
        if (len(n) < 1e-9) n = out;
        if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) n = [-n[0], -n[1], -n[2]];
        const l = len(n) || 1;
        row.push([n[0] / l, n[1] / l, n[2] / l]);
      }
      N.push(row);
    }
    // pole rows: average normal of the next row to avoid pinching
    const ids = [];
    const ccount = closed ? cols + 1 : cols;
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < ccount; c++) {
        const cc = c % cols;
        const d = data(r, c, P[r][cc], N[r][cc], c === cols);
        row.push(this.vertex(P[r][cc], N[r][cc], d));
      }
      ids.push(row);
    }
    const pa = this.P;
    for (let r = 0; r + 1 < rows; r++) for (let c = 0; c + 1 < ccount; c++) {
      const a = ids[r][c], b = ids[r][c + 1], d = ids[r + 1][c], e = ids[r + 1][c + 1];
      this._tri(a, d, b); this._tri(b, d, e);
    }
    return ids;
  }

  _tri(a, b, c) {
    const P = this.P, N = this.N;
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az;
    const vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (fx * fx + fy * fy + fz * fz < 1e-16) return; // degenerate (poles)
    const nx = N[a * 3] + N[b * 3] + N[c * 3], ny = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1], nz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
    if (fx * nx + fy * ny + fz * nz >= 0) this.I.push(a, b, c); else this.I.push(a, c, b);
  }

  /**
   * Tube of horizontal rings (ordered top→bottom). ring: {c:[x,y,z], rx, rz, m?(theta)->mult, zf?(theta)->extra z}
   * theta = 0 at +x, increasing toward +z (back). Front of the body is theta = -PI/2.
   */
  tube(rings, seg, data, th0 = 0) {
    return this.grid(rings.length, seg, (r, c) => {
      const R = rings[r], th = th0 + c / seg * Math.PI * 2;
      const m = R.m ? R.m(th, R) : 1;
      return [R.c[0] + Math.cos(th) * R.rx * m, R.c[1], R.c[2] + Math.sin(th) * R.rz * m + (R.zf ? R.zf(th, R) : 0)];
    }, (r, c, p, n, seam) => data(r, th0 + c / seg * Math.PI * 2, p, n, rings[r], seam ? 1 : c / seg), r => rings[Math.min(Math.max(r, 1), rings.length - 2)].c);
  }

  /** Parametric sphere: radius(dir) -> number | [x,y,z offset point]. phi 0 = top. */
  sphere(center, radius, lat, lon, data, opts = {}) {
    const phi0 = opts.phi0 ?? 0, phi1 = opts.phi1 ?? Math.PI;
    const M = opts.matrix || null;
    const v = new THREE.Vector3();
    const dirs = [];
    const pos = (r, c) => {
      const ph = phi0 + (phi1 - phi0) * r / lat, th = c / lon * Math.PI * 2;
      const d = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
      const rad = radius(d);
      if (Array.isArray(rad)) v.set(d[0] * rad[0], d[1] * rad[1], d[2] * rad[2]); else v.set(d[0] * rad, d[1] * rad, d[2] * rad);
      if (M) v.applyMatrix4(M);
      return [v.x + center[0], v.y + center[1], v.z + center[2]];
    };
    const ctr = M ? (() => { const c = new THREE.Vector3().applyMatrix4(M); return [c.x + center[0], c.y + center[1], c.z + center[2]]; })() : center;
    return this.grid(lat + 1, lon, pos, (r, c, p, n, seam) => {
      const ph = phi0 + (phi1 - phi0) * r / lat, th = c / lon * Math.PI * 2;
      return data([Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)], p, n, r / lat, seam ? 1 : c / lon);
    }, () => ctr);
  }

  /** Ellipsoid helper with optional rotation (euler XYZ) */
  ellipsoid(center, radii, lat, lon, data, rot = null, opts = {}) {
    let matrix = null;
    if (rot) matrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
    return this.sphere(center, () => radii, lat, lon, typeof data === 'function' ? data : () => data, { ...opts, matrix });
  }

  /** Capsule-like tube between two points with radius r0→r1 (rings perpendicular to the segment). */
  limb(a, b, r0, r1, seg, rings, data) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const axis = B.clone().sub(A); const L = axis.length(); axis.normalize();
    const tmp = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(axis, tmp).normalize();
    const w = new THREE.Vector3().crossVectors(axis, u).normalize();
    const total = rings + 2; // + end caps
    return this.grid(total + 1, seg, (r, c) => {
      const th = c / seg * Math.PI * 2;
      let t, rad;
      if (r === 0) { t = -0.0; rad = 0; }
      else if (r === total) { t = 1; rad = 0; }
      else { t = (r - 1) / (rings - 1 || 1); rad = r0 + (r1 - r0) * t; }
      // rounded ends
      const capOff = r === 0 ? -r0 * 0.6 : r === total ? r1 * 0.6 : 0;
      const p = A.clone().addScaledVector(axis, t * L + capOff).addScaledVector(u, Math.cos(th) * rad).addScaledVector(w, Math.sin(th) * rad);
      return [p.x, p.y, p.z];
    }, (r, c, p, n) => (typeof data === 'function' ? data(p, n, r / total) : data), (r) => { const t = Math.min(1, Math.max(0, (r - 1) / (rings - 1 || 1))); const p = A.clone().addScaledVector(axis, t * L); return [p.x, p.y, p.z]; });
  }

  /** Round tube along a polyline (closed loop or open with rounded caps). data(p, n) -> vertex data */
  pathTube(pts, radius, seg, closedLoop, data) {
    const P = pts.map(p => new THREE.Vector3(...p));
    if (closedLoop) P.push(P[0].clone());
    const n = P.length;
    const T = P.map((p, i) => {
      const a = P[Math.max(0, i - 1)], c = P[Math.min(n - 1, i + 1)];
      if (closedLoop && (i === 0 || i === n - 1)) return P[1].clone().sub(P[n - 2]).normalize();
      return c.clone().sub(a).normalize();
    });
    // parallel-transport frames
    const N0 = Math.abs(T[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const Nn = [new THREE.Vector3().crossVectors(T[0], N0).normalize()];
    for (let i = 1; i < n; i++) {
      const v = Nn[i - 1].clone().sub(T[i].clone().multiplyScalar(Nn[i - 1].dot(T[i]))).normalize();
      Nn.push(v.lengthSq() > 1e-8 ? v : Nn[i - 1].clone());
    }
    const rows = [];
    if (!closedLoop) rows.push({ c: P[0].clone().addScaledVector(T[0], -radius * 0.7), r: 0, t: T[0], n: Nn[0] });
    for (let i = 0; i < n; i++) rows.push({ c: P[i], r: radius, t: T[i], n: Nn[i] });
    if (!closedLoop) rows.push({ c: P[n - 1].clone().addScaledVector(T[n - 1], radius * 0.7), r: 0, t: T[n - 1], n: Nn[n - 1] });
    const tmp = new THREE.Vector3();
    return this.grid(rows.length, seg, (r, c) => {
      const R = rows[r], th = c / seg * Math.PI * 2;
      const bnm = tmp.crossVectors(R.t, R.n);
      return [R.c.x + (R.n.x * Math.cos(th) + bnm.x * Math.sin(th)) * R.r, R.c.y + (R.n.y * Math.cos(th) + bnm.y * Math.sin(th)) * R.r, R.c.z + (R.n.z * Math.cos(th) + bnm.z * Math.sin(th)) * R.r];
    }, (r, c, p, nn) => data(p, nn), (r) => { const R = rows[Math.min(Math.max(r, 1), rows.length - 2)]; return [R.c.x, R.c.y, R.c.z]; });
  }

  /** Append an arbitrary three.js BufferGeometry, transformed by matrix. data(p, n) -> vertex data */
  geometry(geo, matrix, data) {
    const g = geo.index ? geo : geo;
    const pos = g.attributes.position, nrm = g.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3(), nn = new THREE.Vector3();
    const base = this.n;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      nn.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
      const p = [v.x, v.y, v.z], n = [nn.x, nn.y, nn.z];
      this.vertex(p, n, data(p, n));
    }
    if (g.index) { const ix = g.index.array; for (let i = 0; i < ix.length; i++) this.I.push(base + ix[i]); }
    else for (let i = 0; i < pos.count; i++) this.I.push(base + i);
    // keep winding consistent with mirrored matrices
    if (matrix.determinant() < 0) {
      const I = this.I; const start = I.length - (g.index ? g.index.count : pos.count);
      for (let i = start; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; }
    }
    geo.dispose?.();
  }

  toGeometry({ skin = true, crowd = false } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.UV, 2));
    if (!crowd) {
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
      g.setAttribute('rm', new THREE.Float32BufferAttribute(this.RM, 3));
      g.setAttribute('gar', new THREE.Float32BufferAttribute(this.GA, 4));
      g.setAttribute('gar2', new THREE.Float32BufferAttribute(this.GB, 4));
    }
    if (skin) {
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.SI, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.SW, 4));
    }
    if (crowd) g.setAttribute('aJP', new THREE.Float32BufferAttribute(this.JP, 4));
    const n = this.n;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1));
    return g;
  }
}
