// GPU vertex/index buffer bytes by owner and attribute (count x itemSize x bytes per element; released attributes
// remember their element size in bytesPerElement). Shared attributes
// are counted once. Compare the total with the in-page WebGL accounting ("GPU buffers" in tests/mobile/iphone.mjs).
//   node tests/mobile/gpubuffers.mjs [url] [--by attr|owner]
import { launch, GPU_ACCOUNTING } from './lib.mjs';
const url = process.argv.find(a => a.startsWith('http')) || 'http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8&t=11';
const h = await launch('chromium', { exclusive: false });
await h.page.addInitScript(GPU_ACCOUNTING);
await h.page.goto(url, { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 240000 });
await h.page.waitForTimeout(3000);
const r = await h.page.evaluate(() => {
  const seen = new Set(), rows = new Map(), byAttr = new Map();
  const owner = o => { for (let a = o; a; a = a.parent) if (a.name && a.name !== 'Scene') return a.name.replace(/_\d+$/, '_*').replace(/^(vehicle|humanoid):.*/, '$1').slice(0, 26); return o.type; };
  __game.scene.traverse(o => {
    const g = o.geometry; if (!g || !g.attributes) return;
    const add = (name, a) => {
      const key = a.isInterleavedBufferAttribute ? a.data : a; if (seen.has(key)) return; seen.add(key);
      const src = a.isInterleavedBufferAttribute ? a.data : a, ar = src.array;
      const bpe = ar?.BYTES_PER_ELEMENT || src.bytesPerElement || 4, b = (a.isInterleavedBufferAttribute ? src.count * src.stride : src.count * src.itemSize) * bpe;
      const k = `${owner(o)}`; rows.set(k, (rows.get(k) || 0) + b);
      const t = `${name}:${ar ? ar.constructor.name.replace('Array', '') : 'released'}x${src.itemSize || src.stride}`; byAttr.set(t, (byAttr.get(t) || 0) + b);
    };
    for (const [n, a] of Object.entries(g.attributes)) add(n, a);
    if (g.index) add('index', g.index);
  });
  return { owners: [...rows].sort((a, b) => b[1] - a[1]), attrs: [...byAttr].sort((a, b) => b[1] - a[1]), webgl: window.__mem ? window.__mem.buf : null };
});
const tot = r.owners.reduce((a, x) => a + x[1], 0);
console.log(`geometry: ${(tot / 1048576).toFixed(1)} MB   (WebGL bufferData accounting: ${r.webgl != null ? (r.webgl / 1048576).toFixed(1) + ' MB' : 'n/a'})`);
console.log('by attribute:'); for (const [k, b] of r.attrs.slice(0, 16)) console.log(`  ${(b / 1048576).toFixed(1).padStart(6)} MB  ${k}`);
console.log('by owner:'); for (const [k, b] of r.owners.slice(0, 22)) console.log(`  ${(b / 1048576).toFixed(1).padStart(6)} MB  ${k}`);
await h.browser.close();
