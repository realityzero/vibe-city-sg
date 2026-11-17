// Memory of the city-builder Web Worker on its own: WebKit, a blank same-origin page that runs just the worker build,
// sampling the WebContent process footprint every 200 ms (a worker is a thread of the tab's process: iOS counts its
// memory against the tab). Prints the peak and a coarse timeline.
//   node tests/mobile/workermem.mjs [--pressure] [--chromium] [--url http://127.0.0.1:4173/]  (worker file from ./dist)
import { launch, pagePids, footprintMB } from './lib.mjs';
import fs from 'fs';
import { execFile } from 'child_process';
const worker = fs.readdirSync('dist/assets').find(f => /^cityBuilder\.worker-.*\.js$/.test(f));
const engine = process.argv.includes('--chromium') ? 'chromium' : 'webkit';
const URL0 = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://127.0.0.1:4173/';
const h = await launch(engine);
await h.page.goto(new URL('data/ground.png', URL0).href /* same origin, no game */, { waitUntil: 'load' }).catch(() => { });
const pids = await pagePids(h);
const base = await footprintMB(pids.content);
let pressure = process.argv.includes('--pressure');
if (pressure) (async () => { while (pressure) { execFile('notifyutil', ['-p', 'org.WebKit.lowMemory']); await new Promise(r => setTimeout(r, 1000)); } })();
const samples = []; let on = true;
(async () => { const t0 = Date.now(); while (on) { const c = await footprintMB(pids.content); samples.push([(Date.now() - t0) / 1000, c]); await new Promise(r => setTimeout(r, 200)); } })();
const r = await h.page.evaluate(async w => {
  const t0 = performance.now();
  const wk = new Worker('/assets/' + w, { type: 'module' });
  const msgs = [];
  const done = new Promise((res, rej) => { wk.onmessage = e => { const t = e.data?.type; msgs.push(t); if (t === 'done' || t === 'result' || t === 'error') res(e.data); }; wk.onerror = e => rej(e.message); });
  wk.postMessage({ type: 'build', cityUrl: new URL('/data/city.json', location.href).href, groundUrl: new URL('/data/ground.png', location.href).href, exclusions: [], chunkSize: 300 });
  const d = await done; const ms = performance.now() - t0; wk.terminate();
  return { ms, last: d.type, msgs: [...new Set(msgs)].join(',') };
}, worker);
await new Promise(r => setTimeout(r, 1500)); on = false; pressure = false;
const peak = Math.max(...samples.map(s => s[1]));
console.log(`worker build ${Math.round(r.ms)} ms (${r.msgs}); page before ${Math.round(base)} MB, peak ${Math.round(peak)} MB (+${Math.round(peak - base)})`);
console.log('timeline:', samples.filter((_, i) => i % 3 === 0).map(([t, c]) => `${t.toFixed(1)}s ${Math.round(c)}`).join(' | '));
await h.browser.close();
