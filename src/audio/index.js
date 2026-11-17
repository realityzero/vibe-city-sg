// Vibe City audio system — everything synthesized at runtime with Web Audio.
//
// Signal flow:
//   radio sessions ─► radioIn ─► radioDuck ─► radioVol ─┐
//   engines ─► enginesBus ─┐                            ├─► muffle LP ─► worldGain ─┐
//   ambience ─► ambLP ─────┼─► sfxBus (+ sfx hall) ─────┘                           ├─► master ─► comp ─► limiter ─► out
//   world one-shots ───────┘                                                        │
//   cues ─► cueIn ─► cueDuck ─► cueVol ─────────────────────────────────────────────┤
//   UI one-shots ─► uiBus ──────────────────────────────────────────────────────────┘
// voice-overs (vo.js): dialogue/phone ─► master, barks ─► muffle (positional), radio talk ─► radioDuck; music ducks
// while dialogue plays. Lines without a recorded take are subtitle-only (speechSynthesis only with ?ttsfallback).
import { makeNoiseBuffers, makeImpulse, makePanner, setPannerPos, smooth } from './util.js';
import { createInstruments } from './instruments.js';
import { makeFxSet, Session, SongPlayer, LazyReverb } from './sequencer.js';
import { Radio } from './radio.js';
import { CUES } from './cues.js';
import { createSfx, UI_SFX, IMPORTANT_SFX, REVERB_SFX } from './sfx.js';
import { Ambience } from './ambience.js';
import { makeEngineSound, ENGINE_TYPES } from './engine.js';
import { Voice } from './voice.js';
import { BARKS, BARK_VOICE } from './barks.js';

export { ENGINE_TYPES };
export const SFX_NAMES = ['horn', 'crash_light', 'crash_heavy', 'explosion', 'door_open', 'door_close', 'footstep', 'footstep_wet', 'splash', 'engine_start', 'tyre_screech', 'pickup', 'money', 'checkpoint', 'mission_start', 'mission_passed', 'mission_failed', 'wasted', 'busted', 'phone_ring', 'text_message', 'ui_select', 'ui_back', 'ui_hover', 'typing', 'keyclick', 'bug_squash', 'ship_it', 'cash_register', 'camera_flash', 'crowd_cheer', 'applause', 'erp_beep', 'wanted_up', 'siren_burst', 'thunder', 'punch', 'jump', 'land',
  'splash_big', 'wave_slap', 'durian_thud', 'cheat', 'stunt', 'taxi_meter', 'camera_shutter', 'flyer_chime', 'kopi_pour', 'crowd_gasp', 'ped_yelp', 'rotor_start', 'parachute'];
export const BARK_KINDS = Object.keys(BARKS);
export const MUSIC_CUES = Object.keys(CUES);

