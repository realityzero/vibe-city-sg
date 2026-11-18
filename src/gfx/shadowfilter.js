// Sun shadow filtering for every material. r186's PCF turns a 5-tap Vogel disk by interleaved gradient noise per
// pixel, which only reads as soft once TAA averages it; without TAA it is a fixed dot pattern over every penumbra and
// leaf shadow (worst on a phone's ~4x upscale). This swaps it for a rotated 4-tap tent: four hardware-filtered taps
// (2x2 compares each) on a square turned by atan(1/2), whose projections on both texel axes are evenly spaced — edges
// get a smooth ~3-texel ramp with no per-pixel noise and no staircase along the map's texel rows. One tap fewer than
// three's, and no noise to compute.
// The map's box follows the view (shadowfit.js), so its shadows also fade out over the last SHADOW_EDGE of the box
// rather than stopping at a hard line; the city materials hand over to the height field across the same band.
import * as THREE from 'three';

export const SHADOW_EDGE = 0.05; // (in shadow-map uv)

// (the PCF getShadow's IGN-rotated Vogel disk; the shipped build has the chunk's comments stripped)
const STOCK = /float phi = interleavedGradientNoise\( gl_FragCoord\.xy \) \* PI2;\s*shadow = \(\s*texture\( shadowMap, vec3\( shadowCoord\.xy \+ vogelDiskSample\( 0, 5, phi \)[\s\S]*?vogelDiskSample\( 4, 5, phi \) \* radius, shadowCoord\.z \) \)\s*\) \* 0\.2;/;
const TENT = /* glsl */`shadow = (
					texture( shadowMap, vec3( shadowCoord.xy + vec2( 0.224, 0.671 ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vec2( -0.671, 0.224 ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vec2( -0.224, -0.671 ) * radius, shadowCoord.z ) ) +
					texture( shadowMap, vec3( shadowCoord.xy + vec2( 0.671, -0.224 ) * radius, shadowCoord.z ) )
				) * 0.25;
				vec2 boxEdge = min( shadowCoord.xy, 1.0 - shadowCoord.xy );
				shadow = mix( 1.0, shadow, smoothstep( 0.0, ${SHADOW_EDGE.toFixed(3)}, min( boxEdge.x, boxEdge.y ) ) );`;

const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
if (STOCK.test(chunk)) THREE.ShaderChunk.shadowmap_pars_fragment = chunk.replace(STOCK, TENT);
else console.warn('shadowfilter: three.js changed its PCF shadow chunk; sun shadows use the stock filter');
