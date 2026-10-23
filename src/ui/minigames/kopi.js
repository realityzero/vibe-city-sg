// "Kopi Uncle": decode kopitiam lingo shouted by customers and build each drink before they walk out.
import { h, mountShell, runShell, clamp, pick, sleep, sfx } from './common.js';
import { PORTRAITS } from './portraits.js';
import { nameOf, english, nameTerms, englishParts, LINES, complain } from './kopi-lingo.js';
import { playSeq, kopiTermKey, kopiPhraseKey } from '../../missions/vodyn.js';
export { nameOf };

const DURATION = 90;
const BASES = [['kopi', 'Kopi', 'Q'], ['teh', 'Teh', 'W'], ['milo', 'Milo', 'E'], ['cham', 'Yuan Yang', 'R']];
const MILKS = [['condensed', 'Condensed', 'A'], ['none', 'None (-O)', 'S'], ['evap', 'Evaporated (-C)', 'D']];
const SUGARS = [[0, 'Kosong', 'Z'], [1, 'Siew dai', 'X'], [2, 'Normal', 'C'], [3, 'Ga dai', 'V']];
const STRENGTHS = [['po', 'Po (weak)', '1'], ['normal', 'Normal', '2'], ['gao', 'Gao (strong)', '3']];
const fresh = () => ({ base: null, milk: 'condensed', sugar: 2, strength: 'normal', ice: false, extra: 'none', dabao: false });

function genOrder(level) {
  const r = Math.random;
  const d = fresh();
  const x = r();
  d.base = x < 0.45 ? 'kopi' : x < 0.8 ? 'teh' : x < 0.93 ? 'milo' : 'cham';
  let mods = 0;
  const cap = 1 + Math.min(3, level);
  const maybe = (p, fn) => { if (mods < cap && r() < p) { fn(); mods++; } };
  if (d.base === 'kopi' || d.base === 'teh') {
    const m = r();
    d.milk = m < 0.45 ? 'condensed' : m < 0.75 ? 'none' : 'evap';
    if (d.base === 'teh' && d.milk === 'condensed' && r() < 0.35) { d.extra = 'tarik'; mods++; }
    if (d.extra !== 'tarik') maybe(0.25 + level * 0.08, () => { d.strength = r() < 0.7 ? 'gao' : 'po'; });
  }
  if (d.base === 'milo' && r() < 0.45) { d.extra = 'dino'; d.ice = true; mods++; }
  maybe(0.55, () => { d.sugar = pick([0, 0, 1, 1, 3]); });
  if (d.extra !== 'dino') maybe(0.35 + level * 0.05, () => { d.ice = true; });
  if (level >= 1) maybe(0.15, () => { d.dabao = true; });
  return d;
}

const FIELDS = ['base', 'milk', 'sugar', 'strength', 'ice', 'extra', 'dabao'];
const diff = (a, b) => FIELDS.filter(f => a[f] !== b[f]);

