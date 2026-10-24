// Usage: node tests/shot.mjs <url> <out.png> [waitMs=4000] [width=1280] [height=720] [evalJsAfterLoad]
// Launches headless Chromium with GPU (ANGLE/Metal) and captures a screenshot + console log.
import { chromium } from './lib/browser.mjs';
const [url, out = '/tmp/shot.png', wait = '4000', w = '1280', h = '720', evalJs] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', m => { const t = m.text(); if (m.type() === 'debug' || /AudioContext was not allowed|PCFSoftShadowMap/.test(t)) return; console.log(`[${m.type()}] ${t}`); });
page.on('pageerror', e => console.log(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(+wait);
if (evalJs) { console.log('eval ->', await page.evaluate(evalJs)); await page.waitForTimeout(1500); }
await page.screenshot({ path: out });
console.log('saved', out);
await browser.close();
