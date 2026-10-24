// vegetation CPU costs: construction (geometry, impostor bake) and per-frame near-pool rebuild at a few spots
import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 400000 });
console.log('build', JSON.stringify(await page.evaluate(() => __game.veg.buildMs)));
for (const [x, z] of [[-160, -700], [1500, 700], [-405, 416]]) {
  const r = await page.evaluate(([x, z]) => {
    const g = __game, cam = g.camera; cam.position.set(x, 2, z); cam.lookAt(x + 50, 3, z - 50); cam.updateMatrixWorld();
    const t0 = performance.now(); for (let i = 0; i < 100; i++) { cam.position.x += 0.01; g.veg.update(0.016, cam, true); } const ms = (performance.now() - t0) / 100;
    return { ms: ms.toFixed(3), near: g.veg.meshes.reduce((a, m) => a + m.count, 0) };
  }, [x, z]);
  console.log(x, z, JSON.stringify(r));
}
await browser.close();