const CUSTOMERS = [
  // voice: the voice-over role (src/audio/cast.js) that orders and reacts — pre-rendered clips, see missions/vodyn.js
  { name: 'Auntie Lim', emoji: '👵', style: 'lingo', col: '#ff8fb1', voice: 'auntie' },
  { name: 'Uncle Tan', emoji: '👴', style: 'lingo', col: '#ffd23f', voice: 'uncle' },
  { name: 'Office Lady', emoji: '👩‍💼', style: 'lingo', col: '#26e0ff', voice: 'auntie' },
  { name: 'Raffles Place Banker', emoji: '👨‍💼', style: 'lingo', col: '#7cff6b', voice: 'uncle' },
  { name: 'NSF on book-out', emoji: '🫡', style: 'lingo', col: '#9bd17a', voice: 'uncle' },
  { name: 'Construction Worker', emoji: '👷', style: 'lingo', col: '#ffb347', voice: 'uncle' },
  { name: 'Poly Student', emoji: '🧑‍🎓', style: 'lingo', col: '#b388ff', voice: 'uncle' },
  { name: 'Tourist (first day)', emoji: '🧔', style: 'english', col: '#ff7a7a', intro: 'Uh, hi! I don\'t know the words, sorry —', voice: 'touristm' },
  { name: 'Tourist w/ selfie stick', emoji: '👱‍♀️', style: 'english', col: '#ff7a7a', intro: 'Hello! Can I get —', voice: 'tourist' },
];
const VIPS = [
  { name: 'Priya · Merlion Ventures', portrait: 'merlion', style: 'lingo', col: '#26e0ff', voice: 'priya', fixed: { base: 'teh', milk: 'none', sugar: 0 }, intro: 'I\'m watching my burn rate.' },
  { name: 'Chad · Sandhill Partners', portrait: 'sandhill', style: 'english', col: '#ffb347', voice: 'chad', fixed: { base: 'kopi', milk: 'none', strength: 'gao', ice: true }, intro: 'Do you have oat milk? No? Cool, cool. Just —' },
  { name: 'Auntie Mei · investor', portrait: 'auntie', style: 'lingo', col: '#ff3ea5', voice: 'auntiemei', fixed: { base: 'kopi', strength: 'gao', sugar: 1 }, intro: 'Faster ah, I\'m an investor.' },
  { name: 'Ken Rosenberg', portrait: 'ken', style: 'english', col: '#ffd23f', voice: 'ken', fixed: { base: 'kopi', milk: 'evap', sugar: 3, dabao: true }, intro: 'TOMMY?! You work here now?! Okay, okay —' },
];

/**
 * @param {HTMLElement} root
 * @param {{audio?, round?: number, onEvent?, signal?: AbortSignal, duration?: number, debug?: boolean}} opts
 * @returns {Promise<{score, served, mistakes, tips}>}
 */
export function runKopiOrder(root, opts = {}) {
  const ctx = mountShell(root, { kind: 'kopi', signal: opts.signal, onEvent: opts.onEvent });
  return runShell(play(ctx, opts), ctx);
}

