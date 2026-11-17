// IOSurface MB in the GPU process every 200 ms around the loading -> play transition (WebKit, iPhone 12 profile)
import { launch, pagePids } from '../mobile/lib.mjs';
import { execSync } from 'child_process';
const extraCss = process.argv[2] || '';
const h = await launch('webkit');
if (extraCss) await h.page.addInitScript(css => addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }), extraCss);
await h.page.goto('http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8', { waitUntil: 'commit' });
const pids = await pagePids(h);
const mb = t => { const m = t.match(/([\d.]+)\s*(KB|MB|GB|B)/); return m ? +m[1] * ({ B: 1 / 1048576, KB: 1 / 1024, MB: 1, GB: 1024 })[m[2]] : 0; };
const ios = () => { const L = execSync(`footprint -p ${pids.gpu} 2>&1`).toString().split('\n'); return Math.round(L.filter(l => /IOSurface/.test(l)).reduce((a, l) => a + mb(l.trim()), 0)); };
const tl = []; let on = true;
(async () => { const t0 = Date.now(); while (on) { const st = await h.page.evaluate(() => `${window.__game?.state}/${window.__game?.worldReady ? 'R' : '-'}${document.querySelector('.vc-loading.leaving') ? 'L' : ''}${document.querySelector('.vc-loading:not(.vc-hidden)') ? 'V' : ''}`).catch(() => '?'); tl.push(`${((Date.now() - t0) / 1000).toFixed(1)}:${ios()}${st}`); await new Promise(r => setTimeout(r, 200)); } })();
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
await h.page.waitForTimeout(5000); on = false;
console.log(tl.join(' '));
await h.browser.close();
