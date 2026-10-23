// Non-lofted vehicles: the delivery motorbike (Foodpando pink / GRUB green), with optional rider.
import * as THREE from 'three';
import { PartBuilder, roundedBox, box, cyl, tube, M4 } from './geom.js';
import { Atlas, text, plate } from './atlas.js';

function buildBike(lod, brand, { rider }) {
  const hi = lod === 'high';
  const atlas = new Atlas();
  const pb = new PartBuilder(atlas);
  const R = 0.3, zF = -0.665, zR = 0.665;
  const seg = hi ? 10 : 5, tub = hi ? 24 : 8;
  // brand box artwork (sign region) + plate (misc2)
  atlas.draw('sign', (c, w, h) => {
    c.fillStyle = brand.hex; c.fillRect(0, 0, w, h);
    text(c, brand.name, w / 2, h * 0.42, { size: h * 0.42, color: '#fff', font: 'Arial Black, Arial', italic: true, maxW: w * 0.9 });
    text(c, brand.tag, w / 2, h * 0.8, { size: h * 0.17, color: '#fff', maxW: w * 0.9 });
  });
  atlas.draw('misc2', (c, w, h) => plate(c, w / 2, h / 2, w * 0.8, h * 0.6, 'FBM 2468 Y'));
  // frame (underbone commuter bike)
  pb.add(tube([[0, 0.98, -0.5], [0, 0.72, -0.32], [0, 0.42, -0.05], [0, 0.42, 0.18]], 0.03, seg, tub), 'painted', { color: 0x1c1c1c });
  pb.add(tube([[0, 0.45, 0.12], [0, 0.72, 0.45], [0, 0.82, 0.72]], 0.025, seg, tub), 'painted', { color: 0x1c1c1c });
  for (const s of [1, -1]) {
    pb.add(tube([[s * 0.08, 0.36, 0.1], [s * 0.08, 0.32, zR]], 0.022, seg, 6), 'steel');            // swingarm
    pb.add(tube([[s * 0.07, 0.42, 0.62], [s * 0.07, 0.78, 0.5]], 0.025, seg, 4), 'chrome');          // shocks
    pb.add(tube([[s * 0.075, 1.0, -0.48], [s * 0.075, 0.3, zF]], 0.022, seg, 4), 'chrome');         // fork
  }
  // engine + exhaust
  pb.add(hi ? roundedBox(0.24, 0.24, 0.32, 0.04, 2) : box(0.24, 0.24, 0.32), 'darkAlloy', { matrix: M4.t(0, 0.38, -0.02) });
  pb.add(tube([[0.06, 0.3, -0.1], [0.14, 0.24, 0.15], [0.16, 0.3, 0.55]], 0.03, seg, tub), 'chrome');
  // body panels: front cowl / leg shield, tank cover, side covers, seat, tail
  pb.add(hi ? roundedBox(0.36, 0.42, 0.14, 0.05, 3) : box(0.36, 0.42, 0.14), 'paint', { matrix: M4.trs(0, 0.82, -0.42, 0.25, 0, 0), color: 0xf2f2f2 });
  pb.add(hi ? roundedBox(0.26, 0.18, 0.42, 0.06, 3) : box(0.26, 0.18, 0.42), 'black', { matrix: M4.t(0, 0.7, 0.05) });
  pb.add(hi ? roundedBox(0.28, 0.1, 0.58, 0.05, 3) : box(0.28, 0.1, 0.58), 'black', { matrix: M4.t(0, 0.82, 0.32) });
  pb.add(hi ? roundedBox(0.24, 0.14, 0.3, 0.05, 2) : box(0.24, 0.14, 0.3), 'plastic', { matrix: M4.trs(0, 0.78, 0.66, -0.2, 0, 0), color: 0xe8e8e8 });
  // headlight + handlebar + mirrors
  pb.add(hi ? roundedBox(0.2, 0.12, 0.1, 0.04, 2) : box(0.2, 0.12, 0.1), 'plastic', { matrix: M4.t(0, 1.04, -0.55), color: 0xe8e8e8 });
  pb.add(box(0.14, 0.07, 0.01), 'head', { matrix: M4.t(0, 1.04, -0.606) });
  pb.add(tube([[-0.36, 1.08, -0.42], [0, 1.1, -0.47], [0.36, 1.08, -0.42]], 0.014, 6, 8), 'chrome');
  for (const s of [1, -1]) {
    pb.add(cyl(0.02, 0.02, 0.12, 8), 'rubber', { matrix: M4.trs(s * 0.34, 1.08, -0.42, 0, 0, Math.PI / 2) });
    pb.add(tube([[s * 0.24, 1.08, -0.44], [s * 0.3, 1.32, -0.46]], 0.008, 4, 4), 'black');
    pb.add(box(0.1, 0.06, 0.015), 'black', { matrix: M4.t(s * 0.31, 1.34, -0.46) });
    pb.add(box(0.05, 0.03, 0.02), s > 0 ? 'indR' : 'indL', { matrix: M4.t(s * 0.12, 0.96, -0.6) });
    pb.add(box(0.05, 0.03, 0.02), s > 0 ? 'indR' : 'indL', { matrix: M4.t(s * 0.12, 0.74, 0.84) });
  }
  pb.add(box(0.12, 0.05, 0.02), 'tail', { matrix: M4.t(0, 0.78, 0.83) });
  // fenders
  for (const [z, a0] of [[zF, -0.3], [zR, 0.2]]) {
    const f = new THREE.CylinderGeometry(R + 0.04, R + 0.04, 0.1, hi ? 16 : 8, 1, true, a0, 1.6); f.deleteAttribute('uv'); f.rotateZ(Math.PI / 2);
    pb.add(f, 'black', { matrix: M4.t(0, R, z) });
  }
  // rear plate
  const pl = new THREE.PlaneGeometry(0.22, 0.08);
  pb.add(pl, 'decal', { matrix: M4.trs(0, 0.66, 0.86, -0.3, 0, 0), uvRect: atlas.rect('misc2') });
  // delivery box (paint = brand colour so traffic tint matches)
  const bw = 0.46, bh = 0.42, bd = 0.44, by = 1.08, bz = 0.62;
  pb.add(hi ? roundedBox(bw, bh, bd, 0.03, 2) : box(bw, bh, bd), 'paintMatte', { matrix: M4.t(0, by, bz) });
  const face = new THREE.PlaneGeometry(bw * 0.92, bh * 0.75);
  const r = atlas.rect('sign');
  for (const [x, ry] of [[bw / 2 + 0.003, Math.PI / 2], [-bw / 2 - 0.003, -Math.PI / 2]]) pb.add(face, 'decalMatte', { matrix: M4.trs(x, by, bz, 0, ry, 0), uvRect: r });
  pb.add(face, 'decalMatte', { matrix: M4.trs(0, by, bz + bd / 2 + 0.003), uvRect: r });
  pb.add(box(0.3, 0.03, 0.3), 'black', { matrix: M4.t(0, by - bh / 2 - 0.015, bz) });
  if (rider) addRider(pb, hi);
  return {
    geometry: pb.build(), glassGeo: null, atlas, design: { bodyColor: brand.color },
    wheels: [{ x: 0, y: R, z: zF, steer: true, left: false }, { x: 0, y: R, z: zR, steer: false, left: false }],
    wheelR: R, wheelW: 0.11, wheelStyle: { style: 'spoke5', rimRatio: 0.55, caliper: false, rimMat: 'darkAlloy' },
    headlights: [{ x: 0, y: 1.04, z: -0.62 }],
  };
}

