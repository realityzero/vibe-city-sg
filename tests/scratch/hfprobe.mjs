import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
console.log(await page.evaluate(() => {
  const g = __game, r = g.R.renderer, rt = g.heightField.rt, w = g.heightField.w, h = g.heightField.h;
  const buf = new Uint16Array(4); const hf = v => { const s = (v & 0x8000) ? -1 : 1, e = (v >> 10) & 31, f = v & 1023; return s * (e === 0 ? f / 1024 * 2 ** -14 : (1 + f / 1024) * 2 ** (e - 15)); };
  const HF = g.heightField; const rect = (globalThis.__HF = null);
  const out = { sun: g.U.sunDir.value.toArray().map(v => v.toFixed(2)) };
  // sample a few known spots: MBS tower (~1300,330 h~200), Raffles Place (~200,350), sea
  const M = g.city.meta, xmin = M.xmin - 600, xmax = M.xmax + 600, zmin = M.zmin - 450, zmax = M.zmax + 450;
  for (const [name, x, z] of [['mbs', 1305, 330], ['rafflesPl', 150, 300], ['chinatown', -400, 400], ['sea', 2600, 1800]]) {
    const px = Math.floor((x - xmin) / (xmax - xmin) * w), py = Math.floor((zmax - z) / (zmax - zmin) * h);
    r.readRenderTargetPixels(rt, px, py, 1, 1, buf); out[name] = hf(buf[0]).toFixed(1);
  }
  return JSON.stringify(out);
}));
await browser.close();
