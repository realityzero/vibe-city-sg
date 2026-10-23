// In-car radio. Each station runs on its own virtual clock (ctx time + a random offset) over a
// deterministic list of generated songs, so tuning away and back resumes where the station "is".
// Notes are only scheduled while the radio is audible (player in a vehicle).
import { STATIONS, generateSong, barEvents } from './stations.js';
import { Session, SongPlayer } from './sequencer.js';
import { TALK_LINES } from './talk.js';
import { pick } from './util.js';

const GAP = 1.4; // seconds of air between songs

class Timeline {
  constructor(def, sessionSeed, offset) {
    this.def = def; this.sessionSeed = sessionSeed; this.offset = offset;
    this.starts = [0]; this.durs = [];
    this.cache = new Map();
  }
  plan(k) {
    let p = this.cache.get(k);
    if (!p) {
      p = generateSong(this.def, k, this.sessionSeed);
      this.cache.set(k, p);
      if (this.cache.size > 4) this.cache.delete(this.cache.keys().next().value);
    }
    return p;
  }
  dur(k) {
    while (this.durs.length <= k) {
      const i = this.durs.length;
      const d = (this.cache.get(i) || generateSong(this.def, i, this.sessionSeed)).duration + GAP;
      this.durs.push(d);
      this.starts.push(this.starts[i] + d);
    }
    return this.durs[k];
  }
  /** Song index containing station-time T and its start time. */
  locate(T) {
    let k = 0;
    for (;;) { this.dur(k); if (this.starts[k + 1] > T) return { k, start: this.starts[k] }; k++; }
  }
}

export class Radio {
  constructor(sys) {
    this.sys = sys;
    this.defs = STATIONS;
    this.stations = STATIONS.map(s => ({ id: s.id, name: s.name, freq: s.freq, genre: s.genre, color: s.color }));
    const music = STATIONS.map((s, i) => (s.talk ? -1 : i)).filter(i => i >= 0);
    this.current = music[Math.floor(Math.random() * music.length)];
    this.timelines = STATIONS.map(s => new Timeline(s, sys.sessionSeed, 60 + Math.random() * 1800));
    this.audible = false;
    this.session = null; this.player = null; this.songK = 0;
    this.onChange = null; this.onSong = null;
    this.nowPlaying = null;
    this.talkNextAt = 0; this.talkOrder = []; this.talkIdx = 0;
    this._timers = [];
  }
  get meta() { return this.current >= 0 ? this.stations[this.current] : { id: 'off', name: 'RADIO OFF', freq: '', genre: '', color: '#888888' }; }

  setStation(i) {
    const n = this.stations.length;
    if (i < -1) i = n - 1; if (i >= n) i = -1;
    if (i === this.current) return this.meta;
    this.current = i;
    if (this.audible) {
      this._stopSession();
      this.sys._tuneStatic?.();
      this._startSession(this.sys.ctx.currentTime + 0.3);
    }
    this.onChange?.(this.meta);
    return this.meta;
  }
  next() { return this.setStation(this.current + 1 >= this.stations.length ? -1 : this.current + 1); }
  prev() { return this.setStation(this.current - 1 < -1 ? this.stations.length - 1 : this.current - 1); }

  setAudible(on) {
    if (on === this.audible || !this.sys.ctx) return;
    this.audible = on;
    if (on) { this._startSession(this.sys.ctx.currentTime + 0.05); this.onChange?.(this.meta); }
    else this._stopSession();
  }

  _clearTimers() { for (const t of this._timers) clearTimeout(t); this._timers.length = 0; }

  _stopSession() {
    this._clearTimers();
    this.sys.voice?.cancelRadio();
    if (this.session) this.session.stop(0.12);
    this.session = null; this.player = null;
  }

  _startSession(at) {
    if (this.current < 0) { this.nowPlaying = null; return; }
    const sys = this.sys, def = this.defs[this.current], tl = this.timelines[this.current];
    this.session = new Session(sys, sys.radioIn, def.g.channels, sys.radioFx, def.g.insert);
    const T = at + tl.offset;
    const { k, start } = tl.locate(T);
    const plan = tl.plan(k);
    const elapsed = T - start;
    if (elapsed >= plan.duration) this._queueSong(k + 1, at + (start + plan.duration + GAP - T), 0, false);
    else {
      const bar = Math.min(plan.totalBars - 1, Math.floor(elapsed / plan.barDur));
      this._queueSong(k, at - (elapsed - bar * plan.barDur), bar, true);
    }
    this.talkNextAt = sys.ctx.currentTime + 1.5;
  }

