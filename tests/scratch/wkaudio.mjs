// WebKit page footprint at the start of the world load, with and without Web Audio (and with reverbs stubbed out)
import { launch, pagePids, footprintMB, webkitPurge } from '../mobile/lib.mjs';
const variants = { audio: null, noaudio: () => { delete window.AudioContext; delete window.webkitAudioContext; }, noconv: () => { const P = BaseAudioContext.prototype; P.createConvolver = function () { return this.createGain(); }; } };
for (const [name, init] of Object.entries(variants)) {
  const h = await launch('webkit');
  if (init) await h.page.addInitScript(init);
  await h.page.goto('http://127.0.0.1:4173/?skipTitle&newgame&memmarks=200000', { waitUntil: 'commit' });
  const pids = await pagePids(h);
  await h.page.waitForFunction(() => window.__memMark === 'start' && (window.__game?.audio || !window.AudioContext || 1), null, { timeout: 60000 });
  await h.page.waitForTimeout(6000); await webkitPurge(2500);
  console.log(name.padEnd(8), 'page', Math.round(await footprintMB(pids.content)), 'gpu', Math.round(await footprintMB(pids.gpu)), 'audio', await h.page.evaluate(() => !!__game.audio));
  await h.browser.close();
}
