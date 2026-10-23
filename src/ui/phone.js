// Smartphone call UI + text-message toasts.
import { ICONS } from './icons.js';
import { el, escapeHtml, wait } from './util.js';

const AVATAR_GRADS = [['#ff3fa4', '#7a2cff'], ['#2fe6ff', '#2a5cff'], ['#ffc94a', '#ff5f3d'], ['#59d96b', '#1b8f7a'], ['#c86bff', '#ff3fa4']];
const initials = n => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
const gradFor = n => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AVATAR_GRADS[h % AVATAR_GRADS.length]; };

export class Phone {
  /** @param {HTMLElement} parent  @param {import('./index.js').UI} ui */
  constructor(parent, ui) {
    this.ui = ui;
    this.root = el('div', 'vc-phone');
    this.root.innerHTML = `<div class="scr"><div class="notch"></div><div class="stat"><span class="clk">9:41</span><span>5G ▮▮▮</span></div>
      <div class="av"></div><div class="nm"></div><div class="st"></div>
      <div class="wave">${'<i></i>'.repeat(9)}</div>
      <div class="btns"><span class="dec">${ICONS.callEnd}</span><span class="acc">${ICONS.callAccept}</span></div></div>`;
    parent.appendChild(this.root);
    this.texts = el('div', 'vc-texts');
    parent.appendChild(this.texts);
    this.av = this.root.querySelector('.av'); this.nm = this.root.querySelector('.nm'); this.st = this.root.querySelector('.st');
    this.clk = this.root.querySelector('.clk');
    [...this.root.querySelectorAll('.wave i')].forEach((i, k) => { i.style.animationDelay = `${(k * 0.11) % 0.9}s`; });
    this._busy = Promise.resolve();
  }

  /**
   * Ring, connect, play the lines as subtitles, hang up.
   * @param {string} caller  @param {{speaker?:string,text:string,duration?:number}[]} lines
   * @param {{ring?:number}} opts ring time in ms (0 = answer instantly)
   */
  call(caller, lines, opts = {}) {
    const run = async () => {
      const [a, b] = gradFor(caller);
      this.av.style.background = `linear-gradient(135deg, ${a}, ${b})`;
      this.av.textContent = initials(caller);
      this.nm.textContent = caller;
      this.st.textContent = 'incoming call…';
      const now = this.ui._gameTime;
      if (now != null) { const m = Math.floor((((now % 24) + 24) % 24) * 60); this.clk.textContent = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; }
      this.root.classList.remove('connected', 'talking');
      this.root.classList.add('on', 'ringing');
      await wait(opts.ring ?? 1500);
      this.root.classList.remove('ringing');
      this.root.classList.add('connected');
      const t0 = performance.now();
      const tick = setInterval(() => { const s = Math.floor((performance.now() - t0) / 1000); this.st.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }, 250);
      this.st.textContent = '00:00';
      for (const ln of lines) {
        this.root.classList.toggle('talking', (ln.speaker || caller) !== 'Tommy');
        // opts.line(ln) -> { opts, sp }: the mission voices the line (earpiece filter) and sets the subtitle length
        const v = opts.line?.(ln);
        const onKey = e => { if (e.code === 'Enter' || e.code === 'NumpadEnter') opts.skip?.(); };
        if (v) addEventListener('keydown', onKey);
        try { await Promise.all([this.ui.subtitle(ln.text, { speaker: ln.speaker || caller, duration: v?.opts.duration ?? ln.duration, color: ln.color, source: 'phone' }), v?.sp]); }
        finally { if (v) removeEventListener('keydown', onKey); }
      }
      clearInterval(tick);
      this.root.classList.remove('talking');
      this.st.textContent = 'call ended';
      await wait(500);
      this.root.classList.remove('on', 'connected');
      await wait(450);
    };
    this._busy = this._busy.then(run, run);
    return this._busy;
  }

  text(from, message) {
    const t = el('div', 'vc-text');
    t.innerHTML = `<div class="ic">${ICONS.message}</div><div class="fr">${escapeHtml(from)}<span>now</span></div><div class="msg">${message}</div>`;
    this.texts.appendChild(t);
    this.ui._log({ speaker: `✉ ${from}`, text: message.replace(/<[^>]+>/g, '') });
    setTimeout(() => t.remove(), 6100);
    while (this.texts.children.length > 3) this.texts.firstElementChild.remove();
  }
}
