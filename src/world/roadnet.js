// Lane-level road network built from the OSM graph: left-hand traffic lanes, junction connectors,
// traffic-light phases, sidewalk paths for pedestrians, and spatial lookup.
import * as THREE from 'three';

const LANE_W = 3.3;
/** Math.hypot(x, z), bit for bit: the algorithm V8 and JavaScriptCore implement (scale by the larger magnitude, sum
 * the squares, sqrt, scale back), minus the call's garbage — V8's builtin allocates ~50 B per call, and the network
 * build and the nearest-lane scans make millions of them. */
function hypot(x, z) {
  const ax = Math.abs(x), az = Math.abs(z), m = ax > az ? ax : az;
  if (m === 0 || m === Infinity || m !== m) return Math.hypot(x, z);
  const a = ax / m, b = az / m;
  return Math.sqrt(a * a + b * b) * m;
}
const _p1 = new THREE.Vector3(), _d1 = new THREE.Vector3(), _p2 = new THREE.Vector3(), _d2 = new THREE.Vector3();

// ArrayBuffer.transfer reallocates and detaches the old buffer at once: its memory is released now, not at the next GC
const XFER = typeof ArrayBuffer.prototype.transfer === 'function';
const resized = (a, n) => { if (XFER) return new Float64Array(a.buffer.transfer(n * 8)); const b = new Float64Array(n); b.set(a.subarray(0, Math.min(n, a.length))); return b; };

/** Packed storage shared by many Paths: their points' xyz and arc lengths, one path after another (doubles, so every
 * coordinate and length is exactly what per-point arrays gave). The network has ~440k points: a small array per point,
 * or even a typed array per path (~230 B of JS objects each), cost tens of MB on phones. */
export class PathStore {
  constructor(points) { this.xyz = new Float64Array(points * 3); this.cum = new Float64Array(points); this.n = 0; }
  /** room for k more points; returns the index of the first */
  alloc(k) {
    const o = this.n; this.n += k;
    if (this.n > this.cum.length) { const cap = Math.max(this.n, this.cum.length * 2); this.xyz = resized(this.xyz, cap * 3); this.cum = resized(this.cum, cap); }
    return o;
  }
  /** release the spare capacity once every path is in */
  trim() { if (this.n < this.cum.length) { this.xyz = resized(this.xyz, this.n * 3); this.cum = resized(this.cum, this.n); } }
}

const NO_BENDS = new Float64Array(0);

