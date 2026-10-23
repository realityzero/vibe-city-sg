// "VibeStudio" — Tommy vibe-codes the MVP with Claudia, his AI pair-programmer, while squashing bugs before they hit prod.
import { h, mountShell, runShell, meter, clamp, pick, sleep, sfx, typeText } from './common.js';
import { highlight, langOf, fileIcon } from './highlight.js';
import {
  IDEAS, FEATURES, COMPACT, HALLUCINATIONS, HALLU_REPLIES, FALLBACK_REPLIES, fallbackCode,
  BUG_NAMES, QUICK_PROMPTS, TOKEN_OUT_REPLY, SHIP_LOGS, GRADE_LINES,
} from './vibecode-data.js';

// Prompt matching priority (first hit wins).
const PRIORITY = ['greet', 'rude', 'tests', 'fix', 'refactor', 'dark', 'pop', 'ai', 'chain', 'payments', 'auth', 'analytics', 'notify', 'geo', 'scale', 'landing', 'deploy'];
const ORDERED = PRIORITY.map(id => FEATURES.find(f => f.id === id)).filter(Boolean);
const SHIP_MIN_FEATURES = 3;
const MAX_BUGS = 9;

/**
 * @param {HTMLElement} root
 * @param {{audio?, onEvent?, signal?: AbortSignal, duration?: number, idea?: string, debug?: boolean}} opts
 * @returns {Promise<{idea, ideaName, quality, bugsSquashed, linesShipped, techDebt, durationSec}>}
 */
export function runVibeCode(root, opts = {}) {
  const ctx = mountShell(root, { kind: 'vibecode', signal: opts.signal, onEvent: opts.onEvent });
  return runShell(play(ctx, opts), ctx);
}

async function play(ctx, opts) {
  const preset = IDEAS.find(i => i.id === opts.idea);
  const idea = preset || await pickIdea(ctx, opts);
  opts.onEvent?.({ type: 'idea', idea: idea.id });
  return ide(ctx, idea, opts);
}

// ---------------------------------------------------------------- idea picker
function pickIdea(ctx, { audio }) {
  const { scope, shell } = ctx;
  return new Promise(resolve => {
    let chosen = false;
    const choose = idea => {
      if (chosen || scope.paused) return;
      chosen = true;
      off();
      sfx(audio, 'ui_select');
      cards.forEach(c => c.classList.toggle('is-chosen', c.dataset.id === idea.id));
      scope.timeout(() => { screen.remove(); resolve(idea); }, 650);
    };
    const cards = IDEAS.map((idea, i) => h('button', {
      class: 'pk-card', dataset: { id: idea.id }, style: { '--accent': idea.accent, '--i': i },
      onclick: () => choose(idea), onmouseenter: () => sfx(audio, 'ui_hover'),
    },
    h('div', { class: 'pk-key' }, String(i + 1)),
    h('div', { class: 'pk-emoji' }, idea.emoji),
    h('div', { class: 'pk-name' }, idea.name),
    h('div', { class: 'pk-tag' }, idea.tagline),
    h('dl', { class: 'pk-facts' },
      h('dt', null, 'TAM'), h('dd', null, h('b', null, idea.tam), h('small', null, ` (${idea.tamNote})`)),
      h('dt', null, 'Moat'), h('dd', null, idea.moat),
      h('dt', null, 'Risk'), h('dd', null, idea.risk)),
    h('div', { class: 'pk-cta' }, 'DISRUPT ▸')));

    const screen = h('div', { class: 'pk' },
      h('div', { class: 'mg-bg-grid' }),
      h('div', { class: 'pk-head' },
        h('div', { class: 'pk-kicker' }, 'MISSION · VIBE CODING'),
        h('h1', { class: 'pk-title' }, 'What are we disrupting, ', h('span', null, 'Tommy?')),
        h('div', { class: 'pk-ken' },
          h('div', { class: 'pk-ken-ava' }, 'KR'),
          h('div', { class: 'pk-ken-say' }, h('b', null, 'KEN ROSENBERG: '), '"Tommy, Tommy, Tommy. In Singapore every startup is fintech, proptech or food. Pick one. Any one. Investors fund vibes now."'))),
      h('div', { class: 'pk-cards' }, cards),
      h('div', { class: 'pk-foot' }, 'Click a card or press ', h('kbd', null, '1'), h('kbd', null, '2'), h('kbd', null, '3')));
    shell.append(screen);
    const onKey = e => {
      const n = +e.key;
      if (n >= 1 && n <= IDEAS.length && !e.repeat) { e.preventDefault(); choose(IDEAS[n - 1]); }
    };
    window.addEventListener('keydown', onKey, true);
    const off = () => window.removeEventListener('keydown', onKey, true);
    scope.add(off);
  });
}

