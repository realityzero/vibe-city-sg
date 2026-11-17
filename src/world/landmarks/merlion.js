// The Merlion (8.6 m): lion head with a curly mane on a scaled fish body rising from sculpted waves,
// spouting a water jet into Marina Bay. Plus the Merlion cub behind it.
import { THREE, U, Bucket, canvasTexture, rng, lerp, smooth, circlePoly, frameFromAngle, uplitMaterial } from './common.js';
import { WATER_LEVEL } from '../../core/constants.js';

function scaleTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#e9e5dc'; ctx.fillRect(0, 0, w, h);
    const rows = 8, cols = 8, rw = w / cols, rh = h / rows;
    for (let r = -1; r <= rows; r++) for (let c = -1; c <= cols; c++) {
      const x = c * rw + (r % 2 ? rw / 2 : 0), y = r * rh;
      const g = ctx.createRadialGradient(x + rw / 2, y + rh * 0.2, 2, x + rw / 2, y + rh * 0.3, rw * 0.75);
      g.addColorStop(0, '#f1eee7'); g.addColorStop(0.75, '#ddd8cd'); g.addColorStop(1, '#b9b2a4');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(x + rw / 2, y + rh * 0.35, rw * 0.56, rh * 0.85, 0, 0, Math.PI); ctx.fill();
      ctx.strokeStyle = 'rgba(120,110,95,0.55)'; ctx.lineWidth = 2; ctx.stroke();
    }
  });
}

