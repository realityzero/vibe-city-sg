// Scripted play-test: node tests/play.mjs <url> <steps.json|inline-json> [outPrefix]
// steps: [{wait:ms}, {shot:'name'}, {down:'KeyW'}, {up:'KeyW'}, {press:'KeyF'}, {eval:'js'}, {hold:'KeyW', ms:2000}, {mouse:[dx,dy]}, {click:[x,y]}, {type:'text'}]
import { chromium } from './lib/browser.mjs';
import { readFileSync, existsSync } from 'node:fs';
const [url, stepsArg, prefix = '/tmp/play'] = process.argv.slice(2);
const steps = JSON.parse(existsSync(stepsArg) ? readFileSync(stepsArg, 'utf8') : stepsArg);
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { const t = m.text(); if (m.type() === 'debug' || /AudioContext was not allowed|PCFSoftShadowMap/.test(t)) return; if (m.type() === 'error') errors.push(t); console.log(`[${m.type()}] ${t.slice(0, 400)}`); });
page.on('pageerror', e => { errors.push(e.message); console.log(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`); });
await page.goto(url, { waitUntil: 'load' });
let n = 0;
for (const s of steps) {
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.waitFor) { const t0 = Date.now(); while (Date.now() - t0 < (s.timeout || 30000)) { if (await page.evaluate(s.waitFor).catch(() => false)) break; await page.waitForTimeout(250); } }
  if (s.spam) { const t0 = Date.now(); while (Date.now() - t0 < (s.timeout || 60000)) { if (s.until && await page.evaluate(s.until).catch(() => false)) break; await page.keyboard.press(s.spam); await page.waitForTimeout(s.every || 400); } }
  if (s.down) await page.keyboard.down(s.down);
  if (s.up) await page.keyboard.up(s.up);
  if (s.press) await page.keyboard.press(s.press);
  if (s.hold) { await page.keyboard.down(s.hold); await page.waitForTimeout(s.ms || 1000); await page.keyboard.up(s.hold); }
  if (s.type) await page.keyboard.type(s.type, { delay: 30 });
  if (s.click) await page.mouse.click(s.click[0], s.click[1]);
  if (s.mouse) { await page.mouse.move(640, 360); await page.mouse.down(); await page.mouse.move(640 + s.mouse[0], 360 + s.mouse[1], { steps: 10 }); await page.mouse.up(); }
  if (s.eval) { try { const r = await page.evaluate(s.eval); if (r !== undefined) console.log('eval>', typeof r === 'string' ? r : JSON.stringify(r)); } catch (e) { console.log('eval error', e.message); } }
  if (s.shot) { const f = `${prefix}_${String(n++).padStart(2, '0')}_${s.shot}.png`; await page.screenshot({ path: f }); console.log('shot', f); }
}
console.log('errors:', errors.length);
await browser.close();
