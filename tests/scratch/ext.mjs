import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl-draft-extensions'] });
const page = await browser.newPage();
const r = await page.evaluate(() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2'); const d = gl.getExtension('WEBGL_debug_renderer_info'); return { t: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'), r: d && gl.getParameter(d.UNMASKED_RENDERER_WEBGL), exts: gl.getSupportedExtensions().join(' ') }; });
console.log(JSON.stringify(r, null, 1));
await browser.close();
