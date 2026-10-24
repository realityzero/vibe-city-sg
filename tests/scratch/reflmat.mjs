// A/B of the cheap reflection facade material in the water reflection: node tests/scratch/reflmat.mjs [prefix]
import { chromium } from '../lib/browser.mjs';
const [prefix = '/tmp/reflmat'] = process.argv.slice(2);
const VIEWS = { bay_sunset: { t: 18.25, cam: [560, 24, 60], look: [1300, 90, 380] }, bay_night: { t: 21.0, cam: [560, 24, 60], look: [1300, 90, 380] }, river: { t: 15, cam: [-200, 6, 380], look: [100, 20, 250] } };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 400)); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&fixedres', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.evaluate(() => {
  const g = __game; g.ui.hud.setVisible(false);
  const orig = g.water.renderReflection.bind(g.water);
  window.__refl = false;
  g.water.renderReflection = (...a) => { if (__refl) g.city.setReflectionMaterials(true); try { orig(...a); } finally { g.city.setReflectionMaterials(false); } };
});
for (const [name, v] of Object.entries(VIEWS)) for (const on of [false, true]) {
  await page.evaluate(({ v, on }) => { const g = __game; const V = g.camera.position.constructor; window.__refl = on; g.sky.time = v.t; g.timeScale = 0; g.player.teleport(new V(v.cam[0], 0, v.cam[2]), 0); g.player.root.visible = false; g.cameraRig.override = { position: new V(...v.cam), lookAt: new V(...v.look), snap: true, fov: 55 }; g.sky.refreshEnv(); }, { v, on });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${prefix}_${name}_${on ? 'cheap' : 'full'}.png` });
}
await browser.close();
console.log('done');
