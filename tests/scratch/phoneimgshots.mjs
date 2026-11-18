// Stills of the phone image under different output-chain variants, same frame: the game loop is stopped at each view
// and the variants (renderer switches) are rendered in turn on the identical scene (each given 24 frames so temporal
// AA converges), screenshotted at the iPhone 12's device resolution. Compare crops with ffmpeg/imgcrop.
//   node tests/scratch/phoneimgshots.mjs --url http://127.0.0.1:4173/ --out /tmp/vc-img [--only flyer,aerial-city]
//        [--variants '{"before":{"taa":false,"upscale":false},"new":{}}']
import { launch } from '../mobile/lib.mjs';
import fs from 'fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), OUT = arg('out', '/tmp/vc-img'), ONLY = arg('only', '');
// a variant: { taa, upscale (bool), out (canvas px per CSS px), sharpen } — unset = the preset's own
const VARIANTS = JSON.parse(arg('variants', '{"before":{"taa":false,"upscale":false},"new":{}}'));
fs.mkdirSync(OUT, { recursive: true });
const VIEWS = [
  ['flyer', 9.5, [1430, 35, -120], [1572, 60, -266]],
  ['cbd-street', 13, [262, 2, 470], [300, 8, 520]],
  ['junction-traffic', 12, [-95, 42, 92], [-133, 0, 54]],
  ['aerial-city', 15, [-200, 420, 900], [200, 0, 100]],
  ['mbs-night', 21, [880, 25, 620], [1291, 90, 377]],
  ['supertrees-grove', 21.3, [1598, 6, 505], [1680, 24, 560]],
].filter(v => !ONLY || ONLY.split(',').includes(v[0]));

const h = await launch('chromium', { exclusive: false });
const errs = []; h.page.on('pageerror', e => errs.push(e.message));
let loadedT = null;
for (const [name, t, pos, look] of VIEWS) {
  if (loadedT !== t) {
    await h.page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=${t}&q=low&fixedres`, { waitUntil: 'load' });
    await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
    await h.page.evaluate(() => { __game.timeScale = 0; document.getElementById('ui').style.display = 'none'; });
    loadedT = t;
  }
  await h.page.evaluate(([pos, look]) => {
    const g = __game, V = g.camera.position.constructor;
    if (g.__tick) { g.tick = g.__tick; delete g.__tick; }
    g.player.teleport(new V(look[0] + (pos[0] - look[0]) * 0.25, 0, look[2] + (pos[2] - look[2]) * 0.25), 0);
    g.cameraRig.override = { position: new V(...pos), lookAt: new V(...look), snap: true, fov: 62 };
  }, [pos, look]);
  await h.page.waitForTimeout(3500);
  await h.page.evaluate(() => { const g = __game; g.__tick = g.tick; g.tick = () => { }; });
  for (const [vn, v] of Object.entries(VARIANTS)) {
    await h.page.evaluate(v => {
      const g = __game, R = g.R;
      R.__q0 ??= { ...R.q };
      Object.assign(R.q, R.__q0); R.allow.taa = v.taa ?? true; R.allow.upscale = v.upscale ?? true;
      if (v.out) R.q.upscale = v.out;
      if (v.sharpen !== undefined) R.q.sharpen = v.sharpen;
      R.applyQualityToPost(); R.resize();
      for (let i = 0; i < 24; i++) g.__tick(0);
    }, v);
    await h.page.screenshot({ path: `${OUT}/${name}-${vn}.png` });
  }
  console.log(name, 'done');
}
if (errs.length) console.log('page errors:', errs.slice(0, 3));
await h.browser.close();
