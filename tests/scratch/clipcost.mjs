// What a bystander's clip still costs (world/bystander.js) at phone settings: iPhone 12 profile in Chromium, Low
// preset, the CPU throttled (default 1.6x ≈ an A14). Drives the Infernus down a CBD street and forces N clips (a
// creator's, so each one renders); per clip: main-thread ms of the still (scene pass + grade, Game.tick's share), the
// draw calls and triangles it adds, the rAF interval of the frame it ran in against the median frame, and whether any
// program was compiled for it. Also checks the async readback came back (the card's still is not blank).
//   node tests/scratch/clipcost.mjs [--url http://127.0.0.1:4173/] [--n 8] [--cpu 1.6]
import { launch } from '../mobile/lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), N = +arg('n', 8), CPU = +arg('cpu', 1.6);
const h = await launch('chromium', { exclusive: true });
const { page } = h, errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=11&q=low`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play' && __game.player.controlsEnabled, null, { timeout: 300000, polling: 200 });
const cdp = await h.ctx.newCDPSession(page);
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
await page.evaluate(() => {
  const g = __game, C = g.clips, info = g.R.renderer.info;
  g.timeScale = 0; g.debugTp(262, 470, 0); g.debugCar('infernus');
  window.__p0 = info.programs.length; window.__clips = []; window.__frames = [];
  // the rAF interval of every frame, and which frames ran a still
  let last = 0; const tick = t => { if (last) window.__frames.push([t - last, C.__ran ? 1 : 0]); C.__ran = 0; last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  const render = C.render.bind(C);
  C.render = () => {
    if (!C.job) return render();
    const c0 = info.render.calls, t0 = info.render.triangles;
    render();
    C.__ran = 1; window.__clips.push({ ms: +C.cost.toFixed(2), calls: info.render.calls - c0, tris: info.render.triangles - t0 });
  };
});
await page.waitForTimeout(6000);
// cruise (the stick) and force a creator's clip every 2.5 s, filmed from the kerb ~15 m away
await page.evaluate(() => { const st = __game.input.stick; st.active = true; st.x = 0; st.y = 0.35; });
for (let i = 0; i < N; i++) {
  await page.evaluate(() => {
    const g = __game, P = g.player.position, sw = g.roadnet.nearestSidewalk(P.x + 10, P.z - 10, 40);
    g.hype.clip(150000, { kind: 'nearmiss', by: { pos: sw.pos, hs: 1 }, handle: '@test' });
  });
  await page.waitForTimeout(2500);
}
const r = await page.evaluate(() => {
  const F = window.__frames.slice(30), all = F.map(f => f[0]).sort((a, b) => a - b), med = all[all.length >> 1];
  const clipFrames = F.filter(f => f[1]).map(f => +f[0].toFixed(1));
  const c = __game.clips.card.canvas, x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let s = 0, s2 = 0; for (let i = 0; i < x.length; i += 4) { const l = x[i] * 0.3 + x[i + 1] * 0.59 + x[i + 2] * 0.11; s += l; s2 += l * l; }
  const n = x.length / 4, m = s / n;
  return { clips: window.__clips, medianFrameMs: +med.toFixed(1), p95FrameMs: +all[Math.floor(all.length * 0.95)].toFixed(1), clipFrameMs: clipFrames,
    mainCalls: __game.R.renderer.info.render.calls, newPrograms: __game.R.renderer.info.programs.length - window.__p0, still: { mean: Math.round(m), sd: Math.round(Math.sqrt(s2 / n - m * m)) } };
});
const ms = r.clips.map(c => c.ms).sort((a, b) => a - b);
console.log(JSON.stringify(r, null, 1));
console.log(`stills ${r.clips.length}/${N} · main-thread ms median ${ms[ms.length >> 1]} max ${ms[ms.length - 1]} (first ${r.clips[0]?.ms}) · +${r.clips[1]?.calls} calls · frame ${r.medianFrameMs} ms median, clip frames ${r.clipFrameMs.join(' ')} · new programs ${r.newPrograms} · cpu ${CPU}x`);
if (errs.length) console.log('errors:', errs.slice(0, 5));
await h.browser.close();
