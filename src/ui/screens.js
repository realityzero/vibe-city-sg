// Title screen + loading screen.
import { skylineSVG, palmSVG } from './art.js';
import { el } from './util.js';

export const DEFAULT_CONTROLS = [
  ['On foot', [['W A S D', 'Move'], ['Mouse', 'Look around'], ['Shift', 'Sprint'], ['Space', 'Jump'], ['F', 'Enter / exit vehicle'], ['E', 'Talk / interact'], ['LMB', 'Punch / action']]],
  ['Driving', [['W / S', 'Accelerate / brake & reverse'], ['A / D', 'Steer'], ['Space', 'Handbrake'], ['H', 'Horn'], ['Q / R', 'Previous / next radio station'], ['C', 'Change camera']]],
  ['General', [['M', 'Map'], ['Esc', 'Pause menu'], ['1 – 4', 'Dialogue choices'], ['Enter', 'Skip dialogue line']]],
];

export const CREDITS_HTML = `
<p><b>Grand Theft Auto: Vibe City — Singapore</b> is a fan-made parody prototype. Not affiliated with Rockstar Games.</p>
<p>Runs entirely in your browser: <b>Three.js</b> (WebGL2 rendering), <b>Rapier</b> (WebAssembly physics), Web Workers (city generation), Web Audio (procedural radio).</p>
<p>Map data © <b>OpenStreetMap contributors</b>, available under the Open Database License (ODbL). Buildings, roads, parks and coastline are generated from real OSM data of central Singapore.</p>
<p>Fonts: Anton, Barlow Condensed, Inter, Monoton, Mr Dafoe, Yellowtail — SIL Open Font License.</p>
<p>All characters, companies and investors are fictional. Any resemblance to your cap table is purely coincidental.</p>`;

const TIPS = [
  'Chope a hawker seat with a packet of tissue. It is legally binding. Probably.',
  'ERP gantries deduct money every time you drive under them during peak hours. Your burn rate thanks you.',
  'Investors love traction. Users love free kopi. Do the maths.',
  'Jaywalking is a fineable offence. So is chewing gum. Tommy has been warned.',
  'Singapore drives on the LEFT. Remember this before your Series A, not after.',
  'The Merlion has been spitting water since 1972. Your startup has been spitting bugs since Tuesday.',
  'Every pitch deck needs a hockey-stick graph. Draw it with confidence.',
  'If it rains at 4pm, it will stop at 4:45pm. Plan your getaway accordingly.',
  '"Can or not?" — "Can." This is the entire due-diligence process at most kopitiams.',
  'Vibe coding tip: if the AI writes a bug, ask it nicely to write a better bug.',
  'Lau Pa Sat turns into satay street after 7pm. Networking opportunities: excellent. Sauce stains: likely.',
  'The Supertrees light up at 7:45pm. So do founders who just closed their round.',
  'A taxi with a green light is available. A taxi with a red light is judging you.',
  'Valuation is just vibes with a decimal point.',
  'Pressing the horn in Singapore is considered extremely rude. Tommy does not care.',
  'Durians are banned on the MRT. Durian startups are not. Yet.',
];

export class TitleScreen {
  constructor(parent) {
    this.root = el('div', 'vc-title vc-hidden vc-interactive');
    this.root.innerHTML = `
      <div class="vc-sky"></div><div class="vc-stars-bg"></div><div class="vc-sunclip"><div class="vc-sun"></div></div>
      <div class="vc-floor"><div class="vc-grid"></div></div>
      <div class="vc-reflect">${skylineSVG({ fill: '#2a0b3e', back: '#3a1450', edge: 'rgba(255,110,190,.3)', seed: 11 })}</div>
      <div class="vc-sunrefl"></div><div class="vc-horizon-glow"></div>
      <div class="vc-skyline">${skylineSVG({ fill: '#170826', back: '#3d1356', edge: 'rgba(255,120,200,.55)', windows: true, winColors: ['#ffd27a', '#ff9ad5'], lights: true, seed: 11 })}</div>
      <div class="vc-palms l">${palmSVG('#0b0315', 3)}</div>
      <div class="vc-palms r">${palmSVG('#0b0315', 9)}</div>
      <div class="vc-logo">
        <div class="gta">GRAND<span>THEFT</span>AUTO</div>
        <div class="vibe">Vibe City</div>
        <div class="sg">SINGAPORE</div>
        <div class="tag">Ship it. Pitch it. Raise it.</div>
      </div>
      <div class="vc-menu"></div>
      <div class="vc-title-foot">Map data © OpenStreetMap contributors · A parody. Not affiliated with Rockstar Games.</div>`;
    parent.appendChild(this.root);
    this.menu = this.root.querySelector('.vc-menu');
    this.panel = null;
    this.sel = 0;
    // palms as SVG fill their container height
    for (const p of this.root.querySelectorAll('.vc-palms')) { const s = p.firstElementChild; s.style.height = '100%'; s.style.width = 'auto'; p.style.height = '78vh'; }
    this._key = e => {
      if (this.root.classList.contains('vc-hidden') || this.root.classList.contains('leaving')) return;
      if (this.panel) { if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Backspace') { e.preventDefault(); this._closePanel(); } return; }
      const btns = [...this.menu.querySelectorAll('button:not([disabled])')];
      if (!btns.length) return;
      if (e.code === 'ArrowDown' || e.code === 'KeyS') { this.sel = (this.sel + 1) % btns.length; this._mark(btns); e.preventDefault(); }
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') { this.sel = (this.sel + btns.length - 1) % btns.length; this._mark(btns); e.preventDefault(); }
      else if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); btns[this.sel]?.click(); }
      e.__uiHandled = true;
    };
    window.addEventListener('keydown', this._key, true);
  }
  _mark(btns) { btns.forEach((b, i) => b.classList.toggle('sel', i === this.sel)); }

  show({ onStart, onContinue, onSettings, controls } = {}) {
    this.controls = controls;
    const items = [
      ['Start Game', onStart],
      ['Continue', onContinue, !onContinue],
      ['Settings', () => (onSettings ? onSettings() : this._openPanel('Settings', '<p>Graphics, audio and controls can be changed any time from the pause menu (<kbd>Esc</kbd>) in game.</p>'))],
      ['Controls', () => this._openPanel('Controls', controlsHTML(this.controls))],
      ['Credits', () => this._openPanel('Credits', CREDITS_HTML)],
    ];
    this.menu.innerHTML = '';
    for (const [label, fn, disabled] of items) {
      const b = el('button', '', label);
      if (disabled) b.disabled = true;
      b.onclick = () => fn && fn();
      b.onmouseenter = () => { const btns = [...this.menu.querySelectorAll('button:not([disabled])')]; this.sel = btns.indexOf(b); this._mark(btns); };
      this.menu.appendChild(b);
    }
    this.sel = 0;
    this._mark([...this.menu.querySelectorAll('button:not([disabled])')]);
    this.root.classList.remove('vc-hidden', 'leaving');
  }
  _openPanel(title, html) {
    this._closePanel();
    this.panel = el('div', 'vc-title-panel', `<h2>${title}</h2>${html}`);
    const x = el('button', 'close', 'Close ✕');
    x.onclick = () => this._closePanel();
    this.panel.appendChild(x);
    this.root.appendChild(this.panel);
    this.menu.style.visibility = 'hidden';
  }
  _closePanel() { if (this.panel) { this.panel.remove(); this.panel = null; this.menu.style.visibility = ''; } }
  hide() {
    this._closePanel();
    this.root.classList.add('leaving');
    setTimeout(() => { if (this.root.classList.contains('leaving')) this.root.classList.add('vc-hidden'); }, 800);
  }
}

