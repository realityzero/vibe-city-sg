// node tests/montage.mjs out.png cols img1 img2 ... — tiles screenshots into one contact sheet (with labels)
import { chromium } from './lib/browser.mjs';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
const [out, colsArg, ...files] = process.argv.slice(2);
const cols = +colsArg || 2, w = 640, h = 360;
const imgs = files.map(f => `<div style="position:relative;width:${w}px;height:${h}px"><img src="data:image/png;base64,${readFileSync(f).toString('base64')}" style="width:${w}px;height:${h}px;display:block"><span style="position:absolute;left:4px;bottom:4px;font:12px monospace;color:#fff;background:#0008;padding:1px 4px">${basename(f)}</span></div>`).join('');
const html = `<body style="margin:0;background:#111"><div style="display:grid;grid-template-columns:repeat(${cols},${w}px);gap:2px">${imgs}</div></body>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: cols * (w + 2), height: Math.ceil(files.length / cols) * (h + 2) } });
await p.setContent(html); await p.screenshot({ path: out, fullPage: true }); await b.close(); console.log('montage', out);
