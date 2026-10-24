import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
for (const [i, t] of [['0', 16.5], ['1', 21]]) {
  await page.goto(`http://127.0.0.1:5174/dev/sky.html?t=${t}&rain=1&yaw=30&pitch=10`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__frames > 60);
  await page.evaluate(() => { const yaw = 30 * Math.PI / 180; const az = Math.atan2(-Math.cos(yaw), Math.sin(yaw)) + 0.12; const S = { az, seed: 7.3, dist: 1500 }; const s = __sky; s._u = s.update; s.update = function (dt, f) { this.setLightning(1, S); this._u(dt, f); }; });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/bolt_${i}.png` });
}
await browser.close();
