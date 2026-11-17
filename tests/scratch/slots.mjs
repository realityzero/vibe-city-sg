import { launch } from '../mobile/lib.mjs';
const h = await launch('chromium', { exclusive: false });
await h.page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 300000 });
console.log(await h.page.evaluate(() => JSON.stringify(__game.spawns.slots.map(s => [s.kind, s.type, +s.pos.x.toFixed(3), +s.pos.z.toFixed(3), +(s.yaw ?? 0).toFixed(4)]))));
await h.browser.close();
