import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, channel: process.env.CH || undefined, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-renderer-backgrounding', '--run-all-compositor-stages-before-draw=false', '--enable-begin-frame-control=false'] });
const page = await browser.newPage();
await page.setContent('<canvas></canvas>');
const r = await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { if (++n < 300) requestAnimationFrame(f); else res((n / (performance.now() - t0) * 1000).toFixed(0)); }; requestAnimationFrame(f); }));
console.log('rAF fps', r);
await browser.close();
