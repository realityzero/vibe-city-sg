import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', m => { if (/heightField|error/i.test(m.text())) console.log(m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&stats' + (process.env.Q ? '&' + process.env.Q : ''), { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
console.log(await page.evaluate(() => JSON.stringify({ hf: !!__game.heightField, w: __game.heightField?.w })));
const views = [['far', 16.6, [300, 700, 1900], [-100, 0, 300]], ['avenue', 16.8, [-100, 3, 1150], [400, 20, 300]], ['canyon', 13, [80, 2, 380], [160, 10, 200]]];
for (const [n, t, c, l] of views) {
  await page.evaluate(({ t, c, l }) => { const g = __game, V = g.camera.position.constructor; g.ui.hud.setVisible(false); g.sky.time = t; g.timeScale = 0; g.weather.force(0); g.player.root.visible = false; g.player.update = () => {}; g.cameraRig.override = { position: new V(...c), lookAt: new V(...l), snap: true, fov: 60 }; g.sky.refreshEnv(); }, { t, c, l });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `/tmp/vc/hf${process.env.Q ? 'off' : ''}_${n}.png` });
}
await browser.close();
