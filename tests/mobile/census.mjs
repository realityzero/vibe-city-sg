// Memory census: walks everything reachable from window.__game (breadth first, so each object is charged to the
// shortest path that reaches it) and attributes typed-array bytes (deduplicated per ArrayBuffer), object counts
// and string bytes to owners two levels deep (e.g. `city.data`, `roadnet.lanes`). Also lists live 2D canvases
// (their backing stores are native memory) and the biggest single buffers.
//   node tests/mobile/census.mjs [url]      (Chromium, phone profile; world loaded behind the title)
import { launch } from './lib.mjs';
const url = process.argv[2] || 'http://127.0.0.1:4173/?t=11';
const h = await launch('chromium', { exclusive: false });
const { page } = h;
await page.addInitScript(() => {
  // remember every canvas ever created (texture generators make and drop them)
  const C = window.__canvases = []; const ce = document.createElement.bind(document);
  document.createElement = (t, o) => { const e = ce(t, o); if (String(t).toLowerCase() === 'canvas') C.push(new WeakRef(e)); return e; };
  if (window.OffscreenCanvas) { const O = window.OffscreenCanvas; window.OffscreenCanvas = class extends O { constructor(w, h) { super(w, h); C.push(new WeakRef(this)); } }; }
});
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(2000);
await page.touchscreen.tap(422, 195);
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 240000 });
await page.waitForTimeout(3000);
const r = await page.evaluate(() => {
  const g = window.__game, seen = new WeakSet(), bufSeen = new WeakSet();
  const own = new Map(); const big = [];
  const charge = (k, f, n) => { const o = own.get(k) || own.set(k, { bytes: 0, objs: 0, str: 0 }).get(k); o[f] += n; };
  // queue of [value, owner, path-for-big-buffers]; owner is the first two keys from __game
  const q = [];
  for (const k of Object.keys(g)) q.push(g[k], k, k);
  seen.add(g);
  let n = 0, head = 0;
  while (head < q.length && n < 8e6) {
    const v = q[head], owner = q[head + 1], path = q[head + 2]; head += 3; n++;
    if (head > 3e6) { q.splice(0, head); head = 0; }
    if (v == null) continue;
    const t = typeof v;
    if (t === 'string') { if (v.length > 64) charge(owner, 'str', v.length); continue; }
    if (t !== 'object' && t !== 'function') continue;
    if (seen.has(v)) continue; seen.add(v);
    if (v instanceof Node || v === window) { if (v instanceof HTMLCanvasElement || v instanceof HTMLImageElement) charge(owner, 'objs', 1); continue; }
    if (ArrayBuffer.isView(v)) { const b = v.buffer; if (!bufSeen.has(b)) { bufSeen.add(b); charge(owner, 'bytes', b.byteLength); if (b.byteLength > 2e6) big.push([b.byteLength, path, v.constructor.name]); } continue; }
    if (v instanceof ArrayBuffer) { if (!bufSeen.has(v)) { bufSeen.add(v); charge(owner, 'bytes', v.byteLength); if (v.byteLength > 2e6) big.push([v.byteLength, path, 'ArrayBuffer']); } continue; }
    if (v instanceof WebGLRenderingContext || v instanceof WebGL2RenderingContext || v instanceof WebAssembly.Memory) continue;
    charge(owner, 'objs', 1);
    const own2 = k => owner.includes('.') ? owner : owner + '.' + k;
    const sub = k => path.length < 90 ? path + '.' + k : path;
    if (v instanceof Map) { for (const [a, b] of v) { q.push(a, own2('<map>'), sub('<k>')); q.push(b, own2('<map>'), sub('<v>')); } continue; }
    if (v instanceof Set) { for (const a of v) q.push(a, own2('<set>'), sub('<e>')); continue; }
    if (Array.isArray(v)) { const o = own2('[]'), p2 = sub('[]'); for (let i = 0; i < v.length; i++) q.push(v[i], o, p2); continue; }
    let keys; try { keys = Object.keys(v); } catch { continue; }
    for (const k of keys) { let c; try { c = v[k]; } catch { continue; } q.push(c, own2(k), sub(k)); }
  }
  const rows = [...own].sort((a, b) => (b[1].bytes + b[1].objs * 60 + b[1].str) - (a[1].bytes + a[1].objs * 60 + a[1].str));
  const canv = window.__canvases.map(w => w.deref()).filter(Boolean).map(c => [c.width * c.height * 4, `${c.width}x${c.height}`]).filter(c => c[0] > 0).sort((a, b) => b[0] - a[0]);
  return { visited: n, rows: rows.slice(0, 45), big: big.sort((a, b) => b[0] - a[0]).slice(0, 25), canvases: { count: canv.length, bytes: canv.reduce((a, c) => a + c[0], 0), top: canv.slice(0, 12).map(c => c[1]) }, heap: performance.memory.usedJSHeapSize };
});
const MB = n => (n / 1048576).toFixed(1).padStart(7);
console.log(`visited ${r.visited} values; JS heap ${MB(r.heap)} MB`);
console.log('owner                                   typed MB   objects    string MB');
for (const [k, o] of r.rows) console.log(`${k.padEnd(40)}${MB(o.bytes)}  ${String(o.objs).padStart(8)}  ${MB(o.str)}`);
console.log('\nbiggest buffers:'); for (const [b, p, t] of r.big) console.log(`${MB(b)} MB  ${t.padEnd(14)} ${p.slice(0, 110)}`);
console.log(`\nlive 2D canvases: ${r.canvases.count}, ${MB(r.canvases.bytes)} MB of pixels; biggest ${r.canvases.top.join(' ')}`);
await h.browser.close();
