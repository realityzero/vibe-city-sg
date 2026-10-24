// drive the perf.mjs route and report what the car hits when it stops
import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&fixedres', { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.waitForTimeout(1500);
await page.evaluate(() => { __game.debugTp(-60, 1000, 0); void __game.debugCar('infernus'); window.__log = []; });
await page.waitForTimeout(500);
await page.keyboard.down('KeyW');
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const g = __game, v = g.player.vehicle; if (!v) return { none: true };
    const P = g.physics, W = P.world, hits = [];
    W.contactPairsWith(v.collider, other => {
      const p = other.translation(), sh = other.shape, parent = other.parent();
      hits.push({ h: other.handle, type: sh?.type, pos: [p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1)], half: sh?.halfExtents ? [sh.halfExtents.x, sh.halfExtents.y, sh.halfExtents.z].map(x => x.toFixed(2)) : null, dyn: !!parent && parent.bodyType?.() });
    });
    const t = v.body.translation();
    const f = new g.camera.position.constructor(0, 0, -1).applyQuaternion(v.root.quaternion);
    const rays = [];
    for (const y of [0.3, 0.8, 1.4]) for (const side of [-0.9, 0, 0.9]) {
      const o = { x: t.x - f.z * side, y: t.y + y, z: t.z + f.x * side };
      const hit = W.castRayAndGetNormal(new P.R.Ray(o, { x: f.x, y: 0, z: f.z }), 6, true, undefined, 0xffffffff, v.collider);
      if (hit) { const c = hit.collider; rays.push(`${y}/${side}: ${hit.timeOfImpact.toFixed(2)}m type ${c.shape.type} grp ${(c.collisionGroups() >>> 16).toString(2)} n(${hit.normal.x.toFixed(2)},${hit.normal.y.toFixed(2)},${hit.normal.z.toFixed(2)}) at ${c.translation().x.toFixed(1)},${c.translation().z.toFixed(1)}`); }
    }
    const wh = [0, 1, 2, 3].map(i => v.vc.wheelIsInContact(i) ? 1 : 0).join('');
    return { rays, wh, susp: [0, 1, 2, 3].map(i => v.vc.wheelSuspensionLength(i)?.toFixed(2)).join(','), kmh: Math.round(v.speed * 3.6), pos: [t.x.toFixed(1), t.y.toFixed(2), t.z.toFixed(1)], hits };
  });
  console.log(JSON.stringify(r));
}
await page.keyboard.up('KeyW');
await page.screenshot({ path: '/tmp/str_blocked.png' });
await browser.close();
