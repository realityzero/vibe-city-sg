// Wall time of each world-load step (Chromium, phone profile, CPU throttle ≈ A14): the steps are synchronous, so a
// long step is a stretch where taps go unanswered.   node tests/mobile/steptimes.mjs [cpuRate=1.6] [url]
import { launch } from './lib.mjs';
const rate = +(process.argv[2] || 1.6), url = process.argv[3] || 'http://127.0.0.1:4173/?skipTitle&newgame&steptimes';
const h = await launch('chromium', { exclusive: true });
const out = []; h.page.on('console', m => { const t = m.text(); if (t.startsWith('step ')) out.push(t); });
if (rate > 1) { const cdp = await h.ctx.newCDPSession(h.page); await cdp.send('Emulation.setCPUThrottlingRate', { rate }); }
await h.page.goto(url, { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 300000 });
const total = await h.page.evaluate(() => Math.round(performance.getEntriesByName('vc:warm-up done')[0]?.startTime - performance.getEntriesByName('vc:start')[0]?.startTime));
console.log(`cpu x${rate}\n` + out.join('\n') + `\ntotal load (start -> warm-up done): ${total} ms`);
await h.browser.close();
