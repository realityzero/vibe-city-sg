// Dump the place names Claudia can teleport/drive to (landmark POIs + MRT stations + extras) -> tools/vo/places.json.
// They're only known once the world is built, so this loads the game headless:  node tools/vo/dump-places.mjs
import fs from 'node:fs';
import { chromium } from '../../tests/lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&q=low&novo', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
const names = await page.evaluate(() => [...new Set(__game.claudia.places().map(p => p.name))]);
await browser.close();
fs.writeFileSync(new URL('./places.json', import.meta.url), JSON.stringify(names, null, 1));
console.log(names.length, 'places');
