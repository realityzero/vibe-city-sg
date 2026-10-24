// Swimming, the other ways in: a high fall into the bay (bridge dive), bailing out of a boat mid-bay and climbing back
// aboard from the water, and driving a car off a quay. Tommy must end up swimming (alive, no damage) every time.
import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&t=11', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
const st = () => page.evaluate(() => { const g = __game, p = g.player; return { y: p.position.y, swim: !!p.swimming, state: p.state, hp: p.health, veh: p.vehicle?.type || null }; });
let fails = 0;
const report = (name, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${extra}`); };

// open water in the middle of Marina Bay
const bay = await page.evaluate(() => { const g = __game, c = g.city; for (let r = 0; r < 400; r += 10) for (let a = 0; a < 24; a++) { const x = 700 + Math.cos(a / 24 * 6.283) * r, z = 200 + Math.sin(a / 24 * 6.283) * r; let ok = true; for (let dx = -40; dx <= 40; dx += 10) for (let dz = -40; dz <= 40; dz += 10) if (!c.isWater(x + dx, z + dz)) ok = false; if (ok) return { x, z }; } return null; });
console.log('bay', bay);

// 1. high fall into the water
await page.evaluate(b => { const g = __game, V = g.camera.position.constructor; g.player.health = g.player.maxHealth; g.player.teleport(new V(b.x, 14, b.z), 0); }, bay);
let minY = 99, r;
for (let t = 0; t < 40; t++) { await page.waitForTimeout(100); r = await st(); minY = Math.min(minY, r.y); }
report('14 m fall into the bay', r.swim && r.state === 'foot' && r.hp === 150 && r.y > -3, `deepest ${minY.toFixed(2)}, settled y ${r.y.toFixed(2)}, hp ${r.hp}`);
await page.screenshot({ path: '/tmp/vc/swim_fall.png' });

// 2. boat mid-bay: bail out over the side, then climb back aboard from the water
const boatInfo = await page.evaluate(async b => {
  const g = __game, V = g.camera.position.constructor, { Boat } = await import('/src/entities/boat.js');
  g.player.teleport(new V(b.x + 30, 0, b.z), 0);
  const v = new Boat(g, 'speedboat', { position: new V(b.x + 30, -1.4, b.z), yaw: 0 }); g.vehicles.push(v); window.__tb = v;
  g.player.enterVehicleImmediate(v);
  return { shore: !!v.shoreSpot() };
}, bay);
await page.waitForTimeout(1500);
await page.keyboard.press('KeyF'); await page.waitForTimeout(1200);
r = await st();
report('bail out of a boat mid-bay', r.swim && !r.veh && r.state === 'foot', `shore alongside ${boatInfo.shore}, swimming ${r.swim}, y ${r.y.toFixed(2)}`);
await page.screenshot({ path: '/tmp/vc/swim_boat.png' });
await page.keyboard.press('KeyF'); await page.waitForTimeout(1500);
r = await st();
report('climb back aboard from the water', r.veh === 'speedboat' && !r.swim, `vehicle ${r.veh}`);
await page.evaluate(() => { const g = __game; g.player.exitVehicle(true); });

// 3. drive a car off a quay into the river
const quay = await page.evaluate(async () => {
  const g = __game, c = g.city, V = g.camera.position.constructor, { Vehicle } = await import('/src/entities/vehicle.js');
  // a dry clear spot whose straight run to open water is clear (no railing collider in the way)
  for (const [x0, z0] of [[1698, -1250], [974, 440], [2212, 469], [-982, -322]]) for (let a = 0; a < 16; a++) {
    const dx = Math.cos(a / 16 * 6.283), dz = Math.sin(a / 16 * 6.283);
    let edge = -1; for (let s = 0; s <= 30; s += 0.5) if (c.isWater(x0 + dx * s, z0 + dz * s)) { edge = s; break; }
    if (edge < 8) continue;
    let clear = true; for (let s = 0; s < edge + 10; s += 1) if (s < edge ? !g.safe.clear(x0 + dx * s, z0 + dz * s, { pad: 1.6 }) : !c.isWater(x0 + dx * s, z0 + dz * s)) clear = false;
    if (!clear) continue;
    const yaw = Math.atan2(-dx, -dz);
    const v = new Vehicle(g, 'sedan', { position: new V(x0, 0.6, z0), yaw }); g.vehicles.push(v);
    g.player.health = g.player.maxHealth; g.player.enterVehicleImmediate(v);
    return { x0, z0, edge };
  }
  return null;
});
console.log('quay', quay);
if (quay) {
  await page.keyboard.down('KeyW');
  let swam = false, died = false;
  for (let t = 0; t < 120; t++) { await page.waitForTimeout(100); r = await st(); if (t === 40) await page.keyboard.up('KeyW'); if (r.swim) swam = true; if (r.state === 'dead') died = true; if (swam && t > 50) break; }
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(1500); r = await st();
  report('drive a car off the quay', !died && r.state === 'foot' && !r.veh, `swam ${swam}, now y ${r.y.toFixed(2)} swimming ${r.swim}, hp ${r.hp.toFixed(0)}`);
  await page.screenshot({ path: '/tmp/vc/swim_car.png' });
}
console.log(fails ? `${fails} FAILED` : 'all ok');
await browser.close();
