// footprint category breakdown of the WebKit page + GPU processes once the world has loaded behind the title
import { launch, pagePids, webkitPurge } from '../mobile/lib.mjs';
import { execSync } from 'child_process';
const h = await launch('webkit');
await h.page.goto(process.argv[2] || 'http://127.0.0.1:4173/', { waitUntil: 'commit' });
const pids = await pagePids(h);
await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 240000 });
await h.page.waitForTimeout(3000); await webkitPurge(3000);
for (const [k, pid] of Object.entries(pids)) { console.log(`===== ${k} ${pid}`); console.log(execSync(`footprint -p ${pid} 2>&1 | head -22`).toString()); }
await h.browser.close();
