// Story-cast voice-over inventory: every static line spoken by the main characters.
//   node tools/vo/story-lines.mjs  ->  tools/vo/story-lines.json  [{ key, role, text, speak, src }]
// `text` is exactly what the runtime looks up (voKey(role, text) — markup is stripped by voNorm), `speak` is the
// TTS-friendly version (money, acronyms, stage directions). Lines built from runtime values (user counts, deal
// numbers) are enumerated when the value set is small (idea names, pitch buzzwords) and skipped otherwise.
import fs from 'node:fs';
import { voKey } from '../../src/audio/vokey.js';
import { slides, questions, TIMEOUT_ANSWER, QTE_LINES, QTE_REACT, verdict, INVESTORS } from '../../src/ui/minigames/pitch-data.js';

const ROOT = new URL('../../', import.meta.url).pathname;
const read = f => fs.readFileSync(ROOT + f, 'utf8');

// speaker name (as in the mission scripts / minigames) -> voice role
export const SPEAKER_ROLE = {
  Tommy: 'tommy', 'Tommy Vercetti': 'tommy', TOMMY: 'tommy',
  Ken: 'ken', 'Ken Rosenberg': 'ken', KEN: 'ken',
  Lance: 'lance', 'Lance Vance': 'lance',
  Kyle: 'kyle', Chad: 'chad', Priya: 'priya', 'Priya Raman': 'priya',
  'Auntie Mei': 'auntiemei', 'Mr. Tan': 'mrtan', 'Uncle Ah Seng': 'ahseng',
  Sonny: 'sonny', 'Sonny Forelli': 'sonny', Jasmine: 'jasmine', Scout: 'scout', MC: 'mc', Claudia: 'claudia',
};
const INVESTOR_ROLE = { merlion: 'priya', sandhill: 'chad', auntie: 'auntiemei' };
const IDEAS = { chopechain: 'ChopeChain', kopiai: 'Kopi.ai', duriandash: 'DurianDash' };

const out = new Map();
const add = (role, text, src) => {
  if (!role || !text) return;
  const plain = text.replace(/<[^>]+>/g, '').trim();
  if (!plain || /^\*[^*]+\*$/.test(plain) || plain === '…') return; // stage directions only
  const key = voKey(role, plain);
  if (!out.has(key)) out.set(key, { key, role, text: plain, speak: speakable(plain), src });
};

// --- mission scripts: { speaker: '…', text: '…' } (Ctx.say and phone calls)
const lit = s => Function(`"use strict"; return (${s});`)();
{
  const s = read('src/missions/story.js');
  const re = /\{\s*speaker:\s*'([^']+)',\s*text:\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
  for (let m; (m = re.exec(s));) {
    const role = SPEAKER_ROLE[m[1]], raw = m[2];
    if (raw.startsWith('`') && raw.includes('${')) {
      // the only enumerable template: "<b>${r.ideaName}</b>. Shipped. I'm a tech founder now."
      if (raw.includes('${r.ideaName}')) for (const n of Object.values(IDEAS)) add(role, lit(raw.replace('${r.ideaName}', n)), 'story.js');
      else console.warn('skipped dynamic line:', m[1], raw.slice(0, 70));
      continue;
    }
    add(role, lit(raw), 'story.js');
  }
  // the Why Combinator scout's surrender is a bare subtitle: voice the quote itself
  add('scout', 'OKAY! OKAY! Take it! I\'m going back to consulting!', 'story.js (scout subtitle)');
}

// --- Demo Day pitch (pitch.js + pitch-data.js)
for (const [idea, name] of Object.entries(IDEAS)) {
  add('mc', `Next up — Tommy Vercetti, founder of ${name}!`, 'pitch.js');
  for (const sl of slides(idea, { users: 1234 })) if (sl.kind !== 'traction') add('tommy', sl.line, 'pitch-data slides');
  const qa = questions(idea, { users: 1234 }), qb = questions(idea, { users: 4321 });
  qa.forEach((q, i) => {
    if (q.text === qb[i].text) add(INVESTOR_ROLE[q.from], q.text, 'pitch-data questions');
    q.answers.forEach((a, j) => {
      if (a.text === qb[i].answers[j].text) add('tommy', a.text, 'pitch-data answers');
      for (const [k, t] of Object.entries(a.react || {})) if (t && t === qb[i].answers[j].react?.[k]) add(INVESTOR_ROLE[k], t, 'pitch-data reactions');
    });
  });
}
for (const [k, t] of Object.entries(TIMEOUT_ANSWER.react)) if (t) add(INVESTOR_ROLE[k], t, 'pitch-data timeout');
for (const r of Object.values(QTE_REACT)) for (const [k, t] of Object.entries(r)) if (t) add(INVESTOR_ROLE[k], t, 'pitch-data qte react');
{
  const buzz = new Set(); for (const idea of Object.keys(IDEAS)) for (const sl of slides(idea, { users: 1234 })) for (const w of sl.buzz) buzz.add(w);
  for (const w of buzz) { add('tommy', QTE_LINES.perfect(w), 'pitch-data qte'); add('tommy', QTE_LINES.good(w), 'pitch-data qte'); }
  const pd = read('src/ui/minigames/pitch-data.js');
  const miss = pd.match(/miss:\s*\(\)\s*=>\s*pickOne\((\[[\s\S]*?\])\)/);
  if (miss) for (const t of lit(miss[1])) add('tommy', t, 'pitch-data qte miss');
}
for (const k of Object.keys(INVESTORS)) for (const v of [10, 50, 90]) add(INVESTOR_ROLE[k], verdict(k, v).replace(/^"|"$/g, ''), 'pitch-data verdict');

