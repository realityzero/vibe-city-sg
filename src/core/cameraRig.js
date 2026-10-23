// GTA-style third person camera: mouse orbit, auto-follow behind vehicles, collision, speed FOV, shake, cutscene override.
import * as THREE from 'three';
import { WATER_LEVEL } from './constants.js';

const _t = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Vector3();
// frame-rate independent exponential smoothing factor (same feel at 60 Hz, 120 Hz and with dt jitter)
const ease = (k, dt) => 1 - Math.exp(-k * dt);

export class CameraRig {
  constructor(game, camera) {
    this.game = game;
    this.camera = camera;
    this.yaw = 0; this.pitch = -0.18;
    this.dist = 4.6;
    this.curDist = 4.6;
    this.target = new THREE.Vector3();
    this.pos = new THREE.Vector3(0, 10, 10);
    this.idle = 0;
    this.shakeAmt = 0;
    this.baseFov = 62;
    this.mode = 0; // vehicle view modes: 0 normal, 1 far, 2 close
    this.zoom = 1; // follow-distance multiplier: mouse wheel, pinch, V on foot
    this.override = null; // { position, lookAt, fov } for cutscenes
    this.sensitivity = 1;
    this.invertY = false;
    this.lookBack = false;
  }

  shake(a) { this.shakeAmt = Math.min(1.5, this.shakeAmt + a); }

  // depth precision: push the near plane out whenever the camera isn't hugging geometry
  setNear(n) { n = Math.round(n * 20) / 20; if (Math.abs(this.camera.near - n) > 0.01) { this.camera.near = n; this.camera.updateProjectionMatrix(); } }

