// World vehicle spawns (GTA-style "always there" rides): rooftop & ground helipads, jet skis and boats on
// Marina Bay / Singapore River, a few hero cars parked at landmarks. Respawn when taken and the player leaves.
import * as THREE from 'three';
import { Vehicle } from '../entities/vehicle.js';
import { Boat } from '../entities/boat.js';
import { Aircraft } from '../entities/aircraft.js';
import { WATER_LEVEL } from '../core/constants.js';
import { VEHICLE_SPECS } from '../entities/vehicles/index.js';

function helipadTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#2b3236'; g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#f2f2f2'; g.lineWidth = 22; g.beginPath(); g.arc(256, 256, 200, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = '#ffd23f'; g.lineWidth = 8; g.beginPath(); g.arc(256, 256, 236, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#f2f2f2'; g.font = 'bold 260px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', 256, 270);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export class Spawns {
  constructor(game) {
    this.game = game;
    this.slots = [];
    this.padTex = helipadTexture();
    const city = game.city;
    // ---- helipads
    const roof = this.findRooftopPad(267, 332, 450);
    if (roof) this.addPad(roof.pos, roof.yaw, 'heli');
    const ground = this.findGroundPad(1450, -560);
    if (ground) this.addPad(ground, 0, 'heli_police_free');
    // ---- boats
    // moored alongside the quay, close enough to step aboard from dry land
    const berth = (x, z, type, r = 140) => { const b = this.findBerth(x, z, type, r); if (b) this.slots.push({ kind: 'boat', type, pos: b.pos, yaw: b.yaw }); };
    berth(520, 310, 'speedboat');
    berth(560, 250, 'jetski');
    berth(1150, 170, 'jetski');
    berth(-330, -330, 'bumboat', 90);
    // ---- parked hero cars
    const park = (x, z, type, color) => { const n = game.roadnet.nearestLane(x, z, 120, l => l.cls <= 6); if (n) this.slots.push({ kind: 'car', type, color, pos: n.pos.clone(), yaw: Math.atan2(-n.dir.x, -n.dir.z) }); };
    park(1305, 330, 'infernus', 0xf7f7f4);
    park(612, -860, 'stinger', 0xc8141c);
    park(-386, 380, 'bike', 0xe2187f);
    park(-640, 870, 'sedan', 0xc9ccd0);
    for (const s of this.slots) this.spawn(s);
    this.t = 0;
  }

  findWater(x, z, r) {
    const c = this.game.city;
    let best = null, bd = Infinity;
    for (let dz = -r; dz <= r; dz += 4) for (let dx = -r; dx <= r; dx += 4) {
      const px = x + dx, pz = z + dz;
      let ok = true;
      // open water: a 16 m clear disc
      for (let a = 0; a < 12 && ok; a++) for (const rr of [0, 8, 16]) if (!c.isWater(px + Math.cos(a / 12 * 6.283) * rr, pz + Math.sin(a / 12 * 6.283) * rr)) { ok = false; break; }
      if (!ok) continue;
      // but reachable: some shore within 30 m
      let shore = false; for (let a = 0; a < 16 && !shore; a++) if (!c.isWater(px + Math.cos(a / 16 * 6.283) * 28, pz + Math.sin(a / 16 * 6.283) * 28)) shore = true;
      if (!shore) continue;
      const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = new THREE.Vector3(px, WATER_LEVEL, pz); }
    }
    return best;
  }
  // heading with the longest run of open water (so a fresh boat doesn't face the seawall)
  /** a mooring for `type` near (x,z): the hull (plus a margin) all on water and parallel to the shore, with a clear
   * dry spot on the quay within boarding reach of the hull — or null */
  findBerth(x, z, type, r) {
    const c = this.game.city, spec = VEHICLE_SPECS[type], L = spec.length / 2 + 1.5, W = spec.width / 2 + 1.2;
    const reach = 5.5 + spec.length * 0.25; // Player boards boats from up to 7.5 m (+ length/4) away
    // solid quay: the physics ground (a conservative 4 m height field) sits back from the drawn waterline, so the
    // standing spot must have real ground under it, not just land in the mask
    const P = this.game.physics, solid = (x, z) => { const h = P.raycast({ x, y: 6, z }, { x: 0, y: -1, z: 0 }, 12); return h && h.point.y > -0.25; };
    let best = null, bd = Infinity;
    for (let dz = -r; dz <= r; dz += 3) for (let dx = -r; dx <= r; dx += 3) {
      const px = x + dx, pz = z + dz, d2 = dx * dx + dz * dz;
      if (d2 >= bd || !c.isWater(px, pz)) continue;
      // nearest land direction
      let nd = Infinity, na = 0;
      for (let a = 0; a < 24; a++) { const ang = a / 24 * Math.PI * 2, cx = Math.cos(ang), cz = Math.sin(ang); for (let t = 1; t <= reach; t += 0.75) if (!c.isWater(px + cx * t, pz + cz * t)) { if (t < nd) { nd = t; na = ang; } break; } }
      if (nd > reach || nd < W + 0.3) continue;
      // hull parallel to the shore: along = perpendicular to the land direction
      const ax = -Math.sin(na), az = Math.cos(na), sx = Math.cos(na), sz = Math.sin(na);
      let ok = true;
      for (let u = -L; u <= L && ok; u += 1.5) for (const v of [-W, 0, W - 0.3]) if (!c.isWater(px + ax * u + sx * v, pz + az * u + sz * v)) { ok = false; break; }
      if (!ok) continue;
      let t = nd + 0.8; while (t < reach && !solid(px + sx * t, pz + sz * t)) t += 0.5;
      if (t >= reach) continue;
      const land = new THREE.Vector3(px + sx * (t + 0.6), 0, pz + sz * (t + 0.6));
      if (this.game.safe && !this.game.safe.clear(land.x, land.z, { pad: 0.2 })) continue;
      bd = d2; best = { pos: new THREE.Vector3(px, WATER_LEVEL, pz), yaw: Math.atan2(-ax, -az) };
    }
    return best;
  }

  openYaw(p) {
    const c = this.game.city; let by = 0, bl = -1;
    for (let a = 0; a < 24; a++) {
      const yaw = a / 24 * Math.PI * 2, dx = -Math.sin(yaw), dz = -Math.cos(yaw);
      let l = 0; while (l < 300 && c.isWater(p.x + dx * l, p.z + dz * l)) l += 4;
      if (l > bl) { bl = l; by = yaw; }
    }
    return by;
  }

  findRooftopPad(cx, cz, radius) {
    const g = this.game, P = g.physics;
    const cands = [];
    for (const b of g.city.data.buildings) {
      if (b.h < 120 || b.h > 260 || b.r) continue;
      const pts = []; for (let i = 0; i < b.p.length; i += 2) pts.push([b.p[i], b.p[i + 1]]);
      let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } x /= pts.length; z /= pts.length;
      if (Math.hypot(x - cx, z - cz) > radius) continue;
      cands.push({ b, x, z, pts });
    }
    cands.sort((a, b) => b.b.h - a.b.h);
    for (const c of cands) {
      // probe a grid on the roof for a flat 14x14 m clear area (lift-motor rooms excluded by the flatness test)
      const top = c.b.h;
      for (let ox = -24; ox <= 24; ox += 6) for (let oz = -24; oz <= 24; oz += 6) {
        const px = c.x + ox, pz = c.z + oz;
        let y0 = null, flat = true;
        for (const [dx, dz] of [[0, 0], [7, 7], [-7, 7], [7, -7], [-7, -7], [7, 0], [-7, 0], [0, 7], [0, -7]]) {
          const h = P.raycast({ x: px + dx, y: top + 30, z: pz + dz }, { x: 0, y: -1, z: 0 }, 60);
          if (!h) { flat = false; break; }
          if (y0 == null) y0 = h.point.y; else if (Math.abs(h.point.y - y0) > 0.15) { flat = false; break; }
        }
        if (flat && y0 > top - 3) return { pos: new THREE.Vector3(px, y0, pz), yaw: 0 };
      }
    }
    return null;
  }
  findGroundPad(x, z) {
    const c = this.game.city;
    for (let r = 0; r < 300; r += 8) for (let a = 0; a < 16; a++) {
      const px = x + Math.cos(a / 16 * Math.PI * 2) * r, pz = z + Math.sin(a / 16 * Math.PI * 2) * r;
      if (c.maskAt(px, pz, 1) > 200 && !c.isWater(px, pz)) {
        const h = this.game.physics.raycast({ x: px, y: 60, z: pz }, { x: 0, y: -1, z: 0 }, 70);
        if (h && h.point.y < 0.3) return new THREE.Vector3(px, 0, pz);
      }
    }
    return null;
  }
  addPad(pos, yaw, type) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(8, 48), new THREE.MeshStandardMaterial({ map: this.padTex, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    m.rotation.x = -Math.PI / 2; m.position.copy(pos).add(new THREE.Vector3(0, 0.06, 0)); m.receiveShadow = true;
    this.game.scene.add(m);
    this.slots.push({ kind: 'air', type: type === 'heli_police_free' ? 'heli_police' : 'heli', pos: pos.clone(), yaw, free: true });
  }

  spawn(s) {
    const g = this.game;
    let v;
    if (s.kind === 'boat') v = new Boat(g, s.type, { position: s.pos, yaw: s.yaw ?? this.openYaw(s.pos) });
    else if (s.kind === 'air') v = new Aircraft(g, s.type, { position: s.pos.clone().add(new THREE.Vector3(0, 0.05, 0)), yaw: s.yaw });
    else { v = new Vehicle(g, s.type, { position: s.pos, yaw: s.yaw, color: s.color }); v.setDriverControls({ throttle: 0, brake: 0, steer: 0, handbrake: true }, 0.016); }
    g.vehicles.push(v);
    s.v = v;
  }

  update(dt) {
    this.t -= dt; if (this.t > 0) return; this.t = 2;
    const g = this.game, P = g.player.position;
    for (const s of this.slots) {
      const v = s.v;
      const taken = !v || !g.vehicles.includes(v) || v.position.distanceTo(s.pos) > 25 || v.exploded;
      if (!taken) continue;
      // respawn when the player is far from the slot and not driving that vehicle
      if (P.distanceTo(s.pos) > 160 && g.player.vehicle !== v) {
        if (v && g.vehicles.includes(v) && (v.exploded || v.position.distanceTo(P) > 200)) { g.vehicles.splice(g.vehicles.indexOf(v), 1); v.dispose(); }
        this.spawn(s);
      }
    }
  }

  blips() { return this.slots.filter(s => s.kind !== 'car' && s.v && s.v.position.distanceTo(s.pos) < 25).map(s => ({ x: s.pos.x, z: s.pos.z, type: 'vehicle', label: s.kind === 'air' ? 'Helicopter' : 'Boat' })); }
}
