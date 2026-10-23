// Instanced street & park trees, Singapore species: rain tree (with bird's-nest-fern epiphytes), flame of the forest,
// angsana, tembusu, yellow flame, pink trumpet (tabebuia), coconut & royal palms, bougainvillea shrubs.
// Near LOD: branch skeletons grown by space colonisation inside a species crown envelope (trunk, limbs, twigs with
// pipe-model radii) carrying clumps of alpha-tested leaf cards from a canvas-painted atlas. The atlas has
// coverage-preserving mipmaps so canopies don't thin out with distance. Shading: clump + crown blended normals,
// baked ambient occlusion, per-tree hue variation, sun translucency, a shadow-independent sky fill and warm
// street-lamp bounce under low canopies at night.
// Mid LOD: same skeleton, few big cards. Far LOD: envelope-shaped lumpy blob tinted to the atlas average.
import * as THREE from 'three';
import { U } from '../gfx/globals.js';
import { HF, HF_GLSL } from '../gfx/heightfield.js';
import { withLampField } from '../gfx/lampfield.js';
import { NOISE } from '../gfx/shaderlib.js';
import { REFLECT_LAYER } from './water.js';
import { WATER_LEVEL } from '../core/constants.js';

let seed = 99;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const setSeed = s => { seed = (Math.abs(Math.floor(s)) % 2147483646) + 1; };
const rr = (a, b) => a + rnd() * (b - a);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const X_AXIS = V3(1, 0, 0), Y_AXIS = V3(0, 1, 0);
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- leaf atlas: 4x2 tiles of 512 px
const AW = 2048, AH = 1024, TS = 512;
const TILE = { fine: [0, 0], broad: [1, 0], dark: [2, 0], yellow: [3, 0], palm: [0, 1], red: [1, 1], pink: [2, 1], fern: [3, 1] };
const SOLID_UV = [1 - 5 / AW, 1 - 5 / AH]; // canvas top-right corner, painted opaque white (bark samples here)
const tileUV = name => { const [tx, ty] = TILE[name]; return [tx * TS / AW, 1 - (ty + 1) * TS / AH, (tx + 1) * TS / AW, 1 - ty * TS / AH]; }; // u0, vBottom, u1, vTop

let _atlas = null;
function leafAtlas() {
  if (_atlas) return _atlas;
  const c = document.createElement('canvas'); c.width = AW; c.height = AH;
  const g = c.getContext('2d', { willReadFrequently: true });
  const R = Math.random;
  const hsl = (h, s, l, a = 1) => `hsla(${h.toFixed(1)},${Math.max(0, s).toFixed(1)}%,${Math.min(96, Math.max(3, l)).toFixed(1)}%,${a})`;
  // pointed leaf with a lit upper half, shaded lower half and a pale midrib
  const leaf = (x, y, len, wid, rot, h, s, l, rib = true) => {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.beginPath(); g.moveTo(-len * 0.5, 0);
    g.quadraticCurveTo(-len * 0.05, -wid, len * 0.5, 0);
    g.quadraticCurveTo(-len * 0.05, wid, -len * 0.5, 0);
    const gr = g.createLinearGradient(0, -wid, 0, wid);
    gr.addColorStop(0, hsl(h - 5, s, l + 10)); gr.addColorStop(0.5, hsl(h, s, l)); gr.addColorStop(1, hsl(h + 6, s * 0.9, l - 8));
    g.fillStyle = gr; g.fill();
    if (rib && len > 12) { g.strokeStyle = hsl(h + 6, s * 0.55, l + 16, 0.5); g.lineWidth = Math.max(0.6, len / 42); g.beginPath(); g.moveTo(-len * 0.5, 0); g.lineTo(len * 0.4, 0); g.stroke(); }
    g.restore();
  };
  const twig = (x0, y0, x1, y1, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  const flower5 = (x, y, r, h, s, l, rot) => {
    for (let p = 0; p < 5; p++) { const a = rot + p * 1.2566; leaf(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 1.15, r * 0.55, a, h + R() * 6 - 3, s, l + R() * 8 - 4, false); }
    g.fillStyle = hsl(h + 25, s, l + 20); g.beginPath(); g.arc(x, y, r * 0.22, 0, 6.283); g.fill();
  };
  // lighting inside a painted clump: lit from above, darker towards the lower/inner leaves
  const shade = (y, oy, x, ox) => (oy + 256 - y) / 512 * 14 + Math.hypot(x - ox - 256, y - oy - 256) / 256 * 5;
  const inTile = (name, fn) => { const [tx, ty] = TILE[name], ox = tx * TS, oy = ty * TS; g.save(); g.beginPath(); g.arc(ox + 256, oy + 256, 248, 0, Math.PI * 2); g.clip(); fn(ox, oy, ox + 256, oy + 256); g.restore(); };
  // bipinnate spray (rain tree / flame trees): rachis with pinnae carrying pairs of tiny leaflets
  const bipinnate = (ox, oy, cx, cy, sprays, hue, sat, lig, spread = 1) => {
    for (let k = 0; k < sprays; k++) {
      const a = (k / sprays) * Math.PI * 2 + R() * 0.5, len = (110 + R() * 120) * spread;
      const sx = cx + Math.cos(a) * R() * 45, sy = cy + Math.sin(a) * R() * 45, ex = sx + Math.cos(a) * len, ey = sy + Math.sin(a) * len * 0.92;
      twig(sx, sy, ex, ey, 2.2, 'rgba(78,64,44,0.95)');
      const nP = 6 + (R() * 4 | 0);
      for (let p = 1; p <= nP; p++) {
        const t = p / (nP + 1), px = sx + (ex - sx) * t, py = sy + (ey - sy) * t;
        for (const side of [-1, 1]) {
          const pa = a + side * (0.85 + R() * 0.35), plen = (30 + R() * 22) * (1 - t * 0.4);
          const qx = px + Math.cos(pa) * plen, qy = py + Math.sin(pa) * plen;
          twig(px, py, qx, qy, 0.9, 'rgba(90,96,46,0.85)');
          for (let q = 0; q < 6; q++) {
            const u = (q + 0.6) / 6.4, lx = px + (qx - px) * u, ly = py + (qy - py) * u, sh = shade(ly, oy, lx, ox);
            for (const s2 of [-1, 1]) leaf(lx + Math.cos(pa + s2 * 1.45) * 4.4, ly + Math.sin(pa + s2 * 1.45) * 4.4, 8.5 + R() * 3.5, 3.1 + R() * 0.8, pa + s2 * 1.15, hue + R() * 14 - 7, sat + R() * 12 - 6, lig + sh + R() * 9 - 4, false);
          }
        }
      }
    }
  };
  // pinnate spray: alternate ovate leaflets along a drooping rachis (angsana)
  const pinnate = (ox, oy, cx, cy, sprays, hue, sat, lig, lw = 38, ww = 15) => {
    for (let k = 0; k < sprays; k++) {
      const a = (k / sprays) * Math.PI * 2 + R() * 0.45, len = 120 + R() * 90;
      const sx = cx + Math.cos(a) * R() * 60, sy = cy + Math.sin(a) * R() * 60;
      let x = sx, y = sy, d = a;
      for (let s = 0; s < 7; s++) {
        const nx = x + Math.cos(d) * len / 7, ny = y + Math.sin(d) * len / 7 + 3; // droops
        twig(x, y, nx, ny, 1.6, 'rgba(84,80,50,0.9)');
        const side = s % 2 ? 1 : -1, la = d + side * (0.75 + R() * 0.3), L = lw * (0.85 + R() * 0.3);
        const sh = shade(ny, oy, nx, ox);
        leaf(nx + Math.cos(la) * L * 0.5, ny + Math.sin(la) * L * 0.5, L, ww * (0.85 + R() * 0.3), la, hue + R() * 12 - 6, sat + R() * 10 - 5, lig + sh + R() * 10 - 5);
        x = nx; y = ny; d += (R() - 0.5) * 0.25;
      }
      const sh = shade(y, oy, x, ox);
      leaf(x + Math.cos(d) * lw * 0.45, y + Math.sin(d) * lw * 0.45, lw, ww, d, hue, sat, lig + sh);
    }
  };

  // fine: rain tree — bright mid green feathery bipinnate foliage
  inTile('fine', (ox, oy, cx, cy) => bipinnate(ox, oy, cx, cy, 17, 94, 46, 27));
  // broad: angsana — light, slightly yellow-green pinnate leaves
  inTile('broad', (ox, oy, cx, cy) => pinnate(ox, oy, cx, cy, 16, 84, 52, 33));
  // dark: tembusu — small, dark glossy opposite leaves, dense
  inTile('dark', (ox, oy, cx, cy) => {
    for (let k = 0; k < 26; k++) {
      const a = R() * Math.PI * 2, r0 = R() * 120, sx = cx + Math.cos(a) * r0, sy = cy + Math.sin(a) * r0, len = 70 + R() * 70;
      const ex = sx + Math.cos(a) * len, ey = sy + Math.sin(a) * len;
      twig(sx, sy, ex, ey, 1.4, 'rgba(60,52,40,0.9)');
      for (let q = 0; q < 9; q++) {
        const t = (q + 0.5) / 9, x = sx + (ex - sx) * t, y = sy + (ey - sy) * t;
        for (const s of [-1, 1]) { const la = a + s * (0.9 + R() * 0.3); leaf(x + Math.cos(la) * 10, y + Math.sin(la) * 10, 20 + R() * 7, 7 + R() * 2, la, 122 + R() * 12, 34 + R() * 8, 19 + shade(y, oy, x, ox) + R() * 7); }
      }
    }
  });
  // yellow: yellow flame — feathery leaves + upright panicles of yellow blossoms and rusty pods
  inTile('yellow', (ox, oy, cx, cy) => {
    bipinnate(ox, oy, cx, cy, 11, 96, 44, 28, 0.9);
    for (let k = 0; k < 20; k++) {
      const a = R() * Math.PI * 2, r0 = Math.sqrt(R()) * 190, px = cx + Math.cos(a) * r0, py = cy + Math.sin(a) * r0;
      for (let f = 0; f < 14; f++) { const t = f / 14; flower5(px + (R() - 0.5) * 34 * (1 - t), py - t * 60 + (R() - 0.5) * 8, 5 + R() * 3, 47 + R() * 6, 92, 58 + R() * 10, R() * 6); }
      if (R() < 0.35) for (let f = 0; f < 3; f++) leaf(px + (R() - 0.5) * 30, py + 20 + R() * 10, 22, 6, 1.4 + R() * 0.4, 14, 55, 30);
    }
  });
  // palm: one frond — central rachis (vertical) with long drooping leaflets both sides; base at the bottom
  {
    const [tx, ty] = TILE.palm, ox = tx * TS, oy = ty * TS, cx = ox + 256;
    g.save(); g.beginPath(); g.rect(ox + 1, oy + 1, TS - 2, TS - 2); g.clip();
    g.strokeStyle = '#7a7a3a'; g.lineWidth = 7; g.beginPath(); g.moveTo(cx, oy + 508); g.lineTo(cx, oy + 6); g.stroke();
    for (let y = oy + 500; y > oy + 10; y -= 6.5) {
      const t = (oy + 508 - y) / 500, len = Math.sin(Math.min(1, t * 1.15) * Math.PI) * 225 + 18;
      for (const s of [-1, 1]) {
        g.save(); g.translate(cx, y); g.rotate(s * (0.42 + 0.25 * t) - Math.PI / 2 * 0);
        const h = 74 + R() * 12, l = 30 + R() * 10 + (1 - t) * 4;
        g.fillStyle = hsl(h, 46, l);
        g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(s * len * 0.5, -8, s * len, 14 + t * 26); g.quadraticCurveTo(s * len * 0.5, 3, 0, 4); g.fill();
        g.strokeStyle = hsl(h - 6, 30, l + 16, 0.5); g.lineWidth = 0.8; g.beginPath(); g.moveTo(0, 2); g.quadraticCurveTo(s * len * 0.5, -2, s * len, 14 + t * 26); g.stroke();
        g.restore();
      }
    }
    g.restore();
  }
  // red: flame of the forest — light feathery leaves + scarlet flower clusters (one petal streaked white/yellow)
  inTile('red', (ox, oy, cx, cy) => {
    bipinnate(ox, oy, cx, cy, 12, 92, 50, 33, 0.95);
    for (let k = 0; k < 24; k++) {
      const a = R() * Math.PI * 2, r0 = Math.sqrt(R()) * 195, px = cx + Math.cos(a) * r0, py = cy + Math.sin(a) * r0;
      for (let f = 0; f < 9; f++) {
        const fx = px + (R() - 0.5) * 46, fy = py + (R() - 0.5) * 40, rot = R() * 6;
        flower5(fx, fy, 8 + R() * 4, 6 + R() * 6, 86, 46 + R() * 8, rot);
        leaf(fx + Math.cos(rot) * 5, fy + Math.sin(rot) * 5, 9, 4, rot, 45, 70, 82, false);
      }
    }
  });
  // pink: pink trumpet tree in bloom — masses of pale pink trumpets with a few palmate leaves behind
  inTile('pink', (ox, oy, cx, cy) => {
    pinnate(ox, oy, cx, cy, 7, 100, 40, 28, 34, 13);
    for (let k = 0; k < 34; k++) {
      const a = R() * Math.PI * 2, r0 = Math.sqrt(R()) * 200, px = cx + Math.cos(a) * r0, py = cy + Math.sin(a) * r0;
      for (let f = 0; f < 8; f++) {
        const fx = px + (R() - 0.5) * 40, fy = py + (R() - 0.5) * 36, rot = R() * 6.28;
        leaf(fx, fy, 22 + R() * 6, 10 + R() * 3, rot, 326 + R() * 12, 55 + R() * 15, 72 + R() * 10 + shade(fy, oy, fx, ox) * 0.5, false);
        g.fillStyle = hsl(50, 70, 75, 0.8); g.beginPath(); g.arc(fx + Math.cos(rot) * 6, fy + Math.sin(rot) * 6, 1.8, 0, 6.283); g.fill();
      }
    }
  });
  // fern: bird's nest fern rosette (rain-tree epiphyte) — broad strap fronds from a brown core
  inTile('fern', (ox, oy, cx, cy) => {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2 + R() * 0.2, len = 170 + R() * 70, w = 24 + R() * 10;
      leaf(cx + Math.cos(a) * len * 0.5, cy + Math.sin(a) * len * 0.5, len, w, a, 84 + R() * 10, 58, 38 + R() * 10);
    }
    g.fillStyle = 'rgba(70,50,30,1)'; g.beginPath(); g.arc(cx, cy, 22, 0, 6.283); g.fill();
  });
  // opaque white corner for bark
  g.fillStyle = '#ffffff'; g.fillRect(AW - 10, 0, 10, 10);

  const { levels, avg } = coverageMips(c);
  const tex = new THREE.CanvasTexture(c);
  tex.mipmaps = levels; tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  _atlas = { tex, avg };
  return _atlas;
}

