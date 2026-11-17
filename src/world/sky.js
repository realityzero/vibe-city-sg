// Time-of-day sky (Preetham scattering + clouds + stars + moon + urban glow), sun/moon light with shadows,
// fog/haze matched to the horizon, and a PMREM environment (sky + fake skyline) for reflections.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { U } from '../gfx/globals.js';
import { HF } from '../gfx/heightfield.js';
import { LIT } from '../gfx/materials.js';

const LAT = 1.29 * Math.PI / 180;
const DEC = -11.5 * Math.PI / 180; // late October

export function sunDirection(hours, out = new THREE.Vector3()) {
  const H = (hours - 13.08) / 24 * Math.PI * 2;
  const E = -Math.cos(DEC) * Math.sin(H);
  const Nn = Math.sin(DEC) * Math.cos(LAT) - Math.cos(DEC) * Math.cos(H) * Math.sin(LAT);
  const Up = Math.sin(DEC) * Math.sin(LAT) + Math.cos(DEC) * Math.cos(H) * Math.cos(LAT);
  return out.set(E, Up, -Nn).normalize();
}

const EXTRA_HEAD = /* glsl */`
uniform float uNight; uniform float uRain; uniform float uEnv; uniform vec3 uMoonDir; uniform float uTimeS; uniform float uRainbow; uniform float uSkyGain; uniform vec4 uBolt;
uniform vec3 uFogCol; uniform float uCapture;
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;
const EXTRA_TAIL = /* glsl */`
  // ---- night: stars, moon, urban sky glow (orange/purple light pollution)
  {
    float up = max(direction.y, 0.0);
    // sodium/LED light pollution: warm orange-pink dome low over the city, fading to a deep blue zenith
    vec3 glow = mix(vec3(0.011, 0.0074, 0.0068), vec3(0.0012, 0.0016, 0.0042), smoothstep(0.0, 0.35, up)) * (1.0 + uRain * 1.5);
    vec3 nightCol = glow;
    vec2 sp = vec2(atan(direction.z, direction.x) * 120.0, direction.y * 240.0);
    vec2 cell = floor(sp); vec2 f = fract(sp) - 0.5;
    float star = h21(cell);
    float tw = 0.6 + 0.4 * sin(uTimeS * 3.0 + star * 60.0);
    float sMask = step(0.985, star) * smoothstep(0.12, 0.0, length(f)) * smoothstep(0.05, 0.35, up) * (1.0 - uRain);
    nightCol += vec3(0.9, 0.95, 1.0) * sMask * 0.08 * tw;
    float md = dot(direction, normalize(uMoonDir + vec3(0.0, 1e-4, 0.0)));
    nightCol += vec3(0.85, 0.9, 1.0) * smoothstep(0.99993, 0.99996, md) * 0.6 * (1.0 - uRain * 0.8);
    nightCol += vec3(0.25, 0.3, 0.4) * pow(max(md, 0.0), 400.0) * 0.02;
    texColor += nightCol * uNight;
  }
  // daylight sky radiance relative to the sunlit city (Preetham at our exposure read as white paper near the horizon)
  texColor *= uSkyGain;
  // humid horizon haze: the low sky away from the sun is a pale blue-grey, not white (sun-side glow is kept)
  {
    float lowSky = 1.0 - smoothstep(0.0, 0.42, max(direction.y, 0.0));
    float awaySun = 1.0 - smoothstep(0.55, 0.95, dot(direction, vSunDirection));
    float k = lowSky * awaySun * (1.0 - uNight) * (1.0 - uRain * 0.7);
    texColor *= mix(vec3(1.0), vec3(0.74, 0.82, 0.95), k);
  }
  // ---- golden hour and dusk. Preetham alone keeps a deep, saturated blue dome until the sun touches the horizon,
  // then goes black within minutes. A low sun warms and softens the dome (a longer path through the humid air), lays
  // a gold-to-orange glow along its side of the horizon and the rose Belt of Venus along the other; once it has set,
  // a deep blue twilight dome (dimming ~4x per 5 deg of sun depression) with an ember band where it went down.
  float sunSide = 0.0;
  if (vSunDirection.y < 0.34 && vSunDirection.y > -0.3) { // (the same for every pixel: no cost by day or at night)
    float se = vSunDirection.y, up = max(direction.y, 0.0);
    float azS = dot(normalize(direction.xz + vec2(1e-5)), normalize(vSunDirection.xz + vec2(1e-5)));
    float gold = smoothstep(0.34, 0.04, se) * smoothstep(-0.07, 0.0, se) * (1.0 - uRain);
    sunSide = pow(azS * 0.5 + 0.5, 3.0) * exp(-up * 4.0) * gold;
    float lum = dot(texColor, vec3(0.3, 0.45, 0.25));
    texColor = mix(texColor, lum * vec3(1.2, 0.95, 0.86), gold * (0.75 - 0.4 * smoothstep(0.0, 0.7, up)));
    vec3 glowTint = mix(vec3(2.0, 0.78, 0.3), vec3(1.7, 1.02, 0.5), smoothstep(-0.02, 0.2, se));
    texColor *= mix(vec3(1.0), glowTint, sunSide);
    float belt = pow(max(-azS, 0.0), 1.5) * smoothstep(0.0, 0.05, up) * exp(-up * 7.0) * gold;
    texColor *= mix(vec3(1.0), vec3(1.4, 0.92, 1.05), belt);
    float depth = max(-se, 0.0);
    float tw = smoothstep(0.03, -0.01, se) * (1.0 - uRain * 0.6);
    float Z = 0.12 * exp(-depth * 16.0) * tw;
    vec3 dome = vec3(0.15, 0.28, 0.85) * mix(1.7, 1.0, smoothstep(0.0, 0.45, up)) + vec3(0.12, 0.05, 0.12) * (1.0 - smoothstep(0.0, 0.2, up));
    vec3 ember = vec3(1.0, 0.4, 0.14) * pow(azS * 0.5 + 0.5, 4.0) * exp(-up * (7.0 + depth * 50.0)) * 3.0;
    texColor += (dome + ember) * Z;
    sunSide = max(sunSide, pow(azS * 0.5 + 0.5, 4.0) * exp(-up * 6.0) * tw * smoothstep(-0.16, -0.02, se));
  }
  // the horizon dissolves into the haze the city is fogged with (uFogCol: this sky's own colour a little higher up,
  // averaged around the horizon), so there is no line where the sea plane or the farthest towers end
  if (uCapture < 0.5 && direction.y < 0.1) {
    float hb = 1.0 - smoothstep(-0.02, 0.1, direction.y); hb *= hb;
    texColor = mix(texColor, uFogCol, hb * (1.0 - 0.7 * sunSide));
  }
  // rain: overcast grey
  float lum = dot(texColor, vec3(0.3, 0.59, 0.11));
  texColor = mix(texColor, vec3(lum) * vec3(0.9, 0.95, 1.0) * 0.38, uRain * 0.85);
  // environment capture: replace below-horizon with ground and fake skyline so glass reflects a city
  if (uEnv > 0.5) {
    float az = atan(direction.z, direction.x);
    float blk = floor(az * 24.0);
    float hgt = 0.02 + 0.32 * pow(h21(vec2(blk, 3.0)), 3.0) + 0.06 * h21(vec2(blk, 7.0));
    float day = 1.0 - uNight;
    if (direction.y < hgt) {
      float lit = step(0.6, h21(floor(vec2(az * 400.0, direction.y * 300.0))));
      vec3 bcol = mix(vec3(0.07, 0.075, 0.08), vec3(0.24, 0.24, 0.23), h21(vec2(blk, 1.0))) * (0.04 + 0.96 * day);
      bcol += vec3(1.0, 0.75, 0.45) * lit * uNight * 0.05;
      texColor = mix(texColor, bcol, smoothstep(hgt, hgt - 0.004, direction.y));
    }
    if (direction.y < 0.0) texColor = mix(texColor, vec3(0.10, 0.092, 0.08) * (0.04 + 0.96 * day) + vec3(0.02, 0.012, 0.006) * uNight, smoothstep(0.0, -0.05, direction.y));
  }
  // lightning: the whole cloud deck lights up blue-white, and a jagged bolt (with a side branch) drops from the
  // cloud base to the horizon at the strike azimuth. uBolt = (azimuth, seed, flash, distance factor)
  if (uBolt.z > 0.001 && uEnv < 0.5) {
    float up = max(direction.y, 0.0);
    texColor += vec3(0.55, 0.6, 0.8) * 0.06 * uBolt.z * (0.4 + 0.6 * smoothstep(0.0, 0.25, up)) * uBolt.w;
    float az = atan(direction.z, direction.x);
    float el = asin(clamp(direction.y, -1.0, 1.0));
    float top = 0.26;
    if (el > -0.01 && el < top) {
      float t = el / top;
      // midpoint-displacement-ish zigzag from summed hashes
      float j = 0.0, amp = 0.05;
      for (int i = 0; i < 4; i++) { float fq = pow(2.0, float(i)) * 6.0; float c = floor(t * fq); float fr = fract(t * fq); j += amp * mix(h21(vec2(c, uBolt.y + float(i))), h21(vec2(c + 1.0, uBolt.y + float(i))), fr) - amp * 0.5; amp *= 0.5; }
      float x = uBolt.x + j * (0.4 + 0.6 * (1.0 - t));
      float dA = abs(mod(az - x + 3.14159, 6.28318) - 3.14159) * cos(el);
      float w = 0.0012 * (0.35 + uBolt.w);
      float core = smoothstep(w, 0.0, dA) * 6.0 + exp(-dA / (w * 6.0)) * 0.8;
      // side branch from 60% height
      if (t < 0.6 && t > 0.2) { float xb = x + (0.6 - t) * 0.25 * (h21(vec2(uBolt.y, 9.0)) > 0.5 ? 1.0 : -1.0); float dB = abs(az - xb) * cos(el); core += smoothstep(w * 0.7, 0.0, dB) * 3.0 * smoothstep(0.2, 0.4, t); }
      texColor += vec3(0.85, 0.88, 1.0) * core * uBolt.z * 0.5 * uBolt.w;
    }
  }
  // rainbow after a tropical downpour: primary bow at ~42 deg around the antisolar point
  if (uRainbow > 0.001 && uEnv < 0.5) {
    float ang = degrees(acos(clamp(dot(direction, -normalize(vSunDirection)), -1.0, 1.0)));
    float t = (ang - 40.3) / 2.2;
    float band = smoothstep(-0.35, 0.05, t) * (1.0 - smoothstep(0.95, 1.35, t)) * smoothstep(0.0, 0.1, direction.y);
    float h = clamp(1.0 - t, 0.0, 1.0) * 0.78;
    vec3 rb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    texColor *= 1.0 + rb * band * uRainbow * 0.55;
    texColor *= 1.0 + smoothstep(0.0, -0.4, t) * smoothstep(0.0, 0.1, direction.y) * uRainbow * 0.08; // brighter inside the bow
  }
  // half-float safety: a single NaN/Inf texel poisons the PMREM and the bloom chain
  if (any(isnan(texColor)) || any(isinf(texColor))) texColor = vec3(0.0);
  texColor = min(texColor, vec3(6.0e4));
  // haze capture (SkySystem.captureHaze): log2-encoded into an 8-bit target, 2^-12..2^4
  if (uCapture > 0.5) texColor = clamp((log2(max(texColor, vec3(2.5e-4))) + 12.0) / 16.0, 0.0, 1.0);
