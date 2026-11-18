// Overlapping AI cars, classified: the same oriented-box test as tests/mobile/turns.mjs, but each overlapping pair is
// put in a class when first seen (same lane, adjacent lanes, a merge / diverge, a junction conflict, a fresh spawn...)
// with both cars' state, and whether either car's leader search sees the other.
//   node tests/scratch/overlaps.mjs [--url http://127.0.0.1:4173/] [--secs 60] [--spots x,z;x,z] [--q low] [--top 40]
import { chromium } from '../lib/browser.mjs';
const args = process.argv.slice(2), arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const url = arg('--url', 'http://127.0.0.1:4173/'), secs = +arg('--secs', 60), q = arg('--q', 'low'), top = +arg('--top', 40);
const spots = arg('--spots', '-60,1000;-600,-60').split(';').map(s => s.split(',').map(Number));
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(new URL('?skipTitle&newgame&freeroam=1&fixedres' + (q ? '&q=' + q : ''), url).href, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 240000 });
await page.evaluate(() => {
  const g = __game, T = g.traffic, net = g.roadnet;
  const R = window.__ovl = { on: false };
  R.reset = () => Object.assign(R, { frames: 0, overlap: 0, pairs: new Map(), cls: {}, clsPairs: {}, turnStops: {} });
  R.reset();
  const spawnAt = T.spawnAt.bind(T);
  T.spawnAt = (...a) => { const c = spawnAt(...a); if (c) c.born = T.clock; return c; };
  const classify = (a, b) => {
    if (a.mode === 'lane' && b.mode === 'lane') {
      if (a.lane === b.lane) return 'lane+lane same lane';
      if (a.lane.edge === b.lane.edge) return a.lane.from === b.lane.from ? 'lane+lane adjacent lanes' : 'lane+lane opposite lanes';
      if (a.lane.to === b.lane.from || b.lane.to === a.lane.from) return 'lane+lane consecutive lanes';
      if (a.lane.to === b.lane.to) return 'lane+lane merging (same end node)';
      if (a.lane.from === b.lane.from) return 'lane+lane diverging (same start node)';
      return 'lane+lane crossing';
    }
    if (a.mode === 'conn' && b.mode === 'conn') {
      if (a.connNodeId !== b.connNodeId) return 'conn+conn different junctions';
      if (a.conn === b.conn) return 'conn+conn same connector';
      if (a.conn.lane === b.conn.lane) return 'conn+conn merge (same target lane)';
      if (a.fromLane === b.fromLane) return 'conn+conn diverge (same source lane)';
      return 'conn+conn crossing';
    }
    const l = a.mode === 'lane' ? a : b, c = a.mode === 'lane' ? b : a;
    if (c.conn.lane === l.lane) return 'conn+lane into the lane car\'s lane';
    if (c.fromLane === l.lane) return 'conn+lane out of the lane car\'s lane';
    if (l.lane.to === c.connNodeId) return 'conn+lane lane car approaching that junction';
    if (l.lane.from === c.connNodeId) return 'conn+lane lane car leaving that junction';
    return 'conn+lane other';
  };
  const info = c => ({
    id: c.id, type: c.type, mode: c.mode, far: c.far, lag: +c.lag.toFixed(3), v: +c.speed.toFixed(1), age: +(T.clock - (c.born ?? -99)).toFixed(1), wait: +c.wait.toFixed(1),
    lane: c.lane?.id, s: c.mode === 'lane' ? `${(c.s - c.lane.s0).toFixed(1)}/${(c.lane.s1 - c.lane.s0).toFixed(1)}` : undefined, cls: c.lane?.cls,
    node: c.mode === 'conn' ? c.connNodeId : c.lane.to, deg: net.nodes[c.mode === 'conn' ? c.connNodeId : c.lane.to].degree,
    from: c.fromLane?.id, cs: c.mode === 'conn' ? `${c.cs.toFixed(1)}/${c.conn.path.length.toFixed(1)}` : undefined, into: c.conn?.lane.id, turn: c.conn ? +c.conn.turn.toFixed(2) : undefined, next: c.nextConn?.lane.id,
  });
  // who a car waits for: the car its leader search settled on, or a stop (line, car across, person)
  if (T._lead) {
    const lead = T._lead.bind(T), stop = T._stop.bind(T);
    T._lead = (o, d) => { const g0 = T._gap; lead(o, d); if (T._gap !== g0) T._who = o; };
    T._stop = d => { const g0 = T._gap; stop(d); if (T._gap !== g0) T._who = 'stop'; };
  }
  R.waiting = () => T.cars.filter(c => c.state === 'drive' && c.wait > 30).map(c => {
    T._who = null; const lg = T.leaderGap(c), gap = lg.gap, person = lg.person, pp = g.player.position;
    // the chain of who waits for whom, to a stop, a moving car or a cycle
    const chain = []; let w = T._who;
    while (w && w !== 'stop' && chain.length < 12 && !chain.some(x => x.id === w.id)) { const i = info(w); T._who = null; i.person = T.leaderGap(w).person; chain.push(i); w = T._who; }
    return { ...info(c), gap: +gap.toFixed(1), person, toPlayer: +Math.hypot(c.pos.x - pp.x, c.pos.z - pp.z).toFixed(1), sig: c.mode === 'lane' ? net.signalFor(c.lane) : '-',
      chain: chain.map(x => `${x.id}:${x.mode}/${x.lane}${x.into ? '>' + x.into : ''} v${x.v}${x.person ? ' PERSON' : ''}`).join(' -> ') + (w === 'stop' ? ' -> stop' : w ? ` -> cycle ${w.id}` : '') };
  });
  // what holds a car standing in a turn (frames, by reason)
  const inTurn = c => {
    T._who = null; const person = T.leaderGap(c).person, w = T._who;
    if (w === 'stop') return person ? 'a person' : 'a stop (car across its way, a held junction)';
    if (!w) return 'nothing (pulling away)';
    if (w.mode === 'conn' && w.connNodeId === c.connNodeId) return w.conn === c.conn ? 'car ahead on its connector' : w.conn.lane === c.conn.lane ? 'car merging into its lane, nearer' : 'car out of the same / a joined lane';
    if (w.mode === 'lane' && w.lane === c.conn.lane) return 'queue on the lane it turns into';
    if (w.mode === 'lane' && w.nextConn?.lane === c.conn.lane) return 'car on another lane heading into its lane';
    return 'car further along its route';
  };
  const update = T.update.bind(T);
  T.update = dt => {
    update(dt);
    if (!R.on || !(dt > 0)) return;
    R.frames++;
    const cars = T.cars.filter(c => c.state === 'drive');
    if (T._lead) for (const c of cars) if (c.mode === 'conn' && Math.abs(c.conn.turn) > 0.6 && Math.abs(c.conn.turn) < 2.5 && c.speed < 0.5) { const k = inTurn(c); R.turnStops[k] = (R.turnStops[k] || 0) + 1; }
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j], dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      if (dx * dx + dz * dz > 100 || Math.abs(b.pos.y - a.pos.y) > 2.5) continue;
      let pen = Infinity;
      for (const c of [a, b]) for (const k of [0, 1]) {
        const ux = k ? -Math.sin(c.yaw) : Math.cos(c.yaw), uz = k ? -Math.cos(c.yaw) : -Math.sin(c.yaw);
        const ext = car => { const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw); return Math.abs(fx * ux + fz * uz) * car.spec.length / 2 + Math.abs(-fz * ux + fx * uz) * car.spec.width / 2; };
        pen = Math.min(pen, ext(a) + ext(b) - Math.abs(dx * ux + dz * uz));
      }
      if (pen <= 0.25) continue;
      R.overlap++;
      const key = Math.min(a.id, b.id) + ':' + Math.max(a.id, b.id);
      let P = R.pairs.get(key);
      if (!P) {
        let cl = classify(a, b);
        if (T.clock - (a.born ?? -99) < 2 || T.clock - (b.born ?? -99) < 2) cl = 'spawned on top: ' + cl;
        P = { cl, frames: 0, gapA: +T.leaderGap(a).gap.toFixed(1), gapB: +T.leaderGap(b).gap.toFixed(1), pen: +pen.toFixed(2), at: [Math.round(a.pos.x), Math.round(a.pos.z)], fromCam: Math.round(Math.hypot(a.pos.x - g.camera.position.x, a.pos.z - g.camera.position.z)), a: info(a), b: info(b) };
        R.pairs.set(key, P);
        R.clsPairs[cl] = (R.clsPairs[cl] || 0) + 1;
      }
      P.frames++; R.cls[P.cl] = (R.cls[P.cl] || 0) + 1;
    }
  };
});
for (const [x, z] of spots) {
  await page.evaluate(([x, z]) => { const g = __game; g.relocate(new g.camera.position.constructor(x, 0, z), 0); }, [x, z]);
  await page.waitForTimeout(6000);
  await page.evaluate(() => { __ovl.reset(); __ovl.on = true; });
  await page.waitForTimeout(secs * 1000);
  const r = await page.evaluate(top => {
    const R = __ovl; R.on = false;
    const pairs = [...R.pairs.values()].sort((a, b) => b.frames - a.frames);
    return { frames: R.frames, overlap: R.overlap, pairs: pairs.length, cls: R.cls, clsPairs: R.clsPairs, cars: __game.traffic.cars.filter(c => c.state === 'drive').length, top: pairs.slice(0, top), waiting: R.waiting(), turnStops: R.turnStops };
  }, top);
  console.log(`=== spot ${x},${z}: ${r.frames} frames, ${r.overlap} overlap frames, ${r.pairs} pairs, ${r.cars} cars, ${r.waiting.length} waiting > 30 s`);
  for (const k of Object.keys(r.cls).sort((a, b) => r.cls[b] - r.cls[a])) console.log(`${String(r.cls[k]).padStart(7)} frames ${String(r.clsPairs[k]).padStart(4)} pairs  ${k}`);
  for (const p of r.top) console.log(JSON.stringify(p));
  for (const w of r.waiting) console.log('waiting', JSON.stringify(w));
  for (const [k, n] of Object.entries(r.turnStops).sort((a, b) => b[1] - a[1])) console.log(`turn stop ${String(n).padStart(6)} car-frames: ${k}`);
}
await browser.close();
