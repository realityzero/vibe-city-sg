// "Chope Rampage": top-down hawker centre at lunch. Throw tissue packets onto empty seats before umbrella aunties claim them.
import { h, mountShell, runShell, clamp, pick, sfx } from './common.js';
// canvas pixel ratio capped at 2: a 3x phone screen would make each full-screen minigame canvas ~12 MB
const MG_DPR = Math.min(2, window.devicePixelRatio || 1);

const LW = 1280, LH = 720;            // logical playfield
const GOAL = 8;
const STALLS = [['CHICKEN RICE', '鸡饭', '#d9412b'], ['CHAR KWAY TEOW', '炒粿条', '#2b6fd9'], ['LAKSA', '叻沙', '#e08a1e'], ['SATAY', '沙爹', '#8a3fd1'], ['KOPI · TEH', '咖啡', '#1d8a4f'], ['HOKKIEN MEE', '福建面', '#c8102e'], ['ROJAK', '啰杂', '#d1a21e']];
const CLOTHES = ['#e85d75', '#f2a541', '#5aa9e6', '#7bc96f', '#b07cc6', '#f7d488', '#ef8354', '#3fb6a8'];
const PERMS = ['#2d2424', '#3b3434', '#4a3a3a', '#6b6262'];
const SKIN = ['#e8b98f', '#d9a37e', '#c98e67', '#f1c7a5', '#a86f4c'];

/**
 * @param {HTMLElement} root
 * @param {{audio?, onEvent?, signal?: AbortSignal, duration?: number, debug?: boolean}} opts
 * @returns {Promise<{seats: number, score: number}>}
 */
export function runChopeRampage(root, opts = {}) {
  const ctx = mountShell(root, { kind: 'chope', signal: opts.signal, onEvent: opts.onEvent });
  return runShell(play(ctx, opts), ctx);
}

