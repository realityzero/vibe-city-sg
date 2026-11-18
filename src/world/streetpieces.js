// Street furniture pieces, written by a small geometry kit into anything with SIMPLE_LAYOUT writers (sv / tri / vc):
// the city builder's chunk geometry (linkways, world/worker/streetscape.js) and the instanced furniture's piece
// geometries on the main thread (world/streetfurniture.js). Plain vertex colours (linear), local +z is a piece's front,
// its origin on the ground; a piece's look varies with h (0..1), quantised to VARIANTS[kind] geometries.

export const lin = hex => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
export const hash = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
export const pick = (arr, h) => arr[Math.floor(h * arr.length) % arr.length];

export const C = {
  stool: [0xc8202a, 0x1f56b8, 0x2b8f3e, 0xe0a020, 0xd8d4c8].map(lin),
  tableTop: [0xe9e6de, 0xd7d9d2, 0x3f6f5a, 0xb9b2a4].map(lin),
  steel: lin(0x8c9296), dark: lin(0x34383b), wood: lin(0x8a5d3b), concrete: lin(0xb3b0a8), terrazzo: lin(0x9c9a94),
  // umbrellas: brewery and soft-drink colours in alternating panels
  brolly: [[0xc8202a, 0xf2f0ea], [0x1e7a3c, 0xf2f0ea], [0x1f56b8, 0xf2d23a], [0xe86a1c, 0xf2f0ea]].map(p => p.map(lin)),
  shrub: [0x3d6e2e, 0x4c7d34, 0x2f5e2a].map(lin), bloom: [0xc2307a, 0xe26a2c, 0xe8c63a].map(lin),
  pot: [0xa65a38, 0x2f5d8a, 0x7d7a73].map(lin),
  bike: [0xf2c400, 0xff7a1a, 0x22a35a].map(lin),
  cart: [0xc0282d, 0x1f5fa8, 0x2f8a4f].map(lin), glass: lin(0xa9c7cf), canvas: lin(0xf0ece2),
  condenser: lin(0xd8d8d2), fan: lin(0x2c2e30),
  linkRoof: [0x3e6b4f, 0x7a2f2f, 0x2f4f7a, 0x5f6a70].map(lin),
  rubber: [0x3f8f55, 0xc4583a, 0x3c6fb4, 0x7b5aa6].map(lin),
  play: [0xe23b2e, 0xf2c230, 0x2f7fd6, 0x3fae49, 0xf07f1e].map(lin),
  produce: [0xc8281e, 0xf08a1c, 0x5aa02c, 0xf2cf2a, 0x7a2a5a, 0xe8e0c8].map(lin), crate: [0x9a6a3a, 0x2f6fb0, 0xc23a2a].map(lin),
  // riverside bars: dark timber or white marble tops, rattan and black bistro chairs, cream and bar-brand parasols
  barTop: [0x4a2f1f, 0xe8e4dc, 0x2b2b2b].map(lin), chair: [0x9a6a3c, 0x222426, 0x6b4a2e].map(lin),
  parasol: [[0xefe6d2, 0xd9ccb2], [0x1d3a5c, 0x16304c], [0x8c1f24, 0x761a1f], [0x2f5a3c, 0x284e33]].map(p => p.map(lin)),
  // hawker centre: fixed tables (one stool colour per centre), stainless counters, tiled stall walls
  hawkerStool: [0xc8202a, 0x1f56b8, 0x2b8f3e, 0xe8e4da].map(lin), hawkerTop: [0xeeebe3, 0xd9dcd8].map(lin),
  stainless: lin(0xc2c7ca), tile: lin(0xe9e7e0), tileDark: lin(0xb9b6ad), wok: lin(0x26282a), tissue: [0xf6f4ee, 0xf2a7c3, 0x8fc6ea].map(lin),
  foodTray: [0xd8a23a, 0xc8462a, 0x6aa040, 0xf2e2b0, 0x8a4a22].map(lin), jar: [0xd23b2a, 0xf0b02a, 0x3a8a3a, 0xe8e2d0, 0x2a5aa8].map(lin),
  fanBlade: lin(0xe8e6e0), trayCab: [0x1f6a3a, 0x2a5aa8].map(lin),
  bicycle: [0x222426, 0x2f6fd6, 0xc23a2a, 0xe8e8e0, 0x3a7a3a].map(lin),
  chessBoard: lin(0xd8b27a), chessLine: lin(0x5a3a1a), chessRed: lin(0xb82a22), chessBlack: lin(0x1e1e1e),
  tent: [[0x2f5fa8, 0xf2f2ee], [0xd84a7a, 0xf8f0e0]].map(p => p.map(lin)), cloth: lin(0xf4f2ec), tentChair: [0x1f56b8, 0xc8202a].map(lin),
  grate: lin(0x3a3c3e), shelterRoof: lin(0x5f7a70),
};

