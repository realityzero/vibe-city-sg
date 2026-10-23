// Radio station definitions + the generative song engine.
// Every song is fully determined by (station seed, song index); every bar by (song seed, bar index),
// so a station keeps "playing" on its own clock while you are not listening.
import { mulberry32, hashInts, pick } from './util.js';
import { SCALES, deg2midi, chordNotes, voice, fit, makeMotif, makeStructure } from './theory.js';

// ------------------------------------------------------------------ pattern helpers
/** 16-char drum string: x accent, o normal, g ghost, - soft. */
function pat(ev, ch, s, v, p, i) {
  for (let k = 0; k < 16; k++) {
    const c = s.charCodeAt(k);
    if (c === 46) continue; // '.'
    const vv = c === 120 ? v : c === 111 ? v * 0.7 : c === 103 ? v * 0.32 : v * 0.5;
    ev.push({ ch, t: k / 4, d: 0.25, n: 0, v: vv, p, i });
  }
}
const chordV = (c, size, center, deg = c.chord) => voice(chordNotes(c.plan.root, c.plan.scale, deg, size), center);
const bassRoot = (c, deg = c.chord) => fit(deg2midi(c.plan.root, c.plan.scale, deg), 33, 44);
const fifthAbove = (c, deg = c.chord) => fit(deg2midi(c.plan.root, c.plan.scale, deg + 4), 36, 52);

function arp(c, ev, ch, notes, pattern, step, vel, len = 0.9) {
  const n = notes.length, steps = Math.round(4 / step);
  for (let k = 0; k < steps; k++) {
    let idx;
    if (pattern === 'up') idx = k % n;
    else if (pattern === 'down') idx = n - 1 - (k % n);
    else if (pattern === 'updown') { const per = Math.max(1, 2 * n - 2); const m = k % per; idx = m < n ? m : per - m; }
    else if (pattern === 'pairs') idx = [0, 2, 1, 3, 2, 3, 1, 2][k % 8] % n;
    else idx = Math.floor(c.rng() * n);
    ev.push({ ch, t: k * step, d: step * len, n: notes[idx], v: vel * (k % 4 === 0 ? 1 : 0.78) });
  }
}
function tomFill(ev, ch, from = 12) {
  const toms = [55, 50, 47, 43];
  const span = 16 - from;
  for (let k = from; k < 16; k++) ev.push({ ch, i: 'tom', t: k / 4, d: 0.25, n: toms[Math.min(3, Math.floor((k - from) * 4 / span))], v: 0.65 + (k - from) / span * 0.3 });
}
function snareRoll(ev, ch, from = 8) {
  for (let k = from; k < 16; k++) ev.push({ ch, t: k / 4, d: 0.25, n: 0, v: 0.35 + (k - from) / (16 - from) * 0.6 });
}
/** Plays the bar-half of a 2-bar motif over the current chord. */
function melody(c, ev, ch, motif, { base = 0, vel = 0.8, legato = 0.92, glide = false, oct = 0 } = {}) {
  const { plan, bi } = c;
  const half = bi % 2;
  const answer = (bi >> 1) % 2 === 1;
  let prev = 0;
  const lastNote = motif[motif.length - 1];
  for (const nt of motif) {
    if ((nt.s >> 4) !== half) continue;
    let o = answer && nt.s >= 20 ? nt.o2 : nt.o;
    if (c.last && nt === lastNote) o = 0;
    let n = fit(deg2midi(plan.leadRoot + oct * 12, plan.scale, c.chord + o + base), plan.leadLo, plan.leadHi);
    if (plan.penta) { const pc = ((n - plan.root) % 12 + 12) % 12; if (pc === 5) n -= 1; else if (pc === 11) n += 1; }
    ev.push({ ch, t: (nt.s & 15) / 4, d: (nt.l / 4) * legato, n, v: vel * (nt.s % 4 === 0 ? 1 : 0.86), p: glide && prev && Math.abs(prev - n) < 8 ? { glideFrom: prev } : undefined });
    prev = n;
  }
}

// ------------------------------------------------------------------ genres
const COMMON_MAJOR = [[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 4, 3], [3, 4, 0, 0], [0, 4, 3, 4], [5, 4, 3, 4], [0, 2, 3, 4]];
const COMMON_MINOR = [[0, 5, 2, 6], [0, 5, 3, 4], [0, 3, 5, 6], [5, 6, 0, 0], [0, 6, 5, 6], [0, 3, 6, 2], [0, 2, 5, 4]];

