// Street-level Singapore: raised kerbs (dropped at crossings), blue street-name signs with the real road names,
// zebra crossings with zig-zags, LOOK RIGHT/LEFT and amber Belisha beacons, tactile strips, bollards, litter bins,
// hydrants, speed signs, tree grates, "BUS STOP" boxes, overhead pedestrian bridges with bougainvillea planters and
// covered linkways at MRT exits. Small props live in "near pools" (one InstancedMesh per prop type, refilled with the
// instances around the camera when it moves) so the whole city costs a handful of draw calls. Also fills the road
// shader's lookup texture (STREET.sig: R = traffic-signal area, B = yellow-box junction).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U } from '../gfx/globals.js';
import { STREET, createStructMaterial } from '../gfx/materials.js';
import { FILTER } from '../physics/physics.js';
import { nextTask } from '../core/nextTask.js';

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

function colorGeo(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo; const c = new THREE.Color(hex);
  const a = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g;
}
const box = (w, h, d, x, y, z, hex) => colorGeo(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
const cyl = (r0, r1, h, x, y, z, hex, seg = 10) => colorGeo(new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y, z), hex);
const yawOf = (dx, dz) => Math.atan2(dx, dz); // rotation about +y that maps local +z onto (dx, dz)
const ABBR = [[/\bRoad\b/g, 'Rd'], [/\bStreet\b/g, 'St'], [/\bAvenue\b/g, 'Ave'], [/\bDrive\b/g, 'Dr'], [/\bBoulevard\b/g, 'Blvd'], [/\bCrescent\b/g, 'Cres'],
  [/\bPlace\b/g, 'Pl'], [/\bTerrace\b/g, 'Ter'], [/\bSquare\b/g, 'Sq'], [/\bExpressway\b/g, 'Expwy'], [/\bHighway\b/g, 'Hwy'], [/\bJalan\b/g, 'Jln'], [/\bLorong\b/g, 'Lor'], [/\bCentral\b/g, 'Ctrl']];
const abbr = n => ABBR.reduce((s, [a, b]) => s.replace(a, b), n);
function hash(x, z) { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); }

// one InstancedMesh per prop type, holding only the instances near the camera. The ~55k placed instances are stored
// struct-of-arrays (position, matrix, uv rows in typed arrays; grid cells hold indices): an object plus a 16-float
// array per instance was ~10 MB of small objects on phones.
class NearPool {
  constructor(scene, geo, mat, { cap = 400, radius = 170, shadow = false, uv = false, name = '' } = {}) {
    this.n = 0; this.radius = radius; this.cap = cap; this.cell = 80; this.grid = new Map();
    this.xz = new Float64Array(64 * 2); this.mats = new Float32Array(64 * 16); this.uvs = uv ? new Float32Array(64 * 4) : null;
    if (uv) { this.uvAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); this.uvAttr.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aUV', this.uvAttr); }
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.castShadow = shadow; this.mesh.receiveShadow = true;
    this.mesh.name = 'street:' + name;
    scene.add(this.mesh);
  }
  add(x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1, uv = null) {
    const i = this.n++;
    if (i * 16 >= this.mats.length) this._grow();
    _q.setFromAxisAngle(UP, yaw); _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    _m.toArray(this.mats, i * 16);
    this.xz[i * 2] = x; this.xz[i * 2 + 1] = z;
    if (this.uvs && uv) this.uvs.set(uv, i * 4);
    const k = Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell);
    let l = this.grid.get(k); if (!l) this.grid.set(k, l = []); l.push(i);
  }
  _grow() {
    const g = (a, per) => { if (!a) return a; const b = new a.constructor(Math.max(a.length * 2, per * 64)); b.set(a); return b; };
    this.xz = g(this.xz, 2); this.mats = g(this.mats, 16); this.uvs = g(this.uvs, 4);
  }
  /** x / z of instance i */
  x(i) { return this.xz[i * 2]; }
  z(i) { return this.xz[i * 2 + 1]; }
  refresh(cx, cz) {
    if (!this._trimmed) { this._trimmed = true; const n = this.n; this.xz = this.xz.slice(0, n * 2); this.mats = this.mats.slice(0, n * 16); if (this.uvs) this.uvs = this.uvs.slice(0, n * 4); }
    const R = this.radius, c = this.cell, R2 = R * R, arr = this.mesh.instanceMatrix.array, uva = this.uvAttr?.array, xz = this.xz, M = this.mats, UV = this.uvs;
    let n = 0;
    for (let gx = Math.floor((cx - R) / c); gx <= Math.floor((cx + R) / c) && n < this.cap; gx++)
      for (let gz = Math.floor((cz - R) / c); gz <= Math.floor((cz + R) / c) && n < this.cap; gz++) {
        const l = this.grid.get(gx * 100003 + gz); if (!l) continue;
        for (const i of l) {
          const dx = xz[i * 2] - cx, dz = xz[i * 2 + 1] - cz; if (dx * dx + dz * dz > R2) continue;
          arr.set(M.subarray(i * 16, i * 16 + 16), n * 16);
          if (uva && UV) uva.set(UV.subarray(i * 4, i * 4 + 4), n * 4);
          if (++n >= this.cap) break;
        }
      }
    this.mesh.count = n;
    const im = this.mesh.instanceMatrix; im.clearUpdateRanges(); im.addUpdateRange(0, Math.max(16, n * 16)); im.needsUpdate = true;
    if (this.uvAttr) { this.uvAttr.clearUpdateRanges(); this.uvAttr.addUpdateRange(0, Math.max(4, n * 4)); this.uvAttr.needsUpdate = true; }
  }
}

// MeshStandardMaterial whose map (and emissive map) read one cell of an atlas, chosen per instance (aUV = offset.xy, scale.zw)
function atlasMaterial(tex, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ map: tex, ...opts });
  m.onBeforeCompile = sh => {
    sh.vertexShader = 'attribute vec4 aUV;\n' + sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      #ifdef USE_MAP
      vMapUv = aUV.xy + vMapUv * aUV.zw;
      #endif
      #ifdef USE_EMISSIVEMAP
      vEmissiveMapUv = aUV.xy + vEmissiveMapUv * aUV.zw;
      #endif`);
  };
  m.customProgramCacheKey = () => 'street-atlas-v1';
  return m;
}

