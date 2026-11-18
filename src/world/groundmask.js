// public/data/ground.png, decoded by hand. Its alpha channel holds each texel's distance to the edge of its ground class
// (tools/ground-sdf.mjs), and a 2D canvas (drawImage + getImageData) stores colour premultiplied by alpha: the R, G, B
// class codes the game queries would come back rounded. The PNG is inflated by the browser's DecompressionStream and
// unfiltered in place in that one buffer.

// alpha: signed distance (m) from a texel's centre to the edge of its own ground class, over +-GROUND_SMAX (written by
// tools/ground-sdf.mjs, SMAX there; the ground shader's GSMAX is the same)
export const GROUND_SMAX = 3;
export const groundEdgeDistance = a => (a / 255 - 0.5) * 2 * GROUND_SMAX;

export async function loadGroundMask(url) {
  const png = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const be32 = o => ((png[o] << 24) | (png[o + 1] << 16) | (png[o + 2] << 8) | png[o + 3]) >>> 0;
  let w = 0, h = 0; const idat = [];
  for (let o = 8; o + 8 <= png.length;) {
    const len = be32(o), type = String.fromCharCode(png[o + 4], png[o + 5], png[o + 6], png[o + 7]);
    if (type === 'IHDR') { w = be32(o + 8); h = be32(o + 12); if (png[o + 16] !== 8 || png[o + 17] !== 6 || png[o + 20]) throw new Error('ground.png: expected 8-bit RGBA, not interlaced'); }
    else if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const raw = new Uint8Array(await new Response(new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const S = w * 4, stride = S + 1;
  if (raw.length < stride * h) throw new Error('ground.png: truncated image data');
  for (let j = 0; j < h; j++) {
    const o = j * stride + 1, p = o - stride, f = raw[o - 1];
    if (f === 1) for (let i = 4; i < S; i++) raw[o + i] += raw[o + i - 4];
    else if (f === 2 && j) for (let i = 0; i < S; i++) raw[o + i] += raw[p + i];
    else if (f === 3) for (let i = 0; i < S; i++) raw[o + i] += ((i >= 4 ? raw[o + i - 4] : 0) + (j ? raw[p + i] : 0)) >> 1;
    else if (f === 4) for (let i = 0; i < S; i++) {
      const a = i >= 4 ? raw[o + i - 4] : 0, b = j ? raw[p + i] : 0, c = j && i >= 4 ? raw[p + i - 4] : 0;
      const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
      raw[o + i] += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
  }
  for (let j = 0; j < h; j++) raw.copyWithin(j * S, j * stride + 1, j * stride + 1 + S); // drop the filter bytes
  return { w, h, data: raw.subarray(0, S * h) };
}
