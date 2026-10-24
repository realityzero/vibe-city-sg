// Voice-over runtime check: node tests/scratch/vocheck.mjs [vobase=vo]
// Loads the game, verifies the VO manifest loads, plays a story line, a phone line, a bark and a radio line from it
// (they must resolve with their real durations), skips a line (stopDialogue must end it at once), and checks that a
// line without a recording is subtitle-only (resolves at once, no speech engine) and lands in window.__voMissing.
// Fails on console errors.
import { chromium } from '../lib/browser.mjs';
const [vobase = 'vo'] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text().slice(0, 200)); });
await page.goto(`http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&q=low&vobase=${vobase}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
const r = await page.evaluate(async () => {
  const g = __game, A = g.audio, V = A.voice, vo = V.vo;
  if (!A.ctx) await A.init();
  await vo.load();
  const out = { ready: vo.ready, lines: vo.count, ctx: A.ctx?.state };
  if (!vo.ready) return out;
  const L = Object.values(vo.lines);
  const time = async (fn) => { const t0 = performance.now(); const used = { n: 0 }; const iv = setInterval(() => { if (vo.handles.size) used.n++; }, 50); await fn(); clearInterval(iv); return { s: +((performance.now() - t0) / 1000).toFixed(2), vo: used.n > 0 }; };
  const story = L.find(l => !['uncle', 'auntie', 'male', 'female', 'tourist', 'police', 'dj', 'sgdj', 'mrt'].includes(l.role));
  if (story) out.story = { role: story.role, d: story.d[0], ...(await time(() => A.say(story.t, { voice: story.role }))) };
  if (story) out.phone = { ...(await time(() => A.say(story.t, { voice: story.role, phone: true }))) };
  const bark = L.find(l => ['uncle', 'auntie', 'male', 'female', 'tourist', 'police'].includes(l.role));
  if (bark) {
    const kind = { uncle: 'hit', auntie: 'auntie', male: 'hit', female: 'hit', tourist: 'tourist', police: 'police' }[bark.role];
    const p = g.player.position, pos = { x: p.x + 3, y: 1.6, z: p.z };
    A._barkAt = 0; A._barkKindAt = {};
    out.bark = { role: bark.role, d: bark.d[0], ...(await time(async () => { out.barkSpoken = await A.bark(kind, { position: pos, voice: bark.role, text: bark.t }); })) };
  }
  const radio = L.find(l => l.role === 'dj' || l.role === 'sgdj');
  if (radio) {
    out.radio = { d: radio.d[0], ...(await time(async () => { const pr = V.sayRadio(radio.t, radio.role); setTimeout(() => V.cancelRadio(), 1200); await pr; })) };
  }
  const long = L.reduce((a, b) => (b.d[0] > (a?.d[0] || 0) && !['dj', 'sgdj'].includes(b.role) ? b : a), null);
  if (long) out.skip = { d: long.d[0], ...(await time(async () => { const pr = A.say(long.t, { voice: long.role }); setTimeout(() => V.stopDialogue(), 600); await pr; })) };
  out.fallback = await time(() => A.say('This line was never recorded by anyone.', { voice: 'tommy' }));
  out.missingLogged = (window.__voMissing || []).some(m => m.text === 'This line was never recorded by anyone.');
  out.synthUsed = !!V.synth;
  out.duckReleased = !V.dialogue;
  return out;
});
console.log(JSON.stringify(r, null, 1));
const fail = [];
if (!r.ready) fail.push('manifest did not load');
if (r.story && (!r.story.vo || Math.abs(r.story.s - r.story.d) > 0.6)) fail.push('story line did not play its take for its real duration');
if (r.bark && (!r.bark.vo || !r.barkSpoken)) fail.push('bark did not play its take');
if (r.radio && (!r.radio.vo || r.radio.s > 2)) fail.push('radio line did not play / cancel');
if (r.skip && r.skip.s > 1.2) fail.push('skipping a line did not stop it');
if (r.fallback.vo || r.fallback.s > 0.3 || r.synthUsed) fail.push('unrecorded line should be subtitle-only (no take, no speech engine)');
if (!r.missingLogged) fail.push('unrecorded line not logged to window.__voMissing');
if (errors.length) fail.push('console errors: ' + errors.slice(0, 3).join(' | '));
console.log(fail.length ? 'FAIL\n  ' + fail.join('\n  ') : 'OK');
await browser.close();
process.exit(fail.length ? 1 : 0);