/** Builds a merlion in local space (facing +x, base at y=0). Returns {bucket, mouth: Vector3, height} */
function merlionGeometry(B, mats, seed = 1) {
  const R = rng(seed);
  const { body, stone, dark, base } = mats;
  // --- wave base
  const wave = new THREE.CylinderGeometry(2.6, 3.2, 1.6, 28, 4);
  const wp = wave.attributes.position;
  for (let i = 0; i < wp.count; i++) {
    const x = wp.getX(i), y = wp.getY(i), z = wp.getZ(i); const a = Math.atan2(z, x);
    const k = 1 + 0.12 * Math.sin(a * 5 + y * 2) + 0.06 * Math.sin(a * 13);
    wp.setXYZ(i, x * k, y + (y > 0.7 ? 0.25 * Math.sin(a * 6) : 0), z * k);
  }
  wave.computeVertexNormals(); wave.translate(0, 0.8, 0);
  B.add(stone, wave);
  // --- fish body: tube along a spine from the waves up to the neck
  const spine = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.4, 1.0, 0), new THREE.Vector3(-0.2, 2.6, 0), new THREE.Vector3(0.05, 4.2, 0), new THREE.Vector3(0.2, 5.4, 0), new THREE.Vector3(0.25, 6.1, 0),
  ]);
  const rad = t => lerp(1.55, 1.05, smooth(t)) * (1 + 0.08 * Math.sin(t * Math.PI));
  const bodyGeo = varTube(spine, rad, 40, 24);
  B.add(body, bodyGeo);
  // tail: rises behind and curls with a fin
  const tail = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.9, 1.3, 0), new THREE.Vector3(-2.0, 1.7, 0.2), new THREE.Vector3(-2.8, 2.6, 0.1), new THREE.Vector3(-3.0, 3.8, -0.1), new THREE.Vector3(-2.6, 4.6, 0),
  ]);
  B.add(body, varTube(tail, t => lerp(0.95, 0.28, t), 30, 16));
  // tail fin
  const fin = new THREE.Shape(); fin.moveTo(0, 0); fin.quadraticCurveTo(0.9, 0.6, 1.4, 1.5); fin.quadraticCurveTo(0.5, 1.1, 0, 0.9); fin.quadraticCurveTo(-0.5, 1.1, -1.4, 1.5); fin.quadraticCurveTo(-0.9, 0.6, 0, 0);
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.18, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2, curveSegments: 10 });
  finGeo.translate(0, 0, -0.09); finGeo.rotateY(Math.PI / 2); finGeo.rotateZ(0.35); finGeo.translate(-2.55, 4.5, 0);
  B.add(stone, finGeo);
  // pectoral fins (side)
  for (const s of [-1, 1]) {
    const pf = new THREE.Shape(); pf.moveTo(0, 0); pf.quadraticCurveTo(0.8, -0.4, 1.4, -1.3); pf.quadraticCurveTo(0.4, -1.0, 0, -0.6);
    const g = new THREE.ExtrudeGeometry(pf, { depth: 0.12, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 1 });
    g.rotateX(Math.PI / 2 * s * 0.7); g.translate(0.5, 3.9, s * 1.15);
    B.add(stone, g);
  }
  // --- head
  const H = new THREE.Vector3(0.55, 7.2, 0);
  const skull = new THREE.SphereGeometry(1.2, 28, 20); skull.scale(1.05, 1.0, 0.95); skull.translate(H.x - 0.1, H.y + 0.15, H.z);
  B.add(stone, skull);
  const muzzle = new THREE.SphereGeometry(0.85, 24, 16); muzzle.scale(1.05, 0.78, 1.05); muzzle.translate(H.x + 0.95, H.y - 0.2, 0);
  B.add(stone, muzzle);
  const nose = new THREE.SphereGeometry(0.3, 16, 12); nose.scale(0.9, 0.65, 1.25); nose.translate(H.x + 1.7, H.y + 0.02, 0);
  B.add(stone, nose);
  // brow ridges
  for (const s of [-1, 1]) {
    const br = new THREE.SphereGeometry(0.42, 16, 10); br.scale(1.2, 0.5, 0.9); br.translate(H.x + 0.85, H.y + 0.5, s * 0.42); B.add(stone, br);
    const eye = new THREE.SphereGeometry(0.13, 12, 8); eye.scale(0.6, 0.8, 1); eye.translate(H.x + 1.2, H.y + 0.26, s * 0.44); B.add(dark, eye);
    
  }
  // open mouth: dark cavity + lower jaw
  const cav = new THREE.SphereGeometry(0.4, 16, 10); cav.scale(1.0, 0.5, 1.1); cav.translate(H.x + 1.5, H.y - 0.62, 0); B.add(dark, cav);
  const jaw = new THREE.SphereGeometry(0.62, 18, 12); jaw.scale(1.15, 0.45, 0.95); jaw.translate(H.x + 1.0, H.y - 0.98, 0); B.add(stone, jaw);
  // --- mane: overlapping flame-like locks in rows framing the face, sweeping back and down over the shoulders
  const lock = new THREE.SphereGeometry(1, 10, 8); lock.scale(0.3, 0.8, 0.19); lock.translate(0, 0.6, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const center = new THREE.Vector3(H.x - 0.2, H.y + 0.05, 0);
  for (let row = 0; row < 4; row++) {
    const ringR = 0.98 + row * 0.15;            // distance from head centre
    const back = -0.2 - row * 0.3;             // rows step backwards
    const count = 15 + row * 3;
    for (let i = 0; i < count; i++) {
      // angle around the face (in the y-z plane), skipping the chin
      const a = -Math.PI * 0.62 + (i / (count - 1)) * Math.PI * 1.24 + (row % 2) * 0.08;
      const dy = Math.cos(a), dz = Math.sin(a);
      const d = new THREE.Vector3(-0.35 - row * 0.2, dy, dz).normalize();
      const p = center.clone().add(new THREE.Vector3(back, dy * ringR, dz * ringR));
      const g = lock.clone();
      // lock points outward from the face and is swept back
      const dir = new THREE.Vector3(-1.0 - row * 0.25, dy * 0.85, dz * 0.85).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(up, dir);
      const twist = new THREE.Quaternion().setFromAxisAngle(dir, (R() - 0.5) * 0.6 + a * 0.3);
      q.premultiply(twist);
      const sc = (0.75 + R() * 0.3) * (1 + row * 0.1);
      g.applyMatrix4(new THREE.Matrix4().compose(p, q, new THREE.Vector3(sc, sc * (1 + (dy < -0.2 ? 0.5 : 0)), sc)));
      B.add(stone, g);
    }
  }
  // mane cape down the back of the neck
  for (let i = 0; i < 22; i++) {
    const a = Math.PI * 0.5 + (i / 21 - 0.5) * Math.PI * 1.1;
    const p = new THREE.Vector3(Math.cos(a) * 1.2 - 0.25, 6.0 + (i % 3) * 0.3, Math.sin(a) * 1.2);
    const g = lock.clone();
    const q = new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(Math.cos(a) * 0.7, -1, Math.sin(a) * 0.7).normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1.25, 1.5, 1.25)));
    B.add(stone, g);
  }
  return { mouth: new THREE.Vector3(H.x + 1.75, H.y - 0.62, 0), height: 8.6 };
}

