// Bridge deck heights for tools/build-city.mjs.
// OSM marks the spans (bridge=yes/viaduct) and a stacking `layer`, never a deck height. Here spans that meet are joined
// into one structure whatever their layers; every span wants a deck height (a named bridge's real one; clear of the
// traffic below, by layer, when the structure passes over a road; else a low arch over the river, a canal or a drain);
// the deck only comes down where the structure really reaches the ground — at a free end. Ground ways that leave a span
// mid-way (slip roads, stairs, short gaps between two spans) are lifted as ramps, and so are the approaches of flyovers
// too short to climb over what they cross — through the junctions of an interchange if need be. Gradients stay those of
// a road (stairs on footbridges); crests and sags are rounded. validateBridges() fails the build on a deck that dips,
// steps or spikes.

// real deck heights (m above the quay; the water is 1.4 m lower) where the rules below get it wrong
const DECK = [
  [/^Benjamin Sheares Bridge$/, 27], // 29 m over the water at its highest, the tallest bridge in Singapore
  [/^Bayfront Bridge$/, 2.6],        // a low arch beside the Helix (OSM layer 2 only stacks it over the promenade)
  [/^The Helix$/, 2.2],              // the hand-built landmark's crown (landmarks/helix.js)
  [/^Esplanade Bridge$/, 3.6],       // low arches the river boats pass under
  [/^Merdeka Bridge$/, 5.4],         // Nicoll Highway over the Kallang River, level with its footways
];
const GRADE = { drive: 0.06, foot: 0.55, steps: 0.7 }; // steepest rise per metre (footbridge ends stand in for stairs)
const SPACING = { drive: 12, foot: 5 };                // deck profile sample spacing (m)
const SAG = 40;                                        // a drive deck leaves the ground over a 40 m vertical curve
const SMOOTH = 8;                                      // crest/sag rounding passes on drive decks

// vertex identity at the 0.1 m the data ships with (OSM has the odd pair of separate nodes a few cm apart)
const kp = p => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
const mode = r => (r.drive ? 'drive' : 'foot');

// the roads each span passes over (drivable ways below it: on the ground or a lower deck, not connected to it)
function roadCrossings(spans, roadsRaw) {
  const C = 40, grid = new Map(), out = new Map();
  const cell = (x, z) => `${Math.floor(x / C)},${Math.floor(z / C)}`;
  for (const o of roadsRaw) if (o.drive) for (let i = 1; i < o.pts.length; i++) {
    const a = o.pts[i - 1], b = o.pts[i];
    for (let gx = Math.floor(Math.min(a[0], b[0]) / C); gx <= Math.floor(Math.max(a[0], b[0]) / C); gx++)
      for (let gz = Math.floor(Math.min(a[1], b[1]) / C); gz <= Math.floor(Math.max(a[1], b[1]) / C); gz++) { const k = `${gx},${gz}`; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push([o, a, b]); }
  }
  const cross = (a, b, c, d) => { const r0 = b[0] - a[0], r1 = b[1] - a[1], s0 = d[0] - c[0], s1 = d[1] - c[1], den = r0 * s1 - r1 * s0; if (Math.abs(den) < 1e-9) return false; const t = ((c[0] - a[0]) * s1 - (c[1] - a[1]) * s0) / den, u = ((c[0] - a[0]) * r1 - (c[1] - a[1]) * r0) / den; return t > 0 && t < 1 && u > 0 && u < 1; };
  for (const r of spans) {
    const own = new Set(r.pts.map(kp));
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], ks = new Set();
      for (let f = 0; f <= 1; f += 0.125) ks.add(cell(a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])));
      for (const k of ks) for (const [o, c, d] of grid.get(k) || []) {
        if (o === r || (o.bridge && o.layer >= r.layer) || o.pts.some(q => own.has(kp(q))) || !cross(a, b, c, d)) continue;
        let l = out.get(r); if (!l) out.set(r, l = new Set()); l.add(o);
      }
    }
  }
  return out;
}

