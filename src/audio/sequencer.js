// Playback plumbing shared by the radio and music cues:
//   makeFxSet  - hall reverb, 80s gated reverb and tempo delay returning into one output
//   Session    - per-playback channel strip (gain + sends), insert chain, and a Tracker for hard stops
//   SongPlayer - lookahead scheduler that turns bar events into instrument calls
import { Tracker, makeImpulse } from './util.js';

export function makeFxSet(ctx, out, { gated = true, hallSec = 2.6 } = {}) {
  const hall = ctx.createConvolver();
  hall.buffer = makeImpulse(ctx, { duration: hallSec, decay: 3.2, damping: 0.7, predelay: 0.02 });
  const hallIn = ctx.createGain();
  const hallHp = ctx.createBiquadFilter(); hallHp.type = 'highpass'; hallHp.frequency.value = 180;
  hallIn.connect(hallHp); hallHp.connect(hall); hall.connect(out);
  let gatedIn = hallIn;
  if (gated) {
    const gv = ctx.createConvolver();
    gv.buffer = makeImpulse(ctx, { duration: 0.42, gated: true, damping: 0.3, predelay: 0.005 });
    gatedIn = ctx.createGain();
    gatedIn.connect(gv); gv.connect(out);
  }
  const delayIn = ctx.createGain();
  const delay = ctx.createDelay(2.0); delay.delayTime.value = 0.375;
  const fb = ctx.createGain(); fb.gain.value = 0.33;
  const fbLp = ctx.createBiquadFilter(); fbLp.type = 'lowpass'; fbLp.frequency.value = 2600;
  delayIn.connect(delay); delay.connect(fbLp); fbLp.connect(fb); fb.connect(delay); fbLp.connect(out);
  return {
    hall: hallIn, gated: gatedIn, delay: delayIn,
    setDelay(sec) { delay.delayTime.setTargetAtTime(Math.min(1.9, sec), ctx.currentTime, 0.05); },
  };
}

/** Optional per-station insert chains. Return {input, output, sources} */
export function makeInsert(kind, ctx, bufs) {
  if (kind === 'lofi') {
    const input = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3600; lp.Q.value = 0.5;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 60;
    const wow = ctx.createDelay(0.1); wow.delayTime.value = 0.014;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.42;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.0016;
    lfo.connect(lfoG); lfoG.connect(wow.delayTime);
    const output = ctx.createGain();
    input.connect(hp); hp.connect(lp); lp.connect(wow); wow.connect(output);
    const crackle = ctx.createBufferSource(); crackle.buffer = bufs.crackle; crackle.loop = true;
    const cg = ctx.createGain(); cg.gain.value = 0.16;
    crackle.connect(cg); cg.connect(output);
    const t = ctx.currentTime; lfo.start(t); crackle.start(t, Math.random() * 3);
    return { input, output, sources: [lfo, crackle] };
  }
  if (kind === 'talk') {
    const input = ctx.createGain(); input.gain.value = 0.55;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    input.connect(lp);
    return { input, output: lp, sources: [] };
  }
  return null;
}

