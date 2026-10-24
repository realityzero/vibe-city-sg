// Checks the worker's kerb push: count of moved footprint vertices and a ray along Robinson Road at the old corner
import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (/\[city\]/.test(m.text()) || m.type() === 'error') console.log(m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&fixedres', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
console.log(await page.evaluate(() => {
  const g = __game, P = g.physics;
  // horizontal rays at bumper height towards the old protruding corner (-55.8, 973.8) from the road centre side
  const hits = [];
  for (const [ox, oz] of [[-49, 977], [-50, 970], [-48, 980]]) {
    const dx = -55.8 - ox, dz = 973.8 - oz, L = Math.hypot(dx, dz);
    const h = P.raycast({ x: ox, y: 0.6, z: oz }, { x: dx / L, y: 0, z: dz / L }, 12, undefined);
    hits.push(h ? `hit at ${h.point.x.toFixed(2)},${h.point.z.toFixed(2)} (toi ${h.toi.toFixed(2)})` : 'clear');
  }
  return JSON.stringify({ kerbPushed: g.city.stats.kerbPushed, hits });
}));
await browser.close();