// the deck height a span wants: a named bridge's real one; a low arch over water, or over whatever a structure that
// crosses no road spans (a canal, a drain, a path); else clear of the traffic below, by layer
function deckTarget(r, isWaterAt, overRoad) {
  for (const [re, h] of DECK) if (re.test(r.t['bridge:name'] || '') || re.test(r.name)) return h;
  let n = 0, wet = 0;
  for (let i = 1; i < r.pts.length; i++) {
    const a = r.pts[i - 1], b = r.pts[i], k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
    for (let s = 0; s < k; s++) { const f = (s + 0.5) / k; n++; if (isWaterAt(a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]))) wet++; }
  }
  const overWater = n && wet / n > 0.3;
  if (!r.drive) return overWater || !overRoad ? 2.2 : 5.4;
  if ((overWater && r.layer <= 1) || !overRoad) return 1.6;
  return Math.min(22, 6.8 * Math.max(1, r.layer));
}

class Heap { // binary min-heap of [priority, id]
  constructor() { this.a = []; }
  push(p, id) { const a = this.a; a.push([p, id]); let i = a.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; [a[i], a[j]] = [a[j], a[i]]; i = j; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}
// least of src[v] + cost(path) over all sources; cost of an edge = its steepest rise * length
function relax(V, src) {
  const d = new Float64Array(V.length).fill(Infinity), h = new Heap();
  for (const [v, val] of src) if (val < d[v]) { d[v] = val; h.push(val, v); }
  while (h.size) {
    const [dv, v] = h.pop(); if (dv > d[v]) continue;
    for (const [u, len, g] of V[v].adj) { const du = dv + len * g; if (du < d[u]) { d[u] = du; h.push(du, u); } }
  }
  return d;
}

// heights for one structure: members [{r, D (wanted height or null), g}], pins Map(vertex key -> fixed height); sets
// each member's densified points m.np (m.orig: index of the source vertex or -1), vertex ids m.vid and heights m.y
function solve(members, pinAt) {
  const V = [], byKey = new Map();
  const vert = key => { if (key != null && byKey.has(key)) return byKey.get(key); V.push({ adj: [] }); if (key != null) byKey.set(key, V.length - 1); return V.length - 1; };
  for (const m of members) {
    const sp = SPACING[mode(m.r)], P = m.r.pts;
    m.np = [P[0]]; m.orig = [0]; m.vid = [vert(kp(P[0]))];
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], n = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / sp);
      for (let s = 1; s <= n; s++) { const f = s / (n + 1), q = [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])]; m.np.push(q); m.orig.push(-1); m.vid.push(vert(null)); }
      m.np.push(b); m.orig.push(i); m.vid.push(vert(kp(b)));
    }
    for (let i = 1; i < m.vid.length; i++) {
      const a = m.vid[i - 1], b = m.vid[i], len = Math.hypot(m.np[i][0] - m.np[i - 1][0], m.np[i][1] - m.np[i - 1][1]);
      if (a === b) continue;
      V[a].adj.push([b, len, m.g]); V[b].adj.push([a, len, m.g]);
    }
  }
  // highest the deck can be: every wanted height and pin, falling off no steeper than allowed
  const up = [], ground = [], fixed = [];
  for (const m of members) if (m.D != null) for (const v of m.vid) up.push([v, -m.D]);
  const pin = (v, y) => { up.push([v, -y]); fixed.push([v, y]); if (y === 0) ground.push([v, 0]); };
  for (const [key, y] of pinAt) { const v = byKey.get(key); if (v != null) pin(v, y); }
  for (const m of members) if (m.groundMid) { // the middle 12 m of a long ground way between two spans
    const s = [0]; for (let i = 1; i < m.np.length; i++) s.push(s[i - 1] + Math.hypot(m.np[i][0] - m.np[i - 1][0], m.np[i][1] - m.np[i - 1][1]));
    const mid = s[s.length - 1] / 2; let near = 0;
    m.vid.forEach((v, i) => { if (Math.abs(s[i] - mid) <= 6) pin(v, 0); if (Math.abs(s[i] - mid) < Math.abs(s[near] - mid)) near = i; });
    pin(m.vid[near], 0);
  }
  const hiNeg = relax(V, up);
  // lowest it must be: climbing from the ground (eased off it over a vertical curve) or from a deck it is pinned to
  const fromGround = relax(V, ground), fromPins = relax(V, fixed.filter(([, y]) => y > 0));
  const ease = (c, c0) => (c < c0 ? c * c / (2 * c0) : c - c0 / 2);
  const drive = members[0].r.drive, c0 = drive ? GRADE.drive * SAG : 0;
  let y = new Float64Array(V.length);
  for (let v = 0; v < V.length; v++) y[v] = Math.max(0, Math.min(-hiNeg[v], ease(fromGround[v], c0), fromPins[v]));
  const isFixed = new Uint8Array(V.length); for (const [v, h] of fixed) { isFixed[v] = 1; y[v] = h; }
  if (drive) {
    // round crests and sags ([1 2 1] passes), then take the steepest-allowed envelope below it again
    for (let k = 0; k < SMOOTH; k++) {
      const y2 = Float64Array.from(y);
      for (let v = 0; v < V.length; v++) { if (isFixed[v] || !V[v].adj.length) continue; let s = 2 * y[v]; for (const [u] of V[v].adj) s += y[u]; y2[v] = s / (2 + V[v].adj.length); }
      y = y2;
    }
    y = relax(V, [...y].map((h, v) => [v, h]));
  }
  for (const m of members) m.y = m.vid.map(v => y[v]);
}

