// Thin occluders (core/occluders.js): Tommy with a tree trunk / lamp post between him and the follow camera, A/B with
// the near-plane cut off and on.
//   node tests/scratch/occluders.mjs [--url http://127.0.0.1:4173/] [--set phone|desktop] [--out /tmp/vc-occl]
import { launch } from '../mobile/lib.mjs';
import fs from 'fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), SET = arg('set', 'phone'), OUT = arg('out', '/tmp/vc-occl');
fs.mkdirSync(OUT, { recursive: true });
const phone = SET === 'phone';
const h = await launch('chromium', { exclusive: false, device: phone ? undefined : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 } });
const { page } = h, errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=11${phone ? '&q=low' : '&q=high'}&fixedres`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
await page.evaluate(() => { __game.timeScale = 0; });
// [name, x, z]: places near a street tree / a lamp post
const SPOTS = [['tree-chinatown', -380, 410], ['tree-cbd', 262, 470], ['tree-esplanade', 640, -300]];
for (const [name, x, z] of SPOTS) {
  const info = await page.evaluate(([x, z]) => {
    const g = __game, veg = g.veg, T = g.camera.position.constructor;
    // the nearest tree with open ground 3 m and 5 m beyond it (Tommy there, the camera behind the trunk)
    let best = null, bd = 1e9;
    for (let i = 0; i < veg.count; i++) {
      const tx = veg.pos[i * 2], tz = veg.pos[i * 2 + 1], d = Math.hypot(tx - x, tz - z);
      if (d < bd && d < 120) { bd = d; best = i; }
    }
    const tx = veg.pos[best * 2], tz = veg.pos[best * 2 + 1];
    for (let a = 0; a < 16; a++) {
      const yaw = a / 16 * Math.PI * 2, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const p = new T(tx + fx * 3.2, 0, tz + fz * 3.2);
      if (!g.safe.find(p, { vehicle: false, yaw })) continue;
      g.player.teleport(p, yaw); g.cameraRig.yaw = yaw; g.cameraRig.pitch = -0.15;
      return { tree: [tx.toFixed(1), tz.toFixed(1)], scale: veg.scale[best].toFixed(2), yaw };
    }
    return null;
  }, [x, z]);
  if (!info) { console.log(name, 'no spot'); continue; }
  await page.waitForTimeout(2500);
  await page.evaluate(() => { const o = __game.cameraRig.occluders; o._update = o.update; o.update = () => 0; });
  await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/${SET}-${name}-off.png` });
  await page.evaluate(() => { const o = __game.cameraRig.occluders; o.update = o._update; });
  await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/${SET}-${name}-on.png` });
  console.log(name, JSON.stringify(info), 'near', await page.evaluate(() => __game.camera.near));
}
if (errs.length) console.log('errors:', errs.slice(0, 6));
await h.browser.close();
