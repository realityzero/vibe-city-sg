// The bystander's clip: when the street films the player ('views' from Hype), now and then — always for a creator's
// set piece in Go Viral — the clip pops up as a vertical phone video (ui/spice.js makeClipCard) showing the moment
// from where one of them stood. One still per clip, rendered on the frame after the event: the scene through a
// phone-shaped camera at the filmer's eye into a small half-float target (180x320, ~1/4 of the phone's own frame),
// graded (their exposure, ACES, sRGB, a phone camera's punch) into an 8-bit one, and read back without a stall
// (readRenderTargetPixelsAsync: a pixel-pack buffer and a fence) into the card's canvas. The card animates the still
// in CSS (push-in, handheld sway, comments rising): nothing runs per frame. Everything is made at load and the grade
// program compiled then; the scene pass uses the programs the main render already has (a render target bound: linear
// output, no tone mapping — the same keys as the composer's).
import * as THREE from 'three';
import { U } from '../gfx/globals.js';
import { districtAt } from '../ui/districts.js';
import { makeClipCard } from '../ui/spice.js';

const W = 180, H = 320;        // px of the still (9:16)
const COOL = 30;               // s between two crowd clips getting a card (a creator's always does)
const CHANCE = 0.55;           // of a crowd clip getting one
const MIN_VIEWS = 8000;        // smaller clips don't make the feed
const _to = new THREE.Vector3(), _d = new THREE.Vector3(), _cp = new THREE.Vector3();

// who posts it, and what the comments say (Singlish; the last pool is any clip's)
const HANDLES = ['@kopi.kakis', '@ahma.drives', '@sgroads.kakis', '@shiok.sia', '@hdb.uncle', '@lepak.lah', '@chope.queen', '@makan.mafia', '@jiak.png', '@steady.bom'];
const COMMENTS = {
  nearmiss: ['walao so close!!', 'almost kena sia', 'my heart pain watching this', 'TP where are you', 'one more inch only'],
  drift: ['Tokyo drift? Tanjong drift!', 'tyres sibei pain', 'drift king of the CBD', 'liddat also can ah'],
  supercar: ['COE how much ah', 'confirm rich kid', 'can sit inside or not', 'photo first!!', 'this one need 2 COEs'],
  crash: ['aiyoh the insurance', 'walao eh', 'his car pengsan already', 'NCD gone liao'],
  stunt: ['wah can fly one!', 'send it!!', 'LTA: cars cannot fly', 'physics say no, he say yes'],
  explosion: ['siao liao', 'run first, film later', 'this one confirm on the news'],
  splash: ['my shoes!!', 'kena splash', 'walao my office pants', 'whole kerb become river'],
  hit: ['wah lau eh', 'call police lah', 'confirm kena saman'],
  any: ['walao', 'confirm kena saman', 'this one sure go viral', 'steady lah bro', 'only in SG', 'who is this guy', 'first!', 'ownself film ownself', 'shiok sia', 'sibei power'],
};
const pick = a => a[Math.floor(Math.random() * a.length)];

