// Esplanade – Theatres on the Bay: the two "durian" domes clad in thousands of triangular aluminium sunshades.
import { THREE, Bucket, materials, domeGeometry, ringOf, exclusionsForBuildings, areaCentroid, nightGlowMaterial, pointInRing } from './common.js';

// the Outdoor Theatre on the waterfront: a stage with the bay behind it, terraced seating rising toward the podium,
// under the wave canopy the city draws (OSM 329, 15-16 m) on slim columns
const STAGE = { x: 780, z: -200, rx: 13, rz: 6, h: 1.1 };
const VIEW_DIR = [-0.55, 0.83], VIEW_CLEAR = 45; // the domes' hero side (toward the Merlion), kept clear of trees this far out

/** distance from (x, z) to a ring's outline (0 inside it) */
function ringDist(x, z, r) {
  if (pointInRing(x, z, r)) return 0;
  let d = Infinity;
  for (let i = 0; i < r.length; i++) {
    const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length], ex = bx - ax, ez = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t));
  }
  return d;
}

export function buildEsplanade(city, quality) {
  const group = new THREE.Group(); group.name = 'Esplanade';
  const podium = city.buildings.find(b => b.n === 'Esplanade Theatres on the Bay');
  const domes = [
    city.buildings.find(b => b.n === 'Esplanade Concert Hall'),
    city.buildings.find(b => b.n === 'Esplanade Theatre'),
  ].filter(Boolean);
  // the glazing under the shades: warm grey (a dark mirror read navy blue under the phone's sky light)
  const glassMat = nightGlowMaterial(0xffc98a, 0.85, { base: 0x5a6266, rough: 0.25, metal: 0.55 });
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0xb9ad98, roughness: 0.38, metalness: 0.85, side: THREE.DoubleSide });
  // spike: a shallow triangular pyramid; base in XZ plane, apex +Y
  const spike = (() => {
    const s = 1.25, h = 1.15;
    const a = new THREE.Vector3(-s, 0, -s * 0.58), b = new THREE.Vector3(s, 0, -s * 0.58), c = new THREE.Vector3(0, 0, s * 1.15), t = new THREE.Vector3(0.0, h, -0.35);
    const pos = [];
    for (const [p, q, r] of [[a, t, b], [b, t, c], [c, t, a]]) pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    return g;
  })();
  const B = new Bucket();
  const spikes = [];
  const exList = [];
  domes.forEach((d, di) => {
    const H = di === 0 ? 34 : 39;
    const { geo, rows, c } = domeGeometry(ringOf(d), H, { sides: 0.5, n: 140, k: 20 });
    B.add(glassMat, geo);
    const k = rows.length - 1, n = rows[0].length;
    // every shade on every preset (they are one instanced draw, and the spikes are what make the domes read), up to the
    // crown: the dome's rows, then a ring halfway from the last row to the apex; rows thin out (a stride round each row)
    // as they shrink, so the shades stay the same size
    const rings = [...rows.slice(0, k), rows[k - 1].map(p => p.clone().lerp(rows[k][0], 0.5)), rows[k]];
    const spacing0 = rings[1][1].distanceTo(rings[1][0]);
    for (let j = 1; j <= k; j++) {
      const R = rings[j], stride = Math.max(1, Math.round(spacing0 / Math.max(1e-3, R[1].distanceTo(R[0]))));
      for (let i = 0; i + stride <= n; i += stride) {
        const i1 = (i + stride) % n;
        const p = R[i].clone().lerp(R[i1], (j % 2) * 0.5);
        const t1 = R[i1].clone().sub(R[(i - stride + n) % n]);
        const t2 = rings[j + 1][i].clone().sub(rings[j - 1][i]);
        const nrm = new THREE.Vector3().crossVectors(t1, t2).normalize();
        const out = new THREE.Vector3(p.x - c[0], p.y * 0.3, p.z - c[1]);
        if (nrm.dot(out) < 0) nrm.negate();
        const tang = t2.clone().normalize();
        // the shades spread over the cell: scale by local spacing
        const sx = Math.min(1.6, t1.length() / 2 / 2.2), sz = Math.min(1.6, t2.length() / 2 / 2.2);
        spikes.push({ p, nrm, tang, sx, sz });
      }
    }
    exList.push(d);
  });
  const inst = new THREE.InstancedMesh(spike, shadeMat, spikes.length);
  const m4 = new THREE.Matrix4(), basis = new THREE.Matrix4(), x = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  spikes.forEach((s, i) => {
    // local Y -> normal, local Z -> up-the-dome tangent
    const yv = s.nrm, zv = s.tang.clone().sub(yv.clone().multiplyScalar(s.tang.dot(yv))).normalize();
    x.crossVectors(yv, zv).normalize();
    basis.makeBasis(x, yv, zv);
    q.setFromRotationMatrix(basis);
    sc.set(s.sx * 1.4, 1, s.sz * 1.4);
    pos.copy(s.p).addScaledVector(yv, 0.15);
    inst.setMatrixAt(i, m4.compose(pos, q, sc));
  });
  inst.instanceMatrix.needsUpdate = true; inst.computeBoundingSphere();
  inst.castShadow = true; inst.receiveShadow = true;
  {
    const M = materials(), stageMat = nightGlowMaterial(0xffe2b8, 0.25, { base: 0xd9d4ca, rough: 0.7 });
    const deck = new THREE.CylinderGeometry(1, 1, STAGE.h, 40, 1, false, Math.PI / 2, Math.PI); // the half toward the seats
    deck.scale(STAGE.rx, 1, STAGE.rz); deck.translate(STAGE.x, STAGE.h / 2, STAGE.z);
    B.add(stageMat, deck);
    B.add(M.darkSteel, new THREE.BoxGeometry(STAGE.rx * 2, 6, 0.5).translate(STAGE.x, 3, STAGE.z + 0.25)); // backdrop frame
    for (let k = 0; k < 5; k++) {
      // seating terraces: rings of steps facing the stage
      const r0 = 10 + k * 2.6, a0 = Math.PI * 0.12, a1 = Math.PI * 0.88, sh = new THREE.Shape();
      sh.absarc(0, 0, r0 + 2.6, a0, a1, false); sh.absarc(0, 0, r0, a1, a0, true);
      const step = new THREE.ExtrudeGeometry(sh, { depth: 0.45 * (k + 1), bevelEnabled: false, curveSegments: 24 });
      step.rotateX(-Math.PI / 2); step.translate(STAGE.x, 0, STAGE.z); // (shape +y -> north)
      B.add(M.stone, step);
    }
    for (const [dx, dz] of [[-22, -8], [22, -8], [-14, -24], [14, -24]]) B.add(M.steel, new THREE.CylinderGeometry(0.35, 0.45, 15, 10).translate(STAGE.x + dx, 7.5, STAGE.z + dz));
  }
  const meshes = B.build({ name: 'esplanade' });
  meshes.forEach(m => group.add(m));
  group.add(inst);
  const colliders = exList.map((d, i) => { const c = areaCentroid(ringOf(d)); return { type: 'cylinder', center: [c[0], 10, c[1]], radius: i === 0 ? 40 : 42, halfHeight: 10 }; });
  return {
    group, exclusions: exclusionsForBuildings(exList), colliders, reflective: [...meshes, inst],
    pois: [{ id: 'esplanade', name: 'Esplanade – Theatres on the Bay', x: 700, y: 0, z: -300 }],
    // the domes stand free on their podium with the promenade open to the bay: no park trees against the building, and
    // none in the foreground of the classic view from the Merlion and the Esplanade Bridge (south-west)
    clearings: [{ x: STAGE.x, z: STAGE.z - 12, r: 30 }, ...[...exList, podium].filter(Boolean).map(b => {
      const r = ringOf(b), [x, z] = areaCentroid(r), view = b !== podium;
      const reach = view ? VIEW_CLEAR : 16;
      return { x, z, r: Math.max(...r.map(p => Math.hypot(p[0] - x, p[1] - z))) + reach, inside: (px, pz) => { const d = ringDist(px, pz, r); return d < 16 || (view && d < reach && (px - x) * VIEW_DIR[0] + (pz - z) * VIEW_DIR[1] > 0); } };
    })],
  };
}
