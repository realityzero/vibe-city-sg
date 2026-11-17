// Mission 1's cold open: sunset on the Esplanade Drive bridge. A low tracking shot of Tommy's white Infernus crossing
// the river mouth — the bay and the Flyer behind it, then Marina Bay Sands and the Spectra lasers ahead — a station ident
// on the radio and the title card; then the camera swings in behind the car and hands Tommy the wheel mid-drive (the
// car cruises on until the player touches the controls). Enter / the touch ▶▶ button cuts straight to the hand-over.
import * as THREE from 'three';
import { PathDriver } from '../entities/aiDriver.js';

const START = { x: 603, z: -238 }; // Esplanade Drive bridge, southbound kerb lane
// sunset: the sky still glows and the city is lighting up. Held there until Ken (mission cleanup unfreezes it) so the
// opening keeps its light while the player takes the wheel
const TIME = 19.03;
const SHOT = 10.5;                  // s until the hand-over
const SPEED = 17;                   // m/s (~60 km/h)
const LET_GO = 6;                   // s after the hand-over the cruise pulls up if the player hasn't taken over
const STATION = 'flash';            // Flash Lah 95.8: "nineteen eighty six forever"

// camera path around the car: [t, angle from the nose towards its right side (rad), distance, height, FOV, look lead]
// side-on with the bay behind (title card), easing round to the rear quarter (MBS ahead), then up into the chase view
const KEYS = [
  [0, 1.4, 9.2, 1.05, 30, 1.2],
  [5.2, 1.8, 8.8, 1.1, 31, 1.6],
  [8.3, 2.55, 8.2, 1.5, 42, 3.5],
  [SHOT, Math.PI, 8.4, 2.25, 58, 0.2],
];
const smooth = x => x * x * (3 - 2 * x);
function sampleKeys(t, out) {
  let i = 0; while (i < KEYS.length - 2 && t > KEYS[i + 1][0]) i++;
  const a = KEYS[i], b = KEYS[i + 1], k = smooth(THREE.MathUtils.clamp((t - a[0]) / (b[0] - a[0]), 0, 1));
  for (let j = 1; j < 6; j++) out[j - 1] = a[j] + (b[j] - a[j]) * k;
}

const kerbSouthbound = l => {
  const P = l.path.xyz, n = l.path.n;
  return l.cls <= 3 && l.idx === 0 && P[(n - 1) * 3 + 2] - P[2] > Math.abs(P[(n - 1) * 3] - P[0]);
};

