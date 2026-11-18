// Hype economy: everything the player does in public moves the startup's valuation.
// Stunts go "viral" (+), crashes and arrests make the news (−); the HUD valuation line reflects it. Whatever the
// street films (Pedestrians 'filmed') racks up views on the HUD's REC counter ('views' event), and views are hype.
// Also: Kopi Gao boost (B in a car) — a caffeine-fuelled nitro that recharges over time.
import * as THREE from 'three';

const VIRAL = ['went viral on TikTok', 'is trending on Rednote', 'made the front page of HardwareZone', 'got 2M views on Instagram Reels', 'was reposted by a Temasick intern', 'was turned into a LinkedIn thought-leadership post'];
const BAD = ['made the Straits Times (not in a good way)', 'is being discussed in a very long Reddit thread', 'was screenshotted by a VC'];
// what a clip of each kind pulls per person filming it (views), and its hashtag
const CLIP = { stunt: [9000, '#sendit'], explosion: [7000, '#breaking'], crash: [3500, '#onlyinsg'], drift: [3000, '#driftking'], supercar: [2500, '#carspotting'],
  splash: [2200, '#kenasplash'], nearmiss: [1800, '#closecall'], hit: [1200, '#kenasaman'] };

export class Hype {
  constructor(game) {
    this.game = game;
    this.kopi = 1; // boost charge 0..1
    this.boostOn = false;
    this.reach = 1; // views multiplier ("the algorithm"): Go Viral raises it while the clips keep coming
    const ev = game.events;
    ev.on('stunt', ({ reward }) => this.bump(Math.min(0.06, reward / 40000), `Your stunt ${pick(VIRAL)}`));
    ev.on('playerBusted', () => this.bump(-0.04, `Your arrest ${pick(BAD)}`));
    ev.on('trafficWreck', () => { if (Math.random() < 0.25) this.bump(-0.004); });
    ev.on('pedHit', () => this.bump(-0.01));
    ev.on('filmed', e => this.filmed(e));
    // boost meter under the speedometer (styled with the HUD: ui/theme.css .vc-kopi)
    this.kopiEl = document.createElement('div'); this.kopiEl.className = 'vc-kopi';
    this.kopiEl.style.display = 'none';
    this.kopiEl.innerHTML = '<div class="fill"></div><div class="lbl">Kopi Gao <span class="key">[B]</span></div>';
    game.ui.root.querySelector('.vc-layer-game').appendChild(this.kopiEl);
    this.lastVal = 0;
    this._f = new THREE.Vector3(); this._p = new THREE.Vector3(); this._b = new THREE.Vector3(); this._lv = new THREE.Vector3();
    addEventListener('keydown', e => { if (e.code === 'KeyB' && !e.__cheatTyping && !e.__uiHandled) this.boostKey = true; });
    addEventListener('keyup', e => { if (e.code === 'KeyB') this.boostKey = false; });
  }

  bump(frac, msg) {
    const m = this.game.missions;
    if (!m.valuation) return;
    m.valuation = Math.max(250000, Math.round(m.valuation * (1 + frac)));
    m.state.valuation = m.valuation;
    if (msg && Math.abs(frac) >= 0.01) this.game.ui.toast(`${msg} · valuation ${frac > 0 ? '▲' : '▼'} ${(Math.abs(frac) * 100).toFixed(1)}%`);
  }

  /** people filmed the player: views on the REC counter, and (except for running people over) a little hype */
  filmed({ count, kind, pos }) {
    const [per, tag] = CLIP[kind] || CLIP.crash;
    this.clip(count * per * (0.6 + Math.random() * 0.8), { kind, tag, pos, count });
  }

  /** a clip of the player is out: its views (times `reach`, the algorithm's mood: a job can push it) go on the REC
   *  counter and out as 'views' { views, kind, tag, pos, count, by, handle } (by: a set piece's creator who filmed it,
   *  { pos, yaw, hs } like a crowd person; handle: their account) */
  clip(raw, { kind = 'crash', tag = (CLIP[kind] || CLIP.crash)[1], pos = this.game.player.position, count = 1, by = null, handle = null } = {}) {
    const views = Math.round(raw * this.reach);
    this.game.ui.views(views, tag);
    if (kind !== 'hit') this.bump(Math.min(0.012, views / 4e6));
    this.game.events.emit('views', { views, kind, tag, pos, count, by, handle });
    return views;
  }

  update(dt) {
    const g = this.game, m = g.missions, v = g.player.vehicle;
    // Kopi Gao boost
    const car = v && v.vc && !v.isBoat && !v.isAircraft;
    this.kopiEl.style.display = car && g.state === 'play' && g.ui.hud.visible ? 'block' : 'none';
    if (car) {
      const want = this.boostKey && this.kopi > 0.02 && g.player.controlsEnabled;
      if (want) {
        this.kopi = Math.max(0, this.kopi - dt / 3.5);
        const f = this._f.set(0, 0, -1).applyQuaternion(v.quaternion);
        v.body.applyImpulse({ x: f.x * v.spec.mass * 9 * dt, y: 0, z: f.z * v.spec.mass * 9 * dt }, true);
        if (!this.boostOn) { g.audio?.sfx?.('kopi_pour', { volume: 0.6 }); g.cameraRig.shake(0.3); }
        // exhaust flames out of the tailpipe(s)
        const lv = v.body.linvel(), bike = v.isBike;
        for (const x of bike ? [0.12] : [-0.35, 0.35]) if (Math.random() < dt * 40) g.fx?.exhaustFlame(this._p.set(x, bike ? 0.55 : 0.35, v.spec.length * 0.5).applyQuaternion(v.quaternion).add(v.position), this._b.copy(f).negate(), this._lv.set(lv.x, lv.y, lv.z), bike ? 0.7 : 1);
      } else this.kopi = Math.min(1, this.kopi + dt / 25);
      this.boostOn = want;
      g.cameraRig.fovBoost = want ? 1 : 0; // the rig owns the FOV and eases into the wider boost view
      this.kopiEl.firstChild.style.width = `${Math.round(this.kopi * 100)}%`;
    }
  }
}
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