// Alpha-tested foliage thins out in plain mipmaps (averaged alpha drops under the cutoff). Each level is rescaled so
// the fraction of texels above the cutoff matches the full-resolution coverage of its tile. Also returns each tile's
// average linear colour (for far-LOD blobs).
function coverageMips(canvas) {
  const CUT = Math.round(0.42 * 255), ntx = AW / TS, nty = AH / TS;
  const d0 = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, AW, AH).data;
  const target = new Float32Array(ntx * nty), avg = {};
  const lin = v => Math.pow(v / 255, 2.2);
  for (const [name, [tx, ty]] of Object.entries(TILE)) {
    let n = 0, r = 0, gg = 0, b = 0;
    for (let y = ty * TS; y < (ty + 1) * TS; y += 2) for (let x = tx * TS; x < (tx + 1) * TS; x += 2) {
      const i = (y * AW + x) * 4; if (d0[i + 3] < CUT) continue;
      n++; r += lin(d0[i]); gg += lin(d0[i + 1]); b += lin(d0[i + 2]);
    }
    target[ty * ntx + tx] = n / (TS * TS / 4);
    avg[name] = n ? [r / n, gg / n, b / n] : [0.05, 0.1, 0.03];
  }
  const levels = [canvas];
  let prev = canvas, w = AW, h = AH;
  while (w > 1 || h > 1) {
    w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(prev, 0, 0, w, h);
    const ts = w / ntx;
    if (ts >= 2 && h / nty >= 2) {
      const id = x.getImageData(0, 0, w, h), d = id.data, hist = new Uint32Array(256);
      for (let ty = 0; ty < nty; ty++) for (let tx = 0; tx < ntx; tx++) {
        hist.fill(0); let n = 0;
        for (let y = ty * ts; y < (ty + 1) * ts; y++) for (let xx = tx * ts; xx < (tx + 1) * ts; xx++) { hist[d[(y * w + xx) * 4 + 3]]++; n++; }
        const want = target[ty * ntx + tx] * n; let cum = 0, aStar = CUT;
        for (let a = 255; a >= 1; a--) { cum += hist[a]; if (cum >= want) { aStar = a; break; } }
        const k = CUT / Math.max(1, aStar);
        if (Math.abs(k - 1) < 0.01) continue;
        for (let y = ty * ts; y < (ty + 1) * ts; y++) for (let xx = tx * ts; xx < (tx + 1) * ts; xx++) { const i = (y * w + xx) * 4 + 3; d[i] = Math.min(255, d[i] * k); }
      }
      x.putImageData(id, 0, 0);
    }
    levels.push(c); prev = c;
  }
  return { levels, avg };
}

// ---------------------------------------------------------------- geometry accumulation
// per vertex: position, shading normal, uv, colour (linear multiplier), aAO (baked occlusion), aLeaf (sway weight), aKind
// aKind: 0 bark, 1 foliage card, 2 ringed palm trunk, 3 smooth trunk / crownshaft
class GB {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.ao = []; this.lf = []; this.k = []; }
  v(p, n, u, v, col, ao, lf, kind) { this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.uv.push(u, v); this.c.push(col[0], col[1], col[2]); this.ao.push(ao); this.lf.push(lf); this.k.push(kind); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aAO', new THREE.Float32BufferAttribute(this.ao, 1));
    g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(this.lf, 1));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.k, 1));
    g.computeBoundingSphere();
    return g;
  }
}
const _t = V3(), _b = V3(), _n = V3(), _q0 = V3(), _q1 = V3();
// tapered open tube a→b
function tube(G, a, b, r0, r1, sides, col, kind = 0, ao = 0.85) {
  const axis = _n.subVectors(b, a); const len = axis.length(); if (len < 1e-3) return; axis.divideScalar(len);
  _t.crossVectors(axis, Math.abs(axis.y) > 0.9 ? X_AXIS : Y_AXIS).normalize(); _b.crossVectors(axis, _t);
  const ring = (c, r, i) => { const a2 = i / sides * Math.PI * 2, cs = Math.cos(a2), sn = Math.sin(a2); return { p: V3(c.x + (_t.x * cs + _b.x * sn) * r, c.y + (_t.y * cs + _b.y * sn) * r, c.z + (_t.z * cs + _b.z * sn) * r), n: V3(_t.x * cs + _b.x * sn, _t.y * cs + _b.y * sn, _t.z * cs + _b.z * sn) }; };
  const [u, v] = SOLID_UV, cv = 0.9 + rnd() * 0.2, cc = [col[0] * cv, col[1] * cv, col[2] * cv];
  for (let i = 0; i < sides; i++) {
    const A = ring(a, r0, i), B = ring(a, r0, i + 1), C = ring(b, r1, i + 1), D = ring(b, r1, i);
    for (const P of [A, B, C, A, C, D]) G.v(P.p, P.n, u, v, cc, ao, 1, kind);
  }
}
// one leaf card: centre p, plane basis (t,b) scaled, shading normal n
function card(G, p, t, b, sx, sy, n, uvr, col, ao) {
  const [u0, v0, u1, v1] = uvr;
  const P = [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]].map(([x, y, u, v]) => ({ p: V3(p.x + t.x * x * sx + b.x * y * sy, p.y + t.y * x * sx + b.y * y * sy, p.z + t.z * x * sx + b.z * y * sy), u, v }));
  for (const k of [0, 1, 2, 0, 2, 3]) G.v(P[k].p, n, P[k].u, P[k].v, col, ao, 1, 1);
}
// clump of leaf cards in an ellipsoid. style: 'flat' (layered, mostly horizontal), 'hang' (vertical, drooping), 'random'
function clump(G, c, rad, count, size, tile, style, crown, exposure, tint) {
  const uvr = tileUV(tile);
  for (let i = 0; i < count; i++) {
    let dx, dy, dz, l2;
    do { dx = rnd() * 2 - 1; dy = rnd() * 2 - 1; dz = rnd() * 2 - 1; l2 = dx * dx + dy * dy + dz * dz; } while (l2 > 1 || l2 < 0.04);
    const rIn = Math.sqrt(l2), push = Math.pow(rIn, 0.55) / rIn;
    const hangOff = style === 'hang' ? -size * 0.45 : 0;
    const p = V3(c.x + dx * push * rad, c.y + dy * push * rad * 0.6 + hangOff, c.z + dz * push * rad);
    // shading normal: clump-outward blended with crown-outward (each clump reads as its own lit volume)
    const n1 = V3(dx, dy * 0.7 + 0.3, dz).normalize();
    const n2 = V3(c.x - crown.x, (c.y - crown.y) * 1.3 + 1.0, c.z - crown.z).normalize();
    const nrm = n1.multiplyScalar(0.55).addScaledVector(n2, 0.45).normalize();
    let pn;
    if (style === 'flat' && rnd() < 0.6) pn = V3((rnd() - 0.5) * 1.4, 1.0, (rnd() - 0.5) * 1.4).normalize();
    else if (style === 'hang') pn = V3(rnd() - 0.5, (rnd() - 0.5) * 0.2, rnd() - 0.5).normalize();
    else pn = V3(rnd() - 0.5, rnd() - 0.3, rnd() - 0.5).normalize();
    const t = V3().crossVectors(pn, Math.abs(pn.y) > 0.9 ? X_AXIS : Y_AXIS).normalize(), b = V3().crossVectors(pn, t);
    if (style !== 'hang') { const s = rnd() * Math.PI * 2, cs = Math.cos(s), sn = Math.sin(s); const t2 = t.clone().multiplyScalar(cs).addScaledVector(b, sn); b.multiplyScalar(cs).addScaledVector(t, -sn); t.copy(t2); }
    const sz = size * (0.75 + rnd() * 0.5);
    const cv = 0.86 + rnd() * 0.28;
    card(G, p, t, b, sz / 2, (style === 'hang' ? 1.45 : 1) * sz / 2, nrm, uvr, [tint[0] * cv, tint[1] * cv, tint[2] * cv], exposure * (0.45 + 0.55 * rIn));
  }
}

