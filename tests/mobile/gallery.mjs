// Scene gallery for judging the look of the game: fixed camera views (landmarks, streets, junctions, bridges) at three
// times of day, on the phone profile (Low preset, iPhone 12 landscape) and/or desktop High, traffic and crowds live.
//   node tests/mobile/gallery.mjs --out /tmp/vc-gallery/run1 [--url http://127.0.0.1:4173/] [--sets phone,desktop]
//                                 [--only merlion,bridge-east] [--t 12,21 (re-shoot the views at these hours: name@12)]
//                                 [--engine webkit]
import { launch } from './lib.mjs';
import fs from 'fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ENGINE = arg('engine', 'chromium'), OUT = arg('out', '/tmp/vc-gallery/run'), URL0 = arg('url', 'http://127.0.0.1:4173/'), SETS = arg('sets', 'phone,desktop').split(','), ONLY = arg('only', '');
fs.mkdirSync(OUT, { recursive: true });

// [name, time, camera position, look-at, hud?]  (hud: third-person gameplay with the HUD, camera from the game itself)
export const VIEWS = [
  ['merlion', 17.2, [652, 7, 62], [611, 7, 22]],
  ['merlion-wide', 17.2, [720, 22, 120], [600, 6, 10]],
  ['marina-bay-golden', 18.9, [480, 40, 140], [900, 60, 300]],
  ['mbs-night', 21, [880, 25, 620], [1291, 90, 377]],
  ['supertrees-night', 20.5, [1555, 32, 445], [1665, 25, 555]],
  ['supertrees-grove', 21.3, [1598, 6, 505], [1680, 24, 560]],
  ['flyer', 9.5, [1430, 35, -120], [1572, 60, -266]],
  ['esplanade', 10, [620, 25, -190], [700, 8, -300]],
  ['esplanade-bay', 17.5, [860, 22, -150], [700, 15, -310]],
  ['chinatown-street', 11, [-392, 3, 420], [-330, 2, 380]],
  ['chinatown-night', 21, [-392, 3, 420], [-330, 2, 380]],
  ['cbd-street', 13, [262, 2, 470], [300, 8, 520]],
  ['clarke-quay-evening', 19.25, [-470, 6, -330], [-300, 10, -250]],
  ['clarke-quay-river', 20.5, [-520, 8, -300], [-460, 4, -380]],
  ['merlion-night', 20.5, [652, 7, 62], [611, 7, 22]],
  ['hdb-estate', 9, [-1200, 30, -900], [-1000, 15, -800]],
  // (hdb-estate above looks at River Valley's condos; these are Bukit Merah's HDB blocks, playground and hawker centre)
  ['hdb-blocks', 9, [-1760, 30, 10], [-1900, 10, -80]],
  ['hdb-voiddeck', 11, [-1866, 1.7, -74], [-1882, 1.4, -94]],
  ['playground', 11, [-1914, 4.5, 1], [-1896, 0.8, 22]],   // (the estate's playground, fitness corner and courtyard)
  ['hawker-centre', 11, [-2580, 3, 814], [-2559, 2.5, 790]],
  ['hawker-maxwell', 11, [-422, 3, 722], [-462, 2.5, 742]],
  ['aerial-city', 15, [-200, 420, 900], [200, 0, 100]],
  ['junction-traffic', 12, [-95, 42, 92], [-133, 0, 54]],
  ['sidewalk-crowd', 12, [-382, 1.7, 412], [-350, 1.5, 385]],
  ['bridge-sheares', 12, [1440, 40, -600], [1605, 22, -740]],
  ['bridge-ayer-rajah', 12, [-490, 70, 1670], [-559, 7, 1593]],
  ['play-onfoot', 11, null, null, 'foot'],
  ['play-driving', 18.4, null, null, 'drive'],
];

async function shoot(set, list) {
  const phone = set === 'phone';
  const h = await launch(ENGINE, { exclusive: false, device: phone ? undefined : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 } });
  const errs = []; h.page.on('pageerror', e => errs.push(e.message));
  let loadedT = null;
  for (const [name, t, pos, look, hud] of list) {
    if (loadedT !== t) {
      await h.page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=${t}${phone ? '&q=low' : '&q=high'}&fixedres`, { waitUntil: 'load' });
      await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
      await h.page.evaluate(() => { __game.timeScale = 0; });
      await h.page.waitForTimeout(3000); loadedT = t;
    }
    await h.page.evaluate(([pos, look, hud]) => {
      const g = __game, V = g.camera.position.constructor, ui = document.getElementById('ui');
      ui.style.display = hud ? '' : 'none';
      if (hud === 'drive') { g.cameraRig.override = null; void g.debugTp(-60, 1000, 0); void g.debugCar('infernus'); g.autopilot.engage({ x: 900, z: 250 }); }
      else if (hud === 'foot') { g.cameraRig.override = null; g.player.teleport(new V(-380, 0, 410), 2.2); }
      else {
        // the player stands near what the camera looks at: traffic and crowds spawn around them, as they would in play
        g.player.teleport(new V(look[0] + (pos[0] - look[0]) * 0.25, 0, look[2] + (pos[2] - look[2]) * 0.25), 0);
        g.cameraRig.override = { position: new V(...pos), lookAt: new V(...look), snap: true, fov: 62 };
      }
    }, [pos, look, hud]);
    await h.page.waitForTimeout(hud === 'drive' ? 9000 : 3500);
    await h.page.screenshot({ path: `${OUT}/${set}-${name}.png` });
  }
  if (errs.length) console.log(set, 'page errors:', errs.slice(0, 3));
  await h.browser.close();
}
const TIMES = arg('t', '') ? arg('t').split(',').map(Number) : null;
const list = VIEWS.filter(v => !ONLY || ONLY.split(',').includes(v[0]))
  .flatMap(v => TIMES ? TIMES.map(t => [`${v[0]}@${t}`, t, ...v.slice(2)]) : [v]).sort((a, b) => a[1] - b[1]);
for (const set of SETS) await shoot(set, list);
console.log(`${list.length * SETS.length} shots → ${OUT}`);
