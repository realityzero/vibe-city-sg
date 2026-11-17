// Instanced renderer for AI traffic: one InstancedMesh per vehicle type (low LOD body incl. lights,
// glass and decals) + one InstancedMesh per wheel style shared by all types. Per-instance paint colour
// and light state live in instanced attributes read by the uber material.
import * as THREE from 'three';
import { getTypeAssets, poolTexture } from './model.js';
import { withLampField } from '../../gfx/lampfield.js';
import { VEHICLE_SPECS } from './specs.js';
import { createVehicleMaterial, packLights, vehicleTime, setDecalParams } from './material.js';
import { buildWheelLow, wheelAtlas } from './wheels.js';

const _m = new THREE.Matrix4(), _w = new THREE.Matrix4(), _l = new THREE.Matrix4(), _b = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _s = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1), X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();
const lightArr = [0, 0, 0, 0];

function shareGeometry(src) {
  const g = new THREE.BufferGeometry();
  for (const k in src.attributes) g.setAttribute(k, src.attributes[k]);
  g.setIndex(src.index);
  g.boundingBox = src.boundingBox; g.boundingSphere = src.boundingSphere;
  return g;
}

class InstancePool {
  constructor(scene, geometry, material, max, { castShadow = true, receiveShadow = true } = {}) {
    this.max = max;
    this.geometry = shareGeometry(geometry);
    this.paint = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
    this.lights = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.paint.setUsage(THREE.DynamicDrawUsage); this.lights.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('iPaint', this.paint);
    this.geometry.setAttribute('iLights', this.lights);
    this.mesh = new THREE.InstancedMesh(this.geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = castShadow; this.mesh.receiveShadow = receiveShadow;
    this.owners = new Array(max);       // slot -> owner record
    this.count = 0;
    this.dirty = false;
    scene.add(this.mesh);
  }
  alloc(owner) {
    if (this.count >= this.max) return -1;
    const s = this.count++;
    this.owners[s] = owner;
    this.mesh.count = this.count;
    return s;
  }
  /** swap-remove; returns the owner that moved into `slot` (or null) */
  free(slot) {
    const last = --this.count;
    let moved = null;
    if (slot !== last) {
      this.mesh.getMatrixAt(last, _m); this.mesh.setMatrixAt(slot, _m);
      for (let i = 0; i < 3; i++) this.paint.array[slot * 3 + i] = this.paint.array[last * 3 + i];
      for (let i = 0; i < 4; i++) this.lights.array[slot * 4 + i] = this.lights.array[last * 4 + i];
      moved = this.owners[last];
      this.owners[slot] = moved;
    }
    this.owners[last] = undefined;
    this.mesh.count = this.count;
    this.dirty = true;
    return moved;
  }
  flush() {
    if (!this.dirty) return;
    // upload only the live prefix (pools are sized for the worst case; most slots are empty)
    const n = Math.max(1, this.count);
    for (const a of [this.mesh.instanceMatrix, this.paint, this.lights]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
    this.dirty = false;
  }
  dispose() { this.mesh.removeFromParent(); this.geometry.dispose(); }
}

export class TrafficRenderer {
  constructor(scene, { maxPerType = 64, maxWheels = null, castShadow = true } = {}) {
    this.scene = scene;
    this.maxPerType = maxPerType;
    this.castShadow = castShadow;
    this.types = new Map();
    this.cars = new Map();
    this.nextId = 1;
    const wa = wheelAtlas().texture();
    const wmat = withLampField(createVehicleMaterial(wa, { instanced: true }));
    const wMax = maxWheels ?? maxPerType * 24;
    this.wheelPools = {
      alloy: new InstancePool(scene, buildWheelLow({ rimRatio: 0.64 }), wmat, wMax, { castShadow: false }),
      steel: new InstancePool(scene, buildWheelLow({ rimRatio: 0.6, steel: true }), wmat, Math.ceil(wMax / 3), { castShadow: false }),
    };
    // headlight pools on the road ahead of the nearest cars at night (no real lights: one additive instanced draw)
    const pg = new THREE.PlaneGeometry(6.5, 13); pg.rotateX(-Math.PI / 2);
    this.poolMax = 12;
    this.pools = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), this.poolMax);
    this.pools.setColorAt(0, _c.setRGB(1, 1, 1)); // creates instanceColor (per-pool fade) before the program is compiled
    this.pools.count = 0; this.pools.frustumCulled = false; this.pools.renderOrder = 3; this.pools.name = 'trafficHeadPools';
    scene.add(this.pools);
    this.frame = 0; this._lit = [];
  }

