// Screenshots of a footbridge's landings: player standing at each stair top looking down the flight.
import { chromium } from '../lib/browser.mjs';
const bi = +(process.argv[2] ?? 6);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&t=11', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
const b = await page.evaluate(i => { const b = __game.streetDetail.bridges[i]; return { x: b.x, z: b.z, stairs: b.stairs.map(s => [s[0], s[1]]) }; }, bi);
for (const k of [0, 1]) {
  const top = b.stairs[k * 2], foot = b.stairs[k * 2 + 1];
  const dx = foot[0] - top[0], dz = foot[1] - top[1], L = Math.hypot(dx, dz);
  // stand on the deck just short of the landing, facing the stairs
  const p = [top[0] - dx / L * 3.5, top[1] - dz / L * 3.5];
  await page.evaluate(([p, yaw]) => { const g = __game, V = g.camera.position.constructor; g.relocate(new V(p[0], 6.3, p[1]), 0, { exact: true }); g.cameraRig.yaw = yaw; g.cameraRig.pitch = -0.32; }, [p, Math.atan2(-dx, -dz)]);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `/tmp/vc/bridge${bi}_${k}.png` });
}
// overview from outside
await page.evaluate(b => { const g = __game, V = g.camera.position.constructor; g.relocate(new V(b.stairs[1][0], 0, b.stairs[1][1]), 0, { exact: true }); }, b);
await page.waitForTimeout(400);
await page.evaluate(b => { const g = __game, p = g.player.position; g.cameraRig.yaw = Math.atan2(-(b.x - p.x), -(b.z - p.z)) + Math.PI; g.cameraRig.pitch = -0.15; }, b);
await page.waitForTimeout(2500);
await page.screenshot({ path: `/tmp/vc/bridge${bi}_ext.png` });
console.log('saved', b.x.toFixed(0), b.z.toFixed(0));
await browser.close();
