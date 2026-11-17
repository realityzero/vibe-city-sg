// Driving juice check (world/juice.js): a staged near miss past a traffic car (CLOSE SHAVE popup + cash), Kopi Gao speed
// lines, a handbrake drift (tyre smoke), a scrape along the bridge parapet (sparks) and a big crash (slow motion).
//   node tests/scratch/juice.mjs [--url http://127.0.0.1:4173/] [--set phone|desktop] [--out /tmp/vc-juice]
import { launch } from '../mobile/lib.mjs';
import fs from 'fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), SET = arg('set', 'desktop'), OUT = arg('out', '/tmp/vc-juice');
fs.mkdirSync(OUT, { recursive: true });
const phone = SET === 'phone';
const h = await launch('chromium', { exclusive: false, device: phone ? undefined : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 } });
const { page } = h, errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=20.6${phone ? '&q=low' : '&q=high'}&fixedres`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
await page.evaluate(() => { __game.timeScale = 0; window.__p0 = __game.R.renderer.info.programs.length; });
const shot = name => page.screenshot({ path: `${OUT}/${SET}-${name}.png` });
const key = (code, down) => page.evaluate(([code, down]) => dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true })), [code, down]);
// a car on Esplanade Drive (southbound, straight) at speed
const place = (x, z, yawOff, speed) => page.evaluate(([x, z, yawOff, speed]) => {
  const g = __game, T = g.camera.position.constructor;
  const n = g.roadnet.nearestLane(x, z, 40, l => l.cls <= 3 && l.idx === 0);
  const yaw = Math.atan2(-n.dir.x, -n.dir.z) + yawOff;
  if (!g.player.vehicle) { g.debugTp(n.pos.x, n.pos.z, yaw); g.debugCar('infernus'); }
  g.relocate(n.pos, yaw, { exact: true });
  const v = g.player.vehicle; v.body.setLinvel({ x: -Math.sin(yaw) * speed, y: 0, z: -Math.cos(yaw) * speed }, true);
  v.grace = 0; // (a teleport ignores impacts for a moment)
  g.cameraRig.yaw = yaw; return [n.pos.x, n.pos.z, yaw];
}, [x, z, yawOff, speed]);
await page.waitForTimeout(3000);

// 1. near miss: overtake a traffic car a lane over, 0.6 m clear
const r1 = await page.evaluate(async () => {
  const g = __game, T = g.camera.position.constructor;
  g.ui.stunt.show = () => Promise.resolve(); // (teleports at speed read as jumps)
  if (!g.player.vehicle) { g.debugTp(600, -230, Math.PI); g.debugCar('infernus'); }
  await new Promise(r => setTimeout(r, 3000));
  // the nearest driving traffic car on a straight-ish lane
  const p = g.player.position;
  const c = g.traffic.cars.filter(c => c.state === 'drive' && c.mode === 'lane' && c.lane.s1 - c.s > 60 && c.speed > 4).sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p))[0];
  if (!c) return 'no car';
  const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw), rx = -fz, rz = fx, v = g.player.vehicle;
  const off = c.spec.width / 2 + v.spec.width / 2 + 0.6;
  const pos = new T(c.pos.x - fx * 16 + rx * off, c.pos.y, c.pos.z - fz * 16 + rz * off);
  g.player.teleport(pos, c.yaw); g.cameraRig.yaw = c.yaw;
  const sp = c.speed + 14; v.body.setLinvel({ x: fx * sp, y: 0, z: fz * sp }, true);
  return { car: c.type, speed: c.speed.toFixed(1), money: g.money };
});
console.log('near miss setup', JSON.stringify(r1));
let got = false;
for (let i = 0; i < 100 && !got; i++) { await page.waitForTimeout(50); got = await page.evaluate(() => document.querySelector('.vc-shave').classList.contains('go')); }
await page.waitForTimeout(250); await shot('1-nearmiss');
console.log('near miss', got, await page.evaluate(() => ({ money: __game.money, combo: __game.juice.combo, fov: __game.camera.fov.toFixed(1) })));

// the rest on an empty road
await page.evaluate(() => { const g = __game; for (const c of [...g.traffic.cars]) g.traffic.despawn(c); g.traffic.enabled = false; });
// 2. Kopi Gao boost: speed lines
await place(603, -238, 0, 22);
await page.waitForTimeout(600);
await key('KeyB', true); await page.waitForTimeout(1300); await shot('2-boost'); await key('KeyB', false);
console.log('boost', await page.evaluate(() => ({ lines: __game.juice.lines.mesh.visible, amt: __game.juice.lines.amt.toFixed(2), kmh: Math.round(__game.player.vehicle.speed * 3.6) })));

// 3. handbrake drift: tyre smoke
await place(603, -238, 0, 24);
await page.waitForTimeout(500);
await key('Space', true); await key('KeyD', true); await page.waitForTimeout(800); await shot('3-drift'); await key('Space', false); await key('KeyD', false);

// 4. scrape along the parapet: sparks
await page.evaluate(() => { const g = __game, j = g.juice, orig = j.contact.bind(j); g.__contacts = 0; j.contact = (...a) => { g.__contacts++; return orig(...a); }; });
await place(603, -238, 0.05, 24);
for (let i = 0; i < 60; i++) { await page.waitForTimeout(30); if (await page.evaluate(() => __game.fx.spark.live > 0 || __game.fx.spark.n > 0)) break; }
await page.waitForTimeout(60); await shot('4-scrape');
await page.waitForTimeout(150); await shot('4-scrape-b');
console.log('sparks live', await page.evaluate(() => ({ live: __game.fx.spark.live, contacts: __game.__contacts })));

// 5. big crash into a building: slow motion
const crash = await page.evaluate(async () => {
  const g = __game, T = g.camera.position.constructor;
  // head-on into the nearest wall 25-60 m away across open ground
  const o = { x: 470, y: 1, z: 150 }; let yaw = 0, best = 1e9;
  for (let a = 0; a < 24; a++) { const t = a / 24 * Math.PI * 2, hit = g.physics.raycast(o, { x: -Math.sin(t), y: 0, z: -Math.cos(t) }, 60); if (hit && hit.toi > 25 && hit.toi < best) { best = hit.toi; yaw = t; } }
  g.relocate(new T(o.x, 0, o.z), yaw, { exact: true });
  const v = g.player.vehicle; v.grace = 0; v.body.setLinvel({ x: -Math.sin(yaw) * 26, y: 0, z: -Math.cos(yaw) * 26 }, true); g.cameraRig.yaw = yaw;
  let minScale = 1; const t0 = performance.now();
  while (performance.now() - t0 < 3000) { await new Promise(r => requestAnimationFrame(r)); minScale = Math.min(minScale, g.simScale); }
  return { minScale, health: Math.round(v.health), wall: best, contacts: g.__contacts, sparks: g.fx.spark.n };
});
console.log('crash', JSON.stringify(crash));
await shot('5-after-crash');
console.log('programs compiled since load:', await page.evaluate(() => __game.R.renderer.info.programs.length - window.__p0));
if (errs.length) console.log('errors:', errs.slice(0, 6));
await h.browser.close();
