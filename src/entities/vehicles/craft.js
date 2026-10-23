// Watercraft and aircraft: jet ski, cigarette speedboat, Singapore River bumboat, light helicopter
// (civil + police) and a DurianDash delivery drone. Same uber material / atlas system as the cars.
// Boats: origin at the waterline centre (y = 0 waterline). Aircraft: origin at ground contact.
import * as THREE from 'three';
import { PartBuilder, gridGeometry, gridSubset, capGeometry, roundedBox, box, cyl, tube, sphere, plane, M4, monotone } from './geom.js';
import { Atlas, text, plate, roundRect } from './atlas.js';
import { patch } from './body.js';

const clamp01 = v => Math.min(1, Math.max(0, v));
const mirrorLoop = (half, z) => { const o = half.map(p => [p[0], p[1], z]); for (let i = half.length - 2; i >= 0; i--) o.push([-half[i][0], half[i][1], z]); return o; };
const hIdx = (k, N) => (k < N ? k : 2 * N - 2 - k);
const fullLoop2D = half => half.concat(half.slice(0, -1).reverse().map(p => [-p[0], p[1]]));

/** Lofts a mirrored surface over stations ts; classify(tMid, halfIndex) -> material key (or null to skip). */
function loftParts(pb, ts, sectionAt, zOf, classify, collect) {
  const N = sectionAt(ts[0]).length;
  const rows = ts.map(t => mirrorLoop(sectionAt(t), zOf(t)));
  const geo = gridGeometry(rows, false);
  const cols = rows[0].length;
  const keyOf = (i, j) => classify((ts[i] + ts[i + 1]) / 2, Math.min(hIdx(j, N), hIdx(j + 1, N)));
  const keys = new Set();
  for (let i = 0; i < ts.length - 1; i++) for (let j = 0; j < cols - 1; j++) keys.add(keyOf(i, j));
  for (const k of keys) {
    if (k == null) continue;
    const sub = gridSubset(geo, cols, (i, j) => keyOf(i, j) === k);
    if (!sub.index.count) continue;
    pb.add(sub, k);
    if (collect && (k === 'paint' || k === 'paintMatte')) collect.push(sub);
  }
  return { geo, N };
}
function stations(n, extra = []) {
  const ts = []; for (let i = 0; i <= n; i++) ts.push(i / n);
  return [...new Set(ts.concat(extra).map(t => Math.round(t * 1e6) / 1e6))].filter(t => t >= 0 && t <= 1).sort((a, b) => a - b);
}
function paintSides(atlas, d, fn) {
  for (const side of ['R', 'L']) atlas.draw(side === 'R' ? 'sideR' : 'sideL', (c, w, h) => fn(c, {
    side, w, h,
    x: z => (side === 'R' ? (d.zF + d.L - z) : (z - d.zF)) / d.L * w,
    y: y => (d.yMax - y) / (d.yMax - d.yMin) * h,
    sx: v => v / d.L * w, sy: v => v / (d.yMax - d.yMin) * h,
  }));
}
function paintEnds(atlas, d, front, rear) {
  const yr = d.yF - d.yMinF;
  const mk = (flip) => (c, w, h) => ({ w, h, x: x => (flip ? (d.W / 2 - x) : (x + d.W / 2)) / d.W * w, y: y => (d.yF - y) / yr * h, sx: v => v / d.W * w, sy: v => v / yr * h });
  if (front) atlas.draw('front', (c, w, h) => front(c, mk(true)(c, w, h)));
  if (rear) atlas.draw('rear', (c, w, h) => rear(c, mk(false)(c, w, h)));
}
function hstripe(c, S, z0, z1, yOf, thick, color) {
  // stripe following a y(z) curve along the side
  c.save(); c.fillStyle = color; c.beginPath();
  const n = 40;
  for (let i = 0; i <= n; i++) { const z = z0 + (z1 - z0) * i / n; const x = S.x(z), y = S.y(yOf(z)); i ? c.lineTo(x, y) : c.moveTo(x, y); }
  for (let i = n; i >= 0; i--) { const z = z0 + (z1 - z0) * i / n; c.lineTo(S.x(z), S.y(yOf(z) - thick)); }
  c.closePath(); c.fill(); c.restore();
}

// ---------------------------------------------------------------- hull lofting (V / round bilge, optional open tub)
function hullSection(H, t, n) {
  const hb = Math.max(0, H.hb(t)), yk = H.yk(t), yc = H.yc(t), ys = H.ys(t), crown = Math.max(0, H.crown(t));
  const gr = Math.min(0.03, hb * 0.2);
  const pts = [[0, yk]];
  if (H.round) {
    // round bilge
    for (let i = 1; i <= n.v; i++) { const a = (i / n.v) * Math.PI / 2; pts.push([hb * Math.sin(a), yc + (yk - yc) * Math.cos(a)]); }
  } else {
    const hc = hb * 0.9;
    for (let i = 1; i <= n.v; i++) { const f = i / n.v; pts.push([hc * f, yk + (yc - yk) * (0.82 * f + 0.18 * f * f)]); }
    pts.push([hb * 0.96, yc + 0.012]);
  }
  const y0 = pts[pts.length - 1][1], x0 = pts[pts.length - 1][0];
  for (let i = 1; i <= n.side; i++) { const f = i / n.side; pts.push([x0 + (hb - x0) * Math.sin(f * Math.PI / 2), y0 + (ys - gr - y0) * f]); }
  pts.push([hb - gr, ys]);
  const xd = Math.max(0, hb - gr);
  const tub = H.tub ? clamp01(H.tub(t)) : 0;
  const floor = H.floor ? H.floor(t) : ys - 0.5;
  const rim = Math.min(H.rim ?? 0.1, xd * 0.6);
  for (let i = 1; i <= n.deck; i++) {
    const f = i / n.deck, x = xd * (1 - f);
    let px = x, py = ys + crown * (1 - (xd > 1e-6 ? (x / xd) ** 2 : 0));
    if (tub > 0) {
      let qx, qy;
      if (i === 1) { qx = xd - rim; qy = ys; }
      else if (i === 2) { qx = xd - rim - 0.02; qy = floor; }
      else { const g = (i - 2) / (n.deck - 2); qx = (xd - rim - 0.02) * (1 - g); qy = floor; }
      px += (qx - px) * tub; py += (qy - py) * tub;
    }
    pts.push([px, py]);
  }
  return pts;
}
function hullMeta(H, n) { const p = hullSection(H, 0.5, n); return { N: p.length, iDeck: p.length - n.deck - 1 }; }

function buildHull(pb, H, n, count, classify, collect) {
  const ts = stations(count, H.extraT || []);
  const zOf = t => H.zF + t * H.L;
  const res = loftParts(pb, ts, t => hullSection(H, t, n), zOf, classify, collect);
  const transom = capGeometry(fullLoop2D(hullSection(H, 1, n)), H.zF + H.L, 1);
  pb.add(transom, 'paint'); collect?.push(transom);
  return { ...res, zOf };
}

