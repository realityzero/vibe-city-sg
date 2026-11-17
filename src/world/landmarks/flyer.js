// Singapore Flyer: 165 m observation wheel (150 m diameter), 28 capsules mounted outside the rim, cable spokes,
// A-frame supports and the terminal building. The wheel turns slowly (~30 min per revolution).
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  THREE, U, Bucket, materials, nightGlowMaterial, frameMatrix, ringOf, exclusionsForBuildings, strut, facadeMaterial, extrudeFootprint, offsetRing,
  signedArea, blobTree, rng, capGeometry,
} from './common.js';

const CENTER = [1572, -266.5];
const DIR = [0.7897, -0.6134];   // wheel plane (horizontal component)
const HUB_Y = 90, RADIUS = 75, CAPS = 28;
// the terminal: three stepped storeys round a rainforest courtyard (OSM parts, ground floor first); the wheel turns
// down into the courtyard, where the lowest capsule meets the boarding deck. The roofs stay below 14 m: the capsules
// clear the courtyard's edge above that.
const TERMINAL = [[8352, 0, 5], [8351, 5, 9.5], [8350, 9.5, 14]], BOARD_Y = 7;

const SPOKE_D = 0.18, SPOKE_MIN_PX = 1.0;
/** Cables as camera-facing ribbons. An 18 cm spoke is under a pixel from anywhere but the boarding deck: as geometry it
 * broke up into a dotted line (worst at a phone's resolution). The ribbon is drawn at least SPOKE_MIN_PX wide and only
 * as opaque as the share of that width the cable really covers — what the pixel would average — so a far spoke reads
 * as the faint continuous line it is. `cables`: [[a, b], ...] Vector3 end points; d: cable diameter (m). */
function cableRibbons(cables, d) {
  const pos = [], dir = [], side = [], idx = [], t = new THREE.Vector3();
  for (const [a, b] of cables) {
    const v = pos.length / 3;
    t.subVectors(b, a).normalize();
    for (const p of [a, b]) for (const s of [-1, 1]) { pos.push(p.x, p.y, p.z); dir.push(t.x, t.y, t.z); side.push(s); }
    idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); // (front-facing whatever the cable's direction: see the shader)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(dir, 3)); // (replaced in the shader: the ribbon faces the camera)
  g.setAttribute('cableDir', new THREE.Float32BufferAttribute(dir, 3));
  g.setAttribute('cableSide', new THREE.Float32BufferAttribute(side, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ color: 0xc9ced3, roughness: 0.5, metalness: 0.6, transparent: true, depthWrite: false });
  const uPxH = { value: 1000 };
  mat.onBeforeCompile = sh => {
    sh.uniforms.uPxH = uPxH;
    sh.vertexShader = 'attribute vec3 cableDir; attribute float cableSide; uniform float uPxH; varying float vCover;\n' + sh.vertexShader
      .replace('#include <project_vertex>', `#include <project_vertex>
      {
        // metres per pixel at this depth, from the projection and the height of the target being drawn
        float px = 2.0 * -mvPosition.z / (projectionMatrix[1][1] * uPxH), w = max(${d.toFixed(2)}, ${SPOKE_MIN_PX.toFixed(1)} * px);
        vec3 along = normalize((modelViewMatrix * vec4(cableDir, 0.0)).xyz);
        // (along, across, view ray) always form the same handedness, so every ribbon winds front-facing
        mvPosition.xyz += normalize(cross(along, mvPosition.xyz)) * cableSide * w * 0.5;
        gl_Position = projectionMatrix * mvPosition;
        vCover = ${d.toFixed(2)} / w;
        vNormal = normalize(-mvPosition.xyz); // a cylinder's average normal, seen from here
      }`);
    sh.fragmentShader = 'varying float vCover;\n' + sh.fragmentShader.replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.a *= vCover;');
  };
  mat.customProgramCacheKey = () => 'flyer-cables-v1';
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'flyer-spokes';
  // the render target being drawn (main or a post pass target) sets the pixel size
  const size = new THREE.Vector2();
  mesh.onBeforeRender = r => { const rt = r.getRenderTarget(); uPxH.value = rt ? rt.height : r.getDrawingBufferSize(size).y; };
  return mesh;
}

