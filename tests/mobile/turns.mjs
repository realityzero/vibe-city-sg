// How AI traffic drives: per car and frame (hooked onto Traffic.update) the body's speed, yaw rate, lateral /
// longitudinal acceleration and jerk, taken from the drawn pose, and how far it is off its lane line; per junction turn
// the entry / minimum / exit speed and the peaks inside it; plus what must never happen — cars overlapping each other
// (oriented boxes), entering a junction on red, turning on the spot (yaw rate the wheelbase can't give at that speed),
// stopping for good.
//   node tests/mobile/turns.mjs [--url http://127.0.0.1:5174/] [--secs 90] [--spots x,z;x,z] [--q low] [--strip /tmp/t]
// --strip also films a car turning left and one turning right at a junction from ~26 m up (<prefix>_L|R_strip.png).
// WORST=1 lists the hardest decelerations, far-off-line and stuck cars with what was around them.
import { chromium } from '../lib/browser.mjs';
const args = process.argv.slice(2), arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const url = arg('--url', 'http://127.0.0.1:5174/'), secs = +arg('--secs', 90), strip = arg('--strip', null), q = arg('--q', null);
const spots = arg('--spots', '-60,1000;-600,-60').split(';').map(s => s.split(',').map(Number));
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(new URL('?skipTitle&newgame&freeroam=1&fixedres' + (q ? '&q=' + q : ''), url).href, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 240000 });

