// City: drives the builder worker, owns chunk meshes, ground and water, exposes data for gameplay systems.
import * as THREE from 'three';
import { createFacadeMaterial, createRoofMaterial, createRoadMaterial, createStructMaterial, createGroundMaterial, FACADE_REC, FACADE_REC_W } from '../gfx/materials.js';
import { REFLECT_LAYER } from './water.js';
import { nextTask } from '../core/nextTask.js';
import { loadGroundMask, groundEdgeDistance, GROUND_SMAX } from './groundmask.js';

const SHORE_TILE = 32; // texels a side of a tile of the waterline's edge distances kept on the CPU (see waterEdge)

const NOBATCH = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nobatch');

// City geometry lives on the GPU only: nothing reads it on the CPU after upload (line of sight and collisions use
// the physics world), so every array is dropped once uploaded. Indices are swapped for an empty array of the same
// type rather than null: BatchedMesh reads index.array.BYTES_PER_ELEMENT every frame.
function disposeArray() { this.bytesPerElement = this.array.BYTES_PER_ELEMENT; this.array = null; } // (size kept for tests/mobile/gpubuffers.mjs)
function emptyIndex() { this.array = new this.array.constructor(0); }
function toGeometry(g, freeOnUpload = true) {
  const geo = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    const attr = new THREE.BufferAttribute(a.array, a.itemSize, !!a.normalized);
    if (freeOnUpload) attr.onUpload(disposeArray);
    geo.setAttribute(name, attr);
  }
  geo.setIndex(new THREE.BufferAttribute(g.index, 1));
  if (freeOnUpload) geo.index.onUpload(emptyIndex);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

