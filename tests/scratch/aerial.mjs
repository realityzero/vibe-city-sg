// Aerial shots around a point: node tests/scratch/aerial.mjs x z [h] [out]
import { chromium } from '../lib/browser.mjs';
const [x, z, h = 160, out = '/tmp/vc/aerial'] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&stats&fixedres&t=12', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.evaluate(() => { __game.ui.hud.setVisible(false); });
const shots = [['top', [+x, +h, +z + 1], [+x, 0, +z]], ['obl', [+x + h * 0.5, h * 0.6, +z + h * 0.7], [+x, 0, +z]], ['obl2', [+x - h * 0.6, h * 0.5, +z - h * 0.6], [+x, 0, +z]]];
for (const [n, c, l] of shots) {
  await page.evaluate(({ c, l, x, z }) => { const g = __game; const V = g.camera.position.constructor; g.timeScale = 0; g.player.teleport(new V(x, 0, z), 0); g.cameraRig.override = { position: new V(...c), lookAt: new V(...l), snap: true, fov: 60 }; }, { c, l, x: +x, z: +z });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}_${n}.png` });
}
await browser.close();
