import { launch } from '../mobile/lib.mjs';
const h = await launch('chromium', { exclusive: false });
await h.page.goto('http://127.0.0.1:5174/?skipTitle&newgame', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 240000 });
console.log(JSON.stringify(await h.page.evaluate(() => globalThis.__clipStats)));
await h.browser.close();
