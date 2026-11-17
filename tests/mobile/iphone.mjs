// iPhone 12 harness: a cold start of the game the way a phone player does it, in Safari's engine (default) or
// Chromium, measuring what decides whether iOS Safari keeps the tab alive.
//
//   node tests/mobile/iphone.mjs [--engine webkit|chromium] [--url http://127.0.0.1:4173/] [--play 15] [--cpu 1.5]
//
// Flow, all with real taps: splash ("TAP TO START") -> title menu -> START GAME -> loading screen (tapping on it)
// -> intro (SKIP button) -> on foot with the touch stick, look drag and JUMP. Checks each step responds.
// Measures: phys_footprint of the page's WebContent/renderer and GPU processes (iOS jetsam counts phys_footprint),
// in-page GPU allocation bytes and WASM memory, splash/menu tap latency, time to playable, main-thread ms per
// frame and fps while playing (Chromium can also throttle the CPU with --cpu to approximate the A14).
// Serve the production build first:  npx vite build && npx vite preview --port 4173 --host 127.0.0.1
import { launch, pagePids, sampleMemory, GPU_ACCOUNTING, readGpu } from './lib.mjs';
import fs from 'fs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const engine = arg('engine', 'webkit'), URL0 = arg('url', 'http://127.0.0.1:4173/'), PLAY = +arg('play', 15), CPU = +arg('cpu', 1);
const out = { engine, url: URL0, steps: {}, errors: [], ok: true };
const fail = (k, why) => { out.ok = false; out.steps[k] = 'FAIL: ' + why; console.log(`FAIL ${k}: ${why}`); };
const pass = (k, info = '') => { out.steps[k] = 'ok ' + info; console.log(`ok   ${k} ${info}`); };

const h = await launch(engine);
const { page } = h;
page.on('pageerror', e => out.errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') out.errors.push('console: ' + m.text().slice(0, 200)); });
page.on('crash', () => { out.errors.push('PAGE CRASHED'); });
await page.addInitScript(GPU_ACCOUNTING);
// main-thread time per animation frame (all rAF callbacks of a frame) and frame intervals
await page.addInitScript(() => {
  const F = window.__frames = { busy: [], gap: [], on: false };
  const raf = window.requestAnimationFrame.bind(window);
  let frameStart = 0, frameBusy = 0, lastTs = 0;
  window.requestAnimationFrame = cb => raf(ts => {
    if (ts !== frameStart) { if (F.on && frameStart) { F.busy.push(frameBusy); F.gap.push(ts - lastTs); } lastTs = frameStart || ts; frameStart = ts; frameBusy = 0; }
    const t = performance.now(); try { cb(ts); } finally { frameBusy += performance.now() - t; }
  });
});
if (engine === 'chromium' && CPU > 1) { const cdp = await h.ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU }); }

