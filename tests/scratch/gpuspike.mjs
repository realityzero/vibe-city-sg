// GPU-process footprint categories at its peak during load (WebKit, skipTitle flow)
import { launch, pagePids, footprintMB } from '../mobile/lib.mjs';
import { execSync } from 'child_process';
const h = await launch('webkit');
await h.page.goto('http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8', { waitUntil: 'commit' });
const pids = await pagePids(h);
let max = 0, best = '', on = true, tl = [];
const mb = t => { const m = t.match(/([\d.]+)\s*(KB|MB|GB|B)/); return m ? +m[1] * ({ B: 1 / 1048576, KB: 1 / 1024, MB: 1, GB: 1024 })[m[2]] : 0; };
const cats = () => { const L = execSync(`footprint -p ${pids.gpu} 2>&1`).toString().split('\n'); const g = re => Math.round(L.filter(l => re.test(l)).reduce((a, l) => a + mb(l.trim()), 0)); return `IOAccel ${g(/IOAccelerator \(graphics\)/)} IOSurface ${g(/IOSurface/)} malloc ${g(/MALLOC_/)} unmapped ${g(/Owned physical footprint \(unmapped\)$/)} IOAccel-other ${g(/IOAccelerator(?! \(graphics\))/)}`; };
(async () => { while (on) { const g = await footprintMB(pids.gpu); tl.push(Math.round(g)); if (g > max + 20) { max = g; best = `${Math.round(g)} MB: ${cats()} (step ${await h.page.evaluate(() => window.__game?.loadLabel).catch(() => '?')})`; } await new Promise(r => setTimeout(r, 250)); } })();
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
await h.page.waitForTimeout(6000); on = false;
console.log('peak', best); console.log('end ', Math.round(await footprintMB(pids.gpu)), cats());
console.log('timeline', tl.filter((_, i) => i % 4 === 0).join(' '));
await h.browser.close();
