// Shared pieces of the iPhone harness: device profile, launch, process memory sampling, in-page GPU accounting.
import { webkit, chromium } from '../lib/browser.mjs';
import { execFile, execSync } from 'child_process';
import { promisify } from 'util';
const run = promisify(execFile);

// iPhone 12 / 12 Pro / 13 in landscape: 844x390 CSS px at 3x, touch only
export const IPHONE12 = {
  viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};
export const IPHONE12_PORTRAIT = { ...IPHONE12, viewport: { width: 390, height: 844 } };

export async function launch(engine = 'webkit', { exclusive = true, device = IPHONE12, ramMB = +(process.env.VC_RAM_MB || 0) } = {}) {
  const B = engine === 'webkit' ? webkit : chromium;
  const args = engine === 'chromium' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] : [];
  // WebKit: make JavaScriptCore size its heap and GC cadence for a phone (JSC's forceRAMSize testing option, handed to
  // the WebContent XPC service via launchd's __XPC_ environment prefix)
  const env = engine === 'webkit' && ramMB ? { ...process.env, __XPC_JSC_forceRAMSize: String(ramMB * 1048576) } : undefined;
  const browser = await B.launch({ headless: true, exclusive, args, env });
  const ctx = await browser.newContext(device);
  const page = await ctx.newPage();
  return { browser, ctx, page, engine };
}

/** WebKit's low-memory handler (GC + cache purge), the same thing iOS triggers as a tab nears its limit: lets a
 * reading show live memory rather than garbage still waiting for collection. Global: harness runs are exclusive. */
export async function webkitPurge(ms = 1800) {
  try { await run('notifyutil', ['-p', 'org.WebKit.lowMemory']); } catch { }
  await new Promise(r => setTimeout(r, ms));
  try { await run('notifyutil', ['-p', 'org.WebKit.lowMemory.end']); } catch { }
}

/** phys_footprint (what iOS jetsam counts) of a process, in MB */
export async function footprintMB(pid) {
  try {
    const { stdout } = await run('footprint', ['-p', String(pid)], { timeout: 4000 });
    const m = stdout.match(/Footprint:\s*([\d.]+)\s*(KB|MB|GB)/);
    if (!m) return null;
    return +m[1] * (m[2] === 'GB' ? 1024 : m[2] === 'KB' ? 1 / 1024 : 1);
  } catch { return null; }
}

/** the page's processes: WebKit = newest WebContent + GPU XPC services (run exclusive so they're ours);
 * Chromium = renderer + GPU from the browser's own process list */
export async function pagePids(h) {
  if (h.engine === 'webkit') {
    const newest = re => { try { return +execSync(`pgrep -n -f '${re}'`).toString().trim(); } catch { return null; } };
    return { content: newest('WebKit.WebContent.Development'), gpu: newest('WebKit.GPU.Development') };
  }
  const cdp = await h.ctx.browser().newBrowserCDPSession();
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  const pick = t => processInfo.filter(p => p.type === t).map(p => p.id);
  return { content: pick('renderer').pop(), gpu: pick('GPU').pop() };
}

/** samples footprints every `ms` until stop(); keeps the peak per process and a timeline */
export function sampleMemory(pids, ms = 700) {
  const s = { timeline: [], peak: { content: 0, gpu: 0, sum: 0 }, last: {}, mark: '' };
  let on = true;
  (async () => {
    const t0 = Date.now();
    while (on) {
      const [c, g] = await Promise.all([footprintMB(pids.content), pids.gpu ? footprintMB(pids.gpu) : 0]);
      if (c != null) {
        const sum = c + (g || 0);
        s.last = { content: c, gpu: g || 0, sum };
        s.peak.content = Math.max(s.peak.content, c); s.peak.gpu = Math.max(s.peak.gpu, g || 0); s.peak.sum = Math.max(s.peak.sum, sum);
        s.timeline.push([((Date.now() - t0) / 1000).toFixed(1), Math.round(c), Math.round(g || 0), s.mark]);
      }
      await new Promise(r => setTimeout(r, ms));
    }
  })();
  s.stop = () => { on = false; };
  return s;
}

