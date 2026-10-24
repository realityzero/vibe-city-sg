// Free-roam side activities with green markers: Singapore Flyer ride, Kopi Uncle stall shifts, Chope Rampage.
import * as THREE from 'three';
import { Marker, Checkpoint } from '../world/markers.js';
import { Aircraft } from '../entities/aircraft.js';

export class Activities {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.busy = false;
    const flyer = game.landmarks?.pois?.find(p => p.id === 'flyer');
    if (flyer) this.add('flyer', 'Singapore Flyer ride (S$40)', this.spot(flyer.x - 60, flyer.z + 40), () => this.flyerRide());
    this.add('kopi', 'Kopi Uncle shift — Maxwell Food Centre', this.spot(-470, 712), () => this.minigame('kopi'));
    this.add('kopi2', 'Kopi Uncle shift — Lau Pa Sat', this.spot(160, 690), () => this.minigame('kopi'));
    this.add('chope', 'Chope Rampage — Amoy Street Food Centre', this.spot(-262, 846), () => this.minigame('chope'));
    this.add('chope2', 'Chope Rampage — Chinatown Complex', this.spot(-668, 180), () => this.minigame('chope'));
    this.add('drone', 'DurianDash drone deliveries — WeHustle', this.spot(-600, 905), () => this.droneDeliveries());
    this.add('ship', 'Ship a feature — WeHustle hot desk', this.spot(-660, 870), () => this.shipFeature());
    this.add('courier', 'Pitch-deck courier — Raffles Place', this.spot(10, 330), () => this.courier());
  }
  spot(x, z) { const s = this.game.roadnet.nearestSidewalk(x, z, 160); return s ? s.pos.clone() : new THREE.Vector3(x, 0, z); }
  add(id, label, pos, run) {
    const m = new Marker(this.game.scene, pos, { type: 'pickup', radius: 1.1, height: 1.8, color: 0x46e08a });
    this.list.push({ id, label, pos, run, m, cool: 0 });
  }
  blips() { return this.game.missions.active ? [] : this.list.map(a => ({ x: a.pos.x, z: a.pos.z, type: 'shop', label: a.label })); }

  update(dt) {
    const g = this.game;
    const hide = !!g.missions.active || this.busy;
    for (const a of this.list) {
      a.m.group.visible = !hide;
      a.cool -= dt;
      if (hide) continue;
      a.m.update(dt);
      const d = Math.hypot(g.player.position.x - a.pos.x, g.player.position.z - a.pos.z);
      if (d < 1.6 && !g.player.vehicle && a.cool <= 0 && g.player.state === 'foot') {
        a.cool = 8; this.busy = true;
        Promise.resolve(a.run()).catch(e => console.warn(e)).finally(() => { this.busy = false; });
      }
    }
  }

  async minigame(kind) {
    const g = this.game;
    let mod, run;
    try {
      if (kind === 'kopi') { mod = await import('../ui/minigames/kopi.js'); run = mod.runKopiOrder; }
      else { mod = await import('../ui/minigames/chope.js'); run = mod.runChopeRampage; }
    } catch { g.ui.toast('This stall is closed today. Come back later lah.'); return; }
    if (!run) return;
    const root = document.createElement('div'); Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: 60 }); document.body.appendChild(root);
    g.input.unlock(); g.input.enabled = false; g.paused = true; g.mgPaused = true;
    try {
      const r = await run(root, { audio: g.audio, round: 1 });
      const pay = kind === 'kopi' ? Math.round((r?.score || 0) * 12 + (r?.tips || 0)) : Math.round((r?.seats || 0) * 40 + (r?.score || 0) * 5);
      if (pay > 0) { g.addMoney(pay); g.ui.splash(`+S$${pay}`, '#7fe36a'); }
    } finally { root.remove(); g.paused = false; g.mgPaused = false; g.input.enabled = true; g.input.lock(); }
  }

  // DurianDash: fly a delivery drone (remote control) to condo rooftops before the timer runs out
  async droneDeliveries() {
    const g = this.game, P = g.player;
    const home = P.position.clone();
    // rooftop targets: residential towers within 700 m, flat roofs found by raycast
    const info = g.city.buildingInfo, targets = [];
    for (let i = 0; i < info.length; i += 5) {
      const x = info[i + 1], z = info[i + 2], top = info[i + 3], style = info[i + 4];
      if (top < 25 || top > 160 || !(style === 2 || style === 3 || style === 5 || style === 1)) continue;
      const d = Math.hypot(x - home.x, z - home.z); if (d < 150 || d > 700) continue;
      const h = g.physics.raycast({ x, y: top + 40, z }, { x: 0, y: -1, z: 0 }, 80);
      if (h && h.point.y > top - 6) targets.push(new THREE.Vector3(x, h.point.y + 2.5, z));
    }
    if (targets.length < 5) { g.ui.toast('No drop-offs nearby. Even durians need an address.'); return; }
    targets.sort(() => Math.random() - 0.5);
    const route = targets.slice(0, 5);
    const drone = new Aircraft(g, 'drone', { position: home.clone().add(new THREE.Vector3(1.5, 0, 1.5)), yaw: P.facing });
    g.vehicles.push(drone);
    P.remoteHome = home.clone(); P.remoteFacing = P.facing;
    P.enterVehicleImmediate(drone);
    g.ui.help('<b>DurianDash</b>: fly the drone (<b>Space/Shift</b> up/down, <b>W/S</b> forward/back, <b>A/D</b> turn) and hover inside each rooftop ring to drop a durian. <b>F</b> to quit.', 9000);
    let done = 0, left = 240, mk = new Checkpoint(g.scene, route[0], { radius: 5, height: 6 });
    g.ui.counter.show('DURIANS', 0, 5); g.ui.timer.show('DELIVERY', left);
    g.routeTo({ x: route[0].x, z: route[0].z });
    const result = await new Promise(resolve => {
      let hold = 0; let last = performance.now();
      const step = () => {
        const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
        if (!g.paused) {
          left -= dt; g.ui.timer.set(Math.max(0, left)); mk.update(dt);
          if (P.vehicle !== drone || drone.exploded || drone.ditched) return resolve('quit');
          if (left <= 0) return resolve('time');
          const t = route[done];
          if (drone.position.distanceTo(t) < 6) { hold += dt; if (hold > 1.2) {
            hold = 0; done++; g.audio?.sfx?.('durian_thud'); g.addMoney(150); g.ui.splash('DURIAN DELIVERED +S$150', '#9dff5a'); g.ui.counter.set(done);
            g.cheats?.ensureDurianMesh?.();
            mk.dispose(); if (done >= 5) return resolve('win');
            mk = new Checkpoint(g.scene, route[done], { radius: 5, height: 6 }); g.routeTo({ x: route[done].x, z: route[done].z });
          } } else hold = 0;
        }
        requestAnimationFrame(step);
      };
      step();
    });
    mk.dispose(); g.ui.counter.hide(); g.ui.timer.hide(); g.routeTo(null);
    if (P.vehicle === drone) P.exitVehicle();
    P.teleport(home, P.remoteFacing); P.remoteHome = null;
    const i = g.vehicles.indexOf(drone); if (i >= 0) g.vehicles.splice(i, 1); drone.dispose();
    if (result === 'win') { g.addMoney(1000); await g.ui.missionPassed({ title: 'DURIANS DELIVERED', reward: 1000, extra: 'Neighbours have filed 14 complaints.' }); }
    else if (result === 'time') g.ui.toast('Out of time. The durians are… fragrant.');
  }

  async shipFeature() {
    const g = this.game;
    const root = document.createElement('div'); Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: 60 }); document.body.appendChild(root);
    g.input.unlock(); g.input.enabled = false; g.paused = true; g.mgPaused = true;
    try {
      const { runVibeCode } = await import('../ui/minigames/vibecode.js');
      const r = await runVibeCode(root, { audio: g.audio, idea: g.missions.state.idea, duration: 90 });
      const pay = Math.round((r?.quality || 0) * 60);
      g.missions.valuation = Math.round((g.missions.valuation || 1000000) * (1 + (r?.quality || 0) / 400));
      g.missions.state.valuation = g.missions.valuation;
      if (pay) { g.addMoney(pay); g.ui.splash(`FEATURE SHIPPED +S$${pay.toLocaleString()}`, '#2fe6ff'); }
    } catch (e) { console.warn(e); }
    finally { root.remove(); g.paused = false; g.mgPaused = false; g.input.enabled = true; g.input.lock(); }
  }

  // "Pitch-deck courier": deliver USB sticks with your deck to VC offices around the CBD (VC's pizza-boy homage)
  async courier() {
    const g = this.game, P = g.player;
    const VCS = [['Merlion Ventures', 'Ocean Financial Centre'], ['Sandhill Partners SG', 'One Raffles Place'], ['Temasick Holdings', 'Capital Tower'], ['500 Shrimps', 'Guoco Tower'], ['Why Combinator Asia', 'Marina Bay Financial Centre'], ['Auntie Mei Family Office', 'Lau Pa Sat'], ['Kopi Capital', 'Far East Square'], ['Durian Seed Fund', 'Fullerton Hotel']];
    const named = name => { for (const b of g.city.data.buildings) if (b.n && b.n.includes(name)) { let x = 0, z = 0; for (let i = 0; i < b.p.length; i += 2) { x += b.p[i]; z += b.p[i + 1]; } return [x / (b.p.length / 2), z / (b.p.length / 2)]; } return null; };
    const stops = [];
    for (const [vc, bld] of VCS.sort(() => Math.random() - 0.5)) { const c = named(bld); if (!c) continue; const sw = g.roadnet.nearestSidewalk(c[0], c[1], 120); if (sw) stops.push({ vc, pos: sw.pos.clone() }); if (stops.length >= 5) break; }
    if (stops.length < 3) { g.ui.toast('All the VCs are at a conference in Davos. Try later.'); return; }
    // a delivery scooter
    const lane = g.roadnet.nearestLane(P.position.x, P.position.z, 80, l => l.cls <= 6);
    const { Vehicle } = await import('../entities/vehicle.js');
    const bike = new Vehicle(g, 'bike', { position: lane ? lane.pos : P.position.clone(), yaw: lane ? Math.atan2(-lane.dir.x, -lane.dir.z) : 0, color: 0x33a04a });
    g.vehicles.push(bike);
    P.enterVehicleImmediate(bike);
    g.ui.help('Deliver your pitch deck on a USB stick to each VC office. Ride into the marker. <b>Faster = more meetings.</b>', 8000);
    let left = 70 + stops.length * 35, i = 0;
    g.ui.timer.show('DEMO DAY IN', left); g.ui.counter.show('DECKS', 0, stops.length);
    let mk = new Checkpoint(g.scene, stops[0].pos, { radius: 4 }); g.routeTo({ x: stops[0].pos.x, z: stops[0].pos.z });
    const res = await new Promise(resolve => {
      let last = performance.now();
      const step = () => {
        const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
        if (!g.paused) {
          left -= dt; g.ui.timer.set(Math.max(0, left)); mk.update(dt);
          if (left <= 0) return resolve('time');
          if (P.state === 'dead') return resolve('dead');
          if (P.position.distanceTo(stops[i].pos) < 5) {
            g.audio?.sfx?.('pickup'); g.addMoney(250); g.ui.counter.set(++i);
            g.ui.splash(`DECK SENT TO ${stops[i - 1].vc.toUpperCase()}`, '#ffd23f');
            mk.dispose(); if (i >= stops.length) return resolve('win');
            left += 12; mk = new Checkpoint(g.scene, stops[i].pos, { radius: 4 }); g.routeTo({ x: stops[i].pos.x, z: stops[i].pos.z });
          }
        }
        requestAnimationFrame(step);
      };
      step();
    });
    mk.dispose(); g.ui.timer.hide(); g.ui.counter.hide(); g.routeTo(null);
    if (res === 'win') { g.addMoney(1500); await g.ui.missionPassed({ title: 'DECKS DELIVERED', reward: 1500, extra: '3 VCs replied "let\'s grab coffee". 2 left you on read.' }); }
    else if (res === 'time') g.ui.toast('Too slow. The VCs have moved on to the next AI wrapper.');
  }

  async flyerRide() {
    const g = this.game;
    if (g.money < 40) { g.ui.toast('Ticket is S$40. Tommy is, for once, broke.'); return; }
    let caps = null;
    g.landmarks.group.traverse(o => { if (!caps && o.isInstancedMesh && o.count === 28 && o.material?.transparent) caps = o; });
    if (!caps) return;
    g.money -= 40; g.audio?.sfx?.('flyer_chime');
    await g.ui.fade(true, 500);
    // board the lowest capsule
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    const posOf = i => { caps.getMatrixAt(i, m); return p.setFromMatrixPosition(m).applyMatrix4(caps.matrixWorld).clone(); };
    let idx = 0, low = Infinity; for (let i = 0; i < 28; i++) { const y = posOf(i).y; if (y < low) { low = y; idx = i; } }
    const P = g.player;
    const back = P.position.clone();
    P.controlsEnabled = false; P.root.visible = false;
    g.flyerSpeed = 22; // a full revolution in ~80 s
    g.ui.letterbox(true);
    g.ui.help('Enjoy the view. Move the <b>mouse</b> to look around, <b>F</b> to get off early.', 7000);
    const rig = g.cameraRig;
    const fl = g.landmarks.pois.find(p => p.id === 'flyer'), mbs = g.landmarks.pois.find(p => p.id === 'mbs') || { x: 1300, z: 380 };
    let yaw = Math.atan2(-(mbs.x - fl.x), -(mbs.z - fl.z)), pitch = -0.12, t = 0;
    await g.ui.fade(false, 600);
    await new Promise(resolve => {
      const step = () => {
        if (!this.busy) return resolve();
        const dt = 1 / 60; t += dt;
        const c = posOf(idx);
        yaw -= g.input.mouse.dx * 0.003; pitch = THREE.MathUtils.clamp(pitch - g.input.mouse.dy * 0.003, -1.2, 0.6);
        const look = c.clone().add(new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(30));
        const out = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)).multiplyScalar(1.6);
        rig.override = { position: c.clone().add(out).add(new THREE.Vector3(0, 0.6, 0)), lookAt: look, snap: true, fov: 58 };
        if (t > 80 || (t > 1 && g.input.pressed.has('KeyF'))) return resolve();
        requestAnimationFrame(step);
      };
      step();
    });
    await g.ui.fade(true, 500);
    rig.override = null; g.flyerSpeed = 1; g.ui.letterbox(false);
    P.root.visible = true; P.controlsEnabled = true; P.teleport(back, P.facing);
    await g.ui.fade(false, 600);
    g.ui.toast('Best S$40 Tommy ever spent. Don\'t tell Ken.');
  }
}
