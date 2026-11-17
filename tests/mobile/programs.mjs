// Shader programs the game compiles (phone profile): grouped by material, with the variant flags that split them.
// Each program costs GPU-process memory on iOS (translated shader + Metal pipeline), ~0.5 MB each.
import { launch } from './lib.mjs';
const url = process.argv[2] || 'http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8';
const h = await launch('chromium', { exclusive: false });
await h.page.goto(url, { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 240000 });
await h.page.waitForTimeout(4000);
const r = await h.page.evaluate(() => {
  const progs = __game.R.renderer.info.programs;
  return progs.map(p => {
    const k = p.cacheKey || '';
    const parts = k.split(',');
    return { name: p.name, key: k, used: p.usedTimes, len: k.length, flags: ['instancing', 'batching', 'skinning', 'morphTargets', 'shadowMapEnabled', 'fog', 'useFog', 'alphaTest', 'vertexColors', 'flatShading', 'doubleSided', 'flipSided', 'depthPacking'].filter(f => k.includes(f + ',true') || k.includes(f + ':true')) };
  });
});
console.log('programs:', r.length);
// three's cache key: shaderID / custom key first, then parameters; show the leading tokens to tell materials apart
const head = k => k.split(',').slice(0, 2).join(',').slice(0, 60);
const groups = {}; for (const p of r) { const g = (p.name || head(p.key)); (groups[g] = groups[g] || []).push(p); }
for (const [n, l] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) console.log(String(l.length).padStart(4), n.padEnd(62), 'used', l.reduce((a, p) => a + p.used, 0));
if (process.argv.includes('--keys')) for (const p of r) console.log(p.key.slice(0, 400));
await h.browser.close();