// ---------------------------------------------------------------- geometry writer
/** writes faces into a SIMPLE_LAYOUT Geo (sv / tri) in a local frame: origin (x, y, z), local +z turned to yaw */
export class Kit {
  constructor() { this.g = null; this.x = 0; this.y = 0; this.z = 0; this.c = 1; this.s = 0; this.n = [0, 1, 0]; }
  at(g, x, y, z, yaw) { this.g = g; this.x = x; this.y = y; this.z = z; this.c = Math.cos(yaw); this.s = Math.sin(yaw); return this; }
  _v(lx, ly, lz, col) { return this.g.sv(this.x + lx * this.c + lz * this.s, this.y + ly, this.z - lx * this.s + lz * this.c, this.n, col); }
  _normal(ux, uy, uz, vx, vy, vz) {
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l; const n = this.n; n[0] = nx * this.c + nz * this.s; n[1] = ny; n[2] = -nx * this.s + nz * this.c;
  }
  /** flat quad a-b-c-d, counter-clockwise seen from its front */
  quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, col) {
    this._normal(bx - ax, by - ay, bz - az, cx - ax, cy - ay, cz - az);
    const i0 = this._v(ax, ay, az, col), i1 = this._v(bx, by, bz, col), i2 = this._v(cx, cy, cz, col), i3 = this._v(dx, dy, dz, col);
    this.g.tri(i0, i1, i2); this.g.tri(i0, i2, i3);
  }
  tri(ax, ay, az, bx, by, bz, cx, cy, cz, col) {
    this._normal(bx - ax, by - ay, bz - az, cx - ax, cy - ay, cz - az);
    this.g.tri(this._v(ax, ay, az, col), this._v(bx, by, bz, col), this._v(cx, cy, cz, col));
  }
  /** box standing on y0 (no bottom face: nothing sees it) */
  box(cx, y0, cz, hx, h, hz, col) {
    const x0 = cx - hx, x1 = cx + hx, z0 = cz - hz, z1 = cz + hz, y1 = y0 + h;
    this.quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, col);
    this.quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, col);
    this.quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, col);
    this.quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, col);
    this.quad(x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0, col);
  }
  /** n-sided frustum about (cx, cz) from radius r0 at y0 to r1 at y1 (z squashed by kz), with an optional top cap */
  prism(cx, cz, y0, y1, r0, r1, n, col, top = true, kz = 1) {
    const da = Math.PI * 2 / n;
    for (let k = 0; k < n; k++) {
      const a0 = k * da, a1 = a0 + da, c0 = Math.cos(a0), s0 = Math.sin(a0) * kz, c1 = Math.cos(a1), s1 = Math.sin(a1) * kz;
      this.quad(cx + r0 * c1, y0, cz + r0 * s1, cx + r0 * c0, y0, cz + r0 * s0, cx + r1 * c0, y1, cz + r1 * s0, cx + r1 * c1, y1, cz + r1 * s1, col);
    }
    if (!top || r1 <= 0) return;
    this._normal(0, 0, 1, 1, 0, 0);
    const b = this.g.vc;
    for (let k = 0; k < n; k++) this._v(cx + r1 * Math.cos(k * da), y1, cz + r1 * Math.sin(k * da) * kz, col);
    for (let k = 1; k < n - 1; k++) this.g.tri(b, b + k + 1, b + k);
  }
  /** flat n-gon of radius r at height y, facing down (the underside of something hanging) */
  discDown(cx, cz, y, r, n, col) {
    this._normal(1, 0, 0, 0, 0, 1);
    const b = this.g.vc, da = Math.PI * 2 / n;
    for (let k = 0; k < n; k++) this._v(cx + r * Math.cos(k * da), y, cz + r * Math.sin(k * da), col);
    for (let k = 1; k < n - 1; k++) this.g.tri(b, b + k, b + k + 1);
  }
  /** cone (apex up), seen from outside; `under` adds the inside, seen from below */
  cone(cx, cz, y0, y1, r, n, colA, colB, under = null) {
    const da = Math.PI * 2 / n;
    for (let k = 0; k < n; k++) {
      const c0 = Math.cos(k * da), s0 = Math.sin(k * da), c1 = Math.cos(k * da + da), s1 = Math.sin(k * da + da), col = k % 2 ? colB : colA;
      this.tri(cx + r * c1, y0, cz + r * s1, cx + r * c0, y0, cz + r * s0, cx, y1, cz, col);
      if (under) this.tri(cx + r * c0, y0, cz + r * s0, cx + r * c1, y0, cz + r * s1, cx, y1 - 0.02, cz, k % 2 ? under[1] : under[0]);
    }
  }
  /** flat polygon in the local y-z plane at x = cx, both sides (bicycle and cart wheels) */
  wheel(cx, cy, cz, r, col) {
    for (const side of [1, -1]) {
      this._normal(0, 0, side, 0, 1, 0);
      const b = this.g.vc;
      for (let k = 0; k < 8; k++) this._v(cx, cy + r * Math.sin(k * Math.PI / 4), cz + r * Math.cos(k * Math.PI / 4), col);
      for (let k = 1; k < 7; k++) if (side > 0) this.g.tri(b, b + k, b + k + 1); else this.g.tri(b, b + k + 1, b + k);
    }
  }
}

