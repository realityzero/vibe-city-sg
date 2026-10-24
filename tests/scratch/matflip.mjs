// finds materials shared by objects that need different program variants (=> getProgram every draw)
import { chromium } from '../lib/browser.mjs';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (/warmUp/.test(m.text())) console.log(m.text()); });
await page.goto('http://127.0.0.1:5174/?skipTitle&newgame&freeroam=8&fixedres', { waitUntil: 'load' });
await page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 90000 });
await page.waitForTimeout(3000);
const r = await page.evaluate(() => {
  const g = __game, mats = new Map();
  g.scene.traverse(o => {
    if (!o.material) return;
    for (const m of [].concat(o.material)) {
      const ca = o.geometry?.attributes?.color;
      const key = `inst=${!!o.isInstancedMesh} icol=${!!o.instanceColor} skin=${!!o.isSkinnedMesh} valpha=${!!(m.vertexColors && ca && ca.itemSize === 4)} tan=${!!o.geometry?.attributes?.tangent} morph=${!!o.geometry?.morphAttributes?.position}`;
      if (!mats.has(m)) mats.set(m, new Map());
      const e = mats.get(m); e.set(key, (e.get(key) || 0) + 1);
      e.names = e.names || new Set(); if (e.names.size < 4) e.names.add(o.name || o.parent?.name || o.type);
    }
  });
  const out = [];
  for (const [m, e] of mats) if (e.size > 1) out.push(`${m.type} "${m.name}" ${[...e].map(([k, n]) => `${k} x${n}`).join(' | ')} objs=${[...e.names].join(',')}`);
  // per-frame version bumps
  const ver = new Map(); for (const m of mats.keys()) ver.set(m, m.version);
  return new Promise(res => setTimeout(() => { const bumped = []; for (const [m, v] of ver) if (m.version - v > 30) { const objs = []; g.scene.traverse(o => { if ([].concat(o.material || []).includes(m)) objs.push(`${o.type}:${o.name}<${o.parent?.type}:${o.parent?.name}<${o.parent?.parent?.type}:${o.parent?.parent?.name} geo=${o.geometry?.type} pos=${o.getWorldPosition(new o.position.constructor()).toArray().map(Math.round)} vis=${o.visible} ro=${o.renderOrder} blend=${m.blending} op=${m.opacity.toFixed(2)}`); }); bumped.push(`${m.type} "${m.name}" +${m.version - v} color=${m.color?.getHexString()} transparent=${m.transparent} ${objs.slice(0, 3).join(',')}`); } res({ out, bumped, n: mats.size }); }, 1000));
});
console.log('materials', r.n); console.log('MULTI-VARIANT:\n' + r.out.join('\n')); console.log('VERSION BUMPS/s:\n' + r.bumped.join('\n'));
await browser.close();