const SYNTHPOP = {
  bpm: [112, 128], modes: ['major', 'minor', 'major', 'mixolydian'], root: [36, 47], target: 170,
  progs: { major: COMMON_MAJOR, minor: COMMON_MINOR, mixolydian: [[0, 6, 3, 0], [0, 3, 6, 3], [0, 6, 5, 6]] },
  motif: { verse: { density: 0.5, longNotes: 0.3 }, chorus: { density: 0.62, longNotes: 0.35, leap: 0.3 }, bridge: { density: 0.42, longNotes: 0.5 } },
  channels: {
    kick: { gain: 0.76 }, snare: { gain: 0.5, gated: 0.6, rev: 0.08 }, hat: { gain: 0.3 }, perc: { gain: 0.42, rev: 0.12, gated: 0.2 },
    bass: { gain: 0.42 }, pad: { gain: 0.16, rev: 0.32 }, arp: { gain: 0.12, dly: 0.35, rev: 0.12 }, lead: { gain: 0.26, dly: 0.25, rev: 0.25 }, fx: { gain: 0.28, rev: 0.3 },
  },
  extra: rng => ({ kickPat: pick(rng, ['x.......x.x.....', 'x.....x.x.......', 'x.......x.......', 'x..x....x.......']), verseArp: rng() < 0.5, arpPat: pick(rng, ['up', 'updown', 'pairs']) }),
  timbre: rng => ({
    kick: { inst: 'kick', p: { f0: 150, f1: 46, decay: 0.36, click: 1 } },
    snare: { inst: 'snare', p: { decay: 0.2, hp: 900, tone: 195 } },
    hat: { inst: 'hat', p: { decay: 0.035 } },
    perc: { inst: 'clap', p: {} },
    bass: { inst: 'bass', p: { wave: 'sawtooth', sub: 0.5, cutEnv: 1900, cut: pick(rng, [380, 520]), q: 5, sus: 0.6, d: 0.15 } },
    pad: { inst: 'pad', p: { wave: 'sawtooth', detune: 11, cut: pick(rng, [1500, 2300]), attack: 0.3, release: 0.7 } },
    arp: { inst: 'pluck', p: { wave: pick(rng, ['square', 'sawtooth']), cutHi: 4200, cutLo: 900, decay: 0.17 } },
    lead: { inst: 'lead', p: { wave: pick(rng, ['square', 'sawtooth']), wave2: 'sawtooth', cut: pick(rng, [2400, 3400]), vib: 0.006, det: 8 } },
    fx: { inst: 'crash', p: {} },
  }),
  bar(c, ev) {
    const { type, bi, last, first, plan, rng } = c;
    const intro = type === 'intro', outro = type === 'outro', chorus = type === 'chorus', bridge = type === 'bridge', verse = type === 'verse';
    const drums = !(intro && bi < 2) && !(bridge && bi < 2) && !(outro && bi >= 2);
    if (drums) {
      pat(ev, 'kick', chorus ? 'x...x...x...x...' : plan.kickPat, 1);
      pat(ev, 'snare', '....x.......x...', 0.9);
      if (chorus) pat(ev, 'perc', '....x.......x...', 0.55);
      pat(ev, 'hat', chorus ? 'xgogxgogxgogxgog' : 'x.o.x.o.x.o.x.o.', 0.75);
    } else pat(ev, 'hat', 'o.o.o.o.o.o.o.o.', 0.4);
    if (first && (chorus || (verse && c.sec.start > 4))) ev.push({ ch: 'fx', t: 0, d: 2, n: 0, v: 0.7 });
    if (last && !outro && drums && c.nextType !== 'outro') tomFill(ev, 'perc', rng() < 0.5 ? 12 : 8);
    if (!(intro && bi < 2) && !(outro && bi >= 3)) {
      const r = bassRoot(c);
      for (let k = 0; k < 8; k++) ev.push({ ch: 'bass', t: k * 0.5, d: 0.4, n: r + (chorus && k % 2 ? 12 : 0), v: k % 2 ? 0.72 : 0.95 });
    }
    ev.push({ ch: 'pad', t: 0, d: 3.9, n: chordV(c, 3, 64), v: chorus ? 0.85 : 0.65 });
    if (intro || chorus || bridge || plan.verseArp) arp(c, ev, 'arp', chordV(c, 4, 74), plan.arpPat, 0.25, chorus ? 0.7 : 0.55, 0.8);
    if (verse) melody(c, ev, 'lead', plan.motifs.verse, { base: -2, vel: 0.72 });
    else if (chorus) melody(c, ev, 'lead', plan.motifs.chorus, { vel: 0.85 });
    else if (bridge && bi >= 2) melody(c, ev, 'lead', plan.motifs.bridge, { base: 2, vel: 0.68 });
  },
};

const DARKWAVE = {
  bpm: [118, 138], modes: ['minor', 'phrygian', 'dorian', 'minor'], root: [36, 45], target: 175,
  progs: { minor: [[0, 5, 2, 6], [0, 6, 5, 6], [0, 3, 5, 4], [0, 5, 6, 4], [0, 0, 5, 6]], phrygian: [[0, 1, 0, 6], [0, 1, 5, 1], [0, 6, 1, 0]], dorian: [[0, 3, 0, 3], [0, 6, 3, 0], [0, 4, 6, 3]] },
  motif: { verse: { density: 0.38, longNotes: 0.5, grid: 2 }, chorus: { density: 0.5, longNotes: 0.45, grid: 2, leap: 0.35 }, bridge: { density: 0.3, longNotes: 0.6, grid: 2 } },
  channels: {
    kick: { gain: 0.72 }, snare: { gain: 0.5, gated: 0.75, rev: 0.1 }, hat: { gain: 0.24 }, perc: { gain: 0.4, rev: 0.2 },
    bass: { gain: 0.45 }, pad: { gain: 0.136, rev: 0.45 }, arp: { gain: 0.15, dly: 0.45, rev: 0.25 }, lead: { gain: 0.234, dly: 0.3, rev: 0.35 }, fx: { gain: 0.25, rev: 0.4 },
  },
  extra: rng => ({ bassPat: pick(rng, [[0, 0, 0, 0, 0, 0, 12, 0], [0, 0, 12, 0, 0, 0, 7, 0], [0, 0, 0, 12, 0, 0, 0, 12], [0, 12, 0, 12, 0, 12, 0, 12]]), arpPat: pick(rng, ['updown', 'up', 'pairs']) }),
  timbre: rng => ({
    kick: { inst: 'kick', p: { f0: 135, f1: 42, decay: 0.32, click: 0.6 } },
    snare: { inst: 'snare', p: { decay: 0.16, hp: 1300, tone: 210, body: 0.35 } },
    hat: { inst: 'hat', p: { decay: 0.03, hp: 8000 } },
    perc: { inst: 'clap', p: { f: 1400 } },
    bass: { inst: 'bass', p: { wave: 'sawtooth', cutEnv: 2600, cut: pick(rng, [520, 700]), q: 3, sus: 0.5, d: 0.1, drive: true } },
    pad: { inst: 'pad', p: { wave: 'sawtooth', detune: 14, cut: pick(rng, [900, 1300]), attack: 0.6, release: 1.2, sweep: 0.8 } },
    arp: { inst: 'pluck', p: { wave: 'sawtooth', wave2: 'sawtooth', det: 11, cutHi: 3000, cutLo: 1200, decay: 0.32, bp: 1500 } },
    lead: { inst: 'lead', p: { wave: 'sawtooth', wave2: 'square', cut: pick(rng, [1600, 2200]), vib: 0.005, det: 12, glide: 0.07 } },
    fx: { inst: 'crash', p: { decay: 2.2 } },
  }),
  bar(c, ev) {
    const { type, bi, last, first, plan } = c;
    const intro = type === 'intro', outro = type === 'outro', chorus = type === 'chorus', bridge = type === 'bridge', verse = type === 'verse';
    const fullDrums = !(intro && bi < 2) && !bridge && !(outro && bi >= 2);
    if (fullDrums) {
      pat(ev, 'kick', chorus || verse ? 'x...x...x...x...' : 'x.......x.......', 1);
      pat(ev, 'snare', '....x.......x...', 0.85);
      pat(ev, 'hat', chorus ? 'xgxgxgxgxgxgxgxg' : 'x.x.x.x.x.x.x.x.', 0.65);
    } else if (bridge) pat(ev, 'kick', 'x.......x.......', 0.7);
    if (first && chorus) ev.push({ ch: 'fx', t: 0, d: 2, n: 0, v: 0.6 });
    if (last && fullDrums && c.nextType === 'chorus') snareRoll(ev, 'snare', 8);
    if (!(intro && bi < 2) && !(outro && bi >= 2)) {
      const r = bassRoot(c);
      for (let k = 0; k < 8; k++) ev.push({ ch: 'bass', t: k * 0.5, d: 0.42, n: r + plan.bassPat[k], v: k % 2 ? 0.75 : 0.95 });
    }
    ev.push({ ch: 'pad', t: 0, d: 3.95, n: chordV(c, 3, 60), v: 0.7 });
    if (!(outro && bi >= 3)) arp(c, ev, 'arp', chordV(c, 4, 67), plan.arpPat, 0.5, chorus ? 0.75 : 0.62, 0.95);
    if (verse && bi >= 2) melody(c, ev, 'lead', plan.motifs.verse, { base: -1, vel: 0.7, glide: true });
    else if (chorus) melody(c, ev, 'lead', plan.motifs.chorus, { base: 1, vel: 0.85, glide: true });
    else if (bridge) melody(c, ev, 'lead', plan.motifs.bridge, { base: 3, vel: 0.65, glide: true });
  },
};

