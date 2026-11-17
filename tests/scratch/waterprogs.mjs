// Programs compiled after warm-up while the camera visits the water at phone settings (the lite reflection draws the
// city in shares over several frames: none of them may need a program the warm-up didn't build).
//   node tests/scratch/waterprogs.mjs [--url http://127.0.0.1:4173/] [--q low]
import { launch } from '../mobile/lib.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:4173/'), Q = arg('q', 'low');
const h = await launch('chromium', { exclusive: false });
for (const t of [12, 20.1, 21]) {
  await h.page.goto(`${URL0}?skipTitle&newgame&freeroam=8&t=${t}&q=${Q}&fixedres`, { waitUntil: 'load' });
  await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
  await h.page.waitForTimeout(2000);
  await h.page.evaluate(() => { window.__p0 = new Set(__game.R.renderer.info.programs); });
  for (const [pos, look] of [[[480, 40, 140], [900, 60, 300]], [[-520, 8, -300], [-460, 4, -380]], [[880, 25, 620], [1291, 90, 377]], [[720, 22, 120], [600, 6, 10]]]) {
    await h.page.evaluate(([pos, look]) => { const g = __game, V = g.camera.position.constructor; g.cameraRig.override = { position: new V(...pos), lookAt: new V(...look), snap: true, fov: 62 }; }, [pos, look]);
    await h.page.waitForTimeout(2500);
  }
  const r = await h.page.evaluate(() => __game.R.renderer.info.programs.filter(p => !__p0.has(p)).map(p => p.name + ' ' + p.cacheKey.slice(0, 60)));
  console.log(`t=${t}: ${r.length} new programs after warm-up`, r);
}
await h.browser.close();