const MAX_ONESHOTS = 24;
const MAX_ENGINES = 10;

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.sessionSeed = (Math.random() * 2 ** 31) | 0;
    this.volumes = { master: 0.9, music: 0.75, sfx: 0.9, voice: 1 };
    this.hrtf = false;
    this.radio = new Radio(this);
    this.voice = new Voice(this);
    this.engines = new Set();
    this.cue = null;
    this._pendingCue = null;
    this._active = [];      // end times of live one-shots
    this._duck = { voice: false, cue: false };
    this.zone = null; this._zoneReq = null;
    this._listener = { x: 0, y: 0, z: 0 };
    this._barkAt = 0; this._barkKindAt = {};
    this._state = { inVehicle: false, paused: false, indoor: false };
  }

  /** @param {AudioContext} [existing] a context already created (and unlocked) inside a user gesture */
  async init(existing) {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC && !existing) return;
    const ctx = this.ctx = existing || new AC({ latencyHint: 'interactive' });
    const g = v => { const n = ctx.createGain(); n.gain.value = v; return n; };

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.knee.value = 10; this.comp.ratio.value = 3.5; this.comp.attack.value = 0.006; this.comp.release.value = 0.22;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.001; this.limiter.release.value = 0.08;
    this.master = g(this.volumes.master);
    this.master.connect(this.comp); this.comp.connect(this.limiter); this.limiter.connect(ctx.destination);

    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.5;
    this.worldGain = g(1);
    this.muffle.connect(this.worldGain); this.worldGain.connect(this.master);

    this.sfxBus = g(this.volumes.sfx); this.sfxBus.connect(this.muffle);
    this.uiBus = g(this.volumes.sfx); this.uiBus.connect(this.master);
    this.enginesBus = g(0.6); this.enginesBus.connect(this.sfxBus);
    this.ambIn = g(1); this.ambLP = ctx.createBiquadFilter(); this.ambLP.type = 'lowpass'; this.ambLP.frequency.value = 18000;
    this.ambIn.connect(this.ambLP); this.ambLP.connect(this.sfxBus);

    this.radioIn = g(1); this.radioDuck = g(1); this.radioVol = g(this.volumes.music);
    this.radioIn.connect(this.radioDuck); this.radioDuck.connect(this.radioVol); this.radioVol.connect(this.muffle);
    this.cueIn = g(1); this.cueDuck = g(1); this.cueVol = g(this.volumes.music);
    this.cueIn.connect(this.cueDuck); this.cueDuck.connect(this.cueVol); this.cueVol.connect(this.master);
    // location-bound ambient music (muffled with the world)
    this.zoneIn = g(1); this.zoneGain = g(0); this.zoneDuck = g(1); this.zoneVol = g(this.volumes.music);
    this.zoneIn.connect(this.zoneGain); this.zoneGain.connect(this.zoneDuck); this.zoneDuck.connect(this.zoneVol); this.zoneVol.connect(this.muffle);

    this.bufs = makeNoiseBuffers(ctx);
    this.inst = createInstruments(ctx, this.bufs);
    this.radioFx = makeFxSet(ctx, this.radioIn, { gated: true });
    this.cueFx = makeFxSet(ctx, this.cueIn, { gated: true });
    this.sfxHallIn = ctx.createGain();
    this.sfxHall = new LazyReverb(ctx, this.sfxHallIn, this.sfxBus, makeImpulse(ctx, { duration: 2.2, decay: 3, damping: 0.75, predelay: 0.03 }));

    this._sfx = createSfx(this);
    this.ambience = new Ambience(this);

    this.ready = true;
    this._timer = setInterval(() => this._tick(), 40);
    // never awaited: outside a user gesture iOS leaves resume() pending until the next tap
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    if (this._pendingCue) { const c = this._pendingCue; this._pendingCue = null; this.music(c); }
    if (this._state.inVehicle) this.radio.setAudible(true);
    if (this._zoneReq) this.setZoneMusic(this._zoneReq.name, this._zoneReq.gain);
    // the Gardens zone reverb's impulse (3.2 s stereo) is generated in an idle slot now rather than on first approach
    (window.requestIdleCallback || (f => setTimeout(f, 2000)))(() => { if (!this.zoneFx) this.zoneFx = makeFxSet(ctx, this.zoneIn, { gated: false, hallSec: 3.2 }); }, { timeout: 5000 });
    // voice-overs: decode a handful of common street barks in the background so the first ones play instantly
    this.voice.vo.load().then(() => this._prefetchBarks());
  }

  _prefetchBarks() {
    if (!this.voice.vo.ready) return;
    for (const kind of ['hit', 'nearmiss', 'auntie']) {
      const lines = BARKS[kind], roles = BARK_VOICE[kind] || ['male'];
      for (let i = 0; i < 3; i++) { const r = roles[i % roles.length], t = lines[Math.floor(Math.random() * lines.length)]; if (this.voice.hasVO(r, t)) this.voice.prefetch(r, [t]); }
    }
  }

  suspend() { return this.ctx?.suspend(); }
  resume() { return this.ctx?.resume(); }

  setVolumes({ master, music, sfx, voice } = {}) {
    if (master != null) this.volumes.master = master;
    if (music != null) this.volumes.music = music;
    if (sfx != null) this.volumes.sfx = sfx;
    if (voice != null) this.volumes.voice = voice;
    this.voice.volume = this.volumes.voice;
    this.voice.vo.setVolume(this.volumes.voice);
    if (!this.ctx) return;
    smooth(this.master.gain, this.volumes.master, this.ctx, 0.05, 0);
    smooth(this.radioVol.gain, this.volumes.music, this.ctx, 0.05, 0);
    smooth(this.cueVol.gain, this.volumes.music, this.ctx, 0.05, 0);
    smooth(this.zoneVol.gain, this.volumes.music, this.ctx, 0.05, 0);
    smooth(this.sfxBus.gain, this.volumes.sfx, this.ctx, 0.05, 0);
    smooth(this.uiBus.gain, this.volumes.sfx, this.ctx, 0.05, 0);
  }

  update(dt, s = {}) {
    this._state = s;
    if (!this.ctx) return;
    const ctx = this.ctx, L = ctx.listener;
    if (s.listenerPos) {
      this._listener = s.listenerPos;
      const p = s.listenerPos, f = s.listenerFwd || { x: 0, y: 0, z: -1 }, u = s.listenerUp || { x: 0, y: 1, z: 0 };
      if (L.positionX) {
        L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
        L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z;
        L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z;
      } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
    }
    this.radio.setAudible(!!s.inVehicle);
    this.voice.vo.setPaused(!!(s.menu ?? s.paused)); // minigames pause the world but their dialogue stays up front
    smooth(this.muffle.frequency, s.paused ? 520 : s.indoor ? 950 : 20000, ctx, 0.08, 0.01);
    smooth(this.worldGain.gain, s.paused ? 0.4 : 1, ctx, 0.1, 0.01);
    smooth(this.ambLP.frequency, s.inVehicle ? 1500 : 18000, ctx, 0.15, 0.01);
    this.ambience.update(Math.min(dt, 0.25), s);
  }

  _tick() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const la = (typeof document !== 'undefined' && document.hidden) ? 1.6 : 0.3;
    this.radio.pump(now, la);
    const z = this.zone;
    if (z) { z.session.tr.prune(now); z.player.pump(now, la); }
    const c = this.cue;
    if (c) {
      c.session.tr.prune(now);
      if (!c.player.done) c.player.pump(now, la);
      else if (now > c.player.endTime + (c.tail ?? 2.5)) this._stopCue(0.2);
    }
  }

  // ------------------------------------------------------------------ music cues
  music(name) {
    if (!this.ctx) { this._pendingCue = name === 'stop' ? null : name; return; }
    if (!name || name === 'stop') { this._stopCue(0.6); return; }
    const cue = CUES[name];
    if (!cue) return;
    this._stopCue(0.25);
    const session = new Session(this, this.cueIn, cue.channels, this.cueFx, null);
    const player = new SongPlayer(this.inst, session, cue, { startTime: this.ctx.currentTime + 0.08, loop: cue.loop, loopTo: cue.loopTo || 0 });
    this.cueFx.setDelay(cue.beatDur * 0.75);
    this.cue = { name, session, player, tail: name === 'mission_passed' ? 2 : 2.5 };
    this._duck.cue = true; this._applyDuck();
    this._tick();
    return name;
  }
  get currentCue() { return this.cue ? this.cue.name : null; }
  _stopCue(fade = 0.4) {
    if (!this.cue) return;
    this.cue.session.stop(fade);
    this.cue = null;
    this._duck.cue = false; this._applyDuck();
  }
  _duckVoice(on) { this._duck.voice = on; this._applyDuck(); }
  _applyDuck() {
    if (!this.ctx) return;
    smooth(this.radioDuck.gain, (this._duck.cue ? 0.15 : 1) * (this._duck.voice ? 0.35 : 1), this.ctx, 0.12, 0);
    smooth(this.cueDuck.gain, this._duck.voice ? 0.5 : 1, this.ctx, 0.12, 0);
    smooth(this.zoneDuck.gain, (this._duck.cue ? 0.25 : 1) * (this._duck.voice ? 0.5 : 1), this.ctx, 0.2, 0);
  }

  // ------------------------------------------------------------------ zone music
  /**
   * Location-bound ambient bed (e.g. 'garden_rhapsody' near the Supertrees). Same name -> only the gain
   * (0..1, e.g. proximity) changes; a different name crossfades; null fades out. Safe before init().
   */
  setZoneMusic(name, gain = 1) {
    this._zoneReq = name ? { name, gain } : null;
    if (!this.ctx) return;
    const ctx = this.ctx;
    smooth(this.zoneGain.gain, name ? Math.max(0, Math.min(1, gain)) : 0, ctx, name && this.zone?.name === name ? 0.4 : 1.0, 0.005);
    if (this.zone && this.zone.name === name) return;
    if (this.zone) { this.zone.session.stop(4); this.zone = null; }
    if (!name) return;
    const cue = CUES[name];
    if (!cue) return;
    if (!this.zoneFx) this.zoneFx = makeFxSet(ctx, this.zoneIn, { gated: false, hallSec: 3.2 });
    const session = new Session(this, this.zoneIn, cue.channels, this.zoneFx, null, 0.55, 4);
    // join at a random point so two visits don't start identically
    const startBar = cue.loop ? Math.floor(Math.random() * Math.min(cue.totalBars, 48)) : 0;
    const player = new SongPlayer(this.inst, session, cue, { startBar, startTime: ctx.currentTime + 0.1, loop: cue.loop, loopTo: cue.loopTo || 0 });
    this.zoneFx.setDelay(cue.beatDur * 0.75);
    this.zone = { name, session, player };
  }
  get currentZone() { return this.zone ? this.zone.name : null; }

  // ------------------------------------------------------------------ pedestrian barks
  /**
   * Short Singlish one-liner (recorded take, positional), volume falls off with distance.
   * Rate-limited (global + per kind); resolves true if spoken, false if skipped.
   */
  bark(kind, { position, voice, volume = 1, text } = {}) {
    const lines = BARKS[kind];
    if (!lines || !this.voice.available) return Promise.resolve(false);
    const now = performance.now();
    if (now < this._barkAt || now < (this._barkKindAt[kind] || 0)) return Promise.resolve(false);
    let v = 0.55 * volume;
    if (position) {
      const L = this._listener, d = Math.hypot(position.x - L.x, (position.y || 0) - (L.y || 0), position.z - L.z);
      v *= Math.max(0, 1 - d / 45) ** 1.5;
    }
    if (this._state.paused) v = 0;
    if (v < 0.04) return Promise.resolve(false);
    const roles = voice ? [voice] : (BARK_VOICE[kind] || ['male']);
    // prefer a line that has a recorded take: the caller's own text (it's on screen in the speech bubble), else a
    // random bark of this kind in one of the kind's voices (silent if nothing was recorded)
    const shuffled = roles.slice().sort(() => Math.random() - 0.5);
    let role = null, line = null;
    if (text) for (const r of shuffled) if (this.voice.hasVO(r, text)) { role = r; line = text; break; }
    if (!line && this.voice.vo.ready) {
      for (let k = 0; k < 8 && !line; k++) { const r = shuffled[k % shuffled.length], t = lines[Math.floor(Math.random() * lines.length)]; if (this.voice.hasVO(r, t)) { role = r; line = t; } }
    }
    if (!line) { role = shuffled[0]; line = text || lines[Math.floor(Math.random() * lines.length)]; }
    const p = this.voice.sayBark(line, role, v * (this._state.indoor ? 0.5 : 1), position);
    if (!p) return Promise.resolve(false);
    this._barkAt = now + 3500; this._barkKindAt[kind] = now + 8000;
    return p.then(() => true);
  }

  // ------------------------------------------------------------------ one-shots
  sfx(name, opts = {}) {
    if (!this.ctx || !this._sfx) return null;
    const fn = this._sfx[name];
    if (!fn) return null;
    const ctx = this.ctx, now = ctx.currentTime;
    const a = this._active; let w = 0;
    for (let r = 0; r < a.length; r++) if (a[r] > now) a[w++] = a[r];
    a.length = w;
    if (a.length >= MAX_ONESHOTS && !IMPORTANT_SFX.has(name)) return null;
    const bus = UI_SFX.has(name) && !opts.position ? this.uiBus : this.sfxBus;
    const g = ctx.createGain(); g.gain.value = opts.volume ?? 1;
    let panner = null;
    if (opts.position) { panner = makePanner(ctx, { ref: opts.ref ?? 5, max: 500, hrtf: this.hrtf }); setPannerPos(panner, opts.position); g.connect(panner); panner.connect(bus); }
    else g.connect(bus);
    let send = null;
    const rv = REVERB_SFX[name];
    if (rv) { send = ctx.createGain(); send.gain.value = rv; g.connect(send); send.connect(this.sfxHallIn); this.sfxHall.extend(now + 1); }
    const end = fn(g, now + 0.005, opts) || now + 1;
    if (rv) this.sfxHall.extend(end);
    a.push(end);
    const life = (end - now + 0.4) * 1000;
    setTimeout(() => { try { g.disconnect(); panner?.disconnect(); send?.disconnect(); } catch { /* noop */ } }, life);
    return {
      end,
      stop: () => { try { g.gain.setTargetAtTime(0, ctx.currentTime, 0.02); } catch { /* noop */ } },
      setPosition: p => { if (panner) setPannerPos(panner, p); },
    };
  }

  /** Radio tuning static (only when the radio is audible). */
  _tuneStatic() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.bufs.white;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(900 + Math.random() * 600, t); bp.frequency.exponentialRampToValueAtTime(2600 + Math.random() * 1500, t + 0.28);
    const gg = ctx.createGain(); gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime(0.32, t + 0.02); gg.gain.setTargetAtTime(0, t + 0.22, 0.04);
    s.connect(bp); bp.connect(gg); gg.connect(this.radioDuck);
    s.start(t, Math.random()); s.stop(t + 0.45);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(2400 + Math.random() * 1500, t); o.frequency.exponentialRampToValueAtTime(700, t + 0.3);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.04, t); og.gain.setTargetAtTime(0, t + 0.15, 0.05);
    o.connect(og); og.connect(this.radioDuck); o.start(t); o.stop(t + 0.45);
    const cr = ctx.createBufferSource(); cr.buffer = this.bufs.crackle;
    const cg = ctx.createGain(); cg.gain.value = 0.5; cr.connect(cg); cg.connect(this.radioDuck); cr.start(t, Math.random() * 2); cr.stop(t + 0.35);
  }

  // ------------------------------------------------------------------ engines
  /**
   * Returns a handle immediately (safe before init). The voice is built lazily on the first update()
   * once the AudioContext exists and a slot is free (max MAX_ENGINES concurrent; extras stay silent).
   */
  createEngine({ type = 'sedan', water } = {}) {
    const sys = this;
    const h = {
      type, real: null, disposed: false,
      update(o) {
        if (h.disposed) return;
        if (!h.real) {
          if (!sys.ctx || sys.engines.size >= MAX_ENGINES) return;
          h.real = makeEngineSound(sys.ctx, sys.bufs, sys.enginesBus, type, { hrtf: sys.hrtf, water: water ?? true });
          const r = h.real;
          sys.engines.add(r);
          r.onDispose = () => sys.engines.delete(r);
        }
        h.real.update(o);
      },
      dispose() { h.disposed = true; if (h.real) h.real.dispose(); h.real = null; },
    };
    return h;
  }

  // ------------------------------------------------------------------ speech
  say(text, opts = {}) { return this.voice.say(text, opts); }
}

