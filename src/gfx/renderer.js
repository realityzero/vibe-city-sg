// WebGL2 renderer + pmndrs post-processing (bloom, AgX tone mapping, SMAA, vignette) + dynamic resolution.
import * as THREE from 'three';
import { setPrimaryRenderer } from './texrelease.js';
import './heightfog.js'; // altitude-aware haze for every material (patches three's fog chunks)
import { VibeVisionEffect } from './vibevision.js';
import { N8AOPostPass } from 'n8ao';
import { AutoExposurePass, ExposureEffect } from './autoexposure.js';
import { FilmGradeEffect } from './filmgrade.js';
import { U } from './globals.js';
import { EffectComposer, RenderPass, EffectPass, GodRaysEffect, BlendFunction, BloomEffect, ToneMappingEffect, ToneMappingMode, SMAAEffect, SMAAPreset, FXAAEffect, VignetteEffect, BrightnessContrastEffect, HueSaturationEffect } from 'postprocessing';

export const QUALITY = {
  // (low: no film grain — at a phone's ~4x upscale it reads as noise, not film)
  low: { pixelRatio: 0.75, shadows: 1024, shadowRadius: 110, reflections: false, bloom: true, smaa: false, grain: false, ao: false, treeDist: 600, treeNear: 90, drawDist: 2600 },
  medium: { pixelRatio: 1.0, shadows: 2048, shadowRadius: 150, reflections: true, bloom: true, smaa: true, ao: false, treeDist: 900, treeNear: 170, drawDist: 3500 },
  high: { pixelRatio: 1.25, shadows: 2048, shadowRadius: 170, reflections: true, bloom: true, smaa: true, ao: true, godrays: true, treeDist: 1300, treeNear: 230, drawDist: 5000 },
  ultra: { pixelRatio: 2.0, shadows: 4096, shadowRadius: 220, reflections: true, bloom: true, smaa: true, ao: true, godrays: true, treeDist: 1800, treeNear: 320, drawDist: 7000 },
};

