// Procedural PBR materials for the city: facades (with interior mapping), roofs, roads, footways, ground.
import * as THREE from 'three';
import { U } from './globals.js';
import { NOISE, AA } from './shaderlib.js';
import { makeSignAtlas } from './signAtlas.js';
import { makeInteriorAtlas } from './interiorAtlas.js';
import { HF, HF_GLSL } from './heightfield.js';

export const LIT = { office: { value: 0.0 }, resi: { value: 0.0 } };
// planar reflection of the bay, reused (approximately) for wet roads — set by Water
// planar reflection shared by water and wet roads; road = 1 when it was rendered about the street plane (no water on
// screen) so roads project their real height into it, 0 when it mirrors about the water level
export const REFL = { tex: { value: null }, mat: { value: null }, on: { value: 0 }, road: { value: 0 } };

// IBL control: neutralise the blue sky irradiance (fake bounce light) and scale reflections separately
export const IBL_CHUNK = /* glsl */`
#include <lights_fragment_maps>
iblIrradiance = mix(vec3(dot(iblIrradiance, vec3(0.3333))), iblIrradiance, 0.45) * uIblDiffuse;
radiance *= uIblSpec * uIblSpecMat;
`;
// City height field lighting (see heightfield.js): far-field sun shadow beyond the shadow map's box scales the sun,
// street-canyon sky visibility scales sky/ambient light. Works from view-space data, so any patched material gets it.
const HF_EVAL = /* glsl */`
  float hfSun = 1.0, hfSky = 1.0;
  if (uHFOn > 0.5) {
    vec3 hfP = cameraPosition + (vec4(-vViewPosition, 0.0) * viewMatrix).xyz;
    vec3 hfN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    float farW = max(smoothstep(uHFShadowR * 0.7, uHFShadowR * 0.95, length(hfP.xz - uHFShadowC.xz)), hfMapOut());
    if (farW > 0.0) hfSun = mix(1.0, hfSunVis(hfP, hfN, uHFSun), farW);
    // canyon occlusion fades out with distance (haze hides it; saves 18 taps on the far city)
    float hfD = length(hfP - cameraPosition);
    if (hfD < 900.0) hfSky = mix(hfSkyVis(hfP, hfN), 1.0, smoothstep(600.0, 900.0, hfD));
  }
`;
const HF_LIGHTS = THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= hfSun;');
const HF_APPLY = /* glsl */`
  { float sk = mix(0.42, 1.0, hfSky); irradiance *= sk; iblIrradiance *= sk; radiance *= mix(0.7, 1.0, hfSky); }
`;
function patch(mat, { uniforms = {}, vertexHead = '', vertexBody = '', fragHead = '', fragAfterMetal = '', fragAfterNormal = '', fragAfterIbl = '', fragAfterEmissive = '', key, specMul = 1, hf = true }) {
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms, { uIblDiffuse: U.iblDiffuse, uIblSpec: U.iblSpec, uIblSpecMat: { value: specMul } });
    if (hf) Object.assign(shader.uniforms, { uHF: HF.tex, uHFRect: HF.rect, uHFOn: HF.on, uHFShadowC: HF.shadowCenter, uHFShadowR: HF.shadowR, uHFSun: U.sunDir });
    const head = 'uniform float uIblDiffuse; uniform float uIblSpec; uniform float uIblSpecMat;\n' + (hf ? HF_GLSL + 'uniform vec3 uHFSun;\n' : '') + fragHead;
    shader.vertexShader = vertexHead + '\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + vertexBody);
    shader.fragmentShader = head + '\n' + shader.fragmentShader
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + fragAfterMetal)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + (hf ? HF_EVAL : '') + fragAfterNormal)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + fragAfterEmissive)
      .replace('#include <lights_fragment_begin>', hf ? HF_LIGHTS : '#include <lights_fragment_begin>')
      .replace('#include <lights_fragment_maps>', IBL_CHUNK + fragAfterIbl + (hf ? HF_APPLY : ''));
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => key + (hf ? '-hf1' : '');
  return mat;
}

const COMMON_U = () => ({ uTime: U.time, uNight: U.night, uWet: U.wet, uRain: U.rain, uOfficeLit: LIT.office, uResiLit: LIT.resi, uDetailDist: U.detailDist });
const COMMON_HEAD = /* glsl */`
uniform float uTime; uniform float uNight; uniform float uWet; uniform float uRain; uniform float uOfficeLit; uniform float uResiLit; uniform float uDetailDist;
varying vec3 vWPos; varying vec3 vWN;
${NOISE}
${AA}
`;
const COMMON_VHEAD = /* glsl */`varying vec3 vWPos; varying vec3 vWN;`;
const COMMON_VBODY = /* glsl */`vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);`;

// ------------------------------------------------------------------ facades
// shophouse terraces: a long shophouse wall is a row of ~5.5 m units (the five-foot-way piers, signboards and window
// bays follow the same grid), each painted its own pastel; a quarter keep the building's colour
const SHOP_UNITS = /* glsl */`
      vec3 shopPastel(float h) {
        h = floor(h * 12.0);
        if (h < 0.5) return vec3(0.392, 0.687, 0.485);
        if (h < 1.5) return vec3(0.905, 0.468, 0.539);
        if (h < 2.5) return vec3(0.922, 0.768, 0.356);
        if (h < 3.5) return vec3(0.397, 0.672, 0.784);
        if (h < 4.5) return vec3(0.930, 0.558, 0.347);
        if (h < 5.5) return vec3(0.584, 0.468, 0.776);
        if (h < 6.5) return vec3(0.807, 0.392, 0.202);
        if (h < 7.5) return vec3(0.462, 0.745, 0.651);
        if (h < 8.5) return vec3(0.947, 0.665, 0.386);
        if (h < 9.5) return vec3(0.658, 0.745, 0.328);
        if (h < 10.5) return vec3(0.342, 0.558, 0.807);
        return vec3(0.863, 0.440, 0.356);
      }`;
const SHOP_UNIT_SETUP = /* glsl */`
      bool terr = fStyle > 3.5 && fStyle < 4.5 && fFlag < 2.5 && wallLen > 8.0;
      float unitN = max(1.0, floor(wallLen / 5.5 + 0.5)), unitW = wallLen / unitN;
      float unitId = floor(vWall.x / unitW), unitU = vWall.x - unitId * unitW;
      float unitH = hash12(vec2(unitId * 3.1 + 0.7, fSeed * 47.0));
      if (terr && unitH < 0.75) wallCol = shopPastel(fract(unitH * 1.33 + fSeed * 5.0));`;
// cheap variant for the half-res planar water reflection: wall colour, the window grid (filtered to its average where
// windows are sub-pixel) and lit windows at night; no interior mapping, weathering, signs, trims or normal tilt
const FACADE_REFLECTION_FRAG = /* glsl */`
      float fStyle = floor(vF1.x + 0.5);
      float fSeed = vF1.y; float fh = vF1.z; float fBase = vF1.w;
      float wallLen = vF2.x; float fTop = vF2.y;
      float fFlag = mod(floor(vF2.w / 16.0 + 0.01), 8.0);
      vec3 wallCol = diffuseColor.rgb;
${SHOP_UNIT_SETUP}
      vec3 albedo = wallCol;
      float fRough = 0.86, fMetal = 0.0;
      vec3 fEmis = vec3(0.0);
      if (fStyle < 11.5) {
        float colW = 0.0; vec2 lo = vec2(0.2, 0.3), hi = vec2(0.8, 0.8);
        if (fStyle < 0.5) { colW = 1.6; lo = vec2(0.03, 0.11); hi = vec2(0.97, 0.985); albedo = mix(albedo * 0.55, vec3(0.32), 0.35); fMetal = 0.6; fRough = 0.35; }
        else if (fStyle < 1.5) { colW = 2.8; lo = vec2(0.05, 0.30); hi = vec2(0.95, 0.88); }
        else if (fStyle < 2.5) { colW = 2.7; lo = vec2(0.14, 0.22); hi = vec2(0.86, 0.84); }
        else if (fStyle < 3.5) { colW = fFlag > 4.5 ? 0.0 : 3.0; lo = vec2(0.22, 0.34); hi = vec2(0.78, 0.80); }
        else if (fStyle < 4.5) { colW = 2.5; lo = vec2(0.22, 0.14); hi = vec2(0.78, 0.84); }
        else if (fStyle < 5.5) { colW = 3.0; lo = vec2(0.18, 0.30); hi = vec2(0.82, 0.82); }
        else if (fStyle < 6.5) { colW = 3.4; lo = vec2(0.3, 0.18); hi = vec2(0.7, 0.82); }
        else if (fStyle < 7.5) { colW = 6.0; lo = vec2(0.07, 0.36); hi = vec2(0.93, 0.94); }
        else if (fStyle > 8.5 && fStyle < 9.5) { colW = 7.0; lo = vec2(0.3, 0.72); hi = vec2(0.7, 0.9); }
        else if (fStyle > 9.5 && fStyle < 10.5) { colW = 2.0; lo = vec2(0.03, 0.05); hi = vec2(0.97, 0.95); }
        if (colW > 0.0 && fh > 0.5) {
          float nCols = max(1.0, floor(wallLen / colW + 0.5)), cw = wallLen / nCols;
          vec2 cell = vec2(vWall.x / cw, (vWall.y - fBase) / fh), cid = floor(cell);
          float nFloors = max(1.0, floor((fTop - fBase) / fh + 0.01));
          vec2 fw = fwidth(cell);
          float win = mix(aaBox(cell, lo, hi), (hi.x - lo.x) * (hi.y - lo.y), smoothstep(0.2, 0.6, max(fw.x, fw.y)));
          win *= step(0.0, cell.y) * step(cell.y, nFloors - 0.02);
          bool resi = fStyle > 1.5 && fStyle < 4.5;
          float litFrac = resi ? uResiLit : uOfficeLit;
          litFrac = clamp(litFrac * (resi ? mix(0.7, 1.3, fract(fSeed * 23.7)) : mix(0.3, 1.75, fract(fSeed * 41.3))), 0.0, 1.0);
          float lit = step(hash13(vec3(cid.yx + 17.0, fSeed * 31.0)), litFrac);
          vec3 lampCol = resi ? vec3(1.0, 0.7, 0.42) : vec3(0.85, 0.9, 1.0);
          vec3 gAlb = fStyle < 0.5 ? mix(vec3(0.03), wallCol * 1.1, 0.75) : vec3(0.02, 0.025, 0.03);
          albedo = mix(albedo, gAlb, win);
          fMetal = mix(fMetal, fStyle < 0.5 ? 0.35 : 0.06, win); fRough = mix(fRough, 0.06, win);
          fEmis += (lampCol * lit * (resi ? 0.3 : 0.2) + 0.03 * (1.0 - uNight)) * win;
        }
      }
      fRough = mix(fRough, fRough * 0.5, uWet);
      diffuseColor.rgb = albedo;
      roughnessFactor = fRough;
      metalnessFactor = fMetal;
`;

// facade parameter records (8 floats each: aF1 then aF2, see the city builder's WALL_LAYOUT), 2 RGBA32F texels per
// record in rows of FACADE_REC_W texels; set by City once the builder is done
export const FACADE_REC = { value: null };
export const FACADE_REC_W = 2048;
const FACADE_VHEAD = /* glsl */`
      attribute vec2 aWall; attribute float aRec; uniform highp sampler2D uRec;
      varying vec2 vWall; varying vec4 vF1; varying vec4 vF2;`;
const FACADE_VBODY = /* glsl */`vWall = aWall;
      { int r = int(aRec + 0.5) * 2; ivec2 t = ivec2(r % ${FACADE_REC_W}, r / ${FACADE_REC_W}); vF1 = texelFetch(uRec, t, 0); vF2 = texelFetch(uRec, t + ivec2(1, 0), 0); }`;
