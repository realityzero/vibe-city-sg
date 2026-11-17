// Fingerprint of everything the city-builder worker emits (every chunk's attributes and indices, physics, trees,
// building info, facade records) so worker refactors can be shown to produce bit-identical output.
//   node tests/mobile/workerhash.mjs      (dev test server, port 5174)
import { launch } from './lib.mjs';
const h = await launch('chromium', { exclusive: false });
await h.page.goto('http://127.0.0.1:5174/data/ground.png', { waitUntil: 'load' }).catch(() => { });
const r = await h.page.evaluate(async () => {
  const wk = new Worker('/src/world/worker/cityBuilder.worker.js', { type: 'module' });
  const d = await new Promise(res => { wk.onmessage = e => { if (e.data?.type === 'done' || e.data?.type === 'error') res(e.data); }; wk.postMessage({ type: 'build', cityUrl: new URL('/data/city.json', location.href).href, groundUrl: new URL('/data/ground.png', location.href).href, exclusions: [], chunkSize: 300 }); });
  wk.terminate();
  if (d.type === 'error') return { err: d.message };
  let hsh = 0x811c9dc5, bytes = 0;
  const eat = ta => { const u = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength); bytes += u.length; for (let i = 0; i < u.length; i++) { hsh ^= u[i]; hsh = Math.imul(hsh, 16777619); } hsh ^= u.length; hsh = Math.imul(hsh, 16777619); };
  const parts = {};
  for (const c of d.chunks) {
    for (const name of ['walls', 'roofs', 'roads', 'foot', 'struct', 'wallsNear', 'structNear']) { const g = c[name]; if (!g) continue; for (const k of Object.keys(g.attributes).sort()) { eat(g.attributes[k].array); parts[name + '.' + k] = (parts[name + '.' + k] || 0) + g.attributes[k].array.length; } eat(g.index); }
    if (c.phys) { eat(c.phys.vertices); eat(c.phys.indices); }
  }
  eat(d.trees); eat(d.buildingInfo); eat(d.facadeRecords);
  return { hash: (hsh >>> 0).toString(16), mb: (bytes / 1048576).toFixed(1), chunks: d.chunks.length, recs: d.facadeRecords.length / 8, ms: d.stats.ms };
});
console.log(JSON.stringify(r));
await h.browser.close();
