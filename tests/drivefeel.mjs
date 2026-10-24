// Driving smoothness: node tests/drivefeel.mjs [hz=60|120|var] [car=sedan] [secs=8]
// Holds throttle (with a few steering inputs) and records, every rendered frame, the car's drawn position, the camera
// and Tommy's seat. Reports judder metrics that should be ~0 for smooth motion:
//   carJerk  RMS frame-to-frame change of the car's drawn velocity (m/s per frame) — judder shows up as 0/2-step frames
//   camRel   RMS second difference of the car's position relative to the camera (cm) — what you see as shake on screen
//   seatOff  spread of Tommy's offset from the car (cm) — he should be glued to the seat
// hz=120 replaces requestAnimationFrame with an ~8.3 ms timer (a ProMotion display); hz=var adds random frame jitter.
import { chromium } from './lib/browser.mjs';
const [hz = '60', car = 'sedan', secs = '8'] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
page.on('pageerror', e => console.log('[pageerror]', e.message)); page.on('console', m => { if (m.type() === 'error' || m.text().startsWith('lane')) console.log('[' + m.type() + ']', m.text().slice(0, 240)); });
if (hz !== '60') await page.addInitScript(mode => {
  const raf = window.requestAnimationFrame.bind(window);
  let next = performance.now();
  window.requestAnimationFrame = cb => {
    const period = mode === 'var' ? 1000 / 60 * (0.6 + Math.random() * 0.9) : 1000 / 120;
    next = Math.max(next + period, performance.now() + 1);
    return setTimeout(() => cb(performance.now()), next - performance.now());
  };
  window.__raf = raf;
}, hz);
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&fixedres&q=medium' + (process.env.Q ? '&' + process.env.Q : ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.evaluate(car => {
  const g = __game;
  // empty roads: kinematic AI traffic in the lane ahead would block the run
  g.traffic.enabled = false; for (const c of [...g.traffic.cars]) g.traffic.despawn(c);
  // the straightest long arterial lane (straight-line distance / path length, length > 450 m), outermost lane
  let best = null;
  for (const l of g.roadnet.lanes) {
    if (l.cls > 3 || l.path.length < 220 || l.path.p.some(q => Math.abs(q[1]) > 0.5)) continue;
    const P = l.path.p, chord = Math.hypot(P.at(-1)[0] - P[0][0], P.at(-1)[2] - P[0][2]);
    const score = chord / l.path.length * Math.min(1, l.path.length / 600);
    if (!best || score > best.score) best = { l, score };
  }
  const P = best.l.path.p;
  void g.debugTp(P[0][0], P[0][2], 0); void g.debugCar(car);
  window.__laneLen = best.l.path.length; console.log("lane", best.l.path.length.toFixed(0), best.score.toFixed(3), P[0][0].toFixed(0), P[0][2].toFixed(0));
  window.__rec = [];
  // sample after each game frame: a rAF callback queued from inside the game's own rAF callback runs next frame,
  // so chain off the game loop instead (wrap Renderer.render, the last thing tick() does)
  const R = g.R, render = R.render.bind(R);
  R.render = dt => {
    render(dt);
    const v = g.player.vehicle; if (!v) return;
    const p = v.root.position, c = g.camera.position, s = g.player.root.position;
    const inv = v.root.quaternion.clone().invert();
    const so = s.clone().sub(p).applyQuaternion(inv);
    const f = p.clone().set(0, 0, -1).applyQuaternion(v.root.quaternion);
    __rec.push([g._last, p.x, p.y, p.z, c.x, c.y, c.z, so.x, so.y, so.z, v.speed, Math.atan2(-f.x, -f.z), Math.asin(Math.max(-1, Math.min(1, f.y)))]);
  };
}, car);
await page.waitForTimeout(800);
await page.evaluate(() => { __rec.length = 0; });
// AUTO=1: Claudia's autopilot drives a real route (steering included) instead of holding W on the straightest lane
if (process.env.AUTO) await page.evaluate(car => { const g = __game; const v = g.player.vehicle; if (v) { g.player.exitVehicle(true); v.dispose(); g.vehicles.splice(g.vehicles.indexOf(v), 1); } void g.debugTp(-60, 1000, 0); void g.debugCar(car); g.autopilot.engage({ x: 900, z: 250 }); }, car);
else await page.keyboard.down('KeyW');
const T = +secs * 1000;
for (let t = 0; t < T; t += 1000) {
  if (process.env.STRAIGHT || process.env.AUTO) { await page.waitForTimeout(1000); continue; }
  if (t === 3000 || t === 6000) { await page.keyboard.down('KeyA'); await page.waitForTimeout(350); await page.keyboard.up('KeyA'); await page.waitForTimeout(650); continue; }
  if (t === 4000) { await page.keyboard.down('KeyD'); await page.waitForTimeout(350); await page.keyboard.up('KeyD'); await page.waitForTimeout(650); continue; }
  await page.waitForTimeout(1000);
}
if (!process.env.AUTO) await page.keyboard.up('KeyW');
const rec = await page.evaluate(() => __rec);
if (process.env.DBG) console.log(await page.evaluate(() => { const g = __game, v = g.player.vehicle; return JSON.stringify({ inList: g.vehicles.includes(v), n: g.vehicles.length, post: g.physics.postStepCallbacks.length, p1: v.pose.p1, body: v.body.translation(), root: v.root.position, alpha: g.physics.alpha, same: v.root === g.player.vehicle.root }); }));
if (process.env.DBG) console.log(JSON.stringify(rec[0]), JSON.stringify(rec[Math.floor(rec.length / 2)]), JSON.stringify(rec.at(-1)));
await browser.close();
// metrics
const n = rec.length, dts = [];
let jerk = 0, jn = 0, rel = 0, rn = 0;
const vel = [];
for (let i = 1; i < n; i++) {
  const dt = (rec[i][0] - rec[i - 1][0]) / 1000; dts.push(dt * 1000);
  vel.push([(rec[i][1] - rec[i - 1][1]) / dt, (rec[i][3] - rec[i - 1][3]) / dt]);
}
for (let i = 1; i < vel.length; i++) { const dx = vel[i][0] - vel[i - 1][0], dz = vel[i][1] - vel[i - 1][1]; jerk += dx * dx + dz * dz; jn++; }
for (let i = 2; i < n; i++) {
  const r = k => [rec[k][1] - rec[k][4], rec[k][2] - rec[k][5], rec[k][3] - rec[k][6]];
  const a = r(i), b = r(i - 1), c = r(i - 2);
  const d = [a[0] - 2 * b[0] + c[0], a[1] - 2 * b[1] + c[1], a[2] - 2 * b[2] + c[2]];
  rel += d[0] ** 2 + d[1] ** 2 + d[2] ** 2; rn++;
}
// yaw twitch: RMS change of yaw rate between frames (rad/s per frame); pitch wobble: RMS pitch rate (rad/s)
let yj = 0, yn = 0, pr = 0, pn = 0, prevYr = null;
for (let i = 1; i < n; i++) {
  const dt = (rec[i][0] - rec[i - 1][0]) / 1000; let dy = rec[i][11] - rec[i - 1][11]; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  const yr = dy / dt; if (prevYr !== null) { yj += (yr - prevYr) ** 2; yn++; } prevYr = yr;
  pr += ((rec[i][12] - rec[i - 1][12]) / dt) ** 2; pn++;
}
const so = rec.map(r => [r[7], r[8], r[9]]);
const mean = [0, 1, 2].map(k => so.reduce((s, v) => s + v[k], 0) / so.length);
const seat = Math.sqrt(so.reduce((s, v) => s + (v[0] - mean[0]) ** 2 + (v[1] - mean[1]) ** 2 + (v[2] - mean[2]) ** 2, 0) / so.length);
dts.sort((a, b) => a - b);
console.log(JSON.stringify({
  hz, car, frames: n, dtMed: dts[dts.length >> 1]?.toFixed(1), dtP95: dts[Math.floor(dts.length * 0.95)]?.toFixed(1),
  topKmh: Math.round(Math.max(...rec.map(r => r[10])) * 3.6),
  kmhPerSec: Array.from({ length: Math.floor((rec.at(-1)[0] - rec[0][0]) / 1000) }, (_, k) => Math.round((rec.find(r => r[0] - rec[0][0] >= k * 1000 + 999) || rec.at(-1))[10] * 3.6)).join(','),
  carJerk: Math.sqrt(jerk / jn).toFixed(2), yawTwitch: Math.sqrt(yj / yn).toFixed(3), pitchRate: Math.sqrt(pr / pn).toFixed(3), camRel_cm: (Math.sqrt(rel / rn) * 100).toFixed(2), seatOff_cm: (seat * 100).toFixed(2),
}));