// ---------------------------------------------------------------- shared small parts
function navLights(pb, hi, at) {
  // at: { red:[x,y,z], green:[x,y,z], white?:[x,y,z] } — red = port (left, -x), green = starboard (right, +x)
  const s = hi ? 0.06 : 0.08;
  if (at.red) pb.add(box(s, s * 0.8, s * 1.4), 'navRed', { matrix: M4.t(...at.red) });
  if (at.green) pb.add(box(s, s * 0.8, s * 1.4), 'navGreen', { matrix: M4.t(...at.green) });
  if (at.white) pb.add(sphere(s * 0.7, hi ? 8 : 5, hi ? 6 : 3), 'navWhite', { matrix: M4.t(...at.white) });
}

function rotorBlades(R, chord, n, hub, hi, { twist = 0.12, mat = 'rotor', tipMat = null } = {}) {
  const pb = new PartBuilder(null);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    const len = R - hub;
    const blade = hi ? roundedBox(len, 0.035, chord, 0.012, 1) : box(len, 0.03, chord);
    const g = blade.clone();
    // twist along the blade
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const u = (p.getX(k) + len / 2) / len, ang = twist * (1 - u); const y = p.getY(k), z = p.getZ(k); p.setY(k, y * Math.cos(ang) - z * Math.sin(ang)); p.setZ(k, y * Math.sin(ang) + z * Math.cos(ang)); }
    g.computeVertexNormals();
    pb.add(g, mat, { matrix: M4.trs(Math.cos(a) * (hub + len / 2), 0, -Math.sin(a) * (hub + len / 2), 0, a, 0) });
    if (tipMat) pb.add(box(0.25, 0.037, chord * 1.02), tipMat, { matrix: M4.trs(Math.cos(a) * (R - 0.13), 0, -Math.sin(a) * (R - 0.13), 0, a, 0) });
  }
  pb.add(cyl(hub, hub, 0.12, hi ? 16 : 8), 'steel');
  pb.add(cyl(hub * 0.5, hub * 0.7, 0.18, hi ? 12 : 6), 'darkAlloy', { matrix: M4.t(0, 0.12, 0) });
  return pb;
}

// ---------------------------------------------------------------- jet ski
function buildJetski(lod) {
  const hi = lod === 'high';
  const atlas = new Atlas();
  const pb = new PartBuilder(atlas);
  const L = 3.2, zF = -1.6;
  const H = {
    L, zF,
    hb: t => 0.58 * (t < 0.56 ? Math.pow(Math.sin(t / 0.56 * Math.PI / 2), 0.95) : 1) * (1 - 0.2 * clamp01((t - 0.8) / 0.2) ** 1.5),
    yk: monotone([[0, 0.28], [0.08, 0.02], [0.3, -0.2], [1, -0.24]]),
    yc: monotone([[0, 0.32], [0.12, 0.08], [0.4, -0.1], [1, -0.13]]),
    ys: monotone([[0, 0.4], [0.25, 0.39], [0.6, 0.33], [0.9, 0.3], [1, 0.27]]),
    crown: monotone([[0, 0.02], [0.12, 0.1], [0.25, 0.19], [0.34, 0.23], [0.42, 0.14], [0.5, 0.04], [1, 0.03]]),
    extraT: [0.005, 0.015, 0.03],
  };
  const n = hi ? { v: 4, side: 3, deck: 6 } : { v: 2, side: 1, deck: 3 };
  const paintSurf = [];
  buildHull(pb, H, n, hi ? 60 : 18, () => 'paint', paintSurf);
  const zOf = t => zF + t * L;
  // seat, handlebar pod, bars, footwell mats, jet nozzle, rear grab
  const ys = t => H.ys(t) + H.crown(t);
  pb.add(hi ? roundedBox(0.38, 0.2, 1.15, 0.08, 3) : box(0.38, 0.2, 1.15), 'leather', { matrix: M4.t(0, ys(0.64) + 0.1, zOf(0.64)), color: 0x14a6a0 });
  pb.add(hi ? roundedBox(0.4, 0.06, 1.1, 0.03, 2) : box(0.4, 0.06, 1.1), 'black', { matrix: M4.t(0, ys(0.64) + 0.02, zOf(0.64)) });
  pb.add(hi ? roundedBox(0.34, 0.16, 0.32, 0.06, 3) : box(0.34, 0.16, 0.32), 'paint', { matrix: M4.trs(0, ys(0.4) + 0.08, zOf(0.4), -0.5, 0, 0) });
  pb.add(box(0.22, 0.012, 0.12), 'glassDark', { matrix: M4.trs(0, ys(0.4) + 0.17, zOf(0.385), -0.5, 0, 0) });
  const by = ys(0.42) + 0.27, bz = zOf(0.43);
  pb.add(tube([[-0.34, by - 0.03, bz + 0.03], [-0.12, by, bz], [0.12, by, bz], [0.34, by - 0.03, bz + 0.03]], 0.016, 6, 10), 'black');
  pb.add(tube([[0, ys(0.41) + 0.12, zOf(0.41)], [0, by, bz]], 0.025, 6, 2), 'black');
  for (const s of [1, -1]) {
    pb.add(cyl(0.024, 0.024, 0.12, 8), 'rubber', { matrix: M4.trs(s * 0.38, by - 0.035, bz + 0.035, 0, 0, Math.PI / 2) });
    pb.add(box(0.2, 0.02, 0.85), 'black', { matrix: M4.t(s * 0.36, H.ys(0.66) + 0.012, zOf(0.66)) });
  }
  const noz = cyl(0.09, 0.1, 0.18, hi ? 14 : 6); noz.rotateX(Math.PI / 2);
  pb.add(noz, 'darkAlloy', { matrix: M4.t(0, -0.08, zOf(1) + 0.06) });
  pb.add(tube([[-0.16, ys(0.94) + 0.02, zOf(0.92)], [-0.14, ys(0.94) + 0.1, zOf(0.94)], [0.14, ys(0.94) + 0.1, zOf(0.94)], [0.16, ys(0.94) + 0.02, zOf(0.92)]], 0.014, 6, 8), 'black');
  pb.add(sphere(0.03, 6, 4), 'navWhite', { matrix: M4.t(0, H.ys(1) + 0.04, zOf(0.995)) });
  // livery
  const d = { zF, L, yMax: 0.85, yMin: -0.35, W: 1.2, yF: 0.85, yMinF: -0.35, frontDepth: 0.4, rearDepth: 0.2 };
  paintSides(atlas, d, (c, S) => {
    c.fillStyle = '#1b1d2a'; c.fillRect(0, S.y(0.02), S.w, S.h);                       // below waterline
    hstripe(c, S, zF + 0.15, zF + L, z => H.ys((z - zF) / L) - 0.03, 0.09, '#ff2fa0');
    hstripe(c, S, zF + 0.35, zF + L, z => H.ys((z - zF) / L) - 0.15, 0.06, '#18c8c0');
    hstripe(c, S, zF + 0.6, zF + L, z => H.ys((z - zF) / L) - 0.24, 0.03, '#ffd23a');
    text(c, 'WAVE RIDER', S.x(zF + 1.0), S.y(0.08), { size: S.sy(0.09), color: '#ff2fa0', italic: true, font: 'Arial Black, Arial', maxW: S.sx(1.2) });
  });
  paintEnds(atlas, d, null, (c, F) => { c.fillStyle = '#1b1d2a'; c.fillRect(0, F.y(0.02), F.w, F.h); text(c, 'VC 1986', F.x(0), F.y(0.25), { size: F.sy(0.06), color: '#fff' }); });
  return {
    geometry: pb.build(), glassGeo: null, atlas, design: { bodyColor: 0xf4f4f2 }, decal: d,
    wheels: [], headlights: [], wake: { x: 0, y: 0, z: zF + L + 0.1 },
  };
}

