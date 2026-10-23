// Synth voices. Every instrument has the same signature:
//   inst[name](out, t, dur, note, vel, p, tr)
//   out: AudioNode destination, t: start time (ctx seconds), dur: seconds, note: midi number or array (chords),
//   vel: 0..1, p: params object, tr: Tracker that receives every source node (so sessions can be cut).
// Nodes are created per note and released by stop(); nothing persists between notes.
import { mtof, distortionCurve } from './util.js';

export function createInstruments(ctx, bufs) {
  const curveSoft = distortionCurve(2.2);
  const curveHard = distortionCurve(14);
  const E = {}; // empty params

  const osc = (type, freq, t, end, tr, detune = 0) => {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq; if (detune) o.detune.value = detune;
    o.start(t); o.stop(end); tr.add(o, end);
    return o;
  };
  const noise = (buf, t, dur, tr) => {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const maxOff = Math.max(0, buf.duration - dur - 0.02);
    s.start(t, Math.random() * maxOff);
    s.stop(t + dur); tr.add(s, t + dur);
    return s;
  };
  const filt = (type, f, q = 0.707) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };
  /** ADSR on a fresh gain node; returns [gainNode, endTime]. */
  const adsr = (t, dur, a, peak, d, s, r) => {
    const g = ctx.createGain(), p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + a);
    if (d > 0 && s < 1) p.setTargetAtTime(peak * s, t + a, d / 3);
    const rel = Math.max(t + a + 0.002, t + dur);
    p.setTargetAtTime(0, rel, Math.max(0.005, r / 4));
    return [g, rel + r + 0.02];
  };
  /** Percussive: quick attack then exponential-ish decay. */
  const perc = (t, peak, decay, attack = 0.002) => {
    const g = ctx.createGain(), p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + attack);
    p.setTargetAtTime(0, t + attack, decay / 4);
    return [g, t + attack + decay * 1.3 + 0.02];
  };

  const I = {
    // ------------------------------------------------------------------ drums
    kick(out, t, dur, note, v = 1, p = E, tr) {
      const f0 = p.f0 ?? 155, f1 = p.f1 ?? 47, dec = p.decay ?? 0.42;
      const [g, end] = perc(t, v, dec);
      const o = osc('sine', f0, t, end, tr);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + (p.sweep ?? 0.075));
      if (p.drive) { const ws = ctx.createWaveShaper(); ws.curve = curveSoft; o.connect(ws); ws.connect(g); }
      else o.connect(g);
      g.connect(out);
      if (p.click) {
        const n = noise(bufs.white, t, 0.02, tr), hp = filt('highpass', 2500), [cg] = perc(t, v * 0.35 * p.click, 0.012, 0.0005);
        n.connect(hp); hp.connect(cg); cg.connect(out);
      }
    },
    snare(out, t, dur, note, v = 1, p = E, tr) {
      const dec = p.decay ?? 0.18;
      const [g, end] = perc(t, v * 0.85, dec, 0.001);
      const n = noise(bufs.white, t, end - t, tr);
      const hp = filt('highpass', p.hp ?? 900);
      n.connect(hp);
      if (p.lp) { const lp = filt('lowpass', p.lp); hp.connect(lp); lp.connect(g); } else hp.connect(g);
      g.connect(out);
      const tone = p.tone ?? 185;
      const [tg, tend] = perc(t, v * (p.body ?? 0.55), 0.09, 0.001);
      const o = osc('triangle', tone, t, tend, tr);
      o.frequency.setValueAtTime(tone * 1.35, t);
      o.frequency.exponentialRampToValueAtTime(tone, t + 0.03);
      o.connect(tg); tg.connect(out);
    },
    clap(out, t, dur, note, v = 1, p = E, tr) {
      const g = ctx.createGain(), gp = g.gain;
      gp.setValueAtTime(0, t);
      for (let k = 0; k < 3; k++) {
        const tk = t + k * 0.011;
        gp.setValueAtTime(v * 0.9, tk);
        gp.setTargetAtTime(0, tk + 0.001, 0.003);
      }
      gp.setValueAtTime(v * 0.75, t + 0.034);
      gp.setTargetAtTime(0, t + 0.035, (p.decay ?? 0.16) / 4);
      const end = t + 0.05 + (p.decay ?? 0.16) * 1.4;
      const n = noise(bufs.white, t, end - t, tr);
      const bp = filt('bandpass', p.f ?? 1150, 1.1);
      n.connect(bp); bp.connect(g); g.connect(out);
    },
    hat(out, t, dur, note, v = 1, p = E, tr) {
      const dec = p.open ? (p.openDecay ?? 0.24) : (p.decay ?? 0.04);
      const [g, end] = perc(t, v * 1.0, dec, 0.001);
      const n = noise(bufs.white, t, end - t, tr);
      const hp = filt('highpass', p.hp ?? 7200);
      n.connect(hp);
      if (p.lp) { const lp = filt('lowpass', p.lp); hp.connect(lp); lp.connect(g); }
      else { const bp = filt('peaking', 10500, 1); bp.gain.value = 6; hp.connect(bp); bp.connect(g); }
      g.connect(out);
    },
    shaker(out, t, dur, note, v = 1, p = E, tr) {
      const g = ctx.createGain(), gp = g.gain;
      gp.setValueAtTime(0, t); gp.linearRampToValueAtTime(v * 0.7, t + 0.018); gp.setTargetAtTime(0, t + 0.02, 0.018);
      const n = noise(bufs.white, t, 0.12, tr); const bp = filt('bandpass', 6500, 1.4);
      n.connect(bp); bp.connect(g); g.connect(out);
    },
    rim(out, t, dur, note, v = 1, p = E, tr) {
      const [g, end] = perc(t, v * 0.5, 0.035, 0.0005);
      const o = osc('triangle', p.f ?? 1650, t, end, tr), bp = filt('bandpass', 1700, 3);
      o.connect(bp); bp.connect(g); g.connect(out);
      const n = noise(bufs.white, t, 0.01, tr), [ng] = perc(t, v * 0.3, 0.006, 0.0005); n.connect(ng); ng.connect(out);
    },
    tom(out, t, dur, note, v = 1, p = E, tr) {
      const f = note ? mtof(note) : (p.f ?? 110);
      const [g, end] = perc(t, v * 0.9, p.decay ?? 0.34);
      const o = osc('sine', f * 1.6, t, end, tr);
      o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.12);
      o.connect(g); g.connect(out);
      const n = noise(bufs.white, t, 0.03, tr), lp = filt('lowpass', 3000), [ng] = perc(t, v * 0.25, 0.02);
      n.connect(lp); lp.connect(ng); ng.connect(out);
    },
    crash(out, t, dur, note, v = 1, p = E, tr) {
      const dec = p.decay ?? 1.8;
      const [g, end] = perc(t, v * 0.45, dec, 0.001);
      const n = noise(bufs.white, t, end - t, tr), hp = filt('highpass', 4200), pk = filt('peaking', 7500, 0.8);
      pk.gain.value = 5;
      n.connect(hp); hp.connect(pk); pk.connect(g); g.connect(out);
    },
    // ------------------------------------------------------------------ tonal
    bass(out, t, dur, note, v = 1, p = E, tr) {
      const f = mtof(note);
      const [g, end] = adsr(t, dur, p.attack ?? 0.004, v, p.d ?? 0.2, p.sus ?? 0.75, p.release ?? 0.05);
      const lp = filt('lowpass', p.cut ?? 500, p.q ?? 4);
      lp.frequency.setValueAtTime(p.cutEnv ?? 2000, t);
      lp.frequency.setTargetAtTime(p.cut ?? 500, t + 0.002, p.fdec ?? 0.05);
      const o = osc(p.wave ?? 'sawtooth', f, t, end, tr);
      if (p.glideFrom) { o.frequency.setValueAtTime(mtof(p.glideFrom), t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06); }
      o.connect(lp);
      if (p.sub) { const s = osc('square', f / 2, t, end, tr), sg = gain(p.sub); s.connect(sg); sg.connect(lp); }
      if (p.drive) { const ws = ctx.createWaveShaper(); ws.curve = curveSoft; lp.connect(ws); ws.connect(g); } else lp.connect(g);
      g.connect(out);
    },
    slap(out, t, dur, note, v = 1, p = E, tr) {
      const f = mtof(note);
      const [g, end] = adsr(t, dur, 0.002, v, 0.25, 0.45, 0.04);
      const lp = filt('lowpass', 600, 5);
      lp.frequency.setValueAtTime(p.cutEnv ?? 3800, t); lp.frequency.setTargetAtTime(p.cut ?? 650, t + 0.002, 0.035);
      const o = osc('triangle', f, t, end, tr), o2 = osc('sawtooth', f, t, end, tr, 4), g2 = gain(0.45);
      o.frequency.setValueAtTime(f * 1.03, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.025);
      o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(out);
      const n = noise(bufs.white, t, 0.02, tr), hp = filt('highpass', 2500), [ng] = perc(t, v * 0.22, 0.01, 0.0005);
      n.connect(hp); hp.connect(ng); ng.connect(out);
    },
    pad(out, t, dur, notes, v = 1, p = E, tr) {
      const arr = Array.isArray(notes) ? notes : [notes];
      const a = p.attack ?? 0.45, r = p.release ?? 1.0;
      const [g, end] = adsr(t, dur, a, v / Math.sqrt(arr.length), 0, 1, r);
      const lp = filt('lowpass', p.cut ?? 1800, p.q ?? 0.8);
      if (p.sweep) { lp.frequency.setValueAtTime((p.cut ?? 1800) * 0.35, t); lp.frequency.linearRampToValueAtTime(p.cut ?? 1800, t + Math.max(a, dur * p.sweep)); }
      const det = p.detune ?? 9, wave = p.wave ?? 'sawtooth';
      for (const n of arr) {
        const f = mtof(n);
        osc(wave, f, t, end, tr, -det).connect(lp);
        osc(wave, f, t, end, tr, det).connect(lp);
      }
      lp.connect(g); g.connect(out);
    },
    lead(out, t, dur, note, v = 1, p = E, tr) {
      const f = mtof(note);
      const [g, end] = adsr(t, dur, p.attack ?? 0.008, v, p.d ?? 0.25, p.sus ?? 0.75, p.release ?? 0.14);
      const o1 = osc(p.wave ?? 'square', f, t, end, tr), o2 = osc(p.wave2 ?? 'sawtooth', f, t, end, tr, p.det ?? 7), g2 = gain(p.mix2 ?? 0.6);
      if (p.glideFrom) {
        const f0 = mtof(p.glideFrom);
        for (const o of [o1, o2]) { o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f, t + (p.glide ?? 0.05)); }
      }
      const cut = p.cut ?? 3000;
      const lp = filt('lowpass', cut, p.q ?? 1.5);
      lp.frequency.setValueAtTime(cut * (p.cutEnv ?? 1.8), t); lp.frequency.setTargetAtTime(cut, t + 0.01, 0.08);
      o1.connect(lp); o2.connect(g2); g2.connect(lp);
      if (dur > 0.28 && (p.vib ?? 0.006) > 0) {
        const lfo = osc('sine', p.vibRate ?? 5.4, t, end, tr), vg = ctx.createGain();
        vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(f * (p.vib ?? 0.006), t + Math.min(0.45, dur * 0.6));
        lfo.connect(vg); vg.connect(o1.frequency); vg.connect(o2.frequency);
      }
      lp.connect(g); g.connect(out);
    },
    sax(out, t, dur, note, v = 1, p = E, tr) {
      const f = mtof(note);
      const [g, end] = adsr(t, dur, 0.045, v, 0.3, 0.85, 0.12);
      const o = osc('sawtooth', f, t, end, tr), o2 = osc('square', f, t, end, tr, -5), g2 = gain(0.25);
      o.frequency.setValueAtTime(f * 0.97, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
      const sum = gain(1); o.connect(sum); o2.connect(g2); g2.connect(sum);
      const f1 = filt('bandpass', p.f1 ?? 720, 2.2), f2 = filt('bandpass', p.f2 ?? 1250, 3), f3 = filt('bandpass', 2600, 4);
      const m2 = gain(0.6), m3 = gain(0.28), lp = filt('lowpass', 5200);
      sum.connect(f1); sum.connect(f2); sum.connect(f3);
      f1.connect(lp); f2.connect(m2); m2.connect(lp); f3.connect(m3); m3.connect(lp);
      if (dur > 0.3) {
        const lfo = osc('sine', 5.0, t, end, tr), vg = ctx.createGain();
        vg.gain.setValueAtTime(0, t); vg.gain.setValueAtTime(0, t + 0.18); vg.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.6, dur));
        lfo.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
      }
      const n = noise(bufs.white, t, end - t, tr), nb = filt('bandpass', 2400, 1.2), ng = gain(0.07 * v);
      n.connect(nb); nb.connect(ng); ng.connect(g);
      lp.connect(g); g.connect(out);
    },
    pluck(out, t, dur, note, v = 1, p = E, tr) {
      const f = mtof(note), dec = p.decay ?? 0.2;
      const [g, end] = perc(t, v, dec, 0.002);
      const lp = filt('lowpass', p.cutLo ?? 800, p.q ?? 2);
      lp.frequency.setValueAtTime(p.cutHi ?? 3800, t); lp.frequency.setTargetAtTime(p.cutLo ?? 800, t + 0.002, p.fdec ?? 0.05);
      osc(p.wave ?? 'square', f, t, end, tr).connect(lp);
      if (p.det) osc(p.wave2 ?? 'sawtooth', f, t, end, tr, p.det).connect(lp);
      if (p.bp) { const bp = filt('bandpass', p.bp, 1.1); lp.connect(bp); bp.connect(g); } else lp.connect(g);
      g.connect(out);
    },
    ep(out, t, dur, notes, v = 1, p = E, tr) {
      const arr = Array.isArray(notes) ? notes : [notes];
      const peak = v / Math.sqrt(arr.length);
      const g = ctx.createGain(), gp = g.gain;
      const dec = p.decay ?? 1.1;
      gp.setValueAtTime(0, t); gp.linearRampToValueAtTime(peak, t + 0.004); gp.setTargetAtTime(0, t + 0.006, dec / 2.5);
      const rel = Math.max(t + 0.01, t + dur); gp.setTargetAtTime(0, rel, 0.08);
      const end = Math.min(rel + 0.4, t + dec * 3) + 0.02;
      for (const n of arr) {
        const f = mtof(n);
        const car = osc('sine', f, t, end, tr), mod = osc('sine', f * (p.ratio ?? 1), t, end, tr), mg = ctx.createGain();
        mg.gain.setValueAtTime(f * (p.index ?? 1.6), t); mg.gain.setTargetAtTime(f * 0.18, t + 0.005, 0.18);
        mod.connect(mg); mg.connect(car.frequency); car.connect(g);
        const tine = osc('sine', f * 4.02, t, t + 0.25, tr), [tg] = perc(t, 0.07, 0.06);
        tine.connect(tg); tg.connect(g);
      }
      if (p.trem) {
        const lfo = osc('sine', p.trem, t, end, tr), tg = gain(0.25), tremNode = gain(0.75);
        lfo.connect(tg); tg.connect(tremNode.gain); g.connect(tremNode); tremNode.connect(out);
      } else g.connect(out);
    },
    piano(out, t, dur, notes, v = 1, p = E, tr) {
      const arr = Array.isArray(notes) ? notes : [notes];
      const peak = v / Math.sqrt(arr.length);
      const g = ctx.createGain(), gp = g.gain;
      gp.setValueAtTime(0, t); gp.linearRampToValueAtTime(peak, t + 0.003); gp.setTargetAtTime(peak * 0.25, t + 0.004, 0.25);
      const rel = Math.max(t + 0.01, t + dur); gp.setTargetAtTime(0, rel, 0.12);
      const end = rel + 0.6;
      const lp = filt('lowpass', p.cut ?? 3800, 0.5);
      for (const n of arr) {
        const f = mtof(n);
        osc('triangle', f, t, end, tr).connect(lp);
        const h2 = osc('sine', f * 2.001, t, end, tr), hg = gain(0.3); h2.connect(hg); hg.connect(lp);
        const h3 = osc('sine', f * 3.003, t, Math.min(end, t + 0.6), tr), hg3 = gain(0.1); h3.connect(hg3); hg3.connect(lp);
      }
      const n = noise(bufs.white, t, 0.03, tr), nl = filt('lowpass', 2200), [ng] = perc(t, v * 0.12, 0.015);
      n.connect(nl); nl.connect(ng); ng.connect(lp);
      lp.connect(g); g.connect(out);
    },
    brass(out, t, dur, notes, v = 1, p = E, tr) {
      const arr = Array.isArray(notes) ? notes : [notes];
      const [g, end] = adsr(t, dur, p.attack ?? 0.025, v / Math.sqrt(arr.length), 0.3, p.sus ?? 0.8, p.release ?? 0.16);
      const cut = p.cut ?? 2600;
      const lp = filt('lowpass', 400, 1.2);
      lp.frequency.setValueAtTime(380, t); lp.frequency.linearRampToValueAtTime(cut, t + 0.07); lp.frequency.setTargetAtTime(cut * 0.55, t + 0.08, 0.25);
      for (const n of arr) {
        const f = mtof(n);
        osc('sawtooth', f, t, end, tr, -7).connect(lp);
        osc('sawtooth', f, t, end, tr, 7).connect(lp);
      }
      lp.connect(g); g.connect(out);
    },
    chick(out, t, dur, notes, v = 1, p = E, tr) {
      const arr = Array.isArray(notes) ? notes : [notes];
      const [g, end] = perc(t, v / Math.sqrt(arr.length), p.decay ?? 0.05, 0.001);
      const bp = filt('bandpass', p.f ?? 1700, 1.3), hp = filt('highpass', 450);
      for (const n of arr) osc('sawtooth', mtof(n), t, end, tr).connect(bp);
      bp.connect(hp); hp.connect(g); g.connect(out);
    },
    gtr(out, t, dur, note, v = 1, p = E, tr) {
      const f = mtof(note);
      const [g, end] = adsr(t, dur, 0.008, v, 0.4, 0.8, 0.18);
      const pre = gain(p.drive ?? 3), ws = ctx.createWaveShaper(); ws.curve = curveHard; ws.oversample = '2x';
      const o1 = osc('sawtooth', f, t, end, tr, -6), o2 = osc('sawtooth', f, t, end, tr, 6);
      if (p.glideFrom) for (const o of [o1, o2]) { o.frequency.setValueAtTime(mtof(p.glideFrom), t); o.frequency.exponentialRampToValueAtTime(f, t + 0.07); }
      o1.connect(pre); o2.connect(pre); pre.connect(ws);
      const lp = filt('lowpass', p.cut ?? 3000, 0.9), post = gain(0.35);
      ws.connect(lp); lp.connect(post); post.connect(g);
      if (dur > 0.35) {
        const lfo = osc('sine', 5.6, t, end, tr), vg = ctx.createGain();
        vg.gain.setValueAtTime(0, t + 0.2); vg.gain.linearRampToValueAtTime(f * 0.014, t + Math.min(0.7, dur));
        lfo.connect(vg); vg.connect(o1.frequency); vg.connect(o2.frequency);
      }
      g.connect(out);
    },
    bell(out, t, dur, note, v = 1, p = E, tr) {
      const f = mtof(note), dec = p.decay ?? 1.4;
      const [g, end] = perc(t, v, dec, 0.002);
      const car = osc('sine', f, t, end, tr), mod = osc('sine', f * (p.ratio ?? 3.5), t, end, tr), mg = ctx.createGain();
      mg.gain.setValueAtTime(f * (p.index ?? 2.5), t); mg.gain.setTargetAtTime(f * 0.2, t, dec / 3);
      mod.connect(mg); mg.connect(car.frequency); car.connect(g); g.connect(out);
    },
    sub(out, t, dur, note, v = 1, p = E, tr) {
      const f = mtof(note);
      const [g, end] = adsr(t, dur, 0.01, v, 0.3, 0.85, p.release ?? 0.08);
      const o = osc('sine', f, t, end, tr), o2 = osc('triangle', f, t, end, tr), g2 = gain(0.25), lp = filt('lowpass', p.cut ?? 420, 0.7);
      if (p.glideFrom) { o.frequency.setValueAtTime(mtof(p.glideFrom), t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08); }
      o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(out);
    },
    // riser / sweep for transitions (note ignored)
    riser(out, t, dur, note, v = 1, p = E, tr) {
      const [g, end] = adsr(t, dur, dur * 0.9, v * 0.5, 0, 1, 0.05);
      const n = noise(bufs.white, t, end - t, tr), bp = filt('bandpass', 400, 3);
      bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(p.to ?? 6000, t + dur);
      n.connect(bp); bp.connect(g); g.connect(out);
    },
    /** Reedy harmonica: square+saw through a nasal formant, breath noise, wide vibrato. */
    harmonica(out, t, dur, note, v = 1, p = E, tr) {
      const f = mtof(note);
      const [g, end] = adsr(t, dur, 0.035, v, 0.2, 0.85, 0.09);
      const o = osc('square', f, t, end, tr), o2 = osc('sawtooth', f, t, end, tr, 6), g2 = gain(0.5);
      const bp = filt('bandpass', p.f ?? 1400, 1.3), lp = filt('lowpass', 3600);
      o.connect(bp); o2.connect(g2); g2.connect(bp); bp.connect(lp);
      if (dur > 0.3) {
        const lfo = osc('sine', 5.8, t, end, tr), vg = ctx.createGain();
        vg.gain.setValueAtTime(0, t + 0.12); vg.gain.linearRampToValueAtTime(f * 0.01, t + Math.min(0.5, dur));
        lfo.connect(vg); vg.connect(o.frequency); vg.connect(o2.frequency);
      }
      const n = noise(bufs.white, t, end - t, tr), nb = filt('bandpass', 2600, 1), ng = gain(0.05 * v);
      n.connect(nb); nb.connect(ng); ng.connect(g);
      lp.connect(g); g.connect(out);
    },
    /** Karplus-Strong plucked string (acoustic / nylon guitar). Buffers are rendered once per pitch. */
    ks(out, t, dur, note, v = 1, p = E, tr) {
      const arr = Array.isArray(note) ? note : [note];
      const g = ctx.createGain(), gp = g.gain, peak = v / Math.sqrt(arr.length);
      gp.setValueAtTime(peak, t);
      const rel = t + Math.max(0.05, dur);
      gp.setTargetAtTime(0, rel, p.mute ?? 0.06);
      const end = Math.min(rel + 0.4, t + 2.4);
      const lp = filt('lowpass', p.cut ?? 4200, 0.5);
      lp.connect(g); g.connect(out);
      arr.forEach((n, i) => {
        const s = ctx.createBufferSource();
        s.buffer = ksBuffer(n, p.bright ?? 0.5);
        s.connect(lp);
        const ts = t + i * (p.strum ?? 0);
        s.start(ts); s.stop(end); tr.add(s, end);
      });
    },
  };

  // Karplus-Strong cache: midi*10+brightness bucket -> AudioBuffer
  const ksCache = new Map();
  function ksBuffer(midi, bright) {
    const b10 = Math.round(Math.max(0, Math.min(1, bright)) * 4);
    const key = midi * 10 + b10;
    let buf = ksCache.get(key);
    if (buf) return buf;
    const sr = ctx.sampleRate, len = Math.floor(sr * 2.2);
    buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const P = sr / mtof(midi);
    const L = Math.max(2, Math.floor(P - 0.5)), frac = P - 0.5 - L;
    // pluck excitation: noise, low-passed more for darker tones, with a pick-position comb
    let lpState = 0;
    const k = 0.25 + b10 * 0.18;
    for (let i = 0; i < L + 2; i++) { lpState += k * ((Math.random() * 2 - 1) - lpState); d[i] = lpState; }
    const pick = Math.floor(L * 0.18);
    for (let i = L + 1; i > pick; i--) d[i] -= 0.6 * d[i - pick];
    // per-pitch decay so low strings ring longer than high ones
    const decay = 0.9985 - Math.max(0, midi - 50) * 0.00006;
    for (let i = L + 2; i < len; i++) {
      const a = 0.5 * (d[i - L] + d[i - L - 1]), b = 0.5 * (d[i - L - 1] + d[i - L - 2]);
      d[i] = decay * ((1 - frac) * a + frac * b);
    }
    // normalise
    let m = 0; for (let i = 0; i < Math.min(len, sr * 0.2); i++) m = Math.max(m, Math.abs(d[i]));
    if (m > 0) { const s = 0.8 / m; for (let i = 0; i < len; i++) d[i] *= s; }
    ksCache.set(key, buf);
    return buf;
  }
  return I;
}
