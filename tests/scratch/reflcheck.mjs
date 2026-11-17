// Water reflection checks at phone settings over the bay: (1) the desktop reflection is pixel-identical with the ground on
// the reflection layer or not, (2) frame cost per lite slice (each frame synced) against no reflection.
//   node tests/scratch/reflcheck.mjs [--url http://127.0.0.1:4173/] [--quick (only 1)] [--parts (also each part alone)]
import { launch } from '../mobile/lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/');
const h = await launch('chromium', { exclusive: true });
await h.page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=20.5&q=low&fixedres`, { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
for (const [name, pos, look] of [['bay', [480, 40, 140], [900, 60, 300]], ['river', [-520, 8, -300], [-460, 4, -380]]]) {
await h.page.evaluate(([pos, look]) => { const g = __game, V = g.camera.position.constructor; g.timeScale = 0; g.cameraRig.override = { position: new V(...pos), lookAt: new V(...look), snap: true, fov: 62 }; }, [pos, look]);
await h.page.waitForTimeout(3000);
const r = await h.page.evaluate(([quick, parts]) => {
  const g = __game, R = g.R.renderer, w = g.water, gl = R.getContext(), px = new Uint8Array(4), out = {};
  g.paused = true;
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  // (1) ground on/off in the reflection (desktop mode)
  w.setReflections(true);
  const grab = () => { for (let i = 0; i < 3; i++) w.renderReflection(R, g.scene, g.camera); const rt = w.rt, a = new Uint16Array(rt.width * rt.height * 4); R.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, a); return a; };
  const a = grab(); g.city.ground.layers.enable(2); g.city.groundShore.layers.enable(2);
  const b = grab(); g.city.ground.layers.disable(2); g.city.groundShore.layers.disable(2);
  let diff = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
  out.groundDiff = `${diff} of ${a.length} half-float channels differ`;
  const rf = g.city.batches.roofs; rf.layers.disable(2); const c = grab(); rf.layers.enable(2);
  let rd = 0, big = 0; for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) { rd++; }
  out.roofsDiff = `${rd} of ${a.length} channels differ without roofs`;
  if (quick) { g.paused = false; return out; }
  // (2) per-slice frame cost: frames back to back with the reflection pinned to one slice
  const med = x => x.slice().sort((p, q) => p - q)[x.length >> 1];
  const cpu = {};
  const run = pin => { const t = []; for (let k = 0; k < 3; k++) { const t0 = performance.now(); for (let i = 0; i < 30; i++) { if (pin !== null) w._lite.slice = pin; const c0 = performance.now(); w.renderReflection(R, g.scene, g.camera); (cpu[pin] ||= []).push(performance.now() - c0); g.R.render(1 / 60); } sync(); t.push((performance.now() - t0) / 30); } return med(t); };
  w.setReflections('lite'); for (let i = 0; i < 12; i++) { w.renderReflection(R, g.scene, g.camera); g.R.render(1 / 60); }
  const per = [], offs = [];
  for (let r = 0; r < 3; r++) {
    w.setReflections(false); offs.push(run(null)); w.setReflections('lite'); run(null);
    w._lite.load.forEach((_, s) => { (per[s] ||= []).push(run(s)); });
  }
  const off = med(offs);
  out.off = off.toFixed(3); out.slices = per.map(x => `+${(med(x) - off).toFixed(3)}`).join(' ');
  if (parts) { // each part drawn alone (pinned to job 1, everything else in job 0)
    const P = w._lite.parts, saved = P.map(p => p.job), cost = [];
    w.setReflections(false); const off2 = run(null); w.setReflections('lite'); run(null);
    for (const q of P.filter(p => p.w > 0)) { P.forEach(p => { p.job = p === q ? 1 : 0; }); cost.push([(q.o.name || q.o.parent?.name || q.o.type) + (q.share >= 0 ? '/' + q.share : ''), q.w, run(1) - off2]); }
    P.forEach((p, i) => { p.job = saved[i]; });
    out.parts = cost.sort((a, b) => b[2] - a[2]).map(([n, w, c]) => `${n} ${(w / 3e3).toFixed(0)}k tris ${c.toFixed(3)} ms`);
  }
  out.cpu = w._lite.load.map((_, s) => med(cpu[s]).toFixed(3)).join(' ');
  out.jobs = w._lite.load.map((_, j) => w._lite.parts.filter(p => p.job === j && p.w > 0).map(p => (p.o.name || p.o.parent?.name || p.o.type) + (p.share >= 0 ? '/' + p.share : '')).slice(0, 5).join('+')).join(' | ');
  g.paused = false;
  return out;
}, [process.argv.includes('--quick'), process.argv.includes('--parts')]);
console.log(name, r);
}
await h.browser.close();