export function createFacadeMaterial({ reflection = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 });
  if (reflection) return patch(mat, {
    key: 'facade-refl-v3', specMul: 1.35, hf: false,
    uniforms: { ...COMMON_U(), uRec: FACADE_REC },
    vertexHead: COMMON_VHEAD + FACADE_VHEAD,
    vertexBody: COMMON_VBODY + FACADE_VBODY,
    fragHead: COMMON_HEAD + `varying vec2 vWall; varying vec4 vF1; varying vec4 vF2;` + SHOP_UNITS,
    fragAfterMetal: FACADE_REFLECTION_FRAG,
    fragAfterEmissive: `totalEmissiveRadiance += fEmis;`,
  });
  return patch(mat, {
    key: 'facade-v4', specMul: 1.35,
    uniforms: { ...COMMON_U(), uSigns: { value: makeSignAtlas() }, uInterior: { value: makeInteriorAtlas() }, uSunDirF: U.sunDir, uRec: FACADE_REC,
      uLamp: STREET.lamp, uLampOrigin: STREET.lampOrigin, uLampSize: STREET.lampSize, uStreetGlow: STREET.glow },
    vertexHead: COMMON_VHEAD + FACADE_VHEAD,
    vertexBody: COMMON_VBODY + FACADE_VBODY,
    fragHead: COMMON_HEAD + SHOP_UNITS + /* glsl */`
      varying vec2 vWall; varying vec4 vF1; varying vec4 vF2;
      uniform sampler2D uSigns; uniform sampler2D uInterior; uniform vec3 uSunDirF;
      uniform sampler2D uLamp; uniform vec2 uLampOrigin; uniform vec2 uLampSize; uniform float uStreetGlow;
      // local clock time from the sun vector (inverse of sky.js sunDirection: late-October declination, lat 1.29 N)
      float localHour() {
        const float sD = -0.19937, cD = 0.97992, sL = 0.022512, cL = 0.99975;
        float H = atan(-uSunDirF.x / cD, (uSunDirF.y - sD * sL) / (cD * cL));
        return mod(13.08 + H * 3.819719, 24.0);
      }
      // share of shops trading at this hour: shutters go up 07:00-09:30 (kopitiams and bakeries from ~06:00), most
      // trade until ~21:00, the late ones until ~23:00, nearly all shut overnight
      float shopOpenFrac(float hr, float early) {
        float o = smoothstep(6.4 - early, 9.4 - early * 1.6, hr) * (1.0 - smoothstep(20.3 + early * 0.9, 22.9 + early * 0.6, hr));
        return mix(0.025, 0.95, o);
      }
      // interior atlas (interiorAtlas.js): 8 back-wall scenes in 4 x 2 cells over the top 80% of the texture
      vec3 interiorCell(float i, vec2 lc, vec2 gx, vec2 gy) {
        lc = clamp(lc, vec2(0.015), vec2(0.985));
        vec2 uv = vec2((mod(i, 4.0) + lc.x) * 0.25, 1.0 - (floor(i / 4.0) + 1.0 - lc.y) * 0.4);
        return textureGrad(uInterior, uv, gx * vec2(0.25, 0.4), gy * vec2(0.25, 0.4)).rgb;
      }
      vec3 hdbAccent(float i) {
        i = mod(i, 8.0);
        if (i < 0.5) return vec3(0.69, 0.10, 0.08);
        if (i < 1.5) return vec3(0.05, 0.25, 0.58);
        if (i < 2.5) return vec3(0.10, 0.48, 0.10);
        if (i < 3.5) return vec3(0.87, 0.42, 0.06);
        if (i < 4.5) return vec3(0.27, 0.15, 0.47);
        if (i < 5.5) return vec3(0.02, 0.45, 0.38);
        if (i < 6.5) return vec3(0.76, 0.20, 0.05);
        return vec3(0.59, 0.07, 0.20);
      }
      vec3 shutterCol(float h) {
        if (h < 0.25) return vec3(0.05, 0.22, 0.12);
        if (h < 0.5) return vec3(0.04, 0.13, 0.28);
        if (h < 0.75) return vec3(0.22, 0.10, 0.04);
        return vec3(0.55, 0.52, 0.45);
      }
      // one signboard from the atlas (60 boards, 4 x 15) with trilinear-safe gradients
      vec4 signBoard(float idx, vec2 bp, vec2 gx, vec2 gy) {
        vec2 o = vec2(mod(idx, 4.0), floor(idx / 4.0));
        return textureGrad(uSigns, (o + vec2(bp.x, 1.0 - bp.y)) / vec2(4.0, 16.0), gx / vec2(4.0, 16.0), gy / vec2(4.0, 16.0));
      }`,
    fragAfterMetal: /* glsl */`
      float fStyle = floor(vF1.x + 0.5);
      float fSeed = vF1.y; float fh = vF1.z; float fBase = vF1.w;
      float wallLen = vF2.x; float fTop = vF2.y;
      float fAccent = mod(vF2.w, 16.0), fFlag = mod(floor(vF2.w / 16.0 + 0.01), 8.0);
      // building use (tools/building-uses.mjs): 0 unknown, 1 retail, 2 health, 3 edu, 4 civic, 5 religious, 6 resi, 7 office, 8 hotel, 9 industrial, 10 parking
      float fUse = floor(vF2.w / 128.0 + 0.001);
      // only shops (and unknowns) get shopfronts and signboards; a shophouse tagged residential still trades downstairs
      bool shopUse = fUse < 1.5 || (fStyle > 3.5 && fStyle < 4.5 && fUse > 5.5 && fUse < 6.5);
      float fy0 = vWall.y - fBase;
      vec3 wallCol = diffuseColor.rgb;
${SHOP_UNIT_SETUP}
      vec3 albedo = wallCol;
      float fRough = 0.86, fMetal = 0.0;
      vec3 fEmis = vec3(0.0);
      vec3 fNTilt = vec3(0.0);
      float fSpecOcc = 1.0, fAmbOcc = 1.0;   // covered five-foot-ways / void decks see little sky
      float camDist = length(vWPos - cameraPosition);
      vec3 N = normalize(vWN);
      bool horiz = abs(N.y) > 0.7;
      float wallId = horiz ? 0.0 : floor(atan(N.z, N.x) * 2.0 + 10.0);
      bool special = fStyle > 11.5; // arcade soffit / columns / five-foot-way floor
      if (special || fFlag > 1.5 && fFlag < 3.5 || fFlag > 5.5) { fSpecOcc = 0.2; fAmbOcc = fStyle > 12.5 && fStyle < 13.5 ? 0.8 : 0.55; }
      // shophouse fronts and their piers at night: the light of the shop in this unit (open by the shop clock) spills
      // out of the five-foot-way and up the wall (fragAfterEmissive) — warm bulbs, or a provision shop's cool tubes
      vec3 fSpill = vec3(0.0);
      if (uNight > 0.02 && shopUse && fFlag < 2.5 && (fStyle > 3.5 && fStyle < 4.5 || fStyle > 12.5 && fStyle < 13.5)) {
        vec2 uh = vec2(unitId * 2.9 + wallId, fSeed * 17.0);
        fSpill = (hash12(uh + 5.1) < 0.65 ? vec3(1.0, 0.72, 0.45) : vec3(0.78, 0.9, 1.0)) * step(hash12(uh), shopOpenFrac(localHour(), 0.0)) * 0.2;
      }

      if (!special) {
        // weathering: large scale tone, rain streaks, base dirt, tropical mould creeping up from the ground
        float big = vnoise(vWPos.xz * 0.013 + vWPos.y * 0.004 + fSeed * 7.0);
        float streak = vnoise(vec2(vWall.x * 0.9 + wallId * 13.0, vWall.y * 0.022 + fSeed * 10.0));
        float grime = smoothstep(0.5, 0.95, streak) * (fStyle < 0.5 ? 0.06 : 0.22);
        albedo *= (0.9 + big * 0.2) * (1.0 - grime);
        albedo *= mix(0.7, 1.0, smoothstep(-0.2, 1.4, vWall.y));
        float mould = (1.0 - smoothstep(0.0, 1.2 + 1.6 * vnoise(vec2(vWall.x * 0.6 + wallId * 7.0, fSeed * 5.0)), vWPos.y)) * step(0.5, fStyle);
        albedo = mix(albedo, albedo * vec3(0.6, 0.66, 0.55), mould * 0.55);
        albedo *= 1.0 - uWet * 0.28;
      } else if (fStyle < 12.5) {
        // ---- arcade / void-deck ceiling: plaster with lamps (warm bulbs for shophouses, tubes for HDB and hawker centres)
        bool hdbS = fFlag > 2.5;
        float sp = hdbS ? 6.5 : 5.2;
        albedo = mix(wallCol, vec3(0.86, 0.85, 0.8), 0.6) * (0.85 + 0.15 * vnoise(vWall * 0.7));
        vec2 lq = vec2((fract(vWall.x / sp) - 0.5) * sp, vWall.y - (hdbS ? 1.05 : 0.95));
        float lampM = hdbS ? (1.0 - smoothstep(0.55, 0.62, abs(lq.x))) * (1.0 - smoothstep(0.035, 0.06, abs(lq.y)))
                           : 1.0 - smoothstep(0.09, 0.14, length(lq));
        vec3 lc = hdbS ? vec3(0.85, 0.95, 1.0) : vec3(1.0, 0.7, 0.38);
        fEmis += lc * lampM * (0.25 + uNight * 7.0);
        fEmis += lc * albedo * exp(-dot(lq, lq) * 0.9) * uNight * 0.45;
        fRough = 0.92;
      } else if (fStyle < 13.5) {
        // ---- columns: shophouse piers wear a Peranakan tile dado, HDB / hawker-centre pillars a painted base band
        bool hdbP = fFlag > 2.5;
        float y = vWall.y;
        albedo = wallCol * (0.9 + 0.12 * vnoise(vec2(vWall.x * 2.0, y * 1.5) + fSeed));
        if (!hdbP && y < 1.2) {
          vec2 tq = vec2(vWall.x, y + 0.02) / 0.15;
          vec2 tid = floor(tq), tf = fract(tq);
          float pal = hash12(vec2(fSeed * 3.0, 1.0));
          vec3 base = mix(vec3(0.62, 0.78, 0.72), vec3(0.86, 0.62, 0.58), step(0.5, pal));
          float r = length(tf - 0.5);
          float petal = smoothstep(0.36, 0.3, r) * (0.5 + 0.5 * cos(atan(tf.y - 0.5, tf.x - 0.5) * 4.0));
          vec3 tc = mix(vec3(0.93, 0.91, 0.85), base, smoothstep(0.5, 0.42, r) * 0.7);
          tc = mix(tc, mix(vec3(0.72, 0.18, 0.25), vec3(0.15, 0.38, 0.58), step(0.5, hash12(tid + pal * 9.0))), petal * 0.85);
          float grout = 1.0 - aaBand(tf.x, 0.04, 0.96) * aaBand(tf.y, 0.04, 0.96);
          albedo = mix(tc, vec3(0.6), grout * 0.6);
          if (y > 1.1) albedo = vec3(0.8, 0.78, 0.72);
          fRough = 0.32;
        } else if (hdbP && y < 1.05) albedo = mix(albedo, hdbAccent(fAccent) * 0.85, 0.9);
        albedo *= mix(0.65, 1.0, smoothstep(-0.2, 0.8, y));
      } else {
        // ---- five-foot-way / void-deck floor: patterned cement tiles, terrazzo for HDB
        vec2 tq = vWall / (fFlag > 2.5 ? 0.4 : 0.22); vec2 tid = floor(tq), tf = fract(tq);
        float chk = mod(tid.x + tid.y, 2.0);
        albedo = fFlag > 2.5 ? wallCol * (0.9 + 0.15 * hash12(tid)) : mix(wallCol, wallCol * vec3(0.55, 0.42, 0.36), chk);
        if (fFlag < 2.5) { float m = smoothstep(0.3, 0.22, length(tf - 0.5)); albedo = mix(albedo, vec3(0.75, 0.72, 0.62), m * 0.5); }
        float grout = 1.0 - aaBand(tf.x, 0.03, 0.97) * aaBand(tf.y, 0.03, 0.97);
        albedo = mix(albedo, albedo * 0.55, grout);
        albedo *= 0.8 + 0.3 * vnoise(vWall * 0.8 + fSeed * 9.0);
        fRough = mix(0.55, 0.2, uWet);
      }

      bool shop = fStyle > 3.5 && fStyle < 4.5;
      bool hdb = fStyle > 2.5 && fStyle < 3.5;
      float glassType = fract(fSeed * 3.17);
      float colW = 0.0; vec2 wLo = vec2(0.2, 0.3), wHi = vec2(0.8, 0.8);
      if (special) { colW = 0.0; }
      else if (fStyle < 0.5) { colW = 1.4 + fSeed * 0.6; wLo = vec2(0.03, 0.11); wHi = vec2(0.97, 0.985);
        if (glassType > 0.45 && glassType < 0.72) { wLo = vec2(0.02, 0.38); wHi = vec2(0.98, 0.97); } }
      else if (fStyle < 1.5) { colW = 2.6 + fSeed * 0.8; wLo = vec2(0.05, 0.30); wHi = vec2(0.95, 0.88); }
      else if (fStyle < 2.5) { colW = 2.7; wLo = vec2(0.14, 0.22); wHi = vec2(0.86, 0.84); }
      else if (fStyle < 3.5) { colW = fFlag > 4.5 ? 0.0 : 3.0; wLo = vec2(0.22, 0.34); wHi = vec2(0.78, 0.80); }
      else if (fStyle < 4.5) { colW = 2.5; wLo = vec2(0.22, 0.14); wHi = vec2(0.78, 0.84); }
      else if (fStyle < 5.5) { colW = 3.0; wLo = vec2(0.18, 0.30); wHi = vec2(0.82, 0.82); }
      else if (fStyle < 6.5) { colW = 3.4; wLo = vec2(0.3, 0.18); wHi = vec2(0.7, 0.82); }
      else if (fStyle < 7.5) { colW = 6.0; wLo = vec2(0.07, 0.36); wHi = vec2(0.93, 0.94); }
      else if (fStyle < 8.5) { colW = 0.0; }
      else if (fStyle < 9.5) { colW = 7.0; wLo = vec2(0.3, 0.72); wHi = vec2(0.7, 0.9); }
      else if (fStyle < 10.5) { colW = 2.0; wLo = vec2(0.03, 0.05); wHi = vec2(0.97, 0.95); }

      if (fStyle > 8.5 && fStyle < 9.5) albedo *= 0.88 + 0.12 * aaPulse(vWall.x * 3.0 + 0.5, 0.5); // corrugated cladding

      // ---- HDB end walls: blank, two accent pinstripes and the painted block number near the top
      if (hdb && fFlag > 4.5) {
        float ex = min(vWall.x, wallLen - vWall.x);
        albedo = mix(albedo, hdbAccent(fAccent), aaBand(ex, 0.9, 1.25) * step(fBase + fh, vWall.y) * 0.85);
        float num = floor(1.0 + hash12(vec2(fSeed * 91.0, 3.0)) * 698.0);
        float nd = num < 9.5 ? 1.0 : (num < 99.5 ? 2.0 : 3.0);
        float dH = clamp(wallLen * 0.2, 2.4, 4.2), dW = dH * 0.6;
        float lx = ((wallLen - vWall.x) - (wallLen - nd * dW) * 0.5) / dW, ly = (vWall.y - (fTop - 1.4 - dH)) / dH;
        if (lx >= 0.0 && lx < nd && ly >= 0.0 && ly < 1.0) {
          float di = floor(lx);
          float dig = mod(floor(num / pow(10.0, nd - 1.0 - di) + 1e-3), 10.0);
          // sample the inner 86% of the glyph cell so mips never bleed in the neighbouring cells / board row
          vec2 g = vec2(lx, -ly) * 0.86 / vec2(10.0, 16.0);
          float a = textureGrad(uSigns, vec2((dig + 0.07 + fract(lx) * 0.86) / 10.0, (15.07 + (1.0 - ly) * 0.86) / 16.0), dFdx(g), dFdy(g)).a;
          albedo = mix(albedo, hdbAccent(fAccent) * 0.55, a);
        }
      }

      if (colW > 0.0 && fh > 0.5) {
        float nCols = max(1.0, floor(wallLen / colW + 0.5));
        float cw = wallLen / nCols;
        vec2 cell = vec2(vWall.x / cw, fy0 / fh);
        // terrace units: two or three window bays each (cell ids stay unique per unit)
        if (terr) { cw = unitW / (2.0 + step(0.6, hash12(vec2(unitId * 1.9, fSeed * 23.0)))); cell.x = unitId * 4.0 + unitU / cw; }
        vec2 cid = floor(cell);
        vec2 cf = fract(cell);
        float nFloors = max(1.0, floor((fTop - fBase) / fh + 0.01));
        bool ground = cid.y < 0.5 && fBase < 1.0;
        bool shopFront = shop && shopUse && fFlag > 0.5 && fFlag < 1.5;     // facade above the five-foot-way
        bool shopRecess = shop && shopUse && (fFlag > 1.5 && fFlag < 2.5 || fFlag > 5.5);   // shopfront behind the arcade (6: hawker stall)
        // glazed double-height lobby: offices, hotels, hospitals, condos, civic towers (and unknown towers over 60 m)
        bool lobby = ground && fStyle < 2.5 && fFlag < 0.5 && ((fUse > 1.5 && fUse < 8.5 && fUse != 3.0 && fUse != 5.0) || (fUse < 0.5 && fStyle < 1.5 && fTop >= 60.0));
        bool hdbCorr = hdb && fFlag > 3.5 && fFlag < 4.5;
        bool hdbVoid = hdb && fFlag > 2.5 && fFlag < 3.5;
        // ground-floor shops trade by the clock: per-unit hours, ~6% vacant units, a family of goods per unit
        bool shopG = ground && shop && shopUse;
        float famH = hash12(vec2(cid.x * 3.7 + wallId * 1.9, fSeed * 53.0));
        float shopFam = famH < 0.24 ? 0.0 : famH < 0.42 ? 1.0 : famH < 0.52 ? 4.0 : famH < 0.64 ? 5.0 : famH < 0.8 ? 6.0 : 7.0;
        if (fFlag > 5.5) shopFam = famH < 0.65 ? 1.0 : famH < 0.85 ? 5.0 : 0.0;   // hawker stalls: food and drinks
        bool shopOpen = false, glassFront = shopFam > 3.5 && shopFam != 6.0; // goldsmith, bakery, pharmacy: air-conditioned
        if (shopG) {
          float early = shopFam == 1.0 || shopFam == 5.0 ? 1.0 : 0.0;
          bool vacant = hash12(vec2(cid.x * 5.1 + wallId, fSeed * 71.0)) < 0.04;
          shopOpen = !vacant && hash12(vec2(cid.x * 2.3 + wallId * 7.0, fSeed * 13.0)) < shopOpenFrac(localHour(), early);
        }
        bool healthLobby = false;
        vec2 lo = wLo, hi = wHi;
        if (ground) {
          if (lobby) { lo = vec2(0.015, 0.0); hi = vec2(0.985, 0.9); healthLobby = fUse > 1.5 && fUse < 2.5 && wallLen > 14.0; if (healthLobby) hi.y = 0.7; }
          else if (shopRecess) { lo = vec2(0.05, 0.0); hi = vec2(0.95, 0.76); }
          else if (hdb) { lo = vec2(0.1, 0.0); hi = vec2(0.9, 0.93); }
          else if (shop) { lo = vec2(0.07, 0.0); hi = vec2(0.93, 0.8); }
          else if (fStyle < 6.5) { lo = vec2(0.04, 0.02); hi = vec2(0.96, 0.9); }
        }
        if (shopFront && cid.y > 0.5 && cid.y < 1.5) lo.y = 0.4;   // first floor windows sit above the signboard
        if (hdbCorr) { lo = vec2(0.52, 0.5); hi = vec2(0.9, 0.84); }
        // condos: bays of balconies (floor-to-ceiling glazing behind a glass balustrade) between punched windows
        bool condo = fStyle > 1.5 && fStyle < 2.5 && !ground;
        bool balc = condo && fract(fSeed * 5.1) < 0.8 && mod(cid.x + floor(fract(fSeed * 3.3) * 4.0), 3.0 + step(0.5, fract(fSeed * 13.1))) < 1.0 + step(0.45, fract(fSeed * 7.7));
        if (balc) { lo = vec2(0.03, 0.07); hi = vec2(0.97, 0.97); }
        float win = aaBox(cell, lo, hi);
        if (cell.y > nFloors - 0.02 || cell.y < 0.0) win = 0.0;
        if (hdbVoid) win *= step(hash12(vec2(cid.x, fSeed * 13.0)), 0.3); // a few open passages through the void deck
        // arched openings (civic windows, shophouse fronts that face no street)
        if ((fStyle > 5.5 && fStyle < 6.5) || (ground && shop && !shopRecess) || (terr && !ground && unitH > 0.62 && cid.y < nFloors - 0.5)) {
          float archY = mix(lo.y, hi.y, 0.72);
          vec2 q = vec2((cf.x - 0.5) * cw, (cf.y - archY) * fh);
          float r = (hi.x - lo.x) * 0.5 * cw;
          float inArch = 1.0 - smoothstep(r - 0.05, r + 0.05, length(q));
          if (cf.y > archY) win *= inArch;
        }
        vec2 fw = vec2(fwidth(vWall.x) / cw, fwidth(cell.y));   // (cell.x jumps between terrace units)
        float far = smoothstep(0.2, 0.6, max(fw.x, fw.y));
        float farLit = smoothstep(0.3, 1.1, max(fw.x, fw.y));
        float cover = (hi.x - lo.x) * (hi.y - lo.y);
        win = mix(win, cover * step(cell.y, nFloors) * step(0.0, cell.y), far);

        float h = hash13(vec3(cid, fSeed * 97.0 + wallId));
        float h2 = hash13(vec3(cid.yx + 17.0, fSeed * 31.0 + wallId * 3.0));
        bool resi = fStyle > 1.5 && fStyle < 4.5;
        float litFrac = resi ? uResiLit : uOfficeLit;
        // occupancy differs per building: one tower still glowing at 23:00, its neighbour nearly dark
        litFrac = clamp(litFrac * (resi ? mix(0.7, 1.3, fract(fSeed * 23.7)) : mix(0.3, 1.75, fract(fSeed * 41.3))), 0.0, 1.0);
        if (ground) litFrac = max(litFrac, 0.6 * uNight);
        // offices light whole open-plan floor zones (a few stray desks on dark floors); homes window by window
        float zone = floor(cid.x / 5.0);
        float hf = hash12(vec2(cid.y * 1.37 + zone * 17.3, fSeed * 61.0 + wallId));
        bool floorOn = hf < litFrac * 1.08;
        // (stray desks on dark floors only after dusk: lit against a sunlit tower they read as specks of noise)
        bool lit = resi || ground ? h2 < litFrac : (floorOn ? h2 < 0.9 : h2 < 0.04 * uNight);

        // ---- non-window wall details per style
        if (fStyle < 0.5) {
          // curtain wall: frame + spandrel tinted metal; ribbon glazing has solid spandrel panels; some towers have fins
          albedo = mix(albedo * 0.55, vec3(0.32), 0.35);
          fMetal = 0.6; fRough = 0.35;
          if (glassType > 0.72) {
            float fin = aaPulse(cell.x, 0.13);
            albedo = mix(albedo, mix(vec3(0.62, 0.64, 0.66), wallCol * 1.3, 0.3), fin);
            fMetal = mix(fMetal, 0.85, fin); fRough = mix(fRough, 0.28, fin);
            win *= 1.0 - fin;
          }
        } else if (hdb) {
          vec3 acc = hdbAccent(fAccent);
          // two-tone repaint scheme: a pastel of the block's accent colour over one or two of every few bays, full height
          float per = 3.0 + floor(fract(fSeed * 11.0) * 3.0);
          float tone = step(mod(cid.x + floor(fract(fSeed * 19.0) * per), per), 0.5 + step(0.5, fract(fSeed * 29.0))) * step(1.0, cell.y);
          vec3 pastel = mix(albedo, acc * 1.15 + 0.08, 0.4);
          if (ground) {
            // void deck back wall: tiled dado, lift doors, letterboxes
            albedo = mix(albedo * 0.9, vec3(0.8, 0.8, 0.76), aaBand(vWall.y, -1.0, 1.15) * 0.8);
            float lift = aaBand(cf.x, 0.38, 0.62) * (1.0 - aaStep(0.72, cf.y)) * step(0.6, hash12(vec2(cid.x * 3.1, fSeed)));
            albedo = mix(albedo, vec3(0.55, 0.57, 0.6) * (0.9 + 0.1 * aaPulse(cell.x / 0.12 + 0.5, 0.5)), lift);
            fMetal = mix(fMetal, 0.7, lift); fRough = mix(fRough, 0.3, lift);
          } else if (hdbCorr) {
            // common corridor: parapet wall with an accent coping, dark corridor behind, doors and gates
            float par = 1.0 - aaStep(0.42, cf.y);
            float corr = (1.0 - par) * (1.0 - aaStep(0.97, cf.y));
            albedo = mix(albedo, pastel, tone * par);
            albedo = mix(albedo, acc, aaBand(cf.y, 0.37, 0.42) * 0.9);
            vec3 back = wallCol * 0.42;
            float door = aaBand(cf.x, 0.1, 0.36) * aaBand(cf.y, 0.42, 0.9);
            float gate = aaPulse(vWall.x * 9.0 + 0.5, 0.5) * door;
            back = mix(back, vec3(0.28, 0.17, 0.1), door);
            back = mix(back, vec3(0.12), gate * 0.6);
            albedo = mix(albedo, back * (0.6 + 0.4 * smoothstep(0.97, 0.6, cf.y)), corr);
            vec2 lq = vec2((cf.x - 0.62) * cw, (cf.y - 0.93) * fh);
            fEmis += vec3(0.85, 0.95, 1.0) * (1.0 - smoothstep(0.25, 0.32, abs(lq.x))) * (1.0 - smoothstep(0.03, 0.05, abs(lq.y))) * (0.2 + uNight * 3.0) * corr * (1.0 - far);
            fEmis += vec3(0.6, 0.65, 0.7) * uNight * 0.08 * corr;
          } else {
            // AC ledges / planter bands at every floor, stair core with breeze blocks
            albedo = mix(albedo, pastel, tone);
            float ledge = 1.0 - aaStep(0.09, cf.y);
            albedo = mix(albedo, albedo * 1.08, ledge);
            albedo *= 1.0 - 0.28 * aaBand(cf.y, 0.09, 0.16) * (1.0 - far);
            float core = step(abs(cid.x - floor(nCols * (0.3 + 0.4 * fract(fSeed * 7.0)))), 0.5) * step(22.0, wallLen) * step(0.5, cell.y);
            if (core > 0.5) {
              // stair core: accent panel with a column of breeze-block vents
              vec2 bq = fract(vec2(cf.x * cw, cf.y * fh) / 0.3);
              float hole = aaBand(bq.x, 0.25, 0.75) * aaBand(bq.y, 0.25, 0.75) * aaBand(cf.x, 0.3, 0.7) * aaBand(cf.y, 0.25, 0.85) * (1.0 - far);
              albedo = mix(mix(albedo, acc, 0.55), albedo * 0.25, hole * 0.8);
              win = 0.0;
            }
            if (cell.y > nFloors - 1.0) albedo = mix(albedo, acc, 0.85);
            // outdoor aircon condensers on the ledge under most windows (0.85 x 0.6 m, fan grille, drip stain)
            float acH = hash12(vec2(cid.x * 7.3 + wallId, cid.y * 3.1 + fSeed * 17.0));
            if (acH < 0.6 && core < 0.5 && far < 0.9 && cell.y < nFloors - 1.0) {
              vec2 am = vec2((cf.x - 0.3 - 0.25 * fract(acH * 7.0)) * cw, (cf.y - 0.1) * fh);
              if (am.x > 0.0 && am.x < 0.85 && am.y > 0.0 && am.y < 0.6) {
                float rr = length(am - vec2(0.32, 0.3));
                float fan = 1.0 - smoothstep(0.19, 0.22, rr);
                float grille = 0.55 + 0.45 * step(0.5, fract(rr * 28.0));
                vec3 unitC = vec3(0.8, 0.8, 0.77) * (0.92 + 0.1 * acH);
                unitC = mix(unitC, vec3(0.22) * grille, fan * 0.85);
                unitC *= 1.0 - 0.35 * aaBand(am.x, 0.66, 0.7);       // side vents
                albedo = mix(albedo, unitC, 1.0 - far);
                fRough = mix(fRough, 0.5, 1.0 - far);
              } else if (am.x > 0.05 && am.x < 0.8 && am.y < 0.0 && am.y > -0.9) {
                albedo *= 1.0 - 0.18 * (1.0 + am.y / 0.9) * (1.0 - far);   // grime streak under the unit
              }
            }
          }
        } else if (shop) {
          // pilasters at the party walls, moulded cornice at every floor, ventilation grilles over the windows
          float ex = terr ? min(unitU, unitW - unitU) : min(vWall.x, wallLen - vWall.x);
          float pil = (1.0 - aaStep(0.38, ex)) * step(0.5, cell.y);
          float pil2 = mod(cid.x, 2.0) < 0.5 && !shopFront && !terr ? (1.0 - aaStep(0.09, cf.x)) * step(0.5, cell.y) : 0.0;
          vec3 trim = mix(vec3(0.9, 0.88, 0.82), wallCol * 1.15, 0.25);
          albedo = mix(albedo, trim, max(pil, pil2 * 0.75));
          albedo *= 1.0 - 0.25 * aaBand(ex, 0.38, 0.46) * step(0.5, cell.y);          // pilaster side shadow
          // capitals: the pilaster steps out under each floor's cornice
          float capM = (1.0 - aaStep(0.52, ex)) * step(0.5, cell.y) * (1.0 - far);
          albedo = mix(albedo, trim * 1.05, aaBand(cf.y, 0.88, 0.95) * capM);
          albedo *= 1.0 - 0.3 * aaBand(cf.y, 0.86, 0.88) * capM;
          if (!ground) {
            float corn = 1.0 - aaStep(0.07, cf.y);
            albedo = mix(albedo, trim, corn * 0.85);
            albedo *= 1.0 - 0.3 * aaBand(cf.y, 0.07, 0.11) * (1.0 - far);
            float vent = aaBand(cf.x, lo.x + 0.04, hi.x - 0.04) * aaBand(cf.y, hi.y + 0.03, hi.y + 0.1);
            if (terr && unitH > 0.3 && unitH <= 0.62) {
              // glazed fanlight over the shutters: dark glass in a painted frame, three glazing bars
              float bars = max(aaPulse((cf.x - lo.x) / (hi.x - lo.x) * 4.0, 0.12), 1.0 - aaBand(cf.y, hi.y + 0.045, hi.y + 0.085));
              albedo = mix(albedo, mix(vec3(0.04, 0.05, 0.055), trim, bars), vent * (1.0 - far));
              fRough = mix(fRough, 0.15, vent * (1.0 - bars) * (1.0 - far));
            } else albedo = mix(albedo, albedo * (0.55 + 0.45 * aaPulse(vWall.x * 12.0 + 0.5, 0.5)), vent * (1.0 - far));
          }
          float cornice = (cell.y > nFloors - 0.18) ? 1.0 : 0.0;
          albedo = mix(albedo, trim, cornice * 0.8);
          albedo *= 1.0 - 0.35 * aaBand(cell.y, nFloors - 0.2, nFloors - 0.17);
          if (!ground) albedo *= 1.0 - 0.25 * aaBand(cf.y, hi.y, hi.y + 0.03);
        } else if (fStyle > 5.5 && fStyle < 6.5) {
          if (ground) albedo *= 0.88 + 0.12 * (1.0 - aaPulse(vWall.y * 1.6, 0.12));
          albedo *= 1.0 - 0.2 * aaBand(cf.y, 0.0, 0.04);
        } else if (fStyle > 6.5 && fStyle < 7.5) {
          albedo *= 1.0 - 0.15 * aaBand(cf.y, 0.0, 0.08);
        } else if (condo) {
          // exposed slab edges at every floor, a darker reveal under each slab
          albedo = mix(albedo, vec3(0.9, 0.89, 0.86), (1.0 - aaStep(0.07, cf.y)) * 0.8);
          albedo *= 1.0 - 0.22 * aaBand(cf.y, 0.07, 0.1) * (1.0 - far);
        } else {
          albedo *= 1.0 + 0.12 * aaBand(cf.y, lo.y - 0.05, lo.y);
        }

        // ---- windows
        if (win > 0.001) {
          vec3 gAlb; float gMetal, gRough, transmit;
          if (fStyle < 0.5) {
            // real glazing, not chrome: clear low-E (dark, the floors behind visible), tinted reflective (the CBD's
            // blue-green, bronze and grey) and silver-coated towers; specular comes from Fresnel + the coating, not from
            // treating glass as metal
            float gk = fract(fSeed * 13.7);
            if (gk < 0.22) { gAlb = vec3(0.018, 0.024, 0.028) * (0.9 + 0.2 * h); gMetal = 0.05; gRough = 0.035 + 0.04 * h; transmit = 1.0; }
            else if (gk < 0.7) { gAlb = mix(vec3(0.03), wallCol, 0.68) * (0.94 + 0.12 * h); gMetal = 0.3; gRough = 0.03 + 0.04 * h; transmit = 0.7; }
            else { gAlb = mix(vec3(0.04), wallCol * 1.1, 0.8) * (0.95 + 0.1 * h); gMetal = 0.58; gRough = 0.025 + 0.03 * h; transmit = 0.35; }
            // panels are never perfectly coplanar: a slight tilt per panel breaks reflections up (more = crumpled foil)
            vec3 Tw = vec3(-N.z, 0.0, N.x);
            vec2 tl = (vec2(hash12(cid + fSeed * 11.0), hash12(cid.yx + fSeed * 23.0)) - 0.5) * 0.012;
            fNTilt = (viewMatrix * vec4(Tw * tl.x + vec3(0.0, tl.y, 0.0), 0.0)).xyz * (1.0 - far);
          } else if (fStyle > 9.5) {
            gAlb = vec3(0.05, 0.07, 0.08); gMetal = 0.3; gRough = 0.08; transmit = 0.8;
          } else {
            gAlb = vec3(0.02, 0.025, 0.03); gMetal = 0.08; gRough = 0.05 + 0.05 * h; transmit = 1.0;
          }
          if (lobby) {
            // clear low-iron glazing in slim mullions every 1.6 m
            gAlb = vec3(0.015, 0.02, 0.022); gMetal = 0.1; gRough = 0.03; transmit = 1.0;
            win *= 1.0 - aaPulse(vWall.x / 1.6 + 0.03, 0.06);
          }
          // ---- interior (lit room, interior mapping when close)
          vec3 roomBase = mix(vec3(0.55, 0.5, 0.42), vec3(0.75, 0.75, 0.78), h);
          if (resi) roomBase = mix(vec3(0.62, 0.5, 0.38), vec3(0.7, 0.66, 0.6), h);
          // colour temperature: offices mix cool 4000-5000K and warm 3000K floors; HDB homes half cool fluorescent
          float warmF = hash12(vec2(cid.y + zone * 3.1, fSeed * 13.0 + 5.0));
          vec3 lampCol = resi ? (hdb && h > 0.5 ? vec3(0.8, 0.9, 1.0) : mix(vec3(1.0, 0.62, 0.32), vec3(1.0, 0.8, 0.55), h))
                              : (warmF < 0.25 + 0.25 * fract(fSeed * 3.3) ? vec3(1.0, 0.78, 0.52) : mix(vec3(0.74, 0.85, 1.0), vec3(0.88, 0.94, 1.0), warmF));
          // per-window on/off up close; fades to the floor/zone average where windows are sub-pixel (no sparkle)
          float floorLit = resi || ground ? step(hash12(vec2(cid.y, fSeed * 61.0 + wallId)), min(1.0, litFrac * 1.15)) * 0.75 + litFrac * 0.25 : (floorOn ? 0.85 : 0.04 * uNight);
          float litAmt = mix(lit ? 1.0 : 0.0, floorLit, farLit);
          float lampI = litAmt * (resi ? 1.2 : 0.72) * mix(0.75 + 0.5 * h, 0.55, farLit);
          float dayI = 0.07 * (1.0 - uNight);
          // open shops are lit day and night
          // lobbies are lit day and night: cool white for offices/hospitals, warm for hotels and condos
          if (lobby) { lampI = 0.42 + 0.18 * h; lampCol = fUse > 7.5 || fUse == 6.0 ? vec3(1.0, 0.8, 0.58) : vec3(0.92, 0.95, 1.0); roomBase = mix(vec3(0.74, 0.71, 0.66), vec3(0.5, 0.47, 0.44), h2); }
          // trading shops are lit day and night: fluorescent provision shops/kopitiams, warm goldsmiths and bakeries
          // shophouse ground floors that aren't shops (homes, offices, hotels) and civic halls keep a lit front room day
          // and night: unlit, their arched glazing in the shade read as a row of black holes. Both turn down after dark,
          // when the exposure opens up 2-4x: at daytime strength the arches blew out to flat white
          if (ground && ((shop && !shopUse) || (fStyle > 5.5 && fStyle < 6.5))) { lampI = (0.58 + 0.2 * h) * mix(1.0, 0.5, uNight); lampCol = vec3(1.0, 0.82, 0.6); }
          if (shopG) { lampI = shopOpen ? (0.62 + 0.25 * h) * mix(1.0, 0.42, uNight) : 0.0; lampCol = shopFam == 4.0 || shopFam == 5.0 ? vec3(1.0, 0.8, 0.58) : mix(vec3(0.86, 0.95, 1.0), vec3(1.0, 0.9, 0.76), step(0.7, h2)); roomBase = mix(vec3(0.55, 0.38, 0.22), vec3(0.42, 0.45, 0.4), h2); }
          vec3 interior;
          if (camDist < uDetailDist && far < 0.5 && !(ground && hdb)) {
            vec3 T = vec3(-N.z, 0.0, N.x);
            vec3 V = normalize(vWPos - cameraPosition);
            vec3 d = vec3(dot(V, T), V.y, -dot(V, N));
            d.z = max(d.z, 0.03);
            float roomW = cw, roomH = fh, roomD = cw * (0.9 + h * 0.9);
            vec3 p = vec3(cf.x * roomW, cf.y * roomH, 0.0);
            // a lobby is one deep open hall behind the mullions, not a row of cells
            if (lobby) { roomW = 14.0; roomD = 16.0; p.x = mod(vWall.x + fSeed * 7.0, roomW); }
            float tx = d.x > 0.0 ? (roomW - p.x) / max(d.x, 1e-4) : -p.x / min(d.x, -1e-4);
            float ty = d.y > 0.0 ? (roomH - p.y) / max(d.y, 1e-4) : -p.y / min(d.y, -1e-4);
            float tz = roomD / d.z;
            float t = min(min(tx, ty), tz);
            vec3 hp = p + d * t;
            vec3 c; float lm = 1.0;
            if (t == tz) {
              c = roomBase * 0.9;
              c *= mix(0.45, 1.0, smoothstep(0.22, 0.32, hp.y / roomH));
              vec2 bw = vec2(hp.x / roomW, hp.y / roomH);
              // analytic texel footprint (no derivatives inside this branch): ~1 mrad per pixel at the back wall
              float pxw = (camDist + t) * 0.0011;
              vec2 bgx = vec2(pxw / roomW, 0.0), bgy = vec2(0.0, pxw / roomH);
              // (room x runs right-to-left seen from outside, like the signboards: mirror the artwork back)
              if (shopG) c = interiorCell(shopFam, vec2(1.0 - bw.x, bw.y), bgx, bgy) * 0.85;          // the shop's own goods, counter, menus
              else if (lobby) {
                // hospital halls alternate registration counters and the pharmacy; offices show their reception
                float hall = hash12(vec2(floor((vWall.x + fSeed * 7.0) / roomW), fSeed * 19.0));
                c = interiorCell(fUse > 1.5 && fUse < 2.5 ? (hall < 0.6 ? 3.0 : 7.0) : 2.0, vec2(1.0 - bw.x, min(bw.y * 1.25, 1.0)), bgx, bgy * 1.25) * 0.9;
              }
              else if (h > 0.6 && abs(bw.x - 0.5) < 0.18 && abs(bw.y - 0.55) < 0.1) c = resi ? vec3(0.2, 0.3, 0.5) : vec3(0.1);
            } else if (t == ty) {
              // floors: timber in homes, grey cement tiles in shops (dark timber read as a black hole seen from above)
              if (d.y < 0.0) { c = shopG ? vec3(0.5, 0.48, 0.44) : resi ? vec3(0.32, 0.2, 0.12) : vec3(0.25, 0.25, 0.27); lm = shopG ? 1.0 : 0.8; }
              else { c = vec3(0.85); lm = 1.6;
                float panel = aaBox(vec2(hp.x / 1.2, hp.z / 1.2), vec2(0.2), vec2(0.8));
                if (!resi) lm += 1.5 * panel; else if (shopRecess) lm += 0.6 * panel; }
            } else {
              c = roomBase * 0.75;
              if (shopG) { // the back wall's shelving continues down the party walls
                float k = clamp(hp.z / roomD, 0.0, 1.0) * 0.18, pxs = (camDist + t) * 0.0011;
                c = interiorCell(shopFam, vec2(d.x < 0.0 ? 0.98 - k : 0.02 + k, hp.y / roomH), vec2(pxs / roomD, 0.0), vec2(0.0, pxs / roomH)) * 0.62;
              }
            }
            c *= mix(1.0, 0.55, clamp(hp.z / roomD, 0.0, 1.0));
            interior = c * (lampCol * lampI * lm * 0.45 + dayI);
          } else {
            // ceiling lighting: rooms read brighter towards the top of the glazing
            float grad = resi ? 1.0 : mix(0.45, 1.3, smoothstep(lo.y, hi.y, cf.y));
            interior = roomBase * 0.7 * (lampCol * lampI * 0.55 * grad + dayI);
          }
          // blinds / curtains
          float wy = (cf.y - lo.y) / max(hi.y - lo.y, 0.01);
          float blind = 1.0 - h * (resi ? 0.9 : 0.35);  // offices: roller blinds only part-way down
          if (wy > blind && !shopG && !lobby) {
            vec3 bc = resi ? mix(vec3(0.7, 0.55, 0.4), vec3(0.85, 0.82, 0.75), h2) : vec3(0.42, 0.42, 0.4);
            bc *= 0.85 + 0.15 * aaPulse(fy0 * 12.0 + 0.5, 0.5);
            interior = bc * (lampCol * lampI * 0.35 + dayI * 1.5);
          }
          // TV flicker
          if (resi && lit && h > 0.93) interior += vec3(0.15, 0.25, 0.6) * (0.6 + 0.4 * sin(uTime * 13.0 + h * 40.0)) * 0.8;
          float wx = (cf.x - lo.x) / max(hi.x - lo.x, 0.01);
          if (shop && !ground && h < 0.75) {
            // louvred timber shutters: closed, or folded back to the jambs
            vec3 sc = shutterCol(fract(fSeed * 7.0 + (terr ? unitH * 3.7 : fAccent * 0.13)));
            sc *= 0.62 + 0.38 * (1.0 - aaPulse(fy0 * 9.0, 0.42));
            sc *= 1.0 - 0.3 * aaBand(wx, 0.48, 0.52);
            float shut = h < 0.45 ? 1.0 : (1.0 - aaBand(wx, 0.22, 0.78));
            albedo = mix(albedo, sc, win * shut); fRough = mix(fRough, 0.6, win * shut);
            fEmis += sc * lampCol * (lit ? 0.1 : 0.0) * win * shut;
            if (shut < 0.5) {
              albedo = mix(albedo, gAlb, win * (1.0 - shut));
              fEmis += interior * win * (1.0 - shut);
            }
          } else if (shopG && !shopOpen) {
            // roller shutter pulled down: weathered galvanised slats (half-metallic and fairly rough, or the shade of
            // the five-foot-way mirrors the dark street into them and the arches read as empty holes)
            vec3 rs = vec3(0.42, 0.43, 0.44) * (0.75 + 0.25 * aaPulse(fy0 * 14.0 + 0.5, 0.5));
            albedo = mix(albedo, rs, win); fMetal = mix(fMetal, 0.25, win); fRough = mix(fRough, 0.58, win);
          } else if (ground && hdb) {
            // passage through the void deck: open dark space
            albedo = mix(albedo, vec3(0.05), win);
            fEmis += vec3(0.8, 0.9, 1.0) * uNight * 0.6 * aaBand(cf.y, 0.86, 0.9) * win;
          } else if (fStyle > 6.5 && fStyle < 7.5) {
            albedo = mix(albedo, vec3(0.05), win);
            fEmis += vec3(0.85, 0.95, 1.0) * uNight * 1.2 * aaBand(cf.y, 0.86, 0.9) * win;
          } else {
            float F = pow(1.0 - clamp(abs(dot(N, normalize(cameraPosition - vWPos))), 0.0, 1.0), 5.0);
            // open shopfronts (kopitiams, provision and hardware shops) have no glass: nothing to reflect
            bool openFront = shopG && shopOpen && !glassFront;
            if (openFront) { F = 0.0; gAlb = vec3(0.0); gMetal = 0.0; gRough = 1.0; transmit = 1.0; }
            // window reveal: the frame casts a soft shadow along the head and jambs (fake depth)
            float wTop = (hi.y - cf.y) * fh, wSide = min(cf.x - lo.x, hi.x - cf.x) * cw;
            float reveal = fStyle < 0.5 ? 0.0 : ((1.0 - smoothstep(0.0, 0.4, wTop)) * 0.6 + (1.0 - smoothstep(0.0, 0.16, wSide)) * 0.35) * (1.0 - far);
            // HDB: grey aluminium frames with a mullion, some with security grilles
            if (hdb && !ground) {
              float frame = (1.0 - aaBand(wx, 0.04, 0.96)) + aaBand(wx, 0.48, 0.52) + (1.0 - aaBand(wy, 0.05, 0.95));
              float grille = step(0.7, h2) * aaPulse(vWall.x * 6.0 + 0.5, 0.5) * 0.8;
              albedo = mix(albedo, vec3(0.6, 0.62, 0.63), clamp(frame, 0.0, 1.0) * win * (1.0 - far));
              reveal = max(reveal, grille);
            }
            albedo = mix(albedo, gAlb * (1.0 - reveal), win);
            fMetal = mix(fMetal, gMetal, win);
            fRough = mix(fRough, gRough, win);
            fEmis += interior * transmit * (1.0 - F) * win * (1.0 - reveal * 0.7);
            if (shopG && shopOpen) fEmis += lampCol * uNight * 0.05 * win;
          }
        }
        // ---- balconies: shade under the slab above, tinted glass balustrade with a slim top rail in front of the glazing
        if (balc && cell.y < nFloors - 0.02) {
          float bw = 1.0 - far;
          albedo *= 1.0 - 0.4 * (1.0 - smoothstep(0.0, 0.45, (1.0 - cf.y) * fh)) * win * bw;
          float rail = aaBand(cf.y, 0.07, 0.38) * aaBand(cf.x, 0.02, 0.98);
          float topRail = aaBand(cf.y, 0.36, 0.385) * aaBand(cf.x, 0.02, 0.98);
          albedo = mix(albedo, mix(albedo, vec3(0.3, 0.42, 0.44), 0.55), rail * bw);
          albedo = mix(albedo, vec3(0.72, 0.73, 0.72), topRail * bw);
          fMetal = mix(fMetal, 0.35, rail * bw); fRough = mix(fRough, 0.12, rail * bw);
          fEmis *= 1.0 - 0.45 * rail;
        }
        // ---- lobby entrance: a pair of sliding doors in the middle bay (frames, centre meeting stile, transom)
        if (lobby && fy0 < 2.75 && far < 0.9) {
          float dx = abs((wallLen - vWall.x) - wallLen * 0.5);
          float fr = max(aaBand(dx, 1.6, 1.74), 1.0 - aaStep(0.035, dx)) * step(dx, 1.74);
          fr = max(fr, aaBand(fy0, 2.5, 2.62) * step(dx, 1.74));
          fr = max(fr, aaBand(fy0, 0.95, 1.0) * aaBand(dx, 0.12, 0.42) * 0.8);   // push bars
          albedo = mix(albedo, vec3(0.16, 0.17, 0.18), fr); fMetal = mix(fMetal, 0.6, fr); fRough = mix(fRough, 0.35, fr);
          fEmis *= 1.0 - fr;
        }
        // ---- hospital fascia over the lobby glazing: backlit name letters and the red block plaque beside them
        if (healthLobby && ground && cf.y > 0.7) {
          float u = wallLen - vWall.x;                                           // left to right seen from outside
          float sh = clamp(fh * 0.2, 0.75, 1.5), sw = sh * 4.0, x0 = (wallLen - sw) * 0.5 - sh;
          float yb = fh * 0.76, pxs = camDist * 0.0011;
          vec2 sp = vec2((u - x0) / sw, (fy0 - yb) / sh);
          if (sp.x > 0.0 && sp.x < 1.0 && sp.y > 0.0 && sp.y < 1.0) {
            float m = dot(textureGrad(uInterior, vec2(sp.x * 0.5, sp.y * 0.2), vec2(pxs / sw * 0.5, 0.0), vec2(0.0, pxs / sh * 0.2)).rgb, vec3(0.333));
            m = smoothstep(0.25, 0.75, m);
            albedo = mix(albedo, vec3(0.93), m); fMetal = mix(fMetal, 0.0, m); fRough = mix(fRough, 0.4, m);
            fEmis += vec3(0.95, 1.0, 1.0) * m * (0.03 + uNight * 2.4);
          }
          float blk = floor(vF2.z + 0.5);
          if (blk > 0.5 && blk < 8.5) {
            float ph = sh * 0.9, pw = ph * 2.0, px0 = x0 + sw + 0.6;
            vec2 pp = vec2((u - px0) / pw, (fy0 - yb - (sh - ph) * 0.5) / ph);
            if (pp.x > 0.0 && pp.x < 1.0 && pp.y > 0.0 && pp.y < 1.0) {
              float k = blk - 1.0;
              vec2 puv = vec2(0.5 + (mod(k, 4.0) + clamp(pp.x, 0.03, 0.97)) * 0.125, 1.0 - (512.0 + floor(k / 4.0) * 64.0 + (1.0 - clamp(pp.y, 0.04, 0.96)) * 64.0) / 640.0);
              vec3 pc = textureGrad(uInterior, puv, vec2(pxs / pw * 0.125, 0.0), vec2(0.0, pxs / ph * 0.1)).rgb;
              albedo = pc; fMetal = 0.0; fRough = 0.45;
              fEmis += pc * (0.02 + uNight * 0.9);
            }
          }
        }
        // ---- shop signboards: over the five-foot-way (atlas boards, one per bay) and small boards over shopfronts
        if (shopFront && cid.y > 0.5 && cid.y < 1.5 && cf.y < 0.37) {
          float nb = max(1.0, floor(wallLen / 5.5 + 0.5)), bw = wallLen / nb;
          vec2 bc = vec2((wallLen - vWall.x) / bw, (fy0 / fh - 1.0)); // u runs right-to-left seen from outside
          vec2 bp = vec2((fract(bc.x) - 0.07) / 0.86, (bc.y - 0.06) / 0.27);
          if (bp.x > 0.0 && bp.x < 1.0 && bp.y > 0.0 && bp.y < 1.0) {
            float hb = hash12(vec2(floor(bc.x) * 1.7 + 3.0, fSeed * 91.0 + wallId));
            if (hb < 0.9) {
              float idx = floor(hash12(vec2(floor(bc.x) * 5.3 + wallId * 1.3, fSeed * 37.0)) * 60.0);
              vec2 gx = dFdx(bc) / vec2(0.86, 0.27), gy = dFdy(bc) / vec2(0.86, 0.27);
              vec3 sg = signBoard(idx, bp, gx, gy).rgb;
              albedo = sg * (1.0 - 0.25 * aaBand(bp.y, 0.0, 0.08));
              fRough = 0.5; fMetal = 0.0;
              fEmis += sg * (hb < 0.45 ? 0.04 + uNight * 0.9 : uNight * 0.12);
            }
          }
          // shadow line under the board onto the fascia
          albedo *= 1.0 - 0.3 * aaBand(bc.y, 0.0, 0.05);
        }
        if (ground && shopUse && !lobby && ((fStyle > 3.5 && fStyle < 5.5) || (fStyle > 0.5 && fStyle < 1.5 && fTop < 60.0)) && cf.y > (shopRecess ? 0.79 : 0.82) && cf.y < 0.985) {
          float hb = hash12(vec2(cid.x * 1.7, fSeed * 91.0 + wallId));
          if (hb < (fStyle < 1.5 && fUse < 0.5 ? 0.45 : 0.78)) {
            float y0b = shopRecess ? 0.79 : 0.82;
            vec2 bp = vec2((0.96 - cf.x) / 0.92, (cf.y - y0b) / (0.985 - y0b));
            float idx = floor(hash12(vec2(cid.x * 2.9 + wallId * 3.7 + 7.0, fSeed * 17.0)) * 60.0);
            vec2 g = vec2(cell.x / 0.92, cell.y / (0.985 - y0b));
            vec3 sg = signBoard(idx, clamp(bp, 0.0, 1.0), dFdx(g), dFdy(g)).rgb;
            float panel = aaBand(cf.x, 0.04, 0.96);
            albedo = mix(albedo, sg, panel);
            fEmis += sg * panel * (0.05 + uNight * (hb < 0.4 ? 1.0 : 0.25));
            fRough = 0.45; fMetal = 0.0;
          }
        }
        // feature lighting at night: a few towers wash their crown, others run coloured LED bands along the slabs
        float fk = fract(fSeed * 5.3);
        if (fStyle < 0.5 && fTop > 140.0 && cell.y > nFloors - 1.5 && fk > 0.45 && fk < 0.6) fEmis += mix(vec3(0.5, 0.7, 1.0), vec3(1.0, 0.85, 0.6), fract(fSeed * 9.1)) * uNight * 0.35;
        if (fStyle < 1.5 && fTop > 110.0 && fk > 0.88 && cell.y > nFloors * 0.7) {
          float k = floor(fract(fSeed * 17.0) * 5.0);
          vec3 led = k < 1.0 ? vec3(0.1, 0.75, 1.0) : k < 2.0 ? vec3(1.0, 0.18, 0.65) : k < 3.0 ? vec3(1.0, 0.7, 0.25) : k < 4.0 ? vec3(0.25, 1.0, 0.5) : vec3(0.55, 0.3, 1.0);
          if (fract(fSeed * 29.0) > 0.6) led = 0.5 + 0.5 * cos(6.2832 * (uTime * 0.04 + cell.y * 0.015 + vec3(0.0, 0.33, 0.67)));
          float band = aaBand(cf.y, 0.0, 0.045) * step(0.5, mod(cid.y + floor(fSeed * 4.0), 2.0));
          fEmis += led * band * uNight * 1.0;
        }
      }
      // aviation obstruction lights. A 0.8 x 1.2 m lamp is soon smaller than a pixel: from there its radiance scales
      // with the share of the pixel it really covers, so a phone's 4x larger pixels don't bloom it into a red blob
      vec2 avPx = fwidth(vWall.xy);
      if (fTop > 110.0 && vWall.y > fTop - 1.2 && vWall.x < 0.8 && !special) fEmis += vec3(1.0, 0.05, 0.02) * uNight * 12.0 * step(0.5, fract(uTime * 0.5 + fSeed)) * clamp(0.96 / max(avPx.x * avPx.y, 1e-4), 0.12, 1.0);
      fRough = mix(fRough, fRough * 0.5, uWet);
      diffuseColor.rgb = albedo;
      roughnessFactor = fRough;
      metalnessFactor = fMetal;
    `,
    fragAfterNormal: `normal = normalize(normal + fNTilt);`,
    // at night the walls above the street see only the dim violet sky glow: the street-level ambient lit whole facades
    // evenly, a dimmed daytime rather than a night street
    fragAfterIbl: `radiance *= fSpecOcc; iblIrradiance *= fAmbOcc;
      { vec3 nUp = mix(vec3(1.0), vec3(0.32, 0.32, 0.45), uNight * smoothstep(3.0, 12.0, vWPos.y)); irradiance *= nUp; iblIrradiance *= nUp; }`,
    // the street lights the walls from below and the light dies away up them within a storey (~exp(-(y - 3) / 2.2);
    // slower, a two-storey shophouse was lit evenly to the eaves): the lamps' pools from the same baked lamp map as
    // the ground (sampled a little out in the street; the cut-off LED heads throw little sideways) — a lamp-lit
    // street's walls read as lit, a back lane's as dim, not both as black — and on shophouse fronts the shop light
    // (fSpill)
    fragAfterEmissive: `totalEmissiveRadiance += fEmis;
      if (uNight > 0.02 && vWPos.y < 14.0 && !horiz) {
        float le = texture2D(uLamp, (vWPos.xz + N.xz * 2.0 - uLampOrigin) / uLampSize).r; le = le * le * 4.0; le = le / (1.0 + 0.45 * le);
        totalEmissiveRadiance += diffuseColor.rgb * (vec3(1.0, 0.92, 0.8) * le * 0.24 + fSpill) * exp(-max(vWPos.y - 3.0, 0.0) * 0.45) * uNight * uStreetGlow;
      }`,
  });
}