const t0 = Date.now(), T = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';
await page.goto(URL0, { waitUntil: 'commit' });
const pids = await pagePids(h);
const mem = sampleMemory(pids);
// --pressure: send WebKit's low-memory notification every second, as iOS does while a tab sits near its limit
// (macOS never does, so JS garbage piles up there): the peaks then approximate what a phone sees
let pressureOn = process.argv.includes('--pressure') && engine === 'webkit';
if (pressureOn) (async () => { const { execFile } = await import('child_process'); while (pressureOn) { execFile('notifyutil', ['-p', 'org.WebKit.lowMemory']); await new Promise(r => setTimeout(r, 1000)); } })();
mem.mark = 'boot';
const center = sel => page.evaluate(sel => { const e = [...document.querySelectorAll(sel)].find(e => e.getBoundingClientRect().width); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
const tap = (x, y) => page.touchscreen.tap(x, y);
const until = async (fn, ms, arg) => { try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch { return false; } };
const alive = () => page.evaluate(() => 1).then(() => true, () => false);

try {
  // 1. splash: TAP TO START must dismiss on the first tap
  if (!await until(() => document.getElementById('vc-press'), 30000)) throw new Error('splash never appeared');
  pass('splash shown', T());
  await page.waitForTimeout(1500);
  const label = await page.evaluate(() => document.getElementById('vc-press').textContent);
  let t = Date.now(); await tap(422, 195);
  if (await until(() => !document.getElementById('vc-press'), 2500)) pass('first tap dismisses splash', `${Date.now() - t} ms ("${label}")`);
  else { fail('first tap dismisses splash', 'still up 2.5 s after the tap'); await tap(422, 195); await until(() => !document.getElementById('vc-press'), 5000); }

  // 2. title menu: START GAME responds to a tap
  mem.mark = 'title';
  if (!await until(() => [...document.querySelectorAll('.vc-title .vc-menu button')].some(b => b.getBoundingClientRect().width), 15000)) throw new Error('title menu never appeared');
  pass('title menu shown', T());
  await page.waitForTimeout(1000);
  const sg = await center('.vc-title .vc-menu button');
  t = Date.now(); await tap(...sg);
  if (await until(() => window.__game?.state === 'play' || document.querySelector('.vc-loading:not(.vc-hidden)'), 2500)) pass('START GAME responds', `${Date.now() - t} ms`);
  else fail('START GAME responds', 'no state change 2.5 s after the tap');

  // 3. loading: taps on the loading screen must not break anything; wait until the world is up
  mem.mark = 'loading';
  let loadTaps = 0;
  const tLoad = Date.now();
  while (!(await page.evaluate(() => window.__game?.worldReady && window.__game.state === 'play').catch(() => false))) {
    if (!await alive()) throw new Error('page died while loading');
    if (Date.now() - tLoad > 240000) throw new Error('world not ready after 240 s');
    if (await page.evaluate(() => !!document.querySelector('.vc-loading:not(.vc-hidden)')).catch(() => false)) { await tap(100 + Math.random() * 640, 60 + Math.random() * 270); loadTaps++; }
    await page.waitForTimeout(700);
  }
  pass('world ready', `${T()} (${loadTaps} taps on the loading screen)`);

  // 4. intro: the SKIP button takes us through to control
  mem.mark = 'intro';
  // (control has to stay with the player for 2 s: the first mission's cutscene starts right after the intro)
  const tIntro = Date.now(); let freeSince = 0;
  for (;;) {
    const free = await page.evaluate(() => { const g = __game; return g.player.controlsEnabled && g.input.enabled && !g.cameraRig.override && !g.ui._sub; });
    if (free) { freeSince = freeSince || Date.now(); if (Date.now() - freeSince > 2000) break; } else freeSince = 0;
    if (Date.now() - tIntro > 180000) throw new Error('intro/cutscenes never handed over control');
    const sk = !free && await center('.vc-touch .sys.skip'); if (sk) await tap(...sk);
    await page.waitForTimeout(400);
  }
  pass('playable', T());

  // 5. touch controls: stick walks, drag looks, JUMP jumps
  mem.mark = 'play';
  const st = () => page.evaluate(() => { const p = __game.player; return { x: p.position.x, z: p.position.z, yaw: __game.cameraRig.yaw, vy: p.vy, grounded: p.grounded }; });
  const ptr = (type, x, y, id, sel = '.vc-touch .surf') => page.evaluate(([type, x, y, id, sel]) => document.querySelector(sel).dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 1 })), [type, x, y, id, sel]);
  // a new game opens at the wheel (the cold open): hold BRAKE to a stop, then EXIT for the on-foot checks
  if (await page.evaluate(() => !!__game.player.vehicle)) {
    const bk = await center('.vc-touch .b-brake');
    if (bk) { await ptr('pointerdown', ...bk, 3, '.vc-touch .b-brake'); await until(() => __game.player.vehicle.speed < 0.8, 10000); await ptr('pointerup', ...bk, 3, '.vc-touch .b-brake'); }
    const ex = await center('.vc-touch .b-exit');
    if (ex) await tap(...ex);
    if (await until(() => !__game.player.vehicle && __game.player.state === 'foot', 6000)) pass('BRAKE + EXIT', 'out of the car'); else fail('BRAKE + EXIT', 'still in the car');
    await page.waitForTimeout(800);
  }
  let a = await st(), b;
  await ptr('pointerdown', 560, 170, 1); for (let k = 1; k <= 8; k++) await ptr('pointermove', 560 + k * 15, 170, 1); await ptr('pointerup', 680, 170, 1);
  await page.waitForTimeout(200); b = await st();
  Math.abs(b.yaw - a.yaw) > 0.2 ? pass('drag looks', `${(b.yaw - a.yaw).toFixed(2)} rad`) : fail('drag looks', `yaw ${(b.yaw - a.yaw).toFixed(3)}`);
  const jb = await center('.vc-touch .b-jump');
  if (!jb) fail('JUMP', 'button not on screen: ' + await page.evaluate(() => `mode ${__game.touch.mode} flags "${__game.touch.flags}" controls ${__game.player.controlsEnabled} mission ${__game.missions.active?.id || '-'} cutscene ${!!__game.cameraRig.override}`));
  else { await tap(...jb); await page.waitForTimeout(120); b = await st(); !b.grounded || b.vy > 0.5 ? pass('JUMP') : fail('JUMP', 'no jump'); }

  await page.waitForTimeout(800); a = await st();
  await ptr('pointerdown', 130, 290, 1); for (let k = 1; k <= 6; k++) await ptr('pointermove', 130, 290 - k * 12, 1);
  await page.waitForTimeout(1500); b = await st(); await ptr('pointerup', 130, 218, 1);
  const moved = Math.hypot(b.x - a.x, b.z - a.z);
  moved > 2 ? pass('stick walks', `${moved.toFixed(1)} m`) : fail('stick walks', `moved ${moved.toFixed(2)} m`);
  // 6. sustained play: walk in a circle with the stick, measure frames
  await page.waitForTimeout(1000);
  await page.evaluate(() => { const F = window.__frames; F.busy.length = F.gap.length = 0; F.on = true; });
  await ptr('pointerdown', 130, 290, 1);
  const tP = Date.now();
  while (Date.now() - tP < PLAY * 1000) { const k = (Date.now() - tP) / 1000; await ptr('pointermove', 130 + Math.sin(k) * 40, 290 - Math.cos(k) * 40, 1); await page.waitForTimeout(250); }
  await ptr('pointerup', 130, 290, 1);
  const fr = await page.evaluate(() => { const F = window.__frames; F.on = false; const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0; }; const sum = F.gap.reduce((x, y) => x + y, 0); return { frames: F.gap.length, fps: F.gap.length / (sum / 1000), busyP50: q(F.busy, 0.5), busyP95: q(F.busy, 0.95), gapP95: q(F.gap, 0.95), tris: __game.R.renderer.info.render.triangles, calls: __game.R.renderer.info.render.calls, quality: __game.R.qualityName, px: `${__game.R.width}x${__game.R.height}` }; });
  out.play = fr;
  pass('play', `${fr.fps.toFixed(1)} fps · main thread p50 ${fr.busyP50.toFixed(1)} / p95 ${fr.busyP95.toFixed(1)} ms · ${(fr.tris / 1e6).toFixed(2)} M tris · ${fr.calls} calls · ${fr.quality} ${fr.px}`);
} catch (e) {
  fail('flow', e.message.split('\n')[0]);
}

