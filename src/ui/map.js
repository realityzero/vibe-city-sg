// Pannable / zoomable map view (used full-screen and inside the pause menu).
import { drawBlip, drawPlayerArrow, BLIP_NAMES, COLORS, MAX_TILES, RADAR_TILES } from './mapRender.js';
import { DISTRICT_LABELS, LANDMARKS } from './districts.js';
import { el, clamp } from './util.js';

const MIN_SCALE = 0.12, MAX_SCALE = 4.5;

export class MapView {
  /** @param {HTMLElement} container  @param {() => import('./mapRender.js').MapData|null} getMap */
  constructor(container, getMap) {
    this.getMap = getMap;
    this.root = el('div', 'vc-mapview vc-interactive');
    this.canvas = el('canvas');
    this.root.appendChild(this.canvas);
    container.appendChild(this.root);
    this.ctx = this.canvas.getContext('2d');
    this.cx = 0; this.cz = 0; this.scale = 0.35;
    this.state = { blips: [] };
    this.waypoint = null;
    this.route = null;
    this._raf = 0;
    this._t0 = performance.now();

    const zoomBox = el('div', 'vc-map-zoom');
    const zin = el('button', '', '+'), zout = el('button', '', '−'), zme = el('button', '', '◎');
    zin.onclick = () => this.zoomAt(1.5); zout.onclick = () => this.zoomAt(1 / 1.5);
    zme.title = 'Centre on player'; zme.onclick = () => { if (this.state.x != null) { this.cx = this.state.x; this.cz = this.state.z; } };
    zoomBox.append(zin, zout, zme);
    this.root.appendChild(zoomBox);
    this.hint = el('div', 'vc-map-hint', 'Drag to pan · Scroll to zoom · Right-click to set a waypoint');
    this.root.appendChild(this.hint);
    this.legend = el('div', 'vc-map-legend');
    this.root.appendChild(this.legend);
    this._buildLegend();

    // one finger / the mouse drags, two fingers pinch-zoom, a long press (touch) drops a waypoint
    let drag = null, press = null, lpAt = 0;
    const pts = new Map();
    const pinch = () => { const [a, b] = [...pts.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    this.root.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target !== this.canvas) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { this.root.setPointerCapture(e.pointerId); } catch { }
      clearTimeout(press?.t); press = null;
      if (pts.size === 2) { drag = { pinch: pinch() }; return; }
      drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz };
      this.root.classList.add('drag');
      if (e.pointerType !== 'mouse') press = { x: e.clientX, y: e.clientY, t: setTimeout(() => { press = null; drag = null; lpAt = performance.now(); this.toggleWaypoint(e.clientX, e.clientY); }, 550) };
    });
    this.root.addEventListener('pointermove', e => {
      const p = pts.get(e.pointerId); if (!p) return;
      p.x = e.clientX; p.y = e.clientY;
      if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) { clearTimeout(press.t); press = null; }
      if (!drag) return;
      if (drag.pinch && pts.size === 2) {
        const q = pinch(), r = this.canvas.getBoundingClientRect();
        this.zoomAt(q.d / drag.pinch.d, q.x - r.left, q.y - r.top); drag.pinch = q;
      } else if (!drag.pinch) {
        this.cx = drag.cx - (e.clientX - drag.x) / this.scale;
        this.cz = drag.cz - (e.clientY - drag.y) / this.scale;
      }
    });
    const end = e => { pts.delete(e.pointerId); clearTimeout(press?.t); press = null; drag = null; this.root.classList.remove('drag'); };
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', end);
    this.root.addEventListener('wheel', e => {
      e.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      this.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    this.root.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (performance.now() - lpAt > 800) this.toggleWaypoint(e.clientX, e.clientY); // Android also fires one after a long press
    });
  }

  /** set a waypoint at a screen point, or clear it when tapping the current one */
  toggleWaypoint(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    const [x, z] = this.screenToWorld(cx - r.left, cy - r.top);
    if (this.waypoint && Math.hypot(this.waypoint.x - x, this.waypoint.z - z) * this.scale < 18) this.waypoint = null;
    else this.waypoint = { x, z };
    this.onWaypoint?.(this.waypoint ? this.waypoint.x : null, this.waypoint ? this.waypoint.z : null);
  }

  _buildLegend() {
    this.legend.innerHTML = '<div class="ttl">Legend</div>';
    const types = ['mission', 'objective', 'checkpoint', 'safehouse', 'shop', 'friend', 'enemy', 'police', 'vehicle'];
    for (const ty of types) {
      const c = el('canvas'); c.width = c.height = 48;
      const x = c.getContext('2d');
      drawBlip(x, ty, 24, 24, 13, {});
      const lbl = el('span', '', BLIP_NAMES[ty]);
      this.legend.append(c, lbl);
    }
  }

  screenToWorld(px, py) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    return [this.cx + (px - w / 2) / this.scale, this.cz + (py - h / 2) / this.scale];
  }
  zoomAt(f, px, py) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (px == null) { px = w / 2; py = h / 2; }
    const [wx, wz] = this.screenToWorld(px, py);
    this.scale = clamp(this.scale * f, MIN_SCALE, MAX_SCALE);
    this.cx = wx - (px - w / 2) / this.scale;
    this.cz = wz - (py - h / 2) / this.scale;
  }

  /** @param {{x?:number,z?:number,heading?:number,playerHeading?:number,blips?:Array,route?:Array,waypoint?:{x,z},onWaypoint?:Function,scale?:number}} s */
  show(s = {}) {
    { const md = this.getMap(); if (md) md.cap = MAX_TILES; }
    this.hint.textContent = this.root.closest('.vc-touchmode') ? 'Drag to pan · Pinch to zoom · Long-press to set a waypoint' : 'Drag to pan · Scroll to zoom · Right-click to set a waypoint';
    this.state = { blips: [], ...s };
    if (s.waypoint !== undefined) this.waypoint = s.waypoint;
    if (s.route !== undefined) this.route = s.route;
    this.onWaypoint = s.onWaypoint;
    const m = this.getMap();
    if (s.x != null) { this.cx = s.x; this.cz = s.z; }
    else if (m) { this.cx = (m.xmin + m.xmax) / 2; this.cz = (m.zmin + m.zmax) / 2; }
    if (s.scale) this.scale = s.scale;
    // first draw on the next animation frame: drawing synchronously here would force a layout of the just-unhidden panel
    if (!this._raf) this._raf = requestAnimationFrame(() => this._loop());
  }
  hide() { cancelAnimationFrame(this._raf); this._raf = 0; const md = this.getMap(); if (md) { md.cap = RADAR_TILES; md.trim(); } }
  setBlips(blips) { this.state.blips = blips || []; }

  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    this.draw();
  }

  draw() {
    const m = this.getMap();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    if (!cw || !ch) return;
    const W = Math.round(cw * dpr), H = Math.round(ch * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    const ctx = this.ctx, t = (performance.now() - this._t0) / 1000;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgb(${COLORS.water})`; ctx.fillRect(0, 0, W, H);
    if (m) {
      // clamp centre so we never drift off into the void
      this.cx = clamp(this.cx, m.xmin, m.xmax); this.cz = clamp(this.cz, m.zmin, m.zmax);
      const s = this.scale * dpr;
      m.draw(ctx, W / 2, H / 2, this.cx, this.cz, s, 0, Math.hypot(W, H) / 2);
      m.renderPending(3);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const toS = (x, z) => [cw / 2 + (x - this.cx) * this.scale, ch / 2 + (z - this.cz) * this.scale];
    // route
    const route = this.route;
    if (route && route.length > 1) {
      ctx.beginPath();
      route.forEach(([x, z], i) => { const [sx, sy] = toS(x, z); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.stroke();
      ctx.lineWidth = 4; ctx.strokeStyle = '#ff5fbf'; ctx.stroke();
    }
    // labels
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (this.scale < 1.6) {
      const fs = clamp(11 + this.scale * 14, 11, 22);
      ctx.font = `italic 800 ${fs}px "Barlow Condensed", sans-serif`;
      ctx.letterSpacing = `${fs * 0.22}px`;
      for (const d of DISTRICT_LABELS) {
        const [sx, sy] = toS(d.x, d.z);
        if (sx < -200 || sy < -50 || sx > cw + 200 || sy > ch + 50) continue;
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(8,4,20,.75)'; ctx.strokeText(d.name.toUpperCase(), sx, sy);
        ctx.fillStyle = 'rgba(200,232,255,.85)'; ctx.fillText(d.name.toUpperCase(), sx, sy);
      }
      ctx.letterSpacing = '0px';
    }
    if (this.scale > 0.22) {
      const fs = clamp(10 + this.scale * 4, 11, 15);
      ctx.font = `600 ${fs}px Inter, sans-serif`;
      for (const l of LANDMARKS) {
        const [sx, sy] = toS(l.x, l.z);
        if (sx < -100 || sy < -30 || sx > cw + 100 || sy > ch + 30) continue;
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(Math.PI / 4);
        ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
        ctx.fillRect(-3.5, -3.5, 7, 7); ctx.strokeRect(-3.5, -3.5, 7, 7); ctx.restore();
        ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(8,4,20,.85)'; ctx.strokeText(l.name, sx, sy - 12);
        ctx.fillStyle = '#fff3c4'; ctx.fillText(l.name, sx, sy - 12);
      }
    }
    // blips
    for (const b of this.state.blips || []) {
      const [sx, sy] = toS(b.x, b.z);
      drawBlip(ctx, b.type, sx, sy, 8, { color: b.color, label: b.label, t });
      if (b.label && b.label.length > 2) {
        ctx.font = '700 12px Inter, sans-serif';
        ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(b.label, sx, sy + 17);
        ctx.fillStyle = '#fff'; ctx.fillText(b.label, sx, sy + 17);
      }
    }
    if (this.waypoint) { const [sx, sy] = toS(this.waypoint.x, this.waypoint.z); drawBlip(ctx, 'waypoint', sx, sy - 8, 9, { t }); }
    // player
    if (this.state.x != null) {
      const [sx, sy] = toS(this.state.x, this.state.z);
      const pulse = (t * 1.2) % 1;
      ctx.beginPath(); ctx.arc(sx, sy, 8 + pulse * 22, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,63,164,${0.8 * (1 - pulse)})`; ctx.lineWidth = 2; ctx.stroke();
      drawPlayerArrow(ctx, sx, sy, 9, -(this.state.playerHeading ?? this.state.heading ?? 0));
    }
    // scale bar
    const meters = [50, 100, 200, 500, 1000, 2000].find(v => v * this.scale > 70) || 2000;
    const bw = meters * this.scale, bx = 20, by = ch - 64;
    ctx.fillStyle = 'rgba(8,4,20,.65)'; ctx.fillRect(bx - 8, by - 20, bw + 16, 34);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by + 6); ctx.lineTo(bx + bw, by + 6); ctx.lineTo(bx + bw, by); ctx.stroke();
    ctx.font = 'italic 700 13px "Barlow Condensed", sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
    ctx.fillText(meters >= 1000 ? `${meters / 1000} km` : `${meters} m`, bx, by - 9);
  }
}