// ------------------------------------------------------------------ roofs
export function createRoofMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0 });
  return patch(mat, {
    key: 'roof-v3',
    uniforms: COMMON_U(),
    vertexHead: COMMON_VHEAD + `attribute vec4 aRoof; varying vec4 vRoof;`,
    vertexBody: COMMON_VBODY + `vRoof = aRoof;`,
    fragHead: COMMON_HEAD + `varying vec4 vRoof;`,
    fragAfterMetal: /* glsl */`
      vec3 albedo = diffuseColor.rgb;
      float n = fbm3(vWPos.xz * 0.25);
      float rgh = 0.9, mtl = 0.0;
      vec3 rEmis = vec3(0.0);
      float rs = floor(vRoof.x + 0.5);
      if (rs > 19.5) {
        // rooftop features laid as decal quads by the city builder; uv in vRoof.zw (0..1 across the quad)
        vec2 uv = vRoof.zw, q = uv - 0.5;
        if (rs < 20.5) {
          // helipad: dark deck, white touchdown ring, yellow H, perimeter lights
          float r = length(q);
          albedo = vec3(0.09, 0.095, 0.1) * (0.85 + 0.3 * n);
          albedo = mix(albedo, vec3(0.85), aaBand(r, 0.33, 0.37));
          float H = (aaBand(q.x, -0.17, -0.11) + aaBand(q.x, 0.11, 0.17)) * aaBand(q.y, -0.2, 0.2) + aaBand(q.x, -0.11, 0.11) * aaBand(q.y, -0.03, 0.03);
          albedo = mix(albedo, vec3(0.95, 0.75, 0.1), clamp(H, 0.0, 1.0));
          float edge = max(abs(q.x), abs(q.y));
          albedo = mix(albedo, vec3(0.9, 0.9, 0.85), aaBand(edge, 0.46, 0.48) * step(0.5, fract((q.x + q.y) * 12.0)));
          float lamp = (1.0 - smoothstep(0.008, 0.016, abs(edge - 0.49))) * step(0.85, fract(atan(q.y, q.x) * 3.82));
          rEmis += vec3(0.3, 1.0, 0.4) * lamp * (0.2 + uNight * 6.0);
          rgh = 0.75;
        } else if (rs < 21.5) {
          // rooftop pool: tiled edge, turquoise water with moving caustics, underwater lights at night
          float edge = max(abs(q.x) * 2.0, abs(q.y) * 2.0);
          float c1 = vnoise(vWPos.xz * 1.3 + uTime * 0.35), c2 = vnoise(vWPos.zx * 1.7 - uTime * 0.28);
          float caus = pow(1.0 - abs(c1 - c2), 6.0);
          vec3 water = mix(vec3(0.02, 0.32, 0.42), vec3(0.1, 0.6, 0.7), caus * 0.6);
          albedo = mix(water, vec3(0.86, 0.85, 0.8), smoothstep(0.9, 0.93, edge));
          rgh = mix(0.04, 0.6, smoothstep(0.9, 0.93, edge)); mtl = 0.0;
          rEmis += vec3(0.1, 0.55, 0.65) * (1.0 - smoothstep(0.9, 0.93, edge)) * uNight * (0.6 + caus * 0.8);
        } else if (rs < 22.5) {
          // roof garden: lawn, shrub clumps and paved paths
          float g = fbm3(vWPos.xz * 0.6);
          albedo = mix(vec3(0.07, 0.16, 0.04), vec3(0.16, 0.28, 0.07), g);
          float shrub = smoothstep(0.62, 0.7, vnoise(vWPos.xz * 0.45));
          albedo = mix(albedo, vec3(0.04, 0.1, 0.03), shrub);
          float path = aaBand(q.x, -0.04, 0.04) + aaBand(q.y, -0.04, 0.04);
          albedo = mix(albedo, vec3(0.6, 0.57, 0.5), clamp(path, 0.0, 1.0));
          rgh = 0.95;
        } else {
          // photovoltaic array: tilted rows of dark blue cells in silver frames, maintenance gaps
          vec2 cell = vec2(q.x * 14.0, q.y * 6.0);
          vec2 cf = fract(cell);
          float gap = aaBand(cf.y, 0.08, 0.92) * aaBand(cf.x, 0.02, 0.98);
          vec2 sub = fract(vec2(cell.x * 6.0, cell.y * 10.0));
          float grid = aaBand(sub.x, 0.05, 0.95) * aaBand(sub.y, 0.05, 0.95);
          vec3 pv = mix(vec3(0.55, 0.57, 0.6), vec3(0.02, 0.04, 0.1) * (0.8 + 0.4 * hash12(floor(cell))), grid);
          albedo = mix(albedo * 0.8, pv, gap);
          rgh = mix(rgh, 0.18, gap * grid); mtl = gap * 0.4;
        }
      } else if (vRoof.z > 1.5) {
        // a terrace's plastered firewall, streaked with grime
        albedo *= 0.88 + 0.2 * n - 0.15 * smoothstep(0.6, 0.85, vnoise(vec2(dot(vWPos.xz, vec2(0.7)) * 0.8, vWPos.y * 2.0)));
        rgh = 0.85;
      } else if (vRoof.z > 0.5) {
        // half-round clay tiles in rows running down the slope (u across it, ~22 cm a row) and overlapping courses
        // (sl down it, ~29 cm); each tile its own shade. Where rows or courses shrink below a pixel they fade to their
        // average, so a distant roof is an even clay colour instead of moire
        float hl = length(vWN.xz);
        vec2 hd = hl > 0.05 ? vec2(-vWN.z, vWN.x) / hl : vec2(1.0, 0.0);
        float u = dot(vWPos.xz, hd) * 4.6, sl = vWPos.y / max(hl, 0.25) * 3.4;
        float fu = 1.0 - smoothstep(0.3, 0.7, fwidth(u)), fs = 1.0 - smoothstep(0.3, 0.7, fwidth(sl));
        float barrel = 0.7 + 0.345 * sqrt(sin(fract(u) * 3.14159));
        float course = 0.8 + 0.2 * smoothstep(0.0, 0.22, fract(sl));
        albedo *= mix(1.0, barrel, fu) * mix(0.98, course, fs) * mix(1.0, 0.88 + 0.24 * hash12(floor(vec2(u, sl))), min(fu, fs));
        // moss / soot on old clay tiles
        albedo = mix(albedo, albedo * vec3(0.45, 0.5, 0.42), smoothstep(0.55, 0.85, vnoise(vWPos.xz * 0.3)) * 0.6);
        rgh = 0.7;
      } else {
        // flat concrete slab: screed tiles, ponding stains, darker drains and patching
        albedo *= 0.75 + 0.45 * n;
        albedo *= 1.0 - 0.25 * smoothstep(0.6, 0.8, vnoise(vWPos.xz * 0.08));
        vec2 tq = fract(vWPos.xz / 1.2);
        albedo *= 1.0 - 0.12 * (1.0 - aaBand(tq.x, 0.03, 0.97) * aaBand(tq.y, 0.03, 0.97));
        float pond = smoothstep(0.55, 0.75, fbm3(vWPos.xz * 0.05 + 3.0));
        albedo = mix(albedo, albedo * vec3(0.55, 0.57, 0.5), pond * 0.6);
      }
      albedo *= 1.0 - uWet * 0.3;
      diffuseColor.rgb = albedo;
      roughnessFactor = mix(rgh, 0.25, uWet);
      metalnessFactor = mtl;
    `,
    fragAfterEmissive: `totalEmissiveRadiance += rEmis;`,
  });
}

