// Character presets. A spec fully describes body, clothing and accessories for the hero builder.
//
// top.type: 'shirt' (button shirt), 'tee', 'singlet', 'polo', 'suit' (jacket over shirt), 'hoodie', 'blouse', 'uniform'
// top.sleeves: 'none' | 'short' | 'long';  top.tex: atlas cell name (pattern) or 'plain'/'knit'/'stripes'
// top.open: open-collar V depth (0 = closed, 1 = Tommy-deep);  top.untucked: hem hangs over the trousers
// bottom.type: 'jeans' | 'trousers' | 'shorts' | 'skirt'
// shoes.type: 'sneakers' | 'loafers' | 'slippers' | 'boots' | 'flats'
// hair: 'slick' | 'short' | 'curly' | 'bob' | 'long' | 'bun' | 'bald' | 'buzz' | 'ponytail'
// acc: chain, glasses, sunglasses, airpods, visor, policeCap, cap, bag, backpack, lanyard, apron, watch, camera, towel, belt, tie, vest

export const SKIN = {
  pale: 0xf1d3bd, light: 0xe8bf9f, tan: 0xc98e66, olive: 0xb98060, brown: 0x9a6243, dark: 0x6b4330, deep: 0x4e3022,
  chinese: 0xe4b48f, malay: 0xb57d58, indian: 0x8a5a3e,
};
export const HAIR = { black: 0x141110, darkBrown: 0x2b1d14, brown: 0x5a3a22, auburn: 0x7a3b22, grey: 0x9a9690, white: 0xd9d6d0, blonde: 0xc9a15e };