/**
 * Gives every bridge way (r.bridge) a deck profile r.y on densified points r.pts; lifts and splits the ground ways that
 * ramp up to them (their raised part becomes a bridge way). Returns the ways to insert: [[afterWay, newWay], ...].
 */
export function elevateBridges(roadsRaw, isWaterAt) {
  const touch = new Map(); // vertex key -> [{r, i}]
  for (const r of roadsRaw) r.pts.forEach((p, i) => { const k = kp(p); let l = touch.get(k); if (!l) touch.set(k, l = []); l.push({ r, i }); });
  const isEnd = (r, i) => i === 0 || i === r.pts.length - 1;
  // heights settled by the structures built so far, by vertex key: a later one that meets them (a footbridge landing on
  // a road deck, two flyovers sharing an interchange) is pinned to them
  const settled = new Map();
  const inserts = [], stats = { structures: 0, lifted: 0, liftedM: 0, approaches: 0, interchanges: 0 };
  const taken = new Set(); // ground ways already lifted (and split) for a structure
  for (const r of roadsRaw) r.y = r.pts.map(() => 0);
  for (const md of ['drive', 'foot']) {
    const spans = roadsRaw.filter(r => r.bridge && mode(r) === md);
    const parent = new Map(spans.map(r => [r, r]));
    const find = r => { while (parent.get(r) !== r) { parent.set(r, parent.get(parent.get(r))); r = parent.get(r); } return r; };
    const join = (a, b) => parent.set(find(a), find(b));
    for (const r of spans) for (const p of r.pts) for (const o of touch.get(kp(p))) if (o.r !== r && o.r.bridge && mode(o.r) === md) join(o.r, r);
    // how many span ends meet at a vertex (an interior vertex counts twice): 1 = a free end of the structure
    const spanDeg = k => touch.get(k).reduce((n, o) => n + (o.r.bridge && mode(o.r) === md ? (isEnd(o.r, o.i) ? 1 : 2) : 0), 0);
    // ground ways of this mode that end on a span: a slip road or stairs leaving it mid-way is a ramp up to the deck
    // (attached), the only way going on from a free end is a possible approach ramp, the rest meet it on the ground
    const links = new Map(); // ground way -> {how: per end 'attach' | 'approach' | null, span: the span at that end}
    for (const r of spans) for (const p of r.pts) {
      const k = kp(p), here = touch.get(k), deg = spanDeg(k);
      const ground = here.filter(o => !o.r.bridge && (md === 'drive' ? o.r.drive : o.r.foot));
      for (const o of ground) {
        if (!isEnd(o.r, o.i)) continue;
        const end = o.i === 0 ? 0 : 1;
        let how = null;
        if (deg >= 2) how = 'attach';
        else if (md === 'foot' && o.r.hw === 'steps' && ground.every(g => g.r.hw === 'steps')) how = 'attach';
        else if (ground.length === 1) how = 'approach';
        if (!how) continue;
        let L = links.get(o.r); if (!L) links.set(o.r, L = { r: o.r, how: [null, null], span: [null, null] });
        L.how[end] = how; L.span[end] = r;
      }
    }
    // stairs often hang off a short landing way: the lift carries on down a single path of ground footways (up to the
    // length a stair needs), or the landing's foot would drag the deck down into a notch
    if (md === 'foot') {
      const wayLen = r => { let l = 0; for (let i = 1; i < r.pts.length; i++) l += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]); return l; };
      const queue = [...links.values()].filter(L => L.how.includes('attach') && !(L.how[0] && L.how[1]));
      while (queue.length) {
        const L = queue.pop(), depth = (L.depth || 0) + wayLen(L.r);
        if (depth > 12) continue;
        const next = touch.get(kp(L.how[0] ? L.r.pts[L.r.pts.length - 1] : L.r.pts[0])).filter(o => o.r !== L.r && !o.r.bridge && o.r.foot);
        if (next.length !== 1 || links.has(next[0].r) || !isEnd(next[0].r, next[0].i)) continue;
        const N = { r: next[0].r, how: [null, null], span: [null, null], depth }, end = next[0].i === 0 ? 0 : 1;
        N.how[end] = 'attach'; N.span[end] = L.span[0] || L.span[1];
        links.set(N.r, N); queue.push(N);
      }
    }
    // a ground way between two spans (both its ends on a deck) joins them into one structure; one long enough to come
    // down to the ground in between does so (it is at grade there, by OSM)
    const below = roadCrossings(spans, roadsRaw), roadRoots = new Set([...below.keys()].map(find));
    const want = new Map(spans.map(r => [r, deckTarget(r, isWaterAt, roadRoots.has(find(r)))]));
    for (const L of links.values()) if (L.how[0] && L.how[1]) {
      L.how = ['attach', 'attach']; join(L.span[0], L.span[1]);
      let len = 0; for (let i = 1; i < L.r.pts.length; i++) len += Math.hypot(L.r.pts[i][0] - L.r.pts[i - 1][0], L.r.pts[i][1] - L.r.pts[i - 1][1]);
      L.groundMid = len > 2 * (Math.min(want.get(L.span[0]), want.get(L.span[1])) - 1) / GRADE[md];
    }
    // a lifted way also ties together every span it touches on the way
    for (const L of links.values()) if (L.how.includes('attach')) for (const p of L.r.pts) for (const o of touch.get(kp(p))) if (o.r.bridge && mode(o.r) === md) join(o.r, L.span[0] || L.span[1]);
    const groups = new Map();
    for (const r of spans) { const g = find(r); if (!groups.has(g)) groups.set(g, { spans: [], links: [] }); groups.get(g).spans.push(r); }
    for (const L of links.values()) groups.get(find(L.span[0] || L.span[1])).links.push(L);

    // tallest first: a lower structure that meets one (at a shared interchange, a landing) takes its heights there
    const tallest = G => Math.max(...G.spans.map(r => want.get(r)));
    const built = new Set();
    for (const G of [...groups.values()].sort((a, b) => tallest(b) - tallest(a))) {
      if (built.has(G)) continue;
      built.add(G); stats.structures++;
      const g = r => (r.hw === 'steps' ? GRADE.steps : GRADE[md]);
      const base = G.spans.map(r => ({ r, D: want.get(r), g: g(r) }));
      const linkMember = L => ({ r: L.r, D: null, g: g(L.r), link: L, groundMid: L.groundMid });
      const degrees = members => { // member incidences at a vertex (an interior vertex counts twice): 1 = a free end
        const deg = new Map();
        for (const m of members) m.r.pts.forEach((p, i) => { const k = kp(p); deg.set(k, (deg.get(k) || 0) + (isEnd(m.r, i) ? 1 : 2)); });
        return deg;
      };
      const run = (withApproaches, extra = []) => {
        const members = base.concat(G.links.filter(L => L.how.includes('attach') || (withApproaches && L.how.includes('approach'))).map(linkMember), extra);
        const deg = degrees(members);
        const stub = (P, i) => { const dir = i ? -1 : 1; let s = 0; for (let j = i + dir; j >= 0 && j < P.length; j += dir) { s += Math.hypot(P[j][0] - P[j - dir][0], P[j][1] - P[j - dir][1]); if (deg.get(kp(P[j])) >= 3) return s; } return Infinity; };
        // a free end comes down to the ground where another way meets it; a loose stub just past a landing stays up
        const pins = new Map();
        for (const m of members) for (const i of [0, m.r.pts.length - 1]) {
          const k = kp(m.r.pts[i]);
          if (deg.get(k) === 1 && !(touch.get(k).length === 1 && stub(m.r.pts, i) < 8)) pins.set(k, 0);
        }
        for (const m of members) for (const p of m.r.pts) { const k = kp(p); if (settled.has(k)) pins.set(k, settled.get(k)); }
        solve(members, pins);
        return members;
      };
      const short = members => members.some(m => m.D != null && Math.max(...m.y) < 0.9 * m.D);
      // still too short with them over a road: lift every ground road within a ramp's length of its free ends (an
      // interchange's slip roads, the street on past its junctions), not the roads it crosses (they stay below it);
      // another structure it runs into (the flyover on the far side of the junction) is built with it
      const interchange = members => {
        const deg = degrees(members), inside = new Set(members.map(m => m.r));
        const under = new Set(G.spans.flatMap(r => [...(below.get(r) || [])]));
        const reach = Math.max(...members.filter(m => m.D != null).map(m => m.D)) / GRADE.drive + SAG;
        const owner = w => { const L = links.get(w), r = w.bridge && mode(w) === md ? w : L && (L.span[0] || L.span[1]); const o = r && groups.get(find(r)); return o !== G ? o : null; };
        const dist = new Map(), h = new Heap(), ways = new Set(), others = new Set();
        for (const [k, n] of deg) if (n === 1) { dist.set(k, 0); h.push(0, k); }
        while (h.size) {
          const [d, k] = h.pop(); if (d > dist.get(k)) continue;
          for (const { r: w, i } of touch.get(k)) {
            const o = owner(w);
            if (o) { if (!built.has(o)) others.add(o); continue; }
            if (w.bridge || !w.drive || inside.has(w) || under.has(w) || taken.has(w) || links.has(w)) continue;
            ways.add(w);
            for (const dir of [-1, 1]) for (let j = i + dir, s = d; j >= 0 && j < w.pts.length && s < reach; j += dir) {
              s += Math.hypot(w.pts[j][0] - w.pts[j - dir][0], w.pts[j][1] - w.pts[j - dir][1]);
              const kj = kp(w.pts[j]);
              if (s < reach && s < (dist.get(kj) ?? Infinity) && touch.get(kj).length > 1) { dist.set(kj, s); h.push(s, kj); }
            }
          }
        }
        const extra = [...ways].map(w => ({ r: w, D: null, g: GRADE.drive, link: true }));
        for (const o of others) { built.add(o); extra.push(...o.spans.map(r => ({ r, D: want.get(r), g: g(r) })), ...o.links.map(linkMember)); }
        return extra;
      };
      let members = run(false);
      // a flyover (footbridge) too short to climb to its height within its own spans takes its ramps (stairs) onto the
      // approach ways
      if (G.links.some(L => L.how.includes('approach')) && short(members)) { members = run(true); stats.approaches++; }
      if (md === 'drive' && roadRoots.has(find(G.spans[0])) && short(members)) { members = run(true, interchange(members)); stats.interchanges++; }
      for (const m of members) {
        if (!m.link) { m.r.pts = m.np; m.r.y = m.y; continue; }
        // a lifted ground way: its raised runs (with the vertices where they touch down) become bridge ways, the rest
        // stays a ground way on its own vertices
        const n = m.np.length, up = m.y.map(h => h > 0.05), runs = [];
        for (let i = 0; i < n; i++) if (up[i] && (i === 0 || !up[i - 1])) { let j = i; while (j + 1 < n && up[j + 1]) j++; runs.push([Math.max(0, i - 1), Math.min(n - 1, j + 1)]); }
        if (!runs.length) continue;
        stats.lifted++; taken.add(m.r);
        const pieces = [], piece = (a, b, raised) => {
          const idx = []; for (let i = a; i <= b; i++) if (raised || i === a || i === b || m.orig[i] >= 0) idx.push(i);
          pieces.push({ ...m.r, pts: idx.map(i => m.np[i]), y: idx.map(i => (raised ? m.y[i] : 0)), bridge: raised ? 1 : 0 });
          if (raised) for (let k = 1; k < idx.length; k++) stats.liftedM += Math.hypot(m.np[idx[k]][0] - m.np[idx[k - 1]][0], m.np[idx[k]][1] - m.np[idx[k - 1]][1]);
        };
        let pos = 0;
        for (const [a, b] of runs) { if (a > pos) piece(pos, a, false); piece(a, b, true); pos = b; }
        if (pos < n - 1) piece(pos, n - 1, false);
        Object.assign(m.r, pieces[0]);
        for (let k = pieces.length - 1; k >= 1; k--) inserts.push([m.r, pieces[k]]);
      }
      for (const m of members) m.np.forEach((p, i) => settled.set(kp(p), m.y[i]));
    }
  }
  stats.liftedM = Math.round(stats.liftedM);
  return { inserts, stats };
}

