// Uncapped render cost per frame with features toggled off one at a time: inside one rAF the frame (reflection + composer)
// is rendered K times back to back between gl.finish() calls, so the wall time per render is the real throughput cost
// (CPU submission and GPU execution, not hidden by vsync).
// node tests/gpuframe.mjs [views=drive,street,aerial,night] [toggles=all] [w=1440] [h=900] [dpr=2]
// Prints the median render ms for the baseline and the saving of each toggle (each toggle applied alone, then restored).
import { chromium } from './lib/browser.mjs';
const [only = 'drive,street,aerial,night', togs = 'all', w = '1440', h = '900', dpr = '2'] = process.argv.slice(2);
const VIEWS = {
  drive: { t: 12, cam: [-60, 3.2, 1006], look: [-60, 2.5, 960] },
  drivedusk: { t: 18.4, cam: [-60, 3.2, 1006], look: [-60, 2.5, 960] },
  aerialdusk: { t: 18.4, cam: [700, 260, 900], look: [150, 60, 300] },
  street: { t: 11.5, cam: [-405, 1.9, 416], look: [-392, 3, 360] },
  aerial: { t: 14.5, cam: [700, 260, 900], look: [150, 60, 300] },
  night: { t: 21.5, cam: [-405, 1.9, 416], look: [-392, 3, 360] },
  bay: { t: 18.25, cam: [560, 24, 60], look: [1300, 90, 380] },
  gardens: { t: 16, cam: [1500, 40, 700], look: [1650, 30, 560] },
  shophouse: { t: 16.0, cam: [-640, 2.2, 860], look: [-600, 4, 905] },
  hdb: { t: 10, cam: [-1300, 2, 1350], look: [-1250, 8, 1300] },
};
// each toggle: [name, js that disables and returns a restore fn]
const TOGGLES = {
  reflection: `const w = g.water; const r = w.reflections; w.reflections = false; return () => { w.reflections = r; };`,
  shadows: `const s = g.R.renderer.shadowMap; s.autoUpdate = false; s.needsUpdate = false; return () => { s.autoUpdate = true; };`,
  walls: `const B = g.city.batches; if (B) { const L = ['walls'].map(k => B[k]).filter(Boolean); L.forEach(b => b.visible = false); return () => L.forEach(b => b.visible = true); } const a = g.city.chunks.map(c => c.meshes.walls).filter(Boolean); const u = g.city.update.bind(g.city); g.city.update = (...x) => { u(...x); a.forEach(m => m.visible = false); }; return () => { g.city.update = u; };`,
  roofs: `const B = g.city.batches; if (B) { const L = ['roofs'].map(k => B[k]).filter(Boolean); L.forEach(b => b.visible = false); return () => L.forEach(b => b.visible = true); } const a = g.city.chunks.map(c => c.meshes.roofs).filter(Boolean); const u = g.city.update.bind(g.city); g.city.update = (...x) => { u(...x); a.forEach(m => m.visible = false); }; return () => { g.city.update = u; };`,
  roads: `const B = g.city.batches; if (B) { const L = ['roads', 'foot'].map(k => B[k]).filter(Boolean); L.forEach(b => b.visible = false); return () => L.forEach(b => b.visible = true); } const a = g.city.chunks.flatMap(c => [c.meshes.roads, c.meshes.foot]).filter(Boolean); const u = g.city.update.bind(g.city); g.city.update = (...x) => { u(...x); a.forEach(m => m.visible = false); }; return () => { g.city.update = u; };`,
  struct: `const B = g.city.batches; if (B) { const L = ['struct'].map(k => B[k]).filter(Boolean); L.forEach(b => b.visible = false); return () => L.forEach(b => b.visible = true); } const a = g.city.chunks.map(c => c.meshes.struct).filter(Boolean); const u = g.city.update.bind(g.city); g.city.update = (...x) => { u(...x); a.forEach(m => m.visible = false); }; return () => { g.city.update = u; };`,
  ground: `const L = [g.city.ground, g.city.groundShore].filter(Boolean); L.forEach(m => m.visible = false); return () => L.forEach(m => m.visible = true);`,
  veg: `const L = []; g.scene.traverse(o => { if (__owner.get(o) === 'veg' && o.visible && (o.isMesh || o.isPoints)) { L.push(o); } }); const u = g.veg.update.bind(g.veg); g.veg.update = (...x) => { u(...x); L.forEach(o => o.visible = false); }; L.forEach(o => o.visible = false); return () => { g.veg.update = u; L.forEach(o => o.visible = true); };`,
  landmarks: `g.landmarks.group.visible = false; return () => { g.landmarks.group.visible = true; };`,
  streetDetail: `const L = []; g.scene.children.forEach(o => { if (__owner.get(o) === 'streetDetail' && o.visible) { L.push(o); o.visible = false; } }); return () => L.forEach(o => o.visible = true);`,
  streetProps: `const L = []; g.scene.children.forEach(o => { if ((__owner.get(o) === 'streetProps' || __owner.get(o) === 'props') && o.visible) { L.push(o); o.visible = false; } }); return () => L.forEach(o => o.visible = true);`,
  actors: `const L = []; g.scene.children.forEach(o => { const m = __owner.get(o); if ((m === 'traffic' || m === 'peds' || m === 'vehicles') && o.visible) { L.push(o); o.visible = false; } }); return () => L.forEach(o => o.visible = true);`,
  water: `g.water.mesh.visible = false; const r = g.water.reflections; g.water.reflections = false; return () => { g.water.mesh.visible = true; g.water.reflections = r; };`,
  sky: `const m = g.sky.sky || g.sky.mesh; if (!m) return () => {}; m.visible = false; return () => { m.visible = true; };`,
  ao: `g.R.ao.enabled = false; return () => { g.R.ao.enabled = true; };`,
  hf: `const o = __HF.on.value; __HF.on.value = 0; return () => { __HF.on.value = o; };`,
  aoq: `const c = g.R.ao.configuration, s = c.aoSamples; c.aoSamples = 4; return () => { c.aoSamples = s; };`,
  bloom: `const b = g.R.bloom; const o = b.blendMode.opacity.value; b.blendMode.opacity.value = 0; return () => { b.blendMode.opacity.value = o; };`,
  smaa: `g.R.smaaPass.enabled = false; g.R.composer.passes.filter(p => p.enabled).at(-1).renderToScreen = true; return () => { g.R.smaaPass.enabled = true; };`,
  impShadow: `const m = g.veg.impostors; m.castShadow = false; return () => { m.castShadow = true; };`,
  nearShadow: `const L = g.veg.meshes.filter(m => m.castShadow); L.forEach(m => m.castShadow = false); return () => L.forEach(m => m.castShadow = true);`,
  impostors: `const m = g.veg.impostors; m.visible = false; return () => { m.visible = true; };`,
  god: `const e = g.R.godPass.enabled; g.R.godPass.enabled = false; return () => { g.R.godPass.enabled = e; };`,
};
const browser = await chromium.launch({ exclusive: true, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&fixedres${process.env.Q ? '&' + process.env.Q : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const g = __game, gl = g.R.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const owner = window.__owner = new Map(), seen = new Set();
  const scan = (o, mod, depth) => {
    if (!o || typeof o !== 'object' || seen.has(o) || depth > 4) return; seen.add(o);
    if (o.isObject3D) { o.traverse(c => { if (!owner.has(c)) owner.set(c, mod); }); return; }
    if (o instanceof Map) { for (const v of o.values()) scan(v, mod, depth + 1); return; }
    if (ArrayBuffer.isView(o) || o.isMaterial || o.isBufferGeometry || o.isTexture || o === g) return;
    for (const k of Object.keys(o)) { if (k === 'game' || k === 'scene' || k === 'camera') continue; try { scan(o[k], mod, depth + 1); } catch { } }
  };
  for (const m of ['city', 'veg', 'landmarks', 'props', 'streetProps', 'streetDetail', 'traffic', 'peds', 'water', 'sky']) scan(g[m], m, 0);
  for (const v of g.vehicles) v.root.traverse(c => owner.set(c, 'vehicles'));
  import('/src/gfx/heightfield.js').then(m => { window.__HF = m.HF; });
  window.__bench = (k = 6) => {
    const R = g.R; gl.finish(); const t0 = performance.now();
    for (let i = 0; i < k; i++) { g.water.renderReflection(R.renderer, g.scene, g.camera); R.render(1 / 60); }
    gl.finish(); return (performance.now() - t0) / k;
  };
});
const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };
const measure = async () => { const gpu = []; for (let i = 0; i < 12; i++) { gpu.push(await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(__bench()))))); } return { gpu, cpu: [0] }; };
for (const name of only.split(',')) {
  const v = VIEWS[name]; if (!v) continue;
  await page.evaluate(v => {
    const g = __game; const V = g.camera.position.constructor;
    g.sky.time = v.t; g.timeScale = 0; g.weather.force(v.rain || 0);
    g.player.teleport(new V(v.cam[0], 0, v.cam[2]), 0); g.player.root.visible = false;
    g.cameraRig.override = { position: new V(...v.cam), lookAt: new V(...v.look), snap: true, fov: 62 };
    g.sky.refreshEnv();
  }, v);
  await page.waitForTimeout(3000);
  await measure(); const base = await measure();
  const b = med(base.gpu);
  const info = await page.evaluate(() => { const i = __game.R.renderer.info.render; return `${i.calls} calls ${(i.triangles / 1e6).toFixed(2)}M tris`; });
  console.log(`\n=== ${name}: render ${b.toFixed(2)} ms (min ${Math.min(...base.gpu).toFixed(2)}), ${info}`);
  for (const t of (togs === 'all' ? Object.keys(TOGGLES) : togs.split(','))) {
    // interleaved A/B pairs cancel GPU clock drift: (base, toggled) x 8, median of the differences
    const r = await page.evaluate(async src => {
      const g = __game, raf = () => new Promise(r => requestAnimationFrame(r)), d = [], off = [];
      for (let i = 0; i < 8; i++) {
        await raf(); await raf(); const a = __bench();
        const restore = new Function('g', src)(g); await raf(); await raf(); const b = __bench(); restore(); off.push(b);
        d.push(a - b);
      }
      d.sort((x, y) => x - y); off.sort((x, y) => x - y);
      return { save: d[4], off: off[4] };
    }, TOGGLES[t]);
    console.log(`  -${t.padEnd(13)} ${r.off.toFixed(2).padStart(6)} ms  saves ${r.save.toFixed(2).padStart(6)} ms`);
  }
}
await browser.close();
