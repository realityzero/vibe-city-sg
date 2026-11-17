// Vibe City UI — DOM/CSS/Canvas2D overlay for HUD, radar, menus, dialogue and mission screens.
// Usage: const ui = new UI(document.body); ui.radar.setMap(city, groundImg); ui.hud.update({...}); ...
import './theme.css';
import { Hud } from './hud.js';
import { Radar } from './radar.js';
import { MapData } from './mapRender.js';
import { FullMap } from './map.js';
import { PauseMenu, DEFAULT_SETTINGS } from './pause.js';
import { TitleScreen, LoadingScreen, DEFAULT_CONTROLS } from './screens.js';
import { Phone } from './phone.js';
import { showChoice } from './choice.js';
import { makeStunt, makeFare, makePhoto, makeBarks, makeCollectibles, makeCheat } from './extras.js';
import { el, wait, keyify, lineMs, fmtMoney, escapeHtml, restartClass } from './util.js';

export { DISTRICTS, districtAt, LANDMARKS } from './districts.js';
export { DEFAULT_SETTINGS, DEFAULT_CONTROLS };

const SPEAKER_COLORS = {
  Tommy: '#ff8fd0', 'Tommy Vercetti': '#ff8fd0', Ken: '#7fe36a', 'Ken Rosenberg': '#7fe36a', Lance: '#2fe6ff', 'Lance Vance': '#2fe6ff',
  'Auntie Mei': '#ffc94a', 'Uncle Ah Seng': '#ffb36b', Priya: '#c8a2ff', 'Priya Raman': '#c8a2ff', Chad: '#ff6b6b', 'Mr. Tan': '#ffe08a', Kyle: '#ff5f5f', 'Sonny Forelli': '#ff7a3d',
};
const PALETTE = ['#ffc94a', '#2fe6ff', '#c8a2ff', '#7fe36a', '#ffb36b', '#ff8fd0', '#8ec5ff'];
const colorFor = name => { if (!name) return '#fff'; if (SPEAKER_COLORS[name]) return SPEAKER_COLORS[name]; let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };

const WASTED_LINES = ['Hospital bill <b>S$2,000</b> · MediSave deducted', 'Ambulance fee <b>S$2,000</b> · Ah Ma is disappointed', 'Polyclinic queue number <b>4,217</b>'];
const BUSTED_LINES = ['Fined <b>S$500</b> · Singapore is a fine city', 'Fined <b>S$500</b> · jaywalking, speeding and vibes', 'Fined <b>S$500</b> · and your gum was confiscated'];

