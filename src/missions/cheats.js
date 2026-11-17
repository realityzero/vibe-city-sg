// GTA-style cheat codes: type them during gameplay. Classic Vice City codes plus Singapore specials
// (DURIANRAIN drops physics durians from the sky, HAZESEASON brings the haze, SEAWAYS lets cars drive on Marina Bay...).
import * as THREE from 'three';
import { Vehicle } from '../entities/vehicle.js';
import { Boat } from '../entities/boat.js';
import { Aircraft } from '../entities/aircraft.js';
import { FILTER } from '../physics/physics.js';
import { WATER_LEVEL } from '../core/constants.js';

export const CHEATS = [
  { code: 'ASPIRINE', name: 'Full health', desc: 'Kopi-O kosong for the soul.' },
  { code: 'PRECIOUSPROTECTION', name: 'Full armour', desc: 'Body armour, the Vice City original.' },
  { code: 'LEAVEMEALONE', name: 'Clear wanted level', desc: 'The SPF suddenly has other priorities.' },
  { code: 'FINECITY', name: '+2 wanted stars', desc: 'Singapore is a fine city. You will be fined.' },
  { code: 'SHIOK', name: 'Spawn Infernus', desc: 'Shiok one.' },
  { code: 'CHOPPER', name: 'Spawn helicopter', desc: 'Get to da chopper.' },
  { code: 'JETSKI', name: 'Spawn jet ski', desc: 'Nearest water, instantly.' },
  { code: 'DURIANRAIN', name: 'Durian rain', desc: 'It is raining the king of fruits. Look up. Then run.' },
  { code: 'SEAWAYS', name: 'Cars drive on water', desc: 'Marina Bay is now a road.' },
  { code: 'COMEFLYWITHME', name: 'Floaty cars', desc: 'Low gravity for vehicles.' },
  { code: 'ALOVELYDAY', name: 'Sunny weather', desc: 'Tropical blue sky.' },
  { code: 'CATSANDDOGS', name: 'Thunderstorm', desc: '4pm, as usual.' },
  { code: 'HAZESEASON', name: 'Haze', desc: 'PSI 180. Wear an N95.' },
  { code: 'LIFEISPASSINGMEBY', name: 'Fast clock', desc: 'Time flies when you are disrupting.' },
  { code: 'BIGBANG', name: 'Launch nearby cars', desc: 'Everything around you takes flight. Pure physics, no injuries.' },
  { code: 'GREENLIGHT', name: 'All green lights', desc: 'The LTA has never been this chill.' },
  { code: 'KIASUDRIVERS', name: 'Aggressive traffic', desc: 'Everyone is late for a meeting.' },
  { code: 'STILLLIKEDRESSINGUP', name: 'Random outfit', desc: 'New look, same Tommy.' },
  { code: 'KACHING', name: '+S$250,000', desc: 'Pre-seed, post-vibes.' },
  { code: 'NIGHTOWL', name: 'Midnight', desc: 'Jump to 23:30 — the city lights up.' },
  { code: 'VICEVISION', name: 'Vibe Vision', desc: 'See Singapore the way Tommy remembers 1986.' },
];

export class Cheats {
  constructor(game) {
    this.game = game;
    this.buf = '';
    this.active = new Set();
    this.found = new Set(JSON.parse(localStorage.getItem('vibecity.cheats') || '[]'));
    this.durians = [];
    this.durianRain = 0;
    // capture phase: runs before the game's own key bindings so they can ignore keys that are part of a cheat being typed
    addEventListener('keydown', e => {
      if (e.__uiHandled || game.state !== 'play' || game.mgPaused || e.target?.closest?.('input,textarea,[contenteditable]')) return;
      if (e.key.length !== 1 || !/[a-z]/i.test(e.key)) return;
      this.buf = (this.buf + e.key.toUpperCase()).slice(-24);
      for (let n = Math.min(this.buf.length, 24); n >= 2; n--) { const suf = this.buf.slice(-n); if (CHEATS.some(c => c.code.startsWith(suf) && c.code.length > n)) { e.__cheatTyping = true; break; } }
      for (const c of CHEATS) if (this.buf.endsWith(c.code)) { this.buf = ''; e.__cheatTyping = true; this.activate(c.code); break; }
    }, true);
  }

