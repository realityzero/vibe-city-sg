// WebKit page-process categories in play (after purge)
import { launch, pagePids, footprintMB, webkitPurge } from '../mobile/lib.mjs';
import { execSync } from 'child_process';
const h = await launch('webkit');
await h.page.goto(process.argv[2] || 'http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8&t=11', { waitUntil: 'commit' });
const pids = await pagePids(h);
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
await h.page.waitForTimeout(8000); await webkitPurge(2500); await webkitPurge(2500);
console.log('page', Math.round(await footprintMB(pids.content)), 'gpu', Math.round(await footprintMB(pids.gpu)));
console.log(execSync(`footprint -p ${pids.content} 2>&1 | sed -n 5,20p`).toString());
await h.browser.close();
