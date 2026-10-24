// lists shader programs compiled AFTER the warm-up (=> runtime hitches)
import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (/warmUp/.test(m.text())) console.log(m.text()); });
await page.goto('http://127.0.0.1:5174/' + (process.argv[2] || ''), { waitUntil: 'load' });
await page.waitForTimeout(1000); await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 120000 });
await page.evaluate(() => {
  window.__p0 = new Set(__game.R.renderer.info.programs);
  const r = __game.R.renderer; window.__who = [];
  let pass = 'main';
  const sm = r.shadowMap, so = sm.render.bind(sm); sm.render = (...a) => { pass = 'shadow'; try { return so(...a); } finally { pass = 'main'; } };
  const orig = r.renderBufferDirect.bind(r);
  r.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
    const n = r.info.programs.length; const res = orig(camera, scene, geometry, material, object, group);
    if (r.info.programs.length > n) { const chain = []; let o = object; while (o && chain.length < 4) { chain.push(o.name || o.type); o = o.parent; } __who.push(`${pass} ${material.type}:${material.name} inst=${!!object.isInstancedMesh} skinned=${!!object.isSkinnedMesh} batched=${!!object.isBatchedMesh} ${chain.join(' < ')}`); }
    return res;
  };
});
await page.keyboard.press('Enter');
await page.waitForFunction(() => __game.state === 'play', null, { timeout: 60000 });
await page.waitForTimeout(6000);
for (let i = 0; i < 14; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(300); }
await page.waitForTimeout(3000);
const r = await page.evaluate(() => {
  const old = [...__p0].map(p => p.cacheKey.split(','));
  return __game.R.renderer.info.programs.filter(p => !__p0.has(p)).map(p => {
    const k = p.cacheKey.split(',');
    let best = null, bd = 1e9;
    for (const o of old) { if (o.length !== k.length) continue; let d = 0; for (let i = 0; i < k.length; i++) if (o[i] !== k[i]) d++; if (d < bd) { bd = d; best = o; } }
    const diffs = best ? k.map((v, i) => v !== best[i] ? `[${i}] ${best[i].slice(0, 40)} -> ${v.slice(0, 40)}` : null).filter(Boolean) : ['no same-length match'];
    const users = []; __game.scene.traverse(o => { for (const m of [].concat(o.material || [])) { const pr = __game.R.renderer.properties.get(m); if (pr.currentProgram === p || pr.programs?.has?.(p.cacheKey)) users.push(`${o.type}:${o.name || o.parent?.name || ''} ${m.type}:${m.name} map=${!!m.map}`); } });
    return `${p.name} diff(${bd}): ${diffs.slice(0, 6).join(' ; ')} USERS: ${[...new Set(users)].slice(0, 4).join(' | ')}`;
  });
});
console.log('new programs after warm-up:', r.length); for (const l of r) console.log('  ', l);
console.log('who:', JSON.stringify(await page.evaluate(() => __who), null, 1));
await browser.close();
