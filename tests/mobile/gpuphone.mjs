// GPU time per frame at the iPhone 12's render settings (Low preset, 844x390 @3x -> ~717x331 internal), measured on
// this Mac's GPU with timer queries (Chromium/ANGLE-Metal) at fixed resolution, over a scripted drive and a few
// still views. A14 GPU ≈ M2 GPU / 4.5: budget for 60 fps on the phone ≈ 16.7 / 4.5 ≈ 3.7 ms here.
import { launch } from './lib.mjs';
const url = process.argv[2] || 'http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8&t=11&fixedres&q=low';
const vp = process.argv[3]; // e.g. 1440x900 to see whether GPU time scales with pixels
const h = await launch('chromium', { exclusive: true, device: vp ? { viewport: { width: +vp.split('x')[0], height: +vp.split('x')[1] }, deviceScaleFactor: 1 } : undefined });
await h.page.goto(url, { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 240000 });
await h.page.waitForTimeout(3000);
const sample = async (label, ms = 5000) => {
  await h.page.evaluate(() => { window.__gs = []; window.__gsOn = true; const R = __game.R; const loop = () => { if (!window.__gsOn) return; if (R.gpuMs) window.__gs.push(R.gpuMs); requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
  await h.page.waitForTimeout(ms);
  const r = await h.page.evaluate(() => { window.__gsOn = false; const a = window.__gs.slice().sort((x, y) => x - y); const i = __game.R.renderer.info.render; return { n: a.length, p50: a[a.length >> 1], p90: a[Math.floor(a.length * 0.9)], tris: i.triangles, calls: i.calls, px: `${__game.R.width}x${__game.R.height}` }; });
  console.log(`${label.padEnd(26)} GPU p50 ${r.p50?.toFixed(2)} ms  p90 ${r.p90?.toFixed(2)} ms  (${r.n} samples)  ${(r.tris / 1e6).toFixed(2)} M tris  ${r.calls} calls  ${r.px}  -> A14 est. ${(r.p90 * 4.5).toFixed(1)} ms`);
};
await sample('spawn (Chinatown street)');
if (process.argv.includes('--quick')) { await h.browser.close(); process.exit(0); }
for (const [name, p, l] of [['Marina Bay overview', [480, 40, 140], [760, 60, 300]], ['CBD street level', [80, 2.2, -30], [200, 20, -60]], ['aerial city', [-200, 420, 900], [200, 0, 100]]]) {
  await h.page.evaluate(([p, l]) => { const g = __game, V = g.camera.position.constructor; g.cameraRig.override = { position: new V(...p), lookAt: new V(...l), snap: true }; }, [p, l]);
  await h.page.waitForTimeout(1500); await sample(name, 3000);
}
await h.page.evaluate(() => { __game.cameraRig.override = null; __game.debugTp(-60, 1000, 0); void __game.debugCar('infernus'); __game.autopilot.engage({ x: 900, z: 250 }); });
await h.page.waitForTimeout(3000); await sample('autopilot drive', 12000);
await h.browser.close();
