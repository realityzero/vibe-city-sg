// CPU profile of N seconds of play at a spot: node tests/cpuprof.mjs [x] [z] [secs=4] [drive=0]
// Prints the hottest functions by self time (and their file:line) plus the game's own frame stats.
import { chromium } from './lib/browser.mjs';
const [x = '-60', z = '1000', secs = '4', drive = '0'] = process.argv.slice(2);
const browser = await chromium.launch({ exclusive: true, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&fixedres${process.env.Q ? '&' + process.env.Q : ''}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
// drive=1: hold W in a sedan; drive=2: Claudia autopilot in the Infernus to Marina Bay (the perf.mjs route)
await page.evaluate(([x, z, drive]) => { const g = __game; void g.debugTp(+x, +z, 0); if (+drive) void g.debugCar(+drive === 2 ? 'infernus' : 'sedan'); if (+drive === 2) g.autopilot.engage({ x: 900, z: 250 }); }, [x, z, drive]);
if (+drive === 1) await page.keyboard.down('KeyW');
await page.waitForTimeout(+drive === 2 ? 6000 : 3000);
const cdp = await ctx.newCDPSession(page);
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await page.evaluate(() => { window.__ft = []; let l = performance.now(); const f = () => { const n = performance.now(); __ft.push(n - l); l = n; requestAnimationFrame(f); }; requestAnimationFrame(f); });
await cdp.send('Profiler.start');
await page.waitForTimeout(+secs * 1000);
const { profile } = await cdp.send('Profiler.stop');
const st = await page.evaluate(() => { const ft = __ft.slice().sort((a, b) => a - b), R = __game.R, i = R.renderer.info.render; return { t: __game.sky.time.toFixed(2), rain: __game.weather.rain?.toFixed(2), wet: __game.U.wet.value.toFixed(2), god: R.godPass.enabled, waterOn: __game.water.onScreen, fps: (1000 / (ft.reduce((a, b) => a + b, 0) / ft.length)).toFixed(1), p95: ft[Math.floor(ft.length * 0.95)].toFixed(1), cpu90: R.cpu90?.toFixed(1), gpu90: R.gpu90?.toFixed(1), gpuMs: R.gpuMs?.toFixed(1), miss: R.missRatio?.toFixed(3), calls: i.calls, tris: (i.triangles / 1e6).toFixed(2) }; });
console.log(JSON.stringify(st));
if (+drive === 1) await page.keyboard.up('KeyW');
await browser.close();
// aggregate self time
const dt = profile.timeDeltas, byId = new Map(profile.nodes.map(n => [n.id, n])), self = new Map();
for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) || 0) + (dt[i] || 0));
const agg = new Map(); let total = 0;
for (const [id, us] of self) { const n = byId.get(id), cf = n.callFrame; const key = `${cf.functionName || '(anon)'}  ${(cf.url || '').replace(/^.*\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`; agg.set(key, (agg.get(key) || 0) + us); total += us; }
const top = [...agg].sort((a, b) => b[1] - a[1]).slice(0, +(process.env.TOP || 30));
// inclusive time of the functions called directly by Game.tick (which systems cost what)
{
  const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const incl = new Map();
  for (const [id, us] of self) {
    let n = id, prevName = null, child = null;
    while (n !== undefined) { const nd = byId.get(n); if (nd.callFrame.functionName === 'tick' && /game\.js/.test(nd.callFrame.url)) break; child = nd; n = parent.get(n); }
    if (n === undefined || !child) continue;
    const cf = child.callFrame, key = `${cf.functionName || '(anon)'} ${(cf.url || '').split('/').pop().replace(/\?.*$/, '')}:${cf.lineNumber + 1}`;
    incl.set(key, (incl.get(key) || 0) + us);
  }
  console.log('--- inclusive per call inside Game.tick (ms/s)');
  for (const [k, us] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(`${(us / 1000 / +secs).toFixed(2).padStart(7)}  ${k}`);
}
console.log(`total sampled ${(total / 1000).toFixed(0)} ms over ${secs}s`);
for (const [k, us] of top) console.log(`${(us / 1000 / +secs).toFixed(2).padStart(6)} ms/s  ${(us / total * 100).toFixed(1).padStart(5)}%  ${k}`);