// ------------------------------------------------------------------ roads & footways
// Street lookup texture, filled by StreetDetail at load: R = near a traffic signal (crossing style),
// B = yellow-box junction. A 1x1 black placeholder keeps the program identical before/after it is set.
const _black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); _black.needsUpdate = true;
// lamp: street-light map baked by Props (ground illuminance from every street lamp, sqrt-encoded over 0..4);
// glow: overall strength of that light at night (runtime tunable)
// wear: city wear map baked by StreetDetail (R = grime: soil round tree bases; G = foot polish: shop fronts, crossing
// kerbs, bus stops). pave: small tiling microstructure for paving seen up close (R albedo, G height, B roughness).
export const STREET = { sig: { value: _black }, sigOrigin: { value: new THREE.Vector2(0, 0) }, sigSize: { value: new THREE.Vector2(1, 1) },
  lamp: { value: _black }, lampOrigin: { value: new THREE.Vector2(0, 0) }, lampSize: { value: new THREE.Vector2(1, 1) }, glow: { value: 1 },
  wear: { value: _black }, wearOrigin: { value: new THREE.Vector2(0, 0) }, wearSize: { value: new THREE.Vector2(1, 1) }, pave: { value: null } };
const STREET_U = () => ({ uSig: STREET.sig, uSigOrigin: STREET.sigOrigin, uSigSize: STREET.sigSize, uLamp: STREET.lamp, uLampOrigin: STREET.lampOrigin, uLampSize: STREET.lampSize, uStreetGlow: STREET.glow,
  uWear: STREET.wear, uWearOrigin: STREET.wearOrigin, uWearSize: STREET.wearSize, uPave: STREET.pave.value ? STREET.pave : (STREET.pave.value = paveDetail(), STREET.pave) });

