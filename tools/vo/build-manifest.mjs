// Merge the voice-over manifests into public/vo/manifest.json (what the game loads):
//   node tools/vo/build-manifest.mjs
// public/vo/manifest.edge.json  — tools/vo/gen-edge.mjs (barks, radio, minigames, Claudia, NPCs)
// public/vo/manifest.dyn.json   — tools/vo/gen-dyn.mjs (runtime-built lines: numbers, places, kopi orders)
// public/vo/manifest.story.json — the story cast (mission dialogue, phone calls); wins on key collisions
// Entries whose files are missing are dropped. Prints counts, durations and total size per kind.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(ROOT, 'public/vo');
const load = f => { const p = path.join(DIR, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')).lines || {} : {}; };
const parts = [['edge', load('manifest.edge.json')], ['dyn', load('manifest.dyn.json')], ['story', load('manifest.story.json')]];

const lines = {}, stats = {};
let missing = 0, overridden = 0;
for (const [src, L] of parts) for (const [key, e] of Object.entries(L)) {
  const files = [].concat(e.f || []), d = [].concat(e.d ?? []);
  const ok = files.map((f, i) => [f, d[i]]).filter(([f]) => fs.existsSync(path.join(DIR, f)));
  if (!ok.length) { missing++; continue; }
  if (lines[key]) overridden++;
  lines[key] = { ...e, f: ok.map(x => x[0]), d: ok.map(x => +(+x[1] || 0).toFixed(2)) };
  const k = e.kind || (src === 'story' ? 'story' : 'other');
  const s = stats[k] || (stats[k] = { lines: 0, takes: 0, sec: 0, bytes: 0 });
  s.lines++; s.takes += ok.length; s.sec += ok.reduce((a, x) => a + (+x[1] || 0), 0); s.bytes += ok.reduce((a, x) => a + fs.statSync(path.join(DIR, x[0])).size, 0);
}
fs.writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify({ v: 1, built: new Date().toISOString(), lines }));
let tb = 0, tt = 0;
for (const [k, s] of Object.entries(stats).sort((a, b) => b[1].bytes - a[1].bytes)) { console.log(`${k.padEnd(10)} ${String(s.lines).padStart(5)} lines ${String(s.takes).padStart(5)} takes ${(s.sec / 60).toFixed(1).padStart(6)} min ${(s.bytes / 1e6).toFixed(2).padStart(6)} MB`); tb += s.bytes; tt += s.takes; }
const all = fs.readdirSync(DIR).filter(f => f.endsWith('.mp3'));
const dirBytes = all.reduce((a, f) => a + fs.statSync(path.join(DIR, f)).size, 0);
console.log(`manifest.json: ${Object.keys(lines).length} lines, ${tt} takes, ${(tb / 1e6).toFixed(2)} MB referenced; public/vo holds ${all.length} mp3 (${(dirBytes / 1e6).toFixed(2)} MB); ${overridden} story overrides, ${missing} entries without files`);
