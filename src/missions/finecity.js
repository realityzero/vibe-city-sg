// "Fine City": Singapore's enforcement as a running gag. The enforcement cameras at the big junctions (entities/wanted.js)
// clock speeders — a white flash and a stamped ticket (S$150 and 4 demerit points at 1-20 km/h over, more beyond);
// running a red, leaning on the horn by a hospital and jaywalking across a main road cost small fines. Every fine goes
// into stats.fines; the ERP gantries (extras.js) drop a −S$ floater off the cash counter. Free roam only (missions,
// side jobs and police chases have their own rules), except the cold open's staged speed trap (speedTrap()).
import * as THREE from 'three';

const LIMIT = 70;            // km/h at the enforcement cameras
const CAM_R = 26;            // m: a camera's speed trap
const LANE_HZ = 10;          // red-light / jaywalk checks a second
const HOSPITAL_R = 140;      // m of quiet around a hospital
// [km/h over the limit, fine, demerit points] (light vehicles); beyond the last tier it's a court case
const SPEEDING = [[20, 150, 4], [30, 200, 6], [40, 300, 8]];
const FLASH_T = 0.14;        // s the camera flash lights the street
const _at = new THREE.Vector3();

export class FineCity {
  constructor(game) {
    this.game = game;
    this.hospitals = (game.city.data.pois || []).filter(p => p.k === 'hospital').map(p => ({ x: p.x, z: p.z, n: p.n }));
    this.camT = 0;           // s until any camera may flash again (one ticket at a time)
    this.redT = 0; this.walkT = 0; this.hornT = 0;
    this.laneT = 0;
    this.app = null; this.appS = 0; // the signalised lane the car is on, and how far along it (its stop line is at s1)
    this.flashT = 0;
    this.camFined = new Map(); // camera -> time its 30 s rest ends
    this._near = []; this._hit = { lane: null, s: 0 };
    addEventListener('keydown', e => {
      if (e.code !== 'KeyH' || e.repeat || e.__cheatTyping || e.__uiHandled) return;
      const v = game.player?.vehicle;
      if (v && !v.isAircraft && !v.isBoat && v.type !== 'police' && game.player.controlsEnabled) this.honk();
    });
  }

  /** a fine: cash, the stats, the ticket (flash: a camera took the picture, lit from `at`) */
  charge(what, amount, detail, { flash = false, at = null } = {}) {
    const g = this.game;
    g.money = Math.max(0, g.money - amount);
    g.progress.stats.fines += amount;
    g.ui.ticket({ what, amount, detail, flash });
    g.ui.floater(`−S$${amount.toLocaleString('en-US')}`);
    g.audio?.sfx?.(flash ? 'camera_flash' : 'stamp', { volume: 0.9 });
    if (flash) setTimeout(() => g.audio?.sfx?.('stamp', { volume: 0.8 }), 380);
    if (flash && at && g.fx?.flash) {
      // the camera's strobe lights the car for a moment (fx's one reusable point light, white for the occasion)
      const L = g.fx.flash; L.color.setHex(0xeef4ff); L.position.copy(at); g.fx.flashT = FLASH_T;
      this.flashT = FLASH_T;
    }
  }

  /** the ERP gantry beep's floater (the deduction itself is extras.js's) */
  erp(price) { this.game.ui.floater(`ERP −S$${price.toFixed(2)}`, 'erp'); }

  /** the cold open's first-drive speed trap: a mobile camera on the straight (any speed over `limit` km/h) */
  speedTrap(limit = 50) {
    const v = this.game.player.vehicle; if (!v) return false;
    const kmh = Math.round(v.speed * 3.6); if (kmh <= limit) return false;
    this.speeding(kmh, limit, _at.set(0, 0, -6).applyQuaternion(v.quaternion).add(v.position).setY(v.position.y + 2.5));
    return true;
  }

  speeding(kmh, limit, at) {
    const over = kmh - limit, tier = SPEEDING.find(t => over <= t[0]);
    if (tier) this.charge('Speed camera', tier[1], `${kmh} km/h in a ${limit} zone · <b>${tier[2]} demerit points</b>`, { flash: true, at });
    else this.charge('Speed camera', 1000, `${kmh} km/h in a ${limit} zone · <b>12 points</b>, see you in court`, { flash: true, at });
  }

  honk() {
    const g = this.game, p = g.player.position;
    if (!this.free() || this.hornT > 0) return;
    const h = this.hospitals.find(h => Math.hypot(h.x - p.x, h.z - p.z) < HOSPITAL_R);
    if (!h) return;
    this.hornT = 90;
    setTimeout(() => this.charge('Horn near a hospital', 70, `${h.n || 'Hospital'} · patients are <b>healing</b> lah`), 450);
  }

