// Shared GLSL snippets.
export const NOISE = /* glsl */`
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm3(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float fbm5(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

// Antialiasing helpers (x continuous, never a fract(): its derivative jumps at the wrap)
// aaPulse: share of the pixel footprint covered by the stripes [k, k + w) of period 1 along x, box-filtered — crisp up
// close, their average where they get thinner than a pixel, so slats, louvres, mullions and grilles never alias into
// moiré. aaBox: the window [lo, hi] of every unit cell in cell space p, filtered the same way along each axis.
export const AA = /* glsl */`
float aaPulse(float x, float w) {
  float f = max(fwidth(x), 1e-4);
  vec2 e = vec2(x - 0.5 * f, x + 0.5 * f);
  vec2 I = floor(e) * w + min(fract(e), w);
  return (I.y - I.x) / f;
}
float aaBox(vec2 cellP, vec2 lo, vec2 hi) { return aaPulse(cellP.x - lo.x, max(hi.x - lo.x, 0.0)) * aaPulse(cellP.y - lo.y, max(hi.y - lo.y, 0.0)); }
float aaStep(float edge, float x) { float w = max(fwidth(x), 1e-4) * 0.75; return smoothstep(edge - w, edge + w, x); }
float aaBand(float x, float lo, float hi) { float w = max(fwidth(x), 1e-4) * 0.75; return smoothstep(lo - w, lo + w, x) * (1.0 - smoothstep(hi - w, hi + w, x)); }
`;