export function controlsHTML(groups = DEFAULT_CONTROLS) {
  let h = '<div class="vc-controls">';
  for (const [sec, rows] of groups) {
    h += `<div class="sec">${sec}</div>`;
    for (const [k, v] of rows) h += `<div class="c"><span>${v}</span><span>${k.split(' / ').map(x => x.split(' ').map(y => y.length <= 6 && y !== '–' ? `<kbd>${y}</kbd>` : y).join(' ')).join(' / ')}</span></div>`;
  }
  return h + '</div>';
}

export class LoadingScreen {
  constructor(parent) {
    this.root = el('div', 'vc-loading vc-hidden');
    this.root.innerHTML = `
      <div class="vc-load-art"><div class="kenburns">
        <div class="moon"></div>
        <svg class="sky" viewBox="0 0 10 10"></svg>
        <div class="water"></div>
      </div></div>
      <div class="vc-load-logo"><div class="vibe">Vibe City</div><div class="sg">SINGAPORE</div></div>
      <div class="vc-tipbox"><div class="hd">Tip</div><div class="tip"></div></div>
      <div class="vc-progress"><div class="lbl"><span class="l">Loading</span><span class="p">0%</span></div><div class="shell"><div class="fill"></div></div></div>`;
    const art = this.root.querySelector('.kenburns');
    const sky = art.querySelector('svg.sky');
    const holder = el('div');
    holder.innerHTML = skylineSVG({ fill: '#0a0316', back: '#1e0a36', edge: 'rgba(47,230,255,.35)', windows: true, winColors: ['#ffd27a', '#8ef3ff', '#ff9ad5'], lights: true, seed: 23 });
    const s2 = holder.firstElementChild; s2.setAttribute('class', 'sky');
    sky.replaceWith(s2);
    parent.appendChild(this.root);
    this.tipEl = this.root.querySelector('.tip');
    this.fill = this.root.querySelector('.fill');
    this.lbl = this.root.querySelector('.lbl .l');
    this.pct = this.root.querySelector('.lbl .p');
    this.tipI = (Math.random() * TIPS.length) | 0;
    this._tipTimer = 0;
  }
  _nextTip() {
    this.tipEl.style.opacity = 0;
    setTimeout(() => { this.tipI = (this.tipI + 1) % TIPS.length; this.tipEl.textContent = TIPS[this.tipI]; this.tipEl.style.opacity = 1; }, 450);
  }
  show(progress = 0, label) {
    if (this.root.classList.contains('vc-hidden') || this.root.classList.contains('leaving')) {
      this.root.classList.remove('vc-hidden', 'leaving');
      this.tipEl.textContent = TIPS[this.tipI];
      clearInterval(this._tipTimer);
      this._tipTimer = setInterval(() => this._nextTip(), 5200);
    }
    const p = Math.max(0, Math.min(1, progress));
    this.fill.style.width = `${(p * 100).toFixed(1)}%`;
    this.pct.textContent = `${Math.round(p * 100)}%`;
    if (label) this.lbl.textContent = label;
  }
  hide() {
    clearInterval(this._tipTimer);
    this.root.classList.add('leaving');
    setTimeout(() => { if (this.root.classList.contains('leaving')) this.root.classList.add('vc-hidden'); }, 750);
  }
}
