// which draws fail WebGL validation in WebKit: check getError after every draw (slow; debugging only) and map the
// current program back to its three.js material
import { launch } from '../mobile/lib.mjs';
const h = await launch('webkit', { exclusive: false });
await h.page.addInitScript(() => {
  const P = WebGL2RenderingContext.prototype, bad = window.__bad = new Map();
  window.__glcheck = true;
  for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const o = P[fn];
    P[fn] = function (...a) {
      o.apply(this, a);
      if (!window.__glcheck) return;
      const e = this.getError();
      if (e) {
        const prog = this.getParameter(this.CURRENT_PROGRAM), g = window.__game;
        const p = g?.R?.renderer?.info?.programs?.find(p => p.program === prog);
        let k = `${fn} err ${e} ${p ? (p.cacheKey || '').split(',').slice(0, 2).join(',') : '?'} @${window.__memMark || g?.state}`;
        if (!bad.has(k)) {
          const n = this.getProgramParameter(prog, this.ACTIVE_UNIFORMS), info = [];
          for (let i = 0; i < n; i++) {
            const u = this.getActiveUniform(prog, i); if (![this.SAMPLER_2D, this.SAMPLER_2D_SHADOW, this.SAMPLER_CUBE, this.SAMPLER_2D_ARRAY, this.SAMPLER_3D].includes(u.type)) continue;
            const unit = this.getUniform(prog, this.getUniformLocation(prog, u.name)); this.activeTexture(this.TEXTURE0 + (Array.isArray(unit) ? unit[0] : unit));
            const tgt = u.type === this.SAMPLER_CUBE ? this.TEXTURE_CUBE_MAP : u.type === this.SAMPLER_2D_ARRAY ? this.TEXTURE_2D_ARRAY : u.type === this.SAMPLER_3D ? this.TEXTURE_3D : this.TEXTURE_2D;
            const cm = this.getTexParameter(tgt, this.TEXTURE_COMPARE_MODE);
            const shadowS = u.type === this.SAMPLER_2D_SHADOW;
            if (shadowS !== (cm === this.COMPARE_REF_TO_TEXTURE)) info.push(`${u.name}:${shadowS ? 'shadowSampler' : 'sampler'} unit ${unit} compare ${cm === this.COMPARE_REF_TO_TEXTURE ? 'ON' : 'off'}`);
          }
          k += ' | ' + (info.join('; ') || 'compare modes consistent');
        }
        bad.set(k, (bad.get(k) || 0) + 1);
      }
    };
  }
});
await h.page.goto(process.argv[2] || 'http://127.0.0.1:4173/?skipTitle&newgame&freeroam=8&q=low&memmarks=1', { waitUntil: 'load' });
await h.page.waitForFunction(() => window.__game?.worldReady && __game.state === 'play', null, { timeout: 300000 });
await h.page.waitForTimeout(5000);
console.log([...(await h.page.evaluate(() => [...window.__bad]))].map(([k, n]) => `${n}x ${k}`).join('\n') || 'no failing draws');
await h.browser.close();
