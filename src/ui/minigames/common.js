// Shared plumbing for the DOM minigames: element builder, disposable scope, meters, pause overlay.
import './minigames.css';
// canvas pixel ratio capped at 2: a 3x phone screen would make each full-screen minigame canvas ~12 MB
const MG_DPR = Math.min(2, window.devicePixelRatio || 1);

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const sleep = (scope, ms) => new Promise(res => scope.timeout(res, ms));
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const money = v => {
  if (v >= 1e9) return `S$ ${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `S$ ${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (v >= 1e3) return `S$ ${Math.round(v / 1e3)}K`;
  return `S$ ${Math.round(v)}`;
};

/** Collects listeners/timers/rafs so a minigame can tear itself down in one call. Timers respect pause. */
export class Scope {
  constructor() { this.disposers = []; this.paused = false; this.dead = false; this._rafs = new Set(); }
  on(target, type, fn, opts) { target.addEventListener(type, fn, opts); this.disposers.push(() => target.removeEventListener(type, fn, opts)); return fn; }
  timeout(fn, ms) {
    // pause-aware timeout: counts down only while not paused
    let left = ms, last = performance.now(), id = 0;
    const tick = () => {
      this._rafs.delete(id); // the set holds only pending frames
      if (this.dead) return;
      const now = performance.now();
      if (!this.paused) left -= now - last;
      last = now;
      if (left <= 0) { this._rafs.delete(id); fn(); return; }
      id = requestAnimationFrame(tick); this._rafs.add(id);
    };
    id = requestAnimationFrame(tick); this._rafs.add(id);
    return () => { cancelAnimationFrame(id); this._rafs.delete(id); };
  }
  /** per-frame loop with dt in seconds (0 while paused). Return false to stop. */
  loop(fn) {
    let last = performance.now(), id = 0, stopped = false;
    const step = now => {
      this._rafs.delete(id);
      if (this.dead || stopped) return;
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (fn(this.paused ? 0 : dt, now / 1000) === false) { stopped = true; this._rafs.delete(id); return; }
      id = requestAnimationFrame(step); this._rafs.add(id);
    };
    id = requestAnimationFrame(step); this._rafs.add(id);
    return () => { stopped = true; cancelAnimationFrame(id); this._rafs.delete(id); };
  }
  add(fn) { this.disposers.push(fn); }
  dispose() {
    if (this.dead) return;
    this.dead = true;
    for (const id of this._rafs) cancelAnimationFrame(id);
    this._rafs.clear();
    for (const d of this.disposers.splice(0).reverse()) { try { d(); } catch (e) { console.warn(e); } }
  }
}

export function meter(label, cls = '', { suffix = '', max = 100 } = {}) {
  const fill = h('div', { class: 'mg-meter-fill' });
  const val = h('span', { class: 'mg-meter-val' }, '0');
  const el = h('div', { class: `mg-meter ${cls}` },
    h('div', { class: 'mg-meter-head' }, h('span', { class: 'mg-meter-label' }, label), val),
    h('div', { class: 'mg-meter-track' }, fill));
  let cur = 0;
  return {
    el,
    get value() { return cur; },
    set(v, text) {
      cur = v;
      fill.style.width = `${clamp(v / max * 100)}%`;
      val.textContent = text ?? `${Math.round(v)}${suffix}`;
      el.classList.toggle('is-danger', v / max > 0.85 && cls.includes('invert'));
      el.classList.toggle('is-low', v / max < 0.2 && !cls.includes('invert'));
    },
    bump(kind = 'up') { el.classList.remove('bump-up', 'bump-down'); void el.offsetWidth; el.classList.add(`bump-${kind}`); },
  };
}

/**
 * Creates the full-screen minigame root inside `root`, wires Escape -> pause overlay and the
 * optional AbortSignal. Keyboard events are stopped at the overlay so the game underneath
 * doesn't move Tommy while the player types.
 */
export function mountShell(root, { kind, signal, onEvent, onPauseChange }) {
  const scope = new Scope();
  const shell = h('div', { class: `vc-mg vc-mg--${kind}`, tabindex: '-1' });
  root.append(shell);
  scope.add(() => shell.remove());
  const stop = e => { if (e.key !== 'F12') e.stopPropagation(); };
  scope.on(shell, 'keydown', stop);
  scope.on(shell, 'keyup', stop);
  scope.on(shell, 'keypress', stop);
  shell.focus({ preventScroll: true });

  let pauseEl = null;
  const setPaused = p => {
    if (p === scope.paused) return;
    scope.paused = p;
    onPauseChange?.(p);
    onEvent?.({ type: p ? 'pause' : 'resume' });
    if (p) {
      pauseEl = h('div', { class: 'mg-pause' },
        h('div', { class: 'mg-pause-card' },
          h('div', { class: 'mg-pause-title' }, 'PAUSED'),
          h('div', { class: 'mg-pause-sub' }, 'The investors are checking their phones.'),
          h('button', { class: 'mg-btn mg-btn--primary', onclick: () => setPaused(false) }, 'Resume  [Esc]')));
      shell.append(pauseEl);
      pauseEl.querySelector('button').focus();
    } else {
      pauseEl?.remove(); pauseEl = null;
      shell.focus({ preventScroll: true });
    }
  };
  const onKey = e => {
    if (scope.dead) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setPaused(!scope.paused); }
  };
  scope.on(window, 'keydown', onKey, true);

  let abortReject = null;
  const aborted = new Promise((_, rej) => { abortReject = rej; });
  aborted.catch(() => {});
  if (signal) {
    const ab = () => { abortReject(new DOMException('Minigame aborted', 'AbortError')); scope.dispose(); };
    if (signal.aborted) queueMicrotask(ab); else { signal.addEventListener('abort', ab, { once: true }); scope.add(() => signal.removeEventListener('abort', ab)); }
  }
  return { scope, shell, setPaused, aborted };
}

