// what JS structures really cost in JavaScriptCore: drop references, purge, read the WebContent footprint delta
import { launch, pagePids, footprintMB, webkitPurge } from '../mobile/lib.mjs';
const h = await launch('webkit');
await h.page.goto('http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8', { waitUntil: 'commit' });
const pids = await pagePids(h);
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 240000 });
await h.page.waitForTimeout(3000);
await h.page.evaluate(() => { __game.paused = true; __game.tick = () => { }; }); // freeze: nothing may touch what we drop
const read = async () => { await webkitPurge(2500); await webkitPurge(2500); return Math.round(await footprintMB(pids.content)); };
let prev = await read(); console.log('start', prev);
for (const [label, fn] of [
  ['city.data (parsed city.json)', () => { __game.city.data = null; window.__dropData = 1; }],
  ['roadnet', () => { __game.roadnet = null; for (const k of ['traffic', 'peds', 'streetDetail', 'safe', 'stunts', 'scenes', 'spawns', 'missions', 'wanted']) { const o = __game[k]; if (o) for (const kk of Object.keys(o)) if (o[kk] && (o[kk].lanes || o[kk].constructor?.name === 'RoadNet')) o[kk] = null; } __game.traffic && (__game.traffic.net = null); __game.peds && (__game.peds.net = null); }],
  ['radar MapData', () => { __game.ui.radar.map = null; if (__game.ui.map?.view) __game.ui.map.view.getMap = () => null; }],
  ['streetDetail', () => { __game.streetDetail = null; }],
  ['safe spots', () => { __game.safe = null; }],
  ['vegetation CPU (grid/pos)', () => { const v = __game.veg; v.grid = null; v.matrices = null; v.pos = null; }],
  ['audio system', () => { try { __game.audio?.ctx?.close(); } catch { } __game.audio = null; }],
]) {
  await h.page.evaluate(fn).catch(e => console.log('err', e.message));
  const now = await read(); console.log(`drop ${label.padEnd(30)} ${now}  (${now - prev} MB)`); prev = now;
}
await h.browser.close();
