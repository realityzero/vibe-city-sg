// node tests/hitch.mjs [w] [h] [dpr] — measures frame-time spikes during the real start flow and mid-game clicks.
// Goes through splash → title → Enter (new game), records every rAF interval + long tasks, then clicks the canvas,
// opens/closes the pause menu, and reports frames > 33 ms with what was happening. Writes a CPU profile to /tmp/hitch.cpuprofile.
import { chromium } from './lib/browser.mjs';
import fs from 'node:fs';
const [w = '1440', h = '900', dpr = '2'] = process.argv.slice(2);
const extra = process.env.Q || '';
const browser = await chromium.launch({ exclusive: true, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { const t = m.text(); if (/world ready|city \{|\[hitch\]/.test(t)) console.log('[console]', t.slice(0, 200)); });
await page.addInitScript(() => {
  window.__ft = []; window.__lt = []; window.__mark = 'boot';
  let last = performance.now();
  const f = () => { const n = performance.now(); __ft.push([n, n - last, __mark]); last = n; requestAnimationFrame(f); };
  requestAnimationFrame(f);
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) __lt.push([e.startTime, e.duration, __mark]); }).observe({ type: 'longtask', buffered: true }); } catch { }
});
const cdp = await ctx.newCDPSession(page);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await page.goto(`http://127.0.0.1:5174/?${extra}`, { waitUntil: 'load' });
await page.waitForTimeout(1500);
const mark = m => page.evaluate(x => { window.__mark = x; }, m);
await mark('splash-key'); await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await mark('title-idle'); await page.waitForTimeout(1500);
await cdp.send('Profiler.start');
const tStart = await page.evaluate(() => performance.now());
await mark('start'); await page.keyboard.press('Enter');
await page.waitForFunction(() => __game.state === 'play', null, { timeout: 60000 });
await mark('play-0-5s'); await page.waitForTimeout(5000);
await mark('play-5-10s'); await page.waitForTimeout(5000);
const prof1 = (await cdp.send('Profiler.stop')).profile;
fs.writeFileSync('/tmp/hitch-start.cpuprofile', JSON.stringify(prof1));
// skip dialogue / mission intro so the player has control
await mark('skip'); for (let i = 0; i < 12; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(250); }
await page.waitForTimeout(2000);
await cdp.send('Profiler.start');
for (let i = 0; i < 6; i++) {
  await mark(`click${i}`); await page.mouse.click(700 + i * 10, 450); await page.waitForTimeout(900);
}
await mark('walk'); await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
await mark('pause'); await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
await mark('resume'); await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
await mark('mapopen'); await page.keyboard.press('KeyM'); await page.waitForTimeout(1200);
await mark('mapclose'); await page.keyboard.press('KeyM'); await page.waitForTimeout(1500);
await mark('car'); await page.evaluate(() => { void __game.debugCar('infernus'); }); await page.waitForTimeout(1500);
await mark('drive'); await page.keyboard.down('KeyW'); await page.waitForTimeout(4000); await page.keyboard.up('KeyW');
await mark('end'); await page.waitForTimeout(500);
const prof2 = (await cdp.send('Profiler.stop')).profile;
fs.writeFileSync('/tmp/hitch-play.cpuprofile', JSON.stringify(prof2));
const r = await page.evaluate(t0 => ({ ft: __ft.filter(f => f[0] >= t0 - 200), lt: __lt.filter(f => f[0] >= t0 - 200) }), tStart);
const byMark = {};
for (const [t, d, m] of r.ft) { (byMark[m] ||= []).push(d); }
console.log('mark            frames  avg   p95   max   >33ms >50ms');
for (const [m, a] of Object.entries(byMark)) {
  const s = [...a].sort((x, y) => x - y), avg = a.reduce((x, y) => x + y, 0) / a.length;
  console.log(m.padEnd(15), String(a.length).padStart(6), avg.toFixed(1).padStart(5), s[Math.floor(s.length * 0.95)].toFixed(1).padStart(5), s[s.length - 1].toFixed(0).padStart(5), String(a.filter(x => x > 33).length).padStart(6), String(a.filter(x => x > 50).length).padStart(5));
}
console.log('spikes > 50ms:', r.ft.filter(f => f[1] > 50).map(f => `${f[2]}@${Math.round(f[0] - tStart)}:${Math.round(f[1])}`).join('  '));
console.log('long tasks:', r.lt.map(f => `${f[2]}@${Math.round(f[0] - tStart)}:${Math.round(f[1])}`).join('  '));
// top self-time functions per profile
for (const [name, prof] of [['start', prof1], ['play', prof2]]) {
  const self = new Map(); const dt = prof.timeDeltas; const byId = new Map(prof.nodes.map(n => [n.id, n]));
  prof.samples.forEach((id, i) => { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + (dt[i] || 0)); });
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 22);
  console.log(`\n== top self time (${name}) ==`); for (const [k, v] of top) console.log((v / 1000).toFixed(0).padStart(6), 'ms ', k);
}
await browser.close();
