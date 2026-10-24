// Reproduce the death -> hospital respawn and look around / walk
import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error' || m.text().startsWith('[rs]')) console.log(m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&stats&fixedres&t=12' + (process.env.Q ? '&' + process.env.Q : ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.evaluate(() => { __game.events.emit('playerDied', 'died'); });
await page.waitForTimeout(9000);
const info = await page.evaluate(() => { const g = __game; const p = g.player.position; return { state: g.player.state, p: [p.x, p.y, p.z].map(v => v.toFixed(1)), cam: g.camera.position.toArray().map(v => v.toFixed(1)) }; });
console.log('[rs] after respawn', JSON.stringify(info));
await page.screenshot({ path: '/tmp/vc/rs_0.png' });
for (const [i, yaw] of [[1, Math.PI / 2], [2, Math.PI], [3, -Math.PI / 2]].values()) {
  await page.evaluate(y => { __game.cameraRig.yaw = y; }, yaw);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `/tmp/vc/rs_${i}.png` });
}
// walk forward 3 s in four directions
for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  await page.evaluate(y => { __game.cameraRig.yaw = y; }, yaw);
  const a = await page.evaluate(() => __game.player.position.toArray());
  await page.keyboard.down('w'); await page.waitForTimeout(2500); await page.keyboard.up('w');
  const b = await page.evaluate(() => __game.player.position.toArray());
  console.log('[rs] walk yaw', yaw.toFixed(2), 'moved', Math.hypot(b[0] - a[0], b[2] - a[2]).toFixed(1), 'm', b.map(v => v.toFixed(1)).join(','));
}
await page.screenshot({ path: '/tmp/vc/rs_after.png' });
await browser.close();
