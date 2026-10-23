// Per-vehicle-type canvas texture atlas: liveries, door seams, plates, grilles, signs.
// UV origin is the canvas top-left (texture.flipY = false).
import * as THREE from 'three';

const SIZE = 1024;
export const REGIONS = {
  white: [0, 0, 16, 16],
  sideR: [0, 24, 1024, 264],    // right side (+x), canvas left = rear of car
  sideL: [0, 292, 1024, 264],   // left side (-x), canvas left = front of car
  front: [0, 560, 512, 256],    // viewed from the front (canvas left = car +x)
  rear: [512, 560, 512, 256],   // viewed from behind (canvas left = car -x)
  sign: [0, 820, 512, 100],
  sign2: [512, 820, 512, 100],
  misc: [0, 924, 512, 100],
  misc2: [512, 924, 512, 100],
};

export class Atlas {
  constructor() {
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(SIZE, SIZE) : Object.assign(document.createElement('canvas'), { width: SIZE, height: SIZE });
    this.ctx = this.canvas.getContext('2d');
    this.ctx.clearRect(0, 0, SIZE, SIZE);
    this.ctx.fillStyle = '#fff';
    this.ctx.fillRect(...REGIONS.white);
    this.whiteUV = [8 / SIZE, 8 / SIZE];
    this._tex = null;
  }
  /** Normalised atlas uv for a point (fx, fy in 0..1, fy = 0 top) inside a region. */
  uv(region, fx, fy) {
    const [x, y, w, h] = REGIONS[region];
    fx = Math.min(1, Math.max(0, fx)); fy = Math.min(1, Math.max(0, fy));
    return [(x + 1 + fx * (w - 2)) / SIZE, (y + 1 + fy * (h - 2)) / SIZE];
  }
  rect(region) { const [x, y, w, h] = REGIONS[region]; return [x / SIZE, y / SIZE, (x + w) / SIZE, (y + h) / SIZE]; }
  /** Draw inside a region with a mapping helper. map(x,y) converts region-normalised coords to pixels. */
  draw(region, fn) {
    const [x, y, w, h] = REGIONS[region];
    const c = this.ctx;
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); c.translate(x, y);
    fn(c, w, h);
    c.restore();
  }
  texture() {
    if (this._tex) return this._tex;
    const t = new THREE.CanvasTexture(this.canvas);
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    this._tex = t;
    return t;
  }
}

// ---------- painting helpers (all in pixel space of a region) ----------
export function plate(c, cx, cy, w, h, text, { bg = '#0b0b0b', fg = '#f2f2f2', border = '#d8d8d8' } = {}) {
  c.save();
  c.fillStyle = border; roundRect(c, cx - w / 2 - 2, cy - h / 2 - 2, w + 4, h + 4, 4); c.fill();
  c.fillStyle = bg; roundRect(c, cx - w / 2, cy - h / 2, w, h, 3); c.fill();
  c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `bold ${Math.round(h * 0.72)}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
  const tw = c.measureText(text).width;
  c.save(); c.translate(cx, cy + h * 0.04); if (tw > w * 0.9) c.scale(w * 0.9 / tw, 1);
  c.fillText(text, 0, 0); c.restore();
  c.restore();
}
export function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
  c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}
export function text(c, str, x, y, { size = 20, color = '#fff', font = 'Arial, Helvetica, sans-serif', weight = 'bold', align = 'center', italic = false, maxW = 0, stroke = null, strokeW = 0 } = {}) {
  c.save();
  c.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${font}`;
  c.textAlign = align; c.textBaseline = 'middle';
  const tw = c.measureText(str).width;
  c.translate(x, y);
  if (maxW && tw > maxW) c.scale(maxW / tw, 1);
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = strokeW; c.lineJoin = 'round'; c.strokeText(str, 0, 0); }
  c.fillStyle = color; c.fillText(str, 0, 0);
  c.restore();
}
/** Honeycomb / mesh grille pattern inside a rounded rect. */
export function grille(c, x, y, w, h, { r = 6, bg = '#070707', bar = '#3a3a3a', style = 'mesh', surround = '#c8c8c8', surroundW = 3 } = {}) {
  c.save();
  roundRect(c, x, y, w, h, r); c.fillStyle = bg; c.fill();
  c.clip();
  c.strokeStyle = bar; c.lineWidth = 2;
  if (style === 'mesh') {
    for (let yy = y + 4; yy < y + h; yy += 8) for (let xx = x + ((yy / 8) % 2) * 5; xx < x + w; xx += 10) { c.beginPath(); c.moveTo(xx, yy); c.lineTo(xx + 5, yy + 4); c.lineTo(xx + 10, yy); c.stroke(); }
  } else if (style === 'bars') {
    for (let yy = y + h / 6; yy < y + h; yy += h / 5) { c.fillStyle = bar; c.fillRect(x, yy, w, Math.max(2, h / 14)); }
  } else if (style === 'vbars') {
    for (let xx = x + 6; xx < x + w; xx += 9) { c.fillStyle = bar; c.fillRect(xx, y, 3, h); }
  } else if (style === 'slats') {
    for (let yy = y + 5; yy < y + h; yy += 7) { c.fillStyle = bar; c.fillRect(x, yy, w, 2); }
  }
  c.restore();
  if (surroundW) { c.save(); roundRect(c, x, y, w, h, r); c.lineWidth = surroundW; c.strokeStyle = surround; c.stroke(); c.restore(); }
}
/** Panel seam line (dark) with a subtle highlight. */
export function seam(c, pts, w = 2) {
  c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
  c.strokeStyle = 'rgba(10,10,10,1)'; c.lineWidth = w;
  c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
  c.restore();
}
export function handle(c, x, y, w = 26, h = 7, col = '#b9b9b9') {
  c.save(); c.fillStyle = 'rgba(15,15,15,1)'; roundRect(c, x - w / 2 - 1, y - h / 2 - 1, w + 2, h + 2, 3); c.fill();
  c.fillStyle = col; roundRect(c, x - w / 2, y - h / 2, w, h, 3); c.fill(); c.restore();
}
export function checker(c, x, y, w, h, cell, a = '#1b3f9a', b = '#ffffff', rows = 2) {
  c.save();
  const ch = h / rows;
  for (let r = 0; r < rows; r++) for (let i = 0; i * cell < w; i++) { c.fillStyle = (i + r) % 2 ? a : b; c.fillRect(x + i * cell, y + r * ch, Math.min(cell, w - i * cell), ch); }
  c.restore();
}
