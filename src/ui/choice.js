// Dialogue choice list: number keys / arrows + Enter / mouse. Resolves with the picked index.
import { el, escapeHtml, wait } from './util.js';

export function showChoice(parent, prompt, options) {
  return new Promise(resolve => {
    const box = el('div', 'vc-choice vc-interactive');
    if (prompt) box.appendChild(el('div', 'q', prompt));
    const btns = options.map((o, i) => {
      const label = typeof o === 'string' ? o : o.label;
      const b = el('button', 'opt', `<span class="n">${escapeHtml(o.key || String(i + 1))}</span><span>${label}</span>`);
      b.onmouseenter = () => mark(i);
      b.onclick = () => pick(i);
      box.appendChild(b);
      return b;
    });
    let sel = 0, done = false;
    const mark = i => { sel = i; btns.forEach((b, k) => b.classList.toggle('sel', k === i)); };
    const pick = async i => {
      if (done) return; done = true;
      window.removeEventListener('keydown', key, true);
      mark(i); btns[i].classList.add('picked');
      await wait(380);
      box.remove();
      resolve(i);
    };
    const key = e => {
      if (e.target?.closest?.('input, textarea, [contenteditable]')) return;
      const keys = options.map((o, i) => (o.key || String(i + 1)).toUpperCase());
      const k = e.key.toUpperCase();
      let handled = true;
      if (keys.includes(k)) pick(keys.indexOf(k));
      else if (e.code === 'ArrowDown') mark((sel + 1) % btns.length);
      else if (e.code === 'ArrowUp') mark((sel + btns.length - 1) % btns.length);
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') pick(sel);
      else handled = false;
      if (handled) { e.preventDefault(); e.stopPropagation(); e.__uiHandled = true; }
    };
    window.addEventListener('keydown', key, true);
    mark(0);
    parent.appendChild(box);
  });
}