`;

// Tropical sky: fair-weather cumulus (billowy cells, sun-lit tops, flat grey bases, self-shadowing via a 2-tap march
// toward the sun) on a low layer, wispy cirrus high up, both fading into the haze at the horizon. Rain thickens the
// cumulus into an overcast deck.
const CLOUDS = /* glsl */`
      if ( direction.y > -0.02 && cloudCoverage > 0.0 ) {
        float dy = max(direction.y, 0.0);
        float dayFactor = smoothstep( -0.08, 0.3, vSunDirection.y );
        vec3 sunColor = vSunE * Fex * 0.22 * 0.04;
        vec3 skyAmbient = Lin * 0.04 + vec3( 0.0, 0.0003, 0.00075 );
        float drift = time * cloudSpeed * 300.0;
        // ---- cumulus layer (~1.5 km): plane projection, softened at the horizon
        vec2 P = direction.xz / ( dy + 0.045 ) * 4.2 + time * cloudSpeed * 900.0;
        float cov = clamp( cloudCoverage, 0.0, 1.0 );
        // macro distribution: clusters and clear patches
        float macro = noise( P * 0.11 + 7.3 ) * 0.5 + 0.5;
        // rounded cumulus bodies (fbm lobes) eroded by fine billows at the edges -> cauliflower outlines
        float shape = fbm( P * 0.42, drift ) * 0.5 + 0.5;
        vec2 q = P * 1.9; float bil = 0.0, amp = 0.5;
        for ( int i = 0; i < 3; i ++ ) { bil += amp * ( 1.0 - abs( noise( q ) ) ); amp *= 0.5; q = q * 2.11 + vec2( drift * 0.9, -drift * 0.5 ) + 3.1; }
        float field = shape * 1.15 + macro * 0.75 + cov * 1.1 - 1.62 - ( 0.55 - bil ) * 0.35;
        float dens = smoothstep( 0.0, 0.22, field ); // soft, billowy edges (0.14 read as flat cut-outs)
        // light march: density a little way toward the sun -> darker where thick cloud lies sunward
        vec2 sd = normalize( vSunDirection.xz + vec2( 1e-4 ) ) * 0.5;
        float shape2 = fbm( ( P + sd ) * 0.42, drift ) * 0.5 + 0.5;
        float macro2 = noise( ( P + sd ) * 0.11 + 7.3 ) * 0.5 + 0.5;
        float occl = max( 0.0, shape2 * 1.15 + macro2 * 0.75 + cov * 1.1 - 1.62 + 0.08 );
        float light = exp( -occl * 5.0 );
        // thick cores have darker flat bases; thin edges glow (forward scattering toward the sun)
        float core = smoothstep( 0.1, 0.55, field );
        float cosT = dot( direction, vSunDirection );
        float silver = pow( max( cosT, 0.0 ), 8.0 ) * ( 1.0 - core ) * 1.6;
        vec3 baseCol = skyAmbient * 1.15 + sunColor * 0.18;
        vec3 litCol = skyAmbient * 0.7 + sunColor * 1.25;
        vec3 cloudColor = mix( baseCol, litCol, light * ( 1.0 - core * 0.55 ) ) + sunColor * silver;
        // rain: heavy grey overcast
        cloudColor = mix( cloudColor, vec3( dot( cloudColor, vec3( 0.33 ) ) ) * 0.55, clamp( ( cov - 0.6 ) * 2.0, 0.0, 1.0 ) );
        cloudColor *= max( dayFactor, 0.035 );
        // low sun: the cumulus deck catches the light longer than the ground — peach to rose, brighter than the sky
        float cGold = smoothstep( 0.3, 0.05, vSunDirection.y ) * smoothstep( -0.1, 0.0, vSunDirection.y );
        if ( cGold > 0.0 ) cloudColor = mix( cloudColor, vec3( 1.0, 0.52, 0.4 ) * dot( texColor, vec3( 0.3, 0.45, 0.25 ) ) * ( 1.2 + 1.6 * light * ( 1.0 - core * 0.4 ) ), cGold * 0.85 );
        // at night the cloud deck is lit from below by the city (orange-grey), thick bases glow most
        cloudColor += vec3( 0.019, 0.0128, 0.0105 ) * ( 1.0 - dayFactor ) * ( 0.55 + core * 0.6 ) * ( 1.0 + cov );
        float horizon = smoothstep( -0.01, 0.06, direction.y );
        float alpha = dens * horizon;
        // ---- cirrus (~9 km): stretched streaks, very thin
        vec2 C = direction.xz / ( dy + 0.12 ) * 0.5 + time * cloudSpeed * 1500.0;
        vec2 Cs = vec2( C.x * 0.35 + C.y * 0.2, C.y * 1.6 - C.x * 0.3 );
        float cir = smoothstep( 0.15, 0.85, fbm( Cs * 1.3, drift * 0.3 ) * 0.5 + 0.35 + ( noise( C * 0.2 + 1.7 ) * 0.25 ) );
        float cirA = cir * 0.16 * smoothstep( 0.02, 0.2, direction.y ) * ( 1.0 - clamp( ( cov - 0.55 ) * 2.5, 0.0, 1.0 ) );
        vec3 cirCol = ( skyAmbient * 0.9 + sunColor * ( 0.9 + pow( max( cosT, 0.0 ), 4.0 ) * 1.2 ) ) * max( dayFactor, 0.035 );
        texColor = mix( texColor, mix( texColor, cirCol, clamp( dot( Fex, vec3( 0.3, 0.45, 0.25 ) ) * 0.8 + 0.2, 0.0, 1.0 ) ), cirA );
        // grey (not per-channel) aerial mix: per-channel extinction tinted cloud edges purple against the low sun
        vec3 cloudAerial = mix( texColor, cloudColor, clamp( dot( Fex, vec3( 0.3, 0.45, 0.25 ) ) * 1.4, 0.0, 1.0 ) );
        texColor = mix( texColor, cloudAerial, alpha );
      }
