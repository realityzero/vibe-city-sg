// "Vibe-code the city": press / to prompt Claudia (Tommy's AI pair-programmer) in plain English.
// A small intent parser maps prompts to world edits — weather, time, spawns, teleports, fireworks, durians...
import * as THREE from 'three';
import { Aircraft } from '../entities/aircraft.js';
import { Boat } from '../entities/boat.js';
import { claudiaTimeSpeak, claudiaSpawnSpeak, claudiaAutopilotSpeak, claudiaTeleportSpeak, playSeq } from './vodyn.js';

const STYLE = `
.vc-claudia { position: fixed; left: 24px; bottom: 228px; width: min(460px, 42vw); font: 13px/1.35 'Inter', system-ui, sans-serif; color: #e9e6ff; z-index: 40; pointer-events: none; }
.vc-claudia .log { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.vc-claudia .msg { background: rgba(14, 8, 30, 0.82); border: 1px solid rgba(255, 63, 164, 0.35); border-radius: 10px; padding: 7px 10px; backdrop-filter: blur(6px); animation: vcq-in .25s ease-out; }
.vc-claudia .msg.me { border-color: rgba(47, 230, 255, 0.4); align-self: flex-end; color: #bff6ff; }
.vc-claudia .msg b { color: #ff7ac8; }
.vc-claudia .bar { display: none; pointer-events: auto; background: rgba(14, 8, 30, 0.92); border: 1px solid #ff3fa4; border-radius: 10px; padding: 8px 10px; box-shadow: 0 0 24px rgba(255, 63, 164, 0.35); }
.vc-claudia.open .bar { display: flex; gap: 8px; align-items: center; }
.vc-claudia .bar span { color: #ff3fa4; font-weight: 700; letter-spacing: .04em; }
.vc-claudia input { flex: 1; background: transparent; border: 0; outline: 0; color: #fff; font: inherit; }
@keyframes vcq-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
`;

const TYPES = [
  [/lambo|supercar|infernus|sports ?car|fast car/, 'infernus'], [/convertible|stinger|red car/, 'stinger'], [/taxi|cab/, 'taxi'],
  [/bus|double.?decker/, 'bus'], [/police|cop/, 'police'], [/lorry|truck/, 'lorry'], [/van/, 'van'], [/mpv|alphard/, 'mpv'],
  [/suv/, 'suv'], [/merc|luxury|limo/, 'luxury'], [/bike|motorbike|scooter|motorcycle/, 'bike'], [/sedan|camry|car/, 'sedan'],
];

