// Fetches the raw OpenStreetMap data for central Singapore from Overpass and caches it.
// Data © OpenStreetMap contributors, ODbL. Run: node tools/fetch-osm.mjs
import { writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(here, 'cache');
export const BBOX = { s: 1.268, w: 103.822, n: 1.306, e: 103.876 };
const bb = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;
// A slightly larger box for coastline so that ways crossing the edge are complete.
const bbWide = `${BBOX.s - 0.02},${BBOX.w - 0.02},${BBOX.n + 0.02},${BBOX.e + 0.02}`;

const QUERIES = {
  buildings: `[out:json][timeout:180];
(
  way["building"](${bb});
  way["building:part"](${bb});
  relation["building"](${bb});
  relation["building:part"](${bb});
);
out body geom;`,
  roads: `[out:json][timeout:180];
(
  way["highway"](${bb});
);
out body geom;`,
  water: `[out:json][timeout:180];
(
  way["natural"="water"](${bb});
  relation["natural"="water"](${bb});
  way["waterway"~"riverbank|canal|river|dock"](${bb});
  relation["waterway"="riverbank"](${bb});
  way["natural"="coastline"](${bbWide});
  way["natural"~"beach|sand"](${bb});
);
out body geom;`,
  green: `[out:json][timeout:180];
(
  way["leisure"~"park|garden|pitch|golf_course|nature_reserve|playground|common"](${bb});
  relation["leisure"~"park|garden|nature_reserve"](${bb});
  way["landuse"~"grass|forest|recreation_ground|village_green|meadow|cemetery|construction|railway|religious"](${bb});
  relation["landuse"~"grass|forest|recreation_ground"](${bb});
  way["natural"~"wood|scrub|grassland|heath|wetland"](${bb});
  relation["natural"~"wood|scrub"](${bb});
  way["amenity"="parking"](${bb});
  way["area:highway"](${bb});
  way["man_made"~"pier|bridge|breakwater"](${bb});
);
out body geom;`,
  trees: `[out:json][timeout:180];
(
  node["natural"="tree"](${bb});
  way["natural"="tree_row"](${bb});
);
out body geom;`,
  rail: `[out:json][timeout:180];
(
  way["railway"](${bb});
  way["aerialway"](${bb});
);
out body geom;`,
  pois: `[out:json][timeout:180];
(
  node["amenity"~"food_court|restaurant|cafe|bar|pub|fast_food|marketplace|bank|place_of_worship|police|hospital|fuel|cinema|theatre|coworking_space"](${bb});
  way["amenity"~"food_court|marketplace|place_of_worship|police|hospital|fuel|cinema|theatre"](${bb});
  node["tourism"](${bb});
  way["tourism"](${bb});
  node["shop"~"mall|department_store|convenience"](${bb});
  way["shop"~"mall|department_store"](${bb});
  node["office"="coworking"](${bb});
  node["highway"~"traffic_signals|bus_stop|street_lamp"](${bb});
  node["public_transport"="station"](${bb});
  node["railway"~"station|subway_entrance"](${bb});
);
out tags center;`,
};

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function run(name, q) {
  const out = join(cacheDir, `${name}.json`);
  if (await exists(out) && !process.argv.includes('--force') && !process.argv.some(a => a.startsWith('--only='))) { console.log(`cached ${name}`); return; }
  const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  for (let attempt = 0; attempt < 4; attempt++) {
    const url = endpoints[attempt % endpoints.length];
    try {
      const t0 = Date.now();
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': 'VibeCitySG/0.1 (browser game prototype)', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const txt = await res.text();
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, txt);
      const n = JSON.parse(txt).elements.length;
      console.log(`fetched ${name}: ${n} elements, ${(txt.length / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      return;
    } catch (e) {
      console.warn(`${name} attempt ${attempt} failed: ${e.message}`);
      await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
    }
  }
  throw new Error(`failed to fetch ${name}`);
}

const only = process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',');
for (const [name, q] of Object.entries(QUERIES)) if (!only || only.includes(name)) await run(name, q);
