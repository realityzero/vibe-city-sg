// Visual A/B: renders the same viewpoints from two builds/variants and diffs them, so memory and engine changes can
// be shown not to change the picture.
//   node tests/mobile/visual.mjs [--a ''] [--b keepsrc] [--url http://127.0.0.1:4173/] [--q low] [--size 844x390@3]
//                                [--t 11] [--out /tmp/vc-visual]
// --a / --b are extra query strings (e.g. --b keepsrc compares against the run with texture-source release off);
// --url-b points variant B at another server (e.g. a baseline build). Math.random is seeded, simulation paused,
// UI hidden. Prints PSNR and the share of pixels differing by more than 8/255 per view; writes A, B and an
// amplified diff image per view.
import { launch } from './lib.mjs';
import fs from 'fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const A = arg('a', ''), B = arg('b', 'keepsrc'), URL_A = arg('url', 'http://127.0.0.1:4173/'), URL_B = arg('url-b', URL_A);
const Q = arg('q', 'low'), T = arg('t', '11'), OUT = arg('out', '/tmp/vc-visual'), engine = arg('engine', 'chromium');
const [, W, H, DPR] = arg('size', '844x390@3').match(/(\d+)x(\d+)@?([\d.]*)/);
fs.mkdirSync(OUT, { recursive: true });

// [name, camera position, look-at]
const VIEWS = [
  ['chinatown', [-392, 3, 420], [-330, 2, 380]],
  ['marina-bay', [480, 40, 140], [760, 60, 300]],
  ['aerial', [-200, 420, 900], [200, 0, 100]],
  ['cbd-street', [80, 2.2, -30], [200, 20, -60]],
  ['hdb', [-1200, 30, -900], [-1000, 15, -800]],
  ['river', [-470, 6, -330], [-300, 10, -250]],
  // close-ups of a parked car (side and rear three-quarter) — the worst case for vehicle texture detail
  ['car-side', 'vehicle', [0, 1.3, 4.2]],
  ['car-rear', 'vehicle', [3.0, 1.6, 5.5]],
];

