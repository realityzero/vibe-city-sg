// Wheel geometry: axle along x, outer (rim) face toward +x, centred at origin.
import * as THREE from 'three';
import { PartBuilder, cyl, box, M4 } from './geom.js';
import { Atlas, REGIONS } from './atlas.js';

function tyreLathe(R, rr, w, seg) {
  const sh = R - rr;
  const prof = [
    [rr - 0.004, w * 0.40], [rr + sh * 0.15, w * 0.48], [rr + sh * 0.55, w * 0.50], [R - sh * 0.2, w * 0.47],
    [R - sh * 0.05, w * 0.40], [R, w * 0.28], [R, -w * 0.28], [R - sh * 0.05, -w * 0.40], [R - sh * 0.2, -w * 0.47],
    [rr + sh * 0.55, -w * 0.50], [rr + sh * 0.15, -w * 0.48], [rr - 0.004, -w * 0.40],
  ].map(([r, a]) => new THREE.Vector2(r, a));
  const g = new THREE.LatheGeometry(prof, seg);
  g.deleteAttribute('uv');
  g.rotateZ(-Math.PI / 2);
  return g;
}

function rimFace(rr, style, depth, curve) {
  const s = new THREE.Shape();
  s.absarc(0, 0, rr, 0, Math.PI * 2, false);
  const n = style === 'spoke10' ? 10 : style === 'multi' ? 15 : style === 'steel' ? 8 : style === 'dial' ? 9 : 5;
  const rIn = rr * (style === 'steel' ? 0.78 : 0.86), rHub = rr * (style === 'steel' ? 0.5 : 0.3);
  const spokeW = style === 'spoke5' ? 0.36 : style === 'spoke10' ? 0.16 : style === 'multi' ? 0.1 : style === 'dial' ? 0.3 : 0.25;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const h = new THREE.Path();
    if (style === 'steel' || style === 'dial') {
      const am = (a0 + a1) / 2, rm = (rIn + rHub) / 2, rad = (rIn - rHub) * (style === 'dial' ? 0.42 : 0.3);
      h.absarc(Math.cos(am) * rm, Math.sin(am) * rm, rad, 0, Math.PI * 2, true);
    } else {
      const g0 = a0 + spokeW * (Math.PI * 2 / n) / 2 + (rHub / rIn) * 0.05, g1 = a1 - spokeW * (Math.PI * 2 / n) / 2;
      const steps = 6;
      h.moveTo(Math.cos(g0) * (rHub * 1.15), Math.sin(g0) * (rHub * 1.15));
      for (let k = 0; k <= steps; k++) { const a = g0 + (g1 - g0) * k / steps; h.lineTo(Math.cos(a) * rIn, Math.sin(a) * rIn); }
      h.lineTo(Math.cos(g1) * (rHub * 1.15), Math.sin(g1) * (rHub * 1.15));
      h.closePath();
    }
    s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: Math.min(0.006, rr * 0.03), bevelSegments: 1, curveSegments: 12 });
  g.deleteAttribute('uv');
  // dish: pull the hub outward so spokes have a concave profile
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getY(i)) / rr; p.setZ(i, p.getZ(i) + curve * (1 - r * r)); }
  g.computeVertexNormals();
  g.rotateY(Math.PI / 2);
  return g;
}

