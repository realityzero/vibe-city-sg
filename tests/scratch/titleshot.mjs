import { launch } from '../mobile/lib.mjs';
const engine = process.argv[2] || 'chromium';
const h = await launch(engine, { exclusive: false, device: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
await h.page.goto('http://127.0.0.1:4173/?memmarks=200000', { waitUntil: 'load' });
await h.page.waitForTimeout(2500); await h.page.touchscreen.tap(422, 195);
await h.page.waitForTimeout(3500);
await h.page.screenshot({ path: `/tmp/vc/title_canvasgrid_${engine}.png` });
await h.browser.close();
