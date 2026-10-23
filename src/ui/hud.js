// Top-right VC-style HUD + bottom-right flash titles + speedometer. update() diffs so per-frame calls are cheap.
import { ICONS } from './icons.js';
import { el, fmtInt, fmtCompact, restartClass } from './util.js';
import { FlightInstruments } from './flight.js';

export class Hud {
  constructor(parent) {
    this.root = el('div', 'vc-hud');
    this.weapon = el('div', 'vc-weapon');
    const col = el('div', 'vc-hud-col');
    this.clock = el('div', 'vc-clock vc-outline', '12:00');
    this.money = el('div', 'vc-money vc-outline', '<span class="cur">S$</span>00000000');
    this.val = el('div', 'vc-val vc-outline-thin vc-hidden');
    this.users = el('div', 'vc-users vc-outline-thin vc-hidden');
    const vitals = el('div', 'vc-vitals');
    this.hp = el('div', 'vc-vital hp vc-outline', `${ICONS.heart}<span>100</span>`);
    this.ar = el('div', 'vc-vital ar vc-outline vc-hidden', `${ICONS.shield}<span>0</span>`);
    vitals.append(this.ar, this.hp);
    this.stars = el('div', 'vc-stars');
    this.starEls = [];
    for (let i = 0; i < 5; i++) { const s = el('span', 'off', ICONS.star); this.starEls.push(s); this.stars.appendChild(s); }
    col.append(this.clock, this.money, this.val, this.users, vitals, this.stars);
    this.root.append(this.weapon, col);
    this.topRight = el('div', 'vc-topright');
    this.topRight.appendChild(this.root);
    parent.appendChild(this.topRight);

    this.zone = el('div', 'vc-flash-zone');
    this.vehicle = el('div', 'vc-flash-vehicle vc-outline');
    this.radio = el('div', 'vc-flash-radio vc-outline');
    this.speedo = el('div', 'vc-speedo vc-outline off');
    parent.append(this.zone, this.vehicle, this.radio, this.speedo);
    this.flight = new FlightInstruments(parent, parent.closest('.vc-root') || parent.parentElement);
    this._timers = {};
    this.prev = {};
    this.visible = true;
    this.update({ time: 12, money: 0, health: 150, armor: 0, wanted: 0, weaponIcon: 'fist' });
  }

  setVisible(v) {
    this.visible = v;
    for (const e of [this.root, this.speedo, this.flight.compass, this.flight.alt]) e.classList.toggle('off', !v);
    if (!v) for (const e of [this.zone, this.vehicle, this.radio]) e.classList.remove('vc-show');
  }

  /** Also accepts { altitude, vspeed, heading } while flying (altitude: null hides the instruments). */
  update(s) {
    this._flight(s);
    const p = this.prev;
    if (s.time != null) {
      const mins = Math.floor((((s.time % 24) + 24) % 24) * 60);
      const txt = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
      if (txt !== p.clock) { this.clock.textContent = txt; p.clock = txt; }
    }
    if (s.money != null) {
      const m = Math.round(s.money);
      if (m !== p.money) {
        const neg = m < 0;
        this.money.innerHTML = `<span class="cur">${neg ? '-S$' : 'S$'}</span>${String(Math.abs(m)).padStart(8, '0')}`;
        this.money.classList.toggle('loss', neg);
        if (p.money != null) restartClass(this.money, 'bump');
        p.money = m;
      }
    }
    if ('valuation' in s && s.valuation !== p.valuation) {
      p.valuation = s.valuation;
      this.val.classList.toggle('vc-hidden', !s.valuation);
      if (s.valuation) this.val.innerHTML = `Valuation <b>${fmtCompact(s.valuation)}</b>`;
    }
    if ('users' in s && s.users !== p.users) {
      p.users = s.users;
      this.users.classList.toggle('vc-hidden', s.users == null);
      if (s.users != null) this.users.innerHTML = `Users <b>${fmtInt(s.users)}</b>`;
    }
    if (s.health != null) {
      const h = Math.max(0, Math.round(s.health));
      if (h !== p.health) { this.hp.lastChild.textContent = String(h); this.hp.classList.toggle('low', h <= 35); p.health = h; }
    }
    if (s.armor != null) {
      const a = Math.max(0, Math.round(s.armor));
      if (a !== p.armor) { this.ar.lastChild.textContent = String(a); this.ar.classList.toggle('vc-hidden', a <= 0); p.armor = a; }
    }
    if (s.wanted != null) {
      const w = Math.max(0, Math.min(5, Math.round(s.wanted)));
      if (w !== p.wanted) {
        const up = p.wanted != null && w > p.wanted;
        this.starEls.forEach((e, i) => {
          e.className = i < w ? 'on' : 'off';
          if (up && i < w) e.classList.add('flash');
        });
        this.stars.style.visibility = w > 0 || this.showEmptyStars ? 'visible' : 'hidden';
        p.wanted = w;
      }
    }
    const icon = s.weaponIcon || p.weaponIcon || 'fist';
    if (icon !== p.weaponIcon) { this.weapon.innerHTML = ICONS[icon] || ICONS.fist; p.weaponIcon = icon; }
    if ('inVehicle' in s || 'speedKmh' in s) {
      const show = !!s.inVehicle && s.speedKmh != null && this.visible;
      this.speedo.classList.toggle('off', !show);
      if (show) {
        const k = Math.round(Math.abs(s.speedKmh));
        const vn = s.vehicleName || '';
        if (k !== p.kmh || vn !== p.vn) {
          this.speedo.innerHTML = `${vn ? `<span class="veh">${vn}</span>` : ''}${k}<small>KM/H</small>`;
          p.kmh = k; p.vn = vn;
        }
      }
    }
  }

  _flight(s) {
    if ('altitude' in s) this.flight.setFlying(s.altitude != null);
    if (this.flight.on && s.altitude != null) this.flight.update(s);
  }

  _flash(elm, html, ms, key) {
    elm.innerHTML = html;
    elm.classList.add('vc-show');
    clearTimeout(this._timers[key]);
    this._timers[key] = setTimeout(() => elm.classList.remove('vc-show'), ms);
  }
  flashVehicle(name) { if (this.visible) this._flash(this.vehicle, name, 3200, 'veh'); }
  flashZone(name) { if (this.visible && name) this._flash(this.zone, name, 3600, 'zone'); }
  flashRadio(name, color = '#ff8fd0') {
    if (!this.visible) return;
    this.radio.style.color = color;
    this._flash(this.radio, `${name}${name === 'Radio Off' ? '' : '<small>now playing</small>'}`, 3500, 'radio');
  }
}