const DISCO = {
  bpm: [112, 124], modes: ['dorian', 'minor', 'major', 'dorian'], root: [38, 45], target: 175,
  progs: { dorian: [[0, 3, 0, 3], [0, 4, 0, 4], [0, 3, 6, 4], [1, 4, 0, 0]], minor: [[0, 3, 0, 3], [0, 6, 5, 6], [0, 5, 3, 4]], major: [[1, 4, 0, 5], [0, 3, 1, 4], [3, 4, 2, 5], [0, 5, 1, 4]] },
  motif: { verse: { density: 0.45, longNotes: 0.25 }, chorus: { density: 0.58, longNotes: 0.4, leap: 0.3 }, bridge: { density: 0.35, longNotes: 0.55 } },
  channels: {
    kick: { gain: 0.76 }, snare: { gain: 0.42, rev: 0.12 }, perc: { gain: 0.4, rev: 0.15 }, hat: { gain: 0.3 }, shk: { gain: 0.22 },
    bass: { gain: 0.5 }, keys: { gain: 0.24, rev: 0.15 }, chick: { gain: 0.3, rev: 0.1 }, pad: { gain: 0.128, rev: 0.4 }, stab: { gain: 0.16, rev: 0.25 },
    lead: { gain: 0.234, dly: 0.18, rev: 0.32 }, fx: { gain: 0.25, rev: 0.3 },
  },
  extra: rng => ({ verseLead: rng() < 0.4, ghost: rng() < 0.6 }),
  timbre: rng => ({
    kick: { inst: 'kick', p: { f0: 140, f1: 50, decay: 0.3, click: 0.8 } },
    snare: { inst: 'snare', p: { decay: 0.15, hp: 1100, tone: 200 } },
    perc: { inst: 'clap', p: {} },
    hat: { inst: 'hat', p: { decay: 0.03, openDecay: 0.2 } },
    shk: { inst: 'shaker', p: {} },
    bass: { inst: 'slap', p: { cut: pick(rng, [600, 800]) } },
    keys: { inst: 'ep', p: { index: 1.3, decay: 0.8, trem: 4.5 } },
    chick: { inst: 'chick', p: { f: pick(rng, [1500, 1900]) } },
    pad: { inst: 'pad', p: { wave: 'sawtooth', detune: 13, cut: 3200, attack: 0.25, release: 0.5 } },
    stab: { inst: 'brass', p: { cut: 3000, attack: 0.012, sus: 0.6, release: 0.1 } },
    lead: { inst: 'lead', p: { wave: 'sawtooth', wave2: 'sawtooth', cut: 3800, vib: 0.009, det: 14, attack: 0.04, mix2: 0.9 } },
    fx: { inst: 'crash', p: {} },
  }),
  bar(c, ev) {
    const { type, bi, last, first, plan } = c;
    const intro = type === 'intro', outro = type === 'outro', chorus = type === 'chorus', bridge = type === 'bridge', verse = type === 'verse';
    const kick = !(intro && bi < 2) && !(bridge && bi < 4);
    if (kick) pat(ev, 'kick', 'x...x...x...x...', 1);
    if (!(intro && bi < 2)) {
      pat(ev, 'snare', '....x.......x...', 0.85);
      pat(ev, 'perc', '....x.......x...', 0.6);
      pat(ev, 'hat', '..x...x...x...x.', 0.8, { open: true });
      pat(ev, 'shk', 'xgogxgogxgogxgog', 0.7);
    } else pat(ev, 'hat', '..x...x...x...x.', 0.6, { open: true });
    if (first && chorus) ev.push({ ch: 'fx', t: 0, d: 2, n: 0, v: 0.65 });
    if (last && c.nextType === 'chorus') snareRoll(ev, 'snare', 12);
    if (!(outro && bi >= 3)) {
      const r = bassRoot(c);
      for (let k = 0; k < 8; k++) ev.push({ ch: 'bass', t: k * 0.5, d: 0.3, n: r + (k % 2 ? 12 : 0), v: k % 2 ? 0.8 : 1 });
      if (plan.ghost) ev.push({ ch: 'bass', t: 1.75, d: 0.2, n: r + 10, v: 0.5 }, { ch: 'bass', t: 3.75, d: 0.2, n: r + 7, v: 0.55 });
    }
    const ch7 = chordV(c, 4, 66);
    if (verse || intro) {
      ev.push({ ch: 'keys', t: 0, d: 0.75, n: ch7, v: 0.7 }, { ch: 'keys', t: 1.5, d: 0.4, n: ch7, v: 0.55 }, { ch: 'keys', t: 2.5, d: 0.75, n: ch7, v: 0.65 });
    }
    if (!(intro && bi < 2)) {
      const tri = chordV(c, 3, 72);
      pat(ev, 'chick', '..x.x..x..x.x..x', 0.55);
      for (const e of ev) if (e.ch === 'chick' && e.n === 0) e.n = tri;
    }
    if (chorus || bridge) ev.push({ ch: 'pad', t: 0, d: 3.9, n: chordV(c, 4, 74), v: 0.8 });
    if (chorus) { const st = chordV(c, 3, 70); ev.push({ ch: 'stab', t: 1.5, d: 0.25, n: st, v: 0.7 }, { ch: 'stab', t: 3.5, d: 0.25, n: st, v: 0.75 }); }
    if (chorus) melody(c, ev, 'lead', plan.motifs.chorus, { base: 2, vel: 0.85 });
    else if (verse && plan.verseLead && bi >= 4) melody(c, ev, 'lead', plan.motifs.verse, { vel: 0.6 });
    else if (bridge) melody(c, ev, 'lead', plan.motifs.bridge, { base: 4, vel: 0.65 });
  },
};

