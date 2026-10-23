// World ambience: continuous beds (traffic, rain, harbour, night insects) + scheduled calls
// (koels, mynas, sunbirds by day; frogs at night) + thunder during heavy rain.
import { makePanner, setPannerPos, smooth } from './util.js';

export class Ambience {
  /** sys needs {ctx, bufs, ambIn (dest), sfx(name, opts)} */
  constructor(sys) {
    this.sys = sys;
    const ctx = this.ctx = sys.ctx, B = sys.bufs, dest = sys.ambIn;
    const t = ctx.currentTime;
    this.sources = [];
    const g = v => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const f = (type, fr, q = 0.7) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = fr; n.Q.value = q; return n; };
    const bed = (buf, chain, out) => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; this.sources.push(s);
      let n = s; for (const c of chain) { n.connect(c); n = c; } n.connect(out);
      s.start(t, Math.random() * (buf.duration - 0.1));
      return s;
    };
    const lfo = (rate, depth, target, type = 'sine') => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = rate; this.sources.push(o);
      const d = g(depth); o.connect(d); d.connect(target); o.start(t); return o;
    };

    // city traffic: rumble + distant hiss
    this.traffic = g(0); this.traffic.connect(dest);
    bed(B.brownSt, [f('lowpass', 320)], this.traffic);
    const hiss = g(0.22); hiss.connect(this.traffic);
    bed(B.pinkSt, [f('bandpass', 850, 0.6)], hiss);
    lfo(0.07, 0.08, hiss.gain);

    // rain: hiss + body; roof drumming for in-car
    this.rain = g(0); this.rain.connect(dest);
    bed(B.whiteSt, [f('highpass', 2600), f('lowpass', 9500)], this.rain);
    const body = g(0.6); body.connect(this.rain);
    bed(B.pinkSt, [f('bandpass', 1300, 0.6)], body);
    this.roof = g(0); this.roof.connect(dest);
    bed(B.brownSt, [f('bandpass', 420, 0.9)], this.roof);
    const roofTick = g(0.35); roofTick.connect(this.roof);
    bed(B.crackle, [f('bandpass', 1800, 0.8)], roofTick);

    // harbour lapping
    this.harbour = g(0); this.harbour.connect(dest);
    const lap = g(0.6); lap.connect(this.harbour);
    bed(B.brownSt, [f('lowpass', 480)], lap);
    lfo(0.16, 0.35, lap.gain); lfo(0.43, 0.15, lap.gain);

    // night insects: cicada band with fast AM + cricket pulses
    this.night = g(0); this.night.connect(dest);
    const cic = g(0.5); cic.connect(this.night);
    const cicAm = g(0.5); cicAm.connect(cic);
    bed(B.whiteSt, [f('bandpass', 4700, 7), f('peaking', 5200, 2)], cicAm);
    lfo(46, 0.45, cicAm.gain); lfo(0.11, 0.3, cic.gain);
    const cr = ctx.createOscillator(); cr.frequency.value = 4350; this.sources.push(cr);
    const crGate = g(0.5), crGroup = g(0.5), crOut = g(0.06);
    cr.connect(crGate); crGate.connect(crGroup); crGroup.connect(crOut); crOut.connect(this.night);
    cr.start(t);
    lfo(17, 0.5, crGate.gain, 'square'); lfo(0.85, 0.5, crGroup.gain, 'square');

    this.birdTimer = 2; this.frogTimer = 4; this.thunderTimer = 8 + Math.random() * 10;
    this.listener = { x: 0, y: 0, z: 0 };
  }

  update(dt, s) {
    const ctx = this.ctx;
    const rain = s.rain || 0, night = s.night || 0, indoor = !!s.indoor, car = !!s.inVehicle, paused = !!s.paused;
    if (s.listenerPos) this.listener = s.listenerPos;
    const out = indoor ? 0.3 : 1;
    smooth(this.traffic.gain, 0.2 * out * (car ? 0.55 : 1) * (1 - night * 0.35), ctx, 0.5);
    smooth(this.rain.gain, rain * 0.55 * (indoor ? 0.35 : car ? 0.5 : 1), ctx, 0.6);
    smooth(this.roof.gain, car ? rain * 0.7 : 0, ctx, 0.3);
    smooth(this.harbour.gain, (s.nearWater || 0) * 0.45 * out, ctx, 0.8);
    smooth(this.night.gain, night * (1 - rain * 0.75) * 0.5 * out * (car ? 0.35 : 1), ctx, 1.0);
    if (paused) return;

    const hour = s.time ?? 12;
    const day = 1 - night;
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 2.5 + Math.random() * 6 / Math.max(0.15, day);
      if (day > 0.4 && rain < 0.5 && !indoor) {
        const dawn = (hour > 5.5 && hour < 9.5) || (hour > 17 && hour < 19.5);
        const r = Math.random();
        if (r < (dawn ? 0.45 : 0.18)) this.koel();
        else if (r < 0.7) this.myna();
        else this.sunbird();
      }
    }
    this.frogTimer -= dt;
    if (this.frogTimer <= 0) {
      this.frogTimer = 1.5 + Math.random() * 5;
      if (night > 0.5 && !indoor) this.frog();
    }
    if (rain > 0.6) {
      this.thunderTimer -= dt;
      if (this.thunderTimer <= 0) {
        this.thunderTimer = 10 + Math.random() * 25 * (1.6 - rain);
        this.sys.sfx?.('thunder', { volume: (0.55 + Math.random() * 0.45) * (indoor ? 0.6 : 1) });
      }
    }
  }

  _emitter(dist = 25) {
    const ctx = this.ctx;
    const p = makePanner(ctx, { ref: 8, max: 300, rolloff: 1 });
    const a = Math.random() * Math.PI * 2, d = dist * (0.6 + Math.random() * 0.8), L = this.listener;
    setPannerPos(p, { x: L.x + Math.cos(a) * d, y: (L.y || 0) + 6 + Math.random() * 10, z: L.z + Math.sin(a) * d });
    p.connect(this.sys.ambIn);
    return p;
  }
  _chirp(out, t, f0, f1, dur, peak, type = 'sine', fm = 0) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + dur * 0.15); g.gain.setTargetAtTime(0, t + dur * 0.6, dur * 0.15);
    if (fm) { const m = ctx.createOscillator(); m.frequency.value = fm; const mg = ctx.createGain(); mg.gain.value = f0 * 0.08; m.connect(mg); mg.connect(o.frequency); m.start(t); m.stop(t + dur + 0.1); }
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.1);
    return t + dur + 0.1;
  }
  /** Asian koel: rising "ko-EL" pairs that climb with each repeat. */
  koel() {
    const ctx = this.ctx, out = this._emitter(45), t0 = ctx.currentTime + 0.05;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1000; bp.Q.value = 1.2; bp.connect(out);
    const reps = 3 + Math.floor(Math.random() * 4);
    let end = t0;
    for (let r = 0; r < reps; r++) {
      const k = 1 + r * 0.055, t = t0 + r * 0.95;
      this._chirp(bp, t, 640 * k, 880 * k, 0.22, 0.22);
      end = this._chirp(bp, t + 0.3, 820 * k, 1300 * k, 0.34, 0.26);
    }
    setTimeout(() => out.disconnect(), (end - ctx.currentTime + 0.5) * 1000);
  }
  myna() {
    const ctx = this.ctx, out = this._emitter(22), t0 = ctx.currentTime + 0.05;
    const n = 3 + Math.floor(Math.random() * 5);
    let t = t0;
    for (let k = 0; k < n; k++) {
      const f0 = 1400 + Math.random() * 1600;
      this._chirp(out, t, f0, f0 * (0.7 + Math.random() * 0.8), 0.06 + Math.random() * 0.08, 0.07, Math.random() < 0.5 ? 'square' : 'sawtooth', 60 + Math.random() * 90);
      t += 0.1 + Math.random() * 0.18;
    }
    setTimeout(() => out.disconnect(), (t - ctx.currentTime + 0.5) * 1000);
  }
  sunbird() {
    const ctx = this.ctx, out = this._emitter(18), t0 = ctx.currentTime + 0.05;
    const n = 4 + Math.floor(Math.random() * 6);
    let t = t0;
    for (let k = 0; k < n; k++) { const f0 = 3800 + Math.random() * 1800; this._chirp(out, t, f0, f0 * (1.1 + Math.random() * 0.4), 0.05, 0.08); t += 0.07 + Math.random() * 0.06; }
    setTimeout(() => out.disconnect(), (t - ctx.currentTime + 0.5) * 1000);
  }
  frog() {
    const ctx = this.ctx, out = this._emitter(20), t0 = ctx.currentTime + 0.05;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520 + Math.random() * 200; bp.Q.value = 4; bp.connect(out);
    const f0 = 160 + Math.random() * 80;
    for (let k = 0; k < 3; k++) this._chirp(bp, t0 + k * 0.07, f0, f0 * 1.1, 0.035, 0.35, 'sawtooth');
    setTimeout(() => out.disconnect(), 900);
  }
  dispose() { for (const s of this.sources) { try { s.stop(); } catch { /* noop */ } } }
}
