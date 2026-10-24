// Render voice-over takes with Microsoft Edge's neural TTS (the Read Aloud voices), via the edge-tts CLI.
//   node tools/vo/gen-edge.mjs [--kinds bark,radio,...] [--limit N] [--dry]
// Reads tools/vo/script.json (tools/vo/extract.mjs), renders every non-story line (story lines are the VO-CAST job),
// trims silence + loudness-normalises with ffmpeg, writes public/vo/<key>[_a|_b|_c].mp3 and public/vo/manifest.edge.json.
// Voices come from src/audio/cast.js (VOICE_CAST; radio lines use DJ_BY_STATION). Street barks get three takes from
// the role's voice family so a crowd doesn't repeat one voice. A content hash (voice+prosody+spoken text) per file
// in tools/vo/edge-cache.json skips work that's already done. The endpoint rate-limits: 3 at a time, backoff on errors.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { VOICE_CAST, DJ_BY_STATION } from '../../src/audio/cast.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'public/vo'), TMP = '/tmp/vc-tts/work';
const EDGE = process.env.EDGE_TTS || '/tmp/vc-tts/bin/edge-tts';
const args = process.argv.slice(2), opt = n => { const i = args.indexOf('--' + n); return i < 0 ? null : args[i + 1] ?? true; };
const KINDS = (opt('kinds') || 'bark,bubble,radio,minigame,claudia,npc,announce').split(','); // phone calls + mission dialogue: VO-CAST
const LIMIT = +(opt('limit') || Infinity), DRY = !!opt('dry'), CONC = +(opt('conc') || 3);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(TMP, { recursive: true });

