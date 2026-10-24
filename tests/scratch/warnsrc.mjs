// who triggers "toNonIndexed(): BufferGeometry is already non-indexed" at load
import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.addInitScript(() => { const w = console.warn; window.__ws = {}; console.warn = (...a) => { if (String(a[0]).includes('already non-indexed')) { const st = new Error().stack.split('\n').slice(2, 6).map(l => l.trim().replace(/https?:\/\/[^/]+/, '').replace(/\?[^:]*/, '')).join(' <- '); __ws[st] = (__ws[st] || 0) + 1; return; } w(...a); }; });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
console.log(JSON.stringify(await page.evaluate(() => __ws), null, 1));
await browser.close();
