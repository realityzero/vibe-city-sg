import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&q=low', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
const boats = await page.evaluate(() => __game.spawns.slots.filter(s => s.kind === 'boat').map(s => ({ type: s.type, pos: s.pos.toArray().map(v => +v.toFixed(1)), yaw: +s.yaw.toFixed(2) })));
console.log(JSON.stringify(boats));
// walk Tommy to the quay next to each boat and try to board it with F
for (const [i, b] of boats.entries()) {
  const r = await page.evaluate(async b => {
    const g = __game, V = g.camera.position.constructor, c = g.city;
    const slot = g.spawns.slots.find(s => s.kind === 'boat' && Math.abs(s.pos.x - b.pos[0]) < 0.5 && Math.abs(s.pos.z - b.pos[2]) < 0.5);
    while (g.player.state === 'dead') await new Promise(r => setTimeout(r, 300));
    const land = slot?.v?.shoreSpot();
    if (!land) return 'no quay';
    g.relocate(land, 0, { exact: true });
    await new Promise(r => setTimeout(r, 600));
    const n = g.player.nearestEnterable();
    return 'quay ' + land.distanceTo(new V(b.pos[0], 0, b.pos[2])).toFixed(1) + ' m, nearest=' + (n ? (n.v?.type || n.kind) : 'none') + ' state=' + g.player.state + ' en=' + g.player.controlsEnabled;
  }, b);
  await page.keyboard.down('KeyF'); await page.waitForTimeout(120); await page.keyboard.up('KeyF');
  await page.waitForTimeout(2500);
  console.log(b.type, r, 'boarded:', await page.evaluate(() => __game.player.vehicle?.type || 'no'));
  await page.evaluate(() => { const p = __game.player; if (p.vehicle) p.exitVehicle(); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `/tmp/vc/boat_${i}.png` });
}
await browser.close();
