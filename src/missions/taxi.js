// "Snatch" ride-hailing side job: in any taxi press T to go on duty, pick up hailing pedestrians and drive them
// to real Singapore destinations against the clock. Metered fares (S$4.10 flag-down + S$0.25 per 400 m), tips, streaks.
import * as THREE from 'three';
import { Marker, Checkpoint } from '../world/markers.js';

const DEST = [
  ['Marina Bay Sands', 1305, 330], ['Lau Pa Sat', 167, 706], ['Maxwell Food Centre', -476, 709], ['Raffles Hotel', 612, -860],
  ['Clarke Quay', -300, -380], ['Chinatown Complex', -673, 177], ['The Fullerton Hotel', 470, 230], ['Esplanade', 700, -250],
  ['Gardens by the Bay', 1500, 650], ['Singapore Flyer', 1450, -280], ['Tanjong Pagar MRT', -330, 1100], ['Bugis Junction', 1060, -1650],
  ['Fort Canning Park', -180, -650], ['Pinnacle@Duxton', -850, 1200], ['Boat Quay', 0, 0], ['Amoy Street Food Centre', -260, 846],
  ['National Gallery', 380, -420], ['Suntec City', 1100, -900], ['Orchard Road', -2400, -1700], ['Tiong Bahru Market', -2500, 600],
];
const PICKUP_LINES = [
  'Uncle, %D, quick quick! My Series A meeting starts in five minutes!',
  'Eh boss, %D please. Can avoid ERP or not? Got cheaper road?',
  'Hello, %D. Don\'t take the long way ah, I know the shortcut.',
  '%D. And can off the radio? Got conference call. Ok never mind, Flash Lah is shiok.',
  'Is this a Snatch? I booked a Snatch. Ok whatever, %D.',
  '%D, then wait for me five minutes, then go back. Can?',
  'Wah your car very clean. %D please. Got charger cable or not?',
  'Sorry ah, I\'m a tourist. %D? I heard there is a durian there.',
];
const DROP_LINES = ['Thank you uncle! Five stars!', 'Wah, Formula One driver ah you.', 'Keep the change. Buy yourself a kopi.', 'Can I get your number? For investors.', 'You drive like Vice City, I like.'];
const LATE_LINES = ['Aiyoh, I GrabHitch next time!', 'You drive like my grandmother. She is 94.', 'Faster to walk lah!'];

