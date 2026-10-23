// Adds a building-use code `u` to every building in public/data/city.json (run after tools/build-city.mjs):
//   node tools/building-uses.mjs
// The facade shader uses it to decide what a ground floor looks like: only retail/F&B (and unknown) buildings get
// shopfronts and hawker/kopitiam signboards; hospitals, schools, civic and religious buildings, homes, offices,
// hotels and industrial sheds get lobbies, plain doors and windows instead.
// Matching: each city building's centroid is looked up in the cached OSM building outlines (smallest containing
// outline wins) for its own tags, and in the cached POI areas (hospital grounds, places of worship, malls, hotels,
// police, museums...) for its context. Idempotent: rewrites `u` each run, leaves everything else byte-for-byte.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cityPath = join(here, '..', 'public', 'data', 'city.json');
const city = JSON.parse(await readFile(cityPath, 'utf8'));
const M = city.meta;
const proj = (lat, lon) => [(lon - M.lon0) * M.kx, -(lat - M.lat0) * M.kz];
const load = async n => JSON.parse(await readFile(join(here, 'cache', `${n}.json`), 'utf8')).elements;

// use codes (keep in sync with the facade shader in src/gfx/materials.js)
export const USE = { unknown: 0, retail: 1, health: 2, edu: 3, civic: 4, religious: 5, resi: 6, office: 7, hotel: 8, industrial: 9, parking: 10 };

function pointInRing(x, z, r) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const ringArea = r => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); };
// outer rings of a way / multipolygon relation (members carry geometry in the cached Overpass output)
function outers(el) {
  if (el.type === 'way' && el.geometry?.length >= 4) return [el.geometry.map(g => proj(g.lat, g.lon))];
  if (el.type === 'relation' && el.members) return el.members.filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry?.length >= 4).map(m => m.geometry.map(g => proj(g.lat, g.lon)));
  return [];
}
// grid of polygons for point queries
function index(items) {
  const cell = 100, grid = new Map();
  for (const it of items) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of it.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) for (let gz = Math.floor(z0 / cell); gz <= Math.floor(z1 / cell); gz++) {
      const k = gx * 100003 + gz; let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(it);
    }
  }
  return (x, z) => (grid.get(Math.floor(x / cell) * 100003 + Math.floor(z / cell)) || []).filter(it => pointInRing(x, z, it.ring));
}

const bldIdx = index((await load('buildings')).flatMap(el => outers(el).map(ring => ({ ring, t: el.tags || {}, area: ringArea(ring) }))));
const AREA_KINDS = new Set(['hospital', 'clinic', 'police', 'place_of_worship', 'mall', 'hotel', 'hostel', 'museum', 'food_court', 'theatre', 'marketplace', 'school', 'university', 'college']);
const areaIdx = index((await load('pois')).flatMap(el => {
  const t = el.tags || {}, k = t.amenity || t.tourism || t.shop;
  return AREA_KINDS.has(k) ? outers(el).map(ring => ({ ring, k })) : [];
}));

export function buildingUse(t, areas, name) {
  const b = t.building || t['building:part'] || '', am = t.amenity || '', nm = name || t.name || '';
  const A = new Set(areas);
  if (['hospital', 'clinic'].includes(b) || ['hospital', 'clinic', 'doctors', 'dentist'].includes(am) || t.healthcare || A.has('hospital') || A.has('clinic') ||
    /hospital|clinic|polyclinic|medical cent|health|dental|nursing home|hospice/i.test(nm)) return USE.health;
  if (['school', 'university', 'college', 'kindergarten'].includes(b) || ['school', 'university', 'college', 'kindergarten'].includes(am) || A.has('school') || A.has('university') || A.has('college') ||
    /\b(school|college|university|polytechnic|institute|academy|campus|kindergarten|pre-?school)\b/i.test(nm)) return USE.edu;
  if (['church', 'cathedral', 'temple', 'mosque', 'chapel', 'shrine', 'religious', 'synagogue', 'convent'].includes(b) || am === 'place_of_worship' || A.has('place_of_worship') ||
    /church|cathedral|temple|mosque|masjid|kuil|chapel|synagogue|gurdwara|shrine/i.test(nm)) return USE.religious;
  if (['government', 'civic', 'public', 'fire_station', 'courthouse', 'police'].includes(b) || t.office === 'government' ||
    ['police', 'courthouse', 'townhall', 'fire_station', 'community_centre', 'library', 'embassy', 'post_office', 'public_building', 'arts_centre', 'theatre', 'events_venue', 'conference_centre'].includes(am) ||
    A.has('police') || A.has('museum') || A.has('theatre') ||
    /ministry|police|court\b|supreme court|parliament|authority|fire station|community (club|centre)|library|embassy|high commission|consulate|museum|gallery|theatre|city hall/i.test(nm)) return USE.civic;
  if (b === 'hotel' || t.tourism === 'hotel' || t.tourism === 'hostel' || A.has('hotel') || A.has('hostel') || /\b(hotel|hostel|resort)\b/i.test(nm)) return USE.hotel;
  if (['retail', 'commercial', 'kiosk', 'supermarket', 'shophouse', 'yes;retail'].includes(b) || t.shop ||
    ['restaurant', 'cafe', 'fast_food', 'food_court', 'marketplace', 'bar', 'pub', 'bank'].includes(am) || A.has('mall') || A.has('food_court') || A.has('marketplace') ||
    /\bmall\b|plaza|market|food cent|hawker|arcade|shopping|square/i.test(nm)) return USE.retail;
  if (['industrial', 'warehouse', 'service', 'storage_tank', 'hangar', 'garage', 'garages'].includes(b) || t.power || t.man_made) return USE.industrial;
  if (b === 'parking' || am === 'parking') return USE.parking;
  if (b === 'office' || t.office) return USE.office;
  if (['residential', 'apartments', 'house', 'detached', 'semidetached_house', 'terrace', 'dormitory'].includes(b) || /residences?\b|condo|apartments?\b|suites\b/i.test(nm)) return USE.resi;
  return USE.unknown;
}

const counts = {};
for (const b of city.buildings) {
  let cx = 0, cz = 0; const n = b.p.length / 2;
  for (let i = 0; i < b.p.length; i += 2) { cx += b.p[i]; cz += b.p[i + 1]; }
  cx /= n; cz /= n;
  const hits = bldIdx(cx, cz).sort((a, c) => a.area - c.area);
  const t = hits[0]?.t || {};
  const u = buildingUse(t, areaIdx(cx, cz).map(a => a.k), b.n);
  if (u) b.u = u; else delete b.u;
  counts[u] = (counts[u] || 0) + 1;
}
// keep the file's key order: re-serialise compactly like build-city.mjs does
await writeFile(cityPath, JSON.stringify(city));
console.log('building uses:', Object.fromEntries(Object.entries(USE).map(([k, v]) => [k, counts[v] || 0])));
