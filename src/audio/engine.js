// Positional vehicle engine: harmonic firing-frequency oscillators through load-dependent drive and
// filtering, intake/exhaust noise, roughness AM, road/tyre noise, skid squeal and an optional siren.
import { makePanner, setPannerPos, smooth } from './util.js';

const waveCache = new WeakMap();

export const ENGINE_TYPES = {
  sports: { idle: 900, max: 7800, cyl: 8, sub: 0.55, noise: 0.22, cutLo: 520, cutHi: 4600, gain: 0.85, whine: 0, rough: 0.32, intake: 2.6, drive: 2.2 },
  sedan: { idle: 750, max: 6500, cyl: 4, sub: 0.32, noise: 0.16, cutLo: 380, cutHi: 2600, gain: 0.55, whine: 0.04, rough: 0.22, intake: 3, drive: 1.4 },
  taxi: { idle: 700, max: 5600, cyl: 4, sub: 0.22, noise: 0.1, cutLo: 300, cutHi: 1800, gain: 0.42, whine: 0.16, rough: 0.18, intake: 3, drive: 1.1 },
  bus: { idle: 600, max: 2500, cyl: 6, sub: 0.7, noise: 0.45, cutLo: 240, cutHi: 1300, gain: 0.85, whine: 0.06, rough: 0.5, intake: 5, drive: 2.5, diesel: true },
  truck: { idle: 650, max: 2800, cyl: 6, sub: 0.75, noise: 0.5, cutLo: 260, cutHi: 1500, gain: 0.85, whine: 0.03, rough: 0.55, intake: 5, drive: 2.8, diesel: true },
  bike: { idle: 1400, max: 11000, cyl: 2, sub: 0.15, noise: 0.25, cutLo: 700, cutHi: 5200, gain: 0.5, whine: 0, rough: 0.45, intake: 4, drive: 3 },
  police: { idle: 800, max: 6800, cyl: 6, sub: 0.4, noise: 0.18, cutLo: 420, cutHi: 3000, gain: 0.6, whine: 0.03, rough: 0.28, intake: 3, drive: 1.6 },
  // watercraft: piston core + hull slap / spray / wake layer (no tyres)
  boat: { idle: 700, max: 5600, cyl: 6, sub: 0.65, noise: 0.32, cutLo: 300, cutHi: 1900, gain: 0.7, whine: 0, rough: 0.38, intake: 3.5, drive: 2.1, water: true },
  jetski: { idle: 1700, max: 8800, cyl: 2, sub: 0.18, noise: 0.38, cutLo: 800, cutHi: 5400, gain: 0.55, whine: 0, rough: 0.5, intake: 4.5, drive: 3.4, water: true },
  // rotorcraft (RotorSound)
  heli: { rotor: true, gain: 2.6 },
  drone: { rotor: true, gain: 0.5 },
};

/** Pulse-train PeriodicWave (all harmonics in cosine phase) for rotor "chop" amplitude modulation. */
export function pulseWave(ctx) {
  let m = waveCache.get(ctx);
  if (!m) { m = new Map(); waveCache.set(ctx, m); }
  if (m.has('pulse')) return m.get('pulse');
  const N = 18, real = new Float32Array(N), imag = new Float32Array(N);
  for (let h = 1; h < N; h++) real[h] = 1 - h / N;
  const w = ctx.createPeriodicWave(real, imag);
  m.set('pulse', w);
  return w;
}

function engineWave(ctx, cyl) {
  let m = waveCache.get(ctx);
  if (!m) { m = new Map(); waveCache.set(ctx, m); }
  if (m.has(cyl)) return m.get(cyl);
  const N = 24, real = new Float32Array(N), imag = new Float32Array(N);
  for (let h = 1; h < N; h++) {
    // firing pulses: strong low harmonics, odd/even colour by cylinder count
    let a = 1 / Math.pow(h, 0.85);
    if (cyl >= 6 && h % 2 === 0) a *= 0.7;
    if (cyl <= 2 && h % 2 === 1) a *= 1.25;
    imag[h] = a * (h % 3 === 0 ? 0.8 : 1);
  }
  const w = ctx.createPeriodicWave(real, imag);
  m.set(cyl, w);
  return w;
}

