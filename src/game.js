// Game orchestrator: boot/loading, main loop, systems wiring, pause/map, death/arrest, save, free-roam extras.
import * as THREE from 'three';
import { Renderer, QUALITY } from './gfx/renderer.js';
import { U } from './gfx/globals.js';
import { SkySystem } from './world/sky.js';
import { Water, REFLECT_LAYER } from './world/water.js';
import { City } from './world/city.js';
import { Vegetation } from './world/vegetation.js';
import { RoadNet } from './world/roadnet.js';
import { Props } from './world/props.js';
import { StreetProps } from './world/streetprops.js';
import { StreetDetail } from './world/streetdetail.js';
import { StreetFurniture } from './world/streetfurniture.js';
import { NightGlow } from './world/nightglow.js';
import { SafeSpots } from './world/safespot.js';
import { TreeColliders } from './world/treecolliders.js';
import { Weather } from './world/weather.js';
import { Input } from './core/input.js';
import { Events } from './core/events.js';
import { CameraRig } from './core/cameraRig.js';
import { loadSettings, saveSettings, loadSave, writeSave } from './core/settings.js';
import { Physics } from './physics/physics.js';
import { Player } from './entities/player.js';
import { Vehicle } from './entities/vehicle.js';
import { VEHICLE_SPECS, getTypeAssets } from './entities/vehicles/index.js';
import { setAtlasGpuScale } from './entities/vehicles/atlas.js';
import { Traffic } from './entities/traffic.js';
import { Pedestrians } from './entities/pedestrians.js';
import { Wanted } from './entities/wanted.js';
import { UI, districtAt } from './ui/index.js';
import { Missions } from './missions/manager.js';
import { Extras } from './missions/extras.js';
import { Spawns } from './world/spawns.js';
import { Boats } from './world/boats.js';
import { FX } from './world/fx.js';
import { Juice } from './world/juice.js';
import { Cheats, CHEATS } from './missions/cheats.js';
import { Stunts } from './missions/stunts.js';
import { Taxi } from './missions/taxi.js';
import { Activities } from './missions/activities.js';
import { PhotoMode } from './core/photo.js';
import { Services } from './missions/services.js';
import { Ambient } from './world/ambient.js';
import { Autopilot } from './entities/autopilot.js';
import { Claudia } from './missions/claudia.js';
import { Scenes } from './world/scenes.js';
import { Hype } from './missions/hype.js';
import { FineCity } from './missions/finecity.js';
import { DragRace } from './missions/dragrace.js';
import { CityTalk } from './missions/citytalk.js';
import { BystanderClips } from './world/bystander.js';
import { TouchControls, isTouchFirst } from './ui/touch.js';
import { WATER_LEVEL } from './core/constants.js';
import { bakeHeightField } from './gfx/heightfield.js';
import { installTextureRelease, releasedTextureStats } from './gfx/texrelease.js';
import { gpuOnly } from './gfx/geomrelease.js';
import { nextTask } from './core/nextTask.js';
installTextureRelease();

const params = new URLSearchParams(location.search);
const HOSPITAL = new THREE.Vector3(-1585, 0, 818);      // Singapore General Hospital, Outram
const POLICE_HQ = new THREE.Vector3(-1088, 0, 860);     // Bukit Merah East NPC / Cantonment
export const SAFEHOUSE = { pos: new THREE.Vector3(-392, 0, 404), facing: Math.PI * 0.5, name: 'Galaxy Pods Capsule Hotel' };

