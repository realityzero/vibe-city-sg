// Ambient pedestrians: GPU-instanced crowd walking the sidewalks, crossing at junctions, idling at hotspots,
// fleeing from reckless drivers and getting knocked over (no gore — they get back up, annoyed).
import * as THREE from 'three';
import { Crowd, randomLook } from './humanoid/index.js';
import { districtAt } from '../ui/index.js';

// who you meet where: CBD suits, Chinatown aunties & uncles, tourists at the bay, students around Bras Basah
const MIX = {
  'Downtown Core': [['office_m', 4], ['office_f', 4], ['male', 1], ['female', 1], ['tourist', 1]],
  'Raffles Place': [['office_m', 5], ['office_f', 4], ['tourist', 1]],
  'Tanjong Pagar': [['office_m', 3], ['office_f', 3], ['auntie', 1], ['uncle', 1], ['male', 1], ['female', 1]],
  'Chinatown': [['auntie', 3], ['uncle', 3], ['tourist', 3], ['male', 1], ['female', 1]],
  'Marina Bay': [['tourist', 5], ['male', 2], ['female', 2], ['office_m', 1]],
  'Marina Centre': [['tourist', 4], ['male', 2], ['female', 2], ['student', 1]],
  'Gardens by the Bay': [['tourist', 6], ['male', 1], ['female', 1]],
  'Bras Basah': [['student', 4], ['male', 2], ['female', 2], ['tourist', 1]],
  'Bugis': [['student', 3], ['male', 2], ['female', 3], ['auntie', 1]],
  'Kampong Glam': [['tourist', 3], ['male', 2], ['female', 2], ['uncle', 1]],
  'Clarke Quay': [['male', 3], ['female', 3], ['tourist', 3], ['office_m', 1]],
  'Boat Quay': [['office_m', 2], ['tourist', 3], ['male', 2], ['female', 2]],
  'Tiong Bahru': [['auntie', 3], ['uncle', 3], ['male', 2], ['female', 2]],
};
const DEFAULT_MIX = [['male', 3], ['female', 3], ['auntie', 1], ['uncle', 1], ['office_m', 1], ['office_f', 1], ['student', 1], ['tourist', 1]];
function pickVariant(x, z) {
  const mix = MIX[districtAt(x, z)] || DEFAULT_MIX;
  let tot = 0; for (const [, w] of mix) tot += w;
  let r = Math.random() * tot; for (const [v, w] of mix) { r -= w; if (r <= 0) return v; }
  return 'male';
}

const _p = new THREE.Vector3(), _d = new THREE.Vector3();

export class Pedestrians {
  constructor(game, { max = 160, radius = 170 } = {}) {
    this.game = game;
    this.net = game.roadnet;
    this.maxWalkers = max;
    this.max = max + 140; // extra capacity for posed scene crowds
    this.radius = radius;
    this.crowd = new Crowd(this.max, { lod: ['low', 'medium'].includes(game.R?.qualityName) ? 'low' : 'high' }); // low LOD = 45% fewer triangles
    this.crowd.mesh.layers?.enable?.(0);
    game.scene.add(this.crowd.mesh);
    this.peds = [];
    this.spawnT = 0;
    // sidewalk end connectivity
    const sws = this.net.sidewalks;
    this.ends = [];
    for (const sw of sws) {
      const P = sw.path, k = P.n - 1;
      sw.ends = [[P.x(0), P.z(0)], [P.x(k), P.z(k)]];
    }
    this.hotspots = (game.city.data.pois || []).filter(p => ['food_court', 'marketplace', 'mall', 'station', 'cafe', 'attraction', 'viewpoint', 'museum', 'restaurant'].includes(p.k)).map(p => ({ x: p.x, z: p.z }));
  }