// ---------------------------------------------------------------- pieces (local +z is the front; origin on the ground)
export const PIECE = {
  // round marble-top table and four plastic stools
  kopitiam(K, h) {
    const top = pick(C.tableTop, h), st = pick(C.stool, hash(h, 3.1));
    K.prism(0, 0, 0.71, 0.75, 0.42, 0.42, 8, top);
    K.box(0, 0, 0, 0.04, 0.71, 0.04, C.steel);
    // (the round plastic stool, slightly flared towards the floor)
    for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; K.prism(Math.cos(a) * 0.64, Math.sin(a) * 0.64, 0, 0.44, 0.16, 0.13, 6, st); }
  },
  umbrella(K, h) {
    const [a, b] = pick(C.brolly, h);
    K.box(0, 0, 0, 0.025, 2.45, 0.025, C.steel);
    K.cone(0, 0, 2.05, 2.5, 1.35, 8, a, b, [a.map(v => v * 0.55), b.map(v => v * 0.55)]);
  },
  planter(K, h) {
    if (h < 0.5) {
      K.box(0, 0, 0, 0.8, 0.55, 0.4, C.concrete);
      K.prism(0, 0, 0.55, 1.0, 0.78, 0.5, 6, pick(C.shrub, h * 3), true, 0.5);
    } else {
      K.prism(0, 0, 0, 0.6, 0.55, 0.6, 8, C.concrete);
      K.prism(0, 0, 0.6, 1.25, 0.55, 0.25, 6, h > 0.8 ? pick(C.bloom, h * 7) : pick(C.shrub, h * 5));
    }
  },
  bench(K) {
    K.box(0, 0.42, 0, 0.8, 0.05, 0.22, C.wood);
    K.box(0, 0.5, -0.21, 0.8, 0.38, 0.025, C.wood);
    for (const x of [-0.68, 0.68]) K.box(x, 0, 0, 0.035, 0.42, 0.2, C.dark);
  },
  // a short rack with two or three dockless share bikes
  bikes(K, h) {
    K.box(0, 0.32, 0, 1.25, 0.04, 0.02, C.steel);
    for (const x of [-1.2, 1.2]) K.box(x, 0, 0, 0.025, 0.36, 0.025, C.steel);
    const n = 2 + (h > 0.5 ? 1 : 0), col = pick(C.bike, h * 5);
    for (let i = 0; i < n; i++) {
      const x = -0.8 + i * 0.8;
      K.wheel(x, 0.33, 0.52, 0.33, C.dark); K.wheel(x, 0.33, -0.52, 0.33, C.dark);
      K.box(x, 0.62, 0, 0.025, 0.05, 0.5, col);           // top tube
      K.box(x, 0.3, -0.12, 0.025, 0.32, 0.03, col);       // seat tube
      K.box(x, 0.86, -0.12, 0.06, 0.03, 0.12, C.dark);    // saddle
      K.box(x, 0.98, 0.5, 0.26, 0.025, 0.025, C.dark);    // handlebar
      K.box(x, 0.33, 0.5, 0.02, 0.65, 0.02, col);         // fork
    }
  },
  // hawker's pushcart: steel body, glass display, canvas awning
  cart(K, h) {
    const col = pick(C.cart, h);
    K.box(0, 0.28, 0, 0.85, 0.62, 0.42, col);
    K.box(0, 0.9, 0.12, 0.8, 0.32, 0.26, C.glass);
    for (const x of [-0.8, 0.8]) K.box(x, 0.9, -0.38, 0.025, 0.95, 0.025, C.steel);
    K.box(0, 1.85, 0, 1.0, 0.05, 0.62, C.canvas);
    K.wheel(-0.88, 0.28, 0, 0.28, C.dark); K.wheel(0.88, 0.28, 0, 0.28, C.dark);
  },
  pot(K, h) {
    K.prism(0, 0, 0, 0.5, 0.2, 0.27, 6, pick(C.pot, h), false);
    K.prism(0, 0, 0.45, 1.15 + h * 0.4, 0.34, 0.1, 5, pick(C.shrub, h * 3));
  },
  // a shop's wares set out on the five-foot-way: a trestle of produce crates, stacked boxes, a sack
  goods(K, h) {
    const P = k => C.produce[Math.floor(h * 7 + k * 2.3) % C.produce.length], cr = pick(C.crate, h * 3);
    K.box(0, 0, 0, 0.75, 0.5, 0.32, C.wood);
    for (let k = 0; k < 3; k++) { const x = -0.5 + k * 0.5; K.box(x, 0.5, 0, 0.22, 0.16, 0.26, cr); K.box(x, 0.66, 0, 0.19, 0.05, 0.22, P(k)); }
    K.box(1.05, 0, -0.05, 0.22, 0.32, 0.2, cr); K.box(1.05, 0.32, -0.05, 0.2, 0.26, 0.18, P(3));
    K.prism(-1.05, 0, 0, 0.5, 0.2, 0.15, 6, C.canvas);
  },
  // stone table and four round stools of the void deck; on half of them a xiangqi board (the uncles' chess table)
  stoneTable(K, h) {
    K.prism(0, 0, 0.7, 0.76, 0.45, 0.45, 8, C.terrazzo);
    K.prism(0, 0, 0, 0.7, 0.2, 0.14, 6, C.terrazzo, false);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; K.prism(Math.cos(a) * 0.78, Math.sin(a) * 0.78, 0, 0.42, 0.17, 0.17, 6, C.terrazzo); }
    if (h < 0.5) return;
    const y = 0.766, e = 0.24;
    K.quad(-e, y, e, e, y, e, e, y, -e, -e, y, -e, C.chessBoard);
    for (let k = 0; k < 5; k++) { const t = -e * 0.8 + k * e * 0.4; K.quad(t - 0.004, y + 0.002, e * 0.85, t + 0.004, y + 0.002, e * 0.85, t + 0.004, y + 0.002, -e * 0.85, t - 0.004, y + 0.002, -e * 0.85, C.chessLine); K.quad(-e * 0.85, y + 0.002, t + 0.004, e * 0.85, y + 0.002, t + 0.004, e * 0.85, y + 0.002, t - 0.004, -e * 0.85, y + 0.002, t - 0.004, C.chessLine); }
    for (let k = 0; k < 10; k++) K.prism(-0.18 + (k % 5) * 0.09, k < 5 ? -0.17 : 0.17 - (k % 2) * 0.09, y, y + 0.018, 0.026, 0.026, 6, k < 5 ? C.chessRed : C.chessBlack);
  },
  // a hawker centre's fixed round table: four stools on arms off one steel frame; some seats are choped with a packet
  // of tissues (h: stool colour x chope pattern, SEATS / CHOPE below)
  hawkerTable(K, h) {
    const v = Math.min(11, Math.floor(h * 12)), st = C.hawkerStool[v % 4], top = C.hawkerTop[v % 2]; // v = colour + 4 x chope
    K.prism(0, 0, 0.72, 0.76, 0.45, 0.45, 10, top);
    K.box(0, 0, 0, 0.05, 0.72, 0.05, C.steel);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2, c = Math.cos(a), sn = Math.sin(a);
      K.quad(c * 0.62 - sn * 0.02, 0.07, sn * 0.62 + c * 0.02, c * 0.62 + sn * 0.02, 0.07, sn * 0.62 - c * 0.02, sn * 0.02, 0.07, -c * 0.02, -sn * 0.02, 0.07, c * 0.02, C.steel);
      K.box(c * 0.66, 0, sn * 0.66, 0.025, 0.42, 0.025, C.steel);
      K.prism(c * 0.66, sn * 0.66, 0.42, 0.46, 0.17, 0.17, 8, st);
    }
    for (const k of CHOPE[Math.floor(v / 4)]) {
      const a = Math.PI / 4 + k * Math.PI / 2, x = Math.cos(a) * 0.66, z = Math.sin(a) * 0.66, col = C.tissue[(v + k) % 3];
      K.box(x, 0.46, z, 0.07, 0.03, 0.045, C.tissue[0]); K.box(x, 0.49, z, 0.05, 0.004, 0.03, col);
    }
  },
  // a few residents' bicycles on a rack under the block
  cycles(K, h) {
    K.box(0, 0.3, -0.35, 1.3, 0.04, 0.02, C.steel);
    for (const x of [-1.25, 1.25]) K.box(x, 0, -0.35, 0.025, 0.34, 0.025, C.steel);
    const n = 2 + (h > 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const x = -0.75 + i * 0.75, col = C.bicycle[(Math.floor(h * 7) + i * 2) % C.bicycle.length];
      K.wheel(x, 0.34, 0.5, 0.34, C.dark); K.wheel(x, 0.34, -0.5, 0.34, C.dark);
      K.box(x, 0.64, 0, 0.022, 0.04, 0.48, col); K.box(x, 0.3, -0.1, 0.022, 0.34, 0.03, col);
      K.box(x, 0.88, -0.12, 0.06, 0.03, 0.12, C.dark); K.box(x, 0.98, 0.48, 0.26, 0.025, 0.025, C.dark);
      K.box(x, 0.34, 0.48, 0.02, 0.64, 0.02, col);
      if (i === 1) K.box(x, 0.7, 0.62, 0.14, 0.18, 0.1, C.steel); // a basket
    }
  },
  // 9 x 6 m tent beside a block: a wake (blue and white, rows of plastic chairs, a table of offerings) or a wedding
  // (pink and cream, round tables in white cloth, red chairs)
  tent(K, h) {
    const wed = h >= 0.5, [a, b] = C.tent[wed ? 1 : 0], X = 4.5, Z = 3, y0 = 2.6, y1 = 3.4;
    for (const x of [-X, 0, X]) for (const z of [-Z, Z]) K.box(x, 0, z, 0.04, y0, 0.04, C.steel);
    // striped pitched canopy (and its underside)
    for (let k = 0; k < 6; k++) {
      const xa = -X + k * 1.5, xb = xa + 1.5, col = k % 2 ? a : b, dim = col.map(v => v * 0.6);
      for (const s of [1, -1]) {
        K.quad(xa, y0, s * Z, xb, y0, s * Z, xb, y1, 0, xa, y1, 0, col);
        K.quad(xb, y0 - 0.01, s * Z, xa, y0 - 0.01, s * Z, xa, y1 - 0.01, 0, xb, y1 - 0.01, 0, dim);
      }
    }
    for (const s of [1, -1]) { K.tri(s * X, y0, -Z, s * X, y0, Z, s * X, y1, 0, b); K.tri(s * X, y0, Z, s * X, y0, -Z, s * X, y1, 0, b); }
    if (wed) for (const [x, z] of TENT_TABLES) {
      K.prism(x, z, 0, 0.76, 0.62, 0.62, 10, C.cloth);
      for (let k = 0; k < 6; k++) { const t = k * Math.PI / 3; K.box(x + Math.cos(t) * 0.95, 0, z + Math.sin(t) * 0.95, 0.2, 0.46, 0.2, C.tentChair[1]); }
    } else {
      K.box(0, 0, -Z + 0.6, 1.2, 0.8, 0.4, C.cloth);
      for (const [x, z] of TENT_CHAIRS) K.box(x, 0, z, 0.21, 0.46, 0.21, C.tentChair[0]);
    }
  },
  // cast-iron tree grate round a plaza tree's trunk
  grate(K) {
    for (let k = 0; k < 4; k++) { const x = -0.6 + k * 0.4; K.quad(x - 0.03, 0.03, 0.7, x + 0.03, 0.03, 0.7, x + 0.03, 0.03, -0.7, x - 0.03, 0.03, -0.7, C.grate); }
    for (const z of [-0.7, 0.7]) K.box(0, 0, z, 0.7, 0.035, 0.03, C.grate);
    for (const x of [-0.7, 0.7]) K.box(x, 0, 0, 0.03, 0.035, 0.7, C.grate);
  },
  // a hawker centre's stalls, ceiling fans and tray-return stations (below)
  stall: (K, h) => hawkerStall(K, h), fan: (K, h) => ceilingFan(K, h), trays: (K, h) => trayReturn(K, h),
  // a small pavilion on a plaza: a slab roof on four posts over two benches
  shelter(K) {
    K.box(0, 2.6, 0, 2.2, 0.16, 1.6, C.shelterRoof);
    K.quad(-2.2, 2.59, -1.6, 2.2, 2.59, -1.6, 2.2, 2.59, 1.6, -2.2, 2.59, 1.6, C.concrete);
    for (const x of [-1.9, 1.9]) for (const z of [-1.3, 1.3]) K.box(x, 0, z, 0.07, 2.6, 0.07, C.dark);
    for (const z of [-0.7, 0.7]) { K.box(0, 0.42, z, 1.5, 0.05, 0.22, C.wood); for (const x of [-1.3, 1.3]) K.box(x, 0, z, 0.035, 0.42, 0.2, C.dark); }
  },
  // wall-mounted aircon condenser (local +z out of the wall)
  condenser(K) {
    K.box(0, -0.3, 0.17, 0.42, 0.6, 0.17, C.condenser);
    K._normal(1, 0, 0, 0, 1, 0);
    const b = K.g.vc;
    for (let k = 0; k < 6; k++) K._v(-0.1 + 0.19 * Math.cos(k * Math.PI / 3), 0.19 * Math.sin(k * Math.PI / 3), 0.345, C.fan);
    for (let k = 1; k < 5; k++) K.g.tri(b, b + k, b + k + 1);
  },
  // 12 x 9 m rubber mat: a roofed tower with a slide and a climbing wall, swings, spring riders, benches
  playground(K, h) {
    const mat = pick(C.rubber, h), P = k => C.play[(Math.floor(h * 97) + k) % C.play.length];
    K.quad(-6, 0.04, 4.5, 6, 0.04, 4.5, 6, 0.04, -4.5, -6, 0.04, -4.5, mat);
    for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [0.9, 0.9], [-0.9, 0.9]]) K.box(x, 0, z, 0.07, 2.7, 0.07, P(0));
    K.box(0, 1.25, 0, 1.0, 0.1, 1.0, P(1));
    K.box(0, 1.35, -0.97, 0.95, 0.65, 0.03, P(2)); K.box(0, 1.35, 0.97, 0.95, 0.65, 0.03, P(3));
    // pyramid roof
    const r = 1.2, y0 = 2.7, y1 = 3.5;
    K.tri(-r, y0, r, r, y0, r, 0, y1, 0, P(4)); K.tri(r, y0, r, r, y0, -r, 0, y1, 0, P(0));
    K.tri(r, y0, -r, -r, y0, -r, 0, y1, 0, P(4)); K.tri(-r, y0, -r, -r, y0, r, 0, y1, 0, P(0));
    // slide down to +x: chute and two side rails
    const sx0 = 1.0, sx1 = 3.6, sy0 = 1.35, sy1 = 0.3, w = 0.32;
    K.quad(sx0, sy0, w, sx1, sy1, w, sx1, sy1, -w, sx0, sy0, -w, P(1));
    K.quad(sx1, sy1 - 0.1, -w, sx0, sy0 - 0.1, -w, sx0, sy0 + 0.18, -w, sx1, sy1 + 0.18, -w, P(1));
    K.quad(sx0, sy0 - 0.1, w, sx1, sy1 - 0.1, w, sx1, sy1 + 0.18, w, sx0, sy0 + 0.18, w, P(1));
    K.box(sx1 - 0.15, 0, 0, 0.05, sy1, w, P(1));
    // climbing wall up the -x side
    K.quad(-2.2, 0, 0.6, -1.0, 1.25, 0.6, -1.0, 1.25, -0.6, -2.2, 0, -0.6, P(3));
    K.quad(-2.2, 0, -0.6, -1.0, 1.25, -0.6, -1.0, 1.25, 0.6, -2.2, 0, 0.6, P(3));
    for (let k = 0; k < 3; k++) K.box(-1.95 + k * 0.38, 0.25 + k * 0.38, 0.1 * (k - 1), 0.07, 0.08, 0.07, P(k + 1));
    // swings
    const wx = -3.6, wz = 2.8;
    for (const x of [-1.4, 1.4]) K.box(wx + x, 0, wz, 0.06, 2.3, 0.06, P(2));
    K.box(wx, 2.25, wz, 1.45, 0.06, 0.06, P(2));
    for (const x of [-0.6, 0.6]) {
      K.box(wx + x, 0.45, wz, 0.22, 0.04, 0.12, C.dark);
      for (const dz of [-0.1, 0.1]) K.box(wx + x, 0.49, wz + dz, 0.012, 1.76, 0.012, C.steel);
    }
    // spring riders
    for (const [x, z, k] of [[3.4, -2.8, 3], [2.0, -3.3, 4]]) { K.box(x, 0, z, 0.06, 0.45, 0.06, C.steel); K.box(x, 0.45, z, 0.18, 0.32, 0.38, P(k)); }
  },
  // a bar's outdoor table on a pedestal: two chairs facing across local z (h < 0.5) or one on every side, seats 0.45 m
  // up (Clarke Quay's terraces, whose diners sit on them)
  barTable(K, h) {
    const top = pick(C.barTop, h * 2.7), ch = pick(C.chair, h * 4.3);
    K.box(0, 0.71, 0, 0.36, 0.04, 0.36, top);
    K.box(0, 0.02, 0, 0.035, 0.69, 0.035, C.dark);
    K.box(0, 0, 0, 0.2, 0.02, 0.2, C.dark);
    const chair = (x, z, bx, bz) => {
      K.box(x, 0.41, z, 0.2, 0.04, 0.2, ch);
      for (const [lx, lz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) K.box(x + lx, 0, z + lz, 0.015, 0.41, 0.015, C.dark);
      K.box(x + bx * 0.19, 0.45, z + bz * 0.19, bz ? 0.2 : 0.02, 0.42, bx ? 0.2 : 0.02, ch); // back, away from the table
    };
    chair(0, 0.62, 0, 1); chair(0, -0.62, 0, -1);
    if (h >= 0.5) { chair(0.62, 0, 1, 0); chair(-0.62, 0, -1, 0); }
  },
  // a square market parasol over a table: four canvas panels on a pole, darker underneath
  parasol(K, h) {
    const [a, b] = pick(C.parasol, h), s = 1.35, y0 = 2.2, y1 = 2.62;
    K.box(0, 0.75, 0, 0.022, y1 - 0.75, 0.022, C.steel);
    const corners = [[s, s], [-s, s], [-s, -s], [s, -s]];
    for (let k = 0; k < 4; k++) {
      const [px, pz] = corners[k], [qx, qz] = corners[(k + 1) % 4], col = k % 2 ? b : a;
      K.tri(qx, y0, qz, px, y0, pz, 0, y1, 0, col);
      K.tri(px, y0 - 0.01, pz, qx, y0 - 0.01, qz, 0, y1 - 0.02, 0, col.map(v => v * 0.55));
      K.quad(qx, y0 - 0.16, qz, px, y0 - 0.16, pz, px, y0, pz, qx, y0, qz, col); // the valance
    }
  },
  // 7 x 4 m: pull-up bars, parallel bars, a sit-up bench and a waist-twister
  fitness(K, h) {
    const post = pick([C.play[2], C.play[1], C.play[3]], h);
    K.quad(-3.5, 0.04, 2, 3.5, 0.04, 2, 3.5, 0.04, -2, -3.5, 0.04, -2, pick(C.rubber, h * 7));
    for (const x of [-3.0, -1.6]) K.box(x, 0, -1.2, 0.06, 2.3, 0.06, post);
    K.box(-2.3, 2.15, -1.2, 0.72, 0.03, 0.03, C.steel);
    for (const [x, z] of [[-0.6, 0.2], [0.8, 0.2], [-0.6, 0.8], [0.8, 0.8]]) K.box(x, 0, z, 0.05, 1.0, 0.05, post);
    for (const z of [0.2, 0.8]) K.box(0.1, 1.0, z, 0.75, 0.03, 0.03, C.steel);
    K.quad(1.8, 0.35, -1.05, 3.0, 0.75, -1.05, 3.0, 0.75, -1.6, 1.8, 0.35, -1.6, post);
    K.box(2.4, 0, -1.33, 0.05, 0.5, 0.05, C.steel);
    K.box(2.4, 0, 1.2, 0.05, 1.1, 0.05, post); K.prism(2.4, 1.2, 0.12, 0.17, 0.3, 0.3, 8, C.steel);
  },
};