// ---- how a line should be *said* (keys/subtitles keep the original text) -------------------------------------------
const ACRO = ['AI', 'AGI', 'ARR', 'COE', 'CPF', 'CTE', 'PIE', 'ECP', 'ERP', 'HDB', 'IPO', 'KYC', 'LTA', 'MRT', 'NPS', 'PSI', 'SPF', 'VC', 'VCs', 'VCPR', 'GPS', 'MVP', 'SLA', 'TAM', 'NSF', 'CEO', 'CTO', 'BTO', 'IC', 'SG', 'UX', 'API', 'APIs', 'QR', 'LTD', 'GP', 'MC', 'VPU', 'KPI'];
// shouted words that are real words, not initialisms (everything else in caps with 2-3 letters is spelled out)
const WORDS = new Set(['HAS', 'NOT', 'YOU', 'ON', 'DAY', 'OUT', 'AND', 'NOW', 'ALL', 'NO', 'GO', 'THE', 'WHY', 'BRO', 'YES', 'WAH', 'LAH']);
const SPELL = { VCs: 'V.C.s', APIs: 'A.P.I.s', OK: 'okay', SEA: 'South-East Asia', VCPR: 'V.C.P.R.', 'Web3': 'web three', F1: 'F-one', Q3: 'Q-three', TAM: 'tam' };
function speakable(t) {
  let s = String(t);
  s = s.replace(/<[^>]*>/g, '');
  s = s.replace(/\*[^*]{1,60}\*/g, ' ');                                  // stage directions
  s = s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '');   // emoji
  s = s.replace(/…/g, '... ').replace(/—/g, ', ').replace(/–/g, ', ');
  // money: S$ 5M, S$4.50, S$500, S$ 0.30
  s = s.replace(/S\$\s?(\d+(?:\.\d+)?)\s?([MBK])\b/g, (_, n, u) => `${n} ${{ M: 'million', B: 'billion', K: 'thousand' }[u]} dollars`);
  s = s.replace(/S\$\s?0\.(\d\d)\b/g, (_, c) => `${+c} cents`);
  s = s.replace(/S\$\s?(\d+)\.(\d\d)\b/g, (_, d, c) => `${d} dollars ${+c}`);
  s = s.replace(/S\$\s?(\d[\d,]*)/g, (_, n) => `${n} dollars`);
  s = s.replace(/\b(\d+(?:\.\d+)?)M\b/g, '$1 million').replace(/\b(\d+)k\b/g, '$1 thousand');
  s = s.replace(/(\d)\s?×/g, '$1 times').replace(/\b(\d+)x\b/g, '$1 times').replace(/×/g, ' times ');
  s = s.replace(/\bMoM\b/g, 'month on month').replace(/\bN95\b/g, 'N-95');
  // spaced capitals (the old speechSynthesis workaround: "V C P R", "M R T") -> one dotted acronym
  s = s.replace(/\b([A-Z])((?: [A-Z]\b)+)/g, (m, a, rest) => (a + rest).split(' ').join('.') + '.');
  // acronyms read as letters; other ALL-CAPS words are shouting: say them as words (some engines spell caps)
  s = s.replace(/\b[A-Za-z0-9]*[A-Z][A-Za-z0-9]*\b/g, w => {
    if (SPELL[w]) return SPELL[w];
    if (ACRO.includes(w)) return w.length <= 4 && /^[A-Z]+$/.test(w) ? w.split('').join('.') + '.' : w;
    if (/^[A-Z]{2,3}$/.test(w) && !WORDS.has(w)) return w.split('').join('.') + '.';
    if (/^[A-Z]{2,}$/.test(w)) return w[0] + w.slice(1).toLowerCase();
    return w;
  });
  s = s.replace(/([A-Z])\.\.(?!\.)/g, '$1.').replace(/\.{4,}/g, '...').replace(/\s+([,.!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
  return s;
}
export { speakable };

// ---- casting --------------------------------------------------------------------------------------------------------
const TAKES = { bark: 3, bubble: 2 };
function voicesFor(l) {
  const c = VOICE_CAST[l.role] || VOICE_CAST.male;
  if (l.kind === 'radio' && l.station && DJ_BY_STATION[l.station]) return [DJ_BY_STATION[l.station]];
  const n = TAKES[l.kind] || 1;
  return [c.edge, ...(c.takes || [])].slice(0, n);
}
const BITRATE = { bark: '40k', bubble: '40k', npc: '32k' };
const LOUD = { bark: -19, bubble: -19, npc: -18 };

// ---- process helpers -------------------------------------------------------------------------------------------------
const run = (cmd, a) => new Promise((res, rej) => { const p = spawn(cmd, a, { stdio: ['ignore', 'ignore', 'pipe'] }); let err = ''; p.stderr.on('data', d => { err += d; }); p.on('close', code => code === 0 ? res() : rej(new Error(`${cmd} ${code}: ${err.slice(-300)}`))); });
const probe = f => new Promise(res => { const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]); let o = ''; p.stdout.on('data', d => { o += d; }); p.on('close', () => res(+(+o).toFixed(3))); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function render(text, v, file, kind) {
  const raw = path.join(TMP, path.basename(file) + '.raw.mp3');
  for (let attempt = 0; ; attempt++) {
    try {
      await run(EDGE, ['--voice', v.voice, `--rate=${v.rate || '+0%'}`, `--pitch=${v.pitch || '+0Hz'}`, `--volume=${v.volume || '+0%'}`, '--text', text, '--write-media', raw]);
      if (!fs.existsSync(raw) || fs.statSync(raw).size < 800) throw new Error('empty audio');
      break;
    } catch (e) {
      if (attempt >= 5) throw e;
      await sleep(2000 * 2 ** attempt + Math.random() * 1000);
    }
  }
  // trim leading/trailing silence, short fades (no clicks), loudness-normalise, mono 24 kHz mp3
  const af = 'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.08,areverse,'
    + `afade=t=in:d=0.015,loudnorm=I=${LOUD[kind] ?? -16}:TP=-1.5:LRA=11`;
  await run('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-af', af, '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', BITRATE[kind] || '48k', file]);
  fs.rmSync(raw, { force: true });
  return probe(file);
}

// ---- main ------------------------------------------------------------------------------------------------------------
const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/vo/script.json'), 'utf8'));
const cachePath = path.join(ROOT, 'tools/vo/edge-cache.json');
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
const manPath = path.join(OUT, 'manifest.edge.json');
const man = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : { v: 1, lines: {} };

// one job per (key, take); a key can appear under several kinds (e.g. bark + bubble): first kind wins.
// The story cast (mission dialogue, phone calls, their minigame lines) is VO-CAST's: skip those roles and anything
// already in its manifest — except Claudia's prompt replies, which only this generator covers.
const STORY_ROLES = new Set(['tommy', 'ken', 'lance', 'kyle', 'priya', 'chad', 'mrtan', 'auntiemei', 'ahseng', 'sonny', 'jasmine', 'scout', 'mc']);
const storyMan = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.story.json'), 'utf8')).lines || {}; } catch { return {}; } })();
const jobs = [], byKey = new Map();
for (const l of script.lines) {
  if (l.kind === 'story' || l.kind === 'phone' || STORY_ROLES.has(l.role) || storyMan[l.key] || !KINDS.includes(l.kind) || byKey.has(l.key)) continue;
  const say = speakable(l.text); if (!say) continue;
  const vs = voicesFor(l);
  byKey.set(l.key, { l, vs, say });
  vs.forEach((v, i) => jobs.push({ key: l.key, i, v, say, kind: l.kind, file: path.join(OUT, `${l.key}${vs.length > 1 ? '_' + 'abc'[i] : ''}.mp3`) }));
}
const todo = jobs.filter(j => { const h = crypto.createHash('sha1').update(JSON.stringify([j.v, j.say, LOUD[j.kind], BITRATE[j.kind]])).digest('hex').slice(0, 12); j.h = h; return !(fs.existsSync(j.file) && cache[path.basename(j.file)]?.h === h); }).slice(0, LIMIT);
console.log(`${byKey.size} lines, ${jobs.length} takes, ${todo.length} to render (${todo.reduce((s, j) => s + j.say.length, 0)} chars)`);
if (DRY) { for (const j of todo.slice(0, 40)) console.log(`  ${j.v.voice.padEnd(30)} ${JSON.stringify(j.say).slice(0, 100)}`); process.exit(0); }

let done = 0, failed = 0;
const saveAll = () => {
  for (const [key, { l, vs }] of byKey) {
    const files = vs.map((_, i) => `${key}${vs.length > 1 ? '_' + 'abc'[i] : ''}.mp3`).filter(f => cache[f]);
    if (!files.length) continue;
    man.lines[key] = { f: files, d: files.map(f => cache[f].d), e: 'edge', voice: vs[0].voice, role: l.role, kind: l.kind, t: l.text };
  }
  fs.writeFileSync(cachePath, JSON.stringify(cache));
  fs.writeFileSync(manPath, JSON.stringify(man));
};
let next = 0;
async function worker() {
  while (next < todo.length) {
    const j = todo[next++];
    try {
      const d = await render(j.say, j.v, j.file, j.kind);
      cache[path.basename(j.file)] = { h: j.h, d, voice: j.v.voice };
    } catch (e) { failed++; console.error('FAIL', j.key, j.v.voice, e.message.slice(0, 160)); }
    if (++done % 25 === 0) { saveAll(); console.log(`  ${done}/${todo.length} (${failed} failed)`); }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
saveAll();
console.log(`done: ${done - failed} rendered, ${failed} failed; manifest.edge.json has ${Object.keys(man.lines).length} lines`);
