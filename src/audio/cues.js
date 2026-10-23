// Hand-composed music cues: title theme, mission-passed jingle, pitch tension loop, finale anthem.
// Each cue is a "source" for SongPlayer: {bpm, totalBars, loop, loopTo, channels, timbre, barEvents(bar)}.
import { SCALES, chordNotes, voice, deg2midi, fit, makeMotif } from './theory.js';
import { mulberry32, hashInts, pick } from './util.js';

function pat(ev, ch, s, v, p, i) {
  for (let k = 0; k < 16; k++) {
    const c = s[k];
    if (c === '.') continue;
    ev.push({ ch, t: k / 4, d: 0.25, n: 0, v: c === 'x' ? v : c === 'o' ? v * 0.7 : v * 0.32, p, i });
  }
}
/** notes: [[step16, lenSteps, midi], ...] over many bars; emits the ones in `bar` (offset by firstBar). */
function phrase(ev, ch, notes, bar, firstBar, vel = 0.85, transpose = 0) {
  const rel = bar - firstBar;
  for (const [s, l, n] of notes) {
    if ((s >> 4) !== rel) continue;
    ev.push({ ch, t: (s & 15) / 4, d: (l / 4) * 0.95, n: n + transpose, v: vel * (s % 4 === 0 ? 1 : 0.88) });
  }
}

const sec = bpm => ({ beatDur: 60 / bpm, barDur: 240 / bpm });

// ------------------------------------------------------------------ title: A-minor synthwave
const TITLE_A = [[0, 6, 76], [6, 2, 74], [8, 4, 72], [12, 4, 71], [16, 6, 69], [22, 2, 72], [24, 8, 77], [32, 6, 76], [38, 2, 74], [40, 4, 72], [44, 4, 76], [48, 8, 74], [56, 4, 71], [60, 4, 67]];
const TITLE_B = [[0, 4, 72], [4, 4, 76], [8, 8, 81], [16, 6, 79], [22, 2, 77], [24, 8, 77], [32, 4, 76], [36, 4, 79], [40, 8, 84], [48, 12, 83], [60, 4, 79]];

const title = {
  name: 'title', ...sec(100), totalBars: 16, loop: true, loopTo: 4, swing: 0,
  channels: {
    kick: { gain: 0.72 }, snare: { gain: 0.5, gated: 0.7, rev: 0.12 }, hat: { gain: 0.26 }, perc: { gain: 0.4, rev: 0.2 },
    bass: { gain: 0.42 }, pad: { gain: 0.16, rev: 0.4 }, arp: { gain: 0.13, dly: 0.4, rev: 0.15 }, lead: { gain: 0.312, dly: 0.3, rev: 0.3 }, fx: { gain: 0.25, rev: 0.4 },
  },
  timbre: {
    kick: { inst: 'kick', p: { f0: 150, f1: 45, decay: 0.4, click: 1 } }, snare: { inst: 'snare', p: { decay: 0.22, tone: 190 } },
    hat: { inst: 'hat', p: { decay: 0.035 } }, perc: { inst: 'tom', p: {} },
    bass: { inst: 'bass', p: { wave: 'sawtooth', sub: 0.5, cutEnv: 1800, cut: 420, q: 5, sus: 0.6 } },
    pad: { inst: 'pad', p: { detune: 12, cut: 2000, attack: 0.5, release: 1 } },
    arp: { inst: 'pluck', p: { wave: 'square', cutHi: 4200, cutLo: 900, decay: 0.16 } },
    lead: { inst: 'lead', p: { wave: 'sawtooth', wave2: 'square', cut: 3000, vib: 0.007, det: 9 } },
    fx: { inst: 'crash', p: {} },
  },
  barEvents(bar) {
    const ev = [], root = 45, sc = SCALES.minor, prog = [0, 5, 2, 6], deg = prog[bar % 4];
    if (bar >= 2) pat(ev, 'kick', 'x...x...x...x...', 1);
    if (bar >= 4) { pat(ev, 'snare', '....x.......x...', 0.9); pat(ev, 'hat', 'xgogxgogxgogxgog', 0.7); }
    else pat(ev, 'hat', 'o.o.o.o.o.o.o.o.', 0.4);
    if (bar === 4 || bar === 12) ev.push({ ch: 'fx', t: 0, d: 2, n: 0, v: 0.8 });
    if (bar === 3 || bar === 11 || bar === 15) for (let k = 12; k < 16; k++) ev.push({ ch: 'perc', t: k / 4, d: 0.25, n: [55, 52, 48, 45][k - 12], v: 0.75 });
    const r = fit(deg2midi(root, sc, deg), 33, 44);
    if (bar >= 2) for (let k = 0; k < 8; k++) ev.push({ ch: 'bass', t: k * 0.5, d: 0.4, n: r + (k % 2 ? 12 : 0), v: k % 2 ? 0.75 : 0.95 });
    ev.push({ ch: 'pad', t: 0, d: 3.95, n: voice(chordNotes(root, sc, deg, 3), 64), v: 0.8 });
    const ar = voice(chordNotes(root, sc, deg, 4), 74);
    for (let k = 0; k < 16; k++) ev.push({ ch: 'arp', t: k / 4, d: 0.2, n: ar[k % ar.length], v: k % 4 ? 0.5 : 0.7 });
    if (bar >= 4 && bar < 8) phrase(ev, 'lead', TITLE_A, bar, 4);
    else if (bar >= 8 && bar < 12) phrase(ev, 'lead', TITLE_B, bar, 8);
    else if (bar >= 12) phrase(ev, 'lead', TITLE_A, bar, 12, 0.9, 12);
    return ev.sort((a, b) => a.t - b.t);
  },
};

