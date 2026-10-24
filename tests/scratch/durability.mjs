// Vehicle durability per type, Tommy vs explosions, witness-based wanted level.
import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&q=low', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
console.log(await page.evaluate(async () => {
  const g = __game, V = g.camera.position.constructor, out = [];
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // 1. crashes to fire: a "solid hit" = contact force of 45 g, a "big crash" = 120 g
  for (const type of ['bike', 'stinger', 'infernus', 'sedan', 'taxi', 'suv', 'police', 'lorry', 'bus']) {
    const hits = [];
    for (const g2 of [45, 120]) {
      const v = g.debugCar(type, false); v.grace = 0; let n = 0;
      while (v.health > 0 && n < 99) { v.onImpact(null, v.spec.mass * 9.81 * g2); n++; v.lastImpact = 0; }
      hits.push(n); hits.max = v.maxHealth;
      g.vehicles.splice(g.vehicles.indexOf(v), 1); v.dispose();
    }
    out.push(`${type.padEnd(8)} hp ${String(hits.max).padStart(4)}  solid hits to fire: ${hits[0]}, big crashes: ${hits[1]}`);
  }
  // 2. blasts: on foot 3 m away, then still inside
  const P = g.player; P.health = P.maxHealth;
  let v = g.debugCar('sedan', false); await wait(300);
  const pp = v.position.clone().add(new V(3, 0, 0)); g.relocate(pp, 0, { exact: true }); await wait(200);
  g.explodeVehicle(v); out.push(`blast 3 m away: health ${P.health.toFixed(0)}/${P.maxHealth} state ${P.state}`);
  P.health = P.maxHealth;
  v = g.debugCar('sedan', true); await wait(300);
  g.explodeVehicle(v); await wait(100); out.push(`blast inside the car: health ${P.health.toFixed(0)} state ${P.state} inCar ${!!P.vehicle}`);
  // 3. wanted: crimes with and without witnesses
  g.wanted.clear();
  const crimeAt = (x, z) => g.wanted.crime(1, 'Hit a pedestrian', new V(x, 0, z));
  // find a spot with no police car / camera nearby
  let quiet = null;
  for (let i = 0; i < 400 && !quiet; i++) { const x = -2000 + Math.random() * 4000, z = -1500 + Math.random() * 3000; if (!g.wanted.witness(new V(x, 0, z))) quiet = [x, z]; }
  const w0 = crimeAt(...quiet); out.push(`crime with no witness -> ${w0}, stars ${g.wanted.stars}`);
  const cam = g.wanted.cameras[0]; const w1 = crimeAt(cam.x + 5, cam.z);
  out.push(`crime next to a camera -> ${w1}, stars ${g.wanted.stars}  (cameras: ${g.wanted.cameras.length})`);
  g.wanted.clear();
  let cop = g.traffic.cars.find(c => c.type === 'police');
  if (!cop) { const n = g.roadnet.nearestLane(g.player.position.x, g.player.position.z, 200, l => l.cls <= 5); g.traffic.spawnAt(n.lane, n.lane.s0 + 5, 'police'); cop = g.traffic.cars.find(c => c.type === 'police'); await wait(300); }
  if (cop) { g.wanted.clear(); const behind = g.wanted.witness(new V(cop.pos.x + 40, 0, cop.pos.z + 300)); out.push(`crime 300 m from that police car -> ${behind}`); }
  g.wanted.clear();
  if (cop) { const w2 = crimeAt(cop.pos.x + 8, cop.pos.z); out.push(`crime 8 m from a police car -> ${w2}, stars ${g.wanted.stars}`); } else out.push('no police car in traffic right now');
  return out.join('\n');
}));
await browser.close();
