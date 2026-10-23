// Procedural human body + clothing geometry, built in the rest (bind) pose.
// Rest pose: standing, arms hanging slightly out (A-ish), feet at y = 0, facing -z (forward). Right side = +x.
import * as THREE from 'three';
import { cellUV, WHITE_UV } from './atlas.js';

export const BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'shoulderL', 'upperArmL', 'lowerArmL', 'handL', 'shoulderR', 'upperArmR', 'lowerArmR', 'handR', 'upperLegL', 'lowerLegL', 'footL', 'upperLegR', 'lowerLegR', 'footR'];
export const PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 7, 2, 9, 10, 11, 0, 13, 14, 0, 16, 17];
export const B = Object.fromEntries(BONES.map((n, i) => [n, i]));

export function makeRest(body = {}) {
  const fem = body.fem || 0, g = Math.max(0, body.girth || 0);
  const sx = 0.183 - 0.017 * fem + 0.024 * g;
  const lx = 0.090 + 0.005 * fem + 0.016 * g;
  const R = { hips: [0, 0.96, 0], spine: [0, 1.06, 0], chest: [0, 1.24, 0], neck: [0, 1.49, 0.008], head: [0, 1.55, 0.008] };
  for (const [s, k] of [[-1, 'L'], [1, 'R']]) {
    R['shoulder' + k] = [s * 0.035, 1.445, 0];
    R['upperArm' + k] = [s * sx, 1.445, 0.004];
    R['lowerArm' + k] = [s * (sx + 0.021), 1.155, 0.012];
    R['hand' + k] = [s * (sx + 0.03), 0.905, 0.004];
    R['upperLeg' + k] = [s * lx, 0.935, 0];
    R['lowerLeg' + k] = [s * (lx + 0.003), 0.515, 0.006];
    R['foot' + k] = [s * (lx + 0.005), 0.088, 0.014];
  }
  return R;
}

// ---------- small math helpers ----------
const clamp01 = x => Math.max(0, Math.min(1, x));
export const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const bump = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));
const lerp = (a, b, t) => a + (b - a) * t;
const sup = (th, n) => { const c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th)); return 1 / Math.pow(Math.pow(c, n) + Math.pow(s, n), 1 / n); };
const tmpC = new THREE.Color();
export const lin = hex => { tmpC.setHex(hex); return [tmpC.r, tmpC.g, tmpC.b]; };
const mixC = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mulC = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const norm3 = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const wrapU = u => u - Math.floor(u);

// material params: [roughness, metalness, sss]
const RM = {
  skin: [0.58, 0, 1], cloth: [0.86, 0, 0], denim: [0.92, 0, 0], silk: [0.55, 0, 0], leather: [0.38, 0, 0], rubber: [0.8, 0, 0],
  hair: [0.62, 0, 0], eye: [0.12, 0, 0], iris: [0.08, 0, 0], gold: [0.28, 1, 0], silver: [0.3, 1, 0], lens: [0.05, 0.4, 0], plastic: [0.35, 0, 0], lips: [0.42, 0, 1],
};

// ---------- profiles ----------
const TORSO = [ // y, rx, rz, zc
  [1.525, 0.054, 0.050, 0.012], [1.502, 0.088, 0.070, 0.012], [1.48, 0.138, 0.091, 0.010], [1.456, 0.172, 0.105, 0.008],
  [1.42, 0.183, 0.114, 0.004], [1.36, 0.182, 0.121, 0.0], [1.29, 0.172, 0.123, -0.004], [1.23, 0.160, 0.118, -0.002],
  [1.16, 0.149, 0.110, 0.002], [1.10, 0.143, 0.104, 0.004], [1.04, 0.148, 0.105, 0.006], [0.98, 0.158, 0.110, 0.008],
  [0.92, 0.164, 0.113, 0.010], [0.875, 0.152, 0.106, 0.012], [0.845, 0.118, 0.082, 0.012], [0.828, 0.0, 0.0, 0.012],
];
const ARM = [ // y, r
  [1.472, 0.0], [1.468, 0.03], [1.45, 0.047], [1.41, 0.050], [1.35, 0.047], [1.29, 0.044], [1.23, 0.040], [1.185, 0.036],
  [1.155, 0.035], [1.12, 0.039], [1.06, 0.040], [1.00, 0.035], [0.95, 0.029], [0.92, 0.026], [0.898, 0.024], [0.882, 0.0],
];
const LEG = [ // y, r
  [0.995, 0.0], [0.985, 0.070], [0.945, 0.087], [0.86, 0.086], [0.78, 0.079], [0.70, 0.071], [0.62, 0.062], [0.56, 0.055],
  [0.515, 0.052], [0.47, 0.053], [0.41, 0.058], [0.34, 0.058], [0.27, 0.050], [0.20, 0.042], [0.14, 0.036], [0.10, 0.034],
  [0.075, 0.032], [0.06, 0.0],
];
function interp(table, y, col) {
  if (y >= table[0][0]) return table[0][col];
  for (let i = 1; i < table.length; i++) if (y >= table[i][0]) { const a = table[i - 1], b = table[i]; return lerp(b[col], a[col], (y - b[0]) / (a[0] - b[0])); }
  return table[table.length - 1][col];
}

/** Body shape functions shared by hero and crowd builders. */
export function makeShape(body = {}) {
  const fem = body.fem || 0, g = body.girth || 0, gp = Math.max(0, g);
  const torso = y => {
    let rx = interp(TORSO, y, 1), rz = interp(TORSO, y, 2); const zc = interp(TORSO, y, 3);
    if (fem) {
      rx *= lerp(1, 0.88, smooth(1.36, 1.44, y));                  // narrower shoulders
      rx *= 1 - 0.13 * fem * bump(y, 1.12, 0.07);                     // waist
      rz *= 1 - 0.07 * fem * bump(y, 1.12, 0.07);
      rx *= 1 + 0.08 * fem * bump(y, 0.93, 0.06);                     // hips
    }
    const k = 1 + 0.22 * g * smooth(1.46, 1.38, y);
    return { rx: rx * k, rz: rz * (1 + 0.25 * g * smooth(1.46, 1.38, y)), zc };
  };
  const torsoZF = (th, y) => {
    const fr = Math.max(0, -Math.sin(th)), bk = Math.max(0, Math.sin(th));
    let dz = 0;
    dz -= 0.007 * (1 - fem) * bump(y, 1.32, 0.05) * fr * fr;                                         // pecs
    dz -= fem * 0.036 * bump(y, 1.295, 0.05) * Math.pow(fr, 3) * Math.exp(-(((Math.abs(Math.cos(th)) - 0.48) / 0.32) ** 2)); // bust
    dz -= (0.006 + 0.075 * gp) * bump(y, 1.07, 0.11) * Math.pow(fr, 1.6);                            // belly
    dz += (0.018 + 0.022 * fem + 0.015 * gp) * bump(y, 0.905, 0.055) * bk * bk;                      // seat
    dz += 0.006 * bump(y, 1.33, 0.06) * bk * bk;                                                      // shoulder blades
    return dz;
  };
  const armR = y => interp(ARM, y, 1) * 1.08 * (1 - 0.15 * fem) * (1 + 0.3 * gp);
  const legR = y => interp(LEG, y, 1) * (1 + 0.04 * fem * smooth(0.6, 0.85, y) - 0.08 * fem * smooth(0.5, 0.3, y)) * (1 + 0.22 * gp);
  return { fem, g, gp, torso, torsoZF, armR, legR };
}

