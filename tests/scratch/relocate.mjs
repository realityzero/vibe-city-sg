// Every MRT arrival + Claudia place + respawn must land clear (outside buildings, no collider overlap, on land)
import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&q=low', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const g = __game, V = g.camera.position.constructor, out = { bad: [], n: 0, maxMove: 0 };
  const check = (label, p) => {
    const d = g.relocate(p.clone(), 0); out.n++;
    const ok = g.safe.clear(d.x, d.z); const mv = Math.hypot(d.x - p.x, d.z - p.z); out.maxMove = Math.max(out.maxMove, mv);
    if (!ok || mv > 120) out.bad.push(`${label} -> (${d.x.toFixed(0)},${d.z.toFixed(0)}) moved ${mv.toFixed(0)}m clear=${ok}`);
  };
  for (const st of g.ambient.stations) { check('MRT ' + st.name, st.pos.clone().add(new V(2.5, 0, 0))); if (g.safe.insideBuilding(st.entry?.x ?? st.pos.x, st.entry?.z ?? st.pos.z, 0)) out.bad.push('MRT entry inside building ' + st.name); }
  for (const p of g.claudia.places()) check('Claudia ' + p.name, new V(p.x, 0, p.z));
  check('hospital', new V(-1585, 0, 818)); check('police', new V(-1088, 0, 860));
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
