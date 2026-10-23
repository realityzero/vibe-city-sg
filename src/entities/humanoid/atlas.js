// Procedural 1024² fabric/skin/hair texture atlas shared by every humanoid (hero meshes and the crowd).
// Garment UVs are generated in [0,1] cell space and remapped into a cell with `cellUV`.
import * as THREE from 'three';

export const ATLAS_SIZE = 1024;
// [x, y, w, h] in canvas pixels (y from top)
export const CELLS = {
  hawaii: [0, 0, 512, 512],      // Tommy: teal Hawaiian shirt
  floral: [512, 0, 512, 512],    // auntie blouse: small dense flowers on cream
  plain: [0, 512, 256, 256],     // near-white fabric (top-left 32px pure white)
  denim: [256, 512, 256, 256],   // grayscale twill, tinted by vertex colour
  hair: [512, 512, 256, 256],    // grayscale strands
  tourist: [768, 512, 256, 256], // red/orange hibiscus print
  batik: [0, 768, 256, 256],     // indigo/brown batik
  skin: [256, 768, 256, 256],    // near-white mottling
  stripes: [512, 768, 256, 256], // white + pale blue pinstripe
  knit: [768, 768, 256, 256],    // near-white knit noise
};
export const PATTERN_LIST = ['plain', 'hawaii', 'floral', 'tourist', 'batik', 'stripes', 'knit', 'denim'];
const INSET = 3;

/** Map local cell coords (u 0..1 left→right, v 0..1 top→bottom) into atlas UV (flipY texture). */
export function cellUV(cell, u, v) {
  const [x, y, w, h] = CELLS[cell];
  return [(x + INSET + u * (w - 2 * INSET)) / ATLAS_SIZE, 1 - (y + INSET + v * (h - 2 * INSET)) / ATLAS_SIZE];
}
export const WHITE_UV = [(CELLS.plain[0] + 12) / ATLAS_SIZE, 1 - (CELLS.plain[1] + 12) / ATLAS_SIZE];
/** uniform-friendly rect (u0, v0, du, dv) so a shader can do uv = rect.xy + local*rect.zw */
export function cellRect(cell) {
  const [x, y, w, h] = CELLS[cell];
  const u0 = (x + INSET) / ATLAS_SIZE, du = (w - 2 * INSET) / ATLAS_SIZE;
  const vTop = 1 - (y + INSET) / ATLAS_SIZE, dv = -(h - 2 * INSET) / ATLAS_SIZE;
  return new THREE.Vector4(u0, vTop, du, dv);
}

let rng = 12345;
const rnd = () => { rng = (rng * 16807) % 2147483647; return (rng - 1) / 2147483646; };

function withCell(ctx, cell, fn) {
  const [x, y, w, h] = CELLS[cell];
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.translate(x, y);
  fn(w, h);
  ctx.restore();
}
// draw a motif at (px,py) plus horizontally wrapped copies so u=0/1 seams tile
function wrapDraw(w, px, r, draw) {
  draw(px);
  if (px - r < 0) draw(px + w);
  if (px + r > w) draw(px - w);
}
function noiseFill(ctx, w, h, base, amp, step = 2) {
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const v = Math.max(0, Math.min(255, base + (rnd() - 0.5) * amp));
    ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x, y, step, step);
  }
}

function hibiscus(ctx, x, y, r, petal, center, rot) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  for (let i = 0; i < 5; i++) {
    ctx.rotate(Math.PI * 2 / 5);
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.52, r * 0.42, r * 0.56, 0, 0, Math.PI * 2);
    ctx.fillStyle = petal; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = Math.max(1, r * 0.04); ctx.stroke();
    // petal veins
    ctx.beginPath(); ctx.moveTo(0, -r * 0.1); ctx.lineTo(0, -r * 0.9);
    ctx.strokeStyle = 'rgba(0,0,0,0.10)'; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2); ctx.fillStyle = center; ctx.fill();
  // stamen
  ctx.strokeStyle = '#f7d046'; ctx.lineWidth = Math.max(1.5, r * 0.07);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * 0.55, -r * 0.35); ctx.stroke();
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(r * 0.55 + (rnd() - 0.5) * r * 0.15, -r * 0.35 + (rnd() - 0.5) * r * 0.15, r * 0.05, 0, Math.PI * 2); ctx.fillStyle = '#f7d046'; ctx.fill(); }
  ctx.restore();
}
function frond(ctx, x, y, len, rot, col, col2) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.strokeStyle = col2; ctx.lineWidth = Math.max(1.5, len * 0.03);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * 0.5, -len * 0.15, len, 0); ctx.stroke();
  ctx.fillStyle = col;
  const n = 11;
  for (let i = 1; i < n; i++) {
    const t = i / n, px = len * t, py = -len * 0.15 * 4 * t * (1 - t) * 0.5;
    const l = len * 0.32 * Math.sin(Math.PI * (0.15 + 0.85 * t)) * (1 - t * 0.4);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + l * 0.35, py + s * l * 0.5, px + l * 0.55, py + s * l);
      ctx.quadraticCurveTo(px + l * 0.1, py + s * l * 0.45, px - len * 0.02, py);
      ctx.fill();
    }
  }
  ctx.restore();
}

