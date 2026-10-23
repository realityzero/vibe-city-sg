// Per-type vehicle designs: lofted body profiles, lights, livery painters and details.
import * as THREE from 'three';
import { roundedBox, box, cyl, M4, plane } from './geom.js';
import { plate, grille, seam, handle, text, roundRect, checker } from './atlas.js';

// ---------------------------------------------------------------- shared painters
function doorSeams(c, S, doors, { sillOff = 0.06, handleY = null, color } = {}) {
  const P = S.P;
  for (const d of doors) {
    const z0 = P.zOf(d[0]), z1 = P.zOf(d[1]);
    const yTop = (t) => P.ys(t) - 0.004;
    const yBot = (t) => Math.max(P.sill(t), P.arch(t)) + sillOff;
    const pts = [];
    // front edge (vertical), bottom, rear edge
    pts.push([S.x(z0), S.y(yTop(d[0]))], [S.x(z0), S.y(yBot(d[0]))]);
    const steps = 10;
    for (let i = 1; i <= steps; i++) { const t = d[0] + (d[1] - d[0]) * i / steps; pts.push([S.x(P.zOf(t)), S.y(Math.max(P.sill(t) + sillOff, Math.min(P.arch(t) + 0.03, yTop(t) - 0.1)))]); }
    pts.push([S.x(z1), S.y(yTop(d[1]))]);
    seam(c, pts, 2.2);
    const hy = handleY ?? (P.ys((d[0] + d[1]) / 2) - 0.085);
    const hz = P.zOf(d[1] - 0.045 * (1 / P.L) * 4.8);
    handle(c, S.x(hz), S.y(hy), S.sx(0.13), Math.max(5, S.sy(0.025)), color);
  }
}
function fuelCap(c, S, t, side = 'L') {
  if (S.side !== side) return;
  const P = S.P;
  const x = S.x(P.zOf(t)), y = S.y(P.ys(t) - 0.09);
  c.save(); c.strokeStyle = 'rgba(10,10,10,1)'; c.lineWidth = 2;
  roundRect(c, x - S.sx(0.09), y - S.sy(0.06), S.sx(0.18), S.sy(0.12), 5); c.stroke(); c.restore();
}
function sgPlateFront(c, F, txt, y = 0.42, opts) { plate(c, F.x(0), F.y(y), F.sx(0.52), F.sy(0.112), txt, opts); }
function sgPlateRear(c, F, txt, y = 0.62, opts) { plate(c, F.x(0), F.y(y), F.sx(0.52), F.sy(0.112), txt, opts); }

// ---------------------------------------------------------------- generic modern sedan
export function sedanBody(o = {}) {
  const L = o.L ?? 4.88, W = o.W ?? 1.84, H = o.H ?? 1.445;
  return {
    L, W, wb: o.wb ?? 2.825, fo: o.fo ?? 0.98, wr: o.wr ?? 0.33, ww: o.ww ?? 0.225, track: o.track ?? 1.59,
    plan: o.plan ?? { rf: 0.5, mf: 0.8, rr: 0.26, mr: 0.9 },
    sr: 0.075, br: 0.05, bulge: 0.012,
    shoulder: o.shoulder ?? [[0, 0.69], [0.012, 0.735], [0.035, 0.765], [0.1, 0.785], [0.2, 0.805], [0.3, 0.86], [0.36, 0.9], [0.55, 0.93], [0.75, 0.965], [0.86, 0.985], [0.96, 0.985], [0.98, 0.965], [0.993, 0.93], [1, 0.88]],
    crown: o.crown ?? [[0, 0.02], [0.08, 0.055], [0.24, 0.055], [0.3, 0.02], [0.32, 0], [0.8, 0], [0.86, 0.025], [1, 0.015]],
    sill: o.sill ?? [[0, 0.3], [0.02, 0.24], [0.08, 0.2], [0.9, 0.2], [0.97, 0.28], [1, 0.39]],
    tumble: [[0, 0.02], [0.3, 0.035], [0.8, 0.04], [1, 0.03]],
    green: {
      t0: 0.315, t1: 0.47, t2: 0.705, t3: 0.845, H, roofW: 0.74, inset: 0.035, edgeR: 0.07, bow: 0.022,
      sideStart: 0.333, sideEnd: 0.8, pillars: [[0.556, 0.572]], bPillar: 'trim', aPillar: 'paint', cPillar: 'paint',
      ...o.green,
    },
    transparentGlass: true,
    ...o.body,
  };
}

function sedanLights(P, G, C, o = {}) {
  const L = [];
  // headlights: swept wrap-around units at the upper front corners: gloss-black housing, lamp inset, DRL strip
  const hx0 = o.headX0 ?? 0.36, hH = o.headH ?? 0.12, d0 = o.headD0 ?? 0.06, d1 = o.headD1 ?? 0.46, hw = P.def.W / 2;
  L.push({ mat: 'trim', c: [C.axMin(hx0), ...C.shoulderBand(P, -hH, 0.02), C.frontSweep(P, hx0, d0, hw, d1)] });
  L.push({ mat: 'head', c: [C.axMin(hx0 + 0.07), C.axMax(hw - 0.05), ...C.shoulderBand(P, -hH + 0.028, 0.0), C.frontSweep(P, hx0, d0 - 0.01, hw, d1 - 0.07)], offset: 0.0055 });
  L.push({ mat: 'drl', c: [C.axMin(hx0 + 0.02), ...C.shoulderBand(P, -hH + 0.006, -hH + 0.022), C.frontSweep(P, hx0, d0, hw, d1 - 0.02)], offset: 0.0065 });
  L.push({ mat: 'indL', c: [p => p.x + (hw - 0.14), ...C.shoulderBand(P, -hH + 0.03, -0.005), C.frontSweep(P, hx0, d0 + 0.2, hw, d1 + 0.02), p => (P.zF + d0 + 0.12 + (d1 - d0) * Math.min(1, Math.max(0, (Math.abs(p.x) - hx0) / (hw - hx0)))) - p.z], offset: 0.0062 });
  L.push({ mat: 'indR', c: [p => (hw - 0.14) - p.x, ...C.shoulderBand(P, -hH + 0.03, -0.005), C.frontSweep(P, hx0, d0 + 0.2, hw, d1 + 0.02), p => (P.zF + d0 + 0.12 + (d1 - d0) * Math.min(1, Math.max(0, (Math.abs(p.x) - hx0) / (hw - hx0)))) - p.z], offset: 0.0062 });
  // tail lights: wrap-around clusters + reverse lamps
  L.push({ mat: 'tail', c: [C.axMin(o.tailX0 ?? 0.34), ...C.shoulderBand(P, -(o.tailH ?? 0.15), 0.012), C.rearSweep(P, 0.34, 0.05, P.def.W / 2, o.tailD1 ?? 0.3)] });
  L.push({ mat: 'rev', c: [C.axMin((o.tailX0 ?? 0.34) + 0.02), C.axMax((o.tailX0 ?? 0.34) + 0.16), ...C.shoulderBand(P, -(o.tailH ?? 0.15) + 0.005, -(o.tailH ?? 0.15) + 0.05), C.facingZ(1, 0.5)], offset: 0.007 });
  return L;
}

