// close night views of the landmarks: node tests/scratch/lmshots.mjs [prefix]
import { chromium } from '../lib/browser.mjs';
const prefix = process.argv[2] || '/tmp/lm';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
const views = {
  gardens_show: { t: 19.85, cam: [1600, 18, 700], look: [1665, 30, 555] },
  gardens_idle: { t: 21.3, cam: [1600, 18, 700], look: [1665, 30, 555] },
  artscience: { t: 21.3, cam: [800, 8, 420], look: [985, 20, 345] },
  merlion: { t: 21.3, cam: [640, 4, 12], look: [612, 5, 22] },
  spectra: { t: 20.08, cam: [640, 6, 40], look: [1150, 120, 330] },
  mbs_close: { t: 21.3, cam: [1050, 30, 250], look: [1300, 120, 340] },
};
for (const [name, v] of Object.entries(views)) {
  await page.evaluate(v => {
    const g = __game, V = g.camera.position.constructor;
    g.ui.hud.setVisible(false); g.sky.time = v.t; g.timeScale = 0; g.weather.force(0); g.U.wet.value = 0;
    g.player.update = () => {}; g.player.root.visible = false;
    g.cameraRig.override = { position: new V(...v.cam), lookAt: new V(...v.look), snap: true, fov: 55 }; g.sky.refreshEnv();
  }, v);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${prefix}_${name}.png` });
}
await browser.close();
