import { launch, pagePids, footprintMB } from '../mobile/lib.mjs';
import { execSync } from 'child_process';
const h = await launch('webkit');
await h.page.goto('http://127.0.0.1:4173/?skipTitle&newgame', { waitUntil: 'commit' });
const pids = await pagePids(h);
await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 240000 });
await h.page.waitForTimeout(3000);
console.log('before', Math.round(await footprintMB(pids.content)), Math.round(await footprintMB(pids.gpu)));
for (const n of ['org.WebKit.lowMemory', 'org.WebKit.lowMemory.begin']) {
  execSync(`notifyutil -p ${n}`);
  await h.page.waitForTimeout(4000);
  console.log('after', n, Math.round(await footprintMB(pids.content)), Math.round(await footprintMB(pids.gpu)));
}
await h.page.evaluate(() => { for (let i = 0; i < 40; i++) { const a = new Float64Array(2e6); a[0] = i; } });
await h.page.waitForTimeout(3000);
console.log('after alloc churn', Math.round(await footprintMB(pids.content)));
execSync('notifyutil -p org.WebKit.lowMemory.end');
await h.browser.close();
