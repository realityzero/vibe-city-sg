// Runtime-built voice lines: load the game with VO, run the kopi / pitch / term-sheet minigames for a bit and Claudia's
// time/spawn/teleport replies, and report every say() call — voiced (take found) or missing — plus page errors.
//   node tests/scratch/vodyn.mjs
import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/AudioContext|PCFSoftShadowMap/.test(m.text())) errors.push(m.text()); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&q=low', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.evaluate(async () => {
  const g = __game; await g.initAudio(); await g.audio.voice.vo.load();
  const said = window.__said = [];
  const say = g.audio.say.bind(g.audio);
  g.audio.say = (text, opts = {}) => { said.push({ role: opts.voice, text, vo: g.audio.voice.hasVO(opts.voice, text) }); return say(text, opts); };
});
// start a minigame, press keys on a schedule ([ms, key] repeating every `every` ms), then abort it
async function run(mod, fn, opts, ms, keys = [], every = 3000) {
  await page.evaluate(async ([mod, fn, opts]) => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const ac = new AbortController(); window.__mg = { root, ac };
    const m = await import(mod);
    window.__mg.p = m[fn](root, { ...opts, audio: __game.audio, signal: ac.signal }).catch(e => String(e));
  }, [mod, fn, opts]);
  await page.waitForTimeout(1500); await page.keyboard.press('Enter');
  for (let t = 1500; t < ms; t += every) { for (const k of keys) { await page.keyboard.press(k); await page.waitForTimeout(150); } await page.waitForTimeout(every); }
  await page.evaluate(async () => { const { root, ac, p } = window.__mg; ac.abort(); await Promise.race([p, new Promise(r => setTimeout(r, 1000))]); root.remove(); __game.audio.voice.stopDialogue(); });
}
await run('/src/ui/minigames/kopi.js', 'runKopiOrder', { round: 3, duration: 60 }, 45000, ['Tab', 'KeyQ', 'Space'], 4000);
await run('/src/ui/minigames/pitch.js', 'runPitch', { users: 2731 }, 60000, ['Space', 'Digit1'], 1500);
await run('/src/ui/minigames/negotiation.js', 'runNegotiation', {}, 30000, ['Digit1', 'Enter'], 2500);
const claudia = await page.evaluate(async () => {
  const v = await import('/src/missions/vodyn.js'), vo = __game.audio.voice;
  const places = __game.claudia.places().map(p => p.name);
  const t = [['claudia', v.claudiaTimeSpeak(19, 22)], ['claudia', v.claudiaTimeSpeak(23, 53)], ['claudia', v.claudiaSpawnSpeak(7, 'taxi')], ['claudia', v.claudiaSpawnSpeak(1, 'mpv')],
    ['claudia', v.claudiaTeleportSpeak(places[3])], ['claudia', v.claudiaAutopilotSpeak(places.at(-1))], ['tommy', v.negoTermsSpeak(13.5e6, 87e6, 2)], ['tommy', v.negoUsersSpeak(1500)],
    ['tommy', v.pitchSlideSpeak(2731)], ['priya', v.pitchPriyaSpeak(2731)], ['tommy', v.pitchWauSpeak(2731)], ['mrtan', v.tanDealLines(13.5e6, 100.5e6).map(l => l.text)]]
    .flatMap(([r, x]) => [].concat(x).map(y => [r, y]));
  return t.map(([role, x]) => ({ role, text: x, vo: vo.hasVO(role, x), d: vo.lineDuration(role, x) }));
});
await page.evaluate(async () => { for (const p of ['time 19:22', 'spawn 3 taxis', 'take me to the Merlion', 'make it rain']) { __game.claudia.prompt(p); await new Promise(r => setTimeout(r, 6000)); } });
const said = await page.evaluate(() => window.__said);
const missing = await page.evaluate(() => window.__voMissing || []);
await browser.close();
for (const s of said) console.log(s.vo ? 'VO ' : '-- ', s.role, '|', s.text);
for (const s of claudia) console.log(s.vo ? 'VO ' : '-- ', s.role, '|', s.text, s.d);
console.log(`say() calls ${said.length}, voiced ${said.filter(s => s.vo).length}; noteMissing ${missing.length}`, JSON.stringify(missing.slice(0, 12)));
console.log('errors:', errors.length, errors.slice(0, 5));
