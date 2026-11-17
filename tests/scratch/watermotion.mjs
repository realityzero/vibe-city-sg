// Water in motion on the phone profile: records the screen while the camera glides along the river at night (and pans
// fast), then tiles frames into contact sheets to look for swimming, lag or edge artefacts in the reflection.
//   node tests/scratch/watermotion.mjs [--url http://127.0.0.1:4173/] [--out /tmp/vc-watermotion] [--t 20.5]
import { launch } from '../mobile/lib.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), OUT = arg('out', '/tmp/vc-watermotion'), T = arg('t', '20.5');
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const h = await launch('chromium', { exclusive: false });
await h.ctx.close();
const ctx = await h.browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, recordVideo: { dir: OUT, size: { width: 844, height: 390 } } });
const page = await ctx.newPage();
await page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=${T}&q=low&fixedres`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
await page.evaluate(() => { document.getElementById('ui').style.display = 'none'; __game.timeScale = 0; });
// glide downstream along the river (8 m/s) looking across it, then a fast pan (90 deg/s) back and forth
await page.evaluate(() => {
  const g = __game, V = g.camera.position.constructor, start = performance.now();
  const step = () => {
    const s = (performance.now() - start) / 1000;
    let pos, look;
    if (s < 4) { pos = new V(-560 + s * 8, 7, -300 - s * 2); look = new V(pos.x + 40, 4, pos.z - 70); }
    else { const a = Math.sin((s - 4) * 1.6) * 0.8; pos = new V(-528, 7, -308); look = new V(pos.x + Math.sin(a) * 80, 4, pos.z - Math.cos(a) * 80); }
    g.cameraRig.override = { position: pos, lookAt: look, snap: true, fov: 62 };
    if (s < 8) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});
await page.waitForTimeout(8500);
const video = await page.video().path();
await ctx.close(); await h.browser.close();
const cut = (from, name) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(from), '-t', '2', '-i', video, '-vf', 'fps=8,scale=422:-1,tile=4x4', '-frames:v', '1', `${OUT}/${name}.png`]);
// the recording starts at page creation: find the glide by the video's length (it ends ~0.5 s after the motion)
const dur = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]).toString();
cut(dur - 8.5 + 1, 'glide'); cut(dur - 8.5 + 4.5, 'pan');
console.log(`contact sheets: ${OUT}/glide.png, ${OUT}/pan.png (video ${video}, ${dur.toFixed(1)} s)`);