export const HEAD_C = [0, 1.648, 0.008];
export function headRadius(d, fem = 0) {
  let rx = 0.080, ry = 0.116, rz = 0.100;
  const low = smooth(-0.25, -0.9, d[1]);
  rx *= 1 - (0.2 + 0.06 * fem) * low * (d[2] < 0 ? 1 : 0.55);
  if (d[2] > 0) rz *= 1.05 + 0.05 * smooth(-0.2, 0.5, d[1]);
  else rz *= 0.985 - 0.02 * bump(d[1], 0.25, 0.25);
  rx *= 1 + 0.04 * bump(d[1], -0.05, 0.2) * smooth(-0.1, -0.7, d[2]); // cheekbones
  let r = 1 / Math.sqrt((d[0] / rx) ** 2 + (d[1] / ry) ** 2 + (d[2] / rz) ** 2);
  r += 0.007 * Math.exp(-((d[0] / 0.25) ** 2 + ((d[1] + 0.78) / 0.18) ** 2 + ((d[2] + 0.6) / 0.3) ** 2)); // chin
  return r * (1 - 0.03 * fem);
}
export const EYE_DIR = s => [s * 0.335, 0.035, -0.94];
export function headPoint(d, fem = 0, inset = 0) { const n = norm3(d); const r = headRadius(n, fem) - inset; return [HEAD_C[0] + n[0] * r, HEAD_C[1] + n[1] * r, HEAD_C[2] + n[2] * r]; }

// hairline threshold: hair covers directions with d.y above this (by azimuth from the front)
function hairThreshold(az, front, temple, ear, behind, back) {
  const a = Math.abs(az);
  const pts = [[0, front], [0.75, temple], [1.45, ear], [2.1, behind], [2.7, back], [Math.PI, back]];
  for (let i = 1; i < pts.length; i++) if (a <= pts[i][0]) return lerp(pts[i - 1][1], pts[i][1], smooth(pts[i - 1][0], pts[i][0], a));
  return back;
}
const pomp = d => smooth(0.5, 0.78, d[1]) * smooth(0.0, -0.6, d[2]);
// thr = hairline height (d.y) at azimuth: [front, temple, ear, behind ear]; the nape is behind - 0.35
export const HAIR_STYLES = {
  slick: { thr: [0.62, 0.50, 0.30, -0.1], thick: d => (0.004 + 0.012 * Math.max(0, d[1]) ** 1.5) + 0.016 * pomp(d), side: true, uvAxis: 'z' },
  short: { thr: [0.60, 0.50, 0.30, -0.08], thick: d => 0.007 + 0.007 * Math.max(0, d[1]) + 0.004 * pomp(d), uvAxis: 'y' },
  buzz: { thr: [0.63, 0.53, 0.32, -0.05], thick: () => 0.003, uvAxis: 'y' },
  curly: { thr: [0.56, 0.46, 0.24, -0.15], thick: d => 0.018 + 0.012 * Math.max(0, d[1]) + 0.007 * Math.sin(d[0] * 38) * Math.sin(d[1] * 41) * Math.sin(d[2] * 37), uvAxis: 'y' },
  bob: { thr: [0.48, 0.25, -0.38, -0.40], thick: d => 0.02 + 0.014 * (1 - Math.max(0, d[1])) + 0.004 * Math.sin(d[0] * 30) * Math.sin(d[1] * 33), uvAxis: 'y' },
  long: { thr: [0.58, 0.40, -0.25, -0.45], thick: d => 0.012 + 0.006 * Math.max(0, d[1]), drape: true, uvAxis: 'y' },
  bun: { thr: [0.60, 0.46, 0.12, -0.3], thick: d => 0.007 + 0.004 * Math.max(0, d[1]), bun: true, uvAxis: 'y' },
  ponytail: { thr: [0.60, 0.46, 0.12, -0.3], thick: d => 0.007 + 0.004 * Math.max(0, d[1]), tail: true, uvAxis: 'y' },
  bald: { bald: true, thr: [0, 0, 0, 0], thick: () => 0.003, uvAxis: 'y' },
};
const EAR_DIR = norm3([1, -0.03, 0.06]);
/** signed margin (>0 inside the hair region) for a head direction */
export function hairMargin(style, d) {
  const az = Math.atan2(d[0], -d[2]);
  if (style.bald) {
    const ed = Math.acos(Math.min(1, Math.abs(d[0]) * EAR_DIR[0] + d[1] * EAR_DIR[1] + d[2] * EAR_DIR[2]));
    return Math.min(d[1] + 0.5, 0.18 - d[1] + 0.25 * smooth(1.6, 3.0, Math.abs(az)), (Math.abs(az) - 1.0) * 0.6, ed - 0.32);
  }
  const t = style.thr;
  let thr = hairThreshold(az, t[0], t[1], t[2], t[3], t[3] - 0.35);
  if (style.side) thr = Math.min(thr, lerp(thr, -0.25, bump(Math.abs(az), 1.3, 0.09)));
  return d[1] - thr;
}
export function hairCovered(style, d) { return hairMargin(style, d) > 0; }
/** shell radius for a hair style: grows out of the scalp smoothly so the hairline is clean at any mesh resolution */
export function hairShellRadius(style, d, fem = 0, crisp = false) {
  const hr = headRadius(d, fem);
  const m = hairMargin(style, d);
  if (crisp) return m >= 0 ? hr + 0.0015 + style.thick(d) * smooth(0, 0.07, m) : hr + 0.0015 - 0.011 * smooth(0, -0.03, m);
  const cov = smooth(-0.025, 0.035, m);
  return hr + style.thick(d) * cov - 0.009 * (1 - cov);
}

