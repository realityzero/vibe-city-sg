// quick load probe: errors + vegetation build stats
import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { const t = m.text(); if (m.type() === 'error' || /warmUp|world ready|veg/.test(t)) console.log('[c]', m.type(), t.slice(0, 400)); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 400000 });
console.log(await page.evaluate(() => JSON.stringify(__game.veg.stats)));
await browser.close();