// --- Mr. Tan negotiation (negotiation.js)
{
  const s = read('src/ui/minigames/negotiation.js');
  const tan = lit(s.match(/const TAN = (\{[\s\S]*?\n\});/)[1]);
  for (const arr of Object.values(tan)) for (const t of arr) add('mrtan', t, 'negotiation TAN');
  const strs = '\'(?:[^\'\\\\]|\\\\.)*\'';
  for (const m of s.matchAll(new RegExp(`tanSay\\((${strs})\\)`, 'g'))) add('mrtan', lit(m[1]), 'negotiation tanSay');
  for (const m of s.matchAll(new RegExp(`tanSay\\(big \\? (${strs}) : (${strs})\\)`, 'g'))) { add('mrtan', lit(m[1]), 'negotiation tanSay'); add('mrtan', lit(m[2]), 'negotiation tanSay'); }
  for (const m of s.matchAll(new RegExp(`say\\('(TOMMY|KEN)', (${strs})`, 'g'))) add(SPEAKER_ROLE[m[1]], lit(m[2]), 'negotiation say');
  const pick = s.match(/say\('TOMMY', pick\(\[`[^`]*`, ('(?:[^'\\]|\\.)*'), ('(?:[^'\\]|\\.)*')\]\)\)/);
  if (pick) { add('tommy', lit(pick[1]), 'negotiation say'); add('tommy', lit(pick[2]), 'negotiation say'); }
}

/** what the TTS should actually say: money, acronyms, symbols, stage directions */
export function speakable(t) {
  let s = t.replace(/\*[^*]+\*/g, ' ').replace(/\s+/g, ' ').trim();
  const num = n => n;
  s = s
    .replace(/S\$\s?([\d,.]+)\s?M\b/g, (_, n) => `${num(n)} million dollars`)
    .replace(/S\$\s?([\d,.]+)\s?B\b/g, (_, n) => `${num(n)} billion dollars`)
    .replace(/S\$\s?([\d,.]+)/g, (_, n) => `${num(n)} dollars`)
    .replace(/\b(\d+)\s?[x×]\b/g, '$1 times')
    .replace(/Section 4\.2\(b\)\(iii\)/, 'Section four point two, b, three')
    .replace(/\bKopi\.ai\b/g, 'Kopi dot A.I.')
    .replace(/\bChopeAI\b/g, 'Chope A.I.')
    .replace(/\bAGI\b/g, 'A.G.I.').replace(/\bAI\b/g, 'A.I.').replace(/\bCPF\b/g, 'C.P.F.').replace(/\bERP\b/g, 'E.R.P.')
    .replace(/\bKYC\b/g, 'K.Y.C.').replace(/\bARR\b/g, 'A.R.R.').replace(/\bSEA\b/g, 'Southeast Asian').replace(/\bUX\b/g, 'U.X.')
    .replace(/\bQR\b/g, 'Q.R.').replace(/\bNFTs\b/g, 'N.F.T.s').replace(/\bKPI\b/g, 'K.P.I.').replace(/\bTAM\b/g, 'T.A.M.')
    .replace(/\bVPU\b/g, 'V.P.U.').replace(/\bMoM\b/g, 'month on month').replace(/\bGPUs\b/g, 'G.P.U.s')
    .replace(/—/g, ', ').replace(/ ,/g, ',').replace(/,\s*,/g, ',')
    .replace(/[🔥☕🧻🚇🚁✅👀🪪☂️🚮]/gu, '')
    .replace(/\b10X\b/g, 'ten X');
  // shouted words in caps would be spelled out letter by letter: lower-case them (the '!' carries the shout)
  const ACR = new Set(['AI', 'AGI', 'CPF', 'ERP', 'KYC', 'ARR', 'UX', 'QR', 'NFT', 'KPI', 'TAM', 'VPU', 'MRT', 'GPU', 'CEO', 'NPS', 'OK', 'TV', 'B2B', 'X']);
  s = s.replace(/\bAIs\b/g, 'A.I.s').replace(/\b[A-Z](?:[A-Z]|['-][A-Z])+\b/g, w => ACR.has(w) ? w : w.toLowerCase());
  return s.replace(/([A-Z])\.\.(?!\.)/g, '$1.').replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}

const lines = [...out.values()];
fs.writeFileSync(ROOT + 'tools/vo/story-lines.json', JSON.stringify(lines, null, 1));
const by = {}; for (const l of lines) by[l.role] = (by[l.role] || 0) + 1;
console.log(lines.length, 'lines', JSON.stringify(by), 'chars', lines.reduce((a, l) => a + l.speak.length, 0));
