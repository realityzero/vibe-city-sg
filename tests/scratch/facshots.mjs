// Close facade views computed from real footprints: node tests/scratch/facshots.mjs prefix [names]
import { chromium } from '../lib/browser.mjs';
const [prefix = '/tmp/fac', only] = process.argv.slice(2);
const SHOTS = [
  // [name, building id, camera distance from wall, eye height, look height, time]
  ['shop_noon', 1573, 9, 1.7, 3.0, 11.5], ['shop_night', 1573, 9, 1.7, 3.0, 20.5], ['shop_late', 1573, 9, 1.7, 3.0, 23.5],
  ['office_day', 423, 18, 1.7, 9, 14], ['office_night', 423, 18, 1.7, 9, 21],
  ['glass_day', 5818, 45, 1.7, 40, 15], ['glass_night', 5818, 45, 1.7, 40, 21.5],
  ['hdb_day', 469, 28, 1.7, 14, 10], ['hdb_night', 469, 28, 1.7, 14, 21],
  ['sghc_day', 94, 16, 1.8, 3.5, 13], ['sghc_night', 94, 16, 1.8, 3.5, 21],
];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.evaluate(() => { const g = __game; g.ui.hud.setVisible(false); g.player.update = () => {}; g.player.root.visible = false; g.timeScale = 0; g.weather.force(0); });
for (const s of SHOTS) {
  if (only && !only.split(',').includes(s[0])) continue;
  const ok = await page.evaluate(([name, id, dist, eye, lookH, t]) => {
    const g = __game, V = g.camera.position.constructor, b = g.city.data.buildings.find(b => b.id === id); if (!b) return false;
    const p = b.p, n = p.length / 2; let cx = 0, cz = 0; for (let i = 0; i < n; i++) { cx += p[i * 2]; cz += p[i * 2 + 1]; } cx /= n; cz /= n;
    let best = null;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1], L = Math.hypot(bx - ax, bz - az); if (!best || L > best.L) best = { ax, az, bx, bz, L }; }
    const mx = (best.ax + best.bx) / 2, mz = (best.az + best.bz) / 2; let nx = -(best.bz - best.az) / best.L, nz = (best.bx - best.ax) / best.L;
    if (nx * (mx - cx) + nz * (mz - cz) < 0) { nx = -nx; nz = -nz; }
    g.sky.time = t; g.sky.refreshEnv();
    g.cameraRig.override = { position: new V(mx + nx * dist, eye, mz + nz * dist), lookAt: new V(mx, lookH, mz), snap: true, fov: 60 };
    return true;
  }, s);
  if (!ok) { console.log('missing', s[0]); continue; }
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${prefix}_${s[0]}.png` });
}
// respawn spot facing the SGH lobby
if (!only || only.split(',').includes('sgh')) for (const [nm, t] of [['sgh_day', 13], ['sgh_night', 21]]) {
  await page.evaluate(t => { const g = __game, V = g.camera.position.constructor; g.sky.time = t; g.sky.refreshEnv(); g.cameraRig.override = { position: new V(-1583, 1.8, 846), lookAt: new V(-1583, 4, 820), snap: true, fov: 62 }; }, t);
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${prefix}_${nm}.png` });
}
await browser.close();
