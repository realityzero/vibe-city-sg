// Touch controls on an emulated phone (844x390 landscape, or WxH from argv; real CDP multi-touch): the controls show up, don't cover the
// radar/HUD, and the stick walks, a right-side drag looks, a pinch zooms, JUMP/PUNCH work, ENTER appears next to a car
// and gets in, GAS drives, EXIT gets out, the radar opens the map and its close button shuts it, II pauses, and
// portrait asks for landscape. Screenshots in /tmp/vc/touch_*.png.
import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const [VW, VH] = (process.argv[2] || '844x390').split('x').map(Number); // e.g. 1024x768 for a tablet
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
const cdp = await ctx.newCDPSession(page);
const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 4, radiusY: 4, force: 1 })) });
const frames = n => page.evaluate(n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const center = sel => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null; }, sel);
const tap = async (sel, id = 9) => { const c = await center(sel); if (!c) return false; await T('touchStart', [[...c, id]]); await frames(3); await T('touchEnd', []); await frames(2); return true; };
let fails = 0; const check = (name, ok, info = '') => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ': ' + info : ''}`); };

await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&q=low&t=11', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play' && __game.player.controlsEnabled && __game.input.enabled, null, { timeout: 120000 });
await page.waitForTimeout(1500);
const st = () => page.evaluate(() => { const g = __game, p = g.player; return { x: p.position.x, z: p.position.z, y: p.position.y, yaw: g.cameraRig.yaw, zoom: g.cameraRig.zoom, grounded: p.grounded, vy: p.vy, anim: p.anim, veh: p.vehicle?.type || null, speed: p.vehicle?.speed || 0, map: g.ui.map.isOpen, paused: g.paused, cls: document.querySelector('.vc-touch').className }; });
let s = await st();
check('touch mode on, controls shown', /play/.test(s.cls) && /ctl/.test(s.cls) && await page.evaluate(() => document.querySelector('.vc-root').classList.contains('vc-touchmode')), s.cls);

// nothing the thumbs use may sit on the radar, the top-right HUD, the speedo or the subtitles
const overlaps = await page.evaluate(() => {
  const R = sel => [...document.querySelectorAll(sel)].map(e => ({ sel, r: e.getBoundingClientRect() })).filter(o => o.r.width && getComputedStyle(o.r ? document.querySelector(sel) : document.body).display !== 'none');
  const ctl = [...R('.vc-touch .stick'), ...R('.vc-touch .btn'), ...R('.vc-touch .sys')];
  const hud = [...R('.vc-radar-wrap'), ...R('.vc-topright .vc-hud'), ...R('.vc-speedo'), ...R('.vc-bottom')];
  const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const out = [];
  for (const c of ctl) for (const h of hud) if (hit(c.r, h.r)) out.push(`${c.sel} x ${h.sel}`);
  return out;
});
check('controls clear of radar / HUD / subtitles', !overlaps.length, overlaps.join(', '));
await page.screenshot({ path: `/tmp/vc/touch_foot_${VW}.png` });

// stick: thumb down bottom-left, push up = walk forward
const p0 = await st();
await T('touchStart', [[130, 290, 1]]); await frames(2);
for (let k = 1; k <= 6; k++) { await T('touchMove', [[130, 290 - k * 12, 1]]); await frames(1); }
await page.waitForTimeout(1500);
const p1 = await st();
await T('touchEnd', []); await frames(3);
check('stick walks Tommy', Math.hypot(p1.x - p0.x, p1.z - p0.z) > 3, `moved ${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)} m`);

// look: one finger dragged on the right
s = await st();
await T('touchStart', [[560, 170, 2]]); for (let k = 1; k <= 8; k++) { await T('touchMove', [[560 + k * 15, 170, 2]]); await frames(1); } await T('touchEnd', []); await frames(3);
const s2 = await st();
check('drag looks around', Math.abs(s2.yaw - s.yaw) > 0.3, `yaw ${(s2.yaw - s.yaw).toFixed(2)} rad`);

// pinch: two fingers apart = zoom in (closer camera)
await T('touchStart', [[480, 180, 3], [600, 180, 4]]); await frames(2);
for (let k = 1; k <= 6; k++) { await T('touchMove', [[480 - k * 12, 180, 3], [600 + k * 12, 180, 4]]); await frames(1); }
await T('touchEnd', []); await frames(3);
const s3 = await st();
check('pinch zooms the camera', s3.zoom < s2.zoom - 0.1, `zoom ${s2.zoom.toFixed(2)} -> ${s3.zoom.toFixed(2)}`);

// JUMP, PUNCH
await tap('.vc-touch .b-jump'); const sj = await st();
check('JUMP', !sj.grounded || sj.vy > 0.5, `grounded ${sj.grounded} vy ${sj.vy.toFixed(1)}`);
await page.waitForTimeout(900);
await tap('.vc-touch .b-punch'); const sp = await st();
check('PUNCH', sp.anim === 'punch', `anim ${sp.anim}`);
await page.waitForTimeout(700);

// a car right in front: ENTER shows up and gets in; GAS drives; EXIT gets out
await page.evaluate(async () => {
  const g = __game, p = g.player, V = g.camera.position.constructor, { Vehicle } = await import('/src/entities/vehicle.js');
  const f = new V(-Math.sin(p.facing), 0, -Math.cos(p.facing));
  const v = new Vehicle(g, 'sedan', { position: p.position.clone().addScaledVector(f, 3.2).setY(0.6), yaw: p.facing + Math.PI / 2 }); g.vehicles.push(v);
});
await page.waitForTimeout(600);
s = await st();
check('ENTER button appears next to a car', /near/.test(s.cls) && !!(await center('.vc-touch .b-enter')), s.cls);
await tap('.vc-touch .b-enter'); await page.waitForTimeout(1300);
s = await st();
check('ENTER gets in', !!s.veh && /car/.test(await page.evaluate(() => document.querySelector('.vc-touch').dataset.mode)), `vehicle ${s.veh}`);
await page.screenshot({ path: `/tmp/vc/touch_car_${VW}.png` });
const g0 = await center('.vc-touch .b-gas');
await T('touchStart', [[...g0, 5]]); await page.waitForTimeout(2000); s = await st(); await T('touchEnd', []); await frames(2);
check('GAS drives', s.speed > 4, `speed ${s.speed.toFixed(1)} m/s`);
const b0 = await center('.vc-touch .b-brake');
await T('touchStart', [[...b0, 6]]); await page.waitForTimeout(2500); await T('touchEnd', []); await frames(2);
await tap('.vc-touch .b-exit'); await page.waitForTimeout(800);
s = await st();
check('EXIT gets out', !s.veh, `vehicle ${s.veh}`);

// radar = map; close button
await tap('.vc-radar-wrap'); await page.waitForTimeout(500);
const mapOpen = (await st()).map;
await page.screenshot({ path: `/tmp/vc/touch_map_${VW}.png` });
await tap('.vc-map-close'); await page.waitForTimeout(400);
check('radar opens the map, ✕ closes it', mapOpen && !(await st()).map);

// pause
await tap('.vc-touch .sys.pause'); await page.waitForTimeout(500);
s = await st();
check('II pauses (controls hidden)', s.paused && !/play/.test(s.cls), s.cls);
await page.evaluate(() => __game.resume()); await page.waitForTimeout(300);

// portrait
await page.setViewportSize({ width: VH, height: VW }); await page.waitForTimeout(500);
const rot = await page.evaluate(() => getComputedStyle(document.querySelector('.vc-touch .rotate')).display);
await page.screenshot({ path: `/tmp/vc/touch_portrait_${VW}.png` });
check('portrait asks for landscape', rot === 'flex', rot);
console.log(fails ? `${fails} FAILED` : 'all touch checks ok');
await browser.close();
