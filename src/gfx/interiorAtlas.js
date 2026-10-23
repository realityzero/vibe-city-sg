// Interior back walls for the facade shader's interior mapping: eight shop/lobby scenes painted procedurally at load
// (4 x 2 cells of 256 px), plus a signage strip (hospital name board + block plaques). Unlit albedo with mild baked
// shading; the shader lights it with the room's lamp colour. Families:
//   0 provision shop  1 kopitiam  2 office reception  3 clinic / hospital reception
//   4 goldsmith       5 bakery    6 hardware            7 pharmacy / beauty
import * as THREE from 'three';

export const INTERIOR_CELLS = { cols: 4, rows: 2, signRowH: 128 / 640 };

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export function makeInteriorAtlas() {
  const W = 1024, H = 640, C = 256;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const R = rng(20261024);
  const pick = a => a[Math.floor(R() * a.length)];
  const rect = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const shade = (x, y, w, h, top = 0.0, bottom = 0.25) => { const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, `rgba(0,0,0,${top})`); gr.addColorStop(1, `rgba(0,0,0,${bottom})`); g.fillStyle = gr; g.fillRect(x, y, w, h); };
  const text = (s, x, y, size, col, font = 'sans-serif', weight = 'bold', align = 'center') => { g.fillStyle = col; g.font = `${weight} ${size}px ${font}`; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y); };
  const GOODS = ['#c8302a', '#e0a020', '#2a6fb0', '#3f8f48', '#e8e0d0', '#8a3f9a', '#d8642a', '#1e1e1e', '#f0c8a0', '#5aa0c8', '#b0b02a'];
  // shelves of packaged goods: rows of small boxes/bottles with gaps, a price strip on each shelf edge
  const shelves = (x, y, w, h, rows, wood = '#6b4a2a', goods = GOODS, dense = 0.85) => {
    rect(x, y, w, h, '#3a2c20');
    const rh = h / rows;
    for (let r = 0; r < rows; r++) {
      const sy = y + r * rh;
      let gx = x + 2;
      while (gx < x + w - 4) {
        const bw = 4 + R() * 10, bh = rh * (0.45 + R() * 0.45);
        if (R() < dense) { rect(gx, sy + rh - 4 - bh, bw, bh, pick(goods)); rect(gx, sy + rh - 4 - bh, bw, 2, 'rgba(255,255,255,0.25)'); }
        gx += bw + 1 + (R() < 0.1 ? 6 : 0);
      }
      rect(x, sy + rh - 4, w, 4, wood);
      rect(x, sy + rh - 4, w, 1, 'rgba(255,255,255,0.3)');
    }
  };
  const cell = (i, draw) => { const x = (i % 4) * C, y = Math.floor(i / 4) * C; g.save(); g.beginPath(); g.rect(x, y, C, C); g.clip(); g.translate(x, y); draw(); g.restore(); };
  const ceilingBand = (col = '#d8d4c8') => { rect(0, 0, C, 20, col); for (let i = 0; i < 4; i++) rect(20 + i * 62, 6, 34, 6, '#fffbe8'); };
  const floor = (col = '#8a8478') => { rect(0, 226, C, 30, col); shade(0, 226, C, 30, 0.1, 0.35); };

  // 0 provision shop: floor-to-ceiling shelves, a counter with a cashier till, hanging snacks, sacks of rice
  cell(0, () => {
    rect(0, 0, C, C, '#cfc6b0'); ceilingBand();
    shelves(8, 24, 240, 150, 6);
    for (let i = 0; i < 10; i++) rect(14 + i * 24, 26, 8, 22, pick(GOODS)); // hanging snack strips
    rect(30, 176, 196, 50, '#7a5a3a'); rect(30, 176, 196, 6, '#a07a50'); // counter
    rect(150, 160, 34, 18, '#2a2a2a'); rect(154, 163, 26, 8, '#5ab0ff'); // till
    for (let i = 0; i < 4; i++) rect(36 + i * 26, 196, 22, 30, '#d8c8a0'); // rice sacks
    text('雜貨', 70, 168, 14, '#c0201a');
    floor('#9a9080');
  });
  // 1 kopitiam: tiled wall, drinks stall with menu boards, fridge, tables and stools
  cell(1, () => {
    rect(0, 0, C, C, '#e8e4d8'); ceilingBand('#e0dcd0');
    for (let y = 20; y < 130; y += 10) for (let x = 0; x < C; x += 10) rect(x + 1, y + 1, 8, 8, (x + y) % 20 ? '#f2efe6' : '#e2ddd0');
    rect(14, 30, 228, 40, '#1c4a2a'); // menu board
    const items = ['KOPI 1.40', 'TEH 1.40', 'MILO 1.80', 'KAYA TOAST 2.20', 'BAK CHOR MEE 4.50', 'CHICKEN RICE 4.00'];
    items.forEach((s, k) => text(s, 22 + (k % 3) * 76, 42 + Math.floor(k / 3) * 18, 9, '#f2e8b0', 'sans-serif', 'bold', 'left'));
    rect(10, 120, 120, 70, '#c84030'); rect(10, 120, 120, 8, '#f0d060'); text('飲料', 70, 150, 18, '#fff3c0'); // drinks stall
    rect(170, 80, 70, 110, '#dfe6ea'); rect(175, 86, 60, 98, '#9ab8c8'); for (let i = 0; i < 5; i++) rect(178, 92 + i * 18, 54, 4, pick(GOODS)); // fridge
    // marble tables + stools (silhouettes in front)
    for (const tx of [20, 110, 190]) { rect(tx, 196, 48, 6, '#f4f2ee'); rect(tx + 20, 202, 6, 24, '#6a6a6a'); rect(tx - 8, 210, 12, 16, '#c0302a'); rect(tx + 44, 210, 12, 16, '#2a62b0'); }
    floor('#a8a094');
  });
  // 2 office reception: timber feature wall with a lit logo, reception desk, plants, lift lobby
  cell(2, () => {
    rect(0, 0, C, C, '#d6d2ca'); ceilingBand('#ece8e0');
    for (let x = 0; x < 150; x += 12) rect(x, 20, 11, 190, x % 24 ? '#8a6040' : '#7a5236'); // timber slats
    rect(26, 70, 98, 26, 'rgba(255,250,235,0.9)'); text(pick(['VIBE CAPITAL', 'MERLION VENTURES', 'TEMASICK', 'KOPI.AI', 'CHOPECHAIN']), 75, 83, 11, '#2a2a2a');
    rect(158, 40, 40, 170, '#b8bcc0'); rect(204, 40, 40, 170, '#b8bcc0'); rect(177, 40, 2, 170, '#6a6e72'); rect(223, 40, 2, 170, '#6a6e72'); // lift doors
    rect(156, 30, 90, 8, '#2a2a2a'); text('LIFTS 1-12', 201, 34, 7, '#e0e0e0');
    rect(20, 168, 120, 42, '#ece8e0'); rect(20, 168, 120, 5, '#c8b898'); // desk
    for (const px of [6, 140]) { rect(px + 2, 178, 14, 32, '#5a4a3a'); g.fillStyle = '#3f7a3a'; g.beginPath(); g.arc(px + 9, 166, 16, 0, 7); g.fill(); }
    floor('#b8b4ac');
  });
  // 3 clinic / hospital reception: white + teal, queue display, counters, rows of chairs, wayfinding signs
  cell(3, () => {
    rect(0, 0, C, C, '#eef0ee'); ceilingBand('#f6f6f4');
    rect(0, 96, C, 10, '#1d8a8a'); // teal band
    rect(16, 30, 110, 46, '#111'); text('NOW SERVING', 71, 40, 9, '#f0f0f0'); text('2041  2042  1187', 71, 60, 12, '#ff5040');
    rect(140, 28, 104, 22, '#1d6a8a'); text('◀ PHARMACY  ·  X-RAY ▶', 192, 39, 8, '#fff');
    rect(140, 54, 104, 22, '#c8202a'); text('EMERGENCY ▶', 192, 65, 10, '#fff');
    rect(10, 120, 236, 50, '#f8f8f6'); rect(10, 120, 236, 6, '#1d8a8a'); // registration counter
    for (let i = 0; i < 5; i++) { rect(22 + i * 46, 130, 30, 18, '#2a3a44'); text(String(i + 1), 37 + i * 46, 158, 9, '#1d6a8a'); }
    for (let i = 0; i < 9; i++) { rect(8 + i * 28, 196, 22, 12, '#3a8aa8'); rect(8 + i * 28, 186, 22, 10, '#4aa0c0'); } // waiting chairs
    floor('#d8dcd8');
  });
  // 4 goldsmith: red walls, gold-trimmed glass counters, lanterns, Chinese characters
  cell(4, () => {
    rect(0, 0, C, C, '#7a1418'); ceilingBand('#e8c870');
    text('金', 64, 70, 54, '#e8c060'); text('鋪', 192, 70, 54, '#e8c060');
    for (let i = 0; i < 3; i++) { g.fillStyle = '#d82a20'; g.beginPath(); g.ellipse(40 + i * 88, 40, 10, 14, 0, 0, 7); g.fill(); }
    rect(8, 120, 240, 90, '#3a0e10');
    for (let i = 0; i < 3; i++) { rect(14 + i * 80, 128, 72, 40, '#9ab0b0'); for (let k = 0; k < 14; k++) rect(18 + i * 80 + R() * 64, 140 + R() * 22, 3, 3, '#ffd860'); rect(14 + i * 80, 168, 72, 4, '#e8c060'); }
    floor('#6a4a3a');
  });
  // 5 bakery: bread racks, cake display fridge, chalkboard menu
  cell(5, () => {
    rect(0, 0, C, C, '#efe2c8'); ceilingBand('#f4ead8');
    rect(150, 26, 96, 70, '#2a2a28'); ['BUNS 1.20', 'EGG TART 1.80', 'KAYA PUFF 1.50', 'CHIFFON 12.00'].forEach((s, k) => text(s, 156, 38 + k * 15, 9, '#f0f0e8', 'sans-serif', 'normal', 'left'));
    for (let r = 0; r < 4; r++) { rect(10, 30 + r * 34, 130, 4, '#8a6a40'); for (let k = 0; k < 9; k++) { g.fillStyle = pick(['#d89848', '#c07830', '#e8b868', '#b06a28']); g.beginPath(); g.ellipse(18 + k * 14, 24 + r * 34, 6, 5, 0, 0, 7); g.fill(); } }
    rect(10, 160, 236, 50, '#dfe8ec'); rect(14, 164, 228, 30, '#f6f2ea'); for (let k = 0; k < 12; k++) rect(18 + k * 19, 176, 14, 12, pick(['#f0c0c8', '#f8f0e0', '#8a4a2a', '#f0d860', '#c8e0a0'])); // cake fridge
    floor('#b8a890');
  });
  // 6 hardware: pails, ropes, tools on pegboard, stacked boxes
  cell(6, () => {
    rect(0, 0, C, C, '#a89a80'); ceilingBand('#c8c0b0');
    rect(8, 24, 240, 100, '#c0a878'); for (let y = 30; y < 120; y += 8) for (let x = 12; x < 244; x += 8) rect(x, y, 2, 2, '#8a7450'); // pegboard
    for (let k = 0; k < 22; k++) rect(14 + R() * 224, 30 + R() * 80, 3 + R() * 6, 10 + R() * 18, pick(['#3a3a3a', '#c8302a', '#e8c020', '#6a6a6a', '#2a62b0']));
    for (let k = 0; k < 8; k++) { g.fillStyle = pick(['#e86a20', '#2a7ac8', '#e8e0d0', '#3a9a48']); g.fillRect(12 + k * 30, 150, 24, 26); }
    for (let k = 0; k < 6; k++) rect(14 + k * 40, 180, 36, 30, '#b88a58');
    floor('#7a7468');
  });
  // 7 pharmacy / beauty: bright white shelving, coloured product rows, mirror panel
  cell(7, () => {
    rect(0, 0, C, C, '#f4f4f2'); ceilingBand('#fafafa');
    shelves(8, 30, 160, 150, 7, '#e8e8e8', ['#f0a0b8', '#a0c8f0', '#f8f8f8', '#80d0a0', '#f0d080', '#d06080', '#4a8ad0'], 0.92);
    rect(176, 30, 70, 150, '#c8d6dc'); shade(176, 30, 70, 150, 0.0, 0.15); // mirror
    rect(176, 22, 70, 8, '#2a8a5a'); text('+ PHARMACY', 211, 26, 7, '#fff');
    rect(20, 186, 216, 26, '#ffffff'); rect(20, 186, 216, 4, '#2a8a5a');
    floor('#e0e0dc');
  });
  // signage strip (y 512..640): [0..512) hospital name board, [512..1024) block plaques 1..8 (4 x 2 of 128 x 64)
  {
    const y0 = 512;
    rect(0, y0, 512, 128, '#000000');
    g.save(); g.translate(0, y0);
    text('SINGAPORE', 256, 38, 44, '#ffffff', 'Helvetica, Arial, sans-serif', 'bold');
    text('GENERAL HOSPITAL', 256, 92, 44, '#ffffff', 'Helvetica, Arial, sans-serif', 'bold');
    g.restore();
    for (let k = 0; k < 8; k++) {
      const x = 512 + (k % 4) * 128, y = y0 + Math.floor(k / 4) * 64;
      rect(x, y, 128, 64, '#c8202a'); rect(x + 3, y + 3, 122, 58, '#b01a24');
      text('BLOCK', x + 64, y + 18, 16, '#ffffff', 'Helvetica, Arial, sans-serif', 'bold');
      text(String(k + 1), x + 64, y + 44, 26, '#ffffff', 'Helvetica, Arial, sans-serif', 'bold');
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  return tex;
}
