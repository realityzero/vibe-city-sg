// One-shot sound effects, all synthesized. Each builder: (out, t, opts) -> end time (ctx seconds).
// opts: {volume, pitch, duration}. Builders only create nodes that stop themselves.
import { pulseWave } from './engine.js';

export const UI_SFX = new Set(['cheat', 'stunt', 'taxi_meter', 'pickup', 'money', 'checkpoint', 'mission_start', 'mission_passed', 'mission_failed', 'wasted', 'busted', 'phone_ring', 'text_message', 'ui_select', 'ui_back', 'ui_hover', 'typing', 'keyclick', 'bug_squash', 'ship_it', 'cash_register', 'erp_beep', 'wanted_up', 'stamp', 'race_beep', 'race_go']);
export const IMPORTANT_SFX = new Set(['cheat', 'stunt', 'splash_big', 'mission_start', 'mission_passed', 'mission_failed', 'wasted', 'busted', 'explosion', 'crash_heavy', 'phone_ring', 'checkpoint', 'money', 'pickup', 'wanted_up']);
export const REVERB_SFX = { splash_big: 0.15, stunt: 0.25, flyer_chime: 0.4, crowd_gasp: 0.2, rotor_start: 0.15, durian_thud: 0.05, explosion: 0.35, thunder: 0.45, crash_heavy: 0.15, siren_burst: 0.2, crowd_cheer: 0.25, applause: 0.2, splash: 0.1, horn: 0.08, mission_failed: 0.3, wasted: 0.4, busted: 0.25 };


const NOTRACK = { add() {} };

