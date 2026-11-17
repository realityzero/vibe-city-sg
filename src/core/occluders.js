// Thin occluders in front of the follow camera — tree trunks, lamp posts, traffic-light poles — are cut away by pushing
// the camera's near plane just past them. A clean cut: no transparency, no dithering, no shader variants, nothing extra
// to draw. Only what is thin and right in front of the lens qualifies (between the camera and Tommy, or filling the
// near field), and the plane never reaches the subject or the ground along the bottom of the screen.
import { CELL as TREE_CELL } from '../world/treecolliders.js';

const LAMP_CELL = 100;   // props.lampGrid
const TL_R = 0.35;       // traffic-light pole with its pedestrian head
const LAMP_R = 0.16;
const HOLD = 0.25;       // s the cut stays after its occluder leaves the zone (no flicker at the boundary)

export class Occluders {
  constructor(game) {
    this.game = game;
    this.near = 0; this.hold = 0;
    this.q = {}; // per-call scratch (no closure or object per frame)
  }

  /**
   * Near-plane distance that clears the occluders this frame (0: none).
   * @param cam camera position; f unit view direction; look the point looked at (the subject); groundY under the subject;
   *   halfW the subject's half width; behind how far its near side sits in front of `look`; nearField the depth within
   *   which anything thin in view is cut
   */
  update(dt, cam, f, look, groundY, halfW, behind, nearField) {
    const g = this.game, q = this.q, camera = g.camera, vfov = camera.fov * Math.PI / 180, aspect = camera.aspect;
    const sx = look.x - cam.x, sz = look.z - cam.z, sL2 = sx * sx + sz * sz;
    const subj = sx * f.x + (look.y - cam.y) * f.y + sz * f.z;
    // the screen's bottom edge looks down at a = pitch + half the vertical FOV: the plane must stay short of where that
    // ray meets the ground, and an upright pole's lowest visible point (its deepest) is where the same ray crosses it
    const beta = vfov * 0.5, a = Math.asin(Math.max(-1, Math.min(1, -f.y))) + beta, H = cam.y - groundY;
    let limit = subj - behind;
    if (a > 0.02 && H > 0) limit = Math.min(limit, H * Math.cos(beta) / Math.sin(a) * 0.9);
    q.cam = cam; q.f = f; q.groundY = groundY; q.sx = sx; q.sz = sz; q.sL2 = sL2; q.a = a; q.tanA = Math.tan(Math.min(a, 1.5));
    q.tanH = Math.tan(beta) * aspect; q.halfW = halfW; q.nearField = nearField; q.limit = limit; q.need = 0;
    if (limit > 0.6 && sL2 > 0.01) {
      const x0 = Math.min(cam.x, look.x) - nearField, x1 = Math.max(cam.x, look.x) + nearField;
      const z0 = Math.min(cam.z, look.z) - nearField, z1 = Math.max(cam.z, look.z) + nearField;
      const veg = g.veg, grid = g.treeColliders?.grid;
      if (veg && grid) {
        for (let gx = Math.floor(x0 / TREE_CELL); gx <= Math.floor(x1 / TREE_CELL); gx++)
          for (let gz = Math.floor(z0 / TREE_CELL); gz <= Math.floor(z1 / TREE_CELL); gz++) {
            const c = grid.get(gx * 100003 + gz); if (!c) continue;
            // (drawn trunks are much wider than their colliders: flared bases, leaning, rain trees up to 0.85 m)
            for (const i of c) this.test(veg.pos[i * 2], veg.pos[i * 2 + 1], Math.min(1, Math.max(0.4, 0.25 + 0.5 * veg.scale[i])));
          }
      }
      const P = g.props;
      if (P?.lampGrid) {
        for (let gx = Math.floor(x0 / LAMP_CELL); gx <= Math.floor(x1 / LAMP_CELL); gx++)
          for (let gz = Math.floor(z0 / LAMP_CELL); gz <= Math.floor(z1 / LAMP_CELL); gz++) {
            const c = P.lampGrid.get(gx * 100003 + gz); if (!c) continue;
            for (const i of c) { const l = P.lamps[i]; if (l.x > x0 && l.x < x1 && l.z > z0 && l.z < z1) this.test(l.x, l.z, LAMP_R); }
          }
        for (const t of P.tlNear) if (t.x > x0 && t.x < x1 && t.z > z0 && t.z < z1) this.test(t.x, t.z, TL_R);
      }
    }
    if (q.need > 0) { this.near = Math.max(q.need, this.hold > 0 ? Math.min(this.near, limit) : 0); this.hold = HOLD; }
    else if ((this.hold -= dt) <= 0 || this.near > limit) this.near = 0;
    return this.near;
  }

  // an upright pole of radius r at (x, z): raise the cut past it if it's in the way. All of it when the plane can go that
  // far; otherwise as far as it may, as long as that clears it at eye level (only a stump at the screen's foot stays).
  test(x, z, r) {
    const q = this.q, cam = q.cam, f = q.f;
    const dx = x - cam.x, dz = z - cam.z;
    const t = (dx * q.sx + dz * q.sz) / q.sL2;
    if (t <= 0) return;
    const dEye = dx * f.x + dz * f.z, yLow = q.a > 0 ? Math.max(q.groundY, cam.y - Math.hypot(dx, dz) * q.tanA) : cam.y;
    const d = dEye + (yLow - cam.y) * f.y;
    let cut = d + r + 0.12;
    if (cut > q.limit) { if (dEye + r + 0.12 > q.limit) return; cut = q.limit; }
    if (cut <= q.need) return;
    const px = dx - q.sx * t, pz = dz - q.sz * t, lat = Math.sqrt(px * px + pz * pz);
    // in front of the subject, or so close that it fills a slice of the screen
    if ((t < 1 && lat < r + q.halfW) || (dEye < q.nearField && lat < dEye * q.tanH + r)) q.need = cut;
  }
}
