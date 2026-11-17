// Landmark draw calls per frame by landmark and pass (main / shadow / reflection), at fixed landmark views and on the
// phone drive, Low preset (phone profile) unless --q high.
//   node tests/scratch/lmdraws.mjs [--url http://127.0.0.1:4173/] [--q low] [--only drive,mbs-night]
import { launch } from '../mobile/lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), Q = arg('q', 'low'), ONLY = arg('only', '');
const VIEWS = [
  ['drive', 18.4, null, null],
  ['marina-bay-golden', 18.9, [480, 40, 140], [900, 60, 300]],
  ['mbs-night', 21, [880, 25, 620], [1291, 90, 377]],
  ['supertrees-night', 20.5, [1560, 8, 470], [1665, 25, 555]],
  ['flyer', 9.5, [1430, 35, -120], [1572, 60, -266]],
  ['esplanade', 10, [620, 25, -190], [700, 8, -300]],
  ['clarke-quay-evening', 19.25, [-470, 6, -330], [-300, 10, -250]],
  ['aerial-city', 15, [-200, 420, 900], [200, 0, 100]],
].filter(v => !ONLY || ONLY.split(',').includes(v[0]));

const h = await launch('chromium', { exclusive: false });
await h.page.goto(`${URL0}?skipTitle&newgame&freeroam=8&q=${Q}&fixedres`, { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
const p0 = await h.page.evaluate(() => __game.R.renderer.info.programs.length);
for (const [name, t, pos, look] of VIEWS) {
  await h.page.evaluate(([t, pos, look]) => {
    const g = __game, V = g.camera.position.constructor;
    g.sky.time = t; g.timeScale = 0;
    if (!pos) { g.cameraRig.override = null; void g.debugTp(-60, 1000, 0); void g.debugCar('infernus'); g.autopilot.engage({ x: 900, z: 250 }); }
    else g.cameraRig.override = { position: new V(...pos), lookAt: new V(...look), snap: true, fov: 62 };
  }, [t, pos, look]);
  await h.page.waitForTimeout(pos ? 3000 : 9000);
  const r = await h.page.evaluate(() => new Promise(res => {
    const R = __game.R.renderer, lm = __game.landmarks.group, counts = {}; let frames = 0, total = 0;
    const root = o => { for (let a = o; a; a = a.parent) if (a.parent === lm) return a.name; return null; };
    const orig = R.renderBufferDirect.bind(R);
    R.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
      total++;
      const n = root(object);
      if (n) {
        const p = /Depth|Distance/.test(material.type) ? 'shadow' : camera === __game.camera ? 'main' : 'refl';
        const c = counts[n] || (counts[n] = { main: 0, shadow: 0, refl: 0 }); c[p]++;
      }
      return orig(camera, scene, geometry, material, object, group);
    };
    const loop = () => { if (++frames < 30) requestAnimationFrame(loop); else { R.renderBufferDirect = orig; res({ counts, total: total / 30, tris: R.info.render.triangles }); } };
    requestAnimationFrame(loop);
  }));
  let lm = 0; const parts = [];
  for (const [k, c] of Object.entries(r.counts).sort()) { const s = (c.main + c.shadow + c.refl) / 30; lm += s; parts.push(`${k} ${(c.main / 30).toFixed(0)}/${(c.shadow / 30).toFixed(0)}/${(c.refl / 30).toFixed(0)}`); }
  console.log(`${name.padEnd(20)} all ${r.total.toFixed(0).padStart(4)}  landmarks ${lm.toFixed(0).padStart(3)}  (main/shadow/refl) ${parts.join(' · ')}`);
}
const p1 = await h.page.evaluate(() => __game.R.renderer.info.programs.length);
console.log(`programs: ${p0} at play start, ${p1} after the views`);
await h.browser.close();
