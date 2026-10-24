// Measures frame-time p95 at a fixed spot with features toggled one at a time.
import { chromium } from './lib/browser.mjs';
const browser = await chromium.launch({ exclusive: true, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 90000 });
await page.evaluate(() => { __game.debugTp(-127, 1263, 0); __game.sky.time = 18.3; __game.timeScale = 0; window.__ft = []; let last = performance.now(); const f = () => { const n = performance.now(); __ft.push(n - last); last = n; requestAnimationFrame(f); }; requestAnimationFrame(f); });
await page.waitForTimeout(4000);
const measure = async label => { await page.evaluate(() => { __ft.length = 0; }); await page.waitForTimeout(4000); const r = await page.evaluate(() => { const ft = __ft.slice().sort((a, b) => a - b); const avg = ft.reduce((a, b) => a + b, 0) / ft.length; return { fps: (1000 / avg).toFixed(1), p95: ft[Math.floor(ft.length * 0.95)].toFixed(1), max: ft[ft.length - 1].toFixed(0) }; }); console.log(label.padEnd(22), JSON.stringify(r)); };
await measure('baseline');
await page.evaluate(() => { __game.R.autoExposure.enabled = false; }); await measure('- autoexposure');
await page.evaluate(() => { __game.R.ao.enabled = false; }); await measure('- ao');
await page.evaluate(() => { __game.R.updateSun = () => {}; __game.R.godPass.enabled = false; __game.R.sunMesh.visible = false; }); await measure('- godrays');
await page.evaluate(() => { __game.water.setReflections(false); }); await measure('- reflections');
await page.evaluate(() => { __game.R.renderer.shadowMap.enabled = false; }); await measure('- shadows');
await page.evaluate(() => { __game.peds.crowd.mesh.visible = false; __game.traffic.enabled = false; }); await measure('- peds/traffic');
await browser.close();