async function play(ctx, opts) {
  const { scope, shell } = ctx;
  const { audio, onEvent } = opts;
  const round = Math.max(1, opts.round ?? 1);
  const duration = opts.duration ?? DURATION;
  const S = { t: 0, left: duration, served: 0, perfect: 0, partial: 0, mistakes: 0, walkouts: 0, tips: 0, points: 0, queue: [], target: null, drink: fresh(), started: false, over: false, vipsUsed: new Set() };
  const level = () => Math.min(3, round - 1 + Math.floor(S.t / 30));

  // ---------- DOM
  const timerB = h('b', null, '1:30');
  const tipsB = h('b', null, 'S$ 0.00');
  const servedB = h('b', null, '0');
  const missB = h('b', null, '0');
  const head = h('div', { class: 'kp-head' },
    h('div', { class: 'kp-sign' }, h('span', { class: 'kp-sign-zh' }, '亚成咖啡'), h('span', null, 'AH SENG KOPI'), h('small', null, 'Stall #01-23 · since 1979')),
    h('div', { class: 'kp-clock' }, h('small', null, 'LUNCH RUSH'), timerB),
    h('div', { class: 'kp-stats' }, h('div', null, h('small', null, 'TIPS'), tipsB), h('div', null, h('small', null, 'SERVED'), servedB), h('div', null, h('small', null, 'MISTAKES'), missB)));
  const queueEl = h('div', { class: 'kp-queue' });

  const cup = h('div', { class: 'kp-cup' });
  const ticketName = h('div', { class: 'kp-ticket-n' }, '…');
  const forWho = h('div', { class: 'kp-ticket-for' }, '');
  const station = h('div', { class: 'kp-station' },
    h('div', { class: 'kp-station-h' }, 'KOPI STATION', h('small', null, 'kopi sock · condensed milk tin · 40 years of Ah Seng\'s elbow grease')),
    h('div', { class: 'kp-cupwrap' }, cup),
    h('div', { class: 'kp-ticket' }, h('small', null, 'YOUR DRINK'), ticketName, forWho),
    h('div', { class: 'kp-acts' },
      h('button', { class: 'mg-btn', onclick: () => trash() }, 'Trash ', h('kbd', null, '⌫')),
      h('button', { class: 'mg-btn mg-btn--primary mg-btn--big', onclick: () => serve() }, 'Serve ', h('kbd', null, 'SPACE'))));

  const groups = {};
  const group = (title, key, items, set) => {
    const btns = items.map(([v, label, k]) => h('button', { class: 'kp-opt', onclick: () => { set(v); }, onmouseenter: () => sfx(audio, 'ui_hover') }, h('kbd', null, k), label));
    groups[key] = { btns, items };
    return h('div', { class: 'kp-group' }, h('div', { class: 'kp-gt' }, title), h('div', { class: 'kp-opts' }, btns));
  };
  const setF = (f, v) => {
    if (S.over) return;
    S.drink[f] = v;
    if (f === 'extra' && v === 'dino') S.drink.ice = true;   // a Milo dinosaur is always iced
    sfx(audio, 'keyclick'); renderDrink();
  };
  const toggle = (f, on, off = false) => setF(f, S.drink[f] === on ? off : on);
  const extrasEl = h('div', { class: 'kp-group' }, h('div', { class: 'kp-gt' }, 'EXTRAS'), h('div', { class: 'kp-opts' },
    h('button', { class: 'kp-opt kp-t-ice', onclick: () => toggle('ice', true) }, h('kbd', null, 'F'), '🧊 Peng (ice)'),
    h('button', { class: 'kp-opt kp-t-tarik', onclick: () => toggle('extra', 'tarik', 'none') }, h('kbd', null, 'T'), '🫗 Tarik (pull)'),
    h('button', { class: 'kp-opt kp-t-dino', onclick: () => { toggle('extra', 'dino', 'none'); } }, h('kbd', null, 'G'), '🦕 Dinosaur'),
    h('button', { class: 'kp-opt kp-t-bao', onclick: () => toggle('dabao', true) }, h('kbd', null, 'B'), '🛍️ Da bao')));
  const sheet = h('div', { class: 'kp-sheet' }, ...GLOSSARY.map(([k, v]) => h('div', { class: 'kp-gl' }, h('b', null, k), h('span', null, v))));
  const sheetBtn = h('button', { class: 'kp-sheet-btn', onclick: () => toggleSheet() }, '📖 Cheat sheet ', h('kbd', null, 'H'));
  const panel = h('div', { class: 'kp-panel' },
    h('div', { class: 'kp-panel-h' }, h('span', null, 'BUILD THE DRINK'), sheetBtn),
    group('BASE', 'base', BASES, v => setF('base', v)),
    group('MILK', 'milk', MILKS, v => setF('milk', v)),
    group('SUGAR', 'sugar', SUGARS, v => setF('sugar', v)),
    group('STRENGTH', 'strength', STRENGTHS, v => setF('strength', v)),
    extrasEl, sheet);
  const toggleSheet = () => { panel.classList.toggle('is-sheet'); sfx(audio, 'ui_select'); };
  const menu = h('div', { class: 'kp-menu' }, [['KOPI', '1.40'], ['KOPI-O', '1.20'], ['KOPI-C', '1.50'], ['TEH', '1.40'], ['TEH TARIK', '1.80'], ['MILO', '1.80'], ['MILO DINO', '3.00'], ['YUAN YANG', '1.60'], ['PENG', '+0.20'], ['DA BAO', '+0.20']].map(([n, p]) => h('span', null, n, h('b', null, p))));
  const stage = h('div', { class: 'kp' }, h('div', { class: 'kp-bg' }), menu, head, queueEl, h('div', { class: 'kp-bottom' }, station, panel));
  shell.append(stage);

  // ---------- rendering
  const renderDrink = () => {
    const d = S.drink;
    for (const [key, g] of Object.entries(groups)) g.btns.forEach((b, i) => b.classList.toggle('is-on', g.items[i][0] === d[key]));
    extrasEl.querySelector('.kp-t-ice').classList.toggle('is-on', d.ice);
    extrasEl.querySelector('.kp-t-tarik').classList.toggle('is-on', d.extra === 'tarik');
    extrasEl.querySelector('.kp-t-dino').classList.toggle('is-on', d.extra === 'dino');
    extrasEl.querySelector('.kp-t-bao').classList.toggle('is-on', d.dabao);
    ticketName.textContent = d.base ? nameOf(d) : 'pick a base: Kopi / Teh / Milo / Yuan Yang';
    ticketName.classList.toggle('is-empty', !d.base);
    cup.replaceChildren(drinkVisual(d));
    cup.className = `kp-cup ${d.dabao ? 'is-bag' : d.ice || d.extra === 'dino' ? 'is-glass' : 'is-hot'}`;
  };
  const renderTarget = () => {
    for (const c of S.queue) c.el.classList.toggle('is-target', c === S.target);
    forWho.textContent = S.target ? `for ${S.target.who.name}` : 'no customer selected';
  };

  // ---------- customers
  const addCustomer = () => {
    if (S.over) return;
    let who = null;
    const vip = VIPS.filter(v => !S.vipsUsed.has(v.name));
    if (S.t > 12 && vip.length && Math.random() < 0.22) { who = pick(vip); S.vipsUsed.add(who.name); }
    else who = pick(CUSTOMERS);
    const want = who.fixed ? Object.assign(fresh(), who.fixed) : genOrder(level());
    const lingo = who.style === 'lingo' || (who.style === 'english' && level() >= 3 && Math.random() < 0.3);
    const said = lingo ? `${nameOf(want)}${pick(['!', '.', ', thank you!', ' ah!', ' — faster hor!'])}` : english(want);
    const patience = Math.max(11, 24 - level() * 3 - (who.portrait ? 3 : 0));
    const fill = h('i');
    const bubble = h('div', { class: 'kp-bubble' }, who.intro ? h('small', null, who.intro) : null, h('b', null, `“${said}”`));
    const ava = who.portrait ? h('div', { class: 'kp-ava kp-ava--p mood-neutral', html: PORTRAITS[who.portrait]() }) : h('div', { class: 'kp-ava' }, h('span', null, who.emoji));
    const el = h('div', { class: 'kp-cust', style: { '--c': who.col } }, bubble, ava, h('div', { class: 'kp-cname' }, who.name), h('div', { class: 'kp-pat' }, fill));
    const c = { who, want, said, patience, left: patience, el, fill, ava };
    el.addEventListener('click', () => { if (!S.over) { S.target = c; sfx(audio, 'ui_select'); renderTarget(); } });
    S.queue.push(c);
    queueEl.append(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    if (!S.target) S.target = c;
    renderTarget();
    onEvent?.({ type: 'customer', name: who.name, order: nameOf(want) });
    // say it: intro, then the order as pre-rendered term clips ("Kopi-C, siew dai, peng!") or English phrases; never
    // over another customer (interrupt: false)
    const terms = lingo ? nameTerms(want) : englishParts(want);
    const clips = terms.map((t, i) => (lingo ? kopiTermKey : kopiPhraseKey)(t, i === terms.length - 1));
    (async () => { if (who.intro && !(await playSeq(audio, who.voice, [who.intro], { interrupt: false }))) return; await playSeq(audio, who.voice, clips, { interrupt: false }); })();
  };
  const removeCustomer = (c, cls, line, mood, spoken = []) => {
    if (spoken.length) playSeq(audio, c.who.voice, spoken, { interrupt: false });
    S.queue = S.queue.filter(x => x !== c);
    if (S.target === c) S.target = S.queue[0] || null;
    const say = h('div', { class: `kp-react ${cls}` }, line);
    c.el.append(say);
    c.el.classList.remove('is-target');
    c.el.classList.add('is-leaving', cls);
    if (c.ava.classList.contains('kp-ava--p')) c.ava.className = `kp-ava kp-ava--p mood-${mood}`;
    scope.timeout(() => c.el.remove(), 1500);
    renderTarget();
  };

  // ---------- actions
  const trash = () => { if (S.over) return; S.drink = fresh(); sfx(audio, 'bug_squash'); renderDrink(); };
  const serve = () => {
    if (S.over || !S.started) return;
    const c = S.target;
    if (!c) { flashMsg('No customer selected — click someone in the queue.'); return; }
    if (!S.drink.base) { flashMsg('Make something first, uncle!'); return; }
    const wrong = diff(S.drink, c.want);
    S.served++;
    if (wrong.length === 0) {
      const tip = 0.3 + 0.7 * (c.left / c.patience);
      S.tips += tip; S.points += 10 + Math.round(4 * c.left / c.patience); S.perfect++;
      const r = LINES.vipPerfect[c.who.name] || pick(LINES.perfect);
      removeCustomer(c, 'is-good', `${r}  +S$${tip.toFixed(2)}`, 'happy', [r]);
      sfx(audio, 'cash_register');
    } else if (wrong.length === 1) {
      S.tips += 0.1; S.points += 5; S.partial++;
      const r = pick(LINES.partial), why = complain(wrong[0], c.want);
      removeCustomer(c, 'is-meh', `${r} (${why})`, 'neutral', [r, why]);
      sfx(audio, 'checkpoint');
    } else {
      S.mistakes++; S.points -= 3;
      const why = complain(wrong[0], c.want), r = pick(LINES.bad);
      removeCustomer(c, 'is-bad', `${why} ${r}`, 'sad', [why, r]);
      sfx(audio, 'mission_failed');
      stage.classList.remove('shake'); void stage.offsetWidth; stage.classList.add('shake');
    }
    onEvent?.({ type: 'serve', want: nameOf(c.want), made: nameOf(S.drink), wrong });
    S.drink = fresh();
    renderDrink(); hud();
  };
  let msgT = null;
  const msgEl = h('div', { class: 'kp-msg' });
  stage.append(msgEl);
  const flashMsg = t => { msgEl.textContent = t; msgEl.classList.add('is-on'); msgT?.(); msgT = scope.timeout(() => msgEl.classList.remove('is-on'), 1600); };
  const hud = () => {
    tipsB.textContent = `S$ ${S.tips.toFixed(2)}`; servedB.textContent = String(S.served); missB.textContent = String(S.mistakes);
    timerB.textContent = `${Math.floor(S.left / 60)}:${String(Math.floor(S.left % 60)).padStart(2, '0')}`;
    timerB.parentElement.classList.toggle('is-urgent', S.left < 15);
  };

  // ---------- keyboard
  const KEYMAP = {};
  for (const [v, , k] of BASES) KEYMAP[k.toLowerCase()] = () => setF('base', v);
  for (const [v, , k] of MILKS) KEYMAP[k.toLowerCase()] = () => setF('milk', v);
  for (const [v, , k] of SUGARS) KEYMAP[k.toLowerCase()] = () => setF('sugar', v);
  for (const [v, , k] of STRENGTHS) KEYMAP[k] = () => setF('strength', v);
  Object.assign(KEYMAP, { f: () => toggle('ice', true), t: () => toggle('extra', 'tarik', 'none'), g: () => toggle('extra', 'dino', 'none'), b: () => toggle('dabao', true), h: () => toggleSheet() });
  const onKey = e => {
    if (scope.paused || e.repeat || S.over) return;
    if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); if (S.started) serve(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); trash(); return; }
    if (e.key === 'Tab' && S.queue.length) { e.preventDefault(); const i = S.queue.indexOf(S.target); S.target = S.queue[(i + 1) % S.queue.length]; renderTarget(); return; }
    const fn = KEYMAP[e.key.toLowerCase()];
    if (fn && S.started) { e.preventDefault(); fn(); }
  };
  window.addEventListener('keydown', onKey, true);
  scope.add(() => window.removeEventListener('keydown', onKey, true));

  renderDrink(); hud();
  if (opts.debug) window.__kopi = { S, serve, setF, nameOf };

  // ---------- intro
  await new Promise(resolve => {
    const go = () => { if (scope.paused) return; window.removeEventListener('keydown', k, true); card.remove(); resolve(); };
    const k = e => { if ((e.code === 'Space' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); e.stopPropagation(); go(); } };
    const card = h('div', { class: 'kp-intro' }, h('div', { class: 'kp-intro-c' },
      h('div', { class: 'pt-intro-k' }, 'SIDE GIG · KOPI UNCLE'),
      h('div', { class: 'kp-intro-t' }, 'Ah Seng needs a hand'),
      h('p', null, 'Uncle Ah Seng went to buy 4D. You\'re on the kopi station for the lunch rush. Customers shout their orders in kopitiam lingo — build each drink exactly right, before they walk out.'),
      h('ul', { class: 'pt-intro-l' },
        h('li', null, h('b', null, 'Kopi'), ' = coffee + condensed milk · ', h('b', null, '-O'), ' = no milk · ', h('b', null, '-C'), ' = evaporated milk'),
        h('li', null, h('b', null, 'Kosong'), ' no sugar · ', h('b', null, 'Siew dai'), ' less · ', h('b', null, 'Ga dai'), ' more · ', h('b', null, 'Peng'), ' iced · ', h('b', null, 'Gao'), ' strong'),
        h('li', null, 'Click a customer (or ', h('kbd', null, 'TAB'), ') to choose who you\'re serving. ', h('kbd', null, 'H'), ' opens the cheat sheet.')),
      h('button', { class: 'mg-btn mg-btn--primary mg-btn--big', onclick: go }, 'Open the stall  ▸')));
    stage.append(card);
    window.addEventListener('keydown', k, true);
    scope.add(() => window.removeEventListener('keydown', k, true));
  });
  S.started = true;
  addCustomer();
  scope.timeout(addCustomer, 2500);

  // ---------- loop
  let spawnIn = 5;
  const done = new Promise(resolve => {
    scope.loop(dt => {
      if (S.over) return false;
      S.t += dt; S.left = Math.max(0, duration - S.t);
      spawnIn -= dt;
      const maxQ = 3 + (level() >= 2 ? 1 : 0);
      if (spawnIn <= 0) { spawnIn = Math.max(2.4, 5.6 - level() * 0.9) + Math.random() * 1.5; if (S.queue.length < maxQ) addCustomer(); }
      if (!S.queue.length && spawnIn > 1) spawnIn = 1;
      for (const c of [...S.queue]) {
        c.left -= dt;
        c.fill.style.width = `${Math.max(0, c.left / c.patience) * 100}%`;
        c.el.classList.toggle('is-angry', c.left < c.patience * 0.3);
        if (c.left <= 0) { S.walkouts++; S.mistakes++; S.points -= 5; const r = pick(LINES.walk); removeCustomer(c, 'is-bad', r, 'sad', [r]); sfx(audio, 'mission_failed'); }
      }
      hud();
      if (S.left <= 0) { S.over = true; resolve(); return false; }
    });
  });
  await done;

  // ---------- results
  const score = Math.round(clamp(S.points / 1.3));
  const result = { score, served: S.served, mistakes: S.mistakes, tips: +S.tips.toFixed(2) };
  onEvent?.({ type: 'kopi_done', ...result });
  sfx(audio, score >= 60 ? 'applause' : 'checkpoint');
  const verdict = score >= 85 ? 'Ah Seng is offering you the stall. And his daughter\'s hand. (You declined both.)' : score >= 60 ? '"Not bad for an ang moh-ish fella." — Ah Seng' : score >= 35 ? '"Next time I go buy 4D, I close the stall." — Ah Seng' : '"You are banned from kopitiams island-wide." — Ah Seng';
  const card = h('div', { class: 'ng-res is-kp' },
    h('div', { class: 'ng-res-k' }, 'STALL CLOSED'),
    h('div', { class: 'ng-res-big' }, `S$ ${S.tips.toFixed(2)}`, h('small', null, 'IN TIPS')),
    h('div', { class: 'ng-res-grid' },
      h('div', null, h('b', null, String(score)), h('small', null, 'score')),
      h('div', null, h('b', null, String(S.perfect)), h('small', null, 'perfect drinks')),
      h('div', null, h('b', null, String(S.served)), h('small', null, 'served')),
      h('div', null, h('b', null, String(S.mistakes)), h('small', null, 'mistakes'))),
    h('div', { class: 'ng-res-q' }, verdict),
    h('button', { class: 'mg-btn mg-btn--primary mg-btn--big' }, 'Continue  ▸'));
  const wrap = h('div', { class: 'ng-res-wrap' }, card);
  stage.append(wrap);
  requestAnimationFrame(() => card.classList.add('is-in'));
  await new Promise(resolve => {
    const fin = () => { if (scope.paused) return; sfx(audio, 'ui_select'); resolve(); };
    card.querySelector('button').onclick = fin;
    const k = e => { if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); fin(); } };
    scope.timeout(() => { window.addEventListener('keydown', k, true); scope.add(() => window.removeEventListener('keydown', k, true)); }, 600);
  });
  return result;
}