// ------------------------------------------------------------------ mission passed: C-major brass fanfare
const missionPassed = {
  name: 'mission_passed', ...sec(128), totalBars: 2, loop: false, swing: 0,
  channels: {
    kick: { gain: 0.72 }, snare: { gain: 0.5, gated: 0.5, rev: 0.2 }, fx: { gain: 0.3, rev: 0.4 },
    brass: { gain: 0.3, rev: 0.3 }, lead: { gain: 0.364, rev: 0.3, dly: 0.12 }, bass: { gain: 0.45 }, bell: { gain: 0.18, rev: 0.4, dly: 0.2 },
  },
  timbre: {
    kick: { inst: 'kick', p: { f0: 160, f1: 48, decay: 0.4, click: 1 } }, snare: { inst: 'snare', p: { decay: 0.18 } }, fx: { inst: 'crash', p: { decay: 2.4 } },
    brass: { inst: 'brass', p: { cut: 3200, attack: 0.015, sus: 0.85 } }, lead: { inst: 'lead', p: { wave: 'square', wave2: 'sawtooth', cut: 4200, vib: 0.008 } },
    bass: { inst: 'bass', p: { wave: 'sawtooth', sub: 0.6, cutEnv: 1500, cut: 500, q: 3, sus: 0.8 } }, bell: { inst: 'bell', p: { ratio: 3.5, index: 2, decay: 1.2 } },
  },
  barEvents(bar) {
    const ev = [];
    if (bar === 0) {
      const C = [60, 64, 67, 72], Bb = [58, 62, 65, 70], FA = [57, 60, 65, 69];
      ev.push(
        { ch: 'brass', t: 0, d: 0.4, n: C, v: 0.9 }, { ch: 'brass', t: 0.75, d: 0.5, n: C, v: 0.85 },
        { ch: 'brass', t: 1.5, d: 0.6, n: Bb, v: 0.9 }, { ch: 'brass', t: 2.25, d: 0.6, n: FA, v: 0.9 },
        { ch: 'brass', t: 3, d: 4.5, n: [60, 64, 67, 72, 76], v: 1 },
        { ch: 'lead', t: 0, d: 0.4, n: 72, v: 0.8 }, { ch: 'lead', t: 0.5, d: 0.22, n: 76, v: 0.8 }, { ch: 'lead', t: 0.75, d: 0.6, n: 79, v: 0.9 },
        { ch: 'lead', t: 1.5, d: 0.6, n: 77, v: 0.85 }, { ch: 'lead', t: 2.25, d: 0.6, n: 81, v: 0.9 },
        { ch: 'lead', t: 3, d: 0.45, n: 79, v: 0.9 }, { ch: 'lead', t: 3.5, d: 3.6, n: 84, v: 1 },
        { ch: 'bass', t: 0, d: 0.4, n: 36, v: 1 }, { ch: 'bass', t: 0.75, d: 0.6, n: 36, v: 0.9 }, { ch: 'bass', t: 1.5, d: 0.6, n: 34, v: 0.9 },
        { ch: 'bass', t: 2.25, d: 0.6, n: 33, v: 0.9 }, { ch: 'bass', t: 3, d: 4, n: 36, v: 1 },
      );
      for (const t of [0, 0.75, 1.5, 2.25, 3]) ev.push({ ch: 'kick', t, d: 0.25, n: 0, v: 1 });
      for (let k = 9; k < 12; k++) ev.push({ ch: 'snare', t: k / 4, d: 0.25, n: 0, v: 0.4 + (k - 9) * 0.2 });
      ev.push({ ch: 'snare', t: 3, d: 0.25, n: 0, v: 1 }, { ch: 'fx', t: 3, d: 3, n: 0, v: 1 });
    } else {
      [72, 76, 79, 84, 88, 91].forEach((n, i) => ev.push({ ch: 'bell', t: 0.25 + i * 0.125, d: 0.6, n, v: 0.7 }));
      ev.push({ ch: 'kick', t: 2, d: 0.25, n: 0, v: 0.6 });
    }
    return ev.sort((a, b) => a.t - b.t);
  },
};

