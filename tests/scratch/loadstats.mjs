// the world-build statistics a build prints while loading (tree culling, street detail counts, city stats...)
import { launch } from '../mobile/lib.mjs';
for (const u of process.argv.slice(2)) {
  const h = await launch('chromium', { exclusive: false });
  const lines = []; h.page.on('console', m => { const t = m.text(); if (/^(trees off|streetdetail|city |props|spawns|heightField|streetprops)/.test(t)) lines.push(t.replace(/\d+ms/g, '_ms').replace(/"ms":\d+,?/g, '').slice(0, 400)); });
  await h.page.goto(u + '?skipTitle&newgame', { waitUntil: 'load' });
  await h.page.waitForFunction(() => window.__game?.worldReady, null, { timeout: 240000 });
  console.log('==', u); for (const l of lines) console.log(l);
  await h.browser.close();
}