// in-page recorder: everything is derived from what is drawn (c.pos, c.yaw), not from the AI's own variables
await page.evaluate(() => {
  const g = __game, T = g.traffic, net = g.roadnet, _v = g.camera.position.clone(), _u = _v.clone(), wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const R = window.__turns = { frames: 0, carFrames: 0, lat: [], lon: [], jerkLat: [], jerkLon: [], yawRate: [], off: [], worst: [], pivot: 0, overSteer: 0, turns: [], overlap: 0, overlapPairs: new Set(), kinds: {}, red: 0, lateAmber: 0, hardStops: 0, stuck: new Set(), dist: 0, time: 0, active: 0, inView: 0 };
  const prev = new Map();
  const orig = T.update.bind(T);
  T.update = dt => {
    orig(dt);
    if (!R.on || !(dt > 0)) return;
    R.frames++; R.time += dt;
    const cars = T.cars.filter(c => c.state === 'drive'); R.active += cars.length;
    // cars the camera faces within 150 m (not occlusion-aware): what visible traffic density there is
    const cam = g.camera.position, cf = g.camera.getWorldDirection(_u);
    for (const c of cars) { const dx = c.pos.x - cam.x, dz = c.pos.z - cam.z, dd = Math.hypot(dx, dz); if (dd < 150 && (dx * cf.x + dz * cf.z) / (dd * Math.hypot(cf.x, cf.z) || 1) > 0.5) R.inView++; }
    const seen = new Set();
    for (const c of cars) {
      seen.add(c.id);
      const p = prev.get(c.id), x = c.pos.x, z = c.pos.z, yaw = c.yaw;
      if (!p) { prev.set(c.id, { x, z, yaw, n: 0, mode: c.mode, lane: c.lane, conn: c.conn }); continue; }
      const vx = (x - p.x) / dt, vz = (z - p.z) / dt, v = Math.hypot(vx, vz), r = wrap(yaw - p.yaw) / dt;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = -fz, rz = fx; // forward, right
      p.n++;
      if (p.n >= 3) {
        const ax = (vx - p.vx) / dt, az = (vz - p.vz) / dt, aLat = ax * rx + az * rz, aLon = ax * fx + az * fz;
        if (p.n >= 4) { R.jerkLat.push(Math.abs(aLat - p.aLat) / dt); R.jerkLon.push(Math.abs(aLon - p.aLon) / dt); }
        R.lat.push(Math.abs(aLat)); R.lon.push(aLon); if (aLon < -15) R.hardStops++; // no tyre stops a car that hard R.yawRate.push(Math.abs(r)); R.carFrames++;
        p.aLat = aLat; p.aLon = aLon;
        // turning on the spot: yaw rate the car's own wheelbase can't produce at this speed (max lock ~0.6 rad)
        if (Math.abs(r) > 0.05 && Math.abs(r) > v * Math.tan(0.62) / c.spec.wheelBase * 1.15 + 0.02) { R.pivot++; if (R.worst.length < 400) R.worst.push(['pivot', +r.toFixed(2), +v.toFixed(2), +c.speed.toFixed(2), c.mode, +(c.steer || 0).toFixed(2), c.type]); }
        if (-aLon > 12 && R.worst.length < 400) {
          // what stopped it: the nearest car ahead in a forward cone (any lane), or an obstacle (player / pedestrian)
          const fx2 = -Math.sin(c.yaw), fz2 = -Math.cos(c.yaw); let near = null;
          for (const o of T.cars) { if (o === c) continue; const dx = o.pos.x - x, dz = o.pos.z - z, ah = dx * fx2 + dz * fz2, lt = Math.abs(dx * -fz2 + dz * fx2); if (ah > 0 && ah < 8 && lt < 2.5 && (!near || ah < near[1])) near = ['car', +ah.toFixed(1), +lt.toFixed(1), o.mode, o.mode === 'conn' && o.fromLane === c.lane ? 'sameFrom' : o.mode === 'conn' && c.mode === 'conn' && o.conn.lane === c.conn.lane ? 'merge' : o.lane === c.lane ? 'sameLane' : '']; }
          for (const ob of T.obstacles) { const dx = ob.x - x, dz = ob.z - z, ah = dx * fx2 + dz * fz2, lt = Math.abs(dx * -fz2 + dz * fx2); if (ah > 0 && ah < 8 && lt < 2.5 && (!near || ah < near[1])) near = [ob.player ? 'player' : 'ped', +ah.toFixed(1), +lt.toFixed(1)]; }
          R.worst.push(['decel', +aLon.toFixed(0), +Math.hypot(p.vx, p.vz).toFixed(1), c.mode, c.type, near]);
        }
        if (v < 0.3 && Math.abs(r) > 0.05) R.overSteer++;
        const t = p.turn; if (t) { t.vMin = Math.min(t.vMin, v); t.lat = Math.max(t.lat, Math.abs(aLat)); t.dec = Math.max(t.dec, -aLon); if (p.n >= 4) t.jerk = Math.max(t.jerk, Math.abs(aLat - p.aLatPrev) / dt); }
        p.aLatPrev = aLat;
      }
      // junction entry / exit
      if (p.mode === 'lane' && c.mode === 'conn') {
        // on red (amber turns red at 21 s of the 46 s cycle: a car committed on amber may still be crossing the line
        // just after; count only entries more than 1 s into red)
        const sg = net.nodes[p.lane.to].signal;
        if (sg && net.signalFor(p.lane) === 'red') { const local = (p.lane.phase || 0) === 0 ? sg.t : (sg.t + 23) % 46; if (local - 21 > 1) R.red++; else R.lateAmber++; }
        const turn = c.conn.turn;
        if (Math.abs(turn) > 0.6 && Math.abs(turn) < 2.5) p.turn = { turn: +turn.toFixed(2), vIn: v, vMin: v, lat: 0, dec: 0, jerk: 0, off: 0, type: c.type };
      }
      if (p.mode === 'conn' && c.mode === 'lane' && p.turn) { p.turn.vOut = v; R.turns.push(p.turn); p.turn = null; }
      // how far the drawn body is off the lane / connector line, at the AI's own progress point
      (c.mode === 'lane' ? c.lane.path : c.conn.path).sample(c.mode === 'lane' ? c.s : c.cs, _v, _u);
      const ul = Math.hypot(_u.x, _u.z) || 1, off = Math.abs(((x - _v.x) * -_u.z + (z - _v.z) * _u.x) / ul);
      R.off.push(off); if (p.turn) p.turn.off = Math.max(p.turn.off, off);
      if (off > 3 && R.worst.length < 400) R.worst.push(['off', +off.toFixed(1), c.mode, c.mode === 'conn' ? +c.conn.turn.toFixed(2) : 0, +(c.mode === 'conn' ? c.cs : c.s).toFixed(1), +(c.mode === 'conn' ? c.conn.path.length : c.lane.s1).toFixed(1), +c.speed.toFixed(1), +(c.steer || 0).toFixed(2), c.type, c.id]);
      if (c.wait > 60 && !R.stuck.has(c.id)) {
        R.stuck.add(c.id);
        const lg = T.leaderGap(c), sig = c.mode === 'lane' ? net.signalFor(c.lane) : '-';
        if (R.worst.length < 400) R.worst.push(['stuck', c.type, c.mode, +off.toFixed(1), +lg.gap.toFixed(1), lg.person, sig, c.mode === 'lane' ? +(c.lane.s1 - c.s).toFixed(1) : +c.cs.toFixed(1), c.mode === 'conn' ? +c.conn.turn.toFixed(2) : c.nextConn ? +c.nextConn.turn.toFixed(2) : null]);
      }
      R.dist += v * dt;
      Object.assign(p, { x, z, yaw, vx, vz, mode: c.mode, lane: c.lane, conn: c.conn });
    }
    for (const id of prev.keys()) if (!seen.has(id)) prev.delete(id);
    // overlapping bodies (2D oriented boxes, separating axis): penetration > 0.25 m counts
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j], dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      if (dx * dx + dz * dz > 100) continue;
      let pen = Infinity;
      for (const [c, o] of [[a, b], [b, a]]) for (const k of [0, 1]) {
        const ux = k ? -Math.sin(c.yaw) : Math.cos(c.yaw), uz = k ? -Math.cos(c.yaw) : -Math.sin(c.yaw);
        const ext = car => { const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw); return Math.abs(fx * ux + fz * uz) * car.spec.length / 2 + Math.abs(-fz * ux + fx * uz) * car.spec.width / 2; };
        const d = Math.abs(dx * ux + dz * uz);
        pen = Math.min(pen, ext(a) + ext(b) - d);
      }
      if (pen > 0.25) {
        R.overlap++;
        const key = Math.min(a.id, b.id) + ':' + Math.max(a.id, b.id);
        if (!R.overlapPairs.has(key)) { R.overlapPairs.add(key); const m = [a, b].map(c => c.mode === 'conn' ? (Math.abs(c.conn.turn) > 0.5 ? 'turn' : 'conn') : 'lane').sort().join('+'); R.kinds[m] = (R.kinds[m] || 0) + 1; }
      }
    }
  };
});

