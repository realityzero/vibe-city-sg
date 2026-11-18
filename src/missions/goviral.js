// Go Viral (side job, from the activity marker at One Fullerton): Chad Brogan of Sandhill Partners only backs founders
// with a following, so: one million views in three minutes, the REC pill as the objective bar. Anything the street
// films counts (near misses, jumps, drifts past people, a supercar parked up among them: world/juice.js), and three
// content creators wait at set pieces around the bay for the big clips — close shaves on Fullerton Road, a drift
// through the Collyer Quay junction, the supercar park-up at the Sands drop-off. Clips that keep coming make the
// algorithm push you (reach ×1.25, ×1.5 … ×2.5 while they come within 20 s of each other). Text only: Chad's texts, the
// creators' bubbles and their clip cards (world/bystander.js).
import { CROWD_ANIM as A } from '../entities/humanoid/index.js';
import { districtAt } from '../ui/districts.js';

const TARGET = 1e6, TIME = 180;                          // views, s
const REACH_STEP = 0.25, REACH_MAX = 2.5, REACH_COOL = 20;  // the algorithm's push per clip, its ceiling, s it lasts
const SHAVES = 2, DRIFT_S = 1;                           // close shaves in the zone, s of drifting in it
const CREATOR_NEAR = 130;                                // m: a creator turns up once the camera is this close
const START = [533, 129];                                // One Fullerton: where Chad left the car
// the set pieces: anchor (x, z), zone radius, the creator filming it, what to do, the clip's views
const PIECES = [
  { id: 'shave', at: [470, 250], r: 70, who: '@kopi.kakis', ask: 'Close shaves past <b>@kopi.kakis</b> on Fullerton Road',
    kind: 'nearmiss', tag: '#closecall', views: 170000, cheer: 'Walao, so close! Posting now!', variant: 'female', top: 0xff5fb0 },
  { id: 'drift', at: [332, 532], r: 30, who: '@shiok.drives', ask: 'Drift the <b>Collyer Quay</b> junction for <b>@shiok.drives</b>',
    kind: 'drift', tag: '#driftking', views: 210000, cheer: 'Tokyo drift? Tanjong drift lah!', variant: 'male', top: 0x2fe6ff },
  { id: 'park', at: [1259, 364], r: 6, who: '@sg.carspotters', ask: 'Park up at the <b>Sands</b> drop-off for <b>@sg.carspotters</b>',
    kind: 'supercar', tag: '#carspotting', views: 250000, cheer: 'Wah, Infernus! Photo first!', variant: 'tourist', top: 0xffd23f },
];
const fmtViews = n => n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}K`;

export const GO_VIRAL = {
  id: 'go_viral', side: true, filmable: true, title: 'Go Viral', subtitle: 'Side job', passTitle: 'Gone viral!', reward: 5000,
  async run(ctx) {
    const g = ctx.game, P = g.player, net = g.roadnet;
    // ---- Chad's car, by the kerb at One Fullerton
    const ln = net.nearestLane(START[0], START[1], 160, l => l.cls <= 5);
    const car = ctx.vehicle('infernus', ln.pos.clone(), Math.atan2(-ln.dir.x, -ln.dir.z), { color: 0xff3fa4 });
    // (traffic only waits for what's in its obstacle list, and would ram a car parked in its lane: held till we're in)
    const hold = { x: car.position.x, z: car.position.z, r: 1.4 }, parked = () => { g.traffic.obstacles?.push(hold); return P.vehicle === car; };
    ctx.text('Chad Brogan', 'Bro. Sandhill only backs founders with a <b>following</b>. 1M views in 3 minutes and we talk term sheets.');
    await ctx.until(parked, 1.2);
    ctx.text('Chad Brogan', 'Left you my pink Infernus outside One Fullerton. Content creators are waiting round the bay. Go.');
    g.missions.extraBlips = [{ x: car.position.x, z: car.position.z, type: 'vehicle', color: '#ff3fa4' }];
    ctx.objective("Get in Chad's <b>Infernus</b>");
    await ctx.until(parked);

    // ---- the set pieces: a creator, a pink beacon over their spot, a ring where the park-up must stop
    const pieces = PIECES.map(d => {
      const sw = net.nearestSidewalk(d.at[0], d.at[1], 60);
      const spot = sw ? sw.pos.clone() : new ctx.T.Vector3(d.at[0], 0, d.at[1]);
      const pc = { ...d, spot, done: false, ped: null };
      // (the park-up's beacon is the ring it must stop in)
      const l = d.id === 'park' && net.nearestLane(d.at[0], d.at[1], 40);
      pc.stop = l ? l.pos.clone() : spot;
      pc.beacon = l ? ctx.marker(pc.stop, { checkpoint: true, radius: 4, height: 3, color: 0xff3fa4 }) : ctx.marker(spot, { type: 'mission', radius: 0.8, height: 4 });
      pc.beacon.blip.type = 'objective'; pc.beacon.blip.color = '#ff3fa4';
      return pc;
    });
    ctx.onCleanup(() => { for (const pc of pieces) if (pc.ped) leave(g, pc.ped); });

    // ---- the views: the REC pill becomes the objective bar; clips that keep coming raise the reach
    let total = 0, clock = 0, lastClip = -99, shaves = 0, driftT = 0;
    g.ui.views.goal(TARGET); g.hype.reach = 1;
    ctx.onCleanup(() => { g.ui.views.goal(0); g.hype.reach = 1; });
    const offViews = g.events.on('views', e => {
      total += e.views;
      g.hype.reach = clock - lastClip < REACH_COOL ? Math.min(REACH_MAX, g.hype.reach + REACH_STEP) : 1 + REACH_STEP;
      lastClip = clock;
      g.ui.views.boost(g.hype.reach);
    });
    const inZone = pc => !pc.done && Math.hypot(P.position.x - pc.at[0], P.position.z - pc.at[1]) < pc.r;
    const offShave = g.events.on('nearMiss', () => {
      const pc = pieces[0]; if (!inZone(pc)) return;
      if (++shaves >= SHAVES) posted(pc); else g.ui.help(`Close shave <b>${shaves}/${SHAVES}</b> for <b>${pc.who}</b>`, 2500);
    });
    const offPark = g.events.on('exitVehicle', v => {
      const pc = pieces[2];
      if (!pc.done && v.spec.maxSpeed >= 66 && v.speed < 3 && Math.hypot(v.position.x - pc.stop.x, v.position.z - pc.stop.z) < pc.r) posted(pc);
    });
    ctx.onCleanup(() => { offViews(); offShave(); offPark(); });

    // a set piece pulled off: the creator posts it (the big clip, filmed from where they stand), the street joins in
    const posted = pc => {
      pc.done = true; pc.beacon.remove();
      g.audio?.sfx?.('checkpoint');
      g.hype.clip(pc.views * (0.9 + Math.random() * 0.2), { kind: pc.kind, tag: pc.tag, pos: P.position, by: pc.ped || { pos: pc.spot, yaw: 0, hs: 1 }, handle: pc.who });
      g.bark('admire', pc.ped ? pc.ped.pos : pc.spot, 0, { text: pc.cheer });
      if (pc.id !== 'park') g.juice.film(P.position, pc.kind, true, true); // (a park-up brings the crowd round by itself)
      const left = pieces.filter(q => !q.done);
      if (left.length) g.ui.help(`<b>${pc.who}</b> posted it. ${left.length} creator${left.length > 1 ? 's' : ''} left on your radar.`, 4000);
    };

    const timer = ctx.timer(TIME, 'GO VIRAL');
    timer.onExpire = () => g.missions.abort(`Only ${fmtViews(total)} views. Chad left you on read.`);
    g.missions.extraBlips = null;
    ctx.objective('Get <b>1M views</b> · show off in front of people · <b>creators</b> on radar');
    await ctx.until(dt => {
      clock += dt;
      if (clock - lastClip > REACH_COOL && g.hype.reach > 1) { g.hype.reach = 1; g.ui.views.boost(1); }
      const v = P.vehicle, drift = pieces[1];
      if (v && inZone(drift) && v.skid > 0.5 && v.speed > 7) { if ((driftT += dt) >= DRIFT_S) posted(drift); }
      else driftT = Math.max(0, driftT - dt);
      for (const pc of pieces) if (!pc.done && !pc.ped) pc.ped = creator(g, pc);
      return total >= TARGET;
    });
    timer.stop();
    const took = Math.round(TIME - timer.left);
    await ctx.wait(1.6); // (the pill counts up and lights green)
    g.cityTalk?.remember('viral', { views: total, district: districtAt(P.position.x, P.position.z) });
    return { reward: 5000, extra: `${fmtViews(total)} views in ${took} s · Chad: "Bro. BRO. Let's do lunch."` };
  },
};

/** the creator at a set piece: a crowd person (they only exist near the camera) filming the player from their spot,
 *  dressed loud; added once the camera is close but they can't be seen appearing */
function creator(g, pc) {
  const peds = g.peds, V = peds.viewer, d = Math.hypot(pc.spot.x - V.x, pc.spot.z - V.z);
  if (d > CREATOR_NEAR || !peds.unseen(pc.spot.x, pc.spot.z, d)) return null;
  const p = peds.addScripted(pc.variant, pc.spot.x, pc.spot.z, 0, A.film);
  if (!p) return null;
  p.look.colors.top = pc.top; p.look.pattern = 0;
  p.film = { x: 0, z: 0, follow: true, delay: 0, back: 'walk', yaw: 0 };
  p.state = 'film'; p.t = Infinity;
  return p;
}
function leave(g, p) { if (!g.peds.peds.includes(p)) return; p.film = null; p.t = 0; g.peds.release(p); }