export class Taxi {
  constructor(game) {
    this.game = game;
    this.onDuty = false;
    this.state = 'idle';
    this.streak = 0; this.earned = 0; this.trips = 0;
    addEventListener('keydown', e => {
      if (e.__uiHandled || e.__cheatTyping || e.code !== 'KeyT' || game.state !== 'play' || game.paused) return;
      const v = game.player.vehicle;
      if (!v || !/^taxi/.test(v.type)) return;
      if (game.missions.active) { game.ui.toast('Finish the mission first, lah.'); return; }
      this.onDuty ? this.stop(true) : this.start();
    });
  }
  start() {
    this.onDuty = true; this.streak = 0; this.earned = 0; this.trips = 0;
    this.game.ui.help('<b>Snatch</b> driver mode: pick up passengers waving at the kerb (blue blips) and drive them to their destination. Press <b>T</b> to clock off.', 7000);
    this.seek();
  }
  async stop(manual) {
    this.clear();
    this.onDuty = false; this.state = 'idle';
    this.game.ui.fare?.hide?.();
    if (this.trips) await this.game.ui.fare?.summary?.({ trips: this.trips, earned: this.earned });
    if (manual) this.game.ui.toast('Clocked off. The uncles at the kopitiam salute you.');
  }
  clear() {
    this.marker?.dispose(); this.marker = null;
    if (this.fare) { this.game.routeTo(null); }
    if (this.hail) this.hail.hailing = false;
    this.hail = null; this.fare = null;
  }
  seek() {
    this.clear();
    this.state = 'seek';
    this.seekT = 0;
    this.game.ui.fare?.show?.({ fare: 0, tip: 0, timeLeft: null, passenger: null, dest: 'FOR HIRE' });
  }
  pickHailer() {
    const g = this.game, P = g.player.position, v = g.player.vehicle;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(v.quaternion);
    let best = null, bs = -1e9;
    for (const p of g.peds.peds) {
      if (p.state !== 'walk' || !p.sw) continue;
      const d = p.pos.distanceTo(P); if (d < 40 || d > 220) continue;
      const ahead = (p.pos.x - P.x) * fwd.x + (p.pos.z - P.z) * fwd.z;
      const sc = ahead - d * 0.3; if (sc > bs) { bs = sc; best = p; }
    }
    return best;
  }
  update(dt) {
    if (!this.onDuty) return;
    const g = this.game, v = g.player.vehicle;
    if (!v || !/^taxi/.test(v.type)) { this.stop(false); g.ui.toast('You left the taxi. Snatch duty ended.'); return; }
    const P = v.position;
    if (this.state === 'seek') {
      this.seekT -= dt;
      if (!this.hail && this.seekT <= 0) {
        this.seekT = 1;
        const p = this.pickHailer();
        if (p) { this.hail = p; p.hailing = true; p.state = 'idle'; p.idleT = 999; p.idleAnim = 10; this.marker = new Marker(g.scene, p.pos, { type: 'checkpoint', radius: 1.2, height: 3 }); }
      }
      if (this.hail) {
        const p = this.hail;
        if (!g.peds.peds.includes(p)) { this.clear(); return; }
        this.marker.group.position.copy(p.pos); this.marker.update(dt);
        if (p.pos.distanceTo(P) < 8 && v.speed < 2.5) this.board(p);
      }
    } else if (this.state === 'ride') {
      const f = this.fare;
      f.left -= dt;
      f.dist += Math.min(5, f.last.distanceTo(P)); f.last.copy(P);
      f.amount = 4.1 + Math.floor(f.dist / 400) * 0.25;
      this.marker.update(dt);
      g.ui.fare?.set?.({ fare: f.amount, tip: this.tip(), timeLeft: Math.max(0, f.left) });
      if (f.left <= 0) { g.ui.subtitle(`Passenger: "${LATE_LINES[Math.floor(Math.random() * LATE_LINES.length)]}"`, { duration: 3500 }); this.streak = 0; this.seek(); return; }
      if (Math.hypot(P.x - f.to.x, P.z - f.to.z) < 14 && v.speed < 3) this.dropOff();
    }
  }
  tip() { const f = this.fare; if (!f) return 0; return Math.max(0, Math.round((f.left / f.total) * 12 + (f.hpStart - this.game.player.vehicle.health) * -0.01)); }
  board(p) {
    const g = this.game, v = g.player.vehicle;
    const i = g.peds.peds.indexOf(p); if (i >= 0) g.peds.peds.splice(i, 1);
    this.marker.dispose(); this.marker = null; this.hail = null;
    // destination 500-2200 m away
    const P = v.position;
    const opts = DEST.filter(d => { const dd = Math.hypot(d[1] - P.x, d[2] - P.z); return dd > 500 && dd < 2200; });
    const d = (opts.length ? opts : DEST)[Math.floor(Math.random() * (opts.length || DEST.length))];
    const lane = g.roadnet.nearestLane(d[1], d[2], 200, l => l.cls <= 6);
    const to = lane ? lane.pos.clone() : new THREE.Vector3(d[1], 0, d[2]);
    const dist = Math.hypot(to.x - P.x, to.z - P.z);
    const total = Math.round(dist / 8.5 + 25);
    this.fare = { name: d[0], to, left: total, total, dist: 0, last: P.clone(), amount: 4.1, hpStart: v.health };
    this.marker = new Checkpoint(g.scene, to, { radius: 7 });
    g.routeTo({ x: to.x, z: to.z });
    this.state = 'ride';
    g.audio?.sfx?.('door_close', { position: P });
    g.ui.subtitle(`Passenger: "${PICKUP_LINES[Math.floor(Math.random() * PICKUP_LINES.length)].replace('%D', `<b>${d[0]}</b>`)}"`, { duration: 4500 });
    g.ui.fare?.show?.({ fare: 4.1, tip: 0, timeLeft: total, passenger: 'Passenger', dest: d[0] });
  }
  async dropOff() {
    const g = this.game, f = this.fare;
    let tip = this.tip();
    this.state = 'paying';
    if (Math.random() < 0.3) {
      g.ui.subtitle('Passenger: "Wait wait. Before I pay — I quiz you on Singlish. Get them right, I tip."', { duration: 3000 });
      await new Promise(r => setTimeout(r, 2200));
      try {
        const { runSinglishQuiz } = await import('../ui/minigames/quiz.js');
        const root = document.createElement('div'); Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: 60 }); document.body.appendChild(root);
        g.input.unlock(); g.input.enabled = false; g.paused = true; g.mgPaused = true;
        try { const r = await runSinglishQuiz(root, { audio: g.audio, count: 5, destination: f.name }); tip += (r?.correct || 0) * 3; if ((r?.correct || 0) === (r?.total || 5)) tip += 10; }
        finally { root.remove(); g.paused = false; g.mgPaused = false; g.input.enabled = true; g.input.lock(); }
      } catch (e) { console.warn(e); }
    }
    const pay = Math.round((f.amount + tip) * 100) / 100;
    this.earned += pay; this.trips++; this.streak++;
    g.money += pay; g.audio?.sfx?.('taxi_meter');
    g.ui.splash(`FARE S$${pay.toFixed(2)}`, '#ffd23f');
    g.ui.subtitle(`Passenger: "${DROP_LINES[Math.floor(Math.random() * DROP_LINES.length)]}"`, { duration: 3000 });
    if (this.streak % 5 === 0) { g.addMoney(500); g.ui.help(`<b>${this.streak} rides in a row!</b> Snatch bonus <em>S$500</em>. Uncle of the month.`, 6000); }
    this.seek();
  }
  blips() {
    if (!this.onDuty) return [];
    if (this.hail) return [{ x: this.hail.pos.x, z: this.hail.pos.z, type: 'friend', label: 'Passenger' }];
    if (this.fare) return [{ x: this.fare.to.x, z: this.fare.to.z, type: 'objective', label: this.fare.name }];
    return [];
  }
}
