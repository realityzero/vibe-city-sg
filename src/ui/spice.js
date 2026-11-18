// "Spice" overlays: the Fine City ticket (speed / red-light cameras, small fines) with its camera flash, money floaters
// under the cash counter (ERP, fines, payouts), the "people are filming you" view counter, the always-on one-line
// objective, and the drag-race light. Each is one pooled DOM node re-armed with restartClass: nothing is created per
// event, and the full-screen flash only has a layer while it plays.
import './spice.css';
import { el, fmtMoney, restartClass } from './util.js';

const fmtViews = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n));

/** Notice of offence, stamped FINE CITY: { what, amount, detail, flash } (flash: a camera saw it) */
export function makeTicket(ui) {
  const t = el('div', 'vc-ticket', `<div class="slip"><div class="hd">Traffic Police · Notice of Offence</div><div class="what"></div>
    <div class="amt"></div><div class="det"></div><div class="stamp">Fine City</div></div>`);
  const flash = el('div', 'vc-camflash');
  ui._fx.append(flash, t);
  const what = t.querySelector('.what'), amt = t.querySelector('.amt'), det = t.querySelector('.det');
  let timer = 0;
  flash.addEventListener('animationend', () => flash.classList.remove('go'));
  return ({ what: w, amount, detail = '', flash: camera = false }) => {
    what.textContent = w; amt.textContent = fmtMoney(amount); det.innerHTML = detail;
    if (camera) restartClass(flash, 'go');
    t.classList.remove('out');
    restartClass(t, 'go');
    clearTimeout(timer); timer = setTimeout(() => t.classList.add('out'), 3400);
  };
}

/** a small amount drifting up off the cash counter: tone 'loss' (red), 'erp' (gantry amber) or 'gain' (green) */
export function makeFloater(hud) {
  const f = el('div', 'vc-floater vc-outline-thin');
  hud.root.querySelector('.vc-hud-col').appendChild(f);
  return (text, tone = 'loss') => { f.textContent = text; f.dataset.tone = tone; restartClass(f, 'go'); };
}

/** "people are filming you": a REC pill under the HUD that counts the views up; repeat calls add to the running clip */
export function makeViews(parent) {
  const p = el('div', 'vc-views vc-outline-thin', '<i class="rec"></i><b>0</b><span>views</span><em></em>');
  parent.appendChild(p);
  const num = p.querySelector('b'), tag = p.querySelector('em');
  let shown = 0, target = 0, raf = 0, hideT = 0, last = '';
  const step = () => {
    shown += Math.max(1, (target - shown) * 0.12);
    if (shown >= target) shown = target;
    const s = fmtViews(shown); if (s !== last) { num.textContent = s; last = s; }
    raf = shown < target ? requestAnimationFrame(step) : 0;
  };
  return (views, label = '') => {
    if (!p.classList.contains('on')) { shown = 0; target = 0; }
    target += views;
    tag.textContent = label;
    p.classList.add('on');
    if (!raf) raf = requestAnimationFrame(step);
    clearTimeout(hideT); hideT = setTimeout(() => p.classList.remove('on'), 4200);
  };
}

/** the always-on one-line objective at the top of the screen (html; empty hides it). quiet: no glow (a distance tick) */
export function makeGoal(parent) {
  const g = el('div', 'vc-goal', '<span class="d"></span><span class="tx"></span>');
  parent.appendChild(g);
  const tx = g.lastChild;
  let cur = null;
  const set = (html, quiet = false) => {
    if (html === cur) return;
    cur = html;
    g.classList.toggle('on', !!html);
    if (html) { tx.innerHTML = html; if (!quiet) restartClass(g, 'pop'); }
  };
  set.el = g;
  return set;
}

/** drag race: the challenge card and the start lights. set({ title, sub, lights: 0..3 lit, go }) / set(null) */
export function makeRaceLights(ui) {
  const r = el('div', 'vc-race', '<div class="lt"><i></i><i></i><i></i></div><div class="t"></div><div class="s"></div>');
  ui._fx.appendChild(r);
  const lights = [...r.querySelectorAll('.lt i')], t = r.querySelector('.t'), s = r.querySelector('.s');
  const prev = {};
  return o => {
    r.classList.toggle('on', !!o);
    if (!o) { prev.t = prev.s = prev.n = null; return; }
    if (o.title !== prev.t) { t.innerHTML = o.title || ''; prev.t = o.title; }
    if (o.sub !== prev.s) { s.innerHTML = o.sub || ''; prev.s = o.sub; }
    const n = o.go ? 4 : o.lights ?? 0;
    if (n !== prev.n) { prev.n = n; lights.forEach((l, i) => { l.className = n === 4 ? 'go' : i < n ? 'on' : ''; }); r.classList.toggle('lit', n > 0); }
  };
}
