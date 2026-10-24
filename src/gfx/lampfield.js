// Night street lighting for everything that isn't the ground: the baked street-lamp map (props.js LightMap, the same
// one roads and pavements use) adds diffuse light to people, cars and low foliage, so a pedestrian under a lamp is lit
// and one between lamps isn't. No extra lights — one texture tap per pixel, only meaningful at night.
import { STREET } from './materials.js';
import { U } from './globals.js';

export const LAMP_PARS = /* glsl */`
uniform sampler2D uLamp; uniform vec2 uLampOrigin; uniform vec2 uLampSize; uniform float uStreetGlow; uniform float uLampNight;
// irradiance-like lamp light at a world point (matches the ground's brightness under the same pool for an upward face)
vec3 lampIrr(vec3 wp, vec3 nW) {
  float e = texture2D(uLamp, (wp.xz - uLampOrigin) / uLampSize).r; e = e * e * 4.0;
  e = e / (1.0 + 0.45 * e);
  // lamp heads are ~9 m up: full light below ~6 m, gone by 12 m; tops catch the most, flanks some, undersides little
  float h = 1.0 - smoothstep(6.0, 12.0, wp.y);
  float facing = 0.45 + 0.4 * max(nW.y, 0.0) + 0.15 * (1.0 - abs(nW.y));
  return vec3(1.0, 0.92, 0.8) * e * h * facing * uLampNight * uStreetGlow;
}
`;

export const lampUniforms = () => ({ uLamp: STREET.lamp, uLampOrigin: STREET.lampOrigin, uLampSize: STREET.lampSize, uStreetGlow: STREET.glow, uLampNight: U.night });

// added after the light maps: diffuse irradiance (x PI x 0.75 = the ground shader's albedo * e * 0.75 radiance)
export const LAMP_APPLY = /* glsl */`
if (uLampNight > 0.02) {
  vec3 lwp = cameraPosition + (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;
  vec3 lnW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  irradiance += PI * 0.75 * lampIrr(lwp, lnW);
}
`;

/** wrap an existing (or empty) onBeforeCompile so a lit material also receives the lamp field */
export function withLampField(mat) {
  // the default program key is onBeforeCompile.toString(): keep keying on the ORIGINAL hook, not this wrapper
  const prev = mat.onBeforeCompile, own = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey');
  const baseKey = own ? mat.customProgramCacheKey.bind(mat) : () => String(prev);
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    Object.assign(sh.uniforms, lampUniforms());
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + LAMP_PARS)
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + LAMP_APPLY);
  };
  mat.customProgramCacheKey = () => baseKey() + '-lamp1';
  return mat;
}
