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
  // stone table and four round stools of the void deck
  stoneTable(K) {
    K.prism(0, 0, 0.7, 0.76, 0.45, 0.45, 8, C.terrazzo);
    K.prism(0, 0, 0, 0.7, 0.2, 0.14, 6, C.terrazzo, false);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; K.prism(Math.cos(a) * 0.78, Math.sin(a) * 0.78, 0, 0.42, 0.17, 0.17, 6, C.terrazzo); }
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
export const VARIANTS = { kopitiam: 10, umbrella: 4, planter: 6, bench: 1, bikes: 3, cart: 3, pot: 6, stoneTable: 1, condenser: 1, playground: 4, fitness: 3, goods: 6, barTable: 6, parasol: 4 };
export const KINDS = Object.keys(VARIANTS);

// covered linkway along local +z from 0 to L: a slab roof on two rows of posts (under the void-deck soffit, 2.85 m up,
// where it meets the blocks)
export function linkway(K, L, roof) {
  const y = 2.45;
  K.box(0, y, L / 2, 1.35, 0.18, L / 2, roof);
  K.quad(-1.35, y, 0, 1.35, y, 0, 1.35, y, L, -1.35, y, L, roof.map(v => v * 0.7)); // soffit
  const n = Math.max(1, Math.round(L / 4.5));
  for (let k = 0; k <= n; k++) for (const x of [-1.2, 1.2]) K.box(x, 0, 0.6 + (L - 1.2) * k / n, 0.06, y, 0.06, C.steel);
}