export class BystanderClips {
  constructor(game) {
    this.game = game;
    this.cam = new THREE.PerspectiveCamera(46, W / H, 0.25, 900);
    this.scene = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType });
    this.out = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false });
    this.grade = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: this.scene.texture }, tExposure: { value: null }, uExposure: { value: 1 }, uAuto: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tScene; uniform sampler2D tExposure; uniform float uExposure; uniform float uAuto; varying vec2 vUv;
        vec3 fit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
        void main() {
          vec3 c = texture2D(tScene, vec2(vUv.x, 1.0 - vUv.y)).rgb;   // (rows top-down: the readback fills an ImageData)
          float e = 0.85 * uExposure * (uAuto > 0.5 ? clamp(texture2D(tExposure, vec2(0.5)).r, 0.5, 3.0) : 1.0);
          c = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777) * (c * e / 0.6);
          c = clamp(mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602) * fit(c), 0.0, 1.0);
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = clamp(mix(vec3(l), c, 1.18), 0.0, 1.0); c = mix(c, c * c * (3.0 - 2.0 * c), 0.35); // a phone camera's punch
          c = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
          vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * 0.55;                         // and its lens falloff
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.grade);
    quad.frustumCulled = false;
    this.quad = new THREE.Scene().add(quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.px = new Uint8Array(W * H * 4);
    this.img = new ImageData(new Uint8ClampedArray(this.px.buffer), W, H);
    this.card = makeClipCard(game.ui, W, H);
    this.ctx2d = this.card.canvas.getContext('2d');
    this.job = null; this.busy = false; this.coolT = 0;
    this.hid = []; // beacons hidden for the still
    this.cost = 0; // ms of main-thread time the last still took (tests/scratch/clipcost.mjs)
    // the targets and the grade's program now, not when the first clip comes
    const R = game.R.renderer, prev = R.getRenderTarget();
    R.initRenderTarget(this.scene);
    R.setRenderTarget(this.out); R.render(this.quad, this.quadCam); R.setRenderTarget(prev);
    game.events.on('views', e => this.onClip(e));
  }

  /** a clip is out: queue a still of it if it makes the feed */
  onClip(e) {
    const g = this.game, now = performance.now() / 1000;
    if (this.job || this.busy || g.state !== 'play' || !g.ui.hud.visible || g.cameraRig.override) return;
    // (a crowd's clip only in free roam or a job about being filmed: a story mission's screen is busy enough)
    if (!e.by && (now < this.coolT || e.views < MIN_VIEWS || Math.random() > CHANCE || (g.missions.active && !g.missions.active.mission.filmable))) return;
    const eye = e.by ? this.creatorEye(e.by) : this.filmer();
    if (!eye) return;
    this.coolT = now + COOL;
    const kind = COMMENTS[e.kind] ? e.kind : 'crash', pool = [...COMMENTS[kind]], any = [...COMMENTS.any], comments = [];
    for (let i = 0; i < 3; i++) { const from = i === 1 || !pool.length ? any : pool; comments.push(from.splice(Math.floor(Math.random() * from.length), 1)[0]); }
    const p = e.pos || g.player.position;
    this.job = { eye, handle: e.handle || pick(HANDLES), tag: e.tag, where: districtAt(p.x, p.z) || 'Singapore', views: e.views, comments,
      likes: Math.round(e.views * (0.04 + Math.random() * 0.05)), roll: (Math.random() - 0.5) * 0.14 };
  }

  /** the eye of someone filming (a crowd person, or a set piece's { pos, hs }) */
  eyeOf(p, out = new THREE.Vector3()) { return out.set(p.pos.x, p.pos.y + 1.47 * (p.hs || 1), p.pos.z); }

  /** the person filming with the best view: 6-35 m off (~15 best), nothing solid and nobody between their phone and
   *  the player */
  filmer() {
    const g = this.game, P = g.player.position;
    let best = null, bd = Infinity;
    for (const p of g.peds.peds) {
      if (p.state !== 'film') continue;
      const d = Math.hypot(p.pos.x - P.x, p.pos.z - P.z);
      if (d < 6 || d > 35 || Math.abs(d - 15) >= bd) continue;
      const eye = this.eyeOf(p, _cp);
      if (!this.unblocked(eye, p)) continue;
      _to.set(P.x - eye.x, P.y + 0.8 - eye.y, P.z - eye.z); const L = _to.length();
      if (g.physics.raycast(eye, _to.multiplyScalar(1 / L), L - 2.5)) continue;
      best = p; bd = Math.abs(d - 15);
    }
    return best && this.eyeOf(best);
  }

  /** a creator's phone: at eye height, or held up overhead, or a step aside — whichever sees past the people around */
  creatorEye(by) {
    const P = this.game.player.position, eye = this.eyeOf(by);
    _d.set(P.z - eye.z, 0, eye.x - P.x).normalize(); // (sideways to the line of sight)
    for (const [up, side] of [[0, 0], [0.5, 0], [0, 0.9], [0, -0.9], [0.5, 1.6], [0.5, -1.6]]) {
      _cp.copy(eye).addScaledVector(_d, side); _cp.y += up;
      if (this.unblocked(_cp, by)) return eye.copy(_cp);
    }
    eye.y += 0.5; return eye;
  }

  /** nobody (but the filmer) and no tree trunk between a phone at `eye` and the player: people block each other's
   *  shots, and street trees (not in the physics world away from the player) block a lot of them */
  unblocked(eye, self) {
    const g = this.game, P = g.player.position, dx = P.x - eye.x, dz = P.z - eye.z, dy = P.y + 0.8 - eye.y, L2 = dx * dx + dz * dz || 1;
    for (let t = 0.08, step = 1.2 / Math.sqrt(L2); t < 0.85; t += step) if (g.treeColliders?.trunkNear(eye.x + dx * t, eye.z + dz * t, 0.5)) return false;
    for (const p of g.peds.peds) {
      if (p === self) continue;
      const t = ((p.pos.x - eye.x) * dx + (p.pos.z - eye.z) * dz) / L2;
      if (t < 0.02 || t > 0.9) continue;
      const ex = eye.x + dx * t - p.pos.x, ez = eye.z + dz * t - p.pos.z;
      if (ex * ex + ez * ez < 0.36 && eye.y + dy * t < p.pos.y + 1.8 * (p.hs || 1)) return false;
    }
    return true;
  }

  /** after the main render (Game.tick): the queued still, graded and on its way back from the GPU */
  render() {
    const job = this.job; if (!job) return;
    this.job = null; this.busy = true;
    const g = this.game, R = g.R.renderer, cam = this.cam, t0 = performance.now();
    const P = g.player, v = P.vehicle, aim = v ? _to.copy(v.position).setY(v.position.y + 0.7) : _to.copy(P.position).setY(P.position.y + 1);
    // the phone a hand's length in front of the face, aimed at the player, held a little crooked and zoomed in so
    // the subject fills about a third of the frame (phones zoom; a car 40 m off would be a speck)
    _d.subVectors(aim, job.eye).setY(0);
    const dist = _d.length(); _d.multiplyScalar(1 / (dist || 1));
    cam.position.copy(job.eye).addScaledVector(_d, 0.35);
    cam.fov = THREE.MathUtils.clamp(2 * Math.atan(6 / dist) * THREE.MathUtils.RAD2DEG, 14, 46); cam.updateProjectionMatrix();
    cam.lookAt(aim); cam.rotateZ(job.roll); cam.layers.mask = g.camera.layers.mask;
    cam.updateMatrixWorld();
    // the shadow map is this frame's; mission and activity beacons are HUD, not something a phone sees
    const sm = R.shadowMap, auto = sm.autoUpdate, needs = sm.needsUpdate, prev = R.getRenderTarget();
    sm.autoUpdate = false; sm.needsUpdate = false;
    const hid = this.hid; hid.length = 0;
    const hide = o => { if (o?.visible) { o.visible = false; hid.push(o); } };
    for (const h of g.missions.markers) hide(h.m.group);
    hide(g.missions.giver?.m.group);
    for (const a of g.activities.list) hide(a.m.group);
    _cp.copy(U.cameraPos.value); U.cameraPos.value.copy(cam.position);
    R.setRenderTarget(this.scene); R.clear(); R.render(g.scene, cam);
    U.cameraPos.value.copy(_cp);
    for (const o of hid) o.visible = true;
    const u = this.grade.uniforms, ae = g.R.autoExposure;
    u.uExposure.value = R.toneMappingExposure; u.tExposure.value = ae?.texture ?? null; u.uAuto.value = ae ? 1 : 0;
    R.setRenderTarget(this.out); R.render(this.quad, this.quadCam);
    R.setRenderTarget(prev);
    sm.autoUpdate = auto; sm.needsUpdate = needs;
    this.cost = performance.now() - t0;
    R.readRenderTargetPixelsAsync(this.out, 0, 0, W, H, this.px)
      .then(() => { this.ctx2d.putImageData(this.img, 0, 0); this.card(job); })
      .catch(e => console.warn('bystander clip', e))
      .finally(() => { this.busy = false; });
  }
}
