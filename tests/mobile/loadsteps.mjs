// Memory cost of each world-load step on the phone profile: loads with ?memmarks (the game pauses at every step)
// and reads the process footprints at the end of each pause: raw, then (WebKit) live after a low-memory purge.  node tests/mobile/loadsteps.mjs [webkit|chromium] [url]
import { launch, pagePids, footprintMB, GPU_ACCOUNTING, readGpu, webkitPurge } from './lib.mjs';
import { execSync } from 'child_process';
const CATS = process.argv.includes('--cats');
const engine = process.argv[2] || 'webkit', base = process.argv[3] || 'http://127.0.0.1:4173/';
const h = await launch(engine);
await h.page.addInitScript(GPU_ACCOUNTING);
const errs = []; h.page.on('pageerror', e => errs.push(e.message));
await h.page.goto(base + (base.includes('?') ? '&' : '?') + 'skipTitle&newgame&memmarks=4500', { waitUntil: 'commit' });
const pids = await pagePids(h);
let last = null, pc = 0, pg = 0, prev = [0, 0];
const sgn = n => (n >= 0 ? '+' : '') + Math.round(n);
const row = async label => {
  const raw = await footprintMB(pids.content);
  if (engine === 'webkit') await webkitPurge();
  const [c, g, gpu] = await Promise.all([footprintMB(pids.content), footprintMB(pids.gpu), readGpu(h.page).catch(() => null)]);
  console.log(`${label.padEnd(28)} page raw ${String(Math.round(raw)).padStart(5)}  live ${String(Math.round(c)).padStart(5)} (${sgn(c - prev[0])})`.padEnd(66) + `GPU proc ${String(Math.round(g)).padStart(5)} (${sgn(g - prev[1])})`.padEnd(24) + (gpu ? `  webgl ${gpu.buffers}+${gpu.textures} MB  wasm ${gpu.wasm}` : ''));
  if (CATS && engine === 'webkit') {
    const mb = t => { const m = t.match(/([\d.]+)\s*(KB|MB|GB|B)/); return m ? +m[1] * ({ B: 1 / 1048576, KB: 1 / 1024, MB: 1, GB: 1024 })[m[2]] : 0; };
    const lines = execSync(`footprint -p ${pids.gpu} 2>&1`).toString().split('\n');
    const get = re => Math.round(lines.filter(l => re.test(l)).reduce((a, l) => a + mb(l.trim()), 0));
    console.log(`      GPU proc: IOAccelerator ${get(/IOAccelerator \(graphics\)/)}  unmapped ${get(/Owned physical footprint \(unmapped\)$/)}  IOSurface ${get(/IOSurface/)}  malloc ${get(/MALLOC_/)}  CoreAnimation ${get(/CoreAnimation/)}`);
  }
  prev = [c, g];
};
const t0 = Date.now();
for (;;) {
  const m = await h.page.evaluate(() => [window.__memMark, !!window.__game?.worldReady]).catch(() => ['DEAD', false]);
  // the game pauses right after finishing a step and sets __memMark to that step's name
  if (m[0] !== last) { last = m[0]; await new Promise(r => setTimeout(r, 900)); await row(last || 'page boot'); }
  if (m[1] || m[0] === 'DEAD' || Date.now() - t0 > 300000) break;
  await new Promise(r => setTimeout(r, 150));
}
await new Promise(r => setTimeout(r, 4000)); await row('ready +4 s');
if (errs.length) console.log('errors', errs.slice(0, 5));
await h.browser.close();
