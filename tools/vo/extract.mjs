// Voice-over inventory: node tools/vo/extract.mjs  ->  tools/vo/script.json
// Collects every line the game speaks (or shows as character speech that a voice could play), with the voice role it
// is spoken in and its key (src/audio/vokey.js). Pure data modules are imported and expanded (barks, radio, pitch
// content for every startup idea); the rest is parsed from source (call arguments, object literals, const tables).
// kind: story (mission dialogue, Ctx.say — voiced), phone (Ctx.phone calls), bark (pedestrian barks — voiced),
// bubble (speech-bubble text of game.bark), radio (DJs, idents, VCPR talk — voiced), minigame, claudia, npc, announce,
// dynamic (built at runtime from variables: listed with the template, not keyed unless the values are finite).
// voicedNow: whether the current runtime speaks it (the rest is subtitle/UI text a voice could take over).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { voKey } from '../../src/audio/vokey.js';
import { SPEAKER_ROLE } from '../../src/audio/cast.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const imp = f => import(pathToFileURL(path.join(ROOT, f)).href);
const lineOf = (src, i) => src.slice(0, i).split('\n').length;

const out = [], dyn = [];
const seen = new Set();
function add(o) {
  const text = String(o.text || '').trim();
  if (!text || /^[\s.…*]*$/.test(text)) return;
  if (/^\*.*\*$/.test(text)) return;               // stage directions like *sips tea*
  const k = voKey(o.role, text);
  const id = k + '|' + o.kind;
  if (seen.has(id)) return; seen.add(id);
  out.push({ key: k, role: o.role, speaker: o.speaker, kind: o.kind, voicedNow: !!o.voicedNow, text, station: o.station, src: o.src });
}
function addDyn(o) { const id = o.role + '|' + o.template; if (seen.has(id)) return; seen.add(id); dyn.push({ kind: 'dynamic', role: o.role, speaker: o.speaker, of: o.of, template: o.template, how: o.how, src: o.src }); }