// ---------- hero character ----------
export function buildCharacter(b, spec, rest, lod = 'high') {
  const hi = lod !== 'low';
  const body = spec.body || {};
  const shape = makeShape(body);
  const fem = shape.fem;
  const top = spec.top, bot = spec.bottom, shoes = spec.shoes;
  const acc = new Set(spec.acc || []);
  const skin = lin(spec.skin), hairC = lin(spec.hair);
  const topC = lin(top.color), botC = lin(bot.color);
  const topTex = top.tex || 'plain', botTex = bot.tex || 'plain';
  const W1 = name => [[B[name], 1]];
  const skinD = (uv, extra = {}) => ({ col: skin, rm: RM.skin, uv: uv || cellUV('skin', 0.5, 0.5), ...extra });

  // ---------------- torso ----------------
  const tuck = !top.untucked;
  const hemY = tuck ? 0.955 : top.type === 'suit' ? 0.872 : top.type === 'blouse' ? 0.885 : 0.866;
  const loose = top.loose ?? 0.5;
  const vDepth = top.open || 0;
  const yv = 1.462 - vDepth * 0.17;
  const vNeck = top.type === 'shirt' || top.type === 'suit' || top.type === 'blouse' || top.type === 'polo' || top.type === 'uniform';
  const isSuit = top.type === 'suit';
  const innerC = lin(top.inner ?? 0xffffff), lapelC = lin(top.lapel ?? top.color), tieC = top.tie != null ? lin(top.tie) : null;
  const vestC = top.vest != null ? lin(top.vest) : null;
  const ys = new Set(TORSO.map(r => r[0]));
  for (const y of [1.20, 1.06, 0.95]) ys.add(y);
  const rings = [];
  const pushRing = (y, zone, dr = 0) => {
    const t = shape.torso(y);
    const k = t.rx > 0 ? 1 : 0;
    rings.push({ c: [0, y, t.zc], rx: k ? t.rx + dr : 0, rz: k ? t.rz + dr * 0.85 : 0, zone, m: th => sup(th, 2.4), zf: th => k ? shape.torsoZF(th, y) : 0 });
  };
  const sorted = [...ys].sort((a, b) => b - a);
  const topDr = y => (0.004 + 0.006 * loose) * smooth(1.44, 1.36, y) + (vestC ? 0.008 * smooth(1.45, 1.38, y) : 0);
  for (const y of sorted) {
    if (y > hemY + 0.006) pushRing(y, 'top', topDr(y));
    if (!tuck && y < hemY && y >= 0.845) pushRing(y, 'bot', 0.006);
    if (tuck && y < hemY - 0.03 && y >= 0.845) pushRing(y, 'bot', 0.006);
    if (y < 0.845) pushRing(y, 'bot', 0);
    // insert hem rings between table rows
    const next = sorted[sorted.indexOf(y) + 1];
    if (next !== undefined && y > hemY && next <= hemY) {
      if (tuck) { pushRing(hemY + 0.004, 'top', topDr(hemY) - 0.002); pushRing(hemY, 'belt', 0.008); pushRing(hemY - 0.026, 'belt', 0.008); pushRing(hemY - 0.03, 'bot', 0.006); }
      else { pushRing(hemY + 0.005, 'top', topDr(hemY) + 0.012 + 0.006 * loose); pushRing(hemY, 'top', topDr(hemY) + 0.012 + 0.006 * loose - 0.006); pushRing(hemY - 0.001, 'bot', 0.006); }
    }
  }
  rings.sort((a, b) => b.c[1] - a.c[1]);
  const beltC = lin(0x2a1d16);
  const packHex = h => (h >>> 0) & 0xffffff;
  let garKind = 0;
  if (vNeck && vDepth > 0) garKind = isSuit ? 2 : 1;
  else if (top.type === 'singlet') garKind = 3;
  else if (top.type === 'shirt' && !top.buttons) garKind = 4;
  const gar2 = [yv, packHex(isSuit ? (top.inner ?? 0xffffff) : spec.skin), packHex(top.lapel ?? top.color), top.tie != null ? packHex(top.tie) : -1];
  b.tube(rings, hi ? 48 : 16, (r, th, p, n, ring, u) => {
    const y = p[1], x = p[0];
    const w = torsoWeights(y);
    const topUV = cellUV(topTex, u, clamp01((1.53 - y) / 0.72));
    if (ring.zone === 'bot') return { w, col: botC, rm: botTex === 'denim' ? RM.denim : RM.cloth, uv: cellUV(botTex, u * 0.6, clamp01((1.0 - y) * 0.9)) };
    if (ring.zone === 'belt') return { w, col: beltC, rm: RM.leather };
    const sn = Math.sin(th);
    let col = topC, rm = top.tex === 'denim' ? RM.denim : RM.cloth, uv = topUV;
    if (vestC && y < 1.475) col = vestC;
    if ((top.type === 'tee' || top.type === 'hoodie') && y > 1.488) col = mulC(col, 0.85);
    if (top.type === 'uniform') {
      for (const s of [-1, 1]) if (sn < -0.4 && Math.abs(x - s * 0.078) < 0.038 && y > 1.285 && y < 1.36) col = mulC(topC, y > 1.345 ? 0.7 : 0.88);
    }
    if (top.type === 'hoodie' && sn < -0.5 && y < 1.07 && y > 0.93 && Math.abs(x) < 0.11) col = mulC(col, 0.9); // pocket
    // necklines are resolved per-pixel in the shader (crisp V / lapels / tie / singlet holes)
    const gar = garKind ? [x, y, sn, garKind] : null;
    return { w, col, rm, uv, gar, gar2 };
  }, Math.PI / 2);
  function torsoWeights(y) {
    const out = [];
    const a = smooth(0.97, 1.11, y), c = smooth(1.13, 1.26, y), nk = smooth(1.49, 1.53, y);
    const wh = 1 - a, wsp = a * (1 - c), wch = c * (1 - nk), wnk = nk;
    if (wh > 0.001) out.push([B.hips, wh]);
    if (wsp > 0.001) out.push([B.spine, wsp]);
    if (wch > 0.001) out.push([B.chest, wch]);
    if (wnk > 0.001) out.push([B.neck, wnk]);
    return out.length ? out : [[B.hips, 1]];
  }
  const torsoSurface = (th, y, out = 0) => { // point on torso surface (shirt layer) for accessories
    const t = shape.torso(y); const m = sup(th, 2.4); const dr = y > hemY ? topDr(y) : 0;
    return [Math.cos(th) * (t.rx + dr + out) * m, y, t.zc + Math.sin(th) * (t.rz + (dr + out) * 0.85) * m + shape.torsoZF(th, y)];
  };

  // suit jacket skirt / dress skirt
  const legBlend = (x, y, y0, y1, k) => {
    const t = smooth(y0, y1, y) * k, fL = smooth(0.05, -0.05, x);
    return [[B.hips, 1 - t], [B.upperLegL, t * fL], [B.upperLegR, t * (1 - fL)]].filter(e => e[1] > 0.001);
  };
  const skirtTube = (y0, y1, r0add, flare, col, rmv, tex, k) => {
    const rs = [];
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const y = lerp(y0, y1, i / n);
      const t = shape.torso(Math.max(y, 0.9));
      const add = r0add + flare * (i / n);
      rs.push({ c: [0, y, t.zc + 0.004], rx: t.rx + add, rz: t.rz + add * 0.9 + 0.01 * (i / n), m: th => sup(th, 2.2), zf: th => shape.torsoZF(th, Math.max(y, 0.9)) * 0.6 });
    }
    rs.push({ c: [0, y1 + 0.002, rs[n].c[2]], rx: rs[n].rx - 0.006, rz: rs[n].rz - 0.006 });
    rs.push({ c: [0, y1 + 0.05, rs[n].c[2]], rx: 0.0, rz: 0.0 });
    b.tube(rs, hi ? 40 : 14, (r, th, p, nn, ring, u) => ({ w: legBlend(p[0], p[1], y0, y1, k), col: r >= n + 1 ? mulC(col, 0.5) : col, rm: rmv, uv: cellUV(tex, u, clamp01((y0 - p[1]) * 1.5)) }), Math.PI / 2);
  };
  if (isSuit && !tuck) skirtTube(0.90, 0.80, 0.014, 0.016, topC, RM.cloth, topTex, 0.35);
  if (bot.type === 'skirt') skirtTube(0.97, 0.53, 0.010, 0.022, botC, RM.cloth, botTex, 0.7);

  // ---------------- neck ----------------
  {
    const nr = 0.056 * (1 - 0.15 * fem) * (1 + 0.25 * shape.gp);
    const rs = [];
    for (const [y, k] of [[1.605, 0.92], [1.57, 0.95], [1.535, 1.0], [1.505, 1.06], [1.475, 1.18]]) rs.push({ c: [0, y, 0.014], rx: nr * k, rz: nr * 0.95 * k });
    b.tube(rs, hi ? 20 : 10, (r, th, p, n, ring, u) => {
      const y = p[1];
      const t = smooth(1.55, 1.595, y), c = smooth(1.52, 1.48, y);
      const w = [[B.neck, 1 - t - c * 0.5], [B.head, t], [B.chest, c * 0.5]].filter(e => e[1] > 0.001);
      // Adam's apple / throat shading
      return { w, col: skin, rm: RM.skin, uv: cellUV('skin', u, y - 1.4) };
    });
  }

  // ---------------- arms ----------------
  for (const s of [-1, 1]) {
    const K = s < 0 ? 'L' : 'R';
    const ua = rest['upperArm' + K], hd = rest['hand' + K];
    const ax = y => lerp(hd[0], ua[0], (y - hd[1]) / (ua[1] - hd[1]));
    const az = y => lerp(hd[2], ua[2], (y - hd[1]) / (ua[1] - hd[1]));
    const sl = top.sleeves || 'short';
    const hemA = sl === 'short' ? (top.type === 'uniform' ? 1.22 : 1.255) : sl === 'long' ? 0.925 : 2;
    const sleeveAdd = sl === 'long' ? (isSuit ? 0.013 : 0.009) : 0.014 + 0.006 * loose;
    const ys2 = ARM.map(a => a[0]);
    if (sl !== 'none') ys2.push(hemA + 0.004, hemA, hemA - 0.001);
    const ys3 = [...new Set(ys2)].sort((a, b) => b - a);
    const rs = [];
    for (const y of ys3) {
      let r = shape.armR(y);
      const inSleeve = y >= hemA - 0.0005 && sl !== 'none';
      if (inSleeve) r += sleeveAdd * (y >= hemA + 0.003 ? 1 : 0.6) * (1 - 0.65 * smooth(1.33, 1.43, y));
      if (y === hemA - 0.001) r = shape.armR(y);
      const rzk = y < 1.14 ? 0.86 : 0.96;
      rs.push({ c: [ax(y), y, az(y)], rx: r, rz: r * rzk, sleeve: inSleeve && y !== hemA - 0.001 });
    }
    const vestArm = false;
    b.tube(rs, hi ? 18 : 8, (r, th, p, n, ring, u) => {
      const y = p[1];
      const tl = smooth(1.19, 1.12, y), th2 = smooth(0.925, 0.898, y), tc = smooth(1.44, 1.485, y);
      const w = [[B['upperArm' + K], (1 - tl) * (1 - tc * 0.3)], [B.chest, (1 - tl) * tc * 0.3], [B['lowerArm' + K], tl * (1 - th2)], [B['hand' + K], th2]].filter(e => e[1] > 0.001);
      if (ring.sleeve) {
        let col = topC;
        if (isSuit && y < 0.935) col = innerC; // shirt cuff
        return { w, col, rm: RM.cloth, uv: cellUV(topTex, u * 0.33 + (s > 0 ? 0.5 : 0.1), clamp01((1.48 - y) / 0.72)) };
      }
      return { w, col: skin, rm: RM.skin, uv: cellUV('skin', u * 0.4, y - 0.8) };
    });
    // deltoid cap
    const sleeveTop = sl !== 'none';
    b.sphere([ua[0] + s * 0.002, 1.40, ua[2] + 0.002], d => [0.05 * (1 - 0.12 * fem) * (1 + 0.25 * shape.gp) + (sleeveTop ? 0.004 : 0), 0.056, 0.05 + (sleeveTop ? 0.004 : 0)], hi ? 12 : 6, hi ? 16 : 8, (d, p) => ({
      w: [[B['upperArm' + K], 0.62], [B.chest, 0.38]],
      col: sleeveTop ? (vestC ? topC : topC) : skin, rm: sleeveTop ? RM.cloth : RM.skin,
      uv: sleeveTop ? cellUV(topTex, wrapU(Math.atan2(d[2], d[0]) / 6.283 * 0.3 + 0.2), clamp01(0.1 + (1 - d[1]) * 0.1)) : cellUV('skin', 0.5, 0.5),
    }));
    // hand
    buildHand(b, s, hd, skin, hi, fem);
    if (acc.has('watch') && s < 0) {
      const y = 0.938, r = shape.armR(y) + (sl === 'long' ? 0.012 : 0.004);
      const wr = [];
      for (const [yy, k] of [[y + 0.011, 0.9], [y + 0.009, 1], [y - 0.009, 1], [y - 0.011, 0.9]]) wr.push({ c: [ax(yy), yy, az(yy)], rx: r * k, rz: r * 0.88 * k });
      b.tube(wr, 12, () => ({ w: [[B.lowerArmL, 1]], col: lin(0xc9a347), rm: RM.gold }));
      b.ellipsoid([ax(y) + s * r * 0.95, y, az(y)], [0.004, 0.014, 0.012], 4, 8, { w: [[B.lowerArmL, 1]], col: lin(0x1a1a1a), rm: RM.lens });
    }
  }

  // ---------------- legs ----------------
  for (const s of [-1, 1]) {
    const K = s < 0 ? 'L' : 'R';
    const ul = rest['upperLeg' + K], ft = rest['foot' + K];
    const lx = y => lerp(ft[0], ul[0], (y - ft[1]) / (ul[1] - ft[1]));
    const lz = y => lerp(ft[2], ul[2], (y - ft[1]) / (ul[1] - ft[1]));
    const pants = bot.type === 'jeans' || bot.type === 'trousers';
    const hemL = bot.type === 'shorts' ? 0.6 : pants ? (bot.type === 'jeans' ? 0.105 : 0.095) : 3;
    const add = bot.type === 'jeans' ? 0.013 : bot.type === 'trousers' ? 0.014 : 0.018;
    const ys2 = LEG.map(a => a[0]);
    if (hemL < 2) ys2.push(hemL + 0.004, hemL, hemL - 0.001);
    const ys3 = [...new Set(ys2)].sort((a, b) => b - a);
    const rs = [];
    for (const y of ys3) {
      let r = shape.legR(y);
      const covered = y >= hemL - 0.0005 && hemL < 2 && r > 0 && y !== hemL - 0.001;
      if (covered) {
        r += add * (y >= hemL + 0.003 ? 1 : 0.55);
        if (bot.type === 'trousers') r = Math.max(r, 0.064);
        if (bot.type === 'jeans') r = Math.max(r, 0.06);
      }
      const yy = y;
      rs.push({ c: [lx(y), y, lz(y)], rx: r, rz: r, covered, m: th => 1 + (covered ? 0.04 : 0.17) * bump(yy, 0.37, 0.08) * Math.max(0, Math.sin(th)) ** 2 + 0.05 * bump(yy, 0.75, 0.12) * Math.max(0, -Math.sin(th)) ** 2 });
    }
    b.tube(rs, hi ? 20 : 8, (r, th, p, n, ring, u) => {
      const y = p[1];
      const th0 = smooth(0.905, 0.985, y), tk = smooth(0.565, 0.465, y), tf = smooth(0.115, 0.07, y);
      const w = [[B.hips, th0 * 0.65], [B['upperLeg' + K], (1 - th0 * 0.65) * (1 - tk)], [B['lowerLeg' + K], tk * (1 - tf)], [B['foot' + K], tf]].filter(e => e[1] > 0.001);
      if (ring.covered) return { w, col: botC, rm: botTex === 'denim' ? RM.denim : RM.cloth, uv: cellUV(botTex, u * 0.5 + (s > 0 ? 0.5 : 0), clamp01((1.0 - y) * 0.95)) };
      if (bot.type === 'skirt' && y > 0.56) return { w, col: botC, rm: RM.cloth, uv: cellUV(botTex, 0.5, 0.5) };
      if (bot.type === 'skirt' && fem) return { w, col: mixC(skin, lin(0x3a2a24), 0.08), rm: [0.45, 0, 0.6], uv: cellUV('skin', 0.4, 0.4) };
      return { w, col: skin, rm: RM.skin, uv: cellUV('skin', u * 0.4, 1 - y) };
    });
    buildShoe(b, s, ft, shoes, skin, hi);
  }

  // ---------------- head ----------------
  const stub = spec.stubble || 0, blush = spec.blush || 0;
  const stubC = mixC(mulC(skin, 0.55), lin(0x2b2a33), 0.35);
  const eyeL = norm3(EYE_DIR(-1)), eyeR = norm3(EYE_DIR(1));
  b.sphere(HEAD_C, d => headRadius(d, fem), hi ? 28 : 12, hi ? 36 : 14, (d, p, nn, rowT, colT) => {
    let col = skin;
    const front = smooth(0.35, -0.3, d[2]);
    if (stub > 0) col = mixC(col, stubC, stub * 0.55 * smooth(-0.12, -0.42, d[1]) * front * (1 - bump(d[0], 0, 0.12) * bump(d[1], -0.45, 0.08)));
    const e = Math.max(d[0] * eyeL[0] + d[1] * eyeL[1] + d[2] * eyeL[2], d[0] * eyeR[0] + d[1] * eyeR[1] + d[2] * eyeR[2]);
    col = mulC(col, 1 - 0.14 * smooth(0.965, 0.995, e));
    if (blush > 0) col = mixC(col, lin(0xd9776f), blush * 0.25 * Math.exp(-(((Math.abs(d[0]) - 0.5) / 0.18) ** 2 + ((d[1] + 0.12) / 0.15) ** 2)) * front);
    col = mulC(col, 1 - 0.08 * smooth(-0.6, -0.95, d[1]));
    return { w: W1('head'), col, rm: RM.skin, uv: cellUV('skin', colT, clamp01(0.5 - d[1] * 0.4)) };
  });
  buildFace(b, spec, fem, hi, skin, hairC);
  buildHair(b, spec, fem, hi, hairC, acc);

  // ---------------- accessories ----------------
  const accHead = W1('head'), accChest = W1('chest');
  if (top.collar || isSuit) buildCollar(b, top, vDepth, yv, torsoSurface, topC, isSuit ? innerC : topC, topTex, hi, shape);
  if (top.buttons) {
    for (let y = yv - 0.04; y > hemY + 0.03; y -= 0.095) {
      const p = torsoSurface(-Math.PI / 2, y, 0.004);
      b.ellipsoid([0.012, y, p[2]], [0.0065, 0.0065, 0.003], 4, 8, { w: torsoWeights(y), col: lin(0xf4efe6), rm: RM.plastic });
    }
  }
  if (acc.has('chain')) {
    const pts = [];
    for (let i = 0; i < 40; i++) { const th = i / 40 * Math.PI * 2; const fr = Math.max(0, -Math.sin(th)); const y = 1.47 - 0.10 * Math.pow(fr, 2.2); pts.push(torsoSurface(th, y, 0.004)); }
    b.pathTube(pts, 0.0035, hi ? 6 : 4, true, p => ({ w: torsoWeights(p[1]), col: lin(0xe0b14a), rm: RM.gold }));
  }
  if (acc.has('lanyard')) {
    const pts = [];
    for (let i = 0; i < 36; i++) { const th = i / 36 * Math.PI * 2; const fr = Math.max(0, -Math.sin(th)); const y = 1.48 - 0.24 * Math.pow(fr, 5); pts.push(torsoSurface(th, y, 0.005)); }
    b.pathTube(pts, 0.004, 4, true, p => ({ w: torsoWeights(p[1]), col: lin(0xc92a2a), rm: RM.cloth }));
    const p = torsoSurface(-Math.PI / 2, 1.20, 0.008);
    b.geometry(new THREE.BoxGeometry(0.056, 0.086, 0.004), new THREE.Matrix4().makeTranslation(0, 1.205, p[2]), (q) => ({ w: torsoWeights(1.2), col: q[1] > 1.235 ? lin(0xc92a2a) : lin(0xf5f5f5), rm: RM.plastic }));
  }
  if (acc.has('belt') && tuck) {
    const p = torsoSurface(-Math.PI / 2, hemY - 0.013, 0.012);
    b.geometry(new THREE.BoxGeometry(0.05, 0.034, 0.008), new THREE.Matrix4().makeTranslation(0, hemY - 0.013, p[2]), () => ({ w: [[B.hips, 1]], col: lin(0xb8b8b8), rm: RM.silver }));
  }
  if (top.type === 'hoodie') {
    const pts = [];
    for (let i = 0; i <= 16; i++) { const th = lerp(-0.25, Math.PI + 0.25, i / 16); pts.push([Math.cos(th) * 0.085, 1.49 + 0.03 * Math.sin(th), 0.015 + Math.sin(th) * 0.075]); }
    b.pathTube(pts, 0.032, hi ? 10 : 6, false, p => ({ w: [[B.chest, 0.7], [B.neck, 0.3]], col: topC, rm: RM.cloth, uv: cellUV('knit', 0.5, 0.5) }));
    for (const s of [-1, 1]) { const p = torsoSurface(-Math.PI / 2, 1.40, 0.006); b.limb([s * 0.035, 1.47, p[2] + 0.005], [s * 0.038, 1.33, p[2] - 0.004], 0.0028, 0.0028, 4, 2, q => ({ w: torsoWeights(q[1]), col: lin(0xeeeeee), rm: RM.cloth })); }
  }
  if (top.type === 'uniform') {
    const p = torsoSurface(-Math.PI / 2 - 0.45, 1.36, 0.006);
    b.ellipsoid([p[0], 1.36, p[2] - 0.002], [0.012, 0.014, 0.003], 4, 8, { w: accChest, col: lin(0xd4b04c), rm: RM.gold });
    for (const s of [-1, 1]) b.geometry(new THREE.BoxGeometry(0.05, 0.008, 0.11), new THREE.Matrix4().makeRotationZ(-s * 0.32).setPosition(s * 0.13, 1.44, 0.0), () => ({ w: accChest, col: mulC(topC, 0.8), rm: RM.cloth }));
  }
  if (acc.has('apron')) buildApron(b, torsoSurface, torsoWeights);
  if (acc.has('backpack')) buildBackpack(b, torsoSurface, hi);
  if (acc.has('camera')) {
    const p = torsoSurface(-Math.PI / 2, 1.24, 0.03);
    b.geometry(new THREE.BoxGeometry(0.11, 0.07, 0.05), new THREE.Matrix4().makeTranslation(0.02, 1.24, p[2]), () => ({ w: accChest, col: lin(0x1b1b1d), rm: RM.plastic }));
    b.geometry(new THREE.CylinderGeometry(0.022, 0.024, 0.04, 14).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(0.03, 1.238, p[2] - 0.04), () => ({ w: accChest, col: lin(0x2b2b2f), rm: RM.lens }));
    const pts = []; for (let i = 0; i < 30; i++) { const th = i / 30 * Math.PI * 2; const fr = Math.max(0, -Math.sin(th)); pts.push(torsoSurface(th, 1.48 - 0.2 * Math.pow(fr, 4), 0.006)); }
    b.pathTube(pts, 0.004, 4, true, q => ({ w: torsoWeights(q[1]), col: lin(0x1b1b1d), rm: RM.cloth }));
  }
  if (acc.has('towel')) {
    const m = new THREE.Matrix4().makeRotationZ(0.35).setPosition(0.12, 1.455, -0.01);
    b.geometry(new THREE.BoxGeometry(0.11, 0.014, 0.17, 3, 1, 3), m, () => ({ w: accChest, col: lin(0xf1f3f5), rm: RM.cloth, uv: cellUV('knit', 0.5, 0.5) }));
    const p = torsoSurface(-Math.PI / 2 + 0.6, 1.33, 0.012);
    b.geometry(new THREE.BoxGeometry(0.1, 0.2, 0.012), new THREE.Matrix4().makeRotationX(0.12).setPosition(p[0], 1.34, p[2]), () => ({ w: accChest, col: lin(0xf1f3f5), rm: RM.cloth, uv: cellUV('knit', 0.4, 0.4) }));
  }
  if (acc.has('bag')) {
    const hd = rest.handL;
    b.geometry(new THREE.BoxGeometry(0.06, 0.22, 0.2, 2, 3, 2), new THREE.Matrix4().makeTranslation(hd[0] - 0.01, 0.62, hd[2]), (q) => ({ w: [[B.handL, 1]], col: lin(0xf08c00), rm: RM.plastic }));
    b.limb([hd[0] - 0.01, 0.73, hd[2] - 0.06], [hd[0] - 0.01, 0.84, hd[2]], 0.004, 0.004, 4, 2, () => ({ w: [[B.handL, 1]], col: lin(0xf08c00), rm: RM.plastic }));
    b.limb([hd[0] - 0.01, 0.84, hd[2]], [hd[0] - 0.01, 0.73, hd[2] + 0.06], 0.004, 0.004, 4, 2, () => ({ w: [[B.handL, 1]], col: lin(0xf08c00), rm: RM.plastic }));
  }
  buildHeadwear(b, acc, fem, hi, spec);
}

