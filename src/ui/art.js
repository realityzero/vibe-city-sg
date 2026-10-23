// Procedural SVG art for the title / loading screens: the Marina Bay skyline (CBD towers, Esplanade,
// ArtScience Museum, Marina Bay Sands, Singapore Flyer, Supertrees) and palm-tree silhouettes.
const f = n => Math.round(n * 10) / 10;

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/**
 * @param {{fill:string, edge?:string, back?:string, windows?:boolean, winColors?:string[], lights?:boolean, seed?:number}} o
 * viewBox 0 0 2000 500, ground at y=500.
 */
export function skylineSVG(o = {}) {
  const fill = o.fill || '#170826', back = o.back || '#2a0f45', edge = o.edge || 'rgba(255,110,190,.45)';
  const R = rng(o.seed || 7);
  const parts = [], backParts = [], wins = [], glow = [];
  const rect = (x, y, w, arr = parts) => arr.push(`M${f(x)} 500V${f(y)}H${f(x + w)}V500Z`);
  const winGrid = (x, y, w, dens = 0.22) => {
    if (!o.windows) return;
    for (let yy = y + 8; yy < 492; yy += 9) for (let xx = x + 4; xx < x + w - 5; xx += 7) {
      if (R() < dens) wins.push(`<rect x="${f(xx)}" y="${f(yy)}" width="3.2" height="4.2" fill="${o.winColors[(R() * o.winColors.length) | 0]}" opacity="${f(0.35 + R() * 0.6)}"/>`);
    }
  };
  // back layer: hazy towers + HDB slabs
  for (let x = 0; x < 2000; x += 26 + R() * 30) {
    const w = 22 + R() * 34, h = 90 + R() * 170;
    if (x > 900 && x < 1350) continue;
    rect(x, 500 - h, w, backParts);
  }
  // left HDB-ish blocks
  for (const [x, w, y] of [[10, 46, 330], [62, 40, 300], [108, 52, 345], [168, 36, 310]]) { rect(x, y, w); winGrid(x, y, w, 0.3); }
  // CBD towers
  const towers = [[214, 48, 250], [268, 40, 190, 'ant'], [318, 64, 120, 'uob'], [394, 0, 0, 'oub'], [484, 54, 98, 'cham'], [548, 58, 66, 'slant'], [616, 44, 150, 'slant2'], [668, 44, 170, 'slant2'], [720, 36, 205]];
  for (const [x, w, y, kind] of towers) {
    if (kind === 'oub') {
      parts.push(`M394 500V142L434 120V500Z`, `M437 500V128L476 150V500Z`); winGrid(394, 142, 82, 0.25); continue;
    }
    if (kind === 'ant') { rect(x, y, w); parts.push(`M${x + w / 2 - 1.5} ${y}V${y - 46}h3V${y}Z`); }
    else if (kind === 'uob') { parts.push(`M${x} 500V${y + 30}L${x + 8} ${y + 22}V${y}H${x + w - 8}V${y + 22}L${x + w} ${y + 30}V500Z`, `M${x + w / 2 - 1.5} ${y}V${y - 26}h3V${y}Z`); }
    else if (kind === 'cham') parts.push(`M${x} 500V${y + 14}L${x + 10} ${y}H${x + w - 10}L${x + w} ${y + 14}V500Z`);
    else if (kind === 'slant') parts.push(`M${x} 500V${y + 18}L${x + w} ${y}V500Z`);
    else if (kind === 'slant2') parts.push(`M${x} 500V${y}L${x + w} ${y + 22}V500Z`);
    else rect(x, y, w);
    winGrid(x, y + 10, w, 0.24);
  }
  // Esplanade durians (spiky half-domes)
  const dome = (cx, rx, ry) => {
    let d = `M${cx - rx} 500`;
    const n = 54;
    for (let i = 0; i <= n; i++) {
      const a = Math.PI - (i / n) * Math.PI;
      const sp = i % 2 ? 1.06 : 1;
      d += `L${f(cx + Math.cos(a) * rx * sp)} ${f(500 - Math.sin(a) * ry * sp)}`;
    }
    parts.push(d + 'Z');
  };
  dome(792, 68, 58); dome(884, 54, 46);
  // ArtScience Museum: splayed "fingers" of a lotus rising from a low podium
  {
    const cx = 968, by = 488;
    for (let k = -3; k <= 3; k++) {
      const ang = k * 0.3, len = 74 - Math.abs(k) * 9 + (k === 1 ? 6 : 0);
      const bx = cx + k * 3.2, tx = bx + Math.sin(ang) * len, ty = by - Math.cos(ang) * len;
      const nx = Math.cos(ang) * 6.5, ny = Math.sin(ang) * 6.5;
      const mx = (bx + tx) / 2 - Math.sin(ang) * 6, my = (by + ty) / 2 + 4;
      parts.push(`M${f(bx - 3)} ${by}Q${f(mx - nx * 1.4)} ${f(my - ny * 1.4)} ${f(tx - nx * 0.25)} ${f(ty - ny * 0.25)}Q${f(tx + Math.sin(ang) * 3)} ${f(ty - Math.cos(ang) * 3)} ${f(tx + nx * 0.25)} ${f(ty + ny * 0.25)}Q${f(mx + nx * 1.4)} ${f(my + ny * 1.4)} ${f(bx + 3)} ${by}Z`);
    }
    parts.push(`M${cx - 30} 500V${by}H${cx + 30}V500Z`);
  }
  // Marina Bay Sands: three two-legged towers + SkyPark
  for (const x of [1030, 1132, 1234]) {
    parts.push(`M${x} 500V160H${x + 44}V236L${x + 74} 500H${x + 50}L${x + 40} 330L${x + 31} 500Z`);
    winGrid(x, 170, 30, 0.3);
  }
  parts.push('M968 158Q972 147 990 145L1290 143Q1314 146 1320 156L1318 162H975Z');
  // Singapore Flyer
  const fx = 1452, fy = 292, fr = 150;
  const flyer = [];
  flyer.push(`<circle cx="${fx}" cy="${fy}" r="${fr}" fill="none" stroke="${fill}" stroke-width="7"/>`);
  flyer.push(`<circle cx="${fx}" cy="${fy}" r="${fr - 9}" fill="none" stroke="${fill}" stroke-width="2.4"/>`);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    flyer.push(`<line x1="${fx}" y1="${fy}" x2="${f(fx + Math.cos(a) * (fr - 9))}" y2="${f(fy + Math.sin(a) * (fr - 9))}" stroke="${fill}" stroke-width="1.3"/>`);
    const cx = fx + Math.cos(a) * (fr + 9), cy = fy + Math.sin(a) * (fr + 9);
    flyer.push(`<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="5.5" ry="7.5" fill="${fill}"/>`);
    if (o.lights) glow.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="2.2" fill="${i % 2 ? '#2fe6ff' : '#ff6ad5'}"/>`);
  }
  flyer.push(`<circle cx="${fx}" cy="${fy}" r="12" fill="${fill}"/>`);
  parts.push(`M${fx - 62} 500L${fx - 4} ${fy}L${fx + 4} ${fy}L${fx - 48} 500Z`, `M${fx + 62} 500L${fx + 4} ${fy}L${fx - 4} ${fy}L${fx + 48} 500Z`);
  parts.push(`M${fx - 120} 500V476Q${fx} 456 ${fx + 120} 476V500Z`);
  // Supertrees
  const trees = [[1612, 342, 60], [1668, 306, 70], [1736, 238, 98], [1816, 258, 92], [1880, 318, 66], [1938, 350, 56]];
  for (const [x, top, cw] of trees) {
    const neck = top + (500 - top) * 0.42;
    parts.push(`M${x - 6} 500L${x - 5} ${f(neck)}Q${x - 6} ${f(top + 18)} ${x - cw / 2} ${top}Q${x} ${top - 9} ${x + cw / 2} ${top}Q${x + 6} ${f(top + 18)} ${x + 5} ${f(neck)}L${x + 6} 500Z`);
    if (o.lights) for (let i = 0; i < 9; i++) { const t = i / 8; glow.push(`<circle cx="${f(x - cw / 2 + t * cw)}" cy="${f(top + 2 - Math.sin(t * Math.PI) * 6)}" r="2" fill="${i % 3 ? '#c86bff' : '#ff6ad5'}"/>`); }
  }
  parts.push('M1736 408Q1776 424 1816 410L1816 414Q1776 428 1736 412Z');
  // right edge low-rise
  for (const [x, w, y] of [[1966, 34, 410]]) rect(x, y, w);

  const glowFilter = o.lights ? `<filter id="g${o.seed || 7}"><feGaussianBlur stdDeviation="2.4"/></filter>` : '';
  return `<svg viewBox="0 0 2000 500" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
<defs>${glowFilter}</defs>
<path d="${backParts.join('')}" fill="${back}" opacity=".75"/>
<g>${flyer.join('')}</g>
<path d="${parts.join('')}" fill="${fill}" stroke="${edge}" stroke-width="1.2" stroke-linejoin="round"/>
<g>${wins.join('')}</g>
${o.lights ? `<g filter="url(#g${o.seed || 7})">${glow.join('')}</g><g>${glow.join('')}</g>` : ''}
</svg>`;
}

/** Palm tree silhouette; viewBox 0 0 400 800. */
export function palmSVG(fill = '#0d0418', seed = 3) {
  const R = rng(seed);
  // trunk: leaning curve with taper and ring notches
  const trunk = [];
  const pts = [];
  for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push([90 + t * 120 + Math.sin(t * 2.2) * 30, 800 - t * 600]); }
  const L = [], Rr = [];
  pts.forEach(([x, y], i) => { const w = 20 - (i / 24) * 9; L.push([x - w / 2, y]); Rr.push([x + w / 2, y]); });
  trunk.push(`M${L.map(p => p.map(f).join(' ')).join('L')}L${Rr.reverse().map(p => p.map(f).join(' ')).join('L')}Z`);
  const [cx, cy] = pts[24];
  // fronds
  const fronds = [];
  const angles = [-170, -140, -112, -80, -55, -28, -5, 18, 160, 200, -60];
  angles.forEach((deg, k) => {
    const a = (deg * Math.PI) / 180;
    const len = 150 + R() * 70, droop = 70 + R() * 70;
    const ex = cx + Math.cos(a) * len, ey = cy + Math.sin(a) * len * 0.55 + droop;
    const mx = cx + Math.cos(a) * len * 0.5, my = cy + Math.sin(a) * len * 0.5 - 30;
    // sample the rib as a quadratic bezier and emit jagged leaflets on both sides
    const n = 16, up = [], dn = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = (1 - t) * (1 - t) * cx + 2 * (1 - t) * t * mx + t * t * ex;
      const y = (1 - t) * (1 - t) * cy + 2 * (1 - t) * t * my + t * t * ey;
      const dx = 2 * (1 - t) * (mx - cx) + 2 * t * (ex - mx), dy = 2 * (1 - t) * (my - cy) + 2 * t * (ey - my);
      const l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
      const w = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 26 * (i % 2 ? 1.0 : 0.35) + 1.5;
      up.push([x + nx * w + dx / l * 6, y + ny * w + dy / l * 6]);
      dn.push([x - nx * w * 0.8 + dx / l * 6, y - ny * w * 0.8 + dy / l * 6]);
    }
    fronds.push(`M${up.map(p => p.map(f).join(' ')).join('L')}L${dn.reverse().map(p => p.map(f).join(' ')).join('L')}Z`);
    if (k % 3 === 0) fronds.push(`M${f(cx)} ${f(cy)}m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0`);
  });
  // coconuts
  const nuts = [[-8, 12], [6, 16], [16, 8]].map(([dx, dy]) => `<circle cx="${f(cx + dx)}" cy="${f(cy + dy)}" r="7" fill="${fill}"/>`).join('');
  return `<svg viewBox="0 0 400 800" preserveAspectRatio="xMinYMax meet" xmlns="http://www.w3.org/2000/svg"><path d="${trunk.join('')}${fronds.join('')}" fill="${fill}"/>${nuts}</svg>`;
}
