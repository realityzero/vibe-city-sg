import { launch } from '../mobile/lib.mjs';
const h = await launch('chromium', { exclusive: false });
await h.page.goto('http://127.0.0.1:4173/?skipTitle&newgame&keepgeo', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 240000 });
console.log(await h.page.evaluate(() => {
  const out = []; let tot = 0;
  const geoBytes = (name, g) => { const parts = []; let sum = 0; for (const [k, a] of Object.entries(g.attributes)) { const b = a.count * a.itemSize * (a.array?.BYTES_PER_ELEMENT || 4); sum += b; parts.push(`${k}:${a.itemSize}x${a.array?.constructor.name.replace('Array', '') || '?'}=${(b / 1048576).toFixed(1)}`); } const ib = g.index ? g.index.count * 4 : 0; sum += ib; tot += sum; out.push(`${name.padEnd(14)} ${(sum / 1048576).toFixed(1).padStart(6)} MB  verts ${g.attributes.position.count}  idx ${(ib / 1048576).toFixed(1)}  ${parts.join(' ')}`); };
  for (const [k, bm] of Object.entries(__game.city.batches)) geoBytes(k, bm.geometry);
  let near = 0, nearV = 0; __game.city.group.traverse(o => { if (o.isMesh && !o.isBatchedMesh && o.geometry) { for (const a of Object.values(o.geometry.attributes)) near += a.count * a.itemSize * 4; near += (o.geometry.index?.count || 0) * 4; nearV += o.geometry.attributes.position.count; } });
  out.push(`near meshes    ${(near / 1048576).toFixed(1)} MB  verts ${nearV}`);
  return out.join('\n') + `\nbatched total ${(tot / 1048576).toFixed(1)} MB`;
}));
await h.browser.close();
