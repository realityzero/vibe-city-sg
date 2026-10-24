// Ambient life: bumboats cruising the Singapore River, MRT station entrances with fast travel,
// nightly fireworks over Marina Bay at 21:00, and airliners crossing the sky towards Changi.
import * as THREE from 'three';
import { createVehicleModel } from '../entities/vehicles/index.js';
import { Path } from './roadnet.js';
import { Fireworks } from './fireworks.js';
import { WATER_LEVEL } from '../core/constants.js';
import { Marker } from './markers.js';

function mrtSignTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#d6202a'; g.beginPath(); g.arc(128, 128, 104, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#ffffff'; g.lineWidth = 22; g.lineCap = 'round';
  g.beginPath(); g.moveTo(70, 100); g.lineTo(186, 100); g.moveTo(70, 156); g.lineTo(186, 156); g.moveTo(108, 70); g.lineTo(148, 186); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Ambient {
  constructor(game) {
    this.game = game;
    // ---------------- river bumboats
    this.boats = [];
    const rv = game.city.data.river?.[0];
    if (rv && rv.length > 8) {
      const pts = []; for (let i = 0; i < rv.length; i += 2) pts.push([rv[i], WATER_LEVEL, rv[i + 1]]);
      this.river = new Path(pts);
      for (let i = 0; i < 4; i++) {
        let m; try { m = createVehicleModel('bumboat', { lod: 'high', beams: false }); } catch { break; }
        m.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        game.scene.add(m.root);
        this.boats.push({ m, s: (i / 4) * this.river.length, dir: i % 2 ? 1 : -1, speed: 3 + Math.random() });
      }
    }
    // ---------------- MRT entrances (fast travel)
    const groups = new Map();
    for (const p of game.city.data.pois) {
      if (p.k !== 'subway_entrance') continue;
      const name = (p.n || '').replace(/ (Station|MRT).*$/, '').replace(/ Exit.*$/, '').replace(/\s*\(.*\)/, '').trim();
      if (!name || /^Exit/.test(name)) continue;
      if (!groups.has(name)) groups.set(name, []); groups.get(name).push(p);
    }
    this.stations = [];
    const tex = mrtSignTexture();
    const signMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xc9ced2, roughness: 0.35, metalness: 0.6 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x8fb4c4, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.45 });
    for (const [name, list] of groups) {
      const e = list[0];
      const sw = game.roadnet.nearestSidewalk(e.x, e.z, 40);
      // the entrance kiosk must stand somewhere reachable (OSM entrance nodes often sit inside the station building)
      const want = sw && sw.dist < 25 ? sw.pos : new THREE.Vector3(e.x, 0, e.z);
      const pos = game.safe.find(want, { pad: 2.2 }) || want.clone();
      let yaw = sw ? Math.atan2(sw.toRoad.x, sw.toRoad.z) : 0;
      // the way in (1.5 m behind the sign) must not open into a wall
      if (game.safe.insideBuilding(pos.x - Math.sin(yaw) * 1.5, pos.z - Math.cos(yaw) * 1.5, 0.3)) yaw += Math.PI;
      const g = new THREE.Group(); g.position.copy(pos); g.rotation.y = yaw;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.25, 5.5), roofMat); roof.position.set(0, 3.2, -1.5); roof.castShadow = true; g.add(roof);
      for (const x of [-2.1, 2.1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.9, 5.2), glassMat); w.position.set(x, 1.6, -1.5); g.add(w); }
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4.2, 6), roofMat); pole.position.set(2.6, 2.1, 1.3); g.add(pole);
      const sign = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), signMat); sign.position.set(2.6, 4.0, 1.37); g.add(sign);
      const sign2 = sign.clone(); sign2.rotation.y = Math.PI; sign2.position.z = 1.23; g.add(sign2);
      game.scene.add(g);
      const entry = pos.clone().add(new THREE.Vector3(0, 0, -1.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw));
      this.stations.push({ name, pos: entry, signMat, cool: 0 });
    }
    this.signMat = signMat;
    this.mrtBusy = false;
    // ---------------- fireworks + planes
    this.fw = new Fireworks(game.scene, 6000);
    this.fwT = 0; this.fwDay = -1;
    const planeGeo = new THREE.CapsuleGeometry(1.8, 30, 4, 8); planeGeo.rotateX(Math.PI / 2);
    const wing = new THREE.BoxGeometry(34, 0.4, 5); const tail = new THREE.BoxGeometry(12, 0.3, 3); tail.translate(0, 0, 14); const fin = new THREE.BoxGeometry(0.3, 6, 4); fin.translate(0, 3, 15);
    const pg = new THREE.Group();
    const wm = new THREE.MeshStandardMaterial({ color: 0xeef1f3, roughness: 0.4, metalness: 0.3 });
    for (const geo of [planeGeo, wing, tail, fin]) pg.add(new THREE.Mesh(geo, wm));
    const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.6, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff })); strobe.position.set(17, 0, 0); pg.add(strobe);
    const strobe2 = strobe.clone(); strobe2.position.x = -17; pg.add(strobe2);
    this.plane = pg; this.planeStrobe = [strobe, strobe2]; pg.visible = false; game.scene.add(pg);
    this.planeT = 20;
  }

  blips() { return this.game.missions.active ? [] : this.stations.map(s => ({ x: s.pos.x, z: s.pos.z, type: 'friend', label: `${s.name} MRT` })); }

  update(dt) {
    const g = this.game, t = g.sky.time, night = g.U.night.value;
    // boats
    if (this.river) {
      const p = new THREE.Vector3(), d = new THREE.Vector3();
      for (const b of this.boats) {
        b.s += b.dir * b.speed * dt;
        if (b.s > this.river.length - 20) { b.dir = -1; } else if (b.s < 20) b.dir = 1;
        this.river.sample(b.s, p, d);
        const side = new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(b.dir * 5);
        b.m.root.position.set(p.x + side.x, WATER_LEVEL + Math.sin(g.U.time.value * 1.3 + b.s) * 0.05, p.z + side.z);
        b.m.root.rotation.set(Math.sin(g.U.time.value * 0.9 + b.s) * 0.015, Math.atan2(-d.x * b.dir, -d.z * b.dir), 0);
        b.m.setLights?.({ head: night > 0.3 });
        b.m.update?.(dt);
      }
    }
    // MRT fast travel
    this.signMat.emissiveIntensity = 0.3 + night * 1.6;
    if (!this.mrtBusy && !g.missions.active && !g.player.vehicle && g.player.state === 'foot') {
      for (const s of this.stations) {
        s.cool -= dt;
        if (s.cool <= 0 && g.player.position.distanceTo(s.pos) < 1.6) { s.cool = 6; this.ride(s); break; }
      }
    }
    // nightly fireworks over Marina Bay, 21:00-21:04 game time
    const day = Math.floor((g.U.time.value * (g.timeScale || 1 / 60)) / 24);
    if (t >= 21 && t < 21.17 && !g.paused) {
      this.fwT -= dt;
      if (this.fwT <= 0) { this.fwT = 0.25 + Math.random() * 0.5; this.fw.burst(new THREE.Vector3(950 + (Math.random() - 0.5) * 300, 110 + Math.random() * 90, 120 + (Math.random() - 0.5) * 200), 260); if (g.player.position.distanceTo(new THREE.Vector3(950, 0, 120)) < 1200) g.audio?.sfx?.('explosion', { position: new THREE.Vector3(950, 150, 120), volume: 0.25 }); }
    }
    this.fw.update(dt);
    // planes heading east to Changi
    this.planeT -= dt;
    const P = this.plane;
    if (this.planeT <= 0 && !P.visible) {
      P.visible = true; this.planeT = 90 + Math.random() * 120;
      const z = g.player.position.z + (Math.random() - 0.5) * 2000;
      this.planeA = new THREE.Vector3(g.player.position.x - 5000, 650 + Math.random() * 300, z);
      this.planeB = new THREE.Vector3(g.player.position.x + 5000, 520, z + (Math.random() - 0.5) * 800);
      this.planeK = 0;
    }
    if (P.visible) {
      this.planeK += dt / 70;
      P.position.lerpVectors(this.planeA, this.planeB, this.planeK);
      P.lookAt(this.planeB); P.rotateY(Math.PI);
      const on = Math.floor(g.U.time.value * 1.2) % 2 === 0 && (g.U.time.value * 1.2) % 1 < 0.08;
      for (const st of this.planeStrobe) st.visible = on;
      if (this.planeK >= 1) P.visible = false;
    }
  }

  async ride(from) {
    const g = this.game;
    this.mrtBusy = true;
    const options = this.stations.filter(s => s !== from).sort((a, b) => a.name.localeCompare(b.name));
    g.input.unlock();
    let to = null, page = 0; const per = 7;
    while (!to) {
      const slice = options.slice(page * per, page * per + per);
      const more = (page + 1) * per < options.length;
      const items = slice.map(s => ({ label: `${s.name}  ·  ${(s.pos.distanceTo(from.pos) / 1000).toFixed(1)} km` }));
      if (more) items.push({ label: 'More stations…' });
      items.push({ label: 'Cancel' });
      const pick = await g.ui.choice(`${from.name} MRT — where to? (S$1.80, tap your EZ-Link)`, items);
      if (pick < 0 || pick === items.length - 1) break;
      if (more && pick === slice.length) { page++; continue; }
      to = slice[pick];
    }
    g.input.lock();
    if (!to) { this.mrtBusy = false; return; }
    if (g.money < 1.8) { g.ui.toast('Insufficient EZ-Link balance. Top up at the kopitiam? (Earn some money first.)'); this.mrtBusy = false; return; }
    g.money -= 1.8;
    g.audio?.sfx?.('erp_beep');
    await g.ui.fade(true, 500);
    g.ui.subtitle('"Doors closing… Please mind the platform gap."', { duration: 2500 });
    await new Promise(r => setTimeout(r, 1800));
    g.relocate(to.pos.clone().add(new THREE.Vector3(2.5, 0, 0)), g.player.facing, { faceOpen: true });
    g.sky.time = (g.sky.time + 0.2) % 24;
    await g.ui.fade(false, 700);
    g.ui.hud.flashZone?.(`${to.name} MRT`);
    to.cool = 8;
    this.mrtBusy = false;
  }
}
