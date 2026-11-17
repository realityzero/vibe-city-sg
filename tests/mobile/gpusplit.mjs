// Where the frame time goes at phone settings: switch one subsystem off at a time and measure how much frame time it
// frees. Frames are rendered back to back (60 per sample, synced with a 1-pixel readPixels) so the GPU runs at full
// clock — vsync-paced timer queries on Apple GPUs just measure a downclocked GPU filling the 16.7 ms slot.
// Prints ms per frame (max of CPU submission and GPU work) and an A14 estimate (x4.5).
//   node tests/mobile/gpusplit.mjs [url]
import { launch } from './lib.mjs';
const url = process.argv[2] || 'http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8&t=11&fixedres&q=low';
const h = await launch('chromium', { exclusive: true });
await h.page.goto(url, { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 240000 });
await h.page.waitForTimeout(3000);
await h.page.evaluate(() => { __game.paused = true; });
const gpu = async () => h.page.evaluate(() => {
  const R = __game.R, gl = R.renderer.getContext(), px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  for (let i = 0; i < 8; i++) R.render(1 / 60); sync();
  const t = []; for (let k = 0; k < 3; k++) { const t0 = performance.now(); for (let i = 0; i < 40; i++) R.render(1 / 60); sync(); t.push((performance.now() - t0) / 40); }
  return t.sort((a, b) => a - b)[1];
});
const base = await gpu();
console.log(`all on: ${base.toFixed(2)} ms per frame back to back (A14 est. ${(base * 4.5).toFixed(1)} ms)`);
const tests = [
  ['shadow map', () => { __game.R.renderer.shadowMap.enabled = false; }, () => { __game.R.renderer.shadowMap.enabled = true; }],
  ['post passes (bloom/tone/AE)', () => { const c = __game.R.composer; window.__pp = c.passes.map(p => p.enabled); c.passes.forEach((p, i) => { if (i > 0) p.enabled = false; }); c.passes[0].renderToScreen = true; }, () => { const c = __game.R.composer; c.passes.forEach((p, i) => p.enabled = window.__pp[i]); c.passes[0].renderToScreen = false; }],
  ['city walls', () => { __game.city.batches.walls.visible = false; }, () => { __game.city.batches.walls.visible = true; }],
  ['city roofs+struct', () => { __game.city.batches.roofs.visible = false; __game.city.batches.struct.visible = false; }, () => { __game.city.batches.roofs.visible = true; __game.city.batches.struct.visible = true; }],
  ['city roads+foot', () => { __game.city.batches.roads.visible = false; __game.city.batches.foot.visible = false; }, () => { __game.city.batches.roads.visible = true; __game.city.batches.foot.visible = true; }],
  ['near detail meshes', () => { window.__nm = []; __game.city.group.traverse(o => { if (/Near_/.test(o.name) && o.visible) { o.visible = false; __nm.push(o); } }); }, () => { for (const o of __nm) o.visible = true; }],
  ['ground', () => { __game.city.ground.visible = false; __game.city.groundShore.visible = false; }, () => { __game.city.ground.visible = true; __game.city.groundShore.visible = true; }],
  ['landmarks', () => { __game.landmarks.group.visible = false; }, () => { __game.landmarks.group.visible = true; }],
  ['tree impostors', () => { __game.veg.impostors.visible = false; }, () => { __game.veg.impostors.visible = true; }],
  ['near trees', () => { for (const m of __game.veg.meshes) m.visible = false; }, () => { for (const m of __game.veg.meshes) m.visible = true; }],
  ['water', () => { __game.water.mesh.visible = false; }, () => { __game.water.mesh.visible = true; }],
  ['sky', () => { __game.sky.sky.visible = false; }, () => { __game.sky.sky.visible = true; }],
  ['street detail pools', () => { for (const p of __game.streetDetail.pools) p.mesh.visible = false; }, () => { for (const p of __game.streetDetail.pools) p.mesh.visible = true; }],
  ['street furniture', () => { if (__game.streetFurniture) __game.streetFurniture.mesh.visible = false; }, () => { if (__game.streetFurniture) __game.streetFurniture.mesh.visible = true; }],
  ['traffic + peds', () => { const tr = __game.traffic.renderer; for (const T of tr.types.values()) T.pool.mesh.visible = false; __game.peds.crowd.mesh.visible = false; }, () => { const tr = __game.traffic.renderer; for (const T of tr.types.values()) T.pool.mesh.visible = true; __game.peds.crowd.mesh.visible = true; }],
];
for (const [name, off, on] of tests) {
  await h.page.evaluate(off);
  const t = await gpu();
  await h.page.evaluate(on);
  console.log(`  without ${name.padEnd(28)} ${t.toFixed(2)} ms   (frees ${(base - t).toFixed(2)} ms)`);
}
await h.browser.close();