// 256x256 tiling paving microstructure (cast concrete / granite): mottling, sand-blasted pits and grains, polish
function paveDetail() {
  const N = 256, px = new Uint8Array(N * N * 4);
  const h = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vn = (x, y, p) => { // periodic value noise with period p cells
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const c = (a, b) => h(((a % p) + p) % p, ((b % p) + p) % p);
    return (c(xi, yi) * (1 - u) + c(xi + 1, yi) * u) * (1 - v) + (c(xi, yi + 1) * (1 - u) + c(xi + 1, yi + 1) * u) * v;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const m = vn(x / 32, y / 32, 8) * 0.5 + vn(x / 16, y / 16, 16) * 0.3 + vn(x / 4, y / 4, 64) * 0.2; // periods divide 256: seamless
    const grain = h(x + 0.37, y + 0.71), pit = grain > 0.965 ? 0 : 1, agg = grain < 0.06 ? 1 : 0;
    const i = (y * N + x) * 4;
    px[i] = Math.round(Math.min(1, Math.max(0, 0.5 + (m - 0.5) * 0.9 - (1 - pit) * 0.25 + agg * 0.18)) * 255);
    px[i + 1] = Math.round(Math.min(1, Math.max(0, 0.5 + (vn(x / 8, y / 8, 32) - 0.5) * 0.6 - (1 - pit) * 0.45 + agg * 0.2)) * 255);
    px[i + 2] = Math.round(Math.min(1, Math.max(0, 0.5 + (vn(x / 64, y / 64, 4) - 0.5) * 0.8 + agg * 0.25)) * 255);
    px[i + 3] = 255;
  }
  const t = new THREE.DataTexture(px, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

// shared street-surface GLSL: procedural bump, joints, paver bonds
const STREET_GLSL = /* glsl */`
uniform sampler2D uSig; uniform vec2 uSigOrigin; uniform vec2 uSigSize; uniform float uStreetGlow;
uniform sampler2D uLamp; uniform vec2 uLampOrigin; uniform vec2 uLampSize;
uniform sampler2D uWear; uniform vec2 uWearOrigin; uniform vec2 uWearSize; uniform sampler2D uPave;
// street-lamp light on the ground at night: lux-like illuminance from the baked lamp map (1 = under a lamp head), a
// touch stronger far away where the pools blur into the lit street grid seen from the air
vec3 lampLight(vec2 wp, float camD) {
  float e = texture2D(uLamp, (wp - uLampOrigin) / uLampSize).r; e = e * e * 4.0;
  e = e / (1.0 + 0.45 * e); // overlapping pools (junctions, both kerbs) saturate instead of washing the asphalt out
  return vec3(1.0, 0.92, 0.8) * (e * 0.75 + 0.015) * mix(1.0, 1.6, smoothstep(250.0, 900.0, camD)) * uNight * uStreetGlow;
}
// perturb the view-space shading normal by a procedural height field h (metres) — Mikkelsen's surface-gradient bump
vec3 bumpNormal(vec3 n, float h, vec3 viewPos) {
  vec3 dpdx = dFdx(-viewPos), dpdy = dFdy(-viewPos);
  vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - grad);
}
// 1 while a pattern of 'freq' cells per metre spans several pixels, fading to 0 before it would alias
float cellFade(vec2 p, float freq) { float px = max(fwidth(p.x), fwidth(p.y)) * freq; return 1.0 - smoothstep(0.22, 0.55, px); }
// gradient (Perlin) noise, ~0.15..0.85 around 0.5: its iso-contours are round, so thresholding it gives pebble-like
// shapes, where thresholded value noise shows the square lattice
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  float va = dot(hash22(i) * 2.0 - 1.0, f), vb = dot(hash22(i + vec2(1.0, 0.0)) * 2.0 - 1.0, f - vec2(1.0, 0.0));
  float vc = dot(hash22(i + vec2(0.0, 1.0)) * 2.0 - 1.0, f - vec2(0.0, 1.0)), vd = dot(hash22(i + vec2(1.0, 1.0)) * 2.0 - 1.0, f - vec2(1.0));
  return 0.5 + 0.7 * mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y);
}
// fine isotropic grain (paver grit, grass blades, granite crystals), 0..1 around 0.5: two gradient-noise octaves on
// rotated lattices with a contrast curve — no square texel steps up close, no grid lines in the bump derived from it.
// Fade it with cellFade(p, f * 1.8) (the finer octave runs at 1.73 f).
float speckle(vec2 p, float f) {
  float a = gnoise(mat2(0.8, -0.6, 0.6, 0.8) * p * f), b = gnoise(mat2(0.28, 0.96, -0.96, 0.28) * p * (f * 1.73) + 11.3);
  return smoothstep(0.25, 0.75, a * 0.62 + b * 0.38);
}
// asphalt aggregate at ~f stones per metre: sparse pale chippings and dark voids in the binder (0.5 = binder)
float stones(vec2 p, float f) {
  float a = gnoise(mat2(0.8, -0.6, 0.6, 0.8) * p * f), b = gnoise(mat2(0.28, 0.96, -0.96, 0.28) * p * (f * 1.37) + 11.3);
  return 0.5 + smoothstep(0.6, 0.7, a) * 0.5 - smoothstep(0.63, 0.73, b) * 0.3;
}
// 1 inside a joint of width j around a size-sized cell (f = local coords in [0,size))
float jointMask(vec2 f, vec2 size, float j) {
  vec2 d = min(f, size - f); float e = min(d.x, d.y);
  float aw = fwidth(e) * 0.8 + 1e-4;
  return 1.0 - smoothstep(j - aw, j + aw, e);
}
// paving bonds in a local frame p (metres): 0 red clay herringbone, 1 grey stretcher bond, 2 concrete slabs, 3 buff basketweave
void pavers(vec2 p, float style, out vec3 col, out float joint, out float pid) {
  vec2 lp = vec2(0.0), sz = vec2(2.0, 1.0), cid = vec2(0.0);
  if (style < 0.5) {
    vec2 q = p / 0.1;
    float fa = floor((q.x + q.y) * 0.5), fb = floor((q.x - q.y) * 0.25);
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
      float a = fa + float(i), b = fb + float(j);
      vec2 r = q - vec2(a + 2.0 * b, a - 2.0 * b);
      if (r.x >= 0.0 && r.x < 2.0 && r.y >= 0.0 && r.y < 1.0) { lp = r; sz = vec2(2.0, 1.0); cid = vec2(a, b * 2.0); }
      vec2 rv = r - vec2(2.0, -1.0);
      if (rv.x >= 0.0 && rv.x < 1.0 && rv.y >= 0.0 && rv.y < 2.0) { lp = rv; sz = vec2(1.0, 2.0); cid = vec2(a, b * 2.0 + 1.0); }
    }
    joint = jointMask(lp, sz, 0.07);
    pid = hash12(cid);
    col = mix(vec3(0.24, 0.075, 0.045), vec3(0.33, 0.13, 0.08), pid) * (0.85 + 0.2 * hash12(cid + 7.3));
    float fd = cellFade(p, 10.0); col = mix(vec3(0.27, 0.098, 0.06), col, fd); joint = mix(0.2, joint, fd); pid = mix(0.5, pid, fd);
  } else if (style < 1.5) {
    vec2 q = p / vec2(0.2, 0.1); q.x += step(1.0, mod(floor(q.y), 2.0)) * 0.5;
    cid = floor(q); lp = fract(q) * vec2(2.0, 1.0);
    joint = jointMask(lp, vec2(2.0, 1.0), 0.07);
    pid = hash12(cid);
    col = mix(vec3(0.17, 0.165, 0.155), vec3(0.25, 0.24, 0.225), pid);
    float fd = cellFade(p, 10.0); col = mix(vec3(0.21, 0.2, 0.19), col, fd); joint = mix(0.2, joint, fd); pid = mix(0.5, pid, fd);
  } else if (style < 2.5) {
    vec2 q = p / 0.6; cid = floor(q); lp = fract(q) * 0.6;
    joint = jointMask(lp, vec2(0.6), 0.006);
    pid = hash12(cid);
    col = vec3(0.21, 0.205, 0.19) * (0.88 + 0.18 * pid);
    float fd = cellFade(p, 1.7); col = mix(vec3(0.2, 0.196, 0.182), col, fd); joint = mix(0.04, joint, fd);
  } else {
    vec2 q = p / 0.1; vec2 c = floor(q * 0.5); vec2 f = q - c * 2.0;
    bool hor = mod(c.x + c.y, 2.0) < 1.0;
    if (hor) { lp = vec2(f.x, fract(f.y)); sz = vec2(2.0, 1.0); cid = c * 2.0 + vec2(0.0, floor(f.y)); }
    else { lp = vec2(fract(f.x), f.y); sz = vec2(1.0, 2.0); cid = c * 2.0 + vec2(floor(f.x), 0.5); }
    joint = jointMask(lp, sz, 0.07);
    pid = hash12(cid);
    col = mix(vec3(0.27, 0.21, 0.14), vec3(0.34, 0.28, 0.19), pid);
    float fd = cellFade(p, 10.0); col = mix(vec3(0.3, 0.245, 0.165), col, fd); joint = mix(0.2, joint, fd); pid = mix(0.5, pid, fd);
  }
}
`;

export function createRoadMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
  return patch(mat, {
    key: 'road-v10',
    uniforms: { ...COMMON_U(), ...STREET_U(), uRefl: REFL.tex, uReflMat: REFL.mat, uReflOn: REFL.on, uReflRoad: REFL.road },
    vertexHead: COMMON_VHEAD + `attribute vec4 aRoad; attribute vec4 aLanes; attribute vec4 aJunc; varying vec4 vRoad; varying vec4 vLanes; varying vec4 vJunc; uniform mat4 uReflMat; uniform float uReflRoad; varying vec4 vRC;`,
    // street-plane capture (no water on screen): project the actual road point; water-level capture: the old trick
    vertexBody: COMMON_VBODY + `vRoad = aRoad; vLanes = aLanes; vJunc = aJunc; vRC = uReflMat * vec4(vWPos.x, mix(-1.4, vWPos.y, uReflRoad), vWPos.z, 1.0);`,
    fragHead: COMMON_HEAD + STREET_GLSL + `varying vec4 vRoad; varying vec4 vLanes; varying vec4 vJunc; uniform sampler2D uRefl; uniform float uReflOn; varying vec4 vRC;`,
    fragAfterEmissive: `
      normal = bumpNormal(normal, bh, vViewPosition);
      if (uNight > 0.02) {
        // pools of light under the real lamp positions (Props bakes the map). LTA's LED retrofit: cool white on
        // expressways/arterials, neutral-warm white elsewhere (no sodium orange)
        vec3 lampCol = vLanes.z < 2.5 && vRoad.w < 0.5 ? vec3(0.9, 0.97, 1.1) : vec3(1.0);
        totalEmissiveRadiance += diffuseColor.rgb * lampCol * lampLight(vWPos.xz, camD);
      }
      if (uReflOn > 0.5 && uWet > 0.05) {
        vec3 V = normalize(cameraPosition - vWPos);
        float F = 0.04 + 0.96 * pow(1.0 - clamp(V.y, 0.0, 1.0), 5.0);
        float pud = puddle / uWet;
        vec2 ruv = vRC.xy / vRC.w + vec2(vnoise(vWPos.xz * 3.0) - 0.5, vnoise(vWPos.zx * 3.0) - 0.5) * 0.004 * (1.0 + uRain * 2.0);
        vec3 refl = texture2D(uRefl, ruv).rgb;
        // glossy wet asphalt stretches bright reflections (lamp heads, lit windows, tail lights) into short vertical
        // streaks: 3 jittered taps along v from a blurrier mip (puddles stay mirror-sharp)
        float sv = 0.035 * (0.7 + uRain * 0.6) * (1.0 - pud * 0.7), jit = hash12(gl_FragCoord.xy) - 0.5;
        vec3 smear = vec3(0.0);
        for (int i = 0; i < 3; i++) { float o = (float(i) - 1.0 + jit) / 3.0; smear += textureLod(uRefl, ruv + vec2(0.0, o * sv), 1.5).rgb * (1.0 - abs(o) * 1.1); }
        refl = mix(refl, smear * 0.42, 0.7 * (1.0 - pud));
        totalEmissiveRadiance += refl * F * uWet * mix(0.35, 0.95, pud) * (1.0 - metal * 0.5);
      }`,
    fragAfterMetal: /* glsl */`
      float s = vRoad.x, along = vRoad.y, w = vRoad.z, kind = vRoad.w;
      float hw = w * 0.5;
      vec2 wp = vWPos.xz;
      float camD = distance(cameraPosition, vWPos);
      float near = 1.0 - smoothstep(30.0, 120.0, camD);
      vec4 sigM = texture2D(uSig, (wp - uSigOrigin) / uSigSize);
      float n1 = fbm3(wp * 0.12), n2 = vnoise(mat2(0.8, -0.6, 0.6, 0.8) * wp * 2.7), n3 = vnoise(wp * 0.03);
      float bh = 0.0, rgh = 0.9, metal = 0.0, wm = 0.0, ym = 0.0, rm = 0.0, pudBias = 0.0;
      // ---- asphalt: fresh black vs sun-bleached grey stretches, aggregate grain, hairline cracks in old surface
      float age = smoothstep(0.32, 0.78, n3 + 0.12 * n1);
      vec3 albedo = mix(vec3(0.04, 0.04, 0.043), vec3(0.105, 0.1, 0.094), age * 0.85) * (0.84 + 0.24 * n1) * (0.95 + 0.1 * n2);
      float gf = cellFade(wp, 50.0), grain = gf > 0.0 ? stones(wp, 36.0) : 0.5;
      albedo *= 1.0 + (grain - 0.5) * 0.55 * gf;
      bh += (grain - 0.5) * 0.0012 * gf;
      if (kind < 0.5) {
        float lf = vLanes.x, lb = vLanes.y, cls = vLanes.z, ow = vLanes.w;
        float jOK = smoothstep(vJunc.z, vJunc.z + 0.4, vJunc.x) * smoothstep(vJunc.w, vJunc.w + 0.4, vJunc.y);
        float x = s + hw - 0.3;
        float laneF = x / 3.3, lanePos = fract(laneF), laneI = floor(laneF);
        float edge = hw - abs(s);
        float urban = step(cls, 6.5);
        // wheel tracks (polished, a touch darker) and the oily drip line down each lane centre
        float tracks = (aaBand(lanePos, 0.2, 0.36) + aaBand(lanePos, 0.64, 0.8)) * urban;
        // queues at the stop line: the drip line darkens and spreads, braking rubber darkens the wheel tracks
        float dStop = laneF < lf ? vJunc.y - vJunc.w : vJunc.x - vJunc.z;
        float queue = (1.0 - smoothstep(4.0, 45.0, dStop)) * step(0.0, dStop) * jOK * urban;
        float oil = aaBand(lanePos, 0.43 - queue * 0.08, 0.57 + queue * 0.08) * smoothstep(0.35 - queue * 0.3, 0.8, vnoise(vec2(along * 0.25, laneI * 3.1))) * urban;
        albedo *= 1.0 - (0.1 + 0.1 * queue) * tracks - (0.22 + 0.2 * queue) * oil;
        rgh -= 0.14 * tracks;
        // cambered carriageway: rain runs to the gutter and sits in the wheel ruts
        pudBias = (1.0 - smoothstep(0.25, 0.9 + 0.6 * n1, edge)) * 0.9 + tracks * 0.25;
        // kerbside grime in the gutter
        albedo *= 1.0 - 0.3 * (1.0 - smoothstep(0.05, 0.55, edge)) * (0.6 + 0.4 * n2);
        // distress, mostly in old surfaces: tar-sealed longitudinal joints beside the lane lines (dark, glossy,
        // intermittent), the odd sealed transverse crack, and hairline crazing in the gutter
        float far2 = 1.0 - smoothstep(70.0, 160.0, camD);
        float bd = abs(fract(laneF + 0.5) - 0.5) * 3.3;
        float jw = bd - 0.16 - (vnoise(vec2(along * 0.18, laneI)) - 0.5) * 0.1;
        float seal = (1.0 - smoothstep(0.018, 0.03 + fwidth(jw), abs(jw))) * step(0.58, vnoise(vec2(along * 0.035, laneI + 7.0))) * smoothstep(0.25, 0.6, age);
        float tcell = floor(along / 9.0), htc = hash12(vec2(tcell, w + laneI * 0.1));
        float ta = along - tcell * 9.0 - 4.5 - (vnoise(vec2(s * 0.9, tcell)) - 0.5) * 0.7;
        float trans = (1.0 - smoothstep(0.012, 0.022 + fwidth(ta), abs(ta))) * step(0.8, htc) * step(abs(s + (fract(htc * 7.3) - 0.5) * hw), hw * 0.45) * smoothstep(0.35, 0.7, age);
        float hc = abs(vnoise(wp * 1.6) - 0.5);
        float hair = (1.0 - smoothstep(0.0, fwidth(hc) * 1.3, hc)) * (1.0 - smoothstep(0.5, 1.4, edge)) * smoothstep(0.5, 0.8, vnoise(wp * 0.12 + 3.0)) * smoothstep(0.3, 0.7, age);
        float sealed = max(seal, trans) * far2;
        albedo = mix(albedo, vec3(0.018, 0.018, 0.02), sealed * 0.85);
        rgh -= sealed * 0.45; bh += sealed * 0.0015;
        albedo *= 1.0 - 0.45 * hair * far2;
        // lane-wide reinstatement patches: fresh black asphalt, or an older patch a shade off the road round it (its
        // grain kept), cut a little out of true and edged with a glossy band of tar sealant
        float pc = floor(along / 27.0), la = along - pc * 27.0;
        float hp = hash12(vec2(pc, laneI + w * 3.17));
        if (hp > 0.8) {
          float a0 = 1.5 + fract(hp * 31.7) * 9.0, a1 = a0 + 2.5 + fract(hp * 17.3) * 13.0;
          float l0 = fract(hp * 5.1) * 0.25, l1 = 0.7 + fract(hp * 9.7) * 0.32;
          float pa = la + (vnoise(vec2(lanePos * 7.0, pc)) - 0.5) * 0.12, pl = lanePos + (vnoise(vec2(along * 0.9, laneI + 3.0)) - 0.5) * 0.03;
          float inP = aaBand(pa, a0, a1) * aaBand(pl, l0, l1);
          float seam = inP * (1.0 - aaBand(pa, a0 + 0.06, a1 - 0.06) * aaBand(pl, l0 + 0.018, l1 - 0.018));
          vec3 pcol = fract(hp * 3.3) > 0.45 ? vec3(0.03, 0.03, 0.033) * (0.9 + 0.2 * n2) : albedo * vec3(0.84, 0.85, 0.88);
          albedo = mix(albedo, pcol, inP * 0.92);
          albedo = mix(albedo, vec3(0.012), seam * 0.75); rgh -= seam * 0.3;
          bh += inP * 0.003;
        }
        // long utility-trench reinstatement
        float tc = floor(along / 140.0); float ht = hash12(vec2(tc, w * 1.37 + 11.0));
        if (ht > 0.72) {
          float off = -hw + 1.0 + fract(ht * 7.7) * max(0.0, w - 2.0);
          float a0 = fract(ht * 3.1) * 60.0, a1 = a0 + 25.0 + fract(ht * 9.9) * 55.0;
          float inT = aaBand(s, off - 0.45, off + 0.45) * aaBand(along - tc * 140.0, a0, a1);
          albedo = mix(albedo, vec3(0.03, 0.03, 0.033) * (0.9 + 0.2 * n2), inT * 0.9);
          bh += inT * 0.002;
        }
        // manhole / service covers: round cast iron, some square telecom lids
        float mc = floor(along / 41.0); float hm = hash12(vec2(mc + 3.0, laneI * 1.7 + w));
        if (hm > 0.5 && urban > 0.5) {
          float cA = 5.0 + fract(hm * 23.1) * 31.0, cS = 0.28 + fract(hm * 7.7) * 0.44;
          vec2 d = vec2((lanePos - cS) * 3.3, along - mc * 41.0 - cA);
          bool sq = fract(hm * 11.3) > 0.8;
          float r = sq ? max(abs(d.x), abs(d.y)) : length(d);
          float rad = sq ? 0.3 : 0.32;
          float disc = 1.0 - aaStep(rad, r);
          float ring = aaBand(r, rad - 0.035, rad + 0.03);
          float pat = sq ? aaBand(fract(d.x * 6.0), 0.1, 0.5) : step(0.5, fract((d.x + d.y) * 8.0)) * step(0.5, fract((d.x - d.y) * 8.0));
          vec3 iron = vec3(0.075, 0.07, 0.066) * (0.75 + 0.35 * pat * near) * (0.8 + 0.4 * n2);
          albedo = mix(albedo, iron, disc);
          albedo = mix(albedo, vec3(0.025), ring * 0.7);
          metal = max(metal, disc * 0.55); rgh = mix(rgh, 0.5, disc);
          bh += disc * pat * 0.003 * near - ring * 0.006;
        }
        // gully gratings along the kerb
        float gc = floor(along / 18.0), lg = along - gc * 18.0;
        float hg = hash12(vec2(gc, w + 5.0 + step(0.0, s)));
        float grate = aaBand(lg, 7.0, 7.9) * aaBand(edge, 0.12, 0.58) * step(0.25, hg) * jOK * urban;
        float slot = aaBand(fract((lg - 7.0) * 10.0), 0.3, 0.75);
        albedo = mix(albedo, mix(vec3(0.06, 0.058, 0.055), vec3(0.006), slot * near), grate);
        metal = max(metal, grate * 0.45); rgh = mix(rgh, 0.55, grate);
        bh -= grate * slot * 0.012 * near;
        // silt and tar run-off streak along the gutter into each grating
        float runoff = smoothstep(3.0, 7.0, lg) * (1.0 - smoothstep(7.9, 8.5, lg)) * (1.0 - smoothstep(0.05, 0.75, edge)) * step(0.25, hg) * jOK * urban;
        albedo *= 1.0 - 0.3 * runoff * (0.6 + 0.6 * n2);
        if (cls < 6.5) {
          float e = hw - 0.32;
          ym = aaBand(abs(s), e - 0.06, e + 0.06);
          if (cls < 3.5) ym = max(ym, aaBand(abs(s), e - 0.27, e - 0.15));
          ym *= jOK;
          float tot = lf + lb;
          float nearest = floor(laneF + 0.5);
          float dl = abs(laneF - nearest) * 3.3;
          float isSep = step(0.5, nearest) * step(nearest, tot - 0.5);
          bool isDiv = ow < 0.5 && abs(nearest - lf) < 0.1;
          float dash = 1.0 - aaStep(0.33, fract(along / 9.0));
          float line = 1.0 - aaStep(0.075, dl);
          if (isDiv) {
            if (cls < 4.5) line = (1.0 - aaStep(0.06, abs(dl - 0.14)));
            else line *= dash;
          } else line *= dash;
          wm = line * isSep * jOK;
          float fwd = 1.0 - aaStep(lf * 3.3, x);
          float stopA = aaBand(vJunc.y, vJunc.w + 0.2, vJunc.w + 0.65) * fwd * step(vJunc.w, 60.0);
          float stopB = aaBand(vJunc.x, vJunc.z + 0.2, vJunc.z + 0.65) * (1.0 - fwd) * step(vJunc.z, 60.0);
          wm = max(wm, max(stopA, stopB) * step(abs(s), hw - 0.4));
          // lane arrows 3-9 m before the stop line; the kerb lane of a multi-lane approach gets straight+left
          bool fw = fwd > 0.5;
          float dA = fw ? vJunc.y - vJunc.w : vJunc.x - vJunc.z;
          float nl = fw ? lf : lb;
          float li = fw ? laneI : (tot - 1.0 - laneI);
          if (dA > 3.0 && dA < 9.5 && nl >= 1.0 && cls < 5.5 && (fw ? vJunc.w : vJunc.z) < 60.0) {
            float u = (lanePos - 0.5) * 3.3 * (fw ? 1.0 : -1.0); // + = away from the kerb
            float v = dA - 3.2;                                   // 0 at the arrow tip
            float arrow = aaBand(u, -0.09, 0.09) * aaBand(v, 1.4, 5.6);
            arrow = max(arrow, aaStep(0.0, v) * (1.0 - aaStep(1.5, v)) * (1.0 - aaStep(v * 0.32, abs(u))));
            if (li < 0.5 && nl >= 2.0) {
              float hu = -u - 0.85;
              arrow = max(arrow, aaBand(v, 2.2, 2.52) * aaBand(u, -0.9, 0.09));
              arrow = max(arrow, aaStep(0.0, hu) * (1.0 - aaStep(0.5, hu)) * (1.0 - aaStep((0.5 - hu) * 0.9, abs(v - 2.36))));
            }
            wm = max(wm, arrow * step(lanePos, 0.97) * step(0.03, lanePos));
          }
          // bus lane (lookup G = bus lane, A/G > 0.5 = full-day): its boundary with the next lane is a continuous yellow (red for
          // full-day lanes) line instead of the white dashes, broken for the last 40 m so cars can weave in to turn left
          if (sigM.g > 0.3 && (fw ? lf : lb) >= 3.0) {
            float bF = fw ? 1.0 : tot - 1.0, dB = abs(laneF - bF) * 3.3;
            float solid = step(40.0, dA);
            float bl = (1.0 - aaStep(0.1, dB)) * mix(1.0 - aaStep(0.5, fract(along / 3.0)), 1.0, solid) * jOK;
            wm *= 1.0 - (1.0 - aaStep(0.3, dB));
            if (sigM.a > sigM.g * 0.5) rm = max(rm, bl); else ym = max(ym, bl);
          }
          // yellow box junction: criss-cross hatch inside the junction mouth of selected signalised junctions
          if (sigM.b > 0.5 && jOK < 0.99) {
            float inJ = 1.0 - jOK;
            float h1 = aaBand(fract((wp.x + wp.y) / 2.4), 0.0, 0.06), h2 = aaBand(fract((wp.x - wp.y) / 2.4), 0.0, 0.06);
            float border = aaBand(edge, 0.25, 0.4);
            ym = max(ym, max(max(h1, h2), border) * inJ * step(0.5, edge));
          }
        } else if (cls < 7.5) {
          // estate and service roads: a precast kerb along each edge (where the ground's verge meets the road), its
          // face's shadow on the asphalt, a yellow no-parking line inside it, and every so often, clear of the
          // junctions, a road hump painted in black and yellow stripes
          float kerb = (1.0 - aaStep(0.15, edge)) * jOK;
          albedo = mix(albedo, vec3(0.34, 0.33, 0.31) * (0.85 + 0.3 * n2), kerb);
          albedo *= 1.0 - 0.5 * aaBand(edge, 0.15, 0.21) * jOK;
          bh += kerb * 0.01; rgh = mix(rgh, 0.8, kerb);
          ym = aaBand(edge, 0.36, 0.44) * jOK;
          float hc = floor(along / 48.0), hh = hash12(vec2(hc, w * 2.3 + 1.0));
          float ha = along - hc * 48.0 - 14.0 - fract(hh * 7.1) * 20.0;
          if (hh > 0.45 && abs(ha) < 0.8 && min(vJunc.x - vJunc.z, vJunc.y - vJunc.w) > 12.0) {
            float hump = aaBand(ha, -0.7, 0.7) * step(0.15, edge);
            float yel = aaPulse((s * 0.8 + ha) / 0.6, 0.5);
            albedo = mix(albedo, mix(vec3(0.015), vec3(0.6, 0.43, 0.03), yel) * (0.75 + 0.35 * vnoise(wp * 2.3)), hump * 0.9);
            bh += cos(clamp(ha / 0.7, -1.0, 1.0) * 1.5708) * 0.035 * step(0.15, edge);
            rgh = mix(rgh, 0.55, hump);
          }
        }
      } else if (kind > 3.5) {
        // junction disc: plain asphalt (+ yellow box hatch)
        if (sigM.b > 0.5) ym = max(aaBand(fract((wp.x + wp.y) / 2.4), 0.0, 0.06), aaBand(fract((wp.x - wp.y) / 2.4), 0.0, 0.06));
      } else if (kind > 1.5 && kind < 2.5) {
        if (sigM.r > 0.5) {
          // signalised crossing (SG style): two dashed transverse lines along the crossing edges
          wm = aaBand(abs(s), hw - 0.45, hw - 0.12) * (1.0 - aaStep(0.55, fract(along / 0.9)));
        } else {
          wm = (1.0 - aaStep(0.5, fract(along / 1.1))) * (1.0 - aaStep(hw - 0.15, abs(s)));  // zebra
        }
      } else {
        // footways: paving bonds aligned with the path, style changes by neighbourhood
        float region = hash12(floor(wp / 140.0) + 0.5);
        float style = region < 0.42 ? 0.0 : region < 0.72 ? 1.0 : region < 0.88 ? 3.0 : 2.0;
        vec3 pc; float jt, pid;
        pavers(vec2(along, s + hw), style, pc, jt, pid);
        float fnear = cellFade(wp, 72.0);
        pc *= 1.0 + (fnear > 0.0 ? speckle(wp, 40.0) - 0.5 : 0.0) * 0.25 * fnear; // surface grit
        float stain = smoothstep(0.6, 0.72, fbm3(wp * 0.4 + 3.7));
        pc *= 1.0 - 0.28 * stain;
        pc = mix(pc, pc * 1.12 + 0.01, (1.0 - smoothstep(0.0, hw * 0.8, abs(s))) * 0.35); // worn walking line
        albedo = mix(pc, pc * 0.35 + vec3(0.012, 0.011, 0.009), jt);
        bh += (pid - 0.5) * 0.0015 * cellFade(wp, 10.0) - jt * 0.004;
        rgh = 0.78 - 0.08 * pid;
        if (kind > 2.5) { float st = fract(along / 0.3); albedo *= 0.72 + 0.28 * step(0.12, st); bh += step(0.5, st) * 0.02; }
      }
      float wear = 0.55 + 0.45 * smoothstep(0.25, 0.7, vnoise(wp * 1.3));
      albedo = mix(albedo, vec3(0.62, 0.62, 0.6), wm * wear);
      albedo = mix(albedo, vec3(0.62, 0.42, 0.04), ym * wear);
      albedo = mix(albedo, vec3(0.42, 0.05, 0.04), rm * wear);
      float paint = max(max(wm, ym), rm) * wear;
      rgh = mix(rgh, 0.5, paint);
      bh += paint * 0.0025;
      // rain: darker, glossier, puddles along the gutters and in the ruts (which also flatten the bump), rain rings
      float puddle = 0.0;
      if (uWet > 0.01) {
        puddle = smoothstep(0.6, 0.68, fbm3(wp * 0.11) + pudBias * 0.32 - (kind > 2.5 ? 0.06 : 0.0)) * uWet;
        albedo *= mix(1.0, 0.6, uWet);
        albedo = mix(albedo, albedo * 0.4, puddle);
        rgh = mix(rgh, 0.18, uWet);
        rgh = mix(rgh, 0.02, puddle);
        bh *= 1.0 - puddle;
        if (puddle > 0.02 && uRain > 0.05 && near > 0.0) {
          // one drop ring per 0.6 m cell, restarting at a random phase
          vec2 rc = floor(wp * 1.6), rf = fract(wp * 1.6) - 0.5 - (hash22(rc) - 0.5) * 0.5;
          float ph = fract(uTime * 0.9 + hash12(rc + 3.1)), rr = length(rf) / 1.6;
          bh += (1.0 - smoothstep(0.0, 0.014, abs(rr - ph * 0.3))) * (1.0 - ph) * 0.003 * uRain * puddle * near;
        }
      }
      diffuseColor.rgb = albedo;
      roughnessFactor = clamp(rgh, 0.02, 1.0);
      metalnessFactor = metal;
    `,
  });
}

// ------------------------------------------------------------------ structures (bridges, seawalls, canopies)
export function createStructMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 });
  return patch(mat, {
    key: 'struct-v1',
    uniforms: COMMON_U(),
    vertexHead: COMMON_VHEAD, vertexBody: COMMON_VBODY,
    fragHead: COMMON_HEAD,
    fragAfterMetal: /* glsl */`
      vec3 albedo = diffuseColor.rgb * (0.8 + 0.35 * fbm3(vWPos.xz * 0.3 + vWPos.y * 0.5));
      albedo *= mix(0.55, 1.0, smoothstep(-1.5, -0.6, vWPos.y));  // algae line at the waterline
      albedo *= 1.0 - uWet * 0.3;
      diffuseColor.rgb = albedo;
      roughnessFactor = mix(0.85, 0.4, uWet);
    `,
  });
}

