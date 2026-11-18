// Night light on the shophouse streets, all emissive (the light count is in every program key):
// - pools: light spilling from shopfronts and their signboards onto the five-foot ways and pavements, soft coloured
//   pools (mostly warm white and amber, some neon red, pink, cyan, green, violet) along every street-facing shophouse
//   and low-rise front. Additive ground decals.
// - neon: tubes on the shop fronts — signboards over the five-foot way outlined in neon round a word on a dark board,
//   vertical blade signs with glowing characters hung out over the pavement, coloured eave lines. Thick in the
//   nightlife quarters (Clarke Quay, Boat Quay, Chinatown, Kampong Glam, Bugis), here and there elsewhere. A bay with
//   neon tints its pool to match.
// One instanced draw each, holding what is near the camera, shown only after dusk. Buildings the city doesn't draw as
// their OSM block (landmarks, hawker pavilions) get none; a landmark that rebuilds shopfronts lists them itself
// (`fronts`, on its own bay grid and heights).
import * as THREE from 'three';
import { U } from '../gfx/globals.js';
import { makeNeonWordAtlas, NEON_COLS, NEON_ROWS, NEON_WORDS } from '../gfx/signAtlas.js';
import { nextTask } from '../core/nextTask.js';
import { districtAt } from '../ui/districts.js';
import { REFLECT_LAYER } from './water.js';

const PALETTE = [[1, 0.72, 0.42], [1, 0.72, 0.42], [1, 0.8, 0.58], [1, 0.8, 0.58], [1, 0.5, 0.2], [1, 0.22, 0.16], [1, 0.25, 0.6], [0.3, 0.72, 1], [0.4, 1, 0.55], [0.7, 0.42, 1]];
// neon gas colours: hot pink, magenta, cyan, aqua, red, amber, green, violet, warm white
const NEON = [[1, 0.1, 0.45], [0.95, 0.12, 1], [0.1, 0.8, 1], [0.12, 1, 0.78], [1, 0.12, 0.06], [1, 0.42, 0.06], [0.35, 1, 0.2], [0.5, 0.22, 1], [1, 0.82, 0.62]];
const NIGHTLIFE = new Set(['Clarke Quay', 'Boat Quay', 'Chinatown', 'Kampong Glam', 'Bugis']);
const STYLE_SHOPHOUSE = 4, STYLE_LOWRISE = 5;
const BAY = 5.5, CELL = 64, RADIUS = 140, CAP = 900, Y = 0.14; // (Y: above roads, footways and five-foot-way floors)
const N_RADIUS = 300, N_CAP = 1600; // neon reads down a whole street
const K_FRAME = 0, K_LINE = 1, K_BLADE = 2, NREC = 24;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

function hash(x, z) { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); }
const hash1 = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// floor height and eave height of a shophouse / low-rise, as the city worker builds it (cityBuilder.worker.js: floorH,
// wallTop — shophouses without an OSM roof mostly get a pitched one, whose walls stop below the OSM height)
function frontHeights(b) {
  const top = b.h, base = Math.max(b.m || 0, 0), seed = hash1(b.id + 0.5), shop = b.s === STYLE_SHOPHOUSE;
  let roof = b.r || 0, rh = roof ? (b.rh || 2) : 0, topAdj = top;
  if (shop && !roof && top < 18 && seed < 0.85) { roof = 1; rh = Math.min(3.2, 1.2 + seed * 2.5); }
  if (shop && roof) { rh = Math.min(rh, Math.max(1.4, (top - base) * 0.22)); topAdj = top + rh * 0.6; }
  const wallTop = roof ? Math.max(base + 1, topAdj - rh) : top;
  return { fh: shop ? Math.max(2.9, (wallTop - base) / Math.max(1, Math.round(b.l || 2))) : 3.25, wallTop, flat: !roof };
}

