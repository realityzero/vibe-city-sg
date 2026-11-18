import * as THREE from 'three';
import { BONES, PARENT, B, makeRest, buildCharacter } from './body.js';
import { MeshBuilder } from './builder.js';
import { resolveSpec } from './presets.js';
import { ANIMS, samplePose, POSE_LEN, NB } from './anims.js';
import { getAtlas } from './atlas.js';
import { withLampField } from '../../gfx/lampfield.js';
import { markMoving } from '../../gfx/taa.js';

let heroMat = null;
/** One shared material for every hero humanoid: vertex colours × atlas, per-vertex roughness/metalness/sss. */
export function getHeroMaterial() {
  if (heroMat) return heroMat;
  heroMat = markMoving(new THREE.MeshStandardMaterial({ vertexColors: true, map: getAtlas(), roughness: 1, metalness: 0 }));
  heroMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 rm;\nattribute vec4 gar;\nattribute vec4 gar2;\nvarying vec3 vRM;\nvarying vec4 vGar;\nflat varying vec4 vGar2;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRM = rm; vGar = gar; vGar2 = gar2;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vRM;
varying vec4 vGar;
flat varying vec4 vGar2;
float hairThr(float a, vec4 t) {
  if (a < 0.75) return mix(t.x, t.y, smoothstep(0.0, 0.75, a));
  if (a < 1.45) return mix(t.y, t.z, smoothstep(0.75, 1.45, a));
  if (a < 2.1) return mix(t.z, t.w, smoothstep(1.45, 2.1, a));
  if (a < 2.7) return mix(t.w, t.w - 0.35, smoothstep(2.1, 2.7, a));
  return t.w - 0.35;
}
float hairMarginF(vec3 d, vec4 t, int kind) {
  float a = abs(atan(d.x, -d.z));
  if (kind == 7) {
    vec3 ed = normalize(vec3(1.0, -0.03, 0.06));
    float e = acos(clamp(abs(d.x) * ed.x + d.y * ed.y + d.z * ed.z, -1.0, 1.0));
    return min(min(d.y + 0.5, 0.18 - d.y + 0.25 * smoothstep(1.6, 3.0, a)), min((a - 1.0) * 0.6, e - 0.32));
  }
  float thr = hairThr(a, t);
  if (kind == 6) { float bmp = exp(-pow((a - 1.3) / 0.09, 2.0)); thr = min(thr, mix(thr, -0.25, bmp)); }
  return d.y - thr;
}
vec3 garUnpack(float f) { uint u = uint(f + 0.5); vec3 c = vec3(float((u >> 16u) & 255u), float((u >> 8u) & 255u), float(u & 255u)) / 255.; return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float garR = vRM.x, garS = vRM.z;
if (vGar.w > 4.5 && vGar.w < 7.5) { if (hairMarginF(normalize(vGar.xyz), vGar2, int(vGar.w + 0.5)) < 0.0) discard; }
else if (vGar.w > 0.5) {
  int kind = int(vGar.w + 0.5);
  float gx = vGar.x, gy = vGar.y, fr = vGar.z, yv = vGar2.x;
  int which = 0;
  if (kind == 1 || kind == 2) {
    if (fr < -0.15 && gy > yv) {
      float hw = (gy - yv) * 0.55 + 0.006;
      if (abs(gx) < hw) { which = 1; if (kind == 2 && vGar2.w >= 0. && abs(gx) < 0.012 + (gy - yv) * 0.035) which = 3; }
      else if (kind == 2 && abs(gx) < hw + 0.034) which = 2;
      else if (kind == 1 && abs(gx) < hw + 0.004) diffuseColor.rgb *= 0.55; // fabric edge
    }
  } else if (kind == 3) {
    float ax = abs(gx);
    if ((fr < 0. && gy > 1.37 && ax < 0.085 + (gy - 1.37) * 0.6) || (fr >= 0. && gy > 1.43 && ax < 0.08) || (ax > 0.118 && gy > 1.27 + 0.4 * (0.17 - ax))) which = 1;
  } else if (kind == 4) {
    if (fr < -0.9 && abs(gx) < 0.0035) diffuseColor.rgb *= 0.82;
  }
  if (which == 1) { diffuseColor.rgb = garUnpack(vGar2.y) * (kind != 2 ? 0.92 : 1.0); if (kind != 2) { garR = 0.58; garS = 1.; } else { garR = 0.8; garS = 0.; } }
  else if (which == 2) { diffuseColor.rgb = garUnpack(vGar2.z); garR = 0.5; }
  else if (which == 3) { diffuseColor.rgb = garUnpack(vGar2.w) * (0.85 + 0.15 * step(0.5, fract(gy * 60.0 + gx * 40.0))); garR = 0.45; }
}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = garR;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;')
      // skin: a warm subsurface lift of the light it actually receives (no glow in the dark)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directDiffuse *= 1.0 + garS * vec3(0.22, 0.06, 0.02); reflectedLight.indirectDiffuse *= 1.0 + garS * vec3(0.14, 0.04, 0.0);');
  };
  heroMat.customProgramCacheKey = () => 'vc-humanoid-rm2';
  return withLampField(heroMat);
}
let phoneGeo = null, phoneMat = null;

