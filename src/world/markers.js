// GTA-style mission markers: glowing translucent cylinders, floating arrows, checkpoint rings, pickups.
import * as THREE from 'three';
import { U } from '../gfx/globals.js';

const COLORS = { mission: 0xff3fa4, destination: 0xffd23f, checkpoint: 0x39f0ff, pickup: 0x7dff6a, enemy: 0xff4040, safehouse: 0x6ad1ff };

function beamMaterial(color) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true,
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: U.time, uAlpha: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uColor; uniform float uTime; uniform float uAlpha; varying vec2 vUv;
      void main(){ float a = pow(1.0 - vUv.y, 1.6) * 0.55; a *= 0.75 + 0.25 * sin(uTime * 3.0 + vUv.y * 10.0);
      float band = smoothstep(0.02, 0.0, abs(fract(vUv.y * 3.0 - uTime * 0.6) - 0.5) - 0.47);
      gl_FragColor = vec4(uColor * (1.5 + band * 1.5), (a + band * 0.15) * uAlpha); }`,
  });
}

export class Marker {
  constructor(scene, pos, { type = 'destination', radius = 1.6, height = 2.2, arrow = true, color } = {}) {
    this.scene = scene;
    this.type = type;
    this.color = color ?? COLORS[type] ?? COLORS.destination;
    this.radius = radius;
    this.group = new THREE.Group();
    this.group.position.copy(pos);
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 40, 1, true), beamMaterial(this.color));
    cyl.position.y = height / 2; cyl.renderOrder = 10;
    this.group.add(cyl);
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.92, radius, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(this.color).multiplyScalar(3), transparent: true, opacity: 0.9, side: THREE.DoubleSide, forceSinglePass: true, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08; this.group.add(ring);
    if (arrow) {
      const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(0.55, 0.7); shape.lineTo(0.22, 0.7); shape.lineTo(0.22, 1.4); shape.lineTo(-0.22, 1.4); shape.lineTo(-0.22, 0.7); shape.lineTo(-0.55, 0.7); shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false }); geo.translate(0, 0, -0.09);
      this.arrow = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: this.color, emissive: this.color, emissiveIntensity: 1.6, roughness: 0.4 }));
      this.arrow.position.y = height + 1.2;
      this.group.add(this.arrow);
    }
    this.cyl = cyl;
    scene.add(this.group);
  }
  get position() { return this.group.position; }
  update(dt) { if (this.arrow) { this.arrow.rotation.y += dt * 2; this.arrow.position.y = this.cyl.position.y * 2 + 1.2 + Math.sin(U.time.value * 3) * 0.25; } }
  dispose() { this.scene.remove(this.group); this.group.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); }
}

// big floating checkpoint ring for races / driving objectives
export class Checkpoint extends Marker {
  constructor(scene, pos, opts = {}) { super(scene, pos, { type: 'checkpoint', radius: opts.radius ?? 6, height: opts.height ?? 7, arrow: false, ...opts }); }
}

// spinning pickup (hidden packages: kaya toast!) — geometry/materials shared by all pickups
let PK = null;
const pickupAssets = () => PK || (PK = {
  bread: new THREE.MeshStandardMaterial({ color: 0xc8843c, roughness: 0.8, emissive: 0x3a2008, emissiveIntensity: 0.6 }),
  kaya: new THREE.MeshStandardMaterial({ color: 0x8fbf3a, roughness: 0.5, emissive: 0x2a4a08, emissiveIntensity: 0.8 }),
  slice: new THREE.BoxGeometry(0.5, 0.08, 0.45), spread: new THREE.BoxGeometry(0.46, 0.04, 0.41),
  glowGeo: new THREE.SphereGeometry(0.6, 16, 12),
  glowMat: new THREE.MeshBasicMaterial({ color: 0x9dff5a, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false }),
});
export class Pickup {
  constructor(scene, pos, { kind = 'kaya' } = {}) {
    this.scene = scene; this.kind = kind;
    const A = pickupAssets();
    this.group = new THREE.Group(); this.group.position.copy(pos);
    const toast = new THREE.Group();
    const b1 = new THREE.Mesh(A.slice, A.bread); b1.position.y = -0.06;
    const k = new THREE.Mesh(A.spread, A.kaya);
    const b2 = b1.clone(); b2.position.y = 0.06;
    toast.add(b1, k, b2);
    toast.rotation.z = 0.5;
    this.toast = toast;
    this.group.add(toast);
    const glow = new THREE.Mesh(A.glowGeo, A.glowMat);
    this.group.add(glow);
    this.group.position.y += 1;
    scene.add(this.group);
  }
  get position() { return this.group.position; }
  update(dt) { this.toast.rotation.y += dt * 2.5; this.group.position.y += Math.sin(U.time.value * 2.5) * 0.004; }
  dispose() { this.scene.remove(this.group); }
}
