// Fine City Getaway (side job, from the activity marker on Raffles Quay): Uncle Ah Seng's back has given out, his
// regular passenger has a check-up at Singapore General Hospital (the Outram Road entrance), and his licence stands at
// 23 demerit points — one more ticket and it's suspended. Drive his cab across the CBD inside the time limit with zero
// fines: the Fine City rules (missions/finecity.js `enforce`) apply in full — speed cameras at the big junctions, every
// red light, a hospital zone at 40 km/h round SGH and the cancer centre — and the cab's CashCard is empty, so every ERP
// gantry is a violation notice too (the S$10 admin fee; the GPS route goes under the Shenton Way one). The clock says
// hurry, the cameras say don't; a ticket fails the job once it has been seen. Text only: Uncle's texts.
import { districtAt } from '../ui/districts.js';

const START = [240, 770];          // Raffles Quay, a block past Lau Pa Sat (where mission 1 ends: not on its doorstep)
const DEST = [-1240, 590];         // SGH campus, Outram Road (by the National Cancer Centre)
const ZONE_R = 140, ZONE_KMH = 40; // the hospitals' slow zones
const PACE = 9.5;                  // m/s along the GPS route the time limit asks for, reds included: well over 50 km/h between them
const RADAR_R = 320;               // m: cameras, gantries and zones within this show on the radar
const ERP_FINE = 10;               // S$ admin fee on an ERP violation

export const GETAWAY = {
  id: 'fine_city_getaway', side: true, title: 'Fine City Getaway', subtitle: 'Side job', passTitle: 'No saman!', reward: 3000,
  async run(ctx) {
    const g = ctx.game, P = g.player, net = g.roadnet, F = g.fines;
    // ---- Uncle's cab at the kerb, pointing the way to go (not round the block first)
    const ahead = l => { const P0 = l.path, k = P0.n - 1; return (P0.x(k) - P0.x(0)) * (DEST[0] - START[0]) + (P0.z(k) - P0.z(0)) * (DEST[1] - START[1]) > 0; };
    const ln = net.nearestLane(START[0], START[1], 160, l => l.cls <= 5 && ahead(l)), dl = net.nearestLane(DEST[0], DEST[1], 80, l => l.cls <= 3);
    const dest = dl ? dl.pos.clone() : new ctx.T.Vector3(DEST[0], 0, DEST[1]);
    const cab = ctx.vehicle('taxi', ln.pos.clone(), Math.atan2(-ln.dir.x, -ln.dir.z));
    // (traffic only waits for what's in its obstacle list, and would ram a cab parked in its lane: held till we're in)
    const hold = { x: cab.position.x, z: cab.position.z, r: 1.4 }, parked = () => { g.traffic.obstacles?.push(hold); return P.vehicle === cab; };
    ctx.text('Uncle Ah Seng', 'Boss, help me can? My back pain, cannot drive. My regular auntie must reach <b>SGH</b> for her check-up.');
    await ctx.until(parked, 1.4);
    ctx.text('Uncle Ah Seng', 'My licence <b>23 points</b> already. One more saman, finish. CashCard also no money, so <b>ERP</b> also cannot. Drive properly ah!');
    g.missions.extraBlips = [{ x: cab.position.x, z: cab.position.z, type: 'vehicle', color: '#ffc94a' }];
    ctx.objective("Get in Uncle Ah Seng's <b>taxi</b>");
    await ctx.until(parked);

    // ---- the rules: every Fine City ticket counts, the hospitals get slow zones, a gantry is a violation
    const hospitals = F.hospitals.filter(h => Math.hypot(h.x - dest.x, h.z - dest.z) < 600);
    F.enforce = true; F.zones = hospitals.map(h => ({ x: h.x, z: h.z, r: ZONE_R, limit: ZONE_KMH, name: 'Hospital' }));
    ctx.onCleanup(() => { F.enforce = false; F.zones = []; });
    let fined = null, clock = 0;
    const offFine = g.events.on('fined', e => { if (!fined) fined = { ...e, at: clock }; });
    const offErp = g.events.on('erp', G => F.charge('ERP violation', ERP_FINE, `${G.name} gantry · CashCard empty · <b>S$${ERP_FINE} admin fee</b>`));
    ctx.onCleanup(() => { offFine(); offErp(); });

    // the route sets the time limit; cameras, gantries and the zones near the cab show on the radar
    const route = net.route(P.position.x, P.position.z, dest.x, dest.z);
    let len = 0; if (route) for (let i = 1; i < route.length; i++) len += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
    const TIME = Math.round(Math.min(300, Math.max(120, (len || 2500) / PACE + 25)));
    const rules = [
      ...g.wanted.cameras.map(c => ({ x: c.x, z: c.z, type: 'objective', color: '#f4f2ff', label: 'S' })),
      ...g.extras.gantries.map(G => ({ x: G.x, z: G.z, type: 'objective', color: '#ffc94a', label: '$' })),
      ...hospitals.map(h => ({ x: h.x, z: h.z, type: 'objective', color: '#3a8cff', label: 'H' })),
    ];
    const near = [];
    g.missions.extraBlips = near;
    const timer = ctx.timer(TIME, 'APPOINTMENT', 'Missed the appointment. Auntie took a Grab.');
    ctx.objective('Auntie to <b>SGH</b>, Outram Road · <u>no fines</u> on the way');
    const goal = ctx.marker(dest, { checkpoint: true, radius: 6 });
    g.routeTo({ x: dest.x, z: dest.z });
    let radarT = 0, inZone = false, told = false;
    await ctx.until(dt => {
      clock += dt;
      // the rules, once the driving tips that come with a car have had their turn
      if (!told && clock > 3) { told = true; g.ui.help('Radar: <b>S</b> speed cameras (70 km/h) · <u>$</u> ERP gantries · <i>H</i> hospital zone (40 km/h, no horn). Every red light has a camera.', 9000); }
      // (once the ticket has had its moment and gone: it would sit under the failure)
      if (fined && clock - fined.at > 4) ctx.fail(`Saman! ${fined.what}, S$${fined.amount}. Uncle Ah Seng's licence is suspended.`);
      if (g.wanted.stars > 0) ctx.fail('The Traffic Police pulled the cab over.');
      if (cab.exploded || cab.health <= 0) ctx.fail("Uncle Ah Seng's cab is wrecked.");
      const p = P.position;
      if ((radarT -= dt) <= 0) {
        radarT = 0.5; near.length = 0;
        for (const b of rules) if (Math.abs(b.x - p.x) < RADAR_R && Math.abs(b.z - p.z) < RADAR_R) near.push(b);
      }
      const z = F.zones.some(Z => Math.hypot(Z.x - p.x, Z.z - p.z) < Z.r);
      if (z && !inZone) g.ui.help('<i>Hospital zone</i> · <b>40 km/h</b> · no horn', 4000);
      inZone = z;
      return !fined && P.vehicle === cab && cab.speed < 4 && Math.hypot(p.x - dest.x, p.z - dest.z) < 8;
    });
    timer.stop(); goal.remove(); g.routeTo(null);
    g.audio?.sfx?.('checkpoint');
    const left = Math.floor(timer.left);
    ctx.text('Uncle Ah Seng', `Auntie reach already, ${left} seconds to spare, <b>no saman</b>! Uncle give you five stars. Steady lah!`);
    g.cityTalk?.remember('getaway', { left, district: districtAt(dest.x, dest.z) });
    return { reward: 3000 + left * 20, extra: `${left} s to spare · fines: <b>S$0</b> · Uncle's licence lives` };
  },
};