// ---------------------------------------------------------------- space colonisation
// grows a branching skeleton from a trunk polyline toward attraction points sampled inside the crown envelope
function colonize(S) {
  const X = [], Y = [], Z = [], par = [], kids = [];
  const cell = S.influence, grid = new Map();
  const key = (cx, cy, cz) => (cx + 512) * 1048576 + (cy + 512) * 1024 + (cz + 512);
  const add = (x, y, z, p) => {
    const i = X.length; X.push(x); Y.push(y); Z.push(z); par.push(p); kids.push([]); if (p >= 0) kids[p].push(i);
    const k = key(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell)); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(i);
    return i;
  };
  let prev = -1;
  for (const p of S.trunk) prev = add(p.x, p.y, p.z, prev);
  // attraction points: rejection-sample the envelope, biased to the outer leafy shell
  const [x0, x1, y0, y1, z0, z1] = S.box, ax = [], ay = [], az = [];
  for (let tries = 0; ax.length < S.nAttr && tries < S.nAttr * 60; tries++) {
    const x = rr(x0, x1), y = rr(y0, y1), z = rr(z0, z1), e = S.env(x, y, z);
    if (e >= 1) continue;
    if (rnd() > (S.shell ?? 0.15) + (1 - (S.shell ?? 0.15)) * e * e * e) continue;
    ax.push(x); ay.push(y); az.push(z);
  }
  const nA = ax.length, alive = new Uint8Array(nA).fill(1), inf2 = S.influence ** 2, kill2 = S.kill ** 2, acc = new Map();
  let left = nA;
  const tr = S.tropism || [0, 0.1, 0];
  for (let it = 0; it < (S.iters || 80) && left > 0; it++) {
    acc.clear();
    for (let a = 0; a < nA; a++) {
      if (!alive[a]) continue;
      const cx = Math.floor(ax[a] / cell), cy = Math.floor(ay[a] / cell), cz = Math.floor(az[a] / cell);
      let best = -1, bd = inf2;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const l = grid.get(key(cx + dx, cy + dy, cz + dz)); if (!l) continue;
        for (const n of l) { const ex = ax[a] - X[n], ey = ay[a] - Y[n], ez = az[a] - Z[n], d2 = ex * ex + ey * ey + ez * ez; if (d2 < bd) { bd = d2; best = n; } }
      }
      if (best < 0) continue;
      if (bd < kill2) { alive[a] = 0; left--; continue; }
      const d = Math.sqrt(bd); let v = acc.get(best); if (!v) acc.set(best, v = [0, 0, 0, 0]);
      v[0] += (ax[a] - X[best]) / d; v[1] += (ay[a] - Y[best]) / d; v[2] += (az[a] - Z[best]) / d; v[3]++;
    }
    if (!acc.size) break;
    let grew = 0;
    for (const [n, v] of acc) {
      let dx = v[0] / v[3] + tr[0], dy = v[1] / v[3] + tr[1], dz = v[2] / v[3] + tr[2];
      const l = Math.hypot(dx, dy, dz); if (l < 1e-4) continue;
      dx /= l; dy /= l; dz /= l;
      const x = X[n] + dx * S.step, y = Y[n] + dy * S.step, z = Z[n] + dz * S.step;
      if (kids[n].some(k => Math.abs(X[k] - x) + Math.abs(Y[k] - y) + Math.abs(Z[k] - z) < 0.05)) continue; // oscillation guard
      add(x, y, z, n); grew++;
    }
    if (!grew) break;
  }
  // pipe-model radii (children are always created after their parents)
  const N = X.length, r = new Float32Array(N), E = 2.3;
  for (let i = N - 1; i >= 0; i--) { if (!kids[i].length) r[i] = 1; else { let s = 0; for (const c of kids[i]) s += Math.pow(r[c], E); r[i] = Math.pow(s, 1 / E); } }
  const k = (S.rBase - S.rTip) / Math.max(1e-3, r[0] - 1);
  for (let i = 0; i < N; i++) r[i] = S.rTip + (r[i] - 1) * k;
  const pos = i => V3(X[i], Y[i], Z[i]);
  return { N, pos, par, kids, r, X, Y, Z };
}

// continuous tube along a polyline (parallel-transport frames: no seams or twists at the joints)
function sweep(G, pts, rads, sides, col, kind = 0, ao = 0.85) {
  const n = pts.length; if (n < 2) return;
  const [u, v] = SOLID_UV, cv = 0.9 + rnd() * 0.2, cc = [col[0] * cv, col[1] * cv, col[2] * cv];
  let T = V3().subVectors(pts[1], pts[0]).normalize();
  let Nr = V3().crossVectors(T, Math.abs(T.y) > 0.9 ? X_AXIS : Y_AXIS).normalize();
  const rings = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    T = V3().subVectors(b, a).normalize();
    Nr.addScaledVector(T, -Nr.dot(T)).normalize();
    const B = V3().crossVectors(T, Nr), ring = [];
    for (let k = 0; k <= sides; k++) {
      const ang = k / sides * Math.PI * 2, cs = Math.cos(ang), sn = Math.sin(ang);
      const d = V3(Nr.x * cs + B.x * sn, Nr.y * cs + B.y * sn, Nr.z * cs + B.z * sn);
      ring.push({ p: V3().copy(pts[i]).addScaledVector(d, rads[i]), n: d });
    }
    rings.push(ring);
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < sides; k++) {
    const A = rings[i][k], B = rings[i][k + 1], C = rings[i + 1][k + 1], D = rings[i + 1][k];
    for (const P of [A, B, C, A, C, D]) G.v(P.p, P.n, u, v, cc, ao, 1, kind);
  }
}

// skeleton → bark: one continuous sweep per branch (branch point → next branch point / tip), sampling every
// `stride` nodes; branches thinner than rMin are left to the leaves. flare widens the trunk foot + shallow roots.
function barkFromSkeleton(G, sk, { stride = 2, rMin = 0.04, sideFn, col, flare = 0 }) {
  const walk = start => {
    for (const c of sk.kids[start]) {
      const ids = [start, c];
      let n = c, steps = 0;
      while (sk.kids[n].length === 1) { n = sk.kids[n][0]; if (++steps % stride === 0 || sk.kids[n].length !== 1) ids.push(n); }
      if (ids[ids.length - 1] !== n) ids.push(n);
      // drop the thin end of the branch
      let m = ids.length; while (m > 2 && sk.r[ids[m - 1]] < rMin) m--;
      if (sk.r[ids[1]] >= rMin) {
        const pts = [], rads = [];
        for (let i = 0; i < m; i++) {
          const id = ids[i]; let r = i === 0 ? Math.min(sk.r[start], sk.r[c] * 1.12) : sk.r[id];
          const p = sk.pos(id);
          if (start === 0 && flare > 0 && p.y < 1.4) r *= 1 + flare * 0.7 * Math.pow(1 - Math.max(0, p.y + 0.3) / 1.7, 2);
          pts.push(p); rads.push(r);
        }
        if (start === 0 && flare > 0) { pts.splice(1, 0, V3().lerpVectors(pts[0], pts[1], 0.35)); rads.splice(1, 0, sk.r[0] * (1 + flare * 0.45)); }
        sweep(G, pts, rads, sideFn(rads[1]), col, 0, 0.8);
      }
      if (sk.kids[n].length) walk(n);
    }
  };
  walk(0);
  // shallow surface roots
  if (flare > 0) {
    const r0 = sk.r[0];
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + rnd() * 0.6, L = r0 * (1.7 + rnd() * 1.0);
      const pts = [V3(Math.cos(a) * r0 * 0.5, 0.35 * flare, Math.sin(a) * r0 * 0.5), V3(Math.cos(a) * r0 * 1.25, 0.02, Math.sin(a) * r0 * 1.25), V3(Math.cos(a + 0.15) * L, -0.2, Math.sin(a + 0.15) * L)];
      sweep(G, pts, [r0 * 0.34, r0 * 0.2, r0 * 0.07], 5, col, 0, 0.7);
    }
  }
}

// leaf clumps on the skeleton tips (and some thin interior nodes)
function foliageFromSkeleton(G, sk, S, lod) {
  const L = S.leaves;
  const crown = V3(0, (S.box[2] + S.box[3]) / 2, 0), halfH = (S.box[3] - S.box[2]) / 2;
  let anchors = [];
  for (let i = 0; i < sk.N; i++) if (!sk.kids[i].length || (sk.r[i] < S.rTip * 2.2 && rnd() < 0.25)) anchors.push(i);
  // shuffle then thin to the clump budget
  for (let i = anchors.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [anchors[i], anchors[j]] = [anchors[j], anchors[i]]; }
  const maxC = lod === 0 ? L.clumps : L.midClumps;
  anchors = anchors.slice(0, maxC);
  const per = lod === 0 ? Math.max(3, Math.round(L.cards / anchors.length)) : Math.max(4, Math.round(L.midCards / anchors.length));
  const rad = L.clump * (lod === 0 ? 1 : 1.7), size = (lod === 0 ? 1 : 1.85);
  for (const i of anchors) {
    const p = sk.pos(i); p.y += L.lift ?? 0.25;
    const e = Math.min(1, S.env(p.x, p.y, p.z));
    const exposure = Math.min(1, Math.max(0.25, 0.35 + 0.5 * e + 0.25 * (p.y - crown.y) / halfH));
    // tile mix: flowers favour the top of the crown
    let tile = L.tiles[0][0];
    if (L.tiles.length > 1) { const top = smooth(crown.y - halfH * 0.3, crown.y + halfH, p.y); let w = rnd() * 0.75 + (1 - top) * 0.35; for (const [tn, f] of L.tiles) { if (w < f) { tile = tn; break; } w -= f; } }
    const style = L.style === 'hang' && p.y < crown.y ? 'hang' : (L.style === 'hang' ? 'random' : L.style);
    clump(G, p, rad * rr(0.8, 1.2), per, rr(L.size[0], L.size[1]) * size, tile, style, crown, exposure, L.tint);
  }
}