export const PRESETS = {
  tommy: {
    body: { height: 1.80, fem: 0, girth: 0.08 },
    skin: 0xc48a63, hair: HAIR.darkBrown, hairStyle: 'slick', stubble: 0.55, eye: 0x3b2a1e,
    top: { type: 'shirt', color: 0xffffff, tex: 'hawaii', sleeves: 'short', open: 1, untucked: true, loose: 1, collar: true, buttons: true },
    bottom: { type: 'jeans', color: 0x3d5f93, tex: 'denim' },
    shoes: { type: 'sneakers', color: 0xf2f2ee, sole: 0xdcdcd4 },
    acc: ['chain', 'watch'],
  },
  ken: {
    body: { height: 1.72, fem: 0, girth: -0.05 },
    skin: 0xf0c9ad, hair: 0x6b3a1f, hairStyle: 'curly', stubble: 0.0, eye: 0x4a6b3a,
    top: { type: 'suit', color: 0xf4f1ea, inner: 0xf2a6c4, tex: 'plain', sleeves: 'long', open: 0.8, untucked: true, lapel: 0xe8e3d8 },
    bottom: { type: 'trousers', color: 0xf0ede6, tex: 'plain' },
    shoes: { type: 'loafers', color: 0xe9e4da, sole: 0x8a7a66 },
    acc: ['glasses'],
  },
  lance: {
    body: { height: 1.83, fem: 0, girth: 0.0 },
    skin: 0x6e4632, hair: HAIR.black, hairStyle: 'buzz', stubble: 0.2, eye: 0x2a1a10,
    top: { type: 'suit', color: 0xf6f4ef, inner: 0x2d2d2d, tex: 'plain', sleeves: 'long', open: 0.9, untucked: true, lapel: 0xeae6dc },
    bottom: { type: 'trousers', color: 0xf3f0ea, tex: 'plain' },
    shoes: { type: 'loafers', color: 0x2a2420, sole: 0x1a1612 },
    acc: ['sunglasses', 'chain'],
  },
  kyle: {
    body: { height: 1.76, fem: 0, girth: -0.08 },
    skin: SKIN.chinese, hair: HAIR.black, hairStyle: 'short', stubble: 0, eye: 0x22180f,
    top: { type: 'hoodie', color: 0x8c9096, tex: 'knit', sleeves: 'long', open: 0, untucked: true, vest: 0x1d3557 },
    bottom: { type: 'trousers', color: 0x3a3f47, tex: 'plain' },
    shoes: { type: 'sneakers', color: 0xe9ecef, sole: 0xffffff },
    acc: ['airpods', 'watch'],
  },
  auntie: {
    body: { height: 1.55, fem: 1, girth: 0.55 },
    skin: SKIN.chinese, hair: 0x2a2220, hairStyle: 'bob', stubble: 0, eye: 0x22180f, blush: 0.4,
    top: { type: 'blouse', color: 0xffffff, tex: 'floral', sleeves: 'short', open: 0.25, untucked: true, loose: 1.4 },
    bottom: { type: 'trousers', color: 0x4b4f5c, tex: 'plain' },
    shoes: { type: 'flats', color: 0x3a2e2a, sole: 0x2a201c },
    acc: ['visor', 'bag'],
  },
  uncle: {
    body: { height: 1.66, fem: 0, girth: 0.45 },
    skin: 0xc79a73, hair: 0x9e9a94, hairStyle: 'buzz', stubble: 0.25, eye: 0x22180f,
    top: { type: 'singlet', color: 0xf3f1ea, tex: 'plain', sleeves: 'none', open: 0, untucked: true },
    bottom: { type: 'shorts', color: 0x2f3b4c, tex: 'plain' },
    shoes: { type: 'slippers', color: 0x2b55a3, sole: 0x1c3f80 },
    acc: ['towel'],
  },
  investor_m: {
    body: { height: 1.79, fem: 0, girth: 0.05 },
    skin: SKIN.light, hair: HAIR.brown, hairStyle: 'short', stubble: 0.1, eye: 0x3a5a7a,
    top: { type: 'suit', color: 0x1f2a44, inner: 0xf6f7fb, tex: 'plain', sleeves: 'long', open: 0.7, untucked: false, tie: 0x7a1f2b, lapel: 0x18223a },
    bottom: { type: 'trousers', color: 0x1f2a44, tex: 'plain' },
    shoes: { type: 'loafers', color: 0x1a1412, sole: 0x0f0c0a },
    acc: ['watch'],
  },
  investor_f: {
    body: { height: 1.68, fem: 1, girth: -0.05 },
    skin: SKIN.indian, hair: HAIR.black, hairStyle: 'long', stubble: 0, eye: 0x22180f, blush: 0.2, lip: 0x8a3a3a,
    top: { type: 'suit', color: 0x2b2b30, inner: 0xf0e6dc, tex: 'plain', sleeves: 'long', open: 0.6, untucked: true, lapel: 0x232328 },
    bottom: { type: 'skirt', color: 0x2b2b30, tex: 'plain' },
    shoes: { type: 'flats', color: 0x111111, sole: 0x111111 },
    acc: ['watch'],
  },
  office_m: {
    body: { height: 1.74, fem: 0, girth: 0.0 },
    skin: SKIN.chinese, hair: HAIR.black, hairStyle: 'short', stubble: 0, eye: 0x22180f,
    top: { type: 'shirt', color: 0xffffff, tex: 'stripes', sleeves: 'long', open: 0.15, untucked: false, collar: true },
    bottom: { type: 'trousers', color: 0x2e3138, tex: 'plain' },
    shoes: { type: 'loafers', color: 0x1a1412, sole: 0x0f0c0a },
    acc: ['lanyard', 'belt'],
  },
  office_f: {
    body: { height: 1.62, fem: 1, girth: -0.05 },
    skin: SKIN.malay, hair: HAIR.darkBrown, hairStyle: 'bun', stubble: 0, eye: 0x22180f, blush: 0.3, lip: 0xa0464a,
    top: { type: 'blouse', color: 0xdbe7f5, tex: 'plain', sleeves: 'short', open: 0.2, untucked: false, loose: 0.6 },
    bottom: { type: 'skirt', color: 0x30343c, tex: 'plain' },
    shoes: { type: 'flats', color: 0x1d1d1f, sole: 0x111111 },
    acc: ['lanyard'],
  },
  tourist: {
    body: { height: 1.84, fem: 0, girth: 0.25 },
    skin: 0xf2c4a8, hair: HAIR.blonde, hairStyle: 'short', stubble: 0.1, eye: 0x4a6d8c, blush: 0.5,
    top: { type: 'shirt', color: 0xffffff, tex: 'tourist', sleeves: 'short', open: 0.3, untucked: true, loose: 1.1, collar: true, buttons: true },
    bottom: { type: 'shorts', color: 0xc8b48a, tex: 'plain' },
    shoes: { type: 'sneakers', color: 0x8a8f96, sole: 0xe9e9e9 },
    acc: ['cap', 'backpack', 'camera'],
  },
  student: {
    body: { height: 1.68, fem: 0, girth: -0.15 },
    skin: SKIN.chinese, hair: HAIR.black, hairStyle: 'short', stubble: 0, eye: 0x22180f,
    top: { type: 'shirt', color: 0xf7f7f7, tex: 'plain', sleeves: 'short', open: 0.1, untucked: false, collar: true },
    bottom: { type: 'shorts', color: 0x24345c, tex: 'plain' },
    shoes: { type: 'sneakers', color: 0xffffff, sole: 0xdddddd },
    acc: ['backpack', 'belt'],
  },
  police: {
    body: { height: 1.77, fem: 0, girth: 0.05 },
    skin: SKIN.malay, hair: HAIR.black, hairStyle: 'buzz', stubble: 0.15, eye: 0x22180f,
    top: { type: 'uniform', color: 0x1f2c4f, tex: 'plain', sleeves: 'short', open: 0.12, untucked: false, collar: true },
    bottom: { type: 'trousers', color: 0x1b2645, tex: 'plain' },
    shoes: { type: 'boots', color: 0x0e0e10, sole: 0x0a0a0a },
    acc: ['policeCap', 'belt'],
  },
  hawker: {
    body: { height: 1.70, fem: 0, girth: 0.3 },
    skin: SKIN.chinese, hair: HAIR.black, hairStyle: 'buzz', stubble: 0.3, eye: 0x22180f,
    top: { type: 'tee', color: 0xf5f5f0, tex: 'plain', sleeves: 'short', open: 0, untucked: false },
    bottom: { type: 'trousers', color: 0x2c2f36, tex: 'plain' },
    shoes: { type: 'boots', color: 0x1b1b1b, sole: 0x111111 },
    acc: ['apron', 'towel'],
  },
};