export class Path {
  // polyline in 3D with arc-length parametrisation: points o .. o+n-1 of a PathStore (written before construction)
  constructor(store, o, n) {
    this.st = store; this.o = o; this.n = n; this._bends = null;
    const P = store.xyz, c = store.cum;
    c[o] = 0;
    for (let i = o + 1; i < o + n; i++) c[i] = c[i - 1] + hypot(P[i * 3] - P[i * 3 - 3], P[i * 3 + 2] - P[i * 3 - 1]);
    this.length = n ? c[o + n - 1] : 0;
  }
  static fromPoints(points /* [[x, y, z]] */) {
    const st = new PathStore(points.length), P = st.xyz, o = st.alloc(points.length);
    for (let i = 0; i < points.length; i++) { const q = points[i]; P[i * 3] = q[0]; P[i * 3 + 1] = q[1]; P[i * 3 + 2] = q[2]; }
    return new Path(st, o, points.length);
  }
  x(i) { return this.st.xyz[(this.o + i) * 3]; }
  y(i) { return this.st.xyz[(this.o + i) * 3 + 1]; }
  z(i) { return this.st.xyz[(this.o + i) * 3 + 2]; }
  /** arc length at point i */
  arc(i) { return this.st.cum[this.o + i]; }
  /** Where the path bends, for speed planning: [from s, to s, total turn (rad), length (m), ...]. Vertices less than
   * 4 m apart form one bend (a finely sampled arc: its turn over its length); a lone vertex is a kink of length 0.
   * Bends under ~2° are left out. Worked out the first time a car looks (only paths near the player ever are). */
  bends() {
    if (this._bends) return this._bends;
    const P = this.st.xyz, o = this.o, out = [];
    let sa = 0, sb = 0, th = 0, k = 0;
    const close = () => { if (th > 0.035) out.push(sa, sb, th, k > 1 ? (sb - sa) * k / (k - 1) : 0); th = 0; k = 0; };
    for (let i = 1; i < this.n - 1; i++) {
      const q = (o + i) * 3, ax = P[q] - P[q - 3], az = P[q + 2] - P[q - 1], bx = P[q + 3] - P[q], bz = P[q + 5] - P[q + 2];
      const t = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz)), s = this.arc(i);
      if (t < 0.005) continue;
      if (k && s - sb > 4) close();
      if (!k) sa = s;
      sb = s; th += t; k++;
    }
    close();
    return (this._bends = out.length ? Float64Array.from(out) : NO_BENDS);
  }
  sample(s, outPos, outDir) {
    const c = this.st.cum, p = this.st.xyz;
    s = Math.max(0, Math.min(this.length, s));
    let lo = this.o, hi = this.o + this.n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] <= s) lo = mid; else hi = mid; }
    const seg = c[hi] - c[lo] || 1; const f = (s - c[lo]) / seg;
    const a = lo * 3, b = hi * 3;
    outPos.set(p[a] + (p[b] - p[a]) * f, p[a + 1] + (p[b + 1] - p[a + 1]) * f, p[a + 2] + (p[b + 2] - p[a + 2]) * f);
    if (outDir) outDir.set(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]).normalize();
    return outPos;
  }
}

/** Lane / sidewalk centreline `off` metres beside an edge's polyline (+ = right of the a->b direction), into `st`.
 * p: the edge's flat [x, z, ...] points; ys: per-point heights (elevated roads) or null; reverse: run b->a. */
function offsetPath(st, p, ys, off, reverse = false) {
  const n = p.length >> 1, o0 = st.alloc(n), out = st.xyz;
  for (let i = 0; i < n; i++) {
    const x = p[i * 2], z = p[i * 2 + 1];
    let dx0 = 0, dz0 = 0, dx1 = 0, dz1 = 0;
    if (i > 0) { dx0 = x - p[i * 2 - 2]; dz0 = z - p[i * 2 - 1]; const l = hypot(dx0, dz0) || 1; dx0 /= l; dz0 /= l; }
    if (i < n - 1) { dx1 = p[i * 2 + 2] - x; dz1 = p[i * 2 + 3] - z; const l = hypot(dx1, dz1) || 1; dx1 /= l; dz1 /= l; }
    if (i === 0) { dx0 = dx1; dz0 = dz1; } if (i === n - 1) { dx1 = dx0; dz1 = dz0; }
    let tx = dx0 + dx1, tz = dz0 + dz1; const tl = hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const rx = -tz, rz = tx;
    const m = 1 / Math.max(0.4, rx * -dz1 + rz * dx1);
    const o = (o0 + (reverse ? n - 1 - i : i)) * 3;
    out[o] = x + rx * off * m; out[o + 1] = ys ? ys[i] : 0; out[o + 2] = z + rz * off * m;
  }
  return new Path(st, o0, n);
}

/** A junction's two-phase traffic signal: its time in the 46 s cycle follows the network's clock (one add a frame, not
 * one per signalised junction — there are ~1200). */
class Signal {
  constructor(net, t0) { this.net = net; this.t0 = t0; this.cycle = 46; }
  get t() { return (this.t0 + this.net.signalClock) % this.cycle; }
}

