import { launch } from '../mobile/lib.mjs';
const h = await launch('chromium', { exclusive: false });
await h.page.addInitScript(() => {
  const C = window.__canvases = []; const ce = document.createElement.bind(document);
  document.createElement = (t, o) => { const e = ce(t, o); if (String(t).toLowerCase() === 'canvas') C.push([new WeakRef(e), new Error().stack.split('\n').slice(2, 4).map(l => l.trim().replace(/https?:\/\/[^/]+\//, '').replace(/\?v=\w+/, '')).join(' < ')]); return e; };
  if (window.OffscreenCanvas) { const O = window.OffscreenCanvas; window.OffscreenCanvas = class extends O { constructor(w, h) { super(w, h); C.push([new WeakRef(this), new Error().stack.split('\n').slice(2, 4).map(l => l.trim().replace(/https?:\/\/[^/]+\//, '')).join(' < ')]); } }; }
});
await h.page.goto('http://127.0.0.1:5174/?t=11', { waitUntil: 'load' });
await h.page.waitForTimeout(2000); await h.page.touchscreen.tap(422, 195);
await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 240000 });
await h.page.locator('.vc-title .vc-menu button').first().tap();
await h.page.waitForFunction(() => __game.state === 'play', null, { timeout: 60000 });
await h.page.waitForTimeout(4000);
const r = await h.page.evaluate(() => window.__canvases.map(([w, s]) => { const c = w.deref(); return c && c.width * c.height ? [c.width * c.height * 4, `${c.width}x${c.height}`, c.isConnected ? 'DOM' : '', s] : null; }).filter(Boolean).sort((a, b) => b[0] - a[0]));
console.log(`live canvases: ${r.length}, ${(r.reduce((a, c) => a + c[0], 0) / 1048576).toFixed(1)} MB`);
for (const c of r.slice(0, 15)) console.log(`${(c[0] / 1048576).toFixed(1).padStart(6)} MB ${c[1].padEnd(10)} ${c[2].padEnd(4)} ${c[3].slice(0, 120)}`);
await h.browser.close();
