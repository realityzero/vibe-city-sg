import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&q=low', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.evaluate(() => { void __game.debugTp(-60, 1000, 0); void __game.debugCar('sedan'); });
await page.waitForTimeout(500);
for (const st of [1, -1]) {
  await page.evaluate(st => { const v = __game.player.vehicle; v.yawSign = 0; __game.player.update = () => {}; v.setDriverControls({ throttle: 0.6, brake: 0, steer: st, handbrake: false }); }, st);
  await page.waitForTimeout(1500);
  console.log(await page.evaluate(() => { const v = __game.player.vehicle; const av = v.body.angvel(); return JSON.stringify({ steer: v.steer.toFixed(3), fwd: v.forwardSpeed.toFixed(2), avy: av.y.toFixed(3), kin: (v.forwardSpeed / v.spec.wheelBase * Math.tan(v.steer)).toFixed(3) }); }));
}
await browser.close();