// ------------------------------------------------------------------ pitch tension: D harmonic minor pulse
const pitchTension = {
  name: 'pitch_tension', ...sec(108), totalBars: 8, loop: true, swing: 0,
  channels: {
    kick: { gain: 0.64 }, hat: { gain: 0.2 }, perc: { gain: 0.3, rev: 0.2 }, bass: { gain: 0.45 }, pad: { gain: 0.144, rev: 0.45 }, bell: { gain: 0.14, rev: 0.4, dly: 0.35 }, fx: { gain: 0.22, rev: 0.3 },
  },
  timbre: {
    kick: { inst: 'kick', p: { f0: 110, f1: 40, decay: 0.45 } }, hat: { inst: 'hat', p: { decay: 0.025, hp: 8500 } }, perc: { inst: 'rim', p: { f: 1200 } },
    bass: { inst: 'bass', p: { wave: 'sawtooth', cutEnv: 900, cut: 260, q: 6, sus: 0.3, d: 0.08 } },
    pad: { inst: 'pad', p: { detune: 14, cut: 1100, attack: 1.2, release: 1.5, sweep: 0.9 } },
    bell: { inst: 'bell', p: { ratio: 2.76, index: 1.8, decay: 1.5 } }, fx: { inst: 'riser', p: { to: 7000 } },
  },
  barEvents(bar) {
    const ev = [], root = 38, sc = SCALES.harmonicMinor, prog = [0, 0, 5, 5, 3, 3, 4, 4], deg = prog[bar];
    pat(ev, 'kick', 'x..x............', 0.9);
    pat(ev, 'hat', 'xgxgxgxgxgxgxgxg', 0.6);
    pat(ev, 'perc', 'x...x...x...x...', 0.5);
    const r = fit(deg2midi(root, sc, deg), 26, 37);
    for (let k = 0; k < 16; k++) ev.push({ ch: 'bass', t: k / 4, d: 0.2, n: r + (k % 4 === 3 ? 12 : 0), v: k % 4 ? 0.6 : 0.9 });
    if (bar % 2 === 0) {
      ev.push({ ch: 'pad', t: 0, d: 7.9, n: voice(chordNotes(root, sc, deg, 3), 62), v: 0.8 });
      [74, 77, 81, 80].forEach((n, i) => ev.push({ ch: 'bell', t: i * 0.5, d: 0.5, n: n + (bar >= 4 ? 2 : 0), v: 0.6 }));
    }
    if (bar === 7) ev.push({ ch: 'fx', t: 0, d: 4, n: 0, v: 0.8 });
    return ev.sort((a, b) => a.t - b.t);
  },
};

