import { launch } from '../mobile/lib.mjs';
const h = await launch('chromium', { exclusive: false });
await h.page.addInitScript(() => {
  const st = window.__attrStats = {};
  const W = window.Worker;
  window.Worker = class extends W { constructor(...a) { super(...a); this.addEventListener('message', e => {
    const walk = (o, d) => { if (!o || typeof o !== 'object' || d > 6 || ArrayBuffer.isView(o)) return; if (o.attributes) for (const [k, a] of Object.entries(o.attributes)) { if (!a?.array || !(a.array instanceof Float32Array)) continue; const kk = k + '@' + Object.keys(o.attributes).join('+'); const s = st[kk] || (st[kk] = { min: Infinity, max: -Infinity, n: 0, nonUnit: 0 }); const ar = a.array; for (let i = 0; i < ar.length; i++) { const v = ar[i]; if (v < s.min) s.min = v; if (v > s.max) s.max = v; if (k === 'color' && v > 1) s.over = (s.over || 0) + 1; } s.n += ar.length; if (k === 'normal') for (let i = 0; i < ar.length; i += 3) { const l = Math.hypot(ar[i], ar[i + 1], ar[i + 2]); if (Math.abs(l - 1) > 1e-3) s.nonUnit++; } } for (const v of Object.values(o)) walk(v, d + 1); };
    walk(e.data, 0);
  }); } };
});
await h.page.goto('http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 240000 });
console.log(JSON.stringify(await h.page.evaluate(() => window.__attrStats), null, 0).replace(/},/g, '},\n'));
await h.browser.close();
