// Finale: term-sheet poker with Mr. Tan of Temasick Holdings, on the Marina Bay Sands SkyPark at night.
import { h, mountShell, runShell, meter, clamp, pick, sleep, sfx, typeText, confetti, money, voice } from './common.js';
import { PORTRAITS, TOMMY_BACK } from './portraits.js';
import { playSeq, negoTermsSpeak, negoUsersSpeak } from '../../missions/vodyn.js';
// canvas pixel ratio capped at 2: a 3x phone screen would make each full-screen minigame canvas ~12 MB
const MG_DPR = Math.min(2, window.devicePixelRatio || 1);

const M = 1e6;
const ACCEPT = 60;
const LIQS = [1, 1.5, 2, 3];
const CLAUSES = [
  { id: 'durian', label: 'No durians in the office', tan: [4, -8] },
  { id: 'prorata', label: 'Investor pro-rata rights', tan: [5, -6] },
  { id: 'ken', label: 'Ken Rosenberg may not speak at board meetings', tan: [6, 0] },
  { id: 'shirts', label: 'Founder may wear Hawaiian shirts to board meetings', tan: [-3, 0] },
];

const MOVES = [
  { id: 'stare', key: '1', name: 'The Vercetti Stare', desc: 'Say nothing. For a long time.', cd: 2 },
  { id: 'flex', key: '2', name: 'Flex the Growth', desc: 'Slide the user chart across the table.', once: true },
  { id: 'crab', key: '3', name: 'Order Chilli Crab', desc: 'Nobody negotiates angry over chilli crab.', once: true },
  { id: 'ken', key: '4', name: 'Unleash Ken', desc: '47 pages of side letters. Weaponised.', cd: 3 },
  { id: 'sonny', key: '5', name: 'Mention Sonny Forelli', desc: '"My previous investor… very persistent."', once: true },
  { id: 'walk', key: '6', name: 'Walk-Away Bluff', desc: 'Stand up. Walk to the pool edge. Pray.', once: true },
];

const TAN = {
  open: ['Mr. Vercetti. Sit. The view is nice, but the numbers must be nicer.', 'We have reviewed your pitch. Let us see if your terms are as confident as your shirt.'],
  far: ['No.', 'Mr. Vercetti, this is Singapore, not Las Vegas.', 'Interesting. Wrong, but interesting.', 'My analysts are laughing. Quietly. In Excel.'],
  mid: ['Closer. Still too rich for my blood pressure.', 'We are in the same postal district now. Not the same block.', 'Hmm. Hmm hmm.'],
  near: ['Very close. One more push, maybe I say yes.', 'If my chairman were not watching, I might accept this.'],
  repeat: ['You proposed that already. I remember. I remember everything.'],
  accept: ['Deal. Welcome to the portfolio, Mr. Vercetti.', 'Agreed. Please, do not make me regret this.'],
  leave: ['I have a flight to Davos. Good luck with the tissue packets, Mr. Vercetti.', 'This meeting is over. The lift is that way.'],
  idle: ['*sips tea*', '*adjusts glasses*', '*checks a very expensive watch*', '*looks at the Flyer, then back at you*'],
};

/**
 * @param {HTMLElement} root
 * @param {{audio?, pitchResult?: {score?, hype?, credibility?, interest?, idea?, ideaName?, users?}, onEvent?, signal?: AbortSignal, debug?: boolean}} opts
 * @returns {Promise<{valuation, raised, dilution, boardSeats, liquidationPref, accepted}>}
 */
export function runNegotiation(root, opts = {}) {
  const ctx = mountShell(root, { kind: 'negotiation', signal: opts.signal, onEvent: opts.onEvent });
  return runShell(play(ctx, opts), ctx);
}

async function play(ctx, opts) {
  const { scope, shell } = ctx;
  const { audio, onEvent } = opts;
  const pr = opts.pitchResult || {};
  const score = clamp(pr.score ?? 60);
  const users = Math.max(0, pr.users ?? opts.users ?? 1500);
  const ideaName = pr.ideaName || opts.ideaName || 'Vercetti Vibe Labs';
  const idea = pr.idea || opts.idea || 'chopechain';

  // ---------- scene
  const sky = h('canvas', { class: 'ng-sky' });
  shell.append(sky);
  const skyFx = skyline(scope, sky);
  const stage = h('div', { class: 'ng' });
  shell.append(stage);

  for (;;) {
    const res = await round(ctx, stage, skyFx, { audio, onEvent, score, users, ideaName, idea, debug: opts.debug });
    if (res.retry) { stage.replaceChildren(); continue; }
    return res.result;
  }
}

