// Wave-2 UI: stunt banner + slow-mo replay look, cheat banner, taxi meter, photo mode, ped barks, collectibles.
import { el, wait, escapeHtml, fmtMoney, restartClass } from './util.js';

// ---------------------------------------------------------------- 7-segment LED digits (SVG)
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', ' ': '' };
const T = 1.9, GAP = 0.35, L = 1.6, R = 10.4, TOP = 1.4, MID = 10, BOT = 18.6;
const hseg = (y, x0, x1) => `${x0},${y} ${x0 + T / 2},${y - T / 2} ${x1 - T / 2},${y - T / 2} ${x1},${y} ${x1 - T / 2},${y + T / 2} ${x0 + T / 2},${y + T / 2}`;
const vseg = (x, y0, y1) => `${x},${y0} ${x + T / 2},${y0 + T / 2} ${x + T / 2},${y1 - T / 2} ${x},${y1} ${x - T / 2},${y1 - T / 2} ${x - T / 2},${y0 + T / 2}`;
const SEGPTS = {
  a: hseg(TOP, L + GAP, R - GAP), b: vseg(R, TOP + GAP, MID - GAP), c: vseg(R, MID + GAP, BOT - GAP), d: hseg(BOT, L + GAP, R - GAP),
  e: vseg(L, MID + GAP, BOT - GAP), f: vseg(L, TOP + GAP, MID - GAP), g: hseg(MID, L + GAP, R - GAP),
};
/** Renders `text` (digits, '-', ' ', '.', ':') as an LED SVG. Unlit segments stay faintly visible like a real meter. */
export function ledSVG(text, on = '#ff2b2b', off = 'rgba(255,43,43,.09)') {
  const cells = [];
  for (const ch of String(text)) {
    if (ch === '.' && cells.length) { cells[cells.length - 1].dp = true; continue; }
    if (ch === ':') { cells.push({ colon: true }); continue; }
    cells.push({ ch, dp: false });
  }
  let x = 0, body = '';
  for (const c of cells) {
    if (c.colon) {
      body += `<circle cx="${x + 2}" cy="6.5" r="1.1" fill="${on}"/><circle cx="${x + 2}" cy="13.5" r="1.1" fill="${on}"/>`;
      x += 4; continue;
    }
    const lit = SEG[c.ch] ?? '';
    for (const s of 'abcdefg') body += `<polygon points="${SEGPTS[s]}" transform="translate(${x} 0)" fill="${lit.includes(s) ? on : off}"/>`;
    body += `<circle cx="${x + 12.2}" cy="${BOT}" r="1" fill="${c.dp ? on : off}"/>`;
    x += 13.6;
  }
  return `<svg class="vc-led" viewBox="-1 0 ${x + 1} 20" style="aspect-ratio:${(x + 2) / 20}"><g transform="skewX(-7) translate(2 0)">${body}</g></svg>`;
}

// ---------------------------------------------------------------- stunt + slowmo
export function makeStunt(ui) {
  let chain = Promise.resolve();
  return {
    /** @param {{title?:string, lines?:string[], reward?:number}} o */
    show({ title = 'Insane Stunt Bonus', lines = [], reward = 0 } = {}) {
      const run = async () => {
        const rows = lines.map(l => {
          const m = String(l).match(/^(.*?)[\s:]+([-+\d.,]+\s*\S*)$/);
          return m ? `<div class="row"><span>${escapeHtml(m[1])}</span><b>${escapeHtml(m[2])}</b></div>` : `<div class="row"><span>${escapeHtml(l)}</span></div>`;
        }).join('');
        const b = el('div', 'vc-stunt', `<div class="t">${escapeHtml(title)}</div><div class="rows">${rows}</div>${reward ? `<div class="rw">${fmtMoney(reward)}</div>` : ''}`);
        ui._fx.appendChild(b);
        await wait(30); b.classList.add('vc-show');
        await wait(3800 + lines.length * 250);
        b.classList.remove('vc-show'); b.classList.add('out');
        await wait(500); b.remove();
      };
      chain = chain.then(run, run);
      return chain;
    },
  };
}

