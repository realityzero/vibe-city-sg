// Load-time allocation volume by call site (including everything that became garbage): what drives the raw memory
// peak while the world loads. V8 sampling heap profiler with collected objects kept, attributed to the nearest frame
// in src/.   node tests/mobile/allocs.mjs [url]
import { launch } from './lib.mjs';
const url = process.argv[2] || 'http://127.0.0.1:5174/?skipTitle&newgame';
const h = await launch('chromium', { exclusive: false });
const cdp = await h.ctx.newCDPSession(h.page);
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32768, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
await h.page.goto(url, { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 240000 });
const { profile } = await cdp.send('HeapProfiler.getSamplingProfile');
const bySite = new Map(), byFile = new Map();
const walk = (n, stack) => {
  const here = [...stack, n.callFrame];
  if (n.selfSize) {
    let app = null; for (let i = here.length - 1; i >= 0; i--) if (/\/src\//.test(here[i].url)) { app = here[i]; break; }
    const file = app ? app.url.replace(/.*\/src\//, 'src/').replace(/\?.*/, '') : '(other)';
    const site = app ? `${file}:${app.lineNumber + 1} ${app.functionName || '(anon)'}` : `(other) ${n.callFrame.functionName || n.callFrame.url.replace(/.*\//, '')}`;
    bySite.set(site, (bySite.get(site) || 0) + n.selfSize); byFile.set(file, (byFile.get(file) || 0) + n.selfSize);
  }
  for (const c of n.children) walk(c, here);
};
walk(profile.head, []);
const tot = [...byFile.values()].reduce((a, b) => a + b, 0), MB = n => (n / 1048576).toFixed(0).padStart(5);
console.log(`allocated during load ≈ ${MB(tot)} MB (JS objects; ArrayBuffer backing stores are not sampled)`);
console.log('by file:'); for (const [k, v] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`${MB(v)} MB  ${k}`);
console.log('by site:'); for (const [k, v] of [...bySite].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`${MB(v)} MB  ${k}`);
await h.browser.close();
