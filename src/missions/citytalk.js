// The city remembers: what the player just did comes back a little later on the radio (a DJ's line over the intro,
// as a subtitle in the station's colour, when a station is on) or as a text from someone who heard about it — a big
// fine, a clip going viral, beating (or losing to) Ah Beng, driving into the Merlion, a jump over the river, an
// arrest, the side jobs. Lines are templates per event with the district dropped in, and a district's own colour
// ({crowd}: who there is talking about it). Text only: nothing here is voiced. One mention at a time, 8-25 s after the
// fact, at most one every 40 s, never over mission dialogue or another line; a memory nobody got round to fades.
import { districtAt } from '../ui/districts.js';

const GAP = 40;              // s between two mentions
const STALE = 150;           // s a memory keeps
const pick = a => a[Math.floor(Math.random() * a.length)];
const fmtViews = n => n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}K`;

// who is talking about it, district by district
const CROWD = {
  'Downtown Core': 'the bankers on Raffles Place', 'Boat Quay': 'the lunch crowd at Boat Quay', 'Clarke Quay': 'the bar crowd at Clarke Quay',
  'Robertson Quay': 'the brunch people at Robertson Quay', 'Marina Bay': 'the tourists at the Sands', 'Marina Centre': 'the mall walkers at Suntec',
  'Chinatown': 'the aunties at Chinatown Complex', 'Tanjong Pagar': 'the office crowd in Tanjong Pagar', 'Outram': 'the nurses at SGH',
  'Orchard': 'the shoppers on Orchard Road', 'Bugis': 'the students in Bugis', 'Little India': 'the shopkeepers on Serangoon Road',
  'Kampong Glam': 'the cafe crowd on Arab Street', 'Tiong Bahru': 'the uncles at Tiong Bahru Market', 'River Valley': 'the expats in River Valley',
  'Fort Canning': 'the joggers at Fort Canning', 'Gardens by the Bay': 'the tourists at the Supertrees', 'Kallang': 'the fans at the Stadium',
  'Bras Basah': 'the art students in Bras Basah', 'Dhoby Ghaut': 'the queue at Plaza Sing', 'Keppel': 'the dockworkers at Keppel', 'Marina South': 'the ferry crowd at Marina South',
};
// [radio lines, [contact, text] lines] per memory; {d} district, {crowd}, {amt}, {what}, {views}, {kmh}, {place}, {n}
const LINES = {
  fine: [
    ['Traffic news: {what} in {d}, S${amt}. The camera would like to thank the driver for their contribution.',
      'Fine City update from {d}: S${amt} for {what}. Remember folks, the speed limit is a limit, not a target.',
      'Breaking: a camera in {d} just earned more today than most startups this year. S${amt}, {what}.'],
    [['Auntie Mei', 'S${amt} fine?? That one {plates} plates of chicken rice you know. Drive slowly lah.'],
      ['Uncle Ah Seng', '{d} got camera one lah. Uncle drive 30 years never kena. You one day already kena.'],
      ['Claudia (AI)', 'Fine logged: S${amt}, {what}. I have added a "Fines" line to the P&L. It is trending up and to the right.']],
  ],
  fines: [
    ['A listener in {d} asks if fines are tax deductible. For one founder this week, we really hope so. S${amt} and counting.'],
    [['Mr. Tan', 'Temasick notes S${amt} in traffic fines this week. We prefer founders who can read a sign.'],
      ['Auntie Mei', 'S${amt} in fines already?! You are burning money faster than your startup.']],
  ],
  erp: [
    ['Traffic: the ERP gantries in {d} report a very loyal customer today. {n} times and counting.'],
    [['Uncle Ah Seng', 'ERP {n} times already? You donate to LTA ah? Take the small roads lah.']],
  ],
  viral: [
    ['Trending right now: a clip from {d} at {views} views, and {crowd} all say they were there. Comments section says confirm kena saman.',
      'Social media update: {views} people have now watched a car do something in {d} it really should not. Algorithm loves it.'],
    [['Chad Brogan', 'BRO. {views} views. The Sandhill group chat is losing it.'],
      ['Jasmine', 'WeHustle is playing your clip on the big screen. {views} views! The kombucha machine is jealous.'],
      ['Priya', '{views} views. Conversion to users: rounding error. But it is a start.']],
  ],
  wonRace: [
    ['Reports of a street race in {d} last night. The lime hatchback with the pink underglow lost. Badly.',
      'Word from {d}: Ah Beng has been beaten. Ah Beng says his turbo was sleeping.'],
    [['Ah Beng', 'Eh bro. Rematch. Same junction, next time. You bring your car, I bring my new exhaust.'],
      ['Uncle Ah Seng', 'Uncle heard you beat Ah Beng in {d}. Steady lah! But traffic police also heard.']],
  ],
  lostRace: [
    ['Street racing news from {d}: Ah Beng is still undefeated. His underglow says thank you.'],
    [['Ah Beng', 'Bro your car got engine or not? Hahaha. Come back when you got turbo.']],
  ],
  merlion: [
    ['We interrupt this programme: someone has driven into the Merlion. The Merlion is fine. It is still spitting. The car is not.'],
    [['Claudia (AI)', 'You drove into the Merlion. The Tourism Board has opened a ticket. Priority: national.'],
      ['Auntie Mei', 'You langgar the Merlion?! Aiyoh. My cousin from Ipoh saw it on Facebook already.']],
  ],
  landmark: [
    ['Breaking from {d}: a car has had a disagreement with {place}. {place} won.'],
    [['Claudia (AI)', 'You hit {place}. I have filed it under "brand activations".']],
  ],
  stunt: [
    ['A car was seen flying over the water in {d}. LTA would like to remind drivers: cars are not boats. Or planes.',
      'Unconfirmed reports of a flying car in {d}. Eyewitnesses describe it as "very steady" and "very siao".'],
    [['Chad Brogan', 'Saw the jump on my feed. That is the energy we look for in a founder, bro.'],
      ['Uncle Ah Seng', 'Wah you jump the river ah? Uncle taxi cannot do that one.']],
  ],
  busted: [
    ['Police in {d} have arrested a startup founder. His lawyer says he was stress testing the product.'],
    [['Priya', 'Saw the arrest in {d}. Investors call that "regulatory risk". Fix it.']],
  ],
  getaway: [
    ['Traffic Police report zero offences in the CBD in the last hour. Officers are calling it eerie.'],
    [['Auntie Mei', 'Uncle Ah Seng told the whole kopitiam you drove his cab with no saman. Wah, model citizen.']],
  ],
};
// crashing into a landmark: which ones count, and what they're called on air
const LANDMARKS = { merlion: 'the Merlion', merlion_cub: 'the Merlion', fullerton: 'The Fullerton', mbs_lobby: 'Marina Bay Sands', esplanade: 'the Esplanade', raffles: 'Raffles Hotel', laupasat: 'Lau Pa Sat', flyer: 'the Singapore Flyer', supertrees: 'a Supertree', nationalgallery: 'the National Gallery', victoria: 'the Victoria Theatre' };

export class CityTalk {
  constructor(game) {
    this.game = game;
    this.pending = [];         // { kind, d, data, t }
    this.lastT = -GAP / 2;     // (the first mention can come early)
    this.t = 0; this.checkT = 0;
    this.fines = 0; this.finesTold = false; this.erpN = 0; this.erpT = 0;
    this.said = new Map();     // memory kind -> last time it was mentioned
    const ev = game.events, here = () => districtAt(game.player.position.x, game.player.position.z);
    ev.on('fined', e => {
      this.fines += e.amount;
      if (e.amount >= 150) this.remember('fine', { amt: e.amount, what: e.what.toLowerCase() }, districtAt(e.x, e.z));
      if (this.fines >= 800 && !this.finesTold) { this.finesTold = true; this.remember('fines', { amt: this.fines }); }
    });
    ev.on('erp', () => { this.erpN = this.t - this.erpT < 300 ? this.erpN + 1 : 1; this.erpT = this.t; if (this.erpN === 4) this.remember('erp', { n: this.erpN }); });
    ev.on('views', e => { if (e.views >= 100000 && !game.missions.active) this.remember('viral', { views: e.views }, districtAt(e.pos.x, e.pos.z)); });
    ev.on('dragRace', won => this.remember(won ? 'wonRace' : 'lostRace', {}, here()));
    ev.on('stunt', e => { if (e.unique || e.dist > 40) this.remember('stunt', {}, here()); });
    ev.on('playerBusted', () => this.remember('busted', {}, here()));
    ev.on('vehicleImpact', e => this.impact(e));
  }

  /** something happened worth talking about (data fills the templates); a side job can call this too */
  remember(kind, data = {}, d = null) {
    const p = this.game.player.position;
    d = d || data.district || districtAt(p.x, p.z) || 'town';
    const i = this.pending.findIndex(m => m.kind === kind);
    if (i >= 0) this.pending.splice(i, 1);
    this.pending.push({ kind, d, data, t: this.t, wait: 8 + Math.random() * 17 });
    if (this.pending.length > 4) this.pending.shift();
  }

  // the player's car hitting a landmark hard
  impact({ vehicle, damage }) {
    const g = this.game;
    if (vehicle !== g.player.vehicle || damage < 60 || this.t - (this.said.get('landmark') ?? -999) < 120) return;
    const p = vehicle.position;
    for (const L of g.landmarks?.pois || []) {
      const name = LANDMARKS[L.id];
      if (!name || Math.abs(L.x - p.x) > 30 || Math.abs(L.z - p.z) > 30) continue;
      this.said.set('landmark', this.t);
      if (name === 'the Merlion') this.remember('merlion');
      else this.remember('landmark', { place: name });
      return;
    }
  }

  update(dt) {
    this.t += dt;
    if ((this.checkT -= dt) > 0) return;
    this.checkT = 1;
    const g = this.game;
    while (this.pending.length && this.t - this.pending[0].t > STALE) this.pending.shift();
    if (!this.pending.length || this.t - this.lastT < GAP) return;
    if (g.missions.active || g.activities?.busy || g.ui._sub || g.cameraRig.override || g.player.state === 'dead' || g.audio?.voice?.radioActive) return;
    const m = this.pending.find(m => this.t - m.t >= m.wait);
    if (!m) return;
    this.pending.splice(this.pending.indexOf(m), 1);
    this.lastT = this.t; this.said.set(m.kind, this.t);
    this.say(m);
  }

  say(m) {
    const g = this.game, [radio, texts] = LINES[m.kind], fill = s => this.fill(s, m);
    const r = g.audio?.radio, onAir = !!g.player.vehicle && r?.audible && r.current >= 0;
    if (onAir && Math.random() < 0.75) {
      const meta = r.meta, station = meta.name.includes(':') ? `${meta.name.split(':')[0]} ${meta.freq}` : meta.name;
      g.ui.subtitle(fill(pick(radio)), { speaker: station, color: meta.color, duration: 6500, source: 'radio' });
    } else {
      const [from, text] = pick(texts);
      g.audio?.sfx?.('text_message');
      g.ui.phone.text(from, fill(text));
    }
  }

  fill(s, m) {
    const D = m.data;
    return s.replace(/\{(\w+)\}/g, (_, k) => k === 'd' ? m.d : k === 'crowd' ? (CROWD[m.d] || 'everyone in town') : k === 'views' ? fmtViews(D.views || 0)
      : k === 'plates' ? Math.round((D.amt || 0) / 4.5) : k === 'amt' ? Math.round(D.amt || 0).toLocaleString('en-SG') : D[k] ?? '');
  }
}
