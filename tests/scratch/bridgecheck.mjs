// footbridge colliders vs carriageways: distance from every column / stair foot to the nearest drivable lane centre
import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const g = __game, SD = g.streetDetail, net = g.roadnet;
  return SD.bridges.map(b => {
    const pts = (b.cols || []).concat(b.stairs || []);
    return { b: [Math.round(b.x), Math.round(b.z)], hw: b.hw, pts: pts.map(([x, z, k]) => { const l = net.nearestLane(x, z, 25, l => l.cls <= 6); return `${k}@${x.toFixed(0)},${z.toFixed(0)} lane ${l ? l.dist.toFixed(1) : '-'}`; }) };
  });
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