// a neon piece is a quad: wall-flat (frames, lines) or standing out from the wall (blades). aNeon = kind, width,
// height (m), seed. The quad has a halo margin of M around the tube shape; the tube is widened to ~1.5 px where it is
// thinner than that, its brightness scaled down to match (no shimmer on a phone), and blade characters melt into an
// even glow once their strokes are sub-pixel. A frame holds a word from the neon word atlas, crisp while its strokes
// are a few pixels wide and the mip-filtered average of its strokes (an even glow) beyond.
const NEON_VS = /* glsl */`
  attribute vec4 aNeon; uniform float uFar;
  varying vec2 vP; varying vec4 vN; varying vec3 vCol; varying float vFade;
  void main() {
    vN = aNeon; vCol = instanceColor; vP = position.xy * aNeon.yz;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vFade = 1.0 - smoothstep(uFar * 0.7, uFar, distance(wp.xyz, cameraPosition));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const NEON_FS = /* glsl */`
  uniform float uNight; uniform float uTime; uniform sampler2D uWords; varying vec2 vP; varying vec4 vN; varying vec3 vCol; varying float vFade;
  const float M = 0.3, R = 0.022; // halo margin, tube radius (m)
  float nh(float n) { return fract(sin(n * 91.345 + 47.13) * 43758.5453); }
  float segH(vec2 p, vec2 a) { return length(vec2(max(abs(p.x - a.x - 0.25) - 0.25, 0.0), p.y - a.y)); }
  float segV(vec2 p, vec2 a) { return length(vec2(p.x - a.x, max(abs(p.y - a.y - 0.25) - 0.25, 0.0))); }
  // distance (glyph units, glyph = unit square) to a pseudo-character: strokes along a 3x3 lattice picked by hash
  float glyph(vec2 p, float s) {
    float d = 9.0;
    for (int i = 0; i < 3; i++) for (int j = 0; j < 2; j++) {
      float fi = float(i) * 0.5, fj = float(j) * 0.5, k = s + float(i * 2 + j);
      if (nh(k) > 0.4) d = min(d, segH(p, vec2(fj, fi)));
      if (nh(k + 13.7) > 0.5) d = min(d, segV(p, vec2(fi, fj)));
    }
    return d;
  }
  void main() {
    vec2 hs = vN.yz * 0.5 - M;                         // tube rectangle half size
    float px = max(fwidth(vP.x), fwidth(vP.y));        // metres per pixel here
    float kind = vN.x, d;
    bool line = kind > 0.5 && kind < 1.5;
    if (line) d = length(vec2(max(abs(vP.x) - hs.x, 0.0), vP.y));
    else { vec2 q = abs(vP) - hs; d = abs(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0)); } // the rectangle's outline
    float w = max(R, px * 0.75);
    float core = (1.0 - smoothstep(w * 0.6, w, d)) * (R / w);
    float glow = 0.0;
    if (kind > 1.5) {
      // characters stacked down the blade
      vec2 inner = hs - 0.1;
      float n = clamp(floor(inner.y / inner.x + 0.5), 2.0, 4.0), ch = inner.y * 2.0 / n, gs = min(inner.x * 2.0, ch) * 0.78;
      float ci = clamp(floor((inner.y - vP.y) / ch), 0.0, n - 1.0);
      vec2 g = (vec2(vP.x, inner.y - (ci + 0.5) * ch - vP.y) + gs * 0.5) / gs;
      float gd = glyph(g, floor(vN.w * 97.0) * 7.0 + ci * 3.1) * gs;
      float detail = 1.0 - smoothstep(0.03, 0.08, px);
      core = max(core, (1.0 - smoothstep(w * 0.6, w, gd)) * (R / w) * detail);
      glow = mix(0.45, exp(-gd / 0.07) * 0.35, detail) * step(abs(vP.x), inner.x + 0.05) * step(abs(vP.y), inner.y + 0.05);
    }
    vec3 word = vec3(0.0); float board = 0.0;
    if (kind < 0.5) {
      // a dark board behind the tubes: the facade's painted signboard under it would fight the word
      vec2 qb = abs(vP) - hs; board = 0.88 * (1.0 - smoothstep(-0.03, 0.0, max(qb.x, qb.y)));
      // the word, fitted to the frame at the atlas cells' 4:1, in its own colour on half the signs
      vec2 inner = hs - 0.16;
      vec2 box = inner.x > inner.y * 4.0 ? vec2(inner.y * 8.0, inner.y * 2.0) : vec2(inner.x * 2.0, inner.x * 0.5);
      vec2 q = vP / box + 0.5;
      float wi = floor(fract(vN.w * 7.31) * ${NEON_WORDS.length}.0);
      vec2 uv = (vec2(mod(wi, ${NEON_COLS}.0), floor(wi / ${NEON_COLS}.0)) + vec2(clamp(q.x, 0.0, 1.0), 1.0 - clamp(q.y, 0.0, 1.0))) / vec2(${NEON_COLS}.0, ${NEON_ROWS}.0);
      vec2 gx = dFdx(uv), gy = dFdy(uv);
      float lod = log2(max(length(gx), length(gy)) * ${NEON_COLS * 256}.0 + 1e-6);
      float inBox = step(abs(q.x - 0.5), 0.5) * step(abs(q.y - 0.5), 0.5);
      float m = textureGrad(uWords, uv, gx, gy).r, aa = fwidth(m) + 1e-3;
      // strokes are ~6 texels: crisp tubes to ~lod 1, the average coverage (no shimmer) from ~lod 2.5
      float wd = mix(smoothstep(0.5 - aa, 0.5 + aa, m), m * 0.45, smoothstep(1.0, 2.5, lod)) * inBox;
      float wGlow = textureGrad(uWords, uv, gx * 10.0, gy * 10.0).r * inBox;
      vec3 tc = fract(vN.w * 13.7) < 0.5 ? vCol.gbr : vCol;
      word = mix(tc, vec3(1.0), 0.3) * wd * 3.6 + tc * wGlow * 0.7;
    }
    float halo = exp(-d / 0.09) * (1.0 - smoothstep(M * 0.55, M, d));
    if (line) halo *= step(abs(vP.x), hs.x); // (eave lines join end to end without a bright seam)
    // a few tubes buzz on and off
    float on = vN.w > 0.97 ? step(0.15, fract(sin(floor(uTime * 9.0) * 12.9898 + vN.w * 311.0) * 43758.5453)) : 1.0;
    vec3 c = mix(vCol, vec3(1.0), 0.3) * core * 5.0 + vCol * (halo * 0.55 + glow) + word;
    float k = vFade * smoothstep(0.12, 0.5, uNight);
    gl_FragColor = vec4(c * on * k, board * k); // (premultiplied: light added, the board covering what is behind)
  }`;

export class NightGlow {
  constructor(game) {
    this.game = game;
    this.n = 0; this.xz = new Float32Array(4096); this.rec = new Float32Array(4096 * 2 * 4); // per pool: x, z, yaw, len | r, g, b, -
    this.grid = new Map();
    // per neon piece, as the instance buffers want it: matrix (16) | kind, width, height, seed | r, g, b, -
    this.nn = 0; this.nrec = new Float32Array(1024 * NREC); this.ngrid = new Map();
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
          gl_FragColor = vec4(vCol * f * smoothstep(0.25, 0.8, uNight) * 0.32, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.name = 'nightGlow';
    this.mesh.renderOrder = 1.5; // after the water (1): lies on the quays, never under the bay
    game.scene.add(this.mesh);

    const ngeo = new THREE.PlaneGeometry(1, 1);
    ngeo.setAttribute('aNeon', new THREE.InstancedBufferAttribute(new Float32Array(N_CAP * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const nmat = new THREE.ShaderMaterial({
      uniforms: { uNight: U.night, uTime: U.time, uFar: { value: N_RADIUS }, uWords: { value: makeNeonWordAtlas() } }, vertexShader: NEON_VS, fragmentShader: NEON_FS,
      transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide, forceSinglePass: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, // wall-flat tubes sit 6 cm off the facade
    });
    this.neon = new THREE.InstancedMesh(ngeo, nmat, N_CAP);
    this.neon.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.neon.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N_CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.neon.count = 0; this.neon.frustumCulled = false; this.neon.name = 'neon';
    this.neon.renderOrder = 1.5;
    this.neon.layers.enable(REFLECT_LAYER); // the river and the bay mirror the quays' neon
    game.scene.add(this.neon);
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
    const rebuilt = this.game.city.rebuilt; // (not drawn as their OSM block: neon on that outline would hang in the air)
    for (let bi = 0; bi < B.length; bi++) {
      if (bi % 4000 === 3999) await nextTask();
      const b = B[bi];
      if ((b.s !== STYLE_SHOPHOUSE && b.s !== STYLE_LOWRISE) || b.m > 0.5 || b.h < 4 || rebuilt.has(b.id)) continue;
      const p = b.p, nV = p.length / 2;
      let area = 0; for (let i = 0; i < nV; i++) { const j = (i + 1) % nV; area += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; }
      const out = area > 0 ? 1 : -1;
      const fr = frontHeights(b);
      fr.nightlife = NIGHTLIFE.has(districtAt(p[0], p[1]));
      fr.shopUse = (b.u || 0) <= 1; // (tools/building-uses.mjs: retail or unknown — the facades that get shopfronts and signboards)
      fr.eave = fr.nightlife && hash1(b.id * 2.7) < 0.4 ? NEON[Math.floor(hash1(b.id * 5.9) * NEON.length)] : null;
      // shophouses: the one front facing the best street (the five-foot way); low-rise: every wall right on a street
      let best = -1, bestS = 8.5;
      for (let i = 0; i < nV; i++) {
        const j = (i + 1) % nV, ex = p[j * 2] - p[i * 2], ez = p[j * 2 + 1] - p[i * 2 + 1], len = Math.hypot(ex, ez);
        if (len < 3 || len > 90) continue;
        const nx = ez / len * out, nz = -ex / len * out, s = clear((p[i * 2] + p[j * 2]) / 2 + nx * 1.5, (p[i * 2 + 1] + p[j * 2 + 1]) / 2 + nz * 1.5);
        if (b.s === STYLE_SHOPHOUSE) { if (s < bestS) { bestS = s; best = i; } } else if (s < 5 && len > 4) this._front(p[i * 2], p[i * 2 + 1], p[j * 2], p[j * 2 + 1], nx, nz, b.id, false, fr);
      }
      if (best >= 0) { const j = (best + 1) % nV, ex = p[j * 2] - p[best * 2], ez = p[j * 2 + 1] - p[best * 2 + 1], len = Math.hypot(ex, ez); this._front(p[best * 2], p[best * 2 + 1], p[j * 2], p[j * 2 + 1], ez / len * out, -ex / len * out, b.id, true, fr); }
    }
    // shopfronts a landmark builds itself (Clarke Quay's godowns): its walls, floor and eave heights
    for (const f of this.game.landmarks?.fronts || []) this._front(f.a[0], f.a[1], f.b[0], f.b[1], f.n[0], f.n[1], f.id, true, f);
    this.xz = this.xz.slice(0, this.n * 2); this.rec = this.rec.slice(0, this.n * 8); this.nrec = this.nrec.slice(0, this.nn * NREC);
  }

  // one pool per shop bay along the wall (x0, z0) -> (x1, z1) (outward normal nx, nz; id seeds it), and the bay's
  // neon if it has any. The bays and signboards follow the facade shader's grid (round(length / 5.5) per wall).
  _front(x0, z0, x1, z1, nx, nz, id, shop, fr) {
    const len = Math.hypot(x1 - x0, z1 - z0), nb = Math.max(1, Math.round(len / BAY)), w = len / nb, ux = (x1 - x0) / len, uz = (z1 - z0) / len;
    const yaw = Math.atan2(nx, nz);
    for (let k = 0; k < nb; k++) {
      const t = (k + 0.5) * w, h = hash(id * 0.37 + k * 1.7, t);
      const bx = x0 + ux * t, bz = z0 + uz * t;
      if (fr.eave && w > 2) this._neon(bx + nx * 0.08, fr.wallTop - (fr.flat ? 0.45 : 0.2), bz + nz * 0.08, yaw, K_LINE, w + 0.6, 0.6, 0.5, fr.eave);
      if (h < 0.22) continue; // shuttered for the night
      let c = PALETTE[Math.floor(hash(id * 1.3 + k * 0.71, 4.1) * PALETTE.length)];
      // neon over this shop: an outlined signboard, a blade sign, or a line under the fascia — where the facade shader
      // puts its signboards: shophouses over the five-foot way (the second-storey band), low-rise atop the shopfront
      const hn = hash(id * 0.91 + k * 2.3, 7.7), rate = fr.nightlife ? 0.6 : shop ? 0.14 : 0.06;
      if (fr.shopUse && hn < rate && w > 2.5) {
        const nc = NEON[Math.floor(hash(id * 2.1 + k * 0.53, 1.9) * NEON.length)], seed = hash(id + k * 3.1, 5.5), kind = hn / rate, fh = fr.fh;
        const signY = shop ? fh * 1.195 : fh * 0.9, signH = shop ? fh * 0.33 : fh * 0.2, bladeY = shop ? fh * 1.42 : fh * 1.05;
        const bladeH = Math.min(2.8, fr.wallTop - 0.5 - bladeY);
        if (kind < 0.4) this._neon(bx + nx * 0.07, signY, bz + nz * 0.07, yaw, K_FRAME, w * 0.9 + 0.6, signH + 0.6, seed, nc);
        else if (kind < 0.8 && bladeH > 1.3) {
          const e = (k % 2 ? 0.45 : w - 0.45) - w / 2; // at the bay's edge (alternating sides: they don't line up in pairs)
          this._neon(bx + ux * e + nx * 0.7, bladeY + bladeH / 2, bz + uz * e + nz * 0.7, yaw - Math.PI / 2, K_BLADE, 0.82 + 0.6, bladeH + 0.6, seed, nc);
        } else this._neon(bx + nx * 0.07, shop ? fh * 1.04 : fh * 0.8, bz + nz * 0.07, yaw, K_LINE, w * 0.86 + 0.6, 0.6, seed, nc);
        c = [(c[0] + nc[0] * 1.5) / 2.5, (c[1] + nc[1] * 1.5) / 2.5, (c[2] + nc[2] * 1.5) / 2.5];
      }
      const x = bx + nx * 1.6, z = bz + nz * 1.6;
      if (this.n * 2 >= this.xz.length) { const a = new Float32Array(this.xz.length * 2); a.set(this.xz); this.xz = a; const r = new Float32Array(this.rec.length * 2); r.set(this.rec); this.rec = r; }
      const v = 0.65 + 0.7 * hash(id + k, 9.3), o = this.n * 8;
      this.xz[this.n * 2] = x; this.xz[this.n * 2 + 1] = z;
      this.rec[o] = x; this.rec[o + 1] = z; this.rec[o + 2] = yaw; this.rec[o + 3] = w * 1.15;
      this.rec[o + 4] = c[0] * v; this.rec[o + 5] = c[1] * v; this.rec[o + 6] = c[2] * v;
      const g = Math.floor(x / CELL) * 100003 + Math.floor(z / CELL); let l = this.grid.get(g); if (!l) this.grid.set(g, l = []); l.push(this.n);
      this.n++;
    }
  }

  // a w x h quad centred at (x, y, z), its local +z turned to yaw
  _neon(x, y, z, yaw, kind, w, h, seed, c) {
    if ((this.nn + 1) * NREC > this.nrec.length) { const a = new Float32Array(this.nrec.length * 2); a.set(this.nrec); this.nrec = a; }
    const o = this.nn * NREC, r = this.nrec;
    _m.compose(_p.set(x, y, z), _q.setFromAxisAngle(_up, yaw), _s.set(w, h, 1)).toArray(r, o);
    r[o + 16] = kind; r[o + 17] = w; r[o + 18] = h; r[o + 19] = seed; r[o + 20] = c[0]; r[o + 21] = c[1]; r[o + 22] = c[2];
    const g = Math.floor(x / CELL) * 100003 + Math.floor(z / CELL); let l = this.ngrid.get(g); if (!l) this.ngrid.set(g, l = []); l.push(this.nn);
    this.nn++;
  }

  /** refill the instances around (x, z) */
  refresh(x, z) {
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), mat = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0);
    const fill = (m, n) => { m.count = n; for (const a of [m.instanceMatrix, m.instanceColor, m.geometry.attributes.aNeon]) if (a?.isInstancedBufferAttribute) { a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(a.itemSize, n * a.itemSize)); a.needsUpdate = true; } };
    {
      const m = this.mesh, M = m.instanceMatrix.array, C = m.instanceColor.array, R2 = RADIUS * RADIUS, rec = this.rec;
      let n = 0;
      for (let gx = Math.floor((x - RADIUS) / CELL); gx <= Math.floor((x + RADIUS) / CELL); gx++)
        for (let gz = Math.floor((z - RADIUS) / CELL); gz <= Math.floor((z + RADIUS) / CELL); gz++) {
          for (const i of this.grid.get(gx * 100003 + gz) || []) {
            const o = i * 8, dx = rec[o] - x, dz = rec[o + 1] - z; if (dx * dx + dz * dz > R2 || n >= CAP) continue;
            // local x along the front, local z out across the pavement (7 m deep)
            mat.compose(pos.set(rec[o], Y, rec[o + 1]), q.setFromAxisAngle(up, rec[o + 2]), s.set(rec[o + 3], 1, 7));
            mat.toArray(M, n * 16); C[n * 3] = rec[o + 4]; C[n * 3 + 1] = rec[o + 5]; C[n * 3 + 2] = rec[o + 6];
            n++;
          }
        }
      fill(m, n);
    }
    {
      const m = this.neon, M = m.instanceMatrix.array, C = m.instanceColor.array, A = m.geometry.attributes.aNeon.array, R2 = N_RADIUS * N_RADIUS, rec = this.nrec;
      let n = 0;
      for (let gx = Math.floor((x - N_RADIUS) / CELL); gx <= Math.floor((x + N_RADIUS) / CELL); gx++)
        for (let gz = Math.floor((z - N_RADIUS) / CELL); gz <= Math.floor((z + N_RADIUS) / CELL); gz++) {
          for (const i of this.ngrid.get(gx * 100003 + gz) || []) {
            const o = i * NREC, dx = rec[o + 12] - x, dz = rec[o + 14] - z; if (dx * dx + dz * dz > R2 || n >= N_CAP) continue;
            M.set(rec.subarray(o, o + 16), n * 16); A.set(rec.subarray(o + 16, o + 20), n * 4); C.set(rec.subarray(o + 20, o + 23), n * 3);
            n++;
          }
        }
      fill(m, n);
    }
    this.at.set(x, z);
  }

  update() {
    const on = U.night.value > 0.12;
    this.mesh.visible = on && this.mesh.count > 0;
    this.neon.visible = on && this.neon.count > 0;
    if (!on) return;
    const cp = this.game.camera.position;
    if (Math.hypot(cp.x - this.at.x, cp.z - this.at.y) > 25) this.refresh(cp.x, cp.z);
  }
}
