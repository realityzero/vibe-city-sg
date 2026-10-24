import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
console.log(await page.evaluate(() => {
  const g = __game, rows = [];
  let tot = 0, auto = 0;
  for (const c of g.scene.children) {
    let n = 0, a = 0; c.traverse(o => { n++; if (o.matrixAutoUpdate) a++; });
    tot += n; auto += a; rows.push([c.name || c.type, n, a]);
  }
  rows.sort((x, y) => y[1] - x[1]);
  return `total ${tot} objects, ${auto} autoUpdate, ${g.scene.children.length} top-level\n` + rows.slice(0, 25).map(r => r.join('  ')).join('\n');
}));
await browser.close();
