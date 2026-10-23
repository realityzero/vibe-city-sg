// Small DSP + randomness helpers shared by the audio modules. No three.js dependency.

export const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashInts(...xs) {
  let h = 2166136261 >>> 0;
  for (const x of xs) {
    h ^= x & 0xffff; h = Math.imul(h, 16777619);
    h ^= (x >>> 16) & 0xffff; h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return h >>> 0;
}

export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

/** Fills noise buffers once per context. Mono buffers feed one-shots; stereo ones feed ambience beds. */
export function makeNoiseBuffers(ctx) {
  const sr = ctx.sampleRate;
  const mk = (seconds, channels, fill) => {
    const b = ctx.createBuffer(channels, Math.floor(sr * seconds), sr);
    for (let c = 0; c < channels; c++) fill(b.getChannelData(c), c);
    return b;
  };
  const white = d => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; };
  const pink = d => {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
  };
  const brown = d => {
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
  };
  // Vinyl crackle: sparse clicks of random polarity + faint hiss, with occasional bigger pops.
  const crackle = d => {
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.012;
    const clicks = Math.floor(d.length / sr * 38);
    for (let k = 0; k < clicks; k++) {
      const p = Math.floor(Math.random() * (d.length - 40));
      const amp = (Math.random() < 0.08 ? 0.9 : 0.25) * (Math.random() < 0.5 ? -1 : 1) * Math.random();
      const len = 2 + Math.floor(Math.random() * 18);
      for (let j = 0; j < len; j++) d[p + j] += amp * Math.exp(-j / (len * 0.35)) * (j % 2 ? -0.6 : 1);
    }
  };
  return {
    white: mk(2, 1, white),
    pink: mk(2, 1, pink),
    brown: mk(2, 1, brown),
    whiteSt: mk(4, 2, white),
    pinkSt: mk(4, 2, pink),
    brownSt: mk(4, 2, brown),
    crackle: mk(3.7, 2, crackle),
  };
}

/** Generated stereo impulse response. gated=true makes the 80s "gated reverb" (dense, then hard cut). */
export function makeImpulse(ctx, { duration = 2.4, decay = 2.8, gated = false, predelay = 0.01, damping = 0.6 } = {}) {
  const sr = ctx.sampleRate, len = Math.floor(sr * duration);
  const buf = ctx.createBuffer(2, len, sr);
  const pd = Math.floor(predelay * sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = pd; i < len; i++) {
      const x = (i - pd) / (len - pd);
      let env;
      if (gated) env = x < 0.8 ? 0.9 - x * 0.35 : Math.max(0, (1 - x) / 0.2) * 0.6;
      else env = Math.pow(1 - x, decay);
      const n = Math.random() * 2 - 1;
      // progressively darker tail
      const k = 1 - damping * x * 0.95;
      lp = lp + k * (n - lp);
      d[i] = lp * env;
    }
  }
  return buf;
}

export function distortionCurve(amount = 4, n = 1024) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    c[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return c;
}

/** Tracks scheduled source nodes so a session can be cut short. Flat array of [node, end, node, end...]. */
export class Tracker {
  constructor() { this.items = []; }
  add(node, end) { this.items.push(node, end); }
  prune(now) {
    const a = this.items; let w = 0;
    for (let r = 0; r < a.length; r += 2) if (a[r + 1] > now) { a[w++] = a[r]; a[w++] = a[r + 1]; }
    a.length = w;
  }
  stopAll(t) {
    const a = this.items;
    for (let r = 0; r < a.length; r += 2) { try { a[r].stop(t); } catch { /* already stopped */ } }
    a.length = 0;
  }
}

/** setTargetAtTime only when the value meaningfully changes (keeps automation queues short). */
export function smooth(param, value, ctx, tc = 0.05, eps = 0.002) {
  const last = param._v;
  if (last !== undefined && Math.abs(last - value) <= eps * Math.max(1, Math.abs(value))) return;
  param._v = value;
  param.setTargetAtTime(value, ctx.currentTime, tc);
}

/** Instantly set (cancelling automation). */
export function setNow(param, value, ctx) {
  param.cancelScheduledValues(ctx.currentTime);
  param.setValueAtTime(value, ctx.currentTime);
  param._v = value;
}

export function makePanner(ctx, { ref = 5, max = 450, rolloff = 1, hrtf = false } = {}) {
  const p = ctx.createPanner();
  p.panningModel = hrtf ? 'HRTF' : 'equalpower';
  p.distanceModel = 'inverse';
  p.refDistance = ref;
  p.maxDistance = max;
  p.rolloffFactor = rolloff;
  return p;
}

export function setPannerPos(p, pos) {
  if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
  else p.setPosition(pos.x, pos.y, pos.z);
}
