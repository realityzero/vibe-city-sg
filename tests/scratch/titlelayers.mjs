// GPU-process cost of the title screen's layers (WebKit, iPhone 12 profile), element by element. The world load is
// held at its first step (?memmarks) so it doesn't add uploads while we measure.
import { launch, pagePids, footprintMB, webkitPurge } from '../mobile/lib.mjs';
const h = await launch('webkit');
await h.page.goto('http://127.0.0.1:4173/?memmarks=200000', { waitUntil: 'commit' });
const pids = await pagePids(h);
await h.page.waitForTimeout(2500);
await h.page.touchscreen.tap(422, 195);
await h.page.waitForFunction(() => [...document.querySelectorAll('.vc-title .vc-menu button')].some(b => b.getBoundingClientRect().width), null, { timeout: 20000 });
await h.page.waitForTimeout(2500);
const read = async () => { await webkitPurge(1500); return [Math.round(await footprintMB(pids.content)), Math.round(await footprintMB(pids.gpu))]; };
let base = await read();
console.log('title up', base.join(' + '));
for (const sel of ['.vc-grid', '.vc-floor', '.vc-reflect', '.vc-sun', '.vc-sunrefl', '.vc-horizon-glow', '.vc-skyline', '.vc-palms', '.vc-logo', '.vc-stars-bg', '.vc-sky', '.vc-title']) {
  await h.page.evaluate(sel => document.querySelectorAll(sel).forEach(e => e.style.display = 'none'), sel);
  await h.page.waitForTimeout(800);
  const r = await read();
  console.log(`hide ${sel.padEnd(18)} ${r[0]} + ${r[1]}   (GPU ${r[1] - base[1] >= 0 ? '+' : ''}${r[1] - base[1]})`);
  base = r;
}
await h.browser.close();
