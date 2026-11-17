// What each subsystem holds in Safari's page process (JavaScriptCore objects, typed arrays, canvases): after the load,
// drop one subsystem at a time (destructive — measurement only), purge, and record how much the footprint falls.
//   node tests/mobile/wkattr.mjs
import { launch, pagePids, footprintMB, webkitPurge } from './lib.mjs';
const h = await launch('webkit');
await h.page.goto('http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8&t=11', { waitUntil: 'commit' });
const pids = await pagePids(h);
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
await h.page.waitForTimeout(4000);
// stop the world so nothing rebuilds what we drop
await h.page.evaluate(() => { const g = __game; g.tick = () => { }; g.paused = true; });
const settle = async () => { for (let i = 0; i < 3; i++) await webkitPurge(1500); return footprintMB(pids.content); };
let prev = await settle();
console.log(`page after load: ${Math.round(prev)} MB`);
const steps = [
  ['audio', g => { g.audio?.ctx?.close(); g.audio = null; }],
  ['roadnet', g => { g.roadnet = null; g.traffic = null; g.peds = null; g.streetDetail && (g.streetDetail.game = null); }],
  ['streetDetail', g => { g.streetDetail = null; }],
  ['vegetation', g => { g.veg = null; }],
  ['safe spots', g => { g.safe = null; }],
  ['city data + mask', g => { g.city.data = null; g.city.mask = null; }],
  ['radar map', g => { g.ui.radar.map = null; if (g.ui.map?.view) g.ui.map.view.getMap = () => null; }],
  ['vehicles + spawns', g => { g.vehicles = []; g.spawns = null; }],
  ['landmarks', g => { g.landmarks = null; }],
  ['the scene graph', g => { g.scene.clear(); }],
  ['three.js renderer state', g => { g.R.renderer.dispose(); }],
];
for (const [name, fn] of steps) {
  await h.page.evaluate(`(${fn.toString()})(window.__game)`).catch(e => console.log('  (', name, e.message, ')'));
  const now = await settle();
  console.log(`${name.padEnd(26)} frees ${String(Math.round(prev - now)).padStart(4)} MB   (page ${Math.round(now)})`);
  prev = now;
}
await h.browser.close();
