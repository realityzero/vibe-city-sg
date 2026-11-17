// Static textures don't need their CPU-side pixels once they are on the GPU. Nearly every texture here is painted
// once into a 2D canvas (atlases, signs, liveries) or built as a typed array (ground wear, light field), uploaded,
// and never touched again — yet the canvas backing stores alone were ~260 MB (on iOS they are IOSurfaces in the
// GPU process, counted against the same memory budget that gets the tab killed).
//
// three.js calls texture.onUpdate(texture) right after every upload; a prototype accessor makes that hook run for
// every texture. On upload the source is shrunk (canvas -> 0x0, ImageBitmap closed, typed array dropped) and
// replaced by a stub that keeps its dimensions, so code reading texture.image.width/height still works.
//
// Canvases, ImageBitmaps and images are released by default; opt out with texture.userData.keepSource = true
// (anything redrawn and re-uploaded later). Typed-array data textures only with texture.userData.releaseSource = true.
// ?keepsrc turns it all off for A/B runs. A texture whose source was released must never be re-uploaded: version
// bumps after the release are reported in the console.
import * as THREE from 'three';

const OFF = typeof location !== 'undefined' && new URLSearchParams(location.search).has('keepsrc');
let freed = 0, count = 0;
// pixel source (canvas, image...) -> every THREE.Source wrapping it: a canvas is often shared by several textures
// (map + emissiveMap, a depth material's copy), each with its own Source and its own upload
const users = new WeakMap();
const isCanvas = d => (typeof HTMLCanvasElement !== 'undefined' && d instanceof HTMLCanvasElement) || (typeof OffscreenCanvas !== 'undefined' && d instanceof OffscreenCanvas);

// all textures sharing a pixel source uploaded? (several Sources may wrap one canvas, and Texture.copy() shares a
// Source — and its hand-made mip canvases — between textures that are uploaded separately)
const texturesOf = src => [...(src.__textures || [])].map(r => r.deref()).filter(u => u && u.source === src);

// only uploads into the main renderer count: helpers with their own WebGL context (the tree impostor baker) upload
// the same textures first, and those copies die with the helper
let primaryDepth = 0;
export function setPrimaryRenderer(renderer) {
  for (const k of ['render', 'initTexture', 'initRenderTarget']) {
    const f = renderer[k]; if (typeof f !== 'function') continue;
    renderer[k] = function (...a) { primaryDepth++; try { return f.apply(this, a); } finally { primaryDepth--; } };
  }
}

function release(t) {
  if (!primaryDepth) return;
  t.__uploaded = true;
  if (OFF || t.userData?.keepSource || t.isRenderTargetTexture || t.isVideoTexture || t.isCompressedTexture) return;
  const d = t.source?.data;
  if (!d || d.__released) return;
  // wait until every texture sharing this source has been uploaded too
  const all = [...(users.get(d) || [])].map(r => r.deref()).filter(s => s && s.data === d);
  if ((all.length ? all : [t.source]).some(src => texturesOf(src).some(u => !u.__uploaded))) return;
  const w = d.width || 0, h = d.height || 0, depth = d.depth || 1;
  let bytes = 0;
  if (isCanvas(d)) {
    if (d.isConnected) return; // on screen as well (never the case for texture sources, but be safe)
    bytes = w * h * 4; d.width = 0; d.height = 0;
  } else if (typeof ImageBitmap !== 'undefined' && d instanceof ImageBitmap) {
    bytes = w * h * 4; d.close();
  } else if (typeof HTMLImageElement !== 'undefined' && d instanceof HTMLImageElement) {
    bytes = w * h * 4; // decoded pixels go once nothing references the element
  } else if (d.data && ArrayBuffer.isView(d.data)) {
    // data textures are opt-in: three.js itself keeps reading some on the CPU (BatchedMesh matrices / indirection,
    // skeleton bones) and some of ours are rewritten and re-uploaded
    if (!t.userData?.releaseSource) return;
    bytes = d.data.byteLength;
  } else return; // cube faces, arrays of images, unknown: leave alone
  const stub = { width: w, height: h, depth, __released: true };
  for (const s of all.length ? all : [t.source]) s.data = stub;
  // hand-built mip chains (canvases) are only read at upload too
  for (const m of t.mipmaps || []) if (m && isCanvas(m) && !m.isConnected && m.width) { bytes += m.width * m.height * 4; m.width = 0; m.height = 0; }
  freed += bytes; count++;
}

let installed = false;
export function installTextureRelease() {
  if (installed) return; installed = true;
  const desc = { configurable: true, enumerable: false };
  Object.defineProperty(THREE.Texture.prototype, 'onUpdate', {
    ...desc,
    get() { const own = this._onUpdateOwn; return own ? t => { own(t); release(t); } : release; },
    set(f) { Object.defineProperty(this, '_onUpdateOwn', { value: f, writable: true, configurable: true, enumerable: false }); },
  });
  // remember which Sources wrap each pixel source (Source's constructor and Texture.image = x both set source.data)
  Object.defineProperty((THREE.TextureSource || THREE.Source).prototype, 'data', {
    ...desc,
    get() { return this.__data; },
    set(v) {
      Object.defineProperty(this, '__data', { value: v, writable: true, configurable: true, enumerable: false });
      if (v && typeof v === 'object' && !v.__released) { let set = users.get(v); if (!set) users.set(v, set = new Set()); set.add(new WeakRef(this)); }
    },
  });
  Object.defineProperty(THREE.Texture.prototype, 'source', {
    ...desc,
    get() { return this.__source; },
    set(v) {
      Object.defineProperty(this, '__source', { value: v, writable: true, configurable: true, enumerable: false });
      if (v && typeof v === 'object') (v.__textures || Object.defineProperty(v, '__textures', { value: new Set(), enumerable: false }).__textures).add(new WeakRef(this));
    },
  });
  // a released texture asked to upload again would send a stub to the GPU: say so loudly
  const vd = Object.getOwnPropertyDescriptor(THREE.Texture.prototype, 'needsUpdate');
  if (vd?.set) Object.defineProperty(THREE.Texture.prototype, 'needsUpdate', {
    ...vd,
    set(v) { if (v && this.source?.data?.__released) console.error('texture re-upload after its source was released', this.name || this); vd.set.call(this, v); },
  });
}
export const releasedTextureStats = () => ({ count, mb: Math.round(freed / 1048576) });