  _type(type) {
    let T = this.types.get(type);
    if (T) return T;
    const A = getTypeAssets(type, 'low');
    const mat = withLampField(createVehicleMaterial(A.texture, { instanced: true }));
    setDecalParams(mat, A.decal, A.atlas);
    T = { A, pool: new InstancePool(this.scene, A.geometry, mat, this.maxPerType, { castShadow: this.castShadow }), spec: VEHICLE_SPECS[type] };
    T.wheelStyle = (A.wheelStyle?.style === 'steel') ? 'steel' : 'alloy';
    this.types.set(type, T);
    return T;
  }

  /** Adds a car; returns an id (or -1 if the per-type pool is full). */
  add(type, color) {
    const T = this._type(type);
    const car = { id: this.nextId++, type, T, slot: -1, wheels: [], m: new THREE.Matrix4(), headOn: -1 };
    car.slot = T.pool.alloc(car);
    if (car.slot < 0) return -1;
    const col = color ?? T.A.design?.bodyColor ?? T.spec.colours[Math.floor(Math.random() * T.spec.colours.length)];
    this.setColor(car, col);
    const wp = this.wheelPools[T.wheelStyle];
    for (let i = 0; i < T.A.wheels.length; i++) {
      const rec = { car, i, pool: wp, slot: -1 };
      rec.slot = wp.alloc(rec);
      if (rec.slot >= 0) car.wheels.push(rec);
    }
    // park far away until the first setTransform
    _m.makeTranslation(0, -1000, 0);
    T.pool.mesh.setMatrixAt(car.slot, _m);
    for (const w of car.wheels) w.pool.mesh.setMatrixAt(w.slot, _m);
    T.pool.dirty = true; wp.dirty = true;
    this.cars.set(car.id, car);
    return car.id;
  }

  setColor(carOrId, color) {
    const car = typeof carOrId === 'number' ? this.cars.get(carOrId) : carOrId;
    if (!car) return;
    _c.set(color);
    const a = car.T.pool.paint.array;
    a[car.slot * 3] = _c.r; a[car.slot * 3 + 1] = _c.g; a[car.slot * 3 + 2] = _c.b;
    car.T.pool.dirty = true;
  }

  remove(id) {
    const car = this.cars.get(id);
    if (!car) return;
    const moved = car.T.pool.free(car.slot);
    if (moved) moved.slot = car.slot;
    for (const w of car.wheels) { const mv = w.pool.free(w.slot); if (mv) mv.slot = w.slot; }
    this.cars.delete(id);
  }

