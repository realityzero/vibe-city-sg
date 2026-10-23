// The story: Tommy Vercetti vibe-codes a startup and raises a Series A in Singapore. Eight missions.
import * as THREE from 'three';
import { PathDriver } from '../entities/aiDriver.js';
import { Fireworks } from '../world/fireworks.js';
import { clearLine, spotFree } from '../core/visibility.js';
import { tanDealLines } from './vodyn.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const fmt = n => 'S$' + Math.round(n).toLocaleString('en-SG');

// ---- locations (world metres; x east, z south)
const LOC = {
  capsule: V(-386, 0, 392),      // Galaxy Pods Capsule Hotel, Chinatown
  laupasat: V(167, 0, 706),      // Lau Pa Sat
  wehustle: V(-630, 0, 888),     // "WeHustle" co-working, Duxton Road shophouses
  clarke: V(-395, 0, -338),      // Clarke Quay
  hongLim: V(-336, 0, 190), chinatownCx: V(-673, 0, 177), maxwell: V(-476, 0, 709), amoy: V(-260, 0, 846),
  expo: V(1135, 0, 300),         // Sands Expo, Marina Bay Sands
  mbsLobby: V(1305, 0, 365),
  pit: V(1500, 0, -740),         // F1 pit building, Republic Boulevard
};

function walkSpot(g, p, r = 140) {
  const s = g.roadnet.nearestSidewalk(p.x, p.z, r);
  return s ? s.pos : p.clone();
}
function sidewalkInfo(g, p) { return g.roadnet.nearestSidewalk(p.x, p.z, 140); }
function laneSpot(g, p, filter) {
  const n = g.roadnet.nearestLane(p.x, p.z, 160, filter || (l => l.cls <= 5));
  if (!n) return { pos: p.clone(), yaw: 0 };
  return { pos: n.pos.clone(), yaw: Math.atan2(-n.dir.x, -n.dir.z), lane: n.lane, s: n.s, dir: n.dir.clone() };
}
// camera framing helpers
// the open side of the current scene (towards the road), set by stage()
let ROAD = null;
// true if nothing solid stands at p (no roof/structure overhead, no wall within r)
function isFree(g, p, r = 0.9) {
  const P = g.physics; if (!P) return true;
  if (!spotFree(g, p)) return false;
  for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
    const h = P.raycast({ x: p.x + ox, y: 80, z: p.z + oz }, { x: 0, y: -1, z: 0 }, 90);
    if (h && h.point.y > 0.6) return false;
  }
  return true;
}
function freeSpot(g, p, along = V(1, 0, 0), road = null) {
  for (let k = 0; k < 40; k++) {
    const d = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 1.5;
    const q = p.clone().addScaledVector(along, d);
    if (isFree(g, q)) return q;
    if (road) { const q2 = q.clone().addScaledVector(road, 1.2); if (isFree(g, q2)) return q2; }
  }
  return p.clone();
}
function stage(g, p) {
  const inf = g.roadnet.nearestSidewalk(p.x, p.z, 160);
  if (!inf) { ROAD = null; return { pos: p.clone(), along: V(1, 0, 0), road: V(0, 0, 1) }; }
  ROAD = inf.toRoad.clone();
  const pos = freeSpot(g, inf.pos, inf.dir, inf.toRoad);
  return { pos, along: inf.dir.clone(), road: inf.toRoad.clone(), beside: (d = 1.7) => freeSpot(g, pos.clone().addScaledVector(inf.dir, d), inf.dir, inf.toRoad) };
}
function over(a, b, back = 3.2, up = 1.7, side = 0.9) {
  // over-the-shoulder of a looking at b, shifted towards the open (road) side
  const d = new THREE.Vector3().subVectors(b, a).setY(0);
  if (d.lengthSq() < 1e-4) d.set(1, 0, 0);
  d.normalize();
  const r = new THREE.Vector3(-d.z, 0, d.x);
  if (ROAD && r.dot(ROAD) < 0) r.negate();
  return { pos: a.clone().addScaledVector(d, -back).addScaledVector(r, Math.abs(side)).setY(a.y + up), look: b.clone().setY(b.y + 1.5), subjects: [a, b] };
}
function two(a, b, dist = 5.5, h = 1.7) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const d = new THREE.Vector3().subVectors(b, a).setY(0);
  if (d.lengthSq() < 1e-4) d.set(1, 0, 0);
  d.normalize();
  const n = new THREE.Vector3(-d.z, 0, d.x);
  if (ROAD && n.dot(ROAD) < 0) n.negate();
  return { pos: mid.clone().addScaledVector(n, dist).setY(mid.y + h), look: mid.clone().setY(mid.y + 1.45), subjects: [a, b] };
}

// pick an unobstructed camera position: try the requested framing, then orbit / pull in until every subject is visible
function clearShot(g, f) {
  const look = f.look; const base = f.pos.clone().sub(look);
  const heads = (f.subjects || [look]).map(p => p.clone().setY((p.y || 0) + 1.55));
  const ok = cand => heads.every(h => clearLine(g, cand, h)) && clearLine(g, cand, look);
  for (const scale of [1, 0.75, 0.55, 1.35]) {
    for (let k = 0; k < 9; k++) {
      const ang = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35;
      const cand = look.clone().add(base.clone().multiplyScalar(scale).applyAxisAngle(new THREE.Vector3(0, 1, 0), ang));
      if (ok(cand)) return { pos: cand, look };
    }
  }
  return { pos: look.clone().add(base.clone().setY(Math.abs(base.y) + 6)), look };
}
async function shot(c, f, opts) { const s = clearShot(c.game, f); c.cam(s.pos, s.look, opts); }

