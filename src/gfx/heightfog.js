// Height-dependent haze: replaces three's fog chunks for every material. The exp² fog keeps its shape, but its
// density thins with altitude (scale height FOG_H): the optical depth along the view ray is integrated through
// exp(-y / H) analytically. From the street it matches plain exp² fog; from a helicopter or the SkyPark the city below
// stays clearer, and tall towers rise out of the low humid haze instead of fading uniformly.
import * as THREE from 'three';

const FOG_H = 380.0;

THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
	varying float vFogDepth;
	varying float vFogDY;
#endif`;

THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogDY = (vec4(mvPosition.xyz, 0.0) * viewMatrix).y; // world-space rise from the camera to this vertex
#endif`;

THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying float vFogDY;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;

THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
	#ifdef FOG_EXP2
		// mean of exp(-y/H) between the camera height and the fragment height
		float fogA = vFogDY / ${FOG_H.toFixed(1)};
		float fogAvg = exp(-max(cameraPosition.y, 0.0) / ${FOG_H.toFixed(1)}) * (abs(fogA) < 1e-3 ? 1.0 - 0.5 * fogA : (1.0 - exp(-fogA)) / fogA);
		float fogOD = fogDensity * vFogDepth * fogAvg;
		float fogFactor = 1.0 - exp(-fogOD * fogOD);
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