function paintSedanSide(o = {}) {
  return (c, S) => {
    const doors = o.doors ?? [[0.335, 0.562], [0.566, 0.765]];
    doorSeams(c, S, doors, { color: o.handleColor });
    fuelCap(c, S, 0.8, 'L');
    if (o.livery) o.livery(c, S);
    // rocker shadow line
    c.save(); c.fillStyle = 'rgba(12,12,12,1)';
    const P = S.P;
    for (let i = 0; i < 60; i++) {
      const t0 = 0.27 + i * 0.0085, t = t0 + 0.0085;
      if (P.arch(t0) > 0 || P.arch(t) > 0) continue;
      c.fillRect(S.x(P.zOf(S.side === 'R' ? t : t0)), S.y(P.sill(t0) + 0.075), Math.abs(S.x(P.zOf(t)) - S.x(P.zOf(t0))) + 1, S.sy(0.05));
    }
    c.restore();
  };
}

function paintSedanFront(o = {}) {
  return (c, F) => {
    const gy = o.grilleY ?? 0.555, gh = o.grilleH ?? 0.13, gw = o.grilleW ?? 0.9;
    grille(c, F.x(gw / 2), F.y(gy + gh), F.sx(gw), F.sy(gh), { style: o.grilleStyle ?? 'bars', bar: o.grilleBar ?? '#4a4a4a', surround: o.surround ?? '#cfcfcf', r: 10 });
    // lower intake
    const iy = o.intakeY ?? 0.36;
    grille(c, F.x(0.58), F.y(iy), F.sx(1.16), F.sy(0.09), { style: 'mesh', bar: '#2a2a2a', surroundW: 0, r: 14 });
    // fog lamp pods
    for (const x of [0.68, -0.68]) { c.fillStyle = '#0c0c0c'; roundRect(c, F.x(x) - F.sx(0.08), F.y(iy + 0.005), F.sx(0.16), F.sy(0.075), 8); c.fill(); c.fillStyle = '#e4e4e4'; c.beginPath(); c.arc(F.x(x), F.y(iy - 0.03), F.sx(0.028), 0, 7); c.fill(); }
    sgPlateFront(c, F, o.plate ?? 'SGX 1986 A', o.plateY ?? 0.43);
    if (o.badge !== false) { c.fillStyle = '#d0d0d0'; c.beginPath(); c.ellipse(F.x(0), F.y(gy + gh / 2), F.sx(0.06), F.sy(0.035), 0, 0, 7); c.fill(); c.fillStyle = '#222'; c.beginPath(); c.ellipse(F.x(0), F.y(gy + gh / 2), F.sx(0.045), F.sy(0.024), 0, 0, 7); c.fill(); }
    if (o.extra) o.extra(c, F);
  };
}
function paintSedanRear(o = {}) {
  return (c, F) => {
    sgPlateRear(c, F, o.plate ?? 'SGX 1986 A', o.plateY ?? 0.66);
    // bumper reflectors + diffuser
    for (const x of [0.7, -0.7]) { c.fillStyle = '#7a0b0b'; roundRect(c, F.x(x) - F.sx(0.08), F.y(0.42), F.sx(0.16), F.sy(0.025), 4); c.fill(); }
    c.fillStyle = '#101010'; roundRect(c, F.x(-0.6), F.y(0.33), F.sx(1.2), F.sy(0.09), 10); c.fill();
    if (o.badgeText) text(c, o.badgeText, F.x(o.badgeX ?? -0.45), F.y(0.8), { size: Math.round(F.sy(0.04)), color: '#d9d9d9', font: 'Arial, sans-serif', weight: 'bold' });
    if (o.extra) o.extra(c, F);
  };
}

// ---------------------------------------------------------------- taxis
function taxiDetails(o) {
  return det => {
    const { pb, P, G, hi, atlas } = det;
    const t = (P.def.green.t1 + P.def.green.t2) / 2 - 0.02;
    const y = G.roofY(t, P.ys(t)) + G.crown;
    const z = P.zOf(t);
    const w = 0.74, h = 0.19, d = 0.26;
    pb.add(hi ? roundedBox(w, h, d, 0.03, 3) : box(w, h, d), 'plastic', { matrix: M4.t(0, y + h / 2 + 0.035, z), color: o.signBody ?? 0xf2f2f2 });
    pb.add(box(0.1, 0.04, 0.05), 'black', { matrix: M4.t(0.3, y + 0.02, z) });
    pb.add(box(0.1, 0.04, 0.05), 'black', { matrix: M4.t(-0.3, y + 0.02, z) });
    // front/back faces: LED "TAXI" (green when free, red when hired); sides + top: brand print
    const face = plane(w * 0.9, h * 0.72);
    const led = atlas.rect('sign2'), brand = atlas.rect('sign');
    pb.add(face, 'taxiSign', { matrix: M4.trs(0, y + h / 2 + 0.035, z - d / 2 - 0.004, 0, Math.PI, 0), uvRect: led });
    pb.add(face, 'taxiSign', { matrix: M4.trs(0, y + h / 2 + 0.035, z + d / 2 + 0.004), uvRect: led });
    const top = plane(w * 0.9, d * 0.8); top.rotateX(-Math.PI / 2);
    pb.add(top, 'decal', { matrix: M4.t(0, y + h + 0.037, z), uvRect: brand });
  };
}
function paintTaxiSigns(atlas, brand, color) {
  atlas.draw('sign', (c, w, h) => { c.fillStyle = color; c.fillRect(0, 0, w, h); text(c, brand, w / 2, h / 2, { size: h * 0.5, color: '#fff', maxW: w * 0.9 }); });
  atlas.draw('sign2', (c, w, h) => { c.fillStyle = '#050505'; c.fillRect(0, 0, w, h); text(c, 'TAXI', w / 2, h / 2, { size: h * 0.8, color: '#fff', font: '"Courier New", monospace', maxW: w * 0.8 }); });
}

// ---------------------------------------------------------------- design table
export const DESIGNS = {};

DESIGNS.sedan = () => ({
  body: sedanBody(),
  lights: (P, G, C) => sedanLights(P, G, C),
  paintSide: paintSedanSide(),
  paintFront: paintSedanFront({ plate: 'SKQ 4127 M' }),
  paintRear: paintSedanRear({ plate: 'SKQ 4127 M', badgeText: 'CAMREE' }),
  exhaust: { x: [-0.5], r: 0.035 },
  rearBench: 0.95,
});

const taxi = (brand, color, phone, plateTxt) => () => ({
  body: sedanBody({ L: 4.77, W: 1.815, H: 1.47, wb: 2.77, fo: 0.95 }),
  lights: (P, G, C) => sedanLights(P, G, C),
  paintSide: paintSedanSide({
    livery: (c, S) => {
      const P = S.P;
      const tc = 0.5;
      text(c, brand, S.x(P.zOf(tc)), S.y(P.ys(tc) - 0.2), { size: S.sy(0.085), color: '#ffffff', italic: true, maxW: S.sx(1.2) });
      text(c, phone, S.x(P.zOf(tc)), S.y(P.ys(tc) - 0.32), { size: S.sy(0.06), color: '#ffffff', maxW: S.sx(0.8) });
    },
  }),
  paintFront: paintSedanFront({ plate: plateTxt, grilleStyle: 'mesh' }),
  paintRear: paintSedanRear({ plate: plateTxt, badgeText: 'HYUNDAE', extra: (c, F) => text(c, phone, F.x(0), F.y(0.76), { size: F.sy(0.05), color: '#fff' }) }),
  paintSigns: atlas => paintTaxiSigns(atlas, brand, '#' + new THREE.Color(color).getHexString()),
  details: taxiDetails({}),
  exhaust: { x: [-0.5], r: 0.03 },
  rearBench: 0.95,
});
DESIGNS.taxi = taxi('ComfyDelGo', 0x1f63c6, '6552 1111', 'SH 1234 Z');
DESIGNS.taxi_yellow = taxi('CityKab', 0xf2c418, '6555 1188', 'SH 5521 K');
DESIGNS.taxi_red = taxi('Trans-Kab', 0xc8202a, '6555 3333', 'SH 8808 T');

