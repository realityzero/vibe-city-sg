import { launch } from '../mobile/lib.mjs';
const h = await launch('chromium', { exclusive: false });
const cdp = await h.ctx.newCDPSession(h.page);
await h.page.goto(process.argv[2] || 'http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8&t=11', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
await h.page.waitForTimeout(8000);
for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage');
const u = await cdp.send('Runtime.getHeapUsage');
const m = await h.page.evaluate(() => ({ used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize }));
console.log(`after GC: JS heap used ${(u.usedSize / 1048576).toFixed(1)} MB (total ${(u.totalSize / 1048576).toFixed(1)}); embedder/external ${((u.embedderHeapUsedSize || 0) / 1048576).toFixed(1)} MB backing stores ${((u.backingStorageSize || 0) / 1048576).toFixed(1)} MB; performance.memory used ${(m.used / 1048576).toFixed(1)}`);
if (process.argv.includes('--snap')) {
  // aggregate a heap snapshot by constructor (self size)
  const chunks = []; cdp.on('HeapProfiler.addHeapSnapshotChunk', e => chunks.push(e.chunk));
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  const snap = JSON.parse(chunks.join('')), f = snap.snapshot.meta.node_fields, nf = f.length, types = snap.snapshot.meta.node_types[0], N = snap.nodes, S = snap.strings;
  const iT = f.indexOf('type'), iN = f.indexOf('name'), iS = f.indexOf('self_size'), agg = new Map();
  for (let i = 0; i < N.length; i += nf) { const t = types[N[i + iT]], name = t === 'object' || t === 'closure' || t === 'native' ? S[N[i + iN]].slice(0, 50) : `(${t})`; const e = agg.get(name) || agg.set(name, [0, 0]).get(name); e[0] += N[i + iS]; e[1]++; }
  for (const [k, [b, n]] of [...agg].sort((a, b) => b[1][0] - a[1][0]).slice(0, 30)) console.log(`${(b / 1048576).toFixed(1).padStart(7)} MB ${String(n).padStart(8)}  ${k}`);
}
await h.browser.close();