/** Wraps a minigame body so abort rejects and finish disposes. */
export function runShell(body, shellCtx) {
  return Promise.race([body, shellCtx.aborted]).finally(() => shellCtx.scope.dispose());
}

/** Streams text into an element, char by char; resolves when done. Click on `skipEl` finishes immediately. */
export function typeText(scope, el, text, cps = 70, skipEl) {
  return new Promise(res => {
    let i = 0, acc = 0, done = false;
    const finish = () => { if (done) return; done = true; el.textContent = text; stopLoop(); res(); };
    if (skipEl) { const f = () => finish(); skipEl.addEventListener('click', f, { once: true }); scope.add(() => skipEl.removeEventListener('click', f)); }
    const stopLoop = scope.loop(dt => {
      acc += dt * cps;
      const n = Math.floor(acc);
      if (n > 0) { acc -= n; i = Math.min(text.length, i + n); el.textContent = text.slice(0, i); }
      if (i >= text.length) { finish(); return false; }
    });
  });
}

/** Little confetti burst on a canvas covering `host`. */
export function confetti(scope, host, { count = 160, colors = ['#ff3ea5', '#26e0ff', '#ffd23f', '#7cff6b', '#b388ff', '#ffffff'], duration = 4 } = {}) {
  const c = h('canvas', { class: 'mg-confetti' });
  host.append(c);
  const ctx = c.getContext('2d');
  const resize = () => { c.width = host.clientWidth * MG_DPR; c.height = host.clientHeight * MG_DPR; };
  resize();
  const W = () => c.width, H = () => c.height;
  const parts = Array.from({ length: count }, () => ({
    x: W() * (0.2 + Math.random() * 0.6), y: H() * 0.45, vx: (Math.random() - 0.5) * 18 * MG_DPR, vy: -(8 + Math.random() * 16) * MG_DPR,
    r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.4, w: (6 + Math.random() * 8) * MG_DPR, hgt: (3 + Math.random() * 5) * MG_DPR, col: pick(colors),
  }));
  let t = 0;
  scope.loop(dt => {
    t += dt;
    ctx.clearRect(0, 0, W(), H());
    for (const p of parts) {
      p.vy += 0.45 * MG_DPR * dt * 60; p.vx *= 0.99; p.x += p.vx * dt * 60; p.y += p.vy * dt * 60; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.globalAlpha = Math.max(0, 1 - t / duration);
      ctx.fillStyle = p.col; ctx.fillRect(-p.w / 2, -p.hgt / 2, p.w, p.hgt * Math.abs(Math.cos(p.r * 2))); ctx.restore();
    }
    if (t > duration) { c.remove(); return false; }
  });
}

export function sfx(audio, name) { try { audio?.sfx?.(name); } catch { /* audio is optional */ } }

/** Voice a minigame line with its recorded take (role from src/audio/cast.js). Lines without a recording stay
 *  subtitle-only (logged in development so they can be rendered).
 *  interrupt: cut whatever line is playing first. Returns a promise for the end of the line, or null. */
export function voice(audio, role, text, { interrupt = true } = {}) {
  try {
    const v = audio?.voice;
    if (!role || !text || !v) return null;
    if (/^\s*\*[^*]+\*\s*$/.test(text)) return null; // *stage direction*: shown, never spoken
    if (!v.hasVO?.(role, text)) { v.noteMissing?.(role, text); return null; }
    if (interrupt) v.stopDialogue();
    else if (v.dialogue > 0) return null;
    return audio.say(text, { voice: role });
  } catch { return null; }
}
