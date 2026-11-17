// load the production build (phone profile) and print console errors/warnings until the world is ready
import { launch } from '../mobile/lib.mjs';
const engine = process.argv[2] || 'chromium', url = process.argv[3] || 'http://127.0.0.1:4173/?skipTitle&newgame';
const h = await launch(engine, { exclusive: false });
h.page.on('console', async m => { if (['error', 'warning'].includes(m.type()) || /world ready|released/.test(m.text())) { let extra = ''; try { const a = m.args()[0]; extra = a ? await a.evaluate(e => e && e.stack || '') : ''; } catch { } console.log(`[${m.type()}] ${m.text().slice(0, 300)} ${String(extra).split('\n').slice(0, 6).join(' | ')}`); } });
h.page.on('pageerror', e => console.log('[pageerror]', e.message, e.stack?.split('\n').slice(0, 3).join(' | ')));
await h.page.goto(url, { waitUntil: 'load' });
const ok = await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 180000 }).then(() => true, () => false);
console.log('worldReady', ok);
await h.page.waitForTimeout(3000);
await h.browser.close();