async function play(ctx, opts) {
  const { scope, shell } = ctx;
  const { audio, onEvent } = opts;
  const duration = opts.duration ?? 60;

  // ---------- world
  const seats = [], tables = [];
  const cols = 6, rows = 3;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = 175 + c * 186 + (r % 2 ? 40 : -10), y = 225 + r * 150;
    const t = { x, y, seats: [] };
    tables.push(t);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2;
      const s = { x: x + Math.cos(a) * 46, y: y + Math.sin(a) * 46, table: t, state: 'empty', mark: null, locked: false, reserved: null, t: 0, hue: (r + c) % 2 ? '#2a8f6a' : '#e0632b', pulse: 0 };
      t.seats.push(s); seats.push(s);
    }
  }
  const S = {
    t: 0, ammo: 10, score: 0, chopes: 0, lost: 0, litter: 0, lanyard: 0, umbrella: 0, over: false, started: false,
    aunties: [], diners: [], shots: [], pickups: [], litterDecals: [], floaters: [], vendor: null, vendorIn: 9,
    auntieIn: 2.2, dinerIn: 1, pickupIn: 7, wave: 0, hover: null, mouse: { x: 640, y: 400, down: false }, lastDragSeat: null, fan: 0,
  };
  const TOMMY = { x: 640, y: 676 };
  const mine = () => seats.filter(s => s.state === 'tommy').length;
  const intensity = () => clamp(S.t / duration, 0, 1);

  // seed: some diners already eating
  for (let i = 0; i < 18; i++) { const s = pick(seats.filter(x => x.state === 'empty')); s.state = 'diner'; s.t = 4 + Math.random() * 14; s.person = person(); }

  // ---------- DOM
  const cv = h('canvas', { class: 'cr-canvas' });
  const clockB = h('b', null, '12:00 PM');
  const seatsB = h('b', null, `0 / ${GOAL}`);
  const ammoB = h('b', null, '10');
  const scoreB = h('b', null, '0');
  const powerEl = h('div', { class: 'cr-power' });
  const banner = h('div', { class: 'cr-banner' });
  const hud = h('div', { class: 'cr-hud' },
    h('div', { class: 'cr-box cr-seats' }, h('small', null, 'SEATS FOR THE TEAM'), seatsB, h('div', { class: 'cr-pips' }, Array.from({ length: GOAL }, () => h('i')))),
    h('div', { class: 'cr-box cr-clock' }, h('small', null, 'LAU PA SAT · LUNCH'), clockB),
    h('div', { class: 'cr-box cr-right' }, h('div', null, h('small', null, 'TISSUE PACKETS'), h('span', null, '🧻 ', ammoB)), h('div', null, h('small', null, 'SCORE'), scoreB), powerEl));
  const stage = h('div', { class: 'cr' }, cv, hud, banner);
  shell.append(stage);
  const g = cv.getContext('2d');
  let scale = 1, ox = 0, oy = 0;
  const resize = () => {
    const d = MG_DPR, W = stage.clientWidth, H = stage.clientHeight;
    cv.width = W * d; cv.height = H * d;
    scale = Math.min(W / LW, H / LH); ox = (W - LW * scale) / 2; oy = (H - LH * scale) / 2;
  };
  resize();
  scope.on(window, 'resize', resize);
  const toWorld = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left - ox) / scale, y: (e.clientY - r.top - oy) / scale }; };

  const say = (text, x, y, col = '#fff', big = false) => S.floaters.push({ text, x, y, col, t: 0, big });
  const showBanner = (text, cls = '') => {
    banner.textContent = text; banner.className = `cr-banner is-on ${cls}`;
    scope.timeout(() => banner.classList.remove('is-on'), 2200);
  };
  const updHud = () => {
    const m = mine();
    seatsB.textContent = `${m} / ${GOAL}`;
    [...hud.querySelectorAll('.cr-pips i')].forEach((p, i) => p.classList.toggle('is-on', i < m));
    ammoB.textContent = String(S.ammo);
    ammoB.parentElement.classList.toggle('is-empty', S.ammo === 0);
    scoreB.textContent = String(Math.max(0, Math.round(S.score)));
    const mins = Math.floor(S.t / duration * 60);
    clockB.textContent = `12:${String(mins).padStart(2, '0')} PM`;
    clockB.parentElement.classList.toggle('is-urgent', duration - S.t < 10);
    powerEl.replaceChildren(...[
      S.lanyard > 0 ? h('span', { class: 'cr-pw cr-pw--lan' }, `🪪 LANYARD ${S.lanyard.toFixed(1)}s`) : null,
      S.umbrella > 0 ? h('span', { class: 'cr-pw cr-pw--umb' }, `☂️ UMBRELLA ×${S.umbrella}`) : null,
    ].filter(Boolean));
  };

  // ---------- spawning
  function person() { return { cloth: pick(CLOTHES), skin: pick(SKIN), hair: pick(PERMS), perm: false }; }
  const entrance = () => Math.random() < 0.5 ? { x: -20, y: 200 + Math.random() * 380 } : { x: LW + 20, y: 200 + Math.random() * 380 };
  const freeSeats = () => seats.filter(s => s.state === 'empty' && !s.reserved);
  const spawnAuntie = () => {
    const e = entrance();
    const umb = Math.random() < 0.35 + intensity() * 0.25;
    const a = { ...e, kind: umb ? 'umbrella' : 'tissue', speed: 70 + Math.random() * 40 + intensity() * 70, target: null, p: { ...person(), perm: true }, umbCol: pick(CLOTHES), state: 'hunt', bob: Math.random() * 6 };
    S.aunties.push(a);
    retarget(a);
  };
  const retarget = a => {
    if (a.target?.reserved === a) a.target.reserved = null;
    let cands = freeSeats();
    if (a.kind === 'umbrella' && Math.random() < 0.55) cands = cands.concat(seats.filter(s => s.state === 'tommy' && !s.locked && !s.reserved));
    if (!cands.length) { a.state = 'leave'; a.target = null; return; }
    cands.sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y));
    a.target = cands[Math.min(cands.length - 1, Math.floor(Math.random() * 3))];
    a.target.reserved = a;
  };
  const spawnDiner = () => {
    const free = freeSeats();
    if (!free.length) return;
    const s = pick(free);
    const st = 90 + Math.floor(Math.random() * 7) * 170;
    const d = { x: st, y: 112, target: s, p: person(), speed: 85 + Math.random() * 30, state: 'walk' };
    s.reserved = d;
    S.diners.push(d);
  };

  // ---------- throwing
  const nearestSeat = (p, r = 24) => { let best = null, bd = r; for (const s of seats) { const d = Math.hypot(s.x - p.x, s.y - p.y); if (d < bd) { bd = d; best = s; } } return best; };
  const throwAt = p => {
    if (S.over || scope.paused || !S.started) return;
    // pickups & vendor first
    for (const pu of S.pickups) if (Math.hypot(pu.x - p.x, pu.y - p.y) < 28) { collect(pu); return; }
    if (S.vendor && Math.hypot(S.vendor.x - p.x, S.vendor.y - p.y) < 32) { S.ammo += 8; say('+8 packets · "Three for one dollar!"', S.vendor.x, S.vendor.y - 30, '#ffd23f'); sfx(audio, 'cash_register'); S.vendor.sold = true; updHud(); return; }
    if (S.ammo <= 0) { say('Out of tissue! Find the tissue auntie 🧻', TOMMY.x, TOMMY.y - 40, '#ff4d5e'); sfx(audio, 'ui_hover'); return; }
    S.ammo--;
    const umbrella = S.umbrella > 0;
    if (umbrella) S.umbrella--;
    const d = Math.hypot(p.x - TOMMY.x, p.y - TOMMY.y);
    S.shots.push({ x0: TOMMY.x, y0: TOMMY.y - 10, x1: p.x, y1: p.y, t: 0, dur: 0.22 + d / 1800, spin: Math.random() * 6, umbrella, lanyard: S.lanyard > 0 });
    sfx(audio, 'keyclick');
    updHud();
  };
  const land = sh => {
    const s = nearestSeat({ x: sh.x1, y: sh.y1 });
    if (sh.umbrella) {
      const t = s?.table || tables.reduce((b, t) => Math.hypot(t.x - sh.x1, t.y - sh.y1) < Math.hypot(b.x - sh.x1, b.y - sh.y1) ? t : b);
      if (Math.hypot(t.x - sh.x1, t.y - sh.y1) > 90) { litter(sh); return; }
      let n = 0;
      for (const seat of t.seats) if (n < 3 && (seat.state === 'empty' || (seat.state === 'auntie' && seat.mark === 'tissue'))) { claim(seat, 'umbrella', sh.lanyard); n++; }
      if (n) { say(`☂️ UMBRELLA CHOPE ×${n}!`, t.x, t.y - 60, '#26e0ff', true); sfx(audio, 'checkpoint'); }
      else say('Table full lah!', t.x, t.y - 50, '#ffb347');
      return;
    }
    if (!s) { litter(sh); return; }
    if (s.state === 'empty') { claim(s, sh.lanyard ? 'lanyard' : 'tissue', sh.lanyard); sfx(audio, 'checkpoint'); }
    else if (s.state === 'tommy') { say('Already yours!', s.x, s.y - 26, '#26e0ff'); }
    else if (s.state === 'auntie') { say(s.mark === 'umbrella' ? 'Umbrella beats tissue. Case law.' : 'Choped already!', s.x, s.y - 26, '#ff8fb1'); sfx(audio, 'ui_hover'); }
    else { say('Someone eating there lah!', s.x, s.y - 26, '#ffb347'); }
  };
  const claim = (s, mark, locked) => {
    if (s.reserved && s.reserved.target === s) { const a = s.reserved; s.reserved = null; if (a.target === s && S.aunties.includes(a)) retarget(a); if (S.diners.includes(a)) { a.target = null; a.state = 'leave'; } }
    s.state = 'tommy'; s.mark = mark; s.locked = !!locked; s.pulse = 1;
    S.chopes++; S.score += locked ? 14 : 10;
    say(locked ? '+14 LANYARD CHOPE' : '+10 CHOPE!', s.x, s.y - 24, '#7cff6b');
    onEvent?.({ type: 'chope', seats: mine() });
    updHud();
  };
  const litter = sh => {
    S.litter++; S.score -= 5;
    S.litterDecals.push({ x: sh.x1, y: sh.y1, r: Math.random() * 6 });
    say('LITTERING! Fine S$300 🚮', sh.x1, sh.y1 - 20, '#ff4d5e');
    sfx(audio, 'mission_failed');
    updHud();
  };
  const collect = pu => {
    S.pickups = S.pickups.filter(x => x !== pu);
    if (pu.kind === 'lanyard') { S.lanyard = 8; say('🪪 LANYARD: office-worker priority! Chopes can\'t be stolen', pu.x, pu.y - 26, '#ffd23f', true); for (const s of seats) if (s.state === 'tommy') s.locked = true; }
    else { S.umbrella += 1; say('☂️ UMBRELLA: next throw chopes 3 seats', pu.x, pu.y - 26, '#26e0ff', true); }
    sfx(audio, 'cash_register');
    updHud();
  };

  // ---------- input
  cv.addEventListener('pointerdown', e => { e.preventDefault(); cv.setPointerCapture?.(e.pointerId); const p = toWorld(e); S.mouse = { ...p, down: true }; S.lastDragSeat = nearestSeat(p); throwAt(p); });
  cv.addEventListener('pointermove', e => {
    const p = toWorld(e); S.mouse.x = p.x; S.mouse.y = p.y;
    S.hover = nearestSeat(p);
    if (S.mouse.down && S.hover && S.hover !== S.lastDragSeat && S.hover.state === 'empty') { S.lastDragSeat = S.hover; throwAt({ x: S.hover.x, y: S.hover.y }); }
  });
  const up = () => { S.mouse.down = false; };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);

  // ---------- intro
  updHud();
  const draw = makeRenderer(g, () => ({ scale, ox, oy, S, seats, tables, TOMMY }));
  scope.loop(() => { draw(); });
  await new Promise(resolve => {
    const go = () => { if (scope.paused) return; window.removeEventListener('keydown', k, true); card.remove(); resolve(); };
    const k = e => { if ((e.code === 'Space' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); go(); } };
    const card = h('div', { class: 'kp-intro' }, h('div', { class: 'kp-intro-c' },
      h('div', { class: 'pt-intro-k' }, 'SIDE GIG · CHOPE RAMPAGE'),
      h('div', { class: 'kp-intro-t cr-t' }, '12:00 PM. Lau Pa Sat.'),
      h('p', null, `Team lunch. Ken, Lance and the devs are still in the lift. Chope ${GOAL} seats before the aunties do. You have one weapon: tissue packets.`),
      h('ul', { class: 'pt-intro-l' },
        h('li', null, h('b', null, 'Click'), ' an empty seat to throw a packet — or ', h('b', null, 'drag'), ' across seats to chope in a sweep'),
        h('li', null, '☂️ Umbrella aunties steal tissue-choped seats. Umbrella beats tissue. This is case law.'),
        h('li', null, 'Grab ', h('b', null, '🪪 Lanyards'), ' (office priority: chopes can\'t be stolen) and ', h('b', null, '☂️ Umbrellas'), ' (chope 3 seats in one throw)'),
        h('li', null, 'Out of packets? Click the 🧻 tissue auntie. Miss a seat and it\'s littering — S$300 fine.')),
      h('button', { class: 'mg-btn mg-btn--primary mg-btn--big', onclick: go }, 'CHOPE!  ▸')));
    stage.append(card);
    window.addEventListener('keydown', k, true);
    scope.add(() => window.removeEventListener('keydown', k, true));
  });
  S.started = true;
  showBanner('LUNCH RUSH BEGINS!');
  if (opts.debug) window.__chope = { S, seats, throwAt, mine };

  // ---------- simulation
  const doneP = new Promise(resolve => {
    scope.loop(dt => {
      if (!dt || S.over) return !S.over;
      S.t += dt;
      const k = intensity();
      // waves
      if (S.wave === 0 && S.t > duration * 0.45) { S.wave = 1; showBanner('OFFICE CROWD ARRIVES!', 'is-warn'); for (let i = 0; i < 6; i++) scope.timeout(spawnDiner, i * 180); for (let i = 0; i < 3; i++) scope.timeout(spawnAuntie, 400 + i * 300); }
      if (S.wave === 1 && S.t > duration * 0.75) { S.wave = 2; showBanner('PEAK CHAOS: AUNTIE STAMPEDE', 'is-warn'); for (let i = 0; i < 5; i++) scope.timeout(spawnAuntie, i * 250); }
      S.auntieIn -= dt; if (S.auntieIn <= 0) { S.auntieIn = Math.max(0.6, 2.6 - k * 2) * (0.6 + Math.random() * 0.8); spawnAuntie(); }
      S.dinerIn -= dt; if (S.dinerIn <= 0) { S.dinerIn = Math.max(0.9, 2.2 - k * 1.2) * (0.6 + Math.random() * 0.8); spawnDiner(); }
      S.pickupIn -= dt; if (S.pickupIn <= 0) { S.pickupIn = 8 + Math.random() * 6; S.pickups.push({ kind: Math.random() < 0.5 ? 'lanyard' : 'umbrella', x: 160 + Math.random() * 960, y: 170 + Math.random() * 420, t: 0 }); }
      S.vendorIn -= dt;
      if (!S.vendor && S.vendorIn <= 0) { const left = Math.random() < 0.5; S.vendor = { x: left ? -20 : LW + 20, y: 600 + Math.random() * 30, vx: left ? 70 : -70, sold: false }; }
      if (S.vendor) { S.vendor.x += S.vendor.vx * dt; if (S.vendor.x < -40 || S.vendor.x > LW + 40) { S.vendor = null; S.vendorIn = 10 + Math.random() * 6; } }
      if (S.lanyard > 0) { S.lanyard = Math.max(0, S.lanyard - dt); if (S.lanyard === 0) say('Lanyard expired', TOMMY.x, TOMMY.y - 50, '#ffd23f'); }
      for (const pu of S.pickups) pu.t += dt;
      S.pickups = S.pickups.filter(pu => pu.t < 7.5);

      // diners
      for (const d of [...S.diners]) {
        if (d.state === 'walk') {
          if (!d.target || d.target.state !== 'empty' || d.target.reserved !== d) { d.state = 'leave'; continue; }
          if (step(d, d.target, dt)) { d.target.state = 'diner'; d.target.person = d.p; d.target.t = 8 + Math.random() * 12; d.target.reserved = null; S.diners = S.diners.filter(x => x !== d); }
        } else if (step(d, { x: d.x < LW / 2 ? -40 : LW + 40, y: d.y }, dt)) S.diners = S.diners.filter(x => x !== d);
      }
      for (const s of seats) if (s.state === 'diner') { s.t -= dt; if (s.t <= 0) { s.state = 'empty'; S.diners.push({ x: s.x, y: s.y, p: s.person, speed: 90, state: 'leave' }); s.person = null; } }
      // aunties
      for (const a of [...S.aunties]) {
        a.bob += dt * 10;
        if (a.state === 'hunt') {
          const s = a.target;
          if (!s) { retarget(a); continue; }
          if (s.reserved !== a || !(s.state === 'empty' || (s.state === 'tommy' && a.kind === 'umbrella' && !s.locked))) { retarget(a); continue; }
          if (step(a, s, dt)) {
            s.reserved = null;
            if (s.state === 'tommy') {
              s.state = 'auntie'; s.mark = 'umbrella'; s.locked = false; s.pulse = 1;
              S.lost++; S.score -= 8;
              say('UMBRELLA BEATS TISSUE! -8', s.x, s.y - 26, '#ff4d5e', true); sfx(audio, 'mission_failed');
              onEvent?.({ type: 'stolen', seats: mine() });
            } else { s.state = 'auntie'; s.mark = a.kind; s.pulse = 1; }
            s.t = 14 + Math.random() * 10;
            a.state = 'leave';
            updHud();
          }
        } else if (step(a, { x: 300 + (a.bob * 37 % 700), y: 80 }, dt)) S.aunties = S.aunties.filter(x => x !== a);
      }
      // auntie chopes eventually become diners (she comes back with food)
      for (const s of seats) if (s.state === 'auntie') { s.t -= dt; if (s.t <= 0) { s.state = 'diner'; s.mark = null; s.person = { ...person(), perm: true }; s.t = 8 + Math.random() * 8; } }
      // projectiles
      for (const sh of [...S.shots]) { sh.t += dt; if (sh.t >= sh.dur) { S.shots = S.shots.filter(x => x !== sh); land(sh); } }
      for (const f of S.floaters) f.t += dt;
      S.floaters = S.floaters.filter(f => f.t < 1.6);
      for (const s of seats) s.pulse = Math.max(0, s.pulse - dt * 1.5);
      if (S.lanyard <= 0) for (const s of seats) if (s.state === 'tommy' && s.mark !== 'lanyard') s.locked = false;
      updHud();
      if (S.t >= duration) { S.over = true; resolve(); return false; }
    });
  });
  await doneP;

  // ---------- results
  const held = mine();
  const score = Math.max(0, Math.round(S.score + held * 15 + (held >= GOAL ? 40 : 0)));
  const result = { seats: held, score };
  onEvent?.({ type: 'chope_done', ...result });
  sfx(audio, held >= GOAL ? 'crowd_cheer' : 'checkpoint');
  const verdict = held >= GOAL ? '"Wah, the whole team got seats. Ken is weeping into his chicken rice." ' : held >= GOAL / 2 ? '"Half the team eats standing. Lance says it\'s \'agile\'."' : '"The team da baos and eats in the lift lobby. Morale: low."';
  const card = h('div', { class: 'ng-res is-cr' },
    h('div', { class: 'ng-res-k' }, '1:00 PM — LUNCH OVER'),
    h('div', { class: 'ng-res-big' }, `${held} SEAT${held === 1 ? '' : 'S'}`, h('small', null, `CHOPED (GOAL ${GOAL})`)),
    h('div', { class: 'ng-res-grid' },
      h('div', null, h('b', null, String(score)), h('small', null, 'score')),
      h('div', null, h('b', null, String(S.chopes)), h('small', null, 'total chopes')),
      h('div', null, h('b', null, String(S.lost)), h('small', null, 'lost to umbrellas')),
      h('div', null, h('b', null, `S$${S.litter * 300}`), h('small', null, 'littering fines'))),
    h('div', { class: 'ng-res-q' }, verdict),
    h('button', { class: 'mg-btn mg-btn--primary mg-btn--big' }, 'Continue  ▸'));
  stage.append(h('div', { class: 'ng-res-wrap' }, card));
  requestAnimationFrame(() => card.classList.add('is-in'));
  await new Promise(resolve => {
    const fin = () => { if (scope.paused) return; sfx(audio, 'ui_select'); resolve(); };
    card.querySelector('button').onclick = fin;
    const k = e => { if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); fin(); } };
    scope.timeout(() => { window.addEventListener('keydown', k, true); scope.add(() => window.removeEventListener('keydown', k, true)); }, 600);
  });
  return result;
}

