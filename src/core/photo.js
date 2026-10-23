// Photo mode (key O): freezes the world, free-fly camera, film filters, capture to PNG with a polaroid preview.
import * as THREE from 'three';

const FILTERS = {
  None: '',
  Vice: 'saturate(1.45) contrast(1.08) hue-rotate(-12deg) brightness(1.03)',
  Noir: 'grayscale(1) contrast(1.35) brightness(0.95)',
  'Kodak 1986': 'sepia(0.38) saturate(1.25) contrast(1.06) brightness(1.04)',
  Haze: 'contrast(0.84) brightness(1.08) saturate(0.78) sepia(0.12)',
};

export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.on = false;
    this.filter = 'None';
    addEventListener('keydown', e => {
      if (e.__uiHandled || e.__cheatTyping || e.code !== 'Backquote' || game.state !== 'play' || game.mgPaused) return;
      if (this.on) this.close(); else if (!game.paused) this.open();
    });
  }
  open() {
    const g = this.game; this.on = true;
    g.paused = true; g.photoMode = true;
    const cam = g.camera;
    this.pos = cam.position.clone();
    const f = new THREE.Vector3(); cam.getWorldDirection(f);
    this.yaw = Math.atan2(-f.x, -f.z); this.pitch = Math.asin(f.y); this.fov = cam.fov;
    g.input.lock();
    g.ui.photo?.open({
      filters: Object.keys(FILTERS),
      onFilter: name => { this.filter = name; g.canvas.style.filter = FILTERS[name] || ''; },
      onCapture: () => this.capture(),
      onClose: () => this.close(),
    });
  }
  close() {
    const g = this.game; if (!this.on) return;
    this.on = false; g.paused = false; g.photoMode = false;
    g.canvas.style.filter = ''; g.cameraRig.override = null;
    g.camera.fov = this.fov; g.camera.updateProjectionMatrix();
    g.ui.photo?.close?.();
  }
  update(dt) {
    if (!this.on) return;
    const g = this.game, inp = g.input;
    this.yaw -= inp.mouse.dx * 0.0022; this.pitch = THREE.MathUtils.clamp(this.pitch - inp.mouse.dy * 0.0022, -1.5, 1.5);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const sp = (inp.keys.has('ShiftLeft') ? 60 : 12) * dt;
    if (inp.keys.has('KeyW')) this.pos.addScaledVector(fwd, sp);
    if (inp.keys.has('KeyS')) this.pos.addScaledVector(fwd, -sp);
    if (inp.keys.has('KeyD')) this.pos.addScaledVector(right, sp);
    if (inp.keys.has('KeyA')) this.pos.addScaledVector(right, -sp);
    if (inp.keys.has('KeyE')) this.pos.y += sp;
    if (inp.keys.has('KeyQ')) this.pos.y -= sp;
    this.pos.y = Math.max(0.3, this.pos.y);
    if (inp.mouse.wheel) { g.camera.fov = THREE.MathUtils.clamp(g.camera.fov + inp.mouse.wheel * 3, 12, 95); g.camera.updateProjectionMatrix(); }
    g.cameraRig.override = { position: this.pos.clone(), lookAt: this.pos.clone().add(fwd), snap: true, fov: g.camera.fov };
  }
  capture() {
    const g = this.game;
    g.audio?.sfx?.('camera_shutter');
    g.ui.setHudHiddenForPhoto?.(true);
    g.water.renderReflection(g.R.renderer, g.scene, g.camera);
    g.R.render(0);
    const src = g.canvas;
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const ctx = c.getContext('2d'); ctx.filter = FILTERS[this.filter] || 'none'; ctx.drawImage(src, 0, 0);
    ctx.filter = 'none';
    ctx.font = `600 ${Math.round(c.height * 0.022)}px "Barlow Condensed", sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.textAlign = 'right';
    ctx.fillText(`VIBE CITY · SINGAPORE · ${String(Math.floor(g.sky.time)).padStart(2, '0')}:${String(Math.floor((g.sky.time % 1) * 60)).padStart(2, '0')}`, c.width - 20, c.height - 20);
    // async PNG encode (toDataURL blocks the main thread for 100+ ms at retina sizes)
    const caption = this.filter === 'None' ? '' : this.filter;
    c.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      g.ui.photo?.showResult?.(url, caption);
      (this._urls ||= []).push(url); while (this._urls.length > 4) URL.revokeObjectURL(this._urls.shift());
    }, 'image/png');
  }
}
