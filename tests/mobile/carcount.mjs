// Traffic where the camera looks: moving cars (and boats) visible per gallery view — in the frustum, within 300 m,
// not hidden behind the city — set up exactly as tests/mobile/gallery.mjs does (the player stands near what the
// camera frames, 3.5 s to settle; 9 s for the driving view).
//   node tests/mobile/carcount.mjs [--url http://127.0.0.1:4173/] [--q low|high] [--out dir] [--only a,b] [--settle ms]
import { launch } from './lib.mjs';
import fs from 'fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), Q = arg('q', 'low'), OUT = arg('out', ''), SETTLE = +arg('settle', 3500);
const ONLY = arg('only', 'junction-traffic,bridge-sheares,cbd-street,play-driving,merlion-wide,clarke-quay-river,esplanade-bay');
// the gallery's views (tests/mobile/gallery.mjs: importing it would run it) that frame roads or water
const ALL = [
  ['merlion-wide', 17.2, [720, 22, 120], [600, 6, 10]],
  ['esplanade-bay', 17.5, [860, 22, -150], [700, 15, -310]],
  ['cbd-street', 13, [262, 2, 470], [300, 8, 520]],
  ['clarke-quay-evening', 19.25, [-470, 6, -330], [-300, 10, -250]],
  ['clarke-quay-river', 20.5, [-520, 8, -300], [-460, 4, -380]],
  ['marina-bay-golden', 18.9, [480, 40, 140], [900, 60, 300]],
  ['aerial-city', 15, [-200, 420, 900], [200, 0, 100]],
  ['junction-traffic', 12, [-95, 42, 92], [-133, 0, 54]],
  ['bridge-sheares', 12, [1440, 40, -600], [1605, 22, -740]],
  ['bridge-ayer-rajah', 12, [-490, 70, 1670], [-559, 7, 1593]],
  ['chinatown-street', 11, [-392, 3, 420], [-330, 2, 380]],
  ['play-driving', 18.4, null, null, 'drive'],
];
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const phone = Q === 'low';
const h = await launch('chromium', { exclusive: false, device: phone ? undefined : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 } });
const errs = []; h.page.on('pageerror', e => errs.push(e.message));
const count = () => h.page.evaluate(() => {
  const g = __game, cam = g.camera, V = cam.position.constructor, P = cam.position;
  const seen = (x, y, z, lift) => {
    const d = Math.hypot(x - P.x, z - P.z); if (d > 300) return 0;
    const v = new V(x, y + lift, z).project(cam); if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return 0;
    const dir = new V(x - P.x, y + lift - P.y, z - P.z), L = dir.length(); dir.multiplyScalar(1 / L);
    return g.physics.raycast(P, dir, L - 3) ? 0 : 1;
  };
  let cars = 0, moving = 0, near = 0, parked = 0, boats = 0;
  for (const c of g.traffic.cars) {
    if (!seen(c.pos.x, c.pos.y, c.pos.z, 1)) continue;
    cars++; if (c.speed > 0.5) moving++; if (cam.position.distanceTo(c.pos) < 120) near++;
  }
  const pk = g.traffic.parked?.spots || [];
  for (const s of pk) if (s.on && seen(s.x, s.y, s.z, 1)) parked++;
  for (const b of g.boats?.list || []) if (seen(b.pos.x, b.pos.y, b.pos.z, 1.5)) boats++;
  // cars inside each other (traffic, parked, and the physics vehicles: the player's): oriented boxes on the ground,
  // overlapping by more than 0.25 m, not one on a flyover above the other
  const box = [...g.traffic.cars.map(c => ({ x: c.pos.x, y: c.pos.y, z: c.pos.z, yaw: c.yaw, l: c.spec.length, w: c.spec.width })),
    ...g.vehicles.filter(v => !v.isBoat && !v.isAircraft && v.spec?.length).map(v => ({ x: v.position.x, y: v.position.y, z: v.position.z, yaw: v.yaw(), l: v.spec.length, w: v.spec.width }))];
  let overlaps = 0;
  for (let i = 0; i < box.length; i++) for (let j = i + 1; j < box.length; j++) {
    const a = box[i], b = box[j], dx = b.x - a.x, dz = b.z - a.z;
    if (dx * dx + dz * dz > 100 || Math.abs(b.y - a.y) > 2.5) continue;
    let pen = Infinity;
    for (const c of [a, b]) for (const k of [0, 1]) {
      const ux = k ? -Math.sin(c.yaw) : Math.cos(c.yaw), uz = k ? -Math.cos(c.yaw) : -Math.sin(c.yaw);
      const ext = o => Math.abs(-Math.sin(o.yaw) * ux - Math.cos(o.yaw) * uz) * o.l / 2 + Math.abs(Math.cos(o.yaw) * ux - Math.sin(o.yaw) * uz) * o.w / 2;
      pen = Math.min(pen, ext(a) + ext(b) - Math.abs(dx * ux + dz * uz));
    }
    if (pen > 0.25) overlaps++;
  }
  return { cars, moving, near, parked, boats, overlaps, total: g.traffic.cars.length, draws: g.R.renderer.info.render.calls };
});
const list = ALL.filter(v => ONLY.split(',').includes(v[0])).sort((a, b) => a[1] - b[1]);
let loadedT = null, sum = 0, overlaps = 0;
for (const [name, t, pos, look, hud] of list) {
  if (loadedT !== t) {
    await h.page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=${t}&q=${Q}&fixedres`, { waitUntil: 'load' });
    await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
    await h.page.evaluate(() => { __game.timeScale = 0; });
    await h.page.waitForTimeout(3000); loadedT = t;
  }
  await h.page.evaluate(([pos, look, hud]) => {
    const g = __game, V = g.camera.position.constructor;
    document.getElementById('ui').style.display = hud ? '' : 'none';
    if (hud === 'drive') { g.cameraRig.override = null; void g.debugTp(-60, 1000, 0); void g.debugCar('infernus'); g.autopilot.engage({ x: 900, z: 250 }); }
    else if (hud === 'foot') { g.cameraRig.override = null; g.player.teleport(new V(-380, 0, 410), 2.2); }
    else {
      g.player.teleport(new V(look[0] + (pos[0] - look[0]) * 0.25, 0, look[2] + (pos[2] - look[2]) * 0.25), 0);
      g.cameraRig.override = { position: new V(...pos), lookAt: new V(...look), snap: true, fov: 62 };
    }
  }, [pos, look, hud]);
  await h.page.waitForTimeout(hud === 'drive' ? 9000 : SETTLE);
  const c = await count();
  sum += c.moving; overlaps += c.overlaps;
  console.log(`${name.padEnd(20)} cars in view ${String(c.cars).padStart(3)}  moving ${String(c.moving).padStart(3)}  <120 m ${String(c.near).padStart(3)}  parked ${String(c.parked).padStart(3)}  boats ${String(c.boats).padStart(2)}  overlapping ${c.overlaps}  (traffic ${c.total}, draws ${c.draws})`);
  if (OUT) await h.page.screenshot({ path: `${OUT}/${Q}-${name}.png` });
}
console.log(`moving cars in view, total over ${list.length} views: ${sum}; pairs of cars inside each other: ${overlaps}`);
if (errs.length) console.log('page errors:', errs.slice(0, 3));
await h.browser.close();
