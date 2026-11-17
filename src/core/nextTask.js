// A task boundary for long loads: lets taps, timers and rendering in between two slices of work.
// Not setTimeout(0): a timer set from inside a timer task counts as nested, and from the fifth level on browsers
// clamp it to >= 4 ms — every load step resumes inside the previous one's timer, so ~200 yields idled ~1 s of the
// load. A MessageChannel message is a fresh task without that clamp.
const ch = typeof MessageChannel !== 'undefined' && !(typeof location !== 'undefined' && location.search.includes('toyield')) ? new MessageChannel() : null; // ?toyield: setTimeout, for A/B
const waiting = [];
if (ch) ch.port1.onmessage = () => { const r = waiting.shift(); if (r) r(); };

/** resolves in a new task */
export function nextTask() {
  return new Promise(r => { if (!ch) { setTimeout(r, 0); return; } waiting.push(r); ch.port2.postMessage(0); });
}
