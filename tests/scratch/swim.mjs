// Swimming: at several real shores walk Tommy off the edge (he must not sink through the drawn pavement first), swim
// out, tread water, swim back into the edge and climb out by himself. Then: dive off a bridge, bail out of a boat
// mid-bay and re-board it from the water, drive a car into the river.
import { chromium } from '../lib/browser.mjs';
const N = +(process.argv[2] ?? 6);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&t=11', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
console.log('shore shelf quads', await page.evaluate(() => __game.physics.shoreQuads));
// shore sites: dry, clear spots 6-9 m from drawn water, straight line to it, spread over the map
const sites = await page.evaluate(N => {
  const g = __game, c = g.city, M = c.meta, out = [];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 40000 && out.length < N; i++) {
    const x = M.xmin + 200 + rnd() * (M.xmax - M.xmin - 400), z = M.zmin + 200 + rnd() * (M.zmax - M.zmin - 400);
    if (c.isWater(x, z) || !g.safe.clear(x, z)) continue;
    for (let a = 0; a < 16; a++) {
      const dx = Math.cos(a / 16 * 2 * Math.PI), dz = Math.sin(a / 16 * 2 * Math.PI);
      let edge = -1; for (let s = 0; s <= 12; s += 0.5) if (c.isWater(x + dx * s, z + dz * s)) { edge = s; break; }
      if (edge < 6 || edge > 9) continue;
      // open water ahead: drawn water, nothing built over it (bridges, pontoons) for 14 m
      let deep = true; for (let s = edge; s < edge + 14; s += 1) {
        const px = x + dx * s, pz = z + dz * s, h = g.physics.raycast({ x: px, y: 12, z: pz }, { x: 0, y: -1, z: 0 }, 30, 0x2ffff);
        if (!c.isWater(px, pz) || c.maskAt(px, pz) > 60 || (h && h.point.y > -2)) deep = false;
      }
      if (!deep) continue;
      let blocked = false; for (let s = 0.5; s < edge; s += 0.5) if (!g.safe.clear(x + dx * s, z + dz * s)) blocked = true;
      if (blocked || out.some(o => Math.hypot(o.x - x, o.z - z) < 500)) continue;
      out.push({ x, z, dx, dz, edge }); break;
    }
  }
  return out;
}, N);
const hold = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
const face = (dx, dz) => page.evaluate(([dx, dz]) => { __game.cameraRig.yaw = Math.atan2(-dx, -dz); }, [dx, dz]);
const st = () => page.evaluate(() => { const g = __game, p = g.player; return { x: p.position.x, y: p.position.y, z: p.position.z, swim: !!p.swimming, climb: !!p.climb, state: p.state, hp: p.health, anim: p.anim, water: g.city.isWater(p.position.x, p.position.z) }; });
let fails = 0;
for (const [i, s] of sites.entries()) {
  await page.evaluate(s => { const g = __game, V = g.camera.position.constructor; g.relocate(new V(s.x, 0, s.z), 0, { exact: true }); g.player.health = g.player.maxHealth; }, s);
  await page.waitForTimeout(500);
  await face(s.dx, s.dz);
  // walk in: record the lowest y while still over drawn land (sinking through the pavement)
  let sunkOnLand = 0, t = 0, r;
  await page.keyboard.down('KeyW');
  for (; t < 40; t++) { await page.waitForTimeout(100); r = await st(); if (!r.water) sunkOnLand = Math.min(sunkOnLand, r.y); if (r.swim) break; }
  await page.keyboard.up('KeyW');
  const entered = r.swim;
  // swim out 6 m, tread a moment
  await hold('KeyW', 2500); await page.waitForTimeout(1500);
  const tread = await st();
  if (i === 1) await page.screenshot({ path: '/tmp/vc/swim_tread.png' });
  // swim back to the edge: expect an automatic climb out
  await face(-s.dx, -s.dz);
  await page.keyboard.down('KeyW');
  let climbed = false;
  for (t = 0; t < 80; t++) {
    await page.waitForTimeout(100); r = await st();
    if (i === 1 && t === 8) await page.screenshot({ path: '/tmp/vc/swim_crawl.png' });
    if (i === 1 && r.climb && !climbed) { await page.waitForTimeout(350); await page.screenshot({ path: '/tmp/vc/swim_climb.png' }); }
    if (r.climb) climbed = true;
    if (climbed && !r.climb && !r.swim) break;
  }
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(600); r = await st();
  const ok = entered && climbed && !r.swim && r.y > -0.3 && r.state === 'foot' && sunkOnLand > -0.35;
  if (!ok) { fails++; await page.screenshot({ path: `/tmp/vc/swimfail_${i}.png` }); }
  console.log(`site ${i} (${s.x.toFixed(0)},${s.z.toFixed(0)}) ${ok ? 'ok  ' : 'FAIL'} entered=${entered} sunkOnLand=${sunkOnLand.toFixed(2)} tread y=${tread.y.toFixed(2)} anim=${tread.anim} climbed=${climbed} end y=${r.y.toFixed(2)} ${r.state} hp=${r.hp.toFixed(0)}`);
}
console.log(fails ? `${fails} FAILED` : 'all shores ok');
await browser.close();
