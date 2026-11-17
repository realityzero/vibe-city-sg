import { launch } from '../mobile/lib.mjs';
for (const eng of ['webkit']) {
  const h = await launch(eng, { exclusive: false });
  await h.page.goto('http://127.0.0.1:4173/vc-blank-404', { waitUntil: 'load' }).catch(() => { });
  const r = await h.page.evaluate(async () => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)(), sr = ctx.sampleRate, out = [];
    for (const dur of [0.42, 2.2, 2.6, 3.2]) {
      const len = Math.floor(sr * dur), b = ctx.createBuffer(2, len, sr);
      for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
      const ts = [];
      for (let k = 0; k < 12; k++) { const t0 = performance.now(); const cv = ctx.createConvolver(); cv.buffer = b; ts.push(performance.now() - t0); cv.buffer = null; await new Promise(r => setTimeout(r, 30)); }
      ts.sort((a, b) => a - b);
      out.push(`${dur}s build median ${ts[6].toFixed(1)} ms (min ${ts[0].toFixed(1)}, max ${ts[11].toFixed(1)})`);
    }
    return out.join(' | ');
  });
  console.log(eng.padEnd(9), r);
  await h.browser.close();
}