const BALLAD = {
  bpm: [70, 86], modes: ['major', 'major', 'minor'], root: [36, 46], target: 185,
  progs: { major: [[0, 4, 5, 3], [3, 4, 0, 5], [0, 5, 3, 4], [5, 3, 0, 4], [0, 2, 3, 4], [3, 0, 4, 5]], minor: [[0, 5, 2, 6], [5, 6, 0, 0], [0, 3, 6, 2]] },
  motif: { verse: { density: 0.42, longNotes: 0.45, grid: 2 }, chorus: { density: 0.48, longNotes: 0.55, grid: 2, leap: 0.35 }, bridge: { density: 0.7, longNotes: 0.2, leap: 0.4 } },
  form: { introBars: 2, sectionBars: 8 },
  channels: {
    kick: { gain: 0.72 }, snare: { gain: 0.48, gated: 0.85, rev: 0.4 }, hat: { gain: 0.22 }, perc: { gain: 0.42, rev: 0.3 },
    bass: { gain: 0.42 }, keys: { gain: 0.26, rev: 0.35 }, pad: { gain: 0.144, rev: 0.45 }, lead: { gain: 0.286, rev: 0.45, dly: 0.12 }, solo: { gain: 0.24, rev: 0.4, dly: 0.25 }, fx: { gain: 0.25, rev: 0.4 },
  },
  extra: rng => ({ leadInst: rng() < 0.6 ? 'sax' : 'lead' }),
  timbre: rng => ({
    kick: { inst: 'kick', p: { f0: 120, f1: 44, decay: 0.5, click: 0.4 } },
    snare: { inst: 'snare', p: { decay: 0.26, hp: 700, tone: 175, body: 0.7 } },
    hat: { inst: 'hat', p: { decay: 0.05 } },
    perc: { inst: 'tom', p: {} },
    bass: { inst: 'bass', p: { wave: 'sawtooth', cutEnv: 900, cut: 380, q: 1, sus: 0.85, d: 0.4, release: 0.15 } },
    keys: { inst: 'piano', p: { cut: 3400 } },
    pad: { inst: 'pad', p: { wave: 'sawtooth', detune: 8, cut: 2200, attack: 0.7, release: 1.4 } },
    lead: { inst: 'sax', p: {} },
    solo: { inst: 'gtr', p: { cut: 2800, drive: 4 } },
    fx: { inst: 'crash', p: { decay: 2.6 } },
  }),
  bar(c, ev) {
    const { type, bi, last, first, plan } = c;
    const intro = type === 'intro', outro = type === 'outro', chorus = type === 'chorus', bridge = type === 'bridge', verse = type === 'verse';
    if (plan.leadInst !== 'sax') ev.leadInst = 'lead';
    const drums = (verse && bi >= 2) || chorus || bridge;
    if (drums) {
      pat(ev, 'kick', chorus ? 'x.........x.x...' : 'x.........x.....', 1);
      pat(ev, 'snare', '....x.......x...', chorus ? 1 : 0.8);
      pat(ev, 'hat', chorus ? 'x.o.x.o.x.o.x.o.' : 'o.o.o.o.o.o.o.o.', 0.5);
    }
    if (first && chorus) ev.push({ ch: 'fx', t: 0, d: 3, n: 0, v: 0.8 });
    if (last && c.nextType === 'chorus') tomFill(ev, 'perc', 8);
    if (!intro) {
      const r = bassRoot(c);
      ev.push({ ch: 'bass', t: 0, d: 1.9, n: r, v: 0.9 }, { ch: 'bass', t: 2, d: 1.9, n: c.rng() < 0.5 ? r : fit(fifthAbove(c), r, r + 12), v: 0.8 });
    }
    if (!chorus || bi % 2 === 0) {
      const ch = chordV(c, 3, 62);
      const tones = [ch[0], ch[1], ch[2], ch[0] + 12, ch[1] + 12, ch[0] + 12, ch[2], ch[1]];
      for (let k = 0; k < 8; k++) ev.push({ ch: 'keys', t: k * 0.5, d: 0.9, n: tones[k], v: k === 0 ? 0.75 : 0.55 });
    } else ev.push({ ch: 'keys', t: 0, d: 3.8, n: chordV(c, 4, 64), v: 0.7 });
    if (chorus || bridge || outro) ev.push({ ch: 'pad', t: 0, d: 3.95, n: chordV(c, 3, 67), v: 0.8 });
    if (verse) melody(c, ev, 'lead', plan.motifs.verse, { base: -2, vel: 0.75, legato: 0.98 });
    else if (chorus) melody(c, ev, 'lead', plan.motifs.chorus, { base: 1, vel: 0.85, legato: 0.98 });
    else if (bridge) melody(c, ev, 'solo', plan.motifs.bridge, { base: 2, vel: 0.85, glide: true });
  },
};

