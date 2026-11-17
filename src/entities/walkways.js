// Where pedestrians walk: both sidewalks of every street (from the road network) plus the city's footways and
// pedestrian streets (riverside promenades, park paths, Merlion Park, Chinatown's pedestrian malls, crossings).
// Every line is vetted before anyone walks it: OSM routes footways through malls and onto road centrelines, and on a
// divided road one carriageway's sidewalk line runs down the other carriageway, so the parts inside a building, in
// the water or on a carriageway (except marked crossings) are cut away. Vetting runs lazily around the viewer under a
// per-frame time budget (no load cost; a relocation vets its new area behind the fade).
import { Path } from '../world/roadnet.js';

const CELL = 60, STEP = 2.5, MIN_RUN = 6;
const cellKey = (gx, gz) => gx * 100003 + gz;

/** squared distance from (x,z) to segment a-b and the segment parameter */
function segDist2(x, z, ax, az, bx, bz, out) {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
  const px = ax + dx * t - x, pz = az + dz * t - z;
  if (out) out.t = t;
  return px * px + pz * pz;
}

export class Walkways {
  constructor(game) {
    this.game = game;
    this.grid = new Map(); // cell -> walks ready to use
    this.raw = new Map();  // cell -> lines not vetted yet: { sw } road sidewalks, { r } footways
    this._stamp = 0; this._seg = { t: 0 }; this._near = []; this._edges = [];
    // polylines are read in place: a sidewalk's points are its window [i0, i1) of the road network's shared path store
    // (xyz, stride 3), a footway's [x0,z0,x1,z1,...] its own array (stride 2)
    for (const sw of game.roadnet.sidewalks) { const P = sw.path; this._register(this.raw, { sw, p: P.st.xyz, i0: P.o * 3, i1: (P.o + P.n) * 3, st: 3, done: false }); }
    for (const r of game.city.data.roads) {
      if ((r.c !== 8 && r.c !== 9) || r.y || r.b) continue; // elevated / bridge footways: stairs and decks are not modelled
      this._register(this.raw, { r, p: r.p, i0: 0, i1: r.p.length, st: 2, done: false });
    }
  }

