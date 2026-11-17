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

// title-screen corner links (official marks: GitHub Invertocat, X logo)
const SOCIAL = [
  ['https://github.com/realityzero/vibe-city-sg', 'Source code on GitHub', '0 0 16 16',
    'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z'],
  ['https://x.com/neshantt_sikri', '@neshantt_sikri on X', '0 0 24 24',
    'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z'],
];
const socialHTML = () => `<nav class="vc-social" aria-label="Links">${SOCIAL.map(([href, label, vb, d]) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer" title="${label}" aria-label="${label}"><svg viewBox="${vb}" aria-hidden="true"><path d="${d}"/></svg></a>`).join('')}</nav>`;

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

// The synthwave floor: a plane hinged on the horizon, tilted 78° toward the viewer under a 40vh perspective, with
// 6vh cells scrolling forward every 1.2 s. It used to be a CSS 3D-transformed div five screens wide — on a 3x phone
// that alone was ~40 MB of compositing layer — so it's drawn here on one small canvas (same projection, line widths,
// colours and fade-in mask; alphas a touch lower than the CSS ones, which the resampled 3D layer used to soften).
function drawGrid(cv, t) {
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d'), vh = innerHeight / 100, d = 40 * vh, cs = 6 * vh, th = 78 * Math.PI / 180;
  const cy = Math.cos(th), sz = Math.sin(th), Ymax = 36 * vh, cx = W / 2;
  // local plane coords (x from the centre, y down the plane from the horizon) -> floor-relative screen coords
  const P = (x, y) => { const k = d / (d - y * sz); return [cx + x * k, y * cy * k]; };
  const mask = y => Math.min(1, y / (0.3 * Ymax));
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const off = ((t % 1.2) / 1.2) * cs;
  // rows: 0.35vh thick, rgba(255,63,164,.9)
  for (let y = off - cs; y < Ymax; y += cs) {
    const y0 = Math.max(0, y), y1 = Math.min(Ymax, y + 0.35 * vh); if (y1 <= y0) continue;
    const [, a] = P(0, y0), [, b] = P(0, y1); if (a > H) break;
    g.fillStyle = `rgba(255,63,164,${0.72 * mask((y0 + y1) / 2)})`; g.fillRect(0, a, W, Math.max(b - a, 0.5 / dpr));
  }
  // columns: 0.3vh wide every 6vh, centred on the middle cell, rgba(255,63,164,.75), fading in toward the horizon
  const kmax = Math.ceil((W * d / (d - Ymax * sz) / 2) / cs) + 1;
  const ySplit = 0.3 * Ymax, [, sSplit] = P(0, ySplit), [, sEnd] = P(0, Ymax);
  const grad = g.createLinearGradient(0, 0, 0, Math.max(1, sSplit));
  for (let i = 0; i <= 6; i++) { const yy = ySplit * i / 6, [, sy] = P(0, yy); grad.addColorStop(Math.min(1, sy / Math.max(1, sSplit)), `rgba(255,63,164,${0.58 * mask(yy)})`); }
  for (let k = -kmax; k <= kmax; k++) {
    const x0 = -0.5 * cs + k * cs, x1 = x0 + 0.3 * vh;
    const a = P(x0, 0), b = P(x1, 0), c = P(x1, Ymax), e = P(x0, Ymax);
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(e[0], e[1]); g.closePath();
    g.fillStyle = grad; g.fill();
    if (sEnd > sSplit) { g.save(); g.beginPath(); g.rect(0, sSplit, W, H); g.clip(); g.fillStyle = 'rgba(255,63,164,.58)'; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(e[0], e[1]); g.closePath(); g.fill(); g.restore(); }
  }
}

export class TitleScreen {
  constructor(parent) {
    this.root = el('div', 'vc-title vc-hidden vc-interactive');
    this.root.innerHTML = `
      <div class="vc-sky"></div><div class="vc-stars-bg"></div><div class="vc-sunclip"><div class="vc-sun"></div></div>
      <div class="vc-floor"><canvas class="vc-gridcv"></canvas></div>
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
      ${socialHTML()}
      <div class="vc-title-foot">Map data © OpenStreetMap contributors · A parody. Not affiliated with Rockstar Games.</div>`;
    parent.appendChild(this.root);
    this.menu = this.root.querySelector('.vc-menu');
    this.panel = null;
    this.sel = 0;
    // palms as SVG fill their container height
    for (const p of this.root.querySelectorAll('.vc-palms')) { const s = p.firstElementChild; s.style.height = '100%'; s.style.width = 'auto'; p.style.height = '78vh'; }
    this._key = e => {
      if (this.root.classList.contains('vc-hidden') || this.root.classList.contains('leaving')) return;
      if (e.target?.closest?.('.vc-social')) return; // Enter on a focused link follows the link, not the menu
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
    // animate the floor grid while the title is up
    const cv = this.root.querySelector('.vc-gridcv');
    if (cv && !this._gridRaf) { const loop = now => { if (this.root.classList.contains('vc-hidden')) { this._gridRaf = 0; return; } drawGrid(cv, now / 1000); this._gridRaf = requestAnimationFrame(loop); }; this._gridRaf = requestAnimationFrame(loop); }
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
