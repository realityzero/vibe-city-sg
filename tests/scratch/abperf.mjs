// A/B frame-time comparison of two servers (A = baseline copy, B = working tree) in one browser, alternating
// measurement windows so background GPU contention hits both equally. node tests/scratch/abperf.mjs [portA] [portB]
import { chromium } from '../lib/browser.mjs';
const [pa = '5175', pb = '5174'] = process.argv.slice(2);
const VIEWS = {
  chinatown_day: { t: 11, cam: [-383.6, 2.0, 328.3], look: [-394, 6.0, 344] },
  street_noon: { t: 11.5, cam: [-405, 1.9, 416], look: [-392, 3, 360] },
  cbd_aerial: { t: 14.5, cam: [700, 260, 900], look: [150, 60, 300] },
  cbd_night: { t: 22.0, cam: [900, 160, 700], look: [150, 80, 300] },
  hdb_estate: { t: 16.5, cam: [-780, 45, 1150], look: [-690, 35, 1250] },
  cbd_street: { t: 16.5, cam: [60, 1.8, 330], look: [140, 60, 260] },
};
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const mk = async port => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`[${port} pageerror]`, e.message));
  await page.goto(`http://127.0.0.1:${port}/?skipTitle&newgame&freeroam=1&fixedres`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 180000 });
  const info = await page.evaluate(() => ({ stats: __game.city.stats }));
  await page.evaluate(() => { __game.mgPaused = true; });
  return { page, port, info };
};
const A = await mk(pa); const B = await mk(pb);
console.log('A', JSON.stringify(A.info.stats)); console.log('B', JSON.stringify(B.info.stats));
const setView = (p, v) => p.evaluate(v => {
  const g = __game; const V = g.camera.position.constructor;
  g.sky.time = v.t; g.timeScale = 0; g.weather.force(0);
  g.player.teleport(new V(v.cam[0], 0, v.cam[2]), 0);
  g.cameraRig.override = { position: new V(...v.cam), lookAt: new V(...v.look), snap: true, fov: 60 };
  g.sky.refreshEnv();
}, v);
const measure = async (p, ms) => p.evaluate(ms => new Promise(res => {
  __game.mgPaused = false;
  const ft = []; let last = performance.now(), t0 = last;
  const f = () => { const n = performance.now(); ft.push(n - last); last = n; if (n - t0 < ms) requestAnimationFrame(f); else { __game.mgPaused = true; ft.splice(0, 20); ft.sort((a, b) => a - b); res({ med: ft[Math.floor(ft.length / 2)], p95: ft[Math.floor(ft.length * 0.95)], calls: __game.R.renderer.info.render.calls, tris: __game.R.renderer.info.render.triangles }); } };
  requestAnimationFrame(f);
}), ms);
for (const [name, v] of Object.entries(VIEWS)) {
  await setView(A.page, v); await setView(B.page, v);
  const ra = [], rb = [];
  for (let k = 0; k < 2; k++) { ra.push(await measure(A.page, 3500)); rb.push(await measure(B.page, 3500)); }
  const md = r => (r.map(x => x.med).sort((a, b) => a - b)[0]).toFixed(1), p9 = r => Math.min(...r.map(x => x.p95)).toFixed(1);
  console.log(`${name.padEnd(14)} A med ${md(ra)}ms p95 ${p9(ra)} calls ${ra[0].calls} tris ${(ra[0].tris / 1e6).toFixed(2)}M | B med ${md(rb)}ms p95 ${p9(rb)} calls ${rb[0].calls} tris ${(rb[0].tris / 1e6).toFixed(2)}M`);
}
await browser.close();