/**
 * Checks the final ways (pts, y, bridge, drive, hw): no deck may dip to the ground between raised neighbours, notch,
 * step at a shared vertex, or climb steeper than its grade. Returns a list of problems (empty = fine).
 */
export function validateBridges(roads) {
  const bad = [], at = new Map();
  const fmt = p => `(${p[0].toFixed(0)},${p[1].toFixed(0)})`;
  for (const r of roads) if (r.bridge) r.pts.forEach((p, i) => { const k = kp(p); let l = at.get(k); if (!l) at.set(k, l = []); l.push({ r, i }); });
  // decks meeting at a vertex agree on its height
  for (const l of at.values()) {
    const ys = l.map(o => o.r.y[o.i]);
    if (Math.max(...ys) - Math.min(...ys) > 0.15) bad.push(`step ${fmt(l[0].r.pts[l[0].i])}: ${l.map(o => `${o.r.name || o.r.hw} ${o.r.y[o.i].toFixed(1)}`).join(" / ")}`);
  }
  // V-dip: a vertex under 1 m with more than one direction along the deck climbing above 3 m within 60 m
  const reach = (r, i, dir) => { let s = 0, hi = 0; for (let j = i + dir; j >= 0 && j < r.pts.length && s < 60; j += dir) { s += Math.hypot(r.pts[j][0] - r.pts[j - dir][0], r.pts[j][1] - r.pts[j - dir][1]); hi = Math.max(hi, r.y[j]); } return hi; };
  for (const l of at.values()) {
    const { r, i } = l[0]; if (r.y[i] >= 1) continue;
    let high = 0;
    for (const o of l) for (const dir of [-1, 1]) if (reach(o.r, o.i, dir) > 3) high++;
    if (high >= 2) bad.push(`dip ${fmt(r.pts[i])}: deck at ${r.y[i].toFixed(1)} m between raised spans (${l.map(o => o.r.name || o.r.hw).join(', ')})`);
  }
  // notch: a deck vertex 1.5 m below the deck on both sides of it within 15 m (a stair or side path dragging it down)
  for (const r of roads) {
    if (!r.bridge) continue;
    const S = [0]; for (let i = 1; i < r.pts.length; i++) S.push(S[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
    for (let i = 1; i < r.pts.length - 1; i++) {
      let L = 0, R = 0;
      for (let j = i - 1; j >= 0 && S[i] - S[j] < 15; j--) L = Math.max(L, r.y[j]);
      for (let j = i + 1; j < r.pts.length && S[j] - S[i] < 15; j++) R = Math.max(R, r.y[j]);
      if (Math.min(L, R) - r.y[i] > 1.5) { bad.push(`notch ${fmt(r.pts[i])} ${r.name || r.hw}: ${r.y[i].toFixed(1)} m between ${L.toFixed(1)} and ${R.toFixed(1)}`); break; }
    }
  }
  // gradient and kinks along every deck (slack for the rounding to decimetres)
  for (const r of roads) {
    if (!r.bridge) continue;
    const g = r.hw === 'steps' ? GRADE.steps : r.drive ? GRADE.drive : GRADE.foot;
    let prev = null;
    for (let i = 1; i < r.pts.length; i++) {
      const len = Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]); if (len < 0.5) continue;
      const dy = r.y[i] - r.y[i - 1];
      if (Math.abs(dy) > g * (len + 0.2) + 0.1) bad.push(`grade ${fmt(r.pts[i])} ${r.name || r.hw}: ${(dy / len * 100).toFixed(0)}% over ${len.toFixed(0)} m`);
      if (r.drive && len > 4) { const gr = dy / len; if (prev != null && Math.abs(gr - prev) > 0.05 + 0.2 / len) bad.push(`kink ${fmt(r.pts[i - 1])} ${r.name || r.hw}: ${(prev * 100).toFixed(0)}% -> ${(gr * 100).toFixed(0)}%`); prev = gr; }
    }
  }
  return bad;
}