DESIGNS.police = () => ({
  body: sedanBody({ L: 4.63, W: 1.78, H: 1.46, wb: 2.70, fo: 0.92 }),
  lights: (P, G, C) => sedanLights(P, G, C),
  paintSide: paintSedanSide({
    livery: (c, S) => {
      const P = S.P;
      // blue / red bands with chequer, POLICE lettering
      const y0 = S.y(P.ys(0.5) - 0.17), y1 = S.y(P.ys(0.5) - 0.3);
      const xa = S.x(P.zOf(0.06)), xb = S.x(P.zOf(0.96));
      const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
      c.fillStyle = '#1b3f9a'; c.fillRect(x0, y0, x1 - x0, (y1 - y0) * 0.42);
      checker(c, x0, y0 + (y1 - y0) * 0.42, x1 - x0, (y1 - y0) * 0.34, S.sx(0.06), '#1b3f9a', '#ffffff', 2);
      c.fillStyle = '#d0202b'; c.fillRect(x0, y0 + (y1 - y0) * 0.76, x1 - x0, (y1 - y0) * 0.24);
      text(c, 'POLICE', S.x(P.zOf(0.5)), S.y(P.ys(0.5) - 0.09), { size: S.sy(0.1), color: '#1b3f9a', font: 'Arial Black, Arial, sans-serif', maxW: S.sx(1.1) });
      text(c, '999', S.x(P.zOf(0.88)), S.y(P.ys(0.88) - 0.1), { size: S.sy(0.07), color: '#1b3f9a' });
    },
  }),
  paintFront: paintSedanFront({ plate: 'QX 2468 B', grilleStyle: 'mesh', extra: (c, F) => text(c, 'POLICE', F.x(0), F.y(0.73), { size: F.sy(0.06), color: '#1b3f9a', font: 'Arial Black, Arial' }) }),
  paintRear: paintSedanRear({ plate: 'QX 2468 B', extra: (c, F) => text(c, 'POLICE', F.x(0), F.y(0.8), { size: F.sy(0.06), color: '#1b3f9a', font: 'Arial Black, Arial' }) }),
  details: det => {
    const { pb, P, G, hi } = det;
    const t = (P.def.green.t1 + P.def.green.t2) / 2 - 0.03;
    const y = G.roofY(t, P.ys(t)) + G.crown, z = P.zOf(t);
    pb.add(hi ? roundedBox(1.2, 0.07, 0.3, 0.025, 2) : box(1.2, 0.07, 0.3), 'black', { matrix: M4.t(0, y + 0.06, z) });
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      const x = -0.55 + (i + 0.5) * 1.1 / segs;
      const lens = hi ? roundedBox(1.1 / segs - 0.02, 0.07, 0.26, 0.02, 2) : box(1.1 / segs - 0.02, 0.07, 0.26);
      pb.add(lens, x > 0 ? 'sirenB' : 'sirenR', { matrix: M4.t(x, y + 0.125, z) });
    }
    pb.add(box(0.06, 0.05, 0.08), 'black', { matrix: M4.t(0.35, y + 0.015, z) });
    pb.add(box(0.06, 0.05, 0.08), 'black', { matrix: M4.t(-0.35, y + 0.015, z) });
  },
  bodyColor: 0xf4f4f2,
  rearBench: 0.92,
});

DESIGNS.luxury = () => ({
  body: sedanBody({
    L: 5.06, W: 1.9, H: 1.47, wb: 2.99, fo: 0.92, wr: 0.345, ww: 0.245, track: 1.63,
    shoulder: [[0, 0.68], [0.012, 0.72], [0.035, 0.765], [0.1, 0.8], [0.2, 0.83], [0.3, 0.88], [0.37, 0.93], [0.55, 0.955], [0.75, 0.99], [0.86, 1.005], [0.95, 0.995], [0.985, 0.95], [1, 0.88]],
    green: { t0: 0.335, t1: 0.485, t2: 0.715, t3: 0.85, sideStart: 0.35, sideEnd: 0.81, pillars: [[0.566, 0.58]], roofW: 0.73 },
  }),
  lights: (P, G, C) => sedanLights(P, G, C, { headH: 0.1, headD1: 0.4, tailH: 0.12 }),
  paintSide: paintSedanSide({ doors: [[0.355, 0.57], [0.575, 0.775]], livery: (c, S) => { /* chrome belt strip */ const P = S.P; c.fillStyle = '#e6e6e6'; const x0 = S.x(P.zOf(0.35)), x1 = S.x(P.zOf(0.8)); c.fillRect(Math.min(x0, x1), S.y(P.ys(0.55) - 0.008), Math.abs(x1 - x0), S.sy(0.012)); } }),
  paintFront: paintSedanFront({ plate: 'SMB 8 E', grilleStyle: 'vbars', grilleW: 0.62, grilleH: 0.16, grilleY: 0.47, grilleBar: '#d9d9d9', surround: '#efefef' }),
  paintRear: paintSedanRear({ plate: 'SMB 8 E', badgeText: 'S580', badgeX: 0.5 }),
  exhaust: { x: [-0.55, 0.55], r: 0.04 },
  seatMat: 'leather',
  rearBench: 1.0,
});

DESIGNS.suv = () => ({
  body: sedanBody({
    L: 4.6, W: 1.86, H: 1.68, wb: 2.69, fo: 0.93, wr: 0.36, ww: 0.235, track: 1.6,
    shoulder: [[0, 0.8], [0.012, 0.86], [0.04, 0.92], [0.12, 0.96], [0.22, 0.99], [0.3, 1.03], [0.36, 1.06], [0.6, 1.08], [0.8, 1.1], [0.95, 1.1], [0.985, 1.06], [1, 0.96]],
    crown: [[0, 0.02], [0.1, 0.05], [0.25, 0.05], [0.3, 0.015], [0.33, 0], [1, 0]],
    sill: [[0, 0.46], [0.03, 0.34], [0.1, 0.27], [0.9, 0.27], [0.96, 0.34], [1, 0.48]],
    green: { t0: 0.3, t1: 0.43, t2: 0.9, t3: 0.985, H: 1.68, roofW: 0.8, sideStart: 0.318, sideEnd: 0.93, pillars: [[0.545, 0.56], [0.79, 0.81]], cPillar: 'trim', bPillar: 'trim', wsCurve: 1.4, rgCurve: 1.1, roofDrop: 0.015 },
    body: { sideExp: 2.5 },
  }),
  lights: (P, G, C) => sedanLights(P, G, C, { headH: 0.11, tailH: 0.2, tailD1: 0.16 }),
  paintSide: paintSedanSide({ doors: [[0.32, 0.553], [0.556, 0.79]], livery: (c, S) => { const P = S.P; c.fillStyle = '#121212'; for (const [a, b] of [[0.1, 0.32], [0.66, 0.92]]) { /* wheel arch cladding */ } } }),
  paintFront: paintSedanFront({ plate: 'SLE 2207 H', grilleStyle: 'mesh', grilleW: 0.95, grilleH: 0.16, grilleY: 0.62, plateY: 0.5 }),
  paintRear: paintSedanRear({ plate: 'SLE 2207 H', plateY: 0.78, badgeText: 'RAV-5' }),
  decalYMax: 1.3, frontYMax: 1.25,
  details: det => {
    const { pb, P, G, hi } = det;
    // roof rails
    for (const s of [1, -1]) {
      const t0 = 0.47, t1 = 0.88, z0 = P.zOf(t0), z1 = P.zOf(t1);
      const y = G.roofY(0.65, P.ys(0.65)) + 0.035;
      pb.add(box(0.04, 0.04, z1 - z0), 'trim', { matrix: M4.t(s * P.def.W / 2 * 0.68, y, (z0 + z1) / 2) });
    }
  },
  rearBench: 0.85,
});