export class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.statsEl = document.getElementById('stats');
    this.settings = loadSettings();
    if (params.get('q')) this.settings.quality = params.get('q');
    this.events = new Events();
    this.U = U;
    this.R = new Renderer(this.canvas, this.settings.quality);
    if (!params.has('fixedres') && !params.has('q')) this.R.detectGpu();
    this.R.setResolutionPreference(this.settings.resolutionScale ?? 1);
    this.R.dynamicResolution = this.settings.dynamicResolution && !params.has('fixedres');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.4, 24000);
    this.camera.layers.enable(REFLECT_LAYER);
    this.camera.position.set(700, 60, 200);
    this.R.setupPost(this.scene, this.camera);
    addEventListener('resize', () => this.R.resize());
    // iOS may drop the WebGL context (backgrounded, GPU memory pressure). Textures and geometry live only on the GPU
    // (their CPU copies are freed after upload), so there is nothing to restore from: save and reload instead.
    this.canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      if (this._ctxLost) return; this._ctxLost = true;
      try { if (this.state === 'play' && this.worldReady && !this.missions?.active) this.save(); } catch { }
      // a context that dies again right after each reload (the device can't spare the memory) must not reload forever:
      // the third loss within a minute asks first
      let n = 0;
      try { const r = JSON.parse(sessionStorage.getItem('vc-ctxlost') || '{}'); n = Date.now() - (r.t || 0) < 60000 ? r.n || 0 : 0; sessionStorage.setItem('vc-ctxlost', JSON.stringify({ n: n + 1, t: Date.now() })); } catch { }
      if (n >= 2) {
        const d = document.createElement('div');
        d.style.cssText = 'position:fixed;inset:0;z-index:300;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:#08020f;color:#fff;font:600 15px/1.4 sans-serif;text-align:center;padding:24px';
        d.innerHTML = '<div>The graphics memory ran out.<br>Close other tabs and apps, then try again.</div><button style="all:unset;padding:12px 26px;border-radius:99em;background:#ff3fa4;font-weight:800;letter-spacing:.1em">TRY AGAIN</button>';
        d.querySelector('button').addEventListener('click', () => { try { sessionStorage.removeItem('vc-ctxlost'); } catch { } location.reload(); });
        document.body.appendChild(d);
        return;
      }
      const go = () => location.reload();
      if (document.hidden) document.addEventListener('visibilitychange', () => { if (!document.hidden) go(); }, { once: true }); else setTimeout(go, 300);
    });
    this.input = new Input(this.canvas);
    this.input.onLockLost = () => { if (this.state === 'play' && !this.paused && !this.mgPaused && !this.claudia?.isOpen && !this.photo?.on) this.togglePause(); };
    this.ui = new UI(document.getElementById('ui'));
    this.touch = new TouchControls(this);
    this.ui.applySettings(this.settings);
    this.ui.setControls([
      ['On foot', [['W A S D', 'Move'], ['Mouse', 'Look around (click to capture the mouse, or drag)'], ['Mouse wheel / V', 'Camera distance'], ['Left click', 'Punch (mouse captured)'], ['Shift', 'Sprint'], ['Ctrl', 'Walk'], ['Space', 'Jump'], ['F', 'Enter / jack a vehicle']]],
      ['Touch', [['Left thumb', 'Move / steer (floating stick)'], ['Right side drag', 'Look around'], ['Pinch', 'Camera distance'], ['Radar', 'Tap for the map'], ['Buttons', 'Jump, run, punch, enter; gas, brake, drift, exit, horn, radio']]],
      ['Driving', [['W / S', 'Accelerate / brake & reverse'], ['A / D', 'Steer'], ['Space', 'Handbrake'], ['Q / E', 'Previous / next radio station'], ['H', 'Horn (siren in police cars)'], ['V', 'Camera distance'], ['C', 'Look behind'], ['L', 'Headlights'], ['B', 'Kopi Gao boost (nitro)'], ['R', 'Flip an overturned car'], ['F', 'Exit vehicle']]],
      ['Flying', [['Space / Shift', 'Climb / descend'], ['W / S', 'Nose down / up (fly forward / back)'], ['A / D', 'Turn'], ['Q / E', 'Strafe left / right']]],
      ['General', [['M', 'Map (right-click sets a GPS waypoint)'], ['Esc / P', 'Pause menu'], ['`', 'Photo mode'], ['T', 'Snatch taxi duty (in a taxi)'], ['Y', 'Claudia Autopilot to your waypoint'], ['/', 'Prompt Claudia: vibe-code the city ("make it rain", "spawn a helicopter")'], ['Enter', 'Skip dialogue line'], ['Typing', 'Cheat codes, Vice City style']]],
    ]);
    this.vehicles = [];
    this.state = 'boot';
    this.time = parseFloat(params.get('t') || '18.2');
    this.timeScale = 1 / 60; // game hours per real second (1 s = 1 game minute)
    this.paused = false;
    this.money = 0;
    this.progress = { missionsDone: [], money: 0, kaya: [], stats: { distance: 0, carjacks: 0, peds: 0, erp: 0, fines: 0 } };
    this._last = performance.now();
    this.fps = 60;
    window.__game = this;
    for (const ev of ['touchend', 'click', 'keydown']) addEventListener(ev, () => { const c = this.audio?.ctx || this._audioCtx; if (c && c.state !== 'running' && !document.hidden) c.resume().catch(() => { }); }, { capture: true, passive: true });
    // iOS: background tabs get suspended and often discarded — keep progress, silence audio while hidden
    const away = () => { if (this.state === 'play' && this.worldReady && !this.missions?.active) try { this.save(); } catch { } };
    document.addEventListener('visibilitychange', () => { const c = this.audio?.ctx; if (document.hidden) { away(); c?.suspend?.().catch(() => { }); } else if (c && this.state !== 'boot') c.resume().catch(() => { }); });
    addEventListener('pagehide', away);
    // keyboard routing for menus
    addEventListener('keydown', e => {
      if (e.__uiHandled || e.__cheatTyping) return;
      if (this.state !== 'play') return;
      if (e.code === 'Escape' || e.code === 'KeyP') { if (this.ui.map.isOpen) return; this.togglePause(); }
      else if (e.code === 'KeyM' && !this.paused) this.openMap();
    });
  }

  async boot() {
    // world loads behind the title screen
    this.loadPromise = this.loadWorld().catch(e => { console.error(e); this.ui.showLoading(1, 'Error: ' + e.message); throw e; });
    if (params.has('skipTitle') || params.has('autostart')) return this.start(params.has('newgame') ? 'new' : 'auto');
    this.state = 'title';
    this.loop();
    await this.pressStart();
    const save = loadSave();
    this.ui.showTitle({
      onStart: () => this.start('new'),
      onContinue: save ? () => this.start('continue') : undefined,
      onSettings: () => { },
    });
  }

  // console-style "press start": the first gesture unlocks Web Audio so the title theme can play over the menu
  pressStart() {
    return new Promise(resolve => {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:radial-gradient(ellipse at 50% 70%,#3a0f4a 0%,#12051f 55%,#05030a 100%);cursor:pointer;user-select:none;-webkit-user-select:none';
      d.innerHTML = `<div style="font:700 13px/1 'Anton','Bebas Neue',Impact,sans-serif;letter-spacing:.5em;color:#fff;opacity:.85">GRAND THEFT AUTO</div>
        <div style="font:64px/1 'Mr Dafoe','Yellowtail',cursive;color:#ff7ad1;text-shadow:0 0 12px #ff3fa4,0 0 38px #ff3fa4">Vibe City</div>
        <div style="font:600 14px/1 'Barlow Condensed',sans-serif;letter-spacing:.6em;color:#7ff3ff;text-shadow:0 0 10px #2fe6ff">SINGAPORE</div>
        <div id="vc-press" style="margin-top:38px;font:600 15px/1 'Barlow Condensed',sans-serif;letter-spacing:.35em;color:#fff;animation:vcpress 1.3s ease-in-out infinite">${isTouchFirst() ? 'TAP TO START' : 'PRESS ANY KEY'}</div>
        <div style="position:absolute;bottom:22px;font:12px 'Inter',sans-serif;color:#a99cc8;opacity:.8">Headphones recommended · Map data © OpenStreetMap contributors</div>
        <style>@keyframes vcpress{0%,100%{opacity:.25}50%{opacity:1}}</style>`;
      d.style.touchAction = 'manipulation';
      document.body.appendChild(d);
      // iOS only unlocks audio inside an "activation" event: touchend / pointerup / click / keydown — not
      // pointerdown or touchstart. The context is created right here, synchronously, and nothing is awaited before
      // the splash goes away (a resume() outside a gesture never settles on iOS, which used to freeze this screen).
      let done = false;
      const go = e => {
        if (done || (e.type === 'keydown' && ['Meta', 'Alt', 'Control', 'Shift'].includes(e.key))) return;
        done = true;
        if (e.type === 'keydown') e.preventDefault();
        removeEventListener('keydown', go, true); d.removeEventListener('pointerup', go); d.removeEventListener('click', go);
        // iOS sends its synthesized click after this pointerup, hit-tested anew: by then the title menu is under the
        // finger (START GAME sits right there), so eat that one click
        if (e.type === 'pointerup' && e.pointerType !== 'mouse') {
          const eat = ev => { ev.preventDefault(); ev.stopPropagation(); };
          addEventListener('click', eat, true); setTimeout(() => removeEventListener('click', eat, true), 500);
        }
        this.unlockAudio();
        d.style.transition = 'opacity .6s'; d.style.opacity = '0'; d.style.pointerEvents = 'none'; setTimeout(() => d.remove(), 650);
        resolve();
        this.initAudio().then(() => { if (this.state === 'title') this.audio?.music?.('title'); });
      };
      addEventListener('keydown', go, true); d.addEventListener('pointerup', go); d.addEventListener('click', go);
    });
  }

  /** create / resume the AudioContext synchronously inside a user gesture (see pressStart). Later gestures resume it
   * again if iOS suspended or interrupted it (a call, Siri, the app switcher). */
  unlockAudio() {
    try {
      if (!this._audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this._audioCtx = new AC({ latencyHint: 'interactive' });
        // a one-sample silent buffer started in the gesture is what flips older iOS versions to "running"
        const b = this._audioCtx.createBuffer(1, 1, 22050), src = this._audioCtx.createBufferSource();
        src.buffer = b; src.connect(this._audioCtx.destination); src.start(0);
      }
      if (this._audioCtx.state !== 'running') this._audioCtx.resume().catch(() => { });
    } catch (e) { console.warn('audio unlock failed', e); }
  }

  async start(mode) {
    this.ui.hideTitle();
    this.audio?.music?.('stop');
    // audio needs a user gesture: we are inside the click handler
    this.initAudio();
    if (!this.worldReady) {
      this.ui.showLoading(this.loadP || 0, this.loadLabel || 'Loading');
      this._showLoading = true;
      await this.loadPromise;
      this._showLoading = false;
    }
    this.ui.hideLoading();
    const save = mode === 'continue' || mode === 'auto' ? loadSave() : null;
    if (save && mode !== 'new') this.applySave(save);
    this.state = 'play';
    this.input.lock();
    // iOS's edge swipe goes back in history (out of the game): give it a same-page entry to pop instead
    if (!this._backGuard) { this._backGuard = true; try { history.pushState({ vc: 1 }, ''); addEventListener('popstate', () => { if (this.state !== 'play') return; history.pushState({ vc: 1 }, ''); if (!this.paused && !this.ui.map.isOpen) this.togglePause(); }); } catch { } }
    this.events.emit('gameStart', { mode, save });
    if (!this._loopStarted) this.loop();
    if (params.get('mission') != null) this.missions.startById(params.get('mission'));
    else if (params.has('freeroam')) { for (const m of this.missions.list.slice(0, +params.get('freeroam') || 0)) this.missions.done.push(m.id); this.missions.refreshGiver(); }
    else this.missions.onGameStart(mode, save);
  }

  initAudio() {
    return this._audioInit || (this._audioInit = this._initAudio());
  }
  async _initAudio() {
    if (this.audio) return;
    try {
      const mod = await import('./audio/index.js');
      this.audio = new mod.AudioSystem();
      await this.audio.init(this._audioCtx);
      this.applyVolumes();
      this.audio.radio.onChange = meta => { if (meta && this.player?.vehicle) this.ui.hud.flashRadio(meta.name, meta.color); else if (!meta) this.ui.hud.flashRadio('Radio Off', '#888'); };
      for (const v of this.vehicles) if (!v.engine && v.driver === 'player') v.engine = this.audio.createEngine({ type: v.spec.engineSound });
    } catch (e) { console.warn('audio unavailable', e); }
  }
  applyVolumes() {
    const s = this.settings;
    this.audio?.setVolumes?.({ master: s.masterVolume, music: s.radioVolume ?? s.musicVolume, sfx: s.sfxVolume, voice: s.sfxVolume });
  }

  progressCb(p, label) {
    this.loadP = p; this.loadLabel = label;
    if (this._showLoading) this.ui.showLoading(p, label);
  }

  /** ?memmarks[=ms]: pause the world load at each step so the iPhone harness (tests/mobile) can read the process
   * footprint step by step */
  mark(label) {
    performance.mark('vc:' + label); // load-step boundaries for tests/mobile/longtasks.mjs
    if (params.has('steptimes')) { const now = performance.now(); console.log(`step ${label}: ${Math.round(now - (this._markT ?? now))} ms`); this._markT = now; }
    // ?memhold=<step label>: pause 60 s at that step only
    const ms = params.get('memhold') === label ? 60000 : params.has('memmarks') ? +params.get('memmarks') || 2500 : 0;
    if (!ms) return null;
    window.__memMark = label;
    return new Promise(r => setTimeout(r, ms));
  }

  async loadWorld() {
    const t0 = performance.now();
    // hand the main thread back between load steps: taps on the splash / title / loading screen are answered within
    // one step instead of after the whole load (several seconds on a phone)
    const brk = nextTask;
    await this.mark('start');
    // a real task boundary first: until now the load ran on in boot()'s task (awaiting a non-promise only queues a
    // microtask), so the splash could neither paint nor take its first tap until the first fetch
    await brk();
    const prog = (p, l) => this.progressCb(p, l);
    prog(0.01, 'Booting physics (WebAssembly)');
    this.physics = new Physics();
    const physP = this.physics.init();
    this.sky = new SkySystem(this.R.renderer, this.scene);
    this.sky.sky.layers.enable(REFLECT_LAYER);
    this.sky.time = this.time;
    this.applyQuality();
    this.water = new Water({ reflections: this.R.q.reflections });
    this.scene.add(this.water.mesh);
    this.R.onResize = (w, h) => this.water.resize(w, h);
    this.R.onShed = shed => this.water.setReflections(shed ? false : this.R.q.reflections); // (dynamic resolution's last resort)
    this.R.resize();
    await brk(); // (the city's materials paint their sign and interior atlases)
    this.city = new City(this.scene);
    this.water.city = this.city; // cheap facade stand-ins in the reflection pass
    const data = await this.city.load(prog);
    await this.mark('city data + mask');
    // landmarks first: they tell the city builder which OSM buildings to skip
    prog(0.08, 'Sculpting Marina Bay Sands');
    let landmarks = null;
    try {
      const mod = await import('./world/landmarks/index.js');
      landmarks = await mod.createLandmarks({ THREE, city: data, renderer: this.R.renderer, quality: this.R.q === QUALITY.low ? 'low' : this.R.q === QUALITY.medium ? 'medium' : 'high', isWater: (x, z) => this.city.waterEdge(x, z) > 0, facade: this.city.mats.walls });
      this.scene.add(landmarks.group);
      gpuOnly(landmarks.group); // (colliders were built from it already)
      for (const o of landmarks.reflective || []) o.traverse(m => m.layers.enable(REFLECT_LAYER));
    } catch (e) { console.warn('landmarks failed', e); }
    this.landmarks = landmarks;
    await this.mark('landmarks');
    const clearings = (landmarks?.clearings || []).map(({ x, z, r }) => ({ x, z, r })); // (no street furniture on a landmark's plaza)
    const stats = await this.city.build({ exclusions: landmarks?.exclusions || [], clearings, paint: landmarks?.paint || [], facades: landmarks?.facades, placed: landmarks?.furniture, onProgress: (p, l) => prog(0.1 + p * 0.6, l) });
    console.log('city', JSON.stringify(stats));
    await this.mark('city built (worker gone)');
    await physP;
    prog(0.72, 'Solidifying concrete');
    await this.physics.addGround(this.city, brk);
    await brk();
    for (let i = 0; i < this.city.physChunks.length; i++) { const c = this.city.physChunks[i]; this.physics.addTrimesh(c.vertices, c.indices); if (i % 60 === 59) await brk(); }
    this.city.physChunks = []; // Rapier keeps its own copy in WASM memory
    for (let i = 0; i < this.city.occlChunks.length; i++) { const c = this.city.occlChunks[i]; this.physics.addSightBlocker(c.vertices, c.indices); if (i % 60 === 59) await brk(); }
    this.city.occlChunks = [];
    for (const c of landmarks?.colliders || []) this.physics.addStatic(c);
    this.physics.beforeWorldStep = h => { for (const v of this.vehicles) v.physicsStep(h); };
    this.physics.onPostStep(() => { for (const v of this.vehicles) v.pose?.capture(); });
    this.physics.noInterp = params.has('nointerp'); // A/B: draw raw physics poses
    this.physics.world.step(); // build the query BVH so load-time raycasts (helipads, ramps, cutscene framing) see the city
    await this.mark('physics');
    prog(0.78, 'Planting 60,000 trees');
    await nextTask();
    { const t0 = performance.now(); this.roadnet = new RoadNet(this.city); console.log('roadnet', Math.round(performance.now() - t0) + 'ms'); }
    // no trees standing in a traffic lane (some generated/OSM trees sit on the carriageway — now that trunks are solid
    // they'd be invisible roadblocks for the AI and a wall for the player)
    {
      // ...nor on a landmark's plaza (the Merlion's granite promontory was a grove that hid the statue)
      const T = this.city.trees, keep = [], t0 = performance.now(), clear = this.landmarks?.clearings || [];
      const onPlaza = (x, z) => clear.some(c => (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r && (!c.inside || c.inside(x, z)));
      for (let i = 0; i < T.length; i += 5) {
        if (onPlaza(T[i], T[i + 1])) continue;
        const n = this.roadnet.nearestLane(T[i], T[i + 1], 6, l => l.cls <= 7); if (!n || n.dist > 1.9) for (let k = 0; k < 5; k++) keep.push(T[i + k]);
        if (i % 50000 === 49995) await brk();
      }
      console.log('trees off the road:', (T.length - keep.length) / 5, Math.round(performance.now() - t0) + 'ms');
      this.city.trees = new Float32Array(keep);
    }
    await this.mark('roadnet');
    await brk();
    await brk();
    this.veg = new Vegetation(this.scene, this.city.trees, { treeDist: this.R.q.treeDist, city: this.city });
    await this.veg.ready;
    this.veg.nearDist = this.R.q.treeNear || 230;
    this.treeColliders = new TreeColliders(this, this.veg);
    await this.mark('vegetation');
    prog(0.84, 'Painting lane markings');
    await brk();
    this.props = new Props(this);
    await this.mark('props');
    await brk();
    this.streetProps = new StreetProps(this);
    await this.mark('streetProps');
    await brk();
    this.streetDetail = new StreetDetail(this);
    await this.streetDetail.ready;
    await this.mark('streetDetail');
    this.streetFurniture = new StreetFurniture(this);
    this.nightGlow = new NightGlow(this);
    await this.nightGlow.ready;
    await this.mark('nightGlow');
    await brk();
    this.safe = new SafeSpots(this);
    await this.mark('safe spots');
    // far-field sun shadows + street-canyon sky occlusion from a top-down height map of the static city
    if (!params.has('nohf')) {
      const t0 = performance.now(), M = this.city.meta;
      this.city.update({ position: new THREE.Vector3((M.xmin + M.xmax) / 2, 0, (M.zmin + M.zmax) / 2) }, 1e9);
      this.heightField = bakeHeightField(this.R.renderer, this.scene, [this.city.group, this.landmarks?.group].filter(Boolean), { xmin: M.xmin - 600, xmax: M.xmax + 600, zmin: M.zmin - 450, zmax: M.zmax + 450 });
      console.log('heightField', this.heightField.w + 'x' + this.heightField.h, Math.round(performance.now() - t0) + 'ms');
    }
    await this.mark('heightfield');
    prog(0.88, 'Hiring taxi uncles');
    this.cameraRig = new CameraRig(this, this.camera);
    this.cameraRig.sensitivity = this.settings.mouseSensitivity ?? 1;
    this.cameraRig.invertY = !!this.settings.invertY;
    this.player = new Player(this, { position: SAFEHOUSE.pos.clone(), facing: SAFEHOUSE.facing });
    this.player.teleport(SAFEHOUSE.pos, SAFEHOUSE.facing);
    await brk();
    this.traffic = new Traffic(this, this.R.q === QUALITY.low ? { target: 90, radius: 270, farFrom: 110, parked: { max: 24, radius: 130 } } : { target: 160, radius: 270, farFrom: 220, parked: { max: 60, radius: 200 } });
    await brk();
    this.peds = new Pedestrians(this, { max: this.R.q === QUALITY.low ? 80 : 150 });
    this.wanted = new Wanted(this);
    this.weather = new Weather(this);
    await this.mark('player, traffic, peds');
    if (params.get('rain')) this.weather.force(parseFloat(params.get('rain')));
    prog(0.93, 'Writing pitch decks');
    await brk();
    await this.ui.radar.setMapAsync(data, null, { data: this.city.mask, w: this.city.maskW, h: this.city.maskH });
    await this.mark('radar map');
    await brk();
    this.missions = new Missions(this);
    this.extras = new Extras(this);
    this.fx = new FX(this);
    this.juice = new Juice(this);
    await this.mark('missions, extras, fx');
    await brk();
    this.spawns = new Spawns(this);
    await this.spawns.spawnAll(brk);
    this.boats = new Boats(this);
    await this.mark('spawns, boats');
    await brk();
    this.cheats = new Cheats(this);
    this.stunts = new Stunts(this);
    await brk();
    this.taxi = new Taxi(this);
    this.activities = new Activities(this);
    this.photo = new PhotoMode(this);
    this.services = new Services(this);
    await this.mark('cheats … services');
    await brk();
    this.ambient = new Ambient(this);
    await this.mark('ambient');
    await brk();
    this.autopilot = new Autopilot(this);
    this.claudia = new Claudia(this);
    this.scenes = new Scenes(this);
    this.hype = new Hype(this);
    this.fines = new FineCity(this);
    this.dragRace = new DragRace(this);
    this.cityTalk = new CityTalk(this);
    this.clips = new BystanderClips(this);
    this.simScale = 1;
    this.wireEvents();
    await this.mark('missions & systems');
    await this.warmUp(prog);
    await this.mark('warm-up done');
    this.worldReady = true;
    prog(1, 'Ready');
    console.log('world ready in', Math.round(performance.now() - t0), 'ms; texture sources released', JSON.stringify(releasedTextureStats()));
    if (params.get('pos')) { const v = params.get('pos').split(',').map(Number); this.player.teleport(new THREE.Vector3(v[0], 0, v[1]), v[2] || 0); }
  }

  // Pay every one-off cost behind the title/loading screen instead of in the first seconds of play:
  // lazily-built vehicle meshes, the environment map, shader programs (compiled in parallel via
  // KHR_parallel_shader_compile, with the FINAL env/fog/light setup so play never recompiles), GPU uploads
  // of every geometry/instance buffer, and one full frame through shadows, reflections and all post passes.
  async warmUp(prog) {
    // lights also light the water reflection: otherwise the reflected city has no sun (darker than the real one),
    // every lit material needs a second 0-light program, and the light state flips between the reflection and main
    // passes (shadow depth programs are keyed on it -> recompiles whenever water comes into view)
    this.scene.traverse(o => { if (o.isLight) o.layers.enable(REFLECT_LAYER); });
    const R = this.R.renderer, scene = this.scene, cam = this.camera;
    const breathe = nextTask;
    // everything static still waiting for its first upload goes GPU-only (gfx/geomrelease.js)
    gpuOnly(scene);
    let t0 = performance.now();
    const T = {};
    prog(0.95, 'Polishing the cars');
    const types = Object.entries(VEHICLE_SPECS).filter(([, v]) => !v.kind && v.aiWeight > 0).map(([k]) => k);
    // each type's atlas goes to the GPU straight away, which frees its canvas (gfx/texrelease.js) before the next
    // type paints one: building them all first used to hold ~350 MB of canvases at once
    for (const t of types) { try { this.traffic.renderer._type(t); R.initTexture(getTypeAssets(t, 'high').texture); } catch (e) { console.warn('prewarm', t, e); } await breathe(); }
    for (const t of ['heli_police']) { try { R.initTexture(getTypeAssets(t, 'high').texture); } catch { } }
    (1234.5).toLocaleString(); new Intl.NumberFormat().format(1);
    T.cars = performance.now() - t0; await this.mark('warm-up: vehicles'); t0 = performance.now();
    // final lighting state at the spawn point
    cam.position.copy(this.player.position).add(new THREE.Vector3(0, 3, 8)); cam.lookAt(this.player.position); cam.updateMatrixWorld();
    this.sky.update(0, this.player.position);
    this.R.updateSun(this.sky.sun, 0, cam);
    this.ui.radar.update?.({ x: this.player.position.x, z: this.player.position.z, heading: 0, blips: [] });
    T.env = performance.now() - t0; t0 = performance.now();
    prog(0.965, 'Compiling shaders');
    // transparent double-sided materials are drawn in two passes by three.js, flipping material.side and bumping
    // material.version twice per draw => a full program lookup every draw. One pass is plenty for glass/markers.
    scene.traverse(o => { for (const m of [].concat(o.material || [])) if (m.transparent && m.side === THREE.DoubleSide) m.forceSinglePass = true; });
    // everything visible while compiling + uploading (LODs, night-only props, hidden pools...)
    const hidden = [];
    scene.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    // compile while a render target is bound: play renders into the composer's (linear) targets, and the output
    // colour space is part of every program's key
    const rt = new THREE.WebGLRenderTarget(4, 4), prevRT = R.getRenderTarget();
    try {
      R.setRenderTarget(rt);
      if (R.compileAsync) await R.compileAsync(scene, cam); else R.compile(scene, cam);
      R.setRenderTarget(prevRT);
      T.compile = performance.now() - t0; await this.mark('warm-up: shaders'); t0 = performance.now();
      prog(0.98, 'Uploading the city to the GPU');
      // geometry upload: tiny render target + top-down ortho camera covering the map, objects fed through layer 31 in batches
      const objs = [];
      scene.traverse(o => { if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && o.material) objs.push(o); });
      const box = new THREE.Box3().setFromObject(this.city.group || scene);
      const ortho = new THREE.OrthographicCamera(box.min.x - 50, box.max.x + 50, box.max.z + 50, box.min.z - 50, 1, 6000);
      ortho.position.set(0, 3000, 0); ortho.up.set(0, 0, -1); ortho.lookAt(0, 0, 0); ortho.updateMatrixWorld();
      ortho.top = -(box.min.z - 50); ortho.bottom = -(box.max.z + 50); ortho.updateProjectionMatrix();
      ortho.layers.set(31);
      // the lights ride along on layer 31: without them this pass compiled a 0-light twin of every program (~80
      // programs that play never uses — each a translated shader + Metal pipeline, ~0.6 MB on iOS)
      const lights = []; scene.traverse(o => { if (o.isLight && !o.layers.isEnabled(31)) { lights.push(o); o.layers.enable(31); } });
      const fc = [], shadowAuto = R.shadowMap.autoUpdate; R.shadowMap.autoUpdate = false;
      for (let i = 0; i < objs.length; i += 400) {
        const batch = objs.slice(i, i + 400);
        for (const o of batch) { o.layers.enable(31); if (o.frustumCulled) { o.frustumCulled = false; fc.push(o); } }
        // with the sun along, these programs sample its shadow map: render it once (first batch only — cheap) so its
        // depth texture exists; WebKit rejects every draw that samples a never-rendered shadow map
        if (i === 0) R.shadowMap.needsUpdate = true;
        R.setRenderTarget(rt); R.render(scene, ortho);
        for (const o of batch) o.layers.disable(31);
        await breathe();
      }
      for (const o of fc) o.frustumCulled = true;
      for (const l of lights) l.layers.disable(31);
      R.setRenderTarget(prevRT); R.shadowMap.autoUpdate = shadowAuto;
      rt.dispose();
      T.upload = performance.now() - t0; await this.mark('warm-up: GPU upload'); t0 = performance.now();
    } finally { for (const o of hidden) o.visible = false; }
    // one real frame with every optional post pass on, so their programs exist before they are first toggled
    // ...and with every shadow caster unculled and empty instance pools given one instance, so each depth-material
    // variant (alpha-tested leaves, the crowd's skinned depth shader, ...) is compiled now rather than on first sight
    const P = this.R, passes = [P.godPass, P.vibePass].filter(Boolean), was = passes.map(p => p.enabled);
    for (const p of passes) p.enabled = true;
    this.city.update(cam, this.drawDist); this.veg?.update(0, cam, true);
    // (casters that are hidden right now — LOD'd landmarks, Tommy, empty pools — and their hidden parents included;
    // batched meshes skip per-instance culling; the sun casts even if warm-up happens at night)
    const touched = [], shown = new Set();
    scene.traverse(o => {
      if (!o.castShadow || !(o.isMesh || o.isPoints)) return;
      touched.push([o, o.frustumCulled, o.isInstancedMesh ? o.count : -1, o.isBatchedMesh ? o.perObjectFrustumCulled : null]);
      o.frustumCulled = false; if (o.isInstancedMesh && o.count === 0) o.count = 1;
      if (o.isBatchedMesh) o.perObjectFrustumCulled = false;
      for (let a = o; a; a = a.parent) if (!a.visible) { a.visible = true; shown.add(a); }
    });
    const sun = this.sky.dir, sunCast = sun.castShadow, sunI = sun.intensity;
    sun.castShadow = true; sun.intensity = Math.max(sunI, 0.1); R.shadowMap.needsUpdate = true;
    // twice: three builds shadow-depth programs with the light state left by the PREVIOUS render of this scene, and
    // in the title-screen flow this is the very first one (0 lights -> every depth program recompiled in play)
    for (let i = 0; i < 2; i++) { this.water.renderReflection(R, scene, cam); R.shadowMap.needsUpdate = true; P.render(1 / 60); }
    for (const [o, fc, n, poc] of touched) { o.frustumCulled = fc; if (n >= 0) o.count = n; if (poc !== null) o.perObjectFrustumCulled = poc; }
    for (const a of shown) a.visible = false;
    sun.castShadow = sunCast; sun.intensity = sunI;
    passes.forEach((p, i) => { p.enabled = was[i]; });
    T.frame = performance.now() - t0; t0 = performance.now();
    // a program's first use queries its uniform locations (and, with checkShaderErrors, its link/compile logs — a
    // synchronous wait on the driver): do that for every program now instead of on the first frames of play
    for (const p of R.info.programs) p.getUniforms();
    console.log('warmUp', JSON.stringify(Object.fromEntries(Object.entries(T).map(([k, v]) => [k, Math.round(v)]))), 'programs', R.info.programs?.length);
  }

  applyQuality() {
    const q = this.R.q;
    setAtlasGpuScale(q === QUALITY.low ? 0.5 : 1); // vehicle liveries: phones never sample the top mip
    this.sky?.setShadowQuality(q.shadows, q.shadowRadius);
    this.R.renderer.shadowMap.enabled = this.settings.shadows !== false;
    if (this.water) this.water.setReflections(q.reflections);
    if (this.veg) { this.veg.treeDist = q.treeDist; this.veg.nearDist = q.treeNear || 230; this.veg.lastPos.set(1e9, 0, 0); }
    this.drawDist = this.settings.drawDistance ? Math.max(q.drawDist * 0.5, Math.min(q.drawDist, this.settings.drawDistance * 2)) : q.drawDist;
  }

  wireEvents() {
    const ev = this.events;
    ev.on('playerDied', r => this.playerDown(r || 'died'));
    ev.on('playerBusted', () => this.playerArrested());
    ev.on('enterVehicle', v => {
      if (this.player.controlsEnabled) this.driveHint(); // (a cutscene that seats Tommy gives it once he has the wheel)
      this.ui.hud.flashVehicle(v.spec.name); const st = this.audio?.radio; if (st && st.current < 0 && !v.isBike) st.setStation(Math.floor(Math.random() * Math.min(5, st.stations.length))); });
    ev.on('exitVehicle', () => { });
    ev.on('vehicleImpact', ({ vehicle, damage }) => { if (vehicle === this.player.vehicle) { this.cameraRig.shake(Math.min(1, damage / 60)); if (damage > 140 && !vehicle.isAircraft) this.player.damage((damage - 140) * 0.03, 'crash'); } });
    ev.on('carjack', () => this.progress.stats.carjacks++);
    ev.on('pedHit', () => this.progress.stats.peds++);
  }

  /** the driving controls, once per session, the first time Tommy has the wheel */
  driveHint(delay = 1200) {
    if (this._toldDriving) return;
    this._toldDriving = true;
    setTimeout(() => this.ui.hint('<b>W/S</b> drive & brake, <b>A/D</b> steer, <b>Space</b> handbrake. <b>Q/E</b> change radio station, <b>V</b> camera, <b>F</b> get out.',
      this.settings.autoGas ? 'Steer with your <b>left thumb</b>: auto-gas drives. <b>BRAKE</b> stops and reverses.' : 'Hold <b>GAS</b> to drive, <b>BRAKE</b> to stop, steer with your <b>left thumb</b>.', 9000), delay);
    // (touch tips are one line each: the radio one follows)
    if (this.touch?.on) setTimeout(() => this.ui.hint(null, 'Tap the <b>station name</b> up top to change the radio.', 5000), delay + 6000);
  }

  async playerDown(reason) {
    if (this.player.state === 'dead') return;
    this.player.state = 'dead';
    this.player.setAnim('knocked');
    this.audio?.sfx?.('wasted');
    this.events.emit('missionAbort', 'wasted');
    const wasIn = this.player.vehicle; if (wasIn) this.player.exitVehicle(true);
    this.player.state = 'dead';
    await this.ui.wasted();
    this.money = Math.max(0, this.money - 2000);
    this.wanted.clear();
    this.respawn(HOSPITAL, 0);
  }
  async playerArrested() {
    if (this.player.state === 'dead') return;
    this.player.state = 'dead';
    this.audio?.sfx?.('busted');
    this.events.emit('missionAbort', 'busted');
    if (this.player.vehicle) this.player.exitVehicle(true);
    this.player.state = 'dead';
    await this.ui.busted();
    this.money = Math.max(0, this.money - 500);
    this.progress.stats.fines += 500;
    this.wanted.clear();
    this.respawn(POLICE_HQ, Math.PI / 2);
  }
  /** Every long-distance move of the player goes through here. Lands on a clear spot (outside buildings, courtyards,
   * colliders and water — unless the target is deliberately elevated, e.g. the SkyPark), drops activity state tied
   * to the old place, and resets the per-position history that would otherwise smear across the jump. */
  relocate(pos, facing, { exact = false, pad, faceOpen = false } = {}) {
    const P = this.player;
    // a boat can't be carried onto dry land: step out first (aircraft keep their own landing logic)
    if (!exact && pos.y < 1 && P.vehicle?.isBoat && !this.city.isWater(pos.x, pos.z)) P.exitVehicle(true);
    const v = P.vehicle;
    let dest = pos;
    if (!exact && pos.y < 1 && !(v && (v.isBoat || v.isAircraft))) {
      dest = this.safe.find(pos, { vehicle: v || false, yaw: facing ?? P.facing, pad });
      if (!dest) { this.ui.toast('No safe place to arrive there.'); return P.position.clone(); }
    }
    if (faceOpen) { // look down the longest clear line of sight instead of into a wall
      let best = -1;
      for (let a = 0; a < 12; a++) {
        const yaw = a / 12 * Math.PI * 2, hit = this.physics.raycast({ x: dest.x, y: 1.6, z: dest.z }, { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) }, 60);
        const d = hit ? hit.toi : 60; if (d > best + 0.5) { best = d; facing = yaw; }
      }
    }
    this.stunts?.cancel?.();
    if (P.autopilot) this.autopilot.disengage();
    P.teleport(dest, facing);
    if (v) { v.speed = v.forwardSpeed = 0; v.sync(0); P.syncSeat(); }
    P.vel?.set(0, 0, 0); P.speed = 0; P.vy = 0;
    this.traffic.recenter = 1.2; this.traffic.spawnTimer = 0;
    this.peds.recenter = 1.2; this.peds.spawnT = 0;
    if (this.props) this.props.poolT = 0;
    this._lastPos?.copy(dest); this._zoneT = 0; this._routeFrom = null;
    if (this.R.autoExposure) this.R.autoExposure.adaptMat.uniforms.reset.value = 1;
    this.relocations = (this.relocations || 0) + 1;
    return dest;
  }

  respawn(pos, facing) {
    this.player.state = 'foot';
    this.player.health = this.player.maxHealth;
    this.relocate(pos, facing, { faceOpen: true });
    this.player.setAnim('idle');
    this.ui.fade(false, 800);
  }

  togglePause() {
    if (this.paused) return this.resume();
    this.paused = true;
    this.input.unlock();
    this.audio?.update?.(0, { paused: true, inVehicle: !!this.player.vehicle, listenerPos: this.camera.position, listenerFwd: new THREE.Vector3(0, 0, -1) });
    this.ui.pause.open({
      onResume: () => this.resume(),
      onQuit: () => location.reload(),
      settings: this.settings,
      stats: this.statsList(),
      map: { x: this.player.position.x, z: this.player.position.z, blips: this.allBlips() },
      secrets: CHEATS.map(c => ({ name: this.cheats.found.has(c.code) ? `${c.code} — ${c.name}` : c.name, desc: c.desc, found: this.cheats.found.has(c.code), hint: 'Type a code while playing. Vice City veterans know a few.' })),
      onSettingsChange: (k, v, all) => this.onSettingsChange(k, v, all),
      actions: this.touch?.on ? this.touch.menuActions() : null,
    });
  }
  resume() { this.ui.pause.close(); this.paused = false; this.input.lock(); }
  allBlips() { return this.missions.blips().concat(this.spawns.blips(), this.taxi.blips(), this.activities.blips(), this.services.blips(), this.ambient.blips(), this.missions.active ? [] : this.stunts.blips()); }
  openMap() {
    this.input.unlock();
    this.paused = true;
    this.ui.map.open({ x: this.player.position.x, z: this.player.position.z, heading: this.cameraRig.yaw, playerHeading: this.player.facing, blips: this.allBlips(), onClose: () => { this.paused = false; this.input.lock(); }, onWaypoint: (x, z) => this.setWaypoint(x, z) });
  }
  setWaypoint(x, z) {
    this.waypoint = x == null ? null : { x, z };
    this.routeTo(this.waypoint);
  }
  routeTo(t, refresh = false) {
    if (!t) { this.ui.radar.setRoute(null); this.routeTarget = null; return; }
    this._routeT = 0;
    const p = this.player.position;
    // periodic refresh: only re-plan once the player has actually moved (A* over 15k lanes is several ms)
    if (refresh && t === this.routeTarget && this._routeFrom && Math.hypot(p.x - this._routeFrom.x, p.z - this._routeFrom.z) < 25) return;
    this.routeTarget = t; this._routeFrom = { x: p.x, z: p.z };
    const r = this.roadnet.route(p.x, p.z, t.x, t.z);
    this.ui.radar.setRoute(r);
  }
  statsList() {
    const s = this.progress.stats;
    return [
      ['Missions passed', `${this.progress.missionsDone.length} / ${this.missions.list.length}`],
      ['Money', `S$${Math.round(this.money).toLocaleString()}`],
      ['Kaya toasts found', `${this.progress.kaya.length} / ${this.extras?.kayaTotal || 0}`],
      ['Distance travelled', `${(s.distance / 1000).toFixed(1)} km`],
      ['Cars "borrowed"', s.carjacks],
      ['Pedestrians bumped', s.peds],
      ['ERP paid', `S$${s.erp.toFixed(2)}`],
      ['Fines paid', `S$${s.fines}`],
    ];
  }
  onSettingsChange(k, v, all) {
    Object.assign(this.settings, all || { [k]: v });
    saveSettings(this.settings);
    this.ui.applySettings(this.settings);
    if (k === 'quality') { this.R.setQuality(v); this.R.applyQualityToPost(); this.applyQuality(); }
    if (k === 'resolutionScale') this.R.setResolutionPreference(v);
    if (k === 'shadows' || k === 'drawDistance') this.applyQuality();
    if (k === 'bloom') this.R.bloom.blendMode.opacity.value = v ? 1 : 0;
    if (k === 'mouseSensitivity') this.cameraRig.sensitivity = v;
    if (k === 'invertY') this.cameraRig.invertY = v;
    if (/Volume/.test(k)) this.applyVolumes();
    if (k === 'showFps') this.statsEl.style.display = v ? 'block' : 'none';
  }

  save() {
    this.progress.state = this.missions.state;
    writeSave({ v: 1, money: this.money, progress: this.progress, time: this.sky.time, pos: [this.player.position.x, this.player.position.z] });
  }
  applySave(s) {
    this.money = s.money || 0;
    this.progress = { ...this.progress, ...s.progress, stats: { ...this.progress.stats, ...(s.progress?.stats || {}) } };
    if (s.time != null) this.sky.time = s.time;
  }
  // debug helpers (console / tests)
  debugCar(type = 'infernus', enter = true) {
    const p = this.player.position; const n = this.roadnet.nearestLane(p.x, p.z, 200, l => l.cls <= 5);
    const pos = n ? n.pos : p.clone(); const yaw = n ? Math.atan2(-n.dir.x, -n.dir.z) : 0;
    const v = new Vehicle(this, type, { position: pos, yaw }); this.vehicles.push(v);
    if (enter) { this.player.teleport(pos, yaw); this.player.enterVehicleImmediate(v); this.cameraRig.yaw = yaw; }
    return v;
  }
  // list scene objects along the camera ray towards a world point (debug)
  debugPick(x, y, z) {
    const rc = new THREE.Raycaster(); const to = new THREE.Vector3(x, y, z);
    rc.set(this.camera.position, to.clone().sub(this.camera.position).normalize()); rc.far = this.camera.position.distanceTo(to) + 2;
    return rc.intersectObjects(this.scene.children, true).slice(0, 6).map(h => `${h.object.type}:${h.object.name || h.object.parent?.name || '?'} d=${h.distance.toFixed(2)} mat=${h.object.material?.type}`);
  }
  debugRide(kind = 'heli') {
    const slot = this.spawns.slots.find(s => s.type === kind && s.v);
    if (!slot) return 'no slot';
    const v = slot.v; this.player.teleport(v.position.clone(), v.yaw()); this.player.enterVehicleImmediate(v); this.cameraRig.yaw = v.yaw();
    return 'ok';
  }
  debugTp(x, z, facing = 0) { this.player.teleport(new THREE.Vector3(x, 0, z), facing); }

  addMoney(n) { this.money = Math.max(0, this.money + n); if (n > 0) this.audio?.sfx?.('money'); }

  // ---------------------------------------------------------------- main loop
  loop() {
    this._loopStarted = true;
    // Ticks are paced to a 60 Hz deadline: on 120/144 Hz displays the in-between callbacks are skipped (an M1/M2 GPU
    // can't draw this city at 120, and a steady 60 looks smoother than an uneven 70-90). Each 60 Hz slot that passes
    // without a tick counts as missed — that, not the frame-time average, drives dynamic resolution.
    let STEP = 1000 / 60;
    let due = NaN, rawPrev = 0, rawN = 0;
    const raw = new Float32Array(31);
    const frame = now => {
      requestAnimationFrame(frame);
      // raw callback cadence: iOS Low Power Mode caps rAF at 30 Hz (see Renderer.trackFrame); back to 60 slots as soon
      // as the callbacks come at 60 again
      if (rawPrev && now - rawPrev < 250) { raw[rawN++ % 31] = now - rawPrev; if (rawN % 31 === 0) { const s = Array.from(raw).sort((a, b) => a - b); this.R.rafMs = s[15]; if (this.R.slotMs && this.R.rafMs < 22) this.R.slotMs = null; } }
      rawPrev = now;
      STEP = this.R.slotMs || 1000 / 60;
      if (!Number.isFinite(due) || now - this._last > 250) { due = now; this._last = now - STEP; this.R.resetFrameStats?.(); }
      if (now + 1.5 < due) return; // early callback on a high-refresh display
      const missed = Math.max(0, Math.floor((now - due + 1.5) / STEP));
      due = Math.max(due + (missed + 1) * STEP, now + STEP * 0.5);
      const dtMs = Math.min(100, now - this._last); this._last = now;
      const dt = dtMs / 1000;
      const t0 = performance.now();
      try { this.tick(dt); } catch (e) { console.error(e); }
      this.R.trackFrame({ missed, cpuMs: performance.now() - t0, eligible: this.worldReady && this.state === 'play' && !this.paused && !this.mgPaused && !document.hidden });
      this.input.endFrame();
      this.fpsAcc = (this.fpsAcc || 0) + dtMs; this.fpsN = (this.fpsN || 0) + 1;
      if (this.fpsAcc > 500) {
        this.fps = 1000 * this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0;
        if (this.settings.showFps || params.has('stats')) { const inf = this.R.renderer.info; this.statsEl.textContent = `${this.fps.toFixed(0)} fps  ${inf.render.calls} calls  ${(inf.render.triangles / 1e6).toFixed(2)}M tris  res×${this.R.dynScale.toFixed(2)}${this.R.gpuMs ? `  gpu ${this.R.gpuMs.toFixed(1)}ms` : ''}`; }
        else this.statsEl.textContent = '';
      }
    };
    requestAnimationFrame(frame);
  }

  tick(dt) {
    U.time.value += dt;
    this.touch?.update();
    if (this.state === 'title' || this.state === 'boot' && !this._showLoading) return; // opaque title/splash: no 3D needed
    if (!this.worldReady) {
      // the loading screen is opaque: drawing the half-built city under it only slowed the load (and taps on it)
      if (this._showLoading) return;
      // title backdrop: slow orbit over the bay while loading
      const t = U.time.value * 0.03;
      this.camera.position.set(700 + Math.cos(t) * 500, 120, 300 + Math.sin(t) * 500);
      this.camera.lookAt(1250, 60, 380);
      if (this.sky) { this.sky.update(dt, this.camera.position); this.R.renderer.toneMappingExposure = this.sky.exposure; this.R.renderer.info.reset(); this.R.render(dt); }
      return;
    }
    const playing = this.state === 'play' && !this.paused;
    const simDt = playing ? dt * (this.simScale || 1) : 0;
    if (playing) {
      this.sky.time = (this.sky.time + dt * this.timeScale * (this.missions.timeFrozen ? 0 : 1)) % 24;
      this.player.update(simDt, this.input);
      this.treeColliders?.update(simDt);
      this.physics.step(simDt);
      for (const v of this.vehicles) v.sync(simDt);
      this.player.syncSeat();
      this.traffic.update(simDt);
      this.peds.update(simDt);
      this.wanted.update(simDt);
      this.missions.update(simDt);
      this.extras.update(simDt);
      this.weather.update(simDt);
      this.spawns.update(simDt);
      this.boats.update(simDt);
      this.cheats.update(simDt);
      this.stunts.update(simDt);
      this.taxi.update(simDt);
      this.activities.update(simDt);
      this.services.update(simDt);
      this.ambient.update(simDt);
      this.scenes.update(simDt);
      this.hype.update(simDt);
      this.fines.update(simDt);
      this.dragRace.update(simDt);
      this.cityTalk.update(simDt);
      this.updateVehicleFx(simDt);
      this.cleanupVehicles(simDt);
      this.juice.update(simDt, dt);
      this.fx.update(simDt);
      // distance stat
      if (this._lastPos) this.progress.stats.distance += Math.min(50, this._lastPos.distanceTo(this.player.position)); else this._lastPos = new THREE.Vector3();
      this._lastPos.copy(this.player.position);
    }
    if (this.photo?.on) this.photo.update(dt);
    if (this.state === 'play') this.cameraRig.update(dt, this.paused ? { mouse: { dx: 0, dy: 0 }, hit: () => false, down: () => false, gamepad: () => null } : this.input);
    // environment
    U.rain.value = this.weather?.rain ?? 0;
    U.wet.value += ((this.weather?.rain > 0.05 ? 1 : 0) - U.wet.value) * Math.min(1, dt * (U.wet.value < (this.weather?.rain ?? 0) ? 0.25 : 0.02));
    U.cameraPos.value.copy(this.camera.position);
    this.sky.rain = U.rain.value;
    const focus = this.player ? this.player.position : this.camera.position;
    this.sky.update(dt, focus, this.camera);
    if (this.R.autoExposure) { this.R.autoExposure.base = this.sky.exposure; this.R.exposureFx.uniforms.get('uOn').value = params.has('noae') ? 0 : 1; }
    this.R.renderer.toneMappingExposure = this.sky.exposure;
    this.R.updateSun(this.sky.sun, U.rain.value, this.camera);
    this.city.update(this.camera, this.drawDist);
    this.veg?.update(dt, this.camera);
    this.props?.update(dt);
    this.streetProps?.update(dt);
    this.streetDetail?.update(dt);
    this.streetFurniture?.update();
    this.nightGlow?.update();
    this.landmarks?.update?.(dt, { time: this.sky.time, night: U.night.value, rain: U.rain.value, camera: this.camera, playerPos: focus, flyerSpeed: this.flyerSpeed || 1, forceShow: this.showcase });
    this.updateAudio(dt);
    this.updateHud(dt);
    // minigames cover the screen: keep the GPU idle except for an occasional refresh
    if (this.mgPaused) { this._mgT = (this._mgT || 0) + dt; if (this._mgT < 0.5) return; this._mgT = 0; }
    this.R.renderer.info.reset(); // counts include the reflection pass
    this.R.taa.carry(this.player.vehicle?.root ?? null); // (temporal AA reprojects it through its own two poses)
    // one scene-graph matrix update per frame (each renderer.render() would otherwise walk the whole city again)
    this.scene.updateMatrixWorld();
    this.scene.matrixWorldAutoUpdate = false;
    this.R.gpuBegin();
    try {
      this.water.renderReflection(this.R.renderer, this.scene, this.camera);
      this.R.render(dt);
      this.clips.render(); // (a bystander's still, on the frame after a clip: world/bystander.js)
    } finally { this.scene.matrixWorldAutoUpdate = true; }
    this.R.gpuEnd();
  }

  // Singlish speech bubble + voice above a world position (text: a specific line; voice: the speaker's role)
  bark(kind, pos, cooldown = 2.5, { text: line, voice } = {}) {
    const now = performance.now();
    if (now - (this._barkT || 0) < cooldown * 1000) return;
    this._barkT = now;
    const LINES = {
      hit: ['Wah lau eh!', 'Siao ah, drive properly leh!', 'Aiyoh my char kway teow!', 'Oi! Got license or not?', 'You think this one Vice City is it?!', 'Walao, I call police ah!'],
      nearmiss: ['Eh eh eh!', 'Slow down lah!', 'Wah, Formula One ah?', 'Simi sai?!', 'Aiyoh, almost!'],
      carjacked: ['My COE!!', 'Oi! That one my car leh!', 'Walao, I just washed it!', 'Police! Polis!'],
      police: ['Stop the vehicle!', 'Sir, step out of the car!', 'You are under arrest, lah!'],
    };
    const list = LINES[kind] || LINES.hit;
    const text = line || list[Math.floor(Math.random() * list.length)];
    const v = pos.clone().setY(pos.y + 2.1).project(this.camera);
    if (v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1) this.ui.bark?.(text, (v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight);
    this.audio?.bark?.(kind, { position: pos, text, voice });
  }

  updateVehicleFx(dt) {
    const V = this._fxV || (this._fxV = { p: new THREE.Vector3(), d: new THREE.Vector3(), vel: new THREE.Vector3() });
    for (const v of this.vehicles) {
      if (v.isBoat) { if (v.spray > 0.2 && Math.random() < v.spray) { const st = V.p.set(0, 0, v.spec.length * 0.45).applyQuaternion(v.quaternion).add(v.position); st.y = -1.2; this.fx.spray(st, V.d.set(0, 0, 1).applyQuaternion(v.quaternion), 1); } continue; }
      if (v.isAircraft || v.exploded) continue;
      const bike = v.isBike, scale = bike ? 0.55 : 1;
      if (v.skid > 0.45 && v.grounded && v.wheelPos) {
        for (const k of bike ? [2] : [2, 3]) { const w = v.wheelPos[k]; this.fx.skid(`${v.collider.handle}_${k}`, V.p.set(bike ? 0 : w[0], 0, w[1]).applyQuaternion(v.quaternion).add(v.position)); }
        // tyre smoke only for proper slides at speed; bikes smoke less (one small tyre)
        const amt = (v.skid - 0.45) / 0.55, rate = (bike ? 8 : 22) * amt;
        // (as many puffs as the frame's share of the rate: a slow phone frame doesn't thin the cloud into blobs)
        const puffs = v.speed > 7 ? Math.floor(dt * rate + Math.random()) : 0;
        if (puffs) { const lv = v.body.linvel(); V.vel.set(lv.x, 0, lv.z); }
        for (let k = 0; k < puffs; k++) {
          const w = v.wheelPos[bike ? 2 : (k + (Math.random() < 0.5 ? 0 : 1)) % 2 + 2];
          this.fx.tyreSmoke(V.p.set(bike ? 0 : w[0], 0.25, w[1] + (Math.random() - 0.5) * 0.5).applyQuaternion(v.quaternion).add(v.position), V.vel, amt, scale);
        }
      }
      // visible wear: paint darkens as the car takes damage
      if (v.model.setColor && v._paint == null) v._paint = v.model.color;
      const maxHp = v.maxHealth || 1000, hpF = v.health / maxHp;
      if (v._paint != null && v._lastHp !== Math.round(hpF * 20)) { v._lastHp = Math.round(hpF * 20); const c = new THREE.Color(v._paint).lerp(new THREE.Color(0x1a1714), THREE.MathUtils.clamp(1 - hpF, 0, 1) * 0.55); v.model.setColor(c); }
      if (hpF < 0.3) {
        // engine bay: under the bonnet for cars, the engine block (between the wheels, low) for bikes
        const eng = bike ? V.p.set(0, v.spec.height * 0.35, 0) : V.p.set(0, v.spec.height * 0.7, -v.spec.length * 0.35);
        eng.applyQuaternion(v.quaternion).add(v.position);
        if (Math.random() < dt * (hpF < 0.12 ? 22 : 7) * (bike ? 0.6 : 1)) this.fx.engineSmoke(eng, hpF < 0.12, scale);
      }
      if (v.health <= 0) {
        v.burnT = (v.burnT || 0) + dt;
        // fair warning, GTA-style: the engine burns for six seconds before it goes up
        if (!v.fireWarned && v === this.player.vehicle) { v.fireWarned = true; this.ui.hint('<b>She\'s on fire!</b> Get out — press <b>F</b> — and run.', '<b>She\'s on fire!</b> Tap <b>EXIT</b> and run.', 4000); this.audio?.sfx?.('wanted_up'); }
        if (v.burnT > 6) this.explodeVehicle(v);
      }
    }
  }
  // stolen-then-abandoned traffic cars (and wrecks) keep full physics + audio alive: drop them once far away
  cleanupVehicles(dt) {
    if ((this._vcT = (this._vcT || 0) + dt) < 1) return;
    this._vcT = 0;
    const P = this.player.position;
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (!v.transient || v === this.player.vehicle || v.driver) continue;
      if (Math.hypot(v.position.x - P.x, v.position.z - P.z) < 420) continue;
      this.vehicles.splice(i, 1); v.dispose();
    }
  }
  explodeVehicle(v) {
    v.exploded = true; v.health = -1;
    this.fx.explosion(v.position);
    this.audio?.sfx?.('explosion', { position: v.position });
    v.body.applyImpulse({ x: 0, y: v.spec.mass * 6, z: 0 }, true);
    v.body.applyTorqueImpulse({ x: v.spec.mass * (Math.random() - 0.5) * 3, y: 0, z: v.spec.mass * (Math.random() - 0.5) * 3 }, true);
    v.model.setColor?.(0x161412);
    for (const c of this.traffic.cars) if (c.pos.distanceTo(v.position) < 8) this.traffic.wreck(c);
    // blast damage falls off with distance (55 at the car, nothing past 10 m); still inside = thrown out, badly hurt
    const P = this.player;
    if (P.vehicle === v) { P.exitVehicle(true); P.damage(95, 'exploded'); }
    else { const d = P.position.distanceTo(v.position); if (d < 10) P.damage(55 * (1 - THREE.MathUtils.smoothstep(d, 2, 10)), 'explosion'); }
    this.wanted.crime(1, 'Explosion', v.position);
    this.events.emit('explosion', v.position);
  }

  updateAudio(dt) {
    if (!this.audio) return;
    const st = this.landmarks?.pois?.find(p => p.id === 'supertrees');
    if (st && this.audio.setZoneMusic) {
      const t = this.sky.time, show = (t >= 19.75 && t < 20) || (t >= 20.75 && t < 21);
      const d = Math.hypot(this.player.position.x - st.x, this.player.position.z - st.z);
      const gain = show ? Math.max(0, 1 - Math.max(0, d - 80) / 260) : 0;
      if (gain > 0.01) { this.audio.setZoneMusic('garden_rhapsody', gain); this._zoneOn = true; }
      else if (this._zoneOn) { this.audio.setZoneMusic(null); this._zoneOn = false; }
    }
    const f = new THREE.Vector3(); this.camera.getWorldDirection(f);
    const p = this.player;
    const nearWater = this.city.isWater(p.position.x + 20, p.position.z) || this.city.isWater(p.position.x - 20, p.position.z) || this.city.isWater(p.position.x, p.position.z + 20) || this.city.isWater(p.position.x, p.position.z - 20) ? 1 : 0;
    this.audio.update(dt, { listenerPos: this.camera.position, listenerFwd: f, listenerUp: this.camera.up, time: this.sky.time, rain: U.rain.value, night: U.night.value, nearWater, inVehicle: !!p.vehicle, speed: p.speed, indoor: false, paused: this.paused || this.state !== 'play', menu: this.paused && !this.mgPaused });
  }

  updateHud(dt) {
    if (this.state !== 'play') return;
    const p = this.player;
    const air = p.vehicle?.isAircraft;
    this.ui.hud.update({ time: this.sky.time, money: Math.round(this.money), health: p.health, armor: p.armor, wanted: this.wanted.stars, wantedFlash: this.wanted.searching, inVehicle: !!p.vehicle, speedKmh: p.vehicle ? Math.round((air ? p.vehicle.speed : Math.abs(p.vehicle.forwardSpeed)) * 3.6) : 0, vehicleName: p.vehicle?.spec.name, valuation: this.missions.valuation || undefined, users: this.missions.users || undefined,
      weaponIcon: p.vehicle ? 'phone' : (this.progress.missionsDone.includes('vibe_coding') ? 'laptop' : 'fist'),
      altitude: air ? Math.round(p.vehicle.position.y) : null, vspeed: air ? p.vehicle.body.linvel().y : 0, heading: air ? p.vehicle.yaw() : 0 });
    // zone names
    this._zoneT = (this._zoneT || 0) - dt;
    if (this._zoneT <= 0) {
      this._zoneT = 1;
      const z = districtAt(p.position.x, p.position.z);
      // (not while a cutscene hides the HUD: the district would be marked as seen and never shown)
      if (z && z !== this._zone && this.ui.hud.visible) { this._zone = z; this.ui.hud.flashZone(z); }
      if (!this.missions.active) this.ui.goal(this.missions.freeRoamGoal(p.position), true);
    }
    // radar
    // radar: mission-critical blips always; amenities only when close (the full map shows everything)
    // (amenity lists are rebuilt 5x a second, not every frame)
    this._amenT = (this._amenT || 0) - dt;
    if (this._amenT <= 0 || !this._amen) {
      this._amenT = 0.2;
      const dist = b => Math.hypot(b.x - p.position.x, b.z - p.position.z), near = b => dist(b) < 260;
      // the three nearest side activities always show (at the radar's rim when far): there's always something to do
      const acts = this.activities.blips().sort((a, b) => dist(a) - dist(b)).filter((b, i) => i < 3 || near(b));
      this._amen = [...this.spawns.blips(), ...this.services.blips(), ...this.ambient.blips(), ...(this.missions.active ? [] : this.stunts.blips())].filter(near).concat(acts);
    }
    const blips = this.missions.blips().concat(this.taxi.blips(), this._amen);
    for (const u of this.wanted.units) blips.push({ x: u.v.position.x, z: u.v.position.z, type: 'police' });
    this.ui.radar.update({ x: p.position.x, z: p.position.z, y: p.position.y, heading: this.cameraRig.yaw, playerHeading: p.facing, blips, zoom: p.vehicle ? 150 + Math.min(200, p.speed * 5) : 110 });
    // GPS route refresh
    if (this.routeTarget && !this.paused) { this._routeT += dt; if (this._routeT > 3) this.routeTo(this.routeTarget, true); }
    // interaction prompt
    let prompt = null;
    this._nearVehicle = !p.vehicle && p.state === 'foot' && p.controlsEnabled ? p.nearestEnterable(4) : null;
    if (this._nearVehicle) { const k = this.touch?.on ? `Tap <kbd>${p.swimming ? 'BOARD' : 'ENTER'}</kbd>` : 'Press F'; prompt = this._nearVehicle.kind === 'traffic' ? `${k} to ${this._nearVehicle.car.state === 'parked' ? 'steal' : 'jack'} this car` : `${k} to ${p.swimming ? 'climb aboard' : 'enter vehicle'}`; }
    if (this.missions.prompt) prompt = this.missions.prompt;
    if (prompt !== this._prompt) { this._prompt = prompt; this.ui.interactPrompt(prompt); }
  }
}