const LOFI = {
  bpm: [72, 88], modes: ['major', 'dorian', 'minor', 'major'], root: [36, 45], target: 150, swing: 0.2,
  progs: { major: [[1, 4, 0, 0], [3, 2, 1, 0], [0, 5, 1, 4], [3, 4, 2, 5], [0, 3, 2, 5]], dorian: [[0, 3, 0, 3], [0, 6, 3, 4], [1, 0, 6, 0]], minor: [[0, 3, 6, 2], [0, 5, 3, 6], [5, 4, 3, 0]] },
  motif: { verse: { density: 0.3, longNotes: 0.4, grid: 2 }, chorus: { density: 0.4, longNotes: 0.4, grid: 2 }, bridge: { density: 0.25, longNotes: 0.6, grid: 2 } },
  form: { introBars: 2, sectionBars: 8, hasBridge: false },
  channels: {
    kick: { gain: 0.68 }, snare: { gain: 0.42, rev: 0.1 }, hat: { gain: 0.22 }, perc: { gain: 0.3 },
    bass: { gain: 0.32 }, keys: { gain: 0.34, rev: 0.25 }, lead: { gain: 0.195, rev: 0.3, dly: 0.25 },
  },
  insert: 'lofi',
  extra: rng => ({ kickPat: pick(rng, ['x......x..x.....', 'x.....x...x..x..', 'x..x......x.....', 'x.......x.x.....']), hatPat: pick(rng, ['x.o.x.ogx.o.x.og', 'xgo.xgo.xgo.xgog', 'x.x.x.x.x.x.x.x.']), keysAlt: rng() < 0.5 }),
  timbre: rng => ({
    kick: { inst: 'kick', p: { f0: 120, f1: 50, decay: 0.32, drive: true } },
    snare: { inst: 'snare', p: { decay: 0.14, hp: 700, lp: 3000, tone: 170, body: 0.6 } },
    hat: { inst: 'hat', p: { decay: 0.04, lp: 7000, hp: 5000 } },
    perc: { inst: 'rim', p: {} },
    bass: { inst: 'sub', p: { cut: 380 } },
    keys: { inst: 'ep', p: { index: 1.0, decay: 1.6, trem: pick(rng, [0, 3.5]) } },
    lead: { inst: 'lead', p: { wave: 'triangle', wave2: 'sine', cut: 2200, vib: 0.004, attack: 0.03, det: 3 } },
  }),
  bar(c, ev) {
    const { type, bi, plan, rng } = c;
    const intro = type === 'intro', outro = type === 'outro', chorus = type === 'chorus', verse = type === 'verse';
    const drums = !(intro && bi < 1) && !(outro && bi >= 2);
    if (drums) {
      pat(ev, 'kick', plan.kickPat, 0.95);
      pat(ev, 'snare', '....x.......x...', 0.8);
      pat(ev, 'hat', plan.hatPat, 0.7);
      if (rng() < 0.3) ev.push({ ch: 'perc', t: 3.75, d: 0.25, n: 0, v: 0.4 });
      for (const e of ev) if (e.ch === 'hat') e.v *= 0.8 + rng() * 0.3;
    }
    if (!intro) {
      const r = bassRoot(c);
      ev.push({ ch: 'bass', t: 0, d: 1.4, n: r, v: 0.9 });
      if (rng() < 0.6) ev.push({ ch: 'bass', t: 1.75, d: 0.5, n: r + 7, v: 0.6 });
      ev.push({ ch: 'bass', t: 2.5, d: 1.2, n: rng() < 0.5 ? r : bassRoot(c, c.next) + (rng() < 0.5 ? 1 : -1), v: 0.75 });
    }
    const ch = chordV(c, rng() < 0.4 ? 5 : 4, 62);
    if (plan.keysAlt) ev.push({ ch: 'keys', t: 0, d: 1.8, n: ch, v: 0.7 }, { ch: 'keys', t: 2.5, d: 1.4, n: ch, v: 0.55 });
    else ev.push({ ch: 'keys', t: 0, d: 3.8, n: ch, v: 0.75 }, { ch: 'keys', t: 3.5, d: 0.4, n: [ch[1] + 12], v: 0.4 });
    if (verse && bi >= 2) melody(c, ev, 'lead', plan.motifs.verse, { vel: 0.7 });
    else if (chorus) melody(c, ev, 'lead', plan.motifs.chorus, { base: 2, vel: 0.75 });
  },
};