DESIGNS.mpv = () => ({
  body: sedanBody({
    L: 4.95, W: 1.85, H: 1.9, wb: 3.0, fo: 0.95, wr: 0.34, ww: 0.225, track: 1.58,
    shoulder: [[0, 0.86], [0.012, 0.93], [0.04, 0.99], [0.1, 1.02], [0.2, 1.035], [0.26, 1.045], [0.3, 1.05], [0.6, 1.055], [0.95, 1.06], [0.985, 1.03], [1, 0.95]],
    crown: [[0, 0.03], [0.1, 0.05], [0.2, 0.04], [0.25, 0.01], [0.28, 0], [1, 0]],
    sill: [[0, 0.42], [0.03, 0.3], [0.1, 0.24], [0.9, 0.24], [0.97, 0.3], [1, 0.45]],
    plan: { rf: 0.45, mf: 0.84, rr: 0.25, mr: 0.92 },
    green: { t0: 0.24, t1: 0.36, t2: 0.96, t3: 0.995, H: 1.9, roofW: 0.85, sideStart: 0.255, sideEnd: 0.965, pillars: [[0.42, 0.435], [0.7, 0.715]], aPillar: 'trim', bPillar: 'trim', cPillar: 'trim', wsCurve: 1.25, rgCurve: 1.0, roofDrop: 0.012, edgeR: 0.09, bow: 0.015 },
    body: { sideExp: 3 },
  }),
  lights: (P, G, C) => sedanLights(P, G, C, { headH: 0.12, headD1: 0.36, tailH: 0.35, tailD1: 0.1 }),
  paintSide: paintSedanSide({ doors: [[0.255, 0.425], [0.44, 0.7]], livery: (c, S) => { const P = S.P; /* sliding door rail */ seam(c, [[S.x(P.zOf(0.7)), S.y(P.ys(0.8) - 0.02)], [S.x(P.zOf(0.93)), S.y(P.ys(0.8) - 0.02)]], 3); } }),
  paintFront: paintSedanFront({ plate: 'SNF 3388 P', grilleStyle: 'bars', grilleW: 1.2, grilleH: 0.3, grilleY: 0.42, plateY: 0.36, grilleBar: '#e0e0e0', surround: '#f0f0f0' }),
  paintRear: paintSedanRear({ plate: 'SNF 3388 P', plateY: 0.8, badgeText: 'ALFRED' }),
  decalYMax: 1.3, frontYMax: 1.3,
  rearBench: 1.2,
});

DESIGNS.van = () => ({
  body: sedanBody({
    L: 4.7, W: 1.7, H: 1.98, wb: 2.57, fo: 0.98, wr: 0.32, ww: 0.195, track: 1.47,
    shoulder: [[0, 0.82], [0.015, 0.9], [0.05, 0.95], [0.12, 0.98], [0.17, 1.0], [0.2, 1.01], [0.6, 1.02], [0.97, 1.03], [1, 0.98]],
    crown: [[0, 0.02], [0.1, 0.03], [0.17, 0.01], [0.19, 0], [1, 0]],
    sill: [[0, 0.4], [0.03, 0.3], [0.1, 0.25], [0.9, 0.25], [0.97, 0.3], [1, 0.42]],
    plan: { rf: 0.3, mf: 0.86, rr: 0.12, mr: 0.94 },
    green: { t0: 0.185, t1: 0.27, t2: 0.985, t3: 0.998, H: 1.98, roofW: 0.9, sideStart: 0.2, sideEnd: 0.37, pillars: [], aPillar: 'paint', rearGlass: false, wsCurve: 1.1, roofDrop: 0.01, edgeR: 0.1, bow: 0.01, sideGlassMax: 99 },
    body: { sideExp: 4 },
  }),
  lights: (P, G, C) => sedanLights(P, G, C, { headH: 0.14, headD1: 0.2, headD0: 0.03, tailH: 0.3, tailD1: 0.05 }),
  paintSide: paintSedanSide({ doors: [[0.2, 0.37], [0.42, 0.75]], livery: (c, S) => { const P = S.P; text(c, 'KIASU LOGISTICS', S.x(P.zOf(0.68)), S.y(1.45), { size: S.sy(0.14), color: '#1a4d8c', italic: true, maxW: S.sx(2.2) }); text(c, 'Same day lah!', S.x(P.zOf(0.68)), S.y(1.25), { size: S.sy(0.08), color: '#d23030', maxW: S.sx(1.5) }); } }),
  sideDecalTop: 0.85,
  paintFront: paintSedanFront({ plate: 'GBC 4471 X', grilleStyle: 'bars', grilleW: 0.9, grilleH: 0.14, grilleY: 0.6, plateY: 0.4 }),
  paintRear: paintSedanRear({ plate: 'GBC 4471 X', plateY: 0.55, extra: (c, F) => { seam(c, [[F.x(0), F.y(1.9)], [F.x(0), F.y(0.5)]], 3); } }),
  rearDecalDepth: 0.4,
  decalYMax: 2.0, frontYMax: 2.0,
  bodyColor: 0xf3f3f1,
});