/** Moves `o` toward `t` at o.speed; returns true on arrival. */
function step(o, t, dt) {
  const dx = t.x - o.x, dy = t.y - o.y, d = Math.hypot(dx, dy), v = (o.speed || 80) * dt;
  if (d <= v) { o.x = t.x; o.y = t.y; return true; }
  o.x += dx / d * v; o.y += dy / d * v; o.dir = Math.atan2(dy, dx);
  return false;
}

function makeRenderer(g, get) {
  let fan = 0;
  return () => {
    const { scale, ox, oy, S, seats, tables, TOMMY } = get();
    const d = MG_DPR;
    fan += 0.06;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0d0a08'; g.fillRect(0, 0, g.canvas.width, g.canvas.height);
    g.setTransform(scale * d, 0, 0, scale * d, ox * d, oy * d);
    // floor
    g.fillStyle = '#d8d2c4'; g.fillRect(0, 0, LW, LH);
    g.strokeStyle = 'rgba(120,110,95,.18)'; g.lineWidth = 1;
    for (let x = 0; x <= LW; x += 40) { g.beginPath(); g.moveTo(x, 110); g.lineTo(x, LH); g.stroke(); }
    for (let y = 110; y <= LH; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(LW, y); g.stroke(); }
    // terrazzo speckle
    g.fillStyle = 'rgba(90,80,70,.12)';
    for (let i = 0; i < 260; i++) { const x = (i * 97.3) % LW, y = 110 + (i * 53.7) % (LH - 110); g.fillRect(x, y, 2, 2); }
    // stalls
    g.fillStyle = '#3a2d22'; g.fillRect(0, 0, LW, 110);
    STALLS.forEach(([name, zh, col], i) => {
      const x = 14 + i * 181, w = 170;
      g.fillStyle = col; roundRect(g, x, 8, w, 42, 6); g.fill();
      g.fillStyle = '#fff'; g.font = '700 15px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.fillText(name, x + w / 2, 27);
      g.font = '700 13px sans-serif'; g.fillStyle = 'rgba(255,240,200,.9)'; g.fillText(zh, x + w / 2, 44);
      g.fillStyle = '#c9c1b0'; g.fillRect(x, 56, w, 40);
      g.fillStyle = '#9a9080'; g.fillRect(x, 92, w, 8);
      g.fillStyle = `rgba(0,0,0,.15)`; g.fillRect(x + 10, 62, 40, 24); g.fillRect(x + 60, 62, 30, 24);
      g.fillStyle = '#e8e0cc'; g.beginPath(); g.arc(x + w - 30, 75, 12, 0, 7); g.fill();
    });
    // pillars
    g.fillStyle = '#b8b0a0';
    for (const [x, y] of [[80, 300], [1200, 300], [80, 540], [1200, 540]]) { g.beginPath(); g.arc(x, y, 18, 0, 7); g.fill(); }
    // litter decals
    for (const l of S.litterDecals) drawPacket(g, l.x, l.y, l.r, 0.75);
    // tables & seats
    for (const t of tables) {
      g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.arc(t.x + 4, t.y + 5, 33, 0, 7); g.fill();
      const tg = g.createRadialGradient(t.x - 10, t.y - 10, 4, t.x, t.y, 34); tg.addColorStop(0, '#ffffff'); tg.addColorStop(1, '#d9d9d4');
      g.fillStyle = tg; g.beginPath(); g.arc(t.x, t.y, 32, 0, 7); g.fill();
      g.strokeStyle = '#a9a9a2'; g.lineWidth = 2; g.stroke();
    }
    for (const s of seats) {
      const hov = S.hover === s && s.state === 'empty';
      g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.arc(s.x + 2, s.y + 3, 13, 0, 7); g.fill();
      g.fillStyle = s.hue; g.beginPath(); g.arc(s.x, s.y, 13, 0, 7); g.fill();
      if (s.state === 'tommy') {
        g.strokeStyle = s.locked ? '#ffd23f' : '#26e0ff'; g.lineWidth = 3 + s.pulse * 6;
        g.shadowColor = g.strokeStyle; g.shadowBlur = 12; g.beginPath(); g.arc(s.x, s.y, 16 + s.pulse * 6, 0, 7); g.stroke(); g.shadowBlur = 0;
      } else if (s.state === 'auntie') {
        g.strokeStyle = '#ff4d5e'; g.lineWidth = 2.5 + s.pulse * 4; g.beginPath(); g.arc(s.x, s.y, 16, 0, 7); g.stroke();
      } else if (hov) {
        g.strokeStyle = 'rgba(124,255,107,.9)'; g.lineWidth = 2; g.setLineDash([4, 3]); g.beginPath(); g.arc(s.x, s.y, 18, 0, 7); g.stroke(); g.setLineDash([]);
      }
      if (s.mark === 'tissue' || (s.state === 'tommy' && s.mark === 'tissue')) drawPacket(g, s.x, s.y, 0.3, 1);
      if (s.mark === 'umbrella') drawClosedUmbrella(g, s.x, s.y, s.state === 'tommy' ? '#26e0ff' : '#e85d75');
      if (s.mark === 'lanyard') drawLanyard(g, s.x, s.y);
      if (s.state === 'diner' && s.person) drawPerson(g, s.x, s.y, s.person, 0, 0.9, true);
    }
    // pickups
    for (const pu of S.pickups) {
      const a = Math.min(1, (7.5 - pu.t) * 2), bob = Math.sin(pu.t * 5) * 3;
      g.globalAlpha = a;
      g.fillStyle = pu.kind === 'lanyard' ? 'rgba(255,210,63,.3)' : 'rgba(38,224,255,.3)';
      g.beginPath(); g.arc(pu.x, pu.y + bob, 24 + Math.sin(pu.t * 8) * 3, 0, 7); g.fill();
      g.font = '28px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(pu.kind === 'lanyard' ? '🪪' : '☂️', pu.x, pu.y + bob);
      g.textBaseline = 'alphabetic'; g.globalAlpha = 1;
    }
    // diners walking (with trays)
    for (const dn of S.diners) { drawPerson(g, dn.x, dn.y, dn.p, dn.dir || 0, 1, false); if (dn.state === 'walk') { g.fillStyle = '#c7a26a'; g.fillRect(dn.x - 9, dn.y - 22, 18, 9); g.fillStyle = '#fff'; g.beginPath(); g.arc(dn.x, dn.y - 18, 4, 0, 7); g.fill(); } }
    // aunties
    for (const a of S.aunties) {
      drawPerson(g, a.x, a.y + Math.sin(a.bob) * 1.5, a.p, a.dir || 0, 1.05, false);
      if (a.kind === 'umbrella') {
        if (a.state === 'hunt') drawClosedUmbrella(g, a.x + 14, a.y - 4, a.umbCol, 0.8);
      } else if (a.state === 'hunt') drawPacket(g, a.x + 12, a.y - 6, 0.6, 0.9);
      if (a.state === 'hunt' && a.target) { g.strokeStyle = 'rgba(255,77,94,.25)'; g.setLineDash([3, 6]); g.lineWidth = 1.5; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(a.target.x, a.target.y); g.stroke(); g.setLineDash([]); }
    }
    // tissue vendor
    if (S.vendor) {
      const v = S.vendor;
      drawPerson(g, v.x, v.y, { cloth: '#7a6a5a', skin: '#c98e67', hair: '#9a9a9a', perm: true }, v.vx > 0 ? 0 : Math.PI, 1, false);
      g.fillStyle = 'rgba(255,210,63,.35)'; g.beginPath(); g.arc(v.x, v.y, 30 + Math.sin(fan * 4) * 3, 0, 7); g.fill();
      g.font = '700 13px "Barlow Condensed", sans-serif'; g.fillStyle = '#3a2a00'; g.textAlign = 'center';
      g.fillText(v.sold ? 'thank you ah boy!' : '🧻 TISSUE 3 FOR $1', v.x, v.y - 34);
    }
    // Tommy
    drawPerson(g, TOMMY.x, TOMMY.y, { cloth: 'hawaii', skin: '#d9a37e', hair: '#2b1a12', perm: false }, -Math.PI / 2, 1.25, false);
    g.font = '800 13px "Barlow Condensed", sans-serif'; g.fillStyle = '#26e0ff'; g.textAlign = 'center'; g.fillText('TOMMY', TOMMY.x, TOMMY.y + 34);
    // aim line
    if (S.started && !S.over) {
      g.strokeStyle = 'rgba(38,224,255,.35)'; g.lineWidth = 2; g.setLineDash([6, 8]);
      g.beginPath(); g.moveTo(TOMMY.x, TOMMY.y - 12); g.quadraticCurveTo((TOMMY.x + S.mouse.x) / 2, Math.min(TOMMY.y, S.mouse.y) - 80, S.mouse.x, S.mouse.y); g.stroke(); g.setLineDash([]);
    }
    // projectiles
    for (const sh of S.shots) {
      const f = sh.t / sh.dur, x = sh.x0 + (sh.x1 - sh.x0) * f, y = sh.y0 + (sh.y1 - sh.y0) * f, hgt = Math.sin(f * Math.PI) * (40 + Math.hypot(sh.x1 - sh.x0, sh.y1 - sh.y0) * 0.15);
      g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.ellipse(x, y, 7, 4, 0, 0, 7); g.fill();
      if (sh.umbrella) drawClosedUmbrella(g, x, y - hgt, '#26e0ff', 1 + hgt / 120);
      else drawPacket(g, x, y - hgt, sh.spin + f * 12, 1 + hgt / 140);
    }
    // ceiling fans (overlay)
    g.globalAlpha = 0.07;
    for (const [fx, fy] of [[330, 300], [950, 300], [640, 520]]) {
      g.fillStyle = '#111';
      for (let b = 0; b < 3; b++) { g.save(); g.translate(fx, fy); g.rotate(fan * 2 + b * 2.094); g.beginPath(); g.ellipse(55, 0, 55, 9, 0, 0, 7); g.fill(); g.restore(); }
      g.beginPath(); g.arc(fx, fy, 10, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
    // floaters
    for (const f of S.floaters) {
      const a = 1 - f.t / 1.6;
      g.globalAlpha = Math.max(0, a); g.textAlign = 'center';
      g.font = `800 italic ${f.big ? 22 : 16}px "Barlow Condensed", sans-serif`;
      g.lineWidth = 3; g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(f.text, f.x, f.y - f.t * 30);
      g.fillStyle = f.col; g.fillText(f.text, f.x, f.y - f.t * 30);
    }
    g.globalAlpha = 1;
  };
}

function roundRect(g, x, y, w, hh, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function drawPacket(g, x, y, rot, s = 1) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(s, s);
  g.fillStyle = '#fff'; g.fillRect(-9, -6, 18, 12);
  g.fillStyle = '#5aa9e6'; g.fillRect(-9, -6, 18, 4); g.fillStyle = '#ff8fb1'; g.fillRect(-3, 0, 6, 4);
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; g.strokeRect(-9, -6, 18, 12);
  g.restore();
}
function drawClosedUmbrella(g, x, y, col, s = 1) {
  g.save(); g.translate(x, y); g.rotate(-0.6); g.scale(s, s);
  g.fillStyle = col; g.beginPath(); g.moveTo(-16, 0); g.lineTo(10, -5); g.lineTo(10, 5); g.closePath(); g.fill();
  g.strokeStyle = '#333'; g.lineWidth = 2; g.beginPath(); g.moveTo(10, 0); g.lineTo(18, 0); g.arc(18, 4, 4, -Math.PI / 2, Math.PI / 2); g.stroke();
  g.restore();
}
function drawLanyard(g, x, y) {
  g.save(); g.translate(x, y);
  g.strokeStyle = '#c8102e'; g.lineWidth = 3; g.beginPath(); g.ellipse(0, -4, 10, 7, 0, 0, 7); g.stroke();
  g.fillStyle = '#fff'; g.fillRect(-6, 2, 12, 9); g.fillStyle = '#26a0e0'; g.fillRect(-6, 2, 12, 3);
  g.restore();
}
function drawPerson(g, x, y, p, dir, s = 1, seated = false) {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.ellipse(2, 4, 13, 9, 0, 0, 7); g.fill();
  g.rotate(dir + Math.PI / 2);
  // shoulders
  if (p.cloth === 'hawaii') {
    g.fillStyle = '#1aa6bf'; g.beginPath(); g.ellipse(0, 0, 15, 10, 0, 0, 7); g.fill();
    g.fillStyle = '#ff5fa2'; for (const [a, b] of [[-8, -3], [6, 4], [0, -5], [9, -3], [-5, 5]]) { g.beginPath(); g.arc(a, b, 2.2, 0, 7); g.fill(); }
    g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(-2, 3, 1.6, 0, 7); g.fill();
  } else { g.fillStyle = p.cloth; g.beginPath(); g.ellipse(0, 0, 14, 9, 0, 0, 7); g.fill(); }
  // head
  g.fillStyle = p.skin; g.beginPath(); g.arc(0, -1, 7, 0, 7); g.fill();
  g.fillStyle = p.hair;
  if (p.perm) { for (let i = 0; i < 7; i++) { const a = i / 7 * 6.283; g.beginPath(); g.arc(Math.cos(a) * 5, -1 + Math.sin(a) * 5 + 1.5, 3.4, 0, 7); g.fill(); } }
  else { g.beginPath(); g.arc(0, 0.5, 6.6, 0, 7); g.fill(); }
  g.restore();
}
