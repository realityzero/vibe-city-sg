// Fingerprint of everything RoadNet builds from the city graph (every node, edge, lane, connector and sidewalk
// property, each Path's packed xyz / cum, the spatial grids) so road-network refactors can be shown to produce
// bit-identical output; plus the build's allocation volume (first, cold build — as in the game, where it runs once),
// the heap it keeps, and its time. Runs in Node (no browser), seeded RNG.
//   node tests/mobile/roadnethash.mjs [--src path/to/roadnet.js] [--runs N]
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';
import { Session } from 'inspector/promises';
import v8 from 'v8';
import { runInNewContext } from 'vm';

const args = process.argv.slice(2), arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const runs = +arg('--runs', 5);
v8.setFlagsFromString('--expose-gc'); const gc = runInNewContext('gc');
let seed = 12345; Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const src = arg('--src', null);
const { RoadNet } = await import(src ? pathToFileURL(resolve(src)).href : '../../src/world/roadnet.js');
const json = readFileSync(new URL('../../public/data/city.json', import.meta.url), 'utf8');
const city = () => ({ data: JSON.parse(json) });

// --- allocation volume of a build (sampling heap profiler, collected objects kept), and what stays alive
const MB = b => (b / 1048576).toFixed(1);
async function sampled(label) {
  const s = new Session(); s.connect();
  const c = city(); gc();
  const heap0 = process.memoryUsage();
  await s.post('HeapProfiler.enable');
  await s.post('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  seed = 12345;
  const net = new RoadNet(c);
  const { profile } = await s.post('HeapProfiler.stopSampling');
  s.disconnect();
  gc(); const heap1 = process.memoryUsage();
  const bySite = new Map(); let tot = 0;
  const walk = (n, stack) => {
    const here = [...stack, n.callFrame];
    if (n.selfSize) {
      let app = null; for (let i = here.length - 1; i >= 0; i--) if (/roadnet[^/]*\.js/.test(here[i].url)) { app = here[i]; break; }
      if (app) { const k = `${app.functionName || '(anon)'}`; bySite.set(k, (bySite.get(k) || 0) + n.selfSize); tot += n.selfSize; }
    }
    for (const ch of n.children) walk(ch, here);
  };
  walk(profile.head, []);
  console.log(`${label} build allocated ≈ ${MB(tot)} MB of JS objects (${[...bySite].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${MB(v)}`).join(', ')})`);
  console.log(`  kept: JS heap ${MB(heap1.heapUsed - heap0.heapUsed)} MB, array buffers ${MB(heap1.arrayBuffers - heap0.arrayBuffers)} MB`);
  return net;
}
const net = await sampled('cold'); // the game builds it once: mostly unoptimised code (every double result boxed)

// --- fingerprint
const parts = {};
const H = name => parts[name] || (parts[name] = createHash('sha256'));
const num = (name, ...v) => H(name).update(Buffer.from(new Float64Array(v).buffer));
const path = (name, p) => {
  num(name, p.n, p.length);
  for (let i = 0; i < p.n; i++) num(name, p.x(i), p.y(i), p.z(i), p.arc ? p.arc(i) : p.cum[i]); // (arc(): pooled paths)
};
const eIdx = new Map(net.edges.map((e, i) => [e, i]));
for (const n of net.nodes) {
  num('nodes', n.id, n.x, n.z, n.degree, n.maxHalfW, n.r, n.out.length, n.inc.length, n.edges.length, n.signal ? n.signal.t : -1, n.signal ? n.signal.cycle : -1);
  num('nodes', ...n.out.map(l => l.id), ...n.inc.map(l => l.id), ...n.edges.map(e => eIdx.get(e)));
}
for (const e of net.edges) num('edges', e.a, e.b, e.hw, e.minCls, e.c, e.v, e.lf, e.lb);
let conns = 0, pts = 0;
for (const l of net.lanes) {
  num('lanes', l.id, eIdx.get(l.edge), l.from, l.to, l.idx, l.nLanes, l.speed, l.cls, l.s0, l.s1, l.phase ?? -1, l.cars.length, l.next.length);
  path('lanePaths', l.path); pts += l.path.n;
  for (const c of l.next) { num('conns', c.lane.id, c.turn); path('connPaths', c.path); conns++; pts += c.path.n; }
}
for (const s of net.sidewalks) { num('sidewalks', eIdx.get(s.edge), s.side); path('sidePaths', s.path); pts += s.path.n; }
const swIdx = new Map(net.sidewalks.map((s, i) => [s, i]));
for (const [name, grid] of [['grid', net.grid], ['sideGrid', net.sideGrid]]) for (const [k, a] of grid) num(name, k, ...a.map(x => x.id ?? swIdx.get(x)));
const all = createHash('sha256'), out = {};
for (const k of Object.keys(parts).sort()) { const d = parts[k].digest('hex').slice(0, 12); out[k] = d; all.update(d); }
console.log(JSON.stringify({ hash: all.digest('hex').slice(0, 16), lanes: net.lanes.length, conns, sidewalks: net.sidewalks.length, points: pts, parts: out }));

// --- build time (median of N warm runs)
const ms = [];
for (let i = 0; i < runs; i++) { const c = city(); const t0 = performance.now(); new RoadNet(c); ms.push(performance.now() - t0); }
ms.sort((a, b) => a - b);
await sampled('warm');
console.log(`build ms: median ${ms[ms.length >> 1].toFixed(0)}  min ${ms[0].toFixed(0)}  (${runs} warm runs)`);
