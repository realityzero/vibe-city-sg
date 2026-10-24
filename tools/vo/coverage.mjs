// Voice-over coverage: every line the game can say must have a pre-rendered take in public/vo/manifest.json (the game
// never synthesises speech at runtime). Checks tools/vo/script.json (static lines, from extract.mjs) plus every
// runtime-built variant (src/missions/vodyn.js, src/ui/minigames/kopi-lingo.js, tools/vo/places.json).
//   node tools/vo/coverage.mjs [--all]     (--all also lists the static lines the game doesn't speak today)
import fs from 'node:fs';
import { voKey } from '../../src/audio/vokey.js';
import * as D from '../../src/missions/vodyn.js';
import { IDEAS } from '../../src/ui/minigames/vibecode-data.js';
import { allOrders, nameTerms, englishParts, LINES, reactionLines } from '../../src/ui/minigames/kopi-lingo.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const man = JSON.parse(fs.readFileSync(ROOT + 'public/vo/manifest.json', 'utf8')).lines;
const script = JSON.parse(fs.readFileSync(ROOT + 'tools/vo/script.json', 'utf8'));
const places = fs.existsSync(ROOT + 'tools/vo/places.json') ? JSON.parse(fs.readFileSync(ROOT + 'tools/vo/places.json', 'utf8')) : [];
const all = process.argv.includes('--all');
const res = {}, miss = [];
const checkAll = (group, role, v) => { for (const t of [].concat(v)) check(group, role, t); }; // a line or sentences played back to back
const check = (group, role, text, spoken = true) => {
  const r = res[group] || (res[group] = { lines: 0, ok: 0, spoken: 0, spokenOk: 0 });
  const ok = !!man[voKey(role, text)];
  r.lines++; if (ok) r.ok++;
  if (spoken) { r.spoken++; if (ok) r.spokenOk++; else miss.push([group, role, text]); }
  else if (!ok && all) miss.push([group + ' (not spoken)', role, text]);
};

// static lines: stage directions (*…*) and narration aren't voiced
for (const l of script.lines) {
  const stage = /^\*[^*]+\*$/.test(l.text.trim()) || /^Tommy (stares|shrugs|says nothing)/.test(l.text);
  check(l.kind, l.role, l.text, !stage);
}
// runtime-built lines
for (const { name } of IDEAS) check('dyn story', 'tommy', `<b>${name}</b>. Shipped. I'm a tech founder now.`);
const sweep = fn => { const s = new Set(); for (const u of [...Array(6001).keys(), 99999]) for (const t of [].concat(fn(u))) s.add(t); return [...s]; };
for (const t of sweep(D.pitchSlideSpeak)) check('dyn pitch', 'tommy', t);
for (const t of sweep(D.pitchPriyaSpeak)) check('dyn pitch', 'priya', t);
for (const t of sweep(D.pitchWauSpeak)) check('dyn pitch', 'tommy', t);
for (const t of sweep(D.negoUsersSpeak)) check('dyn nego', 'tommy', t);
for (const r of D.RAISE_VALUES) for (const p of [D.PRE_VALUES[0]]) check('dyn terms', 'tommy', D.negoTermsSpeak(r, p, 0)[0]);
for (const p of D.PRE_VALUES) check('dyn terms', 'tommy', D.negoTermsSpeak(2e6, p, 0)[1]);
for (const n of D.BOARD_VALUES) check('dyn terms', 'tommy', D.negoTermsSpeak(2e6, 10e6, n)[2]);
for (const r of D.RAISE_VALUES) for (const p of D.PRE_VALUES) { const L = D.tanDealLines(r, r + p); if (p === D.PRE_VALUES[0]) check('dyn tan', 'mrtan', L[0].text); }
for (const v of D.POST_VALUES) check('dyn tan', 'mrtan', D.tanDealLines(2e6, v)[1].text);
check('dyn tan', 'mrtan', D.tanDealLines(2e6, 12e6)[2].text);
for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m++) checkAll('dyn claudia time', 'claudia', D.claudiaTimeSpeak(h, m));
for (const t of D.SPAWN_TYPES) for (let n = 0; n <= 12; n++) checkAll('dyn claudia spawn', 'claudia', D.claudiaSpawnSpeak(n, t));
for (const p of places) { checkAll('dyn claudia place', 'claudia', D.claudiaAutopilotSpeak(p)); checkAll('dyn claudia place', 'claudia', D.claudiaTeleportSpeak(p)); }
const VIP = { priya: { base: 'teh', milk: 'none', sugar: 0 }, chad: { base: 'kopi', milk: 'none', strength: 'gao', ice: true }, auntiemei: { base: 'kopi', strength: 'gao', sugar: 1 }, ken: { base: 'kopi', milk: 'evap', sugar: 3, dabao: true } };
const fresh = () => ({ base: null, milk: 'condensed', sugar: 2, strength: 'normal', ice: false, extra: 'none', dabao: false });
const order = (role, d, lingo) => { const t = lingo ? nameTerms(d) : englishParts(d); t.forEach((x, i) => check('dyn kopi', role, (lingo ? D.kopiTermKey : D.kopiPhraseKey)(x, i === t.length - 1))); };
for (const d of allOrders()) { for (const r of ['auntie', 'uncle', 'tourist', 'touristm']) order(r, d, true); for (const r of ['tourist', 'touristm']) order(r, d, false); }
for (const [r, f] of Object.entries(VIP)) { const d = Object.assign(fresh(), f); order(r, d, true); order(r, d, false); }
for (const r of ['auntie', 'uncle', 'tourist', 'touristm', ...Object.keys(VIP)]) for (const t of reactionLines()) if (!(r in VIP) || !LINES.perfect.includes(t)) check('dyn kopi react', r, t);
const VIP_PERFECT = { chad: 'Bro. This is better than Blue Bottle.', ken: 'Tommy, this is the best thing that\'s happened to me all week.', priya: 'Precise. I like precise.', auntiemei: 'Good. Now go back to your startup.' };
for (const [r, t] of Object.entries(VIP_PERFECT)) check('dyn kopi react', r, t);
for (const [r, t] of [['priya', 'I\'m watching my burn rate.'], ['chad', 'Do you have oat milk? No? Cool, cool. Just —'], ['auntiemei', 'Faster ah, I\'m an investor.'], ['ken', 'TOMMY?! You work here now?! Okay, okay —']]) check('dyn kopi', r, t);
check('dyn kopi', 'touristm', 'Uh, hi! I don\'t know the words, sorry —'); check('dyn kopi', 'tourist', 'Hello! Can I get —');

console.log('group'.padEnd(22), 'spoken  voiced');
let S = 0, O = 0;
for (const [g, r] of Object.entries(res).sort()) { console.log(g.padEnd(22), String(r.spoken).padStart(6), String(r.spokenOk).padStart(7), r.lines !== r.spoken ? `  (+${r.lines - r.spoken} unspoken, ${r.ok - r.spokenOk} voiced)` : ''); S += r.spoken; O += r.spokenOk; }
console.log(`TOTAL spoken ${S}, voiced ${O}, missing ${S - O}`);
const uniq = [...new Map(miss.map(m => [m.join('|'), m])).values()];
for (const m of uniq.slice(0, 60)) console.log('  missing:', m[0], m[1], '|', m[2]);
if (uniq.length > 60) console.log(`  … ${uniq.length - 60} more`);
process.exitCode = S - O ? 1 : 0;
