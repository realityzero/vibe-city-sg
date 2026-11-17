// Stunts: generic airtime bonuses for any vehicle jump, plus "unique stunt jumps" — ramps auto-placed on the
// banks of the Singapore River / Marina Bay inlets aimed at the far bank, with slow-motion cinematic replays.
import * as THREE from 'three';
import { FILTER } from '../physics/physics.js';

function chevronTex() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#1c1c1c'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#ffcf1a';
  for (let i = -2; i < 8; i++) { g.beginPath(); g.moveTo(0, i * 48); g.lineTo(128, i * 48 + 40); g.lineTo(256, i * 48); g.lineTo(256, i * 48 + 22); g.lineTo(128, i * 48 + 62); g.lineTo(0, i * 48 + 22); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export class Stunts {
  constructor(game) {
    this.game = game;
    this.ramps = [];
    this.air = null;
    this.done = new Set(game.progress.stunts || []);
    this.placeRamps();
  }

  // scan the shoreline for spots where a ramp can launch a car across a narrow stretch of water
  placeRamps() {
    const g = this.game, c = g.city, P = g.physics;
    const cands = [];
    for (const sw of g.roadnet.sidewalks) {
      if (cands.length > 400) break;
      const pts = sw.path; if (pts.n < 2) continue;
      for (let i = 0; i < pts.n; i += 3) {
        const x = pts.x(i), z = pts.z(i);
        for (let a = 0; a < 8; a++) {
          const dx = Math.cos(a / 8 * Math.PI * 2), dz = Math.sin(a / 8 * Math.PI * 2);
          // ramp end at (x,z) heading (dx,dz): land behind for 50 m, water gap of 16-34 m, land again
          let ok = true;
          for (let s = -50; s <= 4; s += 3) if (c.isWater(x + dx * s, z + dz * s)) { ok = false; break; }
          if (!ok) continue;
          let gapStart = -1, gapEnd = -1;
          for (let s = 4; s <= 48; s += 1.5) { const w = c.isWater(x + dx * s, z + dz * s); if (w && gapStart < 0) gapStart = s; if (!w && gapStart > 0) { gapEnd = s; break; } }
          if (gapStart < 0 || gapEnd < 0) continue;
          const gap = gapEnd - gapStart;
          if (gap < 14 || gap > 34 || gapStart > 12) continue;
          for (let s = gapEnd; s < gapEnd + 25; s += 3) if (c.isWater(x + dx * s, z + dz * s)) { ok = false; break; }
          if (!ok) continue;
          cands.push({ x, z, dx, dz, gap });
        }
      }
    }
    // spread out & verify no walls along the flight path
    const chosen = [];
    for (const k of cands.sort(() => Math.random() - 0.5)) {
      if (chosen.length >= 7) break;
      if (chosen.some(o => Math.hypot(o.x - k.x, o.z - k.z) < 350)) continue;
      const clear = [1.2, 4].every(h => !P.raycast({ x: k.x - k.dx * 40, y: h, z: k.z - k.dz * 40 }, { x: k.dx, y: 0, z: k.dz }, 40 + k.gap + 25));
      if (!clear) continue;
      chosen.push(k);
    }
    const mat = new THREE.MeshStandardMaterial({ map: chevronTex(), roughness: 0.6, metalness: 0.2 });
    for (const k of chosen) this.addRamp(k, mat);
  }

  addRamp(k, mat) {
    const g = this.game, P = g.physics, R = P.R;
    const L = 9, W = 4.2, H = 2.4;
    const yaw = Math.atan2(k.dx, k.dz);
    // wedge in local space: z from -L (ground) to 0 (top), x ±W/2
    const local = [[-W / 2, 0, -L], [W / 2, 0, -L], [-W / 2, 0, 0], [W / 2, 0, 0], [-W / 2, H, 0], [W / 2, H, 0]];
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const world = local.map(([x, y, z]) => [k.x + x * cos + z * sin, y, k.z - x * sin + z * cos]);
    const flat = new Float32Array(world.flat());
    const desc = R.ColliderDesc.convexHull(flat); if (!desc) return;
    P.world.createCollider(desc.setCollisionGroups(FILTER.static).setFriction(0.9));
    const geo = new THREE.BufferGeometry();
    const tri = [[0, 4, 1], [1, 4, 5], [0, 2, 4], [1, 5, 3], [2, 3, 4], [3, 5, 4]];
    const pos = [], uv = [];
    for (const t of tri) for (const i of t) { pos.push(...world[i]); uv.push(local[i][0] / W + 0.5, (local[i][2] + L) / L * 2 + local[i][1] * 0.2); }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; g.scene.add(m);
    const id = `ramp_${Math.round(k.x)}_${Math.round(k.z)}`;
    this.ramps.push({ id, x: k.x, z: k.z, dx: k.dx, dz: k.dz, gap: k.gap, top: new THREE.Vector3(k.x, H, k.z) });
  }

  blips() { return this.ramps.filter(r => !this.done.has(r.id)).map(r => ({ x: r.x, z: r.z, type: 'checkpoint', label: 'Unique stunt jump' })); }

  /** drop an in-flight jump (death, exit, teleport): restore time scale and the camera if the slow-mo cam had them */
  cancel() {
    const a = this.air; this.air = null;
    if (a?.slow) { const g = this.game; g.simScale = 1; g.ui.slowmo?.(false); g.cameraRig.override = null; }
  }

  update(dt) {
    const g = this.game, v = g.player.vehicle;
    if (!v || !v.vc) { this.cancel(); return; }
    const grounded = [0, 1, 2, 3].some(i => v.vc.wheelIsInContact(i));
    const p = v.position;
    if (!grounded) {
      if (!this.air) {
        const ramp = this.ramps.find(r => Math.hypot(p.x - r.x, p.z - r.z) < 7 && v.speed > 14);
        this.air = { t: 0, start: p.clone(), maxH: p.y, rot: 0, ramp, slow: false };
      }
      const a = this.air;
      a.t += dt; a.maxH = Math.max(a.maxH, p.y);
      const av = v.body.angvel(); a.rot += Math.hypot(av.x, av.z) * dt;
      if (a.ramp && a.t > 0.15 && !a.slow) {
        a.slow = true; g.simScale = 0.38; g.ui.slowmo?.(true);
        const side = new THREE.Vector3(-a.ramp.dz, 0, a.ramp.dx);
        a.cam = new THREE.Vector3(a.ramp.x + a.ramp.dx * (a.ramp.gap * 0.5 + 4) + side.x * 18, 6, a.ramp.z + a.ramp.dz * (a.ramp.gap * 0.5 + 4) + side.z * 18);
      }
      if (a.slow) g.cameraRig.override = { position: a.cam, lookAt: p.clone(), lerp: 8, fov: 50 };
      return;
    }
    const a = this.air; this.air = null;
    if (!a) return;
    if (a.slow) { g.simScale = 1; g.ui.slowmo?.(false); g.cameraRig.override = null; }
    const dist = Math.hypot(p.x - a.start.x, p.z - a.start.z), height = a.maxH - Math.min(a.start.y, p.y);
    if (a.t < 1.0 || (dist < 18 && height < 4)) return;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(v.quaternion);
    if (up.y < 0.5) { g.ui.toast('Stunt failed: landed on your roof. Very Vice City.'); return; }
    const flips = a.rot / (Math.PI * 2);
    let reward = Math.round(dist * 4 + height * 15 + flips * 300);
    let title = dist > 40 || height > 8 ? 'INSANE STUNT BONUS' : 'STUNT BONUS';
    if (a.ramp) {
      const crossed = (p.x - a.ramp.x) * a.ramp.dx + (p.z - a.ramp.z) * a.ramp.dz > a.ramp.gap;
      if (!crossed) { g.ui.toast('So close. The river says hi.'); return; }
      if (!this.done.has(a.ramp.id)) { this.done.add(a.ramp.id); g.progress.stunts = [...this.done]; title = 'UNIQUE STUNT BONUS'; reward += 1000; }
    }
    g.addMoney(reward);
    g.events.emit('stunt', { reward, dist, height, unique: title === 'UNIQUE STUNT BONUS' });
    g.audio?.sfx?.('stunt');
    const lines = [`Distance ${dist.toFixed(0)} m`, `Height ${height.toFixed(1)} m`, `Airtime ${a.t.toFixed(1)} s`]; if (flips > 0.4) lines.push(`Rotation ${Math.round(flips * 360)}°`);
    if (g.ui.stunt) g.ui.stunt.show({ title, lines, reward }); else g.ui.splash(`${title} S$${reward}`, '#ffd23f');
    if (title === 'UNIQUE STUNT BONUS') g.ui.toast(`Unique stunt jumps: ${this.done.size}/${this.ramps.length}`);
  }
}
