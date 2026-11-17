// Frame strip of the new-game cold open (mission 1) and the hand-over to the player.
//   node tests/scratch/coldopen.mjs [--url http://127.0.0.1:4173/] [--set phone|desktop] [--out /tmp/vc-coldopen] [--skip 3]
// phone = iPhone 12 landscape (touch, Low preset), desktop = 1600x900 High. --skip <s>: press Enter that far in.
import { launch } from '../mobile/lib.mjs';
import fs from 'fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), SET = arg('set', 'phone'), OUT = arg('out', '/tmp/vc-coldopen'), SKIP = +arg('skip', 0);
fs.mkdirSync(OUT, { recursive: true });
const phone = SET === 'phone';
const h = await launch('chromium', { exclusive: false, device: phone ? undefined : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 } });
const { page } = h, errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await page.goto(`${URL0}?skipTitle&newgame${phone ? '&q=low' : '&q=high'}&fixedres`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play' && __game.cameraRig.override?.track, null, { timeout: 300000, polling: 50 });
const shotT = () => page.evaluate(() => __game.cameraRig.override?.t ?? -1);
const marks = [0.3, 1.5, 2.6, 4, 5.5, 7, 8.4, 9.6];
let k = 0, skipped = false;
for (;;) {
  const t = await shotT();
  if (t < 0) break;
  if (SKIP && !skipped && t >= SKIP) { skipped = true; await page.keyboard.press('Enter'); }
  if (k < marks.length && t >= marks[k]) { await page.screenshot({ path: `${OUT}/${SET}-a${String(k).padStart(2, '0')}-t${t.toFixed(1)}.png` }); k++; }
  await page.waitForTimeout(40);
}
// after the hand-over: the blend, then play
for (const [i, ms] of [[0, 250], [1, 700], [2, 1500], [3, 3500], [4, 7000]]) {
  await page.waitForTimeout(ms - (i ? [250, 700, 1500, 3500, 7000][i - 1] : 0));
  await page.screenshot({ path: `${OUT}/${SET}-b${i}-${ms}ms.png` });
}
const st = await page.evaluate(() => { const g = __game, v = g.player.vehicle; return { inCar: !!v, kmh: v ? Math.round(v.speed * 3.6) : 0, pos: [Math.round(g.player.position.x), Math.round(g.player.position.z)], cruise: !!g.player.autopilot, near: g.camera.near, markers: g.missions.markers.size, sub: !!g.ui._sub, time: g.sky.time.toFixed(2) }; });
console.log(JSON.stringify(st));
if (errs.length) console.log('errors:', errs.slice(0, 6));
await h.browser.close();
