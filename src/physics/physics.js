// Rapier (WASM) physics world: static city colliders, fixed-step simulation, queries.
import RAPIER from '@dimforge/rapier3d-compat';
import { WATER_LEVEL } from '../core/constants.js';

export const G = { STATIC: 1, CHAR: 2, VEHICLE: 4, TRAFFIC: 8, PED: 16, PROP: 32, SHORE: 64 };
export const groups = (member, filter) => (member << 16) | filter;
export const FILTER = {
  static: groups(G.STATIC, 0xffff),
  char: groups(G.CHAR, G.STATIC | G.VEHICLE | G.TRAFFIC | G.PROP | G.SHORE),
  charRay: groups(G.CHAR, G.STATIC | G.SHORE), // what a character stands on: the city plus the shore shelf
  shore: groups(G.SHORE, G.CHAR),
  vehicle: groups(G.VEHICLE, G.STATIC | G.VEHICLE | G.TRAFFIC | G.CHAR | G.PROP),
  traffic: groups(G.TRAFFIC, G.VEHICLE | G.CHAR | G.TRAFFIC),
  wheels: groups(G.VEHICLE, G.STATIC),
  cameraRay: groups(G.STATIC, G.STATIC),
};

export class Physics {
  async init() {
    await RAPIER.init();
    this.R = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.world.integrationParameters.numSolverIterations = 4;
    this.events = new RAPIER.EventQueue(true);
    this.acc = 0;
    this.stepCallbacks = [];
    this.postStepCallbacks = [];
    this.alpha = 0;
    this.contactHandlers = new Map(); // collider handle -> fn(otherHandle, force)
  }

