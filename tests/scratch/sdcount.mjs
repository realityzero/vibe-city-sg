import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const g = __game, SD = g.streetDetail, out = {};
  if (0) for (const [x, z] of [[1053, 689], [255, 1406], [-405, 416], [20, 360], [-640, 860]]) {
    SD.refresh(x, z);
    out[`${x},${z}`] = Object.fromEntries(SD.pools.map(p => [p.mesh.name.slice(7), `${p.mesh.count}/${p.cap}`]));
  }
  const B = SD.busLanes[0];
  const txt = SD.decals.items.filter(it => it.uv && Math.abs(it.uv[1] - 0.25) < 1e-6 && (Math.abs(it.uv[0] - 0.25) < 1e-6 || Math.abs(it.uv[0]) < 1e-6));
  const near = txt.map(it => [Math.round(it.x), Math.round(it.z), Math.round(Math.hypot(it.x - 1053.6, it.z - 689.3)), it.m[13].toFixed(3)]).sort((a, b) => a[2] - b[2]).slice(0, 4);
  return { counts: SD.counts, b0: B && [B.l.path.length, B.full], nTxt: txt.length, near };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
