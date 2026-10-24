// street-level traffic close-ups: node tests/scratch/traffic.mjs prefix [t]
import { chromium } from '../lib/browser.mjs';
const [prefix = '/tmp/tr', t = '11'] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres&t=${t}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.waitForTimeout(1000);
// a few spots: put the camera on the kerb next to a busy lane, looking along it
const spots = await page.evaluate(() => {
  const g = __game; g.ui.hud.setVisible(false); g.timeScale = 0;
  const out = [];
  for (const [x, z] of [[60, 330], [-60, 1000], [-392, 420], [400, -200]]) {
    const n = g.roadnet.nearestLane(x, z, 200, l => l.cls <= 3);
    if (n) out.push({ x: n.pos.x, z: n.pos.z, dx: n.dir.x, dz: n.dir.z });
  }
  return out;
});
let i = 0;
for (const s of spots) {
  await page.evaluate(s => { const g = __game; const V = g.camera.position.constructor; g.player.teleport(new V(s.x + s.dz * 6, 0, s.z - s.dx * 6), 0); g.player.root.visible = false; }, s);
  await page.waitForTimeout(5000);
  await page.evaluate(s => { const g = __game; const V = g.camera.position.constructor; const side = new V(s.dz, 0, -s.dx); g.cameraRig.override = { position: new V(s.x + side.x * 5.5 - s.dx * 4, 1.6, s.z + side.z * 5.5 - s.dz * 4), lookAt: new V(s.x + s.dx * 25, 1.2, s.z + s.dz * 25), snap: true, fov: 50 }; }, s);
  await page.waitForTimeout(1500);
  const f = `${prefix}_${i++}.png`; await page.screenshot({ path: f }); console.log('shot', f);
}
await browser.close();