  activate(code) {
    const g = this.game, p = g.player, c = CHEATS.find(x => x.code === code);
    g.audio?.sfx?.('cheat');
    g.ui.cheat ? g.ui.cheat(c?.name || code) : g.ui.splash('CHEAT ACTIVATED', '#ff3fa4');
    this.found.add(code); localStorage.setItem('vibecity.cheats', JSON.stringify([...this.found]));
    const fwd = new THREE.Vector3(-Math.sin(p.facing), 0, -Math.cos(p.facing));
    switch (code) {
      case 'ASPIRINE': p.health = p.maxHealth; break;
      case 'PRECIOUSPROTECTION': p.armor = 100; break;
      case 'LEAVEMEALONE': g.wanted.clear(); break;
      case 'FINECITY': g.wanted.add(2, 'Cheating'); break;
      case 'SHIOK': g.debugCar('infernus', !p.vehicle); break;
      case 'CHOPPER': {
        const pos = p.position.clone().addScaledVector(fwd, 12); pos.y = Math.max(0, p.position.y);
        const v = new Aircraft(g, 'heli', { position: pos, yaw: p.facing }); g.vehicles.push(v); break;
      }
      case 'JETSKI': {
        const w = g.spawns?.findWater(p.position.x, p.position.z, 260);
        if (!w) { g.ui.toast('No water nearby. This is a city, lah.'); break; }
        const v = new Boat(g, 'jetski', { position: w, yaw: g.spawns.openYaw(w) }); g.vehicles.push(v); g.routeTo({ x: w.x, z: w.z }); break;
      }
      case 'DURIANRAIN': this.durianRain = 25; break;
      case 'SEAWAYS': this.toggleSeaways(); break;
      case 'COMEFLYWITHME': this.toggle(code); g.physics.world.gravity = { x: 0, y: this.active.has(code) ? -3.2 : -9.81, z: 0 }; break;
      case 'ALOVELYDAY': g.weather.force(0); setTimeout(() => (g.weather.forced = null), 120000); break;
      case 'CATSANDDOGS': g.weather.force(1); setTimeout(() => (g.weather.forced = null), 120000); break;
      case 'HAZESEASON': this.toggle(code); g.sky.fogBase = this.active.has(code) ? 0.0016 : g.sky.fogClear; break;
      case 'LIFEISPASSINGMEBY': this.toggle(code); g.timeScale = this.active.has(code) ? 1 / 6 : 1 / 60; break;
      case 'BIGBANG': this.bigBang(); break;
      case 'GREENLIGHT': this.toggle(code); g.roadnet.allGreen = this.active.has(code); break;
      case 'KIASUDRIVERS': this.toggle(code); for (const car of g.traffic.cars) car.vmax *= this.active.has(code) ? 1.6 : 0.625; g.traffic.kiasu = this.active.has(code); break;
      case 'STILLLIKEDRESSINGUP': this.reskin(); break;
      case 'KACHING': g.addMoney(250000); break;
      case 'NIGHTOWL': g.sky.time = 23.5; g.sky.refreshEnv(); break;
      case 'VICEVISION': this.toggle(code); g.R.vibePass.enabled = this.active.has(code); g.R.vibe.mix = this.active.has(code) ? 1 : 0; break;
    }
  }
  toggle(code) { if (this.active.has(code)) this.active.delete(code); else this.active.add(code); }

  toggleSeaways() {
    const g = this.game, P = g.physics, R = P.R;
    this.toggle('SEAWAYS');
    if (this.active.has('SEAWAYS')) {
      const M = g.city.meta;
      this.seaCollider = P.world.createCollider(R.ColliderDesc.cuboid((M.xmax - M.xmin) / 2 + 2000, 0.5, (M.zmax - M.zmin) / 2 + 2000)
        .setTranslation((M.xmin + M.xmax) / 2, WATER_LEVEL - 0.5, (M.zmin + M.zmax) / 2).setCollisionGroups(FILTER.static));
    } else if (this.seaCollider) { P.world.removeCollider(this.seaCollider, true); this.seaCollider = null; }
  }

