// Night light spilling from shopfronts and their signboards onto the five-foot ways and pavements: soft coloured
// pools (mostly warm white and amber, some neon red, pink, cyan, green, violet) along every street-facing shophouse
// and low-rise front. Additive ground decals, not lights (the light count is in every program key): one instanced
// draw holding the pools near the camera, shown only after dusk.
import * as THREE from 'three';
import { U } from '../gfx/globals.js';
import { nextTask } from '../core/nextTask.js';

const PALETTE = [[1, 0.72, 0.42], [1, 0.72, 0.42], [1, 0.8, 0.58], [1, 0.8, 0.58], [1, 0.5, 0.2], [1, 0.22, 0.16], [1, 0.25, 0.6], [0.3, 0.72, 1], [0.4, 1, 0.55], [0.7, 0.42, 1]];
const STYLE_SHOPHOUSE = 4, STYLE_LOWRISE = 5;
const BAY = 5.5, CELL = 64, RADIUS = 140, CAP = 900, Y = 0.14; // (Y: above roads, footways and five-foot-way floors)

function hash(x, z) { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); }

export class NightGlow {
  constructor(game) {
    this.game = game;
    this.n = 0; this.xz = new Float32Array(4096); this.rec = new Float32Array(4096 * 2 * 4); // per pool: x, z, yaw, len | r, g, b, -
    this.grid = new Map();
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uNight: U.night, uFar: { value: RADIUS } },
      vertexShader: /* glsl */`
        uniform float uFar; varying vec2 vQ; varying vec3 vCol;
        void main() {
          vQ = uv * 2.0 - 1.0; vCol = instanceColor;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vCol *= 1.0 - smoothstep(uFar * 0.65, uFar, distance(wp.xyz, cameraPosition)); // pool radius: fade, don't pop
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      // vQ.y = 1 just inside the front: brightest under the signboard, falling off across the pavement
      fragmentShader: /* glsl */`
        uniform float uNight; varying vec2 vQ; varying vec3 vCol;
        void main() {
          float r = length(vec2(vQ.x, (0.55 - vQ.y) / 1.55));
          float f = 1.0 - smoothstep(0.0, 1.0, r); f *= f;
          gl_FragColor = vec4(vCol * f * smoothstep(0.25, 0.8, uNight) * 0.22, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.name = 'nightGlow';
    this.mesh.renderOrder = 1.5; // after the water (1): lies on the quays, never under the bay
    game.scene.add(this.mesh);
    this.at = new THREE.Vector2(1e9, 0);
    this.ready = this._init();
  }

  // clearance (m) from a point to the nearest kerb of a road a shop would face (back lanes count as further away)
  _roadGrid() {
    const RG = 24, grid = new Map(), seg = [];
    for (const r of this.game.city.data.roads) {
      if (r.b || r.c > 8) continue;
      for (let i = 0; i + 3 < r.p.length; i += 2) {
        const id = seg.length; seg.push(r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3], r.w / 2 - (r.c === 7 ? 7 : 0));
        for (let gx = Math.floor(Math.min(r.p[i], r.p[i + 2]) / RG); gx <= Math.floor(Math.max(r.p[i], r.p[i + 2]) / RG); gx++)
          for (let gz = Math.floor(Math.min(r.p[i + 1], r.p[i + 3]) / RG); gz <= Math.floor(Math.max(r.p[i + 1], r.p[i + 3]) / RG); gz++) {
            const k = gx * 100003 + gz; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(id);
          }
      }
    }
    return (x, z) => {
      let best = 1e9; const gx = Math.floor(x / RG), gz = Math.floor(z / RG);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const id of grid.get((gx + dx) * 100003 + gz + dz) || []) {
        const ax = seg[id], az = seg[id + 1], vx = seg[id + 2] - ax, vz = seg[id + 3] - az, L2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
        best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t) - seg[id + 4]);
      }
      return best;
    };
  }

  async _init() {
    const clear = this._roadGrid(), B = this.game.city.data.buildings;
    await nextTask();
    for (let bi = 0; bi < B.length; bi++) {
      if (bi % 4000 === 3999) await nextTask();
      const b = B[bi];
      if ((b.s !== STYLE_SHOPHOUSE && b.s !== STYLE_LOWRISE) || b.m > 0.5 || b.h < 4) continue;
      const p = b.p, nV = p.length / 2;
      let area = 0; for (let i = 0; i < nV; i++) { const j = (i + 1) % nV; area += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; }
      const out = area > 0 ? 1 : -1;
      // shophouses: the one front facing the best street (the five-foot way); low-rise: every wall right on a street
      let best = -1, bestS = 8.5;
      for (let i = 0; i < nV; i++) {
        const j = (i + 1) % nV, ex = p[j * 2] - p[i * 2], ez = p[j * 2 + 1] - p[i * 2 + 1], len = Math.hypot(ex, ez);
        if (len < 3 || len > 90) continue;
        const nx = ez / len * out, nz = -ex / len * out, s = clear((p[i * 2] + p[j * 2]) / 2 + nx * 1.5, (p[i * 2 + 1] + p[j * 2 + 1]) / 2 + nz * 1.5);
        if (b.s === STYLE_SHOPHOUSE) { if (s < bestS) { bestS = s; best = i; } } else if (s < 5 && len > 4) this._front(p, i, j, nx, nz, len, b.id);
      }
      if (best >= 0) { const j = (best + 1) % nV, ex = p[j * 2] - p[best * 2], ez = p[j * 2 + 1] - p[best * 2 + 1], len = Math.hypot(ex, ez); this._front(p, best, j, ez / len * out, -ex / len * out, len, b.id); }
    }
    this.xz = this.xz.slice(0, this.n * 2); this.rec = this.rec.slice(0, this.n * 8);
  }

  // one pool per shop bay along the wall p[i] -> p[j] (outward normal nx, nz)
  _front(p, i, j, nx, nz, len, id) {
    const nb = Math.max(1, Math.round(len / BAY)), w = len / nb, ux = (p[j * 2] - p[i * 2]) / len, uz = (p[j * 2 + 1] - p[i * 2 + 1]) / len;
    for (let k = 0; k < nb; k++) {
      const t = (k + 0.5) * w, h = hash(id * 0.37 + k * 1.7, t);
      if (h < 0.22) continue; // shuttered for the night
      const x = p[i * 2] + ux * t + nx * 1.6, z = p[i * 2 + 1] + uz * t + nz * 1.6;
      if (this.n * 2 >= this.xz.length) { const a = new Float32Array(this.xz.length * 2); a.set(this.xz); this.xz = a; const r = new Float32Array(this.rec.length * 2); r.set(this.rec); this.rec = r; }
      const c = PALETTE[Math.floor(hash(id * 1.3 + k * 0.71, 4.1) * PALETTE.length)], v = 0.65 + 0.7 * hash(id + k, 9.3), o = this.n * 8;
      this.xz[this.n * 2] = x; this.xz[this.n * 2 + 1] = z;
      this.rec[o] = x; this.rec[o + 1] = z; this.rec[o + 2] = Math.atan2(nx, nz); this.rec[o + 3] = w * 1.15;
      this.rec[o + 4] = c[0] * v; this.rec[o + 5] = c[1] * v; this.rec[o + 6] = c[2] * v;
      const g = Math.floor(x / CELL) * 100003 + Math.floor(z / CELL); let l = this.grid.get(g); if (!l) this.grid.set(g, l = []); l.push(this.n);
      this.n++;
    }
  }

  /** refill the instances around (x, z) */
  refresh(x, z) {
    const m = this.mesh, M = m.instanceMatrix.array, C = m.instanceColor.array, R2 = RADIUS * RADIUS, rec = this.rec;
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), mat = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0);
    let n = 0;
    for (let gx = Math.floor((x - RADIUS) / CELL); gx <= Math.floor((x + RADIUS) / CELL); gx++)
      for (let gz = Math.floor((z - RADIUS) / CELL); gz <= Math.floor((z + RADIUS) / CELL); gz++) {
        for (const i of this.grid.get(gx * 100003 + gz) || []) {
          const o = i * 8, dx = rec[o] - x, dz = rec[o + 1] - z; if (dx * dx + dz * dz > R2 || n >= CAP) continue;
          // local x along the front, local z out across the pavement (6 m deep)
          mat.compose(pos.set(rec[o], Y, rec[o + 1]), q.setFromAxisAngle(up, rec[o + 2]), s.set(rec[o + 3], 1, 6));
          mat.toArray(M, n * 16); C[n * 3] = rec[o + 4]; C[n * 3 + 1] = rec[o + 5]; C[n * 3 + 2] = rec[o + 6];
          n++;
        }
      }
    m.count = n;
    for (const a of [m.instanceMatrix, m.instanceColor]) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(a.itemSize, n * a.itemSize)); a.needsUpdate = true; }
    this.at.set(x, z);
  }

  update() {
    const on = U.night.value > 0.25;
    this.mesh.visible = on && this.mesh.count > 0;
    if (!on) return;
    const cp = this.game.camera.position;
    if (Math.hypot(cp.x - this.at.x, cp.z - this.at.y) > 25) this.refresh(cp.x, cp.z);
  }
}
