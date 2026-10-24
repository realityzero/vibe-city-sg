// Live-loop frame rate at the perf spot with things hidden one at a time (exclusive): node tests/scratch/livefps.mjs [view]
import { chromium } from '../lib/browser.mjs';
const VIEWS = { drive: { t: 12, cam: [-60, 3.2, 1006], look: [-60, 2.5, 960] }, aerial: { t: 14.5, cam: [700, 260, 900], look: [150, 60, 300] }, street: { t: 11.5, cam: [-405, 1.9, 416], look: [-392, 3, 360] } };
const v = VIEWS[process.argv[2] || 'drive'];
const browser = await chromium.launch({ exclusive: true, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&fixedres${process.env.Q ? '&' + process.env.Q : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.evaluate(v => { const g = __game, V = g.camera.position.constructor; g.sky.time = v.t; g.timeScale = 0; g.player.teleport(new V(v.cam[0], 0, v.cam[2]), 0); g.player.root.visible = false; g.cameraRig.override = { position: new V(...v.cam), lookAt: new V(...v.look), snap: true, fov: 62 };
  window.__ft = []; let last = performance.now(); const f = () => { const n = performance.now(); __ft.push(n - last); last = n; requestAnimationFrame(f); }; requestAnimationFrame(f); }, v);
await page.waitForTimeout(4000);
const T = {
  base: '',
  'city batches': `Object.values(g.city.batches || {}).forEach(b => b.visible = false); g.city.chunks.forEach(c => Object.values(c.meshes).forEach(m => { if (m.parent) m.visible = false; }));`,
  'city walls only': `if (g.city.batches) g.city.batches.walls.visible = false; else g.city.chunks.forEach(c => { if (c.meshes.walls) c.meshes.walls.visible = false; });`,
  'trees': `g.scene.traverse(o => { if (/^trees/.test(o.name)) o.visible = false; });`,
  'shadows': `g.R.renderer.shadowMap.autoUpdate = false;`,
  'reflection': `g.water.reflections = false;`,
  'post (AO/bloom/smaa)': `g.R.smaaPass.enabled = false; g.R.bloom.blendMode.opacity.value = 0;`,
};
for (const [name, js] of Object.entries(T)) {
  const res = await page.evaluate(async js => {
    const g = __game; const saved = []; g.scene.traverse(o => saved.push([o, o.visible])); const st = { sm: g.R.renderer.shadowMap.autoUpdate, refl: g.water.reflections, smaa: g.R.smaaPass.enabled, bo: g.R.bloom.blendMode.opacity.value };
    const cu = g.city.update.bind(g.city); g.city.update = (...a) => { cu(...a); new Function('g', js)(g); }; new Function('g', js)(g);
    const vu = g.veg?.update?.bind(g.veg); if (vu) g.veg.update = (...a) => { vu(...a); new Function('g', js)(g); };
    await new Promise(r => setTimeout(r, 800)); __ft.length = 0; await new Promise(r => setTimeout(r, 3000));
    const ft = __ft.slice().sort((a, b) => a - b); const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
    g.city.update = cu; if (vu) g.veg.update = vu; for (const [o, v] of saved) o.visible = v;
    g.R.renderer.shadowMap.autoUpdate = st.sm; g.water.reflections = st.refl; g.R.smaaPass.enabled = st.smaa; g.R.bloom.blendMode.opacity.value = st.bo;
    return { fps: (1000 / avg).toFixed(1), p50: ft[Math.floor(ft.length / 2)].toFixed(1), p95: ft[Math.floor(ft.length * 0.95)].toFixed(1) };
  }, js);
  console.log(name.padEnd(22), JSON.stringify(res));
}
await browser.close();
