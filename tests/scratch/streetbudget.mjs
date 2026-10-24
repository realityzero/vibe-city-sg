// Draws / triangles per game module and render pass (main / shadow / reflection) for one frame in the standard views.
// node tests/scratch/streetbudget.mjs [views] [modules=streetDetail,props,streetProps]
import { chromium } from '../lib/browser.mjs';
const [only = 'street_noon,street_night,cbd_aerial,shophouse_rain,drive', mods = 'streetDetail,props,streetProps'] = process.argv.slice(2);
const VIEWS = {
  street_noon: { t: 11.5, cam: [-405, 1.9, 416], look: [-392, 3, 360] },
  street_night: { t: 21.5, cam: [-405, 1.9, 416], look: [-392, 3, 360] },
  cbd_aerial: { t: 14.5, cam: [700, 260, 900], look: [150, 60, 300] },
  shophouse_rain: { t: 16.0, cam: [-640, 2.2, 860], look: [-600, 4, 905], rain: 1 },
  drive: { t: 12, cam: [-60, 3.2, 1006], look: [-60, 2.5, 960] },
};
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&fixedres', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.evaluate(() => {
  const g = __game, r = g.R.renderer;
  const owner = new Map(), seen = new Set();
  const scan = (o, mod, depth) => {
    if (!o || typeof o !== 'object' || seen.has(o) || depth > 4) return; seen.add(o);
    if (o.isObject3D) { o.traverse(c => { if (!owner.has(c)) owner.set(c, mod); }); return; }
    if (ArrayBuffer.isView(o) || o.isMaterial || o.isBufferGeometry || o.isTexture || o === g) return;
    for (const k of Object.keys(o)) { if (k === 'game' || k === 'scene' || k === 'camera') continue; try { scan(o[k], mod, depth + 1); } catch { } }
  };
  for (const m of ['streetDetail', 'props', 'streetProps', 'city', 'veg', 'landmarks', 'traffic', 'peds']) scan(g[m], m, 0);
  let pass = 'main';
  const S = window.__sb = { on: false, rows: {} };
  const orig = r.renderBufferDirect.bind(r);
  r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    if (S.on) {
      const mod = owner.get(object) || 'other';
      const tris = (geometry.index ? (group ? group.count : Math.min(geometry.index.count, geometry.drawRange.count)) : Math.min(geometry.attributes.position.count, geometry.drawRange.count)) / 3 * (object.isInstancedMesh ? object.count : 1);
      const k = mod + '|' + pass + '|' + (object.name || object.type);
      const row = S.rows[k] || (S.rows[k] = [0, 0]); row[0]++; row[1] += tris;
    }
    return orig(camera, scene, geometry, material, object, group);
  };
  const wrap = (obj, fn, name) => { const o = obj[fn].bind(obj); obj[fn] = function (...a) { const prev = pass; pass = name; try { return o(...a); } finally { pass = prev; } }; };
  wrap(r.shadowMap, 'render', 'shadow');
  wrap(g.water, 'renderReflection', 'refl');
});
for (const name of only.split(',')) {
  const v = VIEWS[name]; if (!v) continue;
  await page.evaluate(v => {
    const g = __game; const V = g.camera.position.constructor;
    g.sky.time = v.t; g.timeScale = 0; g.weather.force(v.rain || 0); g.U.wet.value = v.rain ? 1 : 0;
    g.player.teleport(new V(v.cam[0], 0, v.cam[2]), 0); g.player.root.visible = false;
    g.cameraRig.override = { position: new V(...v.cam), lookAt: new V(...v.look), snap: true, fov: 55 };
  }, v);
  await page.waitForTimeout(2500);
  const rows = await page.evaluate(async () => { __sb.rows = {}; __sb.on = true; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); __sb.on = false; return __sb.rows; });
  const agg = {};
  for (const [k, [n, t]] of Object.entries(rows)) { const [mod, pass] = k.split('|'); const a = agg[mod + '/' + pass] || (agg[mod + '/' + pass] = [0, 0]); a[0] += n / 2; a[1] += t / 2; }
  console.log(`\n== ${name}`);
  for (const [k, [n, t]] of Object.entries(agg).sort()) if (mods.split(',').includes(k.split('/')[0]) || process.env.ALL) console.log(`  ${k.padEnd(26)} ${String(Math.round(n)).padStart(4)} draws ${(t / 1e3).toFixed(1).padStart(8)}k tris`);
  if (process.env.DETAIL) for (const [k, [n, t]] of Object.entries(rows).sort((a, b) => b[1][1] - a[1][1]).slice(0, 25)) if (mods.split(',').includes(k.split('|')[0])) console.log(`     ${k.padEnd(44)} ${n / 2} ${(t / 2e3).toFixed(1)}k`);
}
await browser.close();
