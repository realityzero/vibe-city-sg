// Hype economy: everything Tommy does in public moves the startup's valuation.
// Stunts go "viral" (+), crashes and arrests make the news (−); the HUD valuation line reflects it.
// Also: Kopi Gao boost (B in a car) — a caffeine-fuelled nitro that recharges over time.
import * as THREE from 'three';

const VIRAL = ['went viral on TikTok', 'is trending on Rednote', 'made the front page of HardwareZone', 'got 2M views on Instagram Reels', 'was reposted by a Temasick intern', 'was turned into a LinkedIn thought-leadership post'];
const BAD = ['made the Straits Times (not in a good way)', 'is being discussed in a very long Reddit thread', 'was screenshotted by a VC'];

export class Hype {
  constructor(game) {
    this.game = game;
    this.kopi = 1; // boost charge 0..1
    this.boostOn = false;
    const ev = game.events;
    ev.on('stunt', ({ reward }) => this.bump(Math.min(0.06, reward / 40000), `Your stunt ${pick(VIRAL)}`));
    ev.on('playerBusted', () => this.bump(-0.04, `Your arrest ${pick(BAD)}`));
    ev.on('trafficWreck', () => { if (Math.random() < 0.25) this.bump(-0.004); });
    ev.on('pedHit', () => this.bump(-0.01));
    this.kopiEl = document.createElement('div'); this.kopiEl.className = 'vc-kopi';
    this.kopiEl.style.cssText = "position:fixed;left:236px;bottom:36px;width:120px;height:8px;border-radius:4px;background:rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.25);pointer-events:none;z-index:30;display:none";
    this.kopiEl.innerHTML = '<div style="height:100%;width:100%;border-radius:3px;background:linear-gradient(90deg,#7a4a2a,#e8a35c)"></div><div style="position:absolute;top:-15px;left:0;font:600 11px \'Barlow Condensed\',sans-serif;letter-spacing:.12em;color:#f2d3b0;text-shadow:0 1px 2px #000">KOPI GAO [B]</div>';
    document.body.appendChild(this.kopiEl);
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

  update(dt) {
    const g = this.game, m = g.missions, v = g.player.vehicle;
    // Kopi Gao boost
    const car = v && v.vc && !v.isBoat && !v.isAircraft;
    this.kopiEl.style.display = car && g.state === 'play' ? 'block' : 'none';
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
