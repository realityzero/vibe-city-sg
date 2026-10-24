// Render every runtime-built spoken line (numbers, place names, kopi orders) offline with Microsoft Edge's neural
// voices, so the game never needs a TTS service: the finite sets come from src/missions/vodyn.js and
// src/ui/minigames/kopi-lingo.js (the same builders the game calls). Writes public/vo/<key>.mp3 and
// public/vo/manifest.dyn.json (merged by build-manifest.mjs).
//   node tools/vo/dump-places.mjs     # once the world exists: Claudia's place names -> tools/vo/places.json
//   node tools/vo/gen-dyn.mjs [--force] [--only=kopi,tan,...] [--list]
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { VOICE_CAST } from '../../src/audio/cast.js';
import { voKey } from '../../src/audio/vokey.js';
import * as D from '../../src/missions/vodyn.js';
import { allOrders, nameTerms, englishParts, LINES, reactionLines } from '../../src/ui/minigames/kopi-lingo.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const EDGE = process.env.EDGE_TTS || (fs.existsSync(ROOT + 'tools/vo/.venv/bin/edge-tts') ? ROOT + 'tools/vo/.venv/bin/edge-tts' : '/tmp/vc-tts/bin/edge-tts');
const OUT = ROOT + 'public/vo/', TMP = '/tmp/vc-tts/dyn/';
const CONC = 3;
const force = process.argv.includes('--force'), listOnly = process.argv.includes('--list');
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(TMP, { recursive: true });

// voices: the cast, plus a male tourist for the Kopi Uncle queue (the cast's tourist role is a woman)
const VOICE = role => role === 'touristm' ? { voice: 'en-US-ChristopherNeural', rate: '+4%', pitch: '+0Hz', volume: '+0%' } : VOICE_CAST[role]?.edge;

// ---- what the voice says (keys keep the game's text; this is only the TTS input)
const millions = v => { const m = v / 1e6; return `${Number.isInteger(m) ? m : m.toFixed(1)} million`; };
function speakable(t) {
  return t
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/…/g, '... ')
    .replace(/\s*—\s*$/, '...')
    .replace(/S\$ ?([\d.]+)M\b/g, (_, n) => `${n} million dollars`)
    .replace(/S\$([\d,]+)/g, (_, n) => { const v = +n.replace(/,/g, ''); return v === 0 ? 'zero dollars' : v >= 1e6 ? `${millions(v)} dollars` : `${n} dollars`; })
    .replace(/@/g, ' at ').replace(/&/g, ' and ').replace(/\bMRT\b/g, 'M.R.T.').replace(/\bCOLLECTION\b/g, 'Collection')
    .replace(/\bPARKROYAL\b/g, 'Parkroyal').replace(/\bOCBC\b/g, 'O.C.B.C.').replace(/\bMOUNTAIN\b/g, 'mountain')
    .replace(/\bWehustle\b/g, 'WeHustle')
    .replace(/(^|\s)-([OC])\b/g, '$1$2').replace(/\b(\w+)\/(\w+)\b/g, '$1 or $2').replace(/\b[A-Z]{4,}\b/g, w => w[0] + w.slice(1).toLowerCase()).replace(/—/g, ', ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim();
}

// ---- the finite sets
const L = new Map(); // key -> { key, role, text, speak, kind, kbps }
// 32 kbps mono: hundreds of short variants, so they stay small (story-cast lines match the story cast at 48)
const add = (kind, role, text, speak = speakable(text), kbps = 32) => {
  const key = voKey(role, text);
  if (!L.has(key)) L.set(key, { key, role, text, speak, kind, kbps });
};
const addAll = (kind, role, v) => { for (const t of [].concat(v)) add(kind, role, t); }; // a line or sentences played back to back
const sweepUsers = fn => { const s = new Map(); for (const u of [...Array(6001).keys(), 99999]) { const v = fn(u); s.set(String(v), v); } return [...s.values()]; };

