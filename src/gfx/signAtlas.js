// Shop signboard atlas for the facade shader: 60 invented Singapore shop boards (4 x 15 grid of 512x128) in
// period styles, plus a row of painted HDB block-number digits (alpha = paint mask). Built once at load.
import * as THREE from 'three';

export const SIGN_COLS = 4, SIGN_ROWS = 16, SIGN_COUNT = 60; // row 15 = digits

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

function fit(g, text, font, maxW, size) {
  let s = size;
  g.font = `${font.replace('$', s)}`;
  while (g.measureText(text).width > maxW && s > 10) { s -= 2; g.font = `${font.replace('$', s)}`; }
  return s;
}

export function makeSignAtlas() {
  const W = 2048, H = 2048, bw = W / SIGN_COLS, bh = H / SIGN_ROWS;
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
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  return tex;
}
