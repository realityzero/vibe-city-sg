// Shop signboard atlas for the facade shader: 60 invented Singapore shop boards (4 x 15 grid of 512x128) in
// period styles, a row of painted HDB block-number digits (alpha = paint mask), and the hawker centre's own pool:
// stall lightboxes (dish photo, Chinese and English dish name, stall number), the tray-return board and the NEA
// hygiene-grade sticker. Built once at load.
import * as THREE from 'three';

// row 15 = digits; rows 16-20 = hawker boards: FOOD_FIRST + k for k < FOOD_COUNT, then tray return, then the sticker
export const SIGN_COLS = 4, SIGN_ROWS = 21, SIGN_COUNT = 60, FOOD_FIRST = 64, FOOD_COUNT = 18;

// [english, chinese] — invented names in the style of old Chinatown / Kampong Glam / Little India boards
const SHOPS = [
  ['TONG HENG CONFECTIONERY', '東興餅家'], ['HIN LEE TRADING CO.', '興利貿易'], ['KIM SENG MEDICAL HALL', '金成藥行'],
  ['NAM SENG GOLDSMITH', '南成金莊'], ['HUAT SENG BAK KWA', '發成肉乾'], ['YUAN CHUN TEA HOUSE', '源春茶室'],
  ['KHEONG KEE COFFEE SHOP', '強記咖啡店'], ['SIN HUAT EATING HOUSE', '新發飲食店'], ['HOCK SOON HARDWARE', '福順五金'],
  ['TAI SENG TAILOR', '泰成洋服'], ['LEE KUM SANG MONEY CHANGER', '李金生找換'], ['LAM CLAN ASSOCIATION', '林氏公會'],
  ['WAH KEE PRAWN NOODLE', '華記蝦麵'], ['GOLDEN LOTUS VEGETARIAN', '金蓮素食'], ['SENG HUAT PROVISION', '成發雜貨'],
  ['YONG SHENG CHINESE MEDICINE', '永生中藥'], ['KWONG WAH PHOTO STUDIO', '光華影相'], ['TECK HIN JEWELLERS', '德興珠寶'],
  ['HUP LEE LAUNDRY', '合利洗衣'], ['CHUAN KEE DIM SUM', '泉記點心'], ['FOOT REFLEXOLOGY', '足底按摩'],
  ['KARAOKE KTV', '卡拉OK'], ['THYE SHAN HERBAL TEA', '泰山涼茶'], ['ENG HOE KUEH', '榮和糕粿'],
  ['POH CHENG ANTIQUES', '寶成古董'], ['KIAN SENG CLOCK & WATCH', '建成鐘錶'], ['HONG LIM ROAST DUCK', '芳林燒鴨'],
  ['LUCKY TRAVEL AGENCY', '幸運旅行社'], ['SOON LEE SIGNBOARD', '順利招牌'], ['CHOP CHUAN HUAT', '泉發號'],
  ['GUAN HOE SOON', '源和順'], ['MEI LING HAIR SALON', '美玲髮廊'], ['SHENG XING BOOKSTORE', '勝興書局'],
  ['HAPPY DURIAN', '快樂榴槤'],
];
const LATIN = [
  'RESTORAN AL-BARAKAH', 'KEDAI KOPI BAHAGIA', 'TOKO SAWAH TEXTILES', 'HAJI ISMAIL PERFUMES', 'MUTHU STORES',
  'RAHMAN SONGKOK', 'SRI MURUGAN FLOWERS', 'MOHAMED SALLEH SAREE', 'NASI PADANG SEDAP', 'ZAINAB BATIK',
];
const MODERN = [
  'VIBE COFFEE ROASTERS', 'BUBBLE TEA LAB', 'BAO & CO.', 'HAWKER DAO', 'THE KOPI CO.', 'STARTUP PANTRY',
  'MINI MART 24H', 'CO-WORK HUSTLE', 'NATURAL WINE BAR', 'SPECIALTY MATCHA', 'CLAUDIA AI LAB', 'OMAKASE 8',
  'PILATES STUDIO', 'CRAFT BEER TAPS', 'PET GROOMING', 'LAKSA LAB',
];
// background, primary text, secondary text, frame
const STYLES = [
  ['#121212', '#d9b44a', '#c9a64a', '#6b5a2a'],   // black lacquer, gold
  ['#8f1418', '#f2c94c', '#f6e3a3', '#5a0c0e'],   // red, gold
  ['#f3efe4', '#b3151b', '#1c1c1c', '#7a7a70'],   // white board, red + black
  ['#14452f', '#f4f1e6', '#d8e6d0', '#0b2a1c'],   // dark green, white
  ['#163a73', '#ffffff', '#cfdaf0', '#0d2348'],   // blue, white
  ['#f2c230', '#c0161c', '#2a2a2a', '#a07a10'],   // yellow, red (lightbox)
  ['#efe3c6', '#4a2a14', '#6a4a2a', '#8a6a3a'],   // cream, brown
];
const CN = '"Songti SC", "STSong", "SimSun", "Noto Serif CJK SC", "Source Han Serif SC", "PingFang SC", "Microsoft YaHei", serif';
const CN_SANS = '"PingFang SC", "Heiti SC", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif';
const SANS = '"Arial Black", "Helvetica Neue", Arial, sans-serif';

