// Mission 1's first drive: the minute after the cold open hands Tommy the wheel is staged on the road ahead, so the
// city shows itself on the way to Lau Pa Sat. About 12 s in a bus pulls out of a stop ahead; at ~25 s junglefowl cross
// and the traffic waits for them; at ~38 s a delivery rider jaywalks out in front (swerve close and it's a CLOSE SHAVE);
// then a mobile speed camera flashes on the next straight and Claudia texts about it. The clock runs only while the
// player drives; each beat fits itself to the GPS route ahead and is skipped if nothing fits in time.
import * as THREE from 'three';

// [s of driving, beat, s it keeps looking for a place before it's dropped]
const BEATS = [[12, 'bus', 12], [25, 'fowl', 18], [38, 'jaywalker', 15]]; // (the drive is ~1 km: about a minute)
const GAP = 6;           // s of driving at least between two beats
const _a = { x: 0, z: 0, dx: 0, dz: 0 }, _p = new THREE.Vector3();

/** runs alongside mission 1's drive; resolves when the beats are done or the player has nearly arrived */
export async function firstDrive(c, dest) {
  const g = c.game, P = g.player;
  let t = 0;
  const driving = dt => { if (P.vehicle && !P.autopilot && P.controlsEnabled && P.vehicle.speed > 3) t += dt; };
  const near = () => Math.hypot(P.position.x - dest.x, P.position.z - dest.z) < 110;
  try {
    let last = -GAP;
    for (const [at, beat, tries] of BEATS) {
      await c.until(dt => { driving(dt); return t >= Math.max(at, last + GAP) || near(); });
      if (near()) return;
      let staged = null, k = 0, w = 0;
      // (tried a few times a second until it fits or its time is up)
      await c.until(dt => { driving(dt); w += dt; if ((k += dt) >= 0.25) { k = 0; staged = STAGE[beat](g); } return staged || w >= tries || near(); });
      if (staged) last = t;
      if (staged && beat === 'bus') busPullOut(c, staged).catch(() => { }); // (runs on beside the next beats)
    }
    // the speed trap: the first straight at speed once the last beat has played out
    let flashed = false;
    await c.until(dt => { driving(dt); flashed = t >= last + GAP && !near() && straightAhead(g) && g.fines.speedTrap(50); return flashed || near(); }, 60);
    if (flashed) {
      await c.wait(4);
      c.text('Claudia (AI)', 'Welcome to Singapore! That flash was a speed camera: <b>S$150</b>. I\'ve set up GIRO for your fines. 💅');
    }
  } catch (e) { if (!e?.isMissionFail) throw e; } // (the mission ended under us)
}

// --------------------------------------------------------------------------------------------- the road ahead
/** the GPS route `d` m ahead of the player: _a = { x, z, dx, dz } (route direction), or null */
function ahead(g, d) {
  const r = g.ui.radar.route, p = g.player.position; if (!r) return null;
  // the player's place on the route: the nearest point of its nearest segment
  let bi = -1, bt = 0, bd = 40 * 40;
  for (let i = 0; i < r.length - 1; i++) {
    const ax = r[i][0], az = r[i][1], sx = r[i + 1][0] - ax, sz = r[i + 1][1] - az, L2 = sx * sx + sz * sz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * sx + (p.z - az) * sz) / L2)), ex = ax + sx * t - p.x, ez = az + sz * t - p.z;
    if (ex * ex + ez * ez < bd) { bd = ex * ex + ez * ez; bi = i; bt = t; }
  }
  if (bi < 0) return null;
  for (let i = bi; i < r.length - 1; i++) {
    const ax = r[i][0], az = r[i][1], sx = r[i + 1][0] - ax, sz = r[i + 1][1] - az, L = Math.hypot(sx, sz) || 1;
    const u = i === bi ? bt * L + d : d; // metres from this segment's start
    if (u <= L) { _a.x = ax + sx * u / L; _a.z = az + sz * u / L; _a.dx = sx / L; _a.dz = sz / L; return _a; }
    d = u - L;
  }
  return null;
}
/** the route runs straight for the next 100 m (within ~10°) */
function straightAhead(g) {
  const a = ahead(g, 10); if (!a) return false;
  const dx = a.dx, dz = a.dz;
  for (const d of [50, 100]) { const b = ahead(g, d); if (!b || dx * b.dx + dz * b.dz < 0.985) return false; }
  return true;
}
/** the pavement d m ahead on the route's left (side 1, the kerb we drive along) or right (-1): where people step off
 *  and fowl come out of the verge. The route runs on a lane: the road's own sidewalk is the only one within hw + 1 of
 *  the lane point pushed hw + 2 out to that side. */