export class EngineSound {
  constructor(ctx, bufs, dest, type = 'sedan', { hrtf = false, water = true } = {}) {
    this.ctx = ctx; this.type = type; this.onWater = water;
    const P = this.P = ENGINE_TYPES[type] || ENGINE_TYPES.sedan;
    const t = ctx.currentTime;
    const sources = this.sources = [];
    const mk = (type, f) => { const o = ctx.createOscillator(); if (type === 'engine') o.setPeriodicWave(engineWave(ctx, P.cyl)); else o.type = type; o.frequency.value = f; sources.push(o); return o; };
    const g = v => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const f = (type, fr, q = 0.7) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = fr; n.Q.value = q; return n; };
    const loop = buf => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; sources.push(s); return s; };

    this.panner = makePanner(ctx, { ref: 6, max: 500, rolloff: 1.1, hrtf });
    this.out = g(0);
    this.out.connect(this.panner); this.panner.connect(dest);
    this.out.gain.setTargetAtTime(P.gain * 0.5, t, 0.15);

    // tonal core
    this.o1 = mk('engine', 30); this.o2 = mk('sawtooth', 15); this.o3 = mk('square', 30);
    this.o3.detune.value = 14;
    this.pre = g(1);
    const g2 = g(P.sub), g3 = g(0.22);
    this.o1.connect(this.pre); this.o2.connect(g2); g2.connect(this.pre); this.o3.connect(g3); g3.connect(this.pre);
    this.shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 2.2); }
    this.shaper.curve = curve;
    this.lp = f('lowpass', P.cutLo, 1.2);
    this.amp = g(1 - P.rough * 0.5);
    this.pre.connect(this.shaper); this.shaper.connect(this.lp); this.lp.connect(this.amp); this.amp.connect(this.out);
    // roughness AM at crank rate
    this.rough = mk('sine', 10); this.roughG = g(P.rough * 0.5);
    this.rough.connect(this.roughG); this.roughG.connect(this.amp.gain);
    // intake / exhaust noise
    this.noise = loop(bufs.white); this.nbp = f('bandpass', 400, 1.6); this.ng = g(0);
    this.noise.connect(this.nbp); this.nbp.connect(this.ng); this.ng.connect(this.amp);
    // gear / electric whine
    this.whine = mk('sine', 300); this.wg = g(0);
    this.whine.connect(this.wg); this.wg.connect(this.out);
    if (!P.water) {
      // road + tyre roll
      this.road = loop(bufs.brown); this.rlp = f('lowpass', 520); this.rg = g(0);
      this.road.connect(this.rlp); this.rlp.connect(this.rg); this.rg.connect(this.out);
      // skid squeal
      this.skidN = loop(bufs.white); this.sbp = f('bandpass', 2000, 7); this.sg = g(0);
      this.skidN.connect(this.sbp); this.sbp.connect(this.sg); this.sg.connect(this.out);
      this.skidT = mk('sine', 1120); this.stg = g(0);
      this.skidV = mk('sine', 10); const sv = g(38); this.skidV.connect(sv); sv.connect(this.skidT.frequency);
      this.skidT.connect(this.stg); this.stg.connect(this.out);
    } else {
      // hull slap: low thumps pulsing at a speed-dependent rate
      this.slapAmp = g(0.3); this.slapG = g(0);
      this.slapN = loop(bufs.brown); const slp = f('bandpass', 260, 1.1);
      this.slapN.connect(slp); slp.connect(this.slapAmp); this.slapAmp.connect(this.slapG); this.slapG.connect(this.out);
      this.slapLfo = ctx.createOscillator(); this.slapLfo.setPeriodicWave(pulseWave(ctx)); this.slapLfo.frequency.value = 1.5; sources.push(this.slapLfo);
      const sd = g(0.35); this.slapLfo.connect(sd); sd.connect(this.slapAmp.gain);
      this.slapLfo2 = mk('sine', 0.37); const sd2 = g(0.15); this.slapLfo2.connect(sd2); sd2.connect(this.slapAmp.gain);
      // spray hiss + wake wash
      this.sprayN = loop(bufs.white); this.sprayF = f('highpass', 2600); this.sprayG = g(0);
      this.sprayN.connect(this.sprayF); this.sprayF.connect(this.sprayG); this.sprayG.connect(this.out);
      this.wakeN = loop(bufs.pink); this.wakeF = f('lowpass', 900); this.wakeG = g(0);
      this.wakeN.connect(this.wakeF); this.wakeF.connect(this.wakeG); this.wakeG.connect(this.out);
    }
    // siren (Singapore Police style hi-lo)
    this.siren = null;
    for (const s of sources) s.start(t, s.buffer ? Math.random() * 1.5 : 0);
    if (type === 'police') this._makeSiren(); // starts its own nodes
    this.disposed = false;
  }

  _makeSiren() {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 800;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 0.95;
    const depth = ctx.createGain(); depth.gain.value = 165;
    const smoothLp = ctx.createBiquadFilter(); smoothLp.type = 'lowpass'; smoothLp.frequency.value = 18; // softens the hi-lo steps a touch
    lfo.connect(smoothLp); smoothLp.connect(depth); depth.connect(o.frequency);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 1200; pk.gain.value = 5;
    const sg = ctx.createGain(); sg.gain.value = 0;
    o.connect(lp); lp.connect(pk); pk.connect(sg); sg.connect(this.out);
    o.start(t); lfo.start(t);
    this.sources.push(o, lfo);
    this.siren = sg;
  }

  /** rpm 0..1, throttle 0..1, speed m/s, position {x,y,z}, skid 0..1, siren bool */
  update({ rpm = 0, throttle = 0, speed = 0, position, skid = 0, siren = false, water } = {}) {
    if (this.disposed) return;
    const ctx = this.ctx, P = this.P;
    rpm = Math.max(0, Math.min(1, rpm)); throttle = Math.max(0, Math.min(1, throttle));
    const rpmAbs = P.idle + rpm * (P.max - P.idle);
    const F = rpmAbs / 60 * P.cyl / 2;
    smooth(this.o1.frequency, F, ctx, 0.025, 0.004);
    smooth(this.o2.frequency, F * 0.5, ctx, 0.025, 0.004);
    smooth(this.o3.frequency, F, ctx, 0.025, 0.004);
    smooth(this.rough.frequency, rpmAbs / 60, ctx, 0.05, 0.01);
    smooth(this.nbp.frequency, Math.min(9000, F * P.intake), ctx, 0.04, 0.01);
    smooth(this.pre.gain, 0.5 + throttle * P.drive, ctx, 0.05, 0.01);
    const cut = P.cutLo + (P.cutHi - P.cutLo) * Math.min(1, 0.3 * rpm + 0.7 * throttle * Math.sqrt(rpm + 0.05));
    smooth(this.lp.frequency, cut, ctx, 0.05, 0.01);
    smooth(this.ng.gain, P.noise * (0.25 + throttle * 0.9) * (P.diesel ? 1.2 : 1), ctx, 0.05, 0.01);
    smooth(this.out.gain, P.gain * (0.42 + 0.33 * throttle + 0.25 * rpm), ctx, 0.06, 0.01);
    smooth(this.whine.frequency, 120 + speed * 38, ctx, 0.05, 0.01);
    smooth(this.wg.gain, P.whine * Math.min(1, speed / 18) * 0.25, ctx, 0.08, 0.01);
    if (!P.water) {
      smooth(this.rg.gain, Math.min(0.32, speed / 70) * 0.8, ctx, 0.1, 0.01);
      smooth(this.rlp.frequency, 250 + speed * 18, ctx, 0.1, 0.01);
      const sk = Math.pow(Math.max(0, Math.min(1, skid)), 1.5);
      smooth(this.sg.gain, sk * 0.5, ctx, 0.04, 0.01);
      smooth(this.stg.gain, sk * 0.1, ctx, 0.04, 0.01);
    } else {
      if (water !== undefined) this.onWater = !!water;
      const w = this.onWater ? 1 : 0, sp = Math.max(0, speed);
      smooth(this.slapG.gain, w * Math.pow(Math.min(1, sp / 14), 1.2) * 0.55 + w * 0.06, ctx, 0.15, 0.01);
      smooth(this.slapLfo.frequency, 0.8 + sp * 0.32, ctx, 0.2, 0.01);
      smooth(this.sprayG.gain, w * Math.pow(Math.max(0, Math.min(1, (sp - 3) / 22)), 1.5) * 0.32, ctx, 0.15, 0.01);
      smooth(this.wakeG.gain, w * Math.min(1, sp / 20) * 0.4, ctx, 0.2, 0.01);
      smooth(this.wakeF.frequency, 500 + sp * 40, ctx, 0.2, 0.01);
    }
    if (siren && !this.siren) this._makeSiren();
    if (this.siren) smooth(this.siren.gain, siren ? 0.22 : 0, ctx, 0.05, 0.01);
    if (position) setPannerPos(this.panner, position);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, 0.05);
    for (const s of this.sources) { try { s.stop(t + 0.3); } catch { /* noop */ } }
    setTimeout(() => { try { this.panner.disconnect(); this.out.disconnect(); } catch { /* noop */ } }, 500);
    this.onDispose?.();
  }
}

