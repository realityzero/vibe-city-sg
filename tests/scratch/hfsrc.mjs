import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
console.log(await page.evaluate(() => {
  const g = __game, r = g.R.renderer, gl = r.getContext();
  const out = [];
  for (const p of r.info.programs) {
    if (!/facade|road|roof|ground/i.test(p.cacheKey)) continue;
    const shaders = gl.getAttachedShaders(p.program); const fs = gl.getShaderSource(shaders[1]);
    out.push(p.cacheKey.split(',').pop().slice(0, 40) + ' hf=' + fs.includes('hfSunVis(hfP') + ' mul=' + fs.includes('directLight.color *= hfSun') + ' apply=' + fs.includes('irradiance *= sk'));
  }
  const m = g.city.batches?.walls?.material; return out.join('\n') + '\nwalls key: ' + m?.customProgramCacheKey?.() + ' HF.on=' + g.city.mats.walls.userData.shader?.uniforms.uHFOn?.value;
}));
await browser.close();