const LIQ = { kopi: [62, 34, 16], teh: [168, 82, 30], milo: [98, 58, 32], cham: [118, 62, 30] };
function liquidColor(d) {
  let [r, g, b] = LIQ[d.base] || [120, 90, 60];
  const mix = (c, k) => { r += (c[0] - r) * k; g += (c[1] - g) * k; b += (c[2] - b) * k; };
  if (d.milk === 'none') { r *= 0.62; g *= 0.55; b *= 0.5; }
  if (d.milk === 'condensed') mix([232, 205, 160], d.base === 'milo' ? 0.2 : 0.36);
  if (d.milk === 'evap') mix([236, 226, 206], 0.3);
  if (d.strength === 'gao') { r *= 0.8; g *= 0.78; b *= 0.76; }
  if (d.strength === 'po') mix([210, 170, 120], 0.25);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function drinkVisual(d) {
  const has = !!d.base;
  const col = has ? liquidColor(d) : 'transparent';
  const vessel = d.dabao ? 'bag' : d.ice || d.extra === 'dino' ? 'glass' : 'hot';
  const liquid = h('div', { class: `kp-liq ${has ? 'is-full' : ''}`, style: { '--liq': col } },
    has && d.milk === 'condensed' && !d.ice ? h('div', { class: 'kp-cm' }) : null,
    has && d.extra === 'tarik' ? h('div', { class: 'kp-foam' }) : null,
    has && (d.ice || d.extra === 'dino') ? h('div', { class: 'kp-ice' }, h('i'), h('i'), h('i'), h('i')) : null);
  return h('div', { class: `kp-v kp-v--${vessel}` },
    vessel === 'hot' ? h('div', { class: 'kp-saucer' }) : null,
    vessel === 'bag' ? h('div', { class: 'kp-string' }) : null,
    h('div', { class: 'kp-vessel' }, liquid, vessel === 'hot' ? h('div', { class: 'kp-rim' }) : null),
    vessel === 'hot' ? h('div', { class: 'kp-handle' }) : null,
    has && d.extra === 'dino' ? h('div', { class: 'kp-dino' }) : null,
    has && vessel === 'hot' ? h('div', { class: 'kp-steam' }, h('i'), h('i'), h('i')) : null,
    has && d.sugar !== 2 ? h('div', { class: 'kp-sugar' }, ['🚫 sugar', '½ sugar', '', '➕ sugar'][d.sugar]) : null);
}

export const GLOSSARY = [
  ['Kopi', 'coffee + condensed milk'], ['Teh', 'tea + condensed milk'], ['-O', 'no milk, just sugar'], ['-C', 'evaporated milk + sugar'],
  ['Kosong', 'no sugar ("zero")'], ['Siew dai', 'less sugar'], ['Ga dai', 'more sugar'], ['Peng', 'iced'],
  ['Gao', 'strong (more powder)'], ['Po', 'weak (more water)'], ['Tarik', 'tea "pulled" between jugs — frothy'], ['Milo dinosaur', 'iced Milo + a mountain of Milo powder'],
  ['Yuan Yang', 'coffee + tea mix, condensed milk'], ['Da bao / tapau', 'takeaway — in a plastic bag with a string'],
];
