import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const g = __game, net = g.roadnet, d = g.city.data;
  let len = 0, n6 = 0; for (const e of net.edges) { if (e.c > 6 || e.y) continue; n6++; for (let i = 2; i < e.p.length; i += 2) len += Math.hypot(e.p[i] - e.p[i - 2], e.p[i + 1] - e.p[i - 1]); }
  const junc = net.nodes.filter(n => n.degree >= 3).length;
  const names = new Set(net.edges.filter(e => e.n).map(e => e.n)).size;
  const cross = d.roads.filter(r => r.x).length;
  const cls = {}; for (const e of net.edges) cls[e.c] = (cls[e.c] || 0) + 1;
  const roadKeys = Object.keys(d.roads[0]); const edgeKeys = Object.keys(net.edges[0]);
  const wcmp = net.edges.slice(0, 5).map(e => e.hw * 2);
  const pois = {}; for (const p of d.pois) pois[p.k] = (pois[p.k] || 0) + 1;
  const tr = g.city.trees; 
  const sig = net.nodes.filter(n => n.signal).length;
  return { len: Math.round(len), n6, junc, sig, names, cross, cls, roadKeys, edgeKeys, wcmp, pois, trees: tr && (tr.length || Object.keys(tr)), treeType: tr && tr.constructor.name, sample: d.roads.find(r => r.x) };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