async function render(url, extra) {
  const h = await launch(engine, { exclusive: false, device: { viewport: { width: +W, height: +H }, deviceScaleFactor: +(DPR || 1), isMobile: !!DPR && +DPR > 1, hasTouch: !!DPR && +DPR > 1 } });
  if (process.argv.includes('--trees')) await h.page.addInitScript(() => { window.__keepTrees = 1; });
  await h.page.addInitScript(() => {
    let s = 0x9e3779b9; Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  });
  const errs = []; h.page.on('pageerror', e => errs.push(e.message));
  const q = `skipTitle&newgame&freeroam=8&q=${Q}&t=${T}&fixedres${extra ? '&' + extra : ''}`;
  await h.page.goto(url + (url.includes('?') ? '&' : '?') + q, { waitUntil: 'load' });
  await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 240000 });
  await h.page.evaluate(() => { document.getElementById('ui').style.display = 'none'; const st = document.getElementById('stats'); if (st) st.style.display = 'none'; __game.timeScale = 0; });
  await h.page.waitForTimeout(2500);
  // freeze everything that moves on its own: shader clock (foliage sway, water, signs), traffic, pedestrians
  await h.page.evaluate(() => {
    const g = __game; g.paused = true;
    Object.defineProperty(g.U.time, 'value', { get: () => 1000, set: () => { }, configurable: true });
    const tr = g.traffic?.renderer; if (tr) { for (const T of tr.types.values()) T.pool.mesh.visible = false; for (const p of Object.values(tr.wheelPools || {})) if (p.mesh) p.mesh.visible = false; }
    if (g.peds?.crowd?.mesh) g.peds.crowd.mesh.visible = false;
    // mission-marker arrows spin by frame time accumulated before the pause: pin them (extruded meshes in a marker group)
    g.scene.traverse(o => { if (o.isMesh && o.geometry?.type === 'ExtrudeGeometry' && o.parent?.children?.some(c => c.geometry?.type === 'CylinderGeometry')) o.rotation.y = 0; });
    // trees are randomised per session (Math.random, which three.js also draws on for every object's uuid), so any
    // change in object count reshuffles their leaves: leave them out of the comparison
    if (!window.__keepTrees) g.scene.traverse(o => { if (/^trees_/.test(o.name)) { o.castShadow = false; for (const m of [].concat(o.material || [])) m.visible = false; } });
  });
  const shots = [];
  for (const [name, p, l] of VIEWS) {
    await h.page.evaluate(([p, l]) => {
      const g = __game, V = g.camera.position.constructor;
      if (p === 'vehicle') { // a parked car near the safehouse, seen from its side (offset in the car's frame)
        const v = g.vehicles.filter(v => !v.isBoat && !v.isAircraft && v.spec.kind !== 'drone' && v.spec.track > 0 /* four wheels: a parked bike sways a little differently every run */).sort((a, b) => a.position.distanceTo(g.player.position) - b.position.distanceTo(g.player.position))[0];
        const o = new V(...l).applyQuaternion(v.quaternion);
        g.cameraRig.override = { position: v.position.clone().add(o), lookAt: v.position.clone().add(new V(0, 0.6, 0)), snap: true, fov: 50 };
      } else g.cameraRig.override = { position: new V(...p), lookAt: new V(...l), snap: true, fov: 62 };
    }, [p, l]);
    await h.page.waitForTimeout(2200);
    const f = `${OUT}/${name}-${extra || 'base'}${url === URL_B && URL_B !== URL_A ? '-b' : ''}.png`;
    await h.page.locator('#game').screenshot({ path: f });
    shots.push(f);
  }
  await h.browser.close();
  if (errs.length) console.log('page errors:', errs.slice(0, 3));
  return shots;
}

const sa = await render(URL_A, A), sb = await render(URL_B, B);
// diff in a browser page (no image libraries needed)
const h = await launch('chromium', { exclusive: false, device: { viewport: { width: 400, height: 300 } } });
let worst = Infinity;
for (let i = 0; i < VIEWS.length; i++) {
  const [a, b] = [sa[i], sb[i]].map(f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'));
  const r = await h.page.evaluate(async ([a, b]) => {
    const load = src => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const w = ia.width, hh = ia.height, c = document.createElement('canvas'); c.width = w; c.height = hh;
    const x = c.getContext('2d'); x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, w, hh).data; x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, w, hh);
    let se = 0, big = 0; const d = db.data;
    for (let k = 0; k < da.length; k += 4) {
      let m = 0; for (let ch = 0; ch < 3; ch++) { const e = da[k + ch] - d[k + ch]; se += e * e; m = Math.max(m, Math.abs(e)); }
      if (m > 8) big++;
      const v = Math.min(255, m * 8); d[k] = v; d[k + 1] = v * 0.3; d[k + 2] = 0; d[k + 3] = 255;
    }
    x.putImageData(db, 0, 0);
    const mse = se / (w * hh * 3);
    return { psnr: mse ? 10 * Math.log10(255 * 255 / mse) : 99, big: big / (w * hh), diff: c.toDataURL('image/png') };
  }, [a, b]);
  fs.writeFileSync(`${OUT}/${VIEWS[i][0]}-diff.png`, Buffer.from(r.diff.split(',')[1], 'base64'));
  worst = Math.min(worst, r.psnr);
  console.log(`${VIEWS[i][0].padEnd(12)} PSNR ${r.psnr.toFixed(1).padStart(5)} dB   ${(r.big * 100).toFixed(2).padStart(6)}% px differ >8/255`);
}
await h.browser.close();
console.log(`worst PSNR ${worst.toFixed(1)} dB (≥ 40 dB: indistinguishable; identical renders give 99) → ${OUT}`);
