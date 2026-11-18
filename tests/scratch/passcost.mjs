// What the phone image chain's own passes cost, isolated from the scene, at the iPhone 12's settings (Low preset,
// 844x390 @3x): after real frames, each pass is rendered on its own many times over (synced with a 1-pixel
// readPixels), the variants interleaved, and timed by their fastest batch — whole-frame timings (gpusplit.mjs,
// phoneimgab.mjs) swing by milliseconds when other tests share the machine, and GPU timer queries on ANGLE/Metal
// carry ~1 ms of submission overhead. Every repeat ends its render pass (a tiny clear elsewhere): a tile GPU skips
// shading full-screen draws that a later draw in the same pass overwrites, so back-to-back repeats would look free.
// A14 estimate: x4.5, as in gpuphone.mjs.
//   node tests/scratch/passcost.mjs [--url http://127.0.0.1:4173/] [--outs 2,1.5]
import { launch } from '../mobile/lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), OUTS = arg('outs', '2,1.5').split(',').map(Number);
const VIEWS = [['spawn street', null], ['CBD street', [[80, 2.2, -30], [200, 20, -60]]], ['aerial', [[-200, 420, 900], [200, 0, 100]]]];

const h = await launch('chromium', { exclusive: true });
await h.page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=11&fixedres&q=low`, { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 240000 });
await h.page.waitForTimeout(3000);
for (const [view, cam] of VIEWS) {
  await h.page.evaluate(cam => { const g = __game, V = g.camera.position.constructor; g.cameraRig.override = cam ? { position: new V(...cam[0]), lookAt: new V(...cam[1]), snap: true } : null; }, cam);
  await h.page.waitForTimeout(1500);
  const r = await h.page.evaluate(outs => {
    const g = __game, R = g.R, c = R.composer, rr = R.renderer, gl = rr.getContext(), px = new Uint8Array(4);
    g.paused = true;
    const tiny = new R.taa.history.constructor(4, 4, { depthBuffer: false });
    const sync = () => { rr.setRenderTarget(null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    const breakPass = () => { rr.setRenderTarget(tiny); rr.clear(true, false, false); };
    const batch = (fn, n = 40) => { sync(); const t0 = performance.now(); for (let i = 0; i < n; i++) { fn(); breakPass(); } sync(); return (performance.now() - t0) / n; };
    const set = (taa, out) => { R.allow.taa = taa; R.allow.upscale = !!out; if (out) R.q.upscale = out; R.applyQualityToPost(); R.resize(); for (let i = 0; i < 4; i++) R.render(1 / 60); };
    const tests = [['(pass break)', () => set(false, 0), () => { }], ['before: FXAA+RCAS to canvas', () => set(false, 0), () => R.outPass.render(rr, c.inputBuffer, c.outputBuffer)]];
    for (const out of outs) {
      tests.push([`TAA resolve (${out}x canvas)`, () => set(true, out), () => R.taa.render(rr, c.inputBuffer, c.outputBuffer)]);
      tests.push([`RCAS + EASU to ${out}x CSS`, () => set(true, out), () => R.upPass.render(rr, c.outputBuffer)]);
    }
    const best = tests.map(() => Infinity);
    for (let round = 0; round < 6; round++) tests.forEach(([, setup, fn], i) => { setup(); best[i] = Math.min(best[i], batch(fn)); });
    R.q.upscale = 2; set(true, 2); tiny.dispose(); g.paused = false;
    return tests.map(([name], i) => [name, i ? best[i] - best[0] : best[0]]);
  }, OUTS);
  console.log(`${view}:`);
  for (const [k, v] of r) console.log(`  ${k.padEnd(30)} ${v.toFixed(3)} ms  (A14 est. ${(v * 4.5).toFixed(2)} ms)`);
}
await h.browser.close();
