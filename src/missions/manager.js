// Mission framework: async mission scripts with an abortable context (markers, dialogue, cutscenes,
// timers, NPCs, vehicles, minigames), mission-giver markers, pass/fail flow and save progress.
import * as THREE from 'three';
import { Marker, Checkpoint } from '../world/markers.js';
import { Vehicle } from '../entities/vehicle.js';
import { createHumanoid } from '../entities/humanoid/index.js';
import { STORY } from './story.js';
import { roleOf } from '../audio/cast.js';

export class MissionFail extends Error { constructor(reason) { super(reason); this.isMissionFail = true; } }


class Ctx {
  constructor(mgr, mission) {
    this.mgr = mgr; this.game = mgr.game; this.mission = mission;
    this.aborted = false; this.cleanups = []; this.waiters = new Set();
    this.T = THREE;
  }
  check() { if (this.aborted) throw new MissionFail(this.abortReason); }
  _waiter(pred, timeout) {
    this.check();
    return new Promise((resolve, reject) => {
      const w = { pred, t: 0, timeout, resolve, reject };
      this.waiters.add(w);
    });
  }
  wait(sec) { return this._waiter(null, sec); }
  until(pred, timeout = Infinity) { return this._waiter(pred, timeout); }
  onCleanup(fn) { this.cleanups.push(fn); }
  fail(reason) { this.mgr.abort(reason); throw new MissionFail(reason); }

  // --- UI / dialogue
  objective(t, d) { this.game.ui.objective(t, d); }
  help(t, d) { this.game.ui.help(t, d); }
  title(t, s) { this.game.ui.missionTitle(t, s); }
  splash(t, c) { this.game.ui.splash(t, c); }
  /** One spoken line: subtitle + voice-over. Voice-over keys are voKey(roleOf(speaker), l.text) on the original
   *  subtitle text (markup is ignored by the key). With a recorded take the subtitle stays up for its real length;
   *  Enter skips both. phone: the caller's lines go through the earpiece filter (Tommy's own stay clean). */
  _line(l, { phone = false, caller } = {}) {
    const audio = this.game.audio, voice = audio?.voice;
    const speaker = l.speaker || caller, role = roleOf(speaker);
    const on = this.game.settings.voices !== false && !!audio?.say;
    const dur = on ? voice?.lineDuration?.(role, l.text) : null;
    const opts = dur ? { ...l, speaker, duration: dur * 1000 + 350 } : { ...l, speaker };
    const plain = l.text.replace(/<[^>]+>/g, '');
    // wait for the voice, but never much longer than the line itself (some TTS engines never fire 'end')
    const cap = dur ? dur * 1000 + 1500 : Math.min(9000, 2600 + plain.length * 65);
    const sp = on ? Promise.race([audio.say(l.text, { voice: role, phone: phone && role !== 'tommy' }), new Promise(r => setTimeout(r, cap))]) : null;
    return { opts, sp };
  }
  _prefetch(lines, caller) {
    const v = this.game.audio?.voice; if (!v?.prefetch) return;
    for (const l of lines) v.prefetch(roleOf(l.speaker || caller), [l.text]);
  }
  async say(lines) {
    this._prefetch(lines);
    for (const l of lines) {
      this.check();
      const { opts, sp } = this._line(l);
      const sub = this.game.ui.subtitle(l.text, opts);
      const onKey = e => { if (e.code === 'Enter' || e.code === 'NumpadEnter') this.game.audio?.voice?.stopDialogue?.(); };
      addEventListener('keydown', onKey);
      try { await Promise.all([sub, sp]); } finally { removeEventListener('keydown', onKey); }
      await this.wait(0.15);
    }
  }
  async phone(caller, lines) {
    this.check();
    this._prefetch(lines, caller);
    this.game.audio?.sfx?.('phone_ring');
    const p = this.game.ui.phone.call(caller, lines, { line: l => this._line(l, { phone: true, caller }), skip: () => this.game.audio?.voice?.stopDialogue?.() });
    await p; this.check();
  }
  text(from, msg) { this.game.audio?.sfx?.('text_message'); this.game.ui.phone.text(from, msg); }
  async choice(prompt, options) { this.game.input.unlock(); const r = await this.game.ui.choice(prompt, options); this.game.input.lock(); this.check(); return r; }