// ---------------------------------------------------------------- cigarette speedboat ("Squalo")
function buildSpeedboat(lod) {
  const hi = lod === 'high';
  const atlas = new Atlas();
  const pb = new PartBuilder(atlas);
  const gpb = new PartBuilder(atlas);
  const L = 9.0, zF = -4.5, zR = 4.5;
  const H = {
    L, zF, rim: 0.12,
    hb: t => 1.25 * (t < 0.55 ? Math.pow(Math.sin(t / 0.55 * Math.PI / 2), 0.78) : 1) * (1 - 0.04 * clamp01((t - 0.8) / 0.2)),
    yk: monotone([[0, 0.55], [0.07, 0.05], [0.2, -0.32], [0.4, -0.45], [1, -0.48]]),
    yc: monotone([[0, 0.62], [0.1, 0.32], [0.3, 0.0], [0.5, -0.12], [1, -0.15]]),
    ys: monotone([[0, 1.12], [0.15, 1.08], [0.5, 0.96], [1, 0.86]]),
    crown: monotone([[0, 0.04], [0.15, 0.1], [0.4, 0.07], [1, 0.03]]),
    tub: monotone([[0.39, 0], [0.42, 1], [0.8, 1], [0.83, 0]]),
    floor: () => 0.38,
    extraT: [0.004, 0.012, 0.025, 0.04],
  };
  const n = hi ? { v: 5, side: 4, deck: 7 } : { v: 2, side: 1, deck: 4 };
  const meta = hullMeta(H, n);
  const paintSurf = [];
  buildHull(pb, H, n, hi ? 90 : 26, (t, h) => (h >= meta.iDeck + 1 && H.tub(t) > 0.5 ? 'nonskid' : 'paint'), paintSurf);
  const zOf = t => zF + t * L;
  const deckY = t => H.ys(t) + H.crown(t);
  // windscreen (wrap-around, raked)
  const tW = 0.405, zW = zOf(tW), y0 = H.ys(tW) + 0.02;
  const rows = [];
  const nx = hi ? 16 : 6, ny = hi ? 4 : 1;
  for (let i = 0; i <= nx; i++) {
    const x = -1.02 + 2.04 * i / nx, sw = (Math.abs(x) / 1.02) ** 2;
    const row = [];
    for (let j = 0; j <= ny; j++) { const v = j / ny; row.push([x * (1 - 0.06 * v), y0 + 0.44 * v, zW + 0.42 * sw + 0.36 * v - 0.05 * v * v]); }
    rows.push(row);
  }
  const ws = gridGeometry(rows, false);
  (hi ? gpb : pb).add(ws, 'glass', hi ? { rough: 0.02, metal: 0.4, color: 0x22303a } : {});
  (hi ? gpb : pb).add(gridGeometry(rows, true), 'glass', hi ? { rough: 0.02, metal: 0.4, color: 0x22303a } : {});
  pb.add(tube(rows.map(r => r[ny]), 0.018, 6, hi ? 24 : 8), 'chrome');
  // cockpit: console, wheel, seats, rear bench
  const fl = 0.38;
  pb.add(hi ? roundedBox(2.0, 0.5, 0.5, 0.06, 2) : box(2.0, 0.5, 0.5), 'painted', { matrix: M4.t(0, fl + 0.25, zOf(0.445)), color: 0xf0f0f0 });
  pb.add(box(1.6, 0.02, 0.35), 'trim', { matrix: M4.trs(0, fl + 0.52, zOf(0.44), -0.4, 0, 0) });
  const sw = new THREE.TorusGeometry(0.17, 0.016, 6, 20); sw.deleteAttribute('uv');
  pb.add(sw, 'chrome', { matrix: M4.trs(0.45, fl + 0.62, zOf(0.475), -0.7, 0, 0) });
  pb.add(box(0.06, 0.18, 0.04), 'chrome', { matrix: M4.trs(0.0, fl + 0.6, zOf(0.47), -0.5, 0, 0) });
  for (const x of [0.45, -0.45]) {
    pb.add(hi ? roundedBox(0.52, 0.16, 0.55, 0.05, 2) : box(0.52, 0.16, 0.55), 'leather', { matrix: M4.t(x, fl + 0.32, zOf(0.56)), color: 0xf2f0ea });
    pb.add(hi ? roundedBox(0.52, 0.55, 0.14, 0.05, 2) : box(0.52, 0.55, 0.14), 'leather', { matrix: M4.trs(x, fl + 0.62, zOf(0.59), -0.2, 0, 0), color: 0xf2f0ea });
  }
  pb.add(hi ? roundedBox(2.0, 0.4, 0.55, 0.06, 2) : box(2.0, 0.4, 0.55), 'leather', { matrix: M4.t(0, fl + 0.2, zOf(0.77)), color: 0xf2f0ea });
  pb.add(hi ? roundedBox(2.0, 0.42, 0.14, 0.05, 2) : box(2.0, 0.42, 0.14), 'leather', { matrix: M4.trs(0, fl + 0.55, zOf(0.8), -0.15, 0, 0), color: 0xff3fa4 });
  // engine hatch vents + twin outboards
  for (const x of [0.5, -0.5]) pb.add(box(0.45, 0.02, 0.5), 'trim', { matrix: M4.t(x, deckY(0.9) + 0.012, zOf(0.9)) });
  for (const x of [0.48, -0.48]) {
    pb.add(hi ? roundedBox(0.5, 0.62, 0.72, 0.12, 3) : box(0.5, 0.62, 0.72), 'painted', { matrix: M4.t(x, 1.05, zR + 0.45), color: 0x121212 });
    pb.add(box(0.14, 0.95, 0.24), 'painted', { matrix: M4.t(x, 0.35, zR + 0.48), color: 0x161616 });
    pb.add(box(0.06, 0.3, 0.36), 'painted', { matrix: M4.t(x, -0.3, zR + 0.52), color: 0x161616 });
    const prop = cyl(0.17, 0.17, 0.05, hi ? 12 : 6); prop.rotateX(Math.PI / 2);
    pb.add(prop, 'chrome', { matrix: M4.t(x, -0.22, zR + 0.72) });
    pb.add(box(0.51, 0.06, 0.73), 'painted', { matrix: M4.t(x, 1.05, zR + 0.45), color: 0xff2fa0 });
  }
  // bow rails + cleats
  if (hi) for (const s of [1, -1]) {
    const pts = [];
    for (const t of [0.03, 0.12, 0.22, 0.32]) pts.push([s * (H.hb(t) - 0.07), deckY(t) - 0.02 + 0.25, zOf(t)]);
    pb.add(tube(pts, 0.014, 6, 16), 'chrome');
    for (const t of [0.12, 0.22, 0.32]) pb.add(cyl(0.012, 0.012, 0.25, 6), 'chrome', { matrix: M4.t(s * (H.hb(t) - 0.07), deckY(t) + 0.1, zOf(t)) });
  }
  // nav lights: port red / starboard green at the bow, white stern pole
  navLights(pb, hi, { red: [-(H.hb(0.12) - 0.04), H.ys(0.12) + 0.03, zOf(0.12)], green: [H.hb(0.12) - 0.04, H.ys(0.12) + 0.03, zOf(0.12)], white: [0, deckY(0.97) + 0.72, zOf(0.97)] });
  pb.add(cyl(0.015, 0.015, 0.7, 6), 'chrome', { matrix: M4.t(0, deckY(0.97) + 0.35, zOf(0.97)) });
  // livery
  const d = { zF, L, yMax: 1.25, yMin: -0.55, W: 2.5, yF: 1.25, yMinF: -0.55, frontDepth: 0.3, rearDepth: 0.3 };
  paintSides(atlas, d, (c, S) => {
    c.fillStyle = '#131726'; c.fillRect(0, S.y(-0.02), S.w, S.h);
    hstripe(c, S, zF + 0.6, zR, () => 0.06, 0.06, '#ff2fa0');                         // boot stripe
    hstripe(c, S, zF + 0.25, zR, z => H.ys((z - zF) / L) - 0.08, 0.13, '#ff2fa0');        // neon pink sheer stripe
    hstripe(c, S, zF + 0.4, zR, z => H.ys((z - zF) / L) - 0.25, 0.035, '#19d3e6');
    text(c, 'SQUALO', S.x(zF + 2.1), S.y(0.55), { size: S.sy(0.24), color: '#19d3e6', italic: true, font: 'Arial Black, Arial', stroke: '#0c0c18', strokeW: 3, maxW: S.sx(2.2) });
    text(c, 'VERCETTI MARINE', S.x(zR - 1.5), S.y(0.42), { size: S.sy(0.08), color: '#ff2fa0', italic: true, maxW: S.sx(1.6) });
  });
  paintEnds(atlas, d, null, (c, F) => { c.fillStyle = '#131726'; c.fillRect(0, F.y(-0.02), F.w, F.h); text(c, 'SQUALO', F.x(0), F.y(0.55), { size: F.sy(0.14), color: '#ff2fa0', italic: true, font: 'Arial Black, Arial' }); text(c, 'VICE CITY', F.x(0), F.y(0.36), { size: F.sy(0.07), color: '#19d3e6' }); });
  // cowling decals (sign region) handled by pink band geometry above
  return {
    geometry: pb.build(), glassGeo: hi ? gpb.build() : null, atlas, design: { bodyColor: 0xf6f6f3 }, decal: d,
    wheels: [], headlights: [], wake: { x: 0, y: 0, z: zR + 0.75 },
  };
}

