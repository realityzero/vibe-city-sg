// Tropical weather: afternoon thunderstorms, GPU rain streaks around the camera, lightning + thunder. The 4 pm storm:
// most afternoons between 15:30 and 16:30 (in free roam) the sky opens in seconds rather than a minute, pours for a
// minute or so and clears as fast — event 'downpour', which sends people running for the five-foot ways and floods a
// kerb (world/streetlife.js).
import * as THREE from 'three';
import { U } from '../gfx/globals.js';

export class Weather {
  constructor(game) {
    this.game = game;
    this.rain = 0;
    this.target = 0;
    this.forced = null;
    this.nextChange = 90;
    this.flash = 0;
    this.thunderT = 0;
    this.burst = -99;         // s of downpour left (counts on below 0: the quick clearing after it)
    this.burstDone = false;   // this afternoon's has been (or was skipped)
    // rain streaks: instanced quads, positions wrapped in a box around the camera in the vertex shader
    const N = 16000;
    const base = new THREE.PlaneGeometry(0.008, 0.7);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.uv = base.attributes.uv;
    const offs = new Float32Array(N * 4);
    for (let i = 0; i < N; i++) { offs[i * 4] = Math.random(); offs[i * 4 + 1] = Math.random(); offs[i * 4 + 2] = Math.random(); offs[i * 4 + 3] = 0.7 + Math.random() * 0.6; }
    g.setAttribute('aOff', new THREE.InstancedBufferAttribute(offs, 4));
    g.instanceCount = N;
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uTime: U.time, uCam: { value: new THREE.Vector3() }, uRain: { value: 0 }, uWind: { value: new THREE.Vector2(1.5, 0.6) }, uNight: U.night, uFlash: { value: 0 } },
      vertexShader: /* glsl */`
        attribute vec4 aOff; uniform float uTime; uniform vec3 uCam; uniform float uRain; uniform vec2 uWind;
        varying float vA; varying vec2 vUv;
        void main() {
          vec3 box = vec3(44.0, 30.0, 44.0);
          float fall = 15.0 * aOff.w;
          vec3 p = vec3(aOff.x, aOff.y, aOff.z) * box;
          p.y -= uTime * fall; p.xz += uWind * uTime * 0.6;
          p = mod(p - (uCam - box * 0.5), box) + (uCam - box * 0.5);
          // billboard around Y, stretched along fall direction
          vec3 toCam = normalize(vec3(uCam.x - p.x, 0.0, uCam.z - p.z));
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
          vec3 dir = normalize(vec3(uWind.x * 0.04, -1.0, uWind.y * 0.04));
          vec3 wp = p + right * position.x + dir * -position.y * (0.6 + aOff.w * 0.5);
          vA = step(aOff.x * 0.999, uRain) * (1.0 - smoothstep(10.0, 22.0, distance(wp, uCam))) * smoothstep(1.5, 4.0, distance(wp, uCam));
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform float uNight; uniform float uFlash; varying float vA; varying vec2 vUv;
        void main() {
          float a = vA * (1.0 - abs(vUv.x - 0.5) * 2.0) * smoothstep(0.0, 0.4, vUv.y) * 0.18;
          vec3 c = mix(vec3(0.75, 0.8, 0.85), vec3(0.35, 0.4, 0.5), uNight) + uFlash;
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    game.scene.add(this.mesh);
  }

  force(v) { this.forced = v; this.rain = v; this.target = v; }

  /** the sky opens now, for `seconds` */
  downpour(seconds = 50 + Math.random() * 30) {
    this.burst = seconds; this.target = 1; this.nextChange = seconds + 150 + Math.random() * 200;
    setTimeout(() => this.game.audio?.sfx?.('thunder', { volume: 0.9 }), 700); // (it opens with a crack)
    this.game.events.emit('downpour');
  }

  update(dt) {
    const game = this.game;
    const hour = game.sky.time;
    if (hour < 12) this.burstDone = false;
    if (!this.burstDone && hour >= 15.5 && hour < 16.5 && this.forced == null && !game.missions?.weatherLocked && !game.missions?.active && this.rain < 0.1) {
      this.burstDone = true;
      if (Math.random() < 0.7) this.downpour();
    }
    if (this.burst > -12) { this.burst -= dt; if (this.burst <= 0 && this.target > 0 && this.forced == null) this.target = 0; }
    if (this.forced == null && !game.missions?.weatherLocked && this.burst <= -12) {
      this.nextChange -= dt;
      if (this.nextChange <= 0) {
        // Singapore: afternoon/evening thunderstorms are common
        const p = hour > 13 && hour < 19 ? 0.4 : 0.15;
        this.target = Math.random() < p ? 0.5 + Math.random() * 0.5 : 0;
        this.nextChange = this.target > 0 ? 60 + Math.random() * 90 : 150 + Math.random() * 200;
      }
    } else if (this.forced != null) this.target = this.forced;
    if (game.missions?.weatherLocked) this.target = game.missions.weatherTarget ?? 0;
    this.rain += (this.target - this.rain) * Math.min(1, dt * (this.burst > -12 ? 0.45 : 0.08));
    if (Math.abs(this.target - this.rain) < 0.002) this.rain = this.target;
    this.mat.uniforms.uRain.value = this.rain;
    this.mat.uniforms.uCam.value.copy(game.camera.position);
    this.mesh.visible = this.rain > 0.02;
    // lightning: a strike is 2-4 return strokes ~60-120 ms apart; thunder arrives at 343 m/s from 0.4-6 km away
    if (this.rain > 0.6 && !this.strike && Math.random() < dt * 0.06 * (this.rain - 0.5)) {
      const dist = 400 + Math.random() * 5600, strokes = 2 + Math.floor(Math.random() * 3);
      this.strike = { t: 0, times: Array.from({ length: strokes }, (_, i) => i * (0.06 + Math.random() * 0.07)), az: Math.random() * Math.PI * 2, seed: Math.random() * 100, dist };
      setTimeout(() => game.audio?.sfx?.('thunder', { volume: Math.min(1, 0.35 + 1800 / dist) }), dist / 343 * 1000);
    }
    let f = 0;
    if (this.strike) {
      const S = this.strike; S.t += dt;
      for (const t0 of S.times) { const a = S.t - t0; if (a >= 0) f = Math.max(f, Math.exp(-a * 22) * (a < 0.03 ? 1 : 0.85)); }
      f += Math.exp(-S.t * 6) * 0.25; // afterglow in the clouds
      f *= Math.min(1, 2500 / S.dist + 0.25);
      if (S.t > S.times[S.times.length - 1] + 0.8) this.strike = null;
    }
    this.flash = f;
    this.mat.uniforms.uFlash.value = f;
    game.sky.setLightning(f, this.strike);
  }
}
