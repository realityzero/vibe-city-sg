// GTA staples, Singapore edition:
//  - "Chope 'n' Spray" respray garages (new paint + wanted level cleared, S$100)
//  - Capsule hotel safehouse: save game & sleep until morning
//  - Hawker stalls: chicken rice / laksa / kopi heal you (S$3.50–S$6)
//  - Claudia, Tommy's AI pair-programmer, texts running commentary on his life choices
import * as THREE from 'three';
import { Marker } from '../world/markers.js';
import { SAFEHOUSE } from '../game.js';

const FOODS = [
  ['Hainanese chicken rice', 4.5, 30], ['Laksa', 6, 35], ['Char kway teow', 5, 30], ['Kaya toast set', 3.5, 20],
  ['Satay (10 sticks)', 8, 40], ['Bak chor mee', 5, 30], ['Nasi lemak', 4, 25], ['Chilli crab (market price)', 68, 100], ['Kopi-O kosong', 1.6, 10],
];
const CLAUDIA = {
  pedHit: ['Detected a pedestrian collision. Would you like me to refactor your driving? (y/n)', 'That auntie is going to leave a 1-star review. On everything.', 'Fun fact: hitting pedestrians is not a growth strategy.'],
  carjack: ['You appear to have acquired a vehicle without a purchase order. Logging this as "creative procurement".', 'New car! I have updated the cap table to include "the guy you pulled out of it".'],
  wanted: ['Your wanted level is trending up and to the right. Investors love that shape, police less so.', 'The SPF has opened a ticket on you. Priority: P0.'],
  stunt: ['Sick air. I added it to the pitch deck under "risk appetite".', 'Physics engine says that should not have worked. Shipping it.'],
  rain: ['It is raining. Classic 4pm. Your tyres have been deprecated.', 'Weather API says: wet. Also, your shirt is see-through now.'],
  heli: ['You are flying a helicopter. I did not write the code for this and I will not be held responsible.', 'Altitude acquired. Please do not land on the Supertrees, they are load-bearing for tourism.'],
  boat: ['On the water now? The Singapore River has a speed limit. You are not respecting it.'],
  night: ['It is late. Most founders are asleep or on Twitter. You are doing crimes. Respect.'],
  money: ['Bank balance updated. Burn rate: yes.'],
  idle: ['Still there? I refactored your entire codebase while you stood still. You are welcome.', 'Reminder: your Series A does not raise itself. Unless you count the durian cheat.'],
};

export class Services {
  constructor(game) {
    this.game = game;
    const rn = game.roadnet;
    const lane = (x, z) => { const n = rn.nearestLane(x, z, 160, l => l.cls <= 6); return n ? n.pos.clone() : new THREE.Vector3(x, 0, z); };
    const walk = (x, z) => { const s = rn.nearestSidewalk(x, z, 160); return s ? s.pos.clone() : new THREE.Vector3(x, 0, z); };
    this.sprays = [[-930, 1080], [880, -1260], [-1400, -300]].map(([x, z]) => ({ pos: lane(x, z), m: null, cool: 0 }));
    for (const s of this.sprays) s.m = new Marker(game.scene, s.pos, { radius: 3.5, height: 3, color: 0x39f0ff, arrow: false });
    this.save = { pos: walk(SAFEHOUSE.pos.x, SAFEHOUSE.pos.z), m: null, cool: 0 };
    this.save.pos.addScaledVector(new THREE.Vector3(1, 0, 0), 4);
    this.save.m = new Marker(game.scene, this.save.pos, { radius: 1.1, height: 2, color: 0x6ad1ff });
    const avoid = game.activities?.list.map(a => a.pos) || [];
    this.food = [[-336, 190], [-673, 177], [-476, 709], [-260, 846], [167, 706], [-657, 1155], [1712, 614]].map(([x, z]) => {
      let p = walk(x + 4, z + 4);
      const sw = rn.nearestSidewalk(p.x, p.z, 40);
      for (let k = 1; k < 8 && avoid.some(a => a.distanceTo(p) < 7); k++) p = sw ? sw.pos.clone().addScaledVector(sw.dir, 6 * k) : p.add(new THREE.Vector3(6, 0, 0));
      return { pos: p, m: null, cool: 0 };
    });
    for (const f of this.food) f.m = new Marker(game.scene, f.pos, { radius: 0.9, height: 1.6, color: 0xffb36b, arrow: false });
    // Claudia commentary
    this.claudiaT = 25; this.last = {};
    const ev = game.events;
    ev.on('pedHit', () => this.claudia('pedHit', 0.25));
    ev.on('carjack', () => this.claudia('carjack', 0.35));
    ev.on('enterVehicle', v => { if (v.isAircraft && v.spec.kind !== 'drone') this.claudia('heli', 1); else if (v.isBoat) this.claudia('boat', 0.8); });
    this.lastStars = 0; this.lastPos = new THREE.Vector3(); this.idleT = 0;
  }

