// Spoken forms of lines the game builds at runtime (numbers, names, kopi orders). Voice-overs are rendered offline
// (tools/vo/gen-dyn.mjs), so every line the game can SAY must come from a finite set: this module is that set. The
// game code calls these builders to pick what to say (subtitles keep the exact figures); the generator calls the
// enumerators below to render every variant. Keep both sides on these functions.
// A builder returns a string (one take) or an array of sentences played back to back (playSeq): the varying sentence
// is rendered per value, the fixed ones once.

// ---- money / counts, formatted exactly like the screens that show them
export const fmtSGD = n => 'S$' + Math.round(n).toLocaleString('en-SG');                    // story.js
const M = 1e6;
export const fmtM = v => `S$ ${(v / M).toFixed(v % M ? 1 : 0)}M`;                              // negotiation.js
const num = n => Math.round(n).toLocaleString('en-SG');

// user counts: Mission 3 signs up 2,000 + up to 1,200 bonus users (the Pitch defaults to 2,000, the Term Sheet to
// 1,500 when it has none). Spoken rounded to the nearest 50, the way a founder says it; anything else gets a
// numberless line.
export const USER_VALUES = [1000, 1500, ...Array.from({ length: 25 }, (_, i) => 2000 + i * 50)];
const roundUsers = u => { const r = Math.round(u / 50) * 50; return USER_VALUES.includes(r) ? r : null; };
const wauOf = users => Math.round(Math.max(50, users) * 0.38);                                // pitch-data.js
export const WAU_VALUES = [...new Set(USER_VALUES.map(u => Math.round(wauOf(u) / 50) * 50))].sort((a, b) => a - b);

/** Tommy's traction slide (pitch) */
export function pitchSlideSpeak(users) {
  const r = roundUsers(Math.max(50, users));
  return [r ? `About ${num(r)} users, growing three hundred and forty percent month on month.` : 'Our users are growing three hundred and forty percent month on month.',
    'Look at that line. That\'s the line investors dream about.'];
}
/** Priya's user-count question (pitch) */
export function pitchPriyaSpeak(users) {
  const r = roundUsers(Math.max(50, users));
  return [r ? `Your slide says about ${num(r)} users.` : 'Those user numbers on your slide.', 'How many are weekly active — and how many are your relatives?'];
}
/** Tommy's weekly-actives answer (pitch) */
export function pitchWauSpeak(users) {
  const w = Math.round(wauOf(users) / 50) * 50;
  return [WAU_VALUES.includes(w) ? `About ${num(w)} weekly actives.` : 'A healthy chunk are weekly actives.', 'Zero relatives — I don\'t have any in Singapore. Yet.'];
}
/** Tommy flexes the user curve (term sheet) */
export function negoUsersSpeak(users) {
  const r = roundUsers(users);
  return r ? [`About ${num(r)} users.`, 'Look at that line, Mr. Tan. That line has never seen a down month.'] : 'Look at that user line, Mr. Tan. That line has never seen a down month.';
}

// term sheet: raise S$2–30M in S$0.5M steps, pre-money S$10–150M in S$1M steps, 0–3 board seats
export const RAISE_VALUES = Array.from({ length: 57 }, (_, i) => (2 + i * 0.5) * M);
export const PRE_VALUES = Array.from({ length: 141 }, (_, i) => (10 + i) * M);
export const BOARD_VALUES = [0, 1, 2, 3];
/** Tommy states his terms: three clips played back to back (amount / pre-money / board) */
export function negoTermsSpeak(raise, pre, board) {
  return [`${fmtM(raise)},`, `at ${fmtM(pre)} pre.`, `${board === 0 ? 'No' : board} board seat${board === 1 ? '' : 's'}. Take it or leave it.`];
}

// Mr. Tan closes the deal: raised = the raise, valuation = post-money (pre + raise) — S$12M to S$180M in 0.5M steps.
// Three subtitle beats, each a pre-rendered line.
export const POST_VALUES = [...new Set(RAISE_VALUES.flatMap(r => PRE_VALUES.map(p => r + p)))].sort((a, b) => a - b);
export function tanDealLines(raised, valuation) {
  return [
    { speaker: 'Mr. Tan', text: `${fmtSGD(raised)}.` },
    { speaker: 'Mr. Tan', text: `At ${fmtSGD(valuation)} post-money.` },
    { speaker: 'Mr. Tan', text: 'Welcome to the portfolio, Mr. Vercetti.' },
  ];
}

