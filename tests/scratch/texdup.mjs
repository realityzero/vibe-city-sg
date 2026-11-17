// textures with identical pixels (procedural duplicates): hash every texture source (needs ?keepsrc)
import { launch } from '../mobile/lib.mjs';
const h = await launch('chromium', { exclusive: false });
await h.page.goto('http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8&t=11&keepsrc', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 240000 });
await h.page.waitForTimeout(3000);
console.log(await h.page.evaluate(() => {
  const texs = new Map();
  const owner = o => { const n = []; for (let a = o; a && n.length < 3; a = a.parent) if (a.name) n.push(a.name); return n.join('<') || o.type; };
  __game.scene.traverse(o => { for (const m of [].concat(o.material || [])) for (const k in m) { const t = m[k]; if (t && t.isTexture && !t.isRenderTargetTexture) { const e = texs.get(t) || texs.set(t, { owners: new Set(), key: k, mat: m.name || m.type }).get(t); e.owners.add(owner(o)); } } });
  const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
  const hash = img => { const w = img.width, hh = img.height; if (!w || !hh) return 'nosrc'; let d; if (img.data) d = img.data; else { cv.width = w; cv.height = hh; cx.clearRect(0, 0, w, hh); cx.drawImage(img, 0, 0); d = cx.getImageData(0, 0, w, hh).data; } let x = 2166136261; const step = Math.max(1, Math.floor(d.length / 200000)); for (let i = 0; i < d.length; i += step) { x ^= d[i]; x = Math.imul(x, 16777619); } return `${w}x${hh}:${(x >>> 0).toString(16)}`; };
  const groups = new Map();
  for (const [t, e] of texs) { const img = t.image; if (!img || (img.width || 0) * (img.height || 0) < 256 * 256) continue; let k; try { k = hash(img); } catch (err) { k = 'err'; } const g = groups.get(k) || groups.set(k, []).get(k); g.push(`${e.mat}.${e.key} on ${[...e.owners].slice(0, 2).join(' | ')}`); }
  return [...groups].filter(([, l]) => l.length > 1).map(([k, l]) => `${l.length}x ${k}\n   ` + l.slice(0, 4).join('\n   ')).join('\n') || 'no duplicates';
}));
await h.browser.close();
