// Lane-level road network built from the OSM graph: left-hand traffic lanes, junction connectors,
// traffic-light phases, sidewalk paths for pedestrians, and spatial lookup.
import * as THREE from 'three';

const LANE_W = 3.3;

function offsetPolyline(pts, ys, off) {
  // pts: [[x,z]...]; off: lateral offset, + = right of direction
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    let dx0 = 0, dz0 = 0, dx1 = 0, dz1 = 0;
    if (i > 0) { dx0 = pts[i][0] - pts[i - 1][0]; dz0 = pts[i][1] - pts[i - 1][1]; const l = Math.hypot(dx0, dz0) || 1; dx0 /= l; dz0 /= l; }
    if (i < n - 1) { dx1 = pts[i + 1][0] - pts[i][0]; dz1 = pts[i + 1][1] - pts[i][1]; const l = Math.hypot(dx1, dz1) || 1; dx1 /= l; dz1 /= l; }
    if (i === 0) { dx0 = dx1; dz0 = dz1; } if (i === n - 1) { dx1 = dx0; dz1 = dz0; }
    let tx = dx0 + dx1, tz = dz0 + dz1; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const rx = -tz, rz = tx;
    const m = 1 / Math.max(0.4, rx * -dz1 + rz * dx1);
    out.push([pts[i][0] + rx * off * m, ys ? ys[i] : 0, pts[i][1] + rz * off * m]);
  }
  return out;
}

export class Path {
  // polyline in 3D with arc-length parametrisation. Points are packed xyz in one Float64Array (n points; doubles so
  // every coordinate, length and hash derived from them is unchanged): the network has ~600k points, and a little
  // [x, y, z] array per point cost tens of MB of objects on phones.
  constructor(points /* [[x,y,z]] */) {
    const n = this.n = points.length, xyz = this.xyz = new Float64Array(n * 3), cum = this.cum = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const q = points[i]; xyz[i * 3] = q[0]; xyz[i * 3 + 1] = q[1]; xyz[i * 3 + 2] = q[2];
      if (i) cum[i] = cum[i - 1] + Math.hypot(q[0] - points[i - 1][0], q[2] - points[i - 1][2]);
    }
    this.length = n ? cum[n - 1] : 0;
  }
  x(i) { return this.xyz[i * 3]; }
  y(i) { return this.xyz[i * 3 + 1]; }
  z(i) { return this.xyz[i * 3 + 2]; }
  sample(s, outPos, outDir) {
    const c = this.cum, p = this.xyz;
    s = Math.max(0, Math.min(this.length, s));
    let lo = 0, hi = this.n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] <= s) lo = mid; else hi = mid; }
    const seg = c[hi] - c[lo] || 1; const f = (s - c[lo]) / seg;
    const a = lo * 3, b = hi * 3;
    outPos.set(p[a] + (p[b] - p[a]) * f, p[a + 1] + (p[b + 1] - p[a + 1]) * f, p[a + 2] + (p[b + 2] - p[a + 2]) * f);
    if (outDir) outDir.set(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]).normalize();
    return outPos;
  }
}