function addRider(pb, hi) {
  const s = hi ? 12 : 6;
  // jacket in brand colour (paint), dark pants, helmet
  pb.add(hi ? roundedBox(0.38, 0.55, 0.24, 0.08, 2) : box(0.38, 0.55, 0.24), 'paintMatte', { matrix: M4.trs(0, 1.22, 0.12, -0.35, 0, 0) });
  pb.add(new THREE.SphereGeometry(0.135, s, s * 0.7).deleteAttribute('uv'), 'paint', { matrix: M4.t(0, 1.6, -0.02) });
  pb.add(box(0.2, 0.08, 0.04), 'glassDark', { matrix: M4.trs(0, 1.6, -0.15, 0.1, 0, 0) });
  for (const k of [1, -1]) {
    pb.add(tube([[k * 0.17, 1.42, 0.02], [k * 0.26, 1.22, -0.2], [k * 0.34, 1.1, -0.4]], 0.045, 6, 4), 'paintMatte');
    pb.add(tube([[k * 0.1, 0.92, 0.25], [k * 0.17, 0.88, -0.08], [k * 0.15, 0.5, -0.12]], 0.06, 6, 4), 'cloth', { color: 0x22252b });
    pb.add(box(0.1, 0.08, 0.2), 'black', { matrix: M4.t(k * 0.15, 0.46, -0.16) });
  }
}

const BRANDS = {
  bike: { name: 'foodpando', tag: 'hungry? we come lah', hex: '#e2187f', color: 0xe2187f },
  bike_grub: { name: 'GRUB', tag: 'food · rides · everything', hex: '#2fa84a', color: 0x2fa84a },
};

export const SPECIAL = {
  bike: (lod, o = {}) => buildBike(lod, BRANDS.bike, { rider: o.rider ?? lod !== 'high' }),
  bike_grub: (lod, o = {}) => buildBike(lod, BRANDS.bike_grub, { rider: o.rider ?? lod !== 'high' }),
};
