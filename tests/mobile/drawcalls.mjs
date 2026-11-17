// Draw calls per frame by object and pass (main / shadow / reflection / post) at phone settings, while driving.
//   node tests/mobile/drawcalls.mjs [x] [z] [--foot] [--url http://127.0.0.1:4173/]   (--foot: stay at the spawn on foot)
import { launch } from './lib.mjs';
const ai = process.argv.indexOf('--url'), URL0 = ai > 0 ? process.argv[ai + 1] : 'http://127.0.0.1:4173/';
const [x = '-60', z = '1000'] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--url');
const h = await launch('chromium', { exclusive: false });
await h.page.goto(URL0 + '?skipTitle&newgame&freeroam=8&q=low&fixedres', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
if (!process.argv.includes('--foot')) await h.page.evaluate(([x, z]) => { const g = __game; void g.debugTp(+x, +z, 0); void g.debugCar('infernus'); g.autopilot.engage({ x: 900, z: 250 }); }, [x, z]);
await h.page.waitForTimeout(6000);
const r = await h.page.evaluate(() => new Promise(res => {
  const R = __game.R.renderer, counts = new Map(); let frames = 0, pass = 'main';
  const orig = R.renderBufferDirect.bind(R);
  const name = o => { let n = o.name || ''; for (let a = o.parent; !n && a; a = a.parent) n = a.name; return (n || o.type).replace(/_-?\d+$/, '_*').replace(/^(vehicle|humanoid):.*/, '$1').slice(0, 28); };
  R.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
    const p = R.getRenderTarget() === null ? 'screen' : camera.isOrthographicCamera && material.isMeshDepthMaterial || material.type === 'MeshDepthMaterial' || material.type === 'MeshDistanceMaterial' ? 'shadow' : camera.isOrthographicCamera ? 'post/ortho' : 'main';
    let nm = name(object); if (nm === 'Mesh' || nm === 'InstancedMesh') nm += `[${material.type}${material.customProgramCacheKey?.().slice(0, 16) || ''} ${geometry.type} ${object.parent?.type}${object.parent?.parent?.type ? '<' + object.parent.parent.type : ''} ${object.layers.mask}]`;
    const k = `${p}|${nm}`; counts.set(k, (counts.get(k) || 0) + 1);
    return orig(camera, scene, geometry, material, object, group);
  };
  const loop = () => { if (++frames < 60) requestAnimationFrame(loop); else { R.renderBufferDirect = orig; res([...counts].map(([k, v]) => [k, v / 60]).sort((a, b) => b[1] - a[1])); } };
  requestAnimationFrame(loop);
}));
const byPass = {}; for (const [k, v] of r) { const p = k.split('|')[0]; byPass[p] = (byPass[p] || 0) + v; }
console.log('draws per frame by pass:', Object.entries(byPass).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' · '));
for (const [k, v] of r.slice(0, 30)) console.log(`${v.toFixed(1).padStart(6)}  ${k}`);
await h.browser.close();
