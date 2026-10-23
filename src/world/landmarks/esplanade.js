// Esplanade – Theatres on the Bay: the two "durian" domes clad in thousands of triangular aluminium sunshades.
import { THREE, U, Bucket, materials, domeGeometry, ringOf, exclusionsForBuildings, areaCentroid, nightGlowMaterial } from './common.js';

export function buildEsplanade(city, quality) {
  const M = materials();
  const group = new THREE.Group(); group.name = 'Esplanade';
  const domes = [
    city.buildings.find(b => b.n === 'Esplanade Concert Hall'),
    city.buildings.find(b => b.n === 'Esplanade Theatre'),
  ].filter(Boolean);
  const glassMat = nightGlowMaterial(0xffc98a, 0.85, { base: 0x2f3a3f, rough: 0.15, metal: 0.8 });
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
    const step = quality === 'low' ? 2 : 1;
    for (let j = 1; j < k - 1; j += step) {
      for (let i = 0; i < n; i += step) {
        const off = (j % 2) * 0.5;
        const i0 = i, i1 = (i + 1) % n;
        const p = rows[j][i0].clone().lerp(rows[j][i1], off);
        const t1 = rows[j][(i + 1) % n].clone().sub(rows[j][(i - 1 + n) % n]);
        const t2 = rows[j + 1][i0].clone().sub(rows[j - 1][i0]);
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
  const meshes = B.build({ name: 'esplanade' });
  meshes.forEach(m => group.add(m));
  group.add(inst);
  const colliders = exList.map((d, i) => { const c = areaCentroid(ringOf(d)); return { type: 'cylinder', center: [c[0], 10, c[1]], radius: i === 0 ? 40 : 42, halfHeight: 10 }; });
  return {
    group, exclusions: exclusionsForBuildings(exList), colliders, reflective: [...meshes, inst],
    pois: [{ id: 'esplanade', name: 'Esplanade – Theatres on the Bay', x: 700, y: 0, z: -300 }],
  };
}
