// Demo Day at the Marina Bay Sands Expo: buzzword timing QTEs + investor Q&A.
import { h, mountShell, runShell, meter, clamp, pick, sleep, sfx, typeText, confetti, voice } from './common.js';
import { INVESTORS, slides as makeSlides, questions as makeQuestions, TIMEOUT_ANSWER, QTE_LINES, QTE_REACT, verdict } from './pitch-data.js';
import { PORTRAITS, TOMMY_PODIUM } from './portraits.js';
import { playSeq } from '../../missions/vodyn.js';
// canvas pixel ratio capped at 2: a 3x phone screen would make each full-screen minigame canvas ~12 MB
const MG_DPR = Math.min(2, window.devicePixelRatio || 1);

const KEYS = ['merlion', 'sandhill', 'auntie'];

/**
 * @param {HTMLElement} root
 * @param {{audio?, idea?, ideaName?, quality?: number, users?: number, onEvent?, signal?: AbortSignal, debug?: boolean}} opts
 * @returns {Promise<{score, hype, credibility, interest:{merlion,sandhill,auntie}, quotes:string[]}>}
 */
export function runPitch(root, opts = {}) {
  const ctx = mountShell(root, { kind: 'pitch', signal: opts.signal, onEvent: opts.onEvent });
  return runShell(play(ctx, opts), ctx);
}

