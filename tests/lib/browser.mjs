// Drop-in for `import { chromium, webkit } from 'playwright'` that rations headless browsers on this 8 GB M2.
// Every launch takes one of SLOTS lock directories under /tmp/vc-locks (mkdir is atomic); `exclusive: true`
// (frame-time / GPU measurements) takes all of them so nothing else renders meanwhile. Locks hold the owner's pid
// and are stolen if that process is gone. Released when the browser closes or the process exits.
import { chromium as pwChromium, webkit as pwWebkit } from 'playwright';
import fs from 'fs';
import os from 'os';
const DIR = '/tmp/vc-locks', SLOTS = 2;
fs.mkdirSync(DIR, { recursive: true });
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
function tryTake(i) {
  const d = `${DIR}/slot${i}`;
  try { fs.mkdirSync(d); fs.writeFileSync(`${d}/pid`, String(process.pid)); return d; } catch { }
  try { const pid = +fs.readFileSync(`${d}/pid`, 'utf8'); if (pid && !alive(pid)) { fs.rmSync(d, { recursive: true, force: true }); return tryTake(i); } } catch { }
  return null;
}
const held = new Set();
const release = () => { for (const d of held) fs.rmSync(d, { recursive: true, force: true }); held.clear(); try { if (+fs.readFileSync(XW, 'utf8') === process.pid) fs.rmSync(XW, { force: true }); } catch { } };
process.on('exit', release);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { release(); process.exit(130); });
// an exclusive waiter leaves a marker so new shared launches queue behind it (otherwise it would starve)
const XW = `${DIR}/xwait`;
const xWaiting = () => { try { const pid = +fs.readFileSync(XW, 'utf8'); if (pid === process.pid) return false; if (pid && alive(pid)) return true; fs.rmSync(XW, { force: true }); } catch { } return false; };
async function acquire(exclusive) {
  const t0 = Date.now(); let said = false;
  if (exclusive) { while (xWaiting()) await new Promise(r => setTimeout(r, 1500)); fs.writeFileSync(XW, String(process.pid)); }
  for (;;) {
    if (!exclusive && xWaiting()) { await new Promise(r => setTimeout(r, 1500)); continue; }
    if (exclusive) {
      // take slots in order; give back what we got if we can't have all (avoids deadlock with other exclusive takers)
      const got = []; for (let i = 0; i < SLOTS; i++) { const d = tryTake(i); if (!d) break; got.push(d); }
      if (got.length === SLOTS) { got.forEach(d => held.add(d)); fs.rmSync(XW, { force: true }); return got; }
      got.forEach(d => fs.rmSync(d, { recursive: true, force: true }));
    } else {
      for (let i = 0; i < SLOTS; i++) { const d = tryTake(i); if (d) { held.add(d); return [d]; } }
    }
    if (!said && Date.now() - t0 > 3000) { said = true; console.error(`[browser-lock] waiting for a ${exclusive ? 'exclusive' : 'shared'} browser slot...`); }
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000));
  }
}
const rationed = pw => ({
  async launch({ exclusive = !!process.env.VC_EXCLUSIVE, ...opts } = {}) {
    const mine = await acquire(exclusive);
    const b = await pw.launch(opts);
    const close = b.close.bind(b);
    const free = () => { for (const d of mine) { fs.rmSync(d, { recursive: true, force: true }); held.delete(d); } };
    b.close = async (...a) => { try { return await close(...a); } finally { free(); } };
    b.on('disconnected', free);
    return b;
  },
});
export const chromium = rationed(pwChromium);
// Safari's engine (Playwright's WebKit build): closest thing to iOS Safari on a Mac. macOS 14 only gets a frozen
// WebKit build (r2251) that newer Playwright can't drive, so there it goes through playwright-core 1.59 (dev
// dependency alias pw-webkit-mac14), the last release that speaks its protocol.
const darwinMajor = os.platform() === 'darwin' ? +os.release().split('.')[0] : 0; // Darwin 23 = macOS 14
export const webkit = rationed(darwinMajor === 23 ? (await import('pw-webkit-mac14')).webkit : pwWebkit);
