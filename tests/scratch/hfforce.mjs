import { chromium } from '../lib/browser.mjs';
import { pathToFileURL } from 'url';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
for (const mode of ['normal', 'hfOnly', 'noShadow']) {
  await page.evaluate(async mode => {
    const g = __game, V = g.camera.position.constructor; g.ui.hud.setVisible(false); g.sky.time = 16.8; g.timeScale = 0; g.weather.force(0);
    g.player.update = () => {}; g.player.root.visible = false;
    g.cameraRig.override = { position: new V(120, 60, 520), lookAt: new V(200, 0, 330), snap: true, fov: 60 }; g.sky.refreshEnv();
    const HF = (await import('/src/gfx/heightfield.js')).HF;
    g.R.renderer.shadowMap.enabled = mode === 'normal';
    HF.on.value = mode === 'noShadow' ? 0 : 1;
    window.__forceR = mode === 'hfOnly';
    if (!window.__hooked) { window.__hooked = true; const up = g.sky.update.bind(g.sky); g.sky.update = (...a) => { up(...a); if (window.__forceR) HF.shadowR.value = 1; }; }
  }, mode);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `/tmp/vc/hfforce_${mode}.png` });
}
await browser.close();
