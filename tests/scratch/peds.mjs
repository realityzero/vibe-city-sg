import { chromium } from '../lib/browser.mjs';
const [prefix = '/tmp/ped', t = '12.5'] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres&t=${t}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.evaluate(() => { const g = __game; g.ui.hud.setVisible(false); g.timeScale = 0; g.debugTp(60, 330, 0); g.player.root.visible = false; });
await page.waitForTimeout(6000);
const r = await page.evaluate(() => {
  const g = __game; const V = g.camera.position.constructor; const P = g.player.position;
  // nearest few peds
  const ps = g.peds.peds.map(p => ({ p, d: Math.hypot(p.pos.x - P.x, p.pos.z - P.z) })).sort((a, b) => a.d - b.d);
  const t = ps[3]?.p || ps[0]?.p; if (!t) return 'no peds';
  g.cameraRig.override = { position: new V(t.pos.x + 3.2, 1.6, t.pos.z + 3.2), lookAt: new V(t.pos.x, 1.1, t.pos.z), snap: true, fov: 50 };
  return `peds ${g.peds.peds.length} target d=${ps[3]?.d.toFixed(1)}`;
});
console.log(r);
await page.waitForTimeout(1500); await page.screenshot({ path: `${prefix}_0.png` });
await browser.close();