await new Promise(r => setTimeout(r, 1500));
mem.stop(); pressureOn = false;
out.gpu = await readGpu(page).catch(() => null);
out.memory = { peak: mem.peak, last: mem.last, timeline: mem.timeline };
out.alive = await alive();
await h.browser.close();
const r = n => Math.round(n);
console.log(`memory (phys_footprint MB): content peak ${r(mem.peak.content)} · GPU process peak ${r(mem.peak.gpu)} · sum peak ${r(mem.peak.sum)} · now ${r(mem.last.content || 0)} + ${r(mem.last.gpu || 0)}`);
if (out.gpu) console.log(`in-page: GPU buffers ${out.gpu.buffers} · textures ${out.gpu.textures} · renderbuffers ${out.gpu.renderbuffers} · GPU peak ${out.gpu.gpuPeak} · WASM ${out.gpu.wasm}${out.gpu.jsHeap != null ? ' · JS heap ' + out.gpu.jsHeap : ''} MB`);
const byMark = {}; for (const [, c, g, m] of mem.timeline) { const b = byMark[m] || (byMark[m] = [0, 0]); b[0] = Math.max(b[0], c); b[1] = Math.max(b[1], g); }
console.log('peak by phase:', Object.entries(byMark).map(([m, [c, g]]) => `${m} ${c}+${g}`).join(' · '));
if (out.errors.length) console.log('errors:', out.errors.slice(0, 8));
fs.mkdirSync('/tmp/vc-mobile', { recursive: true });
const f = `/tmp/vc-mobile/${new Date().toISOString().replace(/[:.]/g, '-')}-${engine}.json`;
fs.writeFileSync(f, JSON.stringify(out, null, 1));
console.log(out.ok && !out.errors.length ? 'PASS' : 'FAIL', '→', f);
process.exit(out.ok ? 0 : 1);