// Xinyao: 80s Singapore campus folk — fingerpicked acoustic guitars, pentatonic melodies, gentle shaker.
const XINYAO = {
  bpm: [76, 98], modes: ['major', 'major', 'minor'], root: [38, 45], target: 175,
  progs: { major: [[0, 5, 3, 4], [0, 4, 5, 2], [3, 4, 2, 5], [0, 3, 0, 4], [5, 3, 4, 0], [0, 2, 3, 4]], minor: [[0, 5, 3, 4], [0, 3, 6, 2], [5, 6, 0, 4]] },
  motif: { verse: { density: 0.42, longNotes: 0.4, grid: 2 }, chorus: { density: 0.5, longNotes: 0.45, grid: 2, leap: 0.3 }, bridge: { density: 0.35, longNotes: 0.5, grid: 2 } },
  form: { introBars: 4, sectionBars: 8 },
  channels: {
    gtr: { gain: 0.42, rev: 0.22 }, strum: { gain: 0.3, rev: 0.2 }, bass: { gain: 0.36 }, shk: { gain: 0.2 }, kick: { gain: 0.5 }, rim: { gain: 0.25, rev: 0.15 },
    lead: { gain: 0.24, rev: 0.32, dly: 0.12 }, bell: { gain: 0.12, rev: 0.4, dly: 0.25 },
  },
  extra: rng => ({ penta: true, pickPat: pick(rng, [[0, 2, 1, 3, 2, 1, 3, 2], [0, 1, 2, 3, 1, 2, 3, 1], [0, 2, 3, 1, 2, 3, 1, 2]]), leadInst: rng() < 0.5 ? 'flute' : 'harmonica' }),
  timbre: rng => ({
    gtr: { inst: 'ks', p: { bright: pick(rng, [0.4, 0.6]), cut: 4500 } },
    strum: { inst: 'ks', p: { bright: 0.75, cut: 5200, strum: 0.012 } },
    bass: { inst: 'sub', p: { cut: 340 } },
    shk: { inst: 'shaker', p: {} },
    kick: { inst: 'kick', p: { f0: 110, f1: 48, decay: 0.3 } },
    rim: { inst: 'rim', p: { f: 1400 } },
    lead: { inst: 'lead', p: { wave: 'triangle', wave2: 'sine', cut: 2600, vib: 0.008, vibRate: 5, attack: 0.05, det: 4, mix2: 0.8 } },
    bell: { inst: 'bell', p: { ratio: 3.5, index: 1.2, decay: 1.3 } },
  }),
  bar(c, ev) {
    const { type, bi, plan, rng } = c;
    const intro = type === 'intro', outro = type === 'outro', chorus = type === 'chorus', bridge = type === 'bridge', verse = type === 'verse';
    if (plan.leadInst === 'harmonica') ev.leadInst = 'harmonica';
    // fingerpicking: alternating bass (root / fifth) + arpeggiated chord tones in 8ths
    const tri = chordV(c, 3, 62);
    const tones = [bassRoot(c) + 12, tri[0] + 12 > 70 ? tri[0] : tri[0] + 12, tri[1] + 12 > 74 ? tri[1] : tri[1] + 12, tri[2] + 12 > 76 ? tri[2] : tri[2] + 12];
    const fifth = fit(fifthAbove(c), 45, 57);
    for (let k = 0; k < 8; k++) {
      let n;
      if (k === 0) n = tones[0];
      else if (k === 4) n = fifth;
      else n = tones[1 + (plan.pickPat[k] % 3)];
      ev.push({ ch: 'gtr', t: k * 0.5, d: k % 4 === 0 ? 1.9 : 0.95, n, v: k % 4 === 0 ? 0.85 : 0.6 + rng() * 0.1 });
    }
    if (chorus || bridge) {
      const shape = [bassRoot(c) + 12, ...chordV(c, 3, 60), ...chordV(c, 3, 67)].sort((a, b) => a - b);
      const up = shape.slice().reverse();
      for (const [t, dir, v] of [[0, shape, 0.75], [1, shape, 0.55], [1.5, up, 0.45], [2.5, up, 0.45], [3, shape, 0.6], [3.5, up, 0.4]]) ev.push({ ch: 'strum', t, d: 0.45, n: dir, v });
    }
    if (!intro && !(outro && bi >= 2)) {
      ev.push({ ch: 'bass', t: 0, d: 1.8, n: bassRoot(c), v: 0.8 }, { ch: 'bass', t: 2, d: 1.8, n: rng() < 0.5 ? bassRoot(c) : fit(fifthAbove(c), 36, 48), v: 0.65 });
      pat(ev, 'shk', chorus ? 'x.o.x.o.x.o.x.o.' : 'o...o...o...o...', 0.55);
    }
    if (chorus) { pat(ev, 'kick', 'x.......x.......', 0.7); pat(ev, 'rim', '....x.......x...', 0.6); }
    if (verse && bi >= 2) melody(c, ev, 'lead', plan.motifs.verse, { base: -2, vel: 0.75, legato: 0.97 });
    else if (chorus) melody(c, ev, 'lead', plan.motifs.chorus, { base: 0, vel: 0.85, legato: 0.97 });
    else if (bridge) melody(c, ev, 'lead', plan.motifs.bridge, { base: 2, vel: 0.7 });
    if (chorus && c.first) ev.push({ ch: 'bell', t: 0, d: 1, n: fit(tones[1] + 12, 72, 88), v: 0.6 });
  },
};

const TALKBED = {
  bpm: [88, 96], modes: ['major'], root: [38, 43], target: 240,
  progs: { major: [[0, 3, 0, 4], [0, 5, 3, 4]] },
  motif: { verse: { density: 0.2 }, chorus: { density: 0.2 } },
  form: { introBars: 4, sectionBars: 8, hasBridge: false },
  channels: { hat: { gain: 0.12 }, bass: { gain: 0.3 }, keys: { gain: 0.16, rev: 0.3 }, bell: { gain: 0.15, rev: 0.4, dly: 0.3 } },
  insert: 'talk',
  extra: () => ({}),
  timbre: () => ({
    hat: { inst: 'hat', p: { decay: 0.03, lp: 7000 } },
    bass: { inst: 'sub', p: { cut: 300 } },
    keys: { inst: 'ep', p: { index: 0.8, decay: 2 } },
    bell: { inst: 'bell', p: { ratio: 3.5, index: 1.5, decay: 1.2 } },
  }),
  bar(c, ev) {
    pat(ev, 'hat', 'o...o...o...o...', 0.5);
    ev.push({ ch: 'bass', t: 0, d: 3, n: bassRoot(c), v: 0.7 });
    ev.push({ ch: 'keys', t: 0, d: 3.6, n: chordV(c, 4, 62), v: 0.6 });
  },
};