/** walls facing into a courtyard ring (extrudeFootprint faces out) */
function innerWalls(ring, y0, y1) {
  const g = extrudeFootprint(ring, y0, y1, { top: false });
  for (const a of Object.values(g.attributes)) {
    const v = a.array, n = a.itemSize;
    for (let t = 0; t < v.length / (3 * n); t++) for (let k = 0; k < n; k++) { const i = (t * 3 + 1) * n + k, j = (t * 3 + 2) * n + k; [v[i], v[j]] = [v[j], v[i]]; }
  }
  const nn = g.attributes.normal.array; for (let i = 0; i < nn.length; i++) nn[i] = -nn[i];
  return g;
}
/** flat roof over a ring with a courtyard hole, facing up */
function annulus(outer, hole, y) {
  const o = signedArea(outer) < 0 ? outer.slice().reverse() : outer, h = signedArea(hole) > 0 ? hole.slice().reverse() : hole, all = [...o, ...h];
  const pos = [];
  for (const t of THREE.ShapeUtils.triangulateShape(o.map(p => new THREE.Vector2(p[0], p[1])), [h.map(p => new THREE.Vector2(p[0], p[1]))])) {
    const [a, b, c] = t.map(k => all[k]);
    // wound to face up: (b - a) x (c - a) has y = dz1 * dx2 - dx1 * dz2
    const up = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) > 0;
    for (const q of up ? [a, b, c] : [a, c, b]) pos.push(q[0], y, q[1]);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}

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
  // terminal building (in the wheel's frame: x along the wheel, z across it)
  const termMat = facadeMaterial({ wall: 0xe9ecee, glass: 0x456070, cell: [3.2, 4.2], frame: [0.03, 0.08, 0.1], lit: 0.85, seed: 21, warm: 0xfff3dc, wallGlow: 0.1 });
  const toLocal = ([x, z]) => { const dx = x - CENTER[0], dz = z - CENTER[1]; return [dx * DIR[0] + dz * DIR[1], -dx * DIR[1] + dz * DIR[0]]; };
  const byId = new Map(city.buildings.map(b => [b.id, b]));
  const termCollider = [];
  for (const [id, y0, y1] of TERMINAL) {
    const b = byId.get(id); if (!b) continue;
    const outer = ringOf(b).map(toLocal), hole = b.ho?.length ? ringOf({ p: b.ho[0] }).map(toLocal) : null; // (holes are flat x,z lists too)
    const walls = extrudeFootprint(outer, y0, y1, { top: false });
    S.add(termMat, walls); termCollider.push(walls);
    S.add(white, extrudeFootprint(offsetRing(outer, 0.35), y1 - 0.7, y1 + 0.25, { top: false })); // white roof edge
    if (hole) {
      const inner = innerWalls(hole, y0, y1); S.add(termMat, inner); termCollider.push(inner);
      const roof = annulus(outer, hole, y1); S.add(M.concrete, roof); termCollider.push(roof);
      if (y0 === 0) {
        // the rainforest courtyard, kept clear along the wheel
        S.add(M.planter, capGeometry(hole, 0.04));
        const R = rng(9), cz = hole.reduce((a, p) => a + p[1], 0) / hole.length;
        for (let i = 0; i < 26; i++) {
          const p = hole[(R() * hole.length) | 0], k = 0.2 + R() * 0.7, x = p[0] * k, z = cz + (p[1] - cz) * k;
          if (Math.abs(z) > 9) for (const g of blobTree(x, 0, z, 1.3 + R() * 0.8, R)) S.add(M.foliageSolid, g);
        }
      }
    }
  }
  // boarding deck under the lowest capsule, on slim columns
  S.add(white, new THREE.BoxGeometry(30, 0.6, 12).translate(0, BOARD_Y - 0.3, 0));
  for (const x of [-12, 0, 12]) for (const z of [-4.5, 4.5]) S.add(M.steel, new THREE.CylinderGeometry(0.3, 0.3, BOARD_Y - 0.6, 8).translate(x, (BOARD_Y - 0.6) / 2, z));
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
  const nSp = quality === 'low' ? 24 : 48, spokes = [];
  for (const hz of [-11, 11]) for (let i = 0; i < nSp; i++) {
    const a = (i + (hz > 0 ? 0.5 : 0)) / nSp * Math.PI * 2;
    spokes.push([new THREE.Vector3(Math.cos(a) * 2.5, Math.sin(a) * 2.5, hz), new THREE.Vector3(Math.cos(a) * (RADIUS - 3.4), Math.sin(a) * (RADIUS - 3.4), 0)]);
  }
  wheel.add(cableRibbons(spokes, SPOKE_D));
  const hub = new THREE.CylinderGeometry(4.2, 4.2, 24, 20); hub.rotateX(Math.PI / 2); W.add(white, hub);
  for (const hz of [-11, 11]) { const f = new THREE.CylinderGeometry(6, 6, 1.2, 24); f.rotateX(Math.PI / 2); f.translate(0, 0, hz); W.add(white, f); }
  // capsule mounts
  for (let i = 0; i < CAPS; i++) {
    const a = i / CAPS * Math.PI * 2;
    W.add(rimMat, strut(new THREE.Vector3(Math.cos(a) * RADIUS, Math.sin(a) * RADIUS, 0), new THREE.Vector3(Math.cos(a) * (RADIUS + 3.2), Math.sin(a) * (RADIUS + 3.2), 0), 0.5, 6));
  }
  const ledMat = nightGlowMaterial(0x9fd8ff, 5.0, { base: 0xdfe3e6, rough: 0.35, metal: 0.6 });
  ledMat.userData.ownDraw = true; // its hue cycles at night (update below)
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
  // they orbit the hub: bound the whole circle once rather than recomputing it from the instances every frame
  capsInst.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, HUB_Y, 0), RADIUS + 8);
  frameInst.boundingSphere = capsInst.boundingSphere.clone();
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

  const root = new THREE.Group(); root.name = 'SingaporeFlyerRoot';
  root.add(group);

  const ids = new Set([51761904, 230082125]);
  const ex = exclusionsForBuildings(city.buildings.filter(b => (b.id >= 6253 && b.id <= 6281) || (b.id >= 8350 && b.id <= 8352) || b.n === 'Singapore Flyer' || ids.has(b.id)));
  const cx = CENTER[0], cz = CENTER[1];
  const yaw = Math.atan2(-DIR[1], DIR[0]);
  const colliders = [];
  if (termCollider.length) {
    // the terminal's walls and roofs, in world space
    const g = mergeGeometries(termCollider.map(t => { const c = new THREE.BufferGeometry(); c.setAttribute('position', t.attributes.position.clone()); return c.applyMatrix4(F); }), false);
    const v = g.attributes.position.array;
    colliders.push({ type: 'trimesh', vertices: new Float32Array(v), indices: new Uint32Array([...Array(v.length / 3).keys()]) });
  }
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
