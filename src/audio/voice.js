// Spoken lines. Every line plays a pre-rendered voice-over take (vo.js: neural-voice files in public/vo, made offline
// by tools/vo and keyed by role + text). Nothing is synthesised while the game runs: a line without a take is
// subtitle-only (in development it's logged once to window.__voMissing so it can be rendered). The browser's
// speechSynthesis can be switched on for development with ?ttsfallback — off by default.
// Dialogue (missions) has priority over radio chatter and pedestrian barks. Every say() resolves.
import { VOPlayer } from './vo.js';
import { VOICE_CAST } from './cast.js';
import { voKey } from './vokey.js';

const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const DEV = !!(typeof import.meta !== 'undefined' && import.meta.env?.DEV);
const TTS_FALLBACK = params.has('ttsfallback');
// old novelty/formant voices that sound like 1990s robots: never picked even with ?ttsfallback
const BLOCK = /\b(alex|fred|albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|kathy|princess|deranged|hysterical|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley)\b/i;

export class Voice {
  constructor(sys) {
    this.sys = sys;
    this.vo = new VOPlayer(sys);
    this.synth = TTS_FALLBACK && typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null;
    this.voices = [];
    this.volume = 1;
    this.dialogue = 0;        // pending dialogue lines
    this.radioActive = false;
    this.barking = false;
    this._dialogueHandles = new Set();
    this._radioHandle = null;
    this._missing = new Set();
    if (this.synth) {
      const load = () => { this.voices = this.synth.getVoices().filter(v => /^en/i.test(v.lang) && !BLOCK.test(v.name)); };
      load();
      this.synth.addEventListener?.('voiceschanged', load);
    }
  }
  get available() { return this.vo.ready || (!!this.synth && this.voices.length > 0); }
  busy() { return this.dialogue > 0 || this.radioActive || this.barking; }
  /** seconds of the pre-rendered take for this line, or null */
  lineDuration(role, text) { return this.vo.duration(role, text); }
  hasVO(role, text) { return this.vo.has(role, text); }
  prefetch(role, texts) { this.vo.prefetch(role, texts); }

  /** development: remember a line that has no recording (once per key) so tools/vo can render it */
  noteMissing(role, text) {
    if (!DEV || !this.vo.ready || !text || this.vo.has(role, text)) return;
    const key = voKey(role, text);
    if (this._missing.has(key)) return;
    this._missing.add(key);
    (window.__voMissing || (window.__voMissing = [])).push({ role, text, key });
    console.debug(`[vo] no take for ${role}: ${text}`);
  }

  // ---- development-only speechSynthesis (?ttsfallback): the cast's preferred natural voices, unshifted
  pick(role) {
    const prefer = VOICE_CAST[role]?.prefer || [];
    let best = null, bs = -Infinity;
    for (const v of this.voices) {
      let s = /natural|neural|online|premium|enhanced|siri|google/i.test(v.name) ? 50 : 0;
      const i = prefer.findIndex(n => v.name.includes(n)); if (i >= 0) s += 100 - i;
      if (s > bs) { bs = s; best = v; }
    }
    return best;
  }
  _speak(text, role, volume = 1) {
    text = String(text).replace(/<[^>]*>/g, '');
    const est = (text.split(/\s+/).length / 2.6) + 0.5;
    return new Promise(resolve => {
      const timer = setTimeout(resolve, (est * 1.7 + 2) * 1000);
      const done = () => { clearTimeout(timer); resolve(); };
      try {
        const u = new SpeechSynthesisUtterance(text), v = this.pick(role);
        if (v) { u.voice = v; u.lang = v.lang; }
        u.volume = Math.max(0, Math.min(1, this.volume * volume));
        u.onend = done; u.onerror = done;
        this.synth.speak(u);
      } catch { done(); }
    });
  }
  _cancelSynth() { if (this.synth) { try { this.synth.cancel(); } catch { /* noop */ } } }

  /** Mission dialogue (opts.voice = role, opts.phone = the caller's end of a phone call). Cuts radio chatter and
   *  barks, ducks music. Resolves when the line ends or is stopped — at once if there's no take (subtitle-only). */
  say(text, opts = {}) {
    if (!text) return Promise.resolve();
    const role = opts.voice || 'male';
    const h = this.vo.play(role, text, { bus: opts.phone ? 'phone' : 'dialogue', volume: opts.volume ?? 1 });
    if (!h) {
      this.noteMissing(role, text);
      if (!this.synth) return Promise.resolve();
    }
    if (this.radioActive || this.barking) { this._cancelSynth(); this.vo.stopBus('radio'); this.vo.stopBus('bark'); this.radioActive = false; this.barking = false; }
    this.dialogue++;
    this.sys._duckVoice?.(true);
    let p;
    if (h) { this._dialogueHandles.add(h); p = h.ended.then(() => { this._dialogueHandles.delete(h); }); }
    else p = this._speak(text, role, opts.volume ?? 1);
    return p.then(() => {
      this.dialogue = Math.max(0, this.dialogue - 1);
      if (!this.dialogue) this.sys._duckVoice?.(false);
    });
  }
  /** skip the current dialogue line (Enter) */
  stopDialogue() { for (const h of this._dialogueHandles) h.stop(); this._cancelSynth(); }
  /** loudness 0..1 of the dialogue line playing now (mouth/gesture animation) */
  dialogueLevel() { return this.vo.speaking?.level() ?? 0; }

  /** Radio DJ line; returns null if a dialogue line is busy or the line has no take. */
  sayRadio(text, role = 'dj', opts = {}) {
    if (!this.available || this.busy()) return null;
    const h = this.vo.play(role, text, { bus: 'radio', volume: opts.volume ?? 1 });
    if (h) { this.radioActive = true; this._radioHandle = h; return h.ended.then(() => { if (this._radioHandle === h) this._radioHandle = null; this.radioActive = false; }); }
    this.noteMissing(role, text);
    if (!this.synth || !this.voices.length) return null;
    this.radioActive = true;
    return this._speak(text, role, opts.volume ?? 1).then(() => { this.radioActive = false; });
  }

  /** Ambient one-liner (pedestrian bark), positional. Never interrupts dialogue or queues behind other speech. */
  sayBark(text, role, volume, position) {
    if (!this.available || this.dialogue > 0 || this.barking) return null;
    if (this.synth && (this.synth.speaking || this.synth.pending)) return null;
    const h = this.vo.play(role, text, { bus: 'bark', volume, position });
    if (h) { this.barking = true; return h.ended.then(() => { this.barking = false; }); }
    this.noteMissing(role, text);
    if (!this.synth || !this.voices.length) return null;
    this.barking = true;
    return this._speak(text, role, volume).then(() => { this.barking = false; });
  }

  cancelRadio() {
    if (this._radioHandle) { this._radioHandle.stop(); this._radioHandle = null; }
    if (this.radioActive && this.synth && !this.dialogue) this._cancelSynth();
    this.radioActive = false;
  }
}