// colour variants per kind (h = (v + 0.5) / n); the order is the kind's index in the placement records
export const VARIANTS = { kopitiam: 10, umbrella: 4, planter: 6, bench: 1, bikes: 3, cart: 3, pot: 6, stoneTable: 2, condenser: 1, playground: 4, fitness: 3, goods: 6,
  barTable: 6, parasol: 4, hawkerTable: 12, cycles: 3, tent: 2, grate: 1, shelter: 1, stall: 6, fan: 3, trays: 2 };
export const KINDS = Object.keys(VARIANTS);

// who sits where (world/scenes.js seats people there): per kind, [x, z] of each seat in the piece's frame (they face
// the middle of their table). Hawker tables: seats CHOPE[pattern] hold a packet of tissues and stay empty.
const ring4 = (r, a0) => [0, 1, 2, 3].map(k => [Math.cos(a0 + k * Math.PI / 2) * r, Math.sin(a0 + k * Math.PI / 2) * r]);
export const CHOPE = [[], [1], [0, 2]];
const TENT_TABLES = [[-2.6, -1.2], [0, -1.2], [2.6, -1.2], [-1.3, 1.4], [1.3, 1.4]];
const TENT_CHAIRS = [];
for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) TENT_CHAIRS.push([-2.6 + c * 1.05, -1.0 + r * 0.95]);
export const SEATS = {
  kopitiam: ring4(0.64, Math.PI / 4), hawkerTable: ring4(0.66, Math.PI / 4), stoneTable: ring4(0.78, 0),
  // per variant, [x, z, and the point they face]: a wake's chairs face the front of the tent, a wedding's tables seat six
  tent: [TENT_CHAIRS.map(([x, z]) => [x, z, x, -9]), TENT_TABLES.flatMap(([x, z]) => [0, 1, 2, 3, 4, 5].map(k => [x + Math.cos(k * Math.PI / 3) * 0.95, z + Math.sin(k * Math.PI / 3) * 0.95, x, z]))],
};