// pitch + term sheet: user counts
for (const t of sweepUsers(D.pitchSlideSpeak)) addAll('pitch', 'tommy', t);
for (const t of sweepUsers(D.pitchPriyaSpeak)) addAll('pitch', 'priya', t);
for (const t of sweepUsers(D.pitchWauSpeak)) addAll('pitch', 'tommy', t);
for (const t of sweepUsers(D.negoUsersSpeak)) addAll('nego', 'tommy', t);
// Tommy's terms: amount / pre-money / board seats
for (const r of D.RAISE_VALUES) { const [a] = D.negoTermsSpeak(r, 10e6, 0); add('terms', 'tommy', a, `${millions(r)} dollars,`); }
for (const p of D.PRE_VALUES) { const [, b] = D.negoTermsSpeak(2e6, p, 0); add('terms', 'tommy', b, `at ${millions(p)} pre.`); }
for (const n of D.BOARD_VALUES) { const [, , c] = D.negoTermsSpeak(2e6, 10e6, n); add('terms', 'tommy', c); }
// Mr. Tan closes: raised / post-money / welcome
for (const r of D.RAISE_VALUES) add('tan', 'mrtan', D.tanDealLines(r, 12e6)[0].text);
for (const v of D.POST_VALUES) add('tan', 'mrtan', D.tanDealLines(2e6, v)[1].text, `At ${millions(v)} post-money.`); // deal-speak: "at 100.5 million post-money"
add('tan', 'mrtan', D.tanDealLines(2e6, 12e6)[2].text);
// Claudia: time travel, spawns, places
for (const [h, m] of D.CLAUDIA_TIMES) addAll('claudia', 'claudia', D.claudiaTimeSpeak(h, m));
for (const type of D.SPAWN_TYPES) for (let n = 1; n <= 12; n++) addAll('claudia', 'claudia', D.claudiaSpawnSpeak(n, type));
const places = fs.existsSync(ROOT + 'tools/vo/places.json') ? JSON.parse(fs.readFileSync(ROOT + 'tools/vo/places.json', 'utf8')) : [];
if (!places.length) console.warn('tools/vo/places.json missing: run node tools/vo/dump-places.mjs (needs the dev server)');
for (const p of places) { addAll('claudia', 'claudia', D.claudiaAutopilotSpeak(p)); addAll('claudia', 'claudia', D.claudiaTeleportSpeak(p)); }
// Kopi Uncle: order terms / English phrases per customer voice, intros, VIP lines
const KOPI_LINGO_ROLES = ['auntie', 'uncle', 'tourist', 'touristm'], KOPI_EN_ROLES = ['tourist', 'touristm'];
const VIP = { priya: { base: 'teh', milk: 'none', sugar: 0 }, chad: { base: 'kopi', milk: 'none', strength: 'gao', ice: true }, auntiemei: { base: 'kopi', strength: 'gao', sugar: 1 }, ken: { base: 'kopi', milk: 'evap', sugar: 3, dabao: true } };
const fresh = () => ({ base: null, milk: 'condensed', sugar: 2, strength: 'normal', ice: false, extra: 'none', dabao: false });
const termSet = new Set(), phraseSet = new Set();
for (const d of allOrders()) { for (const t of nameTerms(d)) termSet.add(t); for (const p of englishParts(d)) phraseSet.add(p); }
const kopiTerms = (role, terms) => { for (const t of terms) for (const end of [false, true]) add('kopi', role, D.kopiTermKey(t, end), D.kopiTermSpeak(t, end), 32); };
const kopiPhrases = (role, parts) => { for (const p of parts) for (const end of [false, true]) add('kopi', role, D.kopiPhraseKey(p, end), speakable(D.kopiPhraseSpeak(p, end)), 32); };
for (const r of KOPI_LINGO_ROLES) kopiTerms(r, termSet);
for (const r of KOPI_EN_ROLES) kopiPhrases(r, phraseSet);
for (const [role, fixed] of Object.entries(VIP)) { const d = Object.assign(fresh(), fixed); kopiTerms(role, nameTerms(d)); kopiPhrases(role, englishParts(d)); }
// reactions in the customer's own voice (VIPs have their own perfect-drink line, below)
for (const r of [...KOPI_LINGO_ROLES, ...Object.keys(VIP)]) for (const t of reactionLines()) if (!(r in VIP) || !LINES.perfect.includes(t)) add('kopi', r, t, speakable(t), 32);
add('kopi', 'touristm', 'Uh, hi! I don\'t know the words, sorry —');
add('kopi', 'tourist', 'Hello! Can I get —');
// story-cast lines the other generators missed (Kopi VIP intros + perfect-drink lines, a Priya pitch reaction)
for (const [role, t] of [['priya', 'I\'m watching my burn rate.'], ['chad', 'Do you have oat milk? No? Cool, cool. Just —'], ['auntiemei', 'Faster ah, I\'m an investor.'], ['ken', 'TOMMY?! You work here now?! Okay, okay —'],
  ['chad', 'Bro. This is better than Blue Bottle.'], ['ken', 'Tommy, this is the best thing that\'s happened to me all week.'], ['priya', 'Precise. I like precise.'], ['auntiemei', 'Good. Now go back to your startup.'],
  ['priya', 'Retention. Real retention. Good.']]) add('story', role, t, speakable(t.replace(/\bTOMMY\b/g, 'Tommy')), 48);