export class Session {
  /**
   * @param sys   object with {ctx, bufs}
   * @param dest  AudioNode the session mixes into
   * @param channels  {name: {gain, rev?, gated?, dly?}}
   * @param fx    fx set from makeFxSet
   * @param insertKind  optional insert name
   */
  constructor(sys, dest, channels, fx, insertKind, trim = 0.55, fadeIn = 0.09) {
    const ctx = sys.ctx;
    this.ctx = ctx;
    this.tr = new Tracker();
    this.nodes = [];
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0, ctx.currentTime);
    this.out.gain.setTargetAtTime(trim, ctx.currentTime, fadeIn / 3);
    this.out.connect(dest);
    let input = this.out;
    this.persistent = [];
    const ins = insertKind ? makeInsert(insertKind, ctx, sys.bufs) : null;
    if (ins) { ins.output.connect(this.out); input = ins.input; this.nodes.push(ins.input, ins.output); this.persistent = ins.sources; }
    this.ch = {};
    for (const name in channels) {
      const cfg = channels[name];
      const g = ctx.createGain(); g.gain.value = cfg.gain ?? 0.5;
      g.connect(input);
      this.nodes.push(g);
      const send = (amt, target) => { if (!amt || !target) return; const s = ctx.createGain(); s.gain.value = amt; g.connect(s); s.connect(target); this.nodes.push(s); };
      send(cfg.rev, fx.hall); send(cfg.gated, fx.gated); send(cfg.dly, fx.delay);
      this.ch[name] = g;
    }
    this.stopped = false;
  }
  stop(fade = 0.08) {
    if (this.stopped) return;
    this.stopped = true;
    const ctx = this.ctx, t = ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.setTargetAtTime(0, t, fade / 3);
    this.tr.stopAll(t + fade * 1.5);
    for (const s of this.persistent) { try { s.stop(t + fade * 1.5); } catch { /* noop */ } }
    setTimeout(() => {
      for (const n of this.nodes) { try { n.disconnect(); } catch { /* noop */ } }
      try { this.out.disconnect(); } catch { /* noop */ }
    }, (fade * 2 + 0.3) * 1000);
  }
}

/** Applies swing to off-beat 16ths. */
export function evTime(ev, swing) {
  if (!swing) return ev.t;
  const s = ev.t * 4, step = Math.round(s);
  if (Math.abs(s - step) < 0.01 && (step & 1)) return ev.t + swing * 0.25;
  return ev.t;
}

export function playEvent(inst, session, timbre, ev, t, beatDur, durOverride) {
  const tm = timbre[ev.ch];
  if (!tm) return;
  const out = session.ch[ev.ch];
  if (!out) return;
  const fn = inst[ev.i || tm.inst];
  if (!fn) return;
  const p = ev.p ? Object.assign({}, tm.p, ev.p) : tm.p;
  fn(out, t, durOverride ?? ev.d * beatDur, ev.n, ev.v * (tm.v ?? 1), p, session.tr);
}

/**
 * Schedules a source {beatDur, barDur, totalBars, swing, timbre, barEvents(bar)} with lookahead.
 * pump() returns false once every bar has been scheduled (non-looping) — endTime is then the song end.
 */
export class SongPlayer {
  constructor(inst, session, src, { startBar = 0, startTime, loop = false, loopTo = 0, joining = false } = {}) {
    this.inst = inst; this.session = session; this.src = src; this.loop = loop; this.loopTo = loopTo;
    this.bar = startBar; this.barStart = startTime;
    this.events = src.barEvents(startBar); this.ei = 0;
    this.joining = joining; this.done = false; this.endTime = startTime + (src.totalBars - startBar) * src.barDur;
    this.onBar = null;
  }
  pump(now, lookahead) {
    if (this.done) return false;
    const src = this.src, horizon = now + lookahead;
    for (let guard = 0; guard < 512; guard++) {
      if (this.ei >= this.events.length) {
        if (this.barStart + src.barDur > horizon) break;
        this.bar++;
        this.barStart += src.barDur;
        if (this.bar >= src.totalBars) {
          if (this.loop) this.bar = this.loopTo;
          else { this.done = true; this.endTime = this.barStart; return false; }
        }
        this.events = src.barEvents(this.bar);
        this.ei = 0;
        if (this.onBar) this.onBar(this.bar, this.barStart);
        continue;
      }
      const ev = this.events[this.ei];
      const t = this.barStart + evTime(ev, src.swing) * src.beatDur;
      if (t > horizon) break;
      this.ei++;
      if (t < now - 0.004) {
        // joining a song mid-bar: keep long notes that are still ringing
        if (this.joining) {
          const end = t + ev.d * src.beatDur;
          if (ev.d * src.beatDur > 0.6 && end > now + 0.2) playEvent(this.inst, this.session, src.timbre, ev, now + 0.01, src.beatDur, end - now - 0.01);
        }
        continue;
      }
      playEvent(this.inst, this.session, src.timbre, ev, t, src.beatDur);
    }
    this.joining = false;
    return true;
  }
}