export class UI {
  /** @param {HTMLElement} rootElement container to mount into (usually document.body) */
  constructor(rootElement = document.body) {
    this.root = el('div', 'vc-root');
    rootElement.appendChild(this.root);
    const layer = cls => { const d = el('div', cls); this.root.appendChild(d); return d; };
    this.settings = { ...DEFAULT_SETTINGS };
    this.controls = DEFAULT_CONTROLS;
    this.logEntries = [];
    this._gameTime = null;

    // gameplay layers (bottom to top)
    const game = layer('vc-layer-game');
    this.radar = new Radar(game);
    this.hud = new Hud(game);
    const hudSetVisible = this.hud.setVisible.bind(this.hud);
    this.hud.setVisible = v => { hudSetVisible(v); this.radar.setVisible(v); this.trackers.style.opacity = v ? 1 : 0; };
    const hudUpdate = this.hud.update.bind(this.hud);
    this.hud.update = s => { if (s.time != null) this._gameTime = s.time; hudUpdate(s); };
    this.trackers = el('div', 'vc-trackers'); this.hud.topRight.appendChild(this.trackers);
    this._helpEl = el('div', 'vc-help'); game.appendChild(this._helpEl);
    this._interactEl = el('div', 'vc-interact'); game.appendChild(this._interactEl);
    this._toasts = el('div', 'vc-toasts'); game.appendChild(this._toasts);
    const bottom = el('div', 'vc-bottom'); game.appendChild(bottom);
    this._objEl = el('div', 'vc-objective vc-outline-thin'); this._subEl = el('div', 'vc-sub vc-outline-thin');
    bottom.append(this._objEl, this._subEl);
    this._fx = layer('vc-layer-fx');
    this.phone = new Phone(game, this);
    this._mtitle = el('div', 'vc-mtitle', '<div class="t"></div><div class="s"></div>'); this._fx.appendChild(this._mtitle);
    this._lbTop = el('div', 'vc-lb top'); this._lbBot = el('div', 'vc-lb bot'); this._fx.append(this._lbTop, this._lbBot);
    this._card = el('div', 'vc-titlecard', '<div class="k">Grand Theft Auto</div><div class="t">Vibe City</div><div class="s">Singapore</div><div class="c">1°17′N 103°51′E · 2026</div>');
    this._skipEl = el('div', 'vc-skiphint', '<kbd>Enter</kbd> skip');
    this._fx.append(this._card, this._skipEl);
    this.skippable = false; // a skippable sequence is on (touch shows its ▶▶ button, the keyboard a hint)
    this._choiceLayer = layer('vc-layer-choice');
    // menus
    this.map = new FullMap(this.root, () => this.radar.map);
    const mapOpen = this.map.open.bind(this.map);
    this.map.open = (s = {}) => mapOpen({ route: this.radar.route, ...s });
    this.pause = new PauseMenu(this.root, this);
    this._loading = new LoadingScreen(this.root);
    this._title = new TitleScreen(this.root);
    this._fadeEl = el('div', 'vc-fade'); this.root.appendChild(this._fadeEl);

    this.radar.setMap = (city, ground, mask) => { this.radar.setMapData(new MapData(city, ground, mask)); };
    this.radar.setMapAsync = async (city, ground, mask) => { this.radar.setMapData(await MapData.build(city, ground, mask)); };
    this.timer = this._makeTimer();
    this.counter = this._makeCounter();
    this.bar = this._makeBar();
    this._resultChain = Promise.resolve();
    this._sub = null;
    this._timers = {};

    // wave 2
    this.stunt = makeStunt(this);
    this.fare = makeFare(this, this.trackers);
    this.photo = makePhoto(this);
    this.bark = makeBarks(this);
    this.collectibles = makeCollectibles(this);
    this.cheat = makeCheat(this);
    this._slowmo = el('div', 'vc-slowmo', '<i class="bar t"></i><i class="bar b"></i><span class="rec">● Replay</span>');
    this._fx.appendChild(this._slowmo);
    this._shave = el('div', 'vc-shave', '<div class="t">Close Shave</div><div class="c"></div>');
    this._fx.appendChild(this._shave);

    window.addEventListener('keydown', e => {
      if (e.__uiHandled || e.target?.closest?.('input, textarea, [contenteditable]')) return;
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && this._sub && !this.pause.isOpen && !this.map.isOpen) this.advance();
    });
  }

  // ------------------------------------------------------------ screens
  showTitle(opts) { this._title.show({ controls: this.controls, ...opts }); }
  hideTitle() { this._title.hide(); }
  showLoading(progress, label) { this._loading.show(progress, label); }
  hideLoading() { this._loading.hide(); }
  /** Replace the controls list shown in title/pause: [[section, [[keys, action], ...]], ...] */
  setControls(groups) { this.controls = groups; }

  // ------------------------------------------------------------ text
  _log(entry) {
    this.logEntries.push({ time: this._gameTime, ...entry });
    if (this.logEntries.length > 200) this.logEntries.shift();
  }

  /**
   * VC-style subtitle. Resolves when the line finishes (duration elapses, it's replaced, or advance() is called).
   * @param {string} text  may contain <b> pink, <em> green, <i> cyan, <u> gold highlights
   */
  subtitle(text, { speaker, color, duration, source } = {}) {
    if (this._sub) this._sub.finish();
    const col = color || colorFor(speaker);
    this._log({ speaker, text, color: col });
    const show = this.settings.subtitles !== false;
    this._subEl.innerHTML = speaker && show ? `<span class="spk" style="color:${col}">${escapeHtml(speaker)}:</span>${text}` : (show ? text : '');
    this._subEl.classList.toggle('vc-show', show && !!text);
    return new Promise(resolve => {
      const sub = {
        finish: () => {
          clearTimeout(sub.t);
          if (this._sub === sub) { this._sub = null; this._subEl.classList.remove('vc-show'); }
          resolve();
        },
      };
      sub.t = setTimeout(sub.finish, duration ?? lineMs(text));
      this._sub = sub;
    });
  }
  /** Play a sequence of {speaker, text, duration?} lines. */
  async say(lines) { for (const l of lines) await this.subtitle(l.text, l); }
  /** Skip the current subtitle line (bound to Enter by default). */
  advance() { this._sub?.finish(); }

  objective(text, duration = 7000) {
    this._log({ text, objective: true });
    this._timedShow(this._objEl, text, duration, 'obj');
  }
  /** true while the on-screen touch controls are up (ui/touch.js) */
  get touchMode() { return this.root.classList.contains('vc-touchmode'); }
  /** A controls tip in the player's own terms: the keyboard wording, or the on-screen buttons on a touch screen. */
  hint(keys, touch, duration) { this.help(touch && this.touchMode ? touch : keys, duration); }
  help(text, duration = 6500) {
    if (!text) { this._helpEl.classList.remove('vc-show'); return; }
    this._timedShow(this._helpEl, keyify(text), duration, 'help');
  }
  _timedShow(elm, html, duration, key) {
    clearTimeout(this._timers[key]);
    if (!html) { elm.classList.remove('vc-show'); return; }
    elm.innerHTML = html;
    elm.classList.add('vc-show');
    if (duration > 0) this._timers[key] = setTimeout(() => elm.classList.remove('vc-show'), duration);
  }
  interactPrompt(text) {
    if (text === this._lastPrompt) return;
    this._lastPrompt = text;
    if (!text) { this._interactEl.classList.remove('vc-show'); return; }
    this._interactEl.innerHTML = keyify(text);
    this._interactEl.classList.add('vc-show');
  }
  toast(text) {
    const t = el('div', 'vc-toast', text);
    this._toasts.appendChild(t);
    setTimeout(() => t.remove(), 3700);
    while (this._toasts.children.length > 4) this._toasts.firstElementChild.remove();
  }
  splash(text, color = '#7fe36a') {
    const s = el('div', 'vc-splash vc-outline', text);
    s.style.color = color;
    s.style.textShadow = `0 0 calc(var(--u) * 2.5) ${color}88`;
    this._fx.appendChild(s);
    setTimeout(() => s.remove(), 2300);
  }
  choice(prompt, options) { return showChoice(this._choiceLayer, prompt, options); }

  // ------------------------------------------------------------ mission screens
  missionTitle(title, subtitle = '') {
    this._mtitle.firstChild.textContent = title;
    this._mtitle.lastChild.textContent = subtitle;
    restartClass(this._mtitle, 'vc-show');
    clearTimeout(this._timers.mt);
    this._timers.mt = setTimeout(() => this._mtitle.classList.remove('vc-show'), 4500);
  }
  _result(cls, html, hold) {
    const run = async () => {
      const r = el('div', `vc-result ${cls}`, html);
      this._fx.appendChild(r);
      await wait(30); r.classList.add('vc-show');
      await wait(hold);
      r.classList.remove('vc-show');
      await wait(550); r.remove();
    };
    this._resultChain = this._resultChain.then(run, run);
    return this._resultChain;
  }
  missionPassed({ title, reward = 0, respect, extra } = {}) {
    this._log({ text: `<u>Mission passed${title ? `: ${escapeHtml(title)}` : ''}</u> ${reward ? fmtMoney(reward) : ''}`, objective: true });
    return this._result('passed',
      `<div class="big">Mission Passed!</div>${reward ? `<div class="reward">${fmtMoney(reward)}</div>` : ''}${extra ? `<div class="extra">${extra}</div>` : ''}${respect ? `<div class="respect">Respect +${respect === true ? '' : respect}</div>` : ''}`, 4600);
  }
  missionFailed(reason = '') {
    this._log({ text: `<b>Mission failed</b> ${escapeHtml(reason)}`, objective: true });
    return this._result('failed', `<div class="big">Mission Failed!</div>${reason ? `<div class="reason">${reason}</div>` : ''}`, 3800);
  }
  _dead(kind, word, line) {
    const run = async () => {
      const d = el('div', `vc-dead ${kind}`, `<div class="box"><div class="big">${word}</div><div class="line">${line}</div></div>`);
      this._fx.appendChild(d);
      await wait(30); d.classList.add('vc-show');
      await wait(4300);
      d.style.transition = 'opacity .7s'; d.style.opacity = 0;
      await wait(700); d.remove();
    };
    this._resultChain = this._resultChain.then(run, run);
    return this._resultChain;
  }
  wasted(line) { return this._dead('wasted', 'Wasted', line || WASTED_LINES[(Math.random() * WASTED_LINES.length) | 0]); }
  busted(line) { return this._dead('busted', 'Busted', line || BUSTED_LINES[(Math.random() * BUSTED_LINES.length) | 0]); }

  // ------------------------------------------------------------ cinematic
  letterbox(on) {
    this._lbTop.classList.toggle('on', on); this._lbBot.classList.toggle('on', on);
    this.root.classList.toggle('vc-cine', on);
    if (on && !this._lbHud) { this._lbHud = true; this._hudWas = this.hud.visible; this.hud.setVisible(false); }
    else if (!on && this._lbHud) { this._lbHud = false; this.hud.setVisible(this._hudWas !== false); }
  }
  /** the cold open's title card (Vibe City in pink neon script) */
  titleCard(on) { this._card.classList.toggle('vc-show', !!on); }
  setSkippable(on) { this.skippable = !!on; this._skipEl.classList.toggle('vc-show', !!on); }
  fade(toBlack, ms = 600) {
    this._fadeEl.style.transitionDuration = `${ms}ms`;
    this._fadeEl.style.opacity = toBlack ? 1 : 0;
    this._fadeEl.style.pointerEvents = toBlack ? 'auto' : 'none';
    return wait(ms + 20);
  }

  // ------------------------------------------------------------ trackers
  _row(cls) { const r = el('div', `vc-tracker vc-outline-thin vc-hidden ${cls || ''}`, '<span class="lbl"></span><span class="val"></span>'); this.trackers.appendChild(r); return r; }
  _makeTimer() {
    const r = this._row();
    const fmt = s => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    let last = '';
    return {
      show: (label, seconds) => { r.firstChild.textContent = label; r.classList.remove('vc-hidden'); last = ''; this.timer.set(seconds); },
      set: seconds => { const t = fmt(seconds); if (t !== last) { r.lastChild.textContent = t; last = t; r.classList.toggle('urgent', seconds <= 10); } },
      hide: () => r.classList.add('vc-hidden'),
    };
  }
  _makeCounter() {
    const r = this._row();
    let max = null, last;
    return {
      show: (label, value, mx) => { r.firstChild.textContent = label; max = mx ?? null; r.classList.remove('vc-hidden'); last = undefined; this.counter.set(value); },
      set: v => { if (v === last) return; last = v; r.lastChild.textContent = max != null ? `${Math.round(v).toLocaleString('en-US')}/${Math.round(max).toLocaleString('en-US')}` : Math.round(v).toLocaleString('en-US'); },
      hide: () => r.classList.add('vc-hidden'),
    };
  }
  _makeBar() {
    const r = el('div', 'vc-tracker bar vc-outline-thin vc-hidden', '<span class="lbl"></span><div class="vc-barshell"><div class="vc-barfill"></div></div>');
    this.trackers.appendChild(r);
    const fill = r.querySelector('.vc-barfill');
    return {
      show: (label, v, color = '#ff3d54') => { r.firstChild.textContent = label; fill.style.background = color; r.classList.remove('vc-hidden'); this.bar.set(v); },
      set: v => { fill.style.width = `${Math.max(0, Math.min(1, v)) * 100}%`; },
      hide: () => r.classList.add('vc-hidden'),
    };
  }

  /** near-miss popup (world/juice.js): CLOSE SHAVE, the cash, and the chain multiplier from the second in a row */
  closeShave(cash, combo = 1) {
    this._shave.lastChild.innerHTML = `+${fmtMoney(cash)}${combo > 1 ? `<span class="x">×${combo}</span>` : ''}`;
    restartClass(this._shave, 'go');
  }

  /** Replay look for stunt slow-motion: vignette, thin bars, blinking REPLAY tag. */
  slowmo(on) { this._slowmo.classList.toggle('on', !!on); this.root.classList.toggle('vc-slowmo-on', !!on); }

  /** Apply settings that affect the UI itself (subtitles on/off). Engine still owns the rest. */
  applySettings(s) { Object.assign(this.settings, s); }
}