// ---------------------------------------------------------------- species
const BARK = [0.15, 0.125, 0.1], BARK_DARK = [0.1, 0.088, 0.075], BARK_PALE = [0.24, 0.21, 0.18];
const roundedBox = (r, R, ev) => Math.sqrt(Math.pow(r / R, 4) + ev * ev);
const crownLump = (x, z, a, b) => { const th = Math.atan2(z, x); return 1 + a * Math.sin(3 * th + 0.7) + b * Math.sin(5 * th + 2.1); };
const SPECIES = {
  rain: {
    trunk: [V3(0, -0.4, 0), V3(0.15, 1.2, 0.05), V3(0.35, 2.4, 0.12), V3(0.45, 3.0, 0.15)],
    box: [-11, 11, 5.4, 13.4, -11, 11],
    env(x, y, z) { const r = Math.hypot(x, z), R = 9.8 * crownLump(x, z, 0.1, 0.06), t = Math.min(1, r / R), top = 12.9 - 3.4 * t * t, bot = 6.6 + 0.5 * t * t; const mid = (top + bot) / 2, half = Math.max(0.3, (top - bot) / 2); return roundedBox(r, R, (y - mid) / half); },
    nAttr: 440, step: 0.8, influence: 4.6, kill: 1.5, tropism: [0, 0.05, 0], rTip: 0.035, rBase: 0.85, flare: 1, bark: BARK,
    leaves: { tiles: [['fine', 1]], cards: 640, clumps: 70, midCards: 100, midClumps: 22, clump: 1.75, size: [2.1, 2.8], style: 'flat', tint: [1, 1, 1] },
    epiphytes: 6,
  },
  flameForest: {
    trunk: [V3(0, -0.4, 0), V3(0.1, 1.2, 0), V3(0.2, 2.3, 0.1)],
    box: [-9, 9, 4.6, 10.8, -9, 9],
    env(x, y, z) { const r = Math.hypot(x, z), R = 7.8 * crownLump(x, z, 0.08, 0.05), t = Math.min(1, r / R), top = 10.3 - 2.4 * t * t, bot = 5.6 + 0.4 * t * t; const mid = (top + bot) / 2, half = Math.max(0.3, (top - bot) / 2); return roundedBox(r, R, (y - mid) / half); },
    nAttr: 340, step: 0.75, influence: 4.2, kill: 1.4, tropism: [0, 0.04, 0], rTip: 0.03, rBase: 0.55, flare: 0.8, bark: BARK_PALE,
    leaves: { tiles: [['red', 0.62], ['fine', 1]], cards: 480, clumps: 54, midCards: 80, midClumps: 16, clump: 1.4, size: [1.7, 2.3], style: 'flat', tint: [1.08, 1.06, 0.95] },
  },
  angsana: {
    trunk: [V3(0, -0.4, 0), V3(0.1, 1.6, 0), V3(0.25, 3.2, 0.05)],
    box: [-7.5, 7.5, 3.2, 11.8, -7.5, 7.5],
    env(x, y, z) { const r = Math.hypot(x, z), R = 6.6 * crownLump(x, z, 0.08, 0.05), t = Math.min(1, r / R), top = 11.2 - 3.0 * t * t, bot = 6.4 - 2.8 * t * t; const mid = (top + bot) / 2, half = Math.max(0.3, (top - bot) / 2); return roundedBox(r, R, (y - mid) / half) * 1.0; },
    nAttr: 340, step: 0.7, influence: 4.0, kill: 1.3, tropism: [0, 0.02, 0], rTip: 0.03, rBase: 0.42, flare: 0.6, bark: BARK,
    leaves: { tiles: [['broad', 1]], cards: 430, clumps: 46, midCards: 80, midClumps: 16, clump: 1.35, size: [1.6, 2.2], style: 'hang', tint: [1.04, 1.06, 0.9] },
  },
  tembusu: {
    trunk: [V3(0, -0.4, 0), V3(0.12, 2.5, 0.05), V3(-0.05, 5.0, 0.1), V3(0.1, 7.0, 0.05)],
    box: [-6.5, 6.5, 6.4, 16.6, -6.5, 6.5],
    clumps: null,
    env(x, y, z) { let e = 9; for (const [cx, cy, cz, rx, ry] of this.clumps) e = Math.min(e, Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rx) ** 2)); return e; },
    nAttr: 320, step: 0.7, influence: 3.8, kill: 1.25, tropism: [0, 0.12, 0], rTip: 0.03, rBase: 0.45, flare: 0.5, bark: BARK_DARK,
    leaves: { tiles: [['dark', 1]], cards: 410, clumps: 46, midCards: 80, midClumps: 16, clump: 1.2, size: [1.45, 1.95], style: 'random', tint: [0.95, 1, 0.95] },
  },
  yellowFlame: {
    trunk: [V3(0, -0.4, 0), V3(0.05, 1.8, 0), V3(0.1, 3.4, 0.05)],
    box: [-6.2, 6.2, 4.6, 11.4, -6.2, 6.2],
    env(x, y, z) { const r = Math.hypot(x, z), R = 5.4 * crownLump(x, z, 0.1, 0.05), t = Math.min(1, r / R), top = 11 - 2.2 * t * t, bot = 5.2; const mid = (top + bot) / 2, half = (top - bot) / 2; const tier = 0.16 * Math.cos(y * 2.3); return roundedBox(r, R, (y - mid) / half) + tier; },
    nAttr: 300, step: 0.7, influence: 3.8, kill: 1.25, tropism: [0, 0.08, 0], rTip: 0.03, rBase: 0.34, flare: 0.4, bark: BARK_PALE,
    leaves: { tiles: [['yellow', 0.42], ['fine', 1]], cards: 380, clumps: 40, midCards: 72, midClumps: 14, clump: 1.3, size: [1.6, 2.2], style: 'flat', tint: [1.04, 1.04, 0.9] },
  },
  tabebuia: {
    trunk: [V3(0, -0.4, 0), V3(0.1, 1.6, 0), V3(-0.05, 3.0, 0.1)],
    box: [-5.5, 5.5, 3.8, 10.2, -5.5, 5.5],
    clumps: null,
    env(x, y, z) { let e = 9; for (const [cx, cy, cz, rx, ry] of this.clumps) e = Math.min(e, Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rx) ** 2)); return e; },
    nAttr: 260, step: 0.65, influence: 3.6, kill: 1.2, tropism: [0, 0.12, 0], rTip: 0.028, rBase: 0.3, flare: 0.3, bark: BARK_PALE,
    leaves: { tiles: [['pink', 0.75], ['broad', 1]], cards: 350, clumps: 38, midCards: 70, midClumps: 14, clump: 1.2, size: [1.45, 1.95], style: 'random', tint: [1, 1, 1] },
  },
};
function initClumps() {
  setSeed(777);
  SPECIES.tembusu.clumps = Array.from({ length: 5 }, (_, i) => [rr(-2.2, 2.2), 8.6 + i * 1.5 + rr(-0.5, 0.5), rr(-2.2, 2.2), rr(2.0, 2.9), rr(1.4, 2.0)]);
  SPECIES.tabebuia.clumps = Array.from({ length: 4 }, () => [rr(-2, 2), rr(5.6, 8.4), rr(-2, 2), rr(2.0, 2.7), rr(1.4, 1.9)]);
}

const SK = {}; // cached skeletons (shared by near + mid LOD)
function skeleton(name) {
  if (SK[name]) return SK[name];
  setSeed(4242 + name.length * 131 + name.charCodeAt(0));
  return (SK[name] = colonize(SPECIES[name]));
}

function broadleaf(name, lod) {
  const S = SPECIES[name], sk = skeleton(name), G = new GB();
  setSeed(9000 + name.charCodeAt(1) * 7 + lod);
  if (lod === 0) barkFromSkeleton(G, sk, { stride: 3, rMin: 0.065, col: S.bark, flare: S.flare, sideFn: r => r > 0.35 ? 9 : r > 0.16 ? 6 : r > 0.09 ? 4 : 3 });
  else barkFromSkeleton(G, sk, { stride: 6, rMin: 0.2, col: S.bark, flare: 0, sideFn: r => r > 0.3 ? 5 : 3 });
  foliageFromSkeleton(G, sk, S, lod);
  // epiphytes: bird's nest ferns perched in the forks of big limbs
  if (lod === 0 && S.epiphytes) {
    const cand = []; for (let i = 0; i < sk.N; i++) if (sk.r[i] > 0.14 && sk.r[i] < 0.42 && sk.Y[i] > 3 && sk.kids[i].length > 1) cand.push(i);
    for (let e = 0; e < S.epiphytes && cand.length; e++) {
      const i = cand.splice(Math.floor(rnd() * cand.length), 1)[0], p = sk.pos(i); p.y += 0.35;
      for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI + rnd() * 0.4; const t = V3(Math.cos(a), 0, Math.sin(a)), b = V3(0, 0.55, 0).addScaledVector(V3(-Math.sin(a), 0, Math.cos(a)), 0.83).normalize(); card(G, p, t, b, 0.75, 0.7, V3(0, 1, 0), tileUV('fern'), [1, 1, 1], 0.9); }
      card(G, p, V3(1, 0, 0), V3(0, 0, 1), 0.8, 0.8, V3(0, 1, 0), tileUV('fern'), [0.95, 1, 0.9], 0.9);
    }
  }
  return G.build();
}

// palm frond: arcing rachis with a V-shaped pair of leaflet strips (palm tile: base at the bottom of the tile)
function frond(G, crown, az, len, elev, droop, segs, vShape, tint, aoTop = 1) {
  const h = V3(Math.cos(az), 0, Math.sin(az)), side = V3(-Math.sin(az), 0, Math.cos(az));
  const pts = [];
  for (let k = 0; k <= segs; k++) { const t = k / segs; pts.push(V3().copy(crown).addScaledVector(h, len * t * Math.cos(elev * 0.6)).add(V3(0, len * (Math.sin(elev) * t - droop * t * t), 0))); }
  const [u0, v0, u1, v1] = tileUV('palm'), um = (u0 + u1) / 2;
  for (let k = 0; k < segs; k++) {
    const t0 = k / segs, t1 = (k + 1) / segs, w0 = 1.3 * Math.sin(Math.PI * (0.12 + 0.88 * t0)) + 0.15, w1 = 1.3 * Math.sin(Math.PI * (0.12 + 0.88 * t1)) + 0.15;
    const va = v0 + (v1 - v0) * t0, vb = v0 + (v1 - v0) * t1;
    const ao = 0.55 + 0.45 * aoTop * (0.5 + 0.5 * t0);
    for (const s of [-1, 1]) {
      const drop = vShape ? 0.42 : 0.1;
      const A = pts[k], B = pts[k + 1];
      const Ao = V3().copy(A).addScaledVector(side, s * w0).add(V3(0, -w0 * drop, 0)), Bo = V3().copy(B).addScaledVector(side, s * w1).add(V3(0, -w1 * drop, 0));
      const n = V3(0, 1, 0).addScaledVector(side, s * 0.35).addScaledVector(h, 0.2).normalize();
      const ue = s < 0 ? u0 : u1, col = [tint[0], tint[1], tint[2]];
      // sway weight grows toward the frond tip (1 at the crown → 3.4 at the tip): fronds flap, the crown barely moves
      const la = 1 + 2.4 * t0 * t0, lb = 1 + 2.4 * t1 * t1;
      for (const [P, u, v, lf] of [[A, um, va, la], [Ao, ue, va, la], [Bo, ue, vb, lb], [A, um, va, la], [Bo, ue, vb, lb], [B, um, vb, lb]]) G.v(P, n, u, v, col, ao, lf, 1);
    }
  }
}
function palmTree(kind, lod) {
  const G = new GB(), hi = lod === 0;
  setSeed(kind === 'coconut' ? 31337 : 27182);
  if (kind === 'coconut') {
    const H = 10.4, lean = 2.0, segs = hi ? 8 : 3;
    let prev = V3(0, -0.3, 0);
    for (let i = 1; i <= segs; i++) {
      const t = i / segs, p = V3(lean * Math.pow(t, 1.7), t * H, 0);
      const r0 = 0.26 - (i - 1) / segs * 0.09 + (i === 1 ? 0.08 : 0), r1 = 0.26 - t * 0.09;
      tube(G, prev, p, r0, r1, hi ? 8 : 4, [0.42, 0.37, 0.3], 2, 0.85); prev = p;
    }
    const crown = prev.clone().add(V3(0, 0.15, 0));
    const nf = hi ? 17 : 9;
    for (let f = 0; f < nf; f++) {
      const young = f % 3 === 0, az = f / nf * Math.PI * 2 * 2.618 + rnd() * 0.3;
      frond(G, crown, az, rr(4.6, 5.6), young ? rr(0.7, 1.0) : rr(0.15, 0.45), young ? rr(0.4, 0.7) : rr(1.0, 1.5), hi ? 8 : 3, hi, young ? [1.05, 1.08, 0.88] : [0.95, 0.95, 0.85]);
    }
    if (hi) {
      for (let f = 0; f < 2; f++) frond(G, crown.clone().add(V3(0, -0.3, 0)), rnd() * 6.28, 3.6, -0.9, 0.6, 5, false, [0.62, 0.45, 0.26], 0.6); // dead brown fronds hanging
      const nut = new THREE.IcosahedronGeometry(0.17, 0), np = nut.attributes.position;
      for (let k = 0; k < 6; k++) {
        const a = k / 6 * 6.28 + rnd() * 0.5, c = crown.clone().add(V3(Math.cos(a) * 0.32, -0.45 - rnd() * 0.2, Math.sin(a) * 0.32)), col = rnd() < 0.5 ? [0.3, 0.32, 0.1] : [0.32, 0.22, 0.1];
        for (let i = 0; i < np.count; i++) { const v = V3(np.getX(i), np.getY(i), np.getZ(i)); G.v(v.clone().add(c), v.normalize(), SOLID_UV[0], SOLID_UV[1], col, 0.6, 1, 3); }
      }
    }
  } else {
    // royal palm: smooth pale concrete-like column with a slight bulge, glossy green crownshaft, arching fronds
    const H = 12, segs = hi ? 6 : 2;
    let prev = V3(0, -0.3, 0);
    for (let i = 1; i <= segs; i++) {
      const t = i / segs, p = V3(0, t * H, 0), bul = tt => 0.3 + 0.06 * Math.sin(Math.PI * Math.min(1, tt * 1.6)) - 0.05 * tt;
      tube(G, prev, p, bul((i - 1) / segs) + (i === 1 ? 0.06 : 0), bul(t), hi ? 10 : 5, [0.5, 0.48, 0.45], 3, 0.9); prev = p;
    }
    tube(G, prev, prev.clone().add(V3(0, 2.3, 0)), 0.28, 0.22, hi ? 10 : 5, [0.09, 0.22, 0.06], 3, 0.9);
    const crown = prev.clone().add(V3(0, 2.25, 0));
    const nf = hi ? 14 : 8;
    for (let f = 0; f < nf; f++) {
      const az = f / nf * Math.PI * 2 * 2.618 + rnd() * 0.3, up = f % 2 === 0;
      frond(G, crown, az, rr(4.6, 5.4), up ? rr(0.9, 1.2) : rr(0.4, 0.75), up ? rr(0.5, 0.8) : rr(0.9, 1.3), hi ? 8 : 3, hi, [1.0, 1.02, 0.86]);
    }
  }
  return G.build();
}
function shrub(lod) {
  const G = new GB(), hi = lod === 0;
  setSeed(5150 + lod);
  const crown = V3(0, 0.5, 0);
  const n = hi ? 6 : 3;
  for (let i = 0; i < n; i++) {
    const a = i / n * 6.28 + rnd() * 0.4, r = i === 0 ? 0 : rr(0.5, 0.9), c = V3(Math.cos(a) * r, rr(0.65, 1.05), Math.sin(a) * r);
    const flowers = i % 2 === 1;
    clump(G, c, rr(0.7, 0.95), hi ? 14 : 6, hi ? rr(0.8, 1.05) : 1.5, flowers ? 'pink' : 'broad', 'random', crown, 0.8, flowers ? [1.2, 0.42, 0.85] : [0.95, 1.0, 0.92]);
  }
  return G.build();
}