  /** add item to every cell its polyline (item.p from i0 to i1, stride item.st, z at +st-1) passes through */
  _register(grid, item) {
    const { p, st, i0, i1 } = item, seen = new Set(), zo = st - 1;
    for (let i = i0; i < i1; i += st) {
      const x = p[i], z = p[i + zo];
      seen.add(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (i + st < i1) { // long segments cross cells without a vertex in them
        const bx = p[i + st], bz = p[i + st + zo], n = Math.ceil(Math.hypot(bx - x, bz - z) / (CELL / 2));
        for (let s = 1; s < n; s++) { const f = s / n; seen.add(cellKey(Math.floor((x + (bx - x) * f) / CELL), Math.floor((z + (bz - z) * f) / CELL))); }
      }
    }
    for (const k of seen) { let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(item); }
  }

  /** vet the lines around (x,z) nearest-cells-first until `budgetMs` is spent; true when the area is done */
  prepare(x, z, r, budgetMs) {
    const t0 = performance.now(), gx0 = Math.floor(x / CELL), gz0 = Math.floor(z / CELL), K = Math.ceil(r / CELL);
    for (let k = 0; k <= K; k++)
      for (let gx = gx0 - k; gx <= gx0 + k; gx++)
        for (let gz = gz0 - k; gz <= gz0 + k; gz++) {
          if (Math.max(Math.abs(gx - gx0), Math.abs(gz - gz0)) !== k) continue; // ring k only
          const key = cellKey(gx, gz), list = this.raw.get(key); if (!list) continue;
          while (list.length) {
            const item = list.pop(); if (item.done) continue;
            this._vet(item);
            if (performance.now() - t0 > budgetMs) return false;
          }
          this.raw.delete(key);
        }
    return true;
  }

  _vet(item) {
    item.done = true;
    const g = this.game, city = g.city, safe = g.safe, { sw, r, p, st, i0, i1 } = item, zo = st - 1, cross = !!r?.x;
    // carriageways this line could touch (one lookup per line, then a few segments per sample); a sidewalk is
    // beside its own street by construction
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = i0; i < i1; i += st) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + zo]); z1 = Math.max(z1, p[i + zo]); }
    const edges = this._edges; edges.length = 0;
    if (!cross) for (const l of g.roadnet.lanesNear((x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2 + 30, this._near)) if (!l.edge.y && l.edge !== sw?.edge && !edges.includes(l.edge)) edges.push(l.edge);
    const ok = (x, z) => !city.isWater(x, z) && !safe.insideBuilding(x, z, sw ? 0 : 0.3) && !this._onEdges(x, z, edges, sw ? 0.3 : 0.2);
    let run = [];
    const flush = () => {
      let len = 0; for (let i = 1; i < run.length; i++) len += Math.hypot(run[i][0] - run[i - 1][0], run[i][2] - run[i - 1][2]);
      if (len >= MIN_RUN) {
        const path = Path.fromPoints(run), k = path.n - 1;
        const w = sw ? { path, foot: false, edge: sw.edge, side: sw.side, half: 0.55 } : { path, foot: true, cross, half: Math.max(0.15, Math.min(2.5, (r.w || 2) / 2 - 0.5)) };
        w.ends = [[path.x(0), path.z(0)], [path.x(k), path.z(k)]];
        this._register(this.grid, w, path.xyz, 3);
      }
      run = [];
    };
    for (let i = i0; i + st < i1; i += st) {
      const ax = p[i], az = p[i + zo], bx = p[i + st], bz = p[i + st + zo], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / STEP));
      for (let s = i === 0 ? 0 : 1; s <= n; s++) {
        const f = s / n, x = ax + (bx - ax) * f, z = az + (bz - az) * f;
        if (!ok(x, z)) { flush(); continue; }
        // keep the polyline's own corners; drop the in-between samples once a run continues past them
        if (run.length >= 2 && s > 0 && s < n) { const q = run[run.length - 1]; if (q.mid) { q[0] = x; q[2] = z; continue; } }
        const v = [x, 0, z]; v.mid = s > 0 && s < n; run.push(v);
      }
    }
    flush();
  }

  _onEdges(x, z, edges, pad) {
    const seg = this._seg;
    for (const e of edges) {
      const p = e.p, lim = (e.hw + pad) ** 2;
      for (let i = 0; i + 2 < p.length; i += 2) if (segDist2(x, z, p[i], p[i + 1], p[i + 2], p[i + 3], seg) < lim) return true;
    }
    return false;
  }

  /** on a carriageway (any road edge's paved width) */
  onRoad(x, z, pad = 0.3) {
    const edges = this._edges; edges.length = 0;
    for (const l of this.game.roadnet.lanesNear(x, z, 30, this._near)) if (!l.edge.y && !edges.includes(l.edge)) edges.push(l.edge);
    return this._onEdges(x, z, edges, pad);
  }

  /** somewhere a person can stand: on land, outside buildings, off the carriageway, clear of trees and props */
  standable(x, z) {
    const g = this.game;
    return !g.city.isWater(x, z) && !g.safe.insideBuilding(x, z, 0.45) && !this.onRoad(x, z) && !g.treeColliders?.trunkNear(x, z, 1.1) && g.safe.clear(x, z, { pad: 0.45 });
  }

  /** walks with a point within r of (x,z), each once. `out` is cleared and reused. */
  near(x, z, r, out = []) {
    out.length = 0; const stamp = ++this._stamp;
    for (let gx = Math.floor((x - r) / CELL); gx <= Math.floor((x + r) / CELL); gx++)
      for (let gz = Math.floor((z - r) / CELL); gz <= Math.floor((z + r) / CELL); gz++) {
        const a = this.grid.get(cellKey(gx, gz)); if (!a) continue;
        for (let i = 0; i < a.length; i++) { const w = a[i]; if (w._ws !== stamp) { w._ws = stamp; out.push(w); } }
      }
    return out;
  }

  /** nearest point of a walk to (x,z) within r: { w, s, d } (reused object) or null */
  snap(x, z, r, filter) {
    let best = null, bd = r * r;
    const seg = this._seg, res = this._snap || (this._snap = { w: null, s: 0, d: 0 });
    for (const w of this.near(x, z, r, this._nearW || (this._nearW = []))) {
      if (filter && !filter(w)) continue;
      const pa = w.path, P = pa.st.xyz, cum = pa.st.cum, o0 = pa.o; // the path's window of its store
      for (let i = o0; i < o0 + pa.n - 1; i++) {
        const d2 = segDist2(x, z, P[i * 3], P[i * 3 + 2], P[i * 3 + 3], P[i * 3 + 5], seg);
        if (d2 < bd) { bd = d2; best = w; res.s = cum[i] + (cum[i + 1] - cum[i]) * seg.t; }
      }
    }
    if (!best) return null;
    res.w = best; res.d = Math.sqrt(bd);
    return res;
  }

  /** where to go at the end of a walk: another walk joined at an end or (footways) anywhere along it; null = turn back.
   * Sidewalks also hop across junctions to the next street's sidewalk (that walk is the pedestrian crossing). */
  next(w, endX, endZ) {
    const cands = this._cands || (this._cands = []); cands.length = 0;
    const seg = this._seg, reach = w.foot ? 3 : 22;
    for (const o of this.near(endX, endZ, reach + 2, this._nearN || (this._nearN = []))) {
      if (o === w) continue;
      for (let k = 0; k < 2; k++) {
        const e = o.ends[k], d = Math.hypot(e[0] - endX, e[1] - endZ);
        if (d < (w.foot || o.foot ? 3 : 22)) cands.push(o, k === 0 ? 0 : o.path.length, k === 0 ? 1 : -1);
      }
      if (!o.foot && !w.foot) continue;
      // T-junction: the end touches the middle of another walk
      const pa = o.path, P = pa.st.xyz, cum = pa.st.cum, o0 = pa.o; // the path's window of its store
      for (let i = o0; i < o0 + pa.n - 1; i++) {
        if (segDist2(endX, endZ, P[i * 3], P[i * 3 + 2], P[i * 3 + 3], P[i * 3 + 5], seg) > 4) continue;
        const s = cum[i] + (cum[i + 1] - cum[i]) * seg.t;
        if (s > 1.5 && s < o.path.length - 1.5) { cands.push(o, s, Math.random() < 0.5 ? 1 : -1); break; }
      }
    }
    if (!cands.length) return null;
    const j = Math.floor(Math.random() * (cands.length / 3)) * 3;
    const res = this._next || (this._next = { w: null, s: 0, dir: 1 });
    res.w = cands[j]; res.s = cands[j + 1]; res.dir = cands[j + 2];
    return res;
  }
}