/** in-page accounting of WebGL buffer / texture / renderbuffer bytes (live and peak) and WASM memory */
export const GPU_ACCOUNTING = () => {
  const M = window.__mem = { buf: 0, tex: 0, rb: 0, peak: 0, wasm: [] };
  const sizes = new WeakMap();
  const BPP = { 0x8058: 4, 0x881A: 8, 0x8814: 16, 0x822F: 4, 0x8230: 8, 0x822D: 2, 0x822E: 4, 0x8229: 1, 0x822B: 2, 0x8C43: 4, 0x81A5: 2, 0x81A6: 4, 0x8CAC: 4, 0x88F0: 4, 0x8CAD: 8, 0x8C3A: 4, 0x8051: 3, 0x8881: 6, 0x8815: 12, 0x1908: 4, 0x1907: 3, 0x1909: 1, 0x190A: 2, 0x1906: 1, 0x93B0: 1, 0x93D0: 1, 0x9274: 0.5, 0x9278: 1, 0x83F0: 0.5, 0x83F3: 1 };
  const P = WebGL2RenderingContext.prototype;
  const bound = new WeakMap(); const B = gl => bound.get(gl) || (bound.set(gl, {}), bound.get(gl));
  const set = (obj, kind, n) => { if (!obj) return; const o = sizes.get(obj); const old = o?.n || 0; M[kind] += n - old; sizes.set(obj, { n, kind }); const t = M.buf + M.tex + M.rb; if (t > M.peak) M.peak = t; };
  const wrap = (name, fn) => { const o = P[name]; if (!o) return; P[name] = function (...a) { try { fn.call(this, ...a); } catch { } return o.apply(this, a); }; };
  const texTarget = t => (t >= 0x8515 && t <= 0x851A) ? 0x8513 : t;
  wrap('bindBuffer', function (t, b) { B(this)['b' + t] = b; });
  wrap('bufferData', function (t, d) { set(B(this)['b' + t], 'buf', typeof d === 'number' ? d : d?.byteLength || 0); });
  wrap('bindTexture', function (t, x) { B(this)['t' + t] = x; });
  const mipSum = (w, h, lv, d = 1) => { let n = 0; for (let i = 0; i < lv; i++) n += Math.max(1, w >> i) * Math.max(1, h >> i) * d; return n; };
  wrap('texStorage2D', function (t, lv, f, w, h) { set(B(this)['t' + t], 'tex', mipSum(w, h, lv) * (BPP[f] || 4) * (t === 0x8513 ? 6 : 1)); });
  wrap('texStorage3D', function (t, lv, f, w, h, d) { set(B(this)['t' + t], 'tex', mipSum(w, h, lv, d) * (BPP[f] || 4)); });
  wrap('texImage2D', function (t, lv, f, w, h) { if (lv !== 0) return; if (typeof w !== 'number') { const src = arguments[5]; w = src?.width || src?.videoWidth || 0; h = src?.height || src?.videoHeight || 0; } const x = B(this)['t' + texTarget(t)]; const per = w * h * (BPP[f] || 4) * 1.33; if (texTarget(t) === 0x8513) { const o = sizes.get(x); set(x, 'tex', (o && o.cube !== undefined ? o.n : 0) + per); sizes.get(x).cube = 1; } else set(x, 'tex', per); });
  wrap('compressedTexImage2D', function (t, lv, f, w, h, b, data) { if (lv === 0) set(B(this)['t' + texTarget(t)], 'tex', (data?.byteLength || 0) * 1.33); });
  wrap('texImage3D', function (t, lv, f, w, h, d) { if (lv === 0) set(B(this)['t' + t], 'tex', w * h * d * (BPP[f] || 4)); });
  wrap('bindRenderbuffer', function (t, r) { B(this).rb = r; });
  wrap('renderbufferStorage', function (t, f, w, h) { set(B(this).rb, 'rb', w * h * (BPP[f] || 4)); });
  wrap('renderbufferStorageMultisample', function (t, s, f, w, h) { set(B(this).rb, 'rb', w * h * (BPP[f] || 4) * Math.max(1, s)); });
  for (const [n, k] of [['deleteBuffer', 'buf'], ['deleteTexture', 'tex'], ['deleteRenderbuffer', 'rb']]) wrap(n, function (x) { const o = x && sizes.get(x); if (o) { M[o.kind] -= o.n; sizes.delete(x); } });
  for (const k of ['instantiate', 'instantiateStreaming']) { const oi = WebAssembly[k]; if (!oi) continue; WebAssembly[k] = async function (...a) { const r = await oi.apply(this, a); const ex = (r.instance || r).exports; for (const v of Object.values(ex)) if (v instanceof WebAssembly.Memory) M.wasm.push(v); return r; }; }
};
export const readGpu = page => page.evaluate(() => { const M = window.__mem; const mb = n => Math.round(n / 1048576); return M ? { buffers: mb(M.buf), textures: mb(M.tex), renderbuffers: mb(M.rb), gpuPeak: mb(M.peak), wasm: mb(M.wasm.reduce((a, m) => a + m.buffer.byteLength, 0)), jsHeap: performance.memory ? mb(performance.memory.usedJSHeapSize) : null } : null; });