const geoCache = new Map();
const _v = new THREE.Vector3(), _e = new THREE.Euler(), _q = new THREE.Quaternion();

/**
 * Procedural humanoid. Faces -z, feet at y = 0, height ≈ spec.body.height.
 * root: add to scene and move/rotate it (root.rotation.y = yaw, forward = (-sin yaw, 0, -cos yaw)).
 */
export class Humanoid {
  constructor(opts = {}) {
    const spec = resolveSpec(opts);
    const lod = opts.lod || 'high';
    this.spec = spec;
    this.preset = opts.preset || 'random';
    const rest = makeRest(spec.body);
    const cacheable = this.preset !== 'random' && !opts.colors;
    const key = cacheable ? `${this.preset}:${lod}` : null;
    let geo = key ? geoCache.get(key) : null;
    if (!geo) {
      const b = new MeshBuilder();
      buildCharacter(b, spec, rest, lod);
      geo = b.toGeometry();
      if (key) geoCache.set(key, geo);
    }
    this._ownGeo = !key;
    this.geometry = geo;

    this.bones = BONES.map(n => { const bone = new THREE.Bone(); bone.name = n; return bone; });
    BONES.forEach((n, i) => {
      const p = PARENT[i], r = rest[n], pr = p >= 0 ? rest[BONES[p]] : [0, 0, 0];
      this.bones[i].position.set(r[0] - pr[0], r[1] - pr[1], r[2] - pr[2]);
      if (p >= 0) this.bones[p].add(this.bones[i]);
    });
    this.restPos = this.bones.map(bn => bn.position.clone());
    this.mesh = new THREE.SkinnedMesh(geo, getHeroMaterial());
    this.mesh.add(this.bones[0]);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.35);
    this.height = spec.body.height || 1.78;
    this.mesh.scale.setScalar(this.height / 1.78);

    this.root = new THREE.Group();
    this.root.name = `humanoid:${this.preset}`;
    this.root.add(this.mesh);
    this.root.userData.humanoid = this;
    this.joints = Object.fromEntries(BONES.map((n, i) => [n, this.bones[i]]));

    // prop sockets in the palms (attach phones, laptops, bags...). Socket -y runs toward the fingertips.
    this.hands = { left: new THREE.Object3D(), right: new THREE.Object3D() };
    this.hands.left.position.set(0.004, -0.055, -0.004); this.bones[B.handL].add(this.hands.left);
    this.hands.right.position.set(-0.004, -0.055, -0.004); this.bones[B.handR].add(this.hands.right);
    this.head = this.bones[B.head];

