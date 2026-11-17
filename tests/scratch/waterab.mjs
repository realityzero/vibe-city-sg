// Water reflection cost at phone settings, interleaved A/B inside one page: frames (reflection + composer) rendered back
// to back, synced with a 1-pixel readPixels, per view and per variant; also the CPU time of the reflection call alone.
//   node tests/scratch/waterab.mjs [--url http://127.0.0.1:4173/] [--variants off,lite] [--rounds 4]
import { launch } from '../mobile/lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), ROUNDS = +arg('rounds', 4);
// each variant: js run with g = __game, returning a restore function
const ALL = {
  off: `const w = g.water, m = w.reflections; w.setReflections(false); return () => w.setReflections(m);`,
  lite: `const w = g.water, m = w.reflections; w.setReflections('lite'); return () => w.setReflections(m);`,
  full25: `const w = g.water, r = w.reflections, s = w.resScale; w.setReflections(true); w.resScale = 0.25; w.resize(g.R.width, g.R.height); return () => { w.resScale = s; w.resize(g.R.width, g.R.height); w.setReflections(r); };`,
  current: `return () => {};`,
  // lite as built once, then never re-rendered: the cost of shading the water with it
  frozen: `const w = g.water, m = w.reflections; w.setReflections('lite'); w.renderReflection(g.R.renderer, g.scene, g.camera); w._draw = () => {}; return () => { delete w._draw; w.setReflections(m); };`,
};
// lite with groups hidden during the reflection render only: lite-no:walls+roofs, lite-no:all (fixed overhead)
const GROUPS = {
  walls: 'g.city.batches.walls', roofs: 'g.city.batches.roofs', struct: 'g.city.batches.struct', ground: 'g.city.ground, g.city.groundShore',
  landmarks: 'g.landmarks.group', trees: 'g.veg.impostors', sky: 'g.sky.sky', lamps: 'g.props.headMesh',
};
const reflOnly = list => `const w = g.water, m = w.reflections, rr = w.renderReflection; w.setReflections('lite');
  const objs = [${list.map(k => GROUPS[k]).join(', ')}].filter(Boolean);
  w.renderReflection = function (...a) { const v = objs.map(o => o.visible); objs.forEach(o => o.visible = false); try { rr.apply(this, a); } finally { objs.forEach((o, i) => o.visible = v[i]); } };
  return () => { w.renderReflection = rr; w.setReflections(m); };`;
const VARIANTS = arg('variants', 'off,lite').split(',');
for (const v of VARIANTS) if (v.startsWith('lite-no:')) { const k = v.slice(8); ALL[v] = reflOnly(k === 'all' ? Object.keys(GROUPS) : k.split('+')); }
const VIEWS = [
  ['marina bay golden', 18.9, [480, 40, 140], [900, 60, 300]],
  ['clarke quay river', 20.5, [-520, 8, -300], [-460, 4, -380]],
  ['mbs night', 21, [880, 25, 620], [1291, 90, 377]],
  ['street, no water', 12, [262, 2, 470], [300, 8, 520]],
];
const h = await launch('chromium', { exclusive: true });
h.page.on('pageerror', e => console.log('[pageerror]', e.message));
let loadedT = null;
for (const [name, t, pos, look] of VIEWS) {
  if (loadedT !== t) {
    await h.page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=${t}&q=low&fixedres`, { waitUntil: 'load' });
    await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
    await h.page.evaluate(() => { __game.timeScale = 0; });
    await h.page.waitForTimeout(2000); loadedT = t;
  }
  await h.page.evaluate(([pos, look]) => { const g = __game, V = g.camera.position.constructor; g.cameraRig.override = { position: new V(...pos), lookAt: new V(...look), snap: true, fov: 62 }; }, [pos, look]);
  await h.page.waitForTimeout(2500);
  await h.page.evaluate(() => { __game.paused = true; });
  const res = Object.fromEntries(VARIANTS.map(v => [v, { gpu: [], cpu: [] }]));
  for (let r = 0; r < ROUNDS; r++) for (const v of VARIANTS) {
    const m = await h.page.evaluate(src => {
      const g = __game, R = g.R, W = g.water, gl = R.renderer.getContext(), px = new Uint8Array(4), scene = g.scene, cam = g.camera;
      const restore = new Function('g', src)(g);
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      scene.updateMatrixWorld(); scene.matrixWorldAutoUpdate = false;
      let cpu = 0;
      const frame = () => { const t0 = performance.now(); W.renderReflection(R.renderer, scene, cam); cpu += performance.now() - t0; R.render(1 / 60); };
      for (let i = 0; i < 10; i++) frame(); sync(); cpu = 0;
      const t = []; for (let k = 0; k < 3; k++) { const t0 = performance.now(); for (let i = 0; i < 30; i++) frame(); sync(); t.push((performance.now() - t0) / 30); }
      scene.matrixWorldAutoUpdate = true; restore();
      return { gpu: t.sort((a, b) => a - b)[1], cpu: cpu / 90 };
    }, ALL[v]);
    res[v].gpu.push(m.gpu); res[v].cpu.push(m.cpu);
  }
  await h.page.evaluate(() => { __game.paused = false; });
  const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const base = med(res[VARIANTS[0]].gpu);
  console.log(`${name}:`);
  for (const v of VARIANTS) console.log(`  ${v.padEnd(10)} ${med(res[v].gpu).toFixed(3)} ms/frame (${(med(res[v].gpu) - base >= 0 ? '+' : '')}${(med(res[v].gpu) - base).toFixed(3)})  reflection call CPU ${med(res[v].cpu).toFixed(3)} ms   [${res[v].gpu.map(x => x.toFixed(2)).join(' ')}]`);
}
await h.browser.close();