export class RoadNet {
  constructor(city) {
    const g = city.data.graph;
    this.nodes = g.nodes.map(([x, z], i) => ({ id: i, x, z, out: [], inc: [], degree: 0, maxHalfW: 3, signal: null, edges: [] }));
    this.lanes = [];
    this.sidewalks = [];
    this.edges = g.edges;
    this.signalClock = 0; // s: every junction's signal runs off it (see Signal)
    // every lane and sidewalk point, plus room for the junction connectors (~2.6 a lane, mostly straight: 5 points)
    let pts = 0, lanes = 0;
    for (let i = 0; i < g.edges.length; i++) { const e = g.edges[i]; lanes += e.lf + e.lb; pts += (e.p.length >> 1) * (e.lf + e.lb + (e.c <= 6 && !e.y ? 2 : 0)); }
    this.paths = new PathStore(pts + Math.ceil(lanes * 2.6 * 6));
    // (separate steps with index loops: the network is built once, mostly by unoptimised code, where every iterator
    // step and every double result is an object)
    for (let i = 0; i < g.edges.length; i++) this._edge(g.edges[i]);
    this._connectors();
    this.paths.trim();
    this._signals();
    this.cell = 120;
    this._stamp = 0; // query stamp for _near's de-duplication
    this.grid = this._grid(this.lanes);
    this.sideGrid = this._grid(this.sidewalks);
  }

  /** an OSM edge's lanes and sidewalks */
  _edge(e) {
    const st = this.paths, W = (e.lf + e.lb) * LANE_W + 0.6, hw = W / 2;
    e.hw = hw;
    const A = this.nodes[e.a], B = this.nodes[e.b];
    A.degree++; B.degree++; A.edges.push(e); B.edges.push(e);
    A.maxHalfW = Math.max(A.maxHalfW, hw); B.maxHalfW = Math.max(B.maxHalfW, hw);
    e.minCls = e.c;
    // forward lanes (a->b) on the left side of the a->b direction
    for (let i = 0; i < e.lf; i++) {
      const off = -hw + 0.3 + (i + 0.5) * LANE_W;
      this.lanes.push({ id: this.lanes.length, edge: e, from: e.a, to: e.b, idx: i, nLanes: e.lf, speed: e.v, cls: e.c, path: offsetPath(st, e.p, e.y, off), cars: [], next: [] });
    }
    for (let i = 0; i < e.lb; i++) {
      const off = -hw + 0.3 + (e.lf + i + 0.5) * LANE_W; // right side of a->b == left side of b->a
      this.lanes.push({ id: this.lanes.length, edge: e, from: e.b, to: e.a, idx: e.lb - 1 - i, nLanes: e.lb, speed: e.v, cls: e.c, path: offsetPath(st, e.p, e.y, off, true), cars: [], next: [] });
    }
    // sidewalks (both sides, outside the carriageway), bidirectional for pedestrians
    if (e.c <= 6 && !e.y) {
      this.sidewalks.push({ edge: e, side: -1, path: offsetPath(st, e.p, null, -1 * (hw + 2.0)) });
      this.sidewalks.push({ edge: e, side: 1, path: offsetPath(st, e.p, null, 1 * (hw + 2.0)) });
    }
  }

