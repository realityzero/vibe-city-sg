// GPU-process IOSurface (composited layer backing stores) in play, hiding UI layers one at a time (iPhone 12 @3x)
import { launch, pagePids, footprintMB, webkitPurge } from '../mobile/lib.mjs';
import { execSync } from 'child_process';
const h = await launch('webkit');
await h.page.goto('http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8&t=11', { waitUntil: 'commit' });
const pids = await pagePids(h);
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
await h.page.waitForTimeout(5000);
const mb = t => { const m = t.match(/([\d.]+)\s*(KB|MB|GB|B)/); return m ? +m[1] * ({ B: 1 / 1048576, KB: 1 / 1024, MB: 1, GB: 1024 })[m[2]] : 0; };
const cats = () => { const L = execSync(`footprint -p ${pids.gpu} 2>&1`).toString().split('\n'); const g = re => Math.round(L.filter(l => re.test(l)).reduce((a, l) => a + mb(l.trim()), 0)); return `IOSurface ${g(/IOSurface/)}  IOAccel ${g(/IOAccelerator \(graphics\)/)}  total ${Math.round(+(L.find(l => /phys_footprint:/.test(l)) || '').replace(/[^\d.]/g, '') || 0)}`; };
const step = async (label, fn, arg) => { if (fn) await h.page.evaluate(fn, arg); await h.page.waitForTimeout(1500); await webkitPurge(1500); console.log(label.padEnd(30), cats(), ' gpu fp', Math.round(await footprintMB(pids.gpu))); };
await step('play');
if (0) console.log(await h.page.evaluate(() => { const out = []; for (const e of document.querySelectorAll('body *')) { const cs = getComputedStyle(e); if (e.offsetWidth * e.offsetHeight < 20000) continue; if (cs.willChange !== 'auto' || cs.transform !== 'none' || cs.backdropFilter && cs.backdropFilter !== 'none' || cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none' || cs.animationName !== 'none' || cs.position === 'fixed' || e.tagName === 'CANVAS') out.push(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${[...e.classList].join('.')} ${e.offsetWidth}x${e.offsetHeight} ${cs.display === 'none' || cs.visibility === 'hidden' ? 'HIDDEN' : ''} wc=${cs.willChange} tf=${cs.transform !== 'none'} bf=${(cs.webkitBackdropFilter || cs.backdropFilter || 'none') !== 'none'} anim=${cs.animationName}`); } return out.slice(0, 25).join('\n'); }));
const parts = process.argv.slice(2).length ? process.argv.slice(2) : ['.vc-touch .surf', '.vc-touch .cluster', '.vc-touch .stick', '.vc-touch .sysbar', '.vc-touch', '.vc-lb', '.vc-radar-wrap', '.vc-hud', '.vc-root'];
for (const sel of parts) await step('hide ' + sel, sel => { for (const e of document.querySelectorAll(sel)) e.style.display = 'none'; }, sel);
await h.browser.close();
