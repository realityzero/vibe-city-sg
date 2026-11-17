// Hero-vehicle close-ups in fixed poses (steered and turned wheels, brake / indicator / siren / headlights, pop-up
// lamps, rotor blades and blur discs, night beams) rendered by two builds and diffed (PSNR), like tests/mobile/visual.mjs.
//   node tests/scratch/heroshots.mjs --url http://127.0.0.1:4173/ --url-b http://127.0.0.1:4180/ [--out /tmp/vc-hero]
import { launch } from '../mobile/lib.mjs';
import fs from 'fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL_A = arg('url', 'http://127.0.0.1:4173/'), URL_B = arg('url-b', URL_A), OUT = arg('out', '/tmp/vc-hero');
fs.mkdirSync(OUT, { recursive: true });

// [name, type, camera offset in the vehicle's frame, look-at offset, pose]
const SHOTS = [
  ['sedan-side', 'sedan', [3.4, 0.75, 0.2], [0, 0.45, 0], { spin: 0.4 }],
  ['infernus-steer', 'infernus', [2.7, 0.9, -3.3], [0, 0.4, -0.6], { steer: 0.45, spin: 1.1 }],
  ['infernus-popups', 'infernus', [1.6, 1.5, -4.2], [0, 0.6, -1.2], { lights: { head: true }, popups: true }],
  ['police-rear', 'police', [2.4, 1.4, 4.6], [0, 0.7, 0], { lights: { brake: true, siren: true, indicatorL: true, reverse: true }, steer: -0.3 }],
  ['bike-side', 'bike', [2.6, 0.9, 0.3], [0, 0.6, 0], { steer: 0.35, spin: 0.8 }],
  ['taxi-front', 'taxi', [-1.8, 1.0, -4.6], [0, 0.6, -0.5], { lights: { head: true, indicatorR: true }, steer: 0.25 }],
  ['heli-blades', 'heli_police', [3, 7.5, 11], [0, 2, 0], { rotor: 0.6, lights: { head: true, siren: true } }],
  ['heli-blur', 'heli', [-3, 7.5, -11], [0, 2, 0], { rotorSpeed: 30 }],
];

async function render(url, t, shots, tag) {
  const h = await launch('chromium', { exclusive: false, device: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2 } });
  await h.page.addInitScript(() => {
    let s = 0x9e3779b9; Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  });
  const errs = []; h.page.on('pageerror', e => errs.push(e.message));
  await h.page.goto(url + `?skipTitle&newgame&freeroam=8&q=low&t=${t}&fixedres`, { waitUntil: 'load' });
  await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 240000 });
  await h.page.evaluate(() => { document.getElementById('ui').style.display = 'none'; const st = document.getElementById('stats'); if (st) st.style.display = 'none'; __game.timeScale = 0; });
  await h.page.waitForTimeout(2500);
  await h.page.evaluate(() => {
    const g = __game; g.paused = true;
    Object.defineProperty(g.U.time, 'value', { get: () => 1000, set: () => { }, configurable: true });
    const tr = g.traffic?.renderer; if (tr) { for (const T of tr.types.values()) T.pool.mesh.visible = false; for (const p of Object.values(tr.wheelPools || {})) if (p.mesh) p.mesh.visible = false; }
    if (g.peds?.crowd?.mesh) g.peds.crowd.mesh.visible = false;
    g.scene.traverse(o => { if (/^trees_/.test(o.name)) { o.castShadow = false; for (const m of [].concat(o.material || [])) m.visible = false; } });
    g.player.root.visible = false;
    // the sun's shadow box follows the player: pin where it settled so shadow texels line up from run to run
    const P = g.player.position; P.set(Math.round(P.x), Math.round(P.y * 4) / 4, Math.round(P.z));
    const markers = []; g.scene.traverse(o => { if (o.isMesh && o.geometry?.type === 'ExtrudeGeometry' && o.parent?.children?.some(c => c.geometry?.type === 'CylinderGeometry')) markers.push(o.parent); });
    for (const m of markers) m.visible = false; // mission markers bob and glow on their own clock
  });
  const files = [];
  for (const [name, type, cam, look, pose] of shots) {
    await h.page.evaluate(([type, cam, look, pose]) => {
      const g = __game, V = g.camera.position.constructor;
      for (const v of g.__heroShot || []) v.root.visible = false;
      const v = g.debugCar(type, false); (g.__heroShot ||= []).push(v);
      const M = v.model;
      M.wheels?.forEach((w, i) => { w.rotation.x = pose.spin || 0; if (i < 2 && M.wheelPivots[i]) M.wheelPivots[i].rotation.y = pose.steer || 0; });
      if (pose.rotor != null) { M.rotors.main.rotation.y = pose.rotor; M.rotors.tail.rotation.x = pose.rotor * 3; }
      const now = performance.now; performance.now = () => 4321.25e3; // pins the blink / siren / strobe clock
      M.setLights(pose.lights || {});
      M.rotorSpeed = pose.rotorSpeed || 0;
      M.update(pose.popups ? 1 : 0);
      performance.now = now;
      const o = new V(...cam).applyQuaternion(v.root.quaternion), l = new V(...look).applyQuaternion(v.root.quaternion);
      g.cameraRig.override = { position: v.root.position.clone().add(o), lookAt: v.root.position.clone().add(l), snap: true, fov: 50 };
    }, [type, cam, look, pose]);
    await h.page.waitForTimeout(1500);
    const f = `${OUT}/${name}-t${t}-${tag}.png`;
    await h.page.locator('#game').screenshot({ path: f });
    files.push(f);
  }
  await h.browser.close();
  if (errs.length) console.log('page errors:', errs.slice(0, 3));
  return files;
}

const night = SHOTS.filter(s => ['sedan-side', 'infernus-popups', 'police-rear', 'taxi-front', 'heli-blades'].includes(s[0]));
const runs = [[11, SHOTS], [22, night]];
const rendered = [];
for (const [t, shots] of runs) rendered.push([t, shots, await render(URL_A, t, shots, 'a'), await render(URL_B, t, shots, 'b')]);
// diff in a browser page (no image libraries needed), launched once the renders are done (browsers are rationed)
const h = await launch('chromium', { exclusive: false, device: { viewport: { width: 400, height: 300 } } });
let worst = Infinity;
for (const [t, shots, sa, sb] of rendered) {
  for (let i = 0; i < shots.length; i++) {
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
    fs.writeFileSync(`${OUT}/${shots[i][0]}-t${t}-diff.png`, Buffer.from(r.diff.split(',')[1], 'base64'));
    worst = Math.min(worst, r.psnr);
    console.log(`${(shots[i][0] + ' t' + t).padEnd(22)} PSNR ${r.psnr.toFixed(1).padStart(5)} dB   ${(r.big * 100).toFixed(2).padStart(6)}% px differ >8/255`);
  }
}
await h.browser.close();
console.log(`worst PSNR ${worst.toFixed(1)} dB → ${OUT}`);