// hawker stall lightboxes: [chinese (halal stalls: a Malay subtitle), english, board, text, accent, dish photo, stall
// number, halal]
const FOOD = [
  ['海南鸡饭', 'HAINANESE CHICKEN RICE', '#fbf7ee', '#c4161c', '#1c1c1c', 'chicken', '#01-10', 0],
  ['炒粿条', 'CHAR KWAY TEOW', '#f4c430', '#b3121a', '#2a2a2a', 'ckt', '#01-27', 0],
  ['鱼圆面', 'FISHBALL NOODLE', '#1d4f9c', '#ffffff', '#ffe27a', 'fishball', '#01-05', 0],
  ['菜头粿', 'FRIED CARROT CAKE', '#b5161c', '#ffd84a', '#ffffff', 'carrot', '#01-33', 0],
  ['云吞面', 'WANTON MEE', '#fbf7ee', '#1d4f9c', '#c4161c', 'wanton', '#01-18', 0],
  ['AYAM GORENG · SAMBAL', 'NASI LEMAK', '#1d7a3e', '#ffffff', '#ffe27a', 'nasilemak', '#01-41', 1],
  ['LONTONG · SOTO AYAM', 'MEE REBUS', '#e9f4e4', '#16632f', '#7a3a10', 'meerebus', '#01-22', 1],
  ['MURTABAK · TEH TARIK', 'ROTI PRATA', '#e8731c', '#ffffff', '#fff1c7', 'prata', '#01-09', 1],
  ['经济饭', 'ECONOMIC RICE', '#ffe14d', '#c4161c', '#2a2a2a', 'economic', '#01-14', 0],
  ['甘蔗水', 'SUGARCANE JUICE', '#5fae3a', '#ffffff', '#fdf6c3', 'sugarcane', '#01-38', 0],
  ['饮料', 'DRINKS · KOPI · TEH', '#5a3418', '#ffe7b0', '#ffffff', 'kopi', '#01-01', 0],
  ['叻沙', 'KATONG LAKSA', '#f28a1e', '#7a1414', '#ffffff', 'laksa', '#01-29', 0],
  ['AYAM · DAGING · KETUPAT', 'SATAY', '#7a1414', '#ffd84a', '#ffffff', 'satay', '#01-45', 1],
  ['福建虾面', 'HOKKIEN PRAWN MEE', '#fbf7ee', '#b3121a', '#2a2a2a', 'hokkien', '#01-31', 0],
  ['肉脞面', 'BAK CHOR MEE', '#141414', '#e8c15a', '#e8c15a', 'bcm', '#01-07', 0],
  ['卤鸭饭', 'BRAISED DUCK RICE', '#9c1518', '#ffe7a0', '#ffffff', 'duck', '#01-24', 0],
  ['酿豆腐', 'YONG TAU FOO', '#e9f4e4', '#16632f', '#c4161c', 'ytf', '#01-36', 0],
  ['蚝煎', 'FRIED OYSTER', '#163a73', '#ffffff', '#ffd84a', 'oyster', '#01-12', 0],
];

