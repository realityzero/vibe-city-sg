// hero vehicle beauty shots: node tests/scratch/cars.mjs prefix t types...
import { chromium } from '../lib/browser.mjs';
const [prefix = '/tmp/car', t = '11', ...types] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres&t=${t}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.waitForTimeout(1000);
let i = 0;
for (const type of types.length ? types : ['taxi', 'sedan', 'infernus', 'bus']) {
  await page.evaluate(type => { const g = __game; g.ui.hud.setVisible(false); g.timeScale = 0; if (g.player.vehicle) g.player.exitVehicle(true); g.debugTp(60, 330, 0); const v = g.debugCar(type, false); window.__v = v; g.player.root.visible = false; }, type);
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const g = __game, v = __v; const V = g.camera.position.constructor; const f = new V(0, 0, -1).applyQuaternion(v.quaternion); const r = new V(-f.z, 0, f.x); const L = v.spec.length; g.cameraRig.override = { position: v.position.clone().addScaledVector(f, L * 0.9).addScaledVector(r, L * 0.75).setY(1.5), lookAt: v.position.clone().setY(0.7), snap: true, fov: 45 }; });
  await page.waitForTimeout(1200);
  const f = `${prefix}_${i++}.png`; await page.screenshot({ path: f }); console.log('shot', f, type);
}
await browser.close();