  update(dt, input) {
    const cam = this.camera;
    if (this.override) {
      this.setNear(cam.position.y > 25 ? 2.0 : 0.3);
      const o = this.override;
      if (o.position) cam.position.lerp(o.position, o.snap ? 1 : Math.min(1, dt * (o.lerp ?? 3)));
      if (o.lookAt) { this._look = this._look || o.lookAt.clone(); this._look.lerp(o.lookAt, o.snap ? 1 : Math.min(1, dt * (o.lerp ?? 3))); cam.lookAt(this._look); }
      if (o.fov && Math.abs(cam.fov - o.fov) > 0.1) { cam.fov += (o.fov - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix(); }
      o.snap = false;
      this.pos.copy(cam.position);
      return;
    }
    this._look = null;
    const p = this.game.player;
    const veh = p.vehicle;
    const m = input.mouse;
    const sens = 0.0024 * this.sensitivity;
    if (Math.abs(m.dx) + Math.abs(m.dy) > 0) this.idle = 0; else this.idle += dt;
    this.yaw -= m.dx * sens;
    this.pitch -= m.dy * sens * (this.invertY ? -1 : 1);
    const gp = input.gamepad();
    if (gp) { const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0; if (Math.abs(rx) > 0.15) { this.yaw -= rx * dt * 2.6; this.idle = 0; } if (Math.abs(ry) > 0.15) { this.pitch -= ry * dt * 1.8; this.idle = 0; } }
    if (input.hit('KeyV')) { if (veh) this.mode = (this.mode + 1) % 3; else this.zoom = this.zoom < 0.9 ? 1 : this.zoom < 1.3 ? 1.6 : 0.7; }
    if (m.wheel) this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(m.wheel * 0.1), 0.6, 2);
    this.lookBack = input.down('KeyC') && !!veh;

    let height, dist;
    if (veh) {
      const s = veh.spec;
      const sz = Math.max(s.length, s.height * 2.2);
      dist = [sz * 1.25 + 2.5, sz * 1.8 + 4, sz * 0.9 + 1.5][this.mode] * this.zoom;
      height = s.height * 0.75 + 0.6 + (veh.isBoat ? 1.6 : 0) + (veh.isAircraft ? 1.0 : 0);
      _t.copy(veh.position); _t.y += height;
      // auto align behind the car
      const vyaw = veh.yaw();
      const sp = veh.speed;
      if (this.idle > 1.0 && sp > 2.5) {
        const moveYaw = veh.forwardSpeed < -1 ? vyaw + Math.PI : vyaw;
        let dy = moveYaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yaw += dy * ease(1.2 + sp * 0.06, dt);
        this.pitch += (-0.14 - this.pitch) * ease(1.5, dt);
      }
      const fovT = this.baseFov + Math.min(14, Math.max(0, sp - 10) * 0.3) + (this.fovBoost ? 9 : 0);
      if (Math.abs(cam.fov - fovT) > 0.05) { cam.fov += (fovT - cam.fov) * ease(2, dt); cam.updateProjectionMatrix(); }
    } else {
      height = 1.55;
      dist = this.dist * this.zoom;
      _t.copy(p.position); _t.y += height;
      if (p.swimming) _t.y = Math.max(_t.y, WATER_LEVEL + 1.0); // ride the surface, not the swimmer's sunken feet
      if (this.idle > 2.5 && p.speed > 2) {
        let dy = p.facing - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yaw += dy * ease(0.8, dt);
      }
      if (Math.abs(cam.fov - this.baseFov) > 0.05) { cam.fov += (this.baseFov - cam.fov) * ease(2, dt); cam.updateProjectionMatrix(); }
    }
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.25, 0.6);
    // follow the (interpolated) body: horizontally tight, vertically softer so suspension bounce, kerbs and the bike's
    // pitching don't shake the whole view
    const a = ease(veh ? 14 : 18, dt), ay = ease(veh ? 6 : 18, dt);
    this.target.x += (_t.x - this.target.x) * a; this.target.z += (_t.z - this.target.z) * a; this.target.y += (_t.y - this.target.y) * ay;
    if (this.target.distanceTo(_t) > 8) this.target.copy(_t);
    const yaw = this.yaw + (this.lookBack ? Math.PI : 0);
    // camera offset direction (camera sits behind target): forward of camera = (-sin yaw, -cos yaw)
    _d.set(Math.sin(yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(yaw) * Math.cos(this.pitch));
    // collision
    const P = this.game.physics;
    let want = dist;
    if (P) {
      const hit = P.raycast(this.target, _d, dist + 0.3);
      if (hit) want = Math.max(0.8, hit.toi - 0.35);
    }
    // pull in fast but not in one frame (a lamp post sweeping through the ray shouldn't jolt the view), ease back out
    this.curDist += (want - this.curDist) * ease(want < this.curDist ? (want < 1.6 ? 60 : 28) : 3, dt);
    _c.copy(this.target).addScaledVector(_d, this.curDist);
    if (_c.y < this.target.y - 2 && _c.y < 0.4) _c.y = 0.4;
    if (p.swimming && !veh && _c.y < WATER_LEVEL + 0.5) _c.y = WATER_LEVEL + 0.5;
    cam.position.copy(_c);
    // shake
    // a few Hz and a few cm: an impact thump, not a vibrating view
    if (this.shakeAmt > 0.001) {
      const t = (this.shakeT = (this.shakeT || 0) + dt) * Math.PI * 2;
      cam.position.x += (Math.sin(t * 3.1) + 0.5 * Math.sin(t * 7.3)) * this.shakeAmt * 0.05;
      cam.position.y += (Math.sin(t * 4.3) + 0.5 * Math.sin(t * 9.1)) * this.shakeAmt * 0.035;
      this.shakeAmt *= Math.exp(-dt * 5);
    }
    cam.lookAt(this.target.x, this.target.y + (veh ? 0.2 : 0.15), this.target.z);
    this.pos.copy(cam.position);
    this.setNear(veh ? THREE.MathUtils.clamp(this.curDist * 0.18, 0.4, 1.8) : THREE.MathUtils.clamp(this.curDist * 0.14, 0.25, 0.7));
  }

  /** world-space forward on the ground plane (for camera-relative movement) */
  groundForward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
}