export class RoadNet {
  constructor(city) {
    const g = city.data.graph;
    this.nodes = g.nodes.map(([x, z], i) => ({ id: i, x, z, out: [], inc: [], degree: 0, maxHalfW: 3, signal: null, edges: [] }));
    this.lanes = [];
    this.sidewalks = [];
    this.edges = g.edges;
    for (const e of g.edges) {
      const pts = []; for (let i = 0; i < e.p.length; i += 2) pts.push([e.p[i], e.p[i + 1]]);
      const W = (e.lf + e.lb) * LANE_W + 0.6, hw = W / 2;
      e.hw = hw;
      const A = this.nodes[e.a], B = this.nodes[e.b];
      A.degree++; B.degree++; A.edges.push(e); B.edges.push(e);
      A.maxHalfW = Math.max(A.maxHalfW, hw); B.maxHalfW = Math.max(B.maxHalfW, hw);
      e.minCls = e.c;
      // forward lanes (a->b) on the left side of the a->b direction
      for (let i = 0; i < e.lf; i++) {
        const off = -hw + 0.3 + (i + 0.5) * LANE_W;
        const lane = { id: this.lanes.length, edge: e, from: e.a, to: e.b, idx: i, nLanes: e.lf, speed: e.v, cls: e.c, path: new Path(offsetPolyline(pts, e.y, off)), cars: [], next: [] };
        this.lanes.push(lane);
      }
      for (let i = 0; i < e.lb; i++) {
        const off = -hw + 0.3 + (e.lf + i + 0.5) * LANE_W; // right side of a->b == left side of b->a
        const p3 = offsetPolyline(pts, e.y, off).reverse();
        const lane = { id: this.lanes.length, edge: e, from: e.b, to: e.a, idx: e.lb - 1 - i, nLanes: e.lb, speed: e.v, cls: e.c, path: new Path(p3), cars: [], next: [] };
        this.lanes.push(lane);
      }
      // sidewalks (both sides, outside the carriageway), bidirectional for pedestrians
      if (e.c <= 6 && !e.y) {
        for (const side of [-1, 1]) this.sidewalks.push({ edge: e, side, path: new Path(offsetPolyline(pts, null, side * (hw + 2.0))) });
      }
    }
    for (const l of this.lanes) { this.nodes[l.from].out.push(l); this.nodes[l.to].inc.push(l); }
    // junction trim radius and connectors
    for (const n of this.nodes) n.r = n.degree >= 3 ? n.maxHalfW + 1.5 : 0.5;
    for (const l of this.lanes) {
      l.s0 = Math.min(this.nodes[l.from].r, l.path.length * 0.4);
      l.s1 = Math.max(l.s0 + 0.1, l.path.length - Math.min(this.nodes[l.to].r, l.path.length * 0.4));
    }
    const d1 = new THREE.Vector3(), d2 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
    for (const l of this.lanes) {
      const node = this.nodes[l.to];
      l.path.sample(l.s1, p1, d1);
      for (const o of node.out) {
        if (o.edge === l.edge && o.to === l.from && node.degree > 1) continue; // no U-turns
        o.path.sample(o.s0, p2, d2);
        const cross = d1.x * d2.z - d1.z * d2.x, dot = d1.x * d2.x + d1.z * d2.z;
        const turn = Math.atan2(cross, dot); // + = right turn (x east, z south)
        // lane discipline: in left-hand traffic, left turns from leftmost lanes (idx 0), right turns from the rightmost
        if (node.degree >= 3 && l.nLanes > 1 && o.nLanes >= 1) {
          if (turn < -0.5 && l.idx !== 0) continue;
          if (turn > 0.5 && l.idx !== l.nLanes - 1) continue;
          if (Math.abs(turn) <= 0.5 && Math.abs(l.idx - o.idx) > 0 && o.nLanes === l.nLanes) continue;
        }
        if (turn < -0.5 && o.idx !== 0 && o.nLanes > 1) continue;
        if (turn > 0.5 && o.idx !== o.nLanes - 1 && o.nLanes > 1) continue;
        // quadratic bezier connector
        const ctrl = p1.clone().addScaledVector(d1, p1.distanceTo(p2) * 0.45);
        const ctrl2 = p2.clone().addScaledVector(d2, -p1.distanceTo(p2) * 0.45);
        const ptsC = [];
        const N = 8;
        for (let k = 0; k <= N; k++) {
          const t = k / N, it = 1 - t;
          // cubic bezier p1, ctrl, ctrl2, p2
          const x = it * it * it * p1.x + 3 * it * it * t * ctrl.x + 3 * it * t * t * ctrl2.x + t * t * t * p2.x;
          const y = it * it * it * p1.y + 3 * it * it * t * ctrl.y + 3 * it * t * t * ctrl2.y + t * t * t * p2.y;
          const z = it * it * it * p1.z + 3 * it * it * t * ctrl.z + 3 * it * t * t * ctrl2.z + t * t * t * p2.z;
          ptsC.push([x, y, z]);
        }
        l.next.push({ lane: o, path: new Path(ptsC), turn });
      }
    }
    // dead ends: allow U-turn connectors so traffic never gets stuck
    for (const l of this.lanes) if (!l.next.length) {
      const node = this.nodes[l.to];
      const o = node.out.find(x => x.edge === l.edge) || node.out[0];
      if (o) { l.path.sample(l.s1, p1, d1); o.path.sample(o.s0, p2, d2); l.next.push({ lane: o, path: new Path([[p1.x, p1.y, p1.z], [p1.x + d1.x * 4, p1.y, p1.z + d1.z * 4], [p2.x, p2.y, p2.z]]), turn: Math.PI }); }
    }
    // traffic signals at major junctions: two phases split by approach axis
    for (const n of this.nodes) {
      if (n.degree < 3 || !n.inc.length) continue;
      const major = n.edges.some(e => e.c <= 4);
      if (!major) continue;
      const ref = n.inc[0];
      ref.path.sample(ref.path.length - 0.1, p1, d1);
      const ax = Math.atan2(d1.z, d1.x);
      for (const l of n.inc) {
        l.path.sample(l.path.length - 0.1, p2, d2);
        let a = Math.atan2(d2.z, d2.x) - ax; a = Math.abs(((a % Math.PI) + Math.PI * 1.5) % Math.PI - Math.PI / 2);
        l.phase = a < Math.PI / 4 ? 1 : 0; // 0 aligned with ref axis, 1 perpendicular
      }
      n.signal = { t: Math.random() * 46, cycle: 46 };
    }
    // lane spatial grid (for spawning & lookups)
    this.cell = 120;
    this._stamp = 0; // query stamp for _near's de-duplication
    this.grid = new Map();
    const v = new THREE.Vector3();
    for (const l of this.lanes) {
      const seen = new Set();
      for (let s = 0; s <= l.path.length; s += 30) {
        l.path.sample(s, v); const k = this._k(v.x, v.z); if (seen.has(k)) continue; seen.add(k);
        let a = this.grid.get(k); if (!a) this.grid.set(k, a = []); a.push(l);
      }
    }
    this.sideGrid = new Map();
    for (const sw of this.sidewalks) {
      const seen = new Set();
      for (let s = 0; s <= sw.path.length; s += 30) {
        sw.path.sample(s, v); const k = this._k(v.x, v.z); if (seen.has(k)) continue; seen.add(k);
        let a = this.sideGrid.get(k); if (!a) this.sideGrid.set(k, a = []); a.push(sw);
      }
    }
  }
  // numeric cell keys (a string per lookup was a steady drip of garbage: these run for every car and pedestrian)
  _k(x, z) { return Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell); }
  /** grid entries within r of (x,z), each once, in cell order. `out` (optional) is cleared and reused. */
  _near(grid, x, z, r, out = []) {
    out.length = 0; const c = this.cell, stamp = ++this._stamp;
    for (let gx = Math.floor((x - r) / c); gx <= Math.floor((x + r) / c); gx++)
      for (let gz = Math.floor((z - r) / c); gz <= Math.floor((z + r) / c); gz++) {
        const a = grid.get(gx * 100003 + gz); if (!a) continue;
        for (let i = 0; i < a.length; i++) { const l = a[i]; if (l._qs !== stamp) { l._qs = stamp; out.push(l); } }
      }
    return out;
  }

  updateSignals(dt) { for (const n of this.signalNodes || (this.signalNodes = this.nodes.filter(n => n.signal))) n.signal.t = (n.signal.t + dt) % n.signal.cycle; }
  /** 'green' | 'amber' | 'red' for a lane approaching its end node */
  signalFor(lane) {
    const n = this.nodes[lane.to]; if (!n.signal) return 'none';
    if (this.allGreen) return 'green';
    const t = n.signal.t; const ph = lane.phase || 0;
    const local = ph === 0 ? t : (t + 23) % 46;
    return local < 18 ? 'green' : local < 21 ? 'amber' : 'red';
  }

  lanesNear(x, z, r, out) { return this._near(this.grid, x, z, r, out); }
  sidewalksNear(x, z, r, out) { return this._near(this.sideGrid, x, z, r, out); }

  /** nearest lane point to (x,z): { lane, s, dist, pos, dir } */
  nearestLane(x, z, r = 80, filter) {
    let bl = null, bs = 0, bd = Infinity;
    const near = this.lanesNear(x, z, r, this._nearScratch || (this._nearScratch = []));
    for (let q = 0; q < near.length; q++) {
      const l = near[q];
      if (filter && !filter(l)) continue;
      const P = l.path.xyz, n = l.path.n;
      for (let i = 0; i < n - 1; i++) {
        const ax = P[i * 3], az = P[i * 3 + 2], bx = P[i * 3 + 3], bz = P[i * 3 + 5];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        const px = ax + dx * t, pz = az + dz * t; const dd = Math.hypot(px - x, pz - z);
        if (!bl || dd < bd) { bl = l; bs = l.path.cum[i] + Math.sqrt(L2) * t; bd = dd; }
      }
    }
    if (!bl) return null;
    const best = { lane: bl, s: bs, dist: bd }, d = new THREE.Vector3();
    best.pos = bl.path.sample(bs, new THREE.Vector3(), d); best.dir = d;
    return best;
  }

  /** nearest walkable sidewalk point to (x,z): Vector3, plus the direction of the kerb (towards the road) */
  nearestSidewalk(x, z, r = 120) {
    let best = null; const v = new THREE.Vector3();
    for (const sw of this.sidewalksNear(x, z, r)) {
      const P = sw.path.xyz, n = sw.path.n;
      for (let i = 0; i < n - 1; i++) {
        const ax = P[i * 3], az = P[i * 3 + 2], bx = P[i * 3 + 3], bz = P[i * 3 + 5];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        const px = ax + dx * t, pz = az + dz * t; const dd = Math.hypot(px - x, pz - z);
        if (!best || dd < best.dist) best = { sw, dist: dd, pos: new THREE.Vector3(px, 0, pz), dir: new THREE.Vector3(dx, 0, dz).normalize() };
      }
    }
    if (best) {
      // the road is on the side opposite to the sidewalk offset sign
      const e = best.sw.edge; const side = best.sw.side;
      best.toRoad = new THREE.Vector3(-best.dir.z, 0, best.dir.x).multiplyScalar(-side);
    }
    return best;
  }

  /** a random driving route of roughly `length` metres starting from a lane near (x,z) */
  randomRoute(x, z, length = 3000, minCls = 5) {
    const st = this.nearestLane(x, z, 150, l => l.cls <= minCls);
    if (!st) return null;
    const pts = []; let lane = st.lane, s = st.s, acc = 0, guard = 0;
    while (acc < length && guard++ < 400) {
      const LP = lane.path;
      for (let i = 0; i < LP.n; i++) if (LP.cum[i] >= s) pts.push([LP.x(i), LP.z(i)]);
      acc += lane.path.length - s;
      const opts = lane.next.filter(n => n.lane.cls <= minCls && Math.abs(n.turn) < 2.5);
      if (!opts.length) break;
      const straight = opts.filter(o => Math.abs(o.turn) < 0.6);
      const nx = (straight.length && Math.random() < 0.6 ? straight : opts)[Math.floor(Math.random() * (straight.length && Math.random() < 0.6 ? straight.length : opts.length)) % (straight.length && Math.random() < 0.6 ? straight.length : opts.length)] || opts[0];
      for (let i = 0; i < nx.path.n; i++) pts.push([nx.path.x(i), nx.path.z(i)]);
      lane = nx.lane; s = lane.s0;
    }
    return pts;
  }

  /** shortest route between two points (A* over lanes); returns array of [x,z] for GPS */
  route(fx, fz, tx, tz) {
    const a = this.nearestLane(fx, fz, 200), b = this.nearestLane(tx, tz, 300);
    if (!a || !b) return null;
    // binary min-heap open set with lazy deletion (stale entries skipped via the closed set)
    const came = new Map(), gS = new Map(), closed = new Set(), heapF = [], heapL = [];
    const push = (l, f) => {
      let i = heapF.length; heapF.push(f); heapL.push(l);
      while (i > 0) { const p = (i - 1) >> 1; if (heapF[p] <= f) break; heapF[i] = heapF[p]; heapL[i] = heapL[p]; i = p; }
      heapF[i] = f; heapL[i] = l;
    };
    const pop = () => {
      const top = heapL[0], lf = heapF.pop(), ll = heapL.pop(), n = heapF.length;
      if (n) {
        let i = 0;
        for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && heapF[c + 1] < heapF[c]) c++; if (heapF[c] >= lf) break; heapF[i] = heapF[c]; heapL[i] = heapL[c]; i = c; }
        heapF[i] = lf; heapL[i] = ll;
      }
      return top;
    };
    const h = l => { const P = l.path, k = P.n - 1; return Math.hypot(P.x(k) - tx, P.z(k) - tz); };
    gS.set(a.lane, 0); push(a.lane, h(a.lane));
    let found = null, iter = 0;
    while (heapF.length && iter++ < 20000) {
      const cur = pop();
      if (closed.has(cur)) continue;
      closed.add(cur);
      if (cur === b.lane) { found = cur; break; }
      const gc = gS.get(cur) + cur.path.length / (cur.speed + 2) * 10;
      for (const nx of cur.next) {
        if (closed.has(nx.lane)) continue;
        const g2 = gc + nx.path.length;
        if (g2 < (gS.get(nx.lane) ?? Infinity)) { gS.set(nx.lane, g2); came.set(nx.lane, cur); push(nx.lane, g2 + h(nx.lane) / 1.5); }
      }
    }
    if (!found) return null;
    const lanes = []; let c = found; while (c) { lanes.unshift(c); c = came.get(c); }
    const pts = [];
    for (const l of lanes) for (let i = 0; i < l.path.n; i += Math.max(1, Math.floor(l.path.n / 6))) pts.push([l.path.x(i), l.path.z(i)]);
    pts.push([tx, tz]);
    return pts;
  }
}
