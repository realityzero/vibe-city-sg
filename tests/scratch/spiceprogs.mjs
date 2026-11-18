// Shader programs compiled after the warm-up by the spice features: phone camera flashes (a crowd filming), the Fine
// City camera flash (fx's light turned white), Ah Beng's Stinger and its underglow, the ticket / views / race HUD.
//   node tests/scratch/spiceprogs.mjs [--url http://127.0.0.1:4173/] [--q low|high]
import { chromium } from '../lib/browser.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), Q = arg('q', 'low');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=21&q=${Q}&fixedres`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
await page.waitForTimeout(4000);
await page.evaluate(() => { window.__p0 = new Set(__game.R.renderer.info.programs); });
const step = async (name, fn, ms = 2500) => { await page.evaluate(fn); await page.waitForTimeout(ms); console.log(name, await page.evaluate(() => __game.R.renderer.info.programs.filter(p => !__p0.has(p)).length)); };
await step('car', () => { const g = __game; g.debugTp(262, 470, 0); g.debugCar('infernus'); });
await step('crowd films (flashes)', () => { const g = __game, P = g.player.position; for (const p of g.peds.peds) if (p.pos.distanceTo(P) < 60 && p.state === 'walk') { p.film = { x: P.x, z: P.z, follow: true, delay: 0, back: 'walk', yaw: p.yaw }; p.state = 'film'; p.t = 8; } g.events.emit('filmed', { count: 6, pos: P.clone(), kind: 'supercar' }); });
await step('fine (camera flash)', () => { const g = __game; g.fines.charge('Speed camera', 150, '92 km/h in a 70 zone', { flash: true, at: g.player.position.clone().setY(4) }); }, 1500);
await step('Ah Beng (stinger + underglow)', () => { const g = __game, b = g.debugCar('stinger', false); window.__b = b; const f = () => { g.dragRace.glow.follow(b, g, 1); if (window.__b) requestAnimationFrame(f); }; f(); g.ui.raceLights({ title: 'Ah Beng wants to race', sub: 'x', lights: 2 }); });
const r = await page.evaluate(() => __game.R.renderer.info.programs.filter(p => !__p0.has(p)).map(p => p.name + ' ' + p.cacheKey.slice(0, 80)));
console.log('new programs after warm-up:', r.length); for (const l of r) console.log('  ', l);
await page.screenshot({ path: `/tmp/vc-spiceprogs-${Q}.png` });
if (errs.length) console.log('errors:', errs.slice(0, 5));
await browser.close();
