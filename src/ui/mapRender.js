// Shared map rendering for the radar and the full-screen map.
// - `base`: whole-city raster at 0.5 px/m (one pixel per ground.png texel), recoloured mask + buildings + roads.
// - hi-res tiles (TILE_M metres at TILE_PX px) rendered lazily from spatially bucketed vector features, LRU cached.
export const TILE_M = 256, TILE_PPM = 2, TILE_PX = TILE_M * TILE_PPM;
const MAX_TILES = 40;

export const COLORS = {
  water: [12, 66, 108], pond: [20, 84, 128], land: [27, 22, 50], park: [30, 74, 52], wood: [24, 62, 44], pitch: [40, 92, 58],
  plaza: [46, 39, 74], sidewalk: [41, 35, 66], parking: [38, 32, 62], apron: [34, 29, 58],
  building: '#3b3263', buildingEdge: '#52467f', buildingTall: '#463a78',
};
// road style per class: [fill, casing|null, minPx at base]
const ROAD = {
  0: ['#ffb347', '#6a3a12', 2.6], 1: ['#ffd27a', '#5e4416', 2.4], 2: ['#f6f2ff', '#4a4070', 2.0], 3: ['#e2dbf7', '#463d6a', 1.6],
  4: ['#cbc3e8', '#40375f', 1.3], 5: ['#9d95c0', null, 1.0], 6: ['#8d86b0', null, 0.9], 7: ['#6d6692', null, 0.7],
  8: ['#5a5282', null, 0.8], 9: ['#463f6a', null, 0.5],
};
const ORDER = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];

export class MapData {
  /** @param {object} city parsed city.json  @param {HTMLImageElement|ImageBitmap} ground ground.png */
  constructor(city, ground) {
    const m = city.meta;
    this.xmin = m.xmin; this.zmin = m.zmin; this.xmax = m.xmax; this.zmax = m.zmax;
    this.res = m.res || 2;
    this.ppm = 1 / this.res;                       // base canvas px per metre
    this.W = m.w || Math.ceil((m.xmax - m.xmin) * this.ppm);
    this.H = m.h || Math.ceil((m.zmax - m.zmin) * this.ppm);
    this.tilesX = Math.ceil((this.xmax - this.xmin) / TILE_M);
    this.tilesZ = Math.ceil((this.zmax - this.zmin) / TILE_M);
    this.ground = this._recolor(ground);
    this._bucket(city);
    this.base = document.createElement('canvas');
    this.base.width = this.W; this.base.height = this.H;
    const ctx = this.base.getContext('2d');
    ctx.drawImage(this.ground, 0, 0);
    ctx.setTransform(this.ppm, 0, 0, this.ppm, -this.xmin * this.ppm, -this.zmin * this.ppm);
    this._drawFeatures(ctx, this.buildings, this.roads, this.ppm);
    this.tiles = new Map();                        // key -> canvas (insertion order = LRU)
    this.pending = new Set();
  }