// ------------------------------------------------------------------ stations
export const STATIONS = [
  {
    id: 'flash', name: 'FLASH LAH 95.8', freq: '95.8', genre: '80s synth-pop', color: '#ff4fa3', seed: 958, g: SYNTHPOP,
    artists: ['Durian Duran', 'Orchard Manoeuvres in the Dark', 'The Pet Shophouse Boys', 'A-HDB', 'Tears for Kopi', 'Kim Wilde-Lim', 'Spandau Bayfront', 'Wham! Lah!', 'Bananarama Bay', 'Simple Minds Lah', 'Cyndi Lau Pa Sat', 'Thomas Dolby Ghaut'],
    titles: ['Chope My Heart', 'Love on the Downtown Line', 'ERP (Every Romance Pays)', "Don't You (Forget About My COE)", 'Take On Me (To Changi)', 'Girls Just Want to Have Kopi', 'Sweet Dreams (Are Made of Kaya)', 'Hungry Like the Merlion', 'Tainted Laksa', 'Wake Me Up Before You Kopi-O', 'Rio (Tinto Bay)', 'She Blinded Me With Data Science'],
    words: [['Neon', 'Midnight', 'Kiasu', 'Electric', 'Merlion', 'Tropical', 'Monsoon', 'Orchard', 'Marina', 'Satay', 'Downtown', 'Infinity'], ['Heart', 'Love', 'Nights', 'Dreams', 'Fever', 'Rain', 'Queue', 'Skyline', 'Romance', 'Kiss', 'Runway', 'Pool']],
    idents: ["You're listening to Flash Lah, ninety five point eight. All the hits. All the lah.", 'Flash Lah ninety five eight. The sound of the Lion City, nineteen eighty six forever.', 'Flash Lah. More hits than a hawker centre at lunch.'],
  },
  {
    id: 'wave', name: 'WAVE 103.SG', freq: '103.0', genre: 'new wave / darkwave', color: '#3fd1ff', seed: 1030, g: DARKWAVE,
    artists: ['Depeche Merlion', 'New Order of Merit', 'Joy Divisional Court', 'The Kiasu Cure', 'Siouxsie and the Shophouses', 'Talk Talk Lah', 'Gary Numan Bay', 'Visage Pasir Ris', 'Soft Cell Tower', 'Echo and the Bunnymen of Bugis'],
    titles: ['Blue Monday (Monsoon Mix)', "Just Can't Get Enough Bandwidth", 'Cold Hawker', 'Enjoy the Silence (Library at Esplanade)', 'Cars (Category B)', 'Tanjong Pagar Shadows', 'Love Will Tear Us Apart (Like a Pivot)', 'Fade to Grey (HDB Edition)', 'Tainted Shophouse', 'Boys Don\'t Cry (Founders Do)'],
    words: [['Cold', 'Grey', 'Silent', 'Concrete', 'Black', 'Distant', 'Static', 'Lonely', 'Glass', 'Electric'], ['Tower', 'Corridor', 'Void Deck', 'Signal', 'Harbour', 'Rain', 'Underpass', 'Static', 'Shadow', 'Terminal']],
    idents: ['Wave one oh three. Cold synths for a hot island.', 'This is Wave one oh three. Turn up the aircon, turn down the lights.', 'Wave one oh three dot S G. Darker than your burn rate.'],
  },
  {
    id: 'fever', name: 'FEVER 105 KOPI', freq: '105.0', genre: 'disco funk', color: '#ffb02e', seed: 1050, g: DISCO,
    artists: ['Bee Hoon Gees', 'Chic Rice', 'Donna Satay', 'Kool & The Kopi Gang', 'Earth, Wind & Haze', 'KC and the Sunshine Bay', 'Sister Sledgehammer', 'Gloria Gaynor-Tan', 'The Trammps of Tampines', 'Rose Royce Bridge'],
    titles: ["Stayin' Alive (Without Aircon)", "Le Freak (C'est Chic Rice)", 'Hot Stuff (Chilli Crab)', 'Celebration (IPO Mix)', 'I Will Survive (Series A)', 'Get Down On It (At the Hawker Centre)', 'Boogie Wonderland (Sentosa)', 'We Are Family (Office)', 'Disco Inferno (Burn Rate)', 'Car Wash (Category A)'],
    words: [['Boogie', 'Funky', 'Disco', 'Kopi', 'Satay', 'Groovy', 'Golden', 'Sentosa', 'Saturday', 'Shake'], ['Fever', 'Night', 'Machine', 'Thing', 'Train', 'Shake', 'Party', 'Wonderland', 'Lady', 'Man']],
    idents: ['Fever one oh five Kopi. Disco so smooth, it is kopi-o siew dai.', 'You are grooving to Fever one oh five. Put your hands up, then chope your seat.', 'Fever one oh five. Hot like the weather, sweet like condensed milk.'],
  },
  {
    id: 'emotion', name: 'EMOTION 88.3', freq: '88.3', genre: 'power ballads', color: '#c77dff', seed: 883, g: BALLAD,
    artists: ['Whitney Hustle-ton', 'Bonnie Tyler-Tan', 'Foreigner Talent', 'REO Speedwagon-R', 'Mr. Mister Lim', 'Toto-ly Kiasu', 'Phil Kollins-Koh', 'Chicago Lah', 'Air Supply Chain', 'Heart of Bishan'],
    titles: ['Total Eclipse of the Runway', 'I Want to Know What Funding Is', "Can't Fight This Pivot", 'Broken Wings (Startup Version)', 'Against All Odds (and All Fines)', "Hard to Say I'm Sorry (Term Sheet)", 'Careless Whisper (In the Coworking Space)', 'Kyrie (Chope a Seat)', 'Alone (Working From Home)', 'Making Love Out of Nothing at All (Our MVP)'],
    words: [['Endless', 'Burning', 'Broken', 'Forever', 'Tender', 'Lonely', 'Golden', 'Faithful', 'Midnight', 'Eternal'], ['Heart', 'Love', 'Runway', 'Promise', 'Dream', 'Tears', 'Night', 'Flame', 'Moment', 'Embrace']],
    idents: ['Emotion eighty eight three. For founders who cried at their own pitch.', 'You are listening to Emotion eighty eight point three. Hold someone close. Or your laptop.', 'Emotion eighty eight three. Love songs for the long nights before demo day.'],
  },
  {
    id: 'lofi', name: 'LO-FI HAWKER 91.3', freq: '91.3', genre: 'lo-fi hip hop', color: '#7cff9b', seed: 913, g: LOFI,
    artists: ['kaya.toast', 'sleepy uncle', 'aircon tuesday', 'void deck beats', 'teh peng', 'monsoon tapes', 'lo-fi lim', 'ah boy chill', 'kopitiam fan', 'mrt doors closing'],
    titles: ['chicken rice queue (11:58am)', 'rain on the zinc roof', 'void deck nap', 'last bus to tampines', 'teh peng sweating', 'kopitiam fan spinning', 'skyway at 2am', 'national library aircon', 'uncle is closed today', 'monsoon window', 'ice kachang meltdown', 'pr review at 3am'],
    words: [['quiet', 'rainy', 'late', 'humid', 'sleepy', 'slow', 'soft', 'warm', 'empty', 'blue'], ['kopitiam', 'void deck', 'bus stop', 'monsoon', 'aircon', 'corridor', 'hawker', 'study', 'balcony', 'lift lobby']],
    idents: ['Lo-fi Hawker ninety one three. Beats to queue for chicken rice to.', 'Lo-fi Hawker. Chill beats, warm kopi, no rush lah.', 'You are tuned to Lo-fi Hawker ninety one three. Relax. The aircon is on.'],
  },
  {
    id: 'vcpr', name: 'VCPR: VIBE CITY STARTUP RADIO', freq: '107.7', genre: 'talk radio', color: '#ffffff', seed: 1077, g: TALKBED, talk: true,
    artists: ['VCPR'], titles: ['Startup Talk with Chad Lim'], words: [['Startup'], ['Talk']],
    idents: [],
  },
  {
    id: 'kaya', name: 'KAYA 89.3', freq: '89.3', genre: 'xinyao & Singlish talk', color: '#9fd36b', seed: 893, g: XINYAO,
    artists: ['Campus Guitar Society', 'Auntie Mei & The Kopi Boys', 'Ah Seng Unplugged', 'Zebra Crossing Duo', 'The Kampong Strings', 'Little Pandan', 'Two Uncles One Guitar', 'Void Deck Choir'],
    titles: ['Rain Over Toa Payoh', 'Little Bus Stop', 'The Kampong Tree', 'Kopi in a Plastic Bag', 'Graduation at the Void Deck', 'Tiong Bahru Afternoon', 'Last MRT Home', 'Paper Kite over Marina', "Grandmother's Kaya", 'Sixteen Under the Angsana Tree'],
    words: [['Little', 'Old', 'Rainy', 'Quiet', 'Faraway', 'Gentle', 'Blue', 'Golden'], ['Kampong', 'Kite', 'Bicycle', 'Letter', 'Monsoon', 'Window', 'Harbour', 'Campus']],
    idents: ['Kaya eighty nine three. Steady pom pi pi.', 'You are listening to Kaya eighty nine three. Kopi, kaya toast, and good music. Simple can already.'],
    dj: { chance: 0.85, role: 'sgdj', lines: [
      'Hello hello, you listening to Kaya eighty nine three. Shiok or not?',
      'Wah, today very hot ah. Remember drink water, don\'t only drink kopi.',
      'Next song is for all the uncles who still play guitar at the void deck.',
      'Traffic on the C T E very jam. No need to rush lah, enjoy the song first.',
      'Eh, who chope my seat in the studio with tissue paper? Very kiasu ah you.',
      'This one ah, a classic. Last time we sing this at the campus, everybody cry.',
      'Weather forecast say got thunderstorm. Like that every day also say one.',
      'Listener ask me which hawker got the best chicken rice. Aiyoh, cannot say lah, later people fight.',
      'Okay, next one very nice. Close your eyes. Not if you are driving ah!',
      'You all ah, work so hard. Take a break, go makan first.',
      'Shout out to my auntie in Toa Payoh. She say her son still not married. Any takers?',
      'Remember ah, durian cannot bring on the M R T. Eat finish first, then go.',
      'Got people say xinyao is old school. I say old school is the best school.',
      'Wah, the startup people at Tanjong Pagar very busy hor. Vibe coding until three A M. Go sleep lah!',
      'Eh, the guy in the Hawaiian shirt, I see you. Drive nicely ah, this one not Vice City.',
    ] },
  },
];

