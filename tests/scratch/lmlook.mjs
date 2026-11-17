// Ad-hoc camera views for landmark look-dev, one page load for all of them.
//   node tests/scratch/lmlook.mjs --out /tmp/look [--url http://127.0.0.1:4173/] [--q high|low] [--phone] [--fov 62]
//        --views 'name@t@x,y,z@lx,ly,lz;name2@...'
import { launch } from '../mobile/lib.mjs';
import fs from 'fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), OUT = arg('out', '/tmp/look'), PHONE = process.argv.includes('--phone');
const Q = arg('q', PHONE ? 'low' : 'high'), FOV = +arg('fov', 62);
const VIEWS = arg('views', '').split(';').filter(Boolean).map(v => { const [n, t, p, l] = v.split('@'); return [n, +t, p.split(',').map(Number), l.split(',').map(Number)]; });
fs.mkdirSync(OUT, { recursive: true });
const h = await launch('chromium', { exclusive: false, device: PHONE ? undefined : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 } });
const errs = []; h.page.on('pageerror', e => errs.push(e.message));
await h.page.goto(`${URL0}?skipTitle&newgame&freeroam=8&q=${Q}&fixedres&t=${VIEWS[0]?.[1] ?? 12}`, { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
for (const [name, t, pos, look] of VIEWS) {
  await h.page.evaluate(([t, pos, look, fov]) => {
    const g = __game, V = g.camera.position.constructor;
    document.getElementById('ui').style.display = 'none';
    g.sky.time = t; g.timeScale = 0;
    g.cameraRig.override = { position: new V(...pos), lookAt: new V(...look), snap: true, fov };
    g.sky.refreshEnv?.();
  }, [t, pos, look, FOV]);
  await h.page.waitForTimeout(3500);
  await h.page.screenshot({ path: `${OUT}/${name}.png` });
}
if (errs.length) console.log('page errors:', errs.slice(0, 3));
await h.browser.close();
console.log(`${VIEWS.length} views -> ${OUT}`);