// ---------------------------------------------------------------- Singapore River bumboat
function buildBumboat(lod) {
  const hi = lod === 'high';
  const atlas = new Atlas();
  const pb = new PartBuilder(atlas);
  const gpb = new PartBuilder(atlas);
  const L = 11, zF = -5.5, zR = 5.5;
  const H = {
    L, zF, round: true, rim: 0.12,
    hb: t => 1.45 * (t < 0.24 ? Math.pow(Math.sin(t / 0.24 * Math.PI / 2), 0.62) : 1) * (1 - 0.14 * clamp01((t - 0.86) / 0.14) ** 1.5),
    yk: monotone([[0, 0.2], [0.06, -0.22], [0.18, -0.42], [0.9, -0.42], [1, -0.28]]),
    yc: monotone([[0, 0.45], [0.1, 0.0], [0.25, -0.12], [0.9, -0.12], [1, 0.0]]),
    ys: monotone([[0, 1.25], [0.05, 1.0], [0.18, 0.74], [0.5, 0.64], [0.88, 0.7], [1, 0.8]]),
    crown: monotone([[0, 0.03], [1, 0.03]]),
    tub: monotone([[0.1, 0], [0.13, 1], [0.86, 1], [0.89, 0]]),
    floor: () => 0.14,
    extraT: [0.004, 0.012, 0.025, 0.04, 0.06],
  };
  const n = hi ? { v: 5, side: 3, deck: 6 } : { v: 2, side: 1, deck: 4 };
  const meta = hullMeta(H, n);
  const paintSurf = [];
  buildHull(pb, H, n, hi ? 90 : 26, (t, h) => (h >= meta.iDeck + 2 && H.tub(t) > 0.5 ? 'wood' : 'paint'), paintSurf);
  const zOf = t => zF + t * L;
  // gunwale cap (wood rail)
  if (hi) for (const s of [1, -1]) {
    const pts = []; for (let i = 0; i <= 24; i++) { const t = 0.03 + 0.96 * i / 24; pts.push([s * (H.hb(t) - 0.04), H.ys(t) + 0.03, zOf(t)]); }
    pb.add(tube(pts, 0.045, 6, 48), 'wood', { color: 0x6b3f1e });
  }
  // canopy: posts + roof with red fascia
  const roofY = 2.35, rz0 = zOf(0.14), rz1 = zOf(0.88);
  const postT = [0.16, 0.3, 0.44, 0.58, 0.72, 0.86];
  for (const s of [1, -1]) for (const t of postT) pb.add(cyl(0.035, 0.035, roofY - H.ys(t), hi ? 8 : 5), 'steel', { matrix: M4.t(s * (H.hb(t) - 0.14), (roofY + H.ys(t)) / 2, zOf(t)), color: 0xe8e8e8 });
  pb.add(hi ? roundedBox(2.75, 0.08, rz1 - rz0, 0.03, 2) : box(2.75, 0.08, rz1 - rz0), 'painted', { matrix: M4.t(0, roofY + 0.04, (rz0 + rz1) / 2), color: 0xf2efe6 });
  const fasc = box(2.8, 0.22, 0.04);
  pb.add(fasc, 'painted', { matrix: M4.t(0, roofY - 0.04, rz0 - 0.02), color: 0xb8262c });
  pb.add(fasc, 'painted', { matrix: M4.t(0, roofY - 0.04, rz1 + 0.02), color: 0xb8262c });
  for (const s of [1, -1]) pb.add(box(0.04, 0.22, rz1 - rz0), 'painted', { matrix: M4.t(s * 1.4, roofY - 0.04, (rz0 + rz1) / 2), color: 0xb8262c });
  // fairy lights along the canopy edge (lit at night)
  for (const s of [1, -1]) pb.add(box(0.025, 0.025, rz1 - rz0), 'navWhite', { matrix: M4.t(s * 1.43, roofY - 0.17, (rz0 + rz1) / 2), emit: 0xffc870 });
  // name boards on the fascia
  const nb = plane(2.0, 0.16);
  pb.add(nb, 'decal', { matrix: M4.trs(0, roofY - 0.04, rz0 - 0.045, 0, Math.PI, 0), uvRect: atlas.rect('sign') });
  pb.add(nb, 'decal', { matrix: M4.trs(0, roofY - 0.04, rz1 + 0.045), uvRect: atlas.rect('sign') });
  // benches along both sides + centre
  for (const s of [1, -1]) {
    pb.add(box(0.42, 0.06, 7.6), 'wood', { matrix: M4.t(s * 1.0, 0.56, zOf(0.5)), color: 0x8b5a2b });
    pb.add(box(0.06, 0.4, 7.6), 'wood', { matrix: M4.t(s * 1.2, 0.78, zOf(0.5)), color: 0x7a4d24 });
    for (let i = 0; i < 6; i++) pb.add(box(0.36, 0.42, 0.05), 'wood', { matrix: M4.t(s * 1.0, 0.35, zOf(0.17) + i * 1.5), color: 0x5a3818 });
  }
  pb.add(box(0.5, 0.06, 5.0), 'wood', { matrix: M4.t(0, 0.56, zOf(0.5)), color: 0x8b5a2b });
  // wheelhouse at the stern (helm)
  const whz = zOf(0.8);
  pb.add(hi ? roundedBox(1.3, 0.9, 1.1, 0.04, 2) : box(1.3, 0.9, 1.1), 'painted', { matrix: M4.t(0, 0.6, whz), color: 0xf2efe6 });
  for (const [x, z, ry, w] of [[0, whz - 0.56, 0, 1.15], [0.66, whz, Math.PI / 2, 0.9], [-0.66, whz, -Math.PI / 2, 0.9]]) {
    const g = plane(w, 0.55); (hi ? gpb : pb).add(g, 'glass', { matrix: M4.trs(x, 1.4, z, 0, ry + Math.PI, 0) });
  }
  pb.add(box(0.06, 0.6, 0.06), 'painted', { matrix: M4.t(0.6, 1.4, whz - 0.53), color: 0xf2efe6 });
  pb.add(box(0.06, 0.6, 0.06), 'painted', { matrix: M4.t(-0.6, 1.4, whz - 0.53), color: 0xf2efe6 });
  // tyre fenders hung on the sides
  const tyre = new THREE.TorusGeometry(0.22, 0.08, hi ? 8 : 4, hi ? 16 : 8); tyre.deleteAttribute('uv');
  for (const s of [1, -1]) for (const t of [0.25, 0.42, 0.58, 0.74]) pb.add(tyre, 'rubber', { matrix: M4.trs(s * (H.hb(t) + 0.06), 0.42, zOf(t), 0, Math.PI / 2, 0) });
  // bow bitt + nav lights
  pb.add(cyl(0.06, 0.07, 0.25, 8), 'steel', { matrix: M4.t(0, H.ys(0.05) + 0.12, zOf(0.05)) });
  navLights(pb, hi, { red: [-(H.hb(0.1) - 0.02), H.ys(0.1) + 0.06, zOf(0.1)], green: [H.hb(0.1) - 0.02, H.ys(0.1) + 0.06, zOf(0.1)], white: [0, roofY + 0.2, zOf(0.86)] });
  // livery: red hull, white sheer band, bow eyes, name
  const d = { zF, L, yMax: 1.4, yMin: -0.5, W: 2.9, yF: 1.4, yMinF: -0.5, frontDepth: 0.5, rearDepth: 0.4 };
  atlas.draw('sign', (c, w, h) => { c.fillStyle = '#b8262c'; c.fillRect(0, 0, w, h); text(c, 'SINGAPORE RIVER CRUISE', w / 2, h / 2, { size: h * 0.6, color: '#fff7e0', maxW: w * 0.92 }); });
  paintSides(atlas, d, (c, S) => {
    c.fillStyle = '#26201c'; c.fillRect(0, S.y(0.03), S.w, S.h);                        // waterline / bottom
    hstripe(c, S, zF, zR, z => H.ys((z - zF) / L) + 0.01, 0.13, '#f4efe2');
    hstripe(c, S, zF + 0.4, zR, () => 0.22, 0.05, '#e8c040');
    // painted eye near the bow ("oculus")
    const ez = zF + 0.85, ey = H.ys(0.08) - 0.28;
    const ex = S.x(ez), eyy = S.y(ey), rw = S.sx(0.32), rh = S.sy(0.16);
    c.save(); c.translate(ex, eyy);
    c.fillStyle = '#f7f2e4'; c.beginPath(); c.ellipse(0, 0, rw, rh, 0, 0, Math.PI * 2); c.fill();
    c.lineWidth = 3; c.strokeStyle = '#111'; c.stroke();
    c.fillStyle = '#111'; c.beginPath(); c.arc(S.side === 'R' ? -rw * 0.22 : rw * 0.22, 0, rh * 0.75, 0, Math.PI * 2); c.fill();
    c.restore();
    text(c, 'RIVER EXPLORER 18', S.x(zF + 4.6), S.y(0.42), { size: S.sy(0.12), color: '#f4efe2', maxW: S.sx(3.2) });
  });
  paintEnds(atlas, d, (c, F) => { c.fillStyle = '#26201c'; c.fillRect(0, F.y(0.03), F.w, F.h); }, (c, F) => { c.fillStyle = '#26201c'; c.fillRect(0, F.y(0.03), F.w, F.h); text(c, 'RIVER EXPLORER', F.x(0), F.y(0.55), { size: F.sy(0.09), color: '#f4efe2' }); });
  return {
    geometry: pb.build(), glassGeo: hi ? gpb.build() : null, atlas, design: { bodyColor: 0xb8262c }, decal: d,
    wheels: [], headlights: [], wake: { x: 0, y: 0, z: zR + 0.2 },
  };
}