// ------------------------------------------------------------------ song engine
function makeTitle(rng, st) {
  if (rng() < 0.6) return pick(rng, st.titles);
  return `${pick(rng, st.words[0])} ${pick(rng, st.words[1])}`;
}

/** Generates the deterministic plan of song k on a station. */
export function generateSong(st, k, sessionSeed = 0) {
  const g = st.g;
  const seed = hashInts(st.seed, k, sessionSeed, 991);
  const rng = mulberry32(seed);
  const bpm = Math.round(g.bpm[0] + rng() * (g.bpm[1] - g.bpm[0]));
  const mode = pick(rng, g.modes);
  const scale = SCALES[mode];
  const root = g.root[0] + Math.floor(rng() * (g.root[1] - g.root[0] + 1));
  const beatDur = 60 / bpm, barDur = beatDur * 4;
  const set = g.progs[mode] || g.progs.major || Object.values(g.progs)[0];
  const verse = pick(rng, set);
  const others = set.filter(p => p !== verse);
  const chorus = others.length ? pick(rng, others) : verse;
  const bridge = others.length > 1 ? pick(rng, others.filter(p => p !== chorus)) : chorus;
  const progs = { intro: rng() < 0.5 ? verse : chorus, verse, chorus, bridge, outro: chorus };
  const sections = makeStructure(rng, barDur, g.target ?? 165, g.form || {});
  let bar = 0;
  for (const s of sections) { s.start = bar; bar += s.bars; }
  const totalBars = bar;
  const barSection = new Uint8Array(totalBars);
  sections.forEach((s, i) => barSection.fill(i, s.start, s.start + s.bars));
  const motifs = {
    verse: makeMotif(rng, g.motif.verse),
    chorus: makeMotif(rng, g.motif.chorus),
    bridge: makeMotif(rng, g.motif.bridge || g.motif.verse),
  };
  const leadRoot = fit(root, 60, 71);
  const plan = {
    seed, station: st.id, k, bpm, beatDur, barDur, mode, scale, root, leadRoot, leadLo: 57, leadHi: 86,
    progs, sections, totalBars, barSection, motifs, swing: g.swing || 0,
    duration: totalBars * barDur, timbre: g.timbre(rng),
    title: makeTitle(rng, st), artist: pick(rng, st.artists),
    ...g.extra(rng),
  };
  return plan;
}

/** All note events of one bar: {ch, t (beats), d (beats), n (midi|midi[]), v, p?, i?}. Sorted by time. */
export function barEvents(st, plan, bar) {
  const si = plan.barSection[bar];
  const sec = plan.sections[si];
  const bi = bar - sec.start;
  const prog = plan.progs[sec.type] || plan.progs.verse;
  const chord = prog[bi % prog.length];
  const nextSec = plan.sections[si + 1];
  const next = bi + 1 < sec.bars ? prog[(bi + 1) % prog.length] : nextSec ? (plan.progs[nextSec.type] || prog)[0] : prog[0];
  const c = {
    plan, sec, bi, bar, rng: mulberry32(hashInts(plan.seed, bar, 31)), chord, next,
    last: bi === sec.bars - 1, first: bi === 0, type: sec.type, nextType: nextSec ? nextSec.type : null,
  };
  const ev = [];
  st.g.bar(c, ev);
  if (ev.leadInst) for (const e of ev) if (e.ch === 'lead') e.i = ev.leadInst;
  ev.sort((a, b) => a.t - b.t);
  return ev;
}
