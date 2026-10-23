// Keyboard / mouse / gamepad / touch input with pointer lock and simple action mapping. Touch controls (ui/touch.js)
// feed the same channels: buttons dispatch key events, the stick sets `stick`, look drags add to `mouse.dx/dy`.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();   // keys pressed this frame
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, wheel: 0, buttons: 0, clicked: 0 };
    this.stick = { x: 0, y: 0, active: false }; // on-screen analog stick: x right, y forward, -1..1
    this.locked = false;
    this.enabled = true;
    addEventListener('keydown', e => {
      if (e.repeat || e.__uiHandled) return;
      if (e.__cheatTyping && !['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) return;
      if (!this.enabled && e.code !== 'Escape') return;
      this.keys.add(e.code); this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code) && document.activeElement === document.body || document.activeElement === canvas) e.preventDefault();
    });
    addEventListener('keyup', e => { this.keys.delete(e.code); this.released.add(e.code); });
    addEventListener('blur', () => { this.keys.clear(); this.dragging = false; });
    addEventListener('mousemove', e => {
      // captured: relative motion; dragging: from cursor positions (movementX is unreliable without pointer lock)
      if (this.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
      else if (this.dragging) { this.mouse.dx += e.clientX - this._mx; this.mouse.dy += e.clientY - this._my; }
      this._mx = e.clientX; this._my = e.clientY;
    });
    canvas.addEventListener('mousedown', e => {
      this.mouse.buttons |= 1 << e.button; this.mouse.clicked |= 1 << e.button;
      // left click with the mouse captured = use the weapon (fists)
      if (this.locked && e.button === 0 && this.enabled) { this.keys.add('Attack'); this.pressed.add('Attack'); }
      if (this.wantLock && !this.locked) this._req();
      // drag to look whenever the mouse isn't captured: before the lock engages, or when the browser refuses it
      // (Safari, embedded frames, the ~1 s cooldown after Esc)
      this.dragging = !this.locked; this._mx = e.clientX; this._my = e.clientY;
    });
    addEventListener('mouseup', e => { this.mouse.buttons &= ~(1 << e.button); this.dragging = false; if (e.button === 0) { this.keys.delete('Attack'); this.released.add('Attack'); } });
    canvas.addEventListener('wheel', e => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      // Esc releases pointer lock without a keydown reaching the page: treat an unexpected unlock as "pause"
      if (was && !this.locked && this.wantLock) this.onLockLost?.();
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.wantLock = false;
  }
  down(...codes) { return this.enabled && codes.some(c => this.keys.has(c)); }
  hit(...codes) { return this.enabled && codes.some(c => this.pressed.has(c)); }
  axis(neg, pos) { return (this.down(...pos) ? 1 : 0) - (this.down(...neg) ? 1 : 0); }
  gamepad() { const g = navigator.getGamepads?.(); return g && [...g].find(Boolean); }
  endFrame() { this.pressed.clear(); this.released.clear(); this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0; this.mouse.clicked = 0; }
  _req() { try { const p = this.canvas.requestPointerLock?.(); p?.catch?.(() => { }); } catch { } }
  lock() { this.wantLock = true; this._req(); }
  unlock() { this.wantLock = false; document.exitPointerLock?.(); }
}
