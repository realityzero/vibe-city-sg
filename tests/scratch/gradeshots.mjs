// Light / colour-grade look-dev: posed views across golden hour and dusk (incl. a west-facing hero into the low sun),
// phone and/or desktop, and a program check over a 17:00-22:00 time sweep (the sky, haze and grade must not compile
// anything new as the light changes).
//   node tests/scratch/gradeshots.mjs --url http://127.0.0.1:4173/ --out /tmp/grade [--sets phone,desktop] [--sweep]
//                                     [--only west-hero,mbs-night@21]
import { launch } from '../mobile/lib.mjs';
import fs from 'fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), OUT = arg('out', '/tmp/grade'), SETS = arg('sets', 'phone,desktop').split(','), ONLY = arg('only', '');
fs.mkdirSync(OUT, { recursive: true });

// [name, camera position, look-at, times] (the gallery's views where they share its name)
const VIEWS = [
  // from the Event Plaza in front of MBS across the bay to the Fullerton and Raffles Place: the sun sets behind the CBD
  ['west-hero', [1010, 18, 330], [560, 45, 210], [18.25, 18.5, 18.75, 18.9, 19.1]],
  // from the SkyPark's height into the low sun over the CBD (the disc and its glare clear of the skyline)
  ['west-high', [1180, 200, 400], [500, 150, 520], [18.5, 18.9]],
  ['marina-bay-golden', [480, 40, 140], [900, 60, 300], [17.5, 18.5, 18.75, 18.9, 19.1]],
  ['skyline-dusk', [480, 40, 140], [900, 60, 300], [19.4, 20, 22]],
  ['aerial-city', [-200, 420, 900], [200, 0, 100], [15]],
  ['hdb-estate', [-1200, 30, -900], [-1000, 15, -800], [9]],
  ['bridge-sheares', [1440, 40, -600], [1605, 22, -740], [12]],
  ['flyer', [1430, 35, -120], [1572, 60, -266], [9.5]],
  ['esplanade', [620, 25, -190], [700, 8, -300], [10]],
  ['clarke-quay-evening', [-470, 6, -330], [-300, 10, -250], [19.25]],
  ['merlion-night', [652, 7, 62], [611, 7, 22], [20.5]],
  ['supertrees-night', [1555, 32, 445], [1665, 25, 555], [20.5]],
  ['mbs-night', [880, 25, 620], [1291, 90, 377], [21]],
  ['chinatown-night', [-392, 3, 420], [-330, 2, 380], [21]],
];
const wanted = (name, t) => !ONLY || ONLY.split(',').some(o => o === name || o === `${name}@${t}`);

async function shoot(set) {
  const phone = set === 'phone';
  const h = await launch('chromium', { exclusive: false, device: phone ? undefined : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 } });
  const errs = []; h.page.on('pageerror', e => errs.push(e.message));
  await h.page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=17${phone ? '&q=low' : '&q=high'}&fixedres`, { waitUntil: 'load' });
  await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
  await h.page.evaluate(() => { __game.timeScale = 0; document.getElementById('ui').style.display = 'none'; });
  await h.page.waitForTimeout(3000);
  if (process.argv.includes('--sweep')) {
    // programs compiled while the clock runs from 17:00 to 22:00 right after the warm-up
    const n = await h.page.evaluate(async () => {
      const g = __game, p0 = new Set(g.R.renderer.info.programs), V = g.camera.position.constructor;
      const views = [[[480, 40, 140], [900, 60, 300]], [[-392, 3, 420], [-330, 2, 380]], [[652, 7, 62], [611, 7, 22]]];
      for (let t = 17; t <= 22.001; t += 0.1) {
        g.sky.time = t;
        const [pos, look] = views[Math.round(t * 10) % views.length];
        g.cameraRig.override = { position: new V(...pos), lookAt: new V(...look), snap: true, fov: 62 };
        await new Promise(r => setTimeout(r, 250));
      }
      return g.R.renderer.info.programs.filter(p => !p0.has(p)).map(p => p.name);
    });
    console.log(set, 'programs compiled during the 17:00-22:00 sweep:', n.length, n.join(', '));
  }
  for (const [name, pos, look, times] of VIEWS) for (const t of times) {
    if (!wanted(name, t)) continue;
    await h.page.evaluate(([pos, look, t]) => {
      const g = __game, V = g.camera.position.constructor;
      g.sky.time = t; g.sky.lastEnvTime = -100; // (a jump: the haze snaps to the new sky instead of easing over)
      g.player.teleport(new V(look[0] + (pos[0] - look[0]) * 0.25, 0, look[2] + (pos[2] - look[2]) * 0.25), 0);
      g.cameraRig.override = { position: new V(...pos), lookAt: new V(...look), snap: true, fov: 62 };
    }, [pos, look, t]);
    await h.page.waitForTimeout(3500);
    await h.page.screenshot({ path: `${OUT}/${set}-${name}@${t}.png` });
  }
  if (errs.length) console.log(set, 'page errors:', errs.slice(0, 3));
  await h.browser.close();
}
for (const set of SETS) await shoot(set);
console.log('shots ->', OUT);