  // --- world objects
  marker(pos, opts = {}) {
    const m = opts.checkpoint ? new Checkpoint(this.game.scene, pos, opts) : new Marker(this.game.scene, pos, opts);
    const h = { m, blip: { x: pos.x, z: pos.z, type: opts.blip || (opts.checkpoint ? 'checkpoint' : 'objective') }, remove: () => { m.dispose(); this.mgr.markers.delete(h); } };
    this.mgr.markers.add(h);
    this.onCleanup(() => h.remove());
    return h;
  }
  async reach(pos, { radius = 3, vehicle, text, route = true, checkpoint = false, blip, onFoot } = {}) {
    if (text) this.objective(text);
    const h = this.marker(pos, { radius: checkpoint ? Math.max(radius, 5) : Math.min(radius, 2.2), checkpoint, blip });
    if (route) this.game.routeTo({ x: pos.x, z: pos.z });
    const P = this.game.player;
    await this.until(() => {
      const d = Math.hypot(P.position.x - pos.x, P.position.z - pos.z);
      if (d > radius || Math.abs(P.position.y - pos.y) > 6) return false;
      if (vehicle === true && !P.vehicle) return false;
      if ((vehicle === false || onFoot) && P.vehicle) { this.mgr.prompt = 'Get out of the vehicle'; return false; }
      return true;
    });
    this.mgr.prompt = null;
    h.remove();
    if (route) this.game.routeTo(null);
    this.game.audio?.sfx?.('checkpoint');
  }
  npc(preset, pos, facing = 0, anim = 'idle') {
    const h = createHumanoid({ preset, lod: 'high' });
    h.root.position.copy(pos); h.root.rotation.y = facing;
    h.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    h.setAnim?.(anim);
    this.game.scene.add(h.root);
    const n = { h, root: h.root, setAnim: (a, o) => h.setAnim?.(a, o), face: (p) => { h.root.rotation.y = Math.atan2(-(p.x - h.root.position.x), -(p.z - h.root.position.z)); }, remove: () => { this.game.scene.remove(h.root); h.dispose?.(); this.mgr.npcs.delete(n); } };
    this.mgr.npcs.add(n);
    this.onCleanup(() => n.remove());
    return n;
  }
  vehicle(type, pos, yaw = 0, { keep = false, color } = {}) {
    const v = new Vehicle(this.game, type, { position: pos, yaw, color });
    v.setDriverControls({ throttle: 0, brake: 0, steer: 0, handbrake: true }, 0.016);
    this.game.vehicles.push(v);
    if (!keep) this.onCleanup(() => { if (this.game.player.vehicle === v) return; const i = this.game.vehicles.indexOf(v); if (i >= 0) this.game.vehicles.splice(i, 1); v.dispose(); });
    return v;
  }
  timer(seconds, label = 'TIME', reason = 'Out of time') {
    const ui = this.game.ui; ui.timer.show(label, seconds);
    const t = { left: seconds, stopped: false, stop: () => { t.stopped = true; ui.timer.hide(); } };
    this.mgr.timers.add(t);
    t.onExpire = () => this.mgr.abort(reason);
    this.onCleanup(() => { t.stop(); this.mgr.timers.delete(t); });
    return t;
  }
  // --- cutscenes
  async cutscene(fn) {
    const g = this.game;
    g.player.controlsEnabled = false;
    g.ui.letterbox(true);
    g.wanted.suppress = 999;
    const rig = g.cameraRig;
    const prevOverride = rig.override;
    try { await fn(this); }
    finally {
      rig.override = prevOverride || null;
      g.ui.letterbox(false);
      g.player.controlsEnabled = true;
      g.wanted.suppress = 2;
      g.camera.fov = rig.baseFov; g.camera.updateProjectionMatrix();
    }
  }
  cam(position, lookAt, opts = {}) {
    if (![position.x, position.y, position.z, lookAt.x, lookAt.y, lookAt.z].every(Number.isFinite)) { console.warn('cutscene cam: invalid framing', position, lookAt); return; }
    this.game.cameraRig.override = { position: position.clone(), lookAt: lookAt.clone(), lerp: opts.lerp ?? 2.5, snap: !!opts.snap, fov: opts.fov ?? 50 };
  }
  async pan(from, to, lookFrom, lookTo, seconds, fov = 50) {
    const steps = Math.max(1, Math.round(seconds * 30));
    const p = new THREE.Vector3(), l = new THREE.Vector3();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, e = t * t * (3 - 2 * t);
      p.lerpVectors(from, to, e); l.lerpVectors(lookFrom, lookTo, e);
      this.game.cameraRig.override = { position: p.clone(), lookAt: l.clone(), snap: true, fov };
      await this.wait(seconds / steps);
    }
  }
  async minigame(name, opts = {}) {
    const g = this.game;
    const root = document.createElement('div');
    root.className = 'vc-minigame-host';
    Object.assign(root.style, { position: 'fixed', inset: '0', zIndex: 60 });
    document.body.appendChild(root);
    g.input.unlock(); g.input.enabled = false;
    g.paused = true; g.mgPaused = true;
    try {
      const loaders = {
        vibecode: () => import('../ui/minigames/vibecode.js').then(m => m.runVibeCode),
        pitch: () => import('../ui/minigames/pitch.js').then(m => m.runPitch),
        negotiation: () => import('../ui/minigames/negotiation.js').then(m => m.runNegotiation),
      };
      const run = await loaders[name]();
      return await run(root, { audio: g.audio, ...opts });
    } finally {
      root.remove();
      g.paused = false; g.mgPaused = false;
      g.input.enabled = true; g.input.lock();
    }
  }
  // staged mission positions are already chosen with care: only nudge them if they're actually blocked
  teleport(pos, facing) { this.game.relocate(pos, facing, { pad: 0.15 }); }
  setTime(h) { this.game.sky.time = h; this.game.sky.refreshEnv(); }
}