/** Tube with variable radius r(t). */
function varTube(curve, rad, segs, radial) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs; const P = curve.getPointAt(t); const N = frames.normals[i], Bn = frames.binormals[i]; const r = rad(t);
    for (let j = 0; j <= radial; j++) {
      const v = j / radial * Math.PI * 2; const c = Math.cos(v), s = Math.sin(v);
      const n = new THREE.Vector3().addScaledVector(N, c).addScaledVector(Bn, s);
      pos.push(P.x + n.x * r, P.y + n.y * r, P.z + n.z * r); nor.push(n.x, n.y, n.z); uv.push(j / radial * 3, t * 4);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** GPU particle water jet following a parabola from `mouth` with initial velocity `v0` (world space). */
function waterJet(mouth, v0, { count = 700, size = 0.9, spread = 0.18, water = WATER_LEVEL } = {}) {
  const g = new THREE.BufferGeometry();
  const seeds = new Float32Array(count * 4);
  const R = rng(3);
  for (let i = 0; i < count; i++) { seeds[i * 4] = R(); seeds[i * 4 + 1] = R() * 2 - 1; seeds[i * 4 + 2] = R() * 2 - 1; seeds[i * 4 + 3] = R(); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 4));
  const tLand = (v0.y + Math.sqrt(v0.y * v0.y + 2 * 9.81 * (mouth.y - water))) / 9.81;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: U.time, uMouth: { value: mouth.clone() }, uV0: { value: v0.clone() }, uLand: { value: tLand }, uSize: { value: size }, uSpread: { value: spread }, uNight: U.night, uWater: { value: water } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec4 seed; uniform float uTime, uLand, uSize, uSpread, uWater; uniform vec3 uMouth, uV0;
      varying float vA;
      void main() {
        float life = uLand * 1.25;
        float t = fract(uTime / life + seed.x) * life;
        vec3 jitter = vec3(seed.y, seed.z * 0.6, seed.w * 2.0 - 1.0) * uSpread;
        vec3 v = uV0 * (0.96 + 0.08 * seed.w) + jitter * 2.0;
        vec3 p = uMouth + v * t + vec3(0.0, -4.905, 0.0) * t * t;
        vA = 1.0;
        if (p.y < uWater + 0.05) {
          // splash: bounce up a little and fade
          float tb = t - uLand; p.y = uWater + max(0.0, 1.6 * tb - 4.9 * tb * tb) * (0.6 + seed.w); p.xz += vec2(seed.y, seed.z) * tb * 1.5;
          vA = max(0.0, 1.0 - tb * 3.0);
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * (1.0 + t * 0.8) * 300.0 / -mv.z;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <logdepthbuf_pars_fragment>
      varying float vA; uniform float uNight;
      void main() {
        #include <logdepthbuf_fragment>
        vec2 c = gl_PointCoord - 0.5; float d = dot(c, c);
        if (d > 0.25) discard;
        float a = (1.0 - d * 4.0) * 0.55 * vA;
        // unlit spray: at night it only catches the floodlights (dimmer, slightly warm), not daylight
        vec3 col = mix(vec3(0.93, 0.96, 1.0), vec3(0.36, 0.38, 0.4), uNight);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false;
  // continuous core stream
  const curvePts = []; for (let i = 0; i <= 24; i++) { const t = i / 24 * tLand; curvePts.push(new THREE.Vector3(mouth.x + v0.x * t, mouth.y + v0.y * t - 4.905 * t * t, mouth.z + v0.z * t)); }
  const curve = new THREE.CatmullRomCurve3(curvePts);
  const tube = varTube(curve, t => lerp(0.13, 0.42, t) * (size / 0.9), 48, 10);
  const tubeMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: U.time, uNight: U.night },
    vertexShader: '#include <common>\n#include <logdepthbuf_pars_vertex>\nvarying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);\n#include <logdepthbuf_vertex>\n}',
    fragmentShader: /* glsl */`#include <logdepthbuf_pars_fragment>
      varying vec2 vUv; uniform float uTime, uNight;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      void main(){
        #include <logdepthbuf_fragment>
        float n = h(floor(vec2(vUv.x * 6.0, vUv.y * 40.0 - uTime * 30.0)));
        float a = (0.35 + 0.35 * n) * (1.0 - vUv.y * 0.35);
        vec3 col = mix(vec3(0.95,0.97,1.0), vec3(0.4,0.42,0.44), uNight);
        gl_FragColor = vec4(col, a); }`,
  });
  const stream = new THREE.Mesh(tube, tubeMat); stream.frustumCulled = false;
  const grp = new THREE.Group(); grp.add(pts, stream);
  return grp;
}

