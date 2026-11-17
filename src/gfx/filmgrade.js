// Photographic finishing after tone mapping: split toning (cool shadows, warm highlights), a soft highlight
// shoulder roll-off in saturation (bright skies/neons desaturate like film instead of clipping to flat colour),
// mild humidity haze lift in the shadows, and fine luminance-weighted grain. Merged into the main EffectPass.
// The split follows the light: golden hour pushes amber into the highlights and rose into the shadows, night grades
// teal shadows under magenta-tinted lights (the neon-city look) — uGolden / uNight are set every frame.
import * as THREE from 'three';
import { Effect, BlendFunction } from 'postprocessing';

export class FilmGradeEffect extends Effect {
  constructor({ grain = 0.018, split = 1, lift = 0.012 } = {}) {
    super('FilmGradeEffect', /* glsl */`
      uniform float uGrain; uniform float uSplit; uniform float uLift; uniform float uTime; uniform float uNight; uniform float uGolden;
      float fgHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = max(inputColor.rgb, 0.0);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // split tone: teal-ish shadows, warm highlights by day; amber over rose at golden hour; teal under magenta at night
        vec3 shadowTint = mix(mix(vec3(-0.006, 0.002, 0.012), vec3(0.006, -0.004, 0.010), uGolden), vec3(-0.008, 0.004, 0.014), uNight);
        vec3 highTint = mix(mix(vec3(0.020, 0.008, -0.016), vec3(0.040, 0.012, -0.030), uGolden), vec3(0.016, -0.006, 0.010), uNight);
        float mid = smoothstep(0.08, 0.5, l) * (1.0 - smoothstep(0.6, 1.0, l));
        c += uSplit * (shadowTint * (1.0 - smoothstep(0.0, 0.45, l)) + highTint * (smoothstep(0.45, 1.0, l) + mid * 0.5 * max(uGolden, uNight)));
        // highlight shoulder: very bright pixels lose saturation smoothly
        c = mix(c, vec3(l), smoothstep(0.82, 1.15, l) * 0.35);
        // humid air lifts the blacks a touch
        c = c + uLift * (1.0 - c) * (1.0 - smoothstep(0.0, 0.25, l));
        // fine grain in the mid-tones (kept out of deep shadows so night skies stay clean)
        if (uGrain > 0.0) {
          float g = fgHash(uv * vec2(1931.0, 1213.0) + fract(uTime * 7.31) * 113.0) - 0.5;
          g += fgHash(uv * vec2(977.0, 1601.0) + fract(uTime * 3.17) * 71.0) - 0.5;
          float amt = uGrain * (0.7 - 0.25 * uNight) * (0.3 + 0.7 * smoothstep(0.03, 0.35, l) * (1.0 - smoothstep(0.6, 1.0, l)));
          c += g * amt;
        }
        outputColor = vec4(c, inputColor.a);
      }`, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([['uGrain', new THREE.Uniform(grain)], ['uSplit', new THREE.Uniform(split)], ['uLift', new THREE.Uniform(lift)], ['uTime', new THREE.Uniform(0)], ['uNight', new THREE.Uniform(0)], ['uGolden', new THREE.Uniform(0)]]),
    });
    this.grain = grain; // (the quality presets switch uGrain between this and 0)
  }
  update(renderer, inputBuffer, dt) { this.uniforms.get('uTime').value += dt || 0.016; }
}
