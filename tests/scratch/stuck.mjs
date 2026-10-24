import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&q=medium&t=12', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.evaluate(() => { const g = __game; void g.debugTp(-60, 1000, 0); void g.debugCar('infernus'); });
await page.keyboard.down('KeyW');
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(600);
  console.log(await page.evaluate(() => { const g = __game, v = g.player.vehicle, t = v.body.translation(); const hits = []; g.physics.world.contactPairsWith?.(v.collider, o => hits.push(o.handle)); return JSON.stringify({ p: [t.x, t.y, t.z].map(a => a.toFixed(1)), kmh: Math.round(v.speed * 3.6), yaw: v.yaw().toFixed(2), contacts: hits.length, traffic: g.traffic.cars.filter(c => Math.hypot(c.pos?.x - t.x, c.pos?.z - t.z) < 8).length }); }));
}
await page.screenshot({ path: '/tmp/vc/stuck.png' });
await page.keyboard.up('KeyW');
await browser.close();