const pct = (a, q) => { if (!a.length) return 0; const s = Float64Array.from(a).sort(); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
const out = { url, secs, spots: [] };
for (const [x, z] of spots) {
  await page.evaluate(([x, z]) => { const g = __game; g.relocate(new g.camera.position.constructor(x, 0, z), 0); }, [x, z]);
  await page.waitForTimeout(6000); // seeding + settle
  await page.evaluate(() => { const R = __turns; Object.assign(R, { on: true, frames: 0, carFrames: 0, lat: [], lon: [], jerkLat: [], jerkLon: [], yawRate: [], off: [], worst: [], pivot: 0, overSteer: 0, turns: [], overlap: 0, overlapPairs: new Set(), kinds: {}, red: 0, lateAmber: 0, hardStops: 0, stuck: new Set(), dist: 0, time: 0, active: 0, inView: 0 }); });
  await page.waitForTimeout(secs * 1000);
  const r = await page.evaluate(() => { const R = __turns; R.on = false; return { ...R, overlapPairs: R.overlapPairs.size, stuck: R.stuck.size }; });
  const T = r.turns, med = (f) => pct(T.map(f), 0.5), p95 = (f) => pct(T.map(f), 0.95);
  out.spots.push({
    at: [x, z], gameSecs: +r.time.toFixed(0), fps: +(r.frames / r.time).toFixed(0), cars: +(r.active / r.frames).toFixed(0), facingWithin150m: +(r.inView / r.frames).toFixed(1), flow_m_per_s: +(r.dist / r.time).toFixed(0),
    latAcc: { p50: +pct(r.lat, 0.5).toFixed(2), p95: +pct(r.lat, 0.95).toFixed(2), p99: +pct(r.lat, 0.99).toFixed(2), max: +pct(r.lat, 1).toFixed(1) },
    decel: { p99: +(-pct(r.lon, 0.01)).toFixed(2), max: +(-pct(r.lon, 0)).toFixed(1) }, hardStopsPerMin: +(r.hardStops / r.time * 60).toFixed(1),
    jerkLat: { p95: +pct(r.jerkLat, 0.95).toFixed(1), p99: +pct(r.jerkLat, 0.99).toFixed(1) }, jerkLon: { p95: +pct(r.jerkLon, 0.95).toFixed(1), p99: +pct(r.jerkLon, 0.99).toFixed(1) },
    yawRate: { p99: +pct(r.yawRate, 0.99).toFixed(2), max: +pct(r.yawRate, 1).toFixed(2) },
    offLine: { p95: +pct(r.off, 0.95).toFixed(2), p99: +pct(r.off, 0.99).toFixed(2), max: +pct(r.off, 1).toFixed(1) }, turnOff_p95: +p95(t => t.off).toFixed(2),
    pivotFrames: r.pivot, yawWhileStopped: r.overSteer, carFrames: r.carFrames,
    turns: T.length, turnEntry: { p50: +med(t => t.vIn).toFixed(1), p95: +p95(t => t.vIn).toFixed(1) }, turnMinSpeed_p50: +med(t => t.vMin).toFixed(1),
    stopsInTurn: T.filter(t => t.vMin < 0.5).length, turnLat: { p50: +med(t => t.lat).toFixed(2), p95: +p95(t => t.lat).toFixed(2) }, turnDecel_p95: +p95(t => t.dec).toFixed(2), turnJerkLat_p95: +p95(t => t.jerk).toFixed(1),
    worst: process.env.WORST ? r.worst.slice(0, 40) : undefined,
    overlapFrames: r.overlap, overlapPairs: r.overlapPairs, overlapKinds: r.kinds, redRuns: r.red, enteredAsRedBegan: r.lateAmber, stuckOver60s: r.stuck,
  });
  console.log(JSON.stringify(out.spots.at(-1)));
}

if (strip) {
  // one left and one right turn: a red sedan put on an empty approach 40 m before a junction (green or unsignalised for
  // long enough), told to turn; a fixed camera ~26 m above the turn (over the tree canopies)
  await page.evaluate(([x, z]) => { const g = __game; g.relocate(new g.camera.position.constructor(x, 0, z), 0); }, spots[0]);
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    const g = __game; g.sky.time = 13; g.weather.force?.(0); g.player.root.visible = false;
    const cv = g.R.renderer.domElement; // nothing but the 3D view (prompts, phone toasts)
    for (const el of document.body.querySelectorAll('*')) if (el !== cv && !el.contains(cv)) el.style.visibility = 'hidden';
  });
  for (const side of [-1, 1]) {
    let pick = null;
    for (let tries = 0; tries < 90 && !pick; tries++) {
      pick = await page.evaluate(side => {
        const g = __game, T = g.traffic, net = g.roadnet, p = g.player.position;
        for (const l of net.lanesNear(p.x, p.z, 220)) {
          if (l.cls > 5 || l.s1 - l.s0 < 42 || l.cars.some(o => o.s > l.s1 - 46)) continue;
          const conn = l.next.find(c => Math.sign(c.turn) === side && Math.abs(c.turn) > 1.2 && Math.abs(c.turn) < 2.0 && c.lane.s1 - c.lane.s0 > 20);
          const node = net.nodes[l.to];
          if (!conn) continue;
          const sg = node.signal;
          if (sg) { const local = (l.phase || 0) === 0 ? sg.t : (sg.t + 23) % 46; if (local > 18 - 9) continue; } // green for 9 s more
          const c = T.spawnAt(l, l.s1 - 40, 'sedan', 0xc8202a); if (!c) continue;
          c.keep = true; c.speed = 8; c.nextConn = conn; c.nextConn2 = T.pickNext(conn.lane); window.__stripCar = c;
          const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw), V = g.camera.position.constructor, m = conn.path.sample(conn.path.length / 2, new V());
          g.cameraRig.override = { position: new V(m.x - fx * 6, m.y + 26, m.z - fz * 6), lookAt: new V(m.x - fx * 2, m.y, m.z - fz * 2), snap: true, fov: 50 };
          return { id: c.id, turn: +conn.turn.toFixed(2), node: [Math.round(node.x), Math.round(node.z)], signal: !!sg };
        }
        return null;
      }, side);
      if (!pick) await page.waitForTimeout(500);
    }
    console.log('strip car', side < 0 ? 'left' : 'right', JSON.stringify(pick));
    if (!pick) continue;
    const shots = [], tag = `${strip}_${side < 0 ? 'L' : 'R'}`;
    for (let i = 0; i < 80 && shots.length < 8; i++) {
      const st = await page.evaluate(() => { const c = __stripCar; return { mode: c.mode, remain: c.mode === 'lane' ? c.lane.s1 - c.s : -c.cs, v: c.speed }; });
      if (shots.length || st.mode === 'conn' || st.remain < 6) { const f = `${tag}_${shots.length}.png`; await page.screenshot({ path: f }); shots.push({ f, ...st }); }
      await page.waitForTimeout(shots.length ? 300 : 60);
    }
    await page.evaluate(() => { __stripCar.keep = false; });
    console.log('strip frames', JSON.stringify(shots.map(s => `${s.mode} ${s.remain.toFixed(1)} ${s.v.toFixed(1)}m/s`)));
    // contact sheet: 4 x 2
    const fs = await import('fs');
    const imgs = shots.map(s => 'data:image/png;base64,' + fs.readFileSync(s.f).toString('base64'));
    const sheet = await browser.newPage({ viewport: { width: 4 * 480, height: 2 * 270 } });
    await sheet.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(4,480px);background:#000">${imgs.map((d, i) => `<div style="position:relative"><img src="${d}" style="width:480px;height:270px;display:block"><b style="position:absolute;left:6px;top:4px;color:#fff;font:bold 16px sans-serif;text-shadow:0 0 3px #000">${i + 1}</b></div>`).join('')}</body>`);
    await sheet.waitForTimeout(300);
    await sheet.screenshot({ path: `${tag}_strip.png` }); await sheet.close();
    console.log('strip', `${tag}_strip.png`);
  }
}
await browser.close();