// ------------------------------------------------------------------ finale: D-major anthem
const FIN_A = [[0, 4, 78], [4, 4, 81], [8, 6, 86], [14, 2, 85], [16, 4, 83], [20, 4, 81], [24, 8, 76], [32, 4, 78], [36, 4, 81], [40, 4, 83], [44, 4, 86], [48, 8, 83], [56, 4, 81], [60, 4, 79]];
const FIN_B = [[0, 6, 78], [6, 2, 79], [8, 8, 81], [16, 4, 85], [20, 4, 83], [24, 8, 81], [32, 4, 86], [36, 4, 85], [40, 4, 83], [44, 4, 81], [48, 8, 79], [56, 8, 81]];

const finale = {
  name: 'finale', ...sec(118), totalBars: 16, loop: true, loopTo: 4, swing: 0,
  channels: {
    kick: { gain: 0.76 }, snare: { gain: 0.5, gated: 0.7, rev: 0.15 }, hat: { gain: 0.26 }, perc: { gain: 0.45, rev: 0.25 }, clap: { gain: 0.35, rev: 0.2 },
    bass: { gain: 0.45 }, pad: { gain: 0.16, rev: 0.45 }, arp: { gain: 0.12, dly: 0.4 }, brass: { gain: 0.2, rev: 0.3 }, lead: { gain: 0.325, rev: 0.3, dly: 0.25 }, fx: { gain: 0.28, rev: 0.4 },
  },
  timbre: {
    kick: { inst: 'kick', p: { f0: 155, f1: 46, decay: 0.38, click: 1 } }, snare: { inst: 'snare', p: { decay: 0.22, tone: 200 } }, hat: { inst: 'hat', p: { decay: 0.035 } },
    perc: { inst: 'tom', p: {} }, clap: { inst: 'clap', p: {} },
    bass: { inst: 'bass', p: { wave: 'sawtooth', sub: 0.5, cutEnv: 2000, cut: 520, q: 4, sus: 0.65 } },
    pad: { inst: 'pad', p: { detune: 10, cut: 2600, attack: 0.4, release: 1 } }, arp: { inst: 'pluck', p: { wave: 'sawtooth', cutHi: 4500, cutLo: 1100, decay: 0.15 } },
    brass: { inst: 'brass', p: { cut: 2800 } }, lead: { inst: 'lead', p: { wave: 'sawtooth', wave2: 'square', cut: 3600, vib: 0.008, det: 10 } },
    fx: { inst: 'crash', p: { decay: 2.4 } },
  },
  barEvents(bar) {
    const ev = [], root = 38, sc = SCALES.major, prog = [0, 4, 5, 3], deg = prog[bar % 4];
    const full = bar >= 4;
    if (full) {
      pat(ev, 'kick', 'x...x...x...x...', 1);
      pat(ev, 'snare', '....x.......x...', 0.9); pat(ev, 'clap', '....x.......x...', 0.6);
      pat(ev, 'hat', 'xgogxgogxgogxgog', 0.7);
    } else {
      ev.push({ ch: 'perc', t: 0, d: 0.25, n: 45, v: 0.5 + bar * 0.12 }, { ch: 'perc', t: 2, d: 0.25, n: 45, v: 0.5 + bar * 0.12 });
      if (bar === 3) for (let k = 8; k < 16; k++) ev.push({ ch: 'perc', t: k / 4, d: 0.25, n: [57, 55, 52, 50, 48, 47, 45, 43][k - 8], v: 0.6 + (k - 8) * 0.05 });
    }
    if (bar === 4 || bar === 8 || bar === 12) ev.push({ ch: 'fx', t: 0, d: 2, n: 0, v: 0.9 });
    const r = fit(deg2midi(root, sc, deg), 33, 44);
    if (full) for (let k = 0; k < 8; k++) ev.push({ ch: 'bass', t: k * 0.5, d: 0.42, n: r + (k % 2 ? 12 : 0), v: k % 2 ? 0.75 : 0.95 });
    else ev.push({ ch: 'bass', t: 0, d: 3.9, n: r, v: 0.8 });
    ev.push({ ch: 'pad', t: 0, d: 3.95, n: voice(chordNotes(root, sc, deg, 3), 66), v: 0.85 });
    if (full) {
      const ar = voice(chordNotes(root, sc, deg, 4), 76);
      for (let k = 0; k < 16; k++) ev.push({ ch: 'arp', t: k / 4, d: 0.2, n: ar[(k * 3) % ar.length], v: k % 4 ? 0.5 : 0.7 });
      const st = voice(chordNotes(root, sc, deg, 3), 70);
      ev.push({ ch: 'brass', t: 0, d: 0.6, n: st, v: 0.8 }, { ch: 'brass', t: 1.5, d: 0.3, n: st, v: 0.7 }, { ch: 'brass', t: 2.5, d: 1.3, n: st, v: 0.75 });
    } else ev.push({ ch: 'brass', t: 0, d: 3.8, n: voice(chordNotes(root, sc, deg, 3), 62), v: 0.5 + bar * 0.12 });
    if (bar >= 4 && bar < 8) phrase(ev, 'lead', FIN_A, bar, 4);
    else if (bar >= 8 && bar < 12) phrase(ev, 'lead', FIN_B, bar, 8);
    else if (bar >= 12) { phrase(ev, 'lead', FIN_A, bar, 12, 0.95); phrase(ev, 'brass', FIN_A, bar, 12, 0.5, -12); }
    return ev.sort((a, b) => a.t - b.t);
  },
};

