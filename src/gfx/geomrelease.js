// Static geometry is GPU-only once uploaded: drop the CPU arrays (Float32 positions, normals, uvs, indices...) as
// each attribute is first uploaded. Bounds are computed first (frustum culling and Box3.setFromObject use them).
// Nothing in the game reads static mesh vertices after load — line of sight and collisions use the physics world.
//
// gpuOnly(root) skips what is rebuilt or rewritten at runtime: Points/Lines/skinned meshes, any geometry with an
// InstancedBufferAttribute (instance pools share attributes with cached vehicle assets) or a non-static attribute,
// geometry flagged userData.keepCPU, and subtrees flagged userData.keepCPU (vehicles, characters). ?keepgeo turns
// it off for A/B runs.
import * as THREE from 'three';

const OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).has('keepgeo');
const F32N = typeof location !== 'undefined' && new URLSearchParams(location.search).has('f32normals'); // A/B
// first-upload marker: attributes already on the GPU keep their layout (replacing one would orphan its buffer)
THREE.BufferAttribute.prototype.onUploadCallback = function () { this.__uploaded = true; };

/** Float32 unit normals (xyz) → signed 8-bit normalized xyz + pad: 4 bytes a vertex instead of 12, at most 0.3° off
 * (a lighting change below one 8-bit level). Four components because Metal wants 4-byte vertex strides — ANGLE
 * would keep a converted copy of a 3-byte layout. Shaders still read a vec3. */
export function packNormals(src) {
  const v = src.length / 3, o = new Int8Array(v * 4);
  for (let i = 0; i < v; i++) for (let c = 0; c < 3; c++) { const x = src[i * 3 + c]; o[i * 4 + c] = Math.round((x > 1 ? 1 : x < -1 ? -1 : x) * 127); }
  return o;
}
function disposeArray() { this.bytesPerElement = this.array.BYTES_PER_ELEMENT; this.array = null; } // (size kept for tests/mobile/gpubuffers.mjs)
// BatchedMesh (and three's index handling) read index.array's element type: keep an empty array of the same type
function emptyIndex() { this.array = new this.array.constructor(0); }

export function gpuOnly(root) {
  if (OFF || !root) return 0;
  let n = 0;
  const visit = o => {
    // vehicles and people share cached geometry with models built later (carjacks, spawns, physics hulls)
    if (o.userData?.keepCPU || /^(vehicle|humanoid):/.test(o.name)) return;
    const g = o.geometry;
    if (g && !o.isPoints && !o.isLine && !o.isSkinnedMesh && !o.isBatchedMesh && !g.userData.keepCPU && !g.__gpuOnly) {
      const attrs = Object.values(g.attributes);
      const dynamic = attrs.some(a => a.isInstancedBufferAttribute || a.isInterleavedBufferAttribute || a.usage !== THREE.StaticDrawUsage) || Object.keys(g.morphAttributes).length;
      if (!dynamic && attrs.length) {
        if (!g.boundingSphere) g.computeBoundingSphere();
        if (!g.boundingBox) g.computeBoundingBox();
        const nr = g.attributes.normal;
        if (nr && !F32N && !nr.__uploaded && nr.array instanceof Float32Array && nr.itemSize === 3 && !nr.normalized) g.setAttribute('normal', new THREE.BufferAttribute(packNormals(nr.array), 4, true));
        for (const a of Object.values(g.attributes)) a.onUpload(disposeArray);
        if (g.index) g.index.onUpload(emptyIndex);
        g.__gpuOnly = true; n++;
      }
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  return n;
}
