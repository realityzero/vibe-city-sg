// 360° sweeps at street level to look for mirrored sign text: node tests/scratch/signsweep.mjs prefix x z [x z ...]
import { chromium } from '../lib/browser.mjs';
const [prefix = '/tmp/sweep', ...pts] = process.argv.slice(2);
const P = []; for (let i = 0; i < pts.length; i += 2) P.push([+pts[i], +pts[i + 1]]);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&fixedres&t=11', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.evaluate(() => { __game.ui.hud.setVisible(false); });
for (const [pi, [x, z]] of P.entries()) for (let k = 0; k < 6; k++) {
  const a = k / 6 * Math.PI * 2;
  await page.evaluate(({ x, z, a }) => { const g = __game; const V = g.camera.position.constructor; g.timeScale = 0; g.sky.time = 11; g.player.teleport(new V(x, 0, z), 0); g.player.root.visible = false; g.cameraRig.override = { position: new V(x, 1.8, z), lookAt: new V(x + Math.sin(a) * 30, 4, z - Math.cos(a) * 30), snap: true, fov: 70 }; }, { x, z, a });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${prefix}_${pi}_${k}.png` });
}
await browser.close();
