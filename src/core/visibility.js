// Line-of-sight tests for framing cutscene cameras, run against the static physics world (city buildings and
// bridge decks as trimeshes, landmark colliders, the ground) plus the sight-only blockers the city builder adds for
// what has no collider (pitched roofs, gables, arcade and void-deck ceilings, covered walkways): the shot must not
// have a wall, canopy or landmark piece between the camera and the people in it. Rapier already holds the solid city, so this needs no CPU-side
// copy of the rendered geometry and no BVHs (that used to cost ~100 MB of mesh data, too much for phones).
import { FILTER } from '../physics/physics.js';

const _o = { x: 0, y: 0, z: 0 }, _d = { x: 0, y: 0, z: 0 };
function blocked(P, a, b, nearA, nearB) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz);
  if (L <= nearA + nearB) return false;
  _d.x = dx / L; _d.y = dy / L; _d.z = dz / L;
  _o.x = a.x + _d.x * nearA; _o.y = a.y + _d.y * nearA; _o.z = a.z + _d.z * nearA;
  return !!P.raycast(_o, _d, L - nearA - nearB, FILTER.sightRay);
}

/** true when nothing solid blocks the segment a→b */
export function clearLine(game, a, b) {
  const P = game.physics; if (!P) return true;
  // both directions: a ray that starts inside a solid collider reports nothing on the way out
  return !blocked(P, a, b, 0.05, 0.3) && !blocked(P, b, a, 0.3, 0.05);
}

/** true when a person-sized space at p (ground level) is free: nothing overhead, no wall within r at chest height */
export function spotFree(game, p, r = 0.7) {
  const P = game.physics; if (!P) return true;
  // overhead: up from the feet (a downward probe would start inside anything taller than its start height)
  if (P.raycast({ x: p.x, y: 0.6, z: p.z }, { x: 0, y: 1, z: 0 }, 39.4, FILTER.sightRay)) return false;
  if (P.raycast({ x: p.x, y: 40, z: p.z }, { x: 0, y: -1, z: 0 }, 39.4, FILTER.sightRay)) return false;
  const chest = { x: p.x, y: 1.2, z: p.z };
  for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]])
    if (P.raycast(chest, { x, y: 0, z }, r, FILTER.sightRay)) return false;
  return true;
}