// ---------------------------------------------------------------- light helicopter (Bell 206-ish)
function rrSection(hw, yb, yt, r, n, crown = 0) {
  hw = Math.max(1e-4, hw);
  r = Math.max(1e-4, Math.min(r, hw * 0.98, (yt - yb) * 0.49));
  const pts = [[0, yb], [Math.max(0, hw - r) * 0.5, yb], [Math.max(0, hw - r), yb]];
  for (let i = 1; i <= n.c; i++) { const a = -Math.PI / 2 + i / n.c * Math.PI / 2; pts.push([hw - r + Math.cos(a) * r, yb + r + Math.sin(a) * r]); }
  for (let i = 1; i <= n.s; i++) { const f = i / n.s; pts.push([hw + 0.02 * hw * Math.sin(f * Math.PI), yb + r + (yt - 2 * r - yb) * f]); }
  for (let i = 1; i <= n.c; i++) { const a = i / n.c * Math.PI / 2; pts.push([hw - r + Math.cos(a) * r, yt - r + Math.sin(a) * r]); }
  for (let i = 1; i <= n.t; i++) { const f = i / n.t, x = (hw - r) * (1 - f); pts.push([x, yt + crown * (1 - (x / Math.max(1e-6, hw - r)) ** 2)]); }
  return pts;
}

