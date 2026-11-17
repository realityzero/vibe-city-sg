import { launch } from '../mobile/lib.mjs';
const h = await launch('chromium', { exclusive: false });
await h.page.goto('http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 240000 });
await h.page.waitForTimeout(3000);
const r = await h.page.evaluate(() => {
  // map programs back to materials: walk the scene and every material's program
  const R = __game.R.renderer, byProg = new Map();
  const note = (m, o, how) => { const p = R.properties.get(m); const progs = p.programs ? [...p.programs.values()] : []; for (const pr of progs) { const l = byProg.get(pr) || byProg.set(pr, []).get(pr); l.push(`${m.type}${m.customProgramCacheKey ? '[' + m.customProgramCacheKey() + ']' : ''}${how} on ${o.isBatchedMesh ? 'Batched' : o.isInstancedMesh ? 'Instanced' : o.isSkinnedMesh ? 'Skinned' : o.isPoints ? 'Points' : 'Mesh'}:${(o.name || o.parent?.name || '').slice(0, 22)}`); } };
  __game.scene.traverse(o => { for (const m of [].concat(o.material || [])) note(m, o, ''); if (o.customDepthMaterial) note(o.customDepthMaterial, o, '(depth)'); });
  return R.info.programs.map(p => ({ key: (p.cacheKey || '').split(',').slice(0, 1)[0], users: [...new Set(byProg.get(p) || [])].slice(0, 3) }));
});
const lines = r.map(p => `${p.key.padEnd(12)} ${p.users.join(' | ') || '(no scene user)'}`).sort();
console.log(lines.join('\n'));
await h.browser.close();