  /** junction trim radius and the connectors from every lane end to the lanes it may turn into */
  _connectors() {
    const lanes = this.lanes, nodes = this.nodes;
    for (let i = 0; i < lanes.length; i++) { const l = lanes[i]; nodes[l.from].out.push(l); nodes[l.to].inc.push(l); }
    for (let i = 0; i < nodes.length; i++) { const n = nodes[i]; n.r = n.degree >= 3 ? n.maxHalfW + 1.5 : 0.5; }
    for (let i = 0; i < lanes.length; i++) {
      const l = lanes[i];
      l.s0 = Math.min(nodes[l.from].r, l.path.length * 0.4);
      l.s1 = Math.max(l.s0 + 0.1, l.path.length - Math.min(nodes[l.to].r, l.path.length * 0.4));
    }
    for (let i = 0; i < lanes.length; i++) {
      const l = lanes[i], node = nodes[l.to], out = node.out;
      l.path.sample(l.s1, _p1, _d1);
      for (let j = 0; j < out.length; j++) {
        const o = out[j];
        if (o.edge === l.edge && o.to === l.from && node.degree > 1) continue; // no U-turns
        o.path.sample(o.s0, _p2, _d2);
        const cross = _d1.x * _d2.z - _d1.z * _d2.x, dot = _d1.x * _d2.x + _d1.z * _d2.z;
        const turn = Math.atan2(cross, dot); // + = right turn (x east, z south)
        // lane discipline: in left-hand traffic, left turns from leftmost lanes (idx 0), right turns from the rightmost
        if (node.degree >= 3 && l.nLanes > 1 && o.nLanes >= 1) {
          if (turn < -0.5 && l.idx !== 0) continue;
          if (turn > 0.5 && l.idx !== l.nLanes - 1) continue;
          if (Math.abs(turn) <= 0.5 && Math.abs(l.idx - o.idx) > 0 && o.nLanes === l.nLanes) continue;
        }
        if (turn < -0.5 && o.idx !== 0 && o.nLanes > 1) continue;
        if (turn > 0.5 && o.idx !== o.nLanes - 1 && o.nLanes > 1) continue;
        l.next.push({ lane: o, path: this._connector(turn), turn });
      }
    }
    // dead ends: allow U-turn connectors so traffic never gets stuck
    for (let i = 0; i < lanes.length; i++) {
      const l = lanes[i]; if (l.next.length) continue;
      const out = nodes[l.to].out; let o = out[0];
      for (let j = 0; j < out.length; j++) if (out[j].edge === l.edge) { o = out[j]; break; }
      if (!o) continue;
      l.path.sample(l.s1, _p1, _d1); o.path.sample(o.s0, _p2, _d2);
      const st = this.paths, q = st.alloc(3), P = st.xyz;
      P[q * 3] = _p1.x; P[q * 3 + 1] = _p1.y; P[q * 3 + 2] = _p1.z;
      P[q * 3 + 3] = _p1.x + _d1.x * 4; P[q * 3 + 4] = _p1.y; P[q * 3 + 5] = _p1.z + _d1.z * 4;
      P[q * 3 + 6] = _p2.x; P[q * 3 + 7] = _p2.y; P[q * 3 + 8] = _p2.z;
      l.next.push({ lane: o, path: new Path(st, q, 3), turn: Math.PI });
    }
  }

  /** Connector from lane end (_p1, _d1) to lane start (_p2, _d2): a cubic Bézier with its handles along both lanes.
   * In a turn they reach towards the point where the two lane lines cross, sized so the curve is a near-circular arc
   * of the radius the junction allows (left turns, from the kerb lane, come out tighter than right turns across the
   * junction); sampled every ~7° of turn. Near-straight links (a road continuing, a lane shifting) use 0.45 chord. */
  _connector(turn) {
    const p1 = _p1, d1 = _d1, p2 = _p2, d2 = _d2, chord = p1.distanceTo(p2), th = Math.abs(turn);
    let h1 = chord * 0.45, h2 = h1;
    const dx = p2.x - p1.x, dz = p2.z - p1.z, cr = d1.x * d2.z - d1.z * d2.x;
    if (th > 0.25 && th < 2.6 && Math.abs(cr) > 1e-3) {
      // lane lines p1 + d1 * l1 and p2 - d2 * l2 cross at l1, l2; a circular arc's handles are k * its tangent legs.
      // Left turns run along the kerb: 30% longer handles bow them out a little, so the inside wheels (the rear ones cut
      // in) stay off it
      const l1 = (dx * d2.z - dz * d2.x) / cr, l2 = (d1.x * dz - d1.z * dx) / cr;
      if (l1 > 0.5 && l2 > 0.5 && l1 < chord * 2 && l2 < chord * 2) { const k = 4 / 3 * Math.tan(th / 4) / Math.tan(th / 2) * (turn < 0 ? 1.3 : 1); h1 = l1 * k; h2 = l2 * k; }
    }
    const c1x = p1.x + d1.x * h1, c1y = p1.y + d1.y * h1, c1z = p1.z + d1.z * h1;
    const c2x = p2.x - d2.x * h2, c2y = p2.y - d2.y * h2, c2z = p2.z - d2.z * h2;
    const st = this.paths, N = Math.max(4, Math.min(16, Math.ceil(th / 0.13))), o0 = st.alloc(N + 1), xyz = st.xyz;
    for (let k = 0; k <= N; k++) {
      const t = k / N, it = 1 - t, q = (o0 + k) * 3;
      xyz[q] = it * it * it * p1.x + 3 * it * it * t * c1x + 3 * it * t * t * c2x + t * t * t * p2.x;
      xyz[q + 1] = it * it * it * p1.y + 3 * it * it * t * c1y + 3 * it * t * t * c2y + t * t * t * p2.y;
      xyz[q + 2] = it * it * it * p1.z + 3 * it * it * t * c1z + 3 * it * t * t * c2z + t * t * t * p2.z;
    }
    return new Path(st, o0, N + 1);
  }

