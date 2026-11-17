import { launch } from '../mobile/lib.mjs';
const h = await launch('chromium', { exclusive: false });
await h.page.goto('http://127.0.0.1:5174/?skipTitle&newgame', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 240000 });
console.log(await h.page.evaluate(() => `records ${__game.city.facadeRecordCount}`));
await h.browser.close();
