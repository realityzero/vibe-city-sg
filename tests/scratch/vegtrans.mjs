// Near vs impostor comparison at the same spot: node tests/scratch/vegtrans.mjs out-prefix cam(x,y,z) look(x,y,z) fov t
import { chromium } from '../lib/browser.mjs';
const [out = '/tmp/vt', cam = '330,1.8,-330', look = '450,8,-450', fov = '25', t = '16.5'] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 400000 });
await page.evaluate(({ cam, look, fov, t }) => {
  const g = __game; const V = g.camera.position.constructor; const c = cam.split(',').map(Number), l = look.split(',').map(Number);
  g.ui.hud.setVisible(false); g.sky.time = +t; g.timeScale = 0; g.weather.force(0);
  g.player.teleport(new V(c[0], 0, c[2]), 0); g.player.root.visible = false;
  g.cameraRig.override = { position: new V(...c), lookAt: new V(...l), snap: true, fov: +fov };
}, { cam, look, fov, t });
await page.waitForTimeout(2500);
for (const [name, a, b] of [['mixed', null, null], ['near', 5000, 5001], ['imp', 0, 0.01]]) {
  await page.evaluate(([a, b]) => { const u = __game.veg.uFade.value; if (a === null) __game.veg.nearDist = __game.veg.nearDist; else u.set(a, b); __game.veg.lastPos.set(1e9, 0, 0); }, [a, b]);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}_${name}.png` });
}
await browser.close();