// ---------- parts ----------
function buildHand(b, s, hd, skin, hi, fem) {
  const K = s < 0 ? 'L' : 'R';
  const w = [[B['hand' + K], 1]];
  const sc = (1 - 0.1 * fem) * 0.9;
  const d = { w, col: skin, rm: RM.skin, uv: cellUV('skin', 0.3, 0.3) };
  b.ellipsoid([hd[0] + s * 0.003, hd[1] - 0.05 * sc, hd[2] + 0.002], [0.021 * sc, 0.05 * sc, 0.043 * sc], hi ? 8 : 5, hi ? 12 : 8, d);
  if (hi) {
    const fz = [-0.027, -0.009, 0.009, 0.026], fl = [0.075, 0.083, 0.078, 0.064];
    for (let i = 0; i < 4; i++) {
      const z = hd[2] + fz[i] * sc;
      const y0 = hd[1] - 0.088 * sc, y1 = y0 - fl[i] * 0.55 * sc, y2 = y0 - fl[i] * sc;
      b.limb([hd[0] + s * 0.002, y0, z], [hd[0] - s * 0.005, y1, z - 0.002], 0.0088 * sc, 0.0078 * sc, 6, 2, () => d);
      b.limb([hd[0] - s * 0.005, y1, z - 0.002], [hd[0] - s * 0.016, y2, z - 0.003], 0.0078 * sc, 0.0068 * sc, 6, 2, () => d);
    }
    const ty0 = hd[1] - 0.025 * sc, ty1 = ty0 - 0.045 * sc, ty2 = ty1 - 0.03 * sc;
    b.limb([hd[0] - s * 0.004, ty0, hd[2] - 0.03 * sc], [hd[0] - s * 0.012, ty1, hd[2] - 0.05 * sc], 0.0115 * sc, 0.0095 * sc, 6, 2, () => d);
    b.limb([hd[0] - s * 0.012, ty1, hd[2] - 0.05 * sc], [hd[0] - s * 0.02, ty2, hd[2] - 0.056 * sc], 0.0095 * sc, 0.0082 * sc, 6, 2, () => d);
  } else {
    b.ellipsoid([hd[0] - s * 0.006, hd[1] - 0.115, hd[2]], [0.018 * sc, 0.04 * sc, 0.04 * sc], 5, 8, d);
    b.ellipsoid([hd[0] - s * 0.01, hd[1] - 0.055, hd[2] - 0.045 * sc], [0.01, 0.028, 0.01], 4, 6, d);
  }
}

