// Aircraft instruments: compass tape (top-centre) + altimeter tape with vertical speed (next to the radar).
// Shown while hud.update() receives a non-null `altitude`.
import { el } from './util.js';

const CARD = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

export class FlightInstruments {
  constructor(parent, root) {
    this.rootEl = root;
    this.compass = el('canvas', 'vc-compass');
    this.alt = el('canvas', 'vc-altimeter');
    parent.append(this.compass, this.alt);
    this.on = false;
    this.last = '';
  }

  setFlying(on) {
    if (on === this.on) return;
    this.on = on;
    this.rootEl?.classList.toggle('vc-flying', on);
    this.last = '';
  }

  /** @param {{altitude:number, vspeed?:number, heading?:number, headingDeg?:number}} s heading in radians (three.js yaw, 0 = north) */
  update(s) {
    if (!this.on) return;
    const bearing = s.headingDeg != null ? s.headingDeg : (-(s.heading || 0) * 180) / Math.PI;
    const b = ((bearing % 360) + 360) % 360;
    const key = `${b.toFixed(1)}|${(s.altitude || 0).toFixed(1)}|${(s.vspeed || 0).toFixed(1)}`;
    if (key === this.last) return;
    this.last = key;
    this._drawCompass(b);
    this._drawAlt(s.altitude || 0, s.vspeed || 0);
  }

  _fit(c) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // measure once (+ on resize) instead of reading layout every frame mid-HUD-update
    if (c._cw == null || !c._cw) { c._cw = c.clientWidth; c._ch = c.clientHeight; if (!c._ro && window.ResizeObserver) { c._ro = new ResizeObserver(e => { c._cw = e[0].contentRect.width; c._ch = e[0].contentRect.height; }); c._ro.observe(c); } }
    const w = Math.round(c._cw * dpr), h = Math.round(c._ch * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return [c.getContext('2d'), w, h];
  }

  _drawCompass(b) {
    const [ctx, W, H] = this._fit(this.compass);
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(8,4,20,0)'); g.addColorStop(0.15, 'rgba(8,4,20,.55)'); g.addColorStop(0.85, 'rgba(8,4,20,.55)'); g.addColorStop(1, 'rgba(8,4,20,0)');
    ctx.fillStyle = g; ctx.fillRect(0, H * 0.18, W, H * 0.62);
    const range = 70, ppd = W / (range * 2), cx = W / 2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineCap = 'round';
    for (let d = Math.floor((b - range) / 5) * 5; d <= b + range; d += 5) {
      const x = cx + (d - b) * ppd;
      const dd = ((d % 360) + 360) % 360;
      const major = dd % 15 === 0;
      const fade = 1 - Math.min(1, Math.abs(x - cx) / (W / 2));
      ctx.globalAlpha = 0.25 + fade * 0.75;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, H * (major ? 0.05 : 0.03));
      ctx.beginPath(); ctx.moveTo(x, H * 0.66); ctx.lineTo(x, H * (major ? 0.46 : 0.56)); ctx.stroke();
      if (CARD[dd] != null || dd % 30 === 0) {
        const lbl = CARD[dd] ?? String(dd);
        ctx.font = `${CARD[dd] ? 800 : 600} ${H * (CARD[dd] ? 0.34 : 0.26)}px "Barlow Condensed", sans-serif`;
        ctx.lineWidth = H * 0.08; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(lbl, x, H * 0.3);
        ctx.fillStyle = dd === 0 ? '#ff8fd0' : CARD[dd] ? '#fff' : '#cfc8ea'; ctx.fillText(lbl, x, H * 0.3);
      }
    }
    ctx.globalAlpha = 1;
    // centre index + readout
    ctx.fillStyle = '#2fe6ff';
    ctx.beginPath(); ctx.moveTo(cx, H * 0.7); ctx.lineTo(cx - H * 0.09, H * 0.86); ctx.lineTo(cx + H * 0.09, H * 0.86); ctx.closePath(); ctx.fill();
    const txt = `${String(Math.round(b) % 360).padStart(3, '0')}°`;
    ctx.font = `italic 800 ${H * 0.24}px "Barlow Condensed", sans-serif`;
    ctx.lineWidth = H * 0.07; ctx.strokeStyle = '#000'; ctx.strokeText(txt, cx, H * 0.93);
    ctx.fillStyle = '#a8f6ff'; ctx.fillText(txt, cx, H * 0.93);
  }

  _drawAlt(alt, vs) {
    const [ctx, W, H] = this._fit(this.alt);
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    const r = Math.min(W, H) * 0.12;
    ctx.fillStyle = 'rgba(8,4,20,.62)';
    ctx.beginPath(); ctx.roundRect(W * 0.18, 0, W * 0.64, H, r); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.roundRect(W * 0.18, 0, W * 0.64, H, r); ctx.clip();
    const range = 60, ppm = H / (range * 2), cy = H / 2;
    // ground hatch
    const gy = cy + alt * ppm;
    if (gy < H) {
      ctx.fillStyle = 'rgba(255,61,84,.22)'; ctx.fillRect(0, gy, W, H - gy);
      ctx.strokeStyle = 'rgba(255,61,84,.55)'; ctx.lineWidth = 1;
      for (let x = -H; x < W; x += W * 0.18) { ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + (H - gy), gy); ctx.stroke(); }
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let a = Math.floor((alt - range) / 5) * 5; a <= alt + range; a += 5) {
      const y = cy - (a - alt) * ppm;
      const major = a % 20 === 0;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, W * (major ? 0.03 : 0.018));
      ctx.beginPath(); ctx.moveTo(W * 0.82, y); ctx.lineTo(W * (major ? 0.62 : 0.7), y); ctx.stroke();
      if (major) {
        ctx.font = `600 ${W * 0.17}px "Barlow Condensed", sans-serif`;
        ctx.fillStyle = '#d9d2ff'; ctx.fillText(String(a), W * 0.58, y);
      }
    }
    ctx.restore();
    // readout box
    const bh = W * 0.32;
    ctx.fillStyle = '#0a0614'; ctx.strokeStyle = '#2fe6ff'; ctx.lineWidth = Math.max(1.5, W * 0.025);
    ctx.beginPath(); ctx.roundRect(W * 0.06, cy - bh / 2, W * 0.8, bh, bh * 0.25); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W * 0.86, cy - bh * 0.22); ctx.lineTo(W * 0.97, cy); ctx.lineTo(W * 0.86, cy + bh * 0.22); ctx.closePath(); ctx.fillStyle = '#2fe6ff'; ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = `italic 800 ${W * 0.22}px "Barlow Condensed", sans-serif`;
    ctx.fillStyle = '#fff'; ctx.fillText(`${Math.round(alt)}`, W * 0.42, cy + W * 0.01);
    ctx.font = `600 ${W * 0.11}px "Barlow Condensed", sans-serif`;
    ctx.fillStyle = '#a8f6ff'; ctx.fillText('M', W * 0.74, cy + W * 0.02);
    // vertical speed
    const up = vs >= 0;
    const vy = up ? W * 0.16 : H - W * 0.16;
    ctx.font = `italic 800 ${W * 0.17}px "Barlow Condensed", sans-serif`;
    ctx.fillStyle = Math.abs(vs) < 0.3 ? '#cfc8ea' : up ? '#7fe36a' : '#ff5f6f';
    ctx.lineWidth = W * 0.05; ctx.strokeStyle = '#000';
    const vt = `${up ? '▲' : '▼'} ${Math.abs(vs).toFixed(1)}`;
    ctx.strokeText(vt, W * 0.5, vy); ctx.fillText(vt, W * 0.5, vy);
  }
}