function kerb(g, d, side) {
  const a = ahead(g, d); if (!a) return null;
  const n = g.roadnet.nearestLane(a.x, a.z, 20, l => l.cls <= 5); if (!n) return null;
  const e = n.lane.edge, off = (e.hw + 2) * side; // left of travel: (dz, -dx)
  const sn = g.peds.walkways.snap(a.x + a.dz * off, a.z - a.dx * off, e.hw + 1, w => !w.foot && w.edge === e);
  if (!sn) return null;
  sn.w.path.sample(sn.s, _p);
  return { x: _p.x, z: _p.z };
}

// --------------------------------------------------------------------------------------------- the beats
// each returns what it staged (truthy) or nothing if it doesn't fit right now
const STAGE = {
  // a bus stop by the route 140-230 m ahead: a double-decker waits there and pulls out as the player comes up
  bus(g) {
    for (const d of [140, 170, 200, 230]) {
      const a = ahead(g, d); if (!a) return null;
      const stop = g.streetProps?.stops?.find(s => Math.hypot(s.x - a.x, s.z - a.z) < 22);
      if (!stop) continue;
      const fx = a.dx, fz = a.dz;
      const n = g.roadnet.nearestLane(stop.x, stop.z, 18, l => l.idx === 0 && l.cls <= 5); if (!n || n.dir.x * fx + n.dir.z * fz < 0.8) continue;
      // it mustn't pop in where the player can see the stop
      if (d < 170 && g.traffic.inView(n.pos, 0.5)) continue;
      const car = g.traffic.spawnAt(n.lane, n.s, 'bus');
      if (car) { car.speed = 0; car.keep = true; }
      return car;
    }
    return null;
  },
  // out of the greenery on either side (the scene wants a verge), across both carriageways
  fowl(g) {
    const L = g.peds.life;
    for (const side of [1, -1]) for (const d of [70, 85, 100]) { const k = kerb(g, d, side), ev = k && L.stageAt('fowl', k); if (ev) return ev; }
    return null;
  },
  // far enough out to appear unseen, near enough to be mid-road as the car arrives (~3.4 s)
  jaywalker(g) {
    const v = g.player.vehicle; if (!v) return null;
    const L = g.peds.life, d0 = THREE.MathUtils.clamp(v.speed * 3.4, g.peds.popDist + 4, 95);
    for (const d of [d0, d0 + 12]) { const k = kerb(g, d, 1), ev = k && L.stageAt('jaywalker', k); if (ev) return ev; }
    return null;
  },
};

// the bus holds at its stop (a person-sized obstacle at its nose) until the player is ~60 m back, then pulls away
async function busPullOut(c, car) {
  const g = c.game, hold = { x: 0, z: 0, r: 0.6 }, fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw);
  hold.x = car.pos.x + fx * (car.len / 2 + 2.4); hold.z = car.pos.z + fz * (car.len / 2 + 2.4);
  try {
    await c.until(() => {
      if (!g.traffic.cars.includes(car)) return true;
      const p = g.player.position, back = (car.pos.x - p.x) * fx + (car.pos.z - p.z) * fz;
      if (back < 60 && back > -5) return true;
      g.traffic.obstacles.push(hold);
      return false;
    }, 25);
    g.audio?.sfx?.('horn', { position: _p.copy(car.pos), volume: 0.5 }); // (a toot as it pulls out)
    await c.wait(20);
  } finally { car.keep = false; }
}
