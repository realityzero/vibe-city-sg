// look at fallen blossom: find near flowering trees and shoot them from eye height
import { chromium } from '../lib/browser.mjs';
const [out = '/tmp/petal'] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 400000 });
const spots = await page.evaluate(() => {
  const v = __game.veg, out = [];
  for (const sp of [1, 8, 7]) { let k = 0; for (let i = 0; i < v.count; i++) if (v.types[i] === sp && (k++ % 97) === 13) { out.push([v.pos[i * 2], v.pos[i * 2 + 1], sp]); break; } }
  return out;
});
for (const [i, [x, z, sp]] of spots.entries()) {
  await page.evaluate(([x, z]) => {
    const g = __game; const V = g.camera.position.constructor;
    g.ui.hud.setVisible(false); g.sky.time = 10.5; g.timeScale = 0; g.weather.force(0);
    g.player.teleport(new V(x + 12, 0, z + 12), 0); g.player.root.visible = false;
    g.cameraRig.override = { position: new V(x + 12, 1.7, z + 12), lookAt: new V(x, 1.5, z), snap: true, fov: 62 };
  }, [x, z]);
  await page.waitForTimeout(2500);
  console.log(i, sp, x.toFixed(0), z.toFixed(0), await page.evaluate(() => __game.veg.petals.count));
  await page.screenshot({ path: `${out}_${i}.png` });
}
await browser.close();
