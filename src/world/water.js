// Marina Bay / river / sea water: procedural ripples, planar reflections (layer-filtered, half res), fresnel, sun glint.
import * as THREE from 'three';
import { U } from '../gfx/globals.js';
import { NOISE } from '../gfx/shaderlib.js';
import { WATER_LEVEL } from '../core/constants.js';
import { REFL } from '../gfx/materials.js';

export const REFLECT_LAYER = 2;

export class Water {
  constructor({ size = 60000, reflections = true, resScale = 0.4 } = {}) {
    this.reflections = reflections;
    this.resScale = resScale;
    // mipmapped: rougher (distant, choppy, night) water samples a blurrier reflection instead of sharp wobbling towers
    this.rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 0, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.texMatrix = new THREE.Matrix4();
    this.reflCam = new THREE.PerspectiveCamera();
    this.reflCam.layers.set(REFLECT_LAYER);
    this.uniforms = {
      uRefl: { value: this.rt.texture }, uTexMatrix: { value: this.texMatrix }, uUseRefl: { value: reflections ? 1 : 0 }, uCheap: { value: reflections ? 0 : 1 },
      uTime: U.time, uNight: U.night, uRain: U.rain, uSunDir: U.sunDir, uSunCol: U.sunColor, uFogCol: U.fogColor,
    };
    const mat = new THREE.MeshStandardMaterial({ color: 0x082022, roughness: 0.05, metalness: 0.0, envMapIntensity: reflections ? 0.0 : 1.0 });
    mat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = `varying vec3 vWPos; varying vec4 vRC; uniform mat4 uTexMatrix;\n` + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz; vRC = uTexMatrix * vec4(vWPos, 1.0);`);
      shader.fragmentShader = `varying vec3 vWPos; varying vec4 vRC; uniform sampler2D uRefl; uniform float uUseRefl; uniform float uCheap; uniform vec3 uFogCol; uniform float uTime; uniform float uNight; uniform float uRain; uniform vec3 uSunDir; uniform vec3 uSunCol;
${NOISE}
// without planar reflections (phones): five analytic swells and one noise octave near the camera instead of twelve
// noise lookups — the env-map reflection of fine per-pixel chop at a 4x upscale was sparkle and dark speckle
vec2 waveGradCheap(vec2 p, float t, float camD) {
  vec2 g = vec2(0.0);
  vec2 d1 = normalize(vec2(1.0, 0.35)), d2 = normalize(vec2(-0.4, 1.0)), d3 = normalize(vec2(0.8, -0.7)), d4 = normalize(vec2(-0.95, -0.3)), d5 = normalize(vec2(0.2, -1.0));
  g += d1 * cos(dot(p, d1) * 0.55 + t * 1.3) * 0.055;
  g += d2 * cos(dot(p, d2) * 0.9 + t * 1.9) * 0.04;
  g += d3 * cos(dot(p, d3) * 1.7 + t * 2.6) * 0.03;
  g += d4 * cos(dot(p, d4) * 2.6 + t * 3.2) * 0.02;
  g += d5 * cos(dot(p, d5) * 3.7 + t * 3.8) * 0.014;
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
            grad = waveGradCheap(vWPos.xz, uTime, camD) * mix(0.55, 0.05, smoothstep(25.0, 450.0, camD));
            nVar = length(fwidth(grad));
            roughnessFactor = clamp(0.07 + nVar * 2.0 + smoothstep(40.0, 600.0, camD) * 0.16 + uNight * 0.06 + uRain * 0.1, 0.0, 0.5);
          } else {
            grad = waveGrad(vWPos.xz, uTime) * mix(0.6, 0.08, smoothstep(40.0, 700.0, camD));
            nVar = length(fwidth(grad));
            roughnessFactor = clamp(roughnessFactor + nVar * 3.0 + smoothstep(150.0, 1500.0, camD) * 0.08 + uNight * 0.08, 0.0, 0.5);
          }
          vec3 wn = normalize(vec3(-grad.x, 1.0, -grad.y));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);`)
        // no planar reflection: the env map's low band is the stand-in skyline glass towers mirror (dark blocks),
        // which turned the whole bay navy-black at grazing angles. The bay reflects the open sky just above it
        // instead, and toward the horizon the haze the far shore stands in (golden at sunset, city glow at night)
        .replace('#include <lights_fragment_maps>', `#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )
          if (uCheap > 0.5) {
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
            if (uUseRefl > 0.5) {
              vec2 ruv = vRC.xy / vRC.w + wn.xz * 0.035 * min(1.0, 60.0 / (camD * 0.05 + 1.0));
              // ripples smear a reflection vertically (each wave facet tilts toward or away from the viewer): three
              // taps along the reflection's vertical instead of one sharp, stair-stepped copy of the 0.4-res target
              float lod = clamp(roughnessFactor * 6.0 - 0.3, 0.3, 2.0), sv = (0.003 + roughnessFactor * 0.03) * min(1.0, 40.0 / (camD * 0.05 + 1.0));
              vec3 refl = textureLod(uRefl, ruv, lod).rgb * 0.5 + (textureLod(uRefl, ruv + vec2(0.0, sv), lod).rgb + textureLod(uRefl, ruv - vec2(0.0, sv), lod).rgb) * 0.25;
              totalEmissiveRadiance += refl * F * 0.96;
            }
            // subsurface-ish scattering on wave faces lit by the sun
            float sss = pow(clamp(1.0 - cosT, 0.0, 1.0), 2.0) * max(uSunDir.y, 0.0);
            totalEmissiveRadiance += vec3(0.01, 0.05, 0.045) * sss * length(uSunCol) * 0.25;
          }`);
    };
    mat.customProgramCacheKey = () => 'water-v3-' + (reflections ? 1 : 0);
    this.material = mat;
    REFL.tex.value = this.rt.texture; REFL.mat.value = this.texMatrix; REFL.on.value = reflections ? 1 : 0;
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

  setReflections(on) {
    this.reflections = on;
    REFL.on.value = on ? 1 : 0;
    this.uniforms.uUseRefl.value = on ? 1 : 0; this.uniforms.uCheap.value = on ? 0 : 1;
    this.material.envMapIntensity = on ? 0 : 1;
  }

  resize(w, h) { this.rt.setSize(Math.max(16, Math.floor(w * this.resScale)), Math.max(16, Math.floor(h * this.resScale))); }

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
    // water hidden behind the city (and roads dry — wet roads sample this texture too): skip the reflection; the
    // frame water reappears falls back to the env map
    const show = this.onScreen || U.wet.value > 0.05;
    // with no water in view, wet roads get a reflection about the street plane (not the water level 1.4 m below)
    const road = !this.onScreen;
    this.uniforms.uUseRefl.value = show && this._reflReady && !road && !this._lastRoad ? 1 : 0;
    this.material.envMapIntensity = this.uniforms.uUseRefl.value ? 0 : 1;
    if (!show) { this._reflReady = false; return; }
    this._reflReady = true; this._lastRoad = road; REFL.road.value = road ? 1 : 0;
    const planeY = road ? 0.05 : WATER_LEVEL;
    const v = this._v;
    v.rw.set(0, planeY, 0);
    v.cw.setFromMatrixPosition(camera.matrixWorld);
    if (v.cw.y < WATER_LEVEL + 0.05) return;
    v.rot.extractRotation(camera.matrixWorld);
    v.view.copy(v.cw); v.view.y = 2 * planeY - v.cw.y;
    v.look.set(0, 0, -1).applyMatrix4(v.rot).add(v.cw);
    v.target.copy(v.look); v.target.y = 2 * planeY - v.look.y;
    const rc = this.reflCam;
    rc.position.copy(v.view);
    rc.up.set(0, 1, 0).applyMatrix4(v.rot); rc.up.y = -rc.up.y;
    rc.lookAt(v.target);
    rc.far = camera.far; rc.near = camera.near;
    rc.updateMatrixWorld();
    rc.projectionMatrix.copy(camera.projectionMatrix);
    this.texMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.texMatrix.multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
    // oblique clip plane
    v.plane.setFromNormalAndCoplanarPoint(v.n, v.rw).applyMatrix4(rc.matrixWorldInverse);
    v.clip.set(v.plane.normal.x, v.plane.normal.y, v.plane.normal.z, v.plane.constant);
    const pm = rc.projectionMatrix.elements;
    v.q.set((Math.sign(v.clip.x) + pm[8]) / pm[0], (Math.sign(v.clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
    v.clip.multiplyScalar(2 / v.clip.dot(v.q));
    pm[2] = v.clip.x; pm[6] = v.clip.y; pm[10] = v.clip.z + 1 - 0.003; pm[14] = v.clip.w;
    rc.projectionMatrixInverse.copy(rc.projectionMatrix).invert();

    const prevRT = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    this.mesh.visible = false;
    renderer.setRenderTarget(this.rt);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear();
    // flat lit windows are plenty in a rippled low-res reflection: cheap facade/roof stand-ins while it renders
    const dd = U.detailDist.value; U.detailDist.value = 0;
    this.city?.setReflectionMaterials(true);
    try { renderer.render(scene, rc); } finally { this.city?.setReflectionMaterials(false); U.detailDist.value = dd; }
    renderer.setRenderTarget(prevRT);
    this.mesh.visible = true;
    renderer.shadowMap.autoUpdate = prevShadow;
  }
}
