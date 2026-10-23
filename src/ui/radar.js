// Circular VC-style radar. Rotates with the camera (heading 0 = facing north / -z, three.js yaw convention:
// forward = (-sin h, 0, -cos h)). Blits the pre-rendered map, then blips/route/ring on top.
import { drawBlip, drawPlayerArrow, COLORS } from './mapRender.js';
import { el } from './util.js';

export class Radar {
  constructor(parent) {
    this.wrap = el('div', 'vc-radar-wrap');
    this.canvas = el('canvas');
    this.wrap.appendChild(this.canvas);
    parent.appendChild(this.wrap);
    this.ctx = this.canvas.getContext('2d');
    this.map = null;
    this.route = null;
    this.zoom = 180;
    this._size = 0;
    this._t0 = performance.now();
    this.visible = true;
  }
  setMapData(mapData) { this.map = mapData; }
  /** GPS line: array of [x, z] in world metres, or null */
  setRoute(points) { this.route = points && points.length > 1 ? points : null; }
  setVisible(v) { this.visible = v; this.wrap.classList.toggle('off', !v); }

  _resize() {
    // the wrapper's size only changes on window resize: measure lazily, never inside the per-frame HUD write burst
    if (this._w == null) {
      this._w = this.wrap.getBoundingClientRect().width;
      if (!this._ro && window.ResizeObserver) { this._ro = new ResizeObserver(e => { this._w = e[0].contentRect.width; }); this._ro.observe(this.wrap); }
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.max(64, Math.round(this._w * dpr));
    if (size !== this._size) { this._size = size; this.canvas.width = this.canvas.height = size; }
    return size;
  }

  /**
   * @param {{x:number,z:number,y?:number,heading:number,playerHeading?:number,blips?:Array,zoom?:number}} s
   */
  update(s) {
    if (!this.visible) return;
    const size = this._resize();
    const ctx = this.ctx;
    const t = (performance.now() - this._t0) / 1000;
    const R = size / 2, rIn = R * 0.9;
    const zoom = s.zoom || this.zoom;
    const scale = rIn / zoom;                       // px per metre
    const rot = s.heading || 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // map disc
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, rIn, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = `rgb(${COLORS.water})`; ctx.fillRect(0, 0, size, size);
    if (this.map) {
      this.map.draw(ctx, R, R, s.x, s.z, scale, rot, rIn * 1.05);
      this.map.renderPending(1);
    }
    // GPS route
    if (this.route) {
      ctx.save();
      ctx.translate(R, R); ctx.rotate(rot); ctx.scale(scale, scale); ctx.translate(-s.x, -s.z);
      ctx.beginPath();
      ctx.moveTo(this.route[0][0], this.route[0][1]);
      for (let i = 1; i < this.route.length; i++) ctx.lineTo(this.route[i][0], this.route[i][1]);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = (size * 0.045) / scale; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke();
      ctx.lineWidth = (size * 0.026) / scale; ctx.strokeStyle = '#ff5fbf'; ctx.stroke();
      ctx.restore();
    }
    // vignette + scanline sheen
    const g = ctx.createRadialGradient(R, R, rIn * 0.55, R, R, rIn);
    g.addColorStop(0, 'rgba(10,4,24,0)'); g.addColorStop(1, 'rgba(10,4,24,.55)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    ctx.restore();

    // ring
    ctx.lineWidth = size * 0.05; ctx.strokeStyle = 'rgba(8,4,20,.85)';
    ctx.beginPath(); ctx.arc(R, R, rIn + size * 0.022, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = size * 0.012; ctx.strokeStyle = 'rgba(255,63,164,.95)';
    ctx.beginPath(); ctx.arc(R, R, rIn + size * 0.004, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = size * 0.007; ctx.strokeStyle = 'rgba(47,230,255,.8)';
    ctx.beginPath(); ctx.arc(R, R, rIn + size * 0.036, 0, Math.PI * 2); ctx.stroke();

    // blips
    const sinH = Math.sin(rot), cosH = Math.cos(rot);
    const bs = size * 0.04;
    const py = s.y ?? 0;
    for (const b of s.blips || []) {
      const dx = b.x - s.x, dz = b.z - s.z;
      let sx = (cosH * dx - sinH * dz) * scale, sy = (sinH * dx + cosH * dz) * scale;
      const d = Math.hypot(sx, sy), lim = rIn - bs * 1.1;
      let edge = false;
      if (d > lim) {
        if (b.type === 'police' || b.type === 'enemy' || b.type === 'friend') { if (d > lim * 1.6) continue; }
        sx *= lim / d; sy *= lim / d; edge = true;
      }
      drawBlip(ctx, b.type, R + sx, R + sy, edge ? bs * 0.85 : bs, { color: b.color, label: b.label, dy: b.y != null ? b.y - py : 0, t, edge });
    }
    // north marker on the ring
    const nx = R + Math.sin(rot) * (rIn + size * 0.004), ny = R - Math.cos(rot) * (rIn + size * 0.004);
    ctx.beginPath(); ctx.arc(nx, ny, size * 0.055, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0614'; ctx.fill(); ctx.lineWidth = size * 0.012; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `800 ${size * 0.075}px "Barlow Condensed", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', nx, ny + size * 0.004);

    // player
    const pa = s.playerHeading != null ? rot - s.playerHeading : 0;
    drawPlayerArrow(ctx, R, R, size * 0.045, pa);
  }
}
