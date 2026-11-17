import { launch } from '../mobile/lib.mjs';
const h = await launch('chromium', { exclusive: false });
await h.page.goto('http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 240000 });
await h.page.waitForTimeout(3000);
console.log(await h.page.evaluate(() => {
  const P = __game.R.renderer.info.programs, by = new Map();
  for (const p of P) { const k = p.cacheKey.split(',').filter((_, i) => i !== 54 && i !== 55).slice(0, 3).join(',') + '|' + (p.cacheKey.match(/(roof|road|facade|struct|ground|lm\w+|tree|vc-\w+|street|water)[\w.-]*/)?.[0] || ''); (by.get(k) || by.set(k, []).get(k)).push(p.cacheKey.split(',')); }
  const fieldDiffs = new Map(); let pairs = 0;
  for (const [k, l] of by) if (l.length === 2) { pairs++; const [a, b] = l; const d = []; for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) d.push(i); const s = d.join(','); fieldDiffs.set(s, (fieldDiffs.get(s) || 0) + 1); }
  const sample = P[0].cacheKey.split(',');
  return `${P.length} programs, ${by.size} groups, ${pairs} pairs\ndiffering fields → count: ${JSON.stringify([...fieldDiffs])}\nsample key fields: ` + sample.map((v, i) => `${i}:${v}`).join(' ').slice(0, 1500);
}));
await h.browser.close();
