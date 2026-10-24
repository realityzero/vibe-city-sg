// mean linear RGB / luminance of a rectangle in PNGs: node tests/scratch/imgstat.mjs x,y,w,h a.png b.png ...
import { chromium } from 'playwright';
import fs from 'fs';
const [rect, ...files] = process.argv.slice(2); const [x, y, w, h] = rect.split(',').map(Number);
const b = await chromium.launch(); const p = await b.newPage();
for (const f of files) {
  const url = 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  const r = await p.evaluate(async ({ url, x, y, w, h }) => { const i = new Image(); i.src = url; await i.decode(); const c = new OffscreenCanvas(i.width, i.height), g = c.getContext('2d'); g.drawImage(i, 0, 0); const d = g.getImageData(x, y, w, h).data; let s = [0, 0, 0], sl = 0, sl2 = 0; const L = v => Math.pow(v / 255, 2.2); for (let k = 0; k < d.length; k += 4) { const r = L(d[k]), gg = L(d[k + 1]), bb = L(d[k + 2]); s[0] += r; s[1] += gg; s[2] += bb; const l = 0.2126 * r + 0.7152 * gg + 0.0722 * bb; sl += l; sl2 += l * l; } const n = d.length / 4; const m = sl / n; return { rgb: s.map(v => (v / n).toFixed(4)), lum: m.toFixed(4), sd: Math.sqrt(sl2 / n - m * m).toFixed(4) }; }, { url, x, y, w, h });
  console.log(f, JSON.stringify(r));
}
await b.close();