  claudia(kind, prob = 1) {
    const g = this.game;
    if (g.missions.active || Math.random() > prob) return;
    const now = performance.now();
    if (now - (this.lastAny || 0) < 45000 || now - (this.last[kind] || 0) < 180000) return;
    this.lastAny = now; this.last[kind] = now;
    const list = CLAUDIA[kind]; const msg = list[Math.floor(Math.random() * list.length)];
    g.audio?.sfx?.('text_message');
    g.ui.phone.text('Claudia (AI)', msg);
  }

  blips() {
    if (this.game.missions.active) return [];
    return [...this.sprays.map(s => ({ x: s.pos.x, z: s.pos.z, type: 'shop', label: "Chope 'n' Spray" })), { x: this.save.pos.x, z: this.save.pos.z, type: 'safehouse', label: 'Save game' }, ...this.food.map(f => ({ x: f.pos.x, z: f.pos.z, type: 'shop', label: 'Hawker stall' }))];
  }

  update(dt) {
    const g = this.game, P = g.player, v = P.vehicle;
    const busy = !!g.missions.active || g.activities?.busy;
    for (const s of [...this.sprays, this.save, ...this.food]) { s.m.group.visible = !busy || s === this.save; s.m.update(dt); s.cool -= dt; }
    // respray
    for (const s of this.sprays) {
      if (!v || v.isBoat || v.isAircraft || s.cool > 0) continue;
      if (v.position.distanceTo(s.pos) < 4 && v.speed < 3) { s.cool = 10; this.respray(v); }
    }
    // save
    const sp = this.save;
    if (!v && sp.cool <= 0 && !g.missions.active && P.position.distanceTo(sp.pos) < 1.5) { sp.cool = 6; this.sleep(); }
    // food
    for (const f of this.food) {
      if (v || f.cool > 0 || busy || P.position.distanceTo(f.pos) > 1.4) continue;
      f.cool = 20;
      const [name, price, hp] = FOODS[Math.floor(Math.random() * FOODS.length)];
      if (g.money < price) { g.ui.toast(`${name}: S$${price.toFixed(2)}. Not enough cash, auntie says can pay next time… no she doesn't.`); continue; }
      g.money -= price; P.health = Math.min(P.maxHealth, P.health + hp);
      g.audio?.sfx?.('kopi_pour');
      g.ui.splash(`${name.toUpperCase()} +${hp}♥`, '#ffb36b');
      g.ui.toast(`S$${price.toFixed(2)}. Shiok.`);
    }
    // Claudia idle / wanted / rain / night commentary
    this.claudiaT -= dt;
    if (this.claudiaT <= 0) {
      this.claudiaT = 20;
      if (g.wanted.stars >= 2 && this.lastStars < 2) this.claudia('wanted', 0.8);
      this.lastStars = g.wanted.stars;
      if (g.weather.rain > 0.5) this.claudia('rain', 0.4);
      if (g.sky.time > 0.5 && g.sky.time < 4) this.claudia('night', 0.3);
      if (this.lastPos.distanceTo(P.position) < 2) { this.idleT += 20; if (this.idleT > 90) { this.claudia('idle', 1); this.idleT = 0; } } else this.idleT = 0;
      this.lastPos.copy(P.position);
    }
  }

  async respray(v) {
    const g = this.game;
    if (g.money < 100) { g.ui.toast("Chope 'n' Spray: S$100. Uncle doesn't do IOUs."); return; }
    v.setDriverControls({ throttle: 0, brake: 1, steer: 0, handbrake: true }, 0.016);
    g.player.controlsEnabled = false;
    await g.ui.fade(true, 400);
    g.audio?.sfx?.('cash_register');
    const cols = [0xc8141c, 0x1d2a44, 0xf2c418, 0x2f9a46, 0xff3fa4, 0x18191b, 0xf4f4f2, 0x39c0ff, 0x8a6bb0];
    const col = cols[Math.floor(Math.random() * cols.length)];
    v.model.setColor?.(col); v._paint = col; v._lastHp = null;
    v.health = v.maxHealth ?? 1000; v.burnT = 0; v.fireWarned = false;
    g.money -= 100; g.wanted.clear();
    await new Promise(r => setTimeout(r, 900));
    await g.ui.fade(false, 500);
    g.player.controlsEnabled = true;
    g.ui.splash("CHOPE 'N' SPRAY", '#39f0ff');
    g.ui.toast('New paint, new identity. The SPF has no idea who you are. (They do.)');
  }

  async sleep() {
    const g = this.game;
    const i = await g.ui.choice('Galaxy Pods Capsule Hotel', [{ label: 'Save the game' }, { label: 'Save and sleep until 08:00' }, { label: 'Leave' }]);
    if (i === 2 || i < 0) return;
    if (i === 1) {
      await g.ui.fade(true, 700);
      g.sky.time = 8; g.sky.refreshEnv(); g.player.health = g.player.maxHealth; g.wanted.clear();
      await new Promise(r => setTimeout(r, 600));
      await g.ui.fade(false, 900);
    }
    g.save();
    g.ui.splash('GAME SAVED', '#6ad1ff');
  }
}