function canvasTex(c, { srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t;
}

// ---------------------------------------------------------------- atlases
// street names: 2048x1024, 8 x 21 cells of 256x48 (blue plate, white border, white text)
const NAME_W = 256, NAME_H = 48, NAME_COLS = 8, NAME_ROWS = 21;
function nameAtlas(names) {
  const c = document.createElement('canvas'); c.width = NAME_W * NAME_COLS; c.height = 1024; const g = c.getContext('2d');
  g.fillStyle = '#1b3f8f'; g.fillRect(0, 0, c.width, c.height);
  names.forEach((n, i) => {
    const x = (i % NAME_COLS) * NAME_W, y = Math.floor(i / NAME_COLS) * NAME_H;
    g.fillStyle = '#1b3f8f'; g.fillRect(x, y, NAME_W, NAME_H);
    g.strokeStyle = '#f2f4f8'; g.lineWidth = 3; g.strokeRect(x + 4, y + 4, NAME_W - 8, NAME_H - 8);
    g.fillStyle = '#f7f8fb'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = 30; g.font = `bold ${fs}px Arial, Helvetica, sans-serif`;
    while (g.measureText(n).width > NAME_W - 24 && fs > 14) { fs -= 1; g.font = `bold ${fs}px Arial, Helvetica, sans-serif`; }
    g.fillText(n, x + NAME_W / 2, y + NAME_H / 2 + 1);
  });
  return canvasTex(c);
}
// LTA-style blue direction signs before major junctions: 2048x1152, 8 x 6 cells of 256x192, one sign per cell with a
// row per direction (straight first, then left, right) of arrow + road name
const DIR_W = 256, DIR_H = 192, DIR_COLS = 8, DIR_ROWS = 6, DIR_TH = DIR_H * DIR_ROWS;
function dirAtlas(signs) {
  const c = document.createElement('canvas'); c.width = 2048; c.height = DIR_TH; const g = c.getContext('2d');
  signs.forEach((rows, i) => {
    const x = (i % DIR_COLS) * DIR_W, y = Math.floor(i / DIR_COLS) * DIR_H;
    g.fillStyle = '#1b3f8f'; g.fillRect(x, y, DIR_W, DIR_H);
    g.strokeStyle = '#f2f4f8'; g.lineWidth = 5; g.strokeRect(x + 7, y + 7, DIR_W - 14, DIR_H - 14);
    const rh = (DIR_H - 30) / rows.length;
    rows.forEach(([dir, name], k) => {
      const cy = y + 15 + rh * (k + 0.5);
      // arrow
      g.save(); g.translate(x + 38, cy); g.rotate(dir === 'L' ? -Math.PI / 2 : dir === 'R' ? Math.PI / 2 : 0);
      g.fillStyle = '#f7f8fb'; g.fillRect(-5, -6, 10, 26); g.beginPath(); g.moveTo(0, -22); g.lineTo(15, -4); g.lineTo(-15, -4); g.closePath(); g.fill(); g.restore();
      let fs = Math.min(40, rh * 0.62); g.font = `bold ${fs}px Arial, Helvetica, sans-serif`;
      while (g.measureText(name).width > DIR_W - 90 && fs > 15) { fs -= 1; g.font = `bold ${fs}px Arial, Helvetica, sans-serif`; }
      g.fillStyle = '#f7f8fb'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(name, x + 70, cy + 1);
    });
  });
  return canvasTex(c);
}
const dirUV = i => [(i % DIR_COLS) * DIR_W / 2048, 1 - (Math.floor(i / DIR_COLS) + 1) * DIR_H / DIR_TH, DIR_W / 2048, DIR_H / DIR_TH];
const nameUV = i => [(i % NAME_COLS) * NAME_W / 2048, 1 - (Math.floor(i / NAME_COLS) + 1) * NAME_H / 1024, NAME_W / 2048, NAME_H / 1024];

// road decals: 1024x512, 4 x 4 cells of 256x128 (alpha-tested white/yellow paint, tactile tiles, grates)
const DEC = { zigzag: 0, lookRight: 1, lookLeft: 2, tactile: 3, slow: 4, grate: 5, busStop: 6, yzig: 7, busLane: 8, busLaneRed: 9 };
function decalAtlas() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const g = c.getContext('2d');
  const cell = i => [(i % 4) * 256, Math.floor(i / 4) * 128];
  const paint = '#f1f1ec', yellow = '#e8b512';
  const zig = (i, col) => { const [x, y] = cell(i); g.strokeStyle = col; g.lineWidth = 16; g.lineJoin = 'miter'; g.beginPath(); for (let k = 0; k <= 4; k++) g.lineTo(x + 6 + k * 61, y + (k % 2 ? 30 : 98)); g.stroke(); };
  zig(DEC.zigzag, paint); zig(DEC.yzig, yellow);
  const text = (i, t, col, size = 54) => { const [x, y] = cell(i); g.fillStyle = col; g.font = `bold ${size}px Arial Narrow, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, x + 128, y + 66, 244); };
  text(DEC.lookRight, 'LOOK RIGHT →', paint, 44); text(DEC.lookLeft, '← LOOK LEFT', paint, 44); text(DEC.slow, 'SLOW', paint, 96);
  text(DEC.busStop, 'BUS STOP', yellow, 70);
  text(DEC.busLane, 'BUS LANE', yellow, 70); text(DEC.busLaneRed, 'BUS LANE', '#c8261c', 70);
  { // yellow tactile warning tiles (dome pattern)
    const [x, y] = cell(DEC.tactile); g.fillStyle = '#d8a514'; g.fillRect(x + 2, y + 2, 252, 124);
    g.fillStyle = '#f2c62c'; for (let i = 0; i < 16; i++) for (let j = 0; j < 8; j++) { g.beginPath(); g.arc(x + 9 + i * 15.7, y + 9 + j * 15.6, 4.6, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = '#8a6a0a'; g.lineWidth = 2; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(x + i * 64, y); g.lineTo(x + i * 64, y + 128); g.stroke(); }
  }
  { // cast-iron tree grate (square, radial slots, hole in the middle)
    const [x, y] = cell(DEC.grate), cx = x + 64, cy = y + 64;
    g.fillStyle = '#2a2826'; g.fillRect(x + 2, y + 2, 124, 124);
    g.strokeStyle = '#121110'; g.lineWidth = 3;
    for (let r = 26; r < 62; r += 8) { g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); }
    for (let a = 0; a < 24; a++) { g.beginPath(); g.moveTo(cx + Math.cos(a / 24 * Math.PI * 2) * 24, cy + Math.sin(a / 24 * Math.PI * 2) * 24); g.lineTo(cx + Math.cos(a / 24 * Math.PI * 2) * 62, cy + Math.sin(a / 24 * Math.PI * 2) * 62); g.stroke(); }
    g.fillStyle = '#1a140e'; g.beginPath(); g.arc(cx, cy, 22, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a2c1c'; for (let k = 0; k < 40; k++) { g.fillRect(cx - 18 + Math.random() * 36, cy - 18 + Math.random() * 36, 3, 3); }
  }
  return canvasTex(c);
}
// pedestrian guard railing (galvanised): one 1.25 m period = post + 8 balusters between a top and a bottom rail,
// repeated along each run through the per-instance UV scale
function railTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#c9cdd0';
  g.fillRect(0, 4, 256, 10); g.fillRect(0, 104, 256, 7); g.fillRect(0, 0, 14, 128);
  for (let k = 1; k <= 8; k++) g.fillRect(Math.round(k * 256 / 9) - 2, 14, 5, 90);
  const t = canvasTex(c); t.wrapS = THREE.RepeatWrapping; return t;
}
const decUV = (i, w = 1, h = 1) => [(i % 4) * 0.25, 1 - (Math.floor(i / 4) + 1) * 0.25, 0.25 * w, 0.25 * h];

// traffic signs: 1024x128, 8 cells of 128x128
const SIGN = { s40: 0, s50: 1, s60: 2, s70: 3, s80: 4, ped: 5, keepLeft: 6, noEntry: 7 };
function signAtlas() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#9aa0a4'; g.fillRect(0, 0, 1024, 128);
  [40, 50, 60, 70, 80].forEach((v, i) => {
    const x = i * 128 + 64; g.fillStyle = '#fff'; g.beginPath(); g.arc(x, 64, 60, 0, 7); g.fill();
    g.strokeStyle = '#d0141a'; g.lineWidth = 13; g.beginPath(); g.arc(x, 64, 52, 0, 7); g.stroke();
    g.fillStyle = '#111'; g.font = 'bold 50px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(v), x, 67);
  });
  { const x = 5 * 128; g.fillStyle = '#1d5fb4'; g.fillRect(x + 4, 4, 120, 120); g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x + 64, 18); g.lineTo(x + 112, 108); g.lineTo(x + 16, 108); g.closePath(); g.fill();
    g.fillStyle = '#111'; g.beginPath(); g.arc(x + 64, 52, 6, 0, 7); g.fill(); g.fillRect(x + 60, 58, 8, 26); g.fillRect(x + 50, 84, 8, 18); g.fillRect(x + 70, 84, 8, 18); g.fillRect(x + 36, 98, 56, 4); }
  { const x = 6 * 128 + 64; g.fillStyle = '#1d5fb4'; g.beginPath(); g.arc(x, 64, 60, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 12; g.beginPath(); g.moveTo(x + 22, 30); g.lineTo(x - 18, 70); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x - 32, 86); g.lineTo(x - 2, 82); g.lineTo(x - 28, 54); g.closePath(); g.fill(); }
  { const x = 7 * 128 + 64; g.fillStyle = '#d0141a'; g.beginPath(); g.arc(x, 64, 60, 0, 7); g.fill(); g.fillStyle = '#fff'; g.fillRect(x - 40, 54, 80, 20); }
  return canvasTex(c);
}
const signUV = i => [i / 8, 0, 1 / 8, 1];

// City wear map (2 m/px; R = grime, G = foot polish), sampled by the ground shader so the marks are lit, wetted and
// street-lit like the paving they're on: soil and leaf litter round street-tree bases, a polished strip along shop
// fronts (five-foot ways), crossing kerbs and bus stops where people wait. Singapore's streets are clean, not CG-clean.
class WearMap {
  constructor(M, res = 2) {
    this.res = res; this.x0 = M.xmin; this.z0 = M.zmin;
    this.W = Math.ceil((M.xmax - M.xmin) / res); this.H = Math.ceil((M.zmax - M.zmin) / res);
    this.grime = new Float32Array(this.W * this.H); this.polish = new Float32Array(this.W * this.H);
  }
  splat(A, x, z, r, k) {
    const { res, W, H } = this, ci = (x - this.x0) / res - 0.5, cj = (z - this.z0) / res - 0.5, rp = Math.ceil(r / res);
    for (let j = Math.max(0, Math.floor(cj - rp)); j <= Math.min(H - 1, Math.ceil(cj + rp)); j++)
      for (let i = Math.max(0, Math.floor(ci - rp)); i <= Math.min(W - 1, Math.ceil(ci + rp)); i++) {
        const q = 1 - (((i - ci) * res) ** 2 + ((j - cj) * res) ** 2) / (r * r);
        if (q > 0) A[j * W + i] += k * q * q;
      }
  }
  upload() {
    const { W, H, grime, polish } = this, px = new Uint8Array(W * H * 2);
    for (let i = 0; i < W * H; i++) { px[i * 2] = Math.round(Math.min(1, grime[i]) * 255); px[i * 2 + 1] = Math.round(Math.min(1, polish[i]) * 255); }
    const t = new THREE.DataTexture(px, W, H, THREE.RGFormat, THREE.UnsignedByteType);
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
    t.userData.releaseSource = true; // GPU only from here on (gfx/texrelease.js)
    STREET.wear.value = t; STREET.wearOrigin.value.set(this.x0, this.z0); STREET.wearSize.value.set(W * this.res, H * this.res);
    this.grime = this.polish = null;
  }
}

/** growable typed array (append 3 at a time) */
class GrowBuf {
  constructor(T, n = 1024) { this.T = T; this.a = new T(n); this.n = 0; }
  p3(x, y, z) {
    if (this.n + 3 > this.a.length) { let s = this.a.length * 2; while (s < this.n + 3) s *= 2; const b = new this.T(s); b.set(this.a.subarray(0, this.n)); this.a = b; }
    const a = this.a, n = this.n; a[n] = x; a[n + 1] = y; a[n + 2] = z; this.n = n + 3;
  }
  out() { return this.a.slice(0, this.n); }
}
/** one face of a kerb/linkway quad a-b-d-e into chunk c (flip: reversed winding and normal) */
function emitQuad(c, a, b, d, e, nx, ny, nz, col, flip) {
  const base = c.pos.n / 3, sg = flip ? -1 : 1, P = c.pos, N = c.nor, C = c.col, I = c.idx;
  P.p3(a[0], a[1], a[2]); P.p3(b[0], b[1], b[2]); P.p3(d[0], d[1], d[2]); P.p3(e[0], e[1], e[2]);
  for (let i = 0; i < 4; i++) { N.p3(nx * sg, ny * sg, nz * sg); C.p3(col[0], col[1], col[2]); }
  if (flip) { I.p3(base, base + 2, base + 1); I.p3(base, base + 3, base + 2); } else { I.p3(base, base + 1, base + 2); I.p3(base, base + 2, base + 3); }
}

export class StreetDetail {
  constructor(game) {
    this.game = game;
    const scene = game.scene, net = game.roadnet, data = game.city.data, city = game.city, P = game.physics;
    this.pools = [];
    const t0 = performance.now();
    this.blocked = (x, z) => P.raycast({ x, y: 40, z }, { x: 0, y: -1, z: 0 }, 60)?.point.y > 0.6 || city.isWater(x, z);
    this.overhead = (x, z, h) => (P.raycast({ x, y: h, z }, { x: 0, y: 1, z: 0 }, 60) != null);
    // built in slices, handing the main thread back in between (~0.6 s on a phone): await .ready
    this.ready = this._init(t0);
  }
  async _init(t0) {
    const game = this.game, net = game.roadnet, data = game.city.data, brk = nextTask;
    this.buildLookup();
    await brk();
    // crossings from OSM (footway=crossing ribbons): endpoints, centre, direction, signal or zebra
    this.crossings = [];
    for (const r of data.roads) {
      if (!r.x || r.p.length < 4 || r.b) continue;
      const n = r.p.length / 2, ax = r.p[0], az = r.p[1], bx = r.p[n * 2 - 2], bz = r.p[n * 2 - 1];
      const L = Math.hypot(bx - ax, bz - az); if (L < 4 || L > 45) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const ln = net.nearestLane(mx, mz, 30, l => l.cls <= 6); if (!ln || ln.dist > 14) continue;
      this.crossings.push({ ax, az, bx, bz, mx, mz, L, hw: r.w / 2, signal: this.sigAt(mx, mz) > 0.5, edge: ln.lane.edge, dir: ln.dir.clone().setY(0).normalize(), pos: ln.pos });
    }
    this.mats();
    await brk();
    this.buildKerbsAndLinkways();
    await brk();
    this.buildSigns();
    await brk();
    this.buildCrossings();
    await brk();
    this.buildFurniture();
    await brk();
    this.buildBridges();
    await brk();
    this.buildWear();
    // light under the linkways and footbridges in the street-light map
    const LM = game.props?.light;
    if (LM) {
      const LL = this.linkLights; for (let i = 0; i < LL.n; i++) LM.add(LL.x(i), LL.z(i), 3.1, 0.3);
      for (const b of this.bridges) LM.add(b.x, b.z, 8.5, 0.35);
      LM.upload();
      LM.e = null; // the last lamps are in: the accumulation grid (15 MB) is done with, the GPU has the result
    }
    this.lastRefresh = new THREE.Vector3(1e9, 0, 0);
    const pp = game.player?.position || game.camera.position;
    this.refresh(pp.x, pp.z);
    console.log('streetdetail', JSON.stringify({ ms: Math.round(performance.now() - t0), crossings: this.crossings.length, bridges: this.bridges.length, chunks: this.chunks.length, linkwayTrees: this.linkwayTrees, items: Object.fromEntries(this.pools.map(p => [p.mesh.name.slice(7), p.n])) }));
  }

  // ---------------------------------------------------------------- road-shader lookup texture (4 m/px)
  buildLookup() {
    const M = this.game.city.meta, net = this.game.roadnet, data = this.game.city.data;
    const res = 4, W = Math.ceil((M.xmax - M.xmin) / res), H = Math.ceil((M.zmax - M.zmin) / res);
    const px = new Uint8Array(W * H * 4);
    const stamp = (x, z, r, ch, v = 255) => {
      const i0 = Math.max(0, Math.floor((x - r - M.xmin) / res)), i1 = Math.min(W - 1, Math.ceil((x + r - M.xmin) / res));
      const j0 = Math.max(0, Math.floor((z - r - M.zmin) / res)), j1 = Math.min(H - 1, Math.ceil((z + r - M.zmin) / res));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const cx = M.xmin + (i + 0.5) * res, cz = M.zmin + (j + 0.5) * res;
        if ((cx - x) ** 2 + (cz - z) ** 2 <= r * r) px[(j * W + i) * 4 + ch] = v;
      }
    };
    for (const n of net.nodes) {
      if (!n.signal) continue;
      stamp(n.x, n.z, n.maxHalfW + 22, 0);
      // yellow-box junctions: some of the big signalised crossroads
      if (n.degree >= 4 && n.maxHalfW >= 7 && hash(n.x, n.z) < 0.5) stamp(n.x, n.z, n.r + 1.5, 2);
    }
    for (const p of data.pois) if (p.k === 'traffic_signals') stamp(p.x, p.z, 26, 0);
    // bus lanes (G = bus lane, A = full-day, i.e. red line): the kerb lane of 3+ lane trunk/primary/secondary
    // carriageways, from just past the junction behind to the start of the dashed weaving section before the next
    this.busLanes = [];
    const v = new THREE.Vector3();
    for (const l of net.lanes) {
      const e = l.edge; if (l.idx !== 0 || l.nLanes < 3 || e.c < 1 || e.c > 3 || e.y || l.path.length < 160) continue;
      const full = hash(e.p[0] * 0.37, e.p[1] * 0.71) < 0.4;
      for (let s = 12; s < l.path.length - 6; s += 3) { l.path.sample(s, v); stamp(v.x, v.z, 4.2, 1); if (full) stamp(v.x, v.z, 4.2, 3); }
      this.busLanes.push({ l, full });
    }
    // gameplay queries only read the red channel: keep that (a quarter of the size) and let the RGBA go once uploaded
    const red = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) red[i] = px[i * 4];
    this.sig = { px: red, W, H, res, M };
    const tex = new THREE.DataTexture(px, W, H); tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.flipY = false; tex.needsUpdate = true;
    tex.userData.releaseSource = true;
    STREET.sig.value = tex; STREET.sigOrigin.value.set(M.xmin, M.zmin); STREET.sigSize.value.set(W * res, H * res);
  }
  sigAt(x, z) { const S = this.sig; const i = Math.floor((x - S.M.xmin) / S.res), j = Math.floor((z - S.M.zmin) / S.res); if (i < 0 || j < 0 || i >= S.W || j >= S.H) return 0; return S.px[j * S.W + i] / 255; }

  mats() {
    this.propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
    this.metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.75 });
    this.structMat = createStructMaterial();
    this.decalTex = decalAtlas();
    this.decalMat = atlasMaterial(this.decalTex, { alphaTest: 0.5, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    this.decalMat.transparent = false;
    this.signTex = signAtlas();
    this.signMat = atlasMaterial(this.signTex, { roughness: 0.45, metalness: 0.1, emissive: 0xffffff, emissiveIntensity: 0 });
    this.signMat.emissiveMap = this.signTex;
    this.globeMat = new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0xff9a10, emissiveIntensity: 2, roughness: 0.3 });
    this.lightMat = new THREE.MeshStandardMaterial({ color: 0xeef4ff, emissive: 0xdde8ff, emissiveIntensity: 0, roughness: 0.4 });
  }

  // ---------------------------------------------------------------- kerbs (+ linkways) in 300 m chunk meshes
  buildKerbsAndLinkways() {
    const net = this.game.roadnet, data = this.game.city.data, CH = 300;
    // chunk buffers are growable typed arrays and quads are written without a closure or array per call: plain-array
    // pushes made this builder a few hundred MB of garbage during the load
    const chunks = new Map();
    const chunk = (x, z) => { const cx = Math.floor(x / CH), cz = Math.floor(z / CH), k = cx * 100003 + cz; let c = chunks.get(k); if (!c) chunks.set(k, c = { k: `${cx},${cz}`, x: (cx + 0.5) * CH, z: (cz + 0.5) * CH, pos: new GrowBuf(Float32Array), nor: new GrowBuf(Float32Array), col: new GrowBuf(Uint8Array), idx: new GrowBuf(Uint32Array) }); return c; };
    // quad a-b-d-e (any winding): oriented so its front face points along n (n = null: emit both sides)
    const quad = (c, a, b, d, e, n, col) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      if (!n) { emitQuad(c, a, b, d, e, nx, ny, nz, col, false); emitQuad(c, a, b, d, e, nx, ny, nz, col, true); return; }
      emitQuad(c, a, b, d, e, nx, ny, nz, col, nx * n[0] + ny * n[1] + nz * n[2] < 0);
    };
    // the kerb loop's quads (two per 5 m of kerb, city-wide): corners written into scratch arrays instead of fresh ones
    const KA = [0, 0, 0], KB = [0, 0, 0], KD = [0, 0, 0], KE = [0, 0, 0], KN = [0, 0, 0], K_UP = [0, 1, 0];
    const kp = (v, x, z, o, y, rx, rz) => { v[0] = x + rx * o; v[1] = y; v[2] = z + rz * o; return v; };
    const c8 = hex => { const c = new THREE.Color(hex); return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]; };
    const kerbCol = c8(0xa9a59c), kerbTop = c8(0xc4c0b6);
    // where kerbs must drop: crossings, service-road mouths
    const gaps = [];
    for (const c of this.crossings) gaps.push([c.mx, c.mz, c.hw + 0.6 + Math.max(0, c.L * 0.5 - 4)]);
    for (const r of data.roads) if (r.c === 7 && !r.b) { const n = r.p.length / 2; for (const i of [0, n - 1]) gaps.push([r.p[i * 2], r.p[i * 2 + 1], r.w / 2 + 2.5]); }
    const gapGrid = new Map(); for (const g of gaps) { const k = Math.floor(g[0] / 50) * 100003 + Math.floor(g[1] / 50); let l = gapGrid.get(k); if (!l) gapGrid.set(k, l = []); l.push(g); }
    const inGap = (x, z) => { for (let gx = Math.floor(x / 50) - 1; gx <= Math.floor(x / 50) + 1; gx++) for (let gz = Math.floor(z / 50) - 1; gz <= Math.floor(z / 50) + 1; gz++) for (const g of gapGrid.get(gx * 100003 + gz) || []) if ((x - g[0]) ** 2 + (z - g[1]) ** 2 < g[2] * g[2]) return true; return false; };
    let kerbM = 0;
    const rails = []; // guard railing behind the kerb on the approaches to busy junctions (no jaywalking at the corners)
    for (const e of net.edges) {
      if (e.c > 6 || e.y) continue;
      const pts = []; for (let i = 0; i < e.p.length; i += 2) pts.push([e.p[i], e.p[i + 1]]);
      const A = net.nodes[e.a], B = net.nodes[e.b];
      const trimA = A.degree >= 3 ? A.r + 1.5 : 0, trimB = B.degree >= 3 ? B.r + 1.5 : 0;
      const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const len = cum[cum.length - 1]; if (len - trimA - trimB < 3) continue;
      for (const side of [-1, 1]) {
        const off0 = e.hw, off1 = e.hw + 0.2;
        // walk the polyline in <= 8 m steps so crossings/driveways can drop the kerb
        for (let i = 0; i < pts.length - 1; i++) {
          const [ax, az] = pts[i], [bx, bz] = pts[i + 1]; const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.05) continue;
          const tx = dx / L, tz = dz / L, rx = -tz * side, rz = tx * side;
          const nSub = Math.ceil(L / 5);
          for (let k = 0; k < nSub; k++) {
            let s0 = cum[i] + L * k / nSub, s1 = cum[i] + L * (k + 1) / nSub;
            s0 = Math.max(s0, trimA); s1 = Math.min(s1, len - trimB); if (s1 - s0 < 0.2) continue;
            const f0 = (s0 - cum[i]), f1 = (s1 - cum[i]);
            const x0 = ax + tx * f0, z0 = az + tz * f0, x1 = ax + tx * f1, z1 = az + tz * f1;
            const mx = (x0 + x1) / 2 + rx * off0, mz = (z0 + z1) / 2 + rz * off0;
            if (inGap(mx, mz)) continue;
            const c = chunk(mx, mz);
            const yT = 0.16, yB = 0.02;
            // road-facing face + top (the back drops to footway level and is never seen)
            KN[0] = -rx; KN[2] = -rz;
            quad(c, kp(KA, x0, z0, off0, yB, rx, rz), kp(KB, x1, z1, off0, yB, rx, rz), kp(KD, x1, z1, off0, yT, rx, rz), kp(KE, x0, z0, off0, yT, rx, rz), KN, kerbCol);
            quad(c, kp(KA, x0, z0, off0, yT, rx, rz), kp(KB, x1, z1, off0, yT, rx, rz), kp(KD, x1, z1, off1, yT, rx, rz), kp(KE, x0, z0, off1, yT, rx, rz), K_UP, kerbTop);
            kerbM += s1 - s0;
            if (e.c <= 4 && ((A.degree >= 3 && (A.signal || e.c <= 3) && s0 < trimA + 26) || (B.degree >= 3 && (B.signal || e.c <= 3) && s1 > len - trimB - 26))) {
              const p = (x, z, o, y) => [x + rx * o, y, z + rz * o];
              const [ax2, , az2] = p(x0, z0, off0 + 0.45, 0), [bx2, , bz2] = p(x1, z1, off0 + 0.45, 0);
              rails.push([(ax2 + bx2) / 2, (az2 + bz2) / 2, Math.atan2(-(bz2 - az2), bx2 - ax2), Math.hypot(bx2 - ax2, bz2 - az2)]);
            }
          }
        }
      }
    }
    this.kerbMetres = Math.round(kerbM);
    // covered linkways: along the sidewalk from MRT exits and bus stops
    const roofCol = c8(0x5e7f86), under = c8(0xc9cdcc), postCol = c8(0x40484c), gutter = c8(0x2f3538);
    const lights = [];
    // street trees (x, z, type, scale, rot): a linkway segment shifts toward the buildings to clear a trunk, or is skipped
    const T = this.game.city.trees, tGrid = new Map();
    if (T) for (let i = 0; i < T.length; i += 5) { const k = Math.floor(T[i] / 8) * 100003 + Math.floor(T[i + 1] / 8); let l = tGrid.get(k); if (!l) tGrid.set(k, l = []); l.push(T[i], T[i + 1]); }
    const trunkNear = (ax, az, bx, bz, r) => {
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
      for (let gx = Math.floor((Math.min(ax, bx) - r) / 8); gx <= Math.floor((Math.max(ax, bx) + r) / 8); gx++)
        for (let gz = Math.floor((Math.min(az, bz) - r) / 8); gz <= Math.floor((Math.max(az, bz) + r) / 8); gz++) {
          const l = tGrid.get(gx * 100003 + gz); if (!l) continue;
          for (let i = 0; i < l.length; i += 2) {
            const t = Math.max(0, Math.min(1, ((l[i] - ax) * dx + (l[i + 1] - az) * dz) / L2));
            if ((ax + dx * t - l[i]) ** 2 + (az + dz * t - l[i + 1]) ** 2 < r * r) return true;
          }
        }
      return false;
    };
    let lwShift = 0, lwSkip = 0;
    const linkway = (sw, s0, s1) => {
      const path = sw.path; const st = Math.max(0, s0), en = Math.min(path.length, s1); if (en - st < 6) return;
      const hw = 1.35, y0 = 3.05, y1 = 3.25; // roof slopes up away from the road
      const toRoad = sw.side; // +o = building side; the low edge faces the kerb
      const steps = Math.ceil((en - st) / 4);
      const segs = [];
      for (let k = 0; k < steps; k++) {
        const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
        path.sample(st + (en - st) * k / steps, a, d); path.sample(st + (en - st) * (k + 1) / steps, b);
        segs.push({ a, b, d, rx: -d.z * toRoad, rz: d.x * toRoad });
      }
      // street trees stand on the footway line ~0.2-0.8 m outside the path, so SG linkways run on the building side of
      // them: one lateral offset for the whole run (the one with fewest trunk/building conflicts), conflicting bays skipped
      const bad = (g, o) => trunkNear(g.a.x + g.rx * o, g.a.z + g.rz * o, g.b.x + g.rx * o, g.b.z + g.rz * o, hw + 0.35)
        || (o > 0 && this.blocked((g.a.x + g.b.x) / 2 + g.rx * (o + hw), (g.a.z + g.b.z) / 2 + g.rz * (o + hw)));
      let sh = 0, best = 1e9;
      for (const o of [0, 2.5, 3.1, 3.7]) { const n = segs.reduce((m, g) => m + (bad(g, o) ? 1 : 0), 0) + o * 0.1; if (n < best) { best = n; sh = o; } }
      if (sh > 0) lwShift++;
      segs.forEach((g, k) => {
        const { a, b, d, rx, rz } = g;
        if (bad(g, sh)) { lwSkip++; return; }
        const P = (v, o, y) => [v.x + rx * (o + sh), y, v.z + rz * (o + sh)];
        const mx = (a.x + b.x) / 2 + rx * sh, mz = (a.z + b.z) / 2 + rz * sh;
        if (this.blocked(mx, mz) || this.overhead(mx, mz, 3.6)) return;
        const c = chunk(mx, mz);
        const r0 = P(a, -hw, y0), r1 = P(b, -hw, y0), r2 = P(b, hw, y1), r3 = P(a, hw, y1);
        quad(c, r0, r1, r2, r3, [0, 1, 0], roofCol); quad(c, r0, r3, r2, r1, [0, -1, 0], under);
        // fascia gutters on both edges
        quad(c, P(a, -hw, y0 - 0.22), P(b, -hw, y0 - 0.22), P(b, -hw, y0 + 0.04), P(a, -hw, y0 + 0.04), null, gutter);
        // post on the building side every segment
        const pp = P(a, hw - 0.15, 0);
        const pw = 0.07;
        const px0 = [pp[0] - pw, 0, pp[2] - pw], px1 = [pp[0] + pw, 0, pp[2] - pw], px2 = [pp[0] + pw, 0, pp[2] + pw], px3 = [pp[0] - pw, 0, pp[2] + pw];
        const up = v => [v[0], y1, v[2]];
        quad(c, px0, px1, up(px1), up(px0), [0, 0, -1], postCol); quad(c, px1, px2, up(px2), up(px1), [1, 0, 0], postCol);
        quad(c, px2, px3, up(px3), up(px2), [0, 0, 1], postCol); quad(c, px3, px0, up(px0), up(px3), [-1, 0, 0], postCol);
        if (k % 2 === 0) lights.push([mx, (y0 + y1) / 2 - 0.06, mz, Math.atan2(d.x, d.z)]);
      });
    };
    const net2 = this.game.roadnet;
    let lw = 0;
    const doneAt = [];
    const linkFrom = (x, z, half) => {
      if (doneAt.some(([px, pz]) => Math.hypot(px - x, pz - z) < half)) return;
      const sw = net2.nearestSidewalk(x, z, 30); if (!sw || sw.dist > 14) return;
      const s = sw.sw.path; let best = 0, bd = 1e9; // arc-length of the projection
      for (let i = 0; i < s.n - 1; i++) { const ax = s.x(i), az = s.z(i), bx = s.x(i + 1), bz = s.z(i + 1), dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); const dd = Math.hypot(ax + dx * t - x, az + dz * t - z); if (dd < bd) { bd = dd; best = s.arc(i) + Math.sqrt(L2) * t; } }
      linkway(sw.sw, best - half, best + half); doneAt.push([x, z]); lw++;
    };
    for (const p of data.pois) if (p.k === 'subway_entrance') linkFrom(p.x, p.z, 28);
    for (const st of this.game.streetProps?.stops || []) linkFrom(st.x, st.z, 14);
    this.linkways = lw; this.linkwayTrees = { shifted: lwShift, skipped: lwSkip };
    // meshes
    this.chunks = [];
    for (const c of chunks.values()) {
      if (!c.pos.n) continue;
      const g = new THREE.BufferGeometry(), idx = c.idx.out();
      g.setAttribute('position', new THREE.BufferAttribute(c.pos.out(), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(c.nor.out(), 3));
      g.setAttribute('color', new THREE.BufferAttribute(c.col.out(), 3, true));
      g.setIndex(new THREE.BufferAttribute(c.pos.n / 3 > 65535 ? idx : Uint16Array.from(idx), 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, this.structMat); mesh.receiveShadow = true; mesh.castShadow = true; mesh.matrixAutoUpdate = false; mesh.name = 'kerbs_' + c.k;
      this.game.scene.add(mesh);
      this.chunks.push({ mesh, x: c.x, z: c.z });
    }
    // guard railings (near pool, alpha-tested quads)
    this.railMat = atlasMaterial(railTex(), { alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.7 });
    this.rails = this.pool(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), this.railMat, { cap: 700, radius: 170, uv: true, name: 'rail' });
    const stops = this.game.streetProps?.stops || [];
    for (const [x, z, yaw, L] of rails) if (!this.blocked(x, z) && !stops.some(st => (st.x - x) ** 2 + (st.z - z) ** 2 < 15 * 15)) this.rails.add(x, 0, z, yaw, L + 0.02, 1.0, 1, [0, 0, L / 1.25, 1]);
    // linkway light tubes (near pool)
    const tube = new THREE.BoxGeometry(0.08, 0.04, 1.2);
    this.linkLights = this.pool(tube, this.lightMat, { cap: 600, radius: 220, name: 'linklight' });
    for (const [x, y, z, yaw] of lights) this.linkLights.add(x, y, z, yaw);
  }

  buildWear() {
    const city = this.game.city, M = city.meta, WM = new WearMap(M), T = city.trees;
    // soil, roots and leaf litter round street trees standing in paving
    if (T) for (let i = 0; i < T.length; i += 5) {
      const x = T[i], z = T[i + 1];
      if (city.maskAt(x, z, 2) < 110 || city.maskAt(x, z, 1) > 140) continue;
      WM.splat(WM.grime, x, z, 2.2, 1.1);
    }
    // foot-polished strip along shophouse / retail fronts that face paving (outward side found from the paving mask)
    for (const b of city.data.buildings) {
      if (!((b.s === 4 && (!b.u || b.u === 1)) || b.u === 1) || (b.m || 0) > 2) continue;
      const p = b.p, n = p.length / 2;
      for (let k = 0; k < n; k++) {
        const ax = p[k * 2], az = p[k * 2 + 1], bx = p[((k + 1) % n) * 2], bz = p[((k + 1) % n) * 2 + 1];
        const L = Math.hypot(bx - ax, bz - az); if (L < 3) continue;
        let nx = -(bz - az) / L, nz = (bx - ax) / L;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        if (city.maskAt(mx + nx * 2, mz + nz * 2, 2) < 200) { nx = -nx; nz = -nz; if (city.maskAt(mx + nx * 2, mz + nz * 2, 2) < 200) continue; }
        for (let t = 1; t < L; t += 2) WM.splat(WM.polish, ax + (bx - ax) * t / L + nx * 1.4, az + (bz - az) * t / L + nz * 1.4, 2.0, 0.3);
      }
    }
    // people waiting at crossing kerbs and bus stops; grit collects in the gutter at the ramps
    for (const c of this.crossings) for (const [x, z] of [[c.ax, c.az], [c.bx, c.bz]]) { WM.splat(WM.polish, x, z, 3.2, 0.5); WM.splat(WM.grime, x, z, 1.6, 0.18); }
    for (const st of this.game.streetProps?.stops || []) WM.splat(WM.polish, st.x + Math.sin(st.yaw) * 1.5, st.z + Math.cos(st.yaw) * 1.5, 4.0, 0.5);
    WM.upload();
  }

  pool(geo, mat, opts) { const p = new NearPool(this.game.scene, geo, mat, opts); this.pools.push(p); return p; }

  // ---------------------------------------------------------------- blue street-name signs at junctions
  buildSigns() {
    const net = this.game.roadnet;
    // junctions with two different named roads; names ranked by how often (and how centrally) they appear
    const cand = [], score = new Map();
    for (const n of net.nodes) {
      if (n.degree < 3) continue;
      const named = []; for (const e of n.edges) if (e.n && !e.y && e.c <= 6 && !named.some(o => o.n === e.n)) named.push(e);
      if (named.length < 2) continue;
      cand.push({ n, A: named[0], B: named[1] });
      for (const e of [named[0], named[1]]) score.set(e.n, (score.get(e.n) || 0) + 1 / (1 + Math.hypot(n.x, n.z) / 1500));
    }
    const names = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, NAME_COLS * NAME_ROWS).map(([n]) => n);
    const idx = new Map(names.map((n, i) => [n, i]));
    this.nameTex = nameAtlas(names.map(abbr));
    this.nameMat = atlasMaterial(this.nameTex, { roughness: 0.4, metalness: 0.1, emissive: 0xffffff, emissiveIntensity: 0 });
    this.nameMat.emissiveMap = this.nameTex;
    const plateGeo = new THREE.BoxGeometry(0.95, 0.19, 0.025);
    const poleGeo = mergeGeometries([cyl(0.045, 0.05, 3.05, 0, 1.525, 0, 0x2f5b3e, 8), cyl(0.06, 0.06, 0.1, 0, 3.1, 0, 0x2f5b3e, 8)]);
    this.namePlates = this.pool(plateGeo, this.nameMat, { cap: 240, radius: 160, uv: true, name: 'nameplate' });
    this.signPoles = this.pool(poleGeo, this.propMat, { cap: 360, radius: 160, shadow: true, name: 'signpole' });
    const dirFrom = (e, n) => { // unit vector pointing away from node n along edge e
      const p = e.p, atA = e.a === n.id; const x0 = atA ? p[0] : p[p.length - 2], z0 = atA ? p[1] : p[p.length - 1];
      const x1 = atA ? p[2] : p[p.length - 4], z1 = atA ? p[3] : p[p.length - 3]; const L = Math.hypot(x1 - x0, z1 - z0) || 1; return [(x1 - x0) / L, (z1 - z0) / L];
    };
    let placed = 0;
    for (const { n, A, B } of cand) {
      if (!idx.has(A.n) || !idx.has(B.n)) continue;
      const a = dirFrom(A, n), b = dirFrom(B, n);
      if (Math.abs(a[0] * b[0] + a[1] * b[1]) > 0.8) continue; // nearly collinear: not a corner
      const x = n.x + a[0] * (B.hw + 2.3) + b[0] * (A.hw + 2.3), z = n.z + a[1] * (B.hw + 2.3) + b[1] * (A.hw + 2.3);
      if (this.blocked(x, z)) continue;
      this.signPoles.add(x, 0, z, 0);
      // each plate runs parallel to its road
      this.namePlates.add(x, 3.0, z, yawOf(a[0], a[1]) + Math.PI / 2, 1, 1, 1, nameUV(idx.get(A.n)));
      this.namePlates.add(x, 2.78, z, yawOf(b[0], b[1]) + Math.PI / 2, 1, 1, 1, nameUV(idx.get(B.n)));
      placed++;
    }
    this.nameSigns = placed;
    this.buildDirectionSigns(dirFrom);
  }

  // blue roadside direction signs ~55 m before signalised junctions on arterials: where each exit road goes
  buildDirectionSigns(dirFrom) {
    const net = this.game.roadnet, cand = [], v = new THREE.Vector3(), d = new THREE.Vector3();
    for (const l of net.lanes) {
      if (l.idx !== 0 || l.cls > 3 || l.edge.y || l.path.length < 110) continue;
      const n = net.nodes[l.to]; if (!n.signal || n.degree < 3) continue;
      l.path.sample(l.path.length - 1, v, d);
      const rows = { S: null, L: null, R: null };
      for (const e of n.edges) {
        if (e === l.edge || !e.n || e.c > 5) continue;
        const [ox, oz] = dirFrom(e, n), side = ox * -d.z + oz * d.x, fwd = ox * d.x + oz * d.z; // + = right of travel
        const k = fwd > 0.7 ? 'S' : side > 0.5 ? 'R' : side < -0.5 ? 'L' : null;
        if (k && !rows[k]) rows[k] = abbr(e.n);
      }
      const list = ['S', 'L', 'R'].filter(k => rows[k]).map(k => [k, rows[k]]);
      if (list.length < 2) continue;
      cand.push({ l, list, score: Math.hypot(n.x - 200, n.z - 400) });
    }
    cand.sort((a, b) => a.score - b.score);
    const chosen = [];
    for (const c of cand) {
      if (chosen.length >= DIR_COLS * DIR_ROWS) break;
      const L = c.l.path; L.sample(L.length - 55, v, d);
      const rx = -d.z, rz = d.x, x = v.x - rx * 3.4, z = v.z - rz * 3.4; // behind the left kerb
      if (this.blocked(x, z) || this.overhead(x, z, 2.0) || chosen.some(o => Math.hypot(o.x - x, o.z - z) < 30)) continue;
      chosen.push({ x, z, yaw: yawOf(-d.x, -d.z), list: c.list });
    }
    const tex = dirAtlas(chosen.map(c => c.list));
    this.dirMat = atlasMaterial(tex, { roughness: 0.45, metalness: 0.1, emissive: 0xffffff, emissiveIntensity: 0 });
    this.dirMat.emissiveMap = tex;
    const face = new THREE.PlaneGeometry(2.4, 1.8).translate(0, 3.2, 0.03);
    const back = mergeGeometries([box(2.44, 1.84, 0.04, 0, 3.2, 0, 0x8d9296), cyl(0.06, 0.06, 4.1, -0.85, 2.05, -0.06, 0x8d9296, 8), cyl(0.06, 0.06, 4.1, 0.85, 2.05, -0.06, 0x8d9296, 8)]);
    this.dirFaces = this.pool(face, this.dirMat, { cap: 40, radius: 260, uv: true, name: 'dirsign' });
    this.dirBacks = this.pool(back, this.metalMat, { cap: 40, radius: 260, shadow: true, name: 'dirpost' });
    chosen.forEach((c, i) => { this.dirFaces.add(c.x, 0, c.z, c.yaw, 1, 1, 1, dirUV(i)); this.dirBacks.add(c.x, 0, c.z, c.yaw); });
    this.dirSigns = chosen.length;
  }

  // ---------------------------------------------------------------- crossings: zig-zags, LOOK RIGHT, beacons, tactile, bollards
  buildCrossings() {
    const decGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.decals = this.pool(decGeo, this.decalMat, { cap: 1600, radius: 130, uv: true, name: 'decal' });
    const pole = [];
    for (let i = 0; i < 9; i++) pole.push(cyl(0.05, 0.05, 0.3, 0, 0.15 + i * 0.3, 0, i % 2 ? 0x111111 : 0xf2f2f2, 8));
    this.beaconPoles = this.pool(mergeGeometries(pole), this.propMat, { cap: 120, radius: 170, shadow: true, name: 'beaconpole' });
    this.beaconGlobes = this.pool(new THREE.SphereGeometry(0.17, 12, 8).translate(0, 2.88, 0), this.globeMat, { cap: 120, radius: 260, name: 'beacon' });
    const bol = mergeGeometries([cyl(0.075, 0.075, 0.85, 0, 0.425, 0, 0xb9bec2, 12), cyl(0.085, 0.085, 0.05, 0, 0.86, 0, 0x8b9196, 12), cyl(0.09, 0.09, 0.06, 0, 0.03, 0, 0x30343a, 12), cyl(0.077, 0.077, 0.05, 0, 0.7, 0, 0xd8c020, 12)]);
    this.bollards = this.pool(bol, this.metalMat, { cap: 400, radius: 140, shadow: true, name: 'bollard' });
    const signPlate = new THREE.CircleGeometry(0.32, 24);
    this.signPlates = this.pool(signPlate, this.signMat, { cap: 160, radius: 170, uv: true, name: 'signplate' });
    const sq = new THREE.PlaneGeometry(0.6, 0.6);
    this.signSquares = this.pool(sq, this.signMat, { cap: 120, radius: 170, uv: true, name: 'signsquare' });
    let z = 0, bz = 0;
    for (const c of this.crossings) {
      const cdx = (c.bx - c.ax) / c.L, cdz = (c.bz - c.az) / c.L; // across the road
      const rd = c.dir; // along the road
      const hwR = c.edge.hw, cw = c.hw;
      // tactile strips + bollards at both kerbs
      for (const [ex, ez, sgn] of [[c.ax, c.az, 1], [c.bx, c.bz, -1]]) {
        // ex,ez is roughly at/behind the kerb; step to just behind the kerb line along the crossing
        const kx = c.mx - cdx * sgn * (hwR + 0.7), kz = c.mz - cdz * sgn * (hwR + 0.7);
        this.decals.add(kx, 0.045, kz, yawOf(cdx, cdz), Math.max(1.6, cw * 2), 1, 0.6, decUV(DEC.tactile));
        for (const o of [-1, 1]) {
          const bx = c.mx - cdx * sgn * (hwR + 0.45) + rd.x * o * (cw + 0.5), bzz = c.mz - cdz * sgn * (hwR + 0.45) + rd.z * o * (cw + 0.5);
          if (!this.blocked(bx, bzz)) { this.bollards.add(bx, 0, bzz); bz++; }
        }
        if (!c.signal) {
          // amber Belisha beacons on black-and-white poles + LOOK RIGHT / LOOK LEFT painted at the kerb
          const px = c.mx - cdx * sgn * (hwR + 0.6) + rd.x * (cw + 1.1), pz = c.mz - cdz * sgn * (hwR + 0.6) + rd.z * (cw + 1.1);
          this.beaconPoles.add(px, 0, pz); this.beaconGlobes.add(px, 0, pz);
          const tx = c.mx - cdx * sgn * (hwR - 0.9), tz = c.mz - cdz * sgn * (hwR - 0.9);
          // text reads from the kerb looking across: decal +z (text bottom) points back at the pedestrian
          this.decals.add(tx, 0.095, tz, yawOf(-cdx * sgn, -cdz * sgn), Math.min(2.4, cw * 1.6), 1, 0.7, decUV(sgn > 0 ? DEC.lookRight : DEC.lookLeft));
          const sx = c.mx - cdx * sgn * (hwR + 0.9) - rd.x * sgn * (cw + 1.0), sz = c.mz - cdz * sgn * (hwR + 0.9) - rd.z * sgn * (cw + 1.0);
          if (!this.blocked(sx, sz)) { this.signPoles.add(sx, 0, sz); this.signSquares.add(sx, 2.75, sz, yawOf(-rd.x * sgn, -rd.z * sgn), 1, 1, 1, signUV(SIGN.ped)); }
        }
      }
      if (c.signal) continue;
      // zig-zags on both approaches, along both edges (+ centre line for two-way roads)
      const lanes = [-(hwR - 0.4), hwR - 0.4]; if (c.edge.lf > 0 && c.edge.lb > 0) lanes.push(0);
      const rx = -rd.z, rz = rd.x;
      for (const dirS of [-1, 1]) for (const o of lanes) for (let k = 0; k < 6; k++) {
        const d = cw + 2.2 + k * 2.0 + 1.0;
        const x = c.mx + rd.x * dirS * d + rx * o, zz = c.mz + rd.z * dirS * d + rz * o;
        this.decals.add(x, 0.095, zz, yawOf(rx, rz), 2.0, 1, 0.35, decUV(DEC.zigzag));
      }
      // SLOW before each approach (in the lane, reading towards the driver)
      for (const dirS of [-1, 1]) {
        const d = cw + 18.5, x = c.mx + rd.x * dirS * d, zz = c.mz + rd.z * dirS * d;
        const lo = (dirS > 0 ? -1 : 1) * hwR * 0.5; // left-hand traffic: approach lane is on the driver's left
        this.decals.add(x + rx * lo * (c.edge.lb > 0 ? 1 : 0), 0.095, zz + rz * lo * (c.edge.lb > 0 ? 1 : 0), yawOf(rd.x * dirS, rd.z * dirS), 2.6, 1, 1.3, decUV(DEC.slow));
      }
      z++;
    }
    this.zebras = z; this.bollardCount = bz;
  }

  // ---------------------------------------------------------------- bins, hydrants, speed signs, tree grates, bus-stop boxes
  buildFurniture() {
    const net = this.game.roadnet, city = this.game.city;
    const bin = mergeGeometries([box(0.52, 0.86, 0.42, 0, 0.43, 0, 0x2f6b3a), box(0.56, 0.08, 0.46, 0, 0.9, 0, 0x8a9094), box(0.3, 0.12, 0.02, 0, 0.72, 0.215, 0x111111), box(0.2, 0.06, 0.02, 0, 0.5, 0.215, 0xe8e8e8)]);
    const hyd = mergeGeometries([cyl(0.12, 0.13, 0.62, 0, 0.31, 0, 0xc0161c, 12), colorGeo(new THREE.SphereGeometry(0.13, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.62, 0), 0xe8c21a), cyl(0.05, 0.05, 0.32, 0, 0.42, 0, 0xc0161c, 8).rotateZ(Math.PI / 2).translate(0, 0, 0), cyl(0.16, 0.16, 0.05, 0, 0.03, 0, 0x8a1015, 12)]);
    this.bins = this.pool(bin, this.propMat, { cap: 200, radius: 150, shadow: true, name: 'bin' });
    this.hydrants = this.pool(hyd, this.propMat, { cap: 160, radius: 140, shadow: true, name: 'hydrant' });
    const nearNode = (x, z, r) => { for (const l of net.lanesNear(x, z, r)) { const n = net.nodes[l.to]; if (n.degree >= 3 && Math.hypot(n.x - x, n.z - z) < n.r + r) return true; } return false; };
    let nb = 0, nh = 0, ns = 0;
    const v = new THREE.Vector3(), d = new THREE.Vector3();
    for (const sw of net.sidewalks) {
      const e = sw.edge; if (e.c > 5) continue;
      const P = sw.path, h0 = hash(P.x(0), P.z(0));
      for (let s = 18 + h0 * 50; s < P.length - 10; s += 95 + hash(s, h0) * 60) {
        P.sample(s, v, d); const rx = -d.z * sw.side, rz = d.x * sw.side; // outward (away from road) for this side
        const x = v.x + rx * 1.1, z = v.z + rz * 1.1;
        if (nearNode(x, z, 6) || this.blocked(x, z)) continue;
        this.bins.add(x, 0, z, Math.atan2(-rx, -rz)); nb++;
      }
      for (let s = 40 + h0 * 80; s < P.length - 10; s += 140 + hash(h0, s) * 80) {
        P.sample(s, v, d); const rx = -d.z * sw.side, rz = d.x * sw.side;
        const x = v.x - rx * 1.25, z = v.z - rz * 1.25; // kerb side
        if (nearNode(x, z, 8) || this.blocked(x, z)) continue;
        this.hydrants.add(x, 0, z, Math.atan2(d.x, d.z)); nh++;
      }
    }
    // speed-limit signs on arterials, facing the traffic that reads them (left-hand drive: on the left kerb)
    for (const e of net.edges) {
      if (e.c > 3 || e.y || e.len < 220) continue;
      const kmh = Math.min(80, Math.max(40, Math.round(e.v * 3.6 / 10) * 10));
      const cell = { 40: SIGN.s40, 50: SIGN.s50, 60: SIGN.s60, 70: SIGN.s70, 80: SIGN.s80 }[kmh] ?? SIGN.s50;
      const pts = e.p; const i = Math.floor(pts.length / 4) * 2; if (i + 3 >= pts.length) continue;
      const x0 = pts[i], z0 = pts[i + 1], dx = pts[i + 2] - x0, dz = pts[i + 3] - z0, L = Math.hypot(dx, dz); if (L < 2) continue;
      const tx = dx / L, tz = dz / L;
      for (const dirS of e.o ? [1] : [1, -1]) {
        if (dirS > 0 && !e.lf) continue; if (dirS < 0 && !e.lb) continue;
        // traffic travelling dirS*(tx,tz) keeps left: left kerb = -right
        const lx = tz * dirS, lz = -tx * dirS; // left of travel direction
        const x = x0 + lx * (e.hw + 0.9), z = z0 + lz * (e.hw + 0.9);
        if (this.blocked(x, z)) continue;
        this.signPoles.add(x, 0, z); this.signPlates.add(x, 2.7, z, yawOf(-tx * dirS, -tz * dirS), 1, 1, 1, signUV(cell)); ns++;
      }
    }
    // tree grates under street trees standing in paving
    const T = city.trees; let ng = 0;
    if (T) for (let i = 0; i < T.length; i += 5) {
      const x = T[i], z = T[i + 1];
      if (city.maskAt(x, z, 2) < 110 || city.maskAt(x, z, 1) > 140) continue;
      this.decals.add(x, 0.04, z, hash(x, z) * 0.3, 1.5, 1, 1.5, decUV(DEC.grate, 0.5, 1)); ng++;
    }
    // yellow "BUS STOP" boxes in front of every shelter
    for (const st of this.game.streetProps?.stops || []) {
      const fx = Math.sin(st.yaw), fz = Math.cos(st.yaw); // shelter faces the road
      const x = st.x + fx * 3.6, z = st.z + fz * 3.6;
      const ax = -fz, az = fx;
      this.decals.add(x, 0.095, z, yawOf(-fx, -fz), 3.6, 1, 1.4, decUV(DEC.busStop));
      for (const o of [-1, 1]) for (let k = 0; k < 3; k++) this.decals.add(x + ax * o * (3.0 + k * 2), 0.095, z + az * o * (3.0 + k * 2), yawOf(fx, fz), 2, 1, 0.35, decUV(DEC.yzig));
    }
    // "BUS LANE" in the bus lanes every ~110 m, reading towards the driver
    const bv = new THREE.Vector3(), bd = new THREE.Vector3(); let nbl = 0;
    for (const { l, full } of this.busLanes || []) for (let s = 30; s < l.path.length - 50; s += 110) {
      l.path.sample(s, bv, bd); this.decals.add(bv.x, 0.095, bv.z, yawOf(bd.x, bd.z), 2.7, 1, 2.6, decUV(full ? DEC.busLaneRed : DEC.busLane)); nbl++;
    }
    this.counts = { bins: nb, hydrants: nh, speedSigns: ns, grates: ng, busLanes: this.busLanes?.length || 0, busLaneText: nbl };
  }

  // ---------------------------------------------------------------- overhead pedestrian bridges
  buildBridges() {
    const net = this.game.roadnet, data = this.game.city.data, P = this.game.physics;
    this.bridges = [];
    const anchors = data.pois.filter(p => p.k === 'bus_stop' || p.k === 'subway_entrance');
    const cands = [];
    for (const e of net.edges) {
      if (e.c > 2 || e.y || e.lf + e.lb < 4 || e.len < 110) continue;
      const A = net.nodes[e.a], B = net.nodes[e.b];
      let acc = 0;
      for (let i = 0; i < e.p.length - 2; i += 2) {
        const ax = e.p[i], az = e.p[i + 1], bx = e.p[i + 2], bz = e.p[i + 3], L = Math.hypot(bx - ax, bz - az);
        if (L > 36) {
          const mx = (ax + bx) / 2, mz = (az + bz) / 2;
          const dA = Math.hypot(mx - A.x, mz - A.z), dB = Math.hypot(mx - B.x, mz - B.z);
          if (dA > 45 && dB > 45) {
            const near = anchors.reduce((m, p) => Math.min(m, Math.hypot(p.x - mx, p.z - mz)), 1e9);
            cands.push({ e, x: mx, z: mz, tx: (bx - ax) / L, tz: (bz - az) / L, score: near + hash(mx, mz) * 60 });
          }
        }
        acc += L;
      }
    }
    cands.sort((a, b) => a.score - b.score);
    for (const c of cands) {
      if (this.bridges.length >= 9) break;
      if (this.bridges.some(b => Math.hypot(b.x - c.x, b.z - c.z) < 650)) continue;
      const hw = c.e.hw, S = hw + 4.6, run = 11.4, W2 = 2.8 / 2 + 2.3;
      const rx = -c.tz, rz = c.tx; // across the road
      const at = (u, v) => [c.x + rx * u + c.tx * v, c.z + rz * u + c.tz * v];
      let ok = true;
      for (const u of [-S, 0, S]) { const [x, z] = at(u, 0); if (this.overhead(x, z, 1.0)) ok = false; }
      // columns and stair flights must stay clear of every carriageway (dual carriageways / side roads alongside)
      const laneD = (u, v) => { const [x, z] = at(u, v); return net.nearestLane(x, z, 8, l => l.cls <= 7)?.dist ?? 99; };
      for (const sx of [-1, 1]) if (laneD(sx * (hw + 0.9), 0) < 2.6) ok = false;
      if (!ok) continue;
      // each end's stairs run along the road, up-road or down-road (d = +1 / -1), whichever way the flight and the
      // ground beyond its foot are free of buildings (the real wall colliders, which can sit up to the kerb),
      // street-tree trunks (solid now), water and traffic lanes; no workable way down at either end = no bridge here
      const stairOk = (u, d) => {
        for (const v of [0, 4, 8, run + 1.5]) { const [x, z] = at(u, d * (v + 1.5)); if (this.blocked(x, z)) return false; }
        for (let v = W2; v <= W2 + run + 4.5; v += 1.5) {
          for (const o of [-1.3, 0, 1.3]) { const [x, z] = at(u + o, d * v); if (this.wallAt(x, z)) return false; }
          // only a trunk on the walking line blocks the way (canopies overhanging the stairs are fine)
          const [x, z] = at(u, d * v); if (this.treeAt(x, z, 1.0)) return false;
        }
        for (const v of [0, 4, 8, run]) if (laneD(u, d * (W2 + v)) < 3.4) return false;
        return true;
      };
      const dirs = [];
      for (const u of [-S, S]) { const d = stairOk(u, 1) ? 1 : stairOk(u, -1) ? -1 : 0; if (!d) { ok = false; break; } dirs.push(d); }
      if (!ok) continue;
      const br = { x: c.x, z: c.z, hw, cols: [], stairs: [], dirs };
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) br.cols.push([...at(-sx * (hw + 0.9), sz * 0.8), 'col']);
      [-S, S].forEach((u, k) => { for (const v of [0, run]) br.stairs.push([...at(u, dirs[k] * (W2 + v)), 'stair']); });
      this.bridges.push(br);
      this.buildBridge(c, hw, S, run, at, dirs);
    }
  }
  /** a wall/structure collider at body height here (static colliders only; the ground isn't touched at y >= 1) */
  wallAt(x, z) {
    const W = this.game.physics.world, R = this.game.physics.R;
    const ball = this._probe || (this._probe = new R.Ball(0.5)), q = { x: 0, y: 0, z: 0, w: 1 };
    let hit = false;
    for (const y of [1.0, 2.1]) W.intersectionsWithShape({ x, y, z }, q, ball, () => { hit = true; return false; }, undefined, FILTER.static);
    return hit;
  }
  /** a street-tree trunk within r of (x, z) */
  treeAt(x, z, r) {
    const tc = this.game.treeColliders, veg = this.game.veg; if (!tc || !veg) return false;
    for (let gx = Math.floor((x - r) / 40); gx <= Math.floor((x + r) / 40); gx++) for (let gz = Math.floor((z - r) / 40); gz <= Math.floor((z + r) / 40); gz++)
      for (const i of tc.grid.get(gx * 100003 + gz) || []) if (Math.hypot(veg.pos[i * 2] - x, veg.pos[i * 2 + 1] - z) < r) return true;
    return false;
  }
  // dirs[k]: which way along the road the stairs at end k (u = -S, +S) descend (+1 / -1)
  buildBridge(c, hw, S, run, at, dirs = [1, 1]) {
    const P = this.game.physics, R = P.R;
    const yaw = yawOf(c.tx, c.tz); // local +z = along the road, local +x = across
    const parts = [], lightParts = [];
    const concrete = 0xb7b2a8, steel = 0x6f7a80, roof = 0x7d9aa0;
    const deckY = 5.75, deckT = 0.55, W = 2.8, top = deckY + deckT;
    const span = S * 2 + 2;
    // local x of each end's landing (local x = -u) and the side (+z/-z) its stairs leave from
    const dOf = xc => xc > 0 ? dirs[0] : dirs[1];
    // parapet runs along each side of the deck, with an opening where a landing joins it (or there'd be no way on)
    const segs = sz => {
      const gaps = [-S, S].filter(xc => dOf(xc) * sz > 0).map(xc => [xc - 1.15, xc + 1.15]).sort((a, b) => a[0] - b[0]);
      const out = []; let a = -span / 2;
      for (const [g0, g1] of gaps) { if (g0 > a + 0.05) out.push([a, g0]); a = Math.max(a, g1); }
      if (a < span / 2 - 0.05) out.push([a, span / 2]);
      return out;
    };
    const inGap = (x, sz) => [-S, S].some(xc => dOf(xc) * sz > 0 && Math.abs(x - xc) < 1.3);
    // deck + parapets + planters with bougainvillea
    parts.push(box(span, deckT, W, 0, deckY + deckT / 2, 0, concrete));
    for (const sz of [-1, 1]) {
      for (const [a, b] of segs(sz)) {
        parts.push(box(b - a, 1.05, 0.16, (a + b) / 2, top + 0.52, sz * (W / 2 - 0.08), concrete));
        if (b - a > 0.6) parts.push(box(b - a - 0.2, 0.42, 0.5, (a + b) / 2, top + 0.12, sz * (W / 2 + 0.25), 0x8c8579)); // planter trough hung outside
      }
      for (let x = -span / 2 + 0.6; x < span / 2 - 0.4; x += 0.55) {
        if (inGap(x, sz)) continue;
        // foliage blob + flowers spilling over the edge
        const fx = x + (hash(x, sz) - 0.5) * 0.3;
        const leaf = new THREE.IcosahedronGeometry(0.34 + hash(fx, 3) * 0.12, 0).scale(1.4, 0.8, 1).translate(fx, top + 0.45, sz * (W / 2 + 0.3));
        parts.push(colorGeo(leaf, 0x2f6a2a));
        const fl = new THREE.IcosahedronGeometry(0.22 + hash(fx, 7) * 0.12, 0).scale(1.3, 1.2, 0.8).translate(fx + 0.15, top + 0.35 - hash(fx, 9) * 0.5, sz * (W / 2 + 0.55));
        parts.push(colorGeo(fl, hash(fx, sz + 2) > 0.5 ? 0xd8248c : 0xf05bb0));
      }
    }
    // roof: slightly arched metal on slim posts, light tubes underneath
    const roofY = top + 2.7;
    for (let x = -span / 2 + 0.3; x <= span / 2 - 0.2; x += 4) for (const sz of [-1, 1]) parts.push(box(0.1, 2.7, 0.1, x, top + 1.35, sz * (W / 2 - 0.2), steel));
    for (let k = 0; k < 4; k++) {
      const z0 = -W / 2 - 0.3 + k * (W + 0.6) / 4, z1 = z0 + (W + 0.6) / 4;
      const y0 = roofY + Math.sin(k / 4 * Math.PI) * 0.35, y1 = roofY + Math.sin((k + 1) / 4 * Math.PI) * 0.35;
      const g = new THREE.BufferGeometry();
      const v = [-span / 2, y0, z0, span / 2, y0, z0, span / 2, y1, z1, -span / 2, y1, z1];
      g.setAttribute('position', new THREE.Float32BufferAttribute([v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[0], v[1], v[2], v[6], v[7], v[8], v[9], v[10], v[11],
        v[0], v[1] - 0.04, v[2], v[6], v[7] - 0.04, v[8], v[3], v[4] - 0.04, v[5], v[0], v[1] - 0.04, v[2], v[9], v[10] - 0.04, v[11], v[6], v[7] - 0.04, v[8]], 3));
      g.computeVertexNormals();
      parts.push(colorGeo(g, k % 2 ? roof : 0x86a3a8));
    }
    for (let x = -span / 2 + 2; x < span / 2 - 1; x += 3) lightParts.push(new THREE.BoxGeometry(1.2, 0.05, 0.1).translate(x, roofY - 0.05, 0));
    // columns just outside the carriageway
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(0.55, deckY, 0.55, sx * (hw + 0.9), deckY / 2, sz * 0.8, concrete));
    // stairs: from each deck end down along the road (+z), with stringer walls and handrails
    const steps = Math.round(top / 0.165), rise = top / steps, tread = run / steps;
    for (const sx of [-1, 1]) {
      const xc = sx * S, d = dOf(xc);
      // landing joining the deck end (with side rails: it overhangs the footway)
      parts.push(box(2.2, deckT, 2.6, xc, deckY + deckT / 2, d * (W / 2 + 1.0), concrete));
      for (const rx of [-1.12, 1.12]) parts.push(box(0.1, 1.05, 2.3, xc + rx, top + 0.52, d * (W / 2 + 1.15), concrete));
      for (let i = 0; i < steps; i++) {
        const zz = W / 2 + 2.3 + i * tread, h = top - i * rise;
        parts.push(box(2.0, h, tread + 0.01, xc, h / 2, d * (zz + tread / 2), i % 2 ? 0xa9a49a : 0xb3aea4));
      }
      for (const wx of [-1.08, 1.08]) {
        // stringer wall following the slope + handrail
        const g = new THREE.BufferGeometry(), z0 = d * (W / 2 + 2.3), z1 = z0 + d * run;
        const x0 = xc + wx;
        g.setAttribute('position', new THREE.Float32BufferAttribute([x0, top + 0.9, z0, x0, 0.9, z1, x0, 0, z1, x0, top + 0.9, z0, x0, 0, z1, x0, top - deckT, z0], 3));
        g.computeVertexNormals();
        const g2 = g.clone(); { const a = g2.attributes.position.array; for (let i = 0; i < a.length; i += 9) { const t = [a[i + 3], a[i + 4], a[i + 5]]; a[i + 3] = a[i + 6]; a[i + 4] = a[i + 7]; a[i + 5] = a[i + 8]; a[i + 6] = t[0]; a[i + 7] = t[1]; a[i + 8] = t[2]; } g2.computeVertexNormals(); }
        parts.push(colorGeo(g, concrete), colorGeo(g2, concrete));
      }
      // roof over the stairs (stepped down in 3 sections)
      for (let k = 0; k < 3; k++) {
        const za = W / 2 + 2.3 + k * run / 3, ry = roofY - (k + 0.5) * (top / 3) * 0.95;
        parts.push(box(2.6, 0.06, run / 3 + 0.2, xc, ry, d * (za + run / 6), roof));
        parts.push(box(0.08, 2.6, 0.08, xc - 1.2, ry - 1.3, d * (za + run / 6), steel), box(0.08, 2.6, 0.08, xc + 1.2, ry - 1.3, d * (za + run / 6), steel));
      }
      // physics: stair ramp (wedge) — mesh frame (x across, z along) maps to world as at(-x, z)
      const z0 = d * (W / 2 + 2.3), z1 = z0 + d * run, wedge = [];
      for (const [lx, ly, lz] of [[-1, 0, z0], [1, 0, z0], [-1, top, z0], [1, top, z0], [-1, 0, z1], [1, 0, z1]]) { const [wx2, wz2] = at(-(xc + lx), lz); wedge.push(wx2, ly, wz2); }
      const cdesc = R.ColliderDesc.convexHull(new Float32Array(wedge)); if (cdesc) P.world.createCollider(cdesc.setCollisionGroups(FILTER.static).setFriction(0.8));
    }
    const geo = mergeGeometries(parts.map(g => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'color'].includes(k)) n.deleteAttribute(k); return n; }));
    const mesh = new THREE.Mesh(geo, this.propMat);
    mesh.position.set(c.x, 0, c.z); mesh.rotation.y = yaw; // local z along the road, local x across (mirrored vs at(), the bridge is symmetric)
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'footbridge';
    mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
    this.game.scene.add(mesh);
    const lg = mergeGeometries(lightParts); const lm = new THREE.Mesh(lg, this.lightMat); lm.position.copy(mesh.position); lm.rotation.copy(mesh.rotation); lm.updateMatrix(); lm.matrixAutoUpdate = false; this.game.scene.add(lm);
    // physics: deck, parapets, columns
    const addBox = (cx, cy, cz, hx, hy, hz) => { const [wx, wz] = at(-cx, cz); P.addStatic({ type: 'box', center: [wx, cy, wz], half: [hx, hy, hz], yaw }); };
    addBox(0, deckY + deckT / 2, 0, span / 2, deckT / 2, W / 2);
    for (const sz of [-1, 1]) for (const [a, b] of segs(sz)) addBox((a + b) / 2, top + 0.55, sz * (W / 2 - 0.08), (b - a) / 2, 0.55, 0.08);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(sx * (hw + 0.9), deckY / 2, sz * 0.8, 0.28, deckY / 2, 0.28);
    for (const sx of [-1, 1]) {
      const d = dOf(sx * S);
      addBox(sx * S, deckY + deckT / 2, d * (W / 2 + 1.0), 1.1, deckT / 2, 1.3);
      for (const rx of [-1.12, 1.12]) addBox(sx * S + rx, top + 0.55, d * (W / 2 + 1.15), 0.06, 0.55, 1.15);
    }
  }

  refresh(x, z) { for (const p of this.pools) p.refresh(x, z); this.lastRefresh.set(x, 0, z); }

  update(dt) {
    const cp = this.game.camera.position;
    if (Math.hypot(cp.x - this.lastRefresh.x, cp.z - this.lastRefresh.z) > 30) this.refresh(cp.x, cp.z);
    for (const ch of this.chunks) ch.mesh.visible = Math.hypot(ch.x - cp.x, ch.z - cp.z) < 420;
    const night = U.night.value;
    // Belisha beacons flash (~1 Hz); signs glow faintly in headlights at night; linkway/bridge tubes light up after dusk
    this.globeMat.emissiveIntensity = (Math.sin(U.time.value * Math.PI * 2 * 0.9) > 0 ? 2.6 : 0.25) * (0.5 + night);
    this.nameMat.emissiveIntensity = this.signMat.emissiveIntensity = this.dirMat.emissiveIntensity = 0.04 + night * 0.25;
    this.lightMat.emissiveIntensity = night > 0.15 ? 2.2 * Math.min(1, night * 1.5) : 0;
  }
}
