// Hero vehicle models (individually rendered, high detail) + shared per-type asset cache.
import * as THREE from 'three';
import { DESIGNS } from './designs.js';
import { SPECIAL } from './special.js';
import { CRAFT } from './craft.js';
import { assembleCar } from './car.js';
import { VEHICLE_SPECS } from './specs.js';
import { createVehicleMaterial, packLights, vehicleTime, setDecalParams } from './material.js';
import { buildWheelHigh } from './wheels.js';
import { withLampField } from '../../gfx/lampfield.js';
import { PartBuilder, roundedBox, box, M4 } from './geom.js';

const cache = new Map();

/** Geometry + atlas for a type at a LOD (cached, shared by every car of that type). */
const atlases = new Map(); // car type -> Atlas shared by its LODs
export function getTypeAssets(type, lod = 'high', opts = {}) {
  const key = `${type}|${lod}|${opts.rider ?? ''}`;
  if (cache.has(key)) return cache.get(key);
  const spec = VEHICLE_SPECS[type];
  if (!spec) throw new Error('unknown vehicle type ' + type);
  let A;
  if (CRAFT[type]) A = CRAFT[type](lod);
  else if (SPECIAL[type]) A = SPECIAL[type](lod, opts);
  else {
    const design = DESIGNS[type]();
    const car = assembleCar(design, lod, { atlas: atlases.get(type) });
    atlases.set(type, car.atlas);
    const b = design.body;
    A = {
      ...car, design,
      wheels: [
        { x: b.track / 2, y: b.wr, z: -b.wb / 2, steer: true },
        { x: -b.track / 2, y: b.wr, z: -b.wb / 2, steer: true },
        { x: b.track / 2, y: b.wr, z: b.wb / 2, steer: false },
        { x: -b.track / 2, y: b.wr, z: b.wb / 2, steer: false },
      ],
      wheelR: b.wr, wheelW: b.ww,
      wheelStyle: design.wheel ?? {},
      headlights: headlightAnchors(car.P, b),
    };
  }
  A.texture = A.atlas.texture();
  A.spec = spec;
  cache.set(key, A);
  return A;
}

function headlightAnchors(P, b) {
  const t = 0.03, y = P.ys(t) - 0.05, z = P.zF + 0.08;
  return [{ x: b.W / 2 * 0.62, y, z }, { x: -b.W / 2 * 0.62, y, z }];
}

let _poolTex = null;
export function poolTexture() {
  if (_poolTex) return _poolTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,240,210,1)'); gr.addColorStop(0.4, 'rgba(255,230,190,0.45)'); gr.addColorStop(1, 'rgba(255,220,180,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  _poolTex = new THREE.CanvasTexture(c); _poolTex.colorSpace = THREE.SRGBColorSpace;
  return _poolTex;
}

const _blurTex = {};
function blurTexture(blades) {
  if (_blurTex[blades]) return _blurTex[blades];
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0.0)'); gr.addColorStop(0.12, 'rgba(255,255,255,0.25)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.32)');
  gr.addColorStop(0.9, 'rgba(255,255,255,0.5)'); gr.addColorStop(0.97, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 9; i++) { g.strokeStyle = `rgba(0,0,0,${0.15 + 0.1 * (i % 2)})`; g.lineWidth = 2; g.beginPath(); g.arc(128, 128, 30 + i * 11, 0, Math.PI * 2); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (_blurTex[blades] = t);
}

let _beamMat = null;
function beamMaterial() {
  if (_beamMat) return _beamMat;
  _beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: { uColor: { value: new THREE.Color(1.0, 0.9, 0.72) }, uStrength: { value: 0.06 } },
    vertexShader: `varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() { vAlong = uv.y; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uStrength; varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() { float edge = 1.0 - abs(dot(normalize(vN), normalize(vV))); float a = uStrength * pow(1.0 - vAlong, 2.2) * edge * edge * edge * smoothstep(0.0, 0.1, vAlong);
        gl_FragColor = vec4(uColor * a, 1.0); }`,
  });
  return _beamMat;
}

let _searchMat = null;
function searchlightMaterial() {
  if (_searchMat) return _searchMat;
  _searchMat = beamMaterial().clone();
  _searchMat.uniforms = { uColor: { value: new THREE.Color(0.95, 0.97, 1.0) }, uStrength: { value: 0.35 } };
  return _searchMat;
}

function makeBeams(A) {
  // cheap fake headlight cones (soft, fading with length) + ground light pool; visible only with lights on
  const g = new THREE.Group();
  for (const h of A.headlights) {
    const cone = new THREE.CylinderGeometry(0.08, 2.4, 16, 20, 1, true);
    // uv.y: 0 at the lamp, 1 at the far end
    const uv = cone.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    cone.translate(0, -8, 0); cone.rotateX(Math.PI / 2 - 0.07);
    const m = new THREE.Mesh(cone, beamMaterial()); m.position.set(h.x, h.y, h.z); m.renderOrder = 5;
    g.add(m);
  }
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(7, 14), new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.03, (A.headlights[0]?.z ?? -2) - 8);
  g.add(pool);
  g.visible = false;
  return g;
}