  addGround(city) {
    // heightfield at 4 m: land 0, ponds -0.6, water deep
    const M = city.meta, step = 4;
    const ncols = Math.ceil((M.xmax - M.xmin) / step), nrows = Math.ceil((M.zmax - M.zmin) / step);
    const h = new Float32Array((nrows + 1) * (ncols + 1));
    for (let c = 0; c <= ncols; c++) for (let r = 0; r <= nrows; r++) {
      const x = M.xmin + c * step, z = M.zmin + r * step;
      // conservative: land only if all 4 samples around are land (prevents driving on water edges)
      let mn = 255;
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) mn = Math.min(mn, city.maskAt(x + ox * 1.2, z + oz * 1.2));
      h[c * (nrows + 1) + r] = mn > 200 ? 0 : mn > 100 ? -0.6 : WATER_LEVEL - 5;
    }
    // under every ordinary (non-bridge) carriageway the ground is land, even where the conservative mask test dips
    // toward a nearby river/bay edge — otherwise wheels drop into invisible 1-2 m hollows under continuous asphalt
    for (const rd of city.data.roads) {
      if (rd.b || rd.c >= 8) continue;
      const p = rd.p, half = rd.w / 2 + 2;
      for (let i = 0; i < p.length - 2; i += 2) {
        const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
        const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - half - M.xmin) / step)), c1 = Math.min(ncols, Math.ceil((Math.max(ax, bx) + half - M.xmin) / step));
        const r0 = Math.max(0, Math.floor((Math.min(az, bz) - half - M.zmin) / step)), r1 = Math.min(nrows, Math.ceil((Math.max(az, bz) + half - M.zmin) / step));
        for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) {
          const k = c * (nrows + 1) + r; if (h[k] === 0) continue;
          const x = M.xmin + c * step, z = M.zmin + r * step;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
          if (Math.hypot(x - ax - dx * t, z - az - dz * t) <= half) h[k] = 0;
        }
      }
    }
    const sx = ncols * step, sz = nrows * step;
    const desc = RAPIER.ColliderDesc.heightfield(nrows, ncols, h, { x: sx, y: 1, z: sz })
      .setTranslation(M.xmin + sx / 2, 0, M.zmin + sz / 2).setFriction(1.0).setCollisionGroups(FILTER.static);
    this.ground = this.world.createCollider(desc);
    this.addShoreShelf(city, h, ncols, nrows, step);
    // world boundary walls
    const bx = (M.xmin + M.xmax) / 2, bz = (M.zmin + M.zmax) / 2, hx = (M.xmax - M.xmin) / 2, hz = (M.zmax - M.zmin) / 2;
    for (const [x, z, ex, ez] of [[bx, M.zmin - 5, hx + 10, 5], [bx, M.zmax + 5, hx + 10, 5], [M.xmin - 5, bz, 5, hz + 10], [M.xmax + 5, bz, 5, hz + 10]])
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(ex, 200, ez).setTranslation(x, 100, z).setCollisionGroups(FILTER.static));
  }

  /** The field above slopes away from its last land vertex, up to a cell (4 m) short of the drawn waterline, so on
   * foot Tommy would sink through the pavement before the edge and swim under it after. Characters (only — cars keep
   * the conservative field) get a flat shelf at y=0 over every drawn-land 1 m square of those sloping cells, which
   * puts the quay edge where it is drawn: walk off it and you drop into the water. */
  addShoreShelf(city, h, ncols, nrows, step) {
    const M = city.meta, n = 4, sub = step / n, verts = [], idx = [];
    const H = (c, r) => h[c * (nrows + 1) + r];
    for (let c = 0; c < ncols; c++) for (let r = 0; r < nrows; r++) {
      if (!H(c, r) && !H(c + 1, r) && !H(c, r + 1) && !H(c + 1, r + 1)) continue;
      const x0 = M.xmin + c * step, z0 = M.zmin + r * step;
      for (let sr = 0; sr < n; sr++) {
        let s0 = -1; // runs of land squares along the row become one quad
        for (let sc = 0; sc <= n; sc++) {
          const land = sc < n && !city.isWater(x0 + (sc + 0.5) * sub, z0 + (sr + 0.5) * sub);
          if (land && s0 < 0) s0 = sc;
          else if (!land && s0 >= 0) {
            const b = verts.length / 3, xa = x0 + s0 * sub, xb = x0 + sc * sub, za = z0 + sr * sub, zb = za + sub;
            verts.push(xa, 0, za, xb, 0, za, xb, 0, zb, xa, 0, zb); idx.push(b, b + 2, b + 1, b, b + 3, b + 2); // wound to face up
            s0 = -1;
          }
        }
      }
    }
    this.shoreQuads = idx.length / 6;
    if (idx.length) this.shore = this.world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idx)).setFriction(1.0).setCollisionGroups(FILTER.shore));
  }

  addTrimesh(vertices, indices) {
    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices).setCollisionGroups(FILTER.static).setFriction(0.6); // double-sided: generated walls/roofs have mixed winding
    return this.world.createCollider(desc);
  }

  addStatic(c) {
    let desc;
    if (c.type === 'box') {
      desc = RAPIER.ColliderDesc.cuboid(c.half[0], c.half[1], c.half[2]).setTranslation(c.center[0], c.center[1], c.center[2]);
      if (c.yaw) { const s = Math.sin(c.yaw / 2), q = { x: 0, y: s, z: 0, w: Math.cos(c.yaw / 2) }; desc.setRotation(q); }
    } else if (c.type === 'cylinder') desc = RAPIER.ColliderDesc.cylinder(c.halfHeight, c.radius).setTranslation(c.center[0], c.center[1], c.center[2]);
    else if (c.type === 'trimesh') desc = RAPIER.ColliderDesc.trimesh(c.vertices, c.indices);
    if (!desc) return null;
    desc.setCollisionGroups(FILTER.static);
    return this.world.createCollider(desc);
  }

  onStep(fn) { this.stepCallbacks.push(fn); }
  onPostStep(fn) { this.postStepCallbacks.push(fn); }

  step(dt) {
    this.acc += Math.min(dt, 0.1);
    const h = this.world.timestep;
    let n = 0;
    // at most 3 catch-up steps: after a long frame, dropping sim time beats a second long frame
    while (this.acc >= h && n < 3) {
      for (const fn of this.stepCallbacks) fn(h);
      this.beforeWorldStep?.(h); // vehicles apply this step's controls after every controller (player/AI) has set them
      this.world.step(this.events);
      this.events.drainContactForceEvents(ev => {
        const a = ev.collider1(), b = ev.collider2(), f = ev.totalForceMagnitude();
        this.contactHandlers.get(a)?.(b, f, ev); this.contactHandlers.get(b)?.(a, f, ev);
      });
      this.events.drainCollisionEvents(() => { });
      for (const fn of this.postStepCallbacks) fn(h);
      this.acc -= h; n++;
    }
    if (n === 3) this.acc = Math.min(this.acc, h);
    // how far the render frame is between the last two steps: bodies are drawn at lerp(previous, current, alpha)
    this.alpha = this.noInterp ? 1 : Math.min(1, this.acc / h);
  }

  /** returns { toi, point:{x,y,z}, normal, collider } or null */
  raycast(o, d, max, filterGroups = FILTER.cameraRay, excludeCollider) {
    const ray = new RAPIER.Ray(o, d);
    const hit = this.world.castRayAndGetNormal(ray, max, true, undefined, filterGroups, excludeCollider);
    if (!hit) return null;
    return { toi: hit.timeOfImpact, normal: hit.normal, collider: hit.collider, point: { x: o.x + d.x * hit.timeOfImpact, y: o.y + d.y * hit.timeOfImpact, z: o.z + d.z * hit.timeOfImpact } };
  }
}

/** Render-side interpolation of a rigid body between the last two fixed steps, so motion is smooth on 60 Hz, 120 Hz
 * and irregular frame rates alike (otherwise some frames advance the car by two steps and some by none: judder). */
export class PoseInterp {
  constructor(body, THREE) {
    this.body = body;
    this.p0 = new THREE.Vector3(); this.p1 = new THREE.Vector3();
    this.q0 = new THREE.Quaternion(); this.q1 = new THREE.Quaternion();
    this.snap();
  }
  _read() { const t = this.body.translation(), r = this.body.rotation(); this.p1.set(t.x, t.y, t.z); this.q1.set(r.x, r.y, r.z, r.w); }
  /** after a teleport: no interpolation across the jump */
  snap() { this._read(); this.p0.copy(this.p1); this.q0.copy(this.q1); }
  /** called after every physics step */
  capture() {
    this.p0.copy(this.p1); this.q0.copy(this.q1); this._read();
    if (this.p0.distanceToSquared(this.p1) > 64) { this.p0.copy(this.p1); this.q0.copy(this.q1); }
  }
  apply(obj, alpha) { obj.position.lerpVectors(this.p0, this.p1, alpha); obj.quaternion.slerpQuaternions(this.q0, this.q1, alpha); }
}
