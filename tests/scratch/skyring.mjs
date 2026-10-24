import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://127.0.0.1:5174/dev/sky.html?t=18.4&yaw=255&pitch=8&q=medium`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__frames > 60);
const tests = {
  nobloom: () => { const R = __sky.renderer; window.__R = window.__R; },
};
// toggle bloom via the module instance: find the renderer through the sky's renderer is raw WebGLRenderer, so expose through window in sky.html
await page.evaluate(() => { window.__Rr.bloom.blendMode.opacity.value = 0; });
await page.waitForTimeout(800); await page.screenshot({ path: '/tmp/ring_nobloom.png' });
await page.evaluate(() => { window.__Rr.bloom.blendMode.opacity.value = 1; window.__Rr.exposureFx.uniforms.get('uOn').value = 0; });
await page.waitForTimeout(800); await page.screenshot({ path: '/tmp/ring_noae.png' });
await page.evaluate(() => { window.__Rr.exposureFx.uniforms.get('uOn').value = 1; __sky.sky.material.uniforms.cloudCoverage.value = 0; __sky.update = () => {}; });
await page.waitForTimeout(800); await page.screenshot({ path: '/tmp/ring_noclouds.png' });
await browser.close();
