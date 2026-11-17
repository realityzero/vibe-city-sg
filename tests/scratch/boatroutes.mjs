// Life on the water (world/boats.js): every loop sample keeps a boat's hull (plus a margin) on the water, every ship at
// anchor lies on open water, no moored player craft sits on a loop; then the fleet sails for a while (sim sped up) and
// no boat may leave the water or touch another.
//   node tests/scratch/boatroutes.mjs [--url http://127.0.0.1:5174/] [--secs 60]
import { launch } from '../mobile/lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:5174/'), SECS = +arg('secs', 60);
const h = await launch('chromium', { exclusive: false, device: { viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 } });
const errs = []; h.page.on('pageerror', e => errs.push(e.message));
await h.page.goto(`${URL0}?skipTitle&newgame&freeroam=8&q=low&fixedres`, { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
const stat = await h.page.evaluate(async secs => {
  const g = __game, B = g.boats, water = (x, z) => g.city.isWater(x, z);
  const out = { loops: {}, ships: [], berths: [], left: 0, touch: 0, minGap: 1e9, moved: 0 };
  // hull footprint (width + 2 x 1.5 m, length + 2 x 2 m) on the water at every loop sample, both headings
  for (const [name, L] of [['main', B.main], ['inner', B.inner]]) {
    let bad = 0, worst = 1e9; const pts = [];
    for (let i = 0; i < L.n; i++) {
      const x = L.x[i], z = L.z[i], j = (i + 1) % L.n, dx = L.x[j] - x, dz = L.z[j] - z, l = Math.hypot(dx, dz) || 1, fx = dx / l, fz = dz / l;
      let ok = true;
      for (const a of [-7.5, 0, 7.5]) for (const b of [-3, 0, 3]) if (!water(x + fx * a - fz * b, z + fz * a + fx * b)) ok = false;
      // clearance to the bank sideways
      let c = 0; while (c < 60 && water(x - fz * c, z + fx * c) && water(x + fz * c, z - fx * c)) c += 1;
      worst = Math.min(worst, c);
      if (!ok) { bad++; if (pts.length < 5) pts.push([Math.round(x), Math.round(z)]); }
    }
    out.loops[name] = { length: Math.round(L.length), bad, worstClearance: worst, at: pts };
  }
  for (const m of B.ships) for (let i = 0; i < m.count; i++) {
    const e = new g.camera.matrix.constructor(); m.getMatrixAt(i, e); const E = e.elements, x = E[12], z = E[14], fx = -E[8], fz = -E[10];
    let ok = 0, n = 0; for (let a = -110; a <= 110; a += 10) for (const b of [-20, 0, 20]) { n++; if (water(x + fx * a - fz * b, z + fz * a + fx * b)) ok++; }
    out.ships.push([Math.round(x), Math.round(z), `${ok}/${n}`]);
  }
  for (const s of g.spawns.slots) if (s.kind === 'boat') {
    let d = 1e9; for (const L of [B.main, B.inner]) for (let i = 0; i < L.n; i++) d = Math.min(d, Math.hypot(L.x[i] - s.pos.x, L.z[i] - s.pos.z));
    out.berths.push([s.type, Math.round(d)]);
  }
  // sail: 4x sim speed
  g.simScale = 4; const start = B.list.map(b => b.s);
  const t0 = performance.now();
  while (performance.now() - t0 < secs * 1000 / 4) {
    await new Promise(r => setTimeout(r, 100));
    for (const b of B.list) if (!water(b.pos.x, b.pos.z)) out.left++;
    for (let i = 0; i < B.list.length; i++) for (let j = i + 1; j < B.list.length; j++) {
      const a = B.list[i], b = B.list[j], d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
      out.minGap = Math.min(out.minGap, d); if (d < (a.len + b.len) / 2 * 0.6) out.touch++;
    }
  }
  g.simScale = 1;
  out.moved = B.list.map((b, i) => Math.round(b.loop.wrap(b.s - start[i]))).join(',');
  out.minGap = Math.round(out.minGap);
  return out;
}, SECS);
console.log(JSON.stringify(stat, null, 1));
if (errs.length) console.log('page errors:', errs.slice(0, 3));
await h.browser.close();
