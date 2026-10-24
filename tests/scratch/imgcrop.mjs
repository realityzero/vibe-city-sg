// crop + upscale a PNG region: node tests/scratch/imgcrop.mjs in.png x,y,w,h scale out.png
import { chromium } from 'playwright';
import fs from 'fs';
const [inp, rect, scale = '2', out] = process.argv.slice(2); const [x, y, w, h] = rect.split(',').map(Number), s = +scale;
const b = await chromium.launch(); const p = await b.newPage();
const url = 'data:image/png;base64,' + fs.readFileSync(inp).toString('base64');
const data = await p.evaluate(async ({ url, x, y, w, h, s }) => { const i = new Image(); i.src = url; await i.decode(); const c = document.createElement('canvas'); c.width = w * s; c.height = h * s; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(i, x, y, w, h, 0, 0, w * s, h * s); return c.toDataURL('image/png'); }, { url, x, y, w, h, s });
fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
await b.close();
