// Close-ups of the spice overlays on the phone profile and/or desktop: a Fine City ticket with its cash floater, the
// street filming a supercar (REC views pill, camera flashes), Ah Beng's underglow with the race lights.
//   node tests/scratch/spiceshots.mjs [--url http://127.0.0.1:4173/] [--sets phone,desktop] [--out /tmp/vc-spice]
import { launch } from '../mobile/lib.mjs';
import fs from 'fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), SETS = arg('sets', 'phone,desktop').split(','), OUT = arg('out', '/tmp/vc-spice');
fs.mkdirSync(OUT, { recursive: true });
for (const set of SETS) {
  const phone = set === 'phone';
  const h = await launch('chromium', { exclusive: false, device: phone ? undefined : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 } });
  const { page } = h, errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=21${phone ? '&q=low' : '&q=high'}&fixedres`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
  await page.evaluate(() => { const g = __game; g.timeScale = 0; g.debugTp(262, 470, 0); g.debugCar('infernus'); });
  await page.waitForTimeout(5000);
  const shot = async n => { const f = `${OUT}/${set}-${n}.png`; await page.screenshot({ path: f }); console.log(f); };
  // Fine City: a speed camera ticket (after the flash), the floater by the cash
  await page.evaluate(() => { const g = __game; g.money = 1234; g.fines.charge('Speed camera', 150, '92 km/h in a 70 zone · <b>4 demerit points</b>', { flash: true, at: g.player.position.clone().setY(4) }); });
  await page.waitForTimeout(80); await shot('fine-flash');
  await page.waitForTimeout(650); await shot('fine-ticket');
  await page.waitForTimeout(3500);
  // the street films a supercar: everyone near gets their phone out
  await page.evaluate(() => { const g = __game, P = g.player.position; let n = 0; for (const p of g.peds.peds) if (p.pos.distanceTo(P) < 45 && ['walk', 'idle', 'stand'].includes(p.state) && !p.script) { p.film = { x: P.x, z: P.z, follow: true, delay: 0, back: 'walk', yaw: p.yaw }; p.state = 'film'; p.t = 12; n++; } g.bark('admire', P, 2, { text: 'Wah, Infernus!' }); g.events.emit('filmed', { count: Math.max(6, n), pos: P.clone(), kind: 'supercar' }); });
  for (let i = 0; i < 3; i++) { await page.waitForTimeout(600); await shot(`filmed-${i}`); }
  await page.waitForTimeout(4000);
  // Ah Beng alongside: lime Stinger, underglow, the challenge and then the start lights
  await page.evaluate(() => {
    const g = __game, v = g.player.vehicle, b = window.__b = g.debugCar('stinger', false), q = v.quaternion;
    const r = { x: -2 * (q.x * q.z + q.w * q.y), z: -(1 - 2 * (q.x * q.x + q.y * q.y)) }, L = Math.hypot(r.x, r.z);
    b.body.setTranslation({ x: v.position.x - r.z / L * 3.4, y: v.position.y + 0.3, z: v.position.z + r.x / L * 3.4 }, true);
    b.model.setColor?.(0x86e21c);
    const f = () => { g.dragRace.glow.follow(b, g, g.U.night.value); requestAnimationFrame(f); }; f();
    g.ui.raceLights({ title: 'Ah Beng wants to race', sub: g.touch?.on ? 'Tap <b>FLASH</b> to take him on' : 'Flash your lights — <b>L</b> — to take him on' });
  });
  await page.waitForTimeout(1500); await shot('race-ask');
  await page.evaluate(() => __game.ui.raceLights({ title: 'Street race · 400 m', sub: 'Go on <em>green</em>. Jump it and you lose.', lights: 2 }));
  await page.waitForTimeout(500); await shot('race-lights');
  if (errs.length) console.log(set, 'errors:', errs.slice(0, 4));
  await h.browser.close();
}
