// CPU profile of the world load (Chromium, phone profile, CPU throttle): self time by function inside the longest
// main-thread task, to see what blocks taps.   node tests/mobile/cpuwindow.mjs [cpuRate=1.6] [url]
import { launch } from './lib.mjs';
const rate = +(process.argv[2] || 1.6), url = process.argv[3] || 'http://127.0.0.1:4173/?skipTitle&newgame';
const h = await launch('chromium', { exclusive: true });
await h.page.addInitScript(() => { window.__lt = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); });
const cdp = await h.ctx.newCDPSession(h.page);
if (rate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate });
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
await h.page.goto(url, { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 300000 });
const { profile } = await cdp.send('Profiler.stop');
const { lt, origin } = await h.page.evaluate(() => ({ lt: window.__lt, origin: performance.timeOrigin }));
lt.sort((a, b) => b[1] - a[1]);
const nodes = new Map(profile.nodes.map(n => [n.id, n]));
const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
// profile timestamps are µs on a monotonic clock; align: sample i at startTime + sum(timeDeltas)
let t = profile.startTime; const times = profile.timeDeltas.map(d => (t += d));
// performance.now() 0 corresponds to the first sample time of navigation ~ find by matching: use first long task as anchor is unreliable;
// instead report per task the functions in the window [start, start+dur] using Date-based offset from Profiler startTime
const base = profile.startTime; // µs
for (const [st, dur] of lt.slice(0, 3)) {
  // find the window in profile time: tasks are ordered, so look for the busiest contiguous run of non-idle samples with matching duration
  const self = new Map(), app = new Map();
  // map perf time -> profile time: navigation start ≈ first sample of the new document; approximate via the earliest sample of (program) after goto
  const t0 = base + st * 1000 - lt0offset(); const t1 = t0 + dur * 1000;
  for (let i = 0; i < times.length; i++) {
    if (times[i] < t0 || times[i] > t1) continue;
    const n = nodes.get(profile.samples[i]); const f = n.callFrame;
    const key = `${f.functionName || '(anon)'} ${f.url.replace(/.*\//, '').replace(/\?.*/, '')}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + 1);
    // nearest src/ frame up the stack
    let m = n; while (m && !/\/src\//.test(m.callFrame.url)) m = nodes.get(parent.get(m.id));
    const ak = m ? `${m.callFrame.functionName || '(anon)'} ${m.callFrame.url.replace(/.*\/src\//, 'src/').replace(/\?.*/, '')}:${m.callFrame.lineNumber + 1}` : '(no src frame)';
    app.set(ak, (app.get(ak) || 0) + 1);
  }
  const tot = [...self.values()].reduce((a, b) => a + b, 0) || 1;
  console.log(`\n== task ${Math.round(dur)} ms at ${(st / 1000).toFixed(1)}s (${tot} samples)`);
  console.log(' self:', [...self].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${(v / tot * 100).toFixed(0)}% ${k}`).join(' | '));
  console.log(' in game code:', [...app].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${(v / tot * 100).toFixed(0)}% ${k}`).join(' | '));
}
function lt0offset() { return 0; }
await h.browser.close();