function shoeRadius(d, a, bb, c, n2 = 2.3) {
  let A = a, Bv = bb, C = c;
  if (d[2] < 0) { Bv *= 1 - 0.42 * (-d[2]) ** 1.5; A *= 1 - 0.12 * (-d[2]); }
  const n = d[1] < 0 ? 5 : n2;
  return 1 / Math.pow(Math.abs(d[0] / A) ** n + Math.abs(d[1] / Bv) ** n + Math.abs(d[2] / C) ** n, 1 / n);
}
function buildShoe(b, s, ft, shoes, skin, hi) {
  const K = s < 0 ? 'L' : 'R';
  const w = [[B['foot' + K], 1]];
  const type = shoes.type || 'sneakers';
  const up = lin(shoes.color ?? 0xffffff), so = lin(shoes.sole ?? 0xdddddd);
  const cx = ft[0] + s * 0.004, cz = ft[2] - 0.062;
  if (type === 'slippers') {
    // bare foot + thin sole + strap
    b.sphere([cx, 0.034, cz], d => shoeRadius(d, 0.043, 0.034, 0.12), hi ? 10 : 6, hi ? 16 : 10, (d) => ({ w, col: skin, rm: RM.skin, uv: cellUV('skin', 0.2, 0.2) }));
    b.geometry(new THREE.CylinderGeometry(1, 1, 1, 18).scale(0.052, 0.012, 0.135), new THREE.Matrix4().makeTranslation(cx, 0.006, cz), () => ({ w, col: so, rm: RM.rubber }));
    for (const k of [-1, 1]) b.limb([cx, 0.03, cz - 0.085], [cx + k * 0.045, 0.02, cz + 0.0], 0.006, 0.006, 5, 2, () => ({ w, col: up, rm: RM.rubber }));
    return;
  }
  const hgt = type === 'boots' ? 0.066 : 0.046;
  const L = type === 'loafers' || type === 'flats' ? 0.124 : 0.127;
  const rmv = type === 'sneakers' ? [0.7, 0, 0] : RM.leather;
  b.sphere([cx, hgt, cz], d => shoeRadius(d, type === 'flats' ? 0.042 : 0.049, hgt, L, type === 'sneakers' ? 2.4 : 2.1), hi ? 12 : 6, hi ? 20 : 10, (d, p) => {
    let col = up;
    if (p[1] < (type === 'sneakers' ? 0.024 : 0.012)) col = so;
    else if (type === 'sneakers' && d[2] < -0.3 && d[1] > 0.55 && Math.abs(d[0]) < 0.4) col = mulC(up, 0.82); // laces
    else if (type === 'sneakers' && Math.abs(d[0]) > 0.8 && p[1] > 0.03 && p[1] < 0.045 && d[2] > -0.5) col = mulC(up, 0.88);
    if (type === 'flats' && d[1] > 0.55 && d[2] > -0.5) col = skin; // open top shows the foot
    return { w, col, rm: p[1] < 0.02 ? RM.rubber : rmv };
  });
  if (type === 'boots') {
    const r = 0.046;
    const rs = [];
    for (const [y, k] of [[0.19, 1.0], [0.186, 0.96], [0.12, 1.0], [0.08, 1.05]]) rs.push({ c: [ft[0], y, ft[2] + 0.004], rx: r * k, rz: r * 0.95 * k });
    b.tube(rs, hi ? 14 : 8, (r2, th, p) => ({ w: p[1] > 0.12 ? [[B['lowerLeg' + K], 0.7], [B['foot' + K], 0.3]] : w, col: up, rm: RM.leather }));
  }
}

