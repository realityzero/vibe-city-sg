// Fine City Getaway end to end (missions/getaway.js): new game in free roam, walk into the activity marker on Raffles
// Quay, get in Uncle Ah Seng's cab and drive it to SGH (Outram Road) with a bot that keeps the rules the way a
// careful player would: a route off the ERP roads (the lane-graph router to a waypoint and on, the waypoint chosen so
// neither leg passes a gantry), 80 km/h but 63 (under the cameras' 70) near a camera, 34 in the hospital zones, stopping at red and
// amber lights before the stop line, stopping for anyone crossing (the steering is the game's own PathDriver), on
// streets cleared of traffic. Passes when the job does with S$0 of fines and no program compiled for it.
// --fail instead drives the cab through a speed camera at 90 km/h, --red through a red light at 50, and expects the
// job to fail on the ticket.
//   node tests/scratch/getaway.mjs [--url http://127.0.0.1:4173/] [--set phone|desktop] [--out /tmp/vc-getaway] [--fail | --red]
import { launch } from '../mobile/lib.mjs';
import fs from 'fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), SET = arg('set', 'desktop'), OUT = arg('out', '/tmp/vc-getaway'), RED = process.argv.includes('--red'), FAIL = RED || process.argv.includes('--fail');
fs.mkdirSync(OUT, { recursive: true });
const phone = SET === 'phone';
const h = await launch('chromium', { exclusive: false, device: phone ? undefined : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 } });
const { page } = h, errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=10${phone ? '&q=low' : '&q=high'}&fixedres`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play' && __game.player.controlsEnabled, null, { timeout: 300000, polling: 200 });
const T0 = Date.now(), log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);
const shot = async n => { const f = `${OUT}/${SET}${RED ? '-red' : FAIL ? '-fail' : ''}-${n}.png`; await page.screenshot({ path: f, timeout: 90000 }).then(() => log('shot', f), e => log('shot failed', f, e.message.split('\n')[0])); };
await page.evaluate(() => { const g = __game; g.timeScale = 0; window.__fines0 = g.progress.stats.fines; window.__p0 = new Set(g.R.renderer.info.programs); });

// ---- the activity marker starts the job; Uncle's texts; into the cab
await page.evaluate(() => { const a = __game.activities.list.find(a => a.id === 'getaway'); __game.debugTp(a.pos.x, a.pos.z, 0); });
await page.waitForFunction(() => __game.missions.active?.mission.id === 'fine_city_getaway', null, { timeout: 20000, polling: 100 });
await page.waitForTimeout(3000); await shot('1-texts');
await page.evaluate(() => { const g = __game, cab = g.vehicles[g.vehicles.length - 1]; g.player.teleport(cab.position.clone(), cab.yaw()); g.player.enterVehicleImmediate(cab); g.cameraRig.yaw = cab.yaw(); window.__cab = cab; });
await page.waitForFunction(() => __game.missions.markers.size > 0 && !!document.querySelector('.vc-tracker:not(.vc-hidden)'), null, { timeout: 10000, polling: 100 });
await page.waitForTimeout(1200); await shot('2-rules');
const st = () => page.evaluate(() => { const g = __game, c = window.__cab; return `${g.missions.active ? 'on' : 'off'} ${document.querySelector('.vc-tracker:not(.vc-hidden) .val')?.textContent || '-'} @${Math.round(c.position.x)},${Math.round(c.position.z)} ${Math.round(c.speed * 3.6)} km/h fines S$${g.progress.stats.fines - window.__fines0} wanted ${g.wanted.stars} ${window.__bot?.note || ''}`; });

if (RED) {
  // up to the stop line of a signalised approach near the cab at 50 km/h, its light just turned red
  log(await page.evaluate(() => {
    const g = __game, net = g.roadnet, c = window.__cab, P = c.position;
    g.traffic.target = 0; for (const o of [...g.traffic.cars]) g.traffic.despawn(o); // (no queue at the light)
    const l = net.lanes.filter(l => l.cls <= 3 && !l.edge.y && net.nodes[l.to].signal && l.s1 - l.s0 > 60)
      .sort((a, b) => Math.hypot(a.path.x(0) - P.x, a.path.z(0) - P.z) - Math.hypot(b.path.x(0) - P.x, b.path.z(0) - P.z))[0];
    const n = net.nodes[l.to], local = (l.phase || 0) === 0 ? n.signal.t : (n.signal.t + 23) % 46;
    net.signalClock += ((26 - local) % 46 + 46) % 46; // (red, 20 s of it left)
    const pos = new (P.constructor)(), dir = pos.clone(); l.path.sample(l.s1 - 35, pos, dir);
    const yaw = Math.atan2(-dir.x, -dir.z);
    g.player.teleport(pos, yaw); g.cameraRig.yaw = yaw; c.body.setLinvel({ x: dir.x * 14, y: 0, z: dir.z * 14 }, true);
    const st = g.input.stick; st.active = true; st.x = 0; st.y = 0.5;
    return `red light at node ${n.id}: ${net.signalFor(l)}`;
  }));
} else if (FAIL) {
  // through the nearest speed camera at 90 km/h
  log(await page.evaluate(() => {
    const g = __game, c = window.__cab, P = c.position, cam = g.wanted.cameras.slice().sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0];
    const n = g.roadnet.nearestLane(cam.x, cam.z, 40, l => l.cls <= 5), yaw = Math.atan2(-n.dir.x, -n.dir.z);
    n.lane.path.sample(Math.max(0, n.s - 30), n.pos);
    g.player.teleport(n.pos.clone(), yaw); g.cameraRig.yaw = yaw; c.body.setLinvel({ x: -Math.sin(yaw) * 25, y: 0, z: -Math.cos(yaw) * 25 }, true);
    const st = g.input.stick; st.active = true; st.x = 0; st.y = 1;
    return `camera at ${Math.round(cam.x)},${Math.round(cam.z)}`;
  }));
}
if (FAIL) {
  await page.waitForTimeout(RED ? 3000 : 2200); await shot('3-ticket');
  await page.waitForFunction(() => !__game.missions.active, null, { timeout: 15000, polling: 100 }).catch(() => {});
  await page.evaluate(() => { const st = __game.input.stick; st.active = false; st.x = st.y = 0; });
  await page.waitForTimeout(600); await shot('4-failed');
  const r = await page.evaluate(() => ({ active: !!__game.missions.active, log: __game.ui.logEntries.slice(-4).map(e => (e.speaker ? e.speaker + ': ' : '') + e.text.replace(/<[^>]+>/g, '')) }));
  log(JSON.stringify(r));
  const ok = !r.active && r.log.some(l => /Mission failed.*Saman/i.test(l));
  console.log(ok ? 'PASS' : 'FAIL', `getaway --${RED ? 'red' : 'fail'}`, SET, 'errors:', errs.length, errs.slice(0, 5));
  await h.browser.close(); process.exit(0);
}

// ---- the streets cleared of traffic, the lights all green and the police off for the bot (the rules are under test,
// not its driving in a jam, at a junction or past a pedestrian it clips; --red runs a red light)
await page.evaluate(() => { const g = __game, T = g.traffic; g.roadnet.allGreen = true; g.wanted.enabled = false; T.target = 0; const clear = () => { for (const c of [...T.cars]) T.despawn(c); if (g.missions.active) setTimeout(clear, 500); }; clear(); });

// ---- a clean route: via the waypoint whose two legs pass no ERP gantry, shortest first
log(await page.evaluate(() => {
  const g = __game, net = g.roadnet, c = window.__cab, D = window.__dest = [g.missions.markers.values().next().value.m.group.position.x, g.missions.markers.values().next().value.m.group.position.z];
  const G = g.extras.gantries;
  const segD = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)); return Math.hypot(ax + dx * t - px, az + dz * t - pz); };
  const clean = r => { for (let i = 1; i < r.length; i++) for (const q of G) if (segD(q.x, q.z, r[i - 1][0], r[i - 1][1], r[i][0], r[i][1]) < q.hw + 6) return false; return true; };
  // (on roads a car fits: no service lanes, and never through a building's outline — some lanes round the CBD
  // cut a building's corner, and the driver grinds along it)
  const roads = r => {
    for (let i = 1; i < r.length; i++) {
      const [ax, az] = r[i - 1], [bx, bz] = r[i], L = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s < L; s += 4) if (g.safe.insideBuilding(ax + (bx - ax) * s / L, az + (bz - az) * s / L, 0.3)) return false;
      if (i % 2 === 0) { const n = net.nearestLane(bx, bz, 5); if (n && n.lane.cls > 5) return false; }
    }
    return true;
  };
  // (and no doubling back or going round a block: a route that passes a place twice confuses the driver)
  const ux = D[0] - c.position.x, uz = D[1] - c.position.z, uL = Math.hypot(ux, uz);
  const onward = r => {
    let far = -Infinity, s = 0; const at = [];
    for (let i = 0; i < r.length; i++) {
      const [x, z] = r[i], a = ((x - c.position.x) * ux + (z - c.position.z) * uz) / uL; if (a < far - 120) return false; far = Math.max(far, a);
      if (i) s += Math.hypot(x - r[i - 1][0], z - r[i - 1][1]);
      for (const [px, pz, ps] of at) if (s - ps > 80 && Math.hypot(px - x, pz - z) < 15) return false;
      at.push([x, z, s]);
    }
    return true;
  };
  const len = r => { let s = 0; for (let i = 1; i < r.length; i++) s += Math.hypot(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]); return s; };
  let best = null, bl = Infinity;
  const direct = net.route(c.position.x, c.position.z, D[0], D[1]);
  if (direct && clean(direct) && onward(direct) && roads(direct)) { best = direct; bl = len(direct); }
  const why = { back: 0, road: 0 };
  if (!best) for (let x = -1600; x <= 300; x += 120) for (let z = 300; z <= 1500; z += 120) {
    const a = net.route(c.position.x, c.position.z, x, z)?.slice(0, -1); if (!a || !clean(a)) continue; // (without the waypoint itself: off the road)
    const [jx, jz] = a[a.length - 1], b = net.route(jx, jz, D[0], D[1]); if (!b || !clean(b)) continue; // (on from where the first leg ends)
    const r = a.concat(b), L = len(r); if (L >= bl) continue;
    if (!onward(r)) { why.back++; continue; } if (!roads(r)) { why.road++; continue; }
    bl = L; best = r;
  }
  window.__route = best || direct;
  return best ? `clean route ${Math.round(bl)} m, ${best.length} points (direct GPS route ${direct ? Math.round(len(direct)) : '-'} m, ${direct && clean(direct) ? 'clean' : 'under a gantry'})` : `no clean route (rejected: ${why.back} doubling back, ${why.road} off the road): the GPS route instead (${direct ? Math.round(len(direct)) : '-'} m, under a gantry)`;
}));

// ---- the bot: the game's own PathDriver (the class Claudia's autopilot drives with; the player's controls stay on, so
// the rules apply) steers along the route; this sets its speed by the rules every frame — 80 km/h, 63 within 70 m of
// a speed camera (under its 70), 34 in the hospital zones, stopped before a red or amber light (never inside a
// junction), behind the car in front in its lane, for anyone crossing
await page.evaluate(() => {
  const g = __game, net = g.roadnet, c = window.__cab, D = window.__dest;
  g.autopilot.engage(); const PathDriver = g.autopilot.state.drv.constructor; g.autopilot.disengage();
  const drv = new PathDriver(g, c, window.__route, { speed: 0.4, aggression: 0.5 });
  const bot = window.__bot = { note: '', stop: false };
  const live = () => g.missions.active && g.player.vehicle === c;
  const rules = () => {
    if (!live()) return;
    requestAnimationFrame(rules);
    const p = c.position, yaw = c.yaw(), fx = -Math.sin(yaw), fz = -Math.cos(yaw), v = c.speed;
    let target = 22; bot.note = '';
    if (g.wanted.cameras.some(q => Math.abs(q.x - p.x) < 70 && Math.abs(q.z - p.z) < 70)) { target = 17.5; bot.note = 'camera'; }
    if (g.fines.zones.some(Z => Math.hypot(Z.x - p.x, Z.z - p.z) < Z.r + 30)) { target = 9.5; bot.note = 'hospital zone'; }
    const toEnd = Math.hypot(D[0] - p.x, D[1] - p.z); if (toEnd < 45) target = Math.min(target, Math.max(0, toEnd - 2) * 0.35);
    const h = g.fines.laneUnder(p.x, p.z, fx, fz, 2.6);
    if (h && net.nodes[h.lane.to].signal && net.signalFor(h.lane) !== 'green') { const left = h.lane.s1 - h.s; if (left > 0 && left < 30) { target = Math.min(target, Math.max(0, left - 3) * 0.5); bot.note = 'red'; } }
    for (const o of g.traffic.cars) {
      const qx = o.pos.x - p.x, qz = o.pos.z - p.z, a = qx * fx + qz * fz, l = Math.abs(qx * fz - qz * fx), same = -Math.sin(o.yaw) * fx - Math.cos(o.yaw) * fz > 0.6;
      if (a > 0 && ((same && a < 7 + v * 1.2 && l < 1.8) || (a < 4.5 && l < 1.6))) { target = Math.min(target, Math.max(0, a - 6) * 0.5); bot.note = 'car ahead'; }
    }
    for (const o of g.traffic.obstacles || []) { if (o.player) continue; const qx = o.x - p.x, qz = o.z - p.z, a = qx * fx + qz * fz, l = Math.abs(qx * fz - qz * fx); if (a > 0 && a < 5 + v && l < 2.4) { target = 0; bot.note = 'someone crossing'; } }
    drv.speedMul = Math.max(0.03, target / c.spec.maxSpeed);
    bot.stop = target < 0.6;
  };
  const step = h => {
    if (!live()) { const cbs = g.physics.stepCallbacks, i = cbs.indexOf(step); if (i >= 0) cbs.splice(i, 1); return; }
    drv.update(h);
    if (bot.stop) c.setDriverControls({ throttle: 0, brake: c.speed > 1 ? 1 : 0, steer: 0, handbrake: c.speed <= 1 }, h);
  };
  g.physics.onStep(step); rules();
});
for (let i = 0; i < 110; i++) {
  await page.waitForTimeout(3000);
  log(await st());
  if (i === 3) await shot('3-driving');
  if (i % 8 === 7) await shot(`4-drive${i}`);
  if (!(await page.evaluate(() => !!__game.missions.active))) break;
}
await page.waitForTimeout(800); await shot('5-end');
const end = await page.evaluate(() => ({ side: __game.progress.side, fines: __game.progress.stats.fines - window.__fines0, newPrograms: __game.R.renderer.info.programs.filter(p => !window.__p0.has(p)).map(p => { const users = []; __game.scene.traverse(o => { for (const m of [].concat(o.material || [])) if (__game.R.renderer.properties.get(m).currentProgram === p) users.push(`${o.type}:${o.name || o.parent?.name || '?'} ${m.type}`); }); return `${p.name || '(unnamed)'} <- ${[...new Set(users)].slice(0, 3).join(' | ') || 'not in the scene'}`; }), log: __game.ui.logEntries.slice(-5).map(e => (e.speaker ? e.speaker + ': ' : '') + e.text.replace(/<[^>]+>/g, '')) }));
log(JSON.stringify(end, null, 1));
const pass = end.side?.fine_city_getaway === 1 && end.fines === 0 && !end.newPrograms.length;
console.log(pass ? 'PASS' : 'FAIL', 'fine_city_getaway', SET, 'errors:', errs.length, errs.slice(0, 5));
await h.browser.close();
