// Main-thread long tasks while the world loads (Chromium, phone profile, optional CPU throttle to approximate the A14):
// each one is time a tap on the title / loading screen can't be answered. Attributed to the load step running at the
// time (performance marks 'vc:<step>' from Game.mark).   node tests/mobile/longtasks.mjs [cpuRate=1.6] [url]
import { launch } from './lib.mjs';
const rate = +(process.argv[2] || 1.6), url = process.argv[3] || 'http://127.0.0.1:4173/?skipTitle&newgame';
const h = await launch('chromium', { exclusive: true });
await h.page.addInitScript(() => { window.__lt = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); });
if (rate > 1) { const cdp = await h.ctx.newCDPSession(h.page); await cdp.send('Emulation.setCPUThrottlingRate', { rate }); }
await h.page.goto(url, { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 300000 });
await h.page.waitForTimeout(1500);
const { lt, marks } = await h.page.evaluate(() => ({ lt: window.__lt, marks: performance.getEntriesByType('mark').filter(m => m.name.startsWith('vc:')).map(m => [m.startTime, m.name.slice(3)]) }));
const stepAt = t => { let s = 'boot'; for (const [mt, n] of marks) if (mt <= t) s = 'after ' + n; return s; };
lt.sort((a, b) => b[1] - a[1]);
console.log(`cpu x${rate}: ${lt.length} long tasks, ${Math.round(lt.reduce((a, b) => a + b[1], 0))} ms total, longest ${Math.round(lt[0]?.[1] || 0)} ms`);
for (const [t, d] of lt.slice(0, 18)) console.log(`${String(Math.round(d)).padStart(6)} ms  at ${(t / 1000).toFixed(1)}s  ${stepAt(t)}`);
await h.browser.close();