// ---------------------------------------------------------------- Tommy's wedge supercar
DESIGNS.infernus = () => ({
  body: {
    L: 4.25, W: 1.98, wb: 2.5, fo: 0.95, wr: 0.33, ww: 0.28, track: 1.62,
    archR: 0.395,
    plan: { rf: 0.28, mf: 0.84, rr: 0.18, mr: 0.93 },
    sr: 0.05, br: 0.04, bulge: 0.01, flare: 0.03,
    shoulder: [[0, 0.48], [0.008, 0.52], [0.03, 0.55], [0.12, 0.6], [0.25, 0.67], [0.33, 0.72], [0.5, 0.79], [0.7, 0.85], [0.9, 0.88], [0.97, 0.88], [0.99, 0.85], [1, 0.78]],
    crown: [[0, 0.01], [0.1, 0.03], [0.3, 0.02], [0.36, 0], [0.74, 0], [0.8, 0.012], [1, 0.012]],
    sill: [[0, 0.24], [0.03, 0.17], [0.1, 0.14], [0.9, 0.15], [0.97, 0.22], [1, 0.32]],
    tumble: [[0, 0.03], [0.4, 0.07], [0.7, 0.08], [1, 0.05]],
    green: {
      t0: 0.345, t1: 0.53, t2: 0.665, t3: 0.8, H: 1.12, roofW: 0.66, inset: 0.05, edgeR: 0.045, bow: 0.018, crown: 0.015,
      sideStart: 0.37, sideEnd: 0.69, pillars: [], aPillar: 'paint', cPillar: 'paint', wsCurve: 1.2, rgCurve: 1.0, roofDrop: 0.015, rearGlass: true,
      mirrorT: 0.045, mirrorY: 0.06,
    },
    transparentGlass: true,
  },
  lights: (P, G, C) => [
    // pop-up headlight lids are geometry (see details); low front indicators + full-width tail band
    { mat: 'indL', c: [p => p.x + 0.55, C.axMax(0.82), C.yMin(0.3), C.yMax(0.37), C.facingZ(-1, 0.3)], offset: 0.005 },
    { mat: 'indR', c: [p => 0.55 - p.x, C.axMax(0.82), C.yMin(0.3), C.yMax(0.37), C.facingZ(-1, 0.3)], offset: 0.005 },
    { mat: 'drl', c: [C.axMin(0.2), C.axMax(0.5), C.yMin(0.3), C.yMax(0.36), C.facingZ(-1, 0.4)], offset: 0.005 },
    { mat: 'tail', c: [C.axMin(0.22), C.yMin(0.6), C.yMax(0.74), C.facingZ(1, 0.4)], offset: 0.005 },
    { mat: 'rev', c: [C.axMin(0.08), C.axMax(0.2), C.yMin(0.6), C.yMax(0.74), C.facingZ(1, 0.4)], offset: 0.005 },
  ],
  paintSide: (c, S) => {
    const P = S.P;
    doorSeams(c, S, [[0.37, 0.64]], { sillOff: 0.05 });
    // NACA side intake behind the door (black)
    const t0 = 0.655, t1 = 0.75;
    c.fillStyle = '#0a0a0a'; c.beginPath();
    c.moveTo(S.x(P.zOf(t0)), S.y(P.ys(t0) - 0.07)); c.lineTo(S.x(P.zOf(t1)), S.y(P.ys(t1) - 0.05));
    c.lineTo(S.x(P.zOf(t1)), S.y(P.ys(t1) - 0.24)); c.lineTo(S.x(P.zOf(t0 + 0.02)), S.y(P.ys(t0) - 0.14)); c.closePath(); c.fill();
    // VC-style pinstripe
    c.strokeStyle = '#ff3fa4'; c.lineWidth = S.sy(0.012); c.beginPath();
    for (let i = 0; i <= 30; i++) { const t = 0.05 + 0.9 * i / 30; if (P.arch(t) > P.ys(t) - 0.3) continue; const x = S.x(P.zOf(t)), y = S.y(P.ys(t) - 0.2); i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.stroke();
    text(c, 'INFERNUS', S.x(P.zOf(0.88)), S.y(P.ys(0.88) - 0.14), { size: S.sy(0.05), color: '#222', italic: true });
  },
  paintFront: (c, F) => {
    grille(c, F.x(0.55), F.y(0.27), F.sx(1.1), F.sy(0.07), { style: 'slats', bar: '#303030', surroundW: 0, r: 6 });
    sgPlateFront(c, F, 'SVC 86 T', 0.33, {});
  },
  paintRear: (c, F) => {
    // black tail panel band between the lights
    c.fillStyle = '#080808'; c.fillRect(F.x(-0.98), F.y(0.76), F.sx(1.96), F.sy(0.18));
    grille(c, F.x(-0.75), F.y(0.42), F.sx(1.5), F.sy(0.14), { style: 'slats', bar: '#2a2a2a', surroundW: 0, r: 8 });
    sgPlateRear(c, F, 'SVC 86 T', 0.52);
    text(c, 'VERCETTI', F.x(0), F.y(0.83), { size: F.sy(0.04), color: '#e8e8e8', italic: true });
  },
  frontYMax: 1.0,
  exhaust: { x: [-0.32, -0.22, 0.22, 0.32], r: 0.033, y: 0.33 },
  mirrorSize: [0.16, 0.08, 0.1],
  details: det => {
    const { pb, P, hi } = det;
    // pop-up headlight pods: closed lids flush in the hood; opened by the model (see model.js popups)
    det.popups = [];
    for (const s of [1, -1]) {
      const t = 0.07, z = P.zOf(t), y = P.ys(t) + 0.015;
      det.popups.push({ x: s * 0.6, y, z });
    }
    // rear wing (VC Infernus has none; we add a subtle ducktail lip)
    pb.add(hi ? roundedBox(1.7, 0.03, 0.18, 0.012, 2) : box(1.7, 0.03, 0.18), 'paint', { matrix: M4.trs(0, P.ys(0.985) + 0.03, P.zOf(0.975), 0.2, 0, 0) });
    // engine cover louvres
    for (let i = 0; i < 6; i++) {
      const t = 0.81 + i * 0.022; const y = P.ys(t) + P.crown(t) + 0.004;
      pb.add(box(0.9, 0.012, 0.03), 'trim', { matrix: M4.trs(0, y, P.zOf(t), 0.06, 0, 0) });
    }
  },
  seatZ: [0.25], seatMat: 'leather', seatH: 0.62, floorH: 0.02,
  wheel: { style: 'dial', caliper: true, rimRatio: 0.66 },
  bodyColor: 0xf7f7f4,
});

// ---------------------------------------------------------------- 80s convertible
DESIGNS.stinger = () => ({
  body: {
    L: 4.2, W: 1.79, wb: 2.42, fo: 0.92, wr: 0.31, ww: 0.225, track: 1.5,
    plan: { rf: 0.42, mf: 0.8, rr: 0.32, mr: 0.86 },
    sr: 0.06, br: 0.045, bulge: 0.012,
    shoulder: [[0, 0.56], [0.012, 0.6], [0.04, 0.64], [0.15, 0.7], [0.3, 0.76], [0.38, 0.8], [0.6, 0.84], [0.8, 0.86], [0.95, 0.86], [0.985, 0.83], [1, 0.76]],
    crown: [[0, 0.015], [0.1, 0.04], [0.32, 0.03], [0.37, 0], [1, 0]],
    sill: [[0, 0.3], [0.03, 0.22], [0.1, 0.17], [0.9, 0.17], [0.97, 0.25], [1, 0.34]],
    tub: [[0.39, 0], [0.41, 1], [0.7, 1], [0.72, 0]], tubDepth: 0.42, tubRim: 0.06,
    green: {
      // windshield only (open top): steep frame ends at t1; side glass absent
      t0: 0.37, t1: 0.43, t2: 0.4301, t3: 0.4302, H: 1.2, roofW: 0.8, inset: 0.04, edgeR: 0.02, bow: 0.0, crown: 0.0,
      sideStart: 0.99, sideEnd: 0.99, pillars: [], aPillar: 'trim', roofMat: 'trim', open: true, wsCurve: 1.0, roofDrop: 0.0, mirrorT: 0.02, mirrorY: 0.06,
    },
    transparentGlass: true,
  },
  openTop: true,
  wipers: false,
  lights: (P, G, C) => [
    { mat: 'indL', c: [p => p.x + 0.5, C.axMax(0.78), C.yMin(0.28), C.yMax(0.36), C.facingZ(-1, 0.3)], offset: 0.005 },
    { mat: 'indR', c: [p => 0.5 - p.x, C.axMax(0.78), C.yMin(0.28), C.yMax(0.36), C.facingZ(-1, 0.3)], offset: 0.005 },
    { mat: 'tail', c: [C.axMin(0.3), C.axMax(0.82), C.yMin(0.6), C.yMax(0.72), C.facingZ(1, 0.4)], offset: 0.005 },
    { mat: 'rev', c: [C.axMin(0.18), C.axMax(0.3), C.yMin(0.6), C.yMax(0.72), C.facingZ(1, 0.4)], offset: 0.005 },
  ],
  paintSide: (c, S) => {
    doorSeams(c, S, [[0.4, 0.62]], { sillOff: 0.05 });
    const P = S.P;
    c.fillStyle = '#111'; const x0 = S.x(P.zOf(0.08)), x1 = S.x(P.zOf(0.95)); c.fillRect(Math.min(x0, x1), S.y(P.sill(0.5) + 0.12), Math.abs(x1 - x0), S.sy(0.04));
    text(c, 'STINGER', S.x(P.zOf(0.24)), S.y(P.ys(0.24) - 0.12), { size: S.sy(0.05), color: '#f0f0f0', italic: true });
  },
  paintFront: (c, F) => { grille(c, F.x(0.4), F.y(0.3), F.sx(0.8), F.sy(0.07), { style: 'slats', bar: '#2c2c2c', surroundW: 0, r: 8 }); sgPlateFront(c, F, 'SBY 1984 C', 0.36); },
  paintRear: (c, F) => { sgPlateRear(c, F, 'SBY 1984 C', 0.5); c.fillStyle = '#0d0d0d'; c.fillRect(F.x(-0.3), F.y(0.72), F.sx(0.6), F.sy(0.12)); },
  frontYMax: 1.0,
  exhaust: { x: [-0.4, -0.32], r: 0.03 },
  details: det => {
    const { pb, P, hi } = det;
    det.popups = [];
    for (const s of [1, -1]) det.popups.push({ x: s * 0.56, y: P.ys(0.06) + 0.012, z: P.zOf(0.06) });
    // roll hoops behind seats
    for (const s of [1, -1]) {
      const hoop = new THREE.TorusGeometry(0.2, 0.025, 8, 16, Math.PI); hoop.deleteAttribute('uv');
      pb.add(hoop, 'chrome', { matrix: M4.t(s * 0.37, P.ys(0.66), P.zOf(0.66)) });
    }
    // windshield frame top bar
    const t1 = P.def.green.t1;
    pb.add(box(P.def.W * 0.8 * 0.95, 0.03, 0.04), 'trim', { matrix: M4.t(0, P.def.green.H - 0.01, P.zOf(t1)) });
  },
  seatZ: [0.2], seatMat: 'leather', seatH: 0.7,
  wheel: { style: 'spoke10', rimRatio: 0.62 },
  bodyColor: 0xc8141c,
});

// ---------------------------------------------------------------- colour palettes
export const SG_COLOURS = [0xf4f4f2, 0xf4f4f2, 0xf4f4f2, 0xc9ccd0, 0xc9ccd0, 0x18191b, 0x18191b, 0x6b6e72, 0x1d2a44, 0x8a1a1f, 0x3d4f3a, 0xa8a090];

// ---------------------------------------------------------------- Singapore double-decker bus (LTA "lush green")
function busWindows(C, hi) {
  const W = [];
  const side = s => (p, n) => s * -p.x;          // restrict to one side (s=1: +x/right/offside, s=-1: left/kerb side)
  const pane = (s, z0, z1, y0, y1, mat = 'glass') => W.push({ mat, c: [side(s), C.sideFacing(0.6), C.zMin(z0), C.zMax(z1), C.yMin(y0), C.yMax(y1)], offset: 0.006 });
  const run = (s, z0, z1, y0, y1, n) => { if (!hi) return pane(s, z0, z1, y0, y1); const step = (z1 - z0) / n; for (let i = 0; i < n; i++) pane(s, z0 + i * step + 0.045, z0 + (i + 1) * step - 0.045, y0, y1); };
  // upper deck, both sides
  run(1, -5.35, 5.25, 2.78, 3.86, 8); run(-1, -5.35, 5.25, 2.78, 3.86, 8);
  // lower deck offside (driver window + saloon)
  pane(1, -5.45, -4.55, 1.15, 2.4); run(1, -4.45, 4.95, 1.25, 2.16, 7);
  // lower deck kerb side: front door, saloon, centre exit door, saloon
  pane(-1, -5.4, -4.95, 0.5, 2.38); pane(-1, -4.9, -4.42, 0.5, 2.38);
  run(-1, -4.3, -0.15, 1.25, 2.16, 3);
  pane(-1, 0.0, 0.55, 0.5, 2.3); pane(-1, 0.6, 1.15, 0.5, 2.3);
  run(-1, 1.3, 4.95, 1.25, 2.16, 3);
  return W;
}
DESIGNS.bus = () => ({
  body: {
    L: 11.3, W: 2.55, wb: 5.75, fo: 2.68, wr: 0.5, ww: 0.3, track: 2.08, archR: 0.58, flare: 0,
    plan: { rf: 0.42, mf: 0.9, rr: 0.32, mr: 0.92 },
    sr: 0.3, br: 0.06, bulge: 0.004, sideExp: 1,
    shoulder: [[0, 3.9], [0.004, 4.04], [0.012, 4.12], [0.03, 4.15], [0.97, 4.15], [0.988, 4.12], [0.996, 4.04], [1, 3.92]],
    crown: [[0, 0.06], [0.03, 0.12], [0.97, 0.12], [1, 0.06]],
    sill: [[0, 0.42], [0.008, 0.36], [0.04, 0.34], [0.96, 0.34], [0.992, 0.4], [1, 0.48]],
    tumble: [[0, 0.016], [1, 0.016]],
  },
  lights: (P, G, C, hi) => [
    ...busWindows(C, hi),
    { mat: 'glass', c: [C.facingZ(-1, 0.5), C.yMin(0.98), C.yMax(2.42), C.axMax(1.14)], offset: 0.006 },
    { mat: 'glass', c: [C.facingZ(-1, 0.5), C.yMin(2.76), C.yMax(3.92), C.axMax(1.12)], offset: 0.006 },
    { mat: 'glass', c: [C.facingZ(1, 0.5), C.yMin(3.0), C.yMax(3.86), C.axMax(0.95)], offset: 0.006 },
    { mat: 'display', c: [C.facingZ(-1, 0.5), C.yMin(2.48), C.yMax(2.69), C.axMax(1.0)], offset: 0.008, uv: (p, a) => a.uv('sign', (1.0 - p.x) / 2.0, (2.69 - p.y) / 0.21) },
    { mat: 'display', c: [p => p.x + 0.0, C.sideFacing(0.6), C.zMin(-4.1), C.zMax(-3.2), C.yMin(2.25), C.yMax(2.45)], offset: 0.008, uv: (p, a) => a.uv('sign2', (p.z + 4.1) / 0.9, (2.45 - p.y) / 0.2) },
    { mat: 'display', c: [C.facingZ(1, 0.5), C.yMin(3.9), C.yMax(4.02), C.axMax(0.45)], offset: 0.008, uv: (p, a) => a.uv('sign2', (p.x + 0.45) / 0.9, (4.02 - p.y) / 0.12) },
    { mat: 'head', c: [C.facingZ(-1, 0.5), C.yMin(0.56), C.yMax(0.76), C.axMin(0.78), C.axMax(1.16)], offset: 0.008 },
    { mat: 'indL', c: [p => p.x + 0.9, C.facingZ(-1, 0.5), C.yMin(0.79), C.yMax(0.87)], offset: 0.008 },
    { mat: 'indR', c: [p => 0.9 - p.x, C.facingZ(-1, 0.5), C.yMin(0.79), C.yMax(0.87)], offset: 0.008 },
    { mat: 'tail', c: [C.facingZ(1, 0.5), C.yMin(0.6), C.yMax(1.35), C.axMin(1.0)], offset: 0.008 },
    { mat: 'indL', c: [p => p.x + 1.0, C.facingZ(1, 0.5), C.yMin(1.38), C.yMax(1.5)], offset: 0.008 },
    { mat: 'indR', c: [p => 1.0 - p.x, C.facingZ(1, 0.5), C.yMin(1.38), C.yMax(1.5)], offset: 0.008 },
  ],
  prePaint: atlas => {
    atlas.draw('sign', (c, w, h) => { c.fillStyle = '#060606'; c.fillRect(0, 0, w, h); text(c, '77', w * 0.12, h / 2, { size: h * 0.8, color: '#ffb020', font: '"Courier New", monospace' }); text(c, 'MARINA BAY', w * 0.6, h / 2, { size: h * 0.62, color: '#ffb020', font: '"Courier New", monospace', maxW: w * 0.72 }); });
    atlas.draw('sign2', (c, w, h) => { c.fillStyle = '#060606'; c.fillRect(0, 0, w, h); text(c, '77', w / 2, h / 2, { size: h * 0.85, color: '#ffb020', font: '"Courier New", monospace' }); });
  },
  paintSide: (c, S) => {
    const P = S.P;
    const X = z => S.x(z);
    const band = (y0, y1, col) => { c.fillStyle = col; c.fillRect(0, S.y(y1), S.w, S.y(y0) - S.y(y1)); };
    band(0.3, 0.98, '#a5cd39');               // lime skirt
    band(0.98, 1.06, '#1d6b33');
    band(1.16, 2.24, '#151515');              // lower window band
    band(2.66, 3.95, '#151515');              // upper window band
    // between-deck advert panel
    const ax0 = X(S.side === 'R' ? 3.6 : -3.9), ax1 = X(S.side === 'R' ? -3.9 : 3.6);
    c.fillStyle = '#ff2d7a'; c.fillRect(Math.min(ax0, ax1), S.y(2.62), Math.abs(ax1 - ax0), S.y(2.28) - S.y(2.62));
    text(c, 'CHOPECHAIN', (ax0 + ax1) / 2 - S.sx(1.6), S.y(2.45), { size: S.sy(0.24), color: '#fff', font: 'Arial Black, Arial', italic: true, maxW: S.sx(3) });
    text(c, 'reserve your hawker seat on-chain', (ax0 + ax1) / 2 + S.sx(1.75), S.y(2.45), { size: S.sy(0.13), color: '#fff', maxW: S.sx(3.6) });
    text(c, 'SBX TRANSIT', X(S.side === 'R' ? -2.2 : 2.2), S.y(0.62), { size: S.sy(0.2), color: '#1d6b33', font: 'Arial Black, Arial', maxW: S.sx(2.5) });
    if (S.side === 'L') {
      // door frames
      for (const [z0, z1] of [[-5.45, -4.38], [-0.05, 1.2]]) { c.strokeStyle = '#111'; c.lineWidth = 3; c.strokeRect(X(z0), S.y(2.42), X(z1) - X(z0), S.y(0.36) - S.y(2.42)); }
    }
  },
  paintFront: (c, F) => {
    c.fillStyle = '#a5cd39'; c.fillRect(0, F.y(0.95), F.w, F.y(0.3) - F.y(0.95));
    c.fillStyle = '#151515'; c.fillRect(0, F.y(2.48), F.w, F.y(0.96) - F.y(2.48));
    c.fillRect(0, F.y(3.96), F.w, F.y(2.72) - F.y(3.96));
    grille(c, F.x(0.55), F.y(0.9), F.sx(1.1), F.sy(0.22), { style: 'bars', bar: '#3a3a3a', surroundW: 0, r: 8 });
    plate(c, F.x(0), F.y(0.5), F.sx(0.55), F.sy(0.13), 'SG 5021 Z');
  },
  paintRear: (c, F) => {
    c.fillStyle = '#a5cd39'; c.fillRect(0, F.y(0.95), F.w, F.y(0.3) - F.y(0.95));
    grille(c, F.x(0.9), F.y(2.4), F.sx(1.8), F.sy(0.9), { style: 'slats', bar: '#3a3a3a', bg: '#1a1a1a', surroundW: 0, r: 10 });
    c.fillStyle = '#151515'; c.fillRect(0, F.y(3.92), F.w, F.y(2.95) - F.y(3.92));
    text(c, 'PLEASE GIVE WAY TO BUSES', F.x(0), F.y(1.25), { size: F.sy(0.09), color: '#fff', maxW: F.sx(1.8), stroke: '#1d6b33', strokeW: 3 });
    plate(c, F.x(0), F.y(0.62), F.sx(0.55), F.sy(0.13), 'SG 5021 Z');
  },
  decalYMax: 4.4, frontYMax: 4.4, frontDecalDepth: 0.5, rearDecalDepth: 0.5,
  mirrors: false, wipers: false,
  exhaust: { x: [-0.9], r: 0.05, y: 0.35 },
  details: det => {
    const { pb, P, hi } = det;
    for (const s of [1, -1]) {
      const arm = box(0.04, 0.04, 0.5);
      pb.add(arm, 'black', { matrix: M4.trs(s * 1.2, 2.55, P.zF - 0.15, 0.5, 0, 0) });
      pb.add(hi ? roundedBox(0.16, 0.38, 0.08, 0.02, 2) : box(0.16, 0.38, 0.08), 'black', { matrix: M4.t(s * 1.22, 2.25, P.zF - 0.36) });
    }
    // roof hatches / AC pod
    pb.add(hi ? roundedBox(1.6, 0.12, 2.2, 0.05, 2) : box(1.6, 0.12, 2.2), 'paint', { matrix: M4.t(0, 4.3, 3.6) });
  },
  bodyColor: 0x2c9a48,
  wheel: { style: 'steel', rimRatio: 0.58, caliper: false, rimMat: 'steel' },
});

// ---------------------------------------------------------------- open-back lorry (with workers riding in the back)
DESIGNS.lorry = () => ({
  body: {
    L: 1.95, W: 2.0, wb: 3.36, fo: 1.05, axles: [-1.68], wr: 0.38, ww: 0.24, track: 1.65, archR: 0.47, flare: 0,
    plan: { rf: 0.18, mf: 0.9, rr: 0.04, mr: 0.985 },
    sr: 0.1, br: 0.04, bulge: 0.003, sideExp: 1,
    shoulder: [[0, 1.12], [0.03, 1.19], [0.08, 1.22], [1, 1.22]],
    crown: [[0, 0], [1, 0]],
    sill: [[0, 0.5], [0.04, 0.47], [1, 0.47]],
    tumble: [[0, 0.01], [1, 0.01]],
    green: { t0: 0.035, t1: 0.15, t2: 0.965, t3: 0.999, H: 2.32, roofW: 0.92, inset: 0.02, edgeR: 0.11, bow: 0.004, crown: 0.02, sideStart: 0.16, sideEnd: 0.6, pillars: [], aPillar: 'paint', cPillar: 'paint', rearGlass: false, wsCurve: 1.0, rgCurve: 1.0, roofDrop: 0.004, mirrorT: 0.06, mirrorY: 0.32, mirrorMat: 'black' },
    transparentGlass: true,
  },
  mirrorSize: [0.12, 0.3, 0.06],
  lights: (P, G, C) => [
    { mat: 'head', c: [C.facingZ(-1, 0.5), C.yMin(0.6), C.yMax(0.76), C.axMin(0.6), C.axMax(0.92)], offset: 0.006 },
    { mat: 'indL', c: [p => p.x + 0.62, C.facingZ(-1, 0.5), C.yMin(0.79), C.yMax(0.86)], offset: 0.006 },
    { mat: 'indR', c: [p => 0.62 - p.x, C.facingZ(-1, 0.5), C.yMin(0.79), C.yMax(0.86)], offset: 0.006 },
  ],
  paintSide: (c, S) => {
    const P = S.P;
    doorSeams(c, S, [[0.16, 0.66]], { sillOff: 0.04 });
    text(c, 'AH HUAT RENOVATION', S.x(P.zOf(0.45)), S.y(0.85), { size: S.sy(0.07), color: '#c42020', maxW: S.sx(1.0) });
    text(c, 'Tel 9123 4567', S.x(P.zOf(0.45)), S.y(0.72), { size: S.sy(0.05), color: '#222', maxW: S.sx(0.8) });
  },
  decalYMax: 2.4,
  paintFront: (c, F) => {
    grille(c, F.x(0.55), F.y(1.12), F.sx(1.1), F.sy(0.24), { style: 'slats', bar: '#3a3a3a', surroundW: 0, r: 8 });
    text(c, 'ISUZOO', F.x(0), F.y(1.0), { size: F.sy(0.07), color: '#ddd' });
    c.fillStyle = '#1b1b1b'; c.fillRect(F.x(0.98), F.y(0.56), F.sx(1.96), F.sy(0.08));
    plate(c, F.x(0), F.y(0.66), F.sx(0.52), F.sy(0.11), 'XD 4821 K');
  },
  frontYMax: 2.4,
  exhaust: { x: [0.7], r: 0.04, y: 0.45 },
  prePaint: atlas => atlas.draw('misc2', (c, w, h) => { plate(c, w / 2, h / 2, w * 0.8, h * 0.6, 'XD 4821 K'); }),
  details: det => {
    const { pb, P, hi, atlas } = det;
    const z0 = -0.78, z1 = 3.4, zc = (z0 + z1) / 2, len = z1 - z0;
    for (const s of [1, -1]) pb.add(box(0.14, 0.2, 4.6), 'under', { matrix: M4.t(s * 0.42, 0.66, 1.1) });
    pb.add(box(2.0, 0.09, len), 'steel', { matrix: M4.t(0, 1.06, zc) });
    const board = 'painted', bc = 0x3b6fb0;
    for (const s of [1, -1]) {
      pb.add(box(0.04, 0.42, len), board, { matrix: M4.t(s * 0.98, 1.31, zc), color: bc });
      for (let i = 1; i < 4; i++) pb.add(box(0.05, 0.42, 0.05), 'steel', { matrix: M4.t(s * 0.99, 1.31, z0 + len * i / 4) });
    }
    pb.add(box(2.0, 0.42, 0.04), board, { matrix: M4.t(0, 1.31, z1), color: bc });
    pb.add(box(2.0, 1.0, 0.05), board, { matrix: M4.t(0, 1.6, z0), color: bc });
    // headboard rack
    for (const x of [-0.9, 0, 0.9]) pb.add(box(0.05, 0.6, 0.05), 'steel', { matrix: M4.t(x, 2.3, z0 + 0.02) });
    pb.add(box(1.9, 0.05, 0.05), 'steel', { matrix: M4.t(0, 2.6, z0 + 0.02) });
    // rear bumper bar, lights, plate
    pb.add(box(1.9, 0.12, 0.08), 'black', { matrix: M4.t(0, 0.62, z1 + 0.05) });
    for (const s of [1, -1]) { pb.add(box(0.2, 0.09, 0.03), 'tail', { matrix: M4.t(s * 0.8, 0.62, z1 + 0.1) }); pb.add(box(0.08, 0.09, 0.03), s > 0 ? 'indR' : 'indL', { matrix: M4.t(s * 0.62, 0.62, z1 + 0.1) }); }
    const pl = plane(0.52, 0.12); pb.add(pl, 'decal', { matrix: M4.trs(0, 0.82, z1 + 0.025), uvRect: atlas.rect('misc2') });
    // mudguards over rear wheels
    for (const s of [1, -1]) {
      const mg = new THREE.CylinderGeometry(0.46, 0.46, 0.34, hi ? 16 : 8, 1, true, -Math.PI / 2, Math.PI); mg.deleteAttribute('uv'); mg.rotateZ(Math.PI / 2);
      pb.add(mg, 'black', { matrix: M4.t(s * 0.82, 0.38, 1.68) });
    }
    // fuel tank + toolbox
    const tank = new THREE.CylinderGeometry(0.2, 0.2, 0.7, hi ? 14 : 6); tank.deleteAttribute('uv'); tank.rotateX(Math.PI / 2);
    pb.add(tank, 'steel', { matrix: M4.t(-0.72, 0.62, 0.2) });
    pb.add(box(0.35, 0.3, 0.6), 'black', { matrix: M4.t(0.75, 0.66, 0.3) });
    // cargo + workers sitting on the deck sides facing inward
    pb.add(box(0.6, 0.4, 0.6), 'painted', { matrix: M4.t(0.3, 1.31, 2.7), color: 0x9b7a4a });
    pb.add(box(0.5, 0.3, 0.5), 'painted', { matrix: M4.t(-0.25, 1.26, 2.9), color: 0x9b7a4a });
    const skins = [0x6b4428, 0x8a5a3a, 0xa8754e];
    const seats = [[0.72, 0.3, -1], [0.72, 1.4, -1], [-0.72, 0.8, 1], [-0.72, 1.9, 1]];
    seats.forEach(([x, z, face], i) => addWorker(pb, x, 1.1, z, face, skins[i % 3], hi, i));
  },
  bodyColor: 0xf2f2f0,
  wheel: { style: 'steel', rimRatio: 0.58, caliper: false, rimMat: 'steel' },
});

function addWorker(pb, x, y, z, face, skin, hi, i) {
  // seated figure on the deck edge, facing inward (face = +1 faces +x)
  const ry = face > 0 ? -Math.PI / 2 : Math.PI / 2;
  const at = (lx, ly, lz) => { const c = Math.cos(ry), s = Math.sin(ry); return [x + lx * c + lz * s, y + ly, z - lx * s + lz * c]; };
  const shirt = i % 2 ? 'hivis' : 'cloth';
  pb.add(hi ? roundedBox(0.34, 0.5, 0.22, 0.06, 2) : box(0.34, 0.5, 0.22), shirt, { matrix: M4.trs(...at(0, 0.38, 0.02), 0, ry, 0) });
  pb.add(new THREE.SphereGeometry(0.1, hi ? 12 : 6, hi ? 8 : 4).deleteAttribute('uv'), 'skin', { matrix: M4.t(...at(0, 0.75, 0.02)), color: skin });
  pb.add(new THREE.SphereGeometry(0.12, hi ? 12 : 6, hi ? 6 : 3, 0, Math.PI * 2, 0, Math.PI / 2).deleteAttribute('uv'), 'hardhat', { matrix: M4.t(...at(0, 0.8, 0.02)), color: i % 3 === 2 ? 0xf2f2f2 : 0xffd21a });
  for (const s of [1, -1]) {
    pb.add(box(0.13, 0.13, 0.42), 'cloth', { matrix: M4.trs(...at(s * 0.09, 0.12, 0.2), 0, ry, 0), color: 0x2b3a55 });
    pb.add(box(0.12, 0.42, 0.13), 'cloth', { matrix: M4.trs(...at(s * 0.09, -0.12, 0.42), 0, ry, 0), color: 0x2b3a55 });
    pb.add(box(0.09, 0.4, 0.09), 'skin', { matrix: M4.trs(...at(s * 0.21, 0.38, 0.08), 0.5, ry, 0), color: skin });
  }
}
