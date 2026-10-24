// Close-up tree captures: node tests/scratch/vegclose.mjs [prefix]
// Finds trees of each worker type near busy spots and frames them at noon / golden hour / night.
import { chromium } from '../lib/browser.mjs';
const [prefix = '/tmp/vegc'] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[error]', m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 400000 });
await page.waitForTimeout(1500);
await page.evaluate(() => { const g = __game; g.ui.hud.setVisible(false); g.missions.giver?.m.group && (g.missions.giver.m.group.visible = false); });
// views: [name, workerType, near point, time, camera offset from tree (dx,dy,dz), look offset]
const VIEWS = [
  ['rain_under', 0, [-392, 404], 12.5, [6, 1.7, 7], [0, 7, 0]],
  ['rain_side', 0, [-392, 404], 16.5, [22, 4, 18], [0, 6, 0]],
  ['rain_gold', 0, [200, 600], 18.3, [20, 3, 16], [0, 6, 0]],
  ['rain_night', 0, [-392, 404], 21.5, [16, 2, 12], [0, 6, 0]],
  ['angsana', 1, [100, 400], 11.5, [14, 2, 10], [0, 6, 0]],
  ['palm', 2, [700, 300], 15.5, [10, 2, 10], [0, 7, 0]],
  ['flame', 4, [-600, 700], 14.0, [12, 2, 9], [0, 6, 0]],
  ['street', 0, [-60, 1000], 10.5, [3, 1.7, 30], [0, 4, -40]],
];
const only = process.argv[3]?.split(',');
for (const [name, type, near, t, off, look] of VIEWS) {
  if (only && !only.includes(name)) continue;
  const info = await page.evaluate(([type, near, t, off, look]) => {
    const g = __game, V = g.camera.position.constructor, veg = g.veg;
    let best = -1, bd = 1e18;
    for (let i = 0; i < veg.count; i++) {
      if ((veg.wtypes || veg.types)[i] !== type) continue;
      const d = (veg.pos[i * 2] - near[0]) ** 2 + (veg.pos[i * 2 + 1] - near[1]) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    const x = veg.pos[best * 2], z = veg.pos[best * 2 + 1];
    g.sky.time = t; g.timeScale = 0; g.weather.force(0); g.U.wet.value = 0;
    const cam = new V(x + off[0], off[1], z + off[2]);
    g.player.teleport(new V(cam.x, 0, cam.z), 0); g.player.root.visible = false;
    g.cameraRig.override = { position: cam, lookAt: new V(x + look[0], look[1], z + look[2]), snap: true, fov: 60 };
    g.sky.refreshEnv();
    return { x: x.toFixed(0), z: z.toFixed(0), d: Math.sqrt(bd).toFixed(0) };
  }, [type, near, t, off, look]);
  await page.waitForTimeout(2200);
  const f = `${prefix}_${name}.png`;
  await page.screenshot({ path: f });
  console.log('shot', f, JSON.stringify(info), await page.evaluate(() => __game.fps.toFixed(0) + 'fps ' + __game.R.renderer.info.render.calls + ' calls ' + (__game.R.renderer.info.render.triangles / 1e6).toFixed(2) + 'M'));
}
await browser.close();