export const STORY = [
  // ------------------------------------------------------------------ 1
  {
    id: 'lion_city', title: 'The Lion City', subtitle: 'Mission 1', autoStart: true, reward: 5000, noTitle: true,
    retry: { pos: LOC.capsule, hint: 'Retry: head back to the <b>capsule hotel</b> in Chinatown.' },
    async run(c, S) {
      const g = c.game;
      c.setTime(18.1);
      g.missions.weatherLocked = true; g.missions.weatherTarget = 0;
      const st0 = stage(g, LOC.capsule);
      const start = st0.pos;
      const info = { toRoad: st0.road, dir: st0.along };
      const facing = info ? Math.atan2(-info.toRoad.x, -info.toRoad.z) : 0;
      c.teleport(start, facing);
      await c.cutscene(async () => {
        // establishing shot: sunset over Marina Bay
        await c.pan(V(350, 70, -260), V(820, 38, 40), V(1250, 110, 360), V(1300, 90, 380), 7, 42);
        g.ui.missionTitle('SINGAPORE', '1°17′N 103°51′E · 2026');
        await c.pan(V(820, 38, 40), V(1000, 22, 120), V(1300, 90, 380), V(1290, 160, 380), 5, 42);
        // Chinatown street, Tommy steps out of the capsule hotel
        const T = g.player.position.clone();
        const road = info?.toRoad || V(1, 0, 0), along = info?.dir || V(0, 0, 1);
        await shot(c, { pos: T.clone().addScaledVector(road, 7).addScaledVector(along, 5).setY(4.5), look: T.clone().setY(1.5) }, { snap: true, fov: 45 });
        await c.wait(0.5);
        await shot(c, { pos: T.clone().addScaledVector(road, 3.6).addScaledVector(along, 1.6).setY(1.75), look: T.clone().setY(1.6) }, { lerp: 0.8, fov: 40 });
        await c.say([
          { speaker: 'Tommy', text: 'A capsule hotel. Forty years after Vice City and I\'m sleeping in a <b>drawer</b>.' },
          { speaker: 'Tommy', text: 'Thirty-one degrees at sunset. Even the air here has a <i>KPI</i>.' },
        ]);
      });
      await c.phone('Ken Rosenberg', [
        { speaker: 'Ken', text: 'Tommy! Tommy, you landed! Welcome to Singapore — the only city where <b>chewing gum</b> has a criminal record!' },
        { speaker: 'Tommy', text: 'Ken. Why am I here?' },
        { speaker: 'Ken', text: 'Sonny Forelli. He wants his money back, Tommy. All of it. Plus interest. Plus — and I quote — "vibes".' },
        { speaker: 'Tommy', text: 'I don\'t have Sonny\'s money.' },
        { speaker: 'Ken', text: 'Nobody HAS money anymore, Tommy! You <b>raise</b> money! Meet me at <b>Lau Pa Sat</b>. Big octagon, clock tower, satay. You\'re buying.' },
      ]);
      c.objective('Go to <b>Lau Pa Sat</b> to meet Ken. Follow the <b>GPS route</b> on the radar.');
      // onboarding tips run alongside the objective
      const tips = [[1.5, '<b>W A S D</b> to move, <b>mouse</b> to look (click the screen to lock it). Hold <b>Shift</b> to sprint.'], [10, 'Press <b>F</b> next to a car to "borrow" it. In Singapore that\'s a fine. Everything here is a fine.'], [20, 'Press <b>M</b> for the map. Pink markers start missions. <b>Esc</b> pauses the game.']];
      for (const [t, msg] of tips) setTimeout(() => { if (!c.aborted && g.missions.active?.ctx === c) c.help(msg, 8500); }, t * 1000);
      const meet = stage(g, LOC.laupasat).pos;
      await c.reach(meet, { radius: 3.5, onFoot: true });
      // cutscene with Ken
      const st1 = stage(g, meet);
      const kenPos = st1.beside(1.7);
      const ken = c.npc('ken', kenPos, 0, 'talk');
      await c.cutscene(async () => {
        const T = st1.pos.clone();
        c.teleport(T, Math.atan2(-(kenPos.x - T.x), -(kenPos.z - T.z)));
        ken.face(T);
        g.player.setAnim('idle');
        await shot(c, two(T, kenPos, 4.5), { snap: true, fov: 42 });
        await c.say([
          { speaker: 'Ken', text: 'Tommy! Over here! Try the satay — no wait, I\'m allergic to peanuts, sit downwind.' },
          { speaker: 'Tommy', text: 'Talk, Ken.' },
        ]);
        await shot(c, over(T, kenPos), { lerp: 3, fov: 38 });
        await c.say([
          { speaker: 'Ken', text: 'Okay. Okay. 1986: you sell product, you launder it through a print shop, an ice cream factory, a car showroom...' },
          { speaker: 'Tommy', text: 'I remember, Ken. I was there.' },
          { speaker: 'Ken', text: '2026: you build an <b>"AI-native platform"</b>, investors give YOU the money, and it\'s all <em>legal</em>. They call it a seed round!' },
        ]);
        await shot(c, over(kenPos, T), { lerp: 3, fov: 38 });
        await c.say([
          { speaker: 'Tommy', text: 'I don\'t know how to code.' },
          { speaker: 'Ken', text: 'Nobody codes anymore! That\'s the beauty! You just... <i>vibe</i>. You tell the AI what you want and it writes the code.' },
          { speaker: 'Ken', text: 'Half the founders in this city can\'t spell JavaScript. One of them is worth four hundred million.' },
          { speaker: 'Tommy', text: 'And the catch?' },
        ]);
        await shot(c, two(T, kenPos, 3.8, 1.5), { lerp: 2, fov: 40 });
        await c.say([
          { speaker: 'Ken', text: 'The catch is the AI does exactly what you tell it. Including the stupid stuff. So — don\'t say stupid stuff.' },
          { speaker: 'Ken', text: 'Here. Five grand from my CPF. Don\'t tell my wife. Get a desk at <b>WeHustle</b> on <b>Duxton Road</b>.' },
          { speaker: 'Tommy', text: 'Sonny gets paid, Ken. Then I\'m done.' },
          { speaker: 'Ken', text: 'That\'s what everybody says before their Series B.' },
        ]);
      });
      ken.setAnim('wave');
      g.missions.weatherLocked = false;
      return { reward: 5000 };
    },
  },
  // ------------------------------------------------------------------ 2
  {
    id: 'vibe_coding', title: 'Vibe Coding', subtitle: 'Mission 2', reward: 1000,
    giver: { pos: LOC.wehustle, hint: 'A pink marker on your radar starts the next mission: <b>WeHustle</b> on Duxton Road.' },
    async run(c, S) {
      const g = c.game;
      const st2 = stage(g, g.player.position);
      const T = st2.pos.clone();
      const jasPos = st2.beside(1.6);
      const jas = c.npc('office_f', jasPos, 0, 'talk');
      await c.cutscene(async () => {
        jas.face(T); c.teleport(T, Math.atan2(-(jasPos.x - T.x), -(jasPos.z - T.z)));
        await shot(c, two(T, jasPos, 4), { snap: true, fov: 40 });
        await c.say([
          { speaker: 'Jasmine', text: 'Welcome to <b>WeHustle</b>! Hot desk is S$900 a month, kombucha is free, sleeping here is not allowed but everyone does.' },
          { speaker: 'Tommy', text: 'I need a desk. And one of those AIs.' },
          { speaker: 'Jasmine', text: 'Desk 42. The AI is called <i>Claudia</i>. Be nice to her. Last founder yelled at her and she refactored his whole company into a spreadsheet.' },
        ]);
      });
      const r = await c.minigame('vibecode');
      Object.assign(S, { idea: r.idea, ideaName: r.ideaName, quality: r.quality, techDebt: r.techDebt });
      S.valuation = Math.round(800000 + r.quality * 15000);
      g.missions.valuation = S.valuation;
      jas.setAnim('cheer');
      await c.say([
        { speaker: 'Tommy', text: `<b>${r.ideaName}</b>. Shipped. I'm a tech founder now.` },
        { speaker: 'Jasmine', text: 'Congrats! Please return the lanyard when you pivot.' },
      ]);
      return { reward: 1000, extra: `Pre-seed valuation ${fmt(S.valuation)}` };
    },
    after(g) { setTimeout(() => { g.audio?.sfx?.('text_message'); g.ui.phone.text('Ken Rosenberg', 'Heard you shipped!! Lance Vance is in town. Says he\'s a "growth hacker" now. Meet him at Clarke Quay. Bring sunscreen.'); }, 4000); },
  },
  // ------------------------------------------------------------------ 3
  {
    id: 'chope', title: 'Chope!', subtitle: 'Mission 3', reward: 3000,
    giver: { pos: LOC.clarke, hint: 'Meet <b>Lance Vance</b> at <b>Clarke Quay</b>.' },
    async run(c, S) {
      const g = c.game;
      const st3 = stage(g, g.player.position);
      const T = st3.pos.clone(), along = st3.along;
      const lancePos = st3.beside(1.8);
      const lance = c.npc('lance', lancePos, 0, 'talk');
      const car = laneSpot(g, T.clone().addScaledVector(along, 10));
      const stinger = c.vehicle('stinger', car.pos, car.yaw, { keep: true, color: 0xc8141c });
      await c.cutscene(async () => {
        lance.face(T); c.teleport(T, Math.atan2(-(lancePos.x - T.x), -(lancePos.z - T.z)));
        await shot(c, two(T, lancePos, 4.5), { snap: true, fov: 40 });
        await c.say([
          { speaker: 'Lance', text: 'Tommy Vercetti. The comeback kid.' },
          { speaker: 'Tommy', text: 'Lance. Last time I saw you, things ended... badly.' },
          { speaker: 'Lance', text: 'Water under the Helix Bridge, man. I\'m a growth hacker now. I have a ring light.' },
        ]);
        await shot(c, over(T, lancePos), { lerp: 3, fov: 36 });
        await c.say([
          { speaker: 'Lance', text: 'Listen. Investors don\'t care about product. They care about <b>users</b>. And where is every single person in this city at lunch?' },
          { speaker: 'Tommy', text: 'Prison?' },
          { speaker: 'Lance', text: '<b>Hawker centres</b>! We slap a QR code on every table. "Scan to <i>chope</i>." Tissue packets are legacy infrastructure, Tommy.' },
        ]);
        await shot(c, over(lancePos, stinger.position, 4, 2.2, -1.5), { lerp: 2, fov: 45 });
        await c.say([
          { speaker: 'Lance', text: 'Take my Stinger. Four hawker centres. Lunch rush ends in five minutes. Go go go!' },
        ]);
      });
      lance.setAnim('point');
      const stops = [['Hong Lim Food Centre', LOC.hongLim], ['Chinatown Complex', LOC.chinatownCx], ['Maxwell Food Centre', LOC.maxwell], ['Amoy Street Food Centre', LOC.amoy]];
      const targets = stops.map(([name, p]) => ({ name, pos: laneSpot(g, p).pos, done: false }));
      c.objective('Get in the <b>Stinger</b>, then hit all four <b>hawker centres</b> before the lunch rush ends.');
      const timer = c.timer(300, 'LUNCH RUSH', 'The lunch rush is over');
      g.ui.counter.show('USERS', 0, 2000);
      const handles = targets.map(t => ({ t, h: c.marker(t.pos, { checkpoint: true, radius: 7, blip: 'checkpoint' }) }));
      let users = 0;
      const quips = ['Auntie: "Aiyo, QR code again? Can scan for free chicken rice or not?"', 'Uncle: "Chope with app? Then my tissue packet how?"', 'Student: "Is this a crypto thing? I\'m in."', 'Auntie: "Download app ah? Okay okay, but I give one star first."'];
      while (handles.some(x => !x.t.done)) {
        await c.until(() => {
          const P = g.player.position;
          for (const x of handles) if (!x.t.done && Math.hypot(P.x - x.t.pos.x, P.z - x.t.pos.z) < 9) { x.t.done = true; x.h.remove(); return true; }
          return false;
        });
        users += 500; g.ui.counter.set(users);
        g.audio?.sfx?.('cash_register');
        c.splash('+500 USERS');
        g.ui.subtitle(quips[handles.filter(x => x.t.done).length - 1] || '', { duration: 3500 });
      }
      timer.stop();
      const bonus = Math.round(timer.left * 4);
      S.users = 2000 + bonus;
      g.missions.users = S.users;
      return { reward: 3000, extra: `${S.users.toLocaleString()} users signed up` };
    },
  },
  // ------------------------------------------------------------------ 4
  {
    id: 'poached', title: 'Poached', subtitle: 'Mission 4', reward: 4000, autoStart: true, noTitle: false,
    retry: { pos: LOC.wehustle, hint: 'Retry: Lance is waiting at <b>WeHustle</b>.' },
    async run(c, S) {
      const g = c.game;
      await c.wait(6);
      await c.phone('Lance Vance', [
        { speaker: 'Lance', text: 'TOMMY! Some scout from <b>Why Combinator</b> just walked off with my laptop! All our growth scripts are on it!' },
        { speaker: 'Tommy', text: 'Your passwords are on a sticky note, aren\'t they.' },
        { speaker: 'Lance', text: 'The sticky note is ON the laptop, Tommy! He\'s in a <b>black Mercedez</b>, heading your way! Get it back!' },
      ]);
      const P = g.player.position;
      // spawn the scout's car ~120 m away on a lane and give it a long route
      let spot = null;
      for (let k = 0; k < 30 && !spot; k++) {
        const a = Math.random() * Math.PI * 2;
        const p = laneSpot(g, V(P.x + Math.cos(a) * 120, 0, P.z + Math.sin(a) * 120), l => l.cls <= 4);
        if (p.lane && p.pos.distanceTo(P) > 70 && p.pos.distanceTo(P) < 200) spot = p;
      }
      spot = spot || laneSpot(g, V(P.x + 100, 0, P.z));
      const scout = c.vehicle('luxury', spot.pos, spot.yaw, { color: 0x111214 });
      scout.locked = true; scout.health = 99999;
      const route = g.roadnet.randomRoute(spot.pos.x, spot.pos.z, 6000, 4) || [[spot.pos.x, spot.pos.z], [spot.pos.x + 500, spot.pos.z]];
      const drv = new PathDriver(g, scout, route, { speed: 0.7, aggression: 1 });
      const stepFn = h => drv.update(h);
      g.physics.onStep(stepFn);
      c.onCleanup(() => { const i = g.physics.stepCallbacks.indexOf(stepFn); if (i >= 0) g.physics.stepCallbacks.splice(i, 1); });
      if (g.audio?.createEngine) scout.engine = g.audio.createEngine({ type: 'sedan' });
      c.objective('Ram the <b>black Mercedez</b> until the scout gives up the laptop.');
      if (!g.player.vehicle) c.help('You\'ll need wheels. Press <b>F</b> by any car.');
      g.ui.bar.show('SCOUT\'S CAR', 1, '#ff4060');
      const blip = { x: 0, z: 0, type: 'enemy' };
      g.missions.extraBlips = [blip];
      c.onCleanup(() => { g.missions.extraBlips = []; });
      let hp = 1;
      const off = g.events.on('vehicleImpact', ({ vehicle, damage, other }) => {
        if (vehicle === g.player.vehicle && other === scout.collider.handle) { hp -= Math.min(0.3, 0.06 + damage / 400); g.ui.bar.set(Math.max(0, hp)); }
      });
      c.onCleanup(off);
      await c.until(() => {
        blip.x = scout.position.x; blip.z = scout.position.z;
        const d = scout.position.distanceTo(g.player.position);
        if (d > 300) c.fail('The scout got away with the laptop.');
        if (drv.done) drv.setRoute(g.roadnet.randomRoute(scout.position.x, scout.position.z, 5000, 4) || route);
        return hp <= 0;
      });
      g.ui.bar.hide();
      const i = g.physics.stepCallbacks.indexOf(stepFn); if (i >= 0) g.physics.stepCallbacks.splice(i, 1);
      scout.setDriverControls({ throttle: 0, brake: 1, steer: 0, handbrake: true }, 0.016);
      c.say([{ speaker: 'Scout', text: 'OKAY! OKAY! Take it! I\'m going back to consulting!' }]).catch(() => {}); // voiced; doesn't hold up the chase
      const scoutNpc = c.npc('kyle', scout.doorPosition(V(0, 0, 0)), 0, 'run');
      const lapPos = scout.position.clone().add(V(0, 0, 0));
      const pk = c.marker(scout.doorPosition(V(0, 0, 0)).setY(0), { type: 'pickup', radius: 1.2, blip: 'objective' });
      c.objective('Grab the <b>laptop</b>.');
      let fleeT = 0;
      await c.until(dt => {
        fleeT += dt; const r = scoutNpc.root; r.position.x += Math.sin(r.rotation.y + Math.PI) * dt * 5; r.position.z += Math.cos(r.rotation.y + Math.PI) * dt * 5; if (fleeT > 6) r.visible = false;
        return !g.player.vehicle && g.player.position.distanceTo(pk.m.position) < 2.2;
      });
      pk.remove();
      g.audio?.sfx?.('pickup');
      c.splash('LAPTOP RECOVERED', '#2fe6ff');
      await c.reach(walkSpot(g, LOC.wehustle), { radius: 4, text: 'Bring the laptop back to <b>WeHustle</b>.' });
      await c.say([{ speaker: 'Tommy', text: 'Lance. Change your passwords. All of them. Today.' }]);
      return { reward: 4000 };
    },
  },
  // ------------------------------------------------------------------ 5
  {
    id: 'demo_day', title: 'Demo Day', subtitle: 'Mission 5', reward: 0, passTitle: 'Made it!',
    giver: { pos: LOC.wehustle, hint: 'Demo Day is tonight. Start at <b>WeHustle</b>.' },
    async run(c, S) {
      const g = c.game;
      c.setTime(18.83);
      g.missions.timeFrozen = true;
      const st5 = stage(g, g.player.position);
      const T = st5.pos.clone(), along = st5.along;
      const lancePos = st5.beside(1.6);
      const lance = c.npc('lance', lancePos, 0, 'phone');
      const carSpot = laneSpot(g, T.clone().addScaledVector(along, 9));
      const ride = c.vehicle('infernus', carSpot.pos, carSpot.yaw, { keep: true, color: 0xf7f7f4 });
      await c.cutscene(async () => {
        lance.face(T); c.teleport(T, Math.atan2(-(lancePos.x - T.x), -(lancePos.z - T.z)));
        await shot(c, two(T, lancePos, 4.2), { snap: true, fov: 40 });
        await c.say([
          { speaker: 'Lance', text: 'Ken\'s on the phone. He\'s been screaming for ten minutes. I put him on speaker.' },
          { speaker: 'Ken', text: 'DEMO DAY! SEVEN O\'CLOCK! <b>Marina Bay Sands Expo</b>! If you\'re late they give your slot to a guy selling NFTs of hawker stalls!' },
          { speaker: 'Tommy', text: 'What time is it?' },
          { speaker: 'Lance', text: 'Six fifty. I leased you a car. It\'s on Ken\'s personal guarantee.' },
          { speaker: 'Ken', text: 'Do NOT scratch the Infernus, Tommy! And watch the <b>ERP</b> gantries, they charge per vibe!' },
        ]);
      });
      lance.remove();
      const dest = laneSpot(g, LOC.expo).pos;
      const timer = c.timer(170, 'DEMO DAY', 'You missed your demo slot');
      c.objective('Get to the <b>Sands Expo</b> at <b>Marina Bay Sands</b>!');
      await c.reach(dest, { radius: 10, vehicle: true, checkpoint: true });
      timer.stop();
      S.lateness = timer.left;
      g.missions.timeFrozen = false;
      return { reward: 2000, extra: `${Math.floor(timer.left)}s to spare` };
    },
  },
  // ------------------------------------------------------------------ 6
  {
    id: 'pitch', title: 'The Pitch', subtitle: 'Mission 6', reward: 5000, autoStart: true,
    retry: { pos: LOC.expo, hint: 'Retry: Demo Day is still on at the <b>Sands Expo</b>.' },
    async run(c, S) {
      const g = c.game;
      c.setTime(19.0);
      g.missions.timeFrozen = true;
      if (g.player.vehicle) g.player.exitVehicle();
      const st6 = stage(g, LOC.expo);
      const meet = st6.pos.clone(), along = st6.along;
      c.teleport(meet, g.player.facing);
      const kenPos = st6.beside(1.7);
      const ken = c.npc('ken', kenPos, 0, 'talk');
      console.log('M6 stage', JSON.stringify({ meet, kenPos, along, road: st6.road }));
      await c.cutscene(async () => {
        ken.face(meet); c.teleport(meet, Math.atan2(-(kenPos.x - meet.x), -(kenPos.z - meet.z)));
        c.cam(V(1050, 30, 160), V(1300, 120, 380), { snap: true, fov: 50 });
        await c.wait(2.2);
        await shot(c, two(meet, kenPos, 4.2), { lerp: 2, fov: 40 });
        await c.say([
          { speaker: 'Ken', text: 'Okay. Okay. Three investors. <b>Priya Raman</b>, Merlion Ventures — she reads the footnotes. Of the footnotes.' },
          { speaker: 'Ken', text: '<b>Chad Brogan</b>, Sandhill Partners. He reads nothing. Just say "AGI" and point at the ceiling.' },
          { speaker: 'Ken', text: 'And <b>Auntie Mei</b>. Eleven chicken rice stalls and a Tesla. Do NOT mention the durian thing.' },
          { speaker: 'Tommy', text: 'What durian thing?' },
          { speaker: 'Ken', text: 'EXACTLY.' },
        ]);
      });
      const res = await c.minigame('pitch', { idea: S.idea || 'chopechain', ideaName: S.ideaName || 'ChopeChain', quality: S.quality ?? 60, users: S.users ?? 2000 });
      S.pitch = res;
      S.valuation = Math.round(3000000 + res.score * 120000);
      g.missions.valuation = S.valuation;
      // the rival appears
      const kylePos = st6.beside(-2.2);
      const kyle = c.npc('kyle', kylePos, 0, 'talk');
      await c.cutscene(async () => {
        kyle.face(meet); c.teleport(meet, Math.atan2(-(kylePos.x - meet.x), -(kylePos.z - meet.z)));
        await shot(c, two(meet, kylePos, 4), { snap: true, fov: 40 });
        await c.say([
          { speaker: 'Kyle', text: 'Cute pitch. Kyle Zhang, <b>ChopeAI</b>. Same idea as yours — but with a Stanford degree and a podcast.' },
          { speaker: 'Tommy', text: 'Congratulations.' },
          { speaker: 'Kyle', text: '<b>Temasick Holdings</b> only takes one meeting with a founder this year. Mr. Tan likes... decisive people.' },
          { speaker: 'Kyle', text: 'So let\'s decide. Tonight. The <b>Marina Bay street circuit</b>. Winner gets Mr. Tan.' },
          { speaker: 'Tommy', text: 'You want to race me. Kid, I was running red lights before you had a LinkedIn.' },
        ]);
      });
      g.missions.timeFrozen = false;
      return { reward: 5000, extra: `Valuation now ${fmt(S.valuation)}` };
    },
  },
  // ------------------------------------------------------------------ 7
  {
    id: 'street_circuit', title: 'Street Circuit', subtitle: 'Mission 7', reward: 10000,
    giver: { pos: LOC.pit, hint: 'Kyle is waiting at the <b>F1 Pit Building</b> on Republic Boulevard.' },
    async run(c, S) {
      const g = c.game;
      c.setTime(21.0);
      g.missions.timeFrozen = true;
      g.missions.weatherLocked = true; g.missions.weatherTarget = 0;
      g.traffic.enabled = true;
      // build the circuit from real streets
      const wps = [V(1500, 0, -740), V(1524, 0, -461), V(1000, 0, -870), V(560, 0, -900), V(380, 0, -429), V(470, 0, -60), V(560, 0, -115), V(843, 0, -329), V(1330, 0, -49), V(1500, 0, -740)];
      let loop = [];
      for (let i = 0; i < wps.length - 1; i++) {
        const r = g.roadnet.route(wps[i].x, wps[i].z, wps[i + 1].x, wps[i + 1].z);
        if (r) loop = loop.concat(loop.length ? r.slice(1) : r);
      }
      if (loop.length < 4) loop = wps.map(p => [p.x, p.z]);
      // resample to even spacing
      const pts = [];
      for (let i = 0; i < loop.length - 1; i++) {
        const a = loop[i], b = loop[i + 1]; const d = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(1, Math.ceil(d / 8));
        for (let k = 0; k < n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
      }
      const total = pts.reduce((acc, p, i) => i ? acc + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0, 0);
      const cps = []; let acc = 0;
      for (let i = 1; i < pts.length; i++) { acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (acc >= 160) { cps.push(V(pts[i][0], 0, pts[i][1])); acc = 0; } }
      cps.push(V(pts[pts.length - 1][0], 0, pts[pts.length - 1][1]));
      const LAPS = 2;
      // grid
      const startDir = V(pts[3][0] - pts[0][0], 0, pts[3][1] - pts[0][1]).normalize();
      const yaw = Math.atan2(-startDir.x, -startDir.z);
      const side = V(-startDir.z, 0, startDir.x);
      const base = V(pts[0][0], 0, pts[0][1]);
      if (g.player.vehicle) { const v = g.player.vehicle; g.player.exitVehicle(); }
      const mine = c.vehicle('infernus', base.clone().addScaledVector(side, 2).addScaledVector(startDir, -2), yaw, { keep: true, color: 0xf7f7f4 });
      const rivals = [
        { name: 'Kyle', type: 'infernus', color: 0x15161a, off: [-2, -2], speed: 0.86 },
        { name: 'Chad', type: 'stinger', color: 0xc8141c, off: [2, -10], speed: 0.8 },
        { name: 'Uncle Ah Seng', type: 'taxi', color: 0x1f63c6, off: [-2, -10], speed: 0.78 },
      ].map(r => {
        const v = c.vehicle(r.type, base.clone().addScaledVector(side, r.off[0]).addScaledVector(startDir, r.off[1]), yaw, { color: r.color });
        v.locked = true;
        const d = new PathDriver(g, v, pts, { loop: true, speed: r.speed, aggression: 1 });
        if (g.audio?.createEngine) v.engine = g.audio.createEngine({ type: v.spec.engineSound });
        return { ...r, v, d, lap: 0, last: 0, prog: 0 };
      });
      // traffic off the circuit for the race
      g.traffic.enabled = false;
      for (const car of [...g.traffic.cars]) g.traffic.despawn(car);
      c.onCleanup(() => { g.traffic.enabled = true; });
      g.wanted.suppress = 600;
      await c.cutscene(async () => {
        c.teleport(mine.position.clone().addScaledVector(side, 3), yaw);
        c.cam(base.clone().addScaledVector(startDir, 18).addScaledVector(side, 6).setY(3), base.clone().setY(1), { snap: true, fov: 45 });
        await c.say([
          { speaker: 'Kyle', text: 'Two laps. Raffles Boulevard, Nicoll, Stamford, the Padang, over the bridge, back past the Esplanade. Try to keep up, grandpa.' },
          { speaker: 'Chad', text: 'Bro I\'m only here for the content. Say hi to the livestream.' },
          { speaker: 'Uncle Ah Seng', text: 'Meter already running ah. Race also must pay.' },
        ]);
      });
      // put the player in the car
      g.player.enterVehicleImmediate(mine);
      g.cameraRig.yaw = yaw;
      g.player.controlsEnabled = false;
      for (const n of ['3', '2', '1']) { c.splash(n, '#ffd23f'); g.audio?.sfx?.('checkpoint'); await c.wait(1); }
      c.splash('GO!', '#7fe36a'); g.audio?.sfx?.('mission_start');
      g.player.controlsEnabled = true;
      const step = h => { for (const r of rivals) r.d.update(h); };
      g.physics.onStep(step);
      c.onCleanup(() => { const i = g.physics.stepCallbacks.indexOf(step); if (i >= 0) g.physics.stepCallbacks.splice(i, 1); });
      // player checkpoints
      let cpIdx = 0, lap = 0;
      let mk = c.marker(cps[0], { checkpoint: true, radius: 12 });
      g.ui.counter.show('LAP', 1, LAPS);
      c.objective('Win the race. Hit every <i>checkpoint</i>.');
      const rivalProgress = r => { const s = r.d.progress; if (s < r.last - total * 0.5) r.lap++; r.last = s; return r.lap * total + s; };
      let playerProg = 0;
      const posLabel = () => {
        const mineP = lap * total + (cpIdx / cps.length) * total;
        const ahead = rivals.filter(r => rivalProgress(r) > mineP + 5).length;
        return ahead + 1;
      };
      let finished = false, place = 1;
      await c.until(() => {
        const P = g.player.position;
        if (Math.hypot(P.x - cps[cpIdx].x, P.z - cps[cpIdx].z) < 14) {
          g.audio?.sfx?.('checkpoint');
          cpIdx++;
          mk.remove();
          if (cpIdx >= cps.length) { lap++; cpIdx = 0; if (lap >= LAPS) { finished = true; place = posLabel(); return true; } g.ui.counter.set(lap + 1); c.splash(`LAP ${lap + 1}`, '#2fe6ff'); }
          mk = c.marker(cps[cpIdx], { checkpoint: true, radius: 12 });
        }
        // rivals finishing first
        for (const r of rivals) if (rivalProgress(r) >= LAPS * total - 10 && !finished) { place = 2; c.fail(`${r.name} won the race.`); }
        g.missions.extraBlips = rivals.map(r => ({ x: r.v.position.x, z: r.v.position.z, type: 'enemy' }));
        return false;
      });
      g.missions.extraBlips = [];
      c.splash('1ST PLACE', '#ffd23f');
      await c.wait(1.5);
      g.missions.timeFrozen = false;
      g.missions.weatherLocked = false;
      await c.phone('Ken Rosenberg', [
        { speaker: 'Ken', text: 'Tommy! Kyle\'s posting a LinkedIn essay about "the lessons of losing". You got the meeting! <b>Mr. Tan</b>. Tonight. The top of <b>Marina Bay Sands</b>.' },
      ]);
      return { reward: 10000 };
    },
  },
  // ------------------------------------------------------------------ 8
  {
    id: 'term_sheet', title: 'Term Sheet', subtitle: 'Final Mission', reward: 0, passTitle: 'Series A Raised!',
    giver: { pos: LOC.mbsLobby, hint: 'Mr. Tan is waiting at the <b>Marina Bay Sands</b> SkyPark. Enter through the hotel lobby.' },
    async run(c, S) {
      const g = c.game;
      c.setTime(21.6);
      g.missions.timeFrozen = true;
      g.missions.weatherLocked = true; g.missions.weatherTarget = 0;
      // SkyPark staging: derive the deck axis from the landmark POIs (tower base -> north cantilever)
      const pois = g.landmarks?.pois || [];
      const sp = pois.find(p => p.id === 'skypark'), base = pois.find(p => p.id === 'mbs');
      const deckY = sp ? sp.y : 199.5;
      const axis = sp && base ? V(sp.x - base.x, 0, sp.z - base.z).normalize() : V(0, 0, -1);
      const origin = sp ? V(sp.x, deckY, sp.z) : V(1290, 199.5, 380);
      let side = V(-axis.z, 0, axis.x); if (side.x > 0) side.negate(); // the side facing the CBD (west)
      const T = origin.clone().addScaledVector(axis, -42).addScaledVector(side, 11);
      const tanPos = T.clone().addScaledVector(axis, 3.2);
      const top = T.clone();
      const tan = c.npc('investor_m', tanPos, 0, 'idle');
      const fw = new Fireworks(g.scene);
      c.onCleanup(() => fw.dispose());
      const fwStep = () => fw.update(1 / 60);
      const camSide = T.clone().addScaledVector(axis, 1.6).addScaledVector(side, -6.5).setY(deckY + 1.9);
      await c.cutscene(async () => {
        // lift ride up the tower
        const lobby = g.player.position.clone();
        await c.pan(V(lobby.x + 30, 10, lobby.z + 40), V(lobby.x + 60, 190, lobby.z + 90), V(1300, 20, 380), V(1300, 200, 380), 5, 50);
        c.teleport(top, Math.atan2(-axis.x, -axis.z));
        tan.face(top);
        g.player.setAnim('idle');
        c.cam(camSide, T.clone().addScaledVector(axis, 1.6).setY(deckY + 1.5), { snap: true, fov: 42 });
        await c.say([
          { speaker: 'Mr. Tan', text: 'Mr. Vercetti. In Singapore, we plan forty years ahead. Where do you see your company in forty years?' },
          { speaker: 'Tommy', text: 'In forty years? Owning this hotel.' },
        ]);
        c.cam(T.clone().addScaledVector(axis, -2.6).addScaledVector(side, -1.0).setY(deckY + 1.75), tanPos.clone().setY(deckY + 1.55), { lerp: 3, fov: 36 });
        await c.say([
          { speaker: 'Mr. Tan', text: '...Hm. Most founders say "making the world a better place". Let\'s talk numbers.' },
        ]);
      });
      const res = await c.minigame('negotiation', { pitchResult: S.pitch || { score: 60, hype: 60, credibility: 60, interest: { merlion: 60, sandhill: 60, auntie: 60 } } });
      if (!res?.accepted) c.fail('Mr. Tan walked away from the table.');
      S.raised = res.raised; S.valuation = res.valuation;
      g.missions.valuation = res.valuation;
      // finale
      await c.cutscene(async () => {
        g.audio?.music?.('finale');
        c.cam(T.clone().addScaledVector(side, 12).add(V(0, 6, 0)), V(500, 90, -150), { snap: true, fov: 55 });
        for (let i = 0; i < 18; i++) { fw.burst(V(500 + Math.random() * 600, 120 + Math.random() * 90, -200 + Math.random() * 300)); for (let k = 0; k < 20; k++) { fwStep(); await c.wait(1 / 60); } }
        c.cam(camSide, T.clone().addScaledVector(axis, 1.6).setY(deckY + 1.5), { lerp: 2, fov: 42 });
        await c.say([
          ...tanDealLines(res.raised, res.valuation), // three beats, each pre-rendered (missions/vodyn.js)
          { speaker: 'Tommy', text: 'Pleasure doing business.' },
        ]);
        await c.phone('Ken Rosenberg', [
          { speaker: 'Ken', text: 'TOMMY! Sonny\'s on the other line! He wants his money! What do I tell him?!' },
          { speaker: 'Tommy', text: 'Tell Sonny he can have his money. In <b>equity</b>. Vested over four years. With a one-year cliff.' },
          { speaker: 'Ken', text: '...Tommy, that\'s the most beautiful thing I\'ve ever heard.' },
        ]);
        for (let i = 0; i < 24; i++) { fw.burst(V(500 + Math.random() * 600, 120 + Math.random() * 90, -200 + Math.random() * 300)); for (let k = 0; k < 12; k++) { fwStep(); await c.wait(1 / 60); } }
        for (let k = 0; k < 180; k++) { fwStep(); await c.wait(1 / 60); }
      });
      g.missions.timeFrozen = false; g.missions.weatherLocked = false;
      return { reward: 25000, extra: `SERIES A: ${fmt(res.raised)} raised at ${fmt(res.valuation)}` };
    },
    after(g, S) {
      setTimeout(() => { g.audio?.sfx?.('text_message'); g.ui.phone.text('Lance Vance', 'Partner. 🚀 Next stop: IPO. Also I crashed the Stinger again.'); }, 6000);
      setTimeout(() => g.ui.help('Thanks for playing <b>Vibe City</b>! Free roam is yours: find all the hidden <em>kaya toasts</em>, dodge ERP gantries, and enjoy the city.', 12000), 12000);
    },
  },
];
