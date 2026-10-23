// Small DOM helpers shared by the UI modules.
export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
export const wait = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const fmtInt = n => Math.round(n).toLocaleString('en-US');
export function fmtMoney(n) { return `S$${fmtInt(n)}`; }
/** S$12.5M / S$850K style */
export function fmtCompact(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return `S$${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `S$${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `S$${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return `S$${Math.round(n)}`;
}
export const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** Wraps "Press F", "Hold Shift" etc. in <kbd>. Leaves text that already has <kbd> alone. */
export function keyify(text) {
  if (/<kbd>/.test(text)) return text;
  return text.replace(/\b(Press|Hold|Tap|press|hold|tap|Use|use)\s+(Space|Shift|Enter|Esc|Tab|Ctrl|Alt|LMB|RMB|[A-Z0-9](?![a-z]))/g, (_, verb, key) => `${verb} <kbd>${key}</kbd>`);
}
/** default subtitle duration in ms for a line of text */
export const lineMs = text => clamp(1800 + String(text).replace(/<[^>]+>/g, '').length * 55, 2400, 7500);

// restart a CSS animation/transition class without forcing a synchronous layout (no offsetWidth trick)
export function restartClass(node, cls) {
  node.classList.remove(cls);
  requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add(cls)));
}