export class Missions {
  constructor(game) {
    this.game = game;
    this.list = STORY;
    this.markers = new Set();
    this.npcs = new Set();
    this.timers = new Set();
    this.active = null;
    this.prompt = null;
    this.giver = null;
    this.valuation = 0;
    this.users = 0;
    this.state = {}; // story state shared between missions (idea, quality, pitch...)
    game.events.on('missionAbort', r => { if (this.active) this.abort(r === 'wasted' ? 'You were wasted' : r === 'busted' ? 'You got busted' : r); });
  }

  get done() { return this.game.progress.missionsDone; }
  nextMission() { return this.list.find(m => !this.done.includes(m.id)); }

  onGameStart(mode, save) {
    if (save?.progress?.state) this.state = save.progress.state;
    this.valuation = this.state.valuation || 0; this.users = this.state.users || 0;
    const next = this.nextMission();
    // auto-start missions have no marker: resume them directly (after a beat when continuing a save)
    if (next && next.autoStart && !(this.failedOnce?.has(next.id))) setTimeout(() => this.start(next), mode === 'continue' ? 2500 : 0);
    else this.refreshGiver();
  }

  startById(id) {
    const m = this.list.find(x => x.id === id || String(this.list.indexOf(x) + 1) === String(id));
    if (!m) return;
    for (const x of this.list) { if (x === m) break; if (!this.done.includes(x.id)) this.done.push(x.id); }
    if (m.giver) { const sw = this.game.roadnet.nearestSidewalk(m.giver.pos.x, m.giver.pos.z, 160); this.game.relocate(sw ? sw.pos : m.giver.pos, 0); }
    this.start(m);
  }

  refreshGiver() {
    if (this.giver) { this.giver.m.dispose(); this.giver = null; }
    const next = this.nextMission();
    if (!next || this.active) return;
    const g = next.giver || (this.failedOnce?.has(next.id) ? next.retry : null);
    if (!g) return;
    const sw = this.game.roadnet.nearestSidewalk(g.pos.x, g.pos.z, 160);
    const pos = sw ? sw.pos.clone() : g.pos.clone();
    this.giver = { mission: next, pos, m: new Marker(this.game.scene, pos, { type: 'mission', radius: 1.4, height: 2.4 }) };
    if (g.hint) this.game.ui.help(g.hint, 8000);
  }

