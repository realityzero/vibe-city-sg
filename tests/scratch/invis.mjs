import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&q=low', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const g = __game, P = g.physics, out = [];
  // march along the car's path from (-67.9, 993.1) heading yaw -0.55 (forward = (-sin yaw, -cos yaw))
  const yaw = -0.58, d = { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
  for (const y of [0.15, 0.3, 0.6, 1.0, 1.5, 2.5]) {
    const hit = P.raycast({ x: -67.9, y, z: 993.1 }, d, 40, undefined);
    if (hit) { const c = hit.collider; const t = c.translation(); out.push({ y, toi: hit.toi.toFixed(2), pt: [hit.point.x, hit.point.y, hit.point.z].map(v => v.toFixed(2)), n: [hit.normal.x, hit.normal.y, hit.normal.z].map(v => v.toFixed(2)), shape: c.shapeType(), groups: (c.collisionGroups() >>> 16).toString(2), handle: c.handle, colT: [t.x, t.y, t.z].map(v => v.toFixed(1)), parent: !!c.parent() }); }
    else out.push({ y, hit: false });
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
