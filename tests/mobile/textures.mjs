// Every texture the game holds once loaded: size, format, source kind, where it is referenced from, and its GPU
// bytes (with mips). Chromium, phone profile.   node tests/mobile/textures.mjs [url]
import { launch } from './lib.mjs';
const url = process.argv[2] || 'http://127.0.0.1:4173/?skipTitle&newgame&t=11';
const h = await launch('chromium', { exclusive: false });
await h.page.goto(url, { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 240000 });
await h.page.waitForTimeout(2000);
const rows = await h.page.evaluate(() => {
  const g = __game, R = g.R.renderer, seen = new Map(), visited = new WeakSet();
  const q = [[g, 'game']]; let head = 0, n = 0;
  while (head < q.length && n < 4e6) {
    const [v, path] = q[head++]; n++;
    if (!v || typeof v !== 'object' || visited.has(v)) continue; visited.add(v);
    if (v.isTexture) { if (!seen.has(v)) seen.set(v, path); continue; }
    if (v instanceof Node || ArrayBuffer.isView(v) || v instanceof ArrayBuffer || v instanceof WebGL2RenderingContext) continue;
    if (v instanceof Map) { for (const [a, b] of v) q.push([b, path + '.<map>']); continue; }
    if (v instanceof Set) { for (const a of v) q.push([a, path + '.<set>']); continue; }
    const keys = Array.isArray(v) ? v.keys() : Object.keys(v);
    for (const k of keys) { let c; try { c = v[k]; } catch { continue; } if (c && typeof c === 'object') q.push([c, path.length < 70 ? path + (Array.isArray(v) ? '[]' : '.' + k) : path]); }
  }
  const out = [];
  for (const [t, path] of seen) {
    const im = t.image || t.source?.data; const w = im?.width || (Array.isArray(im) ? im[0]?.width : 0) || 0, hh = im?.height || (Array.isArray(im) ? im[0]?.height : 0) || 0, d = im?.depth || 1;
    const kind = t.isRenderTargetTexture ? 'RT' : t.isDataTexture || t.isData3DTexture || t.isDataArrayTexture ? 'data' : t.isCompressedTexture ? 'compressed' : im instanceof HTMLCanvasElement ? 'canvas' : (typeof ImageBitmap !== 'undefined' && im instanceof ImageBitmap) ? 'bitmap' : im instanceof HTMLImageElement ? 'img' : t.isCubeTexture ? 'cube' : '?';
    const bpp = t.type === 1016 ? 8 : t.type === 1015 ? 16 : (t.format === 1028 || t.format === 1025) ? 1 : t.format === 1030 ? 2 : 4; // half, float, red, rg
    const mips = t.generateMipmaps && t.minFilter !== 1006 && t.minFilter !== 1003 ? 1.33 : 1;
    const up = !!R.properties.get(t).__webglTexture;
    out.push({ mb: w * hh * d * bpp * mips * (t.isCubeTexture ? 6 : 1) / 1048576, dims: `${w}x${hh}${d > 1 ? 'x' + d : ''}`, kind, name: t.name || '', path, up, mips: mips > 1, type: t.type, fmt: t.format });
  }
  return out.sort((a, b) => b.mb - a.mb);
});
let tot = 0, totUp = 0; for (const r of rows) { tot += r.mb; if (r.up) totUp += r.mb; }
console.log(`${rows.length} textures, ${tot.toFixed(0)} MB (${totUp.toFixed(0)} MB uploaded)`);
for (const r of rows.slice(0, 45)) console.log(`${r.mb.toFixed(1).padStart(6)} MB ${r.up ? 'GPU' : '   '} ${r.dims.padEnd(12)} ${r.kind.padEnd(7)} ${r.mips ? 'mips' : '    '} ${(r.name || '').padEnd(14).slice(0, 14)} ${r.path.slice(0, 95)}`);
await h.browser.close();
