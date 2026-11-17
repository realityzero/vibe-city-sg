// Main-thread cost of the AI traffic per frame (Traffic.update: spawning, driving every car, the instanced renderer)
// at phone settings (Low preset, CPU throttled like an A14), timed in the page around the call itself.
//   node tests/mobile/trafficcpu.mjs [--url http://127.0.0.1:5174/] [--secs 20] [--throttle 1.6] [--spot -60,1000]
import { chromium } from '../lib/browser.mjs';
import { IPHONE12 } from './lib.mjs';
const args = process.argv.slice(2), arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const url = arg('--url', 'http://127.0.0.1:5174/'), secs = +arg('--secs', 20), throttle = +arg('--throttle', 1.6);
const [x, z] = arg('--spot', '-60,1000').split(',').map(Number);
const browser = await chromium.launch({ headless: true, exclusive: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...IPHONE12, userAgent: undefined });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(new URL('?skipTitle&newgame&freeroam=1&q=low', url).href, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 240000 });
await page.evaluate(([x, z]) => { const g = __game; g.relocate(new g.camera.position.constructor(x, 0, z), 0); }, [x, z]);
await page.waitForTimeout(8000);
const cdp = await ctx.newCDPSession(page);
if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
await page.waitForTimeout(2000);
const r = await page.evaluate(async secs => {
  const T = __game.traffic, orig = T.update, ms = [], cars = [];
  T.update = function (dt) { const t0 = performance.now(); orig.call(this, dt); ms.push(performance.now() - t0); cars.push(this.cars.length); };
  await new Promise(res => setTimeout(res, secs * 1000));
  T.update = orig;
  const s = ms.slice().sort((a, b) => a - b), mean = ms.reduce((a, b) => a + b, 0) / ms.length, n = cars.reduce((a, b) => a + b, 0) / cars.length;
  return { frames: ms.length, cars: +n.toFixed(0), meanMs: +mean.toFixed(3), p50: +s[s.length >> 1].toFixed(3), p95: +s[Math.floor(s.length * 0.95)].toFixed(3), p99: +s[Math.floor(s.length * 0.99)].toFixed(3), usPerCar: +(mean * 1000 / n).toFixed(1) };
}, secs);
console.log(JSON.stringify({ url, throttle, spot: [x, z], ...r }));
await browser.close();
