// hash every traffic vehicle type's geometry (all attributes + index) in two builds: proves geometry code changes
// are output-identical
import { launch } from '../mobile/lib.mjs';
const urls = process.argv.slice(2);
for (const u of urls) {
  const h = await launch('chromium', { exclusive: false });
  await h.page.goto(u + '?skipTitle&newgame&keepgeo', { waitUntil: 'load' });
  await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 240000 });
  const r = await h.page.evaluate(() => {
    const out = {};
    const hashArr = (a, hsh) => { if (!a) return hsh; const f = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < f.length; i++) hsh = Math.imul(hsh ^ f[i], 16777619) >>> 0; return hsh; };
    for (const [t, T] of __game.traffic.renderer.types) {
      const g = T.A.geometry; let hsh = 2166136261;
      for (const k of Object.keys(g.attributes).sort()) hsh = hashArr(g.attributes[k].array, hsh);
      hsh = hashArr(g.index?.array, hsh);
      out[t] = (hsh >>> 0).toString(16) + ':' + g.attributes.position.count;
    }
    return out;
  });
  console.log(u, JSON.stringify(r));
  await h.browser.close();
}