export class City {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'city';
    scene.add(this.group);
    this.mats = { walls: createFacadeMaterial(), roofs: createRoofMaterial(), roads: createRoadMaterial(), foot: createRoadMaterial(), struct: createStructMaterial() };
    // cheap stand-ins for the half-res water reflection (see setReflectionMaterials)
    this.mats.wallsRefl = createFacadeMaterial({ reflection: true });
    this.mats.roofsRefl = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0 });
    this.mats.foot.polygonOffsetFactor = -1; this.mats.foot.polygonOffsetUnits = -3;
    this.chunks = [];
    this.physChunks = [];
    this.occlChunks = []; // camera-only sight blockers (see cityBuilder.worker.js occlTri)
  }

  async load(onProgress) {
    const [data, ground] = await Promise.all([fetch('/data/city.json').then(r => r.json()), loadGroundMask('/data/ground.png')]);
    this.data = data;
    this.meta = data.meta;
    // the CPU copy for queries (water / vegetation / paving) keeps the RGB planes, and the class-edge distances only
    // in the tiles a waterline runs through. The ground texture is put back together from those planes and the alpha
    // plane, kept until then (6 MB, not the decoded 25 MB, through the city build)
    const rgba = ground.data, W = ground.w, H = ground.h, m = new Uint8Array(W * H * 3), alpha = new Uint8Array(W * H);
    const T = SHORE_TILE, tw = Math.ceil(W / T), th = Math.ceil(H / T), shore = new Uint8Array(tw * th);
    for (let y = 0, i = 0, j = 0; y < H; y++) for (let x = 0; x < W; x++, i++, j += 4) {
      m[i * 3] = rgba[j]; m[i * 3 + 1] = rgba[j + 1]; m[i * 3 + 2] = rgba[j + 2]; alpha[i] = rgba[j + 3];
      // a waterline texel: its tile and any its land-side neighbours may be in
      if (rgba[j] < 160 && rgba[j + 3] < 255) {
        for (let ty = Math.max(0, (y - 1) / T | 0); ty <= Math.min(th - 1, (y + 1) / T | 0); ty++) for (let tx = Math.max(0, (x - 1) / T | 0); tx <= Math.min(tw - 1, (x + 1) / T | 0); tx++) shore[ty * tw + tx] = 1;
      }
    }
    this.mask = m; this.groundAlpha = alpha;
    this.maskW = W; this.maskH = H;
    this.shoreTiles = new Map();
    for (let k = 0; k < shore.length; k++) {
      if (!shore[k]) continue;
      const tx = k % tw, ty = (k / tw) | 0, a = new Uint8Array(T * T).fill(255);
      for (let y = 0; y < T && ty * T + y < H; y++) for (let x = 0; x < T && tx * T + x < W; x++) a[y * T + x] = alpha[(ty * T + y) * W + tx * T + x];
      this.shoreTiles.set(k, a);
    }
    onProgress?.(0.05, 'Map data loaded');
    return data;
  }

  /** R channel: 255 land, 128 pond, 0 water */
  maskAt(x, z, ch = 0) {
    const M = this.meta;
    const i = Math.round((x - M.xmin) / M.res - 0.5), j = Math.round((z - M.zmin) / M.res - 0.5);
    if (i < 0 || j < 0 || i >= this.maskW || j >= this.maskH) return ch === 0 ? 255 : 0;
    return this.mask[(j * this.maskW + i) * 3 + ch];
  }
  isWater(x, z) { return this.maskAt(x, z) < 160; }
  /** signed distance (m, + over water) to the drawn waterline: the ground shader's edge (the water class's edge distance
   * in the mask's alpha, interpolated between texel centres), not the 2 m texel isWater answers by */
  waterEdge(x, z) {
    const M = this.meta, W = this.maskW, H = this.maskH, T = SHORE_TILE, tw = Math.ceil(W / T);
    const fx = Math.min(W - 1.001, Math.max(0, (x - M.xmin) / M.res - 0.5)), fz = Math.min(H - 1.001, Math.max(0, (z - M.zmin) / M.res - 0.5));
    const i0 = Math.floor(fx), j0 = Math.floor(fz), u = fx - i0, v = fz - j0, m = this.mask;
    // (no water texel among the four: land, whatever a land texel's own class edge says)
    if (m[(j0 * W + i0) * 3] >= 160 && m[(j0 * W + i0 + 1) * 3] >= 160 && m[((j0 + 1) * W + i0) * 3] >= 160 && m[((j0 + 1) * W + i0 + 1) * 3] >= 160) return -GROUND_SMAX;
    const at = (i, j) => {
      const tile = this.shoreTiles.get(Math.floor(j / T) * tw + Math.floor(i / T));
      const s = groundEdgeDistance(tile ? tile[(j % T) * T + (i % T)] : 255);
      return this.mask[(j * W + i) * 3] < 160 ? s : -s;
    };
    return (at(i0, j0) * (1 - u) + at(i0 + 1, j0) * u) * (1 - v) + (at(i0, j0 + 1) * (1 - u) + at(i0 + 1, j0 + 1) * u) * v;
  }

  /** facades: walls a landmark draws with the facade shader ({ geometry, records }, see _facadeRecords); placed: street
   *  furniture a landmark sets out itself ([kind, x, z, yaw, h], world/worker/streetscape.js) */
  build({ exclusions = [], clearings = [], paint = [], facades = [], placed = [], onProgress }) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./worker/cityBuilder.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = e => {
        const m = e.data;
        if (m.type === 'progress') onProgress?.(m.p, m.label);
        else if (m.type === 'error') { reject(new Error(m.message + '\n' + m.stack)); worker.terminate(); }
        else if (m.type === 'done') {
          worker.terminate();
          this.trees = m.trees;
          this.buildingInfo = m.buildingInfo;
          this.furniture = m.furniture; // street furniture: { pieces, obstacles } (world/worker/streetscape.js)
          this.railings = m.railings; // quay railing bays: x, z, yaw, length (StreetDetail draws them)
          this.rebuilt = new Set(m.rebuilt); // OSM buildings drawn as something else (landmarks, hawker pavilions)
          this.stats = m.stats;
          this._facadeRecords(m.facadeRecords, facades);
          this._createMeshes(m).then(() => resolve(m.stats), reject);
        }
      };
      worker.onerror = e => reject(e);
      worker.postMessage({ type: 'build', cityUrl: new URL('/data/city.json', location.href).href, groundUrl: new URL('/data/ground.png', location.href).href, exclusions, clearings, paint, placed, chunkSize: 300, f32normals: new URLSearchParams(location.search).has('f32normals') });
    });
  }

  // facade parameter records -> RGBA32F texture the facade shaders read per vertex (materials.js FACADE_REC). Walls a
  // landmark rebuilds with the facade shader (Clarke Quay's godowns) bring records of their own: appended after the
  // builder's, their geometry's aRec (an index into its own records) moved on to match before it is uploaded.
  _facadeRecords(recs, facades = []) {
    const total = facades.reduce((n, f) => n + f.records.length, recs.length);
    const texels = total / 4, H = Math.max(1, Math.ceil(texels / FACADE_REC_W));
    const data = new Float32Array(FACADE_REC_W * H * 4); data.set(recs);
    let o = recs.length;
    for (const f of facades) {
      data.set(f.records, o);
      const a = f.geometry.attributes.aRec.array, base = o / 8;
      for (let i = 0; i < a.length; i++) a[i] += base;
      o += f.records.length;
    }
    const t = new THREE.DataTexture(data, FACADE_REC_W, H, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.flipY = false; t.needsUpdate = true;
    t.userData.releaseSource = true; t.name = 'facadeRecords';
    FACADE_REC.value = t;
    this.facadeRecordCount = texels / 2;
  }

  // ?nobatch: the old one-mesh-per-chunk-and-category layout (A/B and debugging)
  _createPlainMeshes(m, CATS) {
    this.batches = null;
    for (const c of m.chunks) {
      const chunk = { key: c.key, center: new THREE.Vector3(c.x0 + c.size / 2, 0, c.z0 + c.size / 2), meshes: {}, inst: {}, vis: {}, tris: {}, sphere: {} };
      for (const name of [...CATS, 'wallsNear', 'structNear']) {
        if (!c[name]) continue;
        const mesh = new THREE.Mesh(toGeometry(c[name]), this.mats[name === 'wallsNear' ? 'walls' : name === 'structNear' ? 'struct' : name]);
        mesh.matrixAutoUpdate = false;
        mesh.receiveShadow = true;
        mesh.castShadow = name !== 'roads' && name !== 'foot';
        if (name === 'walls' || name === 'roofs' || name === 'struct') mesh.layers.enable(REFLECT_LAYER);
        mesh.name = `${name}_${c.key}`;
        this.group.add(mesh);
        chunk.meshes[name] = mesh;
        if (CATS.includes(name)) { chunk.vis[name] = true; chunk.tris[name] = c[name].index.length / 3; chunk.sphere[name] = mesh.geometry.boundingSphere; }
      }
      if (c.phys) this.physChunks.push({ key: c.key, ...c.phys });
      if (c.occl) this.occlChunks.push(c.occl);
      this.chunks.push(chunk);
    }
    this._createGround();
  }

  async _createMeshes(m) {
    // Walls, roofs, structures, roads and footways of every chunk go into one BatchedMesh per category: a single
    // multi-draw call per pass with per-chunk frustum culling and distance visibility (was ~450 draw calls per pass).
    const CATS = ['walls', 'roofs', 'roads', 'foot', 'struct'];
    if (NOBATCH) return this._createPlainMeshes(m, CATS);
    const size = {};
    for (const c of m.chunks) for (const name of CATS) if (c[name]) { const s = size[name] || (size[name] = { n: 0, v: 0, i: 0 }); s.n++; s.v += c[name].count; s.i += c[name].index.length; }
    this.batches = {};
    for (const name of CATS) {
      const s = size[name]; if (!s) continue;
      const bm = new THREE.BatchedMesh(s.n, s.v, s.i, this.mats[name]);
      bm.name = `city_${name}`;
      bm.frustumCulled = false; // per-chunk culling happens inside
      bm.receiveShadow = true;
      bm.castShadow = name === 'walls' || name === 'roofs' || name === 'struct';
      if (bm.castShadow) bm.layers.enable(REFLECT_LAYER);
      this.batches[name] = bm;
    }
    // (in slices: ~0.5 s of main-thread work on a phone, taps get answered in between)
    for (let ci = 0; ci < m.chunks.length; ci++) {
      if (ci % 40 === 39) await nextTask();
      const c = m.chunks[ci]; m.chunks[ci] = null; // let each chunk's arrays go as soon as they're copied into the batches
      const chunk = { key: c.key, center: new THREE.Vector3(c.x0 + c.size / 2, 0, c.z0 + c.size / 2), meshes: {}, inst: {}, vis: {}, tris: {}, sphere: {} };
      for (const name of CATS) {
        if (!c[name]) continue;
        const geo = toGeometry(c[name], false);
        const bm = this.batches[name];
        chunk.inst[name] = bm.addInstance(bm.addGeometry(geo));
        chunk.vis[name] = true; chunk.tris[name] = c[name].index.length / 3; chunk.sphere[name] = geo.boundingSphere;
      }
      // street-level detail: ordinary meshes, drawn for nearby chunks only (see update)
      for (const name of ['wallsNear', 'structNear']) {
        if (!c[name]) continue;
        const mesh = new THREE.Mesh(toGeometry(c[name]), this.mats[name === 'wallsNear' ? 'walls' : 'struct']);
        mesh.matrixAutoUpdate = false;
        mesh.receiveShadow = true; mesh.castShadow = true;
        mesh.name = `${name}_${c.key}`;
        this.group.add(mesh);
        chunk.meshes[name] = mesh;
      }
      if (c.phys) this.physChunks.push({ key: c.key, ...c.phys });
      if (c.occl) this.occlChunks.push(c.occl);
      this.chunks.push(chunk);
    }
    for (const bm of Object.values(this.batches)) {
      bm.computeBoundingBox(); bm.computeBoundingSphere(); // (per-chunk bounds were cached by addGeometry)
      for (const attr of Object.values(bm.geometry.attributes)) attr.onUpload(disposeArray);
      bm.geometry.index.onUpload(emptyIndex);
      this.group.add(bm);
    }
    this._createGround();
  }

  _createGround() {
    const M = this.meta;
    const W = this.maskW, H = this.maskH, m = this.mask, a = this.groundAlpha, px = new Uint8Array(W * H * 4);
    for (let i = 0, j = 0; i < W * H; i++, j += 4) { px[j] = m[i * 3]; px[j + 1] = m[i * 3 + 1]; px[j + 2] = m[i * 3 + 2]; px[j + 3] = a[i]; }
    this.groundAlpha = null;
    const tex = new THREE.DataTexture(px, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.flipY = false; tex.colorSpace = THREE.NoColorSpace; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true; tex.anisotropy = 8; tex.needsUpdate = true; tex.userData.releaseSource = true; tex.name = 'groundMask';
    this.groundTex = tex;
    // The ground is cut into cells: all-land cells use a shader without `discard` (so early depth rejection skips it
    // under roads, pavements and buildings), cells touching water use the discarding shore variant, pure-water cells
    // are dropped. Cells are classified like the GPU samples the mask (clamped at the edges, R < 160 = water).
    const pad = 2500, x0 = M.xmin - pad, z0 = M.zmin - pad, x1 = M.xmax + pad, z1 = M.zmax + pad;
    const waterAt = (x, z) => this.maskAt(Math.min(M.xmax - 1, Math.max(M.xmin + 1, x)), Math.min(M.zmax - 1, Math.max(M.zmin + 1, z))) < 160;
    const quads = { land: [], shore: [] };
    // 24 m cells over the mapped area, 250 m cells in the padding around it
    const cellsAlong = (a0, a1, b0, b1) => {
      const out = [];
      for (let v = a0; v < a1;) {
        const e = v >= b0 && v < b1 ? Math.min(v + 24, b1) : v < b0 ? Math.min(v + 250, b0) : Math.min(v + 250, a1);
        out.push([v, e]); v = e;
      }
      return out;
    };
    const xs = cellsAlong(x0, x1, M.xmin, M.xmax), zs = cellsAlong(z0, z1, M.zmin, M.zmax);
    for (const [ax, bx] of xs) for (const [az, bz] of zs) {
      let land = 0, water = 0; const st = Math.max(3, Math.min(bx - ax, bz - az) / 8);
      for (let x = ax; x <= bx + 0.01; x += st) for (let z = az; z <= bz + 0.01; z += st) { if (waterAt(x, z)) water++; else land++; if (land && water) break; }
      if (!land) continue;
      quads[water ? 'shore' : 'land'].push(ax, az, bx, bz);
    }
    const build = q => {
      const n = q.length / 4, pos = new Float32Array(n * 12), nor = new Int8Array(n * 16), idx = new Uint32Array(n * 6);
      for (let i = 0; i < n; i++) {
        const ax = q[i * 4], az = q[i * 4 + 1], bx = q[i * 4 + 2], bz = q[i * 4 + 3], o = i * 12, b = i * 4, j = i * 6;
        pos[o] = ax; pos[o + 2] = az; pos[o + 3] = ax; pos[o + 5] = bz; pos[o + 6] = bx; pos[o + 8] = bz; pos[o + 9] = bx; pos[o + 11] = az;
        for (let k = 0; k < 4; k++) nor[i * 16 + k * 4 + 1] = 127; // straight up, packed like the worker's normals
        idx[j] = b; idx[j + 1] = b + 1; idx[j + 2] = b + 2; idx[j + 3] = b; idx[j + 4] = b + 2; idx[j + 5] = b + 3;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 4, true));
      g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeBoundingSphere(); g.computeBoundingBox();
      for (const a of Object.values(g.attributes)) a.onUpload(disposeArray); g.index.onUpload(emptyIndex);
      return g;
    };
    const mk = (q, shore) => {
      const m = new THREE.Mesh(build(q), createGroundMaterial(tex, M, { shore }));
      // (not on REFLECT_LAYER: a sheet facing up is never seen from under the mirror plane — ~90k triangles a
      // reflection for nothing)
      m.receiveShadow = true; m.name = shore ? 'groundShore' : 'ground';
      // drawn after everything opaque that covers it (roads, footways, buildings, trees)
      m.renderOrder = 0.4; m.matrixAutoUpdate = false;
      this.group.add(m); return m;
    };
    this.ground = mk(quads.land, false);
    this.groundShore = mk(quads.shore, true);
    this.groundCells = { land: quads.land.length / 4, shore: quads.shore.length / 4 };
  }

  /** swap the batched walls/roofs to their cheap reflection materials (on) and back (off) around the water's
   *  reflection render; both variants get compiled by warmUp's real frame, which renders the reflection */
  setReflectionMaterials(on) {
    const B = this.batches;
    if (!B) { for (const ch of this.chunks) { if (ch.meshes.walls) ch.meshes.walls.material = on ? this.mats.wallsRefl : this.mats.walls; if (ch.meshes.roofs) ch.meshes.roofs.material = on ? this.mats.roofsRefl : this.mats.roofs; } return; }
    if (B.walls) B.walls.material = on ? this.mats.wallsRefl : this.mats.walls;
    if (B.roofs) B.roofs.material = on ? this.mats.roofsRefl : this.mats.roofs;
  }

  update(camera, drawDist = 4000) {
    const cp = camera.position, B = this.batches;
    const show = B ? (ch, name, v) => { if (ch.vis[name] !== v && ch.inst[name] !== undefined) { ch.vis[name] = v; B[name].setVisibleAt(ch.inst[name], v); } }
      : (ch, name, v) => { const m = ch.meshes[name]; if (m) { m.visible = v; ch.vis[name] = v; } };
    for (const ch of this.chunks) {
      const d = Math.hypot(ch.center.x - cp.x, ch.center.z - cp.z);
      show(ch, 'roads', d < Math.min(drawDist, 2200));
      show(ch, 'foot', d < 900);
      show(ch, 'struct', d < drawDist);
      show(ch, 'walls', d < drawDist + 2000);
      show(ch, 'roofs', d < drawDist + 2000);
      // street-level detail (colonnade pillars, five-foot-way floors, laundry poles): nearby chunks only
      const m = ch.meshes;
      if (m.wallsNear) m.wallsNear.visible = d < 520;
      if (m.structNear) m.structNear.visible = d < 520;
    }
  }
}
