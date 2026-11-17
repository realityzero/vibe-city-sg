// Street life where the camera looks: people visible per gallery view (in the frustum, within 80 m, not hidden behind
// the city) and the crowd's CPU cost per frame (Pedestrians.update + Scenes.update) on foot and driving.
//   node tests/scratch/pedcount.mjs [--url http://127.0.0.1:4173/] [--q low|high] [--throttle 1.6] [--out dir]
//                                   [--only sidewalk-crowd,merlion] [--cost-only | --views-only]
import { launch } from '../mobile/lib.mjs';
import fs from 'fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), Q = arg('q', 'low'), THR = +arg('throttle', '1.6'), OUT = arg('out', ''), ONLY = arg('only', '');
const phone = Q === 'low';
if (OUT) fs.mkdirSync(OUT, { recursive: true });
// street-level views from tests/mobile/gallery.mjs: [name, time, camera, look-at, hud]
const VIEWS = [
  ['merlion', 17.2, [652, 7, 62], [611, 7, 22]],
  ['flyer', 9.5, [1430, 35, -120], [1572, 60, -266]],
  ['chinatown-street', 11, [-392, 3, 420], [-330, 2, 380]],
  ['chinatown-night', 21, [-392, 3, 420], [-330, 2, 380]],
  ['cbd-street', 13, [262, 2, 470], [300, 8, 520]],
  ['clarke-quay-evening', 19.25, [-470, 6, -330], [-300, 10, -250]],
  ['sidewalk-crowd', 12, [-370, 1.7, 395], [-345, 1.5, 370]],
  ['play-onfoot', 11, null, null, 'foot'],
];
const h = await launch('chromium', { exclusive: process.argv.includes('--views-only') ? false : true, device: phone ? undefined : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 } });
const errs = []; h.page.on('pageerror', e => errs.push(e.message));
const load = async t => {
  await h.page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=${t}&q=${Q}&fixedres`, { waitUntil: 'load' });
  await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
  await h.page.evaluate(() => { __game.timeScale = 0; });
  await h.page.waitForTimeout(2500);
};
const count = () => h.page.evaluate(() => {
  const g = __game, cam = g.camera, T = cam.position.constructor;
  let vis = 0, near = 0;
  for (const p of g.peds.peds) {
    const d = cam.position.distanceTo(p.pos); if (d > 80) continue;
    const v = new T(p.pos.x, p.pos.y + 1, p.pos.z).project(cam); if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
    const dir = new T(p.pos.x - cam.position.x, p.pos.y + 1.2 - cam.position.y, p.pos.z - cam.position.z); const L = dir.length(); dir.multiplyScalar(1 / L);
    if (g.physics.raycast(cam.position, dir, L - 0.8)) continue;
    vis++; if (d < 30) near++;
  }
  return { vis, near, total: g.peds.peds.length };
});
if (!process.argv.includes('--cost-only')) {
  const list = VIEWS.filter(v => (!ONLY || ONLY.split(',').includes(v[0]))).sort((a, b) => a[1] - b[1]);
  let loadedT = null;
  for (const [name, t, pos, look, hud] of list) {
    if (loadedT !== t) { await load(t); loadedT = t; }
    await h.page.evaluate(([pos, look, hud]) => {
      const g = __game, V = g.camera.position.constructor;
      document.getElementById('ui').style.display = hud ? '' : 'none';
      if (hud === 'drive') { g.cameraRig.override = null; void g.debugTp(-60, 1000, 0); void g.debugCar('infernus'); g.autopilot.engage({ x: 900, z: 250 }); }
      else if (hud === 'foot') { g.cameraRig.override = null; g.player.teleport(new V(-380, 0, 410), 2.2); }
      else g.cameraRig.override = { position: new V(...pos), lookAt: new V(...look), snap: true, fov: 62 };
    }, [pos, look, hud]);
    await h.page.waitForTimeout(hud === 'drive' ? 9000 : 3500);
    const c = await count();
    console.log(`${name.padEnd(22)} visible ${String(c?.vis ?? '-').padStart(3)}  (<30 m ${c?.near ?? '-'})  crowd ${c?.total ?? '-'}`);
    if (OUT) await h.page.screenshot({ path: `${OUT}/${Q}-${name}.png` });
  }
}
if (!process.argv.includes('--views-only')) {
  // crowd CPU per frame at an A14-ish CPU throttle: on foot in Chinatown, then driving through the CBD
  await load(12);
  const cdp = await h.ctx.newCDPSession(h.page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THR });
  const measure = (label, setup, ms) => h.page.evaluate(async ([setup, ms]) => {
    const g = __game; eval(setup);
    await new Promise(r => setTimeout(r, 3000));
    const T = [], wrap = (o, k) => { const f = o[k].bind(o); o[k] = (...a) => { const t0 = performance.now(); const r = f(...a); T[T.length - 1] += performance.now() - t0; return r; }; return f; };
    const fp = wrap(g.peds, 'update'), fs = wrap(g.scenes, 'update');
    const fl = []; let last = performance.now();
    await new Promise(res => { const end = performance.now() + ms; const loop = () => { const now = performance.now(); fl.push(now - last); last = now; T.push(0); if (now < end) requestAnimationFrame(loop); else res(); }; T.push(0); requestAnimationFrame(loop); });
    g.peds.update = fp; g.scenes.update = fs;
    const s = T.slice(1, -1).sort((a, b) => a - b), f = fl.slice(2).sort((a, b) => a - b), q = (a, k) => a[Math.floor(a.length * k)];
    return { mean: s.reduce((a, b) => a + b, 0) / s.length, p50: q(s, 0.5), p95: q(s, 0.95), max: s[s.length - 1], frame50: q(f, 0.5), peds: g.peds.peds.length, inst: g.peds.crowd.count, draws: g.R.renderer.info.render.calls };
  }, [setup, ms]);
  for (const [label, setup] of [
    ['on foot, Chinatown', "g.player.teleport(new g.camera.position.constructor(-380, 0, 410), 2.2)"],
    ['driving, CBD', "void g.debugTp(-60, 1000, 0); void g.debugCar('infernus'); g.autopilot.engage({ x: 900, z: 250 })"],
  ]) {
    const r = await measure(label, setup, 12000);
    console.log(`${label.padEnd(20)} crowd CPU ms/frame mean ${r.mean.toFixed(3)} p50 ${r.p50.toFixed(3)} p95 ${r.p95.toFixed(3)} max ${r.max.toFixed(2)} · frame p50 ${r.frame50.toFixed(1)} ms · peds ${r.peds} (instances ${r.inst}) · draws ${r.draws}`);
  }
}
if (errs.length) console.log('page errors:', errs.slice(0, 5));
await h.browser.close();