  spawnOnSidewalk(pp) {
    const sws = this.net.sidewalksNear(pp.x, pp.z, this.radius);
    if (!sws.length) return null;
    const sw = sws[Math.floor(Math.random() * sws.length)];
    const s = Math.random() * sw.path.length;
    sw.path.sample(s, _p);
    const d = Math.hypot(_p.x - pp.x, _p.z - pp.z);
    if (d < 35 || d > this.radius) return null;
    if (this.game.city.isWater(_p.x, _p.z)) return null;
    return this.addPed({ sw, s, dir: Math.random() < 0.5 ? 1 : -1, pos: _p.clone() });
  }

  addPed(o) {
    if (this.peds.length >= this.max) return null;
    const ped = {
      sw: o.sw || null, s: o.s || 0, dir: o.dir || 1, pos: o.pos.clone(), yaw: 0, speed: 1.1 + Math.random() * 0.5, state: o.state || 'walk', t: 0,
      lat: (Math.random() - 0.5) * 2.2, phase: Math.random() * 10, look: randomLook(Math.floor(Math.random() * 1e6), pickVariant(o.pos.x, o.pos.z)), slot: -1,
      walkAnim: Math.random() < 0.22 ? 6 : 1, idleAnim: [0, 5, 12, 0][Math.floor(Math.random() * 4)],
      idleT: 0, target: null, knockT: 0, fleeFrom: null,
    };
    this.peds.push(ped);
    return ped;
  }

  // a stationary ped for scenes (seated diners, tourists taking photos...)
  addPose(d) {
    if (this.peds.length >= this.max) return null;
    const p = this.addPed({ pos: new THREE.Vector3(d.x, d.y || 0, d.z), state: 'pose' });
    if (!p) return null;
    p.pose = true; p.yaw = d.yaw; p.poseAnim = d.anim; p.look = randomLook(Math.floor(Math.random() * 1e6), d.variant || 'male');
    return p;
  }

  spawnFleeing(pos, from) {
    const p = this.addPed({ pos: pos.clone(), state: 'flee' });
    this.game.bark?.('carjacked', pos, 0);
    if (p) { p.fleeFrom = from.clone(); p.t = 6; p.speed = 5; }
    return p;
  }

  pickConnection(ped) {
    const sw = ped.sw; const end = ped.dir > 0 ? sw.ends[1] : sw.ends[0];
    const cands = this.net.sidewalksNear(end[0], end[1], 25).filter(o => o !== sw);
    let best = []; for (const o of cands) for (let k = 0; k < 2; k++) { const e = o.ends[k]; const d = Math.hypot(e[0] - end[0], e[1] - end[1]); if (d < 22) best.push({ o, k, d }); }
    if (!best.length) { ped.dir *= -1; return; }
    const c = best[Math.floor(Math.random() * best.length)];
    ped.sw = c.o; ped.dir = c.k === 0 ? 1 : -1; ped.s = c.k === 0 ? 0 : c.o.path.length;
    // walk straight to the start of the new sidewalk (crossing the junction)
    ped.target = new THREE.Vector3(c.o.ends[c.k][0], 0, c.o.ends[c.k][1]);
  }