/** Full-screen map overlay (M key in game). */
export class FullMap {
  constructor(parent, getMap) {
    this.root = el('div', 'vc-fullmap vc-hidden vc-interactive');
    this.root.innerHTML = '<div class="hdr"><span class="t">Vibe City</span><span class="s">Singapore · Central Region</span></div>';
    parent.appendChild(this.root);
    this.view = new MapView(this.root, getMap);
    this.root.appendChild(this.root.querySelector('.hdr'));
    const close = el('button', 'vc-map-close', '✕'); close.title = 'Close map (M)'; close.onclick = () => this.close();
    this.root.appendChild(close);
    this.isOpen = false;
    this._onKey = e => {
      if (!this.isOpen) return;
      if (e.code === 'Escape' || e.code === 'KeyM') { e.preventDefault(); e.stopPropagation(); e.__uiHandled = true; this.close(); }
    };
    window.addEventListener('keydown', this._onKey, true);
  }
  open(s = {}) {
    this.opts = s;
    this.root.classList.remove('vc-hidden');
    this.isOpen = true;
    this.view.show({ scale: 0.6, ...s });
  }
  setBlips(b) { this.view.setBlips(b); }
  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.view.hide();
    this.root.classList.add('vc-hidden');
    this.opts?.onClose?.();
  }
  get waypoint() { return this.view.waypoint; }
}
