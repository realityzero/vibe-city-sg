// impostor debug captures at one view: node tests/scratch/vegdbg.mjs out cam look fov t
import { chromium } from '../lib/browser.mjs';
const [out = '/tmp/vd', cam = '-250,260,-720', look = '-278,0,-829', fov = '62', t = '13'] = process.argv.slice(2);
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
const modes = (process.env.MODES || 'all,noside,notop,noshadow').split(',');
for (const m of modes) {
  await page.evaluate(m => { const v = __game.veg; v.impDbg.value.set(m === 'noside' ? 1 : 0, m === 'notop' ? 1 : 0); v.impostors.receiveShadow = m !== 'noshadow'; v.meshes.forEach(im => im.visible = m !== 'nonear'); }, m);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}_${m}.png` });
}
await browser.close();
