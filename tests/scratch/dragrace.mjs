// Ah Beng's drag race (missions/dragrace.js): new game in free roam, night, the Infernus put first at a red
// light on a straight multi-lane road; waits for the challenge, accepts (L), holds W on green; frames of each phase.
//   node tests/scratch/dragrace.mjs [--url http://127.0.0.1:4173/] [--set phone|desktop] [--out /tmp/vc-drag] [--lose]
import { launch } from '../mobile/lib.mjs';
import fs from 'fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), SET = arg('set', 'desktop'), OUT = arg('out', '/tmp/vc-drag'), LOSE = process.argv.includes('--lose');
fs.mkdirSync(OUT, { recursive: true });
const phone = SET === 'phone';
const h = await launch('chromium', { exclusive: false, device: phone ? undefined : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 } });
const { page } = h, errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
page.on('response', r => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url()}`); });
await page.goto(`${URL0}?skipTitle&newgame&freeroam=8${phone ? '&q=low' : '&q=high'}&fixedres`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play' && __game.player.controlsEnabled, null, { timeout: 300000, polling: 100 });
const setup = await page.evaluate(() => {
  const g = __game, net = g.roadnet;
  // a signalised kerb lane of a 2+ lane major road, with a long straight before and after the stop line
  // (how far its right-hand neighbour runs on nearly straight past the junction: the race needs ~430 m)
  const run = l => { let m = 0, cur = l, k = 0; while (cur && k++ < 8 && m < 450) { const b = cur.next.filter(o => Math.abs(o.turn) < 0.25).sort((a, b) => Math.abs(a.lane.idx - cur.idx) - Math.abs(b.lane.idx - cur.idx))[0]; cur = b?.lane; if (cur) m += cur.s1 - cur.s0; } return m; };
  const right = l => net.lanes.find(o => o.edge === l.edge && o.to === l.to && o.idx === l.idx + 1);
  const cand = net.lanes.filter(l => l.cls <= 3 && !l.edge.y && l.idx === 0 && l.nLanes >= 2 && net.nodes[l.to].signal && l.s1 - l.s0 > 80 && right(l) && run(right(l)) >= 440);
  const p = { x: 300, z: 300 }; cand.sort((a, b) => { const A = a.path, B = b.path; return Math.hypot(A.x(0) - p.x, A.z(0) - p.z) - Math.hypot(B.x(0) - p.x, B.z(0) - p.z); });
  const l = cand[0]; if (!l) return 'no lane';
  const pos = new (g.player.position.constructor)(), dir = pos.clone(); l.path.sample(l.s1 - 6, pos, dir);
  window.__lane = l;
  g.debugTp(pos.x, pos.z, Math.atan2(-dir.x, -dir.z)); g.debugCar('infernus');
  g.relocate(pos, Math.atan2(-dir.x, -dir.z), { exact: true });
  g.sky.time = 21.2; g.missions.timeFrozen = true;
  // this junction's red has 24 s left
  const n = net.nodes[l.to], local = (l.phase || 0) === 0 ? n.signal.t : (n.signal.t + 23) % 46; net.signalClock += ((22 - local) % 46 + 46) % 46;
  g.dragRace.coolT = 0; g.dragRace.chance = 1;
  // (the right-hand lane kept clear of queueing traffic, so he can roll up)
  const side = net.lanes.find(o => o.edge === l.edge && o.to === l.to && o.idx === l.idx + 1);
  const clear = () => { if (g.dragRace.state !== 'idle') return; for (const c of [...side.cars]) g.traffic.despawn(c); setTimeout(clear, 200); }; clear();
  return `lane ${l.id} @${Math.round(pos.x)},${Math.round(pos.z)} signal ${net.signalFor(l)}`;
});
console.log(setup);
await page.waitForTimeout(3000);
// why not (yet): canAsk's conditions one by one
console.log(await page.evaluate(() => {
  const g = __game, v = g.player.vehicle, d = g.dragRace, q = v.quaternion;
  const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y)), fl = Math.hypot(fx, fz);
  const h = g.fines.laneUnder(v.position.x, v.position.z, fx / fl, fz / fl, 2.2), lane = h?.lane;
  const side = lane && g.roadnet.lanesNear(v.position.x, v.position.z, 20).find(l => l.edge === lane.edge && l.to === lane.to && l.idx === lane.idx + 1);
  return JSON.stringify({ speed: v.speed, time: g.sky.time, mission: !!g.missions.active, ctl: g.player.controlsEnabled, lane: lane?.id, want: window.__lane.id, s: h?.s, s1: lane?.s1, red: lane && d.redLeft(lane),
    queue: lane?.cars.filter(c => c.s > h.s).map(c => Math.round(c.s)), side: side?.id, sideCars: side?.cars.map(c => Math.round(c.s)), cool: d.coolT, state: d.state,
    canAsk: !g.missions.active && d.canAsk(v), route: d.route?.length, ...why(g, lane, side, v) });
  // the side lane's road ahead, hop by hop (what straight() walks)
  function why(g, lane, side, v) {
    if (!side) return {};
    const hops = []; let l = side;
    for (let k = 0; k < 5 && l; k++) { hops.push(`${l.id}:${Math.round(l.s1 - l.s0)}m[${l.next.map(o => `${o.lane.id}/${o.turn.toFixed(2)}/i${o.lane.idx}`).join(' ')}]`); const b = l.next.find(o => Math.abs(o.turn) < 0.3); l = b?.lane; }
    const near = g.vehicles.filter(o => o !== v).map(o => Math.round(o.position.distanceTo(v.position)));
    return { hops, near };
  }
}));
const shot = async n => { const f = `${OUT}/${SET}-${n}.png`; await page.screenshot({ path: f }); console.log('shot', f); };
const st = () => page.evaluate(() => {
  const d = __game.dragRace, v = __game.player.vehicle, b = d.beng, P = o => o ? `${Math.round(o.position.x)},${Math.round(o.position.z)}` : '-';
  return `${d.state} t${(d.t || 0).toFixed(1)} kmh${v ? Math.round(v.speed * 3.6) : '-'} @${P(v)} beng ${b ? Math.round(b.speed * 3.6) : '-'}kmh @${P(b)} drv ${d.drv ? `${Math.round(d.drv.progress)}/${Math.round(d.drv.total)}${d.drv.done ? ' done' : ''}` : '-'} sig ${__game.roadnet.signalFor(window.__lane)} $${Math.round(__game.money)}`;
});
for (let i = 0; i < 60; i++) { await page.waitForTimeout(500); const s = await st(); if (!s.startsWith('idle')) break; if (i % 6 === 0) console.log(s); }
console.log(await st()); await shot('1-rollup');
await page.waitForFunction(() => __game.dragRace.state === 'ask' || __game.dragRace.state === 'idle', null, { timeout: 20000, polling: 100 }).catch(() => { });
console.log(await st()); await page.waitForTimeout(700); await shot('2-ask');
console.log('glow', await page.evaluate(() => { let m = null; __game.scene.traverse(o => { if (o.material?.uniforms?.uAmt && o.material.uniforms.uColor) m = o; }); const b = __game.dragRace.beng;
  return m ? JSON.stringify({ vis: m.visible, pos: m.position.toArray().map(Math.round), y: m.position.y, amt: m.material.uniforms.uAmt.value, night: __game.U.night.value, beng: b?.position.toArray(), parent: m.parent?.type }) : 'no mesh'; }));
if (phone) await page.locator('.b-flash').tap().catch(e => console.log('tap', e.message)); else await page.keyboard.press('KeyL');
await page.waitForTimeout(400); console.log(await st()); await shot('3-count');
await page.waitForFunction(() => window.__game.dragRace.lit >= 2 || __game.dragRace.state !== 'count', null, { timeout: 30000, polling: 50 });
await shot('4-lights');
await page.waitForFunction(() => __game.dragRace.state !== 'count', null, { timeout: 30000, polling: 30 });
// on green: drive down our own lane (Ah Beng's route, one lane to the left) with the touch stick
if (!LOSE) await page.evaluate(() => {
  const g = __game, r = g.dragRace.route, st = g.input.stick;
  // (a clean run for the frames: traffic out of the corridor ahead)
  const [x0, z0] = r[0], [x1, z1] = r[r.length - 1], L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L;
  for (const c of [...g.traffic.cars]) { const a = (c.pos.x - x0) * ux + (c.pos.z - z0) * uz, l = (c.pos.x - x0) * uz - (c.pos.z - z0) * ux; if (a > -5 && a < L + 20 && Math.abs(l) < 12) g.traffic.despawn(c); }
  const lane = r.map((p, i) => { const q = r[Math.min(i + 1, r.length - 1)], o = r[Math.max(i - 1, 0)], dx = q[0] - o[0], dz = q[1] - o[1], L = Math.hypot(dx, dz) || 1; return [p[0] + dz / L * 3.3, p[1] - dx / L * 3.3]; });
  const drive = () => {
    const v = g.player.vehicle; if (!v || g.dragRace.state !== 'race') { st.active = false; st.x = st.y = 0; return; }
    const p = v.position, yaw = v.yaw(), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let bi = 0, bd = 1e9; lane.forEach((q, i) => { const d = Math.hypot(q[0] - p.x, q[1] - p.z); if (d < bd) { bd = d; bi = i; } });
    const t = lane[Math.min(lane.length - 1, bi + 3)], dx = t[0] - p.x, dz = t[1] - p.z, ang = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz);
    st.active = true; st.x = Math.max(-1, Math.min(1, ang * 2)); st.y = 1;
    requestAnimationFrame(drive);
  };
  drive();
});
await page.waitForTimeout(250); await shot('5-go');
for (let i = 0; i < 4; i++) { await page.waitForTimeout(1500); console.log(await st()); await shot(`6-race${i}`); }
await page.waitForFunction(() => __game.dragRace.state !== 'race', null, { timeout: 30000, polling: 100 }).catch(() => { });
await page.waitForTimeout(500); console.log(await st()); await shot('7-result');
await page.waitForTimeout(3000); await shot('8-after');
if (errs.length) console.log('errors:', errs.slice(0, 6));
await h.browser.close();
