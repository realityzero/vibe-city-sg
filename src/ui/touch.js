// On-screen controls for phones and tablets. A floating move stick on the left, context buttons on the right (on foot,
// swimming, driving, boating, flying), drag anywhere else to look, pinch to zoom the camera, tap the radar for the map,
// and a small system bar (pause, camera, Claudia, skip line, fullscreen). Buttons dispatch the same key events a
// keyboard would, so every system that listens for keys works unchanged; the stick feeds Input.stick and look drags
// feed Input.mouse. Turns on for touch-first devices or at the first touch, and off again when a real mouse moves.
import './touch.css';

const params = new URLSearchParams(location.search);

/** a phone or tablet with no mouse/trackpad attached */
export const isTouchFirst = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;

// id: [label, key code, held while pressed]
const BTN = {
  jump: ['JUMP', 'Space'], run: ['RUN', 'ShiftLeft', true], punch: ['PUNCH', 'Attack'], enter: ['ENTER', 'KeyF'],
  climb: ['CLIMB', 'Space'], fast: ['FAST', 'ShiftLeft', true], board: ['BOARD', 'KeyF'],
  gas: ['GAS', 'KeyW', true], brake: ['BRAKE', 'KeyS', true], hbrake: ['DRIFT', 'Space', true], exit: ['EXIT', 'KeyF'],
  horn: ['HORN', 'KeyH'], radio: ['RADIO', 'KeyE'], nitro: ['KOPI', 'KeyB', true],
  up: ['UP', 'Space', true], down: ['DOWN', 'ShiftLeft', true],
};
// per mode: [button, slot]. Slots fan out from the bottom-right corner: a big thumb button, b left of it, c above it,
// d up-left between them (enter / exit), e f g small ones further out
const MODES = {
  foot: [['jump', 'a'], ['run', 'b'], ['punch', 'c'], ['enter', 'd']],
  swim: [['climb', 'a'], ['fast', 'b'], ['board', 'd']],
  car: [['gas', 'a'], ['brake', 'b'], ['hbrake', 'c'], ['exit', 'd'], ['horn', 'e'], ['radio', 'f'], ['nitro', 'g']],
  boat: [['gas', 'a'], ['brake', 'b'], ['exit', 'd'], ['horn', 'e']],
  air: [['up', 'a'], ['down', 'b'], ['exit', 'd']],
};
const SYS = [['pause', 'II', 'Escape'], ['cam', 'CAM', 'KeyV'], ['ai', 'AI', 'Slash', '/'], ['skip', '▶▶', 'Enter'], ['full', '⛶']];
const LOOK_GAIN = 2.4;   // touch px -> mouse px (a third of the screen turns ~100°)
const PINCH_GAIN = 0.012; // pinch px -> wheel steps