/** High-detail wheel parts for a single (hero) wheel. Returns {spin: geometry, fixed: geometry} built via PartBuilder. */
export function buildWheelHigh(atlas, { R, w, rimRatio = 0.68, style = 'spoke5', rimMat = 'alloy', caliper = true }) {
  const rr = R * rimRatio;
  const spin = new PartBuilder(atlas);
  spin.add(tyreLathe(R, rr, w, 30), 'rubber');
  // tread band (darker, rougher) as a slightly larger thin cylinder segment set
  const tread = cyl(R + 0.002, R + 0.002, w * 0.56, 30, true); tread.rotateZ(Math.PI / 2);
  spin.add(tread, 'tread');
  const face = rimFace(rr, style, 0.022, style === 'steel' ? 0.01 : 0.03);
  spin.add(face, rimMat, { matrix: M4.t(w * 0.30, 0, 0) });
  const barrel = cyl(rr * 0.99, rr * 0.99, w * 0.78, 28, true); barrel.rotateZ(Math.PI / 2);
  spin.add(barrel, 'darkAlloy', { matrix: M4.t(-w * 0.05, 0, 0) });
  const lip = new THREE.TorusGeometry(rr * 0.99, 0.008, 6, 36); lip.deleteAttribute('uv'); lip.rotateY(Math.PI / 2);
  spin.add(lip, 'chrome', { matrix: M4.t(w * 0.35, 0, 0) });
  const hub = cyl(rr * 0.13, rr * 0.15, 0.03, 16); hub.rotateZ(Math.PI / 2);
  spin.add(hub, 'chrome', { matrix: M4.t(w * 0.33 + 0.025, 0, 0) });
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2, nut = cyl(0.009, 0.009, 0.02, 6); nut.rotateZ(Math.PI / 2);
    spin.add(nut, 'chrome', { matrix: M4.t(w * 0.33 + 0.02, Math.cos(a) * rr * 0.2, Math.sin(a) * rr * 0.2) });
  }
  const disc = cyl(rr * 0.78, rr * 0.78, 0.025, 28); disc.rotateZ(Math.PI / 2);
  spin.add(disc, 'disc', { matrix: M4.t(w * 0.05, 0, 0) });
  const fixed = new PartBuilder(atlas);
  if (caliper) {
    const cal = box(0.05, rr * 0.5, rr * 0.32);
    fixed.add(cal, 'caliper', { matrix: M4.trs(w * 0.12, rr * 0.45, -rr * 0.38, 0.7, 0, 0) });
  }
  return { spin: spin.build(), fixed: fixed.parts.length ? fixed.build() : null };
}

// ---- low LOD unit wheel (radius 1, width 1) for traffic instancing, with its own small atlas ----
let _wheelAtlas = null;
export function wheelAtlas() {
  if (_wheelAtlas) return _wheelAtlas;
  const a = new Atlas();
  // rim images in misc (alloy 5-spoke) and misc2 (steel)
  const drawRim = (region, spokes, steel) => a.draw(region, (c, w, h) => {
    const cx = h / 2, cy = h / 2, r = h / 2 - 1;
    c.fillStyle = '#16161a'; c.fillRect(0, 0, w, h);
    c.fillStyle = steel ? '#9a9da0' : '#cfd3d6';
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#121214';
    for (let i = 0; i < spokes; i++) {
      const a0 = i / spokes * Math.PI * 2 + 0.25, a1 = (i + 1) / spokes * Math.PI * 2 - 0.25;
      c.beginPath(); c.arc(cx, cy, r * 0.84, a0, a1); c.arc(cx, cy, r * 0.34, a1, a0, true); c.closePath(); c.fill();
    }
    c.fillStyle = '#8a8d90'; c.beginPath(); c.arc(cx, cy, r * 0.16, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#e8e8e8'; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, r * 0.97, 0, Math.PI * 2); c.stroke();
  });
  drawRim('misc', 5, false);
  drawRim('misc2', 8, true);
  _wheelAtlas = a;
  return a;
}

export function buildWheelLow({ rimRatio = 0.66, steel = false } = {}) {
  const a = wheelAtlas();
  const pb = new PartBuilder(a);
  pb.add(tyreLathe(1, rimRatio, 1, 14), 'rubber');
  // rim face disc mapped to the rim image
  const disc = new THREE.CircleGeometry(rimRatio, 16);
  disc.rotateY(Math.PI / 2);
  const [x, y, w, h] = REGIONS[steel ? 'misc2' : 'misc'];
  pb.add(disc, 'alloy', {
    matrix: M4.t(0.36, 0, 0),
    uv: p => [(x + h / 2 + (-p.z / rimRatio) * (h / 2 - 2)) / 1024, (y + h / 2 - (p.y / rimRatio) * (h / 2 - 2)) / 1024],
  });
  const inner = new THREE.CircleGeometry(rimRatio, 10); inner.deleteAttribute('uv'); inner.rotateY(-Math.PI / 2);
  pb.add(inner, 'under', { matrix: M4.t(-0.36, 0, 0) });
  return pb.build();
}
