// node tests/perf.mjs [query] [w] [h] [dpr] — drives around in free roam and reports frame times
import { chromium } from './lib/browser.mjs';
const [q = 'fixedres', w = '1440', h = '900', dpr = '2'] = process.argv.slice(2);
const browser = await chromium.launch({ exclusive: true, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&${q}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 90000 });
await page.waitForTimeout(2000);
// Claudia's autopilot drives a fixed cross-town route (Tanjong Pagar -> Marina Bay) so every run sees the same streets
await page.evaluate(() => { __game.debugTp(-60, 1000, 0); void __game.debugCar('infernus'); __game.autopilot.engage({ x: 900, z: 250 }); window.__ft = []; let last = performance.now(); const f = () => { const n = performance.now(); __ft.push(n - last); last = n; requestAnimationFrame(f); }; requestAnimationFrame(f); });
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => { const ft = __ft.splice(0); ft.sort((a, b) => a - b); const avg = ft.reduce((a, b) => a + b, 0) / ft.length; const inf = __game.R.renderer.info.render; return { fps: (1000 / avg).toFixed(1), p95: ft[Math.floor(ft.length * 0.95)]?.toFixed(1), calls: inf.calls, tris: (inf.triangles / 1e6).toFixed(2), scale: __game.R.dynScale.toFixed(2), px: __game.R.width + 'x' + __game.R.height, kmh: Math.round((__game.player.vehicle?.speed || 0) * 3.6) }; });
  console.log(JSON.stringify(r));
}
await browser.close();