// ------------------------------------------------------------------ garden rhapsody: Supertree light show
// Generative ambient orchestral/electronic suite, 48 bars (~2.7 min) per movement cycle. Each pass reseeds
// its melodies, voicings and twinkles, so the show never repeats exactly.
const GR_BARS = 48;
const GR_SECTIONS = [ // [startBar, name]
  [0, 'twilight'], [8, 'awakening'], [16, 'bloom'], [28, 'rhapsody'], [36, 'starfall'], [44, 'fade'],
];
const GR_PROGS = {
  twilight: [[0, 3], [0, 3, 5, 3]], awakening: [[0, 4, 5, 3], [5, 3, 0, 4]], bloom: [[0, 4, 5, 3], [3, 4, 2, 5], [0, 5, 3, 4]],
  rhapsody: [[3, 4, 2, 5], [3, 4, 0, 0], [5, 3, 0, 4]], starfall: [[5, 3, 0, 4], [0, 2, 3, 4]], fade: [[0, 3], [3, 0]],
};
const grCache = new Map();
function grPass(pass) {
  if (grCache.has(pass)) return grCache.get(pass);
  const rng = mulberry32(hashInts(2026, pass, 88));
  const plan = { root: pick(rng, [38, 40, 41, 43]), mode: rng() < 0.4 ? 'lydian' : 'major', progs: {}, motifs: {} };
  for (const [, name] of GR_SECTIONS) plan.progs[name] = pick(rng, GR_PROGS[name]);
  plan.motifs.bloom = makeMotif(rng, { density: 0.35, longNotes: 0.55, grid: 2 });
  plan.motifs.rhapsody = makeMotif(rng, { density: 0.5, longNotes: 0.4, grid: 2, leap: 0.35 });
  plan.motifs.starfall = makeMotif(rng, { density: 0.3, longNotes: 0.6, grid: 2 });
  grCache.set(pass, plan);
  if (grCache.size > 3) grCache.delete(grCache.keys().next().value);
  return plan;
}
const gardenRhapsody = {
  name: 'garden_rhapsody', ...sec(72), totalBars: GR_BARS * 1000, loop: true, swing: 0,
  channels: {
    strings: { gain: 0.2, rev: 0.55 }, choir: { gain: 0.14, rev: 0.6 }, bells: { gain: 0.13, rev: 0.6, dly: 0.35 }, arp: { gain: 0.1, dly: 0.45, rev: 0.3 },
    bass: { gain: 0.32 }, timp: { gain: 0.42, rev: 0.4 }, lead: { gain: 0.2, rev: 0.5, dly: 0.25 }, brass: { gain: 0.15, rev: 0.45 },
    piano: { gain: 0.2, rev: 0.5, dly: 0.2 }, shk: { gain: 0.12 }, kick: { gain: 0.45 }, fx: { gain: 0.22, rev: 0.5 },
  },
  timbre: {
    strings: { inst: 'pad', p: { wave: 'sawtooth', detune: 13, cut: 2400, attack: 1.4, release: 2 } },
    choir: { inst: 'pad', p: { wave: 'triangle', detune: 6, cut: 1500, attack: 1.8, release: 2.4 } },
    bells: { inst: 'bell', p: { ratio: 3.5, index: 1.4, decay: 2.2 } },
    arp: { inst: 'pluck', p: { wave: 'triangle', cutHi: 3800, cutLo: 1400, decay: 0.35 } },
    bass: { inst: 'sub', p: { cut: 300 } },
    timp: { inst: 'tom', p: { decay: 0.9 } },
    lead: { inst: 'lead', p: { wave: 'sawtooth', wave2: 'triangle', cut: 2600, vib: 0.007, attack: 0.18, det: 9, release: 0.5 } },
    brass: { inst: 'brass', p: { cut: 2400, attack: 0.12, release: 0.6 } },
    piano: { inst: 'piano', p: { cut: 3600 } },
    shk: { inst: 'shaker', p: {} },
    kick: { inst: 'kick', p: { f0: 100, f1: 42, decay: 0.55 } },
    fx: { inst: 'crash', p: { decay: 3 } },
  },
  barEvents(barAbs) {
    const pass = Math.floor(barAbs / GR_BARS), bar = barAbs % GR_BARS;
    const plan = grPass(pass);
    let si = 0; for (let i = 0; i < GR_SECTIONS.length; i++) if (bar >= GR_SECTIONS[i][0]) si = i;
    const [start, name] = GR_SECTIONS[si];
    const end = si + 1 < GR_SECTIONS.length ? GR_SECTIONS[si + 1][0] : GR_BARS;
    const bi = bar - start, prog = plan.progs[name], deg = prog[bi % prog.length];
    const sc = SCALES[plan.mode], root = plan.root;
    const rng = mulberry32(hashInts(pass, bar, 5150));
    const ev = [];
    const triad = (size, center) => voice(chordNotes(root, sc, deg, size), center);
    const bassN = fit(deg2midi(root, sc, deg), 33, 45);
    const twinkle = (n, lo, hi, vel) => {
      for (let k = 0; k < n; k++) {
        const deg2 = deg + [0, 2, 4, 7, 9][Math.floor(rng() * 5)];
        ev.push({ ch: 'bells', t: Math.floor(rng() * 8) / 2, d: 1, n: fit(deg2midi(root, sc, deg2), lo, hi), v: vel * (0.6 + rng() * 0.4) });
      }
    };
    const mel = (motif, ch, vel, baseDeg = 0) => {
      const half = bi % 2;
      for (const nt of motif) if ((nt.s >> 4) === half) ev.push({ ch, t: (nt.s & 15) / 4, d: (nt.l / 4) * 0.98, n: fit(deg2midi(root + 24, sc, deg + nt.o + baseDeg), 62, 86), v: vel });
    };
    ev.push({ ch: 'strings', t: 0, d: 3.95, n: triad(3, name === 'twilight' ? 60 : 64), v: name === 'twilight' || name === 'fade' ? 0.55 : 0.8 });
    if (name !== 'twilight' || bi >= 2) ev.push({ ch: 'bass', t: 0, d: 3.8, n: bassN, v: 0.7 });
    switch (name) {
      case 'twilight':
        twinkle(2 + Math.floor(rng() * 3), 76, 96, 0.6);
        if (bi >= 4) ev.push({ ch: 'choir', t: 0, d: 3.9, n: triad(3, 67), v: 0.6 });
        if (bar === 0) ev.push({ ch: 'fx', t: 0, d: 4, n: 0, v: 0.35 });
        break;
      case 'awakening': {
        const ar = triad(4, 72);
        for (let k = 0; k < 8; k++) ev.push({ ch: 'arp', t: k * 0.5, d: 0.45, n: ar[[0, 1, 2, 3, 2, 1, 2, 3][k] % ar.length], v: 0.4 + bi * 0.05 });
        ev.push({ ch: 'timp', t: 0, d: 0.5, n: fit(bassN, 38, 45), v: 0.5 + bi * 0.04 });
        twinkle(2, 79, 96, 0.5);
        if (bi === end - start - 1) ev.push({ ch: 'fx', t: 3, d: 1, n: 0, v: 0.4 });
        break;
      }
      case 'bloom': {
        const ar = triad(4, 74);
        for (let k = 0; k < 16; k++) ev.push({ ch: 'arp', t: k * 0.25, d: 0.22, n: ar[(k * 3) % ar.length], v: k % 4 ? 0.35 : 0.5 });
        ev.push({ ch: 'choir', t: 0, d: 3.9, n: triad(3, 67), v: 0.7 });
        pat(ev, 'shk', 'o.g.o.g.o.g.o.g.', 0.5);
        pat(ev, 'kick', 'x.......x.......', 0.55);
        if (bi >= 2) mel(plan.motifs.bloom, 'lead', 0.7, -2);
        twinkle(1, 84, 98, 0.45);
        break;
      }
      case 'rhapsody': {
        const ar = triad(4, 76);
        for (let k = 0; k < 16; k++) ev.push({ ch: 'arp', t: k * 0.25, d: 0.22, n: ar[[0, 2, 1, 3][k % 4] % ar.length], v: k % 4 ? 0.45 : 0.6 });
        ev.push({ ch: 'choir', t: 0, d: 3.9, n: triad(4, 69), v: 0.85 });
        ev.push({ ch: 'brass', t: 0, d: 1.8, n: triad(3, 62), v: 0.6 }, { ch: 'brass', t: 2, d: 1.8, n: triad(3, 62), v: 0.55 });
        pat(ev, 'kick', 'x.......x...x...', 0.75);
        pat(ev, 'shk', 'xgogxgogxgogxgog', 0.6);
        for (const t of [0, 2]) ev.push({ ch: 'timp', t, d: 0.5, n: fit(bassN, 38, 45), v: 0.8 });
        if (bi === 0) ev.push({ ch: 'fx', t: 0, d: 4, n: 0, v: 0.8 });
        if (bi === end - start - 1) for (let k = 8; k < 16; k++) ev.push({ ch: 'timp', t: k / 4, d: 0.25, n: 40, v: 0.4 + (k - 8) * 0.06 });
        mel(plan.motifs.rhapsody, 'lead', 0.85, 0);
        twinkle(3, 84, 100, 0.55);
        break;
      }
      case 'starfall': {
        const ch = triad(4, 70), down = ch.slice().reverse().map(n => n + 12).concat(ch.slice().reverse());
        for (let k = 0; k < 8; k++) ev.push({ ch: 'piano', t: k * 0.5, d: 1.2, n: down[k % down.length], v: 0.55 - k * 0.03 });
        mel(plan.motifs.starfall, 'bells', 0.55, 2);
        twinkle(2, 86, 100, 0.4);
        break;
      }
      case 'fade':
        ev.push({ ch: 'choir', t: 0, d: 3.9, n: triad(3, 64), v: 0.5 - bi * 0.08 });
        twinkle(1 + Math.floor(rng() * 2), 79, 96, 0.45);
        break;
    }
    return ev.sort((a, b) => a.t - b.t);
  },
};

export const CUES = { title, mission_passed: missionPassed, pitch_tension: pitchTension, finale, garden_rhapsody: gardenRhapsody };