async function round(ctx, stage, skyFx, { audio, onEvent, score, users, ideaName, idea, debug }) {
  const { scope } = ctx;
  const T = { raise: 10 * M, pre: 90 * M, board: 0, liq: 1, clauses: { durian: false, prorata: false, ken: false, shirts: true } };
  const tan = { patience: 100, respect: clamp(28 + score * 0.32), fairPre: 15 * M + score * 0.6 * M, bonusPre: 0, liqWeight: 1, lawyered: false };
  const used = {}; const cooldown = {};
  let turn = 0, counter = null, lastKey = '', over = false;

  const evaluate = t => {
    const maxPre = tan.fairPre * (1 + tan.respect / 220) + tan.bonusPre;
    const own = t.raise / (t.pre + t.raise);
    let A = 52;
    if (t.pre > maxPre) A -= (t.pre - maxPre) / maxPre * 160; else A += Math.min(10, (maxPre - t.pre) / maxPre * 40);
    A += own < 0.1 ? (own - 0.1) * 300 : Math.min(8, (own - 0.1) * 60);
    if (t.raise < 3 * M) A -= 12;
    if (t.raise > 25 * M) A -= 10;
    A += [-22, 4, 10, 14][t.board];
    A += (t.liq - 1) * 16 * tan.liqWeight;
    if (t.liq === 1 && !tan.lawyered) A -= 2;
    for (const c of CLAUSES) A += c.tan[t.clauses[c.id] ? 0 : 1];
    A += (tan.respect - 50) * 0.18;
    return { A, maxPre, own };
  };

  // ---------- DOM
  const head = h('div', { class: 'ng-head' },
    h('div', null, h('div', { class: 'ng-k' }, 'MISSION · TERM SHEET'), h('div', { class: 'ng-t' }, 'The SkyPark')),
    h('div', { class: 'ng-hs' }, 'MARINA BAY SANDS · LEVEL 57 · 11:42 PM'));

  const fmtM = v => `S$ ${(v / M).toFixed(v % M ? 1 : 0)}M`;
  const sliderRow = (label, key, min, max, step, hint) => {
    const out = h('b');
    const inp = h('input', { type: 'range', min: String(min / M), max: String(max / M), step: String(step / M), value: String(T[key] / M), 'aria-label': label });
    inp.addEventListener('input', () => { T[key] = +inp.value * M; sync(); sfx(audio, 'keyclick'); });
    return { el: h('div', { class: 'ts-row ts-row--slider' }, h('label', null, label, h('small', null, hint)), inp, out), inp, out };
  };
  const raiseR = sliderRow('Investment amount', 'raise', 2 * M, 30 * M, 0.5 * M, 'new money from Temasick');
  const preR = sliderRow('Pre-money valuation', 'pre', 10 * M, 150 * M, 1 * M, 'what ' + ideaName + ' is worth today');
  const seg = (label, values, fmt, key, hint) => {
    const btns = values.map(v => h('button', { class: 'seg-b', onclick: () => { T[key] = v; sync(); sfx(audio, 'keyclick'); } }, fmt(v)));
    return { el: h('div', { class: 'ts-row' }, h('label', null, label, h('small', null, hint)), h('div', { class: 'seg' }, btns)), btns, values };
  };
  const boardS = seg('Board seats (investor)', [0, 1, 2, 3], v => String(v), 'board', 'out of 5');
  const liqS = seg('Liquidation preference', LIQS, v => `${v}×`, 'liq', 'who gets paid first');
  const clauseEls = CLAUSES.map(c => {
    const box = h('input', { type: 'checkbox' });
    box.checked = T.clauses[c.id];
    box.addEventListener('change', () => { T.clauses[c.id] = box.checked; sync(); sfx(audio, 'keyclick'); if (c.id === 'durian' && box.checked && idea === 'duriandash') say('KEN', 'Tommy… our entire inventory is durians.', 'ken'); if (c.id === 'ken' && box.checked) say('KEN', 'I object! …Can I object? Am I allowed to object?', 'ken'); });
    return { c, box, el: h('label', { class: 'ts-cl' }, box, h('span', { class: 'ts-sw' }), c.label) };
  });
  const postEl = h('b'), stakeEl = h('b'), keepEl = h('b');
  const proposeBtn = h('button', { class: 'mg-btn mg-btn--primary', onclick: () => propose() }, 'Propose terms ', h('kbd', null, '↵'));
  const counterBtn = h('button', { class: 'mg-btn ng-counter-btn', disabled: true, onclick: () => acceptCounter() }, 'Accept his counter ', h('kbd', null, 'A'));
  const sheet = h('div', { class: 'ts' },
    h('div', { class: 'ts-title' }, h('div', null, h('small', null, 'STRICTLY CONFIDENTIAL · NON-BINDING*'), h('div', null, 'TERM SHEET — SERIES A')), h('div', { class: 'ts-co' }, `${ideaName}`, h('small', null, 'Vercetti Vibe Labs Pte. Ltd.'))),
    raiseR.el, preR.el, boardS.el, liqS.el,
    h('div', { class: 'ts-cls' }, clauseEls.map(c => c.el)),
    h('div', { class: 'ts-sum' }, h('div', null, h('small', null, 'Post-money'), postEl), h('div', null, h('small', null, 'Temasick stake'), stakeEl), h('div', null, h('small', null, 'Tommy & co. keep'), keepEl)),
    h('div', { class: 'ts-acts' }, counterBtn, proposeBtn),
    h('div', { class: 'ts-fine' }, '*binding the moment Mr. Tan smiles.'));

  const patM = meter('Patience', 'ng-m ng-m--pat');
  const resM = meter('Respect', 'ng-m ng-m--res');
  const tanAva = h('div', { class: 'ng-ava mood-neutral', html: PORTRAITS.mrtan() });
  const bubble = h('div', { class: 'ng-bubble' });
  const tell = h('div', { class: 'ng-tell' });
  const tanP = h('div', { class: 'ng-tan' },
    h('div', { class: 'ng-tan-top' }, tanAva, h('div', null, h('div', { class: 'ng-name' }, 'Mr. Tan'), h('div', { class: 'ng-role' }, 'Managing Director'), h('div', { class: 'ng-firm' }, 'TEMASICK HOLDINGS'))),
    patM.el, resM.el, bubble, tell);

  const moveEls = MOVES.map(m => {
    const cdEl = h('span', { class: 'mv-cd' });
    const el = h('button', { class: 'mv', onclick: () => doMove(m), onmouseenter: () => sfx(audio, 'ui_hover') },
      h('kbd', null, m.key), h('div', { class: 'mv-n' }, m.name), h('div', { class: 'mv-d' }, m.desc), cdEl);
    return { m, el, cdEl };
  });
  const moves = h('div', { class: 'ng-moves' }, h('div', { class: 'ng-moves-k' }, 'VERCETTI MOVES'), h('div', { class: 'ng-moves-row' }, moveEls.map(x => x.el)));
  const tommy = h('div', { class: 'ng-tommy', html: TOMMY_BACK });
  const subName = h('b'), subText = h('span');
  const sub = h('div', { class: 'ng-sub' }, subName, subText);
  stage.append(head, h('div', { class: 'ng-main' }, sheet, tanP), tommy, sub, moves);

  // ---------- helpers
  let subStop = null;
  scope.add(() => audio?.voice?.stopDialogue?.());
  // speak: what the voice says when it differs from the subtitle — a string, or clips played back to back
  // returns how long the voice will talk (ms; 0 without a take) so replies can wait for the speaker to finish
  const say = (who, text, cls = '', speak) => {
    const role = { TOMMY: 'tommy', KEN: 'ken' }[who];
    if (Array.isArray(speak)) playSeq(audio, role, speak); else voice(audio, role, speak ?? text);
    const dur = t => audio?.voice?.lineDuration?.(role, t) || 0;
    const talkMs = Array.isArray(speak) ? speak.reduce((a, t) => a + dur(t), 0) * 1000 + 120 + speak.length * 40 : dur(speak ?? text) * 1000;
    subName.textContent = who ? `${who}: ` : '';
    sub.className = `ng-sub is-on ${cls}`;
    subStop?.();
    typeText(scope, subText, text, 70, sub);
    subStop = scope.timeout(() => sub.classList.remove('is-on'), Math.max(3200 + text.length * 30, talkMs + 600));
    return talkMs;
  };
  let bubbleT = null;
  const tanSay = text => {
    voice(audio, 'mrtan', text);
    bubble.textContent = text; bubble.classList.add('is-on');
    bubbleT?.(); bubbleT = scope.timeout(() => bubble.classList.remove('is-on'), 3600 + text.length * 25);
  };
  const setMood = A => {
    const readable = tan.respect >= 40;
    let mood = 'neutral', t = '';
    if (!readable) t = 'His poker face is perfect. (Earn more respect to read him.)';
    else if (A >= ACCEPT) { mood = 'happy'; t = 'Tell: he relaxes and sips his tea. 🍵'; }
    else if (A >= ACCEPT - 15) { mood = 'neutral'; t = 'Tell: he taps the table. Close.'; }
    else { mood = 'sad'; t = 'Tell: his left eyebrow says "no".'; }
    tanAva.className = `ng-ava mood-${mood}`;
    tell.textContent = t;
  };
  const sync = () => {
    raiseR.inp.value = String(T.raise / M); preR.inp.value = String(T.pre / M);
    raiseR.out.textContent = fmtM(T.raise); preR.out.textContent = fmtM(T.pre);
    boardS.btns.forEach((b, i) => b.classList.toggle('is-on', boardS.values[i] === T.board));
    liqS.btns.forEach((b, i) => b.classList.toggle('is-on', liqS.values[i] === T.liq));
    clauseEls.forEach(c => { c.box.checked = T.clauses[c.c.id]; });
    const post = T.pre + T.raise, stake = T.raise / post;
    postEl.textContent = money(post); stakeEl.textContent = `${(stake * 100).toFixed(1)}%`; keepEl.textContent = `${((1 - stake) * 100).toFixed(1)}%`;
    if (counter) {
      const diff = k => counter[k] !== T[k];
      raiseR.el.classList.toggle('is-diff', diff('raise')); preR.el.classList.toggle('is-diff', diff('pre'));
      boardS.el.classList.toggle('is-diff', diff('board')); liqS.el.classList.toggle('is-diff', diff('liq'));
    }
    setMood(evaluate(T).A);
    patM.set(tan.patience); resM.set(tan.respect);
    moveEls.forEach(({ m, el, cdEl }) => {
      const dis = (m.once && used[m.id]) || (cooldown[m.id] > turn) || over;
      el.disabled = dis;
      cdEl.textContent = m.once ? (used[m.id] ? 'USED' : 'ONCE') : cooldown[m.id] > turn ? `${cooldown[m.id] - turn} turn${cooldown[m.id] - turn > 1 ? 's' : ''}` : 'READY';
    });
    stage.classList.toggle('is-tense', tan.patience < 30);
  };

  const makeCounter = () => {
    const { maxPre } = evaluate(T);
    const c = { raise: clamp(T.raise, 5 * M, 15 * M), pre: Math.max(10 * M, Math.round(Math.min(T.pre, maxPre * 0.94) / M) * M), board: Math.max(1, T.board), liq: Math.max(T.liq, tan.lawyered ? 1 : 1.5), clauses: { ...T.clauses, durian: true, prorata: true, ken: true } };
    let guard = 0;
    while (evaluate(c).A < ACCEPT + 2 && guard++ < 80) {
      if (c.pre > 12 * M) c.pre -= M; else if (c.board < 2) c.board++; else if (c.liq < 2) c.liq = c.liq === 1 ? 1.5 : 2; else break;
    }
    return c;
  };

  const sameKey = () => JSON.stringify(T);
  const propose = () => {
    if (over || scope.paused) return;
    sfx(audio, 'ui_select');
    turn++;
    const { A } = evaluate(T);
    onEvent?.({ type: 'proposal', terms: structuredClone(T), score: Math.round(A) });
    const talk = Math.random() < 1 / 3
      ? say('TOMMY', `${fmtM(T.raise)} at ${fmtM(T.pre)} pre. ${T.board} board seat${T.board === 1 ? '' : 's'}. Take it or leave it.`, '', negoTermsSpeak(T.raise, T.pre, T.board))
      : say('TOMMY', pick(['Here\'s my number. Don\'t make me say it twice.', 'Read it and weep, Mr. Tan.']));
    const reply = Math.max(900, talk + 300); // Mr. Tan lets Tommy finish
    const repeat = sameKey() === lastKey;
    lastKey = sameKey();
    if (A >= ACCEPT && !repeat) { scope.timeout(() => deal('proposal'), reply); return; }
    tan.patience = clamp(tan.patience - (repeat ? 16 : 9 + (A < 30 ? 10 : A < 50 ? 4 : 0)));
    if (A >= ACCEPT - 10) tan.respect = clamp(tan.respect + 3);
    counter = makeCounter();
    scope.timeout(() => {
      tanSay(repeat ? pick(TAN.repeat) : A < 25 ? pick(TAN.far) : A < ACCEPT - 10 ? pick(TAN.mid) : pick(TAN.near));
      counterBtn.disabled = false;
      counterBtn.innerHTML = '';
      counterBtn.append(`Accept counter: ${fmtM(counter.raise)} @ ${fmtM(counter.pre)} · ${counter.board} seat${counter.board === 1 ? '' : 's'} · ${counter.liq}× `, h('kbd', null, 'A'));
      sheet.classList.add('has-counter');
      sync(); check();
    }, reply);
    sync();
  };

  const acceptCounter = () => {
    if (over || !counter || scope.paused) return;
    Object.assign(T, structuredClone(counter));
    sync();
    const talk = say('TOMMY', 'Fine. Your terms. But I\'m keeping the shirt.');
    scope.timeout(() => deal('counter'), Math.max(900, talk + 300));
  };

  const doMove = m => {
    if (over || scope.paused) return;
    if ((m.once && used[m.id]) || cooldown[m.id] > turn) return;
    used[m.id] = true; if (m.cd) cooldown[m.id] = turn + m.cd;
    sfx(audio, 'ui_select');
    onEvent?.({ type: 'move', id: m.id });
    const el = moveEls.find(x => x.m === m).el;
    el.classList.add('is-played'); scope.timeout(() => el.classList.remove('is-played'), 700);
    switch (m.id) {
      case 'stare':
        say('', 'Tommy stares at Mr. Tan. The infinity pool laps. Nobody speaks for eleven seconds.', 'is-narr');
        tommyAnim('stare');
        if (tan.respect >= 40) { tan.respect = clamp(tan.respect + 10); tan.bonusPre += 4 * M; scope.timeout(() => tanSay('…Fine. You have conviction. I respect conviction.'), 1600); }
        else { tan.patience = clamp(tan.patience - 10); tan.respect = clamp(tan.respect + 4); scope.timeout(() => tanSay('Are you unwell, Mr. Vercetti? Should I call someone?'), 1600); }
        break;
      case 'flex': {
        const big = users >= 2000;
        const talk = say('TOMMY', `${users.toLocaleString('en-SG')} users. Look at that line, Mr. Tan. That line has never seen a down month.`, '', negoUsersSpeak(users));
        tan.respect = clamp(tan.respect + 8 + Math.min(12, users / 250)); tan.bonusPre += (big ? 6 : 2) * M;
        scope.timeout(() => tanSay(big ? 'Hmm. That is a real curve. My analysts confirm it is not drawn with a ruler.' : 'A modest curve. But it curves. I will allow it.'), Math.max(1500, talk + 300));
        break;
      }
      case 'crab':
        say('', 'A waiter arrives with two Sri Lankan crabs in chilli sauce and a basket of mantou.', 'is-narr');
        tan.patience = clamp(tan.patience + 25); tan.respect = clamp(tan.respect + 3);
        scope.timeout(() => tanSay('…You know the way to a man\'s heart, Mr. Vercetti. Continue.'), 1600);
        break;
      case 'ken': {
        const talk = say('KEN', 'Mr. Tan! Section 4.2(b)(iii) of our side letter clearly states — I wrote this on the plane — no liquidation preference above 1×!', 'ken');
        tan.lawyered = true; tan.liqWeight = 0.35; tan.patience = clamp(tan.patience - 6); tan.respect = clamp(tan.respect + 4);
        // (he cuts Ken off just before the end — that's the joke — but not mid-word)
        scope.timeout(() => tanSay('Fine. I will not die on the liquidation hill. Please make him stop talking.'), Math.max(2400, talk - 400));
        break;
      }
      case 'sonny': {
        const talk = say('TOMMY', 'My previous investor, Sonny Forelli… let\'s say he\'s very persistent about returns.');
        const ok = Math.random() < 0.5 + tan.respect / 400, wait = Math.max(1800, talk + 300);
        if (ok) { tan.respect = clamp(tan.respect + 15); tan.bonusPre += 5 * M; scope.timeout(() => tanSay('*quietly googles "Forelli"* …I see. Let us be generous today.'), wait); }
        else { tan.patience = clamp(tan.patience - 18); scope.timeout(() => tanSay('We do KYC here, Mr. Vercetti. Very, very thorough KYC.'), wait); }
        break;
      }
      case 'walk': {
        say('', 'Tommy stands, buttons nothing, and walks slowly towards the infinity pool edge…', 'is-narr');
        tommyAnim('walk');
        const p = 0.3 + tan.respect / 250 + score / 400;
        const ok = Math.random() < p;
        scope.timeout(() => {
          if (ok) { tan.bonusPre += 12 * M; tan.patience = clamp(tan.patience + 10); tan.respect = clamp(tan.respect + 10); tanSay('…Sit down, Mr. Vercetti. Let us talk properly.'); sfx(audio, 'cash_register'); }
          else { tan.patience = clamp(tan.patience - 30); tan.respect = clamp(tan.respect - 10); tanSay('The lift is that way. Mind the gap.'); }
          sync(); check();
        }, 2300);
        break;
      }
    }
    turn++;
    sync(); check();
  };

  const tommyAnim = k => { tommy.classList.remove('a-stare', 'a-walk'); void tommy.offsetWidth; tommy.classList.add(`a-${k}`); };

  let resolveRound;
  const done = new Promise(r => { resolveRound = r; });
  const check = () => {
    if (over) return;
    if (tan.patience <= 0) fail();
  };

  const deal = async how => {
    if (over) return;
    over = true; sync();
    const post = T.pre + T.raise;
    const result = { valuation: post, raised: T.raise, dilution: +(T.raise / post).toFixed(4), boardSeats: T.board, liquidationPref: T.liq, accepted: true };
    onEvent?.({ type: 'deal', how, result });
    tanAva.className = 'ng-ava mood-happy';
    tanSay(pick(TAN.accept));
    sfx(audio, 'cash_register');
    await sleep(scope, 1300);
    // signature
    const sig = h('div', { class: 'ts-sig', html: `<svg viewBox="0 0 420 110"><text x="10" y="80" class="sig-t">Tommy Vercetti</text><path class="sig-u" d="M14 92 C120 104 260 86 404 94"/></svg>` });
    const stamp = h('div', { class: 'ts-stamp' }, 'TEMASICK', h('small', null, 'APPROVED'));
    sheet.append(sig, stamp);
    sheet.classList.add('is-signed');
    await sleep(scope, 2300);
    stage.classList.add('is-closed');
    sfx(audio, 'ship_it'); sfx(audio, 'crowd_cheer');
    skyFx.fireworks(true);
    confetti(scope, stage, { count: 220, duration: 5 });
    await sleep(scope, 2200);
    const card = h('div', { class: 'ng-res' },
      h('div', { class: 'ng-res-k' }, 'SERIES A CLOSED'),
      h('div', { class: 'ng-res-big' }, money(result.raised), h('small', null, 'RAISED')),
      h('div', { class: 'ng-res-grid' },
        h('div', null, h('b', null, money(result.valuation)), h('small', null, 'post-money valuation')),
        h('div', null, h('b', null, `${(result.dilution * 100).toFixed(1)}%`), h('small', null, 'dilution')),
        h('div', null, h('b', null, String(result.boardSeats)), h('small', null, 'investor board seats')),
        h('div', null, h('b', null, `${result.liquidationPref}×`), h('small', null, 'liquidation pref'))),
      h('div', { class: 'ng-res-q' }, grade(result)),
      h('button', { class: 'mg-btn mg-btn--primary mg-btn--big', onclick: () => fin() }, 'Continue  ▸'));
    const wrap = h('div', { class: 'ng-res-wrap' }, card);
    stage.append(wrap);
    requestAnimationFrame(() => card.classList.add('is-in'));
    card.querySelector('button').focus();
    let finished = false;
    const fin = () => { if (finished || scope.paused) return; finished = true; skyFx.fireworks(false); resolveRound({ result }); };
    const onKey = e => { if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); fin(); } };
    window.addEventListener('keydown', onKey, true);
    scope.add(() => window.removeEventListener('keydown', onKey, true));
  };

  const fail = () => {
    if (over) return;
    over = true; sync();
    onEvent?.({ type: 'walkout' });
    tanAva.className = 'ng-ava mood-sad';
    tanSay(pick(TAN.leave));
    sfx(audio, 'mission_failed');
    scope.timeout(() => {
      tanP.classList.add('is-gone');
      const card = h('div', { class: 'ng-res ng-res--fail' },
        h('div', { class: 'ng-res-k' }, 'DEAL OFF'),
        h('div', { class: 'ng-res-q' }, 'Mr. Tan has left the SkyPark. The infinity pool is very quiet. Somewhere, Ken is hyperventilating into a paper bag.'),
        h('div', { class: 'ng-fail-acts' },
          h('button', { class: 'mg-btn mg-btn--primary mg-btn--big', onclick: () => retry() }, 'Call him back (try again) ', h('kbd', null, 'R')),
          h('button', { class: 'mg-btn', onclick: () => angel() }, 'Take Auntie Mei\'s angel cheque instead')));
      const wrap = h('div', { class: 'ng-res-wrap' }, card);
      stage.append(wrap);
      requestAnimationFrame(() => card.classList.add('is-in'));
      let done2 = false;
      const retry = () => { if (done2 || scope.paused) return; done2 = true; sfx(audio, 'ui_select'); resolveRound({ retry: true }); };
      const angel = () => { if (done2 || scope.paused) return; done2 = true; sfx(audio, 'ui_select'); resolveRound({ result: { valuation: 5.5 * M, raised: 0.5 * M, dilution: 0.0909, boardSeats: 0, liquidationPref: 1, accepted: false } }); };
      const onKey = e => { if (e.key.toLowerCase() === 'r' && !e.repeat) { e.preventDefault(); retry(); } };
      window.addEventListener('keydown', onKey, true);
      scope.add(() => window.removeEventListener('keydown', onKey, true));
    }, 1800);
  };

  // keyboard
  const onKey = e => {
    if (over || scope.paused) return;
    const t = e.target;
    if (e.key === 'Enter' && !e.repeat && !(t instanceof HTMLButtonElement)) { e.preventDefault(); propose(); return; }
    if (e.key.toLowerCase() === 'a' && !e.repeat && counter) { e.preventDefault(); acceptCounter(); return; }
    const mv = MOVES.find(m => m.key === e.key);
    if (mv && !e.repeat) { e.preventDefault(); doMove(mv); }
  };
  window.addEventListener('keydown', onKey, true);
  scope.add(() => window.removeEventListener('keydown', onKey, true));

  // patience drains in real time — the clock is part of the poker
  let idleT = 7;
  const stopDrain = scope.loop(dt => {
    if (over) return false;
    tan.patience = clamp(tan.patience - dt / 3.2);
    idleT -= dt;
    if (idleT <= 0) { idleT = 9 + Math.random() * 6; if (!bubble.classList.contains('is-on')) tanSay(pick(TAN.idle)); }
    patM.set(tan.patience);
    stage.classList.toggle('is-tense', tan.patience < 30);
    check();
  });
  scope.add(stopDrain);

  sync();
  scope.timeout(() => tanSay(pick(TAN.open)), 500);
  scope.timeout(() => say('', 'Drag the terms, play your moves, then propose. If his patience runs out, he walks.', 'is-narr'), 1600);
  if (debug) window.__neg = { T, tan, evaluate, propose, acceptCounter, doMove: id => doMove(MOVES.find(m => m.id === id)), sync };
  return done;
}

