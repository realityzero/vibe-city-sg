// City geometry budget: main-pass triangles of frustum-visible city chunk meshes per category, for the look/perf views,
// plus whole-city totals and the frame's renderer.info. node tests/scratch/bldbudget.mjs [views]
import { chromium } from '../lib/browser.mjs';
const [only] = process.argv.slice(2);
const VIEWS = {
  perf_drive: { t: 12, cam: [-60, 3.2, 1006], look: [-60, 2.5, 960] },
  street_noon: { t: 11.5, cam: [-405, 1.9, 416], look: [-392, 3, 360] },
  bay_sunset: { t: 18.25, cam: [560, 24, 60], look: [1300, 90, 380] },
  cbd_aerial: { t: 14.5, cam: [700, 260, 900], look: [150, 60, 300] },
  cbd_night: { t: 22.0, cam: [900, 160, 700], look: [150, 80, 300] },
  shophouse_rain: { t: 16.0, cam: [-640, 2.2, 860], look: [-600, 4, 905] },
  gardens_night: { t: 20.5, cam: [1500, 40, 700], look: [1650, 30, 560] },
  hdb_estate: { t: 16.5, cam: [-780, 45, 1150], look: [-690, 35, 1250] },
  respawn: { t: 12, cam: [-1590, 2.2, 840], look: [-1585, 4, 800] },
};
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&fixedres', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.waitForTimeout(1000);
const tot = await page.evaluate(() => {
  const g = __game, t = {};
  for (const c of g.city.chunks) { for (const [k, v] of Object.entries(c.tris || {})) t[k] = (t[k] || 0) + v; for (const k of ['wallsNear', 'structNear']) if (c.meshes[k]) t[k] = (t[k] || 0) + c.meshes[k].geometry.index.count / 3; }
  return { totals: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v / 1000) + 'k'])), stats: g.city.stats };
});
const { tc, ...st } = tot.stats; console.log('whole city', JSON.stringify(tot.totals), JSON.stringify(st));
if (tc) console.log('by category (k tris):', Object.entries(tc).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}`).join(' | '));
const sum = {};
for (const [name, v] of Object.entries(VIEWS)) {
  if (only && !only.split(',').includes(name)) continue;
  await page.evaluate(v => {
    const g = __game; const V = g.camera.position.constructor;
    g.sky.time = v.t; g.timeScale = 0; g.weather.force(v.rain || 0);
    g.player.teleport(new V(v.cam[0], 0, v.cam[2]), 0); g.player.root.visible = false;
    g.cameraRig.override = { position: new V(...v.cam), lookAt: new V(...v.look), snap: true, fov: 62 };
  }, v);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => {
    const g = __game, cam = g.camera, F = new (cam.projectionMatrix.constructor === Object ? Object : cam.constructor.prototype.constructor)();
    const THREE_Frustum = g.camera.constructor; // placeholder
    const pm = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
    // manual frustum from the projection*view matrix
    const e = pm.elements, planes = [];
    const P = (a, b, c, d) => { const l = Math.hypot(a, b, c); planes.push([a / l, b / l, c / l, d / l]); };
    P(e[3] - e[0], e[7] - e[4], e[11] - e[8], e[15] - e[12]); P(e[3] + e[0], e[7] + e[4], e[11] + e[8], e[15] + e[12]);
    P(e[3] + e[1], e[7] + e[5], e[11] + e[9], e[15] + e[13]); P(e[3] - e[1], e[7] - e[5], e[11] - e[9], e[15] - e[13]);
    P(e[3] - e[2], e[7] - e[6], e[11] - e[10], e[15] - e[14]); P(e[3] + e[2], e[7] + e[6], e[11] + e[10], e[15] + e[14]);
    const t = {}, n = {};
    const add = (k, s, tri) => { const ce = s.center; if (planes.some(p => p[0] * ce.x + p[1] * ce.y + p[2] * ce.z + p[3] < -s.radius)) return; t[k] = (t[k] || 0) + tri; n[k] = (n[k] || 0) + 1; };
    for (const c of g.city.chunks) {
      for (const k of Object.keys(c.tris || {})) if (c.vis[k]) add(k, c.sphere[k], c.tris[k]);
      for (const k of ['wallsNear', 'structNear']) { const m = c.meshes[k]; if (m && m.visible) add(k, m.geometry.boundingSphere, m.geometry.index.count / 3); }
    }
    const i = g.R.renderer.info.render;
    return { t, n, calls: i.calls, tris: i.triangles };
  });
  const bld = (r.t.walls || 0) + (r.t.roofs || 0) + (r.t.struct || 0) + (r.t.wallsNear || 0) + (r.t.structNear || 0);
  for (const k of Object.keys(r.t)) sum[k] = (sum[k] || 0) + r.t[k];
  console.log(name.padEnd(15), 'walls', Math.round((r.t.walls || 0) / 1000) + 'k', 'roofs', Math.round((r.t.roofs || 0) / 1000) + 'k', 'struct', Math.round((r.t.struct || 0) / 1000) + 'k', 'near', Math.round(((r.t.wallsNear || 0) + (r.t.structNear || 0)) / 1000) + 'k', '| bld', Math.round(bld / 1000) + 'k', '| roads', Math.round((r.t.roads || 0) / 1000) + 'k', 'foot', Math.round((r.t.foot || 0) / 1000) + 'k', '| city calls', Object.entries(r.n).map(([k, v]) => k[0] + k.slice(-4) + ':' + v).join(' '), '| frame', r.calls, 'calls', (r.tris / 1e6).toFixed(2) + 'M');
}
await browser.close();