// ---------------------------------------------------------------- IDE
function ide(ctx, idea, opts) {
  const { scope, shell } = ctx;
  const { audio, onEvent } = opts;
  const duration = opts.duration ?? 150;

  const S = {
    tokens: 100, context: 6, tests: 0, vibes: 45, debt: 12,
    features: [], files: new Map(), active: null, bugs: [], squashed: 0, incidents: 0,
    timeLeft: duration, busy: false, upgraded: false, shipped: false, bonus: 0, penalty: 0, t: 0,
  };

  // ---------- DOM
  const timerEl = h('div', { class: 'ide-timer' }, h('small', null, 'KEN CALLS IN'), h('b', null, '--:--'));
  const featEl = h('div', { class: 'ide-feat' }, h('small', null, 'FEATURES'), h('b', null, '0'));
  const shipBtn = h('button', { class: 'ide-ship', disabled: true, onclick: () => ship('button') }, h('span', null, 'SHIP IT'), ' 🚀', h('small', null, `need ${SHIP_MIN_FEATURES} features`));
  const top = h('div', { class: 'ide-top' },
    h('div', { class: 'ide-dots' }, h('i'), h('i'), h('i')),
    h('div', { class: 'ide-title' }, h('b', null, 'VibeStudio'), ` — ~/${idea.app}`),
    h('div', { class: 'ide-branch' }, '⎇ main (yolo)'),
    h('div', { class: 'ide-spacer' }),
    featEl, timerEl, shipBtn);

  const tree = h('div', { class: 'ide-tree' });
  const M = {
    tokens: meter('Tokens', 'm-tokens', { suffix: '%' }),
    context: meter('Context window', 'm-context invert', { suffix: '%' }),
    tests: meter('Tests passing', 'm-tests', { suffix: '%' }),
    vibes: meter('Vibes', 'm-vibes'),
    debt: meter('Tech debt', 'm-debt invert', { suffix: '%' }),
  };
  const left = h('div', { class: 'ide-left' },
    h('div', { class: 'ide-ptitle' }, 'EXPLORER'), tree,
    h('div', { class: 'ide-ptitle' }, 'SESSION'),
    h('div', { class: 'ide-meters' }, Object.values(M).map(m => m.el)));

  const tabs = h('div', { class: 'ide-tabs' });
  const code = h('div', { class: 'ide-code' });
  const editorScroll = h('div', { class: 'ide-editor' }, code);
  const bugLayer = h('div', { class: 'ide-bugs' });
  const prodLine = h('div', { class: 'ide-prod' }, h('span', null, '🚨 PROD'), h('i'));
  const banner = h('div', { class: 'ide-banner' });
  const center = h('div', { class: 'ide-center' }, tabs, h('div', { class: 'ide-editor-wrap' }, editorScroll, bugLayer, prodLine, banner));

  const log = h('div', { class: 'chat-log' });
  const input = h('textarea', { class: 'chat-input', rows: '2', placeholder: 'Ask Claudia to build something…  (Enter to send)', spellcheck: 'false' });
  const sendBtn = h('button', { class: 'chat-send', onclick: () => send() }, '➤');
  const costHint = h('div', { class: 'chat-cost' }, 'each prompt costs tokens & context');
  const chips = h('div', { class: 'chat-chips' }, QUICK_PROMPTS.map(p => h('button', {
    class: `chip ${p === '/compact' ? 'chip--compact' : ''} ${p === 'deploy' ? 'chip--deploy' : ''}`,
    onclick: () => { if (!S.busy) { input.value = p; send(); } }, onmouseenter: () => sfx(audio, 'ui_hover'),
  }, p)));
  const right = h('div', { class: 'ide-right' },
    h('div', { class: 'chat-head' }, h('div', { class: 'claudia-orb' }), h('div', null, h('b', null, 'Claudia'), h('small', null, 'your AI pair-programmer · claudia-opus-max-ultra')), h('div', { class: 'chat-status' }, '● online')),
    log, chips, h('div', { class: 'chat-box' }, input, sendBtn), costHint);

  const status = h('div', { class: 'ide-status' });
  const ideEl = h('div', { class: 'ide', style: { '--accent': idea.accent } }, top, h('div', { class: 'ide-main' }, left, center, right), status);
  shell.append(ideEl);

  // ---------- files & editor
  const addFile = (path, text, { silent = false } = {}) => {
    if (!S.files.has(path)) {
      S.files.set(path, { path, lines: text ? text.replace(/\n$/, '').split('\n') : [''], lang: langOf(path), isNew: !silent });
    }
    renderTree();
    return S.files.get(path);
  };
  const renderTree = () => {
    tree.replaceChildren(...[...S.files.keys()].sort().map(p => {
      const [ic, col] = fileIcon(p);
      const f = S.files.get(p);
      const depth = p.split('/').length - 1;
      const el = h('div', { class: `tree-item ${p === S.active ? 'is-active' : ''} ${f.isNew ? 'is-new' : ''}`, style: { paddingLeft: `${10 + depth * 10}px` }, onclick: () => { if (!S.busy) openFile(p); } },
        h('span', { class: 'tree-ic', style: { color: col } }, ic), h('span', { class: 'tree-name' }, depth ? h('span', { class: 'tree-dir' }, p.split('/').slice(0, -1).join('/') + '/') : null, p.split('/').pop()));
      return el;
    }));
  };
  const renderTabs = () => {
    tabs.replaceChildren(...[...S.files.keys()].filter(p => p === S.active || S.files.get(p).opened).slice(-4).map(p => {
      const [ic, col] = fileIcon(p);
      return h('div', { class: `ide-tab ${p === S.active ? 'is-active' : ''}`, onclick: () => { if (!S.busy) openFile(p); } }, h('span', { style: { color: col } }, ic), ' ', p.split('/').pop());
    }));
  };
  const lineEl = (n, text, lang) => h('div', { class: 'cl' }, h('span', { class: 'ln' }, String(n)), h('span', { class: 'lc', html: highlight(text, lang) }));
  const openFile = path => {
    const f = S.files.get(path);
    S.active = path; f.opened = true; f.isNew = false;
    code.replaceChildren(...f.lines.map((l, i) => lineEl(i + 1, l, f.lang)));
    renderTree(); renderTabs();
  };
  const totalLines = () => [...S.files.values()].reduce((a, f) => a + f.lines.length, 0);

  /** streams `text` (appended) into file `path` at ~cps chars/sec */
  const streamCode = (path, text, cps = 520) => new Promise(resolve => {
    const f = addFile(path, '');
    if (S.active !== path) openFile(path);
    const startEmpty = f.lines.length === 1 && f.lines[0] === '';
    let curLine = startEmpty ? 0 : f.lines.length;
    if (!startEmpty) { f.lines.push(''); code.append(lineEl(f.lines.length, '', f.lang)); }
    let curEl = code.lastElementChild?.querySelector('.lc');
    let i = 0, acc = 0;
    scope.loop(dt => {
      if (S.shipped) { resolve(); return false; }
      acc += dt * cps;
      let n = Math.floor(acc); acc -= n;
      while (n-- > 0 && i < text.length) {
        const ch = text[i++];
        if (ch === '\n') {
          curEl.innerHTML = highlight(f.lines[curLine], f.lang);
          f.lines.push(''); curLine++;
          code.append(lineEl(curLine + 1, '', f.lang));
          curEl = code.lastElementChild.querySelector('.lc');
          if (i % 3 === 0) sfx(audio, 'typing');
        } else f.lines[curLine] += ch;
      }
      curEl.innerHTML = highlight(f.lines[curLine], f.lang) + '<span class="caret"></span>';
      editorScroll.scrollTop = editorScroll.scrollHeight;
      if (i >= text.length) {
        curEl.innerHTML = highlight(f.lines[curLine], f.lang);
        if (f.lines[curLine] === '') { f.lines.pop(); code.lastElementChild.remove(); }
        resolve(); return false;
      }
    });
  });

  // ---------- chat
  const scrollLog = () => { log.scrollTop = log.scrollHeight; };
  const addMsg = (who, text, cls = '') => {
    const body = h('div', { class: 'msg-body' });
    const el = h('div', { class: `msg msg--${who} ${cls}` },
      who === 'claudia' ? h('div', { class: 'msg-ava claudia-orb' }) : h('div', { class: 'msg-ava msg-ava--tommy' }, 'TV'),
      body);
    if (who !== 'claudia') body.textContent = text;
    log.append(el); scrollLog();
    return { el, body };
  };
  const claudiaSay = async (text, cls = '') => {
    const { body } = addMsg('claudia', '', cls);
    await typeText(scope, body, text, 160, body);
    scrollLog();
    return body;
  };
  const thinking = async ms => {
    const { el } = addMsg('claudia', '', 'msg--thinking');
    el.querySelector('.msg-body').append(h('span', { class: 'dots' }, h('i'), h('i'), h('i')), h('span', { class: 'think-txt' }, pick(['Thinking…', 'Vibing…', 'Consulting the docs I was trained on in 2024…', 'Reticulating splines…', 'Pretending to read your codebase…'])));
    scrollLog();
    await sleep(scope, ms);
    el.remove();
  };

  // ---------- meters / HUD
  const refresh = () => {
    M.tokens.set(S.tokens); M.context.set(S.context); M.tests.set(S.tests); M.vibes.set(S.vibes); M.debt.set(S.debt);
    featEl.querySelector('b').textContent = String(S.features.length);
    const ready = S.features.length >= SHIP_MIN_FEATURES;
    shipBtn.disabled = !ready || S.shipped || S.busy;
    shipBtn.classList.toggle('is-ready', ready && !S.shipped);
    shipBtn.querySelector('small').textContent = ready ? 'ready to deploy' : `need ${SHIP_MIN_FEATURES - S.features.length} more feature${SHIP_MIN_FEATURES - S.features.length === 1 ? '' : 's'}`;
    const hallu = S.context >= 100;
    ideEl.classList.toggle('is-hallucinating', hallu);
    chips.querySelector('.chip--compact')?.classList.toggle('is-hot', S.context >= 80);
    chips.querySelector('.chip--deploy')?.classList.toggle('is-hot', ready);
    banner.textContent = hallu ? '⚠ CONTEXT WINDOW FULL — Claudia is freestyling. Type /compact' : '';
    banner.classList.toggle('is-on', hallu);
    status.replaceChildren(
      h('span', null, '⎇ main'), h('span', null, `${S.files.size} files`), h('span', null, `${totalLines()} lines`),
      h('span', { class: S.bugs.length ? 'st-bad' : '' }, `🐞 ${S.bugs.length} live`), h('span', null, `✔ ${S.squashed} squashed`),
      h('span', { class: S.incidents ? 'st-bad' : '' }, `🔥 ${S.incidents} incidents`),
      h('span', { class: 'st-right' }, S.active ? langOf(S.active).toUpperCase() : ''), h('span', null, 'UTF-8 · SGT'));
  };
  const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // ---------- bugs
  const spawnBug = (delay = 0) => scope.timeout(() => {
    if (S.shipped || S.bugs.length >= MAX_BUGS) return;
    const w = bugLayer.clientWidth || 600;
    const name = pick(BUG_NAMES);
    const el = h('div', { class: 'bug' },
      h('div', { class: 'bug-sprite', html: BUG_SVG }),
      h('div', { class: 'bug-tag' }, name));
    const b = { el, name, x: 40 + Math.random() * Math.max(80, w - 140), y: -40, speed: 30 + Math.random() * 16 + Math.min(18, S.t / 8), phase: Math.random() * 6.28, dead: false };
    el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); squash(b); });
    bugLayer.append(el);
    S.bugs.push(b);
    refresh();
  }, delay);
  const squash = (b, auto = false) => {
    if (b.dead || S.shipped && !auto) return;
    b.dead = true;
    S.bugs = S.bugs.filter(x => x !== b);
    if (!auto) { S.squashed++; S.vibes = clamp(S.vibes + 1.5); sfx(audio, 'bug_squash'); onEvent?.({ type: 'bug_squashed', name: b.name }); }
    b.el.classList.add('is-squashed');
    b.el.querySelector('.bug-sprite').innerHTML = SPLAT_SVG;
    floater(b.x + 10, b.y, auto ? 'fixed' : '+1 squashed', 'good');
    scope.timeout(() => b.el.remove(), 700);
    refresh();
  };
  const floater = (x, y, text, cls) => {
    const f = h('div', { class: `floater floater--${cls}`, style: { left: `${x}px`, top: `${y}px` } }, text);
    bugLayer.append(f);
    scope.timeout(() => f.remove(), 1100);
  };
  const incident = b => {
    b.dead = true;
    S.bugs = S.bugs.filter(x => x !== b);
    S.incidents++; S.debt = clamp(S.debt + 8); S.vibes = clamp(S.vibes - 7);
    b.el.classList.add('is-boom');
    b.el.querySelector('.bug-sprite').innerHTML = '<div class="boom">🔥</div>';
    scope.timeout(() => b.el.remove(), 800);
    toast(`🔥 PROD INCIDENT — "${b.name}" took down sg-1. Ken is on the phone.`);
    ideEl.classList.remove('shake'); void ideEl.offsetWidth; ideEl.classList.add('shake');
    onEvent?.({ type: 'incident', name: b.name });
    refresh();
  };
  const toast = text => {
    const t = h('div', { class: 'ide-toast' }, text);
    center.append(t);
    scope.timeout(() => t.classList.add('is-out'), 2600);
    scope.timeout(() => t.remove(), 3100);
  };

  // ---------- prompt handling
  const setBusy = b => {
    S.busy = b;
    input.disabled = b || S.shipped; sendBtn.disabled = b || S.shipped;
    right.classList.toggle('is-busy', b);
    refresh();
    if (!b && !S.shipped) input.focus({ preventScroll: true });
  };

  const send = async () => {
    const text = input.value.trim().replace(/\s+/g, ' ').slice(0, 160);
    if (!text || S.busy || S.shipped || scope.paused) return;
    input.value = '';
    sfx(audio, 'keyclick');
    addMsg('tommy', text);
    setBusy(true);
    try { await handle(text); } finally { if (!scope.dead) setBusy(false); }
  };

  const handle = async text => {
    onEvent?.({ type: 'prompt', text });
    if (COMPACT.re.test(text)) {
      S.tokens = clamp(S.tokens - 3);
      refresh();
      await thinking(700);
      S.context = 4; S.debt = clamp(S.debt + 2);
      refresh();
      await claudiaSay(pick(COMPACT.replies(idea)), 'msg--system');
      return;
    }
    if (S.tokens <= 0) { await tokenOut(); return; }

    const feat = ORDERED.find(f => f.re.test(text));
    if (feat?.deploy) {
      await thinking(400);
      if (S.features.length >= SHIP_MIN_FEATURES) { await claudiaSay(pick(feat.replies(idea))); ship('prompt'); }
      else await claudiaSay(`Babe. We have ${S.features.length} feature${S.features.length === 1 ? '' : 's'}. Deploy what, the README? Build at least ${SHIP_MIN_FEATURES} things first. Try "add login" or "make it pop". 💅`);
      return;
    }

    const cost = feat?.cost ?? { tokens: 8, context: 12 };
    S.tokens = clamp(S.tokens - cost.tokens);
    const wasHallu = S.context >= 100;
    S.context = clamp(S.context + cost.context, 0, 100);
    refresh();
    await thinking(500 + Math.random() * 500);

    // context full → hallucination
    if (wasHallu && !feat?.noFile) {
      const path = S.active || 'src/index.ts';
      const p = claudiaSay(pick(HALLU_REPLIES), 'msg--hallu');
      for (let i = 0; i < 3; i++) spawnBug(300 + i * 900);
      S.debt = clamp(S.debt + 8); S.vibes = clamp(S.vibes - 4); S.penalty += 4;
      await Promise.all([p, streamCode(path, pick(HALLUCINATIONS)(idea), 560)]);
      refresh();
      return;
    }

    if (!feat) {
      const reply = pick(FALLBACK_REPLIES)(text.slice(0, 48));
      const p = claudiaSay(reply);
      spawnBug(800);
      S.vibes = clamp(S.vibes + 3); S.debt = clamp(S.debt + 3); S.bonus += 0.5;
      await Promise.all([p, streamCode('src/synergy.ts', fallbackCode(idea, text))]);
      refresh();
      return;
    }

    const fx = feat.fx;
    const already = feat.file && S.features.includes(feat.id);
    const replyText = already
      ? `You're absolutely right — ${feat.label.toLowerCase()} could be better. I've made it 10x better. (I changed a comment.) ✅`
      : pick(feat.replies(idea));
    const replyP = claudiaSay(replyText);

    if (fx.squashAll) {
      const live = [...S.bugs];
      live.forEach((b, i) => scope.timeout(() => { if (!b.dead) { squash(b, true); S.squashed++; } }, 250 + i * 160));
    }
    const nBugs = (fx.bugs ?? 1) + (Math.random() < 0.35 ? 1 : 0) - (S.tests > 50 ? 1 : 0);
    for (let i = 0; i < Math.max(0, already ? Math.min(1, nBugs) : nBugs); i++) spawnBug(600 + i * 1100 + Math.random() * 600);

    let codeP = Promise.resolve();
    if (feat.patch) codeP = streamCode(S.active || 'src/index.ts', feat.code(idea));
    else if (feat.file) codeP = streamCode(feat.file, already ? `\n// v2: now 10x better (comment updated by Claudia)\n` : feat.code(idea));

    await Promise.all([replyP, codeP]);

    const k = already ? 0.3 : 1;
    S.tests = clamp(S.tests + (fx.tests ?? 0) * k + (feat.file && !fx.tests ? -4 : 0));
    S.vibes = clamp(S.vibes + (fx.vibes ?? 0) * k);
    S.debt = clamp(S.debt + (fx.debt ?? 2) * (fx.debt < 0 ? 1 : k));
    S.bonus += (fx.quality ?? 0) * k;
    if (feat.file && !already) {
      S.features.push(feat.id);
      onEvent?.({ type: 'feature', id: feat.id, label: feat.label });
      sfx(audio, 'checkpoint');
      toastFeature(feat.label);
    }
    refresh();
  };

  const toastFeature = label => {
    const t = h('div', { class: 'feat-pop' }, h('small', null, 'FEATURE SHIPPED TO MAIN'), h('b', null, label));
    center.append(t);
    scope.timeout(() => t.remove(), 1800);
  };

  const tokenOut = async () => {
    await thinking(300);
    const body = await claudiaSay(TOKEN_OUT_REPLY, 'msg--system');
    const row = h('div', { class: 'msg-actions' });
    if (!S.upgraded) row.append(h('button', {
      class: 'mg-btn mg-btn--small', onclick: () => {
        if (S.upgraded) return;
        S.upgraded = true; S.tokens = 35; S.vibes = clamp(S.vibes - 12);
        row.replaceChildren(h('i', null, 'Upgraded. Tommy\'s credit card is weeping softly.'));
        sfx(audio, 'cash_register'); refresh();
      },
    }, 'Upgrade (S$ 1,999/mo)'));
    if (S.features.length >= SHIP_MIN_FEATURES || S.timeLeft < duration) row.append(h('button', { class: 'mg-btn mg-btn--small mg-btn--primary', onclick: () => ship('tokens') }, 'Ship what we have 🚀'));
    body.parentElement.after(row);
    scrollLog();
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // ---------- main loop
  let resolveDone;
  const done = new Promise(r => { resolveDone = r; });
  let passiveIn = 14;
  scope.loop(dt => {
    if (S.shipped) return false;
    S.t += dt;
    S.timeLeft = Math.max(0, S.timeLeft - dt);
    timerEl.querySelector('b').textContent = fmt(S.timeLeft);
    timerEl.classList.toggle('is-urgent', S.timeLeft <= 30);
    // passive legacy bugs
    passiveIn -= dt;
    if (passiveIn <= 0) { passiveIn = 11 + Math.random() * 7; if (S.files.size > 3) spawnBug(); }
    // move bugs
    const prodY = bugLayer.clientHeight - 34;
    const w = bugLayer.clientWidth;
    for (const b of [...S.bugs]) {
      b.y += b.speed * dt;
      b.x += Math.sin(S.t * 2.6 + b.phase) * 26 * dt;
      b.x = Math.max(8, Math.min(w - 90, b.x));
      const rot = Math.cos(S.t * 2.6 + b.phase) * 25;
      b.el.style.transform = `translate(${b.x}px, ${b.y}px)`;
      b.el.firstChild.style.transform = `rotate(${180 + rot}deg)`;
      b.el.classList.toggle('is-near', b.y > prodY - 90);
      if (b.y >= prodY - 8) incident(b);
    }
    if (S.timeLeft <= 0 && !S.busy) ship('timeout');
  });

  // ---------- ship
  const ship = async reason => {
    if (S.shipped) return;
    S.shipped = true;
    input.disabled = true; sendBtn.disabled = true;
    refresh();
    onEvent?.({ type: 'ship', reason });
    const liveBugs = S.bugs.length;
    S.bugs.forEach(b => b.el.classList.add('is-frozen'));
    if (reason === 'timeout') toast('⏰ Time\'s up — Ken is shipping it for you. God help us.');

    const features = Math.min(8, S.features.length);
    const quality = Math.round(clamp(
      18 + features * 8 + S.tests * 0.15 + S.vibes * 0.12 - S.debt * 0.3 - liveBugs * 3 - S.incidents * 2 + Math.min(12, S.squashed) * 0.6 + S.bonus - S.penalty));
    const grade = quality >= 90 ? 'S' : quality >= 78 ? 'A' : quality >= 64 ? 'B' : quality >= 50 ? 'C' : quality >= 35 ? 'D' : 'F';
    const result = {
      idea: idea.id, ideaName: idea.name, quality,
      bugsSquashed: S.squashed, linesShipped: totalLines(), techDebt: Math.round(S.debt),
      durationSec: Math.round(S.t),
    };

    await sleep(scope, reason === 'timeout' ? 1200 : 400);
    // deploy terminal
    const term = h('div', { class: 'term' });
    const termWrap = h('div', { class: 'term-wrap' }, h('div', { class: 'term-win' },
      h('div', { class: 'term-bar' }, h('div', { class: 'ide-dots' }, h('i'), h('i'), h('i')), h('span', null, `tommy@vercetti-mbp — vibe deploy — ${idea.app}`)), term));
    shell.append(termWrap);
    for (const line of SHIP_LOGS(idea, { tests: S.tests, bugs: liveBugs, debt: S.debt })) {
      await sleep(scope, line.d ?? 300);
      const el = h('div', { class: `tl ${line.c ? line.c.split(' ').map(c => `tl--${c}`).join(' ') : ''}` });
      term.append(el);
      if (line.c?.includes('big')) { sfx(audio, 'ship_it'); el.textContent = line.t; }
      else await typeText(scope, el, line.t, 220, termWrap);
      term.scrollTop = term.scrollHeight;
    }
    await sleep(scope, 900);
    termWrap.querySelector('.term-win').classList.add('is-done');

    // result card
    const card = h('div', { class: 'res' },
      h('div', { class: 'res-kicker' }, 'MVP SHIPPED'),
      h('div', { class: 'res-row' },
        h('div', { class: `res-grade res-grade--${grade}` }, grade),
        h('div', { class: 'res-main' },
          h('div', { class: 'res-name' }, `${idea.emoji} ${idea.name}`),
          h('div', { class: 'res-q' }, 'PRODUCT QUALITY ', h('b', null, `${quality}`), h('span', null, '/100')),
          h('div', { class: 'res-bar' }, h('i', { style: { width: `${quality}%` } })),
          h('div', { class: 'res-chips' }, S.features.map(id => h('span', null, FEATURES.find(f => f.id === id)?.label ?? id))))),
      h('div', { class: 'res-stats' },
        stat('Bugs squashed', S.squashed), stat('Prod incidents', S.incidents), stat('Lines shipped', result.linesShipped),
        stat('Tech debt', `${result.techDebt}%`), stat('Tests', `${Math.round(S.tests)}%`), stat('Time', fmt(S.t))),
      h('div', { class: 'res-quote' }, GRADE_LINES[grade]),
      h('button', { class: 'mg-btn mg-btn--primary mg-btn--big', onclick: () => finish() }, 'Continue  ▸'));
    termWrap.append(card);
    requestAnimationFrame(() => card.classList.add('is-in'));
    card.querySelector('button').focus();
    let finished = false;
    const finish = () => { if (finished) return; finished = true; sfx(audio, 'ui_select'); resolveDone(result); };
    scope.on(window, 'keydown', e => { if (e.key === 'Enter' && !scope.paused) { e.preventDefault(); finish(); } }, true);
  };

  // ---------- boot
  addFile('README.md', `# ${idea.name} ${idea.emoji}
> ${idea.tagline}

## Status
- [ ] MVP
- [ ] Users
- [ ] Series A
- [x] Hawaiian shirt

Founder: **Tommy Vercetti** · Legal: Ken Rosenberg (not legal advice)`, { silent: true });
  addFile('package.json', `{
  "name": "${idea.app}",
  "version": "0.0.1-beta-final-FINAL",
  "scripts": { "dev": "vibe dev", "deploy": "vibe deploy --prod --yolo" },
  "dependencies": { "left-pad": "*", "vibes": "^10.0.0" }
}`, { silent: true });
  addFile('src/index.ts', `// ${idea.name} — entry point
import { app } from './app';

app.listen(65, () => console.log('${idea.name} up on :65 (SG country code, for luck)'));`, { silent: true });
  openFile('README.md');
  refresh();
  timerEl.querySelector('b').textContent = fmt(S.timeLeft);
  scope.timeout(() => claudiaSay(`Hi Tommy! 👋 I'm Claudia. I've read your README (4 lines) and I'm ready to build ${idea.name}. Type what you want — "add login", "make it pop", "add AI"… Ship ${SHIP_MIN_FEATURES}+ features before Ken calls. Click 🐞 bugs before they crawl into PROD.`), 350);
  input.focus({ preventScroll: true });

  if (opts.debug) window.__vibecode = { S, send: t => { input.value = t; return send(); }, ship, spawnBug, refresh };
  return done;
}

