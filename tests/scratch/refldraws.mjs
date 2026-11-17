// Draws issued by one water reflection render at phone settings, grouped by top-level owner and object name.
//   node tests/scratch/refldraws.mjs [--url http://127.0.0.1:4173/] [--mode lite|true]
import { launch } from '../mobile/lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), MODE = arg('mode', 'lite');
const h = await launch('chromium', { exclusive: false });
await h.page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=18.9&q=low&fixedres`, { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
await h.page.evaluate(() => { const g = __game, V = g.camera.position.constructor; g.timeScale = 0; g.cameraRig.override = { position: new V(480, 40, 140), lookAt: new V(900, 60, 300), snap: true, fov: 62 }; });
await h.page.waitForTimeout(3000);
const r = await h.page.evaluate(mode => {
  const g = __game, R = g.R.renderer, w = g.water;
  g.paused = true;
  w.setReflections(mode === 'lite' ? 'lite' : true);
  for (let i = 0; i < 8; i++) { w.renderReflection(R, g.scene, g.camera); g.R.render(1 / 60); }
  const top = o => { let a = o; while (a.parent && a.parent !== g.scene) a = a.parent; return a.name || a.type; };
  const counts = new Map(); let tris = 0, n = 0;
  const orig = R.renderBufferDirect;
  R.renderBufferDirect = function (cam, scene, geo, mat, obj, group) {
    const k = `${top(obj)} / ${obj.name || obj.type} (${mat.type}${mat.name ? ':' + mat.name : ''})`;
    const t0 = R.info.render.triangles, res = orig.apply(this, arguments), t = R.info.render.triangles - t0;
    const c = counts.get(k) || [0, 0]; c[0]++; c[1] += t; counts.set(k, c); n++; tris += t;
    return res;
  };
  // (lite: one full build is one call per job)
  const calls = mode === 'lite' ? w._lite.jobs.length : 1;
  for (let i = 0; i < calls; i++) w.renderReflection(R, g.scene, g.camera);
  R.renderBufferDirect = orig;
  g.paused = false;
  return { n, tris, list: [...counts].sort((a, b) => b[1][1] - a[1][1]).slice(0, 40) };
}, MODE);
console.log(`draws over one full reflection (${MODE}): ${r.n}, ${(r.tris / 1e3).toFixed(0)} k triangles`);
for (const [k, [c, t]] of r.list) console.log(String(c).padStart(5), String((t / 1e3).toFixed(1)).padStart(8), 'k', k);
await h.browser.close();