/** Plays the cold open inside a mission context; resolves once the player has the wheel. dest: the first stop. */
export async function coldOpen(c, dest) {
  const g = c.game, P = g.player, ui = g.ui;
  c.setTime(TIME);
  g.missions.timeFrozen = true;
  const n = g.roadnet.nearestLane(START.x, START.z, 60, kerbSouthbound) || g.roadnet.nearestLane(START.x, START.z, 60);
  const pos = n.pos.clone(), dir = n.dir.clone().setY(0).normalize(), yaw = Math.atan2(-dir.x, -dir.z);
  let car, skipped = false;
  const onKey = e => { if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !g.paused) skipped = true; };
  await c.cutscene(async () => {
    ui.fade(true, 0);
    car = c.vehicle('infernus', pos, yaw, { keep: true, color: 0xf7f7f4 });
    P.enterVehicleImmediate(car);
    g.relocate(pos, yaw, { exact: true });
    g.showcase = true; // the lasers and the Supertrees put on their show for the opening

    const k = [0, 0, 0, 0, 0], yawS = { v: yaw };
    const shot = {
      t: 0, run: false,
      track: (cam, dt) => {
        if (shot.run) shot.t += dt;
        sampleKeys(shot.t, k);
        const ang = k[0], dist = k[1], h = k[2], fov = k[3], lead = k[4];
        // heading smoothed: the cruise's small steering corrections shouldn't swing the whole shot
        let dy = car.yaw() - yawS.v; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); yawS.v += dy * Math.min(1, dt * 3);
        const fx = -Math.sin(yawS.v), fz = -Math.cos(yawS.v), rx = -fz, rz = fx, p = car.position;
        cam.position.set(p.x + (fx * Math.cos(ang) + rx * Math.sin(ang)) * dist, p.y + h, p.z + (fz * Math.cos(ang) + rz * Math.sin(ang)) * dist);
        cam.lookAt(p.x + fx * lead, p.y + 0.95, p.z + fz * lead);
        if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
      },
    };
    g.cameraRig.override = shot;
    ui.setSkippable(true);
    addEventListener('keydown', onKey);
    try {
      // behind the black: let the relocation's traffic seeding finish, then give the shot an open carriageway (traffic
      // doesn't steer round a car that is not in its lane)
      await c.until(() => g.traffic.recenter <= 0 && g.peds.recenter <= 0, 3);
      for (const t of [...g.traffic.cars]) {
        const dx = t.pos.x - pos.x, dz = t.pos.z - pos.z, ahead = dx * dir.x + dz * dir.z, side = dx * dir.z - dz * dir.x;
        if (ahead > -40 && ahead < 320 && Math.abs(side) < 12) g.traffic.despawn(t);
      }
      car.body.setLinvel({ x: dir.x * SPEED, y: 0, z: dir.z * SPEED }, true);
      cruise(c, car, dest);
      const radio = g.audio?.radio, i = radio ? radio.defs.findIndex(d => d.id === STATION) : -1;
      if (i >= 0) radio.setStation(i);
      shot.run = true;
      ui.fade(false, 1500);
      await c.until(() => skipped || shot.t > 1.1);
      const idents = radio?.defs[i]?.idents;
      if (!skipped && idents?.length) g.audio.voice?.sayRadio(idents[1] || idents[0], 'dj');
      await c.until(() => skipped || shot.t > 1.8);
      if (!skipped) ui.titleCard(true);
      await c.until(() => skipped || shot.t > 6.2);
      ui.titleCard(false);
      await c.until(() => skipped || shot.t >= SHOT);
    } finally {
      removeEventListener('keydown', onKey);
      ui.setSkippable(false); ui.titleCard(false); ui.fade(false, 300);
    }
    g.cameraRig.blendFrom(skipped ? 1.0 : 0.7);
  });
  g.driveHint(600);
  setTimeout(() => { g.showcase = false; }, 30000);
  return car;
}

// The car drives itself along the route, keeping its distance to traffic ahead, until the player touches the controls
// (Player.updateInVehicle hands any input over from an `autopilot`); LET_GO seconds after the hand-over it brakes to a
// stop and lets go (nobody at the wheel shouldn't mean rolling on into the next junction).
function cruise(c, car, dest) {
  const g = c.game, P = g.player;
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(car.quaternion);
  const ahead = car.position.clone().addScaledVector(fwd, 14);
  const route = g.roadnet.route(ahead.x, ahead.z, dest.x, dest.z);
  if (!route || route.length < 2) return;
  route.unshift([car.position.x, car.position.z]);
  const cruiseMul = SPEED * 1.05 / car.spec.maxSpeed;
  const drv = new PathDriver(g, car, route, { speed: cruiseMul, aggression: 0.3 });
  let left = Infinity, scan = 0;
  const pilot = {
    disengage: () => {
      const i = g.physics.stepCallbacks.indexOf(step); if (i >= 0) g.physics.stepCallbacks.splice(i, 1);
      if (P.autopilot === pilot) P.autopilot = null;
    },
  };
  const step = h => {
    if (P.vehicle !== car || P.autopilot !== pilot || drv.done) return pilot.disengage();
    if (P.controlsEnabled && left === Infinity) left = LET_GO;
    if ((left -= h) <= 0) {
      car.setDriverControls({ throttle: 0, brake: 0.45, steer: 0, handbrake: false }, h);
      if (car.speed < 0.5) pilot.disengage();
      return;
    }
    // ten times a second: slow down behind the nearest car in our path
    if ((scan -= h) <= 0) {
      scan = 0.1;
      fwd.set(0, 0, -1).applyQuaternion(car.quaternion);
      let cap = cruiseMul;
      for (const t of g.traffic.cars) {
        const dx = t.pos.x - car.position.x, dz = t.pos.z - car.position.z, d = dx * fwd.x + dz * fwd.z;
        if (d < 3 || d > 45 || Math.abs(dx * fwd.z - dz * fwd.x) > 2.4) continue;
        cap = Math.min(cap, Math.max(0, t.speed + (d - 14) * 0.6) / car.spec.maxSpeed);
      }
      drv.speedMul = cap;
    }
    drv.update(h);
  };
  P.autopilot = pilot;
  g.physics.onStep(step);
  c.onCleanup(pilot.disengage);
}