  bigBang() {
    const g = this.game, p = g.player.position;
    for (const car of [...g.traffic.cars]) {
      if (car.pos.distanceTo(p) > 60) continue;
      g.traffic.wreck(car);
      const d = car.pos.clone().sub(p).setY(0).normalize();
      car.body.applyImpulse({ x: d.x * car.spec.mass * 6, y: car.spec.mass * 14, z: d.z * car.spec.mass * 6 }, true);
      car.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * car.spec.mass * 8, y: 0, z: (Math.random() - 0.5) * car.spec.mass * 8 }, true);
      g.fx?.explosion(car.pos);
    }
    g.audio?.sfx?.('explosion');
  }

  reskin() {
    const g = this.game, pl = g.player;
    import('../entities/humanoid/index.js').then(H => {
      const presets = ['tommy', 'ken', 'lance', 'kyle', 'uncle', 'tourist', 'police', 'hawker', 'investor_m', 'student'];
      const pick = presets[Math.floor(Math.random() * presets.length)];
      const h = H.createHumanoid({ preset: pick, lod: 'high' });
      h.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.scene.remove(pl.root); pl.model.dispose?.();
      pl.model = h; pl.root = h.root; g.scene.add(h.root); pl.anim = ''; pl.setAnim('idle');
      g.ui.toast(`Tommy is now dressed as: ${pick.replace('_', ' ')}`);
    });
  }

  // ---- durians: instanced spiky fruit with Rapier bodies
  ensureDurianMesh() {
    if (this.durianMesh) return;
    const g = new THREE.IcosahedronGeometry(0.28, 1);
    const pos = g.attributes.position; // spikes: push every vertex out a bit irregularly
    for (let i = 0; i < pos.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(pos, i); v.multiplyScalar(1 + 0.25 * Math.abs(Math.sin(i * 12.9898))); v.y *= 1.25; pos.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ color: 0x8d8a2e, roughness: 0.8, flatShading: true });
    this.durianMesh = new THREE.InstancedMesh(g, m, 200); this.durianMesh.count = 0; this.durianMesh.castShadow = true; this.durianMesh.frustumCulled = false;
    this.game.scene.add(this.durianMesh);
  }
  dropDurian() {
    const g = this.game, P = g.physics, R = P.R, p = g.player.position;
    this.ensureDurianMesh();
    if (this.durians.length >= 200) { const old = this.durians.shift(); P.world.removeRigidBody(old.body); }
    const x = p.x + (Math.random() - 0.5) * 50, z = p.z + (Math.random() - 0.5) * 50;
    const body = P.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(x, p.y + 45 + Math.random() * 20, z).setAngvel({ x: Math.random() * 4, y: 0, z: Math.random() * 4 }).setCcdEnabled(true));
    P.world.createCollider(R.ColliderDesc.ball(0.32).setMass(2.5).setRestitution(0.35).setFriction(0.9).setCollisionGroups(FILTER.vehicle), body);
    this.durians.push({ body, t: 0, thud: false });
  }
  update(dt) {
    if (this.durianRain > 0) { this.durianRain -= dt; if (Math.random() < dt * 14) this.dropDurian(); }
    if (!this.durians.length || !this.durianMesh) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    const g = this.game;
    this.durians.forEach((d, i) => {
      const t = d.body.translation(), r = d.body.rotation();
      v.set(t.x, t.y, t.z); q.set(r.x, r.y, r.z, r.w); m.compose(v, q, s); this.durianMesh.setMatrixAt(i, m);
      const lv = d.body.linvel();
      if (!d.thud && t.y < g.player.position.y + 3 && lv.y > -2 && d.t > 0.5) { d.thud = true; if (v.distanceTo(g.player.position) < 60) g.audio?.sfx?.('durian_thud', { position: v.clone() }); }
      d.t += dt;
      // bonk pedestrians / Tommy
      if (lv.y < -8 && v.distanceTo(g.player.position) < 1.2 && !g.player.vehicle) { g.player.damage(10, 'durian'); g.ui.toast('Bonked by a durian. The king of fruits has spoken.'); }
    });
    this.durianMesh.count = this.durians.length; this.durianMesh.instanceMatrix.needsUpdate = true;
  }
}
