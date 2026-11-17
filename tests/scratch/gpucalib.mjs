// How much WebKit GPU-process footprint each kind of WebGL allocation really costs: dispose groups of resources
// after load and read the footprint delta.
import { launch, pagePids, footprintMB, webkitPurge, GPU_ACCOUNTING, readGpu } from '../mobile/lib.mjs';
import { execSync } from 'child_process';
const h = await launch('webkit');
await h.page.addInitScript(GPU_ACCOUNTING);
await h.page.goto('http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8', { waitUntil: 'commit' });
const pids = await pagePids(h);
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 240000 });
await h.page.waitForTimeout(3000);
await h.page.evaluate(() => { __game.paused = true; });
const read = async label => { await webkitPurge(2000); const g = await footprintMB(pids.gpu), c = await footprintMB(pids.content), w = await readGpu(h.page); const cats = execSync(`footprint -p ${pids.gpu} 2>&1`).toString().split('\n').filter(l => /IOAccelerator|IOSurface|unmapped|MALLOC_(SMALL|MEDIUM|LARGE|TINY)|CoreAnimation|VM_ALLOCATE/.test(l)).map(l => l.trim().replace(/\s+0 B\s+0 B\s+\d+\s+/, ' ').replace(/\s+/g, ' ')).join(' | ');
  console.log(`${label.padEnd(34)} GPU proc ${Math.round(g)}  page ${Math.round(c)}  webgl buf ${w.buffers} tex ${w.textures}\n     ${cats}`); return g; };
let prev = await read('loaded (paused)');
const step = async (label, fn) => { await h.page.evaluate(fn); await h.page.waitForTimeout(500); const g = await read(label); console.log(`   -> GPU process ${Math.round(g - prev)} MB`); prev = g; };
await step('dispose vehicle textures', () => { const seen = new Set(); __game.scene.traverse(o => { const m = o.material; for (const mm of [].concat(m || [])) for (const k of ['map']) { const t = mm[k]; if (t && t.image && t.image.width === 1024 && t.image.height === 1024 && !seen.has(t)) { seen.add(t); t.dispose(); } } }); window.__n = seen.size; });
await step('dispose city batched geometry', () => { for (const bm of Object.values(__game.city.batches)) bm.geometry.dispose(); });
await step('dispose landmark geometry', () => { __game.landmarks.group.traverse(o => o.geometry?.dispose()); });
await step('render nothing for a while', () => { __game.scene.visible = false; });
await step('dispose all remaining textures', () => { const seen = new Set(); __game.scene.traverse(o => { for (const mm of [].concat(o.material || [])) for (const v of Object.values(mm)) if (v && v.isTexture && !seen.has(v)) { seen.add(v); v.dispose(); } }); });
await h.browser.close();

