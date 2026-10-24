import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&q=low', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
console.log(await page.evaluate(async () => {
  const { STREET } = await import('/src/gfx/materials.js');
  const t = STREET.wear.value, d = t.image.data, W = t.image.width, H = t.image.height;
  let g = 0, p = 0, gmax = 0, pmax = 0; for (let i = 0; i < W * H; i++) { if (d[i * 2]) g++; if (d[i * 2 + 1]) p++; gmax = Math.max(gmax, d[i * 2]); pmax = Math.max(pmax, d[i * 2 + 1]); }
  const o = STREET.wearOrigin.value, at = (x, z) => { const i = Math.floor((x - o.x) / 2), j = Math.floor((z - o.y) / 2); return [d[(j * W + i) * 2], d[(j * W + i) * 2 + 1]]; };
  const T = __game.city.trees; let near = null, bd = 1e9; for (let i = 0; i < T.length; i += 5) { const dd = Math.hypot(T[i] + 405, T[i + 1] - 405); if (dd < bd) { bd = dd; near = [T[i], T[i + 1]]; } }
  return JSON.stringify({ W, H, grimeTexels: g, polishTexels: p, gmax, pmax, tree: near, atTree: at(...near), mask: [__game.city.maskAt(...near, 1), __game.city.maskAt(...near, 2)], pave: !!STREET.pave.value });
}));
await browser.close();
