// night street views with traffic/peds + close pavement: node tests/scratch/litviews.mjs /tmp/prefix
import { chromium } from '../lib/browser.mjs';
const prefix = process.argv[2] || '/tmp/lit';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&fixedres', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.evaluate(() => { __game.ui.hud.setVisible(false); });
const only = process.argv[3]?.split(',');
const V = [
  ['night_road', 21.5, [-60, 1000], [-76, 3.0, 1010], [-38, 1.0, 948]],
  ['night_road2', 21.5, [-60, 1000], [-30, 4.0, 945], [-80, 1.0, 1030]],
  ['night_chinatown', 21.0, [-405, 416], [-405, 1.8, 416], [-392, 2.5, 360]],
  ['night_trees', 21.0, [-640, 860], [-640, 2.0, 860], [-600, 4, 905]],
  ['day_pavement', 11.0, [-405, 416], [-401, 1.6, 410], [-398, 0, 402]],
  ['day_treebase', 11.0, [-405, 416], [-401.5, 3.2, 402.5], [-400, 0, 397.5]],
  ['day_shopfront', 11.0, [-405, 416], [-392, 1.7, 372], [-388, 0.5, 362]],
  ['day_trees', 15.5, [-60, 1000], [-70, 2, 1015], [-40, 6, 960]],
];
for (const [n, t, pp, c, l] of V) {
  if (only && !only.includes(n)) continue;
  await page.evaluate(({ t, pp, c, l }) => {
    const g = __game, Vec = g.camera.position.constructor;
    g.sky.time = t; g.timeScale = 0; g.weather.force(0);
    g.player.teleport(new Vec(pp[0], 0, pp[1]), 0); g.player.root.visible = false;
    g.cameraRig.override = { position: new Vec(...c), lookAt: new Vec(...l), snap: true, fov: 60 };
    g.sky.refreshEnv();
  }, { t, pp, c, l });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${prefix}_${n}.png` });
  console.log('shot', n);
}
await browser.close();
