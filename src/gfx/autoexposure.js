// GPU eye adaptation (no CPU readback): after the scene render, a pass reduces the HDR frame to a 32x18
// log-luminance grid, then to a single adapted-exposure texel (ping-pong 1x1 targets, time-smoothed).
// ExposureEffect multiplies the frame by that texel right before tone mapping.
import * as THREE from 'three';
import { Pass, Effect, BlendFunction } from 'postprocessing';

const FS_VERT = 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }';

export class AutoExposurePass extends Pass {
  constructor() {
    super('AutoExposurePass');
    this.needsSwap = false;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
    this.lumRT = new THREE.WebGLRenderTarget(32, 18, opts);
    this.adapt = [new THREE.WebGLRenderTarget(1, 1, opts), new THREE.WebGLRenderTarget(1, 1, opts)];
    this.idx = 0;
    this.lumMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, texel: { value: new THREE.Vector2(1 / 128, 1 / 72) } },
      vertexShader: FS_VERT,
      fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 texel; varying vec2 vUv;
        void main(){ float s = 0.0;
          for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) {
            vec3 c = texture2D(tDiffuse, vUv + (vec2(float(i), float(j)) - 1.5) * texel).rgb;
            s += log(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-4));
          }
          gl_FragColor = vec4(s / 16.0, 0.0, 0.0, 1.0); }`,
      depthTest: false, depthWrite: false,
    });
    this.adaptMat = new THREE.ShaderMaterial({
      uniforms: { tLum: { value: this.lumRT.texture }, tPrev: { value: null }, dt: { value: 0.016 }, base: { value: 1 }, reset: { value: 1 }, maxE: { value: 2.4 } },
      vertexShader: FS_VERT,
      fragmentShader: `uniform sampler2D tLum; uniform sampler2D tPrev; uniform float dt; uniform float base; uniform float reset; uniform float maxE; varying vec2 vUv;
        void main(){
          float sum = 0.0, wsum = 0.0;
          for (int y = 0; y < 18; y++) for (int x = 0; x < 32; x++) {
            vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(32.0, 18.0);
            float w = (1.2 - min(1.0, length((uv - 0.5) * vec2(2.0, 2.0)))) * (uv.y > 0.7 ? 0.5 : 1.0); // centre-weighted, sky counts less
            sum += texture2D(tLum, uv).r * w; wsum += w;
          }
          float avg = exp(sum / wsum) * base;
          float target = clamp(pow(0.16 / max(avg, 1e-4), 0.55), 0.7, maxE);
          float prev = texture2D(tPrev, vec2(0.5)).r;
          if (reset > 0.5 || !(prev > 0.0) || prev > 10.0) prev = target;
          float rate = target > prev ? 0.9 : 1.6;
          gl_FragColor = vec4(prev + (target - prev) * min(1.0, dt * rate), 0.0, 0.0, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.fullscreenMaterial = this.lumMat;
    this.enabled = true;
    this.last = performance.now();
    this.base = 1;
  }
  get texture() { return this.adapt[this.idx].texture; }
  render(renderer, inputBuffer) {
    const now = performance.now(), dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    this.fullscreenMaterial = this.lumMat;
    this.lumMat.uniforms.tDiffuse.value = inputBuffer.texture;
    renderer.setRenderTarget(this.lumRT); renderer.render(this.scene, this.camera);
    const src = this.adapt[this.idx], dst = this.adapt[1 - this.idx];
    this.fullscreenMaterial = this.adaptMat;
    const u = this.adaptMat.uniforms; u.tPrev.value = src.texture; u.dt.value = dt; u.base.value = this.base; u.maxE.value = this.maxE ?? 2.4;
    renderer.setRenderTarget(dst); renderer.render(this.scene, this.camera);
    u.reset.value = 0;
    this.idx = 1 - this.idx;
    this.onTexture?.(dst.texture);
  }
  update() { return 1; } // exposure is applied on the GPU (ExposureEffect)
}

export class ExposureEffect extends Effect {
  constructor() {
    super('ExposureEffect', `uniform sampler2D tExposure; uniform float uOn;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float e = uOn > 0.5 ? texture2D(tExposure, vec2(0.5)).r : 1.0;
        outputColor = vec4(inputColor.rgb * clamp(e, 0.5, 3.0), inputColor.a);
      }`, { blendFunction: BlendFunction.NORMAL, uniforms: new Map([['tExposure', new THREE.Uniform(null)], ['uOn', new THREE.Uniform(1)]]) });
  }
}
