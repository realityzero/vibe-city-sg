// Street-level look-dev: node tests/scratch/streets.mjs [prefix] [views]
// Views are picked from the road graph (arterials, a CBD junction) plus fixed spots.
import { chromium } from '../lib/browser.mjs';
const [prefix = '/tmp/st', only] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.evaluate(() => { const g = __game; g.ui.hud.setVisible(false); g.missions.giver?.m.group && (g.missions.giver.m.group.visible = false); g.traffic.enabled = true; });
const VIEWS = {
  // Raffles Place / Chulia St junction, eye level
  cbd_junction: { t: 11, cam: [20, 1.7, 360], look: [70, 2, 320] },
  cbd_junction_dusk: { t: 19.2, cam: [20, 1.7, 360], look: [70, 2, 320] },
  // aerial-ish view onto a junction for markings
  junction_top: { t: 13, cam: [40, 24, 380], look: [70, 0, 320] },
  // Chinatown South Bridge Rd kerb / pavement close-up
  pavement: { t: 10.5, cam: [-405, 1.6, 416], look: [-398, 0, 400] },
  arterial: { t: 15, arterial: true },
  bridge: { t: 16.5, bridge: 0 },
  bridge2: { t: 9.5, bridge: 3 },
  bridge_night: { t: 21, bridge: 0 },
  zebra: { t: 12, zebra: 0 },
  zebra_night: { t: 20.5, zebra: 0 },
  namesign: { t: 11, sign: 0 },
  night_aerial: { t: 21.5, cam: [700, 150, 760], look: [120, 0, 380] },
  raffles_mid: { t: 10, cam: [110, 1.7, 420], look: [60, 0, 330] },
  arterial_rain: { t: 16, arterial: true, rain: 1 },
  // close-ups for grain (1-3 m)
  asphalt_close: { t: 11, arterial: true, close: 'road' },
  pavers_close: { t: 11, cam: [-405, 1.4, 416], look: [-403.5, 0, 413] },
  grass_close: { t: 11, grass: true },
  linkway_mrt: { t: 11, linkway: 'subway_entrance', i: 0 },
  linkway_mrt2: { t: 16, linkway: 'subway_entrance', i: 5 },
  linkway_bus: { t: 11, linkway: 'bus', i: 3 },
  linkway_night: { t: 21, linkway: 'subway_entrance', i: 0 },
  linkway_top: { t: 11, linkway: 'subway_entrance', i: 0, top: true },
  linkway_top2: { t: 11, linkway: 'subway_entrance', i: 7, top: true },
  linkway_low: { t: 11, linkway: 'subway_entrance', i: 7, low: true },
  buslane: { t: 11, bus: 0 },
  buslane2: { t: 15, bus: 3 },
  bustext_top: { t: 12, cam: [1045, 9, 707], look: [1045, 0, 703] },
  buslane_text: { t: 11, bus: 0, full: true, s: 14 },
  buslane_text2: { t: 16, bus: 2, full: false, s: 124 },
  buslane_red: { t: 11, bus: 0, full: true },
  buslane_top: { t: 11, bus: 0, full: true, top: true, noveg: true },
  buslane_top2: { t: 11, bus: 1, full: false, top: true, noveg: true },
  signal: { t: 11, signal: 0 },
  signal2: { t: 16, signal: 6 },
  signal_night: { t: 21, signal: 0 },
  signal_close: { t: 11, signal: 6, close: 'sig' },
  dirsign: { t: 11, dir: 0 },
  dirsign2: { t: 15, dir: 4 },
  dirsign_night: { t: 21, dir: 0 },
  lamps_night: { t: 21.5, lampview: 40 },
  lamps_night2: { t: 21.5, lampview: 400 },
  lamps_night2_rain: { t: 21.5, lampview: 400, rain: 1 },
  lamps_night_rain: { t: 21.5, lampview: 40, rain: 1 },
  linkway_top_nv: { t: 11, linkway: 'subway_entrance', i: 0, top: true, noveg: true },
  linkway_top2_nv: { t: 11, linkway: 'subway_entrance', i: 7, top: true, noveg: true },
  linkway_top3_nv: { t: 11, linkway: 'bus', i: 3, top: true, noveg: true },
};
for (const [name, v] of Object.entries(VIEWS)) {
  if (only && !only.split(',').includes(name)) continue;
  const info = await page.evaluate(v => {
    const g = __game; const V = g.camera.position.constructor;
    g.sky.time = v.t; g.timeScale = 0; g.weather.force(v.rain || 0); g.U.wet.value = v.rain ? 1 : 0;
    let cam = v.cam, look = v.look;
    if (v.arterial) {
      // widest 2-way road near the city centre
      const e = g.roadnet.edges.filter(e => e.c <= 2 && !e.y && e.lf >= 2 && e.lb >= 2).map(e => ({ e, d: Math.hypot(e.p[0] - 300, e.p[1] - 0) })).sort((a, b) => a.d - b.d)[0].e;
      const n = e.p.length / 2, i = Math.floor(n / 2);
      const x = e.p[i * 2], z = e.p[i * 2 + 1], x1 = e.p[i * 2 + 2] ?? e.p[i * 2 - 2], z1 = e.p[i * 2 + 3] ?? e.p[i * 2 - 1];
      const dx = x1 - x, dz = z1 - z, l = Math.hypot(dx, dz), rx = -dz / l, rz = dx / l;
      cam = [x + rx * (e.hw + 3) - dx / l * 25, 1.7, z + rz * (e.hw + 3) - dz / l * 25]; look = [x + dx / l * 40, 1, z + dz / l * 40];
      window.__art = { name: e.n, x, z };
    }
    const SD = g.streetDetail;
    if (v.close === 'road') { const [x, , z] = look; const lx = cam[0], lz = cam[2]; const dx = x - lx, dz = z - lz, l = Math.hypot(dx, dz); const px = lx + dx / l * 30 - (dz / l) * 0, pz = lz + dz / l * 30; const e2 = g.roadnet.nearestLane(px, pz, 30); cam = [e2.pos.x, 1.5, e2.pos.z]; look = [e2.pos.x + e2.dir.x * 2.5, 0, e2.pos.z + e2.dir.z * 2.5]; }
    if (v.grass) { for (let r = 0; r < 900 && !window.__gr; r += 7) for (let a = 0; a < 6.28; a += 0.4) { const x = 150 + Math.cos(a) * r, z = 100 + Math.sin(a) * r; if (g.city.maskAt(x, z, 1) > 240 && g.city.maskAt(x, z, 2) < 50 && g.city.maskAt(x + 6, z, 1) > 240 && g.city.maskAt(x, z + 6, 1) > 240) { const T = g.city.trees; let ok = true; for (let i = 0; i < T.length; i += 5) if (Math.hypot(T[i] - x, T[i + 1] - z) < 9) { ok = false; break; } if (ok) { window.__gr = [x, z]; break; } } } const [x, z] = window.__gr; cam = [x, 1.7, z]; look = [x + 2.5, 0, z + 2]; window.__art = { grass: window.__gr }; }
    if (v.bus != null) {
      const B = SD.busLanes.filter(b => v.full == null || b.full === v.full).sort((a, b) => Math.hypot(a.l.path.p[0][0] - 150, a.l.path.p[0][2] - 300) - Math.hypot(b.l.path.p[0][0] - 150, b.l.path.p[0][2] - 300))[v.bus];
      const P = new V(), D = new V(); B.l.path.sample(v.s ?? Math.min(60, B.l.path.length * 0.3), P, D);
      cam = [P.x - D.x * 2 - D.z * 3.3, 1.5, P.z - D.z * 2 + D.x * 3.3]; look = [P.x + D.x * 30, 0.3, P.z + D.z * 30];
      if (v.top) { cam = [P.x + D.x * 10 + 12, 26, P.z + D.z * 10 + 12]; look = [P.x + D.x * 25, 0, P.z + D.z * 25]; }
      window.__art = { bus: [P.x, P.z], full: B.full, name: B.l.edge.n, n: SD.busLanes.length };
    }
    if (v.signal != null) {
      const T = g.props.tl.filter(t => t.lane.edge.hw >= 6).sort((a, b) => Math.hypot(a.x - 150, a.z - 350) - Math.hypot(b.x - 150, b.z - 350))[v.signal];
      const P = new V(), D = new V(); T.lane.path.sample(Math.max(0, T.lane.s1 - 28), P, D);
      T.lane.path.sample(Math.max(0, T.lane.s1 - 16), P, D);
      cam = [P.x + D.z * 1.5, 1.6, P.z - D.x * 1.5]; look = [T.x + D.x * 4 + (-D.z) * 4, 3.6, T.z + D.z * 4 + D.x * 4];
      if (v.close === 'sig') { cam = [T.x - D.x * 6 - D.z * 2.5, 2.4, T.z - D.z * 6 + D.x * 2.5]; look = [T.x, 3.0, T.z]; }
      window.__art = { signal: [T.x, T.z], name: T.lane.edge.n, hw: T.lane.edge.hw };
    }
    if (v.dir != null) {
      const it = SD.dirFaces.items.slice().sort((a, b) => Math.hypot(a.x - 200, a.z - 400) - Math.hypot(b.x - 200, b.z - 400))[v.dir];
      const m = new g.camera.matrix.constructor().fromArray(it.m); const f = new V(0, 0, 1).transformDirection(m);
      cam = [it.x + f.x * 22 + f.z * 3.5, 1.6, it.z + f.z * 22 - f.x * 3.5]; look = [it.x, 3.0, it.z];
      window.__art = { dir: [it.x, it.z] };
    }
    if (v.lampview != null) {
      const L = g.props.lamps.slice().sort((a, b) => Math.hypot(a.x - 150, a.z - 350) - Math.hypot(b.x - 150, b.z - 350))[v.lampview];
      const ln = g.roadnet.nearestLane(L.x, L.z, 40); const d = ln.dir;
      cam = [ln.pos.x - d.x * 30, 1.7, ln.pos.z - d.z * 30]; look = [ln.pos.x + d.x * 10, 0.5, ln.pos.z + d.z * 10];
      window.__art = { lamp: [L.x, L.z] };
    }
    if (v.linkway) {
      let pts = v.linkway === 'bus' ? (g.streetProps?.stops || []).map(s => [s.x, s.z]) : g.city.data.pois.filter(p => p.k === v.linkway).map(p => [p.x, p.z]);
      pts = pts.sort((a, b) => Math.hypot(a[0] - 200, a[1] - 300) - Math.hypot(b[0] - 200, b[1] - 300));
      const [x, z] = pts[v.i]; const sw = g.roadnet.nearestSidewalk(x, z, 30); const p = sw ? sw.pos : { x, z };
      const ln = g.roadnet.nearestLane(p.x, p.z, 40); const d = ln.dir;
      cam = [ln.pos.x - d.x * 14, 2.0, ln.pos.z - d.z * 14]; look = [p.x, 2.2, p.z];
      if (v.top) { cam = [p.x + 18, 34, p.z + 22]; look = [p.x, 0, p.z]; }
      if (v.low) { const tr = sw.toRoad || { x: 0, z: 0 }; cam = [p.x - d.x * 16 + tr.x * 1.5, 1.7, p.z - d.z * 16 + tr.z * 1.5]; look = [p.x, 2.0, p.z]; }
      window.__art = { linkway: [x, z] };
    }
    if (v.bridge != null && SD) {
      const b = SD.bridges[v.bridge % SD.bridges.length];
      const ln = g.roadnet.nearestLane(b.x, b.z, 40); const d = ln.dir;
      const e = ln.lane.edge, rx = -d.z, rz = d.x;
      cam = [b.x - d.x * 45 + rx * (e.hw + 2.5), 1.7, b.z - d.z * 45 + rz * (e.hw + 2.5)]; look = [b.x, 5, b.z];
      window.__art = { bridge: b };
    }
    if (v.zebra != null && SD) {
      const c = SD.crossings.filter(c => !c.signal)[v.zebra];
      const rx = -c.dir.z, rz = c.dir.x;
      cam = [c.mx - c.dir.x * 22 + rx * (c.edge.hw + 1.5), 1.6, c.mz - c.dir.z * 22 + rz * (c.edge.hw + 1.5)]; look = [c.mx, 0.5, c.mz];
      window.__art = { zebra: [c.mx, c.mz], name: c.edge.n };
    }
    if (v.sign != null && SD) {
      const it = SD.signPoles.items[Math.floor(SD.signPoles.items.length * 0.37)];
      cam = [it.x + 4, 2.2, it.z + 3]; look = [it.x, 2.6, it.z];
      window.__art = { sign: [it.x, it.z] };
    }
    if (v.noveg && !window.__vegHidden) { window.__vegHidden = true; const hide = [], seen = new Set(); const sc = (o, d) => { if (!o || typeof o !== 'object' || seen.has(o) || d > 3) return; seen.add(o); if (o.isObject3D) { hide.push(o); return; } if (ArrayBuffer.isView(o) || o.isMaterial || o.isBufferGeometry || o.isTexture) return; for (const k of Object.keys(o)) if (k !== 'scene' && k !== 'game') try { sc(o[k], d + 1); } catch { } }; sc(g.veg, 0); const u = g.veg.update.bind(g.veg); g.veg.update = (...a) => { u(...a); hide.forEach(o => o.visible = false); }; }
    g.player.teleport(new V(cam[0], 0, cam[2]), 0); g.player.root.visible = false;
    g.cameraRig.override = { position: new V(...cam), lookAt: new V(...look), snap: true, fov: 60 };
    g.sky.refreshEnv();
    return window.__art || null;
  }, v);
  await page.waitForTimeout(3000);
  const f = `${prefix}_${name}.png`;
  await page.screenshot({ path: f });
  console.log('shot', f, info ? JSON.stringify(info) : '', await page.evaluate(() => __game.fps.toFixed(0) + 'fps ' + __game.R.renderer.info.render.calls + ' calls'));
}
await browser.close();
