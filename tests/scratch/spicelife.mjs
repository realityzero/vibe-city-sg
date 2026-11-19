// Frames of the street spice and the city remembering (phone and/or desktop): the 4 pm storm on Telok Ayer Street
// (weather.downpour: people dash for the five-foot ways, a kerb floods, the Infernus ploughs through it beside them),
// NS boys booked out at an MRT exit (the street-life director's scene, staged on demand), and CityTalk's mentions —
// a big fine read out by the DJ of the station on the car radio, a viral clip and a Merlion crash as texts — plus a
// crowd clip getting its bystander card in free roam. Logs what each beat did and any errors.
//   node tests/scratch/spicelife.mjs [--url http://127.0.0.1:4173/] [--sets phone,desktop] [--out /tmp/vc-spicelife]
import { launch } from '../mobile/lib.mjs';
import fs from 'fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), SETS = arg('sets', 'phone,desktop').split(','), OUT = arg('out', '/tmp/vc-spicelife');
fs.mkdirSync(OUT, { recursive: true });
for (const set of SETS) {
  const phone = set === 'phone';
  const h = await launch('chromium', { exclusive: false, device: phone ? undefined : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 } });
  const { page } = h, errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=15.9${phone ? '&q=low' : '&q=high'}&fixedres`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play' && __game.player.controlsEnabled, null, { timeout: 300000, polling: 200 });
  const T0 = Date.now(), log = (...a) => console.log(`[${set} ${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);
  const shot = async n => { const f = `${OUT}/${set}-${n}.png`; await page.screenshot({ path: f, timeout: 90000 }).then(() => log('shot', f), e => log('shot failed', f, e.message.split('\n')[0])); };
  await page.evaluate(() => { const g = __game; g.timeScale = 0; g.weather.burstDone = true; window.__p0 = g.R.renderer.info.programs.length; });

  // ---- the 4 pm storm on Telok Ayer Street: on foot on the pavement, looking down the street
  await page.evaluate(() => { const g = __game, sw = g.roadnet.nearestSidewalk(-70, 600, 60); g.relocate(sw.pos, Math.atan2(-sw.dir.x, -sw.dir.z), { exact: true }); g.cameraRig.yaw = Math.atan2(-sw.dir.x, -sw.dir.z); });
  await page.waitForTimeout(7000); await shot('storm-0-before');
  await page.evaluate(() => __game.weather.downpour(45));
  await page.waitForTimeout(1800); await shot('storm-1-dash');
  log(await page.evaluate(() => { const L = __game.peds.life, ev = L.event; return `scene ${ev ? 'storm' : 'none'} runners ${__game.peds.peds.filter(p => p.dash !== undefined && p.script).length} flood ${L.flood.mesh.visible ? `at ${Math.round(L.flood.mesh.position.x)},${Math.round(L.flood.mesh.position.z)}` : 'none'}`; }));
  await page.waitForTimeout(5000); await shot('storm-2-shelter');
  await page.waitForTimeout(12000); await shot('storm-3-flooded');
  // the Infernus through the flooded kerb, past whoever stands there
  log(await page.evaluate(() => {
    const g = __game, F = g.peds.life.flood; if (!F.mesh.visible) return 'no flood to drive through';
    const m = F.mesh.position, yaw = Math.atan2(-F.ax, -F.az), x = m.x - F.ax * 20, z = m.z - F.az * 20;
    for (const c of [...g.traffic.cars]) if (Math.hypot(c.pos.x - m.x, c.pos.z - m.z) < 45) g.traffic.despawn(c); // (a clear run at it)
    g.debugCar('infernus'); g.player.teleport(new (m.constructor)(x, 0, z), yaw); g.cameraRig.yaw = yaw;
    g.player.vehicle.body.setLinvel({ x: F.ax * 14, y: 0, z: F.az * 14 }, true);
    const st = g.input.stick; st.active = true; st.x = 0; st.y = 0.4; window.__splashes = 0;
    const off = g.events.on('views', e => { if (e.kind === 'splash') window.__splashes++; });
    setTimeout(() => { st.active = false; st.y = 0; off(); }, 4000);
    return `flood level ${F.level.toFixed(2)}, driving through from ${Math.round(x)},${Math.round(z)}`;
  }));
  await page.waitForTimeout(1500); await shot('storm-4-splash');
  await page.waitForTimeout(2600); log('splash clips', await page.evaluate(() => window.__splashes));
  await page.evaluate(() => { const g = __game; g.weather.force(0); g.weather.forced = null; });

  // ---- NS boys at an MRT exit: ~55 m from it, looking at it; the director stages them; then walk up
  let ns = 'no MRT exit fitted';
  const exits = await page.evaluate(() => __game.ambient.stations.length);
  for (let k = 0; k < exits && ns.startsWith('no'); k++) {
    const ok = await page.evaluate(k => {
      const g = __game, s = g.ambient.stations[k], sw = g.roadnet.nearestSidewalk(s.pos.x + 45, s.pos.z + 43, 40); if (!sw) return false;
      const yaw = Math.atan2(-(s.pos.x - sw.pos.x), -(s.pos.z - sw.pos.z));
      g.relocate(sw.pos, yaw, { exact: true }); g.cameraRig.yaw = yaw; return true;
    }, k);
    if (!ok) continue;
    await page.waitForTimeout(1200);
    ns = await page.evaluate(k => {
      const g = __game, L = g.peds.life, s = g.ambient.stations[k];
      L.event?.end(); L.event = null; L.critters.clear();
      const ev = L.nsBoys(12); if (!ev) return 'no';
      L.event = ev; window.__ns = s; return `NS boys at ${s.name} MRT`;
    }, k);
  }
  log(ns);
  await page.waitForTimeout(2500); await shot('ns-1-far');
  await page.evaluate(() => { const g = __game, s = window.__ns, at = g.peds.life.event?.at; if (!s || !at) return; const sw = g.roadnet.nearestSidewalk(at.x, at.z, 20), p = sw.pos.clone().addScaledVector(sw.dir, 6); const yaw = Math.atan2(-(at.x - p.x), -(at.z - p.z)); g.relocate(p, yaw, { exact: true }); g.cameraRig.yaw = yaw; });
  await page.waitForTimeout(3500); await shot('ns-2-near');

  // ---- the city remembers: a fine on the radio (in a car), a viral clip and the Merlion as texts (on foot)
  const say = (kind, data, onAir) => page.evaluate(([kind, data, onAir]) => {
    const g = __game, C = g.cityTalk, rnd = Math.random;
    Math.random = () => onAir ? 0 : 0.99;
    try { C.say({ kind, d: 'Downtown Core', data, t: C.t }); } finally { Math.random = rnd; }
    return g.ui.logEntries.slice(-1).map(e => (e.speaker ? e.speaker + ': ' : '') + e.text.replace(/<[^>]+>/g, ''))[0];
  }, [kind, data, onAir]);
  await page.evaluate(() => { const g = __game; g.debugTp(262, 470, 0); g.debugCar('infernus'); });
  await page.waitForTimeout(4000);
  log('radio:', await say('fine', { amt: 400, what: 'red-light camera' }, true));
  await page.waitForTimeout(900); await shot('talk-1-radio');
  await page.waitForTimeout(6500);
  await page.evaluate(() => __game.player.exitVehicle());
  await page.waitForTimeout(1500);
  log('text:', await say('viral', { views: 1340000 }, false));
  await page.waitForTimeout(700);
  log('text:', await say('merlion', {}, false));
  await page.waitForTimeout(900); await shot('talk-2-texts');
  // the queue itself: a remembered fine comes back within ~25 s
  await page.evaluate(() => { const C = __game.cityTalk; C.lastT = -99; C.remember('wonRace', {}, 'Tanjong Pagar'); });
  await page.waitForFunction(() => __game.cityTalk.pending.length === 0, null, { timeout: 40000, polling: 250 }).catch(() => {});
  log('queued mention:', await page.evaluate(() => __game.ui.logEntries.slice(-1).map(e => (e.speaker ? e.speaker + ': ' : '') + e.text.replace(/<[^>]+>/g, ''))[0]));

  // ---- a crowd clip in free roam gets its card (filmed by whoever has the best view)
  log(await page.evaluate(() => {
    const g = __game; g.clips.coolT = 0; const rnd = Math.random; Math.random = () => 0.2;
    try { g.debugCar('infernus'); g.juice.film(g.player.position, 'supercar', false, true); } finally { Math.random = rnd; }
    return `filmers ${g.peds.peds.filter(p => p.state === 'film').length}, card queued ${!!g.clips.job}`;
  }));
  await page.waitForTimeout(2600); await shot('clip-crowd');
  log('new programs after warm-up', await page.evaluate(() => __game.R.renderer.info.programs.length - window.__p0));
  console.log(set, 'errors:', errs.length, errs.slice(0, 5));
  await h.browser.close();
}