export class Claudia {
  constructor(game) {
    this.game = game;
    const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);
    this.el = document.createElement('div'); this.el.className = 'vc-claudia';
    this.el.innerHTML = `<div class="log"></div><div class="bar"><span>CLAUDIA ▸</span><input maxlength="160" placeholder="make it rain · spawn a helicopter · take me to Marina Bay Sands · night time · fireworks"></div>`;
    document.body.appendChild(this.el);
    this.log = this.el.querySelector('.log'); this.input = this.el.querySelector('input');
    addEventListener('keydown', e => {
      if (e.__uiHandled || game.state !== 'play' || game.mgPaused || game.paused) return;
      if (e.code === 'Slash' && !this.isOpen && !e.target?.closest?.('input,textarea')) { e.preventDefault(); this.open(); }
    });
    this.input.addEventListener('keydown', e => {
      e.stopPropagation(); e.__uiHandled = true;
      if (e.code === 'Enter') { const t = this.input.value.trim(); this.close(); if (t) this.prompt(t); }
      else if (e.code === 'Escape') this.close();
    });
    this.input.addEventListener('keyup', e => e.stopPropagation());
  }
  get isOpen() { return this.el.classList.contains('open'); }
  open() { this.el.classList.add('open'); this.game.input.unlock(); this.game.input.enabled = false; this.game.input.keys.clear(); this.input.focus(); setTimeout(() => this.input.focus(), 0); }
  close() { this.el.classList.remove('open'); this.input.value = ''; this.input.blur(); this.game.input.enabled = true; this.game.input.lock(); }
  say(text, me = false) {
    const m = document.createElement('div'); m.className = 'msg' + (me ? ' me' : ''); m.innerHTML = me ? text.replace(/</g, '&lt;') : `<b>Claudia:</b> ${text}`;
    this.log.appendChild(m);
    while (this.log.children.length > 4) this.log.firstChild.remove();
    setTimeout(() => { m.style.transition = 'opacity .6s'; m.style.opacity = '0'; setTimeout(() => m.remove(), 700); }, me ? 6000 : 9000);
  }

  /** Claudia says a reply (a line, or sentences played back to back) if it has pre-rendered takes — no runtime TTS:
   *  lines without one stay text-only. She doesn't talk over mission dialogue. */
  voice(speak) {
    if (this.game.settings?.voices === false) return;
    playSeq(this.game.audio, 'claudia', [].concat(speak).map(t => String(t).replace(/<[^>]*>/g, '')), { interrupt: false }).catch(() => {});
  }

  places() {
    const g = this.game, out = [];
    for (const p of g.landmarks?.pois || []) out.push({ name: p.name, x: p.x, z: p.z, keys: [p.id, p.name.toLowerCase()] });
    for (const s of g.ambient?.stations || []) out.push({ name: `${s.name} MRT`, x: s.pos.x, z: s.pos.z, keys: [s.name.toLowerCase()] });
    const extra = { 'lau pa sat': [167, 706], 'maxwell': [-476, 709], 'chinatown': [-560, 420], 'clarke quay': [-395, -338], 'wehustle': [-630, 888], 'capsule hotel': [-392, 404], 'boat quay': [0, 0], 'orchard': [-2500, -1650], 'bugis': [1060, -1650], 'tiong bahru': [-2500, 600], 'tanjong pagar': [-500, 1150], 'raffles place': [60, 330], 'fort canning': [-180, -650], 'padang': [380, -470], 'hospital': [-1585, 818], 'helipad': null };
    for (const [k, v] of Object.entries(extra)) if (v) out.push({ name: k.replace(/\b\w/g, c => c.toUpperCase()), x: v[0], z: v[1], keys: [k] });
    return out;
  }

  async prompt(text) {
    const g = this.game, P = g.player, t = text.toLowerCase();
    this.say(text, true);
    g.audio?.sfx?.('keyclick');
    await new Promise(r => setTimeout(r, 450 + Math.random() * 500));
    // replies are voiced from pre-rendered takes (speak: the spoken form when it differs from the chat text)
    const reply = (m, speak) => { this.say(m); g.audio?.sfx?.('text_message'); this.voice(speak ?? m); };
    const fwd = new THREE.Vector3(-Math.sin(P.facing), 0, -Math.cos(P.facing));
    const n = Math.min(12, parseInt(t.match(/\b(\d{1,2})\b/)?.[1] || '1', 10));
    let m;
    // --- refusals first (Claudia has principles)
    if (/money|cash|rich|million|bank/.test(t) && !/time/.test(t)) return reply('I can\'t print money, Tommy. I <i>can</i> write you a pitch deck that implies we print money.');
    if (/kill|gun|weapon|bomb|shoot/.test(t)) return reply('That violates my content policy and also several Singapore laws. How about a nice kopi instead?');
    if (/(help|what can you)/.test(t)) return reply('Try: <i>make it rain</i>, <i>sunset</i>, <i>spawn a helicopter</i>, <i>3 taxis</i>, <i>take me to the Merlion</i>, <i>fireworks</i>, <i>durians</i>, <i>low gravity</i>, <i>synthwave mode</i>, <i>more traffic</i>.');
    // --- weather
    if (/rainbow/.test(t)) { g.sky.rainbowT = 120; if (g.sky.sun.y < 0.04 || g.sky.sun.y > 0.6) { g.sky.time = 16.8; g.sky.refreshEnv(); } g.weather.force(0); setTimeout(() => (g.weather.forced = null), 120000); return reply('Rainbow rendered. Look away from the sun. Physics checks out, mostly.'); }
    if (/storm|thunder|rain|monsoon|wet/.test(t) && !/stop|no rain|dry/.test(t)) { g.weather.force(/storm|thunder|monsoon/.test(t) ? 1 : 0.7); setTimeout(() => (g.weather.forced = null), 180000); return reply('Raining. Classic 4pm. I also deprecated your tyre grip, you\'re welcome.'); }
    if (/sun|clear|dry|stop.*rain|blue sky/.test(t) && !/sunset|sunrise/.test(t)) { g.weather.force(0); setTimeout(() => (g.weather.forced = null), 180000); return reply('Clouds refactored out. Blue sky shipped to prod.'); }
    if (/haze|smog|psi/.test(t)) { g.cheats.activate('HAZESEASON'); return reply('Haze enabled. PSI 180. I recommend an N95 and not exercising.'); }
    // --- time
    if ((m = t.match(/(\d{1,2})[:.](\d{2})/)) || (m = t.match(/\b(\d{1,2})\s*(am|pm)\b/))) {
      let h = +m[1]; if (m[2] === 'pm' && h < 12) h += 12; if (m[2] === 'am' && h === 12) h = 0; const min = /^\d+$/.test(m[2] || '') ? +m[2] : 0;
      g.sky.time = (h + min / 60) % 24; g.sky.refreshEnv(); return reply(`Time travelled to ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}. Don't tell the physicists.`, claudiaTimeSpeak(h, min));
    }
    const tod = [[/sunrise|dawn/, 6.8, 'Sunrise. Joggers are out. Uncles are already at the kopitiam.'], [/morning/, 9, 'Morning. Peak hour ERP is active. Sorry.'], [/noon|midday|lunch/, 12.5, 'Lunchtime. Every hawker seat is choped.'], [/sunset|golden hour|evening/, 18.7, 'Golden hour. Perfect for your LinkedIn headshot.'], [/night|dark|midnight/, 22.5, 'Night mode. The skyline is doing its thing.']];
    for (const [re, h, msg] of tod) if (re.test(t)) { g.sky.time = h; g.sky.refreshEnv(); return reply(msg); }
    // --- spectacle
    if (/firework/.test(t)) { for (let i = 0; i < 25; i++) setTimeout(() => g.ambient.fw.burst(new THREE.Vector3(P.position.x + (Math.random() - 0.5) * 300, 90 + Math.random() * 80, P.position.z - 120 + (Math.random() - 0.5) * 200), 240), i * 220); return reply('Fireworks deployed. National Day came early.'); }
    if (/durian/.test(t)) { g.cheats.activate('DURIANRAIN'); return reply('Durians incoming. Please do not stand under them. I mean it.'); }
    if (/synthwave|vice ?vision|80s|retro|neon/.test(t)) { g.cheats.activate('VICEVISION'); return reply('Vibe Vision toggled. It\'s 1986 in your eyes now.'); }
    if (/gravity|float|moon/.test(t)) { g.cheats.activate('COMEFLYWITHME'); return reply('Gravity patched. Low-grav mode toggled — cars may become airborne.'); }
    if (/(more|heavy|lots of) traffic|jam/.test(t)) { g.traffic.target = 160; return reply('More traffic. Welcome to the PIE at 6pm.'); }
    if (/(less|no|light) traffic|empty/.test(t)) { g.traffic.target = 25; return reply('Traffic reduced. Feels like Chinese New Year morning.'); }
    if (/green light|all green/.test(t)) { g.cheats.activate('GREENLIGHT'); return reply('All lights green. The LTA has been notified. They\'re not happy.'); }
    if (/(clear|lose|remove).*(wanted|police|cops|star)|leave me alone/.test(t)) { g.wanted.clear(); return reply('Wanted level cleared. I told the SPF you were "pivoting".'); }
    if (/heal|health|hungry|food|eat/.test(t)) { P.health = P.maxHealth; return reply('Ordered you chicken rice via drone. Health restored. That\'ll be S$4.50.'); }
    if (/water|walk on water|sea ?ways|drive on (the )?(water|sea|bay)/.test(t)) { g.cheats.activate('SEAWAYS'); return reply('Marina Bay is now a road. Technically a feature.'); }
    // --- teleport
    if (/take me|teleport|go to|bring me|travel to|drive me/.test(t)) {
      const ps = this.places(); let best = null, bl = 0;
      for (const p of ps) for (const k of p.keys) if (k && t.includes(k) && k.length > bl) { best = p; bl = k.length; }
      if (!best && /mbs|sands|skypark/.test(t)) best = ps.find(p => p.keys.includes('mbs'));
      if (!best) return reply('I don\'t know that place. Try a landmark, an MRT station, or "Lau Pa Sat".');
      if (/drive me/.test(t) && P.vehicle) { g.setWaypoint(best.x, best.z); g.autopilot.engage({ x: best.x, z: best.z }); return reply(`Autopilot to ${best.name}. Hands off the wheel. Or don't, I'm not your mum.`, claudiaAutopilotSpeak(best.name)); }
      const sw = g.roadnet.nearestSidewalk(best.x, best.z, 200);
      const dest = sw ? sw.pos : new THREE.Vector3(best.x, 0, best.z);
      await g.ui.fade(true, 300); g.relocate(dest, P.facing, { faceOpen: !P.vehicle }); await g.ui.fade(false, 500);
      return reply(`Teleported to ${best.name}. Grab-equivalent fare: S$0. Physics: questionable.`, claudiaTeleportSpeak(best.name));
    }
    // --- spawns
    if (/spawn|give me|get me|i want|i need|summon|make|build|add/.test(t)) {
      const base = P.position.clone().addScaledVector(fwd, 10);
      if (/heli|chopper|helicopter/.test(t)) { const v = new Aircraft(g, /police/.test(t) ? 'heli_police' : 'heli', { position: base.clone().setY(Math.max(0, P.position.y) + 0.2), yaw: P.facing }); g.vehicles.push(v); return reply('Helicopter compiled. Space to climb, Shift to descend. Please don\'t land on the Supertrees.'); }
      if (/drone/.test(t)) { const v = new Aircraft(g, 'drone', { position: base.clone().setY(Math.max(0, P.position.y) + 0.2), yaw: P.facing }); g.vehicles.push(v); return reply('DurianDash drone online. It smells faintly of durian.'); }
      if (/boat|jet ?ski|speedboat/.test(t)) { const w = g.spawns.findWater(P.position.x, P.position.z, 300); if (!w) return reply('No water nearby. This is a city, lah.'); const v = new Boat(g, /jet/.test(t) ? 'jetski' : 'speedboat', { position: w, yaw: g.spawns.openYaw(w) }); g.vehicles.push(v); g.routeTo({ x: w.x, z: w.z }); return reply('Boat at the nearest waterfront — follow the GPS.'); }
      for (const [re, type] of TYPES) if (re.test(t)) {
        for (let i = 0; i < n; i++) {
          const lane = g.roadnet.nearestLane(base.x + (Math.random() - 0.5) * 30 * (i > 0), base.z + (Math.random() - 0.5) * 30 * (i > 0), 120, l => l.cls <= 6);
          if (!lane) continue;
          const { Vehicle } = await import('../entities/vehicle.js');
          const v = new Vehicle(g, type, { position: lane.pos.clone().addScaledVector(lane.dir, i * 7), yaw: Math.atan2(-lane.dir.x, -lane.dir.z) });
          v.setDriverControls({ throttle: 0, brake: 0, steer: 0, handbrake: true }, 0.016); g.vehicles.push(v);
        }
        return reply(n > 1 ? `${n} × ${type} deployed. Parking fines are your problem.` : `One ${type}, freshly vibe-coded, on the nearest road.`, claudiaSpawnSpeak(n, type));
      }
    }
    const shrug = ['I asked my context window and it shrugged. Try "help".', 'That feature is on the roadmap. Q3. Maybe.', 'I generated 400 lines for that, then deleted them. Try something else?', 'Can or not? Not. Try "help", lah.'];
    reply(shrug[Math.floor(Math.random() * shrug.length)]);
  }
}