/**
 * Helicopter / drone. heli: turbine whine + main-rotor chop (pulse AM on rumble, thump and blade swish)
 * + tail-rotor buzz, rate follows rpm; loud and far-reaching. drone: four detuned rotor buzzes that wobble.
 */
export class RotorSound {
  constructor(ctx, bufs, dest, type = 'heli', { hrtf = false } = {}) {
    this.ctx = ctx; this.type = type; this.heli = type !== 'drone';
    const P = this.P = ENGINE_TYPES[type];
    const t = ctx.currentTime;
    const sources = this.sources = [];
    const g = v => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const f = (ty, fr, q = 0.7) => { const n = ctx.createBiquadFilter(); n.type = ty; n.frequency.value = fr; n.Q.value = q; return n; };
    const loop = buf => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; sources.push(s); return s; };
    const mk = (ty, fr) => { const o = ctx.createOscillator(); o.type = ty; o.frequency.value = fr; sources.push(o); return o; };
    this.panner = this.heli ? makePanner(ctx, { ref: 30, max: 2500, rolloff: 0.6, hrtf }) : makePanner(ctx, { ref: 3, max: 150, rolloff: 1.2, hrtf });
    this.out = g(0); this.out.connect(this.panner); this.panner.connect(dest);
    if (this.heli) {
      this.lfo = ctx.createOscillator(); this.lfo.setPeriodicWave(pulseWave(ctx)); this.lfo.frequency.value = 4; sources.push(this.lfo);
      // rumble chop
      this.chop = g(0.3); const cd = g(0.32); this.lfo.connect(cd); cd.connect(this.chop.gain);
      loop(bufs.brown).connect(f('lowpass', 650)).connect(this.chop); this.chop.connect(this.out);
      // low thump
      this.thump = g(0.05); const td = g(0.5); this.lfo.connect(td); td.connect(this.thump.gain);
      const th = mk('sine', 46); th.connect(this.thump); const thg = g(0.7); this.thump.connect(thg); thg.connect(this.out);
      // blade swish
      this.swish = g(0.04); const sd = g(0.12); this.lfo.connect(sd); sd.connect(this.swish.gain);
      loop(bufs.white).connect(f('bandpass', 1700, 0.7)).connect(this.swish); const swg = g(0.5); this.swish.connect(swg); swg.connect(this.out);
      // turbine + whine
      this.turb = mk('sawtooth', 900); this.turbF = f('bandpass', 1800, 4); this.turbG = g(0);
      this.turb.connect(this.turbF); this.turbF.connect(this.turbG); this.turbG.connect(this.out);
      this.whine = mk('sine', 3000); this.whineG = g(0); this.whine.connect(this.whineG); this.whineG.connect(this.out);
      // tail rotor buzz
      this.tail = mk('square', 30); this.tailF = f('lowpass', 420); this.tailG = g(0);
      this.tail.connect(this.tailF); this.tailF.connect(this.tailG); this.tailG.connect(this.out);
    } else {
      this.rotors = [];
      const bp = f('bandpass', 900, 0.55), hs = f('highshelf', 3000); hs.gain.value = 5;
      this.droneG = g(0.25); bp.connect(hs); hs.connect(this.droneG); this.droneG.connect(this.out);
      for (let i = 0; i < 4; i++) {
        const o = mk('sawtooth', 180), w = mk('sine', 0.35 + i * 0.17), wd = g(3);
        w.connect(wd); wd.connect(o.frequency); o.connect(bp);
        this.rotors.push({ o, wd, k: 1 + (i - 1.5) * 0.025 });
      }
      this.hiss = g(0); loop(bufs.white).connect(f('bandpass', 3200, 0.8)).connect(this.hiss); this.hiss.connect(this.out);
    }
    for (const s of sources) s.start(t, s.buffer ? Math.random() * 1.5 : 0);
    this.disposed = false;
  }
  /** rpm 0..1 (rotor speed), throttle 0..1 (collective / load), position */
  update({ rpm = 0, throttle = 0, speed = 0, position } = {}) {
    if (this.disposed) return;
    const ctx = this.ctx, P = this.P;
    rpm = Math.max(0, Math.min(1, rpm)); throttle = Math.max(0, Math.min(1, throttle));
    if (this.heli) {
      const rate = 1 + rpm * 15.5;
      smooth(this.lfo.frequency, rate, ctx, 0.08, 0.004);
      smooth(this.tail.frequency, rate * 5.2, ctx, 0.08, 0.004);
      smooth(this.turb.frequency, 500 + rpm * 2600, ctx, 0.1, 0.004);
      smooth(this.turbF.frequency, 900 + rpm * 3800, ctx, 0.1, 0.004);
      smooth(this.whine.frequency, 1800 + rpm * 4200, ctx, 0.1, 0.004);
      smooth(this.turbG.gain, 0.03 + rpm * 0.05, ctx, 0.1, 0.01);
      smooth(this.whineG.gain, 0.015 + rpm * 0.02, ctx, 0.1, 0.01);
      smooth(this.tailG.gain, rpm * 0.09, ctx, 0.1, 0.01);
      smooth(this.out.gain, P.gain * (0.15 + rpm * 0.65 + throttle * 0.25), ctx, 0.12, 0.01);
    } else {
      const base = 150 + rpm * 260 + throttle * 60;
      for (const r of this.rotors) { smooth(r.o.frequency, base * r.k, ctx, 0.05, 0.004); smooth(r.wd.gain, base * 0.012, ctx, 0.2, 0.01); }
      smooth(this.hiss.gain, 0.02 + throttle * 0.05, ctx, 0.1, 0.01);
      smooth(this.out.gain, P.gain * (rpm > 0.01 ? 0.35 + rpm * 0.5 + throttle * 0.15 : 0), ctx, 0.1, 0.01);
    }
    if (position) setPannerPos(this.panner, position);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, 0.08);
    for (const s of this.sources) { try { s.stop(t + 0.5); } catch { /* noop */ } }
    setTimeout(() => { try { this.panner.disconnect(); this.out.disconnect(); } catch { /* noop */ } }, 700);
    this.onDispose?.();
  }
}

/** Factory: piston engines, watercraft and rotorcraft behind one interface. */
export function makeEngineSound(ctx, bufs, dest, type, opts) {
  return ENGINE_TYPES[type]?.rotor ? new RotorSound(ctx, bufs, dest, type, opts) : new EngineSound(ctx, bufs, dest, type, opts);
}