// a dish photo in a square at (x, y) of side s: a plate or bowl seen from above, food painted with a few primitives
function dishPhoto(g, x, y, s, dish, rnd) {
  g.save(); g.beginPath(); g.rect(x, y, s, s); g.clip();
  g.fillStyle = '#2b2622'; g.fillRect(x, y, s, s);
  const cx = x + s / 2, cy = y + s / 2, R = s * 0.43;
  const disc = (px, py, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill(); };
  const blob = (px, py, rx, ry, rot, col) => { g.fillStyle = col; g.beginPath(); g.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2); g.fill(); };
  const strands = (col, n, w, r = R * 0.7) => {
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
    for (let k = 0; k < n; k++) { const a = rnd() * 6.28, d = rnd() * r * 0.8; const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d, b = rnd() * 6.28, l = r * (0.4 + rnd() * 0.5); g.beginPath(); g.moveTo(px, py); g.quadraticCurveTo(px + Math.cos(b + 1) * l * 0.5, py + Math.sin(b + 1) * l * 0.5, px + Math.cos(b) * l, py + Math.sin(b) * l); g.stroke(); }
  };
  const dots = (col, n, r, spread = R * 0.75) => { for (let k = 0; k < n; k++) { const a = rnd() * 6.28, d = Math.sqrt(rnd()) * spread; disc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (0.7 + rnd() * 0.6), col); } };
  const plate = () => { disc(cx, cy, R, '#f4f1ea'); disc(cx, cy, R * 0.86, '#e6e1d6'); };
  const bowl = soup => { disc(cx, cy, R, '#e9e4da'); disc(cx, cy, R * 0.82, soup); };
  switch (dish) {
    case 'chicken': plate(); blob(cx - R * 0.25, cy, R * 0.45, R * 0.5, 0, '#f3ead2'); for (let k = 0; k < 5; k++) blob(cx + R * 0.25, cy - R * 0.45 + k * R * 0.22, R * 0.32, R * 0.1, -0.3, k % 2 ? '#f2dca0' : '#e9cf8a'); dots('#5f9e3a', 4, R * 0.1); disc(cx - R * 0.55, cy + R * 0.5, R * 0.14, '#d8321e'); break;
    case 'ckt': plate(); strands('#5a3418', 26, s * 0.045); strands('#efe6c8', 10, s * 0.018); dots('#3f7a2a', 6, R * 0.06); dots('#7a2a1a', 6, R * 0.07); break;
    case 'fishball': bowl('#e7d7a8'); strands('#e8c860', 20, s * 0.02); dots('#f7f4ec', 6, R * 0.16, R * 0.5); dots('#4f8f30', 5, R * 0.08); break;
    case 'carrot': plate(); for (let k = 0; k < 14; k++) { const px = cx + (rnd() - 0.5) * R * 1.3, py = cy + (rnd() - 0.5) * R * 1.3; g.fillStyle = k % 3 ? '#efe0a8' : '#3a2416'; g.fillRect(px, py, R * 0.24, R * 0.2); } dots('#5f9e3a', 5, R * 0.05); break;
    case 'wanton': plate(); strands('#e3b84a', 22, s * 0.02); for (let k = 0; k < 4; k++) blob(cx + R * 0.35, cy - R * 0.3 + k * R * 0.2, R * 0.25, R * 0.09, 0.4, '#b8322a'); dots('#4f8f30', 4, R * 0.1); dots('#efe2c4', 3, R * 0.14, R * 0.4); break;
    case 'nasilemak': plate(); blob(cx, cy - R * 0.1, R * 0.38, R * 0.32, 0, '#f6f2e6'); disc(cx + R * 0.45, cy + R * 0.35, R * 0.25, '#ffffff'); disc(cx + R * 0.45, cy + R * 0.35, R * 0.11, '#f2b01e'); blob(cx - R * 0.45, cy + R * 0.4, R * 0.2, R * 0.13, 0, '#c7271a'); dots('#8a5a2a', 9, R * 0.05, R * 0.3); for (let k = 0; k < 3; k++) disc(cx - R * 0.55 + k * R * 0.2, cy - R * 0.5, R * 0.1, '#7cb85a'); break;
    case 'meerebus': bowl('#b9681e'); strands('#f0c84a', 14, s * 0.022); disc(cx + R * 0.2, cy - R * 0.2, R * 0.18, '#fbf3d8'); disc(cx + R * 0.2, cy - R * 0.2, R * 0.08, '#f2b01e'); dots('#3f7a2a', 6, R * 0.05); break;
    case 'prata': plate(); disc(cx - R * 0.15, cy + R * 0.05, R * 0.55, '#d9a24a'); strands('#b77a2a', 8, s * 0.012, R * 0.45); disc(cx + R * 0.5, cy - R * 0.45, R * 0.28, '#e9e4da'); disc(cx + R * 0.5, cy - R * 0.45, R * 0.22, '#c9661a'); break;
    case 'economic': plate(); blob(cx - R * 0.3, cy + R * 0.25, R * 0.38, R * 0.3, 0, '#f6f2e6'); blob(cx + R * 0.35, cy + R * 0.2, R * 0.3, R * 0.25, 0, '#e07a1a'); blob(cx - R * 0.15, cy - R * 0.4, R * 0.32, R * 0.22, 0, '#3f7a2a'); blob(cx + R * 0.35, cy - R * 0.35, R * 0.26, R * 0.2, 0, '#6b3a1a'); break;
    case 'sugarcane': g.fillStyle = '#e9efe6'; g.fillRect(cx - R * 0.42, cy - R * 0.75, R * 0.84, R * 1.5); g.fillStyle = '#b9d66a'; g.fillRect(cx - R * 0.36, cy - R * 0.45, R * 0.72, R * 1.14); disc(cx + R * 0.2, cy - R * 0.55, R * 0.1, '#7cc04a'); break;
    case 'kopi': disc(cx, cy, R, '#efe9de'); disc(cx, cy, R * 0.62, '#f8f6f0'); disc(cx, cy, R * 0.5, '#6a3a1a'); disc(cx - R * 0.1, cy - R * 0.1, R * 0.2, '#8a5a32'); break;
    case 'laksa': bowl('#e0782a'); strands('#f3e6b8', 14, s * 0.025); dots('#c7271a', 5, R * 0.08); dots('#5f9e3a', 7, R * 0.05); disc(cx + R * 0.2, cy + R * 0.1, R * 0.16, '#fbf3d8'); break;
    case 'satay': plate(); for (let k = 0; k < 5; k++) { const py = cy - R * 0.5 + k * R * 0.24; g.strokeStyle = '#c9a46a'; g.lineWidth = s * 0.015; g.beginPath(); g.moveTo(cx - R * 0.8, py); g.lineTo(cx + R * 0.5, py); g.stroke(); for (let m = 0; m < 4; m++) blob(cx - R * 0.5 + m * R * 0.25, py, R * 0.12, R * 0.08, 0, '#8a3a12'); } disc(cx + R * 0.55, cy + R * 0.45, R * 0.25, '#b9681e'); break;
    case 'hokkien': plate(); strands('#efe0a0', 22, s * 0.022); strands('#f6f2e6', 8, s * 0.03); for (let k = 0; k < 3; k++) blob(cx - R * 0.3 + k * R * 0.3, cy - R * 0.2, R * 0.16, R * 0.08, 0.6, '#ef7a3a'); disc(cx + R * 0.5, cy + R * 0.45, R * 0.12, '#6fbf3a'); break;
    case 'bcm': bowl('#4a2a16'); strands('#e3c070', 18, s * 0.02); dots('#7a4a2a', 16, R * 0.06, R * 0.45); dots('#3f7a2a', 6, R * 0.05); break;
    case 'duck': plate(); blob(cx - R * 0.3, cy, R * 0.4, R * 0.5, 0, '#f3ead2'); for (let k = 0; k < 5; k++) blob(cx + R * 0.28, cy - R * 0.45 + k * R * 0.22, R * 0.3, R * 0.1, -0.3, k % 2 ? '#5a2a12' : '#6e3818'); dots('#4f8f30', 3, R * 0.08); break;
    case 'ytf': bowl('#e2cf9a'); for (let k = 0; k < 6; k++) { const a = k * 1.05, px = cx + Math.cos(a) * R * 0.4, py = cy + Math.sin(a) * R * 0.4; g.fillStyle = k % 2 ? '#f4e7b8' : '#f6f2e6'; g.fillRect(px - R * 0.12, py - R * 0.1, R * 0.24, R * 0.2); } dots('#3f7a2a', 6, R * 0.09, R * 0.3); break;
    case 'oyster': plate(); blob(cx, cy, R * 0.66, R * 0.56, 0.3, '#e9b84a'); dots('#8a8478', 8, R * 0.07, R * 0.45); dots('#3f7a2a', 6, R * 0.05, R * 0.5); disc(cx + R * 0.6, cy - R * 0.5, R * 0.14, '#d8321e'); break;
    case 'tray': g.fillStyle = '#e9e6dc'; g.fillRect(cx - R * 0.8, cy - R * 0.55, R * 1.6, R * 1.1); disc(cx - R * 0.35, cy, R * 0.3, '#ffffff'); disc(cx + R * 0.35, cy, R * 0.3, '#ffffff'); disc(cx + R * 0.35, cy, R * 0.2, '#e6e1d6'); break;
  }
  // soft shading over the square: a little vignette and a top highlight, like a backlit photo
  const vg = g.createRadialGradient(cx, cy, s * 0.2, cx, cy, s * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = vg; g.fillRect(x, y, s, s);
  g.restore();
}

