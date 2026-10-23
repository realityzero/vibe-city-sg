// Music theory + generative helpers (pure functions, deterministic given an rng).
import { pick } from './util.js';

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

/** Scale degree (any integer, 0 = tonic) -> midi note. */
export function deg2midi(root, scale, deg) {
  const n = scale.length;
  const o = Math.floor(deg / n);
  const i = ((deg % n) + n) % n;
  return root + scale[i] + 12 * o;
}

/** Diatonic chord on a degree: size 3 = triad, 4 = 7th, 5 = 9th. */
export function chordNotes(root, scale, deg, size = 3) {
  const out = [];
  for (let k = 0; k < size; k++) out.push(deg2midi(root, scale, deg + k * 2));
  return out;
}

/** Moves every chord tone by octaves into [center-6, center+6) and sorts — cheap voice leading. */
export function voice(notes, center) {
  const out = notes.map(n => {
    let m = n;
    while (m < center - 6) m += 12;
    while (m >= center + 6) m -= 12;
    return m;
  });
  out.sort((a, b) => a - b);
  // de-duplicate unisons
  for (let i = 1; i < out.length; i++) if (out[i] === out[i - 1]) out[i] += 12;
  return out;
}

/** Octave shift so a midi note lands inside [lo, hi]. */
export function fit(n, lo, hi) {
  while (n < lo) n += 12;
  while (n > hi) n -= 12;
  return n;
}

/**
 * A 2-bar melodic motif in 16th steps (0..31). Each note: s step, l length (steps), o degree offset
 * relative to the current chord root, o2 an alternative offset used on the answering phrase.
 */
export function makeMotif(rng, { density = 0.55, longNotes = 0.3, grid = 1, leap = 0.25, pickup = 0.3 } = {}) {
  const notes = [];
  let s = rng() < pickup ? pick(rng, [0, 2]) : 0;
  let prev = pick(rng, [0, 2, 4]);
  while (s < 32) {
    if (rng() < density || (s === 0 && notes.length === 0)) {
      const strong = s % 8 === 0 || s % 8 === 4 && rng() < 0.5;
      let o;
      if (strong) o = pick(rng, [0, 2, 4, 4, 2, 7, 0]);
      else if (rng() < leap) o = prev + pick(rng, [-3, 3, 2, -2, 4]);
      else o = prev + pick(rng, [-1, 1, -1, 1, 2, -2, 0]);
      o = Math.max(-3, Math.min(9, o));
      let l = rng() < longNotes ? pick(rng, [4, 6, 8, 4]) : pick(rng, [1, 2, 2, 3, 2]);
      l = Math.max(grid, Math.round(l / grid) * grid);
      if (s + l > 32) l = 32 - s;
      notes.push({ s, l, o, o2: Math.max(-3, Math.min(9, o + pick(rng, [0, 1, -1, 2, 0, -2]))) });
      prev = o;
      s += l;
    } else s += pick(rng, [grid, 2 * grid, 2 * grid, 4]);
  }
  // make the phrase land on a stable tone
  const last = notes[notes.length - 1];
  if (last) { last.o = pick(rng, [0, 2, 4]); last.o2 = 0; }
  return notes;
}

/** Song form; returns [{type, bars, energy}] sized to hit roughly targetSec. */
export function makeStructure(rng, barDur, targetSec = 165, { introBars = 4, sectionBars = 8, hasBridge = true } = {}) {
  const sec = (type, bars, energy) => ({ type, bars, energy });
  const forms = [
    ['intro', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus', 'outro'],
    ['intro', 'verse', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus', 'chorus', 'outro'],
    ['intro', 'chorus', 'verse', 'chorus', 'verse', 'bridge', 'chorus', 'outro'],
    ['intro', 'verse', 'chorus', 'bridge', 'verse', 'chorus', 'chorus', 'outro'],
  ];
  let form = pick(rng, forms).slice();
  if (!hasBridge) form = form.filter(f => f !== 'bridge');
  const energy = { intro: 0.4, verse: 0.7, chorus: 1, bridge: 0.55, outro: 0.4 };
  const build = f => f.map(t => sec(t, t === 'intro' ? introBars : t === 'outro' ? 4 : t === 'bridge' ? (rng() < 0.5 ? 4 : 8) : sectionBars, energy[t]));
  let out = build(form);
  let total = out.reduce((a, s) => a + s.bars, 0) * barDur;
  // too long -> drop a verse/chorus pair; too short -> add a chorus before the outro
  let guard = 0;
  while (total > targetSec * 1.25 && guard++ < 4) {
    const i = out.findIndex((s, k) => k > 1 && s.type === 'verse');
    if (i < 0) break;
    out.splice(i, 1);
    total = out.reduce((a, s) => a + s.bars, 0) * barDur;
  }
  guard = 0;
  while (total < targetSec * 0.8 && guard++ < 4) {
    out.splice(out.length - 1, 0, sec('chorus', sectionBars, 1));
    total = out.reduce((a, s) => a + s.bars, 0) * barDur;
  }
  return out;
}