function grade(r) {
  const v = r.valuation, d = r.dilution;
  if (v >= 80 * M && d <= 0.15 && r.liquidationPref <= 1) return '"Mr. Tan just wrote you the cheque of the decade. Ken is crying. Happy tears. Mostly."';
  if (v >= 50 * M) return '"A respectable Series A. Sonny Forelli would be proud. Or jealous. Probably jealous."';
  return '"Not the biggest cheque in Singapore, but a cheque is a cheque. Auntie Mei approves."';
}

/** Night skyline from the SkyPark: stars, CBD towers with lit windows, the Flyer, Supertrees, bay reflections, fireworks. */
function skyline(scope, cv) {
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, bg = null, fireOn = false;
  const stars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random() * 0.5, r: Math.random() * 1.3 + 0.3, p: Math.random() * 6.28 }));
  const rockets = [], sparks = [];
  const build = () => {
    const d = MG_DPR;
    W = cv.width = cv.clientWidth * d; H = cv.height = cv.clientHeight * d;
    bg = document.createElement('canvas'); bg.width = W; bg.height = H;
    const b = bg.getContext('2d');
    const g = b.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#03041a'); g.addColorStop(0.42, '#140a3a'); g.addColorStop(0.6, '#4a1556'); g.addColorStop(0.64, '#2a0d3a'); g.addColorStop(1, '#05030e');
    b.fillStyle = g; b.fillRect(0, 0, W, H);
    const hz = H * 0.72;
    // city glow
    const glow = b.createRadialGradient(W * 0.5, hz, 0, W * 0.5, hz, W * 0.6);
    glow.addColorStop(0, 'rgba(255,120,90,.25)'); glow.addColorStop(1, 'rgba(255,120,90,0)');
    b.fillStyle = glow; b.fillRect(0, 0, W, H);
    // towers
    let x = -10 * d, seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const towers = [];
    while (x < W) {
      const tw = (18 + rnd() * 46) * d, th = (40 + Math.pow(rnd(), 1.6) * 230) * d * (x > W * 0.3 && x < W * 0.75 ? 1.25 : 0.8);
      towers.push([x, tw, th]); x += tw + rnd() * 6 * d;
    }
    for (const [tx, tw, th] of towers) {
      const tg = b.createLinearGradient(0, hz - th, 0, hz);
      tg.addColorStop(0, '#1a1840'); tg.addColorStop(1, '#0b0a22');
      b.fillStyle = tg; b.fillRect(tx, hz - th, tw, th);
      for (let wy = hz - th + 6 * d; wy < hz - 4 * d; wy += 6 * d) for (let wx = tx + 3 * d; wx < tx + tw - 3 * d; wx += 5 * d) {
        if (rnd() < 0.36) { b.fillStyle = rnd() < 0.7 ? `rgba(255,214,150,${0.35 + rnd() * 0.5})` : `rgba(150,220,255,${0.35 + rnd() * 0.5})`; b.fillRect(wx, wy, 2.2 * d, 2.8 * d); }
      }
      if (th > 200 * d && rnd() < 0.6) { b.fillStyle = '#ff3b3b'; b.beginPath(); b.arc(tx + tw / 2, hz - th - 3 * d, 2 * d, 0, 7); b.fill(); }
    }
    // Singapore Flyer
    const fx = W * 0.86, fy = hz - 120 * d, fr = 95 * d;
    b.strokeStyle = 'rgba(160,220,255,.55)'; b.lineWidth = 2 * d; b.beginPath(); b.arc(fx, fy, fr, 0, 7); b.stroke();
    for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; b.strokeStyle = 'rgba(160,220,255,.12)'; b.beginPath(); b.moveTo(fx, fy); b.lineTo(fx + Math.cos(a) * fr, fy + Math.sin(a) * fr); b.stroke();
      b.fillStyle = '#9fe6ff'; b.beginPath(); b.arc(fx + Math.cos(a) * fr, fy + Math.sin(a) * fr, 2.6 * d, 0, 7); b.fill(); }
    b.strokeStyle = 'rgba(160,220,255,.35)'; b.beginPath(); b.moveTo(fx - 40 * d, hz); b.lineTo(fx, fy); b.lineTo(fx + 40 * d, hz); b.stroke();
    // Supertrees
    for (let i = 0; i < 6; i++) {
      const sx = W * (0.06 + i * 0.035), sh = (60 + (i % 3) * 25) * d;
      b.strokeStyle = 'rgba(200,90,255,.75)'; b.lineWidth = 3 * d; b.beginPath(); b.moveTo(sx, hz); b.lineTo(sx, hz - sh); b.stroke();
      const cg = b.createRadialGradient(sx, hz - sh, 0, sx, hz - sh, 26 * d); cg.addColorStop(0, 'rgba(255,90,220,.85)'); cg.addColorStop(1, 'rgba(255,90,220,0)');
      b.fillStyle = cg; b.beginPath(); b.ellipse(sx, hz - sh, 26 * d, 10 * d, 0, 0, 7); b.fill();
    }
    // bay
    const wg = b.createLinearGradient(0, hz, 0, H);
    wg.addColorStop(0, '#120a2e'); wg.addColorStop(1, '#04030c');
    b.fillStyle = wg; b.fillRect(0, hz, W, H - hz);
    for (const [tx, tw, th] of towers) {
      // broken horizontal dashes read as light reflected on rippling water
      const warm = rnd() < 0.7;
      for (let ry = hz + 3 * d; ry < Math.min(H * 0.88, hz + th * 0.7); ry += (2 + rnd() * 3) * d) {
        const f = 1 - (ry - hz) / (th * 0.7);
        if (rnd() < 0.45) continue;
        b.fillStyle = warm ? `rgba(255,200,140,${0.22 * f * rnd()})` : `rgba(150,220,255,${0.22 * f * rnd()})`;
        const w = tw * (0.3 + rnd() * 0.6);
        b.fillRect(tx + (tw - w) / 2 + (rnd() - 0.5) * 6 * d, ry, w, 1.2 * d);
      }
    }
    // infinity pool edge
    const py = H * 0.88;
    const pg = b.createLinearGradient(0, py, 0, H);
    pg.addColorStop(0, 'rgba(30,180,210,.55)'); pg.addColorStop(1, 'rgba(10,60,90,.9)');
    b.fillStyle = pg; b.fillRect(0, py, W, H - py);
    b.fillStyle = 'rgba(180,250,255,.8)'; b.fillRect(0, py, W, 2 * d);
  };
  build();
  scope.on(window, 'resize', build);
  const burst = (x, y, col) => { const n = 90; for (let i = 0; i < n; i++) { const a = Math.random() * 7, s = (2 + Math.random() * 3) * MG_DPR; sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1 + Math.random() * 0.8, t: 0, col }); } };
  const COLS = ['#ff3ea5', '#26e0ff', '#ffd23f', '#7cff6b', '#b388ff', '#ffffff'];
  let rocketT = 0;
  scope.loop((dt, now) => {
    if (!bg) return;
    ctx.drawImage(bg, 0, 0);
    for (const s of stars) { ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.35 * Math.sin(now * 1.6 + s.p)})`; ctx.fillRect(s.x * W, s.y * H, s.r * MG_DPR, s.r * MG_DPR); }
    // pool shimmer
    const py = H * 0.88;
    for (let i = 0; i < 14; i++) { const x = ((i * 137 + now * 40) % (W + 200)) - 100; ctx.fillStyle = 'rgba(200,255,255,.08)'; ctx.fillRect(x, py + 6 + (i % 4) * 9, 80, 2); }
    if (fireOn) { rocketT -= dt; if (rocketT <= 0) { rocketT = 0.25 + Math.random() * 0.5; rockets.push({ x: W * (0.15 + Math.random() * 0.7), y: H * 0.72, vy: -(5 + Math.random() * 3) * MG_DPR, t: 0, top: H * (0.12 + Math.random() * 0.25), col: COLS[Math.floor(Math.random() * COLS.length)] }); } }
    for (let i = rockets.length - 1; i >= 0; i--) { const r = rockets[i]; r.y += r.vy * dt * 60; ctx.fillStyle = '#fff'; ctx.fillRect(r.x, r.y, 2, 6); if (r.y < r.top) { burst(r.x, r.y, r.col); rockets.splice(i, 1); } }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = sparks.length - 1; i >= 0; i--) { const p = sparks[i]; p.t += dt; p.vy += 0.04 * dt * 60; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx * dt * 60; p.y += p.vy * dt * 60;
      const a = Math.max(0, 1 - p.t / p.life); ctx.fillStyle = p.col; ctx.globalAlpha = a; ctx.fillRect(p.x, p.y, 3.2 * MG_DPR, 3.2 * MG_DPR); ctx.globalAlpha = a * 0.25; ctx.fillRect(p.x - 3 * MG_DPR, p.y - 3 * MG_DPR, 9 * MG_DPR, 9 * MG_DPR); if (p.t > p.life) sparks.splice(i, 1); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  });
  return { fireworks: on => { fireOn = on; } };
}