  _queueSong(k, startTime, bar, joining) {
    const sys = this.sys, def = this.defs[this.current], tl = this.timelines[this.current];
    const plan = tl.plan(k);
    this.songK = k;
    const src = { beatDur: plan.beatDur, barDur: plan.barDur, totalBars: plan.totalBars, swing: plan.swing, timbre: plan.timbre, barEvents: b => barEvents(def, plan, b) };
    this.player = new SongPlayer(sys.inst, this.session, src, { startBar: bar, startTime, joining });
    sys.radioFx.setDelay(plan.beatDur * 0.75);
    const info = { station: def.name, stationId: def.id, title: plan.title, artist: plan.artist, bpm: plan.bpm, key: plan.mode, color: def.color, talk: !!def.talk };
    const announce = () => {
      if (!this.audible || this.defs[this.current] !== def) return;
      this.nowPlaying = info;
      this.onSong?.(info);
      // DJ chatter or a station ident over the intro of fresh songs
      if (bar !== 0 || def.talk) return;
      if (def.dj && Math.random() < def.dj.chance) {
        const p = sys.voice?.sayRadio(pick(Math.random, def.dj.lines), def.dj.role || 'dj');
        if (p && def.idents.length && Math.random() < 0.35) p.then(() => { if (this.audible && this.defs[this.current] === def) sys.voice?.sayRadio(pick(Math.random, def.idents), def.dj.role || 'dj'); });
      } else if (def.idents.length && Math.random() < 0.55) sys.voice?.sayRadio(pick(Math.random, def.idents), 'dj');
    };
    const delay = Math.max(0, startTime - sys.ctx.currentTime);
    if (delay < 0.05) announce(); else this._timers.push(setTimeout(announce, delay * 1000));
  }

  /** Called from the scheduler tick. */
  pump(now, lookahead) {
    if (!this.audible || !this.player || !this.session) return;
    this.session.tr.prune(now);
    if (!this.player.pump(now, lookahead)) {
      this._queueSong(this.songK + 1, this.player.endTime + GAP, 0, false);
      this.player.pump(now, lookahead);
    }
    const def = this.defs[this.current];
    if (def && def.talk) this._talk(now);
  }

  _talk(now) {
    const sys = this.sys;
    if (now < this.talkNextAt) return;
    if (!this.talkOrder.length) {
      this.talkOrder = TALK_LINES.map((_, i) => i);
      for (let i = this.talkOrder.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [this.talkOrder[i], this.talkOrder[j]] = [this.talkOrder[j], this.talkOrder[i]]; }
      this.talkIdx = 0;
    }
    const line = TALK_LINES[this.talkOrder[this.talkIdx % this.talkOrder.length]];
    const voice = sys.voice;
    if (!voice || !voice.available) {
      // no speech engine: play an ad jingle now and then so the station still feels alive
      this._jingle(now + 0.05);
      this.talkNextAt = now + 18 + Math.random() * 20;
      this.talkIdx++;
      return;
    }
    if (voice.busy()) { this.talkNextAt = now + 1; return; }
    this.talkIdx++;
    const speakAt = line.ad ? 1.3 : 0;
    if (line.ad) this._jingle(now + 0.05);
    this.talkNextAt = Infinity;
    const go = () => {
      if (!this.audible || !this.defs[this.current]?.talk) return;
      const p = voice.sayRadio(line.t, line.ad ? 'female' : 'dj');
      if (!p) { this.talkNextAt = sys.ctx.currentTime + 1; return; }
      p.then(() => { this.talkNextAt = sys.ctx.currentTime + 1 + Math.random() * 2.5; });
    };
    if (speakAt) this._timers.push(setTimeout(go, speakAt * 1000)); else go();
  }

  _jingle(t) {
    if (!this.session) return;
    const inst = this.sys.inst, ch = this.session.ch.bell || this.session.ch.keys;
    if (!ch) return;
    const notes = pick(Math.random, [[72, 76, 79, 84], [79, 76, 72, 77], [74, 78, 81, 86]]);
    notes.forEach((n, i) => inst.bell(ch, t + i * 0.16, 0.5, n, 0.8, { ratio: 3.5, index: 1.4, decay: 0.9 }, this.session.tr));
  }
}