async function play(ctx, opts) {
  const { scope, shell } = ctx;
  const { audio, onEvent } = opts;
  const idea = opts.idea || 'chopechain';
  const ideaName = opts.ideaName || { chopechain: 'ChopeChain', kopiai: 'Kopi.ai', duriandash: 'DurianDash' }[idea] || 'Startup';
  const quality = clamp(opts.quality ?? 60);
  const users = Math.max(0, opts.users ?? 1000);
  const SL = makeSlides(idea, { users });
  const QS = makeQuestions(idea, { users });

  const S = {
    hype: 40, cred: clamp(28 + quality * 0.3),
    interest: { merlion: clamp(28 + quality * 0.25), sandhill: 45, auntie: clamp(32 + Math.min(16, users / 250)) },
    quotes: [],
  };

  // ---------- DOM
  const crowd = h('canvas', { class: 'pt-crowd' });
  const hypeM = meter('Hype', 'pt-m pt-m--hype');
  const credM = meter('Credibility', 'pt-m pt-m--cred');
  const dots = h('div', { class: 'pt-dots' }, SL.map(() => h('i')));
  const top = h('div', { class: 'pt-top' }, hypeM.el,
    h('div', { class: 'pt-brand' }, h('div', { class: 'pt-brand-k' }, 'DEMO DAY 2026'), h('div', { class: 'pt-brand-s' }, 'MARINA BAY SANDS EXPO · HALL B'), dots),
    credM.el);
  const slideEl = h('div', { class: 'pt-slide' });
  const screen = h('div', { class: 'pt-screen' }, h('div', { class: 'pt-screen-glow' }), slideEl);
  const tommy = h('div', { class: 'pt-tommy', html: TOMMY_PODIUM(ideaName.toUpperCase().slice(0, 10)) });
  const subName = h('b');
  const subText = h('span');
  const sub = h('div', { class: 'pt-sub' }, subName, subText);
  const inv = {};
  const table = h('div', { class: 'pt-table' }, KEYS.map(k => {
    const I = INVESTORS[k];
    const m = meter('Interest', 'pt-im');
    const ava = h('div', { class: 'inv-ava mood-neutral', html: PORTRAITS[k]() });
    const bubble = h('div', { class: 'inv-bubble' });
    const el = h('div', { class: 'inv', style: { '--c': I.color } }, bubble, ava,
      h('div', { class: 'inv-info' }, h('div', { class: 'inv-name' }, I.name), h('div', { class: 'inv-firm' }, I.firm), h('div', { class: 'inv-role' }, I.role), m.el),
      h('div', { class: 'inv-plate' }));
    inv[k] = { el, m, ava, bubble, hideT: null };
    return el;
  }));
  const qteEl = h('div', { class: 'pt-qte' });
  const qEl = h('div', { class: 'pt-q' });
  const stage = h('div', { class: 'pt' }, h('div', { class: 'pt-bg' }, h('i', { class: 'beam b1' }), h('i', { class: 'beam b2' }), h('i', { class: 'beam b3' })), crowd, top, screen, tommy, sub, table, qteEl, qEl);
  shell.append(stage);

  const refresh = () => {
    hypeM.set(S.hype); credM.set(S.cred);
    for (const k of KEYS) inv[k].m.set(S.interest[k]);
  };
  refresh();

  // ---------- crowd canvas (audience silhouettes + phone flashes)
  const C = crowd.getContext('2d');
  const heads = [];
  let cheer = 0.15;
  const flashes = [];
  const sizeCrowd = () => {
    crowd.width = crowd.clientWidth * MG_DPR; crowd.height = crowd.clientHeight * MG_DPR;
    heads.length = 0;
    for (let row = 0; row < 4; row++) {
      const n = 26 + row * 6;
      for (let i = 0; i < n; i++) heads.push({ row, x: (i + Math.random() * 0.8) / n, ph: Math.random() * 6.28, s: 0.85 + Math.random() * 0.3, hair: Math.random() });
    }
    heads.sort((a, b) => a.row - b.row);
  };
  sizeCrowd();
  scope.on(window, 'resize', sizeCrowd);
  const flash = n => { for (let i = 0; i < n; i++) flashes.push({ x: Math.random(), row: Math.floor(Math.random() * 4), t: 0, life: 0.25 + Math.random() * 0.5, delay: Math.random() * 0.8 }); };
  scope.loop((dt, t) => {
    const W = crowd.width, H = crowd.height, d = MG_DPR;
    C.clearRect(0, 0, W, H);
    for (const p of heads) {
      const y0 = H * (0.25 + p.row * 0.2);
      const r = (14 + p.row * 5) * p.s * d;
      const bob = Math.sin(t * (2 + cheer * 6) + p.ph) * cheer * 7 * d;
      const x = p.x * W, y = y0 - bob;
      const shade = 18 + p.row * 6;
      C.fillStyle = `rgb(${shade + 6},${shade},${shade + 26})`;
      C.beginPath(); C.ellipse(x, y + r * 2.2, r * 1.9, r * 1.3, 0, 0, Math.PI * 2); C.fill();
      C.beginPath(); C.arc(x, y, r, 0, Math.PI * 2); C.fill();
      C.fillStyle = 'rgba(255,62,165,.08)';
      C.beginPath(); C.arc(x - r * 0.3, y - r * 0.3, r * 0.6, 0, Math.PI * 2); C.fill();
    }
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      if (f.delay > 0) { f.delay -= dt; continue; }
      f.t += dt;
      const a = Math.max(0, 1 - f.t / f.life);
      const x = f.x * W, y = H * (0.18 + f.row * 0.2);
      C.fillStyle = `rgba(220,240,255,${0.9 * a})`;
      C.fillRect(x - 5 * d, y - 8 * d, 10 * d, 16 * d);
      const g = C.createRadialGradient(x, y, 0, x, y, 60 * d);
      g.addColorStop(0, `rgba(255,255,255,${0.45 * a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      C.fillStyle = g; C.fillRect(x - 60 * d, y - 60 * d, 120 * d, 120 * d);
      if (f.t > f.life) flashes.splice(i, 1);
    }
    cheer += (0.15 - cheer) * dt * 0.6;
  });

  // ---------- helpers
  // voice roles (src/audio/cast.js): the MC, Tommy and the three investors
  const ROLE_OF = { TOMMY: 'tommy', MC: 'mc', merlion: 'priya', sandhill: 'chad', auntie: 'auntiemei' };
  scope.add(() => audio?.voice?.stopDialogue?.());
  // speak: what the voice says when it differs from the subtitle (exact figures on screen, a finite spoken form) —
  // a line, or sentences played back to back
  const speakAs = (role, s) => Array.isArray(s) ? playSeq(audio, role, s) : voice(audio, role, s);
  const say = async (who, text, { cps = 48, wait = 900, speak } = {}) => {
    subName.textContent = who ? `${who}: ` : '';
    sub.classList.add('is-on');
    tommy.classList.toggle('is-talking', who === 'TOMMY');
    const vo = speakAs(ROLE_OF[who], speak ?? text);
    await Promise.all([typeText(scope, subText, text, cps, stage), vo]);
    tommy.classList.remove('is-talking');
    await sleep(scope, wait);
  };
  const setMood = (k, d) => {
    const mood = d >= 10 ? 'wow' : d > 3 ? 'happy' : d < -3 ? 'sad' : 'neutral';
    inv[k].ava.className = `inv-ava mood-${mood}`;
  };
  const react = (k, text, d) => {
    const I = inv[k];
    if (d) {
      const f = h('div', { class: `inv-delta ${d > 0 ? 'is-up' : 'is-down'}` }, `${d > 0 ? '+' : ''}${Math.round(d)}`);
      I.el.append(f); scope.timeout(() => f.remove(), 1400);
      I.m.bump(d > 0 ? 'up' : 'down');
    }
    setMood(k, d ?? 0);
    if (text) {
      voice(audio, ROLE_OF[k], text, { interrupt: false }); // several investors can react at once: first one speaks
      I.bubble.textContent = text;
      I.bubble.classList.add('is-on');
      I.hideT?.(); I.hideT = scope.timeout(() => I.bubble.classList.remove('is-on'), 3200);
      S.quotes.push(`${INVESTORS[k].name}: “${text}”`);
    }
  };
  const apply = (fx, reacts = {}) => {
    const credK = fx.cred > 0 ? 0.85 + quality / 300 : 1;
    if (fx.hype) { S.hype = clamp(S.hype + fx.hype); hypeM.bump(fx.hype > 0 ? 'up' : 'down'); }
    if (fx.cred) { S.cred = clamp(S.cred + fx.cred * credK); credM.bump(fx.cred > 0 ? 'up' : 'down'); }
    for (const k of KEYS) {
      const d = fx[k] ?? 0;
      if (d) S.interest[k] = clamp(S.interest[k] + d);
      if (d || reacts[k]) react(k, reacts[k], d);
    }
    refresh();
    const good = (fx.hype ?? 0) + (fx.cred ?? 0);
    if (good > 10) { cheer = Math.min(1, cheer + 0.4); flash(4); }
  };

  // ---------- slides
  const showSlide = i => {
    const s = SL[i];
    [...dots.children].forEach((d, j) => d.className = j < i ? 'done' : j === i ? 'cur' : '');
    const body = slideBody(s, idea);
    const el = h('div', { class: `sl sl--${s.kind}` },
      h('div', { class: 'sl-top' }, h('span', { class: 'sl-co' }, ideaName), h('span', { class: 'sl-n' }, `${i + 1} / ${SL.length}`)),
      h('div', { class: 'sl-title' }, s.title), body);
    slideEl.replaceChildren(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    // animated canvases
    const cv = el.querySelector('canvas');
    if (cv) drawChart(scope, cv, s);
  };

  // ---------- QTE
  const qte = (word, idx) => new Promise(resolve => {
    const zw = 0.16 + quality * 0.001;
    const pw = zw * 0.34;
    const zc = 0.25 + Math.random() * 0.5;
    const speed = 0.62 + idx * 0.13;
    const needle = h('div', { class: 'qte-needle' });
    const fb = h('div', { class: 'qte-fb' });
    const timeBar = h('i');
    const bar = h('div', { class: 'qte-bar' },
      h('div', { class: 'qte-zone', style: { left: `${(zc - zw / 2) * 100}%`, width: `${zw * 100}%` } }, h('div', { class: 'qte-perfect', style: { left: `${(0.5 - pw / zw / 2) * 100}%`, width: `${pw / zw * 100}%` } })),
      needle);
    qteEl.replaceChildren(
      h('div', { class: 'qte-k' }, 'DROP THE BUZZWORD'),
      h('div', { class: 'qte-word' }, `“${word}”`),
      bar, h('div', { class: 'qte-time' }, timeBar),
      h('div', { class: 'qte-hint' }, 'press ', h('kbd', null, 'SPACE'), ' or click in the zone'), fb);
    qteEl.classList.add('is-on');
    let pos = 0, dir = 1, left = 4.6, done = false;
    const finish = r => {
      if (done) return; done = true;
      stopLoop();
      fb.textContent = { perfect: 'PERFECT!', good: 'GOOD', miss: 'MISS' }[r];
      fb.className = `qte-fb is-${r}`;
      qteEl.classList.add(`is-${r}`);
      sfx(audio, r === 'miss' ? 'ui_hover' : 'checkpoint');
      onEvent?.({ type: 'qte', word, result: r });
      scope.timeout(() => { qteEl.classList.remove('is-on', 'is-perfect', 'is-good', 'is-miss'); resolve(r); }, 900);
    };
    const hit = () => {
      if (scope.paused || done) return;
      const d = Math.abs(pos - zc);
      finish(d <= pw / 2 ? 'perfect' : d <= zw / 2 ? 'good' : 'miss');
    };
    const stopLoop = scope.loop(dt => {
      pos += dir * speed * 2 * dt;
      if (pos > 1) { pos = 2 - pos; dir = -1; } else if (pos < 0) { pos = -pos; dir = 1; }
      needle.style.left = `${pos * 100}%`;
      left -= dt;
      timeBar.style.width = `${Math.max(0, left / 4.6) * 100}%`;
      if (left <= 0) finish('miss');
    });
    const onKey = e => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); hit(); } };
    window.addEventListener('keydown', onKey, true);
    qteEl.onpointerdown = e => { e.preventDefault(); hit(); };
    const cleanup = () => { window.removeEventListener('keydown', onKey, true); qteEl.onpointerdown = null; };
    scope.add(cleanup);
    const origResolve = resolve;
    resolve = r => { cleanup(); origResolve(r); };
  });

  // ---------- question
  const ask = q => new Promise(resolve => {
    const I = INVESTORS[q.from];
    const order = q.answers.map((a, i) => ({ a, i })).sort(() => Math.random() - 0.5);
    let done = false, left = 13;
    const timeBar = h('i');
    const qText = h('div', { class: 'q-text' });
    const btns = order.map(({ a }, n) => h('button', { class: 'q-ans', onclick: () => pickAns(n), onmouseenter: () => sfx(audio, 'ui_hover') }, h('kbd', null, String(n + 1)), h('span', null, a.text)));
    qEl.replaceChildren(h('div', { class: 'q-card', style: { '--c': I.color } },
      h('div', { class: 'q-head' }, h('div', { class: 'q-ava', html: PORTRAITS[q.from]() }), h('div', null, h('b', null, I.name), h('small', null, I.firm)), h('div', { class: 'q-timer' }, timeBar)),
      qText, h('div', { class: 'q-answers' }, btns), h('div', { class: 'q-hint' }, 'answer with ', h('kbd', null, '1'), '–', h('kbd', null, String(btns.length)), ' or click')));
    qEl.classList.add('is-on');
    inv[q.from].el.classList.add('is-asking');
    typeText(scope, qText, q.text, 90, qText);
    speakAs(ROLE_OF[q.from], q.speak ?? q.text);
    const pickAns = n => {
      if (done || scope.paused) return; done = true;
      sfx(audio, 'ui_select');
      btns.forEach((b, j) => b.classList.add(j === n ? 'is-picked' : 'is-dim'));
      finish(order[n].a);
    };
    const finish = a => {
      stopLoop(); window.removeEventListener('keydown', onKey, true);
      scope.timeout(() => { qEl.classList.remove('is-on'); inv[q.from].el.classList.remove('is-asking'); resolve(a); }, a === TIMEOUT_ANSWER ? 300 : 650);
    };
    const onKey = e => { const n = +e.key; if (n >= 1 && n <= btns.length && !e.repeat) { e.preventDefault(); pickAns(n - 1); } };
    window.addEventListener('keydown', onKey, true);
    scope.add(() => window.removeEventListener('keydown', onKey, true));
    const stopLoop = scope.loop(dt => {
      left -= dt;
      timeBar.style.width = `${Math.max(0, left / 13) * 100}%`;
      qEl.classList.toggle('is-urgent', left < 4);
      if (left <= 0 && !done) { done = true; finish(TIMEOUT_ANSWER); }
    });
  });

  // ---------- intro
  {
    let go;
    const ready = new Promise(r => { go = r; });
    const btn = h('button', { class: 'mg-btn mg-btn--primary mg-btn--big', onclick: () => go() }, 'Take the stage  ▸');
    const intro = h('div', { class: 'pt-intro' }, h('div', { class: 'pt-intro-card' },
      h('div', { class: 'pt-intro-k' }, 'MISSION · THE PITCH'),
      h('div', { class: 'pt-intro-t' }, 'DEMO DAY'),
      h('div', { class: 'pt-intro-s' }, `5 slides. 3 investors. 1 shot. Pitch ${ideaName} and don't embarrass Ken.`),
      h('ul', { class: 'pt-intro-l' },
        h('li', null, h('kbd', null, 'SPACE'), ' drop each buzzword when the needle hits the zone'),
        h('li', null, h('kbd', null, '1'), '–', h('kbd', null, '4'), ' answer investor questions before the timer runs out'),
        h('li', null, 'Watch ', h('b', { style: { color: '#ff3ea5' } }, 'Hype'), ' and ', h('b', { style: { color: '#26e0ff' } }, 'Credibility'), ' — investors want both')),
      btn));
    stage.append(intro);
    const onKey = e => { if ((e.code === 'Space' || e.key === 'Enter') && !scope.paused) { e.preventDefault(); go(); } };
    window.addEventListener('keydown', onKey, true);
    scope.add(() => window.removeEventListener('keydown', onKey, true));
    btn.focus();
    await ready;
    window.removeEventListener('keydown', onKey, true);
    sfx(audio, 'ui_select');
    intro.classList.add('is-out');
    scope.timeout(() => intro.remove(), 500);
    stage.classList.add('is-live');
  }

  await sleep(scope, 500);
  await say('MC', `Next up — Tommy Vercetti, founder of ${ideaName}!`, { wait: 400 });
  sfx(audio, 'applause');
  cheer = 0.6; flash(6);
  await sleep(scope, 900);

  // ---------- rounds
  for (let i = 0; i < SL.length; i++) {
    showSlide(i);
    onEvent?.({ type: 'slide', index: i, kind: SL[i].kind });
    await sleep(scope, 500);
    await say('TOMMY', SL[i].line, { wait: 300, speak: SL[i].speak });
    const word = pick(SL[i].buzz);
    sub.classList.remove('is-on');
    const r = await qte(word, i);
    const fx = r === 'perfect' ? { hype: 10, cred: 3, merlion: 2, sandhill: 7, auntie: 2 } : r === 'good' ? { hype: 6, cred: 1, sandhill: 3 } : { hype: -4, cred: -6, merlion: -4, auntie: -2 };
    apply(fx, QTE_REACT[r]);
    if (r === 'perfect') { tommy.classList.add('is-hype'); scope.timeout(() => tommy.classList.remove('is-hype'), 900); }
    await say('TOMMY', QTE_LINES[r](word), { wait: 500 });

    const q = QS[i];
    await sleep(scope, 200);
    const a = await ask(q);
    onEvent?.({ type: 'answer', slide: i, from: q.from, text: a.text });
    if (a === TIMEOUT_ANSWER) await say('', TIMEOUT_ANSWER.line, { cps: 60, wait: 300 });
    else await say('TOMMY', a.text, { cps: 70, wait: 200, speak: a.speak });
    apply(a.fx, a.react);
    await sleep(scope, 1700);
  }
  sub.classList.remove('is-on');

  // ---------- finale
  const avg = KEYS.reduce((s, k) => s + S.interest[k], 0) / 3;
  const score = Math.round(clamp(avg * 0.4 + S.cred * 0.3 + S.hype * 0.3));
  const tier = score >= 62 ? 'ovation' : score >= 45 ? 'polite' : 'crickets';
  if (tier === 'ovation') { sfx(audio, 'crowd_cheer'); sfx(audio, 'applause'); cheer = 1; flash(16); confetti(scope, stage); }
  else if (tier === 'polite') { sfx(audio, 'applause'); cheer = 0.45; flash(5); }
  else { sfx(audio, 'mission_failed'); }
  const banner = h('div', { class: `pt-final pt-final--${tier}` }, { ovation: 'STANDING OVATION', polite: 'POLITE APPLAUSE', crickets: '*crickets* 🦗' }[tier]);
  stage.append(banner);
  await sleep(scope, 1800);
  banner.classList.add('is-out');

  const result = {
    score, hype: Math.round(S.hype), credibility: Math.round(S.cred),
    interest: Object.fromEntries(KEYS.map(k => [k, Math.round(S.interest[k])])),
    quotes: S.quotes.slice(-8),
  };
  onEvent?.({ type: 'pitch_done', score });

  const card = h('div', { class: 'pt-sum' },
    h('div', { class: 'pt-sum-head' },
      h('div', null, h('div', { class: 'pt-sum-k' }, 'PITCH COMPLETE'), h('div', { class: 'pt-sum-t' }, ideaName)),
      h('div', { class: 'pt-sum-score' }, h('b', null, String(score)), h('small', null, 'PITCH SCORE'))),
    h('div', { class: 'pt-sum-bars' },
      sumBar('Hype', result.hype, '#ff3ea5'), sumBar('Credibility', result.credibility, '#26e0ff')),
    h('div', { class: 'pt-sum-inv' }, KEYS.map(k => h('div', { class: 'sum-inv', style: { '--c': INVESTORS[k].color } },
      h('div', { class: `sum-ava mood-${result.interest[k] >= 70 ? 'happy' : result.interest[k] >= 45 ? 'neutral' : 'sad'}`, html: PORTRAITS[k]() }),
      h('div', { class: 'sum-txt' },
        h('div', { class: 'sum-name' }, INVESTORS[k].name, h('span', null, ` · ${INVESTORS[k].firm}`)),
        h('div', { class: 'sum-v' }, verdict(k, result.interest[k]))),
      h('div', { class: 'sum-n' }, String(result.interest[k]))))),
    h('button', { class: 'mg-btn mg-btn--primary mg-btn--big', onclick: () => fin() }, 'Continue  ▸'));
  const wrap = h('div', { class: 'pt-sum-wrap' }, card);
  stage.append(wrap);
  requestAnimationFrame(() => card.classList.add('is-in'));
  card.querySelector('button').focus();
  // the three verdicts, read out in turn (Continue cuts them off)
  (async () => { for (const k of KEYS) { const p = voice(audio, ROLE_OF[k], verdict(k, result.interest[k]), { interrupt: false }); if (p) await p; await sleep(scope, 250); } })().catch(() => {});
  let fin;
  await new Promise(res => {
    fin = () => { if (scope.paused) return; sfx(audio, 'ui_select'); audio?.voice?.stopDialogue?.(); res(); };
    const onKey = e => { if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); fin(); } };
    window.addEventListener('keydown', onKey, true);
    scope.add(() => window.removeEventListener('keydown', onKey, true));
  });
  return result;
}

