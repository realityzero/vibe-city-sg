import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&' + (process.env.QS || 'q=low'), { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.evaluate(() => { void __game.debugTp(-60, 1000, 0); void __game.debugCar('sedan'); });
await page.waitForTimeout(500);
await page.keyboard.down('KeyW');
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(700);
  console.log(await page.evaluate(() => { const g = __game, v = g.player.vehicle; const t = v.body.translation(); return JSON.stringify({ ctl: v.ctl, thrIn: v.thrIn.toFixed(2), fwd: v.forwardSpeed.toFixed(2), sp: v.speed.toFixed(2), sleeping: v.body.isSleeping(), body: [t.x, t.y, t.z].map(a => a.toFixed(2)), root: v.root.position.toArray().map(a => a.toFixed(2)), p1: v.pose.p1.toArray().map(a => a.toFixed(2)), alpha: g.physics.alpha.toFixed(2), contacts: [0, 1, 2, 3].map(i => v.vc.wheelIsInContact(i) ? 1 : 0).join(''), eng: v.vc.wheelEngineForce?.(0) }); }));
}
await browser.close();