// ------------------------------------------------------------------ ground
// 256x256 tiling lawn microstructure for grass seen up close (cut cow grass from above): R blade light and shade, G
// blade height, B clump density, A clover and broadleaf weeds. Periodic throughout, so it tiles seamlessly.
let _grassTex = null;
function grassDetail() {
  const N = 256, lum = new Float32Array(N * N), hgt = new Float32Array(N * N), weed = new Float32Array(N * N), px = new Uint8Array(N * N * 4);
  let seed = 9071; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const h = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
  const vn = (x, y, p) => { // periodic value noise with period p cells
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const c = (a, b) => h(((a % p) + p) % p, ((b % p) + p) % p);
    return (c(xi, yi) * (1 - u) + c(xi + 1, yi) * u) * (1 - v) + (c(xi, yi + 1) * (1 - u) + c(xi + 1, yi + 1) * u) * v;
  };
  const wrap = v => ((Math.floor(v) % N) + N) % N;
  // blades: short strokes in every direction, lit towards the tip; the gaps between them are the shaded thatch below
  for (let k = 0; k < 7000; k++) {
    const x0 = rnd() * N, y0 = rnd() * N, a = rnd() * Math.PI * 2, len = 5 + rnd() * 10, shade = 0.5 + rnd() * 0.5;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let t = 0; t <= len; t += 0.5) {
      const i = wrap(y0 + sa * t) * N + wrap(x0 + ca * t), f = t / len;
      lum[i] = Math.max(lum[i], shade * (0.65 + 0.35 * f)); hgt[i] = Math.max(hgt[i], 0.4 + 0.6 * f);
    }
  }
  // clover / broadleaf rosettes in a few loose colonies
  for (let k = 0; k < 26; k++) {
    const cx = rnd() * N, cy = rnd() * N, n = 3 + Math.floor(rnd() * 9);
    for (let q = 0; q < n; q++) {
      const lx = cx + (rnd() - 0.5) * 30, ly = cy + (rnd() - 0.5) * 30, r = 1.8 + rnd() * 2.6;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.hypot(dx, dy) / r; if (d < 1) { const i = wrap(ly + dy) * N + wrap(lx + dx); weed[i] = Math.max(weed[i], 1 - d * d); } }
    }
  }
  let mean = 0; for (let i = 0; i < N * N; i++) mean += lum[i]; mean /= N * N;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, o = i * 4;
    px[o] = Math.round(Math.min(1, Math.max(0, 0.5 + (lum[i] - mean) * 0.85)) * 255);
    px[o + 1] = Math.round(hgt[i] * 255);
    px[o + 2] = Math.round(Math.min(1, Math.max(0, 0.5 + (vn(x / 32, y / 32, 8) - 0.5) * 0.9 + (vn(x / 8, y / 8, 32) - 0.5) * 0.4)) * 255);
    px[o + 3] = Math.round(weed[i] * 255);
  }
  const t = new THREE.DataTexture(px, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  t.userData.releaseSource = true; t.name = 'grassDetail';
  return t;
}