// WebKit throws if the pointer is no longer active (a finger lifted mid-dispatch)
const capture = (e, id) => { try { e.setPointerCapture(id); } catch { } };
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.held = new Set();
    this.stickId = null; this.looks = new Map(); this.pinchD = 0;
    this.mode = ''; this.flags = '';
    const root = this.root = el('div', 'vc-touch');
    this.surf = el('div', 'surf');
    this.stick = el('div', 'stick', '<div class="knob"></div>'); this.knob = this.stick.firstChild;
    this.cluster = el('div', 'cluster');
    this.bar = el('div', 'sysbar');
    for (const [id, label, code, key] of SYS) {
      if (id === 'full' && !(document.fullscreenEnabled || document.webkitFullscreenEnabled)) continue;
      const b = el('button', `sys ${id}`, label);
      this.bind(b, id === 'full' ? () => this.toggleFullscreen() : code, false, key);
      this.bar.appendChild(b);
    }
    root.append(this.surf, this.stick, this.cluster, this.bar, el('div', 'rotate', '<b>Turn your device sideways</b><span>Vibe City plays in landscape</span>'));
    game.ui.root.appendChild(root);
    this.bindSurface();

    // touch mode: forced by ?touch / ?notouch, else on for touch-first devices and at any touch, off when a mouse moves
    const forced = params.has('touch') ? true : params.has('notouch') ? false : null;
    this.setOn(forced ?? isTouchFirst());
    if (forced == null) {
      addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') this.setOn(true); }, true);
      let moved = 0;
      addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && this.on && (moved += Math.abs(e.movementX) + Math.abs(e.movementY)) > 60) { moved = 0; this.setOn(false); } }, true);
    }
    addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => this.releaseAll());
  }

  setOn(on) {
    if (this.on === on) return;
    this.on = on;
    this.game.ui.root.classList.toggle('vc-touchmode', on);
    document.documentElement.classList.toggle('vc-touch-on', on);
    if (!on) this.releaseAll();
  }

  key(code, down, key = '') {
    if (down) this.held.add(code); else this.held.delete(code);
    dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key, bubbles: true, cancelable: true }));
  }

  /** press = key down while the finger is on the button (held) or a tap (down + up at once) */
  bind(b, action, hold, key) {
    b.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      capture(b, e.pointerId); b.classList.add('on');
      if (typeof action === 'function') return action();
      this.key(action, true, key);
      if (!hold) this.key(action, false, key);
    });
    const up = () => { if (!b.classList.contains('on')) return; b.classList.remove('on'); if (hold && typeof action === 'string') this.key(action, false, key); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', e => e.preventDefault());
  }

  bindSurface() {
    const s = this.surf, inp = this.input;
    s.addEventListener('pointerdown', e => {
      e.preventDefault();
      capture(s, e.pointerId);
      const x = e.clientX, y = e.clientY;
      // the radar is a map button
      const r = this.game.ui.radar?.wrap?.getBoundingClientRect();
      if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { this.key('KeyM', true); this.key('KeyM', false); return; }
      if (this.stickId == null && this.root.classList.contains('ctl') && x < innerWidth * 0.45 && y > innerHeight * 0.3) {
        this.stickId = e.pointerId;
        const R = this.stickR();
        this.sx = Math.min(innerWidth * 0.45, Math.max(R + 8, x)); this.sy = Math.min(innerHeight - R - 8, Math.max(R + 8, y));
        this.stick.classList.add('active');
        this.stick.style.left = `${this.sx}px`; this.stick.style.top = `${this.sy}px`;
        this.moveStick(x, y);
        return;
      }
      this.looks.set(e.pointerId, { x, y });
      this.pinchD = this.looks.size === 2 ? this.pinchDist() : 0;
    });
    s.addEventListener('pointermove', e => {
      if (e.pointerId === this.stickId) return this.moveStick(e.clientX, e.clientY);
      const l = this.looks.get(e.pointerId); if (!l) return;
      if (this.looks.size === 1) { inp.mouse.dx += (e.clientX - l.x) * LOOK_GAIN; inp.mouse.dy += (e.clientY - l.y) * LOOK_GAIN; }
      l.x = e.clientX; l.y = e.clientY;
      if (this.looks.size === 2) { const d = this.pinchDist(); inp.mouse.wheel -= (d - this.pinchD) * PINCH_GAIN; this.pinchD = d; }
    });
    const end = e => {
      if (e.pointerId === this.stickId) this.releaseStick();
      this.looks.delete(e.pointerId);
      this.pinchD = this.looks.size === 2 ? this.pinchDist() : 0;
    };
    s.addEventListener('pointerup', end); s.addEventListener('pointercancel', end);
    s.addEventListener('contextmenu', e => e.preventDefault());
  }

  stickR() { return Math.max(46, this.stick.offsetWidth / 2 || 46); }
  pinchDist() { const [a, b] = [...this.looks.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }

  moveStick(x, y) {
    const R = this.stickR();
    let dx = (x - this.sx) / R, dy = (y - this.sy) / R;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    this.knob.style.transform = `translate(${dx * R * 0.62}px, ${dy * R * 0.62}px)`;
    // radial dead zone, then rescale so the edge of the dead zone is 0
    const m = Math.min(1, len), k = m < 0.14 ? 0 : (m - 0.14) / 0.86 / (m || 1);
    const st = this.input.stick; st.active = true; st.x = dx * k; st.y = -dy * k;
  }

  releaseStick() {
    this.stickId = null;
    const st = this.input.stick; st.active = false; st.x = st.y = 0;
    this.stick.classList.remove('active'); this.stick.style.left = this.stick.style.top = '';
    this.knob.style.transform = '';
  }

  releaseAll() {
    for (const code of [...this.held]) this.key(code, false);
    for (const b of this.root.querySelectorAll('.on')) b.classList.remove('on');
    if (this.stickId != null) this.releaseStick();
    this.looks.clear();
  }

  toggleFullscreen() {
    const d = document, fs = d.fullscreenElement || d.webkitFullscreenElement;
    if (fs) (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
    else { const e = d.documentElement; const p = (e.requestFullscreen || e.webkitRequestFullscreen)?.call(e, { navigationUI: 'hide' }); p?.then?.(() => screen.orientation?.lock?.('landscape').catch(() => { })).catch?.(() => { }); }
  }

  buildCluster(mode) {
    this.cluster.textContent = '';
    for (const [id, slot] of MODES[mode]) {
      const [label, code, hold] = BTN[id];
      const b = el('button', `btn s-${slot} b-${id}`, label);
      this.bind(b, code, !!hold);
      this.cluster.appendChild(b);
    }
  }

  /** per frame: what's on screen depends on the game state and what Tommy is doing */
  update() {
    if (!this.on) return;
    const g = this.game, p = g.player, v = p?.vehicle;
    const play = !!p && g.state === 'play' && !g.paused && !g.mgPaused && !g.ui.map.isOpen && !g.photo?.on && !g.claudia?.isOpen && p.state !== 'dead';
    const ctl = play && p.controlsEnabled && g.input.enabled;
    const mode = v ? (v.isAircraft || v.spec.kind === 'drone' ? 'air' : v.isBoat ? 'boat' : 'car') : p?.swimming ? 'swim' : 'foot';
    if (mode !== this.mode) { this.releaseAll(); this.mode = mode; this.buildCluster(mode); this.root.dataset.mode = mode; }
    const flags = `${play ? 'play ' : ''}${ctl ? 'ctl ' : ''}${g._nearVehicle ? 'near ' : ''}${g.hype?.kopiEl?.style.display === 'block' ? 'kopi ' : ''}${g.ui._sub ? 'sub' : ''}`;
    if (flags !== this.flags) {
      if (this.flags.includes('ctl') && !ctl) this.releaseAll();
      this.flags = flags;
      this.root.className = `vc-touch ${flags}`;
    }
  }
}