// ---------------------------------------------------------------- taxi meter
export function makeFare(ui, parent) {
  const box = el('div', 'vc-fare vc-hidden');
  box.innerHTML = `<div class="hd"><span class="flag">HIRED</span><span class="co">VIBE<i>CAB</i></span></div>
    <div class="ln big"><span class="k">FARE S$</span><span class="v fare"></span></div>
    <div class="ln"><span class="k">TIP S$</span><span class="v tip"></span></div>
    <div class="ln"><span class="k">TIME</span><span class="v time"></span></div>
    <div class="info"><div class="pax"></div><div class="dest"></div></div>`;
  parent.appendChild(box);
  const q = s => box.querySelector(s);
  const state = { fare: 0, tip: 0, timeLeft: null, passenger: '', dest: '' };
  const last = {};
  const render = () => {
    const f = Number(state.fare || 0).toFixed(2), t = Number(state.tip || 0).toFixed(2);
    if (f !== last.f) { q('.fare').innerHTML = ledSVG(f.padStart(6, ' ')); last.f = f; }
    if (t !== last.t) { q('.tip').innerHTML = ledSVG(t.padStart(5, ' '), '#ffb02b', 'rgba(255,176,43,.09)'); last.t = t; }
    const tl = state.timeLeft;
    const ts = tl == null ? '--:--' : `${String(Math.floor(Math.max(0, tl) / 60)).padStart(2, ' ')}:${String(Math.floor(Math.max(0, tl) % 60)).padStart(2, '0')}`;
    if (ts !== last.ts) { q('.time').innerHTML = ledSVG(ts, '#3dff7a', 'rgba(61,255,122,.08)'); last.ts = ts; }
    box.classList.toggle('urgent', tl != null && tl <= 10);
    if (state.passenger !== last.p) { q('.pax').innerHTML = state.passenger ? `<span>Passenger</span>${escapeHtml(state.passenger)}` : ''; last.p = state.passenger; }
    if (state.dest !== last.d) { q('.dest').innerHTML = state.dest ? `<span>To</span>${escapeHtml(state.dest)}` : ''; last.d = state.dest; }
    q('.flag').textContent = state.passenger ? 'HIRED' : 'FOR HIRE';
    q('.flag').classList.toggle('free', !state.passenger);
  };
  return {
    show(o = {}) { Object.assign(state, { fare: 0, tip: 0, timeLeft: null, passenger: '', dest: '' }, o); box.classList.remove('vc-hidden'); render(); },
    set(o = {}) { Object.assign(state, o); render(); },
    hide() { box.classList.add('vc-hidden'); },
    /** End-of-shift card. Resolves when it fades. */
    summary({ trips = 0, earned = 0 } = {}) {
      return ui._result('passed fare-sum',
        `<div class="big">Taxi Shift Over</div><div class="reward">S$${Number(earned).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div><div class="extra">${trips} ${trips === 1 ? 'trip' : 'trips'} · 5-star vibes</div>`, 3600);
    },
  };
}