function buildFace(b, spec, fem, hi, skin, hairC) {
  const H = [[B.head, 1]];
  const eyeWhite = lin(0xf3efe8), iris = lin(spec.eye ?? 0x3b2a1e), dark = lin(0x0b0807);
  const browC = mixC(hairC, lin(0x1b1410), 0.35);
  for (const s of [-1, 1]) {
    const dir = norm3(EYE_DIR(s));
    const r = headRadius(dir, fem);
    const er = 0.0138;
    const ec = [HEAD_C[0] + dir[0] * (r - 0.0118), HEAD_C[1] + dir[1] * (r - 0.0118), HEAD_C[2] + dir[2] * (r - 0.0118)];
    if (hi) {
      b.ellipsoid(ec, [er, er, er], 8, 12, { w: H, col: eyeWhite, rm: RM.eye });
      b.ellipsoid([ec[0] + s * 0.0005, ec[1] - 0.0004, ec[2] - 0.0118], [0.0068, 0.0068, 0.0026], 5, 12, { w: H, col: iris, rm: RM.iris });
      b.ellipsoid([ec[0] + s * 0.0005, ec[1] - 0.0004, ec[2] - 0.0138], [0.0031, 0.0031, 0.001], 3, 8, { w: H, col: dark, rm: RM.iris });
      // upper lid
      b.sphere(ec, () => er + 0.0016, 6, 14, () => ({ w: H, col: mulC(skin, 0.9), rm: RM.skin }), { phi0: 0, phi1: 0.95, matrix: new THREE.Matrix4().makeRotationX(-0.4) });
      // lower lid
      b.sphere(ec, () => er + 0.0012, 4, 14, () => ({ w: H, col: mulC(skin, 0.95), rm: RM.skin }), { phi0: 2.25, phi1: Math.PI, matrix: new THREE.Matrix4().makeRotationX(0.35) });
      // lashes line
      b.sphere(ec, () => er + 0.0019, 2, 14, () => ({ w: H, col: dark, rm: RM.hair }), { phi0: 0.89, phi1: 0.98, matrix: new THREE.Matrix4().makeRotationX(-0.4) });
    } else {
      b.ellipsoid([ec[0], ec[1], ec[2] - 0.004], [0.009, 0.006, 0.006], 4, 6, { w: H, col: dark, rm: RM.eye });
    }
    // brow
    b.ellipsoid([ec[0] + s * 0.004, ec[1] + 0.0235, ec[2] - 0.002], [0.022, fem ? 0.0028 : 0.0045, 0.006], hi ? 4 : 3, hi ? 10 : 6, { w: H, col: browC, rm: RM.hair }, [0.15, 0, -s * 0.12]);
    // ear
    const ep = headPoint([s * EAR_DIR[0], EAR_DIR[1], EAR_DIR[2]], fem); const ea = [ep[0] + s * 0.002, ep[1], ep[2]];
    b.ellipsoid(ea, [0.011, 0.028, 0.019], hi ? 8 : 4, hi ? 12 : 6, { w: H, col: mulC(skin, 0.96), rm: RM.skin }, [0, s * 0.35, s * 0.08]);
    if (hi) b.ellipsoid([ea[0] + s * 0.004, ea[1], ea[2] - 0.002], [0.006, 0.017, 0.010], 4, 8, { w: H, col: mulC(skin, 0.72), rm: RM.skin }, [0, s * 0.35, s * 0.08]);
  }
  // nose
  const nb = headPoint([0, 0.02, -1], fem);
  const ny = HEAD_C[1];
  b.ellipsoid([0, ny + 0.004, nb[2] + 0.005], [0.0072, 0.03, 0.012], hi ? 6 : 4, hi ? 10 : 6, { w: H, col: skin, rm: RM.skin }, [-0.32, 0, 0]);
  b.ellipsoid([0, ny - 0.02, nb[2] - 0.005], [0.0078, 0.0074, 0.008], hi ? 6 : 4, hi ? 10 : 6, { w: H, col: mulC(skin, 1.02), rm: RM.skin });
  if (hi) for (const s of [-1, 1]) b.ellipsoid([s * 0.0088, ny - 0.0235, nb[2] + 0.002], [0.0055, 0.0048, 0.0058], 4, 8, { w: H, col: mulC(skin, 0.97), rm: RM.skin });
  // lips
  const lipC = spec.lip != null ? lin(spec.lip) : mixC(skin, lin(0xa0524f), fem ? 0.45 : 0.28);
  const lp = headPoint([0, -0.44, -0.9], fem);
  b.ellipsoid([0, lp[1] + 0.0055, lp[2] + 0.0035], [0.021, 0.0042, 0.0065], hi ? 5 : 3, hi ? 12 : 6, { w: H, col: lipC, rm: RM.lips });
  b.ellipsoid([0, lp[1] - 0.0035, lp[2] + 0.0042], [0.018, 0.0052, 0.0065], hi ? 5 : 3, hi ? 12 : 6, { w: H, col: mulC(lipC, 1.05), rm: RM.lips });
  if (hi) b.ellipsoid([0, lp[1] + 0.0012, lp[2] - 0.0012], [0.0195, 0.0013, 0.004], 3, 10, { w: H, col: mulC(lipC, 0.35), rm: RM.lips });
}

