import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 90000 });
await page.waitForTimeout(3000);
const r = await page.evaluate(async () => {
  const g = __game, gl = g.R.renderer.getContext(), out = {};
  const time = async (name, fn, n = 10) => {
    const ts = [];
    for (let i = 0; i < n; i++) { await new Promise(requestAnimationFrame); gl.finish(); const t = performance.now(); fn(i); gl.finish(); ts.push(performance.now() - t); }
    ts.sort((a, b) => a - b); out[name] = ts[Math.floor(n / 2)].toFixed(2) + ' ms (median, incl. gl.finish)';
  };
  await time('refreshEnv', i => { g.sky.time = 12 + i * 0.2; g.sky.refreshEnv(); });
  await time('reflection', () => g.water.renderReflection(g.R.renderer, g.scene, g.camera));
  await time('composer', () => g.R.render(1 / 60));
  await time('fullTick', () => g.tick(1 / 60));
  return out;
});
console.log(r);
await browser.close();
