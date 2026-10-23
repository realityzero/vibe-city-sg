// Line-of-sight tests against rendered geometry (city chunks, landmarks) using lazily-built BVHs.
// Used to frame cutscene cameras so walls, canopies and landmark pieces never block the shot.
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const ray = new THREE.Raycaster();
ray.firstHitOnly = true;
const _d = new THREE.Vector3(), _c = new THREE.Vector3(), _s = new THREE.Sphere();

function candidates(game, a, b) {
  const out = [];
  const mid = _c.addVectors(a, b).multiplyScalar(0.5);
  const r = a.distanceTo(b) / 2 + 30;
  const test = m => {
    if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || !m.visible || !m.geometry?.attributes.position) return;
    if (m.material?.transparent && m.material.opacity < 0.5) return;
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    _s.copy(m.geometry.boundingSphere).applyMatrix4(m.matrixWorld);
    if (_s.center.distanceTo(mid) > _s.radius + r) return;
    out.push(m);
  };
  for (const ch of game.city.chunks) for (const k of ['walls', 'roofs', 'struct']) if (ch.meshes[k]) test(ch.meshes[k]);
  game.landmarks?.group.traverse(test);
  return out;
}

/** true when nothing rendered blocks the segment a→b */
export function clearLine(game, a, b) {
  const list = candidates(game, a, b);
  for (const m of list) if (!m.geometry.boundsTree) m.geometry.computeBoundsTree();
  // test both directions: single-sided faces are invisible to rays leaving a closed volume
  _d.subVectors(b, a); const dist = _d.length(); _d.normalize();
  ray.set(a, _d); ray.near = 0.05; ray.far = Math.max(0, dist - 0.3);
  if (ray.intersectObjects(list, false).length) return false;
  ray.set(b, _d.negate()); ray.near = 0.3; ray.far = Math.max(0, dist - 0.05);
  return ray.intersectObjects(list, false).length === 0;
}

/** true when a person-sized space at p (ground level) is free of rendered geometry (roofs above, walls around) */
export function spotFree(game, p, r = 0.7) {
  const top = p.clone().setY(40), feet = p.clone().setY(0.5);
  const list = candidates(game, top, feet);
  for (const m of list) if (!m.geometry.boundsTree) m.geometry.computeBoundsTree();
  ray.set(top, _d.set(0, -1, 0)); ray.near = 0; ray.far = 39.4;
  if (ray.intersectObjects(list, false).length) return false;
  const chest = p.clone().setY(1.2);
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
    ray.set(chest, _d.set(x, 0, z).normalize()); ray.near = 0; ray.far = r;
    if (ray.intersectObjects(list, false).length) return false;
  }
  return true;
}

// every mesh the line-of-sight tests may query (same filter as candidates())
function bvhMeshes(game) {
  const out = [];
  const take = m => { if (m.isMesh && !m.isInstancedMesh && !m.isSkinnedMesh && m.geometry?.attributes.position && !m.geometry.boundsTree && !(m.material?.transparent && m.material.opacity < 0.5)) out.push(m); };
  for (const ch of game.city.chunks) for (const k of ['walls', 'roofs', 'struct']) if (ch.meshes[k]) take(ch.meshes[k]);
  game.landmarks?.group.traverse(take);
  return out;
}

/** build BVHs now for meshes near the given points (load time: where the first cutscenes happen) */
export function prebuildBVH(game, points, radius = 220) {
  let n = 0;
  for (const m of bvhMeshes(game)) {
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    _s.copy(m.geometry.boundingSphere).applyMatrix4(m.matrixWorld);
    if (points.some(p => Math.hypot(_s.center.x - p.x, _s.center.z - p.z) < _s.radius + radius)) { m.geometry.computeBoundsTree(); n++; }
  }
  return n;
}

/** build the remaining BVHs one per idle slot while keepGoing() (title screen / menus: no frames to protect) */
export function idleBVH(game, keepGoing) {
  const list = bvhMeshes(game);
  const P = game.player?.position;
  if (P) list.sort((a, b) => a.geometry.boundingSphere.center.distanceToSquared(P) - b.geometry.boundingSphere.center.distanceToSquared(P));
  const ric = window.requestIdleCallback || (f => setTimeout(() => f({ timeRemaining: () => 10 }), 30));
  const step = dl => {
    while (list.length && keepGoing() && dl.timeRemaining() > 4) { const m = list.shift(); if (!m.geometry.boundsTree) m.geometry.computeBoundsTree(); }
    if (list.length && keepGoing()) ric(step, { timeout: 500 });
  };
  ric(step, { timeout: 500 });
}