const stat = (label, v) => h('div', { class: 'res-stat' }, h('b', null, String(v)), h('small', null, label));

const BUG_SVG = `<svg viewBox="0 0 40 40" width="34" height="34" aria-hidden="true">
  <g class="legs" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none">
    <path class="lg a" d="M13 17 L5 12"/><path class="lg b" d="M12 22 L3 22"/><path class="lg a" d="M13 27 L5 32"/>
    <path class="lg b" d="M27 17 L35 12"/><path class="lg a" d="M28 22 L37 22"/><path class="lg b" d="M27 27 L35 32"/>
    <path d="M17 9 L13 3"/><path d="M23 9 L27 3"/>
  </g>
  <ellipse cx="20" cy="24" rx="9" ry="11" fill="currentColor"/>
  <circle cx="20" cy="11" r="5.5" fill="currentColor"/>
  <path d="M20 14 L20 34" stroke="#0b0820" stroke-width="1.4"/>
  <circle cx="17.6" cy="10" r="1.5" fill="#fff"/><circle cx="22.4" cy="10" r="1.5" fill="#fff"/>
</svg>`;
const SPLAT_SVG = `<svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true"><path fill="#7cff6b" d="M20 6c3 0 3 6 6 6s6-4 8-1-3 6-1 9 7 3 5 6-6 0-8 3 1 7-3 8-4-4-7-4-6 5-9 2 2-6 0-9-7-2-6-6 6-2 7-5-3-8 1-9 5 3 7 0z" opacity=".9"/></svg>`;
