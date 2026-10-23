// The Helix Bridge: a 280 m curved pedestrian bridge wrapped in counter-rotating steel helices (major + minor),
// connected by struts and rings, part-covered by glass canopies, LED-lit at night. Exports a walkable deck trimesh.
import { THREE, U, Bucket, materials, nightGlowMaterial, lerp, smooth, circlePoly } from './common.js';
import { WATER_LEVEL } from '../../core/constants.js';

// main walkway (OSM "The Helix", north -> south)
const PATH = [
  [1259.4, -213.3], [1263.3, -203.2], [1267.1, -193.2], [1270.9, -183.2], [1274.4, -172.9], [1277.9, -162.7], [1281.3, -152.4],
  [1282.6, -147.4], [1284.6, -137.7], [1286.5, -128], [1288.4, -118.3], [1290.1, -107.8], [1291.9, -97.3], [1292.2, -89.5],
  [1292.5, -81.6], [1292.9, -73], [1293.3, -64.3], [1292.9, -53.4], [1292.4, -42.5], [1292, -31.7], [1290.5, -24.2],
  [1288.9, -16.7], [1287.4, -9.3], [1286, -1.9], [1284.9, 1.5], [1282, 11.4], [1279, 21.4], [1277.2, 27.7], [1276.5, 29.2], [1273, 37], [1269.5, 44.8],
];
const PODS = [[1292.5, -81.6, 1285.6, -81.4], [1282.6, -147.4, 1275.6, -144.8]];