function buildHair(b, spec, fem, hi, hairC, acc) {
  const style = HAIR_STYLES[spec.hairStyle] || HAIR_STYLES.short;
  const H = [[B.head, 1]];
  const lat = hi ? 30 : 12, lon = hi ? 44 : 14;
  b.sphere(HEAD_C, d => hairShellRadius(style, d, fem, true), lat, lon, (d, p, nn, rowT, colT) => {
    const u = colT, v = rowT;
    const shade = 0.85 + 0.15 * smooth(-0.5, 0.8, d[1]);
    return { w: H, col: mulC(hairC, shade), rm: RM.hair, uv: cellUV('hair', u, v), gar: [d[0], d[1], d[2], style.bald ? 7 : style.side ? 6 : 5], gar2: style.thr };
  });
  const hd = { w: H, col: hairC, rm: RM.hair, uv: cellUV('hair', 0.5, 0.3) };
  if (style.drape) {
    const rs = [];
    for (const [y, rx, rz, z] of [[1.73, 0.0, 0.0, 0.03], [1.72, 0.07, 0.04, 0.04], [1.66, 0.092, 0.05, 0.055], [1.58, 0.098, 0.045, 0.07], [1.50, 0.11, 0.035, 0.085], [1.42, 0.115, 0.028, 0.095], [1.39, 0.10, 0.02, 0.098], [1.385, 0, 0, 0.098]]) rs.push({ c: [0, y, z], rx, rz });
    b.tube(rs, hi ? 18 : 8, (r, th, p) => {
      const y = p[1]; const t = smooth(1.6, 1.42, y);
      return { w: [[B.head, 1 - t], [B.neck, t * 0.4], [B.chest, t * 0.6]].filter(e => e[1] > 0.001), col: mulC(hairC, 0.9), rm: RM.hair, uv: cellUV('hair', wrapU(th / 6.283), clamp01((1.75 - y) * 2)) };
    });
  }
  if (style.bun) b.ellipsoid([0, HEAD_C[1] + 0.055, HEAD_C[2] + 0.1], [0.038, 0.034, 0.036], hi ? 8 : 5, hi ? 12 : 8, (d) => ({ ...hd, uv: cellUV('hair', wrapU(Math.atan2(d[0], d[2]) / 6.28 + 0.5), d[1] * 0.5 + 0.5) }));
  if (style.tail) {
    b.ellipsoid([0, HEAD_C[1] + 0.03, HEAD_C[2] + 0.105], [0.022, 0.022, 0.02], 5, 8, hd);
    b.limb([0, HEAD_C[1] + 0.02, HEAD_C[2] + 0.12], [0, 1.50, 0.13], 0.024, 0.012, hi ? 8 : 5, 4, (p) => ({ ...hd, w: p[1] > 1.6 ? H : [[B.head, 0.5], [B.neck, 0.5]] }));
  }
}

