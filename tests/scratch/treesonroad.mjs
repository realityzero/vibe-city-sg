import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&q=low', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
console.log(await page.evaluate(() => {
  const g = __game, v = g.veg, net = g.roadnet; let onLane = 0, near = 0; const ex = [];
  for (let i = 0; i < v.count; i++) {
    const x = v.pos[i * 2], z = v.pos[i * 2 + 1];
    const n = net.nearestLane(x, z, 6, l => l.cls <= 7);
    if (!n) continue;
    if (n.dist < 1.7) { onLane++; if (ex.length < 6) ex.push([x.toFixed(0), z.toFixed(0), n.dist.toFixed(2), n.lane.cls]); }
    else if (n.dist < 2.6) near++;
  }
  return JSON.stringify({ trees: v.count, inLane: onLane, within2_6m: near, ex });
}));
await browser.close();