// ---- tiny JS literal parsing ---------------------------------------------------------------------------------------
/** string literal at src[i] (one of ' " `) -> { value, end, dyn } ; template ${…} kept verbatim and flagged */
function strAt(src, i) {
  const q = src[i]; let v = '', j = i + 1, d = false;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { const n = src[j + 1]; v += n === 'n' ? '\n' : n === 't' ? '\t' : n; j += 2; continue; }
    if (q === '`' && c === '$' && src[j + 1] === '{') { let depth = 0, k = j + 1; for (; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}' && --depth === 0) break; } v += src.slice(j, k + 1); j = k + 1; d = true; continue; }
    if (c === q) return { value: v, end: j + 1, dyn: d };
    v += c; j++;
  }
  return { value: v, end: j, dyn: d };
}
/** end index (exclusive) of the bracketed expression starting at src[i] ('(' '[' '{'), strings skipped */
function matchEnd(src, i) {
  const open = src[i], close = { '(': ')', '[': ']', '{': '}' }[open]; let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '"' || c === "'" || c === '`') { j = strAt(src, j).end - 1; continue; }
    if (c === '/' && src[j + 1] === '/') { j = src.indexOf('\n', j); continue; }
    if (c === open) depth++; else if (c === close && --depth === 0) return j + 1;
  }
  return src.length;
}
/** all string literals inside src[a:b] (top-level and nested) */
function strings(src, a, b) {
  const r = [];
  for (let j = a; j < b; j++) {
    const c = src[j];
    if (c === '/' && src[j + 1] === '/') { j = src.indexOf('\n', j); if (j < 0) break; continue; }
    if (c === '"' || c === "'" || c === '`') { const s = strAt(src, j); r.push({ ...s, at: j }); j = s.end - 1; }
  }
  return r;
}
/** evaluate `const NAME = <literal>` (arrays/objects of literals) */
function grabConst(src, name) {
  const m = new RegExp(`const ${name}\\s*=\\s*`).exec(src); if (!m) return null;
  const i = m.index + m[0].length; const end = matchEnd(src, i);
  try { return Function(`return (${src.slice(i, end)})`)(); } catch { return null; }
}
/** argument ranges of every call `name(` */
function calls(src, re) {
  const r = []; let m;
  while ((m = re.exec(src))) { const i = m.index + m[0].length - 1; r.push({ a: i + 1, b: matchEnd(src, i) - 1, at: m.index }); }
  return r;
}
const plain = t => t.replace(/<[^>]+>/g, '');
const isDyn = s => s.dyn || /\$\{/.test(s.value);

// ---- 1. mission dialogue: { speaker, text } objects --------------------------------------------------------------
for (const f of fs.readdirSync(path.join(ROOT, 'src/missions')).filter(f => f.endsWith('.js'))) {
  const file = `src/missions/${f}`, src = rd(file);
  // enclosing call kinds, by position
  const spans = [...calls(src, /\bc\.say\(/g).map(c => ({ ...c, kind: 'story' })), ...calls(src, /\bc\.phone\(/g).map(c => ({ ...c, kind: 'phone' })), ...calls(src, /subtitle\(/g).map(c => ({ ...c, kind: 'subtitle' }))];
  const re = /speaker:\s*(['"`])/g; let m;
  while ((m = re.exec(src))) {
    const sp = strAt(src, m.index + m[0].length - 1); const after = src.slice(sp.end, sp.end + 40); const tm = /^\s*,\s*text:\s*/.exec(after);
    if (!tm) continue;
    const ti = sp.end + tm[0].length; const tx = strAt(src, ti);
    const span = spans.filter(s => s.a <= m.index && m.index <= s.b).sort((x, y) => y.a - x.a)[0];
    const kind = span?.kind === 'phone' ? 'phone' : span?.kind === 'story' ? 'story' : 'subtitle';
    const role = SPEAKER_ROLE[sp.value] || 'male';
    const src_ = `${file}:${lineOf(src, m.index)}`;
    if (isDyn(tx)) addDyn({ role, speaker: sp.value, of: kind, template: plain(tx.value), how: 'mission template', src: src_ });
    else add({ role, speaker: sp.value, kind, voicedNow: kind === 'story', text: plain(tx.value), src: src_ });
  }
}

// ---- 2. barks (spoken) + game.bark bubble text --------------------------------------------------------------------
{
  const { BARKS, BARK_VOICE } = await imp('src/audio/barks.js');
  for (const [kind, lines] of Object.entries(BARKS)) for (const t of lines) for (const role of BARK_VOICE[kind] || ['male'])
    add({ role, kind: 'bark', voicedNow: true, text: t, src: `src/audio/barks.js:${kind}` });
  const g = rd('src/game.js'); const L = grabConst(g, 'LINES');
  if (L) for (const [kind, lines] of Object.entries(L)) for (const t of lines) for (const role of BARK_VOICE[kind] || ['male'])
    add({ role, kind: 'bubble', text: t, src: `src/game.js:bark.${kind}` });
}

// ---- 3. radio -------------------------------------------------------------------------------------------------------
{
  const { TALK_LINES } = await imp('src/audio/talk.js');
  for (const l of TALK_LINES) add({ role: l.ad ? 'female' : 'dj', kind: 'radio', voicedNow: true, text: l.t, station: l.ad ? 'vcprAd' : 'vcpr', src: 'src/audio/talk.js' });
  const { STATIONS } = await imp('src/audio/stations.js');
  for (const st of STATIONS) {
    for (const t of st.idents || []) {
      add({ role: 'dj', kind: 'radio', voicedNow: true, text: t, station: st.id, src: `src/audio/stations.js:${st.id}.idents` });
      if (st.dj?.role && st.dj.role !== 'dj') add({ role: st.dj.role, kind: 'radio', voicedNow: true, text: t, station: st.id, src: `src/audio/stations.js:${st.id}.idents` });
    }
    for (const t of st.dj?.lines || []) add({ role: st.dj.role || 'dj', kind: 'radio', voicedNow: true, text: t, station: st.id, src: `src/audio/stations.js:${st.id}.dj` });
  }
}

// ---- 4. Demo Day pitch (pitch-data.js expanded for every idea; numbers marked dynamic) ------------------------------
{
  const P = await imp('src/ui/minigames/pitch-data.js');
  const INV = { merlion: 'priya', sandhill: 'chad', auntie: 'auntiemei' };
  const SENT = 12345, sentinels = [SENT, Math.round(SENT * 0.38)].map(n => n.toLocaleString('en-SG'));
  const dynamicText = t => sentinels.some(s => t.includes(s));
  const put = (role, speaker, t, where) => { if (!t) return; t = plain(String(t)).replace(/^"|"$/g, ''); if (dynamicText(t)) addDyn({ role, speaker, of: 'minigame', template: t.replaceAll(sentinels[0], '${users}').replaceAll(sentinels[1], '${weeklyActives}'), how: 'pitch: user counts', src: 'src/ui/minigames/pitch-data.js' }); else add({ role, speaker, kind: 'minigame', text: t, src: 'src/ui/minigames/pitch-data.js' }); };
  const react = r => { for (const [k, v] of Object.entries(r || {})) if (v) put(INV[k], k, v, 'react'); };
  const buzz = new Set();
  for (const idea of ['chopechain', 'kopiai', 'duriandash']) {
    for (const s of P.slides(idea, { users: SENT })) { put('tommy', 'Tommy', s.line); for (const b of s.buzz || []) buzz.add(b); }
    for (const q of P.questions(idea, { users: SENT })) { put(INV[q.from], q.from, q.text); for (const a of q.answers) { put('tommy', 'Tommy', a.text); react(a.react); } }
  }
  put('tommy', 'Tommy', P.TIMEOUT_ANSWER.line); react(P.TIMEOUT_ANSWER.react);
  for (const w of buzz) { put('tommy', 'Tommy', P.QTE_LINES.perfect(w)); put('tommy', 'Tommy', P.QTE_LINES.good(w)); }
  const pm = /pickOne\(\[([\s\S]*?)\]\)/.exec(rd('src/ui/minigames/pitch-data.js'));
  if (pm) for (const s of strings(pm[1], 0, pm[1].length)) put('tommy', 'Tommy', s.value);
  for (const r of Object.values(P.QTE_REACT)) react(r);
  for (const k of ['merlion', 'sandhill', 'auntie']) for (const v of [0, 50, 80]) put(INV[k], k, P.verdict(k, v));
  // pitch.js MC + QTE templates
  const ps = rd('src/ui/minigames/pitch.js');
  for (const c of calls(ps, /\bsay\(/g)) {
    const ss = strings(ps, c.a, c.b); if (ss.length < 2 || ss[0].value !== 'MC') continue;
    for (const ideaName of ['ChopeChain', 'Kopi.ai', 'DurianDash']) add({ role: 'mc', speaker: 'MC', kind: 'minigame', text: ss[1].value.replace(/\$\{ideaName\}/g, ideaName), src: `src/ui/minigames/pitch.js:${lineOf(ps, c.at)}` });
  }
}

// ---- 5. Temasick negotiation ---------------------------------------------------------------------------------------
{
  const file = 'src/ui/minigames/negotiation.js', s = rd(file);
  const TAN = grabConst(s, 'TAN'); if (TAN) for (const [k, v] of Object.entries(TAN)) for (const t of v) add({ role: 'mrtan', speaker: 'Mr. Tan', kind: 'minigame', text: t, src: `${file}:TAN.${k}` });
  for (const c of calls(s, /\btanSay\(/g)) for (const st of strings(s, c.a, c.b)) isDyn(st) ? addDyn({ role: 'mrtan', speaker: 'Mr. Tan', of: 'minigame', template: st.value, how: 'negotiation', src: `${file}:${lineOf(s, c.at)}` }) : add({ role: 'mrtan', speaker: 'Mr. Tan', kind: 'minigame', text: st.value, src: `${file}:${lineOf(s, c.at)}` });
  for (const c of calls(s, /\bsay\(/g)) {
    const ss = strings(s, c.a, c.b); if (!ss.length) continue;
    const who = ss[0].value; const role = SPEAKER_ROLE[who]; if (!role) continue; // narration ('') stays silent
    for (const st of ss.slice(1)) { if (/^is-|^ken$/.test(st.value)) continue; isDyn(st) ? addDyn({ role, speaker: who, of: 'minigame', template: st.value, how: 'negotiation terms', src: `${file}:${lineOf(s, c.at)}` }) : add({ role, speaker: who, kind: 'minigame', text: st.value, src: `${file}:${lineOf(s, c.at)}` }); }
  }
}

// ---- 6. Kopi Uncle, Singlish quiz, taxi passengers, chope ----------------------------------------------------------
{
  const file = 'src/ui/minigames/kopi.js', s = rd(file);
  const lingo = 'src/ui/minigames/kopi-lingo.js', sl = rd(lingo); // reactions + complaints live with the order phrasing
  const L = grabConst(sl, 'LINES');
  const voiceFor = name => /Auntie|Office Lady|Poly|selfie/i.test(name) ? 'auntie' : /Tourist/.test(name) ? 'tourist' : 'uncle';
  if (L) for (const k of ['perfect', 'partial', 'bad', 'walk']) for (const t of L[k] || []) for (const role of ['auntie', 'uncle']) add({ role, kind: 'npc', text: t.replace(/\s*[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ''), src: `${lingo}:LINES.${k}` });
  if (L?.vipPerfect) for (const [n, t] of Object.entries(L.vipPerfect)) { const sp = n.split(' · ')[0].split(' ')[0]; const role = SPEAKER_ROLE[sp] || SPEAKER_ROLE[n.split(' · ')[0]] || 'male'; add({ role, speaker: sp, kind: 'minigame', text: t, src: `${lingo}:vipPerfect` }); }
  for (const c of [...(grabConst(s, 'CUSTOMERS') || []), ...(grabConst(s, 'VIPS') || [])]) if (c.intro) { const sp = c.name.split(' · ')[0]; const role = SPEAKER_ROLE[sp] || SPEAKER_ROLE[sp.split(' ')[0]] || voiceFor(c.name); add({ role, speaker: sp, kind: c.portrait ? 'minigame' : 'npc', text: c.intro, src: `${file}:intro` }); }
  // complaints: one per field/value (finite)
  const cm = /const complain = [\s\S]*?\}\)\[field\];/.exec(sl);
  if (cm) for (const st of strings(cm[0], 0, cm[0].length)) {
    if (isDyn(st)) { for (const b of ['kopi', 'teh', 'Milo', 'yuan yang']) for (const role of ['auntie', 'uncle']) add({ role, kind: 'npc', text: `Aiyoh, I order ${b} leh!`, src: `${lingo}:complain` }); continue; }
    if (/^(kopi|teh|milo|evap|none|gao|po|tarik|dino)$/.test(st.value) || st.value.length < 6) continue;
    for (const role of ['auntie', 'uncle']) add({ role, kind: 'npc', text: st.value, src: `${lingo}:complain` });
  }
  addDyn({ role: 'uncle', of: 'npc', template: 'kopi orders (generated "Kopi-C kosong peng…")', how: 'kopi.js order phrasing from BASES/MILKS/SUGARS/STRENGTHS — combinatorial', src: file });
}
{
  const file = 'src/ui/minigames/quiz.js', s = rd(file);
  for (const n of ['RIGHT', 'WRONG', 'TIMEOUT']) for (const t of grabConst(s, n) || []) add({ role: 'uncle', kind: 'npc', text: t, src: `${file}:${n}` });
  for (const b of grabConst(s, 'BANK') || []) add({ role: 'uncle', kind: 'npc', text: b[1], src: `${file}:BANK` });
}
{
  const file = 'src/missions/taxi.js', s = rd(file);
  const DEST = grabConst(s, 'DEST');
  const names = Array.isArray(DEST) ? DEST.map(d => d.name || d.n || d[0]).filter(x => typeof x === 'string') : [];
  for (const t of grabConst(s, 'PICKUP_LINES') || []) {
    if (t.includes('%D') && names.length) for (const n of names) for (const role of ['female', 'male']) add({ role, kind: 'npc', text: t.replace('%D', n), src: `${file}:PICKUP_LINES` });
    else addDyn({ role: 'male', of: 'npc', template: t, how: 'taxi pickup (%D = destination)', src: file });
  }
  for (const n of ['DROP_LINES', 'LATE_LINES']) for (const t of grabConst(s, n) || []) for (const role of ['female', 'male', 'tourist']) add({ role, kind: 'npc', text: t, src: `${file}:${n}` });
}

// ---- 7. Claudia ------------------------------------------------------------------------------------------------------
{
  const file = 'src/missions/claudia.js', s = rd(file);
  for (const c of calls(s, /\breply\(/g)) for (const st of strings(s, c.a, c.b)) {
    if (st.value.length < 4) continue;
    const t = plain(st.value);
    isDyn(st) ? addDyn({ role: 'claudia', speaker: 'Claudia', of: 'claudia', template: t, how: 'Claudia prompt reply', src: `${file}:${lineOf(s, c.at)}` }) : add({ role: 'claudia', speaker: 'Claudia', kind: 'claudia', text: t, src: `${file}:${lineOf(s, c.at)}` });
  }
  for (const n of ['shrug']) { const m = new RegExp(`const ${n}\\s*=\\s*\\[`).exec(s); if (m) { const i = m.index + m[0].length - 1; for (const st of strings(s, i, matchEnd(s, i))) add({ role: 'claudia', speaker: 'Claudia', kind: 'claudia', text: plain(st.value), src: `${file}:${n}` }); } }
  const tod = /const tod\s*=\s*\[/.exec(s); if (tod) { const i = tod.index + tod[0].length - 1; for (const st of strings(s, i, matchEnd(s, i))) if (st.value.length > 12) add({ role: 'claudia', speaker: 'Claudia', kind: 'claudia', text: plain(st.value), src: `${file}:tod` }); }
}
{
  // Claudia's text messages (services.js) and other ui.phone.text(...) senders
  for (const file of ['src/missions/services.js', 'src/missions/extras.js', 'src/missions/hype.js', 'src/missions/activities.js']) {
    const s = rd(file);
    for (const c of calls(s, /\.text\(\s*'Claudia'/g)) for (const st of strings(s, c.a, c.b).slice(1)) isDyn(st) ? addDyn({ role: 'claudia', speaker: 'Claudia', of: 'claudia', template: plain(st.value), how: 'text message', src: `${file}:${lineOf(s, c.at)}` }) : add({ role: 'claudia', speaker: 'Claudia', kind: 'claudia', text: plain(st.value), src: `${file}:${lineOf(s, c.at)}` });
    const arr = /CLAUDIA[A-Z_]*\s*=\s*\[/.exec(s); if (arr) { const i = arr.index + arr[0].length - 1; for (const st of strings(s, i, matchEnd(s, i))) if (st.value.length > 8) isDyn(st) ? addDyn({ role: 'claudia', speaker: 'Claudia', of: 'claudia', template: plain(st.value), how: 'text message', src: file }) : add({ role: 'claudia', speaker: 'Claudia', kind: 'claudia', text: plain(st.value), src: file }); }
  }
}

// ---- 8. announcements -----------------------------------------------------------------------------------------------
{
  const file = 'src/world/ambient.js', s = rd(file);
  for (const c of calls(s, /subtitle\(/g)) for (const st of strings(s, c.a, c.b).slice(0, 1)) add({ role: 'mrt', kind: 'announce', text: st.value.replace(/^"|"$/g, ''), src: `${file}:${lineOf(s, c.at)}` });
}

// ---- write + summary ------------------------------------------------------------------------------------------------
out.sort((a, b) => a.kind.localeCompare(b.kind) || a.role.localeCompare(b.role));
fs.writeFileSync(path.join(ROOT, 'tools/vo/script.json'), JSON.stringify({ generated: new Date().toISOString(), lines: out, dynamic: dyn }, null, 1));
const sum = (arr, f) => { const m = {}; for (const l of arr) { const k = f(l); m[k] = m[k] || [0, 0]; m[k][0]++; m[k][1] += l.text.length; } return m; };
const show = (title, m) => { console.log(`\n${title}`); for (const [k, [n, c]] of Object.entries(m).sort((a, b) => b[1][1] - a[1][1])) console.log(`  ${k.padEnd(12)} ${String(n).padStart(4)} lines ${String(c).padStart(6)} chars`); };
show('by kind', sum(out, l => l.kind));
show('by role', sum(out, l => l.role));
console.log(`\ntotal ${out.length} lines, ${out.reduce((s, l) => s + l.text.length, 0)} chars; voiced now: ${out.filter(l => l.voicedNow).length}; dynamic templates: ${dyn.length}`);
