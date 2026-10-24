// Every footbridge: are both stair flights and the ground beyond their foot free of walls (real colliders)?
import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=1&q=low', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
console.log(await page.evaluate(() => {
  const g = __game, P = g.physics, R = P.R, ball = new R.Ball(0.45), q = { x: 0, y: 0, z: 0, w: 1 };
  const hits = (x, y, z) => { let n = 0; P.world.intersectionsWithShape({ x, y, z }, q, ball, () => { n++; return false; }, undefined, 0xffff0001 >>> 0); return n > 0; };
  const out = [];
  for (const b of g.streetDetail.bridges) {
    const near = g.city.data.buildings.filter(B => B.n).map(B => { let x = 0, z = 0; for (let i = 0; i < B.p.length; i += 2) { x += B.p[i]; z += B.p[i + 1]; } return [B.n, Math.hypot(x / (B.p.length / 2) - b.x, z / (B.p.length / 2) - b.z)]; }).sort((a, c) => a[1] - c[1])[0];
    const st = b.stairs.map(s => `(${s[0].toFixed(0)},${s[1].toFixed(0)})`);
    // stair feet are the 'stair' entries at v = W2 + run; test the 4 m beyond each foot in both directions along the road
    const res = [];
    for (let k = 0; k < 2; k++) {
      const top = b.stairs[k * 2], foot = b.stairs[k * 2 + 1];
      const dx = foot[0] - top[0], dz = foot[1] - top[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, rx = -uz, rz = ux;
      let blockedExit = 0, blockedFlight = 0;
      for (let t = 1; t <= 5; t += 1) for (const s2 of [-0.8, 0, 0.8]) if (hits(foot[0] + ux * t + rx * s2, 1.0, foot[1] + uz * t + rz * s2)) blockedExit++;
      // under the flight, beside it (the stair itself is a collider: test 1.6 m to each side at shoulder height)
      for (let t = 1; t < L; t += 2) for (const s2 of [-1.8, 1.8]) if (hits(top[0] + ux * t + rx * s2, 1.6, top[1] + uz * t + rz * s2)) blockedFlight++;
      const exitSafe = g.safe.clear(foot[0] + ux * 3, foot[1] + uz * 3, { pad: 0.3 }) && g.safe.reachesSidewalk(foot[0] + ux * 3, foot[1] + uz * 3);
      res.push(`side${k}: exitBlocked ${blockedExit}/15 besideFlight ${blockedFlight} exitReachable ${exitSafe}`);
    }
    out.push(`bridge @(${b.x.toFixed(0)},${b.z.toFixed(0)}) near "${near?.[0]}" ${near?.[1].toFixed(0)}m | ${res.join(' | ')}`);
  }
  return out.join('\n');
}));
await browser.close();