export class Renderer {
  constructor(canvas, quality = 'high') {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, logarithmicDepthBuffer: false });
    setPrimaryRenderer(r); // texture sources are freed once this renderer has them (gfx/texrelease.js)
    r.outputColorSpace = THREE.SRGBColorSpace;
    // shader info-log reads force synchronous driver waits; keep them for development only
    r.debug.checkShaderErrors = !!import.meta.env?.DEV || new URLSearchParams(location.search).has('debug');
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap; // r186 swaps PCFSoft for PCF on the first shadow render (recompiling every program) — set it up front
    r.info.autoReset = false;
    this.setQuality(quality);
    this.composer = null;
    this.dynScale = 1;
    this.frameTimes = [];
  }

  setQuality(name) {
    this.qualityName = name;
    this.q = QUALITY[name] || QUALITY.high;
    this.dynScale = 1;
    this.setResolutionPreference(this.resPref ?? 1);
  }
  /** user resolution scale x quality pixel ratio x a per-GPU cap (base M1/M2 GPUs start with fewer pixels so the
   * first minute is already at 60 fps; dynamic resolution refines it from there) */
  setResolutionPreference(scale = 1) {
    this.resPref = scale;
    this.basePixelRatio = Math.min(window.devicePixelRatio || 1, this.q.pixelRatio, this.autoPixelCap ?? Infinity) * scale;
    this.resize();
  }
  detectGpu() {
    const gl = this.renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    // base (non Pro/Max/Ultra) Apple silicon: M1 7-8 GPU cores, M2 8-10
    if (/Apple M1(?! (Pro|Max|Ultra))/.test(this.gpuName)) this.autoPixelCap = 1.0;
    else if (/Apple M2(?! (Pro|Max|Ultra))/.test(this.gpuName)) this.autoPixelCap = 1.15;
    return this.gpuName;
  }

  setupPost(scene, camera) {
    this.scene = scene; this.camera = camera;
    const c = this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType });
    this.renderPass = new RenderPass(scene, camera);
    c.addPass(this.renderPass);
    this.autoExposure = new AutoExposurePass();
    this.exposureFx = new ExposureEffect();
    this.autoExposure.onTexture = t => { this.exposureFx.uniforms.get('tExposure').value = t; };
    c.addPass(this.autoExposure);
    // ambient occlusion (half-res, depth-aware upsample): contact shadows under cars, in arcades and street canyons
    this.ao = new N8AOPostPass(scene, camera, innerWidth, innerHeight);
    Object.assign(this.ao.configuration, { aoRadius: 1.0, distanceFalloff: 1.0, intensity: 1.6, halfRes: true, depthAwareUpsampling: true, aoSamples: 8, denoiseSamples: 4, denoiseRadius: 4, gammaCorrection: false, color: new THREE.Color(0, 0, 0) });
    c.addPass(this.ao);
    this.bloom = new BloomEffect({ intensity: 0.8, luminanceThreshold: 1.0, luminanceSmoothing: 0.3, mipmapBlur: true, radius: 0.62, levels: 6 });
    // bloom from half resolution (like most engines): the luminance extract is half-res and the blur chain starts at a
    // quarter — the same glow widths as a 7-level chain from full res, at a quarter of the pixel work
    this.bloom.luminancePass.resolution.scale = 0.5;
    { const mip = this.bloom.mipmapBlurPass, set = mip.setSize.bind(mip); mip.setSize = (w, h) => set(Math.ceil(w * 0.5), Math.ceil(h * 0.5)); }
    // what feeds the bloom is capped (hue kept) at night: a sign or lamp a few pixels big but 10-20x over white
    // spread into a blob of glow many times its size, worst at a phone's resolution
    { const lm = this.bloom.luminanceMaterial; lm.uniforms.bloomMax = new THREE.Uniform(1e4);
      lm.fragmentShader = 'uniform float bloomMax;\n' + lm.fragmentShader.replace('vec4 texel=texture2D(inputBuffer,vUv);', 'vec4 texel=texture2D(inputBuffer,vUv);texel.rgb*=min(1.0,bloomMax/max(max(texel.r,max(texel.g,texel.b)),1e-4));'); }
    const tm = { aces: ToneMappingMode.ACES_FILMIC, agx: ToneMappingMode.AGX, neutral: ToneMappingMode.NEUTRAL }[new URLSearchParams(location.search).get('tm')] ?? ToneMappingMode.ACES_FILMIC;
    this.tone = new ToneMappingEffect({ mode: tm });
    const film = !new URLSearchParams(location.search).has('nofilm');
    this.grade = new HueSaturationEffect({ saturation: film ? 0.04 : 0.12, hue: 0 });
    this.bc = new BrightnessContrastEffect({ contrast: film ? 0.05 : 0.06, brightness: 0.0 });
    this.vignette = new VignetteEffect({ darkness: 0.3, offset: 0.34 });
    this.film = new FilmGradeEffect({ split: film ? 0.6 : 0, grain: film ? 0.011 : 0, lift: film ? 0.005 : 0 });
    c.addPass(new EffectPass(camera, this.bloom, this.exposureFx, this.tone, this.grade, this.bc, this.vignette, this.film));
    // crepuscular rays at golden hour: a sun disc mesh far away, occluded by the city in the god-ray mask
    this.sunMesh = new THREE.Mesh(new THREE.SphereGeometry(160, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false, depthWrite: false, transparent: true, opacity: 0.9 }));
    this.sunMesh.frustumCulled = false; this.sunMesh.matrixAutoUpdate = true;
    scene.add(this.sunMesh);
    this.godRays = new GodRaysEffect(camera, this.sunMesh, { blendFunction: BlendFunction.SCREEN, samples: 36, density: 0.94, decay: 0.92, weight: 0.32, exposure: 0.42, clampMax: 0.85, resolutionScale: 0.32, blur: true });
    this.godPass = new EffectPass(camera, this.godRays);
    this.godPass.enabled = false;
    c.addPass(this.godPass);
    this.vibe = new VibeVisionEffect();
    this.vibePass = new EffectPass(camera, this.vibe);
    this.vibePass.enabled = false;
    c.addPass(this.vibePass);
    this.smaa = new SMAAEffect({ preset: SMAAPreset.MEDIUM });
    this.smaaPass = new EffectPass(camera, this.smaa);
    c.addPass(this.smaaPass);
    // the composer only draws to the screen from the last pass *added*: with SMAA off (low preset) every frame used to
    // end in an off-screen buffer — a black game. This pass is the screen output whenever SMAA is off: FXAA, the
    // phone's only anti-aliasing. Its edge test runs on perceptual (sqrt) luma: the composer's buffers are linear,
    // where the stock luminance() leaves most edges in shade and at night below its threshold.
    const fxaa = new FXAAEffect();
    fxaa.fragmentShader = 'float fxaaLuma(vec3 c) { return sqrt(max(luminance(c), 0.0)); }\n' + fxaa.fragmentShader.replaceAll('luminance(texture2D', 'fxaaLuma(texture2D').replace('luminance(inputColor.rgb)', 'fxaaLuma(inputColor.rgb)');
    this.outPass = new EffectPass(camera, fxaa);
    c.addPass(this.outPass);
    this.applyQualityToPost();
    this.resize();
  }

  applyQualityToPost() {
    if (!this.composer) return;
    this.smaaPass.enabled = this.q.smaa; this.outPass.enabled = !this.q.smaa;
    if (this.smaaPass.renderToScreen !== this.q.smaa) { this.smaaPass.renderToScreen = this.q.smaa; this.outPass.renderToScreen = !this.q.smaa; }
    if (this.ao) this.ao.enabled = !!this.q.ao && this.aoAllowed !== false;
    this.film.uniforms.get('uGrain').value = this.q.grain === false ? 0 : this.film.grain;
    this.bloom.blendMode.opacity.value = this.q.bloom && !new URLSearchParams(location.search).has('nobloom') ? 1 : 0;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = this.basePixelRatio * this.dynScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    if (this.composer) this.composer.setSize(w, h, false);
    if (this.camera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    this.width = Math.floor(w * pr); this.height = Math.floor(h * pr);
    this.onResize?.(this.width, this.height);
  }

  // GPU time of reflection + main render via EXT_disjoint_timer_query_webgl2 (async: results arrive a few frames
  // later). Includes some CPU-submission gaps, so it's a hint for headroom, not an exact GPU profile.
  gpuBegin() {
    const T = this._gt || (this._gt = { ext: this.renderer.getContext().getExtension('EXT_disjoint_timer_query_webgl2'), pending: [], active: null, n: 0, samples: [] });
    if (!T.ext || T.active || T.pending.length >= 6 || (T.n++ & 1)) return; // every other frame is plenty
    const gl = this.renderer.getContext(); T.active = gl.createQuery(); gl.beginQuery(T.ext.TIME_ELAPSED_EXT, T.active);
  }
  gpuEnd() {
    const T = this._gt; if (!T?.ext) return;
    const gl = this.renderer.getContext();
    if (T.active) { gl.endQuery(T.ext.TIME_ELAPSED_EXT); T.pending.push(T.active); T.active = null; }
    if (gl.getParameter(T.ext.GPU_DISJOINT_EXT)) { for (const q of T.pending) gl.deleteQuery(q); T.pending.length = 0; T.samples.length = 0; this.gpuMs = 0; return; }
    while (T.pending.length && gl.getQueryParameter(T.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = T.pending.shift(); const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; gl.deleteQuery(q);
      T.samples.push(ms); this.gpuMs = this.gpuMs ? this.gpuMs * 0.9 + ms * 0.1 : ms;
    }
  }
  resetFrameStats() { this._dyn = null; if (this._gt) this._gt.samples.length = 0; }

  // Dynamic resolution for a steady 60 fps. Under vsync, averages and medians hide a GPU that misses every 8th frame,
  // so the game loop reports how many 60 Hz slots each tick missed. Per one-second window: >5% missed slots twice in a
  // row (and not CPU-bound — fewer pixels wouldn't help) steps resolution down; a clean run with GPU headroom probes
  // back up, with exponential backoff if the probe fails. Every resize reallocates all post targets (a 30-40 ms
  // hitch), hence the cooldowns.
  trackFrame({ missed = 0, cpuMs = 0, eligible = true } = {}) {
    const now = performance.now();
    if (!eligible) { if (this._dyn) this._dyn.start = now; return; }
    const D = this._dyn || (this._dyn = { start: now, slots: 0, missed: 0, cpu: [], bad: 0, good: 0, changed: -1e9, lastUp: -1e9, beforeUp: 1, backoff: 6 });
    if (now < D.start) return; // settling after a resize: its own reallocation hitch must not count as overload
    // a frame that lost 3+ slots is a one-off hitch (GC, a load, another app), not a GPU that's too slow: skip it
    if (missed < 3) { D.slots += 1 + missed; D.missed += missed; D.cpu.push(cpuMs); }
    if (now - D.start < 1000) return;
    const ratio = D.missed / D.slots;
    const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor((s.length - 1) * p)] ?? 0; };
    const cpu90 = pct(D.cpu, 0.9);
    const T = this._gt, gpu90 = T?.samples.length ? pct(T.samples, 0.9) : null; if (T) T.samples.length = 0;
    this.missRatio = ratio; this.cpu90 = cpu90; this.gpu90 = gpu90;
    D.start = now; D.slots = D.missed = 0; D.cpu.length = 0;
    if (!this.dynamicResolution) return;
    const overloaded = ratio > 0.05, cpuBound = cpu90 > 15;
    D.bad = overloaded && !cpuBound ? D.bad + 1 : 0;
    D.good = ratio === 0 && (gpu90 === null || gpu90 < 12.5) ? D.good + 1 : 0;
    let scale = this.dynScale;
    // iOS Low Power Mode caps rAF at 30 Hz: every other 60 Hz slot is "missed" whatever the resolution. Signature: a
    // drop in resolution that left the miss ratio at ~1/2 with callbacks ~33 ms apart -> undo the drop and pace the
    // loop to 30 Hz slots (the game loop goes back to 60 once callbacks arrive at 60 Hz again)
    if (D.preDrop && now - D.changed > 1500) {
      const half = r => Math.abs(r - 0.5) < 0.08;
      if (half(ratio) && half(D.preDrop.ratio) && this.rafMs > 28) {
        this.slotMs = 1000 / 30; scale = D.preDrop.scale; D.bad = D.good = 0; D.preDrop = null;
        if (Math.abs(scale - this.dynScale) > 0.01) { this.setDynScale(scale); D.changed = now; D.start = now + 1000; }
        return;
      }
      D.preDrop = null;
    }
    if (D.bad >= 2 && now - D.changed > 3000) {
      if (now - D.lastUp < 6000) { scale = D.beforeUp; D.backoff = Math.min(64, D.backoff * 2); D.lastUp = -1e9; } // the probe up failed
      else { D.preDrop = { scale, ratio }; scale = Math.max(0.55, scale - (ratio > 0.2 ? 0.14 : 0.08)); }
    } else if (scale < 1 && D.good >= D.backoff && now - D.changed > 6000) { D.beforeUp = scale; D.lastUp = now; scale = Math.min(1, scale + 0.05); }
    if (Math.abs(scale - this.dynScale) > 0.01) { this.setDynScale(scale); D.changed = now; D.bad = D.good = 0; D.start = now + 1000; D.slots = D.missed = 0; D.cpu.length = 0; }
  }
  setDynScale(s) { if (Math.abs(s - this.dynScale) > 0.01) { this.dynScale = s; this.resize(); } }

  // place the god-ray sun and enable the pass only while the sun is low and visible
  updateSun(sunDir, rain, camera) {
    if (!this.sunMesh) return;
    const low = sunDir.y > -0.02 && sunDir.y < 0.42 && rain < 0.3 && !!this.q.godrays;
    this.sunMesh.position.copy(camera.position).addScaledVector(sunDir, 12000);
    this.sunMesh.visible = low;
    const fwd = this._f || (this._f = new THREE.Vector3()); camera.getWorldDirection(fwd);
    // only while the sun disc is on (or just off) screen
    const sp = (this._sunNdc || (this._sunNdc = new THREE.Vector3())).copy(this.sunMesh.position).project(camera);
    this.godPass.enabled = low && fwd.dot(sunDir) > 0 && Math.abs(sp.x) < 1.3 && Math.abs(sp.y) < 1.3;
    if (low) this.godRays.blendMode.opacity.value = THREE.MathUtils.smoothstep(sunDir.y, -0.02, 0.06) * (1 - THREE.MathUtils.smoothstep(sunDir.y, 0.25, 0.42)) * (1 - rain / 0.3);
  }

  render(dt) {
    if (this.film) {
      // golden-hour grade while the sun is within ~18 deg of the horizon (handing over to the night grade at dusk)
      const sy = U.sunDir.value.y, fu = this.film.uniforms;
      fu.get('uNight').value = U.night.value;
      fu.get('uGolden').value = (1 - THREE.MathUtils.smoothstep(sy, 0.12, 0.32)) * THREE.MathUtils.smoothstep(sy, -0.1, 0.0) * (1 - U.rain.value);
    }
    // daylight: a dark glass tower filling the frame may not push exposure so far that the sky turns to white paper
    // eye adaptation ceiling: daylight 1.4 (a dark tower filling the frame mustn't turn the sky to paper), more room in
    // the golden hour when the low sun leaves streets in shadow under a dimming sky, night 1.95 (night stays night)
    if (this.autoExposure) { const golden = 1 - THREE.MathUtils.smoothstep(U.sunDir.value.y, 0.04, 0.28); this.autoExposure.maxE = THREE.MathUtils.lerp(THREE.MathUtils.lerp(1.4, 1.8, golden), 1.95, U.night.value); }
    // physically-based bloom: no hard threshold (a thresholded sky around the sun bloomed into a disc with a coloured
    // rim); a small fraction of the blurred frame is added, so only genuinely bright things glow. Night = stronger.
    if (this.bloom) {
      const n = Math.min(1, U.night.value * 1.4);
      this.bloom.luminanceMaterial.threshold = THREE.MathUtils.lerp(0.6, 0.35, n);
      this.bloom.luminanceMaterial.smoothing = THREE.MathUtils.lerp(2.5, 1.2, n);
      this.bloom.intensity = (this._bloomI ?? 1) * THREE.MathUtils.lerp(0.2, 0.52, n);
      this.bloom.luminanceMaterial.uniforms.bloomMax.value = THREE.MathUtils.lerp(1e4, 8, n);
    }
    if (this.composer) this.composer.render(dt); else this.renderer.render(this.scene, this.camera);
  }
}