function buildHeli(lod, police) {
  const hi = lod === 'high';
  const atlas = new Atlas();
  const pb = new PartBuilder(atlas);
  const gpb = new PartBuilder(atlas);
  // cabin: z from -2.25 (nose) to 1.55
  const zF = -2.25, Lc = 3.8;
  const hw = monotone([[0, 0.06], [0.03, 0.34], [0.1, 0.52], [0.25, 0.64], [0.7, 0.65], [0.9, 0.6], [1, 0.42]]);
  const yb = monotone([[0, 1.08], [0.04, 0.86], [0.14, 0.7], [0.3, 0.64], [0.75, 0.64], [0.92, 0.78], [1, 1.1]]);
  const yt = monotone([[0, 1.18], [0.04, 1.5], [0.13, 1.88], [0.28, 2.13], [0.45, 2.2], [0.85, 2.2], [1, 2.02]]);
  const rr = monotone([[0, 0.05], [0.1, 0.25], [0.3, 0.3], [1, 0.25]]);
  const n = hi ? { c: 4, s: 5, t: 6 } : { c: 1, s: 2, t: 2 };
  const ts = stations(hi ? 70 : 16, [0.006, 0.015, 0.03]);
  const zOf = t => zF + t * Lc;
  const cabin = [];
  loftParts(pb, ts, t => rrSection(hw(t), yb(t), yt(t), rr(t), n, 0.04), zOf, () => 'paint', cabin);
  const capR = capGeometry(fullLoop2D(rrSection(hw(1), yb(1), yt(1), rr(1), n, 0.04)), zOf(1), 1);
  pb.add(capR, 'paint');
  // glazing: big windscreen + chin bubbles + door windows (patches hugging the cabin)
  const G = hi ? gpb : pb, gopt = hi ? { offset: 0.006, rough: 0.02, metal: 0.5, color: 0x24323c } : { offset: 0.006 };
  const tz = t => zOf(t);
  patch(G, cabin, 'glass', [p => p.z - tz(0.3), p => 1.3 - p.y, p => p.y - 2.08, p => Math.abs(p.x) - 0.6], gopt);
  patch(G, cabin, 'glass', [p => p.z - tz(0.16), p => p.y - 1.22, p => 0.86 - p.y, p => Math.abs(p.x) - 0.5, p => 0.05 - Math.abs(p.x)], gopt);
  for (const [a, b] of [[0.33, 0.55], [0.6, 0.82]]) patch(G, cabin, 'glass', [p => tz(a) - p.z, p => p.z - tz(b), p => 1.3 - p.y, p => p.y - 2.0, (p, nn) => 0.5 - Math.abs(nn.x)], gopt);
  // door frames / handles
  for (const s of [1, -1]) {
    pb.add(box(0.012, 1.25, 0.04), 'trim', { matrix: M4.t(s * 0.655, 1.4, tz(0.575)) });
    pb.add(box(0.02, 0.025, 0.12), 'chrome', { matrix: M4.t(s * 0.66, 1.25, tz(0.52)) });
  }
  // engine cowling, intakes, exhaust, mast
  pb.add(hi ? roundedBox(0.9, 0.45, 2.0, 0.15, 3) : box(0.9, 0.45, 2.0), 'paint', { matrix: M4.t(0, 2.35, 0.55) });
  for (const s of [1, -1]) pb.add(box(0.03, 0.18, 0.4), 'grille', { matrix: M4.t(s * 0.455, 2.36, 0.1) });
  const exh = cyl(0.12, 0.12, 0.35, hi ? 12 : 6); exh.rotateX(Math.PI / 2 - 0.3);
  pb.add(exh, 'darkAlloy', { matrix: M4.t(0, 2.5, 1.6) });
  pb.add(cyl(0.09, 0.12, 0.55, hi ? 12 : 6), 'steel', { matrix: M4.t(0, 2.75, 0.25) });
  // tail boom (tapered), stabiliser with endplates, vertical fin, tail skid
  const boom = new THREE.CylinderGeometry(0.13, 0.33, 5.3, hi ? 18 : 8); boom.deleteAttribute('uv');
  boom.rotateX(Math.PI / 2); // cylinder top (thin end) -> +z, i.e. the tail
  const boomTilt = 0.04;
  pb.add(boom, 'paint', { matrix: M4.trs(0, 1.98, 4.05, -boomTilt, 0, 0) });
  const stab = hi ? roundedBox(2.1, 0.05, 0.45, 0.02, 2) : box(2.1, 0.05, 0.45);
  pb.add(stab, 'paint', { matrix: M4.t(0, 2.1, 5.3) });
  for (const s of [1, -1]) pb.add(box(0.04, 0.4, 0.42), 'paint', { matrix: M4.t(s * 1.05, 2.1, 5.32) });
  const fin = new THREE.Shape(); fin.moveTo(0, -0.55); fin.lineTo(0.55, -0.45); fin.lineTo(0.75, 0.95); fin.lineTo(0.35, 0.95); fin.lineTo(-0.05, 0.15); fin.closePath();
  const finG = new THREE.ExtrudeGeometry(fin, { depth: 0.06, bevelEnabled: hi, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 }); finG.deleteAttribute('uv');
  finG.translate(0, 0, -0.03); finG.rotateY(-Math.PI / 2);
  pb.add(finG, 'paint', { matrix: M4.t(0, 2.15, 6.15) });
  pb.add(tube([[0, 1.62, 6.2], [0, 1.4, 6.5], [0, 1.45, 6.75]], 0.02, 5, 6), 'steel');
  pb.add(cyl(0.05, 0.05, 0.25, 8), 'darkAlloy', { matrix: M4.trs(-0.12, 2.12, 6.62, 0, 0, Math.PI / 2) });
  // skids: two tubes with upturned toes + arched cross tubes
  for (const s of [1, -1]) {
    const x = s * 1.0;
    pb.add(tube([[x, 0.05, 1.7], [x, 0.04, 0.4], [x, 0.04, -1.1], [x, 0.12, -1.55], [x, 0.3, -1.72]], 0.045, hi ? 10 : 5, hi ? 24 : 8), 'steel', { color: 0x9a9da0 });
  }
  for (const z of [-0.55, 0.95]) pb.add(tube([[-1.0, 0.05, z], [-0.85, 0.5, z], [-0.5, 0.7, z], [0.5, 0.7, z], [0.85, 0.5, z], [1.0, 0.05, z]], 0.04, hi ? 8 : 4, hi ? 20 : 8), 'steel', { color: 0x9a9da0 });
  // interior (visible through the bubble)
  if (hi) {
    pb.add(box(1.1, 0.22, 0.4), 'interior', { matrix: M4.trs(0, 1.32, tz(0.2), 0.3, 0, 0) });
    for (const x of [0.33, -0.33]) {
      pb.add(roundedBox(0.46, 0.12, 0.48, 0.04, 2), 'interior', { matrix: M4.t(x, 0.98, -0.65) });
      pb.add(roundedBox(0.44, 0.62, 0.1, 0.04, 2), 'interior', { matrix: M4.trs(x, 1.32, -0.4, -0.12, 0, 0) });
      pb.add(cyl(0.015, 0.015, 0.45, 6), 'black', { matrix: M4.trs(x, 1.0, -0.98, -0.3, 0, 0) });
    }
    pb.add(roundedBox(1.15, 0.5, 0.12, 0.04, 2), 'interior', { matrix: M4.t(0, 1.25, 0.7) });
  }
  // lights: nav (port red / stbd green on the stabiliser tips), tail strobe, beacons, landing light
  navLights(pb, hi, { red: [-1.08, 2.1, 5.15], green: [1.08, 2.1, 5.15] });
  pb.add(sphere(0.04, 6, 4), 'strobe', { matrix: M4.t(0, 3.1, 6.78) });
  pb.add(sphere(0.045, 8, 6), 'beacon', { matrix: M4.t(0, 2.6, 1.3) });
  pb.add(sphere(0.045, 8, 6), 'beacon', { matrix: M4.t(0, 0.66, 0.2) });
  pb.add(cyl(0.06, 0.06, 0.04, 10), 'head', { matrix: M4.trs(0, 0.82, tz(0.05), Math.PI / 2 - 0.3, 0, 0) });
  let spotlight = null;
  if (police) {
    pb.add(cyl(0.1, 0.1, 0.22, 12), 'black', { matrix: M4.trs(0.45, 0.6, -1.2, Math.PI / 2, 0, 0) });
    pb.add(cyl(0.085, 0.085, 0.01, 12), 'head', { matrix: M4.trs(0.45, 0.6, -1.32, Math.PI / 2, 0, 0) });
    pb.add(box(0.05, 0.12, 0.05), 'black', { matrix: M4.t(0.45, 0.68, -1.2) });
    spotlight = { x: 0.45, y: 0.6, z: -1.33, pitch: -0.9 };
    for (const s of [1, -1]) pb.add(box(0.05, 0.05, 0.16), s > 0 ? 'sirenB' : 'sirenR', { matrix: M4.t(s * 0.5, 2.25, -0.3) });
  }
  // rotors (separate objects so the game can spin them)
  const main = rotorBlades(5.1, 0.33, 2, 0.16, hi, { tipMat: 'paint' });
  main.add(cyl(0.05, 0.05, 0.5, 8), 'steel', { matrix: M4.trs(0, 0.06, 0, 0, 0, Math.PI / 2) }); // stabiliser bar
  const tail = new PartBuilder(null);
  for (let i = 0; i < 2; i++) tail.add(hi ? roundedBox(0.035, 0.72, 0.14, 0.01, 1) : box(0.03, 0.72, 0.14), 'rotor', { matrix: M4.t(0, (i ? -1 : 1) * 0.42, 0) });
  tail.add(cyl(0.05, 0.05, 0.08, 8), 'steel', { matrix: M4.trs(0, 0, 0, 0, 0, Math.PI / 2) });
  // livery
  const d = { zF, L: 9.05, yMax: 3.2, yMin: 0.4, W: 1.35, yF: 2.3, yMinF: 0.5, frontDepth: 0.4, rearDepth: 0.3 };
  const body = police ? 0xf4f4f2 : 0xf6f6f3;
  paintSides(atlas, d, (c, S) => {
    if (police) {
      hstripe(c, S, zF + 0.4, 6.8, z => z < 1.6 ? 1.12 : 2.0 + 0.04 * (z - 1.6), 0.12, '#1b3f9a');
      hstripe(c, S, zF + 0.6, 6.8, z => z < 1.6 ? 0.98 : 1.9 + 0.04 * (z - 1.6), 0.05, '#d0202b');
      text(c, 'POLICE', S.x(0.2), S.y(1.72), { size: S.sy(0.26), color: '#1b3f9a', font: 'Arial Black, Arial', maxW: S.sx(1.6) });
      text(c, 'SPF AIR WING', S.x(3.6), S.y(2.06), { size: S.sy(0.12), color: '#1b3f9a', maxW: S.sx(2.0) });
      text(c, '9V-SPF', S.x(5.4), S.y(2.38), { size: S.sy(0.09), color: '#111' });
    } else {
      hstripe(c, S, zF + 0.2, 1.6, z => 1.27 - 0.03 * (z - zF), 0.15, '#ff2fa0');
      hstripe(c, S, zF + 0.4, 1.6, z => 1.08 - 0.03 * (z - zF), 0.07, '#19d3e6');
      hstripe(c, S, 1.4, 6.9, z => 2.12 + 0.04 * (z - 1.4), 0.09, '#ff2fa0');
      hstripe(c, S, 1.4, 6.9, z => 1.98 + 0.04 * (z - 1.4), 0.04, '#19d3e6');
      text(c, 'VIBE AIR', S.x(3.45), S.y(2.0), { size: S.sy(0.24), color: '#ff2fa0', italic: true, font: 'Arial Black, Arial', stroke: '#19d3e6', strokeW: 2, maxW: S.sx(2.0) });
      text(c, '9V-VCE', S.x(1.05), S.y(0.95), { size: S.sy(0.12), color: '#222' });
      text(c, 'VIBE AIR', S.x(0.6), S.y(2.38), { size: S.sy(0.1), color: '#ff2fa0', italic: true, font: 'Arial Black, Arial' });
    }
  });
  paintEnds(atlas, d, (c, F) => { if (police) text(c, 'POLICE', F.x(0), F.y(0.9), { size: F.sy(0.1), color: '#1b3f9a', font: 'Arial Black, Arial' }); }, null);
  return {
    geometry: pb.build(), glassGeo: hi ? gpb.build() : null, atlas, design: { bodyColor: body }, decal: d,
    wheels: [], headlights: [{ x: 0, y: 0.82, z: tz(0.05) }],
    rotors: {
      main: { pos: [0, 3.05, 0.25], axis: 'y', geometry: main.build(), radius: 5.1, blades: 2 },
      tail: { pos: [-0.22, 2.12, 6.62], axis: 'x', geometry: tail.build(), radius: 0.8, blades: 2, ratio: 4.7 },
    },
    spotlight,
  };
}

