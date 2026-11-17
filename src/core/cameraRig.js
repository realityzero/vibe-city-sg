// GTA-style third person camera: mouse orbit, auto-follow behind vehicles, collision, speed FOV, shake, FOV kicks,
// cutscene override and the blend from a cutscene's last shot back to the follow view, thin-occluder cut (occluders.js).
import * as THREE from 'three';
import { WATER_LEVEL } from './constants.js';
import { Occluders } from './occluders.js';

const _t = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Vector3(), _f = new THREE.Vector3(), _q = new THREE.Quaternion();
// frame-rate independent exponential smoothing factor (same feel at 60 Hz, 120 Hz and with dt jitter)
const ease = (k, dt) => 1 - Math.exp(-k * dt);
const MAX_ASPECT = 16 / 9; // phones: the horizontal field of view is capped at what this aspect would show

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
    this.override = null; // cutscenes: { position, lookAt, fov }, or { track(camera, dt) } for a shot that follows the action
    this.sensitivity = 1;
    this.invertY = false;
    this.lookBack = false;
    this.fovKick = 0; this.fovKickOut = 0; // degrees: a quick widen that springs back (near misses)
    this.blend = null; // { off, quat, t, dur }: a cutscene's last shot, handing over to the follow view
    this.occluders = new Occluders(game);
    // phone-sized screens: the chase view sits further back and higher, or the car fills half the screen. A wide phone
    // in landscape (19.5:9) also sees no more across than a 16:9 screen: every FOV here is vertical, and at 62 deg a
    // 2.16:1 screen spans ~105 deg horizontally (~118 at speed) — small subjects, stretched edges. camera.zoom narrows
    // whatever FOV is set (follow view, cutscenes, photo mode); camera.getEffectiveFOV() is the vertical FOV seen.
    const fit = () => {
      this.compact = Math.min(innerWidth, innerHeight) < 520;
      camera.zoom = this.compact ? Math.max(1, innerWidth / innerHeight / MAX_ASPECT) : 1;
      camera.updateProjectionMatrix();
    };
    fit(); addEventListener('resize', fit);
  }

  shake(a) { this.shakeAmt = Math.min(1.5, this.shakeAmt + a); }
  kick(deg) { this.fovKick = Math.min(10, this.fovKick + deg); }

  /** Ease from where a cutscene left the camera into the follow view over `dur` seconds. The shot is held relative
   * to the subject (it keeps up with a moving car) while the follow camera takes over underneath. */
  blendFrom(dur = 1.4) {
    const cam = this.camera, p = this.game.player, v = p.vehicle;
    // the follow camera starts out settled: behind a car (or on the shot's side of Tommy), at its resting distance
    const at = v ? v.position : p.position;
    this.yaw = v ? v.yaw() : Math.atan2(cam.position.x - at.x, cam.position.z - at.z);
    this.pitch = v ? (this.compact ? -0.19 : -0.14) : -0.18;
    this.target.copy(at).y += this.follow(v);
    this.curDist = this.followDist;
    this.idle = 2;
    this.blend = { off: cam.position.clone().sub(this.target), quat: cam.quaternion.clone(), fov: cam.fov, t: 0, dur };
  }

  // depth precision: push the near plane out whenever the camera isn't hugging geometry
  setNear(n) { n = Math.round(n * 20) / 20; if (Math.abs(this.camera.near - n) > 0.01) { this.camera.near = n; this.camera.updateProjectionMatrix(); } }

  update(dt, input) {
    const cam = this.camera;
    if (this.override) {
      this.setNear(cam.position.y > 25 ? 2.0 : 0.3);
      const o = this.override;
      // (run here, after the world has moved this frame: a tracking shot stays locked to the interpolated car)
      if (o.track) o.track(cam, dt);
      if (o.position) cam.position.lerp(o.position, o.snap ? 1 : Math.min(1, dt * (o.lerp ?? 3)));
      if (o.lookAt) { this._look = this._look || o.lookAt.clone(); this._look.lerp(o.lookAt, o.snap ? 1 : Math.min(1, dt * (o.lerp ?? 3))); cam.lookAt(this._look); }
      if (o.fov && Math.abs(cam.fov - o.fov) > 0.1) { cam.fov += (o.fov - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix(); }
      o.snap = false;
      this.pos.copy(cam.position);
      this.fovKick = this.fovKickOut = 0;
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

    const height = this.follow(veh), dist = this.followDist;
    if (veh) {
      _t.copy(veh.position); _t.y += height;
      // auto align behind the car
      const vyaw = veh.yaw();
      const sp = veh.speed;
      if (this.idle > 1.0 && sp > 2.5) {
        const moveYaw = veh.forwardSpeed < -1 ? vyaw + Math.PI : vyaw;
        let dy = moveYaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yaw += dy * ease(1.2 + sp * 0.06, dt);
        this.pitch += ((this.compact ? -0.19 : -0.14) - this.pitch) * ease(1.5, dt);
      }
      this.easeFov(this.baseFov + Math.min(14, Math.max(0, sp - 10) * 0.3) + (this.fovBoost ? 9 : 0), dt);
    } else {
      _t.copy(p.position); _t.y += height;
      if (p.swimming) _t.y = Math.max(_t.y, WATER_LEVEL + 1.0); // ride the surface, not the swimmer's sunken feet
      if (this.idle > 2.5 && p.speed > 2) {
        let dy = p.facing - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yaw += dy * ease(0.8, dt);
      }
      this.easeFov(this.baseFov, dt);
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
    _c.set(this.target.x, this.target.y + (veh ? 0.2 : 0.15), this.target.z);
    cam.lookAt(_c);
    // handing over from a cutscene: from its last shot (carried along with the subject) into this view
    const b = this.blend;
    if (b) {
      b.t += dt;
      const k = Math.min(1, b.t / b.dur), e = k * k * k * (k * (k * 6 - 15) + 10); // smootherstep
      _q.copy(cam.quaternion);
      cam.position.lerpVectors(_t.copy(this.target).add(b.off), cam.position, e);
      cam.quaternion.slerpQuaternions(b.quat, _q, e);
      if (b.fov) { cam.fov = b.fov; cam.updateProjectionMatrix(); b.fov = 0; } // (the FOV eases on from the shot's)
      if (k >= 1) this.blend = null;
    }
    this.pos.copy(cam.position);
    // thin occluders (trunks, poles) between the lens and Tommy: cut away by the near plane
    _f.subVectors(_c, cam.position).normalize();
    const sub = veh ? veh.spec : null;
    const occl = this.blend ? 0 : this.occluders.update(dt, cam.position, _f, _c, (veh || p).position.y,
      sub ? sub.width * 0.5 + 0.25 : 0.45, sub ? sub.length * 0.5 + 0.5 : 0.6, veh ? 3 : 2.2);
    this.setNear(Math.max(occl, veh ? THREE.MathUtils.clamp(this.curDist * 0.18, 0.4, 1.8) : THREE.MathUtils.clamp(this.curDist * 0.14, 0.25, 0.7)));
  }

  /** follow-view framing for the current vehicle (or on foot): returns the look height above it, sets followDist */
  follow(veh) {
    if (!veh) { this.followDist = this.dist * this.zoom; return 1.55; }
    const s = veh.spec, sz = Math.max(s.length, s.height * 2.2);
    let dist = [sz * 1.25 + 2.5, sz * 1.8 + 4, sz * 0.9 + 1.5][this.mode] * this.zoom;
    let height = s.height * 0.75 + 0.6 + (veh.isBoat ? 1.6 : 0) + (veh.isAircraft ? 1.0 : 0);
    if (this.compact && !veh.isAircraft) { dist *= 1.18; height += 0.45; }
    this.followDist = dist;
    return height;
  }

  // FOV towards `target` (frame-rate independent), plus the decaying kick on top
  easeFov(target, dt) {
    const cam = this.camera, base = cam.fov - this.fovKickOut;
    this.fovKick *= Math.exp(-dt * 3.5);
    if (this.fovKick < 0.02) this.fovKick = 0;
    const fov = base + (target - base) * ease(2, dt) + this.fovKick;
    this.fovKickOut = this.fovKick;
    if (Math.abs(cam.fov - fov) > 0.02) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  /** world-space forward on the ground plane (for camera-relative movement) */
  groundForward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
}
