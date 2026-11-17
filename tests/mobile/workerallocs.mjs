// Allocation profile of the city build: runs the worker module on a page's main thread (shimmed postMessage) in
// Chromium so the sampling heap profiler sees it: bytes allocated per function (garbage included), the JS heap
// over time, and a heap snapshot at the "Uploading city" stage (what is live at the peak), grouped by constructor.
//   node tests/mobile/workerallocs.mjs [--dev]
import { launch } from './lib.mjs';
import fs from 'fs';
const DEV = process.argv.includes('--dev'); // unminified names: the dev test server (vite --config vite.test.config.js, port 5174)
const ORIGIN = DEV ? 'http://127.0.0.1:5174' : 'http://127.0.0.1:4173';
const worker = DEV ? '/src/world/worker/cityBuilder.worker.js' : '/assets/' + fs.readdirSync('dist/assets').find(f => /^cityBuilder\.worker-.*\.js$/.test(f));
const h = await launch('chromium', { exclusive: false });
const cdp = await h.ctx.newCDPSession(h.page);
await h.page.goto(ORIGIN + '/data/ground.png' /* same origin, no game (unknown paths serve index.html) */, { waitUntil: 'load' }).catch(() => { });
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32768, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
const heap = []; let on = true;
(async () => { while (on) { const u = await cdp.send('Runtime.getHeapUsage'); heap.push(Math.round((u.usedSize + (u.backingStorageSize || 0)) / 1048576)); await new Promise(r => setTimeout(r, 100)); } })();
const snapAt = process.argv.includes('--snap');
await h.page.exposeFunction('__vcStage', async label => { if (snapAt && /Uploading/.test(label)) { /* snapshot taken from node after the build pauses */ } });
const res = await h.page.evaluate(async w => {
  const out = {};
  window.postMessage = m => { if (m?.type === 'progress') { out.stages = (out.stages || 0) + 1; } if (m?.type === 'done' || m?.type === 'error') out.done = m.type; };
  await import(w);
  const t0 = performance.now();
  await window.onmessage({ data: { type: 'build', cityUrl: new URL('/data/city.json', location.href).href, groundUrl: new URL('/data/ground.png', location.href).href, exclusions: [], chunkSize: 300 } });
  out.ms = Math.round(performance.now() - t0);
  return out;
}, worker);
on = false;
const prof = (await cdp.send('HeapProfiler.stopSampling')).profile;
const by = new Map();
const walk = n => { const f = n.callFrame, name = `${f.functionName || '(anon)'}:${f.lineNumber + 1}`; if (n.selfSize) by.set(name, (by.get(name) || 0) + n.selfSize); for (const c of n.children) walk(c); };
walk(prof.head);
const tot = [...by.values()].reduce((a, b) => a + b, 0);
console.log(`build ${res.ms} ms (${res.done}); allocated ${(tot / 1048576).toFixed(0)} MB total (sampled, garbage included); JS heap + backing peak ${Math.max(...heap)} MB`);
console.log('heap timeline (MB, 100 ms):', heap.filter((_, i) => i % 3 === 0).join(' '));
for (const [k, b] of [...by].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(`${(b / 1048576).toFixed(0).padStart(6)} MB  ${k}`);
await h.browser.close();
