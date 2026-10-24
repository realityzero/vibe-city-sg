// Fireworks over Marina Bay: CPU-simulated additive point bursts with trails and gravity.
import * as THREE from 'three';

const PALETTE = [0xff3fa4, 0x39f0ff, 0xffd23f, 0x7dff6a, 0xff6a3d, 0xc8a2ff, 0xffffff];

export class Fireworks {
  constructor(scene, max = 9000) {
    this.scene = scene; this.max = max;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 3); this.life = new Float32Array(max); this.base = new Float32Array(max * 3);
    this.n = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const tex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
    this.mat = new THREE.PointsMaterial({ size: 3.2, map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.lights = [];
  }
  burst(center, count = 320) {
    const c = new THREE.Color(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
    const c2 = new THREE.Color(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
    const speed = 18 + Math.random() * 14;
    const ring = Math.random() < 0.3;
    for (let i = 0; i < count; i++) {
      const k = this.n % this.max; this.n++;
      let dx, dy, dz;
      if (ring) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a) * 0.3; dz = Math.sin(a); }
      else { const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u); dx = r * Math.cos(a); dy = u; dz = r * Math.sin(a); }
      const s = speed * (0.85 + Math.random() * 0.3);
      this.pos.set([center.x, center.y, center.z], k * 3);
      this.vel.set([dx * s, dy * s, dz * s], k * 3);
      const cc = Math.random() < 0.5 ? c : c2;
      this.base.set([cc.r * 6, cc.g * 6, cc.b * 6], k * 3);
      this.life[k] = 2.2 + Math.random() * 1.2;
    }
  }
  update(dt) {
    const N = Math.min(this.n, this.max);
    let live = 0;
    for (let i = 0; i < N; i++) {
      if (this.life[i] <= 0) { this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      live++;
      this.life[i] -= dt;
      const d = Math.exp(-dt * 1.6);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - 9.8 * dt * 0.35; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = Math.min(1, this.life[i] / 1.2) * (0.7 + 0.3 * Math.random());
      this.col[i * 3] = this.base[i * 3] * f; this.col[i * 3 + 1] = this.base[i * 3 + 1] * f; this.col[i * 3 + 2] = this.base[i * 3 + 2] * f;
    }
    // idle between shows: no draw, no uploads; restart the ring so the next show uploads a short prefix
    this.points.visible = live > 0;
    if (!live) this.n = 0;
    else {
      this.points.geometry.setDrawRange(0, N);
      for (const a of [this.points.geometry.attributes.position, this.points.geometry.attributes.color]) { a.clearUpdateRanges(); a.addUpdateRange(0, N * 3); a.needsUpdate = true; }
    }
    for (let i = this.lights.length - 1; i >= 0; i--) { const l = this.lights[i]; l.t -= dt; l.L.intensity *= Math.exp(-dt * 5); if (l.t <= 0) { this.scene.remove(l.L); this.lights.splice(i, 1); } }
  }
  dispose() { this.scene.remove(this.points); for (const l of this.lights) this.scene.remove(l.L); this.points.geometry.dispose(); this.mat.dispose(); }
}
