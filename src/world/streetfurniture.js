// Street furniture around the camera: kopitiam tables and umbrellas, planters, benches, shared bikes, pushcarts, potted
// plants, void-deck stone tables, aircon condensers, playgrounds and fitness corners. The city builder places them
// (world/worker/streetscape.js); each piece's geometry (world/streetpieces.js, a few colour variants per kind) lives
// once in a BatchedMesh drawn with the city's structure material, so all of it is one multi-draw call (and its shadow).
// Only the pieces near the camera are instances, refilled as it moves (like StreetDetail's near pools); playgrounds
// and fitness corners show from further away than a stool.
import * as THREE from 'three';
import { Kit, PIECE, VARIANTS, KINDS } from './streetpieces.js';

const CELL = 64, NEAR = 150, FAR = 420, CAP = 1600;
const BIG = new Set([KINDS.indexOf('playground'), KINDS.indexOf('fitness')]);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);

/** a SIMPLE_LAYOUT writer (sv / tri / vc, like the city builder's Geo) collecting one piece */
class Collector {
  constructor() { this.p = []; this.n = []; this.c = []; this.i = []; this.vc = 0; }
  sv(x, y, z, n, col) { this.p.push(x, y, z); this.n.push(n[0], n[1], n[2]); this.c.push(col[0], col[1], col[2]); return this.vc++; }
  tri(a, b, c) { this.i.push(a, b, c); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    return g;
  }
}

export class StreetFurniture {
  constructor(game) {
    this.game = game;
    const F = game.city.furniture?.pieces || new Float32Array(0);
    this.F = F; this.n = F.length / 6;
    // every kind's variants: geometry id = first[kind] + variant
    const K = new Kit(), geos = [];
    this.first = KINDS.map(kind => {
      const id = geos.length;
      for (let v = 0; v < VARIANTS[kind]; v++) { const c = new Collector(); PIECE[kind](K.at(c, 0, 0, 0, 0), (v + 0.5) / VARIANTS[kind]); geos.push(c.geometry()); }
      return id;
    });
    const nv = geos.reduce((a, g) => a + g.attributes.position.count, 0), ni = geos.reduce((a, g) => a + g.index.count, 0);
    const mesh = this.mesh = new THREE.BatchedMesh(CAP, nv, ni, game.city.mats.struct);
    mesh.name = 'streetFurniture';
    for (const g of geos) { mesh.addGeometry(g); g.dispose(); }
    for (let i = 0; i < CAP; i++) mesh.setVisibleAt(mesh.addInstance(0), false);
    mesh.frustumCulled = false; mesh.sortObjects = false; // (instances are culled one by one inside)
    mesh.castShadow = true; mesh.receiveShadow = true;
    game.scene.add(mesh);
    // pieces by grid cell
    this.grid = new Map();
    for (let i = 0; i < this.n; i++) {
      const k = Math.floor(F[i * 6 + 1] / CELL) * 100003 + Math.floor(F[i * 6 + 3] / CELL);
      let a = this.grid.get(k); if (!a) this.grid.set(k, a = []); a.push(i);
    }
    this.live = 0; this.at = new THREE.Vector3(1e9, 0, 0); this._cand = [];
    const p = game.player?.position || game.camera.position;
    this.refresh(p.x, p.z);
  }

  /** instance the pieces around (x, z): small ones within NEAR, playgrounds and fitness corners within FAR */
  refresh(x, z) {
    const F = this.F, C = this._cand, mesh = this.mesh; C.length = 0;
    for (let gx = Math.floor((x - FAR) / CELL); gx <= Math.floor((x + FAR) / CELL); gx++)
      for (let gz = Math.floor((z - FAR) / CELL); gz <= Math.floor((z + FAR) / CELL); gz++) {
        const a = this.grid.get(gx * 100003 + gz); if (!a) continue;
        for (const i of a) {
          const d2 = (F[i * 6 + 1] - x) ** 2 + (F[i * 6 + 3] - z) ** 2, r = BIG.has(F[i * 6]) ? FAR : NEAR;
          if (d2 < r * r) C.push(i, d2);
        }
      }
    // (more than the pool holds: nearest first)
    let order = null;
    if (C.length / 2 > CAP) { order = []; for (let k = 0; k < C.length; k += 2) order.push(k); order.sort((a, b) => C[a + 1] - C[b + 1]); }
    const n = Math.min(CAP, C.length / 2);
    for (let s = 0; s < n; s++) {
      const i = C[order ? order[s] : s * 2], o = i * 6, kind = F[o];
      _q.setFromAxisAngle(UP, F[o + 4]); _m.compose(_p.set(F[o + 1], F[o + 2], F[o + 3]), _q, _s);
      mesh.setGeometryIdAt(s, this.first[kind] + Math.min(VARIANTS[KINDS[kind]] - 1, Math.floor(F[o + 5] * VARIANTS[KINDS[kind]])));
      mesh.setMatrixAt(s, _m);
      if (s >= this.live) mesh.setVisibleAt(s, true);
    }
    for (let s = n; s < this.live; s++) mesh.setVisibleAt(s, false);
    this.live = n; this.at.set(x, 0, z);
  }

  update() {
    const c = this.game.camera.position;
    if (Math.hypot(c.x - this.at.x, c.z - this.at.z) > 25) this.refresh(c.x, c.z);
  }
}
