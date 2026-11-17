// Hero-vehicle draws per frame, by vehicle and part (main / shadow), on the drawcalls.mjs drive at phone settings.
//   node tests/scratch/vehdraws.mjs [url]
import { launch } from '../mobile/lib.mjs';
const URL0 = process.argv[2] || 'http://127.0.0.1:4173/';
const h = await launch('chromium', { exclusive: false });
await h.page.goto(URL0 + '?skipTitle&newgame&freeroam=8&q=low&fixedres', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
await h.page.evaluate(() => { const g = __game; void g.debugTp(-60, 1000, 0); void g.debugCar('infernus'); g.autopilot.engage({ x: 900, z: 250 }); });
await h.page.waitForTimeout(6000);
const r = await h.page.evaluate(() => new Promise(res => {
  const R = __game.R.renderer, counts = new Map(); let frames = 0;
  const orig = R.renderBufferDirect.bind(R);
  R.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    let root = null; for (let a = object; a; a = a.parent) if (/^vehicle:/.test(a.name)) { root = a; break; }
    if (root) {
      const p = material.type.includes('Depth') || material.type.includes('Distance') ? 'shadow' : 'main';
      const k = `${p}|${root.name}#${root.id}|${material.type}${material.transparent ? '(T)' : ''} ${geometry.attributes.position.count}v`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return orig(camera, scene, geometry, material, object, group);
  };
  const loop = () => { if (++frames < 30) requestAnimationFrame(loop); else { R.renderBufferDirect = orig; res([...counts].map(([k, v]) => [k, v / 30]).sort()); } };
  requestAnimationFrame(loop);
}));
const tot = {}; for (const [k, v] of r) { const p = k.split('|')[0]; tot[p] = (tot[p] || 0) + v; console.log(v.toFixed(1).padStart(5), k); }
console.log('hero vehicle draws per frame:', JSON.stringify(tot));
console.log((await h.page.evaluate(() => __game.vehicles.map(v => `${v.type}#${v.root.id} ${v.position.distanceTo(__game.player.position).toFixed(0)} m${v === __game.player.vehicle ? ' (player)' : ''}`))).join('\n'));
await h.browser.close();
