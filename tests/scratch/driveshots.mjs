import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&t=17.2', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.evaluate(car => {
  const g = __game; let best = null;
  for (const l of g.roadnet.lanes) { if (l.cls > 3 || l.path.length < 220 || l.path.p.some(q => Math.abs(q[1]) > 0.5)) continue; const P = l.path.p, chord = Math.hypot(P.at(-1)[0] - P[0][0], P.at(-1)[2] - P[0][2]); const sc = chord / l.path.length * Math.min(1, l.path.length / 600); if (!best || sc > best.sc) best = { l, sc }; }
  const P = best.l.path.p; void g.debugTp(P[0][0], P[0][2], 0); void g.debugCar(car);
}, process.argv[2] || 'infernus');
await page.keyboard.down('KeyW');
for (let i = 0; i < 4; i++) { await page.waitForTimeout(1600); await page.screenshot({ path: `/tmp/vc/drive_${i}.png` }); }
await page.keyboard.up('KeyW');
await browser.close();