function graniteTexture() {
  const t = canvasTexture(256, 256, (ctx, w, h) => {
    const r = rng(41), n = 4, sz = w / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = 200 + Math.floor(r() * 22), tint = Math.floor(r() * 8);
      ctx.fillStyle = `rgb(${v},${v - 3 - tint},${v - 10 - tint})`; ctx.fillRect(x * sz, y * sz, sz, sz);
      for (let k = 0; k < 90; k++) { const g = 150 + Math.floor(r() * 90); ctx.fillStyle = `rgba(${g},${g - 6},${g - 12},0.35)`; ctx.fillRect(x * sz + r() * sz, y * sz + r() * sz, 1.5, 1.5); }
    }
    ctx.strokeStyle = 'rgba(96,90,82,0.85)'; ctx.lineWidth = 2;
    for (let i = 0; i <= n; i++) { ctx.beginPath(); ctx.moveTo(i * sz, 0); ctx.lineTo(i * sz, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i * sz); ctx.lineTo(w, i * sz); ctx.stroke(); }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Merlion Park is an open granite promontory (the statue at its tip, the viewing pier in front), not a lawn: paving
// over the land of the site, with the grove kept back on the Fullerton side (the clearing below keeps trees off it).
const PLAZA = { x: 604, z: 18, r: 40, west: 571 };
const onPlaza = (x, z) => x >= PLAZA.west && (x - PLAZA.x) ** 2 + (z - PLAZA.z) ** 2 < PLAZA.r * PLAZA.r;
function plazaGeometry(isWater) {
  const pos = [], uv = [], idx = [], y = 0.07, cell = 1, tile = 2.4;
  const quad = (x0, x1, z0, z1) => {
    const b = pos.length / 3;
    pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
    uv.push(x0 / tile, z0 / tile, x1 / tile, z0 / tile, x1 / tile, z1 / tile, x0 / tile, z1 / tile);
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  };
  for (let z = PLAZA.z - PLAZA.r; z < PLAZA.z + PLAZA.r; z += cell) {
    let run = null; // runs of paved cells along x become one quad
    for (let x = PLAZA.west; x <= PLAZA.x + PLAZA.r; x += cell) {
      // stay ~1.2 m inside the land: the ground draws a smoothed waterline and its quay wall, the paving ends behind it
      const cx = x + cell / 2, cz = z + cell / 2, e = 1.2;
      const paved = x < PLAZA.x + PLAZA.r && onPlaza(cx, cz) && !isWater(cx, cz) && !isWater(cx + e, cz) && !isWater(cx - e, cz) && !isWater(cx, cz + e) && !isWater(cx, cz - e);
      if (paved && run === null) run = x;
      else if (!paved && run !== null) { quad(run, x, z, z + cell); run = null; }
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, i) => i % 3 === 1 ? 1 : 0), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function buildMerlion(city, quality, renderer, env = {}) {
  // floodlit warm-white from the deck at night (strongest on the fish body, softer up on the head)
  const body = uplitMaterial(0xfff0dc, 0.12, { y0: 0, y1: 11, floor: 0.3, base: 0xffffff, map: scaleTexture(), rough: 0.62 });
  const stone = uplitMaterial(0xfff0dc, 0.07, { y0: 0, y1: 4, floor: 0.2, base: 0xe6e1d6, rough: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c2a27, roughness: 0.9 });
  const plinth = new THREE.MeshStandardMaterial({ color: 0xb8b0a2, roughness: 0.85 });
  const group = new THREE.Group(); group.name = 'Merlion';
  const pois = [], colliders = [];
  const statues = [
    // the hero statue a touch over life size (8.6 m -> ~10.8 m): read from across the bay against the CBD behind it
    { x: 612.5, z: 22.5, yaw: -0.12, scale: 1.25, name: 'Merlion', id: 'merlion', water: WATER_LEVEL, hero: true },
    { x: 590, z: 22.4, yaw: -0.05, scale: 0.26, name: 'Merlion Cub', id: 'merlion_cub', water: 0.6 },
  ];
  for (const s of statues) {
    const B = new Bucket();
    const { mouth } = merlionGeometry(B, { body, stone, dark, base: plinth }, 7);
    // platform the statue stands on (main merlion: semicircular viewing deck at the water's edge)
    if (s.hero) {
      const deck = new THREE.CylinderGeometry(4.2, 4.4, 1.8, 32); deck.translate(0, -0.9 + 0.02, 0); B.add(plinth, deck);
    } else {
      const ped = new THREE.CylinderGeometry(2.6, 2.8, 2.2, 20); ped.translate(0, -1.1, 0); B.add(plinth, ped);
      const basin = new THREE.TorusGeometry(5.5, 0.35, 6, 32); basin.rotateX(Math.PI / 2); basin.translate(6, -2.4, 0); B.add(plinth, basin);
    }
    const F = frameFromAngle(s.x, s.z, s.yaw, s.hero ? 0.02 : 0.6);
    F.multiply(new THREE.Matrix4().makeScale(s.scale, s.scale, s.scale));
    const meshes = B.build({ name: s.id });
    for (const m of meshes) { m.geometry.applyMatrix4(F); m.geometry.computeBoundingSphere(); group.add(m); }
    // jet in world space
    const wMouth = mouth.clone().applyMatrix4(F);
    const dir = new THREE.Vector3(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    const v0 = dir.multiplyScalar(7.2 * Math.sqrt(s.scale)).add(new THREE.Vector3(0, 1.6 * Math.sqrt(s.scale), 0));
    group.add(waterJet(wMouth, v0, { count: s.hero ? 700 : 160, size: s.hero ? 0.55 : 0.35, spread: s.hero ? 0.09 : 0.06 /* a slim arc, as the real one */, water: s.hero ? WATER_LEVEL : 0.1 }));
    pois.push({ id: s.id, name: s.name, x: s.x, y: 0, z: s.z });
    colliders.push({ type: 'cylinder', center: [s.x, 4.3 * s.scale, s.z], radius: 2.5 * s.scale, halfHeight: 4.3 * s.scale });
  }
  const plaza = env.isWater && plazaGeometry(env.isWater);
  if (plaza) {
    const m = new THREE.Mesh(plaza, new THREE.MeshStandardMaterial({ map: graniteTexture(), roughness: 0.78, metalness: 0 }));
    m.name = 'merlion_plaza'; m.receiveShadow = true; group.add(m);
  }
  return {
    group, colliders, pois,
    clearings: [{ x: PLAZA.x, z: PLAZA.z, r: PLAZA.r, inside: (x, z) => x >= PLAZA.west - 2 }],
    exclusions: [circlePoly(612.5, 22.5, 5, 12)],
    reflective: group.children.filter(c => c.isMesh),
  };
}
