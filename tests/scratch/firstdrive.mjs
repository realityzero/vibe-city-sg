// Mission 1's staged first drive (missions/firstdrive.js): after the cold open's hand-over, a stick "driver" follows
// the GPS route to Lau Pa Sat; logs each beat / fine / near miss and takes a frame every --every s.
//   node tests/scratch/firstdrive.mjs [--url http://127.0.0.1:4173/] [--set phone|desktop] [--out /tmp/vc-firstdrive] [--secs 80] [--every 2] [--kmh 62]
import { launch } from '../mobile/lib.mjs';
import fs from 'fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), SET = arg('set', 'phone'), OUT = arg('out', '/tmp/vc-firstdrive');
const SECS = +arg('secs', 80), EVERY = +arg('every', 2), KMH = +arg('kmh', 62);
fs.mkdirSync(OUT, { recursive: true });
const phone = SET === 'phone';
const h = await launch('chromium', { exclusive: false, device: phone ? undefined : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 } });
const { page } = h, errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
page.on('response', r => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url()}`); });
await page.goto(`${URL0}?skipTitle&newgame${phone ? '&q=low' : '&q=high'}&fixedres`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play' && __game.cameraRig.override?.track, null, { timeout: 300000, polling: 100 });
await page.waitForFunction(() => !__game.cameraRig.override && __game.player.controlsEnabled, null, { timeout: 60000, polling: 100 });
await page.evaluate(kmh => {
  const g = window.__game, log = window.__fdlog = [], t0 = performance.now(), T = () => ((performance.now() - t0) / 1000).toFixed(1);
  for (const k of ['ticket', 'views', 'closeShave', 'floater']) { const f = g.ui[k]; g.ui[k] = (...a) => { log.push(`${T()} ${k} ${JSON.stringify(a).slice(0, 120)}`); return f.apply(g.ui, a); }; }
  const L = g.peds.life, st = L.stageAt.bind(L);
  L.stageAt = (k, at) => {
    const e = st(k, at);
    // why not: no footpath in view there / the scene's own test (fowl: greenery)
    const why = e ? 'ok' : !L.spotAt(at, null, false) ? `no spot @${Math.round(at.x)},${Math.round(at.z)}` : `scene said no (green ${g.city.maskAt(at.x, at.z, 1)})`;
    log.push(`${T()} stageAt ${k} ${why}`); return e;
  };
  const sp = g.traffic.spawnAt.bind(g.traffic); g.traffic.spawnAt = (l, s, type, c) => { const r = sp(l, s, type, c); if (type === 'bus') { log.push(`${T()} bus spawned`); window.__bus = r; } return r; };
  // pure pursuit on the GPS route through the touch stick (steer = -x, throttle from y)
  const drive = () => {
    const P = g.player, v = P.vehicle, r = g.ui.radar.route, st = g.input.stick;
    if (v && r && P.controlsEnabled) {
      const p = P.position, f = { x: -Math.sin(v.yaw()), z: -Math.cos(v.yaw()) };
      let bi = 0, bd = 1e9; for (let i = 0; i < r.length; i++) { const d = Math.hypot(r[i][0] - p.x, r[i][1] - p.z); if (d < bd) { bd = d; bi = i; } }
      let tgt = r[r.length - 1], acc = 0; for (let i = bi; i < r.length - 1; i++) { acc += Math.hypot(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1]); if (acc > 9 + v.speed * 0.5) { tgt = r[i + 1]; break; } }
      const dx = tgt[0] - p.x, dz = tgt[1] - p.z, ang = Math.atan2(f.x * dz - f.z * dx, f.x * dx + f.z * dz);
      // slow for the bend 30 m on
      let far = r[r.length - 1]; acc = 0; for (let i = bi; i < r.length - 1; i++) { acc += Math.hypot(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1]); if (acc > 30) { far = r[i + 1]; break; } }
      const fx2 = far[0] - p.x, fz2 = far[1] - p.z, bend = Math.abs(Math.atan2(f.x * fz2 - f.z * fx2, f.x * fx2 + f.z * fz2));
      const want = bend < 0.2 ? kmh : bend < 0.6 ? 32 : 20, now = v.speed * 3.6;
      // (a test driver doesn't overtake: whatever queues right in front of it is cleared away)
      for (const c of [...g.traffic.cars]) { const ex = c.pos.x - p.x, ez = c.pos.z - p.z, ah = ex * f.x + ez * f.z; if (ah > 0 && ah < 30 && Math.abs(ex * f.z - ez * f.x) < 2.2 && c.speed < v.speed && c !== window.__bus) g.traffic.despawn(c); }
      st.active = true; st.x = Math.max(-1, Math.min(1, ang * 2.2));
      st.y = now < want ? 1 : now > want + 6 ? -1 : 0;
      // stuck against something: back off with the wheel the other way
      drive.stuck = now < 5 && !(drive.rev > 0) ? (drive.stuck || 0) + 1 / 60 : 0;
      if (drive.stuck > 1.2) drive.rev = 90;
      if (drive.rev > 0) { drive.rev--; st.y = -1; st.x = -st.x; }
      if (Math.hypot(p.x - r[r.length - 1][0], p.z - r[r.length - 1][1]) < 25) { st.y = -1; }
    }
    requestAnimationFrame(drive);
  };
  drive();
}, KMH);
const t0 = Date.now(); let k = 0;
while ((Date.now() - t0) / 1000 < SECS) {
  await page.waitForTimeout(EVERY * 1000);
  const s = await page.evaluate(() => { const g = __game, v = g.player.vehicle; return `${v ? Math.round(v.speed * 3.6) : 0}kmh @${Math.round(g.player.position.x)},${Math.round(g.player.position.z)} ev:${g.peds.life.event ? 'on' : '-'} $${Math.round(g.money)} fines:${g.progress.stats.fines}`; });
  const f = `${OUT}/${SET}-${String(k++).padStart(2, '0')}.png`;
  await page.screenshot({ path: f });
  console.log(((Date.now() - t0) / 1000).toFixed(0), s, f);
  const log = await page.evaluate(() => window.__fdlog.splice(0)); for (const l of log) console.log('   ', l);
}
if (errs.length) console.log('errors:', errs.slice(0, 6));
await h.browser.close();