  update(dt) {
    const game = this.game;
    const pp = game.player?.position || game.camera.position;
    const pv = game.player?.vehicle;
    // spawn
    this.spawnT -= dt;
    this.recenter = (this.recenter || 0) - dt; // after a relocation: fill the new streets quickly
    if (this.spawnT <= 0) { this.spawnT = 0.1; let walkers = 0; for (const p of this.peds) if (!p.pose) walkers++; for (let k = 0, n = this.recenter > 0 ? 14 : 3; k < n && walkers < this.maxWalkers; k++, walkers++) this.spawnOnSidewalk(pp); }
    const obstacles = game.traffic ? (game.traffic.obstacles = game.traffic.obstacles || []) : [];
    obstacles.length = 0;
    if (game.player) obstacles.push({ x: pp.x, z: pp.z, r: pv ? pv.spec.width * 0.6 : 0.5, player: true });
    const vSpeed = pv ? pv.speed : 0;
    let n = 0;
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      const dx = p.pos.x - pp.x, dz = p.pos.z - pp.z, dist = Math.hypot(dx, dz);
      if (dist > this.radius + 40 && !p.pose) { this.peds.splice(i, 1); continue; }
      // react to the player's vehicle
      if (pv && p.state !== 'knocked') {
        if (dist < pv.spec.length * 0.5 + 0.6 && vSpeed > 3.5) {
          p.state = 'knocked'; p.knockT = 2.6; p.yaw = Math.atan2(dx, dz);
          _d.set(dx, 0, dz).normalize().multiplyScalar(Math.min(6, vSpeed * 0.25)); p.pos.add(_d);
          game.audio?.sfx?.('punch', { position: p.pos, volume: 0.8 });
          game.events.emit('pedHit', p);
          game.bark?.('hit', p.pos, 1);
          game.wanted?.crime(1, 'Hit a pedestrian', p.pos); // only if police or a camera saw it
        } else if (dist < 14 && vSpeed > 9 && (p.state === 'walk' || p.state === 'pose') && Math.random() < dt * 3) { p.state = 'flee'; p.t = 4; p.fleeFrom = pp.clone(); if (dist < 8) game.bark?.('nearmiss', p.pos, 4); }
      }
      switch (p.state) {
        case 'walk': {
          if (p.target) {
            _d.subVectors(p.target, p.pos); _d.y = 0; const l = _d.length();
            if (l < 0.6) p.target = null; else { _d.multiplyScalar(1 / l); p.pos.addScaledVector(_d, p.speed * dt); p.yaw = Math.atan2(-_d.x, -_d.z); }
          } else if (p.sw) {
            p.s += p.dir * p.speed * dt;
            if (p.s < 0 || p.s > p.sw.path.length) { this.pickConnection(p); break; }
            p.sw.path.sample(p.s, _p, _d);
            const fx = _d.x * p.dir, fz = _d.z * p.dir;
            p.pos.set(_p.x + -fz * p.lat * 0.5, _p.y, _p.z + fx * p.lat * 0.5);
            p.yaw = Math.atan2(-fx, -fz);
            if (Math.random() < dt * 0.02) { p.state = 'idle'; p.idleT = 3 + Math.random() * 8; }
          }
          obstacles.push({ x: p.pos.x, z: p.pos.z, r: 0.4 });
          break;
        }
        case 'idle': p.idleT -= dt; if (p.idleT <= 0) p.state = 'walk'; break;
        case 'pose': break;
        case 'flee': {
          p.t -= dt;
          _d.subVectors(p.pos, p.fleeFrom || pp); _d.y = 0; _d.normalize();
          p.pos.addScaledVector(_d, 5.2 * dt); p.yaw = Math.atan2(-_d.x, -_d.z);
          if (p.t <= 0) { p.state = p.pose ? 'pose' : 'walk'; if (!p.sw && !p.pose) { this.peds.splice(i, 1); continue; } }
          break;
        }
        case 'knocked': p.knockT -= dt; if (p.knockT <= 0) { p.state = 'flee'; p.t = 5; p.fleeFrom = pp.clone(); } break;
      }
      // keep out of water & clamp to ground
      if (!p.pose) p.pos.y = Math.max(0, p.pos.y);
      const anim = p.state === 'pose' ? p.poseAnim : p.state === 'walk' ? (p.target ? 1 : p.walkAnim) : p.state === 'idle' ? p.idleAnim : p.state === 'flee' ? 3 : 4;
      const o = { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, anim, phase: p.phase, speed: p.state === 'flee' ? 5 : p.speed };
      if (p.slot !== n) { o.look = p.look; p.slot = n; }
      this.crowd.set(n++, o);
    }
    this.crowd.setCount(n);
    this.crowd.update(dt);
  }
}
