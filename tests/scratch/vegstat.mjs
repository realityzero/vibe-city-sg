// Vegetation budget per view: node tests/scratch/vegstat.mjs [views] [shots-prefix]
// Prints per-LOD instances/triangles, draws (main/shadow/reflection), renderer totals, and optional screenshots.
import { chromium } from '../lib/browser.mjs';
const [only = 'drive,street,aerial,gardens', shots] = process.argv.slice(2);
const VIEWS = {
  drive: { t: 12, cam: [-60, 3.2, 1006], look: [-60, 2.5, 960] },
  street: { t: 11.5, cam: [-405, 1.9, 416], look: [-392, 3, 360] },
  aerial: { t: 14.5, cam: [700, 260, 900], look: [150, 60, 300] },
  gardens: { t: 16, cam: [1500, 40, 700], look: [1650, 30, 560] },
  night: { t: 21.5, cam: [-405, 1.9, 416], look: [-392, 3, 360] },
  park: { t: 9.5, cam: [-180, 1.8, 330], look: [-140, 4, 300] },
  bay: { t: 17.5, cam: [980, 2.0, 120], look: [1060, 5, 60] },
  orchard: { t: 10.5, cam: [-1450, 2.0, -240], look: [-1380, 6, -280] },
  padang: { t: 16.5, cam: [330, 1.8, -330], look: [450, 8, -450] },
  padangHi: { t: 16.5, cam: [300, 45, -300], look: [450, 0, -450] },
  canning: { t: 9, cam: [-420, 30, -200], look: [-300, 10, -380] },
  heli: { t: 15, cam: [-100, 110, -620], look: [-278, 0, -829] },
  heliTop: { t: 13, cam: [-250, 260, -720], look: [-278, 0, -829] },
  fcStreet: { t: 15, cam: [-160, 1.8, -700], look: [-278, 12, -829] },
};
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres${process.env.Q ? '&' + process.env.Q : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 400000 });
await page.waitForTimeout(1000);
await page.evaluate(() => { __game.ui.hud.setVisible(false); });
console.log(await page.evaluate(() => __game.veg.stats.join(' ')));
for (const name of only.split(',')) {
  const v = VIEWS[name]; if (!v) continue;
  await page.evaluate(v => {
    const g = __game; const V = g.camera.position.constructor;
    g.sky.time = v.t; g.timeScale = 0; g.weather.force(0);
    g.player.teleport(new V(v.cam[0], 0, v.cam[2]), 0); g.player.root.visible = false;
    g.cameraRig.override = { position: new V(...v.cam), lookAt: new V(...v.look), snap: true, fov: 62 };
  }, v);
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    const g = __game, out = { inst: [0, 0], tris: [0, 0], drawsMain: 0, drawsShadow: 0, drawsRefl: 0, shadowTris: 0, reflTris: 0 };
    const tri = (geo, n) => (geo.index ? geo.index.count : geo.attributes.position.count) / 3 * n;
    for (const im of g.veg.meshes) { if (!im.visible || !im.count) continue; const t = tri(im.geometry, im.count); out.inst[0] += im.count; out.tris[0] += t; out.drawsMain++; out.drawsShadow++; out.shadowTris += tri(im.geometry, im.shadowCount ?? im.count); }
    const imp = g.veg.impostors; if (imp) { const c = __game.camera.position; let n = 0; const a = imp.geometry.attributes.iA.array, u = g.veg.uFade.value, far = g.veg.uFar.value; for (let i = 0; i < a.length; i += 4) { const d = Math.hypot(a[i] - c.x, a[i + 1] - c.z); if (d > u.x && d < far) n++; } out.inst[1] = n; out.tris[1] = n * 4; out.drawsMain++; out.drawsShadow++; out.drawsRefl++; out.reflTris += imp.geometry.instanceCount * 4; out.impVerts = imp.geometry.instanceCount * 8; }
    if (g.veg.petals?.count) out.drawsMain++;
    const inf = g.R.renderer.info.render;
    return { ...out, tris: out.tris.map(t => (t / 1e6).toFixed(3) + 'M'), total: ((out.tris.reduce((a, b) => a + b, 0)) / 1e6).toFixed(2) + 'M', shadowTris: (out.shadowTris / 1e6).toFixed(2) + 'M', reflTris: (out.reflTris / 1e6).toFixed(2) + 'M', frame: `${inf.calls} calls ${(inf.triangles / 1e6).toFixed(2)}M`, fps: __game.fps?.toFixed(0) };
  });
  console.log(name.padEnd(8), JSON.stringify(r));
  if (shots) await page.screenshot({ path: `${shots}_${name}.png` });
}
await browser.close();
