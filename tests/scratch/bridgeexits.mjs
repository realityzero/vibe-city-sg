// Every footbridge stair foot must open onto ground that floods out to the sidewalk network (not a sealed plaza).
import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&q=low&t=11', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
const res = await page.evaluate(() => {
  const g = __game, S = g.safe;
  return g.streetDetail.bridges.map(b => {
    const feet = [];
    for (let i = 0; i < b.stairs.length; i += 2) {
      const [tx, tz] = b.stairs[i], [fx, fz] = b.stairs[i + 1];
      const dx = fx - tx, dz = fz - tz, L = Math.hypot(dx, dz);
      const x = fx + dx / L * 3, z = fz + dz / L * 3;
      feet.push({ x: +x.toFixed(0), z: +z.toFixed(0), inside: S.insideBuilding(x, z), reach: S.reachesSidewalk(x, z) });
    }
    return { x: +b.x.toFixed(0), z: +b.z.toFixed(0), dirs: b.dirs, feet };
  });
});
for (const r of res) console.log(`bridge (${r.x},${r.z}) dirs ${r.dirs}:`, r.feet.map(f => `${f.reach && !f.inside ? 'open' : 'SEALED'}(${f.x},${f.z})`).join('  '));
await browser.close();
