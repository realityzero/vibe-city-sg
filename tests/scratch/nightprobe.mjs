// night road brightness probe: zebra_night view with toggles
import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres' + (process.env.CAMH ? '&camh=' + process.env.CAMH : ''), { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.evaluate(async () => { window.__STREET = (await import('/src/gfx/materials.js')).STREET; });
await page.evaluate(() => { const g = __game; g.ui.hud.setVisible(false); const V = g.camera.position.constructor; const c = g.streetDetail.crossings.filter(c => !c.signal)[0]; const rx = -c.dir.z, rz = c.dir.x;
  const H = +(new URLSearchParams(location.search).get('camh') || 1.6); const cam = [c.mx - c.dir.x * 22 * Math.max(1, H / 6) + rx * (c.edge.hw + 1.5), H, c.mz - c.dir.z * 22 * Math.max(1, H / 6) + rz * (c.edge.hw + 1.5)];
  g.sky.time = 21; g.timeScale = 0; g.weather.force(0); g.U.wet.value = 0;
  g.player.teleport(new V(cam[0], 0, cam[2]), 0); g.player.root.visible = false;
  g.cameraRig.override = { position: new V(...cam), lookAt: new V(c.mx, 0.5, c.mz), snap: true, fov: 60 }; });
const G = (process.env.GLOWS || '0.6,1,1.6,2.4').split(',');
const toggles = Object.fromEntries(G.map(v => ['g' + v, `window.__STREET.glow.value = ${v};`]));
for (const [n, js] of Object.entries(toggles)) {
  await page.evaluate(`(() => { const g = __game; ${js} })()`);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `/tmp/str_probe_${n}.png` });
  console.log(n, await page.evaluate(() => { const g = __game; return JSON.stringify({ wet: g.U.wet.value, night: g.U.night.value.toFixed(2), exp: g.sky.exposure?.toFixed(2), refl: g.water.reflections, ae: g.R.autoExposure?.maxE, aev: g.R.autoExposure?.value ?? g.R.autoExposure?.exposure }); }));
}
await browser.close();
