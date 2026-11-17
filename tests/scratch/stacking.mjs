// stacking contexts / likely composited layers in play (phone profile): size, why, and how much painted content they hold
import { launch } from '../mobile/lib.mjs';
const h = await launch('webkit', { exclusive: false });
await h.page.goto('http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8&t=11', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
await h.page.waitForTimeout(3000);
console.log(await h.page.evaluate(() => {
  const out = [];
  const why = (e, cs) => { const r = []; if (cs.position !== 'static' && cs.zIndex !== 'auto') r.push('z' + cs.zIndex); if (+cs.opacity < 1) r.push('op' + cs.opacity); if (cs.transform !== 'none') r.push('tf'); if (cs.willChange !== 'auto') r.push('wc'); if (cs.filter !== 'none') r.push('filter'); const bf = cs.webkitBackdropFilter || cs.backdropFilter; if (bf && bf !== 'none') r.push('backdrop'); if (cs.position === 'fixed') r.push('fixed'); if (cs.animationName !== 'none') r.push('anim:' + cs.animationName); if (cs.scale && cs.scale !== 'none') r.push('scale'); if (cs.mixBlendMode !== 'normal') r.push('blend'); if (cs.isolation === 'isolate') r.push('iso'); return r; };
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  for (const e of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(e); if (cs.display === 'none' || !vis(e)) continue;
    const w = why(e, cs); if (!w.length && e.tagName !== 'CANVAS') continue;
    const r = e.getBoundingClientRect();
    if (r.width * r.height < 844 * 390 * 0.25 && !w.some(x => x.startsWith('anim') || x === 'backdrop')) continue;
    out.push(`${Math.round(r.width)}x${Math.round(r.height)}`.padEnd(9) + ` ${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${[...e.classList].join('.')}`.padEnd(42) + ` ${w.join(',')}`);
  }
  return out.join('\n');
}));
await h.browser.close();
