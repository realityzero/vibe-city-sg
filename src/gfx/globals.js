import * as THREE from 'three';
/** Shared shader uniforms, updated once per frame by the engine. Reference these objects directly in materials. */
export const U = {
  time: { value: 0 },            // seconds since start (animation clock)
  night: { value: 0 },           // 0 = full day, 1 = full night
  rain: { value: 0 },            // rain intensity 0..1
  wet: { value: 0 },             // surface wetness 0..1 (lags rain)
  sunDir: { value: new THREE.Vector3(0, 1, 0) },
  sunColor: { value: new THREE.Color(1, 1, 1) },
  wind: { value: new THREE.Vector2(1, 0.3) },
  fogColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
  fogDensity: { value: 0.00035 },
  cameraPos: { value: new THREE.Vector3() },
  iblDiffuse: { value: 1.0 },   // multiplier on image-based diffuse (patched materials)
  iblSpec: { value: 1.0 },      // multiplier on image-based reflections (patched materials)
  detailDist: { value: 260 },   // facade interior-mapping range (m); 0 during the planar reflection pass
};
