import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&fixedres&t=21.5', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.waitForTimeout(3000);
const r = await page.evaluate(() => {
  const g = __game, R = g.traffic.renderer, P = R.pools; g.ui.hud.setVisible(false);
  const cam = g.camera.position, cars = [...R.cars.values()];
  // aim the camera at the nearest pooled car, from behind-ish and above
  let best = null; for (const c of cars) { if (c.headOn < R.frame - 2) continue; const e = c.m.elements, d = Math.hypot(e[12] - cam.x, e[14] - cam.z); if (!best || d < best.d) best = { d, e: [...e] }; }
  if (best) { const e = best.e, V = cam.constructor; const fwd = new V(-e[8], 0, -e[10]).normalize(); const p = new V(e[12], 0, e[14]); g.timeScale = 0; g.traffic.enabled = false;
    g.cameraRig.override = { position: p.clone().addScaledVector(fwd, 22).setY(5), lookAt: p.clone().addScaledVector(fwd, 4), snap: true, fov: 55 }; }
  return { pools: P.count, cars: cars.length, headOn: cars.filter(c => c.headOn >= R.frame - 2).length, best: best?.d, night: g.U.night.value };
});
console.log(JSON.stringify(r));
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/lit_after_pool.png' });
await browser.close();