function buildHeadwear(b, acc, fem, hi, spec) {
  const H = [[B.head, 1]];
  const top = HEAD_C[1];
  const brim = (y, zFront, rx, rz, col, rm, tilt = 0.12) => b.sphere([0, y, zFront], () => [rx, 0.005, rz], hi ? 4 : 3, hi ? 20 : 10, () => ({ w: H, col, rm }), { matrix: new THREE.Matrix4().makeRotationX(tilt) });
  if (acc.has('cap')) {
    const col = lin(spec.capColor ?? 0x1c7ed6);
    b.sphere([0, top + 0.022, HEAD_C[2] - 0.002], d => { const r = headRadius(d, fem) + 0.014; return r; }, hi ? 10 : 5, hi ? 24 : 10, () => ({ w: H, col, rm: RM.cloth }), { phi0: 0, phi1: 1.55 });
    brim(top + 0.035, HEAD_C[2] - 0.115, 0.072, 0.06, col, RM.cloth, 0.18);
  }
  if (acc.has('visor')) {
    const col = lin(0xf3f0e8);
    const rs = [];
    for (const [y, k] of [[top + 0.06, 1.0], [top + 0.035, 1.02]]) { const d = [0, 0.4, -0.9]; rs.push({ c: [0, y, HEAD_C[2] + 0.005], rx: 0.088 * k + (fem ? 0.02 : 0), rz: 0.104 * k + (fem ? 0.02 : 0) }); }
    b.tube(rs, hi ? 24 : 10, () => ({ w: H, col, rm: RM.plastic }));
    brim(top + 0.04, HEAD_C[2] - 0.135, 0.085, 0.07, lin(0x2f9e44), [0.2, 0, 0], 0.22);
  }
  if (acc.has('policeCap')) {
    const col = lin(0x1a2342);
    const rs = [];
    for (const [y, rx, rz] of [[top + 0.105, 0, 0], [top + 0.104, 0.105, 0.118], [top + 0.096, 0.112, 0.126], [top + 0.075, 0.098, 0.112], [top + 0.04, 0.093, 0.107], [top + 0.03, 0.094, 0.108]]) rs.push({ c: [0, y, HEAD_C[2] + 0.004], rx, rz });
    b.tube(rs, hi ? 28 : 12, (r, th, p) => ({ w: H, col: p[1] < top + 0.06 ? lin(0x111318) : col, rm: RM.cloth }));
    brim(top + 0.034, HEAD_C[2] - 0.12, 0.08, 0.055, lin(0x0b0b0d), RM.leather, 0.3);
    b.ellipsoid([0, top + 0.068, HEAD_C[2] - 0.112], [0.013, 0.016, 0.004], 4, 8, { w: H, col: lin(0xd8b24a), rm: RM.gold });
  }
  const eyeC = s => { const dir = norm3(EYE_DIR(s)); const r = headRadius(dir, fem); return [dir[0] * r, HEAD_C[1] + dir[1] * r, HEAD_C[2] + dir[2] * r]; };
  if (acc.has('glasses') || acc.has('sunglasses')) {
    const sun = acc.has('sunglasses');
    const frame = lin(sun ? 0x111111 : 0x2b2118);
    for (const s of [-1, 1]) {
      const e = eyeC(s);
      const z = e[2] - 0.012;
      if (sun) b.ellipsoid([e[0], e[1] - 0.002, z], [0.024, 0.017, 0.004], 5, 12, { w: H, col: lin(0x0d1117), rm: RM.lens });
      b.geometry(new THREE.TorusGeometry(sun ? 0.024 : 0.019, 0.0024, 5, hi ? 18 : 10).scale(1, sun ? 0.72 : 0.85, 1), new THREE.Matrix4().makeTranslation(e[0], e[1] - 0.002, z), () => ({ w: H, col: frame, rm: RM.plastic }));
      b.limb([e[0] + s * (sun ? 0.024 : 0.019), e[1], z + 0.002], [s * 0.079, e[1] + 0.002, HEAD_C[2] - 0.005], 0.0022, 0.0022, 4, 2, () => ({ w: H, col: frame, rm: RM.plastic }));
    }
    const e = eyeC(1);
    b.limb([-e[0] + 0.012, e[1] + 0.002, e[2] - 0.012], [e[0] - 0.012, e[1] + 0.002, e[2] - 0.012], 0.002, 0.002, 4, 2, () => ({ w: H, col: frame, rm: RM.plastic }));
  }
  if (acc.has('airpods')) for (const s of [-1, 1]) b.limb([s * 0.083, HEAD_C[1] - 0.01, HEAD_C[2] - 0.004], [s * 0.084, HEAD_C[1] - 0.04, HEAD_C[2]], 0.0055, 0.0035, 6, 2, () => ({ w: H, col: lin(0xffffff), rm: RM.plastic }));
}

function buildCollar(b, top, vDepth, yv, torsoSurface, col, innerCol, tex, hi, shape) {
  const W = [[B.chest, 0.6], [B.neck, 0.4]];
  const isSuit = top.type === 'suit';
  const c = isSuit ? innerCol : col;
  const ctex = isSuit ? 'plain' : tex;
  const open = vDepth > 0.35;
  // band around the back of the neck (full ring when closed)
  const a0 = open ? -0.35 : -Math.PI / 2 + 0.06, a1 = open ? Math.PI + 0.35 : Math.PI * 1.5 - 0.06;
  const pts = [];
  for (let i = 0; i <= 18; i++) { const th = lerp(a0, a1, i / 18); pts.push([Math.cos(th) * 0.07, 1.485 + 0.012 * Math.sin(th), 0.014 + Math.sin(th) * 0.066]); }
  b.pathTube(pts, 0.011, hi ? 8 : 5, false, (p) => ({ w: W, col: c, rm: RM.cloth, uv: cellUV(ctex, wrapU(Math.atan2(p[0], p[2]) / 6.283 + 0.5) * 0.4, 0.04) }));
  if (!open || isSuit) return;
  // camp-collar flaps lying on the chest along each side of the V
  for (const s of [-1, 1]) {
    const rows = 7, cols = 4;
    const yTop = 1.475, yBot = Math.max(yv + 0.05, 1.3);
    const P = (r, cIdx) => {
      const y = lerp(yTop, yBot, r / (rows - 1));
      const xe = (y - yv) * 0.55 + 0.004;
      const taper = Math.sin(Math.PI * Math.min(1, (r + 0.6) / rows)) ** 0.7;
      const x = s * (xe + 0.052 * taper * (cIdx / (cols - 1)));
      const t = shape.torso(y);
      const rx = t.rx + 0.012;
      const th = -Math.PI / 2 + Math.asin(Math.max(-1, Math.min(1, x / rx)));
      const q = torsoSurface(th, y, 0.006 + 0.004 * (1 - cIdx / (cols - 1)));
      return q;
    };
    b.grid(rows, cols, P, (r, cIdx, p) => ({ w: W, col: c, rm: RM.cloth, uv: cellUV(ctex, 0.45 + p[0] * 1.2, clamp01((1.53 - p[1]) / 0.72)) }), (r) => [0, lerp(yTop, yBot, r / (rows - 1)), 0.0], false);
  }
}

function buildApron(b, torsoSurface, torsoWeights) {
  const col = lin(0x1c4e80);
  const rows = 14, cols = 10;
  b.grid(rows, cols, (r, c) => {
    const y = lerp(1.36, 0.56, r / (rows - 1));
    const half = lerp(0.12, 0.2, smooth(1.3, 1.05, y));
    const x = lerp(-half, half, c / (cols - 1));
    let z;
    if (y > 0.9) { const th = Math.atan2(-1, x / 0.16); const p = torsoSurface(-Math.PI / 2 + x * 3.5, y, 0.014); z = p[2]; }
    else z = -0.135 + 0.01 * Math.abs(x) / 0.2;
    return [x, y, z];
  }, (r, c, p) => {
    const y = p[1];
    const w = y > 0.95 ? torsoWeights(y) : [[B.hips, 1]];
    return { w, col: col, rm: RM.cloth, uv: cellUV('plain', 0.5, 0.5) };
  }, (r, c) => [0, lerp(1.36, 0.56, r / (rows - 1)), 0.05], false);
}

function buildBackpack(b, torsoSurface, hi) {
  const W = [[B.chest, 0.85], [B.spine, 0.15]];
  const col = lin(0x343a40);
  const back = torsoSurface(Math.PI / 2, 1.22, 0);
  b.sphere([0, 1.21, back[2] + 0.075], (d) => 1 / Math.pow(Math.abs(d[0] / 0.145) ** 4 + Math.abs(d[1] / 0.2) ** 4 + Math.abs(d[2] / 0.075) ** 4, 0.25), hi ? 12 : 6, hi ? 18 : 10, (d, p) => ({ w: W, col: d[2] > 0.6 && p[1] < 1.2 ? mulC(col, 0.8) : col, rm: [0.75, 0, 0] }));
  for (const s of [-1, 1]) {
    const pts = [[s * 0.1, 1.36, back[2] + 0.01], [s * 0.11, 1.45, 0.07], [s * 0.105, 1.47, -0.02], [s * 0.1, 1.42, -0.105], [s * 0.1, 1.28, -0.125], [s * 0.11, 1.12, -0.115]];
    b.pathTube(pts, 0.012, 5, false, (p) => ({ w: W, col: mulC(col, 0.7), rm: [0.75, 0, 0] }));
  }
}
