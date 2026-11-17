import { launch } from '../mobile/lib.mjs';
const h = await launch('chromium', { exclusive: false });
await h.page.addInitScript(() => {
  const o = WebGL2RenderingContext.prototype.texSubImage2D; let n = 0;
  WebGL2RenderingContext.prototype.texSubImage2D = function (...a) { const src = a[a.length - 1]; if (src && src.width === 0 && n++ < 6) console.log('REUPLOAD', src.__rel, new Error().stack.split('\n').slice(3, 4).join(' | ')); return o.apply(this, a); };
});
h.page.on('console', m => { if (/REUPLOAD/.test(m.text())) console.log(m.text().replace(/http:\/\/127.0.0.1:5174\//g, '').replace(/\?v=\w+/g, '').slice(0, 900)); });
await h.page.goto('http://127.0.0.1:5174/?skipTitle&newgame', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 180000 }).catch(() => {});
await h.browser.close();
