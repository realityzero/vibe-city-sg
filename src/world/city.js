// City: drives the builder worker, owns chunk meshes, ground and water, exposes data for gameplay systems.
import * as THREE from 'three';
import { createFacadeMaterial, createRoofMaterial, createRoadMaterial, createStructMaterial, createGroundMaterial } from '../gfx/materials.js';
import { REFLECT_LAYER } from './water.js';

const NOBATCH = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nobatch');

function disposeArray() { this.array = null; }
function toGeometry(g, freeOnUpload = true) {
  const geo = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    const attr = new THREE.BufferAttribute(a.array, a.itemSize);
    // positions stay on the CPU (raycasts for camera framing); everything else is freed once on the GPU
    if (freeOnUpload && name !== 'position' && name !== 'normal') attr.onUpload(disposeArray);
    geo.setAttribute(name, attr);
  }
  geo.setIndex(new THREE.BufferAttribute(g.index, 1));
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
  }

  async load(onProgress) {
    const [data, maskImg] = await Promise.all([
      fetch('/data/city.json').then(r => r.json()),
      new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = '/data/ground.png'; }),
    ]);
    this.data = data;
    this.meta = data.meta;
    this.maskImg = maskImg;
    // CPU copy of the mask for queries (water / vegetation / paving)
    const cv = document.createElement('canvas'); cv.width = maskImg.width; cv.height = maskImg.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(maskImg, 0, 0);
    this.mask = ctx.getImageData(0, 0, cv.width, cv.height).data;
    this.maskW = cv.width; this.maskH = cv.height;
    onProgress?.(0.05, 'Map data loaded');
    return data;
  }

  /** R channel: 255 land, 128 pond, 0 water */
  maskAt(x, z, ch = 0) {
    const M = this.meta;
    const i = Math.round((x - M.xmin) / M.res - 0.5), j = Math.round((z - M.zmin) / M.res - 0.5);
    if (i < 0 || j < 0 || i >= this.maskW || j >= this.maskH) return ch === 0 ? 255 : 0;
    return this.mask[(j * this.maskW + i) * 4 + ch];
  }
  isWater(x, z) { return this.maskAt(x, z) < 160; }

  build({ exclusions = [], onProgress }) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./worker/cityBuilder.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = e => {
        const m = e.data;
        if (m.type === 'progress') onProgress?.(m.p, m.label);
        else if (m.type === 'error') { reject(new Error(m.message + '\n' + m.stack)); worker.terminate(); }
        else if (m.type === 'done') {
          this._createMeshes(m);
          this.trees = m.trees;
          this.buildingInfo = m.buildingInfo;
          this.stats = m.stats;
          worker.terminate();
          resolve(m.stats);
        }
      };
      worker.onerror = e => reject(e);
      worker.postMessage({ type: 'build', cityUrl: new URL('/data/city.json', location.href).href, groundUrl: new URL('/data/ground.png', location.href).href, exclusions, chunkSize: 300 });
    });
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
      this.chunks.push(chunk);
    }
    this._createGround();
  }

  _createMeshes(m) {
    // Walls, roofs, structures, roads and footways of every chunk go into one BatchedMesh per category: a single
    // multi-draw call per pass with per-chunk frustum culling and distance visibility (was ~450 draw calls per pass).
    // Each chunk keeps a position-only Mesh (never rendered) for line-of-sight raycasts / BVHs.
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
    for (const c of m.chunks) {
      const chunk = { key: c.key, center: new THREE.Vector3(c.x0 + c.size / 2, 0, c.z0 + c.size / 2), meshes: {}, inst: {}, vis: {}, tris: {}, sphere: {} };
      for (const name of CATS) {
        if (!c[name]) continue;
        const geo = toGeometry(c[name], false);
        const bm = this.batches[name];
        chunk.inst[name] = bm.addInstance(bm.addGeometry(geo));
        chunk.vis[name] = true; chunk.tris[name] = c[name].index.length / 3; chunk.sphere[name] = geo.boundingSphere;
        if (name === 'walls' || name === 'roofs' || name === 'struct') {
          // raycast proxy: positions + index only
          const rg = new THREE.BufferGeometry();
          rg.setAttribute('position', geo.attributes.position); rg.setIndex(geo.index);
          rg.boundingSphere = geo.boundingSphere; rg.boundingBox = geo.boundingBox;
          const proxy = new THREE.Mesh(rg, this.mats[name]);
          proxy.name = `${name}_${c.key}`;
          chunk.meshes[name] = proxy;
        }
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
      this.chunks.push(chunk);
    }
    for (const bm of Object.values(this.batches)) {
      bm.computeBoundingBox(); bm.computeBoundingSphere();
      // the merged vertex buffers live on the GPU only (BatchedMesh still reads the index type and positions)
      for (const [k, attr] of Object.entries(bm.geometry.attributes)) if (k !== 'position') attr.onUpload(disposeArray);
      this.group.add(bm);
    }
    this._createGround();
  }

  _createGround() {
    const M = this.meta;
    const tex = new THREE.Texture(this.maskImg);
    tex.flipY = false; tex.colorSpace = THREE.NoColorSpace; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true; tex.anisotropy = 8; tex.needsUpdate = true;
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
      const n = q.length / 4, pos = new Float32Array(n * 12), nor = new Float32Array(n * 12), idx = new Uint32Array(n * 6);
      for (let i = 0; i < n; i++) {
        const [ax, az, bx, bz] = q.slice(i * 4, i * 4 + 4);
        pos.set([ax, 0, az, ax, 0, bz, bx, 0, bz, bx, 0, az], i * 12);
        for (let k = 0; k < 4; k++) nor[i * 12 + k * 3 + 1] = 1;
        idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeBoundingSphere(); g.computeBoundingBox();
      return g;
    };
    const mk = (q, shore) => {
      const m = new THREE.Mesh(build(q), createGroundMaterial(tex, M, { shore }));
      m.receiveShadow = true; m.layers.enable(REFLECT_LAYER); m.name = shore ? 'groundShore' : 'ground';
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
