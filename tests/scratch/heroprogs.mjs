// Shader programs compiled after warm-up while hero vehicles of every kind appear, light up, drive and burn
// (=> hitches; must be 0). Also reports page errors.
//   node tests/scratch/heroprogs.mjs [--url http://127.0.0.1:4173/]
import { launch } from '../mobile/lib.mjs';
const ai = process.argv.indexOf('--url'), URL0 = ai > 0 ? process.argv[ai + 1] : 'http://127.0.0.1:4173/';
const h = await launch('chromium', { exclusive: false });
const errs = []; h.page.on('pageerror', e => errs.push(e.message));
await h.page.goto(URL0 + '?skipTitle&newgame&freeroam=8&q=low', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
await h.page.evaluate(() => { window.__p0 = new Set(__game.R.renderer.info.programs); });
const step = async (label, fn, ms = 2500) => { await h.page.evaluate(fn); await h.page.waitForTimeout(ms); console.log(label, (await h.page.evaluate(() => __game.R.renderer.info.programs.filter(p => !__p0.has(p)).length))); };
await step('cars of every type parked around the player:', () => {
  const g = __game, types = ['sedan', 'taxi', 'taxi_yellow', 'luxury', 'suv', 'mpv', 'van', 'police', 'bus', 'lorry', 'bike', 'bike_grub', 'stinger'];
  types.forEach((t, i) => { const v = g.debugCar(t, false); const p = v.body.translation(); v.body.setTranslation({ x: p.x + (i % 4) * 7 - 10, y: p.y + 0.3, z: p.z + Math.floor(i / 4) * 9 - 12 }, true); v.pose.snap?.(); if (t === 'police') v.sirenOn = true; v.lightsOn = true; });
});
await step('driving an infernus (lights, brakes, steering):', () => { const g = __game; const v = g.debugCar('infernus'); v.lightsOn = true; g.autopilot.engage({ x: 900, z: 250 }); }, 5000);
await step('night:', () => { __game.sky.time = 22.5; }, 4000);
await step('helicopter ride (rotors, blur discs, searchlight):', () => { __game.autopilot.disengage?.(); return __game.debugRide('heli'); }, 4000);
await step('explosion of a nearby car:', () => { const g = __game; const v = g.vehicles.find(v => v.type === 'sedan'); if (v) g.explodeVehicle(v); }, 3000);
const r = await h.page.evaluate(() => {
  const old = [...__p0].map(p => p.cacheKey.split(','));
  return __game.R.renderer.info.programs.filter(p => !__p0.has(p)).map(p => {
    const k = p.cacheKey.split(',');
    let best = null, bd = 1e9;
    for (const o of old) { if (o.length !== k.length) continue; let d = 0; for (let i = 0; i < k.length; i++) if (o[i] !== k[i]) d++; if (d < bd) { bd = d; best = o; } }
    const diffs = best ? k.map((v, i) => v !== best[i] ? `[${i}] ${best[i].slice(0, 40)} -> ${v.slice(0, 40)}` : null).filter(Boolean) : ['no same-length match'];
    return `${p.name} ${k[0].slice(0, 50)} diff(${bd}): ${diffs.slice(0, 5).join(' ; ')}`;
  });
});
console.log('new programs after warm-up:', r.length); for (const l of r) console.log('  ', l);
console.log('programs total:', await h.page.evaluate(() => __game.R.renderer.info.programs.length));
if (errs.length) console.log('page errors:', errs.slice(0, 5));
await h.browser.close();
