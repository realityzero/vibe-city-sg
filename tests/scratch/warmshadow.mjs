import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('console', m => { const t = m.text(); if (/^\[ws\]|warmUp/.test(t)) console.log(t.slice(0, 400)); });
await page.addInitScript(() => {
  // count shadow renders and depth programs created during the whole session
  const iv = setInterval(() => {
    const g = window.__game; if (!g?.R?.renderer) return; clearInterval(iv);
    const r = g.R.renderer, sm = r.shadowMap, so = sm.render.bind(sm);
    window.__sh = { calls: 0, objs: 0 };
    sm.render = (lights, scene, camera) => { __sh.calls++; console.log(`[ws] shadow render #${__sh.calls} lights=${lights.length} state=${g.state} ready=${g.worldReady} auto=${sm.autoUpdate} needs=${sm.needsUpdate} enabled=${sm.enabled}`); return so(lights, scene, camera); };
  }, 5);
});
const title = !!process.env.TITLE;
await page.goto('http://127.0.0.1:5174/' + (title ? '' : '?skipTitle&newgame&freeroam=1&q=high'), { waitUntil: 'load' });
if (title) { await page.waitForTimeout(1000); await page.keyboard.press('Enter'); }
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.evaluate(() => { window.__p0 = new Set(__game.R.renderer.info.programs); window.__p0k = [...__p0].map(p => p.cacheKey); });
if (title) { await page.keyboard.press('Enter'); await page.waitForFunction(() => __game.state === 'play', null, { timeout: 60000 }); await page.waitForTimeout(3000); for (let i = 0; i < 10; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(300); } }
await page.waitForTimeout(4000);
console.log(await page.evaluate(() => {
  const all = __game.R.renderer.info.programs, depth0 = [...__p0].filter(p => p.cacheKey.startsWith('depth')).map(p => p.cacheKey.split(','));
  const out = ['depth programs at warm-up: ' + depth0.length];
  for (const p of all.filter(p => !__p0.has(p))) {
    const k = p.cacheKey.split(','); let best = null, bd = 1e9;
    for (const o of depth0) { if (o.length !== k.length) continue; let d = 0; for (let i = 0; i < k.length; i++) if (o[i] !== k[i]) d++; if (d < bd) { bd = d; best = o; } }
    out.push(`new ${k[0]} diff(${bd}) ` + (best ? k.map((v, i) => v !== best[i] ? `[${i}] ${best[i]} -> ${v}` : null).filter(Boolean).join(' ; ') : 'none') + '\n   KEY ' + p.cacheKey.slice(0, 600));
  }
  return out.join('\n');
}));
await browser.close();
