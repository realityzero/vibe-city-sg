import { launch } from '../mobile/lib.mjs';
const h = await launch('chromium', { exclusive: false });
h.page.on('console', m => { const t = m.text(); if (/\d+ ?ms/.test(t) && t.length < 300) console.log(t); });
await h.page.goto(process.argv[2] || 'http://127.0.0.1:5174/?skipTitle&newgame', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 240000 });
await h.browser.close();