// ---------------------------------------------------------------- species table
const KINDS = ['rain', 'flameForest', 'angsana', 'tembusu', 'coconut', 'royal', 'shrub', 'yellowFlame', 'tabebuia'];
const K = Object.fromEntries(KINDS.map((k, i) => [k, i]));
const LEAF_TILE = { coconut: 'palm', royal: 'palm', shrub: 'broad' };
// whole-tree sway per species: massive rain trees and columnar tembusu barely move, light flowering trees and
// drooping angsana move more (palm fronds carry their own tip-weighted sway on top)
const SWAY = { rain: 0.45, flameForest: 0.7, angsana: 0.85, tembusu: 0.5, coconut: 0.8, royal: 0.6, shrub: 0.35, yellowFlame: 0.9, tabebuia: 0.9 };
function buildNear(kind) {
  const g = kind === 'coconut' || kind === 'royal' ? palmTree(kind, 0) : kind === 'shrub' ? shrub(0) : broadleaf(kind, 0);
  const lf = g.attributes.aLeaf.array; for (let i = 0; i < lf.length; i++) lf[i] *= SWAY[kind];
  return g;
}
// worker tree types (0 rain tree, 1 angsana/tembusu, 2 palm, 3 shrub, 4 slim/flowering) → species, by a position hash
const hash2 = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
function speciesOf(t, x, z) {
  const h = hash2(x, z);
  switch (t) {
    case 0: return h < 0.1 ? K.flameForest : K.rain;
    case 1: return h < 0.5 ? K.angsana : K.tembusu;
    case 2: return h < 0.55 ? K.coconut : K.royal;
    case 3: return K.shrub;
    default: return h < 0.62 ? K.yellowFlame : K.tabebuia;
  }
}

// ---------------------------------------------------------------- impostors
// Each species' near model is rendered once at load (in a throwaway WebGL context, 2x supersampled) from 4 sides and
// from above into an albedo atlas (sRGB; alpha = leaf coverage, coverage-preserving mips) and a normal atlas
// (bake-view-space shading normal; alpha = baked crown occlusion). Beyond the near range every tree is a camera-facing
// card that blends the two baked side views nearest the viewer's azimuth around that tree, plus a horizontal card
// with the top view that opens up as the view steepens — 4 triangles a tree, all 60k trees in one draw, and the
// distance gating is done in the vertex shader so the CPU never touches them after load.
const IMP_VIEWS = 5, IMP_COLS = 8, IMP_ROWS = Math.ceil(KINDS.length * IMP_VIEWS / IMP_COLS), IMP_CELL = 256, IMP_NCELL = 128, IMP_SS = 2;
const CUT = Math.round(0.42 * 255);
const lin2srgb = c => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