const sumBar = (label, v, c) => h('div', { class: 'sum-bar', style: { '--c': c } }, h('span', null, label), h('div', null, h('i', { style: { width: `${v}%` } })), h('b', null, String(v)));

function slideBody(s, idea) {
  switch (s.kind) {
    case 'problem': return h('div', { class: 'sl-body sl-split' },
      h('div', { class: 'sl-hero' }, h('div', { class: 'sl-icon' }, s.icon), h('div', { class: 'sl-stat' }, s.stat), h('div', { class: 'sl-stat-l' }, s.statLabel)),
      h('div', null, h('div', { class: 'sl-h' }, s.headline), h('ul', { class: 'sl-ul' }, s.bullets.map(b => h('li', null, b))), h('div', { class: 'sl-foot' }, s.foot)));
    case 'solution': return h('div', { class: 'sl-body sl-split' },
      h('div', { class: 'sl-phone' }, h('div', { class: 'ph-notch' }), h('div', { class: 'ph-k' }, s.phone[0]), h('div', { class: 'ph-s' }, s.phone[1]), h('div', { class: 'ph-big' }, s.phone[2]), h('div', { class: 'ph-s' }, s.phone[3]), h('div', { class: 'ph-btn' }, 'OK LAH')),
      h('div', null, h('div', { class: 'sl-h' }, s.headline), h('ol', { class: 'sl-ol' }, s.bullets.map(b => h('li', null, b)))));
    case 'traction': return h('div', { class: 'sl-body sl-split sl-split--wide' },
      h('div', { class: 'sl-chart' }, h('canvas')),
      h('div', null, h('div', { class: 'sl-h sl-h--big' }, s.headline), h('ul', { class: 'sl-ul' }, s.bullets.map(b => h('li', null, b))), h('div', { class: 'sl-foot' }, s.foot)));
    case 'model': return h('div', { class: 'sl-body sl-split' },
      h('div', { class: 'sl-chart sl-chart--pie' }, h('canvas')),
      h('div', null, h('div', { class: 'sl-h' }, s.headline), h('ul', { class: 'sl-legend' }, s.pie.map(([l, v], i) => h('li', null, h('i', { style: { background: PIE_COLS[i] } }), `${l}`, h('b', null, `${v}%`))))));
    case 'ask': return h('div', { class: 'sl-body' },
      h('div', { class: 'sl-ask' }, s.headline),
      h('div', { class: 'sl-funds' }, s.funds.map(([l, v, c]) => h('div', { class: 'fund' }, h('span', null, l), h('div', null, h('i', { style: { '--w': `${v * 2.2}%`, background: c } })), h('b', null, `${v}%`)))));
  }
  return h('div');
}

