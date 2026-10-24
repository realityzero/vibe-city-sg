// GPU time per pass / module / object, measured with EXT_disjoint_timer_query_webgl2 around every draw call.
// node tests/gpuprof.mjs [views=drive,street,aerial,night] [w=1440] [h=900] [dpr=2]
// Each draw is wrapped in its own TIME_ELAPSED query (renderer.renderBufferDirect), attributed to the render pass that
// issued it (shadow / reflection / main / post) and to the game module that owns the object (found by scanning the
// game's sub-systems for Object3Ds). Absolute numbers include some per-query overhead; compare them relatively.
import { chromium } from './lib/browser.mjs';
const [only = 'drive,street,aerial,night', w = '1440', h = '900', dpr = '2'] = process.argv.slice(2);
const VIEWS = {
  drive: { t: 12, cam: [-60, 3.2, 1006], look: [-60, 2.5, 960] },
  street: { t: 11.5, cam: [-405, 1.9, 416], look: [-392, 3, 360] },
  aerial: { t: 14.5, cam: [700, 260, 900], look: [150, 60, 300] },
  night: { t: 21.5, cam: [-405, 1.9, 416], look: [-392, 3, 360] },
  bay: { t: 18.25, cam: [560, 24, 60], look: [1300, 90, 380] },
  gardens: { t: 16, cam: [1500, 40, 700], look: [1650, 30, 560] },
  shophouse: { t: 16.0, cam: [-640, 2.2, 860], look: [-600, 4, 905] },
};
const browser = await chromium.launch({ exclusive: true, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&fixedres${process.env.Q ? '&' + process.env.Q : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const g = __game, R = g.R, r = R.renderer, gl = r.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const owner = new Map();
  const mods = ['city', 'veg', 'landmarks', 'props', 'streetProps', 'streetDetail', 'traffic', 'peds', 'water', 'sky', 'markers', 'fx', 'scenes', 'ambient', 'fireworks', 'spawns', 'player', 'wanted', 'missions', 'extras', 'weather', 'stunts', 'activities', 'services'];
  const seen = new Set();
  const scan = (o, mod, depth) => {
    if (!o || typeof o !== 'object' || seen.has(o) || depth > 4) return; seen.add(o);
    if (o.isObject3D) { o.traverse(c => { if (!owner.has(c)) owner.set(c, mod); }); return; }
    if (o instanceof Map) { for (const v of o.values()) scan(v, mod, depth + 1); return; }
    if (ArrayBuffer.isView(o) || o.isMaterial || o.isBufferGeometry || o.isTexture || o === g) return;
    for (const k of Object.keys(o)) { if (k === 'game' || k === 'scene' || k === 'camera') continue; try { scan(o[k], mod, depth + 1); } catch { } }
  };
  for (const m of mods) scan(g[m], m, 0);
  for (const v of g.vehicles) v.root.traverse(c => owner.set(c, 'vehicles'));
  let pass = 'main';
  const pool = [], pending = [];
  const P = window.__gp = { on: false, rows: new Map(), frames: 0, passes: new Map() };
  const orig = r.renderBufferDirect.bind(r);
  r.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    if (!P.on) return orig(camera, scene, geometry, material, object, group);
    const q = pool.pop() || gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    orig(camera, scene, geometry, material, object, group);
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    let mod = owner.get(object); if (!mod) { let o = object; while (o.parent && !owner.get(o)) o = o.parent; mod = owner.get(o) || (pass.startsWith('post') ? 'post' : 'other'); }
    const label = object.name || (object.isInstancedMesh ? 'inst' : object.type);
    pending.push({ q, key: `${pass}|${mod}|${label}|${material.type}${material.name ? ':' + material.name : ''}`, pass, tris: (geometry.index ? (group ? group.count : geometry.index.count) : geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1) });
  };
  const wrap = (obj, fn, name) => { const o = obj[fn].bind(obj); obj[fn] = function (...a) { const prev = pass; pass = name; try { return o(...a); } finally { pass = prev; } }; };
  wrap(r.shadowMap, 'render', 'shadow');
  wrap(g.water, 'renderReflection', 'reflection');
  R.composer.passes.forEach((p, i) => wrap(p, 'render', i === 0 ? 'main' : 'post' + i + ':' + (p.name || p.constructor.name)));
  P.collect = () => {
    for (let i = pending.length - 1; i >= 0; i--) {
      const e = pending[i];
      if (!gl.getQueryParameter(e.q, gl.QUERY_RESULT_AVAILABLE)) continue;
      const ns = gl.getQueryParameter(e.q, gl.QUERY_RESULT);
      const row = P.rows.get(e.key) || { ms: 0, n: 0, tris: 0 }; row.ms += ns / 1e6; row.n++; row.tris += e.tris; P.rows.set(e.key, row);
      pool.push(e.q); pending.splice(i, 1);
    }
  };
  const tick = () => { if (P.on) { P.frames++; P.collect(); } requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
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
  await page.evaluate(() => { __gp.rows.clear(); __gp.frames = 0; __gp.on = true; });
  await page.waitForTimeout(3000);
  const res = await page.evaluate(() => { __gp.on = false; __gp.collect(); const F = __gp.frames; return { F, rows: [...__gp.rows].map(([k, r]) => [k, r.ms / F, r.n / F, r.tris / F]) }; });
  const byPass = {}, byMod = {}, byModPass = {};
  let total = 0, draws = 0;
  for (const [k, ms, n, tris] of res.rows) {
    const [pass, mod] = k.split('|');
    const pk = pass.startsWith('post') ? pass : pass;
    byPass[pk] = (byPass[pk] || [0, 0, 0]); byPass[pk][0] += ms; byPass[pk][1] += n; byPass[pk][2] += tris;
    if (!pass.startsWith('post')) { byMod[mod] = (byMod[mod] || [0, 0, 0]); byMod[mod][0] += ms; byMod[mod][1] += n; byMod[mod][2] += tris; const mk = mod + '/' + pass; byModPass[mk] = (byModPass[mk] || 0) + ms; }
    total += ms; draws += n;
  }
  const f = (o, lim = 30) => Object.entries(o).sort((a, b) => (b[1][0] ?? b[1]) - (a[1][0] ?? a[1])).slice(0, lim).map(([k, v]) => Array.isArray(v) ? `  ${k.padEnd(34)} ${v[0].toFixed(2).padStart(6)} ms ${String(Math.round(v[1])).padStart(5)} draws ${(v[2] / 1e6).toFixed(2).padStart(5)}M tris` : `  ${k.padEnd(34)} ${v.toFixed(2).padStart(6)} ms`).join('\n');
  console.log(`\n=== ${name}  (${res.F} frames)  GPU total ${total.toFixed(2)} ms/frame, ${Math.round(draws)} draws/frame`);
  console.log(' by pass:\n' + f(byPass));
  console.log(' by module (scene passes):\n' + f(byMod));
  console.log(' by module/pass:\n' + f(byModPass, 24));
  console.log(' top draws:\n' + res.rows.sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, ms, n, tris]) => `  ${ms.toFixed(2).padStart(6)} ms ${String(Math.round(n)).padStart(4)}x ${(tris / 1e3).toFixed(0).padStart(6)}k  ${k}`).join('\n'));
}
await browser.close();
