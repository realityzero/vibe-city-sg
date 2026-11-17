// WebKit footprint (page + GPU process) against the world-load progress label, to see what each load step costs
import { launch, pagePids, footprintMB } from '../mobile/lib.mjs';
const h = await launch('webkit');
await h.page.goto(process.argv[2] || 'http://127.0.0.1:4173/?skipTitle&newgame', { waitUntil: 'commit' });
const pids = await pagePids(h);
let last = '', t0 = Date.now();
for (;;) {
  const [st, c, g] = await Promise.all([h.page.evaluate(() => ({ l: window.__game?.loadLabel || '-', p: window.__game?.loadP || 0, r: !!window.__game?.worldReady, s: window.__game?.state })).catch(() => ({ l: 'DEAD' })), footprintMB(pids.content), footprintMB(pids.gpu)]);
  const line = `${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s  ${String(Math.round(c)).padStart(5)} + ${String(Math.round(g)).padStart(5)} MB  ${(st.p * 100).toFixed(0).padStart(3)}%  ${st.l}${st.r ? ' [READY]' : ''}`;
  if (st.l !== last || st.r) console.log(line);
  last = st.l;
  if (st.l === 'DEAD' || (st.r && Date.now() - t0 > 3000 && (await h.page.evaluate(() => __game.state)) === 'play' && (globalThis.__extra = (globalThis.__extra || 0) + 1) > 12)) break;
  await new Promise(r => setTimeout(r, 300));
}
await h.browser.close();