const PIE_COLS = ['#ff3ea5', '#26e0ff', '#ffd23f', '#7cff6b'];

function drawChart(scope, cv, s) {
  const ctx = cv.getContext('2d');
  let t = 0;
  scope.loop(dt => {
    if (!cv.isConnected) return false;
    const d = MG_DPR, W = cv.clientWidth * d, H = cv.clientHeight * d;
    if (!W || !H) return;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    t = Math.min(1, t + dt / 1.4);
    const e = 1 - Math.pow(1 - t, 3);
    ctx.clearRect(0, 0, W, H);
    if (s.kind === 'traction') {
      const pad = 34 * d, x0 = pad, y0 = H - pad, x1 = W - 12 * d, y1 = 14 * d;
      ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = d;
      for (let i = 0; i <= 4; i++) { const y = y0 - (y0 - y1) * i / 4; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }
      ctx.fillStyle = 'rgba(233,230,255,.55)'; ctx.font = `${11 * d}px Barlow Condensed, sans-serif`; ctx.textAlign = 'center';
      const months = ['JUL', 'AUG', 'SEP', 'OCT', 'NOV*'];
      months.forEach((m, i) => ctx.fillText(m, x0 + (x1 - x0) * i / 4, y0 + 18 * d));
      const pts = [];
      const N = 60;
      for (let i = 0; i <= N * e; i++) {
        const f = i / N;
        const v = Math.pow(f, 3.2) * 0.92 + 0.04 + Math.sin(f * 30) * 0.008;
        pts.push([x0 + (x1 - x0) * f, y0 - (y0 - y1) * v]);
      }
      if (pts.length > 1) {
        const g = ctx.createLinearGradient(0, y1, 0, y0);
        g.addColorStop(0, 'rgba(255,62,165,.45)'); g.addColorStop(1, 'rgba(255,62,165,0)');
        ctx.beginPath(); ctx.moveTo(pts[0][0], y0); pts.forEach(p => ctx.lineTo(p[0], p[1])); ctx.lineTo(pts[pts.length - 1][0], y0); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
        ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
        ctx.strokeStyle = '#ff3ea5'; ctx.lineWidth = 3.5 * d; ctx.shadowColor = '#ff3ea5'; ctx.shadowBlur = 16 * d; ctx.stroke(); ctx.shadowBlur = 0;
        const last = pts[pts.length - 1];
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(last[0], last[1], 5 * d, 0, Math.PI * 2); ctx.fill();
        if (e > 0.98) {
          ctx.fillStyle = '#ffd23f'; ctx.font = `bold ${15 * d}px Barlow Condensed, sans-serif`; ctx.textAlign = 'right';
          ctx.fillText(`${s.users.toLocaleString('en-SG')} ↗`, last[0] - 10 * d, last[1] + 4 * d);
        }
      }
    } else if (s.kind === 'model') {
      const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.42;
      let a0 = -Math.PI / 2;
      s.pie.forEach(([, v], i) => {
        const a1 = a0 + (v / 100) * Math.PI * 2 * e;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath();
        ctx.fillStyle = PIE_COLS[i]; ctx.shadowColor = PIE_COLS[i]; ctx.shadowBlur = 12 * d; ctx.fill(); ctx.shadowBlur = 0;
        a0 = a1;
      });
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2); ctx.fillStyle = '#140c33'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `${22 * d}px Anton, Impact, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('40%', cx, cy + 4 * d);
      ctx.font = `${10 * d}px Barlow Condensed, sans-serif`; ctx.fillStyle = 'rgba(233,230,255,.6)'; ctx.fillText('MARGIN*', cx, cy + 18 * d);
    }
    if (t >= 1 && s.kind !== 'traction') return false;
  });
}