// one hawker lightbox in the 512x128 cell at (x, y): photo square on the left, the dish name, the stall number
function foodBoard(g, x, y, bw, bh, f, rnd) {
  const [zh, en, bg, fg, acc, dish, no, halal] = f;
  g.fillStyle = '#d9d9d4'; g.fillRect(x, y, bw, bh);
  g.fillStyle = bg; g.fillRect(x + 5, y + 5, bw - 10, bh - 10);
  const gr = g.createLinearGradient(0, y, 0, y + bh); gr.addColorStop(0, 'rgba(255,255,255,0.18)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = gr; g.fillRect(x + 5, y + 5, bw - 10, bh - 10);
  dishPhoto(g, x + 9, y + 9, bh - 18, dish, rnd);
  const tx = x + bh + 4, tw = bw - bh - 92, tcx = tx + tw / 2;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (!halal) {
    g.fillStyle = fg; fit(g, zh, `900 $px ${CN_SANS}`, tw, 66);
    g.fillText(zh, tcx, y + bh * 0.4);
    g.fillStyle = acc; fit(g, en, `bold $px ${SANS}`, tw + 50, 24);
    g.fillText(en, tcx + 25, y + bh * 0.82);
  } else {
    g.fillStyle = fg; fit(g, en, `900 $px ${SANS}`, tw, 50);
    g.fillText(en, tcx, y + bh * 0.42);
    g.fillStyle = acc; fit(g, zh, `bold $px ${SANS}`, tw + 50, 20);
    g.fillText(zh, tcx + 25, y + bh * 0.82);
  }
  // stall number plate (and the halal mark) at the top right
  g.fillStyle = '#ffffff'; g.fillRect(x + bw - 84, y + 12, 72, 30);
  g.fillStyle = '#1c1c1c'; g.font = `bold 20px ${SANS}`; g.fillText(no, x + bw - 48, y + 28);
  if (halal) { g.fillStyle = '#16632f'; g.beginPath(); g.arc(x + bw - 48, y + 72, 17, 0, Math.PI * 2); g.fill(); g.fillStyle = '#ffffff'; g.font = `bold 10px ${SANS}`; g.fillText('HALAL', x + bw - 48, y + 73); }
}

function fit(g, text, font, maxW, size) {
  let s = size;
  g.font = `${font.replace('$', s)}`;
  while (g.measureText(text).width > maxW && s > 10) { s -= 2; g.font = `${font.replace('$', s)}`; }
  return s;
}

export function makeSignAtlas() {
  const W = 2048, bw = W / SIGN_COLS, bh = 128, H = bh * SIGN_ROWS;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  let rs = 7;
  const rnd = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
  for (let i = 0; i < SIGN_COUNT; i++) {
    const x = (i % SIGN_COLS) * bw, y = Math.floor(i / SIGN_COLS) * bh;
    const kind = i < 34 ? 'cn' : i < 44 ? 'latin' : 'modern';
    const st = STYLES[kind === 'modern' ? 2 + Math.floor(rnd() * 5) : kind === 'latin' ? [3, 4, 2, 6][i % 4] : Math.floor(rnd() * 5)];
    // board with a raised frame and a little sun-bleaching gradient
    g.fillStyle = st[3]; g.fillRect(x, y, bw, bh);
    g.fillStyle = st[0]; g.fillRect(x + 6, y + 6, bw - 12, bh - 12);
    const gr = g.createLinearGradient(0, y, 0, y + bh); gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0.18)');
    g.fillStyle = gr; g.fillRect(x + 6, y + 6, bw - 12, bh - 12);
    const cx = x + bw / 2;
    if (kind === 'cn') {
      const [en, zh] = SHOPS[i];
      g.fillStyle = st[1];
      fit(g, zh, `bold $px ${CN}`, bw - 60, 70);
      g.fillText(zh.split('').join(zh.length < 5 ? ' ' : ''), cx, y + bh * 0.42);
      g.fillStyle = st[2];
      fit(g, en, 'bold $px Georgia, "Times New Roman", serif', bw - 50, 24);
      g.fillText(en, cx, y + bh * 0.82);
    } else if (kind === 'latin') {
      const en = LATIN[i - 34];
      g.fillStyle = st[1];
      fit(g, en, 'bold $px Georgia, "Times New Roman", serif', bw - 50, 50);
      g.fillText(en, cx, y + bh * 0.5);
      g.fillStyle = st[2]; g.fillRect(x + 40, y + bh * 0.82, bw - 80, 3);
    } else {
      const en = MODERN[i - 44];
      g.fillStyle = st[1];
      fit(g, en, '900 $px "Arial Black", "Helvetica Neue", Arial, sans-serif', bw - 50, 56);
      g.fillText(en, cx, y + bh * 0.52);
    }
  }
  // painted block-number digits: white paint mask in alpha, coloured in the shader
  const dy = 15 * bh, dw = W / 10;
  g.clearRect(0, dy, W, bh);
  g.fillStyle = '#ffffff';
  g.font = `bold ${Math.round(bh * 0.8)}px "Helvetica Neue", Arial, sans-serif`;
  for (let d = 0; d < 10; d++) g.fillText(String(d), d * dw + dw / 2, dy + bh * 0.53);
  // the hawker centre: stall lightboxes, the tray-return board, the NEA grade sticker (a square cell at the left)
  const cell = i => [(i % SIGN_COLS) * bw, Math.floor(i / SIGN_COLS) * bh];
  FOOD.forEach((f, k) => foodBoard(g, ...cell(FOOD_FIRST + k), bw, bh, f, rnd));
  {
    const [x, y] = cell(FOOD_FIRST + FOOD_COUNT);
    g.fillStyle = '#d9d9d4'; g.fillRect(x, y, bw, bh); g.fillStyle = '#145c36'; g.fillRect(x + 5, y + 5, bw - 10, bh - 10);
    dishPhoto(g, x + 9, y + 9, bh - 18, 'tray', rnd);
    g.textAlign = 'center'; g.fillStyle = '#ffffff'; fit(g, 'TRAY RETURN', `900 $px ${SANS}`, bw - bh - 30, 46);
    g.fillText('TRAY RETURN', x + bh + (bw - bh) / 2, y + bh * 0.38);
    g.fillStyle = '#dff2e4'; fit(g, '托盘回收处 · CLEAN TABLE', `bold $px ${CN_SANS}`, bw - bh - 30, 26);
    g.fillText('托盘回收处 · CLEAN TABLE', x + bh + (bw - bh) / 2, y + bh * 0.78);
  }
  {
    const [x, y] = cell(FOOD_FIRST + FOOD_COUNT + 1);
    g.fillStyle = '#ffffff'; g.fillRect(x, y, bh, bh);
    g.strokeStyle = '#1d4f9c'; g.lineWidth = 10; g.strokeRect(x + 8, y + 8, bh - 16, bh - 16);
    g.fillStyle = '#1d4f9c'; g.font = `900 78px ${SANS}`; g.fillText('A', x + bh / 2, y + bh * 0.5);
    g.font = `bold 13px ${SANS}`; g.fillText('NEA', x + bh / 2, y + bh * 0.86);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  return tex;
}

// Words bent in neon tube over the shopfronts at night (world/nightglow.js): the bar-street staples, and what this
// city's founders drink to
export const NEON_WORDS = [
  'BAR', 'KTV', 'LIVE BAND', '酒吧', 'OPEN 24H', 'SERIES A BAR', 'PIVOT CLUB', 'HAPPY HOUR',
  '卡拉OK', 'SHIOK!', 'BURN RATE', 'COCKTAILS', 'KIASU KTV', '火锅', 'SEED ROUND', 'ATAS BAR',
];
export const NEON_COLS = 2, NEON_ROWS = 8; // cells of 256 x 64

/** The neon words as a coverage mask (R8, 2 x 8 cells of 256 x 64, mip-mapped: far away a word is its average glow) */
export function makeNeonWordAtlas() {
  const W = 256 * NEON_COLS, H = 64 * NEON_ROWS;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  NEON_WORDS.forEach((w, i) => {
    const x = (i % NEON_COLS) * 256 + 128, y = Math.floor(i / NEON_COLS) * 64 + 33;
    // tube-weight strokes (~6 px at 40 px letters), a little air round each word so mips never bleed into the next
    const cjk = /[^\x00-\x7f]/.test(w);
    fit(g, w, cjk ? `$px ${CN}` : '600 $px "Avenir Next", "Helvetica Neue", Arial, sans-serif', 228, 42);
    g.fillText(w, x, y);
  });
  const rgba = g.getImageData(0, 0, W, H).data, px = new Uint8Array(W * H);
  for (let i = 0; i < px.length; i++) px[i] = rgba[i * 4];
  c.width = c.height = 0;
  const tex = new THREE.DataTexture(px, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = true;
  tex.flipY = false; tex.needsUpdate = true; tex.userData.releaseSource = true;
  return tex;
}
