// Where the sun's shadow map goes each frame. The map is a square of fixed size in the light's view, so its texels
// keep their size and its centre snaps to whole texels (shadow edges don't crawl as the camera moves). Within `reach`
// of the focus the sun shadow comes from the map, beyond it from the city height field (HF.shadowCenter / shadowR).
// Centred on the focus, the box spent half its texels behind the camera; fitted to the part of that disc the camera
// can see — sampled at a few heights, ground and water up to tree crowns and low facades — the same reach takes a
// much smaller box. When even that doesn't fit (a wide view along one of the light's axes) the box keeps the part
// nearest the camera, and whatever it misses is shaded by the height field (materials.js).
import * as THREE from 'three';
import { SHADOW_EDGE } from './shadowfilter.js';

// box half size / shadow circle radius: ~1.6x the texel density of the old player-centred box. A chase camera's view
// of the circle needs up to ~0.75, so looking along the light's axes the far corners (~70 m out at the nearest on Low)
// are left to the height field.
export const SHADOW_BOX = 0.62;

const LEVELS = [-1.5, 9, 20];
const SIDES = 16, OUTER = 1 / Math.cos(Math.PI / SIDES); // polygon around the disc, not inside it
const _frustum = new THREE.Frustum(), _pv = new THREE.Matrix4();
let _p = new Float32Array(2 * (SIDES + 8)), _q = new Float32Array(2 * (SIDES + 8));
let u0, u1, v0, v1;

// Sutherland-Hodgman: keep the part of polygon src (n x,z pairs) where a x + b z + k >= 0, into dst; returns its size
function clip(src, n, dst, a, b, k) {
  let m = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, x0 = src[2 * i], z0 = src[2 * i + 1], x1 = src[2 * j], z1 = src[2 * j + 1];
    const s0 = a * x0 + b * z0 + k, s1 = a * x1 + b * z1 + k;
    if (s0 >= 0) { dst[2 * m] = x0; dst[2 * m + 1] = z0; m++; }
    if ((s0 >= 0) !== (s1 >= 0)) { const t = s0 / (s0 - s1); dst[2 * m] = x0 + (x1 - x0) * t; dst[2 * m + 1] = z0 + (z1 - z0) * t; m++; }
  }
  return m;
}
function grow(x, y, z, SX, SY) {
  const u = x * SX.x + z * SX.z, v = x * SY.x + y * SY.y + z * SY.z;
  u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
}
// along one axis: the middle of the span needed, or (too long for the box) the stretch at the camera's end of it
const centre = (lo, hi, cam, m) => (lo > hi ? cam : hi - lo <= 2 * m ? (lo + hi) / 2 : Math.min(hi - m, Math.max(lo + m, cam)));

/**
 * Centre of the shadow box in light space (u along SX, v along SY; SX horizontal), snapped to texels, into out[0..1].
 * half: the box's half size; reach: radius round the focus the map must cover where the camera (if any) sees it.
 */
export function fitShadowBox(camera, focus, reach, half, texel, SX, SY, out) {
  u0 = v0 = Infinity; u1 = v1 = -Infinity;
  let cu = focus.x * SX.x + focus.z * SX.z, cv = focus.x * SY.x + focus.z * SY.z;
  if (camera) {
    camera.updateMatrixWorld();
    _frustum.setFromProjectionMatrix(_pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const R = reach * OUTER, c = camera.position;
    for (const y of LEVELS) {
      let n = SIDES;
      for (let i = 0; i < SIDES; i++) { const a = i / SIDES * Math.PI * 2; _p[2 * i] = focus.x + Math.cos(a) * R; _p[2 * i + 1] = focus.z + Math.sin(a) * R; }
      for (const pl of _frustum.planes) {
        n = clip(_p, n, _q, pl.normal.x, pl.normal.z, pl.normal.y * y + pl.constant);
        const t = _p; _p = _q; _q = t;
        if (!n) break;
      }
      for (let i = 0; i < n; i++) grow(_p[2 * i], y, _p[2 * i + 1], SX, SY);
    }
    if (c.y > LEVELS[0] && c.y < LEVELS[LEVELS.length - 1] && Math.hypot(c.x - focus.x, c.z - focus.z) < reach) grow(c.x, c.y, c.z, SX, SY);
    cu = c.x * SX.x + c.z * SX.z; cv = c.x * SY.x + c.y * SY.y + c.z * SY.z;
  }
  const m = half * (1 - 2 * SHADOW_EDGE) - 1 - 0.01 * reach; // clear of the fade band, PCF footprint and polygon slack
  out[0] = Math.round(centre(u0, u1, cu, m) / texel) * texel;
  out[1] = Math.round(centre(v0, v1, cv, m) / texel) * texel;
  return out;
}