// shore: the variant for ground cells that touch water (it discards water pixels so the bay shows through); the main
// land variant has no discard, so the GPU's early depth test skips it wherever roads, pavements or buildings cover it
export function createGroundMaterial(maskTex, meta, { shore = true } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.0 });
  const sizeW = meta.w * meta.res, sizeH = meta.h * meta.res;
  return patch(mat, {
    key: shore ? 'ground-v8-shore' : 'ground-v8',
    uniforms: { ...COMMON_U(), ...STREET_U(), uMask: { value: maskTex }, uMaskOrigin: { value: new THREE.Vector2(meta.xmin, meta.zmin) }, uMaskSize: { value: new THREE.Vector2(sizeW, sizeH) }, uGrass: { value: _grassTex || (_grassTex = grassDetail()) } },
    vertexHead: COMMON_VHEAD, vertexBody: COMMON_VBODY,
    fragHead: COMMON_HEAD + STREET_GLSL + `uniform sampler2D uMask; uniform vec2 uMaskOrigin; uniform vec2 uMaskSize; uniform sampler2D uGrass;
// The mask's R/G/B channels hold class codes (water R < 0.63; park 1.0, woods 0.71, pitch 0.39 in G; plaza 1.0,
// sidewalk 0.86, car park 0.78, building apron 0.59 in B) and A each texel's signed distance to the edge of its own
// class, +-GSMAX m over 0..1 (tools/ground-sdf.mjs, whose classOf() groundClass() mirrors): 0 water, 1 vegetation,
// 2 plaza, 3 sidewalk, 4 car park, 5 apron, 6 pitch, 7 bare ground
const float GSMAX = 3.0;
float groundClass(vec3 c) {
  if (c.r < 0.6255) return 0.0;
  if (c.g > 0.547) return 1.0;
  if (c.b > 0.4373) return c.b > 0.951 ? 2.0 : c.b > 0.8294 ? 3.0 : c.b > 0.7471 ? 4.0 : 5.0;
  return c.g > 0.194 ? 6.0 : 7.0;
}
// what a class covers the ground with: x vegetation (lawn, woods or pitch), y pitch turf, z paving
vec3 classCover(float c) { return vec3(c == 1.0 || c == 6.0 ? 1.0 : 0.0, c == 6.0 ? 1.0 : 0.0, c > 1.5 && c < 5.5 ? 1.0 : 0.0); }
// a paving class's code in the B channel (what the paving branch shades by)
float classB(float c) { return c < 2.5 ? 1.0 : c < 3.5 ? 0.86 : c < 4.5 ? 0.78 : 0.59; }
// share of the pixel footprint [x - w, x + w] inside [lo, hi]: crisp up close, a band's faint average once sub-pixel
float bandF(float x, float lo, float hi, float w) { return clamp((min(hi, x + w) - max(lo, x - w)) / (2.0 * w), 0.0, 1.0); }`,
    fragAfterEmissive: `normal = bumpNormal(normal, bh, vViewPosition);
      if (uNight > 0.02) totalEmissiveRadiance += diffuseColor.rgb * lampLight(wp, camD);`,
    fragAfterMetal: /* glsl */`
      float bh = 0.0;
      float camD = distance(cameraPosition, vWPos);
      float fnear = 1.0 - smoothstep(12.0, 60.0, camD);
      vec2 wp = vWPos.xz, dwx = dFdx(wp), dwy = dFdy(wp);
      vec2 muv = (wp - uMaskOrigin) / uMaskSize;
      vec4 m = texture2D(uMask, muv);
      bool outside = muv.x < 0.0 || muv.y < 0.0 || muv.x > 1.0 || muv.y > 1.0;
      float g = outside ? 0.5 : m.g, b = outside ? 0.5 : m.b;
      float n1 = fbm3(wp * 0.07);
      float edgeN = (vnoise(wp * 0.9) - 0.5) * 0.12 + (vnoise(wp * 3.7) - 0.5) * 0.05;
      // What covers the ground (cv: x vegetation, y pitch turf, z paving; bc the paving's code). Far away, where a pixel
      // spans texels: the filtered, mip-mapped mask, its class borders soft and a little ragged. Nearer: the four
      // surrounding texels' classes and edge distances (see groundClass), which put a class edge where the map has it,
      // straight or curved, crisp to the pixel, and say how far this pixel is from it for the kerbs, edging courses and
      // quay coping drawn along it (edgeK: 1 a kerb seen from the paving, -1 from the verge, 2 a joint between two
      // pavings, 3 the water's edge; edgeD metres from the edge; edgeW the pixel's half-width across it). Read
      // everywhere, not only where the filtered mask varies across the pixel quad: the GPU's filter weights come in
      // steps, so such a test comes and goes in rings near every class border (a dot lattice over sidewalks and plazas)
      vec3 cv = vec3(smoothstep(0.36, 0.42, g + edgeN), 0.0, b > 0.4 && g < 0.55 ? smoothstep(0.44, 0.5, b + edgeN) : 0.0);
      cv.y = cv.x * (1.0 - smoothstep(0.42, 0.62, g + edgeN));
      float bc = b, edgeK = 0.0, edgeD = 9.0, edgeW = 0.01;
      bool wet = !outside && m.r < 0.627;
      if (!outside) {
        ivec2 msz = textureSize(uMask, 0);
        vec2 tc = muv * vec2(msz) - 0.5;
        float crisp = 1.0 - smoothstep(0.8, 1.6, max(length(dwx), length(dwy)) * float(msz.x) / uMaskSize.x); // texels a pixel
        if (crisp > 0.0) {
          ivec2 t0 = clamp(ivec2(floor(tc)), ivec2(0), msz - 2);
          vec2 tf = clamp(tc - vec2(t0), 0.0, 1.0);
          vec4 q00 = texelFetch(uMask, t0, 0), q10 = texelFetch(uMask, t0 + ivec2(1, 0), 0), q01 = texelFetch(uMask, t0 + ivec2(0, 1), 0), q11 = texelFetch(uMask, t0 + ivec2(1, 1), 0);
          vec4 L = vec4(groundClass(q00.rgb), groundClass(q10.rgb), groundClass(q01.rgb), groundClass(q11.rgb));
          vec4 S = (vec4(q00.a, q10.a, q01.a, q11.a) - 0.5) * (2.0 * GSMAX);
          vec4 lw = vec4((1.0 - tf.x) * (1.0 - tf.y), tf.x * (1.0 - tf.y), (1.0 - tf.x) * tf.y, tf.x * tf.y);
          // per corner class: its texels' distances counted +, the others' - (between two classes a straight edge comes
          // back exactly); the best is the class here, the best of the rest the one across the nearest edge
          vec4 f = vec4(dot(lw, S * (2.0 * vec4(equal(L, L.xxxx)) - 1.0)), dot(lw, S * (2.0 * vec4(equal(L, L.yyyy)) - 1.0)),
                        dot(lw, S * (2.0 * vec4(equal(L, L.zzzz)) - 1.0)), dot(lw, S * (2.0 * vec4(equal(L, L.wwww)) - 1.0)));
          float cA = L.x, fA = f.x;
          if (f.y > fA) { cA = L.y; fA = f.y; }
          if (f.z > fA) { cA = L.z; fA = f.z; }
          if (f.w > fA) { cA = L.w; fA = f.w; }
          vec4 fo = mix(vec4(-1e3), f, vec4(notEqual(L, vec4(cA))));
          float fB = max(max(fo.x, fo.y), max(fo.z, fo.w));
          float cB = fB < -500.0 ? cA : fB == fo.x ? L.x : fB == fo.y ? L.y : fB == fo.z ? L.z : L.w;
          vec3 cc = classCover(cA);
          if (cB != cA) {
            // distance from the edge (half the gap between the two classes' fields) and the pixel's extent across it
            vec4 v = S * (vec4(equal(L, vec4(cA))) - vec4(equal(L, vec4(cB))));
            vec2 gd = vec2(mix(v.y - v.x, v.w - v.z, tf.y), mix(v.z - v.x, v.w - v.y, tf.x));
            gd /= max(length(gd), 1e-5);
            edgeW = max(0.5 * (abs(dot(dwx, gd)) + abs(dot(dwy, gd))), 1e-3);
            float d = 0.5 * (fA - fB);
            bool pavA = cA > 1.5 && cA < 5.5, pavB = cB > 1.5 && cB < 5.5;
            // lawn, pitch and bare earth meet along a ragged line
            if (!pavA && !pavB && cA != 0.0 && cB != 0.0) {
              float sh = (vnoise(wp * 0.9) - 0.5) * 0.9 + (vnoise(wp * 3.1) - 0.5) * 0.3;
              d += cA < cB ? sh : -sh;
              if (d < 0.0) { float t = cA; cA = cB; cB = t; d = -d; }
            }
            cc = mix(classCover(cB), classCover(cA), clamp(0.5 + d / (2.0 * edgeW), 0.5, 1.0));
            edgeD = d;
            edgeK = crisp < 0.5 ? 0.0 : cB == 0.0 ? 3.0 : pavA && pavB ? 2.0 : pavA ? 1.0 : pavB && cA != 0.0 ? -1.0 : 0.0;
          }
          cv = mix(cv, cc, crisp);
          bc = cA > 1.5 && cA < 5.5 ? classB(cA) : cB > 1.5 && cB < 5.5 ? classB(cB) : b;
          wet = crisp > 0.5 ? cA == 0.0 : wet;
        }
      }
      ${shore ? 'if (wet) discard;' : ''}
      float gv = cv.x, pavW = cv.z;
      vec3 col = vec3(0.17, 0.12, 0.08); float rgh = 0.95;
      // grass / dirt / pitches — skipped where paving covers the ground completely (most of the city floor)
      if (pavW < 0.999) {
        float n2 = vnoise(wp * 1.9), n3 = vnoise(wp * 0.21);
        // grass (Singapore: lush, cut cow grass) with dry patches
        vec3 grass = mix(vec3(0.06, 0.13, 0.022), vec3(0.1, 0.19, 0.035), n1) * (0.85 + 0.25 * n2);
        grass = mix(grass, vec3(0.16, 0.16, 0.07), smoothstep(0.62, 0.8, n3) * 0.5);
        // close up: blades, clumps and clover from the lawn texture at two scales and angles (no felt)
        float gnear = 1.0 - smoothstep(12.0, 42.0, camD);
        if (gnear > 0.0) {
          vec4 gt = texture2D(uGrass, wp * 1.1), gt2 = texture2D(uGrass, mat2(0.8, -0.6, 0.6, 0.8) * wp * 0.27 + 0.37);
          grass *= 1.0 + ((gt.r - 0.5) * 0.75 + (gt2.b - 0.5) * 0.45) * gnear;
          grass = mix(grass, vec3(0.045, 0.14, 0.035) * (0.75 + 0.6 * gt.r), max(gt.a, gt2.a * 0.8) * 0.65 * gnear);
          bh += (gt.g - 0.5) * 0.008 * gnear;
        }
        grass = mix(grass, grass * vec3(0.8, 1.15, 0.7), smoothstep(0.7, 0.8, vnoise(wp * 0.9 + 5.0)) * 0.5);
        vec3 pitch = mix(vec3(0.08, 0.2, 0.04), vec3(0.11, 0.26, 0.05), step(0.5, fract(wp.x * 0.1)));
        vec3 dirt = mix(vec3(0.17, 0.12, 0.08), vec3(0.12, 0.13, 0.06), n1);
        col = mix(dirt, grass, smoothstep(0.3, 0.6, n1 + 0.25));
        // (woods darker than lawn and a pitch's brighter turf fade across the filtered mask: switching per 2 m texel drew
        // squares wherever a stray pitch or woods texel sits in a lawn)
        vec3 lawn = grass * mix(0.75, 1.0, smoothstep(0.74, 0.97, g + edgeN * 1.5));
        col = mix(col, mix(lawn, pitch, cv.y / max(gv, 1e-3)), gv);
        // a verge along a kerb: a dark contact line, then patches of trodden earth for a hand's width
        if (edgeK < -0.5) col = mix(mix(col, vec3(0.1, 0.075, 0.05) * (0.8 + 0.4 * n1), bandF(edgeD, 0.0, 0.25, edgeW) * smoothstep(0.35, 0.75, vnoise(wp * 2.7)) * 0.5), vec3(0.02, 0.016, 0.012), bandF(edgeD, 0.0, 0.035, edgeW));
      }
      // paving channel
      if (pavW > 0.0) {
        vec3 pav;
        float stain = smoothstep(0.6, 0.74, fbm3(wp * 0.33 + 4.0));
        if (bc > 0.95) { // plaza granite: 600 mm tiles, speckled, occasional darker accent courses, thin grout
          float region = hash12(floor(wp / 60.0));
          vec2 tsz = region > 0.5 ? vec2(0.6) : vec2(0.6, 0.3);
          vec2 tp = wp / tsz, tid = floor(tp);
          float jt = jointMask(fract(tp) * tsz, tsz, 0.004);
          float hv = hash12(tid);
          vec3 light = region > 0.3 ? vec3(0.2, 0.192, 0.178) : vec3(0.215, 0.2, 0.17);
          pav = mix(light, vec3(0.11, 0.108, 0.105), step(0.88, hv) * step(0.45, region)) * (0.78 + 0.32 * hash12(tid + 3.0));
          // accent bands of dark granite every few courses
          pav = mix(pav, vec3(0.09, 0.088, 0.085), step(region, 0.25) * step(mod(tid.y, 7.0), 0.5));
          float sf = cellFade(wp, 108.0);
          pav *= 1.0 + (sf > 0.0 ? speckle(wp, 60.0) - 0.5 : 0.0) * 0.55 * sf;
          pav *= 1.0 - 0.32 * stain - 0.15 * smoothstep(0.4, 0.8, vnoise(wp * 0.06 + 2.0));
          pav = mix(pav, pav * 0.4, jt);
          bh += (hv - 0.5) * 0.001 - jt * 0.003;
          rgh = 0.6 - 0.12 * hv;
        } else if (bc > 0.83) { // sidewalk pavers: bond varies by neighbourhood
          float region = hash12(floor(wp / 140.0) + 0.5);
          float style = region < 0.42 ? 0.0 : region < 0.72 ? 1.0 : region < 0.88 ? 3.0 : 2.0;
          float jt, pid;
          pavers(wp, style, pav, jt, pid);
          float gf2 = cellFade(wp, 72.0);
          pav *= 1.0 + (gf2 > 0.0 ? speckle(wp, 40.0) - 0.5 : 0.0) * 0.25 * gf2;
          pav *= 1.0 - 0.28 * stain;
          pav = mix(pav, pav * 0.35 + vec3(0.012, 0.011, 0.009), jt);
          bh += (pid - 0.5) * 0.0015 * cellFade(wp, 10.0) - jt * 0.004;
          rgh = 0.78 - 0.08 * pid;
        } else if (bc > 0.75) { // car park asphalt with oil drips
          float cf = cellFade(wp, 50.0);
          pav = vec3(0.06, 0.06, 0.065) * (0.8 + 0.3 * n1) * (1.0 + (cf > 0.0 ? stones(wp, 36.0) - 0.5 : 0.0) * 0.55 * cf);
          pav *= 1.0 - 0.4 * smoothstep(0.66, 0.74, vnoise(wp * 0.7 + 9.0));
          rgh = 0.9;
        } else { // building apron: cast concrete slabs with saw-cut joints, water stains
          vec2 tp = wp / 1.5; float jt = jointMask(fract(tp) * 1.5, vec2(1.5), 0.005);
          pav = vec3(0.18, 0.176, 0.165) * (0.82 + 0.25 * n1) * (0.85 + 0.2 * hash12(floor(tp)));
          pav *= 1.0 - 0.35 * stain - 0.2 * smoothstep(0.45, 0.85, vnoise(wp * 0.08 + 7.0));
          pav = mix(pav, pav * 0.55, jt); bh -= jt * 0.003; rgh = 0.85;
        }
        // up close: material grain from a small tiling texture. Everywhere: the city wear map — soil and leaf litter
        // round tree bases, foot polish along shop fronts, at crossing kerbs and bus stops — and a few re-laid patches
        if (fnear > 0.0) { vec3 pd = texture2D(uPave, wp / 1.7).rgb; pav *= 1.0 + (pd.r - 0.5) * 0.32 * fnear; bh += (pd.g - 0.5) * 0.0014 * fnear; rgh += (pd.b - 0.5) * 0.16 * fnear; }
        vec2 wr = texture2D(uWear, (wp - uWearOrigin) / uWearSize).rg;
        float mott = 0.55 + 0.9 * vnoise(wp * 1.3);
        pav = mix(pav, vec3(0.045, 0.036, 0.026), clamp(wr.r * mott, 0.0, 1.0) * 0.72);
        pav = mix(pav, pav * 1.1 + 0.008, wr.g * 0.45); rgh -= wr.g * 0.22 * (0.6 + 0.4 * mott);
        float relaid = step(hash12(floor(wp / 3.0) + 91.7), 0.03);
        pav = mix(pav, pav * vec3(1.13, 1.11, 1.07) + 0.006, relaid * 0.8);
        col = mix(col, pav, pavW);
        bh *= pavW;
      }
      if (edgeK > 0.5) {
        if (edgeK < 1.5) { // precast concrete kerb on the paving side, a dark contact line at the grass
          float k = bandF(edgeD, 0.0, 0.15, edgeW);
          col = mix(col, vec3(0.36, 0.352, 0.33) * (0.85 + 0.3 * vnoise(wp * 5.0)), k);
          col = mix(col, vec3(0.02, 0.016, 0.012), bandF(edgeD, 0.0, 0.02, edgeW));
          bh += k * 0.012; rgh = mix(rgh, 0.8, k);
        } else if (edgeK < 2.5) { // a course of dark granite edging where one paving meets another
          float k = bandF(edgeD, 0.0, 0.07, edgeW);
          col = mix(col, vec3(0.1, 0.097, 0.092) * (0.85 + 0.3 * vnoise(wp * 7.0)), k); bh -= k * 0.002; rgh = mix(rgh, 0.6, k);
        } else { // the quay's pale granite coping (as at the Merlion), a dark arris on the water side
          float k = bandF(edgeD, 0.0, 0.75, edgeW);
          vec3 gr = vec3(0.4, 0.388, 0.36) * (0.86 + 0.22 * hash12(floor(wp * 0.9))) * (1.0 + (fnear > 0.0 ? speckle(wp, 40.0) - 0.5 : 0.0) * 0.4 * fnear);
          col = mix(col, gr, k);
          col = mix(col, col * 0.45, bandF(edgeD, 0.0, 0.025, edgeW) + bandF(edgeD, 0.75, 0.77, edgeW) * 0.6);
          bh += k * 0.01; rgh = mix(rgh, 0.62, k);
        }
      }
      float puddle = uWet > 0.01 ? smoothstep(0.6, 0.66, n1) * uWet * step(0.5, pavW) : 0.0;
      col *= mix(1.0, 0.65, uWet);
      col = mix(col, col * 0.5, puddle);
      rgh = mix(rgh, mix(0.35, 0.03, puddle), uWet * step(0.5, pavW));
      bh *= 1.0 - puddle;
      diffuseColor.rgb = col;
      roughnessFactor = rgh;
    `,
  });
}
