// Hand-built procedural Singapore landmarks placed at their true positions (x east, z south, metres).
import * as THREE_NS from 'three';
import { triCount } from './common.js';
import { buildMBS } from './mbs.js';
import { buildArtScience } from './artscience.js';
import { buildGardens } from './gardens.js';
import { buildFlyer } from './flyer.js';
import { buildEsplanade } from './esplanade.js';
import { buildMerlion } from './merlion.js';
import { buildHelix } from './helix.js';
import { buildHeritage } from './heritage.js';
import { buildSkyline } from './skyline.js';
import { buildCivic } from './civic.js';
import { nextTask } from '../../core/nextTask.js';

const BUILDERS = [
  ['mbs', buildMBS],
  ['artscience', buildArtScience],
  ['gardens', buildGardens],
  ['flyer', buildFlyer],
  ['esplanade', buildEsplanade],
  ['merlion', buildMerlion],
  ['helix', buildHelix],
  ['heritage', buildHeritage],
  ['skyline', buildSkyline],
  ['civic', buildCivic],
];

/**
 * @returns {Promise<{group, exclusions, colliders, reflective, update, pois, stats}>}
 */
export async function createLandmarks({ THREE = THREE_NS, city, renderer, quality = 'high', isWater = () => false } = {}) {
  const group = new THREE.Group(); group.name = 'landmarks';
  const exclusions = [], colliders = [], reflective = [], pois = [], updaters = [], perLandmark = {}, clearings = [];
  const env = { isWater }; // what builders may ask about the site (the ground mask)
  for (const [name, build] of BUILDERS) {
    // a task boundary between landmarks (awaiting a synchronous builder only queues a microtask, which lets no tap
    // through): the whole set was one ~0.5 s task on a phone
    await nextTask();
    const r = await build(city, quality, renderer, env);
    group.add(r.group);
    exclusions.push(...(r.exclusions || []));
    colliders.push(...(r.colliders || []));
    reflective.push(...(r.reflective || []));
    pois.push(...(r.pois || []));
    clearings.push(...(r.clearings || []));
    if (r.update) updaters.push(r.update);
    let calls = 0; r.group.traverse(o => { if (o.isMesh || o.isPoints) calls++; });
    perLandmark[name] = { tris: triCount(r.group), calls };
  }
  const stats = { tris: Object.values(perLandmark).reduce((a, b) => a + b.tris, 0), calls: Object.values(perLandmark).reduce((a, b) => a + b.calls, 0), perLandmark };
  console.log('[landmarks]', JSON.stringify(stats));
  return {
    group, exclusions, colliders, reflective, pois, stats, clearings,
    update(dt, env = {}) { for (const u of updaters) u(dt, env); },
  };
}
