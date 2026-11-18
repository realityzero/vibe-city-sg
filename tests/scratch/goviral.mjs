// Go Viral end to end (missions/goviral.js): new game in free roam at 11:00, walk into the activity marker at One
// Fullerton, get in Chad's Infernus, then pull off the three set pieces through the game's own systems until the views
// pill reads 1M — two close shaves past @kopi.kakis on Fullerton Road (Juice's near-miss payout for a traffic car
// brushed past), a handbrake drift through the Collyer Quay junction (real physics: the car is put in the zone at
// speed and slides), the park-up at the Sands drop-off (stop in the ring, F out) — then the street's own clips (the
// crowd filming) until it passes. Checks the pass, the side-job count, each clip card's still (not blank), the
// programs compiled after the warm-up, errors; frames of every beat.
//   node tests/scratch/goviral.mjs [--url http://127.0.0.1:4173/] [--set phone|desktop] [--out /tmp/vc-viral]
import { launch } from '../mobile/lib.mjs';
import fs from 'fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), SET = arg('set', 'desktop'), OUT = arg('out', '/tmp/vc-viral');
fs.mkdirSync(OUT, { recursive: true });
const phone = SET === 'phone';
const h = await launch('chromium', { exclusive: false, device: phone ? undefined : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 } });
const { page } = h, errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=11${phone ? '&q=low' : '&q=high'}&fixedres`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play' && __game.player.controlsEnabled, null, { timeout: 300000, polling: 200 });
const T0 = Date.now(), log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);
const shot = async n => { const f = `${OUT}/${SET}-${n}.png`; await page.screenshot({ path: f, timeout: 90000 }).then(() => log('shot', f), e => log('shot failed', f, e.message.split('\n')[0])); };
const st = () => page.evaluate(() => { const g = __game, m = g.missions.active; return { mission: m?.mission.id || null, views: g.ui.views.total(), reach: g.hype.reach, timer: document.querySelector('.vc-tracker:not(.vc-hidden) .val')?.textContent, cards: window.__cards, side: g.progress.side, money: Math.round(g.money) }; });
// count the clip cards that come up, and keep what their stills look like (mean / spread of luminance: not blank)
await page.evaluate(() => {
  const g = __game; window.__cards = 0; window.__stills = []; window.__p0 = g.R.renderer.info.programs.length; g.timeScale = 0;
  const card = document.querySelector('.vc-clip');
  new MutationObserver(() => {
    if (!card.classList.contains('on') || card.__seen) { if (!card.classList.contains('on')) card.__seen = false; return; }
    card.__seen = true; window.__cards++;
    const c = card.querySelector('canvas'), x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let s = 0, s2 = 0; for (let i = 0; i < x.length; i += 4) { const l = x[i] * 0.3 + x[i + 1] * 0.59 + x[i + 2] * 0.11; s += l; s2 += l * l; }
    const n = x.length / 4, m = s / n; window.__stills.push({ mean: Math.round(m), sd: Math.round(Math.sqrt(s2 / n - m * m)), cost: +g.clips.cost.toFixed(2), who: card.querySelector('.who').textContent });
  }).observe(card, { attributes: true, attributeFilter: ['class'] });
});

// ---- the activity marker starts the job; Chad's texts; into the Infernus
await page.evaluate(() => { const a = __game.activities.list.find(a => a.id === 'viral'); __game.debugTp(a.pos.x, a.pos.z, 0); });
await page.waitForFunction(() => __game.missions.active?.mission.id === 'go_viral', null, { timeout: 20000, polling: 100 });
await page.waitForTimeout(2500); await shot('1-texts');
await page.evaluate(() => { const g = __game, car = g.vehicles[g.vehicles.length - 1]; g.player.teleport(car.position.clone(), car.yaw()); g.player.enterVehicleImmediate(car); g.cameraRig.yaw = car.yaw(); window.__car = car; });
await page.waitForFunction(() => !!document.querySelector('.vc-views.goal.on'), null, { timeout: 10000, polling: 100 });
await page.waitForTimeout(1500); log(JSON.stringify(await st())); await shot('2-goal');

// put the car on a lane near (x,z), heading along it (or towards `at`), moving at `speed` m/s
const place = (x, z, speed, at) => page.evaluate(([x, z, speed, at]) => {
  const g = __game, car = window.__car, n = g.roadnet.nearestLane(x, z, 60, l => l.cls <= 5);
  let yaw = Math.atan2(-n.dir.x, -n.dir.z);
  if (at) yaw = Math.atan2(-(at[0] - n.pos.x), -(at[1] - n.pos.z));
  g.player.teleport(n.pos.clone(), yaw); g.cameraRig.yaw = yaw;
  car.body.setLinvel({ x: -Math.sin(yaw) * speed, y: 0, z: -Math.cos(yaw) * speed }, true);
  return `${Math.round(n.pos.x)},${Math.round(n.pos.z)} yaw ${yaw.toFixed(2)}`;
}, [x, z, speed, at]);

// ---- set piece 1: two close shaves on Fullerton Road (a traffic car brushed past at 90 km/h)
log('shave', await place(470, 250, 25));
await page.waitForTimeout(600);
for (let i = 0; i < 2; i++) {
  await page.evaluate(() => {
    const g = __game, car = window.__car, other = g.traffic.cars.find(c => c.state === 'drive') || g.traffic.cars[0];
    g.juice.nearMiss({ obj: other, ped: false, min: 0.4, rel: 20, spd: 25 }, car, performance.now() / 1000);
  });
  await page.waitForTimeout(700);
}
await page.waitForTimeout(900); await shot('3-shave-card'); log(JSON.stringify(await st()));
await page.waitForTimeout(5000);

// ---- set piece 2: a handbrake drift through the Collyer Quay junction (real slide; a few tries if it hits something)
for (let k = 0; k < 4; k++) {
  const before = (await st()).cards;
  log('drift', await place(332 + 16, 532 + 16, 17, [332, 532]));
  await page.keyboard.down('Space'); await page.keyboard.down('KeyA');
  await page.waitForTimeout(450); await shot(`4-drift${k}`);
  await page.waitForTimeout(1300);
  await page.keyboard.up('Space'); await page.keyboard.up('KeyA');
  await page.waitForTimeout(900);
  if ((await st()).cards > before) break;
}
await shot('5-drift-card'); log(JSON.stringify(await st()));
await page.waitForTimeout(5000);

// ---- set piece 3: park up in the ring at the Sands drop-off and step out (if two quick ones haven't done it already:
// clips that come fast push the reach up)
if ((await st()).mission) {
  log('park', await page.evaluate(() => {
    const g = __game, car = window.__car, n = g.roadnet.nearestLane(1259, 364, 40);
    const yaw = Math.atan2(-n.dir.x, -n.dir.z); g.player.teleport(n.pos.clone(), yaw); g.cameraRig.yaw = yaw + 0.6;
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true); return `${Math.round(n.pos.x)},${Math.round(n.pos.z)}`;
  }));
  await page.waitForTimeout(2500);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(1500); await shot('6-park-card'); log(JSON.stringify(await st()));
}

// ---- the street's own clips until it's a million (the crowd round the car films whatever the car does next)
for (let i = 0; i < 30 && (await st()).mission; i++) {
  await page.evaluate(() => { const g = __game; g.juice.film(g.player.position, 'stunt', true, true); });
  await page.waitForTimeout(1500);
  if (i % 4 === 0) log(JSON.stringify(await st()));
}
await page.waitForTimeout(400); await shot('7-million');
await page.waitForFunction(() => !__game.missions.active, null, { timeout: 30000, polling: 200 }).catch(() => {});
await page.waitForTimeout(1200); await shot('8-passed');
const end = await page.evaluate(() => ({ side: __game.progress.side, money: Math.round(__game.money), stills: window.__stills, newPrograms: __game.R.renderer.info.programs.length - window.__p0, log: __game.ui.logEntries.slice(-6).map(e => (e.speaker ? e.speaker + ': ' : '') + e.text.replace(/<[^>]+>/g, '')) }));
log(JSON.stringify(end, null, 1));
const pass = end.side?.go_viral === 1 && end.stills.length >= 2 && end.stills.every(s => s.sd > 8) && end.newPrograms === 0;
console.log(pass ? 'PASS' : 'FAIL', 'go_viral', SET, 'errors:', errs.length, errs.slice(0, 5));
await h.browser.close();
