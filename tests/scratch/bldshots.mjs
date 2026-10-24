// node tests/scratch/bldshots.mjs prefix [names] — building look-dev views (HDB estates, five-foot-ways, towers)
import { chromium } from '../lib/browser.mjs';
const [prefix = '/tmp/bs', only] = process.argv.slice(2);
const VIEWS = {
  hdb_close: { t: 10.5, cam: [-660, 2.0, 470], look: [-610, 18, 515] },
  hdb_endwall: { t: 15.0, cam: [-760, 60, 1180], look: [-708, 55, 1250] },
  hdb_number: { t: 15.0, cam: [-805, 72, 1240], look: [-762, 74, 1251], fov: 40 },
  cbd_night: { t: 22.0, cam: [900, 160, 700], look: [150, 80, 300] },
  cbd_night_close: { t: 22.0, cam: [300, 70, 520], look: [150, 90, 330] },
  cbd_street: { t: 16.5, cam: [60, 1.8, 330], look: [140, 60, 260] },
  cbd_glass: { t: 17.8, cam: [300, 70, 520], look: [150, 90, 330] },
  hdb_estate: { t: 16.5, cam: [-780, 45, 1150], look: [-690, 35, 1250] },
  hdb_night: { t: 21.0, cam: [-780, 45, 1150], look: [-690, 35, 1250] },
  hdb_void: { t: 20.5, cam: [-640, 1.7, 480], look: [-610, 3, 512] },
  shop_ffw: { t: 11.0, cam: [-393.0, 1.7, 344.4], look: [-375.6, 2.6, 354.2] },
  shop_ffw_night: { t: 21.5, cam: [-393.0, 1.7, 344.4], look: [-375.6, 2.6, 354.2] },
  shop_street: { t: 10.0, cam: [-383.6, 2.0, 328.3], look: [-394, 6.0, 344] },
  shop_street_night: { t: 21.0, cam: [-383.6, 2.0, 328.3], look: [-394, 6.0, 344] },
  shop_aerial: { t: 9.5, cam: [-470, 60, 320], look: [-400, 0, 400] },
  roofs_aerial: { t: 13.0, cam: [-300, 260, 900], look: [100, 0, 450] },
  tower_close: { t: 17.0, cam: [180, 3, 520], look: [120, 120, 380] },
  sgh_front: { t: 11.0, cam: [-1615, 1.8, 878], look: [-1625, 9, 840] },
  sgh_night: { t: 21.0, cam: [-1615, 1.8, 878], look: [-1625, 9, 840] },
  raffles_lobby: { t: 15.0, cam: [226, 1.8, 300], look: [226, 9, 277] },
  raffles_lobby_night: { t: 21.5, cam: [226, 1.8, 300], look: [226, 9, 277] },
  hotel_lobby: { t: 20.0, cam: [152, 1.8, -478], look: [152, 8, -502] },
  office_night: { t: 22.5, cam: [520, 120, 600], look: [200, 100, 250] },
  condo: { t: 16.0, cam: [-596, 30, -40], look: [-596, 60, -112] },
  condo_night: { t: 21.5, cam: [-596, 30, -40], look: [-596, 60, -112] },
  condo_aerial: { t: 10.0, cam: [-1300, 160, -1200], look: [-1578, 60, -1406] },
};
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 600)); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&stats&fixedres', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.evaluate(() => { const g = __game; g.ui.hud.setVisible(false); g.missions.giver?.m.group && (g.missions.giver.m.group.visible = false); });
for (const [name, v] of Object.entries(VIEWS)) {
  if (only && !only.split(',').includes(name)) continue;
  await page.evaluate(v => {
    const g = __game; const V = g.camera.position.constructor;
    g.sky.time = v.t; g.timeScale = 0; g.weather.force(v.rain || 0); g.U.wet.value = v.rain ? 1 : 0;
    g.player.teleport(new V(v.cam[0], 0, v.cam[2]), 0); g.player.root.visible = false;
    g.cameraRig.override = { position: new V(...v.cam), lookAt: new V(...v.look), snap: true, fov: v.fov || 60 };
    g.sky.refreshEnv();
  }, v);
  await page.waitForTimeout(2500);
  const f = `${prefix}_${name}.png`;
  await page.screenshot({ path: f });
  console.log('shot', f);
}
await browser.close();