function paintHawaii(ctx) {
  withCell(ctx, 'hawaii', (w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1fb3b8'); g.addColorStop(1, '#179ca6');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // subtle weave
    ctx.globalAlpha = 0.05;
    for (let y = 0; y < h; y += 2) { ctx.fillStyle = y % 4 ? '#000' : '#fff'; ctx.fillRect(0, y, w, 1); }
    ctx.globalAlpha = 1;
    // background palm fronds (darker teal)
    for (let i = 0; i < 18; i++) {
      const x = rnd() * w, y = rnd() * h, len = 70 + rnd() * 60, rot = rnd() * Math.PI * 2;
      wrapDraw(w, x, len, px => frond(ctx, px, y, len, rot, '#0e6f7c', '#0b5c66'));
    }
    // light leaves
    for (let i = 0; i < 16; i++) {
      const x = rnd() * w, y = rnd() * h, len = 40 + rnd() * 30, rot = rnd() * Math.PI * 2;
      wrapDraw(w, x, len, px => frond(ctx, px, y, len, rot, '#5fd0c9', '#3fb0aa'));
    }
    // hibiscus flowers (white/pale with deep blue centre)
    const flowers = [];
    for (let i = 0; i < 13; i++) {
      let x, y, r, ok, tries = 0;
      do { x = rnd() * w; y = rnd() * h; r = 26 + rnd() * 16; ok = flowers.every(f => Math.hypot(Math.min(Math.abs(f[0] - x), w - Math.abs(f[0] - x)), f[1] - y) > f[2] + r + 6); } while (!ok && ++tries < 60);
      flowers.push([x, y, r]);
      const petal = rnd() < 0.6 ? '#f2fbfb' : (rnd() < 0.5 ? '#bfeff0' : '#ffe9a8');
      const rot = rnd() * 6.28;
      wrapDraw(w, x, r, px => hibiscus(ctx, px, y, r, petal, '#1a3f8a', rot));
    }
    // tiny dots
    for (let i = 0; i < 120; i++) { const x = rnd() * w, y = rnd() * h; ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.arc(x, y, 1.5 + rnd() * 1.5, 0, 6.28); ctx.fill(); }
  });
}
function paintFloral(ctx) {
  withCell(ctx, 'floral', (w, h) => {
    ctx.fillStyle = '#f5ecd8'; ctx.fillRect(0, 0, w, h);
    const cols = ['#d6336c', '#e8590c', '#ae3ec9', '#f06595', '#c92a2a', '#7048e8'];
    for (let i = 0; i < 70; i++) {
      const x = rnd() * w, y = rnd() * h, len = 18 + rnd() * 14, rot = rnd() * 6.28;
      wrapDraw(w, x, len, px => frond(ctx, px, y, len, rot, '#5c940d', '#4a7a0a'));
    }
    for (let i = 0; i < 110; i++) {
      const x = rnd() * w, y = rnd() * h, r = 8 + rnd() * 9, c = cols[(rnd() * cols.length) | 0], rot = rnd() * 6.28;
      wrapDraw(w, x, r, px => hibiscus(ctx, px, y, r, c, '#ffd43b', rot));
    }
  });
}
function paintTourist(ctx) {
  withCell(ctx, 'tourist', (w, h) => {
    ctx.fillStyle = '#e8590c'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 16; i++) { const x = rnd() * w, y = rnd() * h, l = 30 + rnd() * 20, rot = rnd() * 6.28; wrapDraw(w, x, l, px => frond(ctx, px, y, l, rot, '#2b8a3e', '#237032')); }
    for (let i = 0; i < 14; i++) { const x = rnd() * w, y = rnd() * h, r = 12 + rnd() * 9, rot = rnd() * 6.28; wrapDraw(w, x, r, px => hibiscus(ctx, px, y, r, rnd() < 0.5 ? '#ffe066' : '#fff4e6', '#c92a2a', rot)); }
  });
}
function paintBatik(ctx) {
  withCell(ctx, 'batik', (w, h) => {
    ctx.fillStyle = '#2b3a67'; ctx.fillRect(0, 0, w, h);
    const s = 64;
    for (let gy = 0; gy < h + s; gy += s) for (let gx = 0; gx < w + s; gx += s) {
      const ox = (gy / s) % 2 ? s / 2 : 0;
      ctx.save(); ctx.translate(gx + ox, gy);
      ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, 0, 22, 14, 0.6, 0, 6.28); ctx.stroke();
      ctx.fillStyle = '#a0522d'; ctx.beginPath(); ctx.ellipse(0, 0, 10, 6, 0.6, 0, 6.28); ctx.fill();
      ctx.fillStyle = '#f1e3c6';
      for (let k = 0; k < 8; k++) { const a = k * 0.785; ctx.beginPath(); ctx.arc(Math.cos(a) * 28, Math.sin(a) * 18, 2.5, 0, 6.28); ctx.fill(); }
      ctx.restore();
    }
    ctx.globalAlpha = 0.15; noiseFill(ctx, w, h, 128, 120, 2); ctx.globalAlpha = 1;
  });
}
function paintDenim(ctx) {
  withCell(ctx, 'denim', (w, h) => {
    noiseFill(ctx, w, h, 222, 26, 1);
    ctx.globalAlpha = 0.18;
    for (let k = -h; k < w; k += 3) { ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + h, h); ctx.stroke(); }
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 40; i++) { ctx.fillStyle = '#fff'; ctx.fillRect(rnd() * w, rnd() * h, 1, 6 + rnd() * 18); }
    ctx.globalAlpha = 1;
  });
}
function paintHair(ctx) {
  withCell(ctx, 'hair', (w, h) => {
    ctx.fillStyle = 'rgb(175,175,175)'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      const x = rnd() * w, v = 80 + rnd() * 175, len = 30 + rnd() * 120, y = rnd() * h - 40;
      ctx.strokeStyle = `rgba(${v},${v},${v},0.8)`; ctx.lineWidth = 0.6 + rnd() * 1.4;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + (rnd() - 0.5) * 6, y + len / 2, x + (rnd() - 0.5) * 4, y + len); ctx.stroke();
    }
  });
}
function paintPlain(ctx) {
  withCell(ctx, 'plain', (w, h) => {
    noiseFill(ctx, w, h, 246, 10, 2);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 32, 32);
  });
}
function paintSkin(ctx) {
  withCell(ctx, 'skin', (w, h) => {
    noiseFill(ctx, w, h, 246, 8, 2);
    ctx.globalAlpha = 0.025;
    for (let i = 0; i < 160; i++) { ctx.fillStyle = '#c0605a'; ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, 3 + rnd() * 10, 0, 6.28); ctx.fill(); }
    ctx.globalAlpha = 1;
  });
}
function paintStripes(ctx) {
  withCell(ctx, 'stripes', (w, h) => {
    ctx.fillStyle = '#f7f9fc'; ctx.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) { ctx.fillStyle = 'rgba(70,110,190,0.35)'; ctx.fillRect(x, 0, 1.5, h); }
  });
}
function paintKnit(ctx) {
  withCell(ctx, 'knit', (w, h) => {
    noiseFill(ctx, w, h, 238, 18, 1);
    ctx.globalAlpha = 0.08;
    for (let y = 0; y < h; y += 4) for (let x = 0; x < w; x += 4) { ctx.fillStyle = (x + y) % 8 ? '#000' : '#fff'; ctx.fillRect(x, y, 2, 3); }
    ctx.globalAlpha = 1;
  });
}

let atlasTex = null;
export function getAtlas() {
  if (atlasTex) return atlasTex;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d');
  rng = 12345;
  paintPlain(ctx); paintHawaii(ctx); paintFloral(ctx); paintTourist(ctx); paintBatik(ctx);
  paintDenim(ctx); paintHair(ctx); paintSkin(ctx); paintStripes(ctx); paintKnit(ctx);
  atlasTex = new THREE.CanvasTexture(canvas);
  atlasTex.colorSpace = THREE.SRGBColorSpace;
  atlasTex.anisotropy = 4;
  atlasTex.generateMipmaps = true;
  atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
  atlasTex.needsUpdate = true;
  return atlasTex;
}
