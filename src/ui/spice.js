// "Spice" overlays: the Fine City ticket (speed / red-light cameras, small fines) with its camera flash, money floaters
// under the cash counter (ERP, fines, payouts), the "people are filming you" view counter (also a job's objective bar),
// a bystander's clip as a phone video, the always-on one-line objective, and the drag-race light. Each is one pooled
// DOM node re-armed with restartClass: nothing is created per event, and the full-screen flash and the clip card only
// have a layer while they play.
import './spice.css';
import { el, fmtMoney, restartClass } from './util.js';

const fmtViews = n => n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n));

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

/** "people are filming you": a REC pill under the HUD that counts the views up; repeat calls add to the running clip.
 *  views.goal(n) makes it a job's objective bar ("412K / 1M views", a fill along its foot, up until goal(0));
 *  views.boost(x) shows the algorithm's multiplier on it */
export function makeViews(parent) {
  const p = el('div', 'vc-views vc-outline-thin', '<i class="rec"></i><b>0</b><span class="of"></span><span>views</span><strong></strong><em></em><i class="fill"></i>');
  parent.appendChild(p);
  const num = p.querySelector('b'), of = p.querySelector('.of'), boost = p.querySelector('strong'), tag = p.querySelector('em'), fill = p.querySelector('.fill');
  let shown = 0, target = 0, goal = 0, raf = 0, hideT = 0, last = '';
  const step = () => {
    shown += Math.max(1, (target - shown) * 0.12);
    if (shown >= target) shown = target;
    const s = fmtViews(shown); if (s !== last) { num.textContent = s; last = s; }
    if (goal) fill.style.transform = `scaleX(${Math.min(1, shown / goal)})`;
    raf = shown < target ? requestAnimationFrame(step) : 0;
  };
  const views = (n, label = '') => {
    if (!goal && !p.classList.contains('on')) { shown = 0; target = 0; }
    target += n;
    tag.textContent = label;
    p.classList.add('on');
    if (goal && target >= goal) p.classList.add('hit');
    if (!raf) raf = requestAnimationFrame(step);
    clearTimeout(hideT); if (!goal) hideT = setTimeout(() => p.classList.remove('on'), 4200);
  };
  views.goal = n => {
    goal = n; shown = target = 0; last = '0'; num.textContent = '0'; tag.textContent = ''; boost.textContent = '';
    fill.style.transform = 'scaleX(0)';
    of.textContent = n ? `/ ${fmtViews(n)}` : '';
    p.classList.toggle('goal', !!n); p.classList.remove('hit');
    clearTimeout(hideT); p.classList.toggle('on', !!n);
  };
  views.boost = x => { const s = x > 1.01 ? `×${+x.toFixed(2)}` : ''; if (boost.textContent !== s) { boost.textContent = s; if (s) restartClass(boost, 'pop'); } };
  views.total = () => target;
  return views;
}

/** A bystander's clip of the player as a vertical phone video: the still they caught (world/bystander.js paints
 *  `canvas`), REC and a running time, the poster's handle, the hashtag and place, Singlish comments rising and a like
 *  burst. One node, re-armed per clip (restartClass restarts every CSS animation in it); 5.5 s on screen.
 *  show({ handle, tag, where, views, likes, comments: [3 strings] }) */
export function makeClipCard(ui, w, h) {
  const c = el('div', 'vc-clip', `<div class="scr"><canvas width="${w}" height="${h}"></canvas><div class="top"><i class="rec"></i><span class="t">0:00</span></div>
    <div class="side"><span class="like"><i>♥</i><b></b></span><span class="share"><i>➦</i><b>Share</b></span><i class="h">♥</i><i class="h">♥</i><i class="h">♥</i></div>
    <ul class="cm"><li></li><li></li><li></li></ul><div class="cap"><b class="who"></b><span class="tag"></span><span class="views"></span></div></div>`);
  ui._fx.appendChild(c);
  const q = s => c.querySelector(s), t = q('.t'), likes = q('.like b'), who = q('.who'), tag = q('.tag'), views = q('.views'), cms = [...c.querySelectorAll('.cm li')];
  let hideT = 0, tick = 0;
  c.addEventListener('animationend', e => { if (e.animationName === 'vc-clip-out') c.classList.remove('on', 'out'); });
  const show = o => {
    who.textContent = o.handle; tag.textContent = `${o.tag} · ${o.where}`; views.textContent = `${fmtViews(o.views)} views`;
    likes.textContent = fmtViews(o.likes); o.comments.forEach((s, i) => { cms[i].textContent = s; });
    let s = 0; t.textContent = '0:00';
    clearInterval(tick); tick = setInterval(() => { t.textContent = `0:0${Math.min(9, ++s)}`; }, 1000);
    c.classList.remove('out'); restartClass(c, 'on');
    clearTimeout(hideT); hideT = setTimeout(() => { clearInterval(tick); c.classList.add('out'); }, 5500);
  };
  show.canvas = q('canvas');
  return show;
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
