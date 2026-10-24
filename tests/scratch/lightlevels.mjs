import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
for (const t of [12, 17, 18, 18.6, 19, 19.3, 19.7, 20.5]) {
  console.log(await page.evaluate(async t => { const g = __game; g.sky.time = t; g.timeScale = 0; await new Promise(r => setTimeout(r, 400)); const s = g.sky; return `t=${t} night=${g.U.night.value.toFixed(2)} sunY=${s.sun.y.toFixed(3)} dir=${s.dir.intensity.toFixed(2)} hemi=${s.hemi.intensity.toFixed(2)} exp=${s.exposure.toFixed(2)} ibl=${g.U.iblDiffuse.value.toFixed(2)} envI=${(g.scene.environmentIntensity ?? 1).toFixed(2)}`; }, t));
}
await browser.close();
