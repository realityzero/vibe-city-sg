// JS heap + what's alive at the very start of the world load (paused there with ?memmarks)
import { launch } from '../mobile/lib.mjs';
const h = await launch('chromium', { exclusive: false });
const cdp = await h.ctx.newCDPSession(h.page);
await h.page.goto('http://127.0.0.1:4173/?memmarks=200000', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__memMark === 'start', null, { timeout: 60000 });
await h.page.waitForTimeout(3000);
await cdp.send('HeapProfiler.collectGarbage');
const m = await h.page.evaluate(() => ({ used: performance.memory.usedJSHeapSize / 1048576, total: performance.memory.totalJSHeapSize / 1048576, scripts: performance.getEntriesByType('resource').filter(r => /\.js$/.test(r.name)).map(r => [r.name.replace(/.*\//, ''), Math.round(r.decodedBodySize / 1024)]) }));
console.log(`JS heap used ${m.used.toFixed(1)} MB (total ${m.total.toFixed(1)})`);
console.log('scripts KB:', m.scripts.sort((a, b) => b[1] - a[1]).slice(0, 10).map(s => s.join(' ')).join(' | '));
const { usedSize } = await cdp.send('Runtime.getHeapUsage');
console.log('Runtime.getHeapUsage', (usedSize / 1048576).toFixed(1));
await h.browser.close();
