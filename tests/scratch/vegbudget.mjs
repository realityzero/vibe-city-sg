// vegetation triangle budget at a few spots: node tests/scratch/vegbudget.mjs [port]
import { chromium } from '../lib/browser.mjs';
const port = process.argv[2] || 5174;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/?skipTitle&newgame&freeroam=8&fixedres`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 400000 });
for (const [x, z] of [[-60, 1000], [-392, 404], [200, 600], [1500, 700]]) {
  const r = await page.evaluate(([x, z]) => {
    const g = __game, V = g.camera.position.constructor;
    g.player.teleport(new V(x, 0, z), 0); g.cameraRig.override = { position: new V(x, 2, z), lookAt: new V(x, 2, z - 50), snap: true };
    g.camera.position.set(x, 2, z); g.camera.lookAt(x, 2, z - 50); g.camera.updateMatrixWorld();
    g.veg.update(0, g.camera, true);
    const out = { near: 0, mid: 0, far: 0, inst: [0, 0, 0] };
    for (const lods of g.veg.meshes) lods.forEach((im, l) => { const t = im.geometry.attributes.position.count / 3 * im.count; out[['near', 'mid', 'far'][l]] += t; out.inst[l] += im.count; });
    for (const k of ['near', 'mid', 'far']) out[k] = (out[k] / 1e6).toFixed(2) + 'M';
    return out;
  }, [x, z]);
  console.log(x, z, JSON.stringify(r));
}
await browser.close();