export function hashSeed(s) { let h = 2166136261 >>> 0; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, arr) => arr[(r() * arr.length) | 0];

/** Random Singapore pedestrian spec for the hero builder (used for 'random' preset). */
export function randomSpec(seed) {
  const r = mulberry(seed);
  const fem = r() < 0.5 ? 1 : 0;
  const skin = pick(r, [SKIN.chinese, SKIN.chinese, SKIN.chinese, SKIN.malay, SKIN.indian, SKIN.light, SKIN.tan, SKIN.brown]);
  const age = r();
  const hair = age > 0.85 ? pick(r, [HAIR.grey, HAIR.white]) : (skin === SKIN.light && r() < 0.4 ? pick(r, [HAIR.blonde, HAIR.brown, HAIR.auburn]) : pick(r, [HAIR.black, HAIR.black, HAIR.darkBrown]));
  const shirtCols = [0xffffff, 0xdbe7f5, 0x1f2a44, 0xc92a2a, 0x2b8a3e, 0xf2c94c, 0x7f5af0, 0xf4a261, 0x264653, 0xe76f51, 0x8d99ae, 0x111111];
  const pantsCols = [0x1f2a44, 0x2e3138, 0x111111, 0x3d5f93, 0xc8b48a, 0x5c4b3a, 0x6c757d];
  const topType = pick(r, fem ? ['blouse', 'tee', 'tee', 'shirt'] : ['shirt', 'tee', 'tee', 'polo', 'shirt']);
  const tex = r() < 0.12 ? pick(r, ['batik', 'floral', 'tourist', 'stripes']) : (r() < 0.3 ? 'knit' : 'plain');
  const bottomType = fem ? pick(r, ['skirt', 'trousers', 'jeans', 'shorts']) : pick(r, ['trousers', 'jeans', 'shorts', 'trousers']);
  const spec = {
    body: { height: fem ? 1.55 + r() * 0.15 : 1.65 + r() * 0.17, fem, girth: (r() - 0.35) * (age > 0.6 ? 0.9 : 0.5) },
    skin, hair, hairStyle: fem ? pick(r, ['long', 'bob', 'bun', 'ponytail']) : (age > 0.8 ? pick(r, ['bald', 'short']) : pick(r, ['short', 'short', 'buzz', 'slick'])),
    stubble: fem ? 0 : r() * 0.4, eye: 0x22180f, blush: fem ? r() * 0.4 : 0,
    top: { type: topType, color: pick(r, shirtCols), tex, sleeves: topType === 'shirt' && r() < 0.5 ? 'long' : 'short', open: topType === 'shirt' ? r() * 0.3 : 0, untucked: r() < 0.6, collar: topType === 'shirt' || topType === 'polo' },
    bottom: { type: bottomType, color: pick(r, pantsCols), tex: bottomType === 'jeans' ? 'denim' : 'plain' },
    shoes: { type: pick(r, ['sneakers', 'sneakers', 'loafers', 'slippers', 'flats']), color: pick(r, [0xffffff, 0x111111, 0x5c4b3a, 0x8a8f96]), sole: 0xdddddd },
    acc: [],
  };
  if (bottomType === 'jeans') spec.bottom.color = pick(r, [0x3d5f93, 0x2b3f66, 0x5a7bb0, 0x222222]);
  if (r() < 0.25) spec.acc.push('lanyard');
  if (r() < 0.15) spec.acc.push('backpack');
  if (r() < 0.1) spec.acc.push('cap');
  if (r() < 0.1) spec.acc.push('glasses');
  return spec;
}

export function resolveSpec(opts = {}) {
  const preset = opts.preset || 'random';
  let spec;
  if (preset === 'random' || !PRESETS[preset]) spec = randomSpec(opts.seed ?? ((Math.random() * 1e9) | 0));
  else spec = structuredClone(PRESETS[preset]);
  const c = opts.colors || {};
  if (c.skin != null) spec.skin = c.skin;
  if (c.hair != null) spec.hair = c.hair;
  if (c.shirt != null) spec.top.color = c.shirt;
  if (c.pants != null) spec.bottom.color = c.pants;
  if (c.shoes != null) spec.shoes.color = c.shoes;
  return spec;
}
