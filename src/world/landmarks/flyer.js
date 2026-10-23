// Singapore Flyer: 165 m observation wheel (150 m diameter), 28 capsules mounted outside the rim, cable spokes,
// A-frame supports and the terminal building. The wheel turns slowly (~30 min per revolution).
import { THREE, U, Bucket, materials, nightGlowMaterial, frameMatrix, ringOf, exclusionsForBuildings, strut, lerp, facadeMaterial, extrudeFootprint, areaCentroid } from './common.js';

const CENTER = [1572, -266.5];
const DIR = [0.7897, -0.6134];   // wheel plane (horizontal component)
const HUB_Y = 90, RADIUS = 75, CAPS = 28;

export function buildFlyer(city, quality) {
  const M = materials();
  const F = frameMatrix(CENTER[0], CENTER[1], DIR[0], DIR[1]);
  const group = new THREE.Group(); group.name = 'SingaporeFlyer';
  group.matrixAutoUpdate = false; group.matrix.copy(F); group.matrixWorldNeedsUpdate = true;

  // ---- static: supports + hub housing
  const S = new Bucket();
  const white = new THREE.MeshStandardMaterial({ color: 0xeef1f3, roughness: 0.35, metalness: 0.55 });
  const hubP = (z) => new THREE.Vector3(0, HUB_Y, z);
  for (const side of [-1, 1]) {
    const top = hubP(side * 13);
    for (const sx of [-1, 1]) {
      const foot = new THREE.Vector3(sx * 20, 0, side * 36);
      const g = new THREE.CylinderGeometry(1.1, 2.0, 1, 10, 1); // tapered leg
      const d = new THREE.Vector3().subVectors(top, foot); const L = d.length();
      g.scale(1, L, 1); g.translate(0, L / 2, 0);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      g.applyMatrix4(new THREE.Matrix4().compose(foot, q, new THREE.Vector3(1, 1, 1)));
      S.add(white, g);
    }
    // cross tie between the two legs of the A
    S.add(white, strut(new THREE.Vector3(-11, 45, side * 25), new THREE.Vector3(11, 45, side * 25), 0.5, 6));
  }
  const axle = new THREE.CylinderGeometry(2.2, 2.2, 28, 16); axle.rotateX(Math.PI / 2); axle.translate(0, HUB_Y, 0);
  S.add(M.steel, axle);
  // terminal building
  const term = city.buildings.find(b => b.id === 51761904 || (b.n === 'Singapore Flyer' && b.p.length > 40));
  const termMat = facadeMaterial({ wall: 0xe9ecee, glass: 0x456070, cell: [3.2, 4.2], frame: [0.03, 0.08, 0.1], lit: 0.85, seed: 21, warm: 0xfff3dc });
  const statics = [];
  if (term) {
    const g = extrudeFootprint(ringOf(term), 0, 12.5);
    const tm = new THREE.Mesh(g, termMat); tm.castShadow = tm.receiveShadow = true; statics.push(tm);
    const roof = extrudeFootprint(ringOf(term).map(([x, z]) => { const c = areaCentroid(ringOf(term)); return [c[0] + (x - c[0]) * 1.02, c[1] + (z - c[1]) * 1.02]; }), 12.5, 13.6);
    const rm = new THREE.Mesh(roof, M.white); rm.castShadow = rm.receiveShadow = true; statics.push(rm);
  }
  const sMeshes = S.build({ name: 'flyer-static' });
  sMeshes.forEach(m => { m.matrixAutoUpdate = true; group.add(m); });

  // ---- rotating wheel
  const wheel = new THREE.Group(); wheel.position.set(0, HUB_Y, 0); group.add(wheel);
  const W = new Bucket();
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.35, metalness: 0.7 });
  for (const z of [-2.6, 2.6]) { const t = new THREE.TorusGeometry(RADIUS, 0.85, 8, 160); t.translate(0, 0, z); W.add(rimMat, t); }
  const inner = new THREE.TorusGeometry(RADIUS - 3.2, 0.6, 6, 160); W.add(rimMat, inner);
  // truss bracing
  const segs = 96;
  for (let i = 0; i < segs; i++) {
    const a0 = i / segs * Math.PI * 2, a1 = (i + 1) / segs * Math.PI * 2;
    const P = (a, r, z) => new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, z);
    W.add(rimMat, strut(P(a0, RADIUS, -2.6), P(a1, RADIUS, 2.6), 0.18, 4));
    W.add(rimMat, strut(P(a0, RADIUS, -2.6), P(a0, RADIUS - 3.2, 0), 0.16, 4));
    W.add(rimMat, strut(P(a0, RADIUS, 2.6), P(a0, RADIUS - 3.2, 0), 0.16, 4));
  }
  // cable spokes from both hub flanges
  const nSp = quality === 'low' ? 24 : 48;
  for (const hz of [-11, 11]) for (let i = 0; i < nSp; i++) {
    const a = (i + (hz > 0 ? 0.5 : 0)) / nSp * Math.PI * 2;
    W.add(M.steel, strut(new THREE.Vector3(Math.cos(a) * 2.5, Math.sin(a) * 2.5, hz), new THREE.Vector3(Math.cos(a) * (RADIUS - 3.4), Math.sin(a) * (RADIUS - 3.4), 0), 0.09, 3));
  }
  const hub = new THREE.CylinderGeometry(4.2, 4.2, 24, 20); hub.rotateX(Math.PI / 2); W.add(white, hub);
  for (const hz of [-11, 11]) { const f = new THREE.CylinderGeometry(6, 6, 1.2, 24); f.rotateX(Math.PI / 2); f.translate(0, 0, hz); W.add(white, f); }
  // capsule mounts
  for (let i = 0; i < CAPS; i++) {
    const a = i / CAPS * Math.PI * 2;
    W.add(rimMat, strut(new THREE.Vector3(Math.cos(a) * RADIUS, Math.sin(a) * RADIUS, 0), new THREE.Vector3(Math.cos(a) * (RADIUS + 3.2), Math.sin(a) * (RADIUS + 3.2), 0), 0.5, 6));
  }
  const ledMat = nightGlowMaterial(0x9fd8ff, 5.0, { base: 0xdfe3e6, rough: 0.35, metal: 0.6 });
  for (const z of [-3.5, 3.5]) { const t = new THREE.TorusGeometry(RADIUS + 0.9, 0.22, 4, 200); t.translate(0, 0, z); W.add(ledMat, t); }
  const wMeshes = W.build({ name: 'flyer-wheel', castShadow: true });
  wMeshes.forEach(m => { m.matrixAutoUpdate = true; wheel.add(m); });

  // ---- capsules (instanced, stay level while the wheel turns)
  const capGeo = new THREE.CapsuleGeometry(2.0, 8.0, 6, 14); capGeo.rotateX(Math.PI / 2);
  const capMat = new THREE.MeshPhysicalMaterial({ color: 0xbfd8e2, roughness: 0.08, metalness: 0.3, transparent: true, opacity: 0.55, emissive: 0xfff0d8, emissiveIntensity: 0 });
  capMat.onBeforeCompile = sh => { sh.uniforms.uNight = U.night; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vec3(1.0,0.92,0.8) * 1.2 * uNight;'); };
  const capFrame = new THREE.CylinderGeometry(2.15, 2.15, 0.5, 14, 1); capFrame.rotateX(Math.PI / 2);
  const capsInst = new THREE.InstancedMesh(capGeo, capMat, CAPS);
  const frameInst = new THREE.InstancedMesh(capFrame, M.steel, CAPS * 2);
  capsInst.frustumCulled = frameInst.frustumCulled = false;
  group.add(capsInst, frameInst);

  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  let angle = 0;
  const placeCaps = () => {
    for (let i = 0; i < CAPS; i++) {
      const a = angle + i / CAPS * Math.PI * 2;
      p.set(Math.cos(a) * (RADIUS + 5.2), HUB_Y + Math.sin(a) * (RADIUS + 5.2), 0);
      capsInst.setMatrixAt(i, m4.compose(p, q, one));
      for (const k of [0, 1]) { const pp = p.clone(); pp.z = k ? 3.2 : -3.2; frameInst.setMatrixAt(i * 2 + k, m4.compose(pp, q, one)); }
    }
    capsInst.instanceMatrix.needsUpdate = true; frameInst.instanceMatrix.needsUpdate = true;
  };
  placeCaps();

  statics.forEach(s => { s.matrixAutoUpdate = false; s.updateMatrix(); });
  const root = new THREE.Group(); root.name = 'SingaporeFlyerRoot';
  root.add(group); statics.forEach(s => root.add(s));

  const ids = new Set([51761904, 230082125]);
  const ex = exclusionsForBuildings(city.buildings.filter(b => (b.id >= 6253 && b.id <= 6281) || (b.id >= 8350 && b.id <= 8352) || b.n === 'Singapore Flyer' || ids.has(b.id)));
  const cx = CENTER[0], cz = CENTER[1];
  const yaw = Math.atan2(-DIR[1], DIR[0]);
  const colliders = [];
  if (term) colliders.push({ type: 'cylinder', center: [areaCentroid(ringOf(term))[0], 6.5, areaCentroid(ringOf(term))[1]], radius: 48, halfHeight: 6.5 });
  for (const side of [-1, 1]) for (const sx of [-1, 1]) {
    const fx = cx + DIR[0] * sx * 20 + (-DIR[1]) * side * 36, fz = cz + DIR[1] * sx * 20 + DIR[0] * side * 36;
    colliders.push({ type: 'cylinder', center: [fx, 8, fz], radius: 2.2, halfHeight: 8 });
  }
  const ledColor = new THREE.Color();
  return {
    group: root, exclusions: ex, colliders, reflective: [...wMeshes, ...sMeshes],
    pois: [{ id: 'flyer', name: 'Singapore Flyer', x: cx, y: 0, z: cz }],
    update(dt, env) {
      angle += dt * (Math.PI * 2 / 1800) * (env.flyerSpeed || 1);
      wheel.rotation.z = angle;
      placeCaps();
      if (U.night.value > 0.01) { ledColor.setHSL((U.time.value * 0.02) % 1, 0.7, 0.6); ledMat.emissive.copy(ledColor); }
    },
  };
}
