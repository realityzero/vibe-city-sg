import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&fixedres', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const g = __game; const V = g.camera.position.constructor;
  g.ui.hud.setVisible(false); g.sky.time = 14.5; g.timeScale = 0;
  g.player.teleport(new V(700, 0, 900), 0); g.player.root.visible = false;
  g.cameraRig.override = { position: new V(700, 260, 900), lookAt: new V(150, 60, 300), snap: true, fov: 55 };
  g.sky.refreshEnv();
});
await page.waitForTimeout(2000);
const sample = async name => { await page.waitForTimeout(700); await page.screenshot({ path: `/tmp/ws_${name}.png` }); };
await sample('base');
const r = await page.evaluate(() => {
  const g = __game; const out = [];
  // what is drawn in the upper middle of the screen? raycast through NDC (0, 0.8)
  const rc = new (g.camera.constructor.prototype.constructor === undefined ? Object : Object)();
  return { fog: g.scene.fog?.density, far: g.camera.far, skyVis: g.sky.sky.visible, skyFog: g.sky.sky.material.fog, sunMeshVis: g.R.sunMesh.visible, rain: g.weather?.rain };
});
console.log(r);
await page.evaluate(() => { const g = __game; g.sky._upd = g.sky.update; g.sky.update = function (dt, f) { this._upd(dt, f); for (const u of [this.sky.material.uniforms]) u.cloudCoverage.value = 0; }; }); await sample('noclouds');
await page.evaluate(() => { const g = __game; g.sky.update = function (dt, f) { this._upd(dt, f); this.sky.material.uniforms.cloudCoverage.value = 0; this.sky.material.uniforms.mieCoefficient.value = 0.001; }; }); await sample('lowmie');
await page.evaluate(() => { const g = __game; g.sky.update = function (dt, f) { this._upd(dt, f); this.sky.material.uniforms.cloudCoverage.value = 0; this.sky.material.uniforms.mieCoefficient.value = 0.0042; this.sky.material.uniforms.turbidity.value = 1.5; }; }); await sample('lowturb');
await browser.close();
