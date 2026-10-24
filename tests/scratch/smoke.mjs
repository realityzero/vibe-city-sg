import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres&t=11', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 90000 });
await page.waitForTimeout(1500);
for (const type of (process.argv[2] || 'bike_grub,infernus').split(',')) {
  await page.evaluate(t => { const g = __game; if (g.player.vehicle) g.player.exitVehicle(true); g.debugTp(-60, 1000, 0); g.timeScale = 0; g.sky.time = 11; void g.debugCar(t); }, type);
  await page.waitForTimeout(800);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(3500);
  await page.keyboard.down('Space'); await page.keyboard.down('KeyA'); await page.waitForTimeout(900);
  await page.screenshot({ path: `/tmp/smoke_${type}_slide.png` });
  await page.keyboard.up('Space'); await page.keyboard.up('KeyA'); await page.keyboard.up('KeyW');
  const info = await page.evaluate(() => ({ live: __game.fx.smoke.live, skid: __game.player.vehicle?.skid, kmh: Math.round((__game.player.vehicle?.speed||0)*3.6) }));
  console.log(type, JSON.stringify(info));
  await page.evaluate(() => { const v = __game.player.vehicle; v.health = 120; });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(2500);
  await page.screenshot({ path: `/tmp/smoke_${type}_damaged.png` });
  await page.keyboard.down('KeyB'); await page.waitForTimeout(700);
  await page.screenshot({ path: `/tmp/smoke_${type}_boost.png` });
  await page.keyboard.up('KeyB'); await page.keyboard.up('KeyW');
  await page.evaluate(() => { const v = __game.player.vehicle; v.health = 1000; });
}
await browser.close();
