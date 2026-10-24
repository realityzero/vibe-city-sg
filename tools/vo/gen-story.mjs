// Render the story cast's lines with Microsoft Edge neural voices (edge-tts) into public/vo/<key>.mp3 and
// public/vo/manifest.story.json. Skips lines whose file exists and whose voice/prosody/text haven't changed.
//   node tools/vo/story-lines.mjs && node tools/vo/gen-story.mjs [--force] [--only=tommy,ken]
// Post-processing: trim leading/trailing silence, loudness-normalise to -16 LUFS, mono 24 kHz MP3 64 kbps.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { VOICE_CAST } from '../../src/audio/cast.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const EDGE = process.env.EDGE_TTS || '/tmp/vc-tts/bin/edge-tts';
const OUT = ROOT + 'public/vo/', TMP = '/tmp/vc-tts/story/';
const CONC = 3;
const force = process.argv.includes('--force');
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(TMP, { recursive: true });

const lines = JSON.parse(fs.readFileSync(ROOT + 'tools/vo/story-lines.json', 'utf8'));
const manPath = OUT + 'manifest.story.json';
const man = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : { v: 1, lines: {} };

const run = (cmd, args) => new Promise((res, rej) => {
  const p = spawn(cmd, args); let err = '', out = '';
  p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
  p.on('close', c => c === 0 ? res(out) : rej(new Error(`${cmd} ${c}: ${err.slice(-300)}`)));
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function render(l) {
  const c = VOICE_CAST[l.role]?.edge; if (!c) throw new Error('no cast for ' + l.role);
  const sig = `${c.voice}|${c.rate}|${c.pitch}|${c.volume}|${l.speak}`;
  const file = `${l.key}.mp3`;
  if (!force && man.lines[l.key]?.sig === sig && fs.existsSync(OUT + file)) return 'cached';
  const raw = TMP + l.key + '.raw.mp3';
  for (let attempt = 0; ; attempt++) {
    try {
      await run(EDGE, ['--voice', c.voice, `--rate=${c.rate}`, `--pitch=${c.pitch}`, `--volume=${c.volume}`, '--text', l.speak, '--write-media', raw]);
      if (fs.statSync(raw).size < 1500) throw new Error('empty audio');
      break;
    } catch (e) { if (attempt >= 4) throw e; await sleep(1500 * 2 ** attempt + Math.random() * 500); }
  }
  // trim silence at both ends, keep a short natural tail; -16 LUFS; mono speech-rate MP3
  const af = 'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.04,areverse,silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.12,areverse,loudnorm=I=-16:TP=-1.5:LRA=11';
  await run('ffmpeg', ['-y', '-v', 'error', '-i', raw, '-af', af, '-ac', '1', '-ar', '24000', '-b:a', '64k', OUT + file]);
  const d = parseFloat(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT + file]));
  man.lines[l.key] = { f: [file], d: [Math.round(d * 1000) / 1000], e: 'edge', voice: c.voice, role: l.role, t: l.text, sig };
  fs.rmSync(raw, { force: true });
  return 'ok';
}

const todo = lines.filter(l => !only.length || only.includes(l.role));
let i = 0, done = 0, failed = [];
const worker = async () => {
  while (i < todo.length) {
    const l = todo[i++];
    try { const r = await render(l); done++; if (done % 20 === 0) console.log(`${done}/${todo.length}`); if (r === 'ok') await sleep(150); }
    catch (e) { failed.push([l.key, l.role, e.message]); }
    if (done % 10 === 0) fs.writeFileSync(manPath, JSON.stringify(man));
  }
};
await Promise.all(Array.from({ length: CONC }, worker));
// drop manifest entries for lines that no longer exist
const keep = new Set(lines.map(l => l.key));
for (const k of Object.keys(man.lines)) if (!keep.has(k)) delete man.lines[k];
fs.writeFileSync(manPath, JSON.stringify(man, null, 0));
const bytes = Object.values(man.lines).reduce((a, x) => a + (fs.existsSync(OUT + x.f[0]) ? fs.statSync(OUT + x.f[0]).size : 0), 0);
console.log(`done ${done}/${todo.length}, failed ${failed.length}, ${Object.keys(man.lines).length} in manifest, ${(bytes / 1e6).toFixed(2)} MB`);
if (failed.length) console.log(JSON.stringify(failed.slice(0, 10), null, 1));
