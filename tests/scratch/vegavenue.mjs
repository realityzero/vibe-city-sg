// find a road lined by leaning rain trees and shoot down its centreline: node tests/scratch/vegavenue.mjs out [n]
import { chromium } from '../lib/browser.mjs';
const [out = '/tmp/avenue', n = '3', t = '10.5'] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 300)); });
await page.goto(`http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 400000 });
console.log('leaning', await page.evaluate(() => __game.veg.leaning));
// candidate spots: lane points whose 60 m neighbourhood has the most leaning rain trees on both sides
const spots = await page.evaluate(n => {
  const g = __game, v = g.veg, M = v.matrices, res = [];
  for (const lane of g.roadnet.lanes.filter(l => l.cls <= 3)) {
    const P = lane.path.p; if (lane.path.cum.at(-1) < 120) continue;
    const a = P[0], b = P[P.length - 1];
    for (let k = 0; k < P.length - 1; k += 3) {
      const x = P[k][0], z = P[k][2]; let c = 0;
      for (const i of v.grid.get(Math.floor(x / v.cell) * 100003 + Math.floor(z / v.cell)) || []) if (v.types[i] === 0 && (M[i * 16 + 4] || M[i * 16 + 6])) c++;
      res.push({ x, z, c, dx: P[k + 1][0] - x, dz: P[k + 1][2] - z });
    }
  }
  res.sort((p, q) => q.c - p.c);
  const pick = []; for (const r of res) { if (pick.every(p => Math.hypot(p.x - r.x, p.z - r.z) > 400)) pick.push(r); if (pick.length >= n) break; }
  return pick;
}, +n);
for (const [i, s] of spots.entries()) {
  const l = Math.hypot(s.dx, s.dz);
  await page.evaluate(({ s, l, t }) => {
    const g = __game; const V = g.camera.position.constructor;
    g.ui.hud.setVisible(false); g.sky.time = +t; g.timeScale = 0; g.weather.force(0);
    g.player.teleport(new V(s.x, 0, s.z), 0); g.player.root.visible = false;
    g.cameraRig.override = { position: new V(s.x - s.dx / l * 30, 1.7, s.z - s.dz / l * 30), lookAt: new V(s.x + s.dx / l * 40, 4, s.z + s.dz / l * 40), snap: true, fov: 62 };
  }, { s, l, t });
  await page.waitForTimeout(2500);
  console.log(i, JSON.stringify(s));
  await page.screenshot({ path: `${out}_${i}.png` });
}
await browser.close();