// ---- Claudia
const HOUR = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];
/** a clock time the way people say it, to the nearest quarter hour */
export function spokenClock(h, min) {
  let q = Math.round(min / 15), hh = h % 24;
  if (q === 4) { q = 0; hh = (hh + 1) % 24; }
  if (q === 0 && hh === 0) return 'midnight';
  if (q === 0 && hh === 12) return 'noon';
  const next = (hh + (q === 3 ? 1 : 0)) % 24;
  const word = HOUR[next % 12], ampm = next < 12 ? 'a.m.' : 'p.m.';
  const tail = next === 0 ? 'midnight' : next === 12 ? 'noon' : `${word} ${ampm}`;
  return q === 0 ? `${word} ${ampm}` : q === 1 ? `quarter past ${tail}` : q === 2 ? `half past ${tail}` : `quarter to ${tail}`;
}
export function claudiaTimeSpeak(h, min) { const c = spokenClock(h, min); return [`Time travelled to ${c}${c.endsWith('.') ? '' : '.'}`, 'Don\'t tell the physicists.']; }
export const CLAUDIA_TIMES = Array.from({ length: 96 }, (_, i) => [Math.floor(i / 4), (i % 4) * 15]);

const SPAWN_PLURAL = { infernus: 'Infernus supercars', stinger: 'Stinger convertibles', taxi: 'taxis', bus: 'double-decker buses', police: 'police cars', lorry: 'lorries', van: 'vans', mpv: 'M.P.V.s', suv: 'S.U.V.s', luxury: 'limousines', bike: 'motorbikes', sedan: 'sedans' };
const SPAWN_ONE = { infernus: 'Infernus', stinger: 'Stinger', taxi: 'taxi', bus: 'double-decker bus', police: 'police car', lorry: 'lorry', van: 'van', mpv: 'M.P.V.', suv: 'S.U.V.', luxury: 'limousine', bike: 'motorbike', sedan: 'sedan' };
const COUNT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export const SPAWN_TYPES = Object.keys(SPAWN_PLURAL);
export function claudiaSpawnSpeak(n, type) {
  const N = String(COUNT[n] || n).replace(/^./, c => c.toUpperCase());
  return n > 1 ? [`${N} ${SPAWN_PLURAL[type] || type + 's'} deployed.`, 'Parking fines are your problem.']
    : `One ${SPAWN_ONE[type] || type}, freshly vibe-coded, on the nearest road.`;
}
export const claudiaAutopilotSpeak = name => [`Autopilot to ${name}.`, 'Hands off the wheel. Or don\'t, I\'m not your mum.'];
export const claudiaTeleportSpeak = name => [`Teleported to ${name}.`, 'Grab-equivalent fare: S$0. Physics: questionable.'];

// ---- kopi orders: uncles bark them as terms ("Kopi-C, siew dai, peng!"), tourists in English phrases. Each term is
// a short clip in two forms (mid-order, and order-ending); the clip keys are synthetic, not subtitles.
export const kopiTermKey = (term, end) => `kopi order ${end ? 'end' : 'mid'} ${term}`;
export const kopiTermSpeak = (term, end) => end ? `${term}!` : `${term},`;
export const kopiPhraseKey = (part, end) => `kopi english ${end ? 'end' : 'mid'} ${part}`;
export const kopiPhraseSpeak = (part, end) => end ? `${part}, please?` : `${part},`;

/** play pre-rendered clips back to back as one line; resolves when done or when the line is cut off (Enter, another
 *  line). Plays nothing unless EVERY clip exists (no half-voiced lines). */
export async function playSeq(audio, role, texts, { interrupt = true } = {}) {
  const v = audio?.voice;
  if (!v || !role || !texts.length || !texts.every(t => v.hasVO?.(role, t))) return false;
  if (interrupt) v.stopDialogue?.(); else if (v.dialogue > 0) return false;
  v.prefetch?.(role, texts);
  await new Promise(r => setTimeout(r, 120)); // let the clips decode so the parts join without gaps
  for (const t of texts) {
    const t0 = performance.now(), dur = v.lineDuration?.(role, t) || 0;
    await audio.say(t, { voice: role });
    if (dur && performance.now() - t0 < dur * 700) return false; // stopped early: drop the rest of the line
  }
  return true;
}