`;

export class SkySystem {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.time = 18.0;
    this.rain = 0;
    this.turbBase = 3.2; this.rayleighBase = 1.5; // humid tropical haze, but not a white-paper sky
    this.skyGain = 0.8; this.skyGainU = { value: 1 };
    this.boltU = { value: new THREE.Vector4() }; this.lightning = 0;
    { const qs = new URLSearchParams(location.search); if (qs.get('skygain')) this.skyGain = +qs.get('skygain'); if (qs.get('turb')) this.turbBase = +qs.get('turb'); } // look-dev
    this.rainbowU = { value: 0 };
    this.peakRain = 0; this.rainbowT = 0;
    this.sun = new THREE.Vector3();
    this.moon = new THREE.Vector3(0, -1, 0);

    const makeSky = (env) => {
      const sky = new Sky();
      const m = sky.material;
      m.uniforms.uNight = U.night; m.uniforms.uRain = U.rain; m.uniforms.uEnv = { value: env ? 1 : 0 };
      m.uniforms.uMoonDir = { value: this.moon }; m.uniforms.uTimeS = U.time; m.uniforms.uRainbow = this.rainbowU; m.uniforms.uSkyGain = this.skyGainU; m.uniforms.uBolt = this.boltU;
      m.uniforms.uFogCol = U.fogColor; m.uniforms.uCapture = { value: 0 };
      // swap the stock single-layer cloud sheet for tropical cumulus + cirrus (see CLOUDS)
      let fs = m.fragmentShader;
      const c0 = fs.indexOf('// Clouds'), c1 = fs.indexOf('gl_FragColor = vec4( texColor, 1.0 );');
      if (c0 > 0 && c1 > c0) fs = fs.slice(0, c0) + CLOUDS + '\n' + fs.slice(c1);
      m.fragmentShader = EXTRA_HEAD + fs.replace('gl_FragColor = vec4( texColor, 1.0 );', EXTRA_TAIL + '\ngl_FragColor = vec4( texColor, 1.0 );');
      m.uniforms.turbidity.value = 3.0; m.uniforms.rayleigh.value = 1.5; m.uniforms.mieCoefficient.value = 0.0042; m.uniforms.mieDirectionalG.value = 0.78;
      m.uniforms.cloudCoverage.value = 0.38; m.uniforms.cloudDensity.value = 0.5; m.uniforms.cloudScale.value = 0.00022; m.uniforms.cloudSpeed.value = 0.00003; m.uniforms.cloudElevation.value = 0.55;
      sky.scale.setScalar(20000);
      sky.frustumCulled = false;
      return sky;
    };
    this.sky = makeSky(false);
    // drawn AFTER the opaque city (the Sky shader puts it on the far plane, so it only fills pixels nothing else
    // covered). Drawn first, its cloud raymarch ran for every pixel on screen and was then painted over: ~4 ms.
    this.sky.renderOrder = 0.5;
    scene.add(this.sky);

    this.envScene = new THREE.Scene();
    this.envSky = makeSky(true);
    this.envSky.material.uniforms.showSunDisc.value = 0;
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.lastEnvTime = -100;
    this.lastEnvRain = -1;

    // lights
    this.dir = new THREE.DirectionalLight(0xffffff, 3);
    this.dir.castShadow = true;
    this.dir.shadow.mapSize.set(2048, 2048);
    const sc = this.dir.shadow.camera; sc.near = 10; sc.far = 1400; sc.left = -170; sc.right = 170; sc.top = 170; sc.bottom = -170;
    this.dir.shadow.bias = -0.0004; this.dir.shadow.normalBias = 0.25; // small enough that cars, feet and columns keep their contact shadow
    this.shadowRadius = 170;
    scene.add(this.dir); scene.add(this.dir.target);
    this.hemi = new THREE.HemisphereLight(0xbfd9ff, 0x4a4a40, 0.5);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xbcc8d6, 0.00045);
    this.fogClear = 0.00025; this.fogBase = this.fogClear; // (HAZESEASON raises it)
    // haze colour = the sky's own colour around the horizon (captureHaze), eased toward each new capture
    this.haze = new THREE.Color(0.42, 0.5, 0.62); this.hazeTarget = this.haze.clone(); this._hc = new THREE.Color(); this._hazeSnap = true; this._hazeId = 0;
    this.exposure = 1;
    this._c = new THREE.Color();
  }

  setShadowQuality(size, radius) {
    // only reallocate when the resolution really changes (draw-distance/shadow toggles call this too)
    if (this.dir.shadow.mapSize.x !== size || this.dir.shadow.mapSize.y !== size) {
      this.dir.shadow.mapSize.set(size, size);
      this.dir.shadow.map?.dispose(); this.dir.shadow.map = null;
    }
    this.shadowRadius = radius;
    const sc = this.dir.shadow.camera; sc.left = -radius; sc.right = radius; sc.top = radius; sc.bottom = -radius; sc.updateProjectionMatrix();
  }

  update(dt, focus /* Vector3 */) {
    const t = this.time;
    sunDirection(t, this.sun);
    sunDirection(t + 12.4, this.moon);
    const sunY = this.sun.y;
    // night factor: 0 when sun > 6°, 1 when sun < -8°
    const night = THREE.MathUtils.smoothstep(-sunY, -0.1, 0.14);
    U.night.value = night;
    U.sunDir.value.copy(this.sun);
    this.skyGainU.value = THREE.MathUtils.lerp(this.skyGain, 1, night);
    const skyU = this.sky.material.uniforms, envU = this.envSky.material.uniforms;
    for (const u of [skyU, envU]) {
      u.sunPosition.value.copy(this.sun).multiplyScalar(450000);
      u.time.value = U.time.value;
      u.cloudCoverage.value = 0.38 + this.rain * 0.6;
      u.cloudDensity.value = 0.5 + this.rain * 0.5;
      u.turbidity.value = this.turbBase + this.rain * 6;
      u.rayleigh.value = this.rayleighBase;
    }
    // rainbow when a real downpour clears while the sun is up and fairly low
    this.peakRain = Math.max(this.peakRain * Math.exp(-dt / 300), this.rain);
    if (this.peakRain > 0.5 && this.rain < 0.12 && sunY > 0.04 && sunY < 0.6 && this.rainbowT <= 0) { this.rainbowT = 140; this.peakRain = 0; }
    if (this.rainbowT > 0) this.rainbowT -= dt;
    const rbTarget = this.rainbowT > 0 ? Math.min(1, this.rainbowT / 20) * (1 - this.rain * 3) : 0;
    this.rainbowU.value += (Math.max(0, rbTarget) - this.rainbowU.value) * Math.min(1, dt * 0.5);
    // directional light: sun by day, moon by night
    const useSun = sunY > -0.04;
    const ld = useSun ? this.sun : this.moon;
    const elev = Math.max(0.0, ld.y);
    if (useSun) {
      // colour temperature through the afternoon: ~5800 K high up, ~4000 K at 10 deg, ~2600 K at 3 deg (a long
      // path through humid air); the low sun also loses some strength, so golden hour is warm, not noon-bright
      const warm = THREE.MathUtils.smoothstep(sunY, -0.02, 0.4);
      this._c.setRGB(1.0, 0.36 + 0.58 * warm, 0.12 + 0.76 * warm);
      this.dir.color.copy(this._c);
      this.dir.intensity = 5.2 * THREE.MathUtils.smoothstep(sunY, -0.03, 0.1) * THREE.MathUtils.lerp(0.72, 1, THREE.MathUtils.smoothstep(sunY, 0.05, 0.4)) * (1 - this.rain * 0.85);
    } else {
      this.dir.color.setRGB(0.55, 0.65, 1.0);
      this.dir.intensity = 0.13 * THREE.MathUtils.smoothstep(this.moon.y, 0.0, 0.2) * (1 - this.rain * 0.9);
    }
    U.sunColor.value.copy(this.dir.color).multiplyScalar(this.dir.intensity);
    // shadow camera follows focus, snapped to texels to avoid shimmering
    const r = this.shadowRadius;
    const texel = (2 * r) / this.dir.shadow.mapSize.x;
    const L = (this._L || (this._L = new THREE.Vector3())).copy(ld).setY(Math.max(ld.y, 0.12)).normalize();
    // snap in the shadow camera's own right/up basis (world X/Z snapping still shimmers as the camera follows a car)
    const SX = this._sx || (this._sx = new THREE.Vector3()), SY = this._sy || (this._sy = new THREE.Vector3()), F = this._sf || (this._sf = new THREE.Vector3());
    SX.set(L.z, 0, -L.x).normalize(); SY.crossVectors(L, SX);
    F.set(focus.x, 0, focus.z);
    const px = F.dot(SX), py = F.dot(SY);
    F.addScaledVector(SX, Math.round(px / texel) * texel - px).addScaledVector(SY, Math.round(py / texel) * texel - py);
    this.dir.target.position.copy(F);
    HF.shadowCenter.value.copy(F); HF.shadowR.value = r; // the height field takes over the sun shadow beyond this box
    this.dir.position.set(F.x + L.x * 700, F.y + L.y * 700, F.z + L.z * 700);
    this.dir.target.updateMatrixWorld();
    // The sun never stops casting (castShadow is part of every lit program's key: switching it at dusk recompiled ~40
    // programs on the spot); its shadows fade out with it and, once it is down, the shadow map is no longer rendered.
    const shadowI = THREE.MathUtils.smoothstep(this.dir.intensity, 0.03, 0.12);
    this.dir.shadow.intensity = shadowI;
    this.dir.shadow.autoUpdate = shadowI > 0;
    if (shadowI > 0 && !this._shadowLive) this.dir.shadow.needsUpdate = true; // first frame after sunrise
    this._shadowLive = shadowI > 0;

    // hemisphere / ambient
    const day = 1 - night;
    // day: blue sky / warm ground bounce; night: sodium-orange urban glow from below, dim blue above
    // a low sun: the sky fill weakens and turns blue-violet against the warm sun (golden-hour contrast, not noon light)
    const lowSun = (1 - THREE.MathUtils.smoothstep(sunY, 0.02, 0.32)) * day * (1 - this.rain);
    this.hemi.color.setRGB(THREE.MathUtils.lerp(0.45, 0.87, day), THREE.MathUtils.lerp(0.5, 0.92, day), THREE.MathUtils.lerp(0.85, 1.0, day)).lerp(this._hc.setRGB(0.6, 0.62, 1.0), lowSun * 0.6);
    this.hemi.groundColor.setRGB(THREE.MathUtils.lerp(0.9, 0.42, day), THREE.MathUtils.lerp(0.55, 0.36, day), THREE.MathUtils.lerp(0.3, 0.28, day));
    this.hemi.intensity = (0.05 + 0.55 * day * (1 - 0.2 * lowSun)) * (1 - this.rain * 0.3) + night * 0.09 + this.rain * 0.12 * day + this.lightning * 2.2;

    // fog = haze: the horizon sky's colour (golden at sunset, blue at dusk, city glow at night, grey in rain), so
    // distant towers and the sea fade into the sky instead of into a darker band under it
    this.haze.lerp(this.hazeTarget, Math.min(1, dt * 0.6));
    const fog = this.haze;
    this.scene.fog.color.copy(fog);
    this.scene.fog.density = this.fogBase * (1 + this.rain * 2.5);
    U.fogColor.value.copy(fog); U.fogDensity.value = this.scene.fog.density;

    // window lighting schedules (fraction of windows lit)
    const h = t;
    const officeSched = h < 6 ? 0.1 : h < 8 ? 0.3 : h < 18 ? 0.6 : h < 21 ? 0.55 - (h - 18) * 0.1 : h < 24 ? 0.25 - (h - 21) * 0.04 : 0.12;
    const resiSched = h < 5 ? 0.06 : h < 7 ? 0.2 : h < 18 ? 0.12 : h < 23 ? 0.5 : 0.28;
    LIT.office.value = officeSched * Math.max(night, 0.0) + (1 - night) * 0.0;
    LIT.resi.value = resiSched * night;

    // exposure: brighter at night (eye adaptation)
    this.exposure = THREE.MathUtils.lerp(0.62, 1.38, night) * (1 + this.rain * 0.12);

    // env map refresh when sun moved enough or rain changed
    if (Math.abs(t - this.lastEnvTime) > 0.12 || Math.abs(this.rain - this.lastEnvRain) > 0.08) this.refreshEnv();
    this.scene.environmentIntensity = 0.5 * (1 + this.rain * 0.2);
    U.iblDiffuse.value = (0.9 + 0.1 * night) * (1 + this.rain * 0.1);
    U.iblSpec.value = 1.0;
  }

  // called by Weather every frame: flash strength 0..1 and the current strike (azimuth/seed/distance) or null
  setLightning(f, strike) {
    this.lightning = f;
    const b = this.boltU.value;
    if (strike) b.set(strike.az, strike.seed, f, THREE.MathUtils.clamp(1.6 - strike.dist / 4000, 0.3, 1.4)); else b.z = 0;
  }

  refreshEnv() {
    // make sure the capture uses the current sun/moon (callers may have just changed the time)
    sunDirection(this.time, this.sun); sunDirection(this.time + 12.4, this.moon);
    U.night.value = THREE.MathUtils.smoothstep(-this.sun.y, -0.1, 0.14);
    const eu = this.envSky.material.uniforms;
    eu.sunPosition.value.copy(this.sun).multiplyScalar(450000);
    eu.cloudCoverage.value = 0.38 + this.rain * 0.6; eu.cloudDensity.value = 0.5 + this.rain * 0.5; eu.turbidity.value = this.turbBase + this.rain * 6; eu.rayleigh.value = this.rayleighBase;
    if (Math.abs(this.time - this.lastEnvTime) > 0.5 || Math.abs(this.rain - this.lastEnvRain) > 0.3) this._hazeSnap = true; // a jump, not the clock
    this.lastEnvTime = this.time; this.lastEnvRain = this.rain;
    this.captureHaze();
    const prevFog = this.scene.fog;
    const rt = this.pmrem.fromScene(this.envScene, 0, 1, 30000, { size: 128 });
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.fog = prevFog;
  }

  // The haze colour: the sky (without lightning or rainbow) at 6.5 deg elevation in 8 directions, rendered one
  // pixel each into an 8x1 target (log-encoded, see EXTRA_TAIL) and read back asynchronously — no GPU stall. By day
  // it is paled and warmed a little: humid tropical air scatters white, not Rayleigh blue.
  captureHaze() {
    const r = this.renderer;
    const rt = this._hazeRT || (this._hazeRT = new THREE.WebGLRenderTarget(8, 1, { type: THREE.UnsignedByteType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: false }));
    const cam = this._hazeCam || (this._hazeCam = new THREE.PerspectiveCamera(1, 1, 1, 30000));
    const u = this.envSky.material.uniforms, bolt = this.boltU.value.z, rainbow = this.rainbowU.value, prevRT = r.getRenderTarget(), autoClear = r.autoClear;
    u.uEnv.value = 0; u.uCapture.value = 1; this.boltU.value.z = 0; this.rainbowU.value = 0; r.autoClear = false;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      cam.lookAt(Math.cos(a), 0.114, Math.sin(a)); cam.updateMatrixWorld();
      rt.viewport.set(i, 0, 1, 1); r.setRenderTarget(rt); r.render(this.envScene, cam);
    }
    u.uEnv.value = 1; u.uCapture.value = 0; this.boltU.value.z = bolt; this.rainbowU.value = rainbow; r.autoClear = autoClear;
    r.setRenderTarget(prevRT);
    const id = ++this._hazeId, px = new Uint8Array(32), sunY = this.sun.y, sunAz = Math.atan2(this.sun.z, this.sun.x);
    r.readRenderTargetPixelsAsync(rt, 0, 0, 8, 1, px).then(() => {
      if (id !== this._hazeId) return; // a newer capture is on its way
      // weighted geometric mean (of the log-encoded texels), the sun's side counting least: a sunset glow belongs to
      // its own patch of sky (the sky shader keeps it there), not to haze all round the horizon
      const c = [0, 0, 0]; let ws = 0;
      for (let i = 0; i < 8; i++) {
        const w = 1 - 0.7 * Math.max(0, Math.cos(i * Math.PI / 4 - sunAz)); ws += w;
        for (let k = 0; k < 3; k++) c[k] += px[i * 4 + k] * w;
      }
      for (let k = 0; k < 3; k++) c[k] /= ws;
      const T = this.hazeTarget.setRGB(...c.map(v => 2 ** (v / 255 * 16 - 12)));
      const l = 0.2126 * T.r + 0.7152 * T.g + 0.0722 * T.b, pale = 0.65 * THREE.MathUtils.smoothstep(sunY, 0.12, 0.4);
      T.lerp(this._hc.setRGB(l * 1.08, l, l * 0.86), pale);
      if (this._hazeSnap) { this.haze.copy(T); this._hazeSnap = false; }
    }).catch(() => { }); // (a lost readback keeps the last haze colour; the next env refresh tries again)
  }
}
