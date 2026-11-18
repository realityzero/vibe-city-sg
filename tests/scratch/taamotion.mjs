// The phone image in motion, frame by frame: the game loop is stopped and the game stepped at exactly 1/60 s per
// frame (sim + render), each frame screenshotted at the iPhone 12's device resolution (what the player sees, after
// the browser's own scaling). Crops of consecutive frames are tiled side by side to look for crawl (static detail
// flickering as the camera moves) and ghosting (trails behind moving cars and people).
//   node tests/scratch/taamotion.mjs --url http://127.0.0.1:4173/ --out /tmp/vc-taa/a [--params notaa] [--only drive]
import { launch } from '../mobile/lib.mjs';
import { execFileSync } from 'child_process';
import fs from 'fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), OUT = arg('out', '/tmp/vc-taa/run'), PARAMS = arg('params', ''), ONLY = arg('only', '');
fs.mkdirSync(OUT, { recursive: true });

// name, hour, setup (in page), per-frame camera (in page; null = the game's own follow camera), frames to warm, frames
// to keep, crops [x, y, w, h] in device pixels (2532x1170)
const SCENES = [
  // a slow pan across the Supertree grove at night: lattice, lights and leaves against the sky
  ['grove-pan', 21.3, null, (g, V, i) => { const a = 0.55 + i * 0.004; return [new V(1598, 6, 505), new V(1598 + Math.cos(a) * 100, 22, 505 + Math.sin(a) * 100)]; }, 40, 6, [[900, 150, 640, 420], [1500, 300, 640, 420]]],
  // a slow dolly past the Flyer by day: spokes, railings, roofs
  ['flyer-dolly', 9.5, null, (g, V, i) => [new V(1430 + i * 0.25, 35, -120), new V(1572, 60, -266)], 40, 6, [[1000, 100, 640, 420], [300, 600, 640, 420]]],
  // the aerial view drifting: roof tiles, facades, streets
  ['aerial-drift', 15, null, (g, V, i) => [new V(-200 + i * 0.6, 420, 900), new V(200 + i * 0.6, 0, 100)], 40, 6, [[1000, 500, 640, 420], [300, 200, 640, 420]]],
  // a fixed camera over a busy junction: moving cars and people (ghosting)
  ['junction', 12, g => { const V = g.camera.position.constructor; g.player.teleport(new V(-124, 0, 64), 0); }, (g, V) => [new V(-95, 42, 92), new V(-133, 0, 54)], 120, 6, [[900, 300, 760, 500], [200, 500, 760, 500]]],
  // a fixed camera over Sheares bridge: traffic at expressway speed through the frame (ghosting)
  ['bridge', 12, g => { const V = g.camera.position.constructor; g.player.teleport(new V(1564, 0, -705), 0); }, (g, V) => [new V(1440, 40, -600), new V(1605, 22, -740)], 300, 6, [[500, 820, 1300, 350], [800, 560, 900, 320]]],
  // driving on autopilot behind the car (the player's car, traffic, the street streaming past)
  ['drive', 18.4, g => { g.cameraRig.override = null; void g.debugTp(-60, 1000, 0); void g.debugCar('infernus'); g.autopilot.engage({ x: 900, z: 250 }); }, null, 420, 6, [[900, 450, 760, 520], [1700, 200, 760, 520], [100, 200, 760, 520]]],
  // the same drive watched from a fixed camera by the road, the car passing through the frame (no camera to carry it)
  ['passby', 18.4, g => { g.cameraRig.override = null; void g.debugTp(-60, 1000, 0); void g.debugCar('infernus'); g.autopilot.engage({ x: 900, z: 250 }); },
    (g, V, i) => {
      if (i < 400) return [g.camera.position.clone(), g.player.vehicle.position.clone()];
      const v = g.player.vehicle, f = new V(-Math.sin(v.yaw()), 0, -Math.cos(v.yaw()));
      window.__pb ??= [v.position.clone().addScaledVector(f, 14).add(new V(f.z * 7, 1.6, -f.x * 7)), v.position.clone().addScaledVector(f, 8)];
      return window.__pb;
    }, 412, 8, [[700, 300, 1100, 700]]],
];

const h = await launch('chromium', { exclusive: false });
const errs = []; h.page.on('pageerror', e => errs.push(e.message));
let loadedT = null;
for (const [name, t, setup, cam, warm, keep, crops] of SCENES) {
  if (ONLY && !ONLY.split(',').includes(name)) continue;
  if (loadedT !== t) {
    await h.page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=${t}&q=low&fixedres${PARAMS ? '&' + PARAMS : ''}`, { waitUntil: 'load' });
    await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
    await h.page.evaluate(() => { __game.timeScale = 0; document.getElementById('ui').style.display = 'none'; });
    await h.page.waitForTimeout(2000); loadedT = t;
  }
  // stop the loop: from here on the page renders only when stepped
  await h.page.evaluate(([setup, cam]) => {
    const g = __game; if (!g.__tick) { g.__tick = g.tick; g.tick = () => { }; }
    g.cameraRig.override = null;
    if (setup) (0, eval)(`(${setup})`)(g);
    window.__cam = cam ? (0, eval)(`(${cam})`) : null;
    window.__i = 0;
  }, [setup?.toString() || null, cam?.toString() || null]);
  const step = n => h.page.evaluate(n => {
    const g = __game, V = g.camera.position.constructor;
    for (let k = 0; k < n; k++) {
      if (window.__cam) { const [p, l] = window.__cam(g, V, window.__i); g.cameraRig.override = { position: p, lookAt: l, snap: true, fov: 62 }; }
      window.__i++; g.__tick(1 / 60);
    }
  }, n);
  // (warm-up in chunks: streaming, traffic spawning, the autopilot getting up to speed)
  for (let k = 0; k < warm; k += 30) { await step(Math.min(30, warm - k)); await h.page.waitForTimeout(50); }
  const frames = [];
  for (let k = 0; k < keep; k++) {
    await step(1);
    const f = `${OUT}/${name}-f${k}.png`; await h.page.screenshot({ path: f }); frames.push(f);
  }
  // one sheet per crop: the consecutive frames side by side (3 per row)
  crops.forEach(([x, y, w, hh], ci) => {
    const inputs = frames.flatMap(f => ['-i', f]);
    const filt = frames.map((_, k) => `[${k}:v]crop=${w}:${hh}:${x}:${y}[c${k}]`).join(';') + ';' + frames.map((_, k) => `[c${k}]`).join('') + `xstack=inputs=${frames.length}:layout=${frames.map((_, k) => `${(k % 3) ? Array.from({ length: k % 3 }, () => 'w0').join('+') : '0'}_${Math.floor(k / 3) ? Array.from({ length: Math.floor(k / 3) }, () => 'h0').join('+') : '0'}`).join('|')}`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filt, `${OUT}/${name}-crop${ci}.png`]);
  });
  await h.page.evaluate(() => { const g = __game; g.tick = g.__tick; delete g.__tick; g.cameraRig.override = null; g.autopilot?.disengage?.(); });
  console.log(`${name}: ${OUT}/${name}-crop*.png`);
}
if (errs.length) console.log('page errors:', errs.slice(0, 3));
await h.browser.close();
