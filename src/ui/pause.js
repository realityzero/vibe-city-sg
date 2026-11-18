// Pause menu: Map / Brief / Stats / Settings / Controls tabs.
import { MapView } from './map.js';
import { controlsHTML } from './screens.js';
import { el, escapeHtml, fmtInt } from './util.js';

export const DEFAULT_SETTINGS = {
  quality: 'high', resolutionScale: 1, drawDistance: 1800, mouseSensitivity: 1, invertY: false,
  masterVolume: 0.8, musicVolume: 0.7, radioVolume: 0.7, sfxVolume: 0.8, subtitles: true, autoGas: false,
};

const pct = v => `${Math.round(v * 100)}%`;
const SCHEMA = [
  { grp: 'Graphics' },
  { key: 'quality', label: 'Graphics quality', type: 'seg', options: ['low', 'medium', 'high', 'ultra'] },
  { key: 'resolutionScale', label: 'Resolution scale', type: 'range', min: 0.5, max: 1.5, step: 0.05, fmt: pct },
  { key: 'drawDistance', label: 'Draw distance', type: 'range', min: 400, max: 4000, step: 100, fmt: v => `${fmtInt(v)} m` },
  { key: 'shadows', label: 'Shadows', type: 'toggle' },
  { key: 'bloom', label: 'Neon bloom', type: 'toggle' },
  { key: 'showFps', label: 'Show FPS', type: 'toggle' },
  { grp: 'Controls' },
  { key: 'mouseSensitivity', label: 'Mouse sensitivity', type: 'range', min: 0.2, max: 3, step: 0.05, fmt: v => `${(+v).toFixed(2)}×` },
  { key: 'invertY', label: 'Invert Y axis', type: 'toggle' },
  { key: 'autoGas', label: 'Auto-gas (touch: the stick drives)', type: 'toggle' },
  { grp: 'Audio' },
  { key: 'masterVolume', label: 'Master volume', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
  { key: 'musicVolume', label: 'Music volume', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
  { key: 'radioVolume', label: 'Radio volume', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
  { key: 'sfxVolume', label: 'Effects volume', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
  { grp: 'Interface' },
  { key: 'subtitles', label: 'Subtitles', type: 'toggle' },
];

const TABS = [['map', 'Map'], ['brief', 'Brief'], ['stats', 'Stats'], ['secrets', 'Secrets'], ['settings', 'Settings'], ['controls', 'Controls']];

export class PauseMenu {
  constructor(parent, ui) {
    this.ui = ui;
    this.root = el('div', 'vc-pause vc-hidden vc-interactive');
    this.root.innerHTML = `<div class="top"><div class="brand">Vibe City</div><div class="tabs"></div><div class="spacer"></div>
      <button class="act quit">Quit to title</button><button class="act resume">Resume</button></div><div class="quick"></div><div class="body"></div>`;
    parent.appendChild(this.root);
    this.tabsEl = this.root.querySelector('.tabs');
    this.body = this.root.querySelector('.body');
    this.panes = {};
    for (const [id, label] of TABS) {
      const b = el('button', '', label); b.dataset.tab = id;
      b.onclick = () => this.tab(id);
      this.tabsEl.appendChild(b);
      const p = el('div', `pane ${id}`); this.panes[id] = p; this.body.appendChild(p);
    }
    this.mapView = new MapView(this.panes.map, () => ui.radar.map);
    this.root.querySelector('.resume').onclick = () => this.opts?.onResume?.();
    this.root.querySelector('.quit').onclick = () => this.opts?.onQuit?.();
    this.isOpen = false;
    window.addEventListener('keydown', e => {
      if (!this.isOpen) return;
      if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); e.__uiHandled = true; this.opts?.onResume ? this.opts.onResume() : this.close(); }
    }, true);
  }

  /**
   * @param {{onResume?:Function,onQuit?:Function,settings?:object,onSettingsChange?:Function,stats?:object,
   *          map?:{x,z,heading,blips,route}, tab?:string, controls?:Array}} opts
   */
  open(opts = {}) {
    this.opts = opts;
    if (this.ui.map.isOpen) this.ui.map.close();
    this.settings = { ...DEFAULT_SETTINGS, ...(opts.settings || {}) };
    this.root.querySelector('.quit').classList.toggle('vc-hidden', !opts.onQuit);
    // quick actions (touch: camera, Claudia, fullscreen): resume first, then act in the game
    const quick = this.root.querySelector('.quick');
    quick.textContent = '';
    for (const [label, run] of opts.actions || []) {
      const b = el('button', 'act', escapeHtml(label));
      b.onclick = () => { opts.onResume?.(); run(); };
      quick.appendChild(b);
    }
    quick.classList.toggle('vc-hidden', !opts.actions?.length);
    this.root.classList.remove('vc-hidden');
    this.isOpen = true;
    this._renderBrief(); this._renderStats(); this._renderSecrets(); this._renderSettings();
    this.tabsEl.querySelector('[data-tab="secrets"]').classList.toggle('vc-hidden', !opts.secrets);
    this.panes.controls.innerHTML = `<h3>Controls</h3>${controlsHTML(opts.controls || this.ui.controls)}`;
    let t = opts.tab || this._last || 'map';
    if (t === 'secrets' && !opts.secrets) t = 'map';
    this.tab(t);
  }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.mapView.hide();
    this.root.classList.add('vc-hidden');
  }
  tab(id) {
    this._last = id;
    for (const b of this.tabsEl.children) b.classList.toggle('on', b.dataset.tab === id);
    for (const [k, p] of Object.entries(this.panes)) p.style.display = k === id ? '' : 'none';
    if (id === 'map') {
      const m = this.opts.map || {};
      this.mapView.show({ scale: 0.55, route: this.ui.radar.route, ...m });
    } else this.mapView.hide();
  }

  _renderBrief() {
    const rows = this.ui.logEntries.slice().reverse();
    let h = '<h3>Brief</h3><div class="vc-log">';
    if (!rows.length) h += '<div class="row"><span class="tm"></span><span style="opacity:.6">Nothing yet. Go make something happen.</span></div>';
    for (const r of rows) {
      const tm = r.time != null ? `${String(Math.floor(r.time)).padStart(2, '0')}:${String(Math.floor((r.time % 1) * 60)).padStart(2, '0')}` : '';
      h += `<div class="row${r.objective ? ' obj' : ''}"><span class="tm">${tm}</span><span>${r.speaker ? `<span class="spk" style="color:${r.color || '#ff8fd0'}">${escapeHtml(r.speaker)}:</span>` : ''}${r.text}</span></div>`;
    }
    this.panes.brief.innerHTML = h + '</div>';
  }
  _renderStats() {
    const st = this.opts.stats || {};
    let h = '<h3>Stats</h3>';
    const c = this.ui.collectibles?.state;
    if (c && c.total) {
      const pct = Math.round((c.found / c.total) * 100);
      h += `<div class="vc-collect-card"><span class="ico">🍞</span><div class="tx"><div class="nm">${escapeHtml(c.label)}s found</div>
        <div class="vc-barshell"><div class="vc-barfill" style="width:${pct}%"></div></div></div><b>${c.found}/${c.total}</b></div>`;
    }
    h += '<div class="vc-stats">';
    const entries = Array.isArray(st) ? st : Object.entries(st);
    if (!entries.length) h += '<div class="st"><span>Days in Singapore</span><b>1</b></div>';
    for (const [k, v] of entries) h += `<div class="st"><span>${escapeHtml(k)}</span><b>${typeof v === 'number' ? fmtInt(v) : escapeHtml(v)}</b></div>`;
    this.panes.stats.innerHTML = h + '</div>';
  }
  _renderSecrets() {
    const list = this.opts.secrets || [];
    const n = list.filter(x => x.found).length;
    let h = `<h3>Secrets <span class="vc-sec-count">${n}/${list.length} found</span></h3><div class="vc-secrets">`;
    for (const x of list) {
      h += x.found
        ? `<div class="sec on"><div class="nm">${escapeHtml(x.name)}</div><div class="ds">${escapeHtml(x.desc || '')}</div></div>`
        : `<div class="sec off"><div class="nm">${'?'.repeat(Math.max(4, Math.min(12, String(x.name).length)))}</div><div class="ds">${x.hint ? escapeHtml(x.hint) : 'Not yet discovered'}</div></div>`;
    }
    this.panes.secrets.innerHTML = h + '</div>';
  }
  _renderSettings() {
    const s = this.settings, wrap = el('div', 'vc-settings');
    const emit = (k, v) => { s[k] = v; this.opts.onSettingsChange?.(k, v, { ...s }); };
    const known = new Set(SCHEMA.map(x => x.key).filter(Boolean));
    const rows = [];
    let pendingGrp = null;
    for (const f of SCHEMA) {
      if (f.grp) { pendingGrp = f.grp; continue; }
      if (!(f.key in s)) continue;
      if (pendingGrp) { rows.push({ grp: pendingGrp }); pendingGrp = null; }
      rows.push(f);
    }
    const extra = Object.keys(s).filter(k => !known.has(k));
    if (extra.length) rows.push({ grp: 'Other' });
    for (const k of extra) {
      const v = s[k];
      if (typeof v === 'boolean') rows.push({ key: k, label: k, type: 'toggle' });
      else if (typeof v === 'number') rows.push({ key: k, label: k, type: 'range', min: 0, max: Math.max(1, v * 2), step: v > 10 ? 1 : 0.01, fmt: x => (+x).toFixed(v > 10 ? 0 : 2) });
    }
    for (const f of rows) {
      if (f.grp) { wrap.appendChild(el('div', 'grp', f.grp)); continue; }
      wrap.appendChild(el('label', '', f.label));
      const ctl = el('div', 'ctl');
      if (f.type === 'seg') {
        const seg = el('div', 'vc-seg');
        for (const o of f.options) {
          const b = el('button', s[f.key] === o ? 'on' : '', o);
          b.onclick = () => { for (const c of seg.children) c.classList.remove('on'); b.classList.add('on'); emit(f.key, o); };
          seg.appendChild(b);
        }
        ctl.appendChild(seg);
      } else if (f.type === 'range') {
        const r = el('input'); r.type = 'range'; r.min = f.min; r.max = f.max; r.step = f.step; r.value = s[f.key];
        const num = el('span', 'num', f.fmt(s[f.key]));
        const paint = () => r.style.setProperty('--p', `${((r.value - f.min) / (f.max - f.min)) * 100}%`);
        paint();
        r.oninput = () => { num.textContent = f.fmt(+r.value); paint(); emit(f.key, +r.value); };
        ctl.append(r, num);
      } else if (f.type === 'toggle') {
        const t = el('button', `vc-toggle${s[f.key] ? ' on' : ''}`);
        t.onclick = () => { const v = !t.classList.contains('on'); t.classList.toggle('on', v); emit(f.key, v); };
        ctl.appendChild(t);
      }
      wrap.appendChild(ctl);
    }
    this.panes.settings.innerHTML = '<h3>Settings</h3>';
    this.panes.settings.appendChild(wrap);
  }
}
