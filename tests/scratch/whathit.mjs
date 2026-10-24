import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&q=medium', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.evaluate(() => {
  const g = __game; g.traffic.enabled = false; for (const c of [...g.traffic.cars]) g.traffic.despawn(c);
  let best = null;
  for (const l of g.roadnet.lanes) { if (l.cls > 3 || l.path.length < 220 || l.path.p.some(q => Math.abs(q[1]) > 0.5)) continue; const P = l.path.p, chord = Math.hypot(P.at(-1)[0] - P[0][0], P.at(-1)[2] - P[0][2]); const sc = chord / l.path.length * Math.min(1, l.path.length / 600); if (!best || sc > best.sc) best = { l, sc }; }
  const P = best.l.path.p; void g.debugTp(P[0][0], P[0][2], 0); void g.debugCar('infernus');
  window.__lane = best.l;
  const ch = g.events.emit.bind(g.events); window.__impacts = [];
  g.events.on('vehicleImpact', e => { const o = e.other; const col = g.physics.world.getCollider?.(o) || null; __impacts.push({ t: performance.now(), dmg: e.damage.toFixed(0), pos: g.player.vehicle.position.toArray().map(v => v.toFixed(1)), group: col ? (col.collisionGroups() >>> 16).toString(2) : '?', shape: col?.shapeType?.() }); });
});
await page.keyboard.down('KeyW');
await page.waitForTimeout(6000);
await page.keyboard.up('KeyW');
console.log(await page.evaluate(() => { const g = __game, v = g.player.vehicle, p = v.position; const n = g.roadnet.nearestLane(p.x, p.z, 20); const L = __lane; return JSON.stringify({ impacts: __impacts.slice(0, 5), pos: p.toArray().map(a => a.toFixed(1)), laneDist: n?.dist.toFixed(2), sameLane: n?.lane === L, kmh: Math.round(v.speed * 3.6) }); }));
await page.screenshot({ path: '/tmp/vc/whathit.png' });
await browser.close();
