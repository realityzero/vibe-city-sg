// every AudioBuffer the game creates: size and creator, plus convolvers (which keep a private FFT copy of their IR)
import { launch } from '../mobile/lib.mjs';
const h = await launch('chromium', { exclusive: false });
await h.page.addInitScript(() => {
  const L = window.__abufs = [];
  const site = () => new Error().stack.split('\n').slice(3, 5).map(l => l.trim().replace(/https?:\/\/[^/]+\//, '').replace(/\?v=\w+/, '').replace(/^at /, '')).join(' < ');
  const P = BaseAudioContext.prototype, cb = P.createBuffer;
  P.createBuffer = function (c, n, sr) { const b = cb.call(this, c, n, sr); L.push([c * n * 4, `${c}ch ${(n / sr).toFixed(2)}s @${sr}`, site()]); return b; };
  const cc = P.createConvolver; P.createConvolver = function () { const n = cc.call(this); L.push([0, 'convolver', site()]); return n; };
  const dd = P.decodeAudioData; P.decodeAudioData = function (...a) { L.push([0, 'decode', site()]); return dd.apply(this, a); };
});
await h.page.goto('http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play' && __game.audio, null, { timeout: 240000 });
await h.page.waitForTimeout(6000);
const r = await h.page.evaluate(() => window.__abufs);
const by = new Map(); for (const [b, d, s] of r) { const k = s.split(' < ')[0].replace(/:\d+$/, ''); const e = by.get(k) || by.set(k, { b: 0, n: 0, d }).get(k); e.b += b; e.n++; }
console.log(`AudioBuffers ${r.filter(x => x[0]).length}, total ${(r.reduce((a, x) => a + x[0], 0) / 1048576).toFixed(1)} MB; convolvers ${r.filter(x => x[1] === 'convolver').length}`);
for (const [k, e] of [...by].sort((a, b) => b[1].b - a[1].b).slice(0, 20)) console.log(`${(e.b / 1048576).toFixed(2).padStart(7)} MB  x${String(e.n).padEnd(4)} ${e.d.padEnd(18)} ${k}`);
await h.browser.close();
