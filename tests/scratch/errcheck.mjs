// loads the game and prints console errors/warnings (shader compile errors show up here)
import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 1500)); if (/warmUp|streetdetail/.test(m.text())) console.log(m.text()); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.waitForTimeout(3000);
await browser.close();