/**
 * Creates a detailed, individually animated vehicle.
 * wheels[i].rotation.x = spin (rolling forward is negative: spin -= distance / radius).
 * wheelPivots[i].rotation.y = steer (only front wheels; positive = turn left).
 */
export function createVehicleModel(type, { color, seed = 0, lod = 'high', beams = true, rider } = {}) {
  const A = getTypeAssets(type, lod, { rider });
  const spec = VEHICLE_SPECS[type];
  const mat = withLampField(createVehicleMaterial(A.texture, { instanced: false })); // street lamps light the body at night
  setDecalParams(mat, A.decal, A.atlas);
  const paint = color ?? A.design?.bodyColor ?? spec.colours[Math.abs(seed) % spec.colours.length];
  mat.userData.uPaint.value.set(paint);
  const root = new THREE.Group(); root.name = `vehicle:${type}`;
  const body = new THREE.Mesh(A.geometry, mat);
  body.castShadow = true; body.receiveShadow = true;
  root.add(body);
  let glass = null, glassMat = null;
  if (A.glassGeo) {
    glassMat = createVehicleMaterial(A.texture, { transparent: true });
    glass = new THREE.Mesh(A.glassGeo, glassMat); glass.renderOrder = 2;
    root.add(glass);
  }
  // wheels
  if (!A.wheelGeo && A.wheels.length) {
    const ws = A.wheelStyle;
    A.wheelGeo = buildWheelHigh(A.atlas, { R: A.wheelR, w: A.wheelW, rimRatio: ws.rimRatio ?? 0.66, style: ws.style ?? 'spoke5', rimMat: ws.rimMat ?? 'alloy', caliper: ws.caliper ?? true });
  }
  const wheels = [], wheelPivots = [];
  for (const w of A.wheels) {
    const pivot = new THREE.Group(); pivot.position.set(w.x, w.y, w.z);
    const spin = new THREE.Group();
    const m = new THREE.Mesh(A.wheelGeo.spin, mat); m.castShadow = true;
    const left = w.x < 0 || w.left;
    if (left) m.rotation.y = Math.PI;
    if (w.scale) m.scale.setScalar(w.scale);
    spin.add(m); pivot.add(spin);
    if (A.wheelGeo.fixed && !w.noCaliper) { const f = new THREE.Mesh(A.wheelGeo.fixed, mat); if (left) f.rotation.y = Math.PI; pivot.add(f); }
    root.add(pivot);
    wheels.push(spin); wheelPivots.push(pivot);
  }
  // pop-up headlights
  const popups = [];
  if (A.popups) {
    for (const p of A.popups) {
      const pb = new PartBuilder(A.atlas);
      pb.add(roundedBox(0.36, 0.1, 0.26, 0.015, 2), 'paint', { matrix: M4.t(0, -0.05, 0) });
      pb.add(box(0.3, 0.07, 0.01), 'head', { matrix: M4.t(0, -0.05, -0.131) });
      pb.add(box(0.33, 0.012, 0.012), 'trim', { matrix: M4.t(0, -0.012, -0.132) });
      const g = pb.build();
      const m = new THREE.Mesh(g, mat); m.castShadow = true;
      const grp = new THREE.Group(); grp.position.set(p.x, p.y, p.z); grp.add(m);
      root.add(grp);
      popups.push({ grp, base: p.y, open: 0 });
    }
  }
  const beamsGrp = beams && A.headlights?.length && !spec.kind ? makeBeams(A) : null;
  if (beamsGrp) root.add(beamsGrp);

  // rotors (helicopters / drones): Object3Ds spun by update() from model.rotorSpeed, with a motion-blur disc
  let rotors = null;
  const rotorList = [];
  if (A.rotors) {
    rotors = {};
    const mk = d => {
      const g = new THREE.Group(); g.position.set(...d.pos);
      const blades = new THREE.Mesh(d.geometry, mat); blades.castShadow = true;
      g.add(blades);
      const discMat = new THREE.MeshBasicMaterial({ map: blurTexture(d.blades), transparent: true, opacity: 0, depthWrite: false, forceSinglePass: true, side: THREE.DoubleSide, color: 0x202022 });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(d.radius, 40), discMat);
      if (d.axis === 'y') disc.rotation.x = -Math.PI / 2; else disc.rotation.y = Math.PI / 2;
      disc.renderOrder = 3; disc.visible = false;
      g.add(disc);
      root.add(g);
      rotorList.push({ g, blades, disc, axis: d.axis, ratio: d.ratio ?? 1, dir: d.dir ?? 1 });
      return g;
    };
    if (A.rotors.main) rotors.main = mk(A.rotors.main);
    if (A.rotors.tail) rotors.tail = mk(A.rotors.tail);
    if (A.rotors.props) rotors.props = A.rotors.props.map(mk);
  }
  // police searchlight: Object3D whose local -Z is the beam direction (pitched down/forward)
  let spotlight = null, spotBeam = null, spotlightTarget = null;
  if (A.spotlight) {
    spotlight = new THREE.Group(); spotlight.name = 'spotlight';
    spotlight.position.set(A.spotlight.x, A.spotlight.y, A.spotlight.z);
    spotlight.rotation.x = A.spotlight.pitch;
    spotlightTarget = new THREE.Object3D(); spotlightTarget.position.set(0, 0, -20); spotlight.add(spotlightTarget);
    const cone = new THREE.CylinderGeometry(0.08, 3.2, 30, 20, 1, true);
    const uv = cone.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    cone.translate(0, -15, 0); cone.rotateX(Math.PI / 2);
    spotBeam = new THREE.Mesh(cone, searchlightMaterial()); spotBeam.renderOrder = 5; spotBeam.visible = false;
    spotlight.add(spotBeam);
    root.add(spotlight);
  }
  // wake emitter at the stern (boats)
  let wake = null;
  if (A.wake) { wake = new THREE.Object3D(); wake.name = 'wake'; wake.position.set(A.wake.x, A.wake.y, A.wake.z); root.add(wake); }

  const lights = { head: false, brake: false, reverse: false, indicatorL: false, indicatorR: false, siren: false, taxiSign: 'free' };
  const arr = [0, 0, 0, 0];
  const model = {
    type, kind: spec.kind ?? 'car', root, body, glass, wheels, wheelPivots, spec, lod, rotors, spotlight, spotlightTarget, wake,
    /** rad/s for main rotor / props (tail rotor spins ratio x faster); update() applies it */
    rotorSpeed: 0,
    dims: { length: spec.length, width: spec.width, height: spec.height, wheelBase: spec.wheelBase, track: spec.track, wheelRadius: spec.wheelRadius, wheelY: spec.wheelRadius, draft: spec.draft ?? 0, rotorDiameter: spec.rotorDiameter ?? 0 },
    setLights(l) {
      Object.assign(lights, l);
      packLights(lights, arr);
      mat.userData.uLights.value.set(arr[0], arr[1], arr[2], arr[3]);
      if (glassMat) glassMat.userData.uLights.value.copy(mat.userData.uLights.value);
      if (beamsGrp) beamsGrp.visible = !!lights.head;
      if (spotBeam) spotBeam.visible = !!(lights.spot ?? lights.siren);
    },
    /** Spin all wheels by distance travelled (m) and steer the front ones (rad). */
    setWheelState(distance, steer = 0) {
      for (let i = 0; i < wheels.length; i++) {
        const r = A.wheels[i].r ?? A.wheelR;
        wheels[i].rotation.x -= distance / r;
        if (A.wheels[i].steer) wheelPivots[i].rotation.y = steer;
      }
    },
    update(dt) {
      vehicleTime.value = performance.now() / 1000;
      for (const p of popups) {
        const target = lights.head ? 1 : 0;
        p.open += Math.sign(target - p.open) * Math.min(Math.abs(target - p.open), dt * 2.5);
        const e = p.open * p.open * (3 - 2 * p.open);
        p.grp.position.y = p.base + e * 0.1;
        p.grp.rotation.x = e * 0.12;
      }
      for (const r of rotorList) {
        const w = this.rotorSpeed * r.ratio * r.dir * dt;
        if (r.axis === 'y') r.g.rotation.y += w; else r.g.rotation.x += w;
        const sp = Math.abs(this.rotorSpeed * r.ratio);
        const blur = Math.min(1, Math.max(0, (sp - 8) / 20));
        r.disc.visible = blur > 0.01;
        r.disc.material.opacity = blur * 0.55;
        r.blades.visible = blur < 0.85;
      }
    },
    setColor(c) { mat.userData.uPaint.value.set(c); },
    get color() { return mat.userData.uPaint.value.getHex(); },
    dispose() { mat.dispose(); glassMat?.dispose(); for (const r of rotorList) { r.disc.geometry.dispose(); r.disc.material.dispose(); } spotBeam?.geometry.dispose(); beamsGrp?.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); root.removeFromParent(); },
  };
  model.setLights({});
  return model;
}

/** Physics-facing dimensions for a type. */
export function getModelForPhysics(type) {
  const s = VEHICLE_SPECS[type];
  const A = getTypeAssets(type, 'low');
  const bb = A.geometry.boundingBox;
  return {
    type, mass: s.mass, length: s.length, width: s.width, height: s.height,
    wheelBase: s.wheelBase, track: s.track, wheelRadius: s.wheelRadius, wheelWidth: s.wheelWidth,
    chassis: { min: bb.min.clone(), max: bb.max.clone() },
    wheels: A.wheels.map(w => ({ x: w.x, y: w.y, z: w.z, r: w.r ?? A.wheelR, steer: !!w.steer })),
    seats: s.seats, maxSpeed: s.maxSpeed, enginePower: s.enginePower, brake: s.brake, steerMax: s.steerMax, grip: s.grip,
    kind: s.kind ?? 'car', draft: s.draft, turnRate: s.turnRate, liftPower: s.liftPower, maxClimb: s.maxClimb, yawRate: s.yawRate, rotorDiameter: s.rotorDiameter,
    wake: A.wake ?? null,
  };
}
