// What the phone image chain costs (temporal AA, the in-engine FSR 1 upscale) at the iPhone 12's settings: frames are
// rendered back to back (as in gpusplit.mjs, so the GPU runs at full clock) with each variant switched in place, the
// variants interleaved over several rounds at a few fixed views. Prints ms per frame and the A14 estimate (x4.5).
//   node tests/scratch/phoneimgab.mjs [--url http://127.0.0.1:4173/] [--rounds 4]
//        [--variants '[["2x, no sharpening", {"taa": true, "upscale": true, "out": 2, "sharpen": 0}]]']
import { launch } from '../mobile/lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), ROUNDS = +arg('rounds', 4);
const VARIANTS = JSON.parse(arg('variants', 'null')) ?? [
  ['before (FXAA+RCAS, browser stretch)', { taa: false, upscale: false }],
  ['FXAA + EASU', { taa: false, upscale: true }],
  ['TAA + EASU', { taa: true, upscale: true }],
];
const VIEWS = [['spawn street', null], ['Marina Bay', [[480, 40, 140], [760, 60, 300]]], ['CBD street', [[80, 2.2, -30], [200, 20, -60]]], ['aerial', [[-200, 420, 900], [200, 0, 100]]]];

const h = await launch('chromium', { exclusive: true });
await h.page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=11&fixedres&q=low`, { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 240000 });
await h.page.waitForTimeout(3000);
const frame = () => h.page.evaluate(() => {
  const R = __game.R, gl = R.renderer.getContext(), px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  for (let i = 0; i < 8; i++) R.render(1 / 60); sync();
  const t = []; for (let k = 0; k < 3; k++) { const t0 = performance.now(); for (let i = 0; i < 40; i++) R.render(1 / 60); sync(); t.push((performance.now() - t0) / 40); }
  return t.sort((a, b) => a - b)[1];
});
const set = v => h.page.evaluate(v => {
  const R = __game.R; R.allow.taa = v.taa; R.allow.upscale = v.upscale;
  R.__q0 ??= { ...R.q }; Object.assign(R.q, R.__q0); if (v.out) R.q.upscale = v.out;
  R.applyQualityToPost(); R.resize();
  if (v.sharpen !== undefined) R.upPass.sharpen = v.sharpen;
  return `${R.width}x${R.height} -> canvas ${R.canvas.width}x${R.canvas.height}`;
}, v);
for (const [view, cam] of VIEWS) {
  await h.page.evaluate(cam => { const g = __game, V = g.camera.position.constructor; g.cameraRig.override = cam ? { position: new V(...cam[0]), lookAt: new V(...cam[1]), snap: true } : null; }, cam);
  await h.page.waitForTimeout(1500);
  await h.page.evaluate(() => { __game.paused = true; });
  const ms = VARIANTS.map(() => []), sizes = [];
  for (let r = 0; r < ROUNDS; r++) for (let i = 0; i < VARIANTS.length; i++) { sizes[i] = await set(VARIANTS[i][1]); ms[i].push(await frame()); }
  await h.page.evaluate(() => { __game.paused = false; });
  // other load on the machine only ever adds time: each variant is compared with the baseline of the same round
  // (paired, median over rounds) and by its fastest round
  const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1], min = a => Math.min(...a);
  console.log(`${view}:`);
  VARIANTS.forEach(([name], i) => {
    const d = med(ms[i].map((x, r) => x - ms[0][r])), dMin = min(ms[i]) - min(ms[0]);
    console.log(`  ${name.padEnd(38)} ${med(ms[i]).toFixed(2)} ms (min ${min(ms[i]).toFixed(2)})  ${i ? `paired ${d >= 0 ? '+' : ''}${d.toFixed(2)} / min ${dMin >= 0 ? '+' : ''}${dMin.toFixed(2)} ms -> A14 est. ${(d * 4.5).toFixed(2)} / ${(dMin * 4.5).toFixed(2)} ms` : `A14 est. ${(min(ms[0]) * 4.5).toFixed(1)} ms`}  [${ms[i].map(x => x.toFixed(2)).join(' ')}]  ${sizes[i]}`);
  });
}
await h.browser.close();
