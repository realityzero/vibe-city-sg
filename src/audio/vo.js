// Pre-rendered voice-overs: neural-voice takes rendered offline by tools/vo into public/vo (manifest.json + mp3s),
// found by role + text through vokey.js. Only these static files are used at runtime — no speech service is ever
// called. Paths follow the deploy base (import.meta.env.BASE_URL). Lines are fetched and decoded lazily
// (decodeAudioData runs off the main thread), kept in a small LRU and played on Web Audio buses:
//   dialogue ─► light compressor ─► voice gain ─► master        (clear; music ducks via AudioSystem._duckVoice)
//   phone    ─► earpiece band-pass ─► dialogue                   (the caller's end of a phone call)
//   bark     ─► panner (direction only) ─► voice gain ─► muffle  (positional, muffled indoors / when paused)
//   radio    ─► broadcast EQ + compressor ─► radioDuck           (follows the radio's volume and ducking)
// No manifest -> has() is false and the line is subtitle-only.
import { voKey } from './vokey.js';
import { makePanner, setPannerPos } from './util.js';

const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const BASE = ((typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/') + (qs.get('vobase') || 'vo') + '/';
const MAX_BUFFERS = 40, MAX_SECONDS = 180; // decoded PCM is ~0.19 MB per second at 48 kHz mono

export class VOPlayer {
  constructor(sys) {
    this.sys = sys;
    this.lines = null;          // manifest lines, null until loaded (or when there is no manifest)
    this.cache = new Map();     // file -> AudioBuffer, Map order = LRU order
    this.pending = new Map();   // file -> Promise<AudioBuffer|null>
    this.takes = new Map();     // key -> chosen take index (so a prefetched take is the one that plays)
    this.handles = new Set();   // playing lines
    this.buses = null;
    this.volume = 1;
    this.paused = false;
    this._loadP = null;
    this._queue = []; this._pumping = false;
    if (!qs.has('novo')) this.load();
  }

  load() {
    if (!this._loadP) {
      this._loadP = fetch(BASE + 'manifest.json', { cache: 'no-cache' })
        .then(r => (r.ok ? r.json() : null))
        .then(j => { this.lines = j && j.lines ? j.lines : null; this.onReady?.(); })
        .catch(() => { this.lines = null; });
    }
    return this._loadP;
  }
  get ready() { return !!this.lines; }
  get count() { return this.lines ? Object.keys(this.lines).length : 0; }

  entry(role, text) { return this.lines && text ? this.lines[voKey(role, text)] || null : null; }
  has(role, text) { return !!this.entry(role, text); }

  _take(role, text) {
    const key = voKey(role, text), e = this.lines?.[key];
    if (!e) return null;
    const files = Array.isArray(e.f) ? e.f : [e.f];
    let i = this.takes.get(key);
    if (i == null || i >= files.length) { i = Math.floor(Math.random() * files.length); this.takes.set(key, i); }
    const d = Array.isArray(e.d) ? e.d[i] ?? e.d[0] : e.d;
    return { key, file: files[i], dur: typeof d === 'number' ? d : null };
  }
  /** seconds of the take that will play for this line (null if unknown / no asset) */
  duration(role, text) { return this._take(role, text)?.dur ?? null; }

  _buffer(file) {
    const ctx = this.sys.ctx;
    if (!ctx) return Promise.resolve(null);
    const hit = this.cache.get(file);
    if (hit) { this.cache.delete(file); this.cache.set(file, hit); return Promise.resolve(hit); }
    let p = this.pending.get(file);
    if (!p) {
      p = fetch(BASE + file)
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then(ab => ctx.decodeAudioData(ab))
        .then(buf => { this.pending.delete(file); this.cache.set(file, buf); this._trim(); return buf; })
        .catch(() => { this.pending.delete(file); return null; });
      this.pending.set(file, p);
    }
    return p;
  }
  _trim() {
    let secs = 0; for (const b of this.cache.values()) secs += b.duration;
    for (const [f, b] of this.cache) {
      if (this.cache.size <= MAX_BUFFERS && secs <= MAX_SECONDS) break;
      if ([...this.handles].some(h => h.file === f)) continue; // never evict what's playing
      this.cache.delete(f); secs -= b.duration;
    }
  }

  /** decode upcoming lines in the background, a couple at a time in idle slots (never a burst at mission start) */
  prefetch(role, texts) {
    if (!this.lines) return;
    for (const t of [].concat(texts)) { const tk = this._take(role, t); if (tk && !this.cache.has(tk.file) && !this.pending.has(tk.file)) this._queue.push(tk.file); }
    if (this._queue.length > 16) this._queue.splice(0, this._queue.length - 16);
    this._pump();
  }
  _pump() {
    if (this._pumping || !this._queue.length || !this.sys.ctx) return;
    this._pumping = true;
    const idle = window.requestIdleCallback || (f => setTimeout(f, 30));
    idle(() => {
      const batch = this._queue.splice(0, 2);
      Promise.all(batch.map(f => this._buffer(f))).finally(() => { this._pumping = false; this._pump(); });
    }, { timeout: 400 });
  }

  _ensureBuses() {
    const sys = this.sys, ctx = sys.ctx;
    if (this.buses || !ctx || !sys.master) return this.buses;
    const g = v => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const bq = (type, f, q = 0.7, gain = 0) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; n.gain.value = gain; return n; };
    const comp = (th, ratio, att = 0.004, rel = 0.15) => { const c = ctx.createDynamicsCompressor(); c.threshold.value = th; c.ratio.value = ratio; c.knee.value = 8; c.attack.value = att; c.release.value = rel; return c; };
    // dialogue: a gentle leveller so quiet and loud takes sit together over the music
    const dIn = g(1), dHp = bq('highpass', 70), dComp = comp(-20, 2.5), dVol = g(this.volume);
    dIn.connect(dHp); dHp.connect(dComp); dComp.connect(dVol); dVol.connect(sys.master);
    // phone: telephone band, a little honk, slightly crushed
    const pIn = g(1.25), pHp = bq('highpass', 330, 0.9), pLp = bq('lowpass', 3300, 0.9), pPk = bq('peaking', 1700, 1.2, 5), pComp = comp(-26, 6, 0.002, 0.08);
    pIn.connect(pHp); pHp.connect(pLp); pLp.connect(pPk); pPk.connect(pComp); pComp.connect(dIn);
    // barks: into the world chain so indoor/pause muffling applies
    const bVol = g(this.volume); bVol.connect(sys.muffle);
    // radio: broadcast processing — high-pass, presence, air roll-off, firm compression
    const rIn = g(1), rHp = bq('highpass', 150, 0.8), rPk = bq('peaking', 3000, 0.9, 3), rLp = bq('lowpass', 7500, 0.7), rComp = comp(-24, 5, 0.003, 0.12), rVol = g(0.9);
    rIn.connect(rHp); rHp.connect(rPk); rPk.connect(rLp); rLp.connect(rComp); rComp.connect(rVol); rVol.connect(sys.radioDuck);
    this.buses = { dialogue: dIn, phone: pIn, bark: bVol, radio: rIn, dVol, bVol };
    return this.buses;
  }

  setVolume(v) {
    this.volume = v;
    const B = this.buses, ctx = this.sys.ctx; if (!B || !ctx) return;
    B.dVol.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
    B.bVol.gain.setTargetAtTime(v, ctx.currentTime, 0.05);
  }
  /** pause menu: dialogue drops under the menu, barks and radio talk stop */
  setPaused(p) {
    if (p === this.paused) return;
    this.paused = p;
    const B = this.buses, ctx = this.sys.ctx; if (!B || !ctx) return;
    B.dVol.gain.setTargetAtTime(p ? this.volume * 0.25 : this.volume, ctx.currentTime, 0.08);
    if (p) for (const h of this.handles) if (h.bus === 'bark' || h.bus === 'radio') h.stop();
  }

  /**
   * Play a line. Returns null if there's no asset for it (caller falls back); otherwise a handle
   * { duration, bus, ended: Promise<boolean> (true = played to the end), stop(), level() } — playback starts once
   * the take is decoded (immediately if it was prefetched).
   */
  play(role, text, { bus = 'dialogue', position, volume = 1 } = {}) {
    const tk = this._take(role, text);
    const ctx = this.sys.ctx;
    if (!tk || !ctx || !this._ensureBuses()) return null;
    let src = null, gain = null, panner = null, analyser = null, stopped = false, resolveEnd;
    const h = {
      file: tk.file, bus, duration: tk.dur, key: tk.key,
      ended: new Promise(r => { resolveEnd = r; }),
      stop: () => {
        if (stopped) return; stopped = true;
        if (src && gain) { try { gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03); src.stop(ctx.currentTime + 0.12); } catch { /* noop */ } }
        else finish(false);
      },
      /** 0..1 loudness right now (for mouth/gesture animation) */
      level: () => {
        if (!analyser) return 0;
        const a = h._a || (h._a = new Float32Array(analyser.fftSize)); analyser.getFloatTimeDomainData(a);
        let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i];
        return Math.min(1, Math.sqrt(s / a.length) * 4);
      },
    };
    const finish = ok => {
      if (h._done) return; h._done = true;
      this.handles.delete(h);
      try { src?.disconnect(); gain?.disconnect(); panner?.disconnect(); analyser?.disconnect(); } catch { /* noop */ }
      resolveEnd(ok);
    };
    this.handles.add(h);
    this._buffer(tk.file).then(buf => {
      if (stopped || !buf) { finish(false); return; }
      const B = this.buses;
      h.duration = buf.duration;
      src = ctx.createBufferSource(); src.buffer = buf;
      gain = ctx.createGain(); gain.gain.value = volume;
      src.connect(gain);
      if (bus === 'bark') {
        // direction only: the caller already scaled the volume by distance
        panner = makePanner(ctx, { ref: 1, max: 1e4, rolloff: 0, hrtf: this.sys.hrtf });
        if (position) setPannerPos(panner, position);
        gain.connect(panner); panner.connect(B.bark);
      } else gain.connect(B[bus] || B.dialogue);
      if (bus === 'dialogue' || bus === 'phone') { analyser = ctx.createAnalyser(); analyser.fftSize = 256; gain.connect(analyser); }
      src.onended = () => finish(!stopped);
      src.start(ctx.currentTime + 0.01);
    });
    return h;
  }

  stopBus(bus) { for (const h of [...this.handles]) if (!bus || h.bus === bus || (bus === 'dialogue' && h.bus === 'phone')) h.stop(); }
  /** the dialogue line playing now (for mouth/gesture animation), if any */
  get speaking() { for (const h of this.handles) if ((h.bus === 'dialogue' || h.bus === 'phone') && !h._done) return h; return null; }
}