// covered linkway along local +z from 0 to L: a slab roof on two rows of posts (under the void-deck soffit, 2.85 m up,
// where it meets the blocks)
export function linkway(K, L, roof) {
  const y = 2.45;
  K.box(0, y, L / 2, 1.35, 0.18, L / 2, roof);
  K.quad(-1.35, y, 0, 1.35, y, 0, 1.35, y, L, -1.35, y, L, roof.map(v => v * 0.7)); // soffit
  const n = Math.max(1, Math.round(L / 4.5));
  for (let k = 0; k <= n; k++) for (const x of [-1.2, 1.2]) K.box(x, 0, 0.6 + (L - 1.2) * k / n, 0.06, y, 0.06, C.steel);
}

// ---------------------------------------------------------------- hawker centre fittings
// a stall seen from its aisle (local +z), its front on z = 0, its back at -D: tiled side walls, a stainless counter with
// a glass display, the wok range and shelves inside, its own low ceiling; the lightbox and photo menus over the front
// (PANEL: y range, width) and the NEA sticker on the counter (STICKER: x, y, size) are facade quads the city builder
// writes (they light up)
export const STALL = { W: 3.0, D: 2.6, PANEL: [1.72, 2.85], PANEL_W: 2.6, STICKER: [0.95, 0.6, 0.2] };
export function hawkerStall(K, h) {
  const { W, D } = STALL, hw = W / 2, [p0, p1] = STALL.PANEL, J = k => C.jar[(Math.floor(h * 17) + k) % C.jar.length];
  for (const x of [-hw + 0.03, hw - 0.03]) K.box(x, 0, -D / 2, 0.03, 2.55, D / 2, C.tile);
  K.box(0, 0, -D + 0.03, hw, 2.55, 0.03, C.tile);
  K.box(0, 2.5, -D / 2, hw, 0.05, D / 2, C.tileDark);                                // the stall's own ceiling
  K.box(0, p0 - 0.05, -0.07, hw, p1 - p0 + 0.08, 0.07, C.tileDark);                  // lightbox housing over the front
  // counter: stainless, a darker kick plate, a glass display of the day's food on top, a chopping board
  K.box(0, 0, -0.32, hw - 0.08, 0.95, 0.32, C.stainless);
  K.box(0, 0, -0.01, hw - 0.1, 0.12, 0.012, C.wok);
  K.box(-0.35, 0.95, -0.3, 0.95, 0.42, 0.2, C.glass);
  for (let k = 0; k < 4; k++) K.box(-1.05 + k * 0.47, 0.96, -0.3, 0.2, 0.06, 0.15, C.foodTray[(Math.floor(h * 11) + k) % C.foodTray.length]);
  K.box(1.0, 0.95, -0.3, 0.3, 0.05, 0.22, C.wood);
  // the back: wok range and its hood, shelves of jars and sauce bottles, a stockpot
  K.box(-0.55, 0, -D + 0.4, 0.8, 0.85, 0.32, C.stainless);
  K.prism(-0.85, -D + 0.4, 0.85, 0.95, 0.28, 0.34, 8, C.wok, false);
  K.prism(-0.15, -D + 0.42, 0.85, 1.3, 0.22, 0.22, 8, C.steel);
  K.box(-0.55, 1.95, -D + 0.38, 0.85, 0.3, 0.36, C.stainless);
  for (const [y, o] of [[1.25, 0], [1.65, 2]]) {
    K.box(0.85, y, -D + 0.14, 0.55, 0.03, 0.12, C.steel);
    for (let k = 0; k < 4; k++) K.box(0.45 + k * 0.27, y + 0.03, -D + 0.14, 0.06, 0.18 + (k % 2) * 0.06, 0.05, J(k + o));
  }
}
// ceiling fan hanging from the hall's ceiling (origin there): drop rod, motor and three blades turned by h
export function ceilingFan(K, h) {
  K.box(0, -0.75, 0, 0.02, 0.75, 0.02, C.steel);
  K.prism(0, 0, -0.85, -0.72, 0.13, 0.11, 8, C.fanBlade, false); K.discDown(0, 0, -0.85, 0.13, 8, C.fanBlade);
  for (let k = 0; k < 3; k++) {
    const a = h * 6.283 + k * 2.094, c = Math.cos(a), s = Math.sin(a), r0 = 0.12, r1 = 0.72, w = 0.065, y = -0.79;
    const P = (r, o) => [c * r - s * o, s * r + c * o];
    const [ax, az] = P(r0, -w), [bx, bz] = P(r1, -w), [cx, cz] = P(r1, w), [dx, dz] = P(r0, w);
    K.quad(ax, y, az, dx, y, dz, cx, y, cz, bx, y, bz, C.fanBlade);
    K.quad(ax, y, az, bx, y, bz, cx, y, cz, dx, y, dz, C.fanBlade.map(v => v * 0.8));
  }
}
// tray-return station at the end of a row of stalls: an open-fronted rack cabinet, its board above (BOARD: y range,
// width; a facade quad the builder writes)
export const TRAY = { BOARD: [1.62, 2.02], BOARD_W: 1.6 };
export function trayReturn(K, h) {
  const col = C.trayCab[h < 0.5 ? 0 : 1];
  K.box(0, 0, -0.3, 0.82, 1.5, 0.3, col);
  for (const y of [0.3, 0.65, 1.0]) K.box(0, y, -0.02, 0.74, 0.25, 0.02, C.dark);   // the rack's slots
  K.box(0, 1.5, -0.3, 0.82, 0.55, 0.06, col);                                      // the board's backing
}
