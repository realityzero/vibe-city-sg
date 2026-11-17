// Parked cars: along one kerb of the service roads (back lanes, access roads: AI traffic never drives them) and reversed
// into the bays of open car parks (the ground mask's parking paving beside an aisle), never near a carriageway the
// traffic uses. Spots are found per 120 m cell the first time the viewer comes near it and kept (the same cars are there
// when you come back); the nearest occupied ones are Traffic cars in state 'parked' — drawn by the traffic renderer, no
// AI, solid near the player, and a hard knock (Traffic.wreck) or a thief (Traffic.take) makes them real vehicles.
import { VEHICLE_SPECS, pickTrafficType } from '../entities/vehicles/index.js';

const CELL = 120;
const key = (gx, gz) => gx * 100003 + gz;
// a repeatable 0..1 from a position (the same car in the same spot on every visit)
const hash = (x, z, k = 0) => { const h = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return h - Math.floor(h); };

export class Parking {
  constructor(game, { max = 28, radius = 140 } = {}) {
    this.game = game; this.max = max; this.radius = radius;
    this.roads = new Map(); // cell -> service roads passing through it
    this.cells = new Map(); // cell -> its spots, once found
    this.spots = [];        // spots holding a car now
    this.t = 0;
    const roads = game.city.data.roads;
    for (let i = 0; i < roads.length; i++) {
      const r = roads[i];
      if (r.c !== 7 || r.w < 4.9 || r.cv || r.b || r.y) continue;
      const seen = new Set();
      for (let j = 0; j < r.p.length - 2; j += 2) {
        const ax = r.p[j], az = r.p[j + 1], bx = r.p[j + 2], bz = r.p[j + 3], n = Math.ceil(Math.hypot(bx - ax, bz - az) / 30);
        for (let k = 0; k <= n; k++) {
          const c = key(Math.floor((ax + (bx - ax) * k / n) / CELL), Math.floor((az + (bz - az) * k / n) / CELL));
          if (seen.has(c)) continue; seen.add(c);
          let a = this.roads.get(c); if (!a) this.roads.set(c, a = []); a.push(r);
        }
      }
    }
  }

  /** the spots in cell (gx, gz): parallel along a kerb, or bays where parking paving lies beside the road */
  _cell(gx, gz) {
    const c = key(gx, gz); let out = this.cells.get(c);
    if (out) return out;
    out = []; this.cells.set(c, out);
    const g = this.game, city = g.city, net = g.roadnet;
    const parkingAt = (x, z) => { const b = city.maskAt(x, z, 2); return b >= 195 && b <= 205; };
    const free = (x, z, r) => !city.isWater(x, z) && !g.safe.insideBuilding(x, z, r) && !((net.nearestLane(x, z, 8)?.dist ?? 99) < 6);
    const add = (x, z, yaw, k) => {
      if (Math.floor(x / CELL) !== gx || Math.floor(z / CELL) !== gz) return; // each spot belongs to one cell
      let type = pickTrafficType(() => hash(x, z, k + 1));
      if (type === 'bus' || type === 'lorry') type = 'van';
      const cols = VEHICLE_SPECS[type].colours;
      out.push({ x, z, yaw, type, color: cols[Math.floor(hash(x, z, k + 2) * cols.length)], car: null, gone: false });
    };
    for (const r of this.roads.get(c) || []) {
      const P = r.p, hw = r.w / 2;
      let s0 = 0, total = 0;
      for (let j = 0; j < P.length - 2; j += 2) total += Math.hypot(P[j + 2] - P[j], P[j + 3] - P[j + 1]);
      for (let j = 0; j < P.length - 2; j += 2) {
        const ax = P[j], az = P[j + 1], dx = P[j + 2] - ax, dz = P[j + 3] - az, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
        // left of the way along (x east, z south): (uz, -ux)
        for (const side of [1, -1]) {
          const nx = uz * side, nz = -ux * side;
          if (parkingAt(ax + dx / 2 + nx * (hw + 2.6), az + dz / 2 + nz * (hw + 2.6)) && parkingAt(ax + dx / 2 + nx * (hw + 4.6), az + dz / 2 + nz * (hw + 4.6))) {
            // bays at 2.6 m, reversed in (nose to the aisle), most of them taken
            for (let t = 3; t < L - 3; t += 2.6) {
              const x = ax + ux * t + nx * (hw + 2.7), z = az + uz * t + nz * (hw + 2.7);
              if (hash(x, z) > 0.7 || !parkingAt(x, z) || !parkingAt(x + nx * 2, z + nz * 2) || !free(x, z, 1.3)) continue;
              add(x, z, Math.atan2(nx, nz), 0);
            }
          } else if (side === 1) {
            // along the kerb on the left, a car length and a gap apart, clear of the ends (junction mouths)
            for (let t = 4; t < L - 4; t += 6.6) {
              const x = ax + ux * t + nx * (hw - 1.05), z = az + uz * t + nz * (hw - 1.05);
              if (s0 + t < 12 || s0 + t > total - 12 || hash(x, z) > 0.55 || !free(x, z, 0.8)) continue;
              add(x, z, Math.atan2(-ux, -uz), 1);
            }
          }
        }
        s0 += L;
      }
    }
    return out;
  }

  update(dt) {
    if ((this.t -= dt) > 0) return;
    this.t = 0.5;
    const T = this.game.traffic, V = T.viewer, r = this.radius;
    // what became of the cars we parked: stolen or knocked loose, the spot stays empty while we are around
    for (const s of this.spots) if (s.car && (s.car.state !== 'parked' || !T.cars.includes(s.car))) { s.car = null; s.gone = true; }
    const want = [];
    for (let gx = Math.floor((V.x - r) / CELL); gx <= Math.floor((V.x + r) / CELL); gx++)
      for (let gz = Math.floor((V.z - r) / CELL); gz <= Math.floor((V.z + r) / CELL); gz++) {
        if (!this.roads.has(key(gx, gz))) continue;
        for (const s of this._cell(gx, gz)) { const d = Math.hypot(s.x - V.x, s.z - V.z); if (d < r) want.push(d, s); }
      }
    // the nearest `max`
    const idx = []; for (let i = 0; i < want.length; i += 2) idx.push(i);
    idx.sort((a, b) => want[a] - want[b]);
    const keep = new Set(); for (let k = 0; k < Math.min(this.max, idx.length); k++) keep.add(want[idx[k] + 1]);
    for (const s of this.spots) if (!keep.has(s)) { if (s.car) T.despawn(s.car); s.car = null; s.gone = false; }
    this.spots = [...keep];
    for (const s of this.spots) if (!s.car && !s.gone) s.car = T.park(s);
  }
}