// ---------------------------------------------------------------- DurianDash delivery drone
function buildDrone(lod) {
  const hi = lod === 'high';
  const atlas = new Atlas();
  const pb = new PartBuilder(atlas);
  const by = 0.78;
  pb.add(hi ? roundedBox(0.62, 0.24, 0.86, 0.09, 3) : box(0.62, 0.24, 0.86), 'paint', { matrix: M4.t(0, by, 0) });
  pb.add(hi ? roundedBox(0.4, 0.1, 0.5, 0.04, 2) : box(0.4, 0.1, 0.5), 'trim', { matrix: M4.t(0, by + 0.16, 0.05) });
  pb.add(sphere(0.07, hi ? 12 : 6, hi ? 8 : 4), 'glassDark', { matrix: M4.t(0, by - 0.08, -0.42) });
  const props = [];
  const arm = 0.66;
  for (const [sx, sz, i] of [[1, -1, 0], [-1, -1, 1], [1, 1, 2], [-1, 1, 3]]) {
    const mx = sx * arm, mz = sz * arm;
    pb.add(tube([[sx * 0.2, by + 0.02, sz * 0.25], [mx, by + 0.05, mz]], 0.03, hi ? 8 : 4, 2), 'painted', { color: 0x1c1c1e });
    pb.add(cyl(0.06, 0.07, 0.11, hi ? 14 : 6), 'darkAlloy', { matrix: M4.t(mx, by + 0.1, mz) });
    pb.add(tube([[mx * 0.75, by, mz * 0.75], [mx * 0.85, 0.25, mz * 0.85], [mx * 0.9, 0.02, mz * 0.9]], 0.018, 5, 4), 'painted', { color: 0x1c1c1e });
    pb.add(sphere(0.03, 6, 4), 'rubber', { matrix: M4.t(mx * 0.9, 0.025, mz * 0.9) });
    pb.add(box(0.05, 0.03, 0.05), sz < 0 ? 'navRed' : 'navGreen', { matrix: M4.t(mx, by + 0.02, mz) });
    const pp = new PartBuilder(null);
    for (const a of [0, Math.PI]) pp.add(hi ? roundedBox(0.34, 0.012, 0.06, 0.004, 1) : box(0.34, 0.012, 0.06), 'rotor', { matrix: M4.trs(Math.cos(a) * 0.19, 0, -Math.sin(a) * 0.19, 0.08, a, 0) });
    pp.add(cyl(0.025, 0.025, 0.04, 8), 'steel');
    props.push({ pos: [mx, by + 0.17, mz], axis: 'y', geometry: pp.build(), radius: 0.38, blades: 2, dir: i % 3 === 0 ? 1 : -1 });
  }
  pb.add(sphere(0.035, 6, 4), 'strobe', { matrix: M4.t(0, by + 0.22, 0.2) });
  pb.add(cyl(0.035, 0.035, 0.02, 8), 'head', { matrix: M4.trs(0, by - 0.06, -0.43, Math.PI / 2, 0, 0) });
  // cage hanging under the body with a durian inside
  const c0 = 0.12, c1 = 0.52, cw = 0.23;
  const edges = [];
  for (const y of [c0, c1]) for (const [a, b] of [[[-cw, -cw], [cw, -cw]], [[cw, -cw], [cw, cw]], [[cw, cw], [-cw, cw]], [[-cw, cw], [-cw, -cw]]]) edges.push([[a[0], y, a[1]], [b[0], y, b[1]]]);
  for (const [x, z] of [[-cw, -cw], [cw, -cw], [cw, cw], [-cw, cw]]) edges.push([[x, c0, z], [x, c1, z]]);
  for (const x of [-cw / 3, cw / 3]) for (const z of [-cw, cw]) edges.push([[x, c0, z], [x, c1, z]]);
  for (const [a, b] of edges) pb.add(tube([a, b], 0.008, 4, 1), 'steel', { color: 0xc8c8c8 });
  pb.add(box(cw * 2, 0.01, cw * 2), 'steel', { matrix: M4.t(0, c0, 0), color: 0x9a9a9a });
  for (const [x, z] of [[-cw, -cw], [cw, -cw], [cw, cw], [-cw, cw]]) pb.add(tube([[x, c1, z], [x * 0.5, by - 0.1, z * 0.6]], 0.006, 4, 1), 'black');
  const dur = new THREE.IcosahedronGeometry(0.17, hi ? 2 : 1); dur.deleteAttribute('uv'); dur.scale(1, 1.15, 1);
  pb.add(dur, 'painted', { matrix: M4.t(0, 0.31, 0), color: 0x7d8a2a, rough: 0.9 });
  const spike = new THREE.ConeGeometry(0.022, 0.06, 4); spike.deleteAttribute('uv'); spike.translate(0, 0.03, 0);
  const dp = new THREE.IcosahedronGeometry(1, hi ? 2 : 1).attributes.position;
  const seen = new Set(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), q = new THREE.Quaternion();
  for (let i = 0; i < dp.count; i++) {
    v.set(dp.getX(i), dp.getY(i), dp.getZ(i)).normalize();
    const k = v.toArray().map(x => x.toFixed(2)).join();
    if (seen.has(k)) continue; seen.add(k);
    q.setFromUnitVectors(up, v);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(v.x * 0.165, 0.31 + v.y * 0.19, v.z * 0.165), q, new THREE.Vector3(1, 1, 1));
    pb.add(spike, 'painted', { matrix: m, color: 0x5f6a1c, rough: 0.9 });
  }
  pb.add(cyl(0.015, 0.02, 0.06, 5), 'painted', { matrix: M4.t(0, 0.52, 0), color: 0x4a3a1a });
  // branding panels on the body sides
  atlas.draw('sign', (c, w, h) => { c.fillStyle = '#1a1a1a'; c.fillRect(0, 0, w, h); text(c, 'DurianDash', w / 2, h * 0.42, { size: h * 0.5, color: '#f2c418', italic: true, font: 'Arial Black, Arial', maxW: w * 0.9 }); text(c, 'king of fruits · 15 min', w / 2, h * 0.82, { size: h * 0.17, color: '#9fd23a', maxW: w * 0.9 }); });
  const panel = plane(0.8, 0.16);
  for (const s of [1, -1]) pb.add(panel, 'decal', { matrix: M4.trs(s * 0.315, by, 0, 0, s * Math.PI / 2, 0), uvRect: atlas.rect('sign') });
  return {
    geometry: pb.build(), glassGeo: null, atlas, design: { bodyColor: 0xf2c418 }, decal: null,
    wheels: [], headlights: [], rotors: { props },
  };
}

export const CRAFT = {
  jetski: lod => buildJetski(lod),
  speedboat: lod => buildSpeedboat(lod),
  bumboat: lod => buildBumboat(lod),
  heli: lod => buildHeli(lod, false),
  heli_police: lod => buildHeli(lod, true),
  drone: lod => buildDrone(lod),
};
