// Marina Bay / river / sea water: procedural ripples, planar reflections (layer-filtered, half res), fresnel, sun glint.
// reflections: true (desktop: 0.4-res mirror, also lends wet roads theirs), 'lite' (phones: a tiny mirror of the
// city smeared into vertical streaks, water only), false (the env map's sky)
import * as THREE from 'three';
import { U } from '../gfx/globals.js';
import { NOISE } from '../gfx/shaderlib.js';
import { WATER_LEVEL } from '../core/constants.js';
import { REFL } from '../gfx/materials.js';
import { HF, HF_GLSL } from '../gfx/heightfield.js';

export const REFLECT_LAYER = 2;
// lite reflection: frames per rebuild, parts each city batch is dealt as, frustum widening (tangent scale)
const LITE_SLICES = 8, LITE_SHARES = 2, LITE_MARGIN = 1.15;

export class Water {
  constructor({ size = 60000, reflections = true, resScale = 0.4, liteScale = 0.25 } = {}) {
    this.reflections = reflections;
    this.resScale = resScale; this.liteScale = liteScale;
    // mipmapped: rougher (distant, choppy, night) water samples a blurrier reflection instead of sharp wobbling towers
    this.rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 0, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.texMatrix = new THREE.Matrix4();
    this.reflCam = new THREE.PerspectiveCamera();
    this.reflCam.layers.set(REFLECT_LAYER);
    this.uniforms = {
      uRefl: { value: this.rt.texture }, uTexMatrix: { value: this.texMatrix }, uUseRefl: { value: reflections ? 1 : 0 }, uCheap: { value: reflections === true ? 0 : 1 },
      uTime: U.time, uNight: U.night, uRain: U.rain, uSunDir: U.sunDir, uSunCol: U.sunColor, uFogCol: U.fogColor,
      uHF: HF.tex, uHFRect: HF.rect, uHFOn: HF.on, uHFShadowC: HF.shadowCenter, uHFShadowR: HF.shadowR,
    };
    // body colour: the bay and the river are a murky teal-jade, not the cobalt of an open sea
    const mat = new THREE.MeshStandardMaterial({ color: 0x163c33, roughness: 0.05, metalness: 0.0, envMapIntensity: reflections ? 0.0 : 1.0 });
    mat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = `varying vec3 vWPos; varying vec4 vRC; uniform mat4 uTexMatrix;\n` + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz; vRC = uTexMatrix * vec4(vWPos, 1.0);`);
      shader.fragmentShader = `varying vec3 vWPos; varying vec4 vRC; uniform sampler2D uRefl; uniform float uUseRefl; uniform float uCheap; uniform vec3 uFogCol; uniform float uTime; uniform float uNight; uniform float uRain; uniform vec3 uSunDir; uniform vec3 uSunCol;
${NOISE}
${HF_GLSL}
// a swell of k rad/m fades out as its crests close in on a pixel apart (pw: metres per pixel) — sampled coarser, the
// distant bay shows rings of moiré — and costs nothing once gone
vec2 swell(vec2 p, vec2 d, float k, float w, float a, float t, float pw) {
  float f = 1.0 - smoothstep(0.6, 1.6, pw * k);
  return f > 0.0 ? d * cos(dot(p, d) * k + t * w) * a * f : vec2(0.0);
}
// phones (lite or no planar reflection): five analytic swells and one noise octave near the camera instead of twelve
// noise lookups — the env-map reflection of fine per-pixel chop at a 4x upscale was sparkle and dark speckle
vec2 waveGradCheap(vec2 p, float t, float camD, float pw) {
  vec2 g = swell(p, normalize(vec2(1.0, 0.35)), 0.55, 1.3, 0.055, t, pw);
  g += swell(p, normalize(vec2(-0.4, 1.0)), 0.9, 1.9, 0.04, t, pw);
  g += swell(p, normalize(vec2(0.8, -0.7)), 1.7, 2.6, 0.03, t, pw);
  g += swell(p, normalize(vec2(-0.95, -0.3)), 2.6, 3.2, 0.02, t, pw);
  g += swell(p, normalize(vec2(0.2, -1.0)), 3.7, 3.8, 0.014, t, pw);
  if (camD < 120.0) {
    float e = 0.2; vec2 q = p * 0.9 + vec2(t * 0.35, t * 0.22);
    float n0 = vnoise(q), nx = vnoise(q + vec2(e, 0.0)), nz = vnoise(q + vec2(0.0, e));
    g += vec2(nx - n0, nz - n0) / e * (0.12 + uRain * 0.2) * (1.0 - smoothstep(60.0, 120.0, camD));
  }
  return g * (1.0 + uRain * 0.8);
}
vec2 waveGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  // directional swell
  vec2 d1 = normalize(vec2(1.0, 0.35)), d2 = normalize(vec2(-0.4, 1.0)), d3 = normalize(vec2(0.8, -0.7));
  g += d1 * cos(dot(p, d1) * 0.55 + t * 1.3) * 0.055;
  g += d2 * cos(dot(p, d2) * 0.9 + t * 1.9) * 0.04;
  g += d3 * cos(dot(p, d3) * 1.7 + t * 2.6) * 0.025;
  // chop from noise (finite differences)
  float e = 0.15;
  vec2 q = p * 0.7 + vec2(t * 0.35, t * 0.22);
  float n0 = fbm3(q), nx = fbm3(q + vec2(e, 0.0)), nz = fbm3(q + vec2(0.0, e));
  g += vec2(nx - n0, nz - n0) / e * (0.16 + uRain * 0.25);
  vec2 q2 = p * 2.6 - vec2(t * 0.6, t * 0.45);
  float m0 = vnoise(q2), mx = vnoise(q2 + vec2(e, 0.0)), mz = vnoise(q2 + vec2(0.0, e));
  g += vec2(mx - m0, mz - m0) / e * (0.05 + uRain * 0.2);
  return g;
}
` + shader.fragmentShader
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          float camD = length(vWPos - cameraPosition);
          vec2 grad; float nVar;
          if (uCheap > 0.5) {
            // calm and stable: the waves flatten sooner with distance and the surface turns satin (a blurrier env
            // sample) instead of resolving ripples smaller than a pixel into sparkle
            vec2 fw = fwidth(vWPos.xz);
            grad = waveGradCheap(vWPos.xz, uTime, camD, max(fw.x, fw.y)) * mix(0.55, 0.05, smoothstep(25.0, 450.0, camD));
            nVar = length(fwidth(grad));
            roughnessFactor = clamp(0.07 + nVar * 2.0 + smoothstep(40.0, 600.0, camD) * 0.16 + uNight * 0.06 + uRain * 0.1, 0.0, 0.5);
          } else {
            grad = waveGrad(vWPos.xz, uTime) * mix(0.6, 0.08, smoothstep(40.0, 700.0, camD));
            nVar = length(fwidth(grad));
            roughnessFactor = clamp(roughnessFactor + nVar * 3.0 + smoothstep(150.0, 1500.0, camD) * 0.08 + uNight * 0.08, 0.0, 0.5);
          }
          vec3 wn = normalize(vec3(-grad.x, 1.0, -grad.y));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
          // the shadow map ends at its box (sky.js): beyond it the city height field's far sun shadow takes over, as on
          // land (materials.js) — no hard-edged rectangle of tower shadow on the bay; without one the map's fades out
          float wFar = smoothstep(uHFShadowR * 0.7, uHFShadowR * 0.95, length(vWPos.xz - uHFShadowC.xz));
          float wSun = 1.0, wMapFade = uHFOn > 0.5 ? 0.0 : wFar;
          if (uHFOn > 0.5 && wFar > 0.0) wSun = mix(1.0, hfSunVis(vWPos, vec3(0.0, 1.0, 0.0), uSunDir), wFar);`)
        .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin
          .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= wSun;')
          .replace(/\? (getShadow\( directionalShadowMap\[ i \][^;]*?\)) : 1\.0;/, '? mix($1, 1.0, wMapFade) : 1.0;'))
        // phones without a planar reflection (this frame): the env map's low band is the stand-in skyline glass towers
        // mirror (dark blocks), which turned the whole bay navy-black at grazing angles. The bay reflects the open sky
        // just above it instead, and toward the horizon the haze the far shore stands in (golden at sunset, city glow)
        .replace('#include <lights_fragment_maps>', `#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
          if (uCheap > 0.5 && uUseRefl < 0.5) {
            iblIrradiance += getIBLIrradiance(geometryNormal);
            vec3 rW = reflect(-normalize(cameraPosition - vWPos), wn);
            vec3 rS = normalize(vec3(rW.x, 0.2 + max(rW.y, 0.0) * 0.8, rW.z));
            vec3 skyR = textureCubeUV(envMap, envMapRotation * rS, material.roughness).rgb * envMapIntensity;
            radiance += mix(skyR, uFogCol * 0.85, 1.0 - smoothstep(0.0, 0.14, rW.y));
          } else {
            #include <lights_fragment_maps>
          }
          #else
          #include <lights_fragment_maps>
          #endif`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          {
            vec3 V = normalize(cameraPosition - vWPos);
            float cosT = clamp(dot(wn, V), 0.0, 1.0);
            float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
            if (uUseRefl > 0.5 && uCheap > 0.5) {
              // lite (phones): the quarter-res mirror is smeared along the vertical — the night harbour look, every lit
              // window and lamp a streak (each ripple facet tilts toward or away from the viewer), and no texel crawl.
              // The swells only nudge it: displaced further, their regular crests cut a bright reflection (MBS at
              // golden hour) into horizontal bands
              vec2 ruv = vRC.xy / vRC.w + wn.xz * 0.014;
              float sv = 0.018 * (1.0 + uRain);
              vec3 acc = vec3(0.0), peak = vec3(0.0);
              for (int i = -2; i <= 2; i++) {
                vec3 c = textureLod(uRefl, ruv + vec2(0.0, float(i) * sv), 0.6).rgb;
                acc += c * (0.32 - 0.1 * abs(float(i))); peak = max(peak, c);
              }
              totalEmissiveRadiance += mix(acc, peak, 0.25) * F * 0.96;
            } else if (uUseRefl > 0.5) {
              vec2 ruv = vRC.xy / vRC.w + wn.xz * 0.035 * min(1.0, 60.0 / (camD * 0.05 + 1.0));
              // ripples smear a reflection vertically (each wave facet tilts toward or away from the viewer): three
              // taps along the reflection's vertical instead of one sharp, stair-stepped copy of the 0.4-res target
              float lod = clamp(roughnessFactor * 6.0 - 0.3, 0.3, 2.0), sv = (0.003 + roughnessFactor * 0.03) * min(1.0, 40.0 / (camD * 0.05 + 1.0));
              vec3 refl = textureLod(uRefl, ruv, lod).rgb * 0.5 + (textureLod(uRefl, ruv + vec2(0.0, sv), lod).rgb + textureLod(uRefl, ruv - vec2(0.0, sv), lod).rgb) * 0.25;
              totalEmissiveRadiance += refl * F * 0.96;
            }
            // subsurface-ish scattering on wave faces lit by the sun
            float sss = pow(clamp(1.0 - cosT, 0.0, 1.0), 2.0) * max(uSunDir.y, 0.0);
            totalEmissiveRadiance += vec3(0.012, 0.055, 0.04) * sss * length(uSunCol) * 0.25;
          }`);
    };
    mat.customProgramCacheKey = () => 'water-v5';
    this.material = mat;
    REFL.tex.value = this.rt.texture; REFL.mat.value = this.texMatrix; REFL.on.value = reflections === true ? 1 : 0;
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.renderOrder = 1; // after opaque land: early depth rejection skips the (expensive) water shading under the city
    this.mesh.receiveShadow = true;
    // is any water pixel actually on screen? An occlusion query around the water draw in the main pass answers it a
    // frame late; while nothing passes the depth test the (whole-city) reflection render is skipped
    this.onScreen = true;
    this._occ = null;
    this.mesh.onBeforeRender = (renderer, scene, camera) => {
      if (camera !== this.mainCamera || this._occ?.active) return;
      const gl = renderer.getContext();
      const o = this._occ || (this._occ = { gl, q: [gl.createQuery(), gl.createQuery()], i: 0, pending: [false, false], active: false });
      if (o.pending[o.i]) return; // both queries in flight (GPU behind): keep the last answer
      gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, o.q[o.i]); o.active = true;
    };
    this.mesh.onAfterRender = () => {
      const o = this._occ; if (!o?.active) return;
      o.gl.endQuery(o.gl.ANY_SAMPLES_PASSED_CONSERVATIVE); o.active = false; o.pending[o.i] = true; o.i ^= 1;
    };
    this._v = { rw: new THREE.Vector3(), cw: new THREE.Vector3(), view: new THREE.Vector3(), look: new THREE.Vector3(), target: new THREE.Vector3(), rot: new THREE.Matrix4(), n: new THREE.Vector3(0, 1, 0), plane: new THREE.Plane(), clip: new THREE.Vector4(), q: new THREE.Vector4() };
  }

  setReflections(mode) {
    this.reflections = mode;
    REFL.on.value = mode === true ? 1 : 0;
    this.uniforms.uUseRefl.value = mode ? 1 : 0; this.uniforms.uCheap.value = mode === true ? 0 : 1;
    this.material.envMapIntensity = mode ? 0 : 1;
    this._reflReady = false;
    if (this._size) this.resize(...this._size);
  }

  resize(w, h) {
    this._size = [w, h];
    const s = this.reflections === 'lite' ? this.liteScale : this.resScale;
    this.rt.setSize(Math.max(16, Math.floor(w * s)), Math.max(16, Math.floor(h * s)));
  }

  _pollOcclusion() {
    const o = this._occ; if (!o) return;
    const gl = o.gl;
    for (const k of [o.i, o.i ^ 1]) { // older query first
      if (!o.pending[k] || !gl.getQueryParameter(o.q[k], gl.QUERY_RESULT_AVAILABLE)) continue;
      this.onScreen = !!gl.getQueryParameter(o.q[k], gl.QUERY_RESULT); o.pending[k] = false;
    }
  }

  renderReflection(renderer, scene, camera) {
    if (!this.reflections) return;
    this.mainCamera = camera;
    this._pollOcclusion();
    if (this.reflections === 'lite') { this._renderLite(renderer, scene, camera); return; }
    // water hidden behind the city (and roads dry — wet roads sample this texture too): skip the reflection; the
    // frame water reappears falls back to the env map
    const show = this.onScreen || U.wet.value > 0.05;
    // with no water in view, wet roads get a reflection about the street plane (not the water level 1.4 m below)
    const road = !this.onScreen;
    this.uniforms.uUseRefl.value = show && this._reflReady && !road && !this._lastRoad ? 1 : 0;
    this.material.envMapIntensity = this.uniforms.uUseRefl.value ? 0 : 1;
    if (!show) { this._reflReady = false; return; }
    this._reflReady = true; this._lastRoad = road; REFL.road.value = road ? 1 : 0;
    const planeY = road ? 0.05 : WATER_LEVEL, rc = this.reflCam;
    if (!this._aim(camera, planeY, rc, this.texMatrix)) return;
    rc.projectionMatrix.copy(camera.projectionMatrix);
    this.texMatrix.multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
    this._clipOblique(rc, planeY);
    this._draw(renderer, scene, rc, this.rt);
  }

  /** places `rc` at the mirror image of `camera` about the plane y = planeY (projection left to the caller) and starts
   *  texMatrix with the clip -> uv bias; false with the camera under the plane */
  _aim(camera, planeY, rc, texMatrix) {
    const v = this._v;
    v.cw.setFromMatrixPosition(camera.matrixWorld);
    if (v.cw.y < WATER_LEVEL + 0.05) return false;
    v.rot.extractRotation(camera.matrixWorld);
    v.view.copy(v.cw); v.view.y = 2 * planeY - v.cw.y;
    v.look.set(0, 0, -1).applyMatrix4(v.rot).add(v.cw);
    v.target.copy(v.look); v.target.y = 2 * planeY - v.look.y;
    rc.position.copy(v.view);
    rc.up.set(0, 1, 0).applyMatrix4(v.rot); rc.up.y = -rc.up.y;
    rc.lookAt(v.target);
    rc.far = camera.far; rc.near = camera.near;
    rc.updateMatrixWorld();
    texMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    return true;
  }

  /** oblique near plane on the mirror plane: nothing under the water ends up in the reflection */
  _clipOblique(rc, planeY) {
    const v = this._v;
    v.rw.set(0, planeY, 0);
    v.plane.setFromNormalAndCoplanarPoint(v.n, v.rw).applyMatrix4(rc.matrixWorldInverse);
    v.clip.set(v.plane.normal.x, v.plane.normal.y, v.plane.normal.z, v.plane.constant);
    const pm = rc.projectionMatrix.elements;
    v.q.set((Math.sign(v.clip.x) + pm[8]) / pm[0], (Math.sign(v.clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
    v.clip.multiplyScalar(2 / v.clip.dot(v.q));
    pm[2] = v.clip.x; pm[6] = v.clip.y; pm[10] = v.clip.z + 1 - 0.003; pm[14] = v.clip.w;
    rc.projectionMatrixInverse.copy(rc.projectionMatrix).invert();
  }

  _draw(renderer, scene, rc, rt, keep = false) {
    const prevRT = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    this.mesh.visible = false;
    renderer.setRenderTarget(rt);
    renderer.state.buffers.depth.setMask(true);
    if (!keep) renderer.clear();
    // flat lit windows are plenty in a rippled low-res reflection: cheap facade/roof stand-ins while it renders
    const dd = U.detailDist.value; U.detailDist.value = 0;
    this.city?.setReflectionMaterials(true);
    try { renderer.render(scene, rc); } finally { this.city?.setReflectionMaterials(false); U.detailDist.value = dd; }
    renderer.setRenderTarget(prevRT);
    this.mesh.visible = true;
    renderer.shadowMap.autoUpdate = prevShadow;
  }

  // Phones: re-rendering the city for the mirror every frame cost ~1.3 ms of a ~3.6 ms frame on an M2 — vertices, not
  // pixels (a quarter-res target is almost free to fill). The lite reflection is built from one camera pose over
  // LITE_SLICES frames, a share of the mirrored city per frame (depth kept between them), into a back buffer that is
  // swapped in when complete. Sampled through the matrix of the pose it was built from, a reflection a few frames old
  // stays anchored to the shore (a point at the waterline is its own mirror image from any viewpoint); its frustum is a
  // little wider than the camera's so turning while the next one builds doesn't run off its edge.
  _renderLite(renderer, scene, camera) {
    if (!this._lite) {
      this._lite = {
        back: this.rt.clone(), cam: new THREE.PerspectiveCamera(), texMatrix: new THREE.Matrix4(), pos: new THREE.Vector3(), front: new THREE.Vector3(), slice: 0, ready: false,
        parts: null, order: null, was: [], load: new Array(LITE_SLICES), frustum: new THREE.Frustum(), m: new THREE.Matrix4(), sphere: new THREE.Sphere(), range: {},
      };
      this._lite.cam.layers.set(REFLECT_LAYER);
    }
    const L = this._lite;
    if (L.back.width !== this.rt.width || L.back.height !== this.rt.height) { L.back.setSize(this.rt.width, this.rt.height); L.slice = 0; L.ready = false; }
    const cp = this._v.cw.setFromMatrixPosition(camera.matrixWorld);
    // a reflection built far from here (a relocation, water seen again across town) would mirror the wrong place
    const valid = L.ready && cp.distanceToSquared(L.front) < 20 * 20;
    this.uniforms.uUseRefl.value = valid ? 1 : 0;
    this.material.envMapIntensity = valid ? 0 : 1;
    if (!this.onScreen) { L.slice = 0; return; }
    if (L.slice === 0) {
      if (!this._aim(camera, WATER_LEVEL, L.cam, L.texMatrix)) return;
      L.cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) / 2) * LITE_MARGIN));
      L.cam.aspect = camera.aspect; L.cam.updateProjectionMatrix();
      L.texMatrix.multiply(L.cam.projectionMatrix).multiply(L.cam.matrixWorldInverse);
      if (!L.parts) { L.parts = this._liteParts(scene); L.order = L.parts.slice(); }
      this._liteDeal(L);
      this._clipOblique(L.cam, WATER_LEVEL);
      L.pos.copy(cp);
    }
    // the first reflection (warm-up) is built in one go: it compiles every reflection program before play
    const one = L.ready;
    if (one) this._liteShare(L.slice, false);
    try { this._draw(renderer, scene, L.cam, L.back, L.slice > 0 && one); } finally { if (one) this._liteShare(L.slice, true); }
    L.slice = one ? L.slice + 1 : LITE_SLICES;
    if (L.slice < LITE_SLICES) return;
    L.slice = 0; L.ready = true;
    [this.rt, L.back] = [L.back, this.rt];
    this.uniforms.uRefl.value = REFL.tex.value = this.rt.texture;
    this.texMatrix.copy(L.texMatrix); L.front.copy(L.pos);
  }

  /** what the reflection draws, as parts to deal into jobs: objects, and each batched mesh (the city's walls, roofs,
   *  structures — one multi-draw each, culled per chunk) as LITE_SHARES parts of interleaved chunks, so no job is stuck
   *  with all of one. A batch's parts are consecutive (share 0 first). */
  _liteParts(scene) {
    const parts = [];
    scene.traverse(o => {
      if (!(o.isMesh || o.isPoints) || o === this.mesh || !o.layers.isEnabled(REFLECT_LAYER)) return;
      if (!o.isBatchedMesh) { parts.push({ o, share: -1, w: 0, job: 0 }); return; }
      for (let share = 0; share < LITE_SHARES; share++) parts.push({ o, share, w: 0, job: 0 });
    });
    return parts;
  }

  /** deals the parts to LITE_SLICES jobs of about equal triangle count in this pose's frustum (largest first): what
   *  each costs depends on where the camera looks (the CBD towers by the river, the Helix by the bay) */
  _liteDeal(L) {
    const f = L.frustum, m = L.m, sp = L.sphere, load = L.load.fill(0);
    f.setFromProjectionMatrix(m.multiplyMatrices(L.cam.projectionMatrix, L.cam.matrixWorldInverse));
    const shown = o => { for (let a = o; a; a = a.parent) if (!a.visible) return false; return true; };
    for (const p of L.parts) {
      const o = p.o; p.w = 0;
      if (!shown(o)) continue;
      if (p.share < 0) {
        const g = o.geometry;
        if (o.frustumCulled && !f.intersectsObject(o)) continue;
        p.w = (g.index ? g.index.count : g.attributes.position.count) * (o.isInstancedMesh ? o.count : g.isInstancedBufferGeometry ? g.instanceCount : 1);
        continue;
      }
      for (let i = p.share; i < o.instanceCount; i += LITE_SHARES) {
        if (!o.getVisibleAt(i)) continue;
        const gid = o.getGeometryIdAt(i);
        o.getBoundingSphereAt(gid, sp).applyMatrix4(o.getMatrixAt(i, m).premultiply(o.matrixWorld));
        if (f.intersectsSphere(sp)) p.w += o.getGeometryRangeAt(gid, L.range).count;
      }
    }
    L.order.sort((a, b) => b.w - a.w);
    for (const p of L.order) { let j = 0; for (let k = 1; k < LITE_SLICES; k++) if (load[k] < load[j]) j = k; p.job = j; load[j] += p.w; }
  }

  /** hides what job j doesn't draw (restore = false), or shows it again */
  _liteShare(j, restore) {
    const L = this._lite, was = L.was, parts = L.parts;
    let k = 0;
    for (let n = 0; n < parts.length; n++) {
      const p = parts[n], o = p.o;
      if (p.share < 0) {
        if (p.job === j) continue;
        if (restore) o.visible = was[k]; else { was[k] = o.visible; o.visible = false; }
        k++; continue;
      }
      // a batch: its LITE_SHARES parts from here on; drawn whole, not at all, or the chunks of the shares dealt to j
      let mine = 0;
      for (let s = 0; s < LITE_SHARES; s++) if (parts[n + s].job === j) mine++;
      if (mine === 0) { if (restore) o.visible = was[k]; else { was[k] = o.visible; o.visible = false; } k++; }
      else if (mine < LITE_SHARES) {
        for (let i = 0; i < o.instanceCount; i++, k++) {
          if (parts[n + i % LITE_SHARES].job === j) continue;
          if (restore) { if (was[k]) o.setVisibleAt(i, true); } else if ((was[k] = o.getVisibleAt(i))) o.setVisibleAt(i, false);
        }
      }
      n += LITE_SHARES - 1;
    }
  }
}
