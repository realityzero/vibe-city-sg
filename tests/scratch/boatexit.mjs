import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&q=low', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
console.log(await page.evaluate(async () => {
  const g = __game, P = g.player, out = [];
  g.events.on('playerDrowned', () => out.push('DROWNED at ' + P.position.toArray().map(v => v.toFixed(1))));
  g.events.on('playerDied', r => out.push('DIED ' + r));
  const slot = g.spawns.slots.find(s => s.type === 'speedboat'); const v = slot.v;
  P.enterVehicleImmediate(v);
  await new Promise(r => setTimeout(r, 1500));
  out.push('in boat at ' + v.position.toArray().map(a => a.toFixed(1)) + ' shore=' + (v.shoreSpot()?.toArray().map(a => a.toFixed(1)) || 'none'));
  P.exitVehicle();
  for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 300)); out.push(`t${i} state=${P.state} pos=${P.position.toArray().map(a => a.toFixed(2))} body=${(() => { const t = P.body.translation(); return [t.x, t.y, t.z].map(a => a.toFixed(2)); })()}`); }
  return out.join('\n');
}));
await browser.close();
