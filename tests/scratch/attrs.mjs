// GPU vertex/index buffer bytes by (owner, attribute, array type)
import { launch } from '../mobile/lib.mjs';
const h = await launch('chromium', { exclusive: false });
await h.page.goto('http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8&t=11&keepgeo', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 240000 });
await h.page.waitForTimeout(3000);
const r = await h.page.evaluate(() => {
  const R = __game.R.renderer, seen = new Set(), rows = new Map();
  const owner = o => { const n = o.name || ''; if (/^(walls|roofs|struct|roads|foot)Near_/.test(n)) return n.replace(/_\d+$/, '_*'); if (/^city_/.test(n)) return n; for (let a = o; a; a = a.parent) if (a.name && a.name !== 'Scene') return a.name.replace(/_\d+$/, '_*').slice(0, 24); return o.type; };
  __game.scene.traverse(o => {
    const g = o.geometry; if (!g || !g.attributes) return;
    const add = (name, a, isIdx) => {
      const ar = a.array || a.data?.array; if (!ar || seen.has(ar)) return; seen.add(ar);
      const ok = R.properties ? true : true;
      const k = `${owner(o)}|${isIdx ? 'index' : name}|${ar.constructor.name.replace('Array', '')}x${a.itemSize || 1}`;
      rows.set(k, (rows.get(k) || 0) + (ar.byteLength || a.__gpuBytes || 0));
    };
    for (const [n, a] of Object.entries(g.attributes)) add(n, a);
    if (g.index) add('index', g.index, true);
  });
  return [...rows].sort((a, b) => b[1] - a[1]);
});
const tot = r.reduce((a, x) => a + x[1], 0);
console.log(`CPU-visible attribute arrays: ${(tot / 1048576).toFixed(1)} MB (released ones show 0 — see note)`);
for (const [k, b] of r.slice(0, 30)) console.log(`${(b / 1048576).toFixed(2).padStart(7)} MB  ${k}`);
await h.browser.close();
