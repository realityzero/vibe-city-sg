import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&q=low', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
console.log(await page.evaluate(() => {
  const g = __game, V = g.camera.position.constructor, out = [];
  for (const [n, x, z] of [['hospital', -1585, 818], ['hospital again', -1585, 818], ['flower dome', 1745, 275], ['bayfront', 1336, 563], ['police', -1088, 860]]) {
    g.safe.memo.clear && n !== 'hospital again' && g.safe.memo.clear();
    const t0 = performance.now(); const d = g.relocate(new V(x, 0, z), 0); out.push(`${n}: ${(performance.now() - t0).toFixed(1)} ms -> ${d.x.toFixed(0)},${d.z.toFixed(0)}`);
  }
  return out.join('\n');
}));
await browser.close();