  /** the one-line objective between missions: the next story mission's marker, else the nearest side activity */
  freeRoamGoal(p) {
    const far = (x, z) => { const d = Math.hypot(x - p.x, z - p.z); return d >= 950 ? `${(d / 1000).toFixed(1)} km` : `${Math.max(50, Math.round(d / 50) * 50)} m`; };
    if (this.giver) return `Next mission: <b>${this.giver.mission.title}</b> · ${far(this.giver.pos.x, this.giver.pos.z)}`;
    let best = null, bd = Infinity;
    for (const a of this.game.activities?.list || []) { const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z); if (d < bd) { bd = d; best = a; } }
    return best ? `<em>${best.label}</em> · ${far(best.pos.x, best.pos.z)}` : null;
  }

  blips() {
    const b = [];
    if (this.giver) b.push({ x: this.giver.pos.x, z: this.giver.pos.z, type: 'mission', label: this.giver.mission.title });
    for (const h of this.markers) b.push(h.blip);
    for (const extra of this.extraBlips || []) b.push(extra);
    b.push({ x: -392, z: 404, type: 'safehouse', label: 'Capsule hotel' });
    return b;
  }

  async start(mission) {
    if (this.active) return;
    if (this.giver) { this.giver.m.dispose(); this.giver = null; }
    const ctx = new Ctx(this, mission);
    this.active = { mission, ctx };
    this.game.ui.goal(null); // (until the mission sets its first objective)
    this.game.audio?.sfx?.('mission_start');
    if (!mission.noTitle) this.game.ui.missionTitle(mission.title, mission.subtitle || '');
    let ok = false, reason = '';
    try {
      const result = await mission.run(ctx, this.state);
      ok = true;
      this.finish(mission, ctx, result);
    } catch (e) {
      if (!e?.isMissionFail) console.error(e);
      reason = e?.message || 'Mission failed';
    }
    this.cleanup(ctx);
    this.active = null;
    if (!ok) {
      (this.failedOnce ||= new Set()).add(mission.id);
      if (!/wasted|busted/i.test(reason)) await this.game.ui.missionFailed(reason);
      this.refreshGiver();
    }
  }

  async finish(mission, ctx, result) {
    const reward = result?.reward ?? mission.reward ?? 0;
    this.done.push(mission.id);
    this.game.progress.state = this.state;
    this.game.addMoney(reward);
    this.game.audio?.music?.('mission_passed');
    await this.game.ui.missionPassed({ title: mission.passTitle, reward, extra: result?.extra });
    this.game.save();
    if (mission.after) mission.after(this.game, this.state);
    const next = this.nextMission();
    if (next?.autoStart) setTimeout(() => this.start(next), 1500);
    else this.refreshGiver();
  }

  abort(reason) {
    const a = this.active; if (!a || a.ctx.aborted) return;
    a.ctx.aborted = true; a.ctx.abortReason = reason;
    for (const w of a.ctx.waiters) w.reject(new MissionFail(reason));
    a.ctx.waiters.clear();
  }

  cleanup(ctx) {
    for (const fn of ctx.cleanups.reverse()) { try { fn(); } catch (e) { console.warn(e); } }
    ctx.cleanups = [];
    for (const w of ctx.waiters) w.reject(new MissionFail('cleanup'));
    ctx.waiters.clear();
    this.prompt = null;
    this.game.routeTo(null);
    this.game.ui.timer.hide(); this.game.ui.counter.hide(); this.game.ui.bar.hide(); this.game.ui.goal(null);
    this.game.cameraRig.override = null;
    this.game.player.controlsEnabled = true;
    this.game.ui.letterbox(false);
    this.weatherLocked = false; this.timeFrozen = false;
  }

  update(dt) {
    for (const h of this.markers) h.m.update(dt);
    if (this.giver) {
      this.giver.m.update(dt);
      const P = this.game.player;
      const d = Math.hypot(P.position.x - this.giver.pos.x, P.position.z - this.giver.pos.z);
      if (d < 1.8 && P.state === 'foot' && !this.active) this.start(this.giver.mission);
      else if (d < 1.8 && P.vehicle) this.prompt = 'Get out of the vehicle to start the mission';
      else if (this.prompt === 'Get out of the vehicle to start the mission') this.prompt = null;
    }
    for (const t of this.timers) {
      if (t.stopped) continue;
      t.left -= dt;
      this.game.ui.timer.set(Math.max(0, t.left));
      if (t.left <= 0) { t.stopped = true; t.onExpire?.(); }
    }
    const a = this.active; if (!a) return;
    for (const w of [...a.ctx.waiters]) {
      w.t += dt;
      let done = false;
      try { done = w.pred ? w.pred(dt) : w.t >= w.timeout; } catch (e) { a.ctx.waiters.delete(w); w.reject(e); continue; }
      if (w.pred && w.t >= w.timeout) { a.ctx.waiters.delete(w); w.resolve(false); continue; }
      if (done) { a.ctx.waiters.delete(w); w.resolve(true); }
    }
  }
}
