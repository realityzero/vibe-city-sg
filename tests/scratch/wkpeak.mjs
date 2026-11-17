// is the page memory at a load step live or late-finalized garbage? pause there and purge repeatedly
import { launch, pagePids, footprintMB, webkitPurge } from '../mobile/lib.mjs';
const step = process.argv[2] || 'warm-up: vehicles';
const h = await launch('webkit');
await h.page.goto('http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8&memhold=' + encodeURIComponent(step) + (process.argv[3] ? '&' + process.argv[3] : ''), { waitUntil: 'commit' });
const pids = await pagePids(h);
await h.page.waitForFunction(s => window.__memMark === s, step, { timeout: 300000, polling: 200 });
const t0 = Date.now();
for (const wait of [0, 3000, 6000, 10000]) { await h.page.waitForTimeout(wait); await webkitPurge(1500); console.log(`${step} +${((Date.now() - t0) / 1000).toFixed(0)} s: page ${Math.round(await footprintMB(pids.content))} gpu ${Math.round(await footprintMB(pids.gpu))}`); }
await h.browser.close();