  _recolor(img) {
    const c = document.createElement('canvas');
    c.width = this.W; c.height = this.H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, this.W, this.H);
    const id = ctx.getImageData(0, 0, this.W, this.H), d = id.data;
    const C = COLORS;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      let col;
      if (r < 64) col = C.water;
      else if (r < 200) col = C.pond;
      else if (g >= 230) col = C.park;
      else if (g >= 150) col = C.wood;
      else if (g >= 80) col = C.pitch;
      else if (b >= 250) col = C.plaza;
      else if (b >= 210) col = C.sidewalk;
      else if (b >= 190) col = C.parking;
      else if (b >= 100) col = C.apron;
      else col = C.land;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return c;
  }

  _bucket(city) {
    const nb = this.tilesX * this.tilesZ;
    this.bB = Array.from({ length: nb }, () => []);
    this.bR = Array.from({ length: nb }, () => []);
    this.buildings = [];
    this.roads = [];
    const add = (arr, buckets, item, p) => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < p.length; i += 2) { const x = p[i], z = p[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      const pad = item.w ? item.w : 0;
      const tx0 = Math.max(0, Math.floor((x0 - pad - this.xmin) / TILE_M)), tx1 = Math.min(this.tilesX - 1, Math.floor((x1 + pad - this.xmin) / TILE_M));
      const tz0 = Math.max(0, Math.floor((z0 - pad - this.zmin) / TILE_M)), tz1 = Math.min(this.tilesZ - 1, Math.floor((z1 + pad - this.zmin) / TILE_M));
      arr.push(item);
      for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) buckets[tz * this.tilesX + tx].push(item);
    };
    for (const b of city.buildings || []) {
      if (!b.p || b.p.length < 6) continue;
      add(this.buildings, this.bB, { p: b.p, h: b.h || 10, m: b.m || 0 }, b.p);
    }
    // parts and minHeight>0 (sky bridges) drawn after ground-level buildings
    this.buildings.sort((a, b) => (a.m > 0) - (b.m > 0) || a.h - b.h);
    for (const bucket of this.bB) bucket.sort((a, b) => (a.m > 0) - (b.m > 0) || a.h - b.h);
    for (const r of city.roads || []) {
      if (!r.p || r.p.length < 4) continue;
      add(this.roads, this.bR, { p: r.p, c: r.c ?? 5, w: r.w || 6, b: r.b ? 1 : 0, x: r.x ? 1 : 0 }, r.p);
    }
    const order = r => ORDER.indexOf(r.c) + r.b * 20;
    this.roads.sort((a, b) => order(a) - order(b));
    for (const bucket of this.bR) bucket.sort((a, b) => order(a) - order(b));
  }

  /** ctx must already carry a world->pixel transform with uniform scale `ppm` (px per metre). */
  _drawFeatures(ctx, buildings, roads, ppm) {
    // buildings
    const bp = new Path2D(), tall = new Path2D();
    for (const b of buildings) {
      const path = b.h > 60 ? tall : bp;
      const p = b.p;
      path.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) path.lineTo(p[i], p[i + 1]);
      path.closePath();
    }
    ctx.fillStyle = COLORS.building; ctx.fill(bp);
    ctx.fillStyle = COLORS.buildingTall; ctx.fill(tall);
    if (ppm >= 1) {
      ctx.lineWidth = 0.8 / ppm; ctx.strokeStyle = COLORS.buildingEdge; ctx.stroke(bp); ctx.stroke(tall);
    }
    // roads: casing pass then fill pass, grouped by style so we only change state per group
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const groups = new Map();
    for (const r of roads) {
      const st = ROAD[r.c] || ROAD[5];
      const wpx = Math.max(r.w * ppm, st[2] * (ppm >= 1 ? 1.5 : 1));
      const key = `${r.c}|${r.b}|${Math.round(wpx * 2)}`;
      let g = groups.get(key);
      if (!g) { g = { st, wpx, c: r.c, b: r.b, path: new Path2D() }; groups.set(key, g); }
      const p = r.p;
      g.path.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) g.path.lineTo(p[i], p[i + 1]);
    }
    const list = [...groups.values()].sort((a, b) => (ORDER.indexOf(a.c) + a.b * 20) - (ORDER.indexOf(b.c) + b.b * 20));
    for (const g of list) {
      if (!g.st[1]) continue;
      ctx.strokeStyle = g.b ? '#120d24' : g.st[1];
      ctx.lineWidth = (g.wpx + Math.max(1, ppm * 1.4) * (g.b ? 2 : 1)) / ppm;
      ctx.stroke(g.path);
    }
    for (const g of list) {
      ctx.strokeStyle = g.st[0];
      ctx.globalAlpha = g.c >= 8 ? 0.8 : 1;
      ctx.lineWidth = g.wpx / ppm;
      if (g.c === 9 && ppm >= 1) ctx.setLineDash([2.2, 1.6]);
      ctx.stroke(g.path);
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  /** Returns a cached hi-res tile canvas or null (and queues it). Call `renderPending(n)` to build queued tiles. */
  tile(tx, tz) {
    if (tx < 0 || tz < 0 || tx >= this.tilesX || tz >= this.tilesZ) return null;
    const k = tz * this.tilesX + tx;
    const t = this.tiles.get(k);
    if (t) { this.tiles.delete(k); this.tiles.set(k, t); return t; }
    this.pending.add(k);
    return null;
  }

  renderPending(maxTiles = 1) {
    let n = 0;
    for (const k of this.pending) {
      this.pending.delete(k);
      if (this.tiles.has(k)) continue;
      this._renderTile(k);
      if (++n >= maxTiles) break;
    }
    return n;
  }

  _renderTile(k) {
    const tx = k % this.tilesX, tz = (k / this.tilesX) | 0;
    let c;
    if (this.tiles.size >= MAX_TILES) { const oldK = this.tiles.keys().next().value; c = this.tiles.get(oldK); this.tiles.delete(oldK); }
    else { c = document.createElement('canvas'); c.width = TILE_PX; c.height = TILE_PX; }
    const ctx = c.getContext('2d');
    const x0 = this.xmin + tx * TILE_M, z0 = this.zmin + tz * TILE_M;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgb(${COLORS.water})`; ctx.fillRect(0, 0, TILE_PX, TILE_PX);
    ctx.setTransform(TILE_PPM, 0, 0, TILE_PPM, -x0 * TILE_PPM, -z0 * TILE_PPM);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const sx = (x0 - this.xmin) * this.ppm, sz = (z0 - this.zmin) * this.ppm, sw = TILE_M * this.ppm;
    ctx.drawImage(this.ground, sx - 1, sz - 1, sw + 2, sw + 2, x0 - this.res, z0 - this.res, TILE_M + 2 * this.res, TILE_M + 2 * this.res);
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, z0, TILE_M, TILE_M); ctx.clip();
    this._drawFeatures(ctx, this.bB[k], this.bR[k], TILE_PPM);
    ctx.restore();
    this.tiles.set(k, c);
  }

  /**
   * Draws the map into ctx for a view centred at world (cx, cz) with `scale` px/m and rotation `rot`
   * (canvas rotate angle; 0 = north up). (ox, oy) is the screen centre. Uses tiles when zoomed in.
   */
  draw(ctx, ox, oy, cx, cz, scale, rot, radiusPx, useTiles = true) {
    ctx.save();
    ctx.translate(ox, oy);
    if (rot) ctx.rotate(rot);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cz);
    ctx.imageSmoothingEnabled = true;
    // base raster (draw only the visible sub-rectangle)
    const rW = radiusPx / scale;                   // world radius covered (rotation-safe when radiusPx = half-diagonal)
    const vx0 = Math.max(this.xmin, cx - rW), vx1 = Math.min(this.xmax, cx + rW);
    const vz0 = Math.max(this.zmin, cz - rW), vz1 = Math.min(this.zmax, cz + rW);
    if (vx1 > vx0 && vz1 > vz0) {
      const sx = (vx0 - this.xmin) * this.ppm, sz = (vz0 - this.zmin) * this.ppm;
      const sw = (vx1 - vx0) * this.ppm, sh = (vz1 - vz0) * this.ppm;
      ctx.drawImage(this.base, sx, sz, sw, sh, vx0, vz0, vx1 - vx0, vz1 - vz0);
    }
    if (useTiles && scale > this.ppm * 1.15) {
      const tx0 = Math.floor((vx0 - this.xmin) / TILE_M), tx1 = Math.floor((vx1 - this.xmin - 0.01) / TILE_M);
      const tz0 = Math.floor((vz0 - this.zmin) / TILE_M), tz1 = Math.floor((vz1 - this.zmin - 0.01) / TILE_M);
      // nearest tiles first so the queue fills around the centre
      const ctx0 = Math.floor((cx - this.xmin) / TILE_M), ctz0 = Math.floor((cz - this.zmin) / TILE_M);
      const list = [];
      for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) list.push([tx, tz, Math.abs(tx - ctx0) + Math.abs(tz - ctz0)]);
      list.sort((a, b) => a[2] - b[2]);
      // never request more tiles than the cache can hold (that would thrash); base raster covers the rest
      if (list.length > MAX_TILES - 6) list.length = 0;
      for (const [tx, tz] of list) {
        const t = this.tile(tx, tz);
        if (t) ctx.drawImage(t, this.xmin + tx * TILE_M, this.zmin + tz * TILE_M, TILE_M, TILE_M);
      }
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- blips
export const BLIP_COLORS = {
  mission: '#ff3fa4', objective: '#ffd23f', enemy: '#ff3d54', police: '#3a8cff', friend: '#2fe6ff', shop: '#59d96b',
  safehouse: '#ffffff', checkpoint: '#ff3d54', vehicle: '#2fe6ff', waypoint: '#ff3fa4',
};
export const BLIP_NAMES = {
  mission: 'Mission', objective: 'Objective', checkpoint: 'Checkpoint', friend: 'Contact', enemy: 'Target', police: 'Police',
  vehicle: 'Vehicle', shop: 'Shop / Kopitiam', safehouse: 'Safehouse',
};

/**
 * Draw one blip at screen (x, y). `s` = radius in px. `dy` = blip height minus player height (for ▲/▼).
 * `t` = time in seconds (for flashing).
 */
export function drawBlip(ctx, type, x, y, s, { color, label, dy = 0, t = 0, edge = false } = {}) {
  const col = color || BLIP_COLORS[type] || '#fff';
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = 'round';
  const outline = Math.max(1, s * 0.28);
  const disc = (fill, stroke = '#000', r = s) => { ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = outline; ctx.strokeStyle = stroke; ctx.stroke(); };
  const glyph = (txt, fill = '#fff', k = 1.25) => { ctx.fillStyle = fill; ctx.font = `800 ${s * k}px "Barlow Condensed", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, 0, s * 0.06); };
  const levelShape = (fill) => {
    ctx.beginPath();
    if (dy > 4) { ctx.moveTo(0, -s * 1.05); ctx.lineTo(s * 1.0, s * 0.75); ctx.lineTo(-s * 1.0, s * 0.75); }
    else if (dy < -4) { ctx.moveTo(0, s * 1.05); ctx.lineTo(s * 1.0, -s * 0.75); ctx.lineTo(-s * 1.0, -s * 0.75); }
    else ctx.rect(-s * 0.78, -s * 0.78, s * 1.56, s * 1.56);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = outline; ctx.strokeStyle = '#000'; ctx.stroke();
  };
  switch (type) {
    case 'mission':
      disc(col, '#fff', s * 1.05);
      glyph(label && label.length <= 2 ? label : '!', '#fff', label && label.length === 2 ? 1.0 : 1.35);
      break;
    case 'shop':
      disc(col); glyph(label && label.length <= 2 ? label : '$', '#062a0c');
      break;
    case 'safehouse': {
      ctx.beginPath();
      ctx.moveTo(0, -s * 1.1); ctx.lineTo(s * 1.1, -s * 0.05); ctx.lineTo(s * 0.75, -s * 0.05); ctx.lineTo(s * 0.75, s * 0.95);
      ctx.lineTo(-s * 0.75, s * 0.95); ctx.lineTo(-s * 0.75, -s * 0.05); ctx.lineTo(-s * 1.1, -s * 0.05); ctx.closePath();
      ctx.fillStyle = color || '#ff8fd0'; ctx.fill(); ctx.lineWidth = outline; ctx.strokeStyle = '#000'; ctx.stroke();
      ctx.fillStyle = '#2a0d33'; ctx.fillRect(-s * 0.22, s * 0.3, s * 0.44, s * 0.65);
      break;
    }
    case 'checkpoint': {
      const pulse = 1 + 0.12 * Math.sin(t * 6);
      ctx.beginPath(); ctx.arc(0, 0, s * pulse, 0, Math.PI * 2); ctx.lineWidth = s * 0.55; ctx.strokeStyle = '#000'; ctx.stroke();
      ctx.lineWidth = s * 0.32; ctx.strokeStyle = col; ctx.stroke();
      break;
    }
    case 'vehicle': {
      ctx.beginPath();
      const w = s * 0.85, h = s * 1.3, r = s * 0.35;
      ctx.roundRect(-w, -h * 0.75, w * 2, h * 1.5, r);
      ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = outline; ctx.strokeStyle = '#000'; ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(-w * 0.6, -h * 0.45, w * 1.2, h * 0.38);
      break;
    }
    case 'police': {
      const on = Math.floor(t * 4) % 2 === 0;
      levelShape(on ? '#ff3d54' : '#3a8cff');
      break;
    }
    case 'waypoint': {
      ctx.beginPath(); ctx.moveTo(0, s * 1.2); ctx.lineTo(s * 0.9, -s * 0.2); ctx.arc(0, -s * 0.45, s * 0.92, 0.25, Math.PI - 0.25, true); ctx.closePath();
      ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = outline; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, -s * 0.45, s * 0.32, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
      break;
    }
    default: // objective, enemy, friend + anything custom
      levelShape(col);
      if (label && label.length <= 2) glyph(label, '#000', 1.0);
  }
  if (edge) { ctx.globalAlpha = 0.9; }
  ctx.restore();
}

/** Player arrow; `a` = clockwise screen angle from up. */
export function drawPlayerArrow(ctx, x, y, s, a) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(a);
  ctx.beginPath();
  ctx.moveTo(0, -s * 1.25); ctx.lineTo(s * 0.9, s * 0.95); ctx.lineTo(0, s * 0.45); ctx.lineTo(-s * 0.9, s * 0.95); ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, s * 0.42); ctx.strokeStyle = '#000'; ctx.stroke();
  const g = ctx.createLinearGradient(0, -s, 0, s);
  g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#ffc6e6');
  ctx.fillStyle = g; ctx.fill();
  ctx.restore();
}