export function createSfx(sys) {
  const ctx = sys.ctx, B = sys.bufs, I = sys.inst;
  const filt = (type, f, q = 0.707) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const gainNode = v => { const g = ctx.createGain(); g.gain.value = v; return g; };

  /** Oscillator with pitch glide and percussive/sustained envelope. */
  function tone(out, type, f0, f1, t, dur, peak, { attack = 0.004, hold = 0, curve = 'exp', lp } = {}) {
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.9);
      else o.frequency.linearRampToValueAtTime(f1, t + dur * 0.9);
    }
    const g = ctx.createGain(), p = g.gain;
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + attack);
    if (hold) p.setValueAtTime(peak, t + attack + hold);
    p.setTargetAtTime(0, t + attack + hold, Math.max(0.005, (dur - attack - hold) / 4));
    const end = t + dur * 1.25 + 0.02;
    if (lp) { const f = filt('lowpass', lp); o.connect(f); f.connect(g); } else o.connect(g);
    g.connect(out); o.start(t); o.stop(end);
    return { osc: o, gain: g, end };
  }
  /** Filtered noise burst. */
  function nz(out, t, dur, peak, { buf = B.white, type = 'bandpass', f0 = 1000, f1, q = 1, attack = 0.002, hold = 0, sweep = 'exp' } = {}) {
    const s = ctx.createBufferSource(); s.buffer = buf;
    if (dur > buf.duration - 0.05) s.loop = true;
    const f = filt(type, f0, q);
    if (f1 && f1 !== f0) { f.frequency.setValueAtTime(f0, t); if (sweep === 'exp') f.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.9); else f.frequency.linearRampToValueAtTime(f1, t + dur * 0.9); }
    const g = ctx.createGain(), p = g.gain;
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + attack);
    if (hold) p.setValueAtTime(peak, t + attack + hold);
    p.setTargetAtTime(0, t + attack + hold, Math.max(0.004, (dur - attack - hold) / 4));
    const end = t + dur * 1.25 + 0.02;
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random() * Math.max(0, buf.duration - dur - 0.05)); s.stop(end);
    return { src: s, filter: f, gain: g, end };
  }
  const click = (out, t, peak = 0.4, f = 3200) => nz(out, t, 0.012, peak, { type: 'highpass', f0: f });
  const thud = (out, t, peak = 0.6, f0 = 120, f1 = 55, dur = 0.14) => tone(out, 'sine', f0, f1, t, dur, peak, { attack: 0.002 });
  const metal = (out, t, peak, dur, P = 1) => {
    let end = t;
    for (const f of [327, 541, 853, 1297, 1871]) end = Math.max(end, tone(out, 'sine', f * P * (0.9 + Math.random() * 0.2), 0, t, dur * (0.5 + Math.random() * 0.7), peak * (0.25 + Math.random() * 0.3)).end);
    return end;
  };
  const bells = (out, t, notes, step, v = 0.6, p = { ratio: 2, index: 1.2, decay: 0.6 }) => {
    notes.forEach((n, i) => I.bell(out, t + i * step, 0.3, n, v, p, NOTRACK));
    return t + notes.length * step + p.decay * 1.5;
  };
  const am = (node, t, end, rate, depth, type = 'square') => {
    const l = ctx.createOscillator(); l.type = type; l.frequency.value = rate;
    const d = gainNode(depth); l.connect(d); d.connect(node.gain); l.start(t); l.stop(end);
  };

  // precomputed applause (many tiny claps)
  const applauseBuf = (() => {
    const sr = ctx.sampleRate, len = Math.floor(sr * 3.2), b = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let k = 0; k < 900; k++) {
        const p = Math.floor(Math.random() * (len - 600)), amp = 0.15 + Math.random() * 0.35, L = 120 + Math.floor(Math.random() * 380);
        let lp = 0; const a = 0.3 + Math.random() * 0.6;
        for (let j = 0; j < L; j++) { lp += a * ((Math.random() * 2 - 1) - lp); d[p + j] += lp * amp * Math.exp(-j / (L * 0.25)); }
      }
    }
    return b;
  })();

  const S = {
    horn(out, t, o) {
      const dur = o.duration ?? 0.45, P = o.pitch ?? 1;
      const lp = filt('lowpass', 2400), pk = filt('peaking', 1500, 1); pk.gain.value = 6;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.32, t + 0.012); g.gain.setValueAtTime(0.32, t + dur); g.gain.setTargetAtTime(0, t + dur, 0.015);
      const end = t + dur + 0.1;
      for (const f of [412, 518]) { const os = ctx.createOscillator(); os.type = 'square'; os.frequency.value = f * P; os.connect(lp); os.start(t); os.stop(end); }
      lp.connect(pk); pk.connect(g); g.connect(out);
      return end;
    },
    crash_light(out, t, o) {
      const P = o.pitch ?? 1;
      nz(out, t, 0.28, 0.7, { f0: 1700 * P, q: 0.8 });
      thud(out, t, 0.5, 110, 55, 0.16);
      return Math.max(metal(out, t + 0.005, 0.35, 0.45, P), t + 0.4);
    },
    crash_heavy(out, t, o) {
      const P = o.pitch ?? 1;
      thud(out, t, 1, 95 * P, 32, 0.7);
      nz(out, t, 0.8, 0.9, { type: 'lowpass', f0: 1600, f1: 300 });
      nz(out, t, 0.4, 0.5, { f0: 2500, q: 0.6 });
      let end = metal(out, t + 0.01, 0.5, 1.1, P * 0.8);
      for (let k = 0; k < 7; k++) { const tk = t + 0.03 + Math.random() * 0.5; end = Math.max(end, nz(out, tk, 0.06 + Math.random() * 0.08, 0.25 + Math.random() * 0.2, { type: 'highpass', f0: 4500 + Math.random() * 3000 }).end); }
      return end;
    },
    explosion(out, t) {
      thud(out, t, 1, 70, 22, 1.6);
      nz(out, t, 2.4, 1, { type: 'lowpass', f0: 5000, f1: 140, q: 0.8, attack: 0.004 });
      nz(out, t + 0.02, 1.2, 0.35, { type: 'highpass', f0: 1800, f1: 600 });
      for (let k = 0; k < 10; k++) nz(out, t + 0.15 + Math.random() * 1.4, 0.03, 0.15 + Math.random() * 0.2, { type: 'highpass', f0: 2000 + Math.random() * 3000 });
      return t + 3.2;
    },
    door_open(out, t) {
      click(out, t, 0.45, 2500);
      const c = tone(out, 'sawtooth', 170, 230, t + 0.04, 0.22, 0.05, { lp: 1100, curve: 'lin' });
      return c.end;
    },
    door_close(out, t) {
      thud(out, t, 0.75, 150, 62, 0.16);
      nz(out, t, 0.12, 0.5, { type: 'lowpass', f0: 900 });
      click(out, t + 0.025, 0.35, 2800);
      return t + 0.3;
    },
    footstep(out, t, o) {
      const P = (o.pitch ?? 1) * (0.9 + Math.random() * 0.2);
      nz(out, t, 0.07, 0.35 + Math.random() * 0.15, { f0: 1300 * P, q: 1.1 });
      thud(out, t, 0.25, 95 * P, 60, 0.06);
      return t + 0.12;
    },
    footstep_wet(out, t, o) {
      S.footstep(out, t, o);
      nz(out, t + 0.01, 0.14, 0.22, { type: 'highpass', f0: 3200 });
      return t + 0.2;
    },
    splash(out, t) {
      nz(out, t, 0.7, 0.8, { f0: 500, f1: 2600, q: 0.7 });
      nz(out, t, 1.2, 0.5, { type: 'lowpass', f0: 700 });
      for (let k = 0; k < 6; k++) tone(out, 'sine', 380 + Math.random() * 300, 900 + Math.random() * 500, t + 0.2 + Math.random() * 0.6, 0.06, 0.08);
      return t + 1.6;
    },
    engine_start(out, t) {
      const st = tone(out, 'sawtooth', 36, 42, t, 0.75, 0.3, { attack: 0.03, hold: 0.55, lp: 900, curve: 'lin' });
      am(st.gain, t, st.end, 13, 0.18);
      tone(out, 'sawtooth', 44, 115, t + 0.7, 0.55, 0.45, { attack: 0.05, hold: 0.15, lp: 1300 });
      tone(out, 'square', 22, 55, t + 0.7, 0.55, 0.25, { attack: 0.05, hold: 0.15, lp: 500 });
      return t + 1.5;
    },
    tyre_screech(out, t, o) {
      const dur = o.duration ?? 0.9;
      const n = nz(out, t, dur, 0.35, { f0: 2100, q: 9, attack: 0.05, hold: dur * 0.6 });
      const l = ctx.createOscillator(); l.frequency.value = 7; const lg = gainNode(220); l.connect(lg); lg.connect(n.filter.frequency); l.start(t); l.stop(n.end);
      const s = tone(out, 'sine', 1150, 1080, t, dur, 0.12, { attack: 0.05, hold: dur * 0.6, curve: 'lin' });
      const v = ctx.createOscillator(); v.frequency.value = 11; const vg = gainNode(35); v.connect(vg); vg.connect(s.osc.frequency); v.start(t); v.stop(s.end);
      return n.end;
    },
    // a car or a pedestrian flashing past the window (near miss): air torn open, falling away
    whoosh(out, t) {
      nz(out, t, 0.5, 0.42, { f0: 3400, f1: 520, q: 1.4, attack: 0.07 });
      return nz(out, t + 0.02, 0.35, 0.18, { type: 'lowpass', f0: 900, f1: 260, attack: 0.05 }).end;
    },
    // bodywork grinding along a wall: gritty band of noise, chattering, with a metallic ring
    scrape(out, t) {
      const n = nz(out, t, 0.32, 0.32, { f0: 2300, f1: 1700, q: 3, attack: 0.01, hold: 0.12 });
      am(n.gain, t, n.end, 31, 0.14);
      return Math.max(n.end, metal(out, t, 0.05, 0.25, 1.6));
    },
    pickup(out, t) { return bells(out, t, [84, 88, 91, 96], 0.055, 0.55); },
    money(out, t) { tone(out, 'square', 1975, 0, t, 0.08, 0.06, { lp: 4000 }); tone(out, 'square', 2637, 0, t + 0.07, 0.3, 0.06, { lp: 5000 }); return bells(out, t, [83, 88], 0.07, 0.5, { ratio: 3.01, index: 1, decay: 0.7 }); },
    checkpoint(out, t) {
      for (const n of [76, 81, 88]) I.pluck(out, t, 0.2, n, 0.25, { wave: 'square', cutHi: 5000, cutLo: 1500, decay: 0.22 }, NOTRACK);
      return bells(out, t + 0.04, [93], 0.05, 0.4);
    },
    mission_start(out, t) {
      thud(out, t, 0.8, 90, 40, 0.5);
      I.brass(out, t, 0.7, [48, 55, 60, 63], 0.6, { cut: 2400 }, NOTRACK);
      I.riser(out, t + 0.1, 0.9, 0, 0.6, { to: 5000 }, NOTRACK);
      I.brass(out, t + 1.0, 0.9, [51, 58, 63, 67], 0.65, { cut: 3000 }, NOTRACK);
      return t + 2.3;
    },
    mission_failed(out, t) {
      [67, 63, 60].forEach((n, i) => I.brass(out, t + i * 0.36, 0.32, [n, n - 12], 0.55, { cut: 2000 }, NOTRACK));
      I.brass(out, t + 1.1, 1.6, [48, 51, 55], 0.5, { cut: 1400, attack: 0.1 }, NOTRACK);
      I.bass(out, t + 1.1, 1.6, 36, 0.6, { wave: 'sawtooth', cut: 300, sus: 0.9 }, NOTRACK);
      return t + 3.2;
    },
    wasted(out, t) {
      thud(out, t, 1, 110, 30, 1.2);
      tone(out, 'sine', 220, 38, t, 2.6, 0.35, { attack: 0.02, curve: 'exp' });
      nz(out, t, 2.5, 0.4, { type: 'lowpass', f0: 1200, f1: 120 });
      I.pad(out, t + 0.1, 2.2, [40, 46, 47, 53], 0.6, { attack: 0.6, release: 1.2, cut: 900 }, NOTRACK);
      return t + 4;
    },
    busted(out, t) {
      const s = tone(out, 'triangle', 520, 1250, t, 0.4, 0.22, { attack: 0.02, hold: 0.25, curve: 'lin', lp: 3000 });
      tone(out, 'triangle', 1250, 520, t + 0.42, 0.4, 0.22, { attack: 0.01, hold: 0.25, curve: 'lin', lp: 3000 });
      I.brass(out, t + 0.9, 1.4, [42, 48, 54], 0.6, { cut: 1800 }, NOTRACK);
      I.snare(out, t + 0.9, 0.2, 0, 0.8, { decay: 0.3 }, NOTRACK);
      thud(out, t + 0.9, 0.9, 100, 40, 0.5);
      return Math.max(s.end, t + 3);
    },
    phone_ring(out, t) {
      const lp = filt('lowpass', 3500); lp.connect(out);
      let end = t;
      for (let r = 0; r < 2; r++) for (let b = 0; b < 2; b++) {
        const tb = t + r * 1.4 + b * 0.55;
        const x = tone(lp, 'square', 1320, 0, tb, 0.42, 0.09, { attack: 0.005, hold: 0.36 });
        am(x.gain, tb, x.end, 24, 0.09);
        end = x.end;
      }
      return end;
    },
    text_message(out, t) {
      tone(out, 'sine', 1760, 0, t, 0.09, 0.25, { hold: 0.05 });
      tone(out, 'sine', 2349, 0, t + 0.13, 0.14, 0.25, { hold: 0.06 });
      return t + 0.4;
    },
    ui_select(out, t) { tone(out, 'triangle', 880, 1320, t, 0.09, 0.3, { curve: 'lin' }); tone(out, 'sine', 1760, 0, t + 0.04, 0.08, 0.12); return t + 0.18; },
    ui_back(out, t) { tone(out, 'triangle', 700, 440, t, 0.1, 0.28, { curve: 'lin' }); return t + 0.16; },
    ui_hover(out, t) { tone(out, 'sine', 2100, 0, t, 0.025, 0.08); return t + 0.05; },
    keyclick(out, t, o) {
      const P = (o.pitch ?? 1) * (0.92 + Math.random() * 0.16);
      nz(out, t, 0.014, 0.4, { f0: 3600 * P, q: 2.5 });
      thud(out, t + 0.004, 0.18, 210 * P, 120, 0.02);
      return t + 0.06;
    },
    typing(out, t, o) {
      let tk = t; const n = 7 + Math.floor(Math.random() * 5);
      for (let k = 0; k < n; k++) { S.keyclick(out, tk, o); tk += 0.045 + Math.random() * 0.07; }
      return tk + 0.05;
    },
    bug_squash(out, t) {
      nz(out, t, 0.16, 0.6, { type: 'lowpass', f0: 1100 });
      tone(out, 'sine', 520, 70, t, 0.14, 0.45);
      for (let k = 0; k < 4; k++) nz(out, t + k * 0.018, 0.02, 0.3, { f0: 2400 + k * 400, q: 2 });
      return t + 0.3;
    },
    ship_it(out, t) {
      nz(out, t, 0.75, 0.45, { f0: 280, f1: 5200, q: 1.5 });
      I.brass(out, t + 0.55, 0.6, [60, 64, 67, 72], 0.55, { cut: 3400 }, NOTRACK);
      return bells(out, t + 0.5, [72, 76, 79, 84, 88], 0.06, 0.5);
    },
    cash_register(out, t) {
      nz(out, t, 0.16, 0.45, { type: 'lowpass', f0: 1500 });
      click(out, t + 0.12, 0.3);
      tone(out, 'sine', 2637, 0, t + 0.16, 0.9, 0.22);
      tone(out, 'sine', 3951, 0, t + 0.16, 0.7, 0.16);
      return t + 1.2;
    },
    camera_flash(out, t) {
      click(out, t, 0.5, 2200); click(out, t + 0.06, 0.4, 1800);
      tone(out, 'sine', 2200, 7000, t + 0.08, 0.45, 0.04, { attack: 0.05, curve: 'exp' });
      return t + 0.6;
    },
    crowd_cheer(out, t, o) {
      const dur = o.duration ?? 2.8;
      const a = nz(out, t, dur, 0.4, { buf: B.pink, f0: 900, q: 0.5, attack: 0.25, hold: dur * 0.35 });
      const b = nz(out, t, dur, 0.25, { buf: B.white, f0: 2300, q: 1.2, attack: 0.3, hold: dur * 0.3 });
      am(a.gain, t, a.end, 6.3, 0.12, 'sine'); am(b.gain, t, b.end, 8.7, 0.08, 'sine');
      for (let k = 0; k < 5; k++) { const tk = t + 0.1 + Math.random() * dur * 0.6; tone(out, 'sawtooth', 300 + Math.random() * 200, 500 + Math.random() * 300, tk, 0.4, 0.03, { attack: 0.05, lp: 1500, curve: 'lin' }); }
      return b.end;
    },
    applause(out, t, o) {
      const dur = o.duration ?? 3;
      const s = ctx.createBufferSource(); s.buffer = applauseBuf; s.loop = true;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.7, t + 0.35); g.gain.setValueAtTime(0.7, t + dur * 0.6); g.gain.linearRampToValueAtTime(0, t + dur);
      const hp = filt('highpass', 400);
      s.connect(hp); hp.connect(g); g.connect(out); s.start(t); s.stop(t + dur + 0.05);
      return t + dur + 0.1;
    },
    erp_beep(out, t) { tone(out, 'square', 1000, 0, t, 0.16, 0.1, { hold: 0.12, lp: 2800 }); return t + 0.25; },
    // a rubber stamp on a notice of offence: a dull thump, a paper slap
    stamp(out, t) {
      thud(out, t, 0.7, 150, 60, 0.12);
      nz(out, t, 0.07, 0.35, { type: 'bandpass', f0: 1400, q: 0.8 });
      return t + 0.3;
    },
    // drag-race start lights: a low beep per red, a high long one for green
    race_beep(out, t) { tone(out, 'square', 660, 0, t, 0.18, 0.08, { hold: 0.1, lp: 2400 }); return t + 0.3; },
    race_go(out, t) { tone(out, 'square', 1320, 0, t, 0.5, 0.09, { hold: 0.4, lp: 3200 }); return t + 0.7; },
    wanted_up(out, t) {
      tone(out, 'square', 880, 0, t, 0.12, 0.09, { hold: 0.08, lp: 3000 });
      tone(out, 'square', 1175, 0, t + 0.13, 0.16, 0.09, { hold: 0.1, lp: 3000 });
      thud(out, t, 0.4, 80, 45, 0.25);
      return t + 0.4;
    },
    siren_burst(out, t) {
      const lp = filt('lowpass', 2800); lp.connect(out);
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
      o1.frequency.setValueAtTime(560, t); o1.frequency.linearRampToValueAtTime(1350, t + 0.35); o1.frequency.linearRampToValueAtTime(600, t + 0.8);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.03); g.gain.setValueAtTime(0.18, t + 0.7); g.gain.linearRampToValueAtTime(0, t + 0.85);
      o1.connect(g); g.connect(lp); o1.start(t); o1.stop(t + 0.9);
      return t + 0.95;
    },
    thunder(out, t) {
      nz(out, t, 0.25, 0.55, { type: 'highpass', f0: 1400 });
      const r = nz(out, t + 0.08, 4.5, 0.9, { buf: B.brown, type: 'lowpass', f0: 380, f1: 120, attack: 0.4, hold: 0.6 });
      am(r.gain, t, r.end, 2.3, 0.25, 'sine');
      return r.end;
    },
    punch(out, t) {
      nz(out, t, 0.07, 0.2, { f0: 600, f1: 1800, q: 1 });
      thud(out, t + 0.05, 0.9, 140, 50, 0.12);
      nz(out, t + 0.05, 0.06, 0.45, { type: 'lowpass', f0: 1600 });
      return t + 0.25;
    },
    jump(out, t) { nz(out, t, 0.16, 0.18, { f0: 350, f1: 1400, q: 1.2 }); return t + 0.25; },
    land(out, t) { thud(out, t, 0.6, 95, 40, 0.14); nz(out, t, 0.09, 0.3, { type: 'lowpass', f0: 600 }); return t + 0.2; },
    // ---------------------------------------------------------------- wave 2
    splash_big(out, t) {
      thud(out, t, 0.9, 80, 28, 0.9);
      nz(out, t, 1.5, 1, { f0: 300, f1: 2600, q: 0.6, attack: 0.01 });
      nz(out, t + 0.04, 2.6, 0.65, { type: 'lowpass', f0: 1000, f1: 280 });
      nz(out, t + 0.1, 1.4, 0.35, { type: 'highpass', f0: 3000, attack: 0.05 });
      for (let k = 0; k < 16; k++) tone(out, 'sine', 350 + Math.random() * 400, 800 + Math.random() * 700, t + 0.3 + Math.random() * 1.8, 0.05 + Math.random() * 0.05, 0.05 + Math.random() * 0.06);
      return t + 3.2;
    },
    wave_slap(out, t, o) {
      const P = o.pitch ?? 1;
      nz(out, t, 0.4, 0.6, { type: 'lowpass', f0: 950 * P, f1: 380 * P, attack: 0.025 });
      nz(out, t + 0.02, 0.28, 0.22, { f0: 1500 * P, q: 0.8 });
      thud(out, t, 0.35, 75 * P, 45, 0.14);
      return t + 0.65;
    },
    durian_thud(out, t, o) {
      thud(out, t, 0.95, 88, 38, 0.28);
      nz(out, t, 0.14, 0.55, { type: 'lowpass', f0: 1300 });
      for (let k = 0; k < 7; k++) nz(out, t + Math.random() * 0.06, 0.015, 0.18 + Math.random() * 0.2, { type: 'highpass', f0: 2500 + Math.random() * 3500 });
      if (o.metal) metal(out, t, 0.35, 0.55, 1.15);
      tone(out, 'sine', 140, 90, t + 0.18, 0.12, 0.25); // second bounce
      return t + 0.7;
    },
    cheat(out, t) {
      [60, 64, 67, 72, 76, 79, 84, 88].forEach((n, i) => I.pluck(out, t + i * 0.035, 0.12, n, 0.3, { wave: 'square', cutHi: 6000, cutLo: 1800, decay: 0.12 }, NOTRACK));
      I.brass(out, t + 0.3, 0.55, [60, 64, 67, 72], 0.4, { cut: 3600, attack: 0.01 }, NOTRACK);
      return bells(out, t + 0.3, [84, 88, 91, 96], 0.05, 0.45);
    },
    stunt(out, t) {
      I.riser(out, t, 0.55, 0, 0.7, { to: 7000 }, NOTRACK);
      thud(out, t + 0.5, 0.9, 110, 45, 0.5);
      I.brass(out, t + 0.5, 0.35, [53, 60, 65, 69], 0.55, { cut: 3400, attack: 0.008 }, NOTRACK);
      I.brass(out, t + 0.9, 1.3, [55, 62, 67, 71, 74], 0.55, { cut: 3800, attack: 0.01 }, NOTRACK);
      I.crash(out, t + 0.5, 2, 0, 0.7, { decay: 2 }, NOTRACK);
      I.tom(out, t + 0.75, 0.2, 43, 0.7, {}, NOTRACK); I.tom(out, t + 0.82, 0.2, 40, 0.75, {}, NOTRACK);
      return t + 2.8;
    },
    taxi_meter(out, t) {
      tone(out, 'square', 2400, 0, t, 0.07, 0.07, { hold: 0.04, lp: 4000 });
      tone(out, 'square', 2400, 0, t + 0.12, 0.07, 0.07, { hold: 0.04, lp: 4000 });
      return S.cash_register(out, t + 0.25);
    },
    camera_shutter(out, t) {
      click(out, t, 0.55, 2800);
      nz(out, t + 0.01, 0.05, 0.12, { f0: 1200, q: 1.5 });
      click(out, t + 0.07, 0.4, 2000);
      return t + 0.25;
    },
    flyer_chime(out, t) { return bells(out, t, [79, 84, 86, 91, 88, 84], 0.22, 0.4, { ratio: 3.5, index: 1.2, decay: 1.6 }); },
    kopi_pour(out, t, o) {
      const dur = o.duration ?? 2;
      const a = nz(out, t, dur, 0.35, { f0: 520, f1: 1400, q: 7, attack: 0.08, hold: dur * 0.7, sweep: 'lin' });
      am(a.gain, t, a.end, 9.5, 0.12, 'sine');
      const b = nz(out, t, dur, 0.18, { type: 'lowpass', f0: 1600, attack: 0.1, hold: dur * 0.7 });
      am(b.gain, t, b.end, 13.7, 0.08, 'sine');
      for (let k = 0; k < 8; k++) tone(out, 'sine', 600 + Math.random() * 500, 1100 + Math.random() * 600, t + Math.random() * dur * 0.9, 0.03, 0.04);
      return a.end;
    },
    crowd_gasp(out, t) {
      const a = nz(out, t, 1.1, 0.9, { buf: B.pink, f0: 700, q: 1.5, attack: 0.09 });
      nz(out, t, 1.0, 0.5, { buf: B.pink, f0: 1150, q: 2, attack: 0.1 });
      for (let k = 0; k < 7; k++) {
        const f0 = 140 + Math.random() * 180, tk = t + Math.random() * 0.12;
        tone(out, 'sawtooth', f0 * 1.15, f0 * 0.85, tk, 0.9, 0.025, { attack: 0.08, lp: 1100, curve: 'lin' });
      }
      return a.end;
    },
    ped_yelp(out, t, o) {
      const P = o.pitch ?? (0.8 + Math.random() * 0.8);
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(210 * P, t); osc.frequency.exponentialRampToValueAtTime(390 * P, t + 0.06); osc.frequency.exponentialRampToValueAtTime(250 * P, t + 0.26);
      const f1 = filt('bandpass', 780 * Math.sqrt(P), 5), f2 = filt('bandpass', 1350 * Math.sqrt(P), 6), m2 = gainNode(0.7);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.02); g.gain.setTargetAtTime(0, t + 0.18, 0.04);
      osc.connect(f1); osc.connect(f2); f1.connect(g); f2.connect(m2); m2.connect(g); g.connect(out);
      osc.start(t); osc.stop(t + 0.4);
      nz(out, t, 0.1, 0.06, { f0: 2500, q: 1 });
      return t + 0.42;
    },
    rotor_start(out, t) {
      const dur = 3;
      const lfo = ctx.createOscillator(); lfo.setPeriodicWave(pulseWave(ctx));
      lfo.frequency.setValueAtTime(0.8, t); lfo.frequency.exponentialRampToValueAtTime(16, t + dur);
      const chop = gainNode(0.3), cd = gainNode(0.32); lfo.connect(cd); cd.connect(chop.gain);
      const env = ctx.createGain(); env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(0.9, t + dur * 0.8); env.gain.setTargetAtTime(0, t + dur, 0.1);
      const r = ctx.createBufferSource(); r.buffer = B.brown; r.loop = true;
      const lp = filt('lowpass', 650); r.connect(lp); lp.connect(chop); chop.connect(env); env.connect(out);
      const th = ctx.createOscillator(); th.frequency.value = 46; const thA = gainNode(0.05), thD = gainNode(0.5); lfo.connect(thD); thD.connect(thA.gain); th.connect(thA); thA.connect(env);
      const tb = ctx.createOscillator(); tb.type = 'sawtooth'; tb.frequency.setValueAtTime(200, t); tb.frequency.exponentialRampToValueAtTime(2800, t + dur);
      const tf = filt('bandpass', 600, 4); tf.frequency.setValueAtTime(400, t); tf.frequency.exponentialRampToValueAtTime(4500, t + dur);
      const tg = gainNode(0.06); tb.connect(tf); tf.connect(tg); tg.connect(env);
      const end = t + dur + 0.5;
      for (const s of [lfo, r, th, tb]) { s.start(t); s.stop(end); }
      return end;
    },
    parachute(out, t) {
      nz(out, t, 0.18, 0.6, { f0: 380, q: 1.2, attack: 0.005 });
      thud(out, t, 0.35, 70, 40, 0.15);
      const f = nz(out, t + 0.12, 1.4, 0.3, { f0: 650, q: 1, attack: 0.02, hold: 0.6 });
      am(f.gain, t, f.end, 17, 0.25);
      return f.end;
    },
  };
  S.mission_passed = (out, t) => { sys.music?.('mission_passed'); return t + 0.1; };
  return S;
}