// ---------------------------------------------------------------- photo mode
export function makePhoto(ui) {
  const ov = el('div', 'vc-photo vc-hidden');
  ov.innerHTML = `<div class="frame"><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i><i class="g v1"></i><i class="g v2"></i><i class="g h1"></i><i class="g h2"></i></div>
    <div class="top"><span class="lbl">Photo Mode</span><span class="filt"><kbd>F</kbd><b class="fname">None</b></span></div>
    <div class="hints"></div><div class="flash"></div>`;
  ui.root.appendChild(ov);
  const results = el('div', 'vc-polaroids vc-interactive');
  ui.root.appendChild(results);
  const hints = ov.querySelector('.hints'), fname = ov.querySelector('.fname'), flash = ov.querySelector('.flash');
  hints.innerHTML = [['W A S D', 'Fly'], ['Q / E', 'Down / up'], ['Scroll', 'Zoom'], ['F', 'Filter'], ['Space', 'Capture'], ['Esc', 'Exit']]
    .map(([k, v]) => `<span>${k.split(' / ').map(x => x.split(' ').map(y => `<kbd>${y}</kbd>`).join('')).join(' / ')} ${v}</span>`).join('');
  let opts = null, fi = 0, hudWas = true;
  const api = {
    isOpen: false,
    /** @param {{onCapture?:Function,onClose?:Function,filters?:string[],onFilter?:(name:string,index:number)=>void}} o */
    open(o = {}) {
      opts = { filters: ['None', 'Vice', 'Noir', 'Kodak 1986', 'Haze'], ...o };
      fi = 0; fname.textContent = opts.filters[0];
      hudWas = ui.hud.visible; ui.hud.setVisible(false);
      ov.classList.remove('vc-hidden'); api.isOpen = true;
      ui.root.classList.add('vc-photomode');
    },
    close() {
      if (!api.isOpen) return;
      api.isOpen = false; ov.classList.add('vc-hidden');
      ui.root.classList.remove('vc-photomode');
      ui.hud.setVisible(hudWas !== false);
      const cb = opts?.onClose; opts = null; cb?.();
    },
    nextFilter(dir = 1) {
      if (!opts) return;
      fi = (fi + dir + opts.filters.length) % opts.filters.length;
      fname.textContent = opts.filters[fi];
      restartClass(fname, 'pop');
      opts.onFilter?.(opts.filters[fi], fi);
    },
    capture() {
      if (!opts) return;
      restartClass(flash, 'go');
      ov.classList.add('snap'); setTimeout(() => ov.classList.remove('snap'), 260);
      opts.onCapture?.({ filter: opts.filters[fi] });
    },
    /** Polaroid toast with download link. */
    showResult(dataUrl, caption) {
      const cap = caption || `Vibe City · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      const name = `vibecity-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
      const p = el('div', 'vc-polaroid', `<div class="img" style="background-image:url('${dataUrl}')"></div><div class="cap">${escapeHtml(cap)}</div><a class="dl" download="${name}" href="${dataUrl}">⬇ Save photo</a>`);
      results.appendChild(p);
      while (results.children.length > 2) results.firstElementChild.remove();
      setTimeout(() => { p.classList.add('out'); setTimeout(() => p.remove(), 600); }, 9000);
    },
  };
  window.addEventListener('keydown', e => {
    if (!api.isOpen || e.__uiHandled) return;
    if (e.code === 'KeyF') { api.nextFilter(e.shiftKey ? -1 : 1); }
    else if (e.code === 'Space') { if (!e.repeat) api.capture(); }
    else if (e.code === 'Escape') { api.close(); }
    else return;
    e.preventDefault(); e.stopPropagation(); e.__uiHandled = true;
  }, true);
  return api;
}

// ---------------------------------------------------------------- barks
export function makeBarks(ui) {
  const layer = el('div', 'vc-barks');
  ui.root.insertBefore(layer, ui.root.firstChild.nextSibling);
  const live = [];
  /** Floating speech bubble anchored (bottom-centre) at screen px. Returns {move(x,y), remove()}. Max 3 alive. */
  return (text, x, y) => {
    const b = el('div', 'vc-bark', `<span>${text}</span>`);
    b.style.left = `${x}px`; b.style.top = `${y}px`;
    layer.appendChild(b);
    const h = {
      el: b,
      move(nx, ny) { b.style.left = `${nx}px`; b.style.top = `${ny}px`; },
      remove() { const i = live.indexOf(h); if (i >= 0) live.splice(i, 1); b.remove(); },
    };
    live.push(h);
    while (live.length > 3) live[0].remove();
    setTimeout(() => h.remove(), 2600);
    return h;
  };
}

// ---------------------------------------------------------------- collectibles
export function makeCollectibles(ui) {
  const st = { found: 0, total: 24, label: 'Kaya Toast' };
  return {
    get state() { return { ...st }; },
    /** Persistent count shown in pause → Stats. */
    set(found, total = st.total, label = st.label) { Object.assign(st, { found, total, label }); },
    /** Pickup feedback: special toast + count update. */
    pickup(found, total = st.total, label = st.label) {
      this.set(found, total, label);
      const t = el('div', 'vc-toast vc-collect', `<span class="ico">🍞</span><span><b>${escapeHtml(label.toUpperCase())}</b> ${found}/${total}</span>`);
      ui._toasts.appendChild(t);
      setTimeout(() => t.remove(), 3700);
    },
  };
}

// ---------------------------------------------------------------- cheat banner
export function makeCheat(ui) {
  const b = el('div', 'vc-cheat');
  ui._fx.appendChild(b);
  let t = 0;
  return name => {
    b.innerHTML = `<div class="t">Cheat Activated</div>${name ? `<div class="n">${escapeHtml(name)}</div>` : ''}`;
    restartClass(b, 'vc-show');
    clearTimeout(t); t = setTimeout(() => b.classList.remove('vc-show'), 3200);
    ui._log({ text: `<b>Cheat activated</b> ${escapeHtml(name || '')}` });
  };
}