  /**
   * position/quaternion: world transform of the car origin (ground centre between axles).
   * wheelSpin: accumulated wheel rotation in radians (rolling forward = decreasing).
   * steer: front wheel steer angle (radians, + = left). lights: { head, brake, siren, indicatorL, indicatorR, reverse, taxiSign }.
   * tilt: optional body-only rotation in car space (roll / pitch on the suspension, about a point 0.5 m up — roughly
   * the roll centre); the wheels stay on the road.
   */
  setTransform(id, position, quaternion, wheelSpin = 0, steer = 0, lights = null, tilt = null) {
    const car = this.cars.get(id);
    if (!car) return;
    const T = car.T, A = T.A;
    _m.compose(position, quaternion, ONE);
    if (tilt) {
      const e = _l.makeRotationFromQuaternion(tilt).elements, h = 0.5;
      e[12] = -e[4] * h; e[13] = h - e[5] * h; e[14] = -e[6] * h; // rotate about (0, h, 0): t = p - R p
      T.pool.mesh.setMatrixAt(car.slot, _b.multiplyMatrices(_m, _l));
    } else T.pool.mesh.setMatrixAt(car.slot, _m);
    if (lights) {
      packLights(lights, lightArr);
      T.pool.lights.array.set(lightArr, car.slot * 4);
      if (lights.head) { car.m.copy(_m); car.headOn = this.frame; }
    }
    T.pool.dirty = true;
    for (const w of car.wheels) {
      const ws = A.wheels[w.i];
      const r = ws.r ?? A.wheelR, width = ws.w ?? A.wheelW;
      _q.setFromAxisAngle(Y, ws.steer ? steer : 0);
      _q2.setFromAxisAngle(X, wheelSpin);
      _q.multiply(_q2);
      if (ws.x < 0 || ws.left) { _q3.setFromAxisAngle(Y, Math.PI); _q.multiply(_q3); }
      _l.compose(_v.set(ws.x, ws.y, ws.z), _q, _s.set(width, r, r));
      _w.multiplyMatrices(_m, _l);
      w.pool.mesh.setMatrixAt(w.slot, _w);
      w.pool.dirty = true;
    }
  }

  update() {
    vehicleTime.value = performance.now() / 1000;
    for (const T of this.types.values()) T.pool.flush();
    for (const p of Object.values(this.wheelPools)) p.flush();
    this._updatePools();
    this.frame++;
  }

  // the nearest cars with headlights on this frame get a light pool on the road ahead of them, fading out by 110 m
  _updatePools() {
    const cam = globalThis.__game?.camera?.position, L = this._lit; L.length = 0;
    if (cam) for (const car of this.cars.values()) {
      if (car.headOn !== this.frame) continue;
      const e = car.m.elements, d = Math.hypot(e[12] - cam.x, e[14] - cam.z);
      if (d < 110) L.push(d, car);
    }
    const n = Math.min(this.poolMax, L.length / 2);
    if (n < L.length / 2) { const idx = []; for (let i = 0; i < L.length; i += 2) idx.push(i); idx.sort((a, b) => L[a] - L[b]); const S = idx.slice(0, n).flatMap(i => [L[i], L[i + 1]]); L.length = 0; L.push(...S); }
    for (let k = 0; k < n; k++) {
      const d = L[k * 2], car = L[k * 2 + 1];
      _l.makeTranslation(0, 0.13, (car.T.A.headlights?.[0]?.z ?? -2) - 6.5); // roads render ~8 cm above the car origin
      _w.multiplyMatrices(car.m, _l);
      this.pools.setMatrixAt(k, _w);
      const f = 1 - THREE.MathUtils.smoothstep(d, 70, 110);
      this.pools.setColorAt(k, _c.setRGB(f, f, f));
    }
    if (n || this.pools.count) {
      this.pools.count = n;
      this.pools.instanceMatrix.needsUpdate = true; if (this.pools.instanceColor) this.pools.instanceColor.needsUpdate = true;
    }
  }

  get count() { return this.cars.size; }
  /** Physics-facing dims for a type (same as getModelForPhysics). */
  getModelForPhysics(type) { const s = VEHICLE_SPECS[type]; return { length: s.length, width: s.width, height: s.height, wheelBase: s.wheelBase, track: s.track, wheelRadius: s.wheelRadius, mass: s.mass }; }

  dispose() {
    for (const T of this.types.values()) T.pool.dispose();
    for (const p of Object.values(this.wheelPools)) p.dispose();
    this.types.clear(); this.cars.clear();
  }
}
