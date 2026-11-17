// hash of every mesh whose name matches a pattern (attributes + index), ?keepgeo so arrays survive upload
import { launch } from '../mobile/lib.mjs';
const pat = process.argv[2] || '^kerbs_';
const h = await launch('chromium', { exclusive: false });
await h.page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&keepgeo', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 300000 });
console.log(await h.page.evaluate(pat => {
  const re = new RegExp(pat); let hsh = 0x811c9dc5, n = 0, bytes = 0;
  const eat = ta => { const u = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength); bytes += u.length; for (let i = 0; i < u.length; i++) { hsh ^= u[i]; hsh = Math.imul(hsh, 16777619); } };
  __game.scene.traverse(o => { if (!re.test(o.name) || !o.geometry) return; n++; const g = o.geometry; for (const k of Object.keys(g.attributes).sort()) { const a = g.attributes[k]; if (a.array) { eat(a.array); hsh ^= a.itemSize * 31 + (a.normalized ? 7 : 0); } } if (g.index?.array) eat(g.index.array); });
  return `${n} meshes, ${(bytes / 1048576).toFixed(2)} MB, hash ${(hsh >>> 0).toString(16)}`;
}, pat));
await h.browser.close();