export function buildHelix() {
  const M = materials();
  const steel = new THREE.MeshStandardMaterial({ color: 0xd9dee2, roughness: 0.22, metalness: 0.95 });
  const ledA = nightGlowMaterial(0xff4fa0, 4.5, { base: 0xd9dee2, rough: 0.25, metal: 0.9 });
  const ledB = nightGlowMaterial(0x4fe0ff, 4.5, { base: 0xd9dee2, rough: 0.25, metal: 0.9 });
  const canopy = new THREE.MeshPhysicalMaterial({ color: 0xb8d6e0, roughness: 0.1, metalness: 0.4, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x8d8478, roughness: 0.7 });
  const pierMat = M.concrete;
  const parapet = new THREE.MeshPhysicalMaterial({ color: 0xcfe0e6, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });

  // smooth centreline (plan) and length
  const plan = new THREE.CatmullRomCurve3(PATH.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const L = plan.getLength();
  const deckY = s => 0.7 + 1.5 * Math.sin(Math.PI * Math.min(1, Math.max(0, s / L)));
  const AX = 3.3; // axis above deck
  const N = Math.ceil(L / 1.0);
  const frames = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, s = t * L;
    const p = plan.getPointAt(t); p.y = deckY(s);
    const tan = plan.getTangentAt(t).setY(0).normalize();
    const side = new THREE.Vector3(-tan.z, 0, tan.x);
    frames.push({ s, p, tan, side });
  }
  const at = (s) => frames[Math.min(N, Math.max(0, Math.round(s / L * N)))];
  const helixPoint = (s, r, ang) => {
    const f = at(s); const c = Math.cos(ang), sn = Math.sin(ang);
    return f.p.clone().add(new THREE.Vector3(0, AX, 0)).addScaledVector(f.side, c * r).add(new THREE.Vector3(0, sn * r, 0));
  };
  const B = new Bucket();
  const pitch = 21, k = Math.PI * 2 / pitch;
  const strand = (r, phase, dirSign, tubeR, mat) => {
    const pts = [];
    for (let s = 0; s <= L; s += 0.9) pts.push(helixPoint(s, r, dirSign * k * s + phase));
    const curve = new THREE.CatmullRomCurve3(pts);
    B.add(mat, new THREE.TubeGeometry(curve, pts.length * 2, tubeR, 6, false));
  };
  // major helix (outer), two strands; minor (inner), two strands, counter-rotating
  strand(5.9, 0, 1, 0.2, steel); strand(5.9, Math.PI, 1, 0.2, steel);
  strand(5.9, 0.16, 1, 0.07, ledA); strand(5.9, Math.PI + 0.16, 1, 0.07, ledA);
  strand(4.7, Math.PI / 2, -1, 0.16, steel); strand(4.7, -Math.PI / 2, -1, 0.16, steel);
  strand(4.7, Math.PI / 2 + 0.18, -1, 0.06, ledB); strand(4.7, -Math.PI / 2 + 0.18, -1, 0.06, ledB);
  // struts where the helices cross and rings at regular intervals
  for (let s = 0; s <= L; s += 0.5) {
    for (const ph of [0, Math.PI]) {
      const a1 = k * s + ph;
      // find crossings with minor strands (angles equal mod 2pi)
      for (const pm of [Math.PI / 2, -Math.PI / 2]) {
        const a2 = -k * s + pm;
        const d = Math.atan2(Math.sin(a1 - a2), Math.cos(a1 - a2));
        if (Math.abs(d) < k * 0.5 * 1.0) {
          const pa = helixPoint(s, 5.9, a1), pb = helixPoint(s, 4.7, a1);
          const g = new THREE.CylinderGeometry(0.1, 0.1, 1, 5, 1, true);
          const dv = new THREE.Vector3().subVectors(pb, pa); const len = dv.length();
          g.scale(1, len, 1);
          g.applyMatrix4(new THREE.Matrix4().compose(pa.clone().add(pb).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dv.normalize()), new THREE.Vector3(1, 1, 1)));
          B.add(steel, g);
        }
      }
    }
  }
  for (let s = 2; s < L; s += 5.25) {
    const f = at(s);
    const ring = new THREE.TorusGeometry(5.3, 0.075, 4, 32);
    // ring plane perpendicular to the tangent
    const m = new THREE.Matrix4().makeBasis(f.side, new THREE.Vector3(0, 1, 0), f.tan);
    m.setPosition(f.p.x, f.p.y + AX, f.p.z);
    ring.applyMatrix4(m);
    B.add(steel, ring);
  }
  // glass canopies over alternate segments (upper arc of the tube)
  for (let s = 6; s < L - 6; s += 14) {
    const segLen = 8, rows = 6, cols = 8;
    const pos = [];
    const P = (u, v) => { const ss = s + u * segLen; const ang = lerp(Math.PI * 0.32, Math.PI * 0.86, v); return helixPoint(ss, 4.2, ang); };
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      const a = P(i / rows, j / cols), b = P((i + 1) / rows, j / cols), c = P(i / rows, (j + 1) / cols), d = P((i + 1) / rows, (j + 1) / cols);
      pos.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...c.toArray(), ...b.toArray(), ...d.toArray());
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    B.add(canopy, g);
  }
  // deck (+ collider), parapets and piers
  const W = 3.2;
  const deckPos = [], deckIdx = [], under = [];
  for (let i = 0; i <= N; i++) {
    const f = frames[i];
    const l = f.p.clone().addScaledVector(f.side, -W), r = f.p.clone().addScaledVector(f.side, W);
    deckPos.push(l.x, l.y, l.z, r.x, r.y, r.z);
    if (i < N) { const a = i * 2; deckIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const deck = new THREE.BufferGeometry(); deck.setAttribute('position', new THREE.Float32BufferAttribute(deckPos, 3)); deck.setIndex(deckIdx); deck.computeVertexNormals();
  // ensure up-facing
  if (deck.attributes.normal.getY(0) < 0) { for (let i = 0; i < deckIdx.length; i += 3) { const t = deckIdx[i + 1]; deckIdx[i + 1] = deckIdx[i + 2]; deckIdx[i + 2] = t; } deck.setIndex(deckIdx); deck.computeVertexNormals(); }
  B.add(deckMat, deck);
  const deckUnder = deck.clone(); deckUnder.translate(0, -0.6, 0);
  { const idx = deckUnder.index.array; for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } deckUnder.computeVertexNormals(); }
  B.add(M.darkSteel, deckUnder);
  for (const side of [-1, 1]) {
    const pos = [];
    for (let i = 0; i < N; i++) {
      const a = frames[i], b = frames[i + 1];
      const pa = a.p.clone().addScaledVector(a.side, side * W), pb = b.p.clone().addScaledVector(b.side, side * W);
      pos.push(pa.x, pa.y - 0.6, pa.z, pb.x, pb.y - 0.6, pb.z, pb.x, pb.y + 1.1, pb.z, pa.x, pa.y - 0.6, pa.z, pb.x, pb.y + 1.1, pb.z, pa.x, pa.y + 1.1, pa.z);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    B.add(parapet, g);
  }
  for (let s = 40; s < L - 20; s += 62) {
    const f = at(s);
    for (const side of [-1, 1]) {
      const p = f.p.clone().addScaledVector(f.side, side * 2.2);
      const g = new THREE.CylinderGeometry(0.7, 0.9, f.p.y - WATER_LEVEL + 3, 10); g.translate(p.x, (f.p.y + WATER_LEVEL - 3) / 2 - 0.6, p.z);
      B.add(pierMat, g);
    }
  }
  // viewing pods (semicircular platforms cantilevered over the water)
  for (const [x0, z0, x1, z1] of PODS) {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz);
    const cx = x1 + dx / l * 2, cz = z1 + dz / l * 2;
    const g = new THREE.CylinderGeometry(5, 5, 0.5, 24, 1, false, 0, Math.PI);
    g.rotateY(Math.atan2(dx, dz) + Math.PI / 2); g.translate(cx, 1.6, cz);
    B.add(deckMat, g);
  }
  const meshes = B.build({ name: 'helix', castShadow: true });
  const group = new THREE.Group(); group.name = 'HelixBridge';
  meshes.forEach(m => group.add(m));

  // walkable deck collider (world space)
  const vertices = new Float32Array(deckPos), indices = new Uint32Array(deck.index.array);
  const mid = at(L / 2).p;
  return {
    group, reflective: meshes,
    colliders: [{ type: 'trimesh', vertices, indices }],
    exclusions: [],
    pois: [{ id: 'helix', name: 'The Helix Bridge', x: mid.x, y: mid.y, z: mid.z }],
    deckPath: frames.filter((_, i) => i % 5 === 0).map(f => [f.p.x, f.p.y, f.p.z]),
  };
}
