// Many small static props scattered over the city (MRT kiosks, ERP and expressway gantries) were a draw call per part
// — ~150 of a phone's ~430 per frame, most of them for props a few pixels tall. mergeStatic() bakes the opaque parts
// that share a material (and shadow / layer settings) into one world-space mesh: the same triangles, material and
// shadows, one draw. Frustum culling becomes all-or-nothing, which costs nothing for a few thousand triangles.
// Transparent parts stay separate meshes: three.js sorts those back to front per mesh.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** merges the opaque meshes under `roots` (Object3Ds already in the scene); returns the new meshes */
export function mergeStatic(scene, roots, name) {
  const sets = new Map();
  for (const r of roots) r.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.material.transparent || Array.isArray(o.material)) return;
    const k = [o.material.uuid, o.castShadow, o.receiveShadow, o.renderOrder, o.layers.mask].join('|');
    (sets.get(k) || sets.set(k, []).get(k)).push(o);
  });
  const out = [];
  for (const list of sets.values()) {
    if (list.length < 2) continue;
    const geos = list.map(m => { m.updateWorldMatrix(true, false); const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; });
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue; // incompatible attribute sets: leave these as they were
    const m0 = list[0], mesh = new THREE.Mesh(merged, m0.material);
    mesh.name = name; mesh.castShadow = m0.castShadow; mesh.receiveShadow = m0.receiveShadow; mesh.renderOrder = m0.renderOrder; mesh.layers.mask = m0.layers.mask;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    scene.add(mesh); mesh.updateMatrixWorld(true);
    for (const m of list) m.removeFromParent();
    out.push(mesh);
  }
  return out;
}
