// radar + full-map screenshots from two builds (same player position), diffed
import { launch } from '../mobile/lib.mjs';
import fs from 'fs';
const shots = {};
for (const [tag, u] of [['a', process.argv[2]], ['b', process.argv[3]]]) {
  const h = await launch('chromium', { exclusive: false, device: { viewport: { width: 1100, height: 700 } } });
  await h.page.goto(u + '?skipTitle&newgame&freeroam=8&t=11', { waitUntil: 'load' });
  await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 240000 });
  await h.page.waitForTimeout(1500);
  await h.page.evaluate(() => { __game.paused = true; });
  await h.page.waitForTimeout(800);
  await h.page.locator('.vc-radar-wrap').screenshot({ path: `/tmp/vc/map_radar_${tag}.png` });
  await h.page.evaluate(() => __game.openMap());
  await h.page.waitForTimeout(1500);
  await h.page.screenshot({ path: `/tmp/vc/map_full_${tag}.png` });
  await h.page.evaluate(() => { const v = __game.ui.map.view; v.zoomAt(4); v.zoomAt(2); });
  await h.page.waitForTimeout(2500);
  await h.page.screenshot({ path: `/tmp/vc/map_zoom_${tag}.png` });
  await h.browser.close();
}
const h = await launch('chromium', { exclusive: false });
for (const n of ['radar', 'full', 'zoom']) {
  const [a, b] = ['a', 'b'].map(t => 'data:image/png;base64,' + fs.readFileSync(`/tmp/vc/map_${n}_${t}.png`).toString('base64'));
  const r = await h.page.evaluate(async ([a, b]) => { const L = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = s; }); const [x, y] = await Promise.all([L(a), L(b)]); const c = document.createElement('canvas'); c.width = x.width; c.height = x.height; const g = c.getContext('2d'); g.drawImage(x, 0, 0); const A = g.getImageData(0, 0, c.width, c.height).data; g.drawImage(y, 0, 0); const B = g.getImageData(0, 0, c.width, c.height).data; let big = 0, se = 0; for (let i = 0; i < A.length; i += 4) { let m = 0; for (let k = 0; k < 3; k++) { const e = A[i + k] - B[i + k]; se += e * e; m = Math.max(m, Math.abs(e)); } if (m > 8) big++; } const mse = se / (A.length / 4 * 3); return { psnr: mse ? 10 * Math.log10(65025 / mse) : 99, big: big / (A.length / 4) }; }, [a, b]);
  console.log(n.padEnd(6), 'PSNR', r.psnr.toFixed(1), 'dB', (r.big * 100).toFixed(2) + '% px > 8/255');
}
await h.browser.close();
