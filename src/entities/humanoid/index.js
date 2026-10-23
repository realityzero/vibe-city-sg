// Procedural humans for Vibe City — no external assets.
//
// HERO CHARACTERS (Tommy, mission NPCs)
//   const h = createHumanoid({ preset: 'tommy', lod: 'high' | 'low', seed, colors: { skin, hair, shirt, pants, shoes } });
//   scene.add(h.root);  h.root.position.set(x, y, z);  h.root.rotation.y = yaw;
//   h.setAnim('walk', { blend: 0.2, speed: 1 });  h.update(dt);   // call every frame
//   h.lookAt(worldPos | null);  h.params.steer = -1..1 (for 'drive');  h.isAnimDone() (non-looping anims)
//   h.hands.left / h.hands.right: Object3D sockets in the palms for props (phone shown automatically in 'phone').
//   h.joints.{hips,spine,chest,neck,head,upperArmL,...}; h.height; h.dispose()
//   One SkinnedMesh + one shared material => 1 draw call (+ shadow). ~15k tris high, ~4.4k tris low.
//   Walk speed: anim 'walk' at speed 1 ≈ 1.4 m/s, 'run' ≈ 3.8 m/s, 'sprint' ≈ 5.5 m/s — scale `speed` with ground speed.
//
// PEDESTRIAN CROWD (one draw call for hundreds)
//   const crowd = new Crowd(400, { lod: 'high' | 'low' }); scene.add(crowd.mesh);
//   crowd.set(i, { x, y, z, yaw, anim: 'walk', speed: 1, phase: Math.random(), look: randomLook(seed, 'office_f') });
//   crowd.setCount(n); crowd.update(dt);
//   anims: idle walk run flee knocked idle_phone walk_phone sit sit_eat clap wave cheer talk (or CROWD_ANIM ids)
//   variants for randomLook: office_m office_f auntie uncle tourist student male female (omit = random mix)
//
// ORIENTATION: everyone faces -z at yaw 0 (facing vector = (-sin yaw, 0, -cos yaw)); feet at y = 0; right hand on +x.
export { Humanoid, createHumanoid, getHeroMaterial } from './humanoid.js';
export { Crowd, randomLook, CROWD_ANIM, CROWD_ACC, CROWD_HAIR } from './crowd.js';
export { PRESETS, resolveSpec, randomSpec, SKIN, HAIR } from './presets.js';
export { ANIMS } from './anims.js';
export const PRESET_NAMES = ['tommy', 'ken', 'lance', 'kyle', 'auntie', 'uncle', 'investor_m', 'investor_f', 'office_m', 'office_f', 'tourist', 'student', 'police', 'hawker', 'random'];
export const ANIM_NAMES = ['idle', 'walk', 'run', 'sprint', 'jump', 'fall', 'land', 'sit', 'sit_type', 'talk', 'phone', 'wave', 'cheer', 'drive', 'enter_car', 'exit_car', 'flee', 'knocked', 'handshake', 'point', 'dance', 'swim', 'tread', 'climb_out', 'punch'];
