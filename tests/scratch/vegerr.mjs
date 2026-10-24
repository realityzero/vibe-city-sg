import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message, e.stack?.slice(0, 500)));
page.on('console', m => console.log('[' + m.type() + ']', m.text().slice(0, 400)));
await page.goto(`http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres`, { waitUntil: 'load' });
for (let i = 0; i < 12; i++) { await page.waitForTimeout(5000); const r = await page.evaluate(() => ({ ready: !!window.__game?.worldReady, state: window.__game?.state, txt: document.body.innerText.slice(0, 200) })); console.log(JSON.stringify(r)); if (r.ready) break; }
await browser.close();