    if (!phoneGeo) {
      phoneGeo = new THREE.BoxGeometry(0.072, 0.15, 0.009);
      phoneMat = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.25, metalness: 0.4 });
    }
    this.phone = new THREE.Mesh(phoneGeo, phoneMat);
    this.phone.position.set(-0.012, -0.01, -0.02);
    this.phone.rotation.set(0.15, 0, 0);
    this.phone.visible = false;
    this.hands.right.add(this.phone);

    this.params = { steer: 0 };
    this.layers = [];
    this.current = null;
    this.seed = (opts.seed ?? Math.random() * 100) % 100;
    this.ctx = { seed: this.seed, steer: 0, tmpA: new Float32Array(POSE_LEN), tmpB: new Float32Array(POSE_LEN) };
    this._pose = new Float32Array(POSE_LEN);
    this._acc = new Float32Array(POSE_LEN);
    this._look = { target: null, yaw: 0, pitch: 0, w: 0 };
    this.setAnim(opts.anim || 'idle', { blend: 0 });
    this.update(0);
  }

  get anim() { return this.current?.name; }
  get animTime() { return this.current?.t ?? 0; }
  /** true once a non-looping anim (jump, land, knocked, enter_car, exit_car) has reached its end */
  isAnimDone() { const c = this.current; if (!c) return true; const a = ANIMS[c.name]; return !a.loop && c.t >= a.dur; }

  setAnim(name, { blend = 0.2, speed = 1, restart = false } = {}) {
    if (!ANIMS[name]) name = 'idle';
    if (this.current && this.current.name === name && !restart) { this.current.speed = speed; return this; }
    for (const l of this.layers) l.target = 0;
    const layer = { name, t: 0, speed, w: this.layers.length && blend > 0 ? 0 : 1, target: 1, fade: Math.max(blend, 1e-3) };
    if (layer.w === 1) this.layers.length = 0;
    this.layers.push(layer);
    this.current = layer;
    this.phone.visible = name === 'phone';
    return this;
  }
  setSpeed(speed) { if (this.current) this.current.speed = speed; }
  /** world-space point to look at (null to stop). */
  lookAt(target) { this._look.target = target ? (this._look.target || new THREE.Vector3()).copy(target) : null; }

  update(dt) {
    const L = this.layers;
    for (const l of L) {
      l.t += dt * l.speed;
      const rate = dt / l.fade;
      l.w = l.target > l.w ? Math.min(1, l.w + rate) : Math.max(0, l.w - rate);
    }
    for (let i = L.length - 1; i >= 0; i--) if (L[i].target === 0 && L[i].w <= 0) L.splice(i, 1);
    this.ctx.steer = this.params.steer;
    const acc = this._acc; acc.fill(0);
    let wsum = 0;
    for (const l of L) {
      if (l.w <= 0) continue;
      samplePose(l.name, l.t, this.ctx, this._pose);
      for (let j = 0; j < POSE_LEN; j++) acc[j] += this._pose[j] * l.w;
      wsum += l.w;
    }
    if (wsum > 0) for (let j = 0; j < POSE_LEN; j++) acc[j] /= wsum;
    this._applyLook(dt, acc);
    for (let i = 0; i < NB; i++) {
      _e.set(acc[i * 3], acc[i * 3 + 1], acc[i * 3 + 2], 'XYZ');
      this.bones[i].quaternion.setFromEuler(_e);
    }
    const hp = NB * 3;
    this.bones[0].position.set(this.restPos[0].x + acc[hp], this.restPos[0].y + acc[hp + 1], this.restPos[0].z + acc[hp + 2]);
  }

  _applyLook(dt, acc) {
    const lk = this._look;
    let ty = 0, tp = 0, tw = 0;
    if (lk.target) {
      this.root.updateWorldMatrix(true, false);
      _v.copy(lk.target);
      this.root.worldToLocal(_v);
      _v.y -= this.height * 0.93;
      const yaw = Math.atan2(-_v.x, -_v.z);
      if (Math.abs(yaw) < 2.2) { ty = Math.max(-1.2, Math.min(1.2, yaw)); tp = Math.max(-0.5, Math.min(0.5, Math.atan2(_v.y, Math.hypot(_v.x, _v.z)))); tw = 1; }
    }
    const k = 1 - Math.exp(-dt * 6);
    lk.yaw += (ty - lk.yaw) * k; lk.pitch += (tp - lk.pitch) * k; lk.w += (tw - lk.w) * k;
    if (lk.w < 0.001) return;
    const y = lk.yaw * lk.w, p = lk.pitch * lk.w;
    acc[B.chest * 3 + 1] += y * 0.15;
    acc[B.neck * 3 + 1] += y * 0.35; acc[B.neck * 3] += p * 0.3;
    acc[B.head * 3 + 1] += y * 0.5; acc[B.head * 3] += p * 0.7;
  }

  dispose() {
    this.root.removeFromParent();
    if (this._ownGeo) this.geometry.dispose();
    this.mesh.skeleton.dispose();
  }
}

export function createHumanoid(opts) { return new Humanoid(opts); }
