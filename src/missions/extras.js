// Free-roam extras: hidden kaya toasts (collectibles) and ERP gantries that charge you for driving under them (event
// 'erp' with the gantry: { name, x, z, price }).
import * as THREE from 'three';
import { Pickup } from '../world/markers.js';
import { mergeStatic } from '../gfx/mergeStatic.js';

const ERP_ROADS = ['Shenton Way', 'Robinson Road', 'Cecil Street', 'Anson Road', 'Bras Basah Road', 'Eu Tong Sen Street', 'Raffles Avenue', 'Esplanade Drive', 'Bayfront Avenue', 'Fullerton Road', 'Stamford Road', 'New Bridge Road', 'Victoria Street', 'Nicoll Highway', 'Marina Boulevard'];

function erpTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d');
  g.fillStyle = '#0b3d2a'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#ffffff'; g.font = 'bold 54px Arial, sans-serif'; g.textBaseline = 'middle'; g.fillText('ERP', 18, 50);
  g.fillStyle = '#ffcc00'; g.font = 'bold 34px monospace'; g.fillText('$ 2.00', 330, 50);
  g.fillStyle = '#9fd'; g.font = '20px Arial'; g.fillText('ELECTRONIC ROAD PRICING', 130, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Extras {
  constructor(game) {
    this.game = game;
    // ---- kaya toasts: deterministic spots on sidewalks across the map
    let seed = 20261022; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const sws = game.roadnet.sidewalks;
    this.kaya = [];
    const M = game.city.meta;
    for (let i = 0; this.kaya.length < 24 && i < 500; i++) {
      const sw = sws[Math.floor(rnd() * sws.length)];
      const p = sw.path.sample(rnd() * sw.path.length, new THREE.Vector3());
      if (p.x < M.xmin + 200 || p.x > M.xmax - 200 || p.z < M.zmin + 200 || p.z > M.zmax - 200) continue;
      if (this.kaya.some(k => k.pos.distanceTo(p) < 250)) continue;
      this.kaya.push({ id: this.kaya.length, pos: p.clone() });
    }
    this.kayaTotal = this.kaya.length;
    this.pickups = new Map();
    // (one made at load, hidden, so the toasts' programs compile in the warm-up and not when the first one shows up)
    new Pickup(game.scene, new THREE.Vector3(0, -50, 0)).group.visible = false;
    // ---- ERP gantries
    const net = game.roadnet;
    this.gantries = [];
    const tex = erpTexture();
    const steel = new THREE.MeshStandardMaterial({ color: 0x9ea6ad, metalness: 0.7, roughness: 0.4 });
    const panel = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.6, roughness: 0.5 });
    const grps = [];
    for (const name of ERP_ROADS) {
      const es = net.edges.filter(e => e.n === name && e.len > 60 && !e.y);
      if (!es.length) continue;
      es.sort((a, b) => b.len - a.len);
      const e = es[0];
      const k = Math.floor(e.p.length / 4) * 2;
      const x = e.p[k], z = e.p[k + 1], x2 = e.p[k + 2] ?? e.p[k - 2], z2 = e.p[k + 3] ?? e.p[k - 1];
      const d = new THREE.Vector2(x2 - x, z2 - z).normalize(); if (k + 2 >= e.p.length) d.negate();
      const yaw = Math.atan2(-d.x, -d.y);
      const hw = e.hw + 1;
      const grp = new THREE.Group(); grp.position.set(x, 0, z); grp.rotation.y = yaw;
      for (const s of [-1, 1]) { const col = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6.2, 0.35), steel); col.position.set(s * hw, 3.1, 0); grp.add(col); }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 0.5, 0.6, 0.8), steel); beam.position.y = 6; grp.add(beam);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.8), panel); sign.position.set(0, 6, 0.42); grp.add(sign);
      const sign2 = sign.clone(); sign2.rotation.y = Math.PI; sign2.position.z = -0.42; grp.add(sign2);
      grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
      game.scene.add(grp); grps.push(grp);
      this.gantries.push({ name, x, z, dx: d.x, dz: d.y, hw, side: 0, cool: 0, price: [1, 2, 2, 3, 4][Math.floor(Math.random() * 5)] });
    }
    mergeStatic(game.scene, grps, 'erpGantries');
  }

  update(dt) {
    const g = this.game, P = g.player.position;
    // kaya toasts: show only near the player
    for (const k of this.kaya) {
      if (g.progress.kaya.includes(k.id)) continue;
      const d = k.pos.distanceTo(P);
      let pk = this.pickups.get(k.id);
      if (d < 140 && !pk) { pk = new Pickup(g.scene, k.pos); this.pickups.set(k.id, pk); }
      else if (d > 170 && pk) { pk.dispose(); this.pickups.delete(k.id); pk = null; }
      if (pk) {
        pk.update(dt);
        if (Math.hypot(P.x - k.pos.x, P.z - k.pos.z) < 1.6 && Math.abs(P.y - k.pos.y) < 2.5) {
          g.progress.kaya.push(k.id); pk.dispose(); this.pickups.delete(k.id);
          g.addMoney(100); g.audio?.sfx?.('pickup');
          const n = g.progress.kaya.length;
          g.ui.splash(`KAYA TOAST ${n}/${this.kayaTotal}`, '#9dff5a');
          if (n === this.kayaTotal) { g.addMoney(10000); g.ui.help('All kaya toasts found! Uncle at the kopitiam is proud of you. <b>+S$10,000</b>'); }
          g.save();
        }
      }
    }
    // ERP: detect crossing the gantry line while driving
    const v = g.player.vehicle;
    for (const G of this.gantries) {
      G.cool -= dt;
      const rx = P.x - G.x, rz = P.z - G.z;
      const along = rx * G.dx + rz * G.dz, lat = Math.abs(rx * -G.dz + rz * G.dx);
      const side = Math.sign(along);
      if (v && lat < G.hw + 1 && Math.abs(along) < 8 && G.side && side !== G.side && G.cool <= 0) {
        G.cool = 10;
        g.money = Math.max(0, g.money - G.price);
        g.progress.stats.erp += G.price;
        g.audio?.sfx?.('erp_beep');
        g.fines.erp(G.price);
        g.events.emit('erp', G);
      }
      G.side = Math.abs(along) < 30 && lat < G.hw + 4 ? side : 0;
    }
  }
}
