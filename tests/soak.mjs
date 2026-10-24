// Soak test: autopilot drives the player's car around the city for N seconds; reports fps, heap, entity counts, errors.
import { chromium } from './lib/browser.mjs';
const secs = +(process.argv[2] || 180);
const browser = await chromium.launch({ exclusive: true, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 90000 });
await page.evaluate(async () => {
  const g = __game; const { PathDriver } = await import('/src/entities/aiDriver.js');
  g.debugTp(-127, 1263, 0); const v = g.debugCar('taxi');
  const route = () => g.roadnet.randomRoute(v.position.x, v.position.z, 4000, 4);
  window.__ap = new PathDriver(g, v, route(), { speed: 0.8 });
  g.player.autopilot = { disengage() {} };
  g.physics.onStep(h => { if (__ap.done) __ap.setRoute(route()); __ap.update(h); });
  g.timeScale = 1 / 10; // a full day/night cycle in ~4 minutes
});
const t0 = Date.now();
while (Date.now() - t0 < secs * 1000) {
  await page.waitForTimeout(15000);
  const r = await page.evaluate(() => { const g = __game; return { t: g.sky.time.toFixed(1), fps: g.fps.toFixed(0), heapMB: (performance.memory?.usedJSHeapSize / 1e6 || 0).toFixed(0), cars: g.traffic.cars.length, peds: g.peds.peds.length, veh: g.vehicles.length, calls: g.R.renderer.info.render.calls, tex: g.R.renderer.info.memory.textures, geo: g.R.renderer.info.memory.geometries, pos: [g.player.position.x | 0, g.player.position.z | 0], kmh: Math.round((g.player.vehicle?.speed || 0) * 3.6), rain: g.weather.rain.toFixed(2) }; });
  console.log(JSON.stringify(r));
}
await page.screenshot({ path: '/tmp/soak_end.png' });
console.log('errors', errors.length, errors.slice(0, 5));
await browser.close();