// lines another generator already voices (story cast / edge manifests) are left to it
const others = new Set(['manifest.story.json', 'manifest.edge.json'].flatMap(f => fs.existsSync(OUT + f) ? Object.keys(JSON.parse(fs.readFileSync(OUT + f, 'utf8')).lines || {}) : []));
for (const k of [...L.keys()]) if (others.has(k)) L.delete(k);
const lines = [...L.values()].filter(l => !only.length || only.includes(l.kind));
const byKind = {}; for (const l of lines) byKind[l.kind] = (byKind[l.kind] || 0) + 1;
console.log(`${lines.length} dynamic lines`, JSON.stringify(byKind));
if (listOnly) { for (const l of lines) console.log(l.kind, l.role, '|', l.text, '=>', l.speak); process.exit(0); }

// ---- render (same post as the other generators: trim, loudness, mono speech mp3)
const manPath = OUT + 'manifest.dyn.json';
const man = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : { v: 1, lines: {} };
const run = (cmd, args) => new Promise((res, rej) => {
  const p = spawn(cmd, args); let err = '', out = '';
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
  p.on('close', c => c === 0 ? res(out) : rej(new Error(`${cmd} ${c}: ${err.slice(-300)}`)));
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function render(l) {
  const c = VOICE(l.role); if (!c) throw new Error('no voice for ' + l.role);
  const sig = `${c.voice}|${c.rate}|${c.pitch}|${c.volume}|${l.kbps}|${l.speak}`;
  const file = `${l.key}.mp3`;
  if (!force && man.lines[l.key]?.sig === sig && fs.existsSync(OUT + file)) return 'cached';
  // Edge's output is kept (by voice + text) so re-encoding at another bitrate / loudness doesn't call Edge again
  const raw = TMP + crypto.createHash('sha1').update(`${c.voice}|${c.rate}|${c.pitch}|${c.volume}|${l.speak}`).digest('hex').slice(0, 16) + '.raw.mp3';
  const haveRaw = () => fs.existsSync(raw) && fs.statSync(raw).size >= 1200;
  for (let attempt = 0; !haveRaw(); attempt++) {
    try {
      await run(EDGE, ['--voice', c.voice, `--rate=${c.rate}`, `--pitch=${c.pitch}`, `--volume=${c.volume}`, '--text', l.speak, '--write-media', raw + '.part']);
      if (fs.statSync(raw + '.part').size < 1200) throw new Error('empty audio');
      fs.renameSync(raw + '.part', raw); // only complete responses are kept
    } catch (e) { if (attempt >= 5) throw e; await sleep(1500 * 2 ** attempt + Math.random() * 500); }
  }
  // kopi clips are joined back to back at runtime: keep only a hair of silence at their ends
  const tail = l.kind === 'kopi' ? 0.03 : 0.12;
  const lufs = l.kind === 'kopi' ? -18 : -16;
  const af = `silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.03,areverse,silenceremove=start_periods=1:start_threshold=-48dB:start_silence=${tail},areverse,loudnorm=I=${lufs}:TP=-1.5:LRA=11`;
  await run('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-af', af, '-ac', '1', '-ar', '24000', '-b:a', `${l.kbps}k`, OUT + file]);
  const d = parseFloat(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT + file]));
  man.lines[l.key] = { f: [file], d: [Math.round(d * 1000) / 1000], e: 'edge', voice: c.voice, role: l.role, t: l.text, kind: l.kind === 'story' ? 'story' : 'dyn-' + l.kind, sig };
  return 'ok';
}
let i = 0, done = 0, rendered = 0; const failed = [];
const worker = async () => {
  while (i < lines.length) {
    const l = lines[i++];
    try { const r = await render(l); done++; if (r === 'ok') { rendered++; await sleep(120); } if (done % 50 === 0) { console.log(`${done}/${lines.length}`); fs.writeFileSync(manPath, JSON.stringify(man)); } }
    catch (e) { failed.push([l.key, l.role, l.text, e.message]); }
  }
};
await Promise.all(Array.from({ length: CONC }, worker));
if (!only.length) { const keep = new Set([...L.keys()]); for (const k of Object.keys(man.lines)) if (!keep.has(k)) { if (!others.has(k)) fs.rmSync(OUT + man.lines[k].f[0], { force: true }); delete man.lines[k]; } }
fs.writeFileSync(manPath, JSON.stringify(man));
const bytes = Object.values(man.lines).reduce((a, x) => a + (fs.existsSync(OUT + x.f[0]) ? fs.statSync(OUT + x.f[0]).size : 0), 0);
console.log(`done ${done}/${lines.length} (${rendered} rendered), failed ${failed.length}, manifest.dyn ${Object.keys(man.lines).length} lines, ${(bytes / 1e6).toFixed(2)} MB`);
if (failed.length) console.log(JSON.stringify(failed.slice(0, 10), null, 1));
