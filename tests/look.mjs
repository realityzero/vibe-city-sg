// Look-dev captures: node tests/look.mjs [prefix] [views=all]
// Renders a fixed set of camera views at given times in one session for visual comparison.
import { chromium } from './lib/browser.mjs';
const [prefix = '/tmp/look', only] = process.argv.slice(2);
const VIEWS = {
  street_noon: { t: 11.5, cam: [-405, 1.9, 416], look: [-392, 3, 360] },
  street_dusk: { t: 18.6, cam: [-405, 1.9, 416], look: [-392, 3, 360] },
  bay_sunset: { t: 18.25, cam: [560, 24, 60], look: [1300, 90, 380] },
  bay_night: { t: 21.0, cam: [560, 24, 60], look: [1300, 90, 380] },
  cbd_aerial: { t: 14.5, cam: [700, 260, 900], look: [150, 60, 300] },
  cbd_night: { t: 22.0, cam: [900, 160, 700], look: [150, 80, 300] },
  shophouse_rain: { t: 16.0, cam: [-640, 2.2, 860], look: [-600, 4, 905], rain: 1 },
  gardens_night: { t: 20.5, cam: [1500, 40, 700], look: [1650, 30, 560] },
};
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&stats&fixedres' + (process.env.Q ? '&' + process.env.Q : ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.evaluate(() => { const g = __game; g.ui.hud.setVisible(false); g.missions.giver?.m.group && (g.missions.giver.m.group.visible = false); });
for (const [name, v] of Object.entries(VIEWS)) {
  if (only && !only.split(',').includes(name)) continue;
  await page.evaluate(v => {
    const g = __game; const V = g.camera.position.constructor;
    g.sky.time = v.t; g.timeScale = 0; g.weather.force(v.rain || 0); g.U.wet.value = v.rain ? 1 : 0;
    g.player.teleport(new V(v.cam[0], 0, v.cam[2]), 0); g.player.root.visible = false;
    g.cameraRig.override = { position: new V(...v.cam), lookAt: new V(...v.look), snap: true, fov: 55 };
    g.sky.refreshEnv();
  }, v);
  await page.waitForTimeout(2500);
  const f = `${prefix}_${name}.png`;
  await page.screenshot({ path: f });
  console.log('shot', f, await page.evaluate(() => __game.fps.toFixed(0) + 'fps ' + __game.R.renderer.info.render.calls + ' calls'));
}
await browser.close();
