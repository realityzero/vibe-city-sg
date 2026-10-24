// node tests/scratch/skyshots.mjs prefix "t=16&yaw=90" "t=18.6&yaw=250" ...
import { chromium } from '../lib/browser.mjs';
const [prefix, ...views] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 300)); });
let i = 0;
for (const v of views) {
  await page.goto(`http://127.0.0.1:5174/dev/sky.html?${v}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__frames > 90, null, { timeout: 60000 });
  const f = `${prefix}_${i++}.png`; await page.screenshot({ path: f }); console.log('shot', f, v);
}
await browser.close();