const BAKE_VS = `precision highp float;
uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; uniform mat3 normalMatrix;
in vec3 position; in vec3 normal; in vec2 uv; in vec3 color; in float aAO; in float aKind;
out vec2 vUv; out vec3 vCol; out float vAO; out float vKind; out vec3 vN;
void main() { vUv = uv; vCol = color; vAO = aAO; vKind = aKind; vN = normalMatrix * normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BAKE_FS = `precision highp float;
uniform sampler2D map; uniform int uMode;
in vec2 vUv; in vec3 vCol; in float vAO; in float vKind; in vec3 vN;
layout(location = 0) out vec4 outColor;
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec4 t = texture(map, vUv);
  if (t.a < 0.42) discard;
  bool fol = vKind > 0.5 && vKind < 1.5;
  if (uMode == 0) {
    // same diffuse the near shader builds: texel x vertex tint x baked occlusion (bark: average fissure darkening)
    vec3 c = t.rgb * vCol * (fol ? mix(0.55, 1.05, vAO) : 0.8 * mix(0.5, 1.0, vAO));
    outColor = vec4(toSRGB(clamp(c, 0.0, 1.0)), 1.0);
  } else {
    vec3 n = normalize(vN); if (!fol && !gl_FrontFacing) n = -n;
    outColor = vec4(n * 0.5 + 0.5, max(vAO, 0.02));
  }
}`;

// box-filter an f x f block of the bake read-back into an atlas cell; uncovered texels take the background colour
// (so filtering at leaf edges blends towards foliage colour, not black)
function cellDown(src, srcW, sx0, size, f, dst, dstW, dx0, dy0, bg, coverageAlpha) {
  const n = size / f;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let r = 0, g = 0, b = 0, a = 0, cov = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) {
      const s = ((y * f + j) * srcW + sx0 + x * f + i) * 4;
      if (src[s + 3] === 0) continue;
      cov++; r += src[s]; g += src[s + 1]; b += src[s + 2]; a += src[s + 3];
    }
    const d = ((dy0 + y) * dstW + dx0 + x) * 4;
    if (!cov) { dst[d] = bg[0]; dst[d + 1] = bg[1]; dst[d + 2] = bg[2]; dst[d + 3] = coverageAlpha ? 0 : bg[3]; continue; }
    dst[d] = r / cov; dst[d + 1] = g / cov; dst[d + 2] = b / cov;
    dst[d + 3] = coverageAlpha ? 255 * cov / (f * f) : a / cov;
  }
}

// full mip chain; with `coverage`, each cell's alpha is rescaled per level so the fraction of texels passing the
// alpha test matches level 0 (alpha-tested canopies would otherwise thin out with distance)
function mipChain(data, w, h, coverage) {
  const levels = [{ data, width: w, height: h }];
  const target = new Float32Array(IMP_COLS * IMP_ROWS);
  if (coverage) {
    const cw = w / IMP_COLS, ch = h / IMP_ROWS;
    for (let cy = 0; cy < IMP_ROWS; cy++) for (let cx = 0; cx < IMP_COLS; cx++) {
      let n = 0; for (let y = cy * ch; y < (cy + 1) * ch; y++) for (let x = cx * cw; x < (cx + 1) * cw; x++) if (data[(y * w + x) * 4 + 3] >= CUT) n++;
      target[cy * IMP_COLS + cx] = n / (cw * ch);
    }
  }
  const hist = new Uint32Array(256);
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), out = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, a = 0, ws = 0;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const s = (Math.min(h - 1, y * 2 + j) * w + Math.min(w - 1, x * 2 + i)) * 4, wt = coverage ? data[s + 3] + 2 : 1;
        r += data[s] * wt; g += data[s + 1] * wt; b += data[s + 2] * wt; a += data[s + 3]; ws += wt;
      }
      const d = (y * nw + x) * 4; out[d] = r / ws; out[d + 1] = g / ws; out[d + 2] = b / ws; out[d + 3] = a / 4;
    }
    const cw = nw / IMP_COLS, ch = nh / IMP_ROWS;
    if (coverage && cw >= 2 && ch >= 2 && Number.isInteger(cw) && Number.isInteger(ch)) {
      for (let cy = 0; cy < IMP_ROWS; cy++) for (let cx = 0; cx < IMP_COLS; cx++) {
        hist.fill(0); let n = 0;
        for (let y = cy * ch; y < (cy + 1) * ch; y++) for (let x = cx * cw; x < (cx + 1) * cw; x++) { hist[out[(y * nw + x) * 4 + 3]]++; n++; }
        const want = target[cy * IMP_COLS + cx] * n; let cum = 0, aStar = CUT;
        for (let a = 255; a >= 1; a--) { cum += hist[a]; if (cum >= want) { aStar = a; break; } }
        const k = CUT / Math.max(1, aStar); if (Math.abs(k - 1) < 0.01) continue;
        for (let y = cy * ch; y < (cy + 1) * ch; y++) for (let x = cx * cw; x < (cx + 1) * cw; x++) { const i = (y * nw + x) * 4 + 3; out[i] = Math.min(255, out[i] * k); }
      }
    }
    levels.push({ data: out, width: nw, height: nh });
    data = out; w = nw; h = nh;
  }
  return levels;
}

function bakeImpostors(geos, leafTex, avg) {
  const W = IMP_COLS * IMP_CELL, H = IMP_ROWS * IMP_CELL, NW = IMP_COLS * IMP_NCELL, NH = IMP_ROWS * IMP_NCELL, S = IMP_CELL * IMP_SS;
  const alb = new Uint8Array(W * H * 4), nrm = new Uint8Array(NW * NH * 4);
  const r = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false, alpha: true, powerPreference: 'high-performance' });
  r.setSize(4, 4, false);
  const rt = new THREE.WebGLRenderTarget(S * IMP_VIEWS, S, { depthBuffer: true, generateMipmaps: false });
  const mat = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, side: THREE.DoubleSide, uniforms: { map: { value: leafTex }, uMode: { value: 0 } }, vertexShader: BAKE_VS, fragmentShader: BAKE_FS });
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(), mesh = new THREE.Mesh(geos[0], mat);
  mesh.frustumCulled = false; scene.add(mesh);
  const pix = new Uint8Array(S * IMP_VIEWS * S * 4), sp = [];
  r.setClearColor(0x000000, 0);
  for (let s = 0; s < geos.length; s++) {
    const g = geos[s], p = g.attributes.position; mesh.geometry = g;
    let rXZ = 0, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < p.count; i++) { rXZ = Math.max(rXZ, Math.hypot(p.getX(i), p.getZ(i))); y0 = Math.min(y0, p.getY(i)); y1 = Math.max(y1, p.getY(i)); }
    y0 = Math.max(y0, -0.15);
    const L = Math.max(2 * rXZ, y1 - y0) * 1.05, cY = (y0 + y1) / 2, Lt = 2 * rXZ * 1.05;
    sp.push(new THREE.Vector4(L, cY, Lt, 0));
    const lc = avg[LEAF_TILE[KINDS[s]] || SPECIES[KINDS[s]].leaves.tiles.at(-1)[0]] || [0.05, 0.1, 0.03];
    const bgA = [lin2srgb(lc[0] * 0.8) * 255, lin2srgb(lc[1] * 0.8) * 255, lin2srgb(lc[2] * 0.8) * 255, 0], bgN = [128, 128, 255, 150];
    for (const mode of [0, 1]) {
      mat.uniforms.uMode.value = mode;
      r.setRenderTarget(rt); r.setScissorTest(false); r.clear();
      r.setScissorTest(true);
      for (let v = 0; v < IMP_VIEWS; v++) {
        r.setViewport(v * S, 0, S, S); r.setScissor(v * S, 0, S, S);
        const half = (v < 4 ? L : Lt) / 2;
        cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.near = 1; cam.far = 300;
        if (v < 4) { const a = v * Math.PI / 2; cam.position.set(Math.sin(a) * 120, cY, Math.cos(a) * 120); cam.up.set(0, 1, 0); cam.lookAt(0, cY, 0); }
        else { cam.position.set(0, 120, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); }
        cam.updateProjectionMatrix(); cam.updateMatrixWorld();
        r.render(scene, cam);
      }
      r.setScissorTest(false);
      r.readRenderTargetPixels(rt, 0, 0, S * IMP_VIEWS, S, pix);
      for (let v = 0; v < IMP_VIEWS; v++) {
        const c = s * IMP_VIEWS + v, cx = c % IMP_COLS, cy = Math.floor(c / IMP_COLS);
        if (mode === 0) cellDown(pix, S * IMP_VIEWS, v * S, S, IMP_SS, alb, W, cx * IMP_CELL, cy * IMP_CELL, bgA, true);
        else cellDown(pix, S * IMP_VIEWS, v * S, S, S / IMP_NCELL, nrm, NW, cx * IMP_NCELL, cy * IMP_NCELL, bgN, false);
      }
    }
  }
  r.setRenderTarget(null);
  rt.dispose(); mat.dispose(); r.dispose(); r.forceContextLoss();
  const tex = (data, w, h, srgb, coverage) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.mipmaps = mipChain(data, w, h, coverage); t.generateMipmaps = false;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 4;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true;
    return t;
  };
  return { albedo: tex(alb, W, H, true, true), normal: tex(nrm, NW, NH, false, false), sp };
}

// ---------------------------------------------------------------- materials
// shared foliage lighting terms (near cards and impostors): transmitted sun through backlit leaves and light scattered
// inside the crown — both scaled by how much sun the leaf actually gets (fSunVis, captured from the shadow test in the
// light loop, x the height-field visibility for far impostors), so shaded leaves don't glow. Night street light comes
// from the baked lamp map (withLampField) like everything else.
const foliageLight = sunExtra => `{
  vec3 V = normalize(cameraPosition - vTW), L = normalize(uSunDir);
  vec3 nW = inverseTransformDirection(normal, viewMatrix);
  float sunUp = smoothstep(-0.05, 0.12, L.y), sv = fSunVis * ${sunExtra};
  float fwd = pow(clamp(dot(-V, L), 0.0, 1.0), 4.0), back = clamp(-dot(nW, L) * 0.8 + 0.2, 0.0, 1.0);
  vec3 trans = diffuseColor.rgb * vec3(0.9, 1.0, 0.45) * uSunCol * (fwd * 0.5 + back * 0.07) * (0.3 + 0.7 * fAO) * sunUp * sv;
  vec3 fill = diffuseColor.rgb * (uSunCol * 0.014 * (0.25 + 0.75 * sv) + vec3(0.03, 0.039, 0.045) * (1.0 - uNight)) * (0.35 + 0.65 * fAO);
  totalEmissiveRadiance += trans + fill;
}`;
// directional-light loop that also records the sun's shadow-map visibility in fSunVis (extra: more GLSL after the
// light info is fetched, e.g. the impostors' height-field shadow)
const litBegin = (extra = '') => 'float fSunVis = 1.0;\n' + THREE.ShaderChunk.lights_fragment_begin
  .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );' + extra)
  .replace('directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap', 'fSunVis = ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap')
  .replace('vDirectionalShadowCoord[ i ] ) : 1.0;', 'vDirectionalShadowCoord[ i ] ) : 1.0; directLight.color *= fSunVis;');
const IBL_TWEAK = '#include <lights_fragment_maps>\niblIrradiance = mix(vec3(dot(iblIrradiance, vec3(0.3333))), iblIrradiance, 0.35) * uIblDiffuse * mix(0.45, 1.0, fAO);\nradiance *= 0.25 * fAO;';
const HUE_VAR = 'diffuseColor.rgb *= mix(vec3(0.88, 1.0, 1.06), vec3(1.08, 1.03, 0.8), vIH) * (0.88 + 0.24 * fract(vIH * 7.31));';
const IGN = 'fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))))'; // interleaved gradient noise

// near LOD: leaf cards + bark. Fades out (screen-door dither, complementary to the impostors) across uFade.
function treeMaterial(atlas, uFade) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, map: atlas, alphaTest: 0.42, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uTime: U.time, uWet: U.wet, uWind: U.wind, uSunDir: U.sunDir, uSunCol: U.sunColor, uNight: U.night, uIblDiffuse: U.iblDiffuse, uFade });
    sh.vertexShader = `attribute float aLeaf; attribute float aAO; attribute float aKind; uniform float uTime; uniform vec2 uWind; uniform vec2 uFade;
      varying float vAO; varying float vKind; varying float vIH; varying float vLY; varying vec3 vTP; varying vec3 vTW; varying vec3 vLP; varying float vFadeN;\n` + sh.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vAO = aAO; vKind = aKind; vLY = position.y; vLP = position;
      vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
      vFadeN = smoothstep(uFade.x, uFade.y, length(vec3(ip.x, 6.0, ip.z) - cameraPosition));
      vIH = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
      float ph = ip.x * 0.11 + ip.z * 0.07;
      float sway = aLeaf * smoothstep(1.0, 10.0, transformed.y) * (0.6 + length(uWind) * 0.5);
      transformed.x += sin(uTime * 1.1 + ph) * 0.12 * sway + sin(uTime * 2.7 + ph * 3.0 + transformed.y) * 0.04 * sway;
      transformed.z += cos(uTime * 0.9 + ph) * 0.1 * sway;
      if (aKind > 0.5 && aKind < 1.5) transformed += normal * sin(uTime * 4.0 + dot(position, vec3(3.1, 1.7, 2.3))) * 0.05;
      // palm fronds: each frond bobs on its own phase, more at the tip
      float frondW = max(0.0, aLeaf - 0.9);
      transformed.y += sin(uTime * 2.3 + ph * 2.0 + position.x * 0.7 + position.z * 0.5) * 0.11 * frondW * (0.6 + length(uWind) * 0.4);
      vTP = transformed + ip;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vTW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`)
      // fully faded out (inside the impostor range): collapse so nothing is rasterised
      .replace('#include <project_vertex>', '#include <project_vertex>\nif (vFadeN > 0.999) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);');
    sh.fragmentShader = `uniform float uWet; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uIblDiffuse; uniform float uNight; uniform float uTime;
      varying float vAO; varying float vKind; varying float vIH; varying float vLY; varying vec3 vTP; varying vec3 vTW; varying vec3 vLP; varying float vFadeN;\n${NOISE}\n` + sh.fragmentShader
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>\nif (${IGN} < vFadeN) discard;\nfloat fAO = vAO;`)
      // foliage keeps the clump/crown-outward normal on both faces (no back-face flip): soft volumetric shading
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nif (vKind > 0.5 && vKind < 1.5) normal = normalize(vNormal);')
      .replace('#include <lights_fragment_maps>', IBL_TWEAK)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      bool foliage = vKind > 0.5 && vKind < 1.5;
      if (foliage) {
        // per-tree hue/brightness variation (yellow-green ↔ blue-green) and baked crown occlusion
        ${HUE_VAR}
        diffuseColor.rgb *= mix(0.55, 1.05, vAO);
        roughnessFactor = mix(0.68, 0.45, uWet);
      } else {
        // bark: fissures and grey-green lichen; ringed (coconut) or smooth (royal palm) trunks
        float n1 = vnoise(vTP.xz * 9.0 + vTP.y * vec2(0.7, 2.9)) * 0.6 + vnoise(vTP.xy * vec2(3.0, 0.6)) * 0.4;
        if (vKind < 0.5) {
          // fine vertical fissures, soft lichen/moss patches (Singapore trunks are always a little green), mossy foot
          float fis = vnoise(vec2(atan(vLP.z, vLP.x) * 7.0, vLP.y * 0.9 + n1 * 0.6));
          diffuseColor.rgb *= (0.64 + 0.5 * n1) * (0.66 + 0.42 * smoothstep(0.2, 0.75, fis));
          float lichen = smoothstep(0.5, 0.86, vnoise(vTP.xz * 3.1 + vTP.y * 1.3)) * (0.45 + 0.55 * vnoise(vTP.xz * 9.0 + vTP.y * 4.0)) * smoothstep(0.3, 2.0, vLY);
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.17, 0.21, 0.1), vec3(0.36, 0.37, 0.31), smoothstep(0.35, 0.85, n1)), lichen * 0.42);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.1, 0.04), smoothstep(1.4, 0.1, vLY) * 0.35 * (0.6 + 0.4 * n1));
          diffuseColor.rgb *= mix(0.5, 1.0, vAO) * mix(1.0, 0.72, uWet);
          roughnessFactor = 0.92;
        } else if (vKind < 2.5) {
          diffuseColor.rgb *= (0.78 + 0.22 * smoothstep(-0.3, 0.7, sin(vLY * 11.0 + n1 * 2.0))) * (0.85 + 0.3 * n1);
          roughnessFactor = 0.85;
        } else {
          diffuseColor.rgb *= 0.9 + 0.2 * vnoise(vTP.xz * 4.0 + vec2(0.0, vLY * 0.5));
          roughnessFactor = 0.55;
        }
        roughnessFactor = mix(roughnessFactor, 0.35, uWet);
      }`)
      .replace('#include <lights_fragment_begin>', litBegin())
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\nif (vKind > 0.5 && vKind < 1.5) ${foliageLight('1.0')}`);
  };
  m.customProgramCacheKey = () => 'tree-near-v5';
  return withLampField(m);
}

// impostor cards (see bakeImpostors). One quad per side view + one top quad per tree; attributes iA = (x, z, yaw,
// scale), iB = (species, vertical scale). uFade: near↔impostor dither band, uFar: draw distance.
// billboard vertex code shared by the colour and shadow-depth materials. Distance gating uses the main camera
// (uCamMain); orientation uses cameraPosition, so in the shadow pass the cards turn to face the sun and cast the
// silhouette the sun would see.
function impostorVertex(nSp, color) {
  const pars = `attribute vec4 iA; attribute vec4 iB; uniform vec4 uSp[${nSp}]; uniform vec2 uFade; uniform float uFar; uniform float uWaterY; uniform vec3 uCamMain;
    varying vec2 vUvA; varying vec2 vUvB; varying float vBlend; varying float vFadeI; varying float vCut;
    ${color ? 'varying vec3 vR; varying vec3 vU; varying vec3 vF; varying float vIH; varying vec3 vTW;' : ''}
    vec2 impCell(float c, vec2 uv) { return (vec2(mod(c, ${IMP_COLS}.0), floor(c / ${IMP_COLS}.0)) + uv) / vec2(${IMP_COLS}.0, ${IMP_ROWS}.0); }\n`;
  const main = `
    int si = int(iB.x + 0.5);
    vec4 sp = uSp[si];
    float sc = iA.w, sy = iB.y;
    vec3 ctr = vec3(iA.x, sp.y * sc * sy, iA.y);
    ctr.xz += iB.zw * ctr.y; // street-tree lean (shear per metre of height)
    float dM = length(vec3(iA.x, 6.0, iA.y) - uCamMain);
    ${color
      // the mirrored water-reflection camera sits below the water: it gets every tree as an impostor
      ? 'vFadeI = cameraPosition.y < uWaterY ? 1.0 : smoothstep(uFade.x, uFade.y, dM);'
      // shadows: near models cast to 10 m past the fade band (their pools are rebuilt at ~15 Hz), impostors beyond
      : 'vFadeI = step(uFade.y + 10.0, dM);'}
    float keep = 1.0 - smoothstep(uFar * 0.9, uFar, length(iA.xy - uCamMain.xz));
    vec3 toC = cameraPosition - ctr;
    float dH = length(toC.xz);
    vec2 vh = toC.xz / max(dH, 1e-3);
    float sinE = toC.y / max(length(toC), 1e-3);
    float cr = cos(iA.z), sr = sin(iA.z);
    ${color ? 'vIH = fract(sin(dot(iA.xy, vec2(12.9898, 78.233))) * 43758.5453);' : ''}
    vec3 transformed;
    if (position.z < 0.5) {
      // upright card facing the viewer; looking down it erodes away (raised alpha cut) in favour of the top card
      float w = smoothstep(0.3, 0.58, abs(sinE));
      vCut = mix(0.42, 1.0, w);
      ${color ? 'vR = vec3(vh.y, 0.0, -vh.x); vU = vec3(0.0, 1.0, 0.0); vF = vec3(vh.x, 0.0, vh.y);' : ''}
      transformed = ctr + vec3(vh.y, 0.0, -vh.x) * (position.x * sp.x * sc) + vec3(0.0, position.y * sp.x * sc * sy, 0.0);
      float lx = vh.x * cr - vh.y * sr, lz = vh.x * sr + vh.y * cr;
      float f = mod(atan(lx, lz) / 1.5707963 + 4.0, 4.0), k0 = floor(f);
      vBlend = f - k0;
      float base = float(si) * ${IMP_VIEWS}.0;
      vUvA = impCell(base + k0, position.xy + 0.5); vUvB = impCell(base + mod(k0 + 1.0, 4.0), position.xy + 0.5);
      keep *= step(w, 0.99);
    } else {
      // horizontal card at crown height with the top view, rotated with the tree; edge-on (hidden) at eye level
      float vis = smoothstep(0.06, 0.22, abs(sinE));
      vCut = mix(1.0, 0.42, smoothstep(0.12, 0.36, abs(sinE)));
      vec3 ax = vec3(cr, 0.0, -sr), az = vec3(sr, 0.0, cr);
      ${color ? 'vR = ax; vU = -az; vF = vec3(0.0, 1.0, 0.0);' : ''}
      transformed = ctr + (ax * position.x - az * position.y) * (sp.z * sc);
      vUvA = vUvB = impCell(float(si) * ${IMP_VIEWS}.0 + 4.0, position.xy + 0.5); vBlend = 0.0;
      keep *= step(0.01, vis);
    }
    if (vFadeI < 0.001 || keep < 0.001) transformed = ctr; // degenerate: not rasterised
    else transformed = mix(ctr, transformed, keep);
    ${color ? 'vTW = transformed;' : ''}`;
  return { pars, main };
}
function impostorUniforms(albedo, sp, shared) {
  return { ...shared, uImp: { value: albedo }, uSp: { value: sp }, uWaterY: { value: WATER_LEVEL + 0.5 } };
}
// shared: { uFade, uFar, uCamMain }
function impostorMaterial(albedo, normalTex, sp, shared) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
  const V = impostorVertex(sp.length, true);
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, impostorUniforms(albedo, sp, shared), { uWet: U.wet, uSunDir: U.sunDir, uSunCol: U.sunColor, uNight: U.night, uIblDiffuse: U.iblDiffuse, uImpN: { value: normalTex } },
      { uHF: HF.tex, uHFRect: HF.rect, uHFOn: HF.on, uHFShadowC: HF.shadowCenter, uHFShadowR: HF.shadowR, uHFSun: U.sunDir });
    // far trees sit beyond the sun shadow map: shade them from the city height field (once per vertex, visible cards only)
    sh.vertexShader = V.pars + HF_GLSL + 'uniform vec3 uHFSun; varying float vHFSun;\n' + sh.vertexShader
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace('#include <begin_vertex>', V.main + `
      vHFSun = 1.0;
      if (uHFOn > 0.5 && vFadeI > 0.001 && keep > 0.001) vHFSun = hfSunVis(ctr + vec3(0.0, ctr.y * 0.3, 0.0), vec3(0.0, 1.0, 0.0), uHFSun);`);
    sh.fragmentShader = `uniform sampler2D uImp; uniform sampler2D uImpN; uniform float uWet; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uIblDiffuse; uniform float uNight;
      varying vec2 vUvA; varying vec2 vUvB; varying float vBlend; varying vec3 vR; varying vec3 vU; varying vec3 vF; varying float vIH; varying float vFadeI; varying vec3 vTW; varying float vCut; varying float vHFSun;\n` + sh.fragmentShader
      .replace('#include <lights_fragment_begin>', litBegin(' directLight.color *= vHFSun;'))
      .replace('#include <map_fragment>', `
      vec4 it = mix(texture2D(uImp, vUvA), texture2D(uImp, vUvB), vBlend);
      if (it.a < vCut || ${IGN} >= vFadeI) discard;
      diffuseColor.rgb *= it.rgb;
      vec4 inr = mix(texture2D(uImpN, vUvA), texture2D(uImpN, vUvB), vBlend);
      float fAO = inr.a;`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      { vec3 nb = inr.xyz * 2.0 - 1.0; normal = normalize((viewMatrix * vec4(normalize(vR * nb.x + vU * nb.y + vF * nb.z), 0.0)).xyz); }`)
      .replace('#include <lights_fragment_maps>', IBL_TWEAK)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${HUE_VAR}\nroughnessFactor = mix(0.7, 0.45, uWet);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${foliageLight('vHFSun')}`);
  };
  m.customProgramCacheKey = () => 'tree-imp-v4';
  return withLampField(m);
}
function impostorDepthMaterial(albedo, sp, shared) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  const V = impostorVertex(sp.length, false);
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, impostorUniforms(albedo, sp, shared));
    sh.vertexShader = V.pars + sh.vertexShader.replace('#include <begin_vertex>', V.main);
    sh.fragmentShader = 'uniform sampler2D uImp; varying vec2 vUvA; varying vec2 vUvB; varying float vBlend; varying float vFadeI; varying float vCut;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', 'if (vFadeI < 0.5 || mix(texture2D(uImp, vUvA), texture2D(uImp, vUvB), vBlend).a < vCut) discard;');
  };
  m.customProgramCacheKey = () => 'tree-imp-depth-v1';
  return m;
}

// Street trees lean their crowns out over the carriageway (light-seeking: Singapore's arterials turn into green
// tunnels under rain trees). For each broadleaf tree standing just off a drivable road, returns a world-space shear
// (crown shift per metre of height) pointing at the road centreline.
const LEAN = { rain: 0.34, flameForest: 0.26, angsana: 0.24, tembusu: 0.08, yellowFlame: 0.18, tabebuia: 0.15 };
function roadLean(types, pos, city) {
  const roads = city?.data?.roads; if (!roads) return null;
  const CELL = 24, grid = new Map(), seg = [];
  for (const r of roads) {
    if (r.c > 5 || r.b) continue;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3], id = seg.length;
      seg.push(ax, az, bx, bz, r.w / 2);
      for (let cx = Math.floor(Math.min(ax, bx) / CELL); cx <= Math.floor(Math.max(ax, bx) / CELL); cx++)
        for (let cz = Math.floor(Math.min(az, bz) / CELL); cz <= Math.floor(Math.max(az, bz) / CELL); cz++) {
          const k = cx * 100003 + cz; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(id);
        }
    }
  }
  const N = types.length, out = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const amt = LEAN[KINDS[types[i]]]; if (!amt) continue;
    const x = pos[i * 2], z = pos[i * 2 + 1], gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    let best = 1e9, bx = 0, bz = 0, bhw = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const l = grid.get((gx + dx) * 100003 + gz + dz); if (!l) continue;
      for (const id of l) {
        const ax = seg[id], az = seg[id + 1], ex = seg[id + 2] - ax, ez = seg[id + 3] - az, L2 = ex * ex + ez * ez || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2)), px = ax + ex * t, pz = az + ez * t;
        const d = Math.hypot(px - x, pz - z) - seg[id + 4];
        if (d < best) { best = d; bx = px; bz = pz; bhw = seg[id + 4]; }
      }
    }
    if (best > 4.5 || best < -0.5) continue;
    const dl = Math.hypot(bx - x, bz - z) || 1, k = amt * (0.7 + 0.6 * hash2(z * 1.7, x * 0.3)) / 10;
    out[i * 2] = (bx - x) / dl * k; out[i * 2 + 1] = (bz - z) / dl * k;
  }
  return out;
}

// Fallen blossom under flowering trees (flame of the forest: scarlet; yellow flame: yellow; pink trumpet: pink):
// one flat card per tree with a painted scatter of petals (grey, tinted per instance), densest under the crown.
const PETAL = { flameForest: [[0.62, 0.05, 0.02], 7.5], yellowFlame: [[0.75, 0.55, 0.05], 5.6], tabebuia: [[0.85, 0.45, 0.6], 5.2] };
function petalTexture() {
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); setSeed(4711);
  for (let i = 0; i < 9000; i++) {
    // radial density: a soft disc with a ragged rim, thinning out past the crown edge
    const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.75) * 0.5 * (0.82 + 0.18 * Math.sin(a * 5 + 1.3));
    if (rnd() < smooth(0.3, 0.5, r) * 0.85) continue;
    const x = S / 2 + Math.cos(a) * r * S, y = S / 2 + Math.sin(a) * r * S, len = 4 + rnd() * 6, w = len * (0.45 + rnd() * 0.25);
    const l = 62 + rnd() * 30;
    g.save(); g.translate(x, y); g.rotate(rnd() * Math.PI);
    g.fillStyle = `hsl(0,0%,${l.toFixed(0)}%)`; g.beginPath(); g.ellipse(0, 0, len / 2, w / 2, 0, 0, Math.PI * 2); g.fill();
    if (rnd() < 0.3) { g.fillStyle = `hsl(0,0%,${(l + 10).toFixed(0)}%)`; g.beginPath(); g.ellipse(len * 0.1, 0, len / 4, w / 4, 0, 0, Math.PI * 2); g.fill(); }
    g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// The quality presets' treeNear was the old mid-LOD switch distance; the near models now hand straight over to
// impostors a bit closer in, across a short dithered band.
const NEAR_SCALE = 0.6, FADE_BAND = 18;
const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere(), _q = new THREE.Quaternion();

export class Vegetation {
  constructor(scene, trees /* Float32Array x,z,type,scale,rot */, { treeDist = 1300, city = globalThis.__game?.city } = {}) {
    this.scene = scene;
    this.uFade = { value: new THREE.Vector2() };
    this.uFar = { value: treeDist };
    this.uCam = { value: new THREE.Vector3() };
    this.lastPos = new THREE.Vector3(1e9, 0, 0);
    this.treeDist = treeDist;
    this.nearDist = 230;
    const N = trees.length / 5;
    this.count = N;
    this.types = new Uint8Array(N);   // species (mesh) index
    this.pos = new Float32Array(N * 2);
    this.scale = new Float32Array(N);
    this.matrices = new Float32Array(N * 16);
    const iA = new Float32Array(N * 4), iB = new Float32Array(N * 4);
    const m = new THREE.Matrix4(), sh = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const perType = new Array(KINDS.length).fill(0);
    for (let i = 0; i < N; i++) {
      const x = trees[i * 5], z = trees[i * 5 + 1], t = trees[i * 5 + 2];
      const sp = speciesOf(t, x, z);
      this.types[i] = sp; this.pos[i * 2] = x; this.pos[i * 2 + 1] = z; this.scale[i] = trees[i * 5 + 3]; perType[sp]++;
    }
    const lean = roadLean(this.types, this.pos, city);
    this.leaning = 0;
    for (let i = 0; i < N; i++) {
      const x = this.pos[i * 2], z = this.pos[i * 2 + 1], sp = this.types[i], sc = this.scale[i], rot = trees[i * 5 + 4];
      // palms keep upright proportions; broadleaf crowns vary a little in height vs spread
      const sy = sp === K.coconut || sp === K.royal ? 0.9 + hash2(z, x) * 0.25 : 0.88 + (rot % 1) * 0.24;
      q.setFromAxisAngle(up, rot); s.set(sc, sc * sy, sc); p.set(x, 0, z);
      m.compose(p, q, s);
      const lx = lean ? lean[i * 2] : 0, lz = lean ? lean[i * 2 + 1] : 0;
      if (lx || lz) { sh.set(1, lx, 0, 0, 0, 1, 0, 0, 0, lz, 1, 0, 0, 0, 0, 1); m.premultiply(sh); this.leaning++; }
      m.toArray(this.matrices, i * 16);
      iA[i * 4] = x; iA[i * 4 + 1] = z; iA[i * 4 + 2] = rot; iA[i * 4 + 3] = sc; iB[i * 4] = sp; iB[i * 4 + 1] = sy; iB[i * 4 + 2] = lx; iB[i * 4 + 3] = lz;
    }
    this.cell = 50;
    this.grid = new Map();
    for (let i = 0; i < N; i++) { const k = this._key(this.pos[i * 2], this.pos[i * 2 + 1]); if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(i); }
    initClumps();
    const atlas = leafAtlas();
    let t0 = performance.now();
    const geos = KINDS.map(buildNear);
    this.buildMs = { geo: Math.round(performance.now() - t0) }; t0 = performance.now();
    const imp = bakeImpostors(geos, atlas.tex, atlas.avg);
    this.buildMs.bake = Math.round(performance.now() - t0);
    const matNear = treeMaterial(atlas.tex, this.uFade);
    const depthNear = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas.tex, alphaTest: 0.42, side: THREE.DoubleSide });
    this.meshes = [];
    this.stats = [];
    for (let t = 0; t < KINDS.length; t++) {
      const im = new THREE.InstancedMesh(geos[t], matNear, Math.max(16, perType[t]));
      im.count = 0; im.frustumCulled = false;
      im.castShadow = true; im.receiveShadow = true;
      im.customDepthMaterial = depthNear;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.name = `trees_${KINDS[t]}`;
      // shadow pass: only the near-range prefix of the pool (see update)
      im.shadowCount = 0;
      im.onBeforeShadow = () => { im._n = im.count; im.count = Math.min(im.count, Math.max(im.shadowCount, im._n > 0 && !this._built ? 1 : 0)); };
      im.onAfterShadow = () => { im.count = im._n; };
      scene.add(im);
      this.meshes.push(im);
      this.stats.push(`${KINDS[t]}:${geos[t].attributes.position.count / 3}`);
    }
    // fallen blossom cards
    const pg = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    const pm = new THREE.MeshStandardMaterial({ map: petalTexture(), alphaTest: 0.5, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    this.petals = new THREE.InstancedMesh(pg, pm, 1024);
    this.petals.count = 0; this.petals.frustumCulled = false; this.petals.receiveShadow = true; this.petals.name = 'trees_petals';
    this.petals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.petals.setColorAt(0, new THREE.Color(1, 1, 1)); this.petals.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.petalSp = KINDS.map(k => PETAL[k] || null);
    scene.add(this.petals);
    // impostors: 2 quads (upright + top) per tree, every tree, one draw
    const ig = new THREE.InstancedBufferGeometry();
    const cp = [];
    for (const z of [0, 1]) for (const [x, y] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) cp.push(x, y, z);
    ig.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    ig.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    ig.setAttribute('iA', new THREE.InstancedBufferAttribute(iA, 4));
    ig.setAttribute('iB', new THREE.InstancedBufferAttribute(iB, 4));
    ig.instanceCount = N;
    ig.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const shared = { uFade: this.uFade, uFar: this.uFar, uCamMain: this.uCam };
    this.impostors = new THREE.Mesh(ig, impostorMaterial(imp.albedo, imp.normal, imp.sp, shared));
    this.impostors.customDepthMaterial = impostorDepthMaterial(imp.albedo, imp.sp, shared);
    this.impostors.frustumCulled = false; this.impostors.receiveShadow = true; this.impostors.castShadow = true;
    this.impostors.layers.enable(REFLECT_LAYER);
    this.impostors.name = 'trees_impostors';
    scene.add(this.impostors);
    this._lastQ = new THREE.Quaternion(); this._lastFov = 0; this._age = 0;
    this._counts = new Int32Array(KINDS.length); this._guard = KINDS.map(() => []);
  }
  _key(x, z) { return Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell); }

  get nearDist() { return this._nearQ; }
  set nearDist(v) { this._nearQ = v; const b = v * NEAR_SCALE; this.uFade.value.set(b - FADE_BAND, b); this.lastPos?.set(1e9, 0, 0); }
  get treeDist() { return this.uFar.value; }
  set treeDist(v) { this.uFar.value = v; }

  // near pool: trees inside the near range whose crown — or shadow — can touch the view frustum. Rebuilt at most
  // ~15 times a second (immediately after a jump: >10 m, >5° turn, zoom), with a 20 m guard on the candidate radius
  // and frustum spheres so membership that is a frame or two old never leaves holes; the fade itself is per pixel on
  // the GPU. Trees within the near range (+10 m) come first in each pool: the shadow pass only draws that prefix (the
  // rest of the guard band is faded out in colour and casts through the impostors).
  update(dt, camera, force = false) {
    camera.updateMatrixWorld();
    const cp = camera.position;
    this.uCam.value.copy(cp);
    this._age += dt;
    const moved2 = cp.distanceToSquared(this.lastPos), qd = Math.abs(_q.copy(camera.quaternion).dot(this._lastQ)), dfov = Math.abs(camera.fov - this._lastFov);
    const urgent = force || moved2 > 100 || qd < 0.99905 || dfov > 1;
    if (!urgent && (this._age < 1 / 15 || (moved2 < 1e-4 && qd > 0.9999999 && dfov < 0.01))) return;
    this._age = 0;
    this.lastPos.copy(cp); this._lastQ.copy(camera.quaternion); this._lastFov = camera.fov;
    _frustum.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const sd = U.sunDir.value, tanE = sd.y / Math.max(1e-3, Math.hypot(sd.x, sd.z));
    const shadowExt = sd.y > 0.05 ? Math.min(45, 14 / Math.max(0.3, tanE)) : 25;
    const counts = this._counts, guard = this._guard;
    counts.fill(0); for (const g of guard) g.length = 0;
    let np = 0;
    const B = this.uFade.value.y, B2 = (B + 10) * (B + 10), R = B + 20, R2 = R * R, M = this.matrices, dy2 = (cp.y - 6) * (cp.y - 6);
    const c0x = Math.floor((cp.x - R) / this.cell), c1x = Math.floor((cp.x + R) / this.cell);
    const c0z = Math.floor((cp.z - R) / this.cell), c1z = Math.floor((cp.z + R) / this.cell);
    const copy = (t, i) => { const o = counts[t]++ * 16, src = i * 16, dst = this.meshes[t].instanceMatrix.array; for (let k = 0; k < 16; k++) dst[o + k] = M[src + k]; };
    if (dy2 <= R2) for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
      const list = this.grid.get(cx * 100003 + cz); if (!list) continue;
      for (const i of list) {
        const x = this.pos[i * 2], z = this.pos[i * 2 + 1], dx = x - cp.x, dz = z - cp.z, d2 = dx * dx + dz * dz + dy2;
        if (d2 > R2) continue;
        const sc = this.scale[i];
        _sph.center.set(x, 6 * sc, z); _sph.radius = 11 * sc + 24 + shadowExt;
        if (!_frustum.intersectsSphere(_sph)) continue;
        const t = this.types[i];
        if (d2 > B2) { guard[t].push(i); continue; }
        copy(t, i);
        // blossom under ~2/3 of the flowering trees, centred under the (leaning) crown
        const pt = this.petalSp[t];
        if (pt && np < 1024 && hash2(x * 0.37, z * 1.3) < 0.68) {
          const src = i * 16, h = hash2(z, x * 2.1), r = pt[1] * sc * (0.8 + 0.4 * h), ang = h * 40, cs = Math.cos(ang), sn = Math.sin(ang), pa = this.petals.instanceMatrix.array, po = np * 16;
          pa[po] = cs * r; pa[po + 1] = 0; pa[po + 2] = -sn * r; pa[po + 3] = 0; pa[po + 4] = 0; pa[po + 5] = 1; pa[po + 6] = 0; pa[po + 7] = 0;
          pa[po + 8] = sn * r; pa[po + 9] = 0; pa[po + 10] = cs * r; pa[po + 11] = 0;
          pa[po + 12] = x + M[src + 4] * 7; pa[po + 13] = 0.1; pa[po + 14] = z + M[src + 6] * 7; pa[po + 15] = 1;
          const ca = this.petals.instanceColor.array, b = 0.75 + 0.5 * hash2(x * 3.1, z), co = np * 3;
          ca[co] = pt[0][0] * b; ca[co + 1] = pt[0][1] * b; ca[co + 2] = pt[0][2] * b;
          np++;
        }
      }
    }
    for (let t = 0; t < KINDS.length; t++) {
      const im = this.meshes[t];
      im.shadowCount = counts[t];
      for (const i of guard[t]) copy(t, i);
      const n = counts[t];
      im.count = n;
      im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, Math.max(16, n * 16)); im.instanceMatrix.needsUpdate = true;
    }
    this._built = true;
    const P = this.petals; P.count = np;
    P.instanceMatrix.clearUpdateRanges(); P.instanceMatrix.addUpdateRange(0, Math.max(16, np * 16)); P.instanceMatrix.needsUpdate = true;
    P.instanceColor.clearUpdateRanges(); P.instanceColor.addUpdateRange(0, Math.max(3, np * 3)); P.instanceColor.needsUpdate = true;
  }
}
