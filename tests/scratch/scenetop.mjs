import { launch } from '../mobile/lib.mjs';
const h = await launch('chromium', { exclusive: false });
await h.page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 240000 });
console.log(await h.page.evaluate(() => {
  const g = __game, rows = [], seenBuf = new WeakSet();
  const bytesOf = o => { let n = 0, cnt = 0; o.traverse(m => { const geo = m.geometry; if (!geo) return; cnt++; for (const a of [...Object.values(geo.attributes), geo.index].filter(Boolean)) { const arr = a.array; if (arr && !seenBuf.has(arr.buffer)) { seenBuf.add(arr.buffer); n += arr.byteLength; } } }); return [n, cnt]; };
  for (const c of g.scene.children) { const [n, cnt] = bytesOf(c); rows.push([n, `${c.type} ${c.name || ''} (${cnt} geos)`]); }
  // who owns each top-level child: match against known systems
  const owners = new Map(); for (const k of Object.keys(g)) { const v = g[k]; if (!v || typeof v !== 'object') continue; for (const kk of Object.keys(v)) { const x = v[kk]; if (x && x.isObject3D) owners.set(x, `${k}.${kk}`); } }
  return rows.sort((a, b) => b[0] - a[0]).slice(0, 40).map(([n, s], i) => `${(n / 1048576).toFixed(1).padStart(6)} MB  ${s}`).join('\n') + '\n' + g.scene.children.filter(c => owners.has(c)).map(c => `${c.name || c.type} <- ${owners.get(c)}`).join('\n');
}));
await h.browser.close();