  /** fines apply in free roam, with the controls in Tommy's hands (not Claudia's autopilot) and no police on him */
  free() {
    const g = this.game, P = g.player;
    return !g.missions.active && !g.activities?.busy && g.wanted.stars === 0 && P.controlsEnabled && !P.autopilot && !g.cameraRig.override;
  }

  update(dt) {
    const g = this.game, P = g.player;
    if (this.flashT > 0 && (this.flashT -= dt) <= 0) g.fx?.flash.color.setHex(0xffaa55); // (back to explosion orange)
    this.camT -= dt; this.redT -= dt; this.walkT -= dt; this.hornT -= dt;
    if (!this.free() || P.state === 'dead') { this.app = null; return; }
    const v = P.vehicle, car = v && !v.isBoat && !v.isAircraft && !v.exploded;
    const px = P.position.x, pz = P.position.z;
    // speed cameras
    if (car && this.camT <= 0 && v.speed * 3.6 > LIMIT + 1) {
      for (const c of g.wanted.cameras || []) {
        const dx = c.x - px, dz = c.z - pz;
        if (dx * dx + dz * dz > CAM_R * CAM_R || (this.camFined.get(c) || 0) > performance.now()) continue;
        this.camFined.set(c, performance.now() + 30000); this.camT = 6;
        this.speeding(Math.round(v.speed * 3.6), LIMIT, _at.set(c.x, 4.8, c.z));
        break;
      }
    }
    if ((this.laneT -= dt) > 0) return;
    this.laneT = 1 / LANE_HZ;
    if (car) this.redLight(v, px, pz);
    else { this.app = null; if (P.state === 'foot' && !P.swimming && this.walkT <= 0) this.jaywalk(px, pz); }
  }

  // Through a red: on a signalised lane, the car went over its stop line (s1: lanes run on into the junction) while
  // the lane showed red. Only real approaches count: the stubs between the nodes of a big junction have signals of
  // their own, out of step with the one you just crossed on green.
  redLight(v, px, pz) {
    const g = this.game, net = g.roadnet, q = v.quaternion;
    const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y)), fl = Math.hypot(fx, fz) || 1;
    const h = this.laneUnder(px, pz, fx / fl, fz / fl, 2.6);
    if (!h || !net.nodes[h.lane.to].signal || h.lane.s1 - h.lane.s0 < 25) { this.app = null; return; }
    const L = h.lane;
    if (L === this.app && this.appS < L.s1 && h.s >= L.s1 + 0.5 && v.speed > 3 && this.redT <= 0 && net.signalFor(L) === 'red') {
      this.redT = 25;
      L.path.sample(L.s1, _at);
      this.charge('Red-light camera', 400, `Ran a red at ${Math.round(v.speed * 3.6)} km/h · <b>12 demerit points</b>`, { flash: true, at: _at.setY(4.8) });
    }
    this.app = L; this.appS = h.s;
  }

  // Jaywalking: on foot on a main road's carriageway, mid-block, with traffic coming.
  jaywalk(px, pz) {
    const g = this.game, h = this.laneUnder(px, pz, 0, 0, 1.8);
    if (!h || h.lane.cls > 3 || h.s < h.lane.s0 + 12 || h.s > h.lane.s1 - 12) return;
    for (const c of g.traffic.cars) {
      if (c.speed < 4 || Math.abs(c.pos.x - px) > 35 || Math.abs(c.pos.z - pz) > 35) continue;
      this.walkT = 120;
      g.bark('nearmiss', c.pos, 2, { text: 'Eh, this one zebra crossing leh!' });
      this.charge('Jaywalking', 20, 'First offence. The crossing is <b>right there</b>.');
      return;
    }
  }

  /** the lane whose centre line passes within maxD of (x,z) — running along (fx,fz) unless that's zero — or null.
   * The result object is reused. */
  laneUnder(x, z, fx, fz, maxD) {
    let best = null, bd = maxD * maxD, bs = 0;
    for (const l of this.game.roadnet.lanesNear(x, z, 12, this._near)) {
      const P = l.path.st.xyz, o = l.path.o, n = l.path.n;
      for (let i = 0; i < n - 1; i++) {
        const q = (o + i) * 3, ax = P[q], az = P[q + 2], dx = P[q + 3] - ax, dz = P[q + 5] - az, L2 = dx * dx + dz * dz || 1;
        if ((fx || fz) && dx * fx + dz * fz < 0.7 * Math.sqrt(L2)) continue;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), ex = ax + dx * t - x, ez = az + dz * t - z, d2 = ex * ex + ez * ez;
        if (d2 < bd) { bd = d2; best = l; bs = l.path.arc(i) + Math.sqrt(L2) * t; }
      }
    }
    if (!best) return null;
    this._hit.lane = best; this._hit.s = bs;
    return this._hit;
  }
}
