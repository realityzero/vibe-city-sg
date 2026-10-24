// Walk Tommy over every footbridge: beyond foot A -> top of stairs A -> landing A -> deck -> landing B -> top B -> foot B -> beyond.
import { chromium } from '../lib/browser.mjs';
const only = process.argv[2] ? +process.argv[2] : null;
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&q=low&t=11', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
const bridges = await page.evaluate(() => __game.streetDetail.bridges.map(b => ({ x: b.x, z: b.z, stairs: b.stairs.map(s => [s[0], s[1]]) })));
const walkTo = async (wp, tries = 50) => {
  let last = null, stuck = 0;
  for (let i = 0; i < tries; i++) {
    const st = await page.evaluate(wp => { const g = __game, p = g.player.position; const dx = wp[0] - p.x, dz = wp[1] - p.z; g.cameraRig.yaw = Math.atan2(-dx, -dz); return { d: Math.hypot(dx, dz), x: p.x, z: p.z }; }, wp);
    if (st.d < 1.0) return st;
    await page.keyboard.down('KeyW'); await page.waitForTimeout(220); await page.keyboard.up('KeyW');
    if (last && Math.hypot(st.x - last.x, st.z - last.z) < 0.05) { if (++stuck > 5) return st; } else stuck = 0;
    last = st;
  }
  return page.evaluate(wp => { const p = __game.player.position; return { d: Math.hypot(wp[0] - p.x, wp[1] - p.z) }; }, wp);
};
for (const [bi, b] of bridges.entries()) {
  if (only != null && bi !== only) continue;
  const [topA, footA, topB, footB] = b.stairs;
  const out = (f, t, k) => { const dx = f[0] - t[0], dz = f[1] - t[1], L = Math.hypot(dx, dz); return [f[0] + dx / L * k, f[1] + dz / L * k]; };
  // landing = top of the flight, stepped 2.4 m further from the foot (toward the deck edge), then the deck centre
  const landA = out(topA, footA, 2.4), landB = out(topB, footB, 2.4);
  await page.evaluate(p => { const g = __game, V = g.camera.position.constructor; g.relocate(new V(p[0], 0, p[1]), 0, { exact: true }); }, out(footA, topA, 3));
  await page.waitForTimeout(400);
  const route = [['topA', topA], ['landA', landA], ['deck', [b.x, b.z]], ['landB', landB], ['topB', topB], ['footB', footB], ['offB', out(footB, topB, 3)]];
  const log = [];
  let failed = null;
  for (const [name, wp] of route) {
    const st = await walkTo(wp);
    const y = await page.evaluate(() => __game.player.position.y.toFixed(1));
    log.push(`${name}${st.d > 1.6 ? `(STUCK ${st.d.toFixed(1)}m)` : ''}@${y}`);
    if (st.d > 1.6) { failed = name; break; }
  }
  console.log(`bridge ${bi} (${b.x.toFixed(0)},${b.z.toFixed(0)}): ${failed ? 'FAIL' : 'ok  '} ${log.join(' -> ')}`);
  if (failed) await page.screenshot({ path: `/tmp/vc/bwfail_${bi}.png` });
}
await browser.close();