  /** traffic signals at major junctions: two phases split by approach axis */
  _signals() {
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (n.degree < 3 || !n.inc.length) continue;
      const major = n.edges.some(e => e.c <= 4);
      if (!major) continue;
      const ref = n.inc[0];
      ref.path.sample(ref.path.length - 0.1, _p1, _d1);
      const ax = Math.atan2(_d1.z, _d1.x);
      for (let j = 0; j < n.inc.length; j++) {
        const l = n.inc[j];
        l.path.sample(l.path.length - 0.1, _p2, _d2);
        let a = Math.atan2(_d2.z, _d2.x) - ax; a = Math.abs(((a % Math.PI) + Math.PI * 1.5) % Math.PI - Math.PI / 2);
        l.phase = a < Math.PI / 4 ? 1 : 0; // 0 aligned with ref axis, 1 perpendicular
      }
      n.signal = new Signal(this, Math.random() * 46);
    }
  }

  /** spatial grid of lanes / sidewalks (spawning & lookups): cell key -> items passing through it, each once (an item
   * already in a cell's list was the last one pushed: its points are visited one item at a time) */
  _grid(items) {
    const grid = new Map();
    for (let i = 0; i < items.length; i++) {
      const it = items[i], P = it.path;
      for (let s = 0; s <= P.length; s += 30) {
        P.sample(s, _p1); const k = this._k(_p1.x, _p1.z);
        let a = grid.get(k); if (!a) grid.set(k, a = []); if (a[a.length - 1] !== it) a.push(it);
      }
    }
    return grid;
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

  updateSignals(dt) { this.signalClock += dt; }
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
      const P = l.path.st.xyz, o = l.path.o, n = l.path.n;
      for (let i = 0; i < n - 1; i++) {
        const q = (o + i) * 3, ax = P[q], az = P[q + 2], bx = P[q + 3], bz = P[q + 5];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        const px = ax + dx * t, pz = az + dz * t; const dd = hypot(px - x, pz - z);
        if (!bl || dd < bd) { bl = l; bs = l.path.arc(i) + Math.sqrt(L2) * t; bd = dd; }
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
      const P = sw.path.st.xyz, o = sw.path.o, n = sw.path.n;
      for (let i = 0; i < n - 1; i++) {
        const q = (o + i) * 3, ax = P[q], az = P[q + 2], bx = P[q + 3], bz = P[q + 5];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        const px = ax + dx * t, pz = az + dz * t; const dd = hypot(px - x, pz - z);
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
      for (let i = 0; i < LP.n; i++) if (LP.arc(i) >= s) pts.push([LP.x(i), LP.z(i)]);
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
    const h = l => { const P = l.path, k = P.n - 1; return hypot(P.x(k) - tx, P.z(k) - tz); };
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
