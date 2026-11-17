// Composited-layer memory of the HUD in play on an iPhone 12 profile (WebKit, @3x): GPU-process IOSurface MB per
// variant, each in a fresh page (a hidden layer's surface goes back to WebKit's pool, so in-page toggles read noisy).
//   node tests/mobile/uilayers.mjs ['<extra css for variant 1>' ...]   (variant 0 = as shipped)
import { launch, pagePids, webkitPurge } from './lib.mjs';
import { execSync } from 'child_process';
const url = 'http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8&t=11';
const variants = ['', ...process.argv.slice(2)];
const mb = t => { const m = t.match(/([\d.]+)\s*(KB|MB|GB|B)/); return m ? +m[1] * ({ B: 1 / 1048576, KB: 1 / 1024, MB: 1, GB: 1024 })[m[2]] : 0; };
for (const css of variants) {
  const h = await launch('webkit');
  if (css) await h.page.addInitScript(css => addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }), css);
  await h.page.goto(url, { waitUntil: 'commit' });
  const pids = await pagePids(h);
  await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
  await h.page.waitForTimeout(6000);
  const s = [];
  for (let k = 0; k < 3; k++) { await webkitPurge(1500); const L = execSync(`footprint -p ${pids.gpu} 2>&1`).toString().split('\n'); s.push(Math.round(L.filter(l => /IOSurface/.test(l)).reduce((a, l) => a + mb(l.trim()), 0))); }
  console.log(`IOSurface ${String(Math.min(...s)).padStart(4)} MB (samples ${s.join(', ')})  ${css ? css.slice(0, 110) : '(as shipped)'}`);
  await h.browser.close();
}
