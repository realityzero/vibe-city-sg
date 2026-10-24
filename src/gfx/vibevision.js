// "Vibe Vision" — a synthwave reality filter (cheat VICEVISION): depth-edge neon outlines, pink/cyan palette remap,
// scanlines and a horizon grid glow. A love letter to the Vice City box art, rendered in real time.
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';
import { Uniform } from 'three';

const frag = /* glsl */`
uniform float uMix;
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float lin(vec2 uv) { return -getViewZ(readDepth(uv)); }
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (uMix <= 0.001) { outputColor = inputColor; return; }
  float z = -getViewZ(depth);
  vec2 t = texelSize * 1.2;
  float zl = lin(uv - vec2(t.x, 0.0)), zr = lin(uv + vec2(t.x, 0.0)), zu = lin(uv + vec2(0.0, t.y)), zd = lin(uv - vec2(0.0, t.y));
  float edge = (abs(zl - z) + abs(zr - z) + abs(zu - z) + abs(zd - z)) / max(z, 1.0);
  edge = smoothstep(0.03, 0.12, edge) * (1.0 - smoothstep(1500.0, 4000.0, z));
  float L = lum(inputColor.rgb);
  // synthwave gradient map: deep indigo -> magenta -> hot pink -> peach
  vec3 c0 = vec3(0.03, 0.01, 0.09), c1 = vec3(0.35, 0.03, 0.45), c2 = vec3(1.0, 0.18, 0.6), c3 = vec3(1.0, 0.75, 0.55);
  float l = clamp(L * 1.6, 0.0, 1.0);
  vec3 grad = l < 0.33 ? mix(c0, c1, l / 0.33) : l < 0.66 ? mix(c1, c2, (l - 0.33) / 0.33) : mix(c2, c3, (l - 0.66) / 0.34);
  // neon edges: cyan near, pink far
  vec3 neon = mix(vec3(0.1, 1.0, 1.0), vec3(1.0, 0.25, 0.85), smoothstep(30.0, 600.0, z)) * 2.4;
  vec3 col = mix(grad, neon, edge);
  // distance haze towards a purple horizon
  col = mix(col, vec3(0.35, 0.08, 0.4), smoothstep(400.0, 3000.0, z) * 0.6);
  // scanlines + slight vignette
  float scan = 0.88 + 0.12 * sin(uv.y * resolution.y * 1.5 + time * 6.0);
  col *= scan;
  outputColor = vec4(mix(inputColor.rgb, col, uMix), inputColor.a);
}`;

export class VibeVisionEffect extends Effect {
  constructor() {
    super('VibeVisionEffect', frag, { attributes: EffectAttribute.DEPTH, blendFunction: BlendFunction.NORMAL, uniforms: new Map([['uMix', new Uniform(0)]]) });
  }
  get mix() { return this.uniforms.get('uMix').value; }
  set mix(v) { this.uniforms.get('uMix').value = v; }
}
