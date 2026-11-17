// Does WebKit's GPU process give memory back when WebGL textures / buffers are deleted? (clean page, no game)
import { launch, pagePids, footprintMB, webkitPurge } from '../mobile/lib.mjs';
const h = await launch('webkit');
await h.page.goto('http://127.0.0.1:4173/vc-blank.html', { waitUntil: 'commit' }).catch(() => {});
await h.page.setContent('<canvas id=c width=64 height=64></canvas>');
const pids = await pagePids(h);
await h.page.evaluate(() => { const gl = window.gl = document.getElementById('c').getContext('webgl2'); window.objs = []; gl.clearColor(0, 0, 0, 1); });
const read = async l => { await webkitPurge(1500); console.log(l.padEnd(32), 'GPU proc', Math.round(await footprintMB(pids.gpu)), ' page', Math.round(await footprintMB(pids.content))); };
const frame = () => h.page.evaluate(() => { gl.clear(gl.COLOR_BUFFER_BIT); gl.finish(); });
await read('empty context');
await h.page.evaluate(() => { for (let i = 0; i < 4; i++) { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 4096, 4096); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4096, 4096, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4096 * 4096 * 4).fill(7)); objs.push(t); } }); await frame();
await read('+4 textures 64 MB each (256)');
await h.page.evaluate(() => { for (const t of objs) gl.deleteTexture(t); objs.length = 0; }); await frame();
await read('textures deleted');
await h.page.evaluate(() => { for (let i = 0; i < 4; i++) { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(16 * 1048576).fill(1), gl.STATIC_DRAW); objs.push(b); } }); await frame();
await read('+4 buffers 64 MB each (256)');
await h.page.evaluate(() => { for (const b of objs) gl.deleteBuffer(b); objs.length = 0; }); await frame();
await read('buffers deleted');
// draw with a buffer (ANGLE may keep shadow copies for drawn/used buffers)
await h.page.evaluate(() => {
  const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, '#version 300 es\nin vec3 p; void main(){ gl_Position = vec4(p*0.0001, 1.0); gl_PointSize = 1.0; }'); gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, '#version 300 es\nprecision mediump float; out vec4 o; void main(){ o = vec4(1); }'); gl.compileShader(fs);
  const pr = window.pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr); gl.useProgram(pr);
  for (let i = 0; i < 4; i++) { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(16 * 1048576).fill(0.5), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.POINTS, 0, 1000); objs.push(b); }
}); await frame();
await read('+4 drawn buffers (256)');
await h.page.evaluate(() => { for (const b of objs) gl.deleteBuffer(b); objs.length = 0; }); await frame();
await read('drawn buffers deleted');
await h.browser.close();
