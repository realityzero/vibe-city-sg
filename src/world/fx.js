// Lightweight particle FX: explosions (fireball + smoke + debris sparks), tyre/engine smoke, nitro flames, scrape sparks,
// boat spray, splashes.
// Particles are camera-facing points sized in WORLD metres (converted with the projection + drawing-buffer height), they fade
// by alpha over their life (not by darkening), and fade out when they drift close to the camera so a chase cam never sits
// inside a smoke cloud.
import * as THREE from 'three';
import { U } from '../gfx/globals.js';

function softTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.6)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

class Pool {
  // lit: smoke/water get dimmer at night (they are lit by the scene); additive fire glows on its own
  constructor(scene, max, additive, { near = [1.2, 4.5], lit = true } = {}) {
    this.max = max; this.n = 0; this.live = 0; this.dirty = true;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.age = new Float32Array(max).fill(1); this.life.fill(0);
    this.size0 = new Float32Array(max); this.grow = new Float32Array(max); this.a0 = new Float32Array(max);
    this.size = new Float32Array(max); this.alpha = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uTex: { value: softTex() }, uPx: { value: 800 }, uMaxPx: { value: 400 }, uNear: { value: new THREE.Vector2(...near) }, uLight: { value: 1 } };
    this.lit = lit;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, vertexColors: true,
      uniforms: this.uniforms,
      vertexShader: `attribute float aSize; attribute float aAlpha; varying vec3 vC; varying float vA; uniform float uPx; uniform float uMaxPx; uniform vec2 uNear;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); float d = -mv.z;
          float px = aSize * uPx / max(d, 0.05);
          // shrink-and-fade instead of filling the screen when a particle is right in front of the lens
          vA = aAlpha * smoothstep(uNear.x, uNear.y, d) * (px > uMaxPx ? uMaxPx / px : 1.0);
          gl_PointSize = min(px, uMaxPx); gl_Position = projectionMatrix * mv; if (vA < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
      fragmentShader: additive ? `uniform sampler2D uTex; varying vec3 vC; varying float vA; void main(){ float a = texture2D(uTex, gl_PointCoord).a * vA; gl_FragColor = vec4(vC * a, a); }`
        : `uniform sampler2D uTex; uniform float uLight; varying vec3 vC; varying float vA; void main(){ float a = texture2D(uTex, gl_PointCoord).a * vA; if (a < 0.004) discard; gl_FragColor = vec4(vC * uLight, a); }`,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 15;
    scene.add(this.points);
  }
  // size: starting diameter in metres; grow: diameter gained per second as a fraction of the start size; alpha: peak opacity
  emit(p, v, color, life, size, grow = 1, alpha = 1) {
    const i = this.n++ % this.max, k = i * 3;
    this.pos[k] = p.x; this.pos[k + 1] = p.y; this.pos[k + 2] = p.z;
    this.vel[k] = v.x; this.vel[k + 1] = v.y; this.vel[k + 2] = v.z;
    this.col[k] = color[0]; this.col[k + 1] = color[1]; this.col[k + 2] = color[2];
    this.life[i] = life; this.age[i] = 0; this.size0[i] = size; this.grow[i] = grow; this.a0[i] = alpha;
    this.live++; this.dirty = true;
  }
  update(dt, grav, drag) {
    if (!this.live && !this.dirty) return;
    const N = Math.min(this.n, this.max), d = Math.exp(-dt * drag);
    let live = 0;
    for (let i = 0; i < N; i++) {
      if (this.age[i] >= this.life[i]) { if (this.alpha[i] !== 0) { this.alpha[i] = 0; this.size[i] = 0; } continue; }
      live++;
      const a = (this.age[i] += dt), k = i * 3, f = Math.min(1, a / this.life[i]);
      this.vel[k] *= d; this.vel[k + 1] = this.vel[k + 1] * d + grav * dt; this.vel[k + 2] *= d;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      // grows quickly at first then slows (puffs spread, they don't balloon forever)
      this.size[i] = this.size0[i] * (1 + this.grow[i] * Math.sqrt(a) * 1.4);
      // quick fade-in, long soft fade-out
      this.alpha[i] = this.a0[i] * Math.min(1, a * 12) * (1 - f) * (1 - f);
    }
    this.live = live; this.dirty = live > 0;
    // nothing alive: stop drawing/uploading, and restart the ring so the next burst uses a short prefix
    this.points.visible = live > 0;
    if (!live) { this.n = 0; return; }
    this.points.geometry.setDrawRange(0, N);
    const at = this.points.geometry.attributes;
    for (const a of [at.position, at.color, at.aSize, at.aAlpha]) { a.clearUpdateRanges(); a.addUpdateRange(0, N * a.itemSize); a.needsUpdate = true; }
  }
}

const _v = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
export class FX {
  constructor(game) {
    this.game = game;
    this.fire = new Pool(game.scene, 1500, true, { near: [0.6, 2.5], lit: false });
    this.smoke = new Pool(game.scene, 1500, false, { near: [1.5, 6] });
    this.water = new Pool(game.scene, 1500, false, { near: [0.8, 3] });
    this.spark = new Pool(game.scene, 240, true, { near: [0.4, 1.5], lit: false }); // (same program as the fire)
    // tyre smoke is pale and catches the headlights and street lamps: dimmed less at night than exhaust smoke
    this.tyre = new Pool(game.scene, 500, false, { near: [1.2, 4.5], lit: false });
    this.pools = [this.fire, this.smoke, this.water, this.spark, this.tyre];
    // tyre marks: ring buffer of dark quads laid on the road while skidding
    this.skidMax = 1400; this.skidN = 0;
    const sg = new THREE.PlaneGeometry(0.26, 1, 1, 1); sg.rotateX(-Math.PI / 2);
    this.skidMat = new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 });
    this.skids = new THREE.InstancedMesh(sg, this.skidMat, this.skidMax); this.skids.count = 0; this.skids.frustumCulled = false; this.skids.renderOrder = 3;
    game.scene.add(this.skids);
    this.lastSkid = new Map();
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._mid = new THREE.Vector3();
    this.flash = new THREE.PointLight(0xffaa55, 0, 60, 2); // single reusable light (count fixed => no shader recompiles)
    game.scene.add(this.flash);
    this.flashT = 0;
  }
  explosion(p) {
    for (let i = 0; i < 90; i++) {
      _v.set(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(4 + Math.random() * 12);
      this.fire.emit(_p.copy(p).add(_up), _v, [6, 2.6 + Math.random(), 0.6], 0.6 + Math.random() * 0.7, 1.6 + Math.random() * 2, 0.6, 1);
    }
    for (let i = 0; i < 50; i++) {
      _v.set(Math.random() - 0.5, Math.random() * 0.6 + 0.4, Math.random() - 0.5).multiplyScalar(5);
      const c = 0.12 + Math.random() * 0.1;
      this.smoke.emit(_p.copy(p).addScaledVector(_up, 1.5), _v, [c, c, c], 3 + Math.random() * 3, 3 + Math.random() * 3, 0.9, 0.85);
    }
    this.flash.position.copy(p).addScaledVector(_up, 3); this.flash.intensity = 4000; this.flashT = 0.6;
    this.game.cameraRig?.shake(1.2);
  }
  // damaged-engine smoke (grey → black when nearly dead), with flames when heavy. scale ~0.5 for bikes
  engineSmoke(p, heavy, scale = 1) {
    _v.set((Math.random() - 0.5) * 0.5, 1.2 + Math.random() * 0.8, (Math.random() - 0.5) * 0.5);
    const c = heavy ? 0.07 : 0.3;
    this.smoke.emit(p, _v, [c, c, c], 1.6 + Math.random() * 0.8, (heavy ? 0.9 : 0.6) * scale, 1.1, heavy ? 0.75 : 0.45);
    if (heavy && Math.random() < 0.6) this.fire.emit(p, _v.multiplyScalar(0.6), [5, 2, 0.4], 0.45, 0.7 * scale, 0.4, 0.9);
  }
  // pale tyre smoke left behind on the road while sliding; vel = vehicle velocity (smoke inherits a little of it)
  tyreSmoke(p, vel, amount, scale = 1) {
    _v.set(vel.x * 0.15 + (Math.random() - 0.5) * 0.6, 0.35 + Math.random() * 0.4, vel.z * 0.15 + (Math.random() - 0.5) * 0.6);
    const c = (0.62 + Math.random() * 0.1) * (1 - U.night.value * 0.5);
    this.tyre.emit(p, _v, [c, c, c * 1.03], 1.2 + Math.random() * 0.8, 0.6 * scale, 1.3, 0.2 + 0.3 * amount);
  }
  // nitro / boost: short blue-orange exhaust flame + a wisp of smoke
  exhaustFlame(p, back, vel, scale = 1) {
    _v.copy(back).multiplyScalar(6 + Math.random() * 4).add(vel);
    this.fire.emit(p, _v, Math.random() < 0.5 ? [0.6, 1.2, 4] : [4, 1.6, 0.4], 0.12 + Math.random() * 0.08, 0.35 * scale, 0.5, 1);
    if (Math.random() < 0.25) { _v.copy(back).multiplyScalar(2).add(vel).multiplyScalar(0.3); _v.y += 0.4; this.smoke.emit(p, _v, [0.5, 0.5, 0.5], 0.8, 0.35 * scale, 1, 0.15); }
  }
  // bodywork scraping a wall or another car: hot sparks thrown back along `vel`, falling as they cool
  sparks(p, vel, n) {
    for (let i = 0; i < n; i++) {
      _v.set(vel.x + (Math.random() - 0.5) * 5, 1 + Math.random() * 3.5, vel.z + (Math.random() - 0.5) * 5);
      const hot = Math.random();
      this.spark.emit(p, _v, [9, 3.2 + hot * 3, 0.6 + hot * 1.2], 0.2 + Math.random() * 0.3, 0.07 + Math.random() * 0.07, 0.1, 1);
    }
  }
  // cooking smoke (hawker grills)
  grillSmoke(p) {
    _v.set((Math.random() - 0.5) * 0.4, 0.9 + Math.random() * 0.5, (Math.random() - 0.5) * 0.4);
    this.smoke.emit(p, _v, [0.7, 0.68, 0.64], 2.4 + Math.random(), 0.7, 1.3, 0.22);
  }
  spray(p, dir, amount) {
    for (let i = 0; i < amount; i++) {
      _v.set(dir.x * 3 + (Math.random() - 0.5) * 3, 2 + Math.random() * 3, dir.z * 3 + (Math.random() - 0.5) * 3);
      this.water.emit(p, _v, [0.85, 0.9, 0.95], 0.8 + Math.random() * 0.5, 0.5 + Math.random() * 0.5, 0.8, 0.5);
    }
  }
  splash(p, big = 1) {
    for (let i = 0; i < 60 * big; i++) {
      _v.set((Math.random() - 0.5) * 6, 4 + Math.random() * 8 * big, (Math.random() - 0.5) * 6);
      this.water.emit(p, _v, [0.9, 0.95, 1], 1 + Math.random(), 0.6 + Math.random() * big, 0.7, 0.6);
    }
  }
  // called per rear wheel while the vehicle slides; joins consecutive points into a continuous mark
  skid(key, p) {
    const last = this.lastSkid.get(key), now = performance.now();
    if (!last) { this.lastSkid.set(key, { p: p.clone(), t: now }); return; }
    const ok = now - last.t <= 120, d = p.distanceTo(last.p);
    if (ok && d < 0.3) return; // keep accumulating until the mark is long enough
    if (ok && d <= 4) {
      const mid = this._mid.copy(p).add(last.p).multiplyScalar(0.5); mid.y = Math.max(mid.y, 0) + 0.07;
      this._m.compose(mid, this._q.setFromAxisAngle(_up, Math.atan2(p.x - last.p.x, p.z - last.p.z)), this._s.set(1, 1, d));
      this.skids.setMatrixAt(this.skidN % this.skidMax, this._m); this.skidN++;
      this.skids.count = Math.min(this.skidN, this.skidMax); this.skids.instanceMatrix.needsUpdate = true;
    }
    last.p.copy(p); last.t = now;
  }

  update(dt) {
    const R = this.game.R, cam = this.game.camera;
    // world-metre point sizes: pixels per metre at 1 m distance = drawing-buffer height * P[1][1] / 2
    const px = (R?.height || innerHeight) * cam.projectionMatrix.elements[5] * 0.5, maxPx = (R?.height || innerHeight) * 0.3;
    const light = 1 - U.night.value * 0.78;
    for (const p of this.pools) { p.uniforms.uPx.value = px; p.uniforms.uMaxPx.value = maxPx; p.uniforms.uLight.value = p.lit ? light : 1; }
    this.fire.update(dt, 2, 2.2);
    this.smoke.update(dt, 0.5, 1.4);
    this.water.update(dt, -9.8, 0.6);
    this.spark.update(dt, -9.8, 0.8);
    this.tyre.update(dt, 0.5, 1.4);
    if (this.flashT > 0) { this.flashT -= dt; this.flash.intensity = Math.max(0, this.flashT / 0.6) * 4000; } else this.flash.intensity = 0;
  }
}
