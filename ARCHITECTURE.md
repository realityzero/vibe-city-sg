# Grand Theft Auto: Vibe City (Singapore) — architecture & conventions

Browser-only open-world game. Tommy Vercetti lands in Singapore, vibe-codes a startup and raises a Series A.
Three.js r186 (WebGL2) + Rapier3D (WASM physics) + Web Workers + Web Audio. Vite dev server, vanilla ES modules (no TS).

## Run
```
npm run dev            # http://127.0.0.1:5173  (main game: index.html)
npm run data           # regenerate public/data/* (fetch-osm uses tools/cache when present, build-city, building-uses)
```
Dev/test pages live in `dev/*.html` (served by the same Vite server, e.g. http://127.0.0.1:5173/dev/landmarks.html).
Headless screenshots: `node tests/shot.mjs <url> <out.png>` (Playwright chromium; see tests/).

## World conventions (IMPORTANT)
- Units: metres, seconds, radians. **x = east, z = south, y = up. North is -z.**
- Projection from OSM: `x = (lon - 103.849) * 111292.0`, `z = -(lat - 1.287) * 110574` (see public/data/city.json `meta`).
- World extents ≈ x ∈ [-3005, 3005], z ∈ [-2101, 2101].
- Ground (land) at y = 0. Water surface (Marina Bay, river, sea) at **y = -1.4** (`WATER_LEVEL` in src/core/constants.js).
- Singapore drives on the **left**.
- Game time: hours 0..24 (`env.time`), 1 real second ≈ 1 game minute in free roam.

## Data (public/data)
- `city.json` — `{meta, buildings[], roads[], graph{nodes,edges}, trees[], rail[], pois[]}`
  - building: `{id, p:[x0,z0,x1,z1,...] outer ring, ho?:[[...]] holes, h:height, m?:minHeight, s:style, l:levels, c?:wallColor int, rc?:roofColor int, r?:roofShape, rh?:roofHeight, n?:name, pt?:1 if building:part}`
  - style ids: glass 0, office 1, resi 2, hdb 3, shophouse 4, lowrise 5, civic 6, parking 7, canopy 8, industrial 9, station 10
  - road: `{p:[...], c:class(0 motorway..5 residential,7 service,8 pedestrian,9 footway), w:width, lf?, lb? lanes fwd/back, o?:oneway, b?:bridge, y?:[elev per vertex], cv?:covered, n?:name, x?:crossing}`
  - bridge decks (`tools/bridge-decks.mjs`): spans that meet are one structure whatever their OSM `layer`; each wants a
    deck height (a named bridge's real one — Benjamin Sheares 27 m, Merdeka, Esplanade, Bayfront, the Helix; 6.8 m a
    layer over a road; else a low arch over the river, a canal or a drain) and comes down only at the structure's free
    ends. Ground ways leaving a span mid-way (slip roads, stairs, short gaps between spans) and the approaches of flyovers
    too short to climb (through an interchange's junctions if need be, never the road crossed) are lifted and split (the
    raised part becomes a bridge way). Grades ≤ 6 % on roads (stair-steep on footbridges), 40 m sag curves, rounded
    crests. The build fails (`validateBridges`) on a deck that dips to the ground between raised spans, steps where two
    meet, or climbs steeper than its grade.
- `ground.png` — 2 m/px RGBA mask over the bbox. R: 255 land / 128 pond / 0 water. G: vegetation (255 park/grass, 180 woods, 100 pitch). B: paving (255 plaza, 220 sidewalk, 200 parking, 150 building apron).
  A: signed distance (+-3 m) from the texel's centre to the edge of its ground class, measured on the vector geometry the
  raster came from (`tools/ground-sdf.mjs`): the ground shader interpolates it into crisp sub-texel class edges, with
  kerbs, edging courses and the quays' granite coping along them; seawalls follow the same contour. Read it with
  `world/groundmask.js` (a canvas premultiplies colour by alpha: the class codes would come back rounded);
  `City.waterEdge(x, z)` is the drawn waterline as a distance (shore shelf, landmark sites).

## Shared runtime contracts
- `src/gfx/globals.js` exports shared uniform objects (`U.time`, `U.night` 0..1, `U.rain` 0..1, `U.wet`, `U.sunDir`, `U.wind`) — any custom shader may reference them; the engine updates them every frame.
- Everything that animates exposes `update(dt, env)` where `env = { time (hours), night (0 day..1 night), rain (0..1), camera, playerPos (THREE.Vector3) }`.
- Materials: physically based (`MeshStandardMaterial`/`MeshPhysicalMaterial`). `scene.environment` is a PMREM of the procedural sky, so metal/glass reflect automatically. Night lights = emissive (bloom picks up values > 1 via emissiveIntensity). Use `U.night` to fade emissive.
- Performance budget (target: Apple M1/M2 integrated GPU, 60 fps): merge static geometry (`BufferGeometryUtils.mergeGeometries`), instance repeated parts, share materials, avoid per-frame allocations. Whole frame (shadow + reflection + main) ≈ 600 draw calls, ~3M triangles.

## Frame-time hygiene (no hitches)
- `Game.warmUp()` runs behind the title screen: prebuilds every traffic/hero vehicle asset, sets the final environment map, compiles every program with `compileAsync` **while a render target is bound** (output colour space is part of the program key), uploads all geometry in batches through an ortho camera, then renders one real frame with every optional post pass on and every shadow caster unculled (so depth-material variants exist). `node tests/scratch/newprogs.mjs` must report **0** programs compiled after warm-up — anything created later (missions, cheats) should reuse existing material types.
- Create materials/meshes at load and toggle `visible`; never add/remove lights at runtime (light count is in every lit program's key — `fx.flash` and `wanted.spot` are permanent, intensity-animated). Shadow type is `PCFShadowMap` (r186 silently swaps `PCFSoftShadowMap`, recompiling everything).
- Transparent `DoubleSide` materials get `forceSinglePass` (three.js otherwise flips `side` and bumps `material.version` twice per draw → a full program lookup every frame).
- No layout reads in per-frame UI (`ResizeObserver`-cached sizes; `restartClass()` instead of the `offsetWidth` reflow trick). Dynamic resolution resizes at most every few seconds (median frame time, hysteresis, back-off) because each resize reallocates every post target.
- Instanced pools upload only their live prefix (`addUpdateRange`); particle pools hide themselves when empty. Line-of-sight BVHs are built for mission locations during warm-up and the rest in idle time while menus are up.
- Tools: `tests/hitch.mjs` (start flow + clicks/pause/map with long-task attribution), `tests/profspikes.mjs` (busy spans in a CPU profile), `tests/scratch/newprogs.mjs`, `tests/scratch/matflip.mjs` (materials forcing per-draw program switches), `dev/sky.html` (sky look-dev bench).

## Frame pacing, resolution and GPU budget
- `Game.loop()` paces ticks to a 60 Hz deadline: on 120/144 Hz displays the in-between rAF callbacks are skipped (an
  M1/M2 can't draw the city at 120; steady 60 beats uneven 70-90). Each 60 Hz slot that passes without a tick counts as
  *missed*; `Renderer.trackFrame()` steps resolution down after two one-second windows with >2% missed slots (unless the
  CPU is the limit) and probes back up with backoff — down to 0.75 of the preset's pixel ratio, then the water's
  mirror of the city goes (`onShed`), and only then lower. `gpuBegin/gpuEnd` time reflection + render with
  `EXT_disjoint_timer_query_webgl2` (a headroom hint; it includes CPU-submission gaps).
- Base M1 / M2 GPUs (`Renderer.detectGpu()`) start with a lower pixel ratio cap (1.0 / 1.15); the user's resolution
  scale (`setResolutionPreference`) multiplies it.
- The sky draws **after** the opaque city (`renderOrder 0.5`; the Sky shader sits on the far plane) — drawn first, its
  cloud raymarch ran for every pixel. The water reflection renders only when an occlusion query says water was on screen
  last frame, or roads are wet (then it mirrors about the street plane, `REFL.road`); the city swaps to cheap facade
  materials for it (`city.setReflectionMaterials`). Every light is also on `REFLECT_LAYER` (one light state for all
  passes: no 0-light program variants, sunlit reflections, stable shadow-depth program keys). On Low the reflection is
  *lite* (`reflections: 'lite'`): quarter resolution, water only, built from one camera pose over 8 frames (an eighth
  of the mirrored city each — dealt per pose by triangles in its frustum, the city batches as two halves of alternate
  chunks) into a back buffer swapped in when complete, and smeared into vertical streaks by the water shader — the bay
  at night mirrors the lit city for ~0.2-0.3 ms a frame on an M2 instead of ~1.3 ms. `tests/scratch/waterab.mjs` (A/B cost), `reflcheck.mjs` (per-slice cost),
  `watermotion.mjs` (contact sheets of the water in motion).
- One `scene.updateMatrixWorld()` per frame; renders inside the frame run with `matrixWorldAutoUpdate = false`.
- The ground plane is cut into 24 m cells: all-land cells use a shader without `discard` (so early depth rejection skips
  it under roads, pavements and buildings — `discard` disables early-Z on Apple GPUs), cells touching water use the
  discarding shore variant, pure-water cells are dropped; ground draws after the other opaques (`renderOrder 0.4`).
- City walls/roofs/roads/footways/structures are one `BatchedMesh` per category (multi-draw, per-chunk culling); near-only
  detail (piers, five-foot-way floors, laundry poles) lives in `wallsNear`/`structNear` within 520 m.
- **Height field** (`gfx/heightfield.js`): the static city rendered once from straight above into a 2.5 m/px height
  texture at load. City materials (`patch()` in materials.js) ray-march it toward the sun beyond the shadow map's box
  (far-field shadows to ~0.9 km) and sample it for street-canyon sky occlusion; tree impostors take the sun term per
  vertex, the water its far-field sun shadow (no hard-edged shadow-map box on the bay). `?nohf` disables it.
- **Sun shadow map** (`sky.js`, `gfx/shadowfit.js`, `gfx/shadowfilter.js`): the map serves the circle of `shadowRadius`
  round the player, the height field beyond it. Its box is a fixed square (0.62 of that radius: ~1.6x the texel
  density of a box centred on the player), fitted each frame to what the camera sees of the circle and snapped to
  whole texels, so edges don't crawl as the view moves; where it can't reach (far corners of a wide view, tall
  facades) the height field shades (`hfMapOut()`). PCF is a rotated 4-tap tent — three's taps turn by per-pixel noise,
  a fixed dot pattern without TAA — and fades out across the box's edge band.
- **Height fog** (`gfx/heightfog.js`) replaces three's fog chunks: exp² fog whose density thins with altitude. Its
  colour is the haze: `SkySystem.captureHaze()` renders the sky at 6.5° in 8 directions into an 8x1 target with each
  env refresh and reads it back asynchronously; the sky shader blends its lowest band into the same colour, so the
  sea plane and the farthest towers dissolve into the horizon at every time of day.
- The grade aims at a pastel postcard by day and magenta/violet at night. Day: a cyan-leaning dome over a turquoise
  haze (`skyGain` dims Preetham's white-paper horizon). Golden hour (~17:30-19:15) and dusk live in the sky shader (a
  coral-to-lilac dome held bright until sunset, pink-lit cumulus, sun-side glow and glare, Belt of Venus, a violet
  twilight dome after sunset; the environment capture adds a gold flare toward the low sun, so glass facing it
  glows), `SkySystem.update` (sun colour temperature, peach fill and warm bounce, a little more haze) and
  `FilmGradeEffect` (`uGolden` warms the white balance of sunlit warm tones, `uNight` the violet/magenta neon grade).
  Night: the urban sky glow (a mauve band over the skyline, violet zenith, city-lit cloud bases) is also the haze
  colour, so towers stand in it. Night light is emissive only, no lights: `world/nightglow.js` (shop light pools on
  the pavements and neon on the shop fronts — framed signboards, blade signs, eave lines — instanced near the camera,
  thick in the nightlife quarters), street-lamp coronas (`Props`), and the baked street-light map (street lamps, lane
  and plaza lights), which lights roads, pavements, people, cars and the facades' lower floors; facades also take the
  shop light from under their five-foot-ways, fading up the wall, while the upper storeys see only the sky glow.
- Budget at High, 1800x1125 on an M2: ~5-8 ms GPU for reflection + main render, 450-580 draw calls (incl. shadow and
  reflection passes), 2.5-3.3M triangles. `node tests/perf.mjs` drives Claudia's autopilot route Tanjong Pagar -> Marina
  Bay; `tests/gpuframe.mjs` measures per-feature render cost (interleaved A/B), `tests/gpuprof.mjs` per-draw GPU time,
  `tests/cpuprof.mjs` the hottest functions and per-system cost inside `Game.tick`.

## Phones (iPhone 12 / iOS Safari): memory and touch
iOS kills a Safari tab whose footprint passes roughly 1.5 GB on a 4 GB phone (less under pressure) — the symptom is a
reload a few seconds into the load. What counts: the WebContent process (JS heap, typed arrays, WASM, **Web Worker
threads**) plus what the GPU process allocates for the tab (textures, vertex buffers, IOSurfaces: 2D canvases and
composited layers at device scale, ~12 MB per full-screen layer on an iPhone 12). JavaScriptCore lets garbage pile up
for a while, so allocation *churn* during the load matters as well as what stays alive.
- **City worker** (`cityBuilder.worker.js`): growable typed buffers start small (every chunk owns ~40) and grow / trim
  with `ArrayBuffer.transfer` (old memory released at once, not at the next GC); vertices go through the positional
  writers (`wv/sv/rv/dv`, `p1..p4`) — no object or array literal, spread or string key per vertex. Its output is
  checked bit-identical with `tests/mobile/workerhash.mjs`; `tests/mobile/workermem.mjs` / `workerallocs.mjs` measure it.
- **Road network** (`world/roadnet.js`): every lane, sidewalk and junction-connector point lives in one packed
  `PathStore` (doubles; a `Path` is an offset + count into it), built with scalar math — no array per point or typed
  array per path. `tests/mobile/roadnethash.mjs` fingerprints everything it builds (bit-identical refactors) and
  reports the build's allocations.
- Static textures drop their canvases / bitmaps after upload (`gfx/texrelease.js`); static geometry drops its arrays
  (`gfx/geomrelease.js`) and stores unit normals as normalized `Int8x4` (also the worker's output). Vehicle atlases go
  to the GPU at half size on Low (`setAtlasGpuScale`) — what a ~630 px wide phone render samples anyway.
- Convolution reverbs exist only while something plays through them (`LazyReverb`): WebKit keeps ~7 MB per second of
  stereo impulse response per `ConvolverNode`, playing or not.
- Nothing 3D is drawn under the opaque loading screen. The warm-up upload pass keeps the lights in (no 0-light twin of
  every program; each program is ~0.6 MB on iOS) and renders the shadow map once on its first batch (WebKit rejects
  draws that sample a never-rendered shadow map).
- Loading runs in task-sized slices so taps on the splash / title / loading screen are answered: `await nextTask()`
  (`core/nextTask.js`, a MessageChannel task boundary — nested `setTimeout(0)` is clamped to 4 ms, ~1 s over a load)
  between steps and inside the heavy ones. `await someSyncFunction()` only queues a microtask and lets no input through.
- Static props scattered over the city (MRT kiosks, ERP / expressway gantries) are merged per material into one mesh
  each (`gfx/mergeStatic.js`): ~120 fewer draw calls a frame. Transparent parts stay separate (sorted per mesh).
- Hero vehicles (player, parked, mission, police) are a *rig* (`vehicles/model.js` `heroRig`, `material.js` `RIG_PARS`):
  per type, one body geometry that also holds the moving parts (pop-up lamps, rotor blades) and one wheel geometry
  drawn once per wheel by an instanced draw. A `part` vertex attribute picks a matrix from the car's `uPart[]`, mirrored
  from the wheel / lid / rotor Object3Ds before each render (they stay the API: `wheels`, `wheelPivots`, `rotors`); a
  custom depth material moves the same parts in the shadow pass. Lamps were already per-vertex light channels switched
  by the per-car `uLights`. A car is body + wheels + glass (3 draws, ~12 before); `tests/scratch/vehdraws.mjs` counts
  them, `heroshots.mjs` diffs posed close-ups against another build, `heroprogs.mjs` checks for post-warm-up programs.
- Static geometry normals: 8-bit normalized; facades 16-bit (glass mirrors the sky) and packed so each wall keeps its
  `wallId` bin (the facade shader seeds weathering from the wall's orientation). `?f32normals` for A/B.
- Cutscene line of sight (`core/visibility.js`) uses the physics world plus *sight-only* colliders the city builder
  emits for what nothing collides with (pitched roofs, gables, arcade / void-deck ceilings, covered walkways):
  `FILTER.sightRay` sees them, driving and walking don't.
- Radar tiles: 12 cached during play, 40 while the full-screen map is open (trimmed when it closes).
- Image on a phone: Low renders at 0.8 x CSS pixels (iPhone 12 landscape ~675x312). `gfx/taa.js` resolves it
  temporally at that resolution, ahead of bloom and tone mapping: the projection is jittered (Halton 2,3), last
  frame's result reprojected from depth and the two camera poses, clipped to the new 3x3 neighbourhood (variance box,
  YCoCg, on reversibly tone-mapped colour) and blended at 1/10 (up to 3/10, with a tighter box, the faster the view
  sweeps: a history resampled every frame softens). Cars and people have no motion vectors: their materials write a
  stencil mark (`markMoving`: vehicles/material.js, humanoid.js, crowd.js; render state, no new program) and the
  resolve runs once per mark — moving things take only last frame's same pixel, weighted lightly, and only if a
  moving thing was there; the static world refuses history where one stood (the history's alpha remembers), so
  nothing leaves a trail or fades in like a ghost; the player's vehicle (`taa.carry`) is one rigid body with two
  known poses, reprojected exactly through them. `gfx/upscale.js` then sharpens (FSR 1 RCAS) and analyses edges at
  the internal resolution and draws the canvas at 1.5 x CSS pixels with FSR 1's EASU (edge-adaptive, no ringing)
  instead of the browser's bilinear ~3.75x stretch (2 x looked hardly better and cost the A14 ~0.7 ms more); the
  canvas has no depth buffer. `?notaa` (FXAA instead) and `?noupscale` switch them off for A/B;
  `tests/scratch/phoneimgshots.mjs` (stills of variants on the same frame),
  `taamotion.mjs` (consecutive frames stepped at 1/60 s: crawl and ghosting), `passcost.mjs` / `phoneimgab.mjs`
  (cost). Wide phones see no more across than a 16:9 screen while playing (`camera.zoom` from `CameraRig`; FOVs stay
  vertical — read `camera.getEffectiveFOV()`), which frees the draws that pay for the extra pixels; shots that frame a
  subject (`cameraRig.override`: cutscenes, photo mode, test views) keep the vertical FOV they were framed with and
  see wider instead, easing back into the cap as play resumes. Geometry thinner than a pixel is
  pre-filtered rather than left to alias: a ribbon at least a pixel wide with opacity = true coverage (Flyer spokes),
  coverage-anti-aliased lines (MBS lasers), alpha blending to the mip-averaged coverage (Supertree lattice), an average
  normal + wider roughness once facets are a few pixels big (Esplanade shades).
- Touch: the splash answers `pointerup`/`click`/`keydown` (iOS unlocks audio only in those), eats the ghost click that
  follows, and creates the AudioContext synchronously in the gesture. Small touch controls get their own layers so the
  full-screen overlay has no backing store.
- Harness (`tests/mobile/`, WebKit = Safari's engine, iPhone 12 profile): `iphone.mjs` (cold start with real taps:
  splash, title, loading, intro, stick, look, JUMP; memory per phase; `--pressure` sends WebKit's low-memory signal
  every second as iOS does near the limit), `loadsteps.mjs` (live memory per load step, `--cats` for GPU-process
  categories), `longtasks.mjs` / `cpuwindow.mjs` (load tasks at 1.6x CPU throttle ≈ A14), `visual.mjs` (PSNR A/B of
  fixed views against a variant or another build), `gpusplit.mjs` (frame cost by subsystem at phone settings),
  `gpubuffers.mjs`, `drawcalls.mjs`, `textures.mjs`, `programs.mjs`, `uilayers.mjs`, `census.mjs`, `allocs.mjs`,
  `workermem.mjs` / `workerallocs.mjs` / `workerhash.mjs`, `roadnethash.mjs`, `steptimes.mjs` (load time at 1.6x),
  `wkattr.mjs`, `turns.mjs` / `trafficcpu.mjs` (AI traffic).

## Physics, driving and placement
- Physics steps at a fixed 60 Hz. Bodies are drawn at `lerp(previous, current, alpha)` (`PoseInterp` in physics.js,
  captured in `onPostStep`), so motion is smooth at any refresh rate; Tommy is seated after the vehicles sync. Vehicle
  controls are *stored* by `setDriverControls()` (player, AI, autopilot) and applied per fixed step in
  `Physics.beforeWorldStep`, after every controller callback has run; AI (`PathDriver`) steers from the simulated body,
  not the interpolated root. With `follow` (Claudia's autopilot) it keeps 3 m + 1.2 s behind the traffic car on its
  route ahead.
- `Vehicle`: centre of mass ~0.45 m up, steering lock limited by a lateral-acceleration budget and slower at speed,
  ramped pedals (brake wins over throttle; reverse after a short stop), brakes as impulses (force × h), yaw-rate assist,
  inertia-normalised bike balance, support-faded downforce. Parked cars may sleep; input or impacts wake them.
  `tests/drivefeel.mjs [60|120|var] [car]` measures judder (car velocity jerk, camera-relative shake, seat offset).
- **AI traffic** (`entities/traffic.js`) moves on the lane graph (progress `s` along lanes / junction connectors, IDM
  car-following with per-driver temperament) but is drawn as a kinematic bicycle: the rear axle rolls along its heading,
  the front wheels steer by pure pursuit of the route ahead, so the heading only changes as the car rolls; `s` is kept
  at the body's projection. Speed is planned for the bends ahead (`Path.bends()`: comfortable lateral acceleration,
  gentle braking before the corner), indicators blink before and through turns, bodies roll / dive / squat on a spring
  (`TrafficRenderer.setTransform` tilt: body only, wheels stay down). Junctions: amber commits a car that can't stop
  smoothly; crossings resolve first come, first through (nobody in a junction waits for a car still to come in, so
  nobody waits in a circle), merges in turn by distance to the merge, like a zip. Cars keep to their lane
  (`Traffic._keep`): where a road carries on, the lane graph links every lane to every lane, so a car takes the lanes
  nearest its own place across the carriageway, and where roads split or merge the lanes nearest where its lane ends.
  Where OSM draws a dual carriageway's two ways closer together than their width (~230 lanes, e.g. the ECP by
  Sheares), the inner lanes of both run over each other and across the other deck's kerb; traffic keeps off such a
  lane (`_squeezed`) where its road has another, and nothing appears on it.
  The leader search (`leaderGap`) follows the car's route through the next two junctions — lanes inside a big junction
  are a few metres long — and sees cars heading into the same lane (two lanes into one) and, where OSM's ways join or
  part at a shallow angle so that the lanes of both roads overlap for some metres before / after the junction
  (`_joins` / `_splits`, found per lane the first time it's needed), the cars on the other road's lane as if on its own.
  Spawns (`_canSpawn`) count those too, and never come within 25 m of the player. `holdWay(steps)` / `release()` keep a
  run of road clear (Ah Beng's drag race): nobody appears on it, cars ahead on it are let go out of sight or move over a
  lane, and traffic whose way crosses or joins it waits at the line. Beyond 140 / 200 m from the camera a car is driven
  every 2nd / 3rd frame. Traffic lives around the **camera** (`Traffic.viewer`, like the crowd) and is spent where it
  looks: the quota (`target` x an hourly curve: rush hours full, a lull after midnight) appears in view beyond 170 m or
  behind a building (one sight test a tick), just off the edges of the view ahead, or near the camera; cars left behind
  it out of sight are let go first. A camera cut or `Game.relocate` fills the new view at once, with queues at red lights
  and buses standing at their stops. Big roads get more of it (per-class spawn chance); expressways flow in platoons.
  Past `farFrom` (110 m on Low, 220 m on High) from the camera and 100 m from the player a car is a **far stand-in**: no
  physics body, drawn as a painted box with a glasshouse and lamps scaled to its type (two instanced draws for all of
  them, sharing the wheels' material); it still drives the lane graph. Buses (kerb lanes) pull up at the StreetProps
  shelters on their lane, indicate in and out, and stand 8-18 s. Parked cars (`world/parking.js`): along one kerb of the
  service roads and reversed into the bays of open car parks, found per 120 m cell and kept; the nearest are Traffic
  cars in state `parked` (no AI, solid near the player, stolen with `take`, knocked loose with `wreck`).
  `tests/mobile/carcount.mjs` counts the cars (and boats) visible in the gallery's road / water views, and any cars
  inside each other (the player's included). `tests/mobile/turns.mjs` measures it (yaw rate, lateral acceleration,
  jerk, turn speeds, off-line distance, overlapping cars, red-light runs, stuck cars; `--strip` films a left and a right
  turn from above); `tests/scratch/overlaps.mjs` classifies every overlapping pair (same lane, merge, roads alongside,
  junction conflict, fresh spawn...) and lists who long-waiting cars wait for;
  `tests/mobile/trafficcpu.mjs` times `Traffic.update` at phone settings.
- **Boats** (`world/boats.js`): ten river taxis loop the Singapore River (to starboard of its middle, turning at
  Robertson Quay) and Marina Bay, one more and a DUCKtours amphibious bus circle an inner bay loop, ships lie at anchor
  in the strait. Loops are Catmull-Rom through the channel middle with bend speeds; boats keep their distance, stop for
  the player's craft or a swimmer (and nudge it aside after 5 s), are kinematic bodies, and push an additive wake.
  `tests/scratch/boatroutes.mjs` checks every loop sample and anchorage against the water mask and sails the fleet.
- The follow camera uses frame-rate independent smoothing, a softer vertical follow and a fast-but-not-instant pull-in.
  Thin occluders between it and Tommy (trunks, lamp posts, traffic-light poles: `core/occluders.js`, from the tree /
  lamp grids) are cut by pushing the near plane just past them — never into the subject or the ground at the screen's
  foot. On phone-sized screens the chase view sits further back and higher. Cutscene overrides can `track(camera, dt)`
  (run after the world moved, so a tracking shot stays locked to the interpolated car); `blendFrom()` eases a
  cutscene's last shot into the follow view.
- Driving juice (`world/juice.js`): near misses (boxes on the ground plane followed through the pass) pay cash and hype
  with a popup and a FOV kick; sparks from the contact point of every player scrape (`Vehicle.onImpact` hook, Rapier
  pair manifold); 0.3 s slow motion on big crashes; view-space Kopi Gao speed lines. Pooled, created at load.
- New game: mission 1 opens cold (`missions/coldopen.js`): sunset on the Esplanade Drive bridge, a tracking shot of the
  Infernus, a radio ident and the title card, then the camera blends into the chase view and the car cruises on until
  the player touches the controls. Time holds at sunset until Ken: once the sun stops casting shadows every lit
  program swaps for its shadowless twin (~40 compiles — the same hitch free roam has at dusk). A retry starts at the
  capsule hotel as before.
  Small props have no colliders; trees get solid trunks near the player from a pool of static cylinders
  (`world/treecolliders.js`, group `PROP`: cars and Tommy hit them, wheel rays and the camera ray don't).
- Every long-distance move of the player goes through `Game.relocate()` -> `SafeSpots.find()` (`world/safespot.js`):
  outside ground-level building footprints (holes count as inside), on land, the occupant's real shape overlapping
  nothing, and — for pedestrians — connected to a sidewalk by a swept flood fill. Respawns, MRT, Claudia, mission
  teleports. `relocate` also resets per-position state (traffic/ped recentering, exposure, GPS, stunts).
- `node tests/scratch/relocate.mjs` checks every MRT/Claudia/respawn destination.
- The physics ground is a conservative 4 m height field, so along shorelines it sits up to ~4 m behind the drawn
  waterline. Vehicles live with that (boat exits use `Boat.shoreSpot()`, moorings `Spawns.findBerth()`, which keeps
  every starting boat within boarding reach of a solid quay — `tests/scratch/boats.mjs` boards each one). Characters
  also collide with a flat **shore shelf** (`Physics.addShoreShelf`, group `SHORE`, a trimesh of 1 m drawn-land squares
  over the sloping cells, by `City.waterEdge`), so on foot the quay edge is exactly where it is drawn.
- Seawalls (city builder) stand on that drawn waterline, the zero contour of the water class's edge distance: a face,
  a pale granite coping lipping over it (the ground draws the coping's top), and along the bay, river and canal
  promenades a slim steel railing (`City.railings`, a `StreetDetail` near pool) that is seen but not collided with —
  swimmers still climb out over the edge.
- **Swimming** (`Player.updateSwim`): below `WATER_LEVEL - 0.6` Tommy floats on a damped spring (treading water /
  front crawl anims), is kept inside the drawn water (the land sheet overhangs the bank), and `findLedge()` down-rays
  for dry level ground within reach (railings up to ~1.6 m above the water are vaulted, walls are not) to play the
  `climb_out` haul. Boats can be left anywhere (over the side when no quay is alongside) and boarded from the water.
  `tests/scratch/swim.mjs` walks in, swims and climbs out at 8 shores; `swim2.mjs` covers a 14 m fall, a boat
  bail-out/re-board and a car off a quay.
- **Input** (`core/input.js`): keys, mouse (pointer lock, with click-and-drag look whenever the lock isn't held —
  drag deltas come from cursor positions, `movementX` is unreliable unlocked), gamepad, and an analog `stick`. Left
  click while captured is the `Attack` action (`Player.updatePunch`: a jab that knocks down the ped in front; a
  witnessed crime). `#ui` must stay `pointer-events: none` all the way down except `.vc-interactive` panels —
  a stray `#ui > * { pointer-events: auto }` once swallowed every click meant for the canvas, so the mouse never
  got captured and the camera couldn't be turned.
- **Touch** (`ui/touch.js`, `touch.css`): on for touch-first devices, at the first touch, or with `?touch`
  (`?notouch` off); a real mouse moving turns it off. Buttons dispatch synthetic `KeyboardEvent`s, so every key
  listener (Input, pause, map, Claudia, Kopi boost, subtitle skip) works unchanged; the floating stick writes
  `Input.stick` (walk / steer + pedals), a one-finger drag adds to `Input.mouse.dx/dy`, a pinch to `mouse.wheel`
  (camera `zoom`). `.vc-touchmode` moves the radar top-left and the bottom-right HUD flashes and phone out of the
  thumbs' way. `tests/scratch/touch.mjs [WxH]` drives it with real CDP multi-touch on an emulated phone/tablet.
- Post: the composer only draws to the screen from the last pass *added*, so `Renderer.outPass` (FXAA on sqrt luma,
  after SMAA) is the output whenever SMAA is off — without it the Low preset rendered black. Low has no film grain.
- Flyover and viaduct parapets carry troughs of bougainvillea (`StreetDetail.buildViaductPlanters`, a near pool of
  2.4 m bays on every raised carriageway deck over 4 m up).
- Footbridges (`StreetDetail.buildBridges`) pick, per end, the stair direction whose flight and foot are clear of
  walls, tree trunks and traffic lanes, and leave gaps in the deck parapet at the landings.
  `tests/scratch/bridgewalk.mjs` walks over every bridge, `bridgeexits.mjs` checks each stair foot floods out to a sidewalk.

## Streetscape (furniture, HDB estates, hawker centres)
- The city builder places street furniture (`world/worker/streetscape.js`, hash-seeded, after the trees): kopitiam
  tables and umbrellas near food and shopfronts, planters, benches, shared bikes, pushcarts, potted plants by
  five-foot-way piers and wares in front of the shops, condensers on shophouse back walls, stone (xiangqi) tables,
  bicycles and benches in HDB void decks, a playground and fitness corner per estate and now and then a wake's or a
  wedding's tent, trees in grates (planted for it), benches, planters and shelters on squares of ~400 m² and more. It
  keeps clear of buildings, carriageways and their sidewalk lines (hw + 4 m), footway lines (2.4 m), trees and landmark
  clearings. The pieces (`world/streetpieces.js`) are one `BatchedMesh` with the city's structure material, instanced
  within 150 m of the camera (420 m for playgrounds, tents and hawker stalls): one draw call plus its shadow. Linkways
  between HDB blocks are chunk `structNear` geometry.
- `TreeColliders.trunkNear` also answers for furniture (people walk round it); sturdy pieces get low colliders.
- Low halls holding a food centre (OSM name or POI) are built as hawker centres: open halls under a hipped roof
  (columns round the outline, a ceiling of tube lights, a tiled floor: facade flag 6) with back-to-back rows of stalls,
  fixed tables (some choped with tissue packets), fans and tray returns inside (`worker/hawkerhall.js` lays them out;
  they're street furniture). Each stall's lightbox, photo menus and NEA sticker are near-detail facade quads (style 15)
  sampling the sign atlas's food pool (`gfx/signAtlas.js`), lit while it trades. Long shophouse walls are rows of
  ~5.5 m units in their own pastels; shophouses let as hotels or offices still trade at street level. A terrace's
  gable roof is split on the same grid, a roof per unit with a plastered firewall between.
- Chinatown's lantern strings (`world/streetprops.js`) are strung only where rays from the street find a facade on
  both sides, and never through a street tree's crown. Every building outline (and each landmark footprint) is stamped
  into the builder's occupancy grid before trees are planted, so no crown grows through a roof.

## Street life (pedestrians)
- The crowd lives around the **camera** (`Pedestrians.viewer`), not the player, and is spent where it looks: walkers
  are placed in the view cone (or just beside it), only where they can't be seen popping in (out of the frustum,
  beyond `popDist`, or behind a building by a ray) and recycled as soon as they're out of sight beyond that ring.
  Density per m² of view is the same on every preset (80 people / 75 m on Low, 150 / ~100 m on High); a camera cut
  or `Game.relocate` fills the new view at once. Scenes (`world/scenes.js`) also activate around the camera.
- `entities/walkways.js`: what's walkable — road sidewalks plus OSM footways / pedestrian streets, each line vetted
  lazily around the viewer (~0.35 ms a frame) with the parts inside buildings, in water or on a carriageway cut
  away (a divided road's sidewalk line runs down the other carriageway). Open paving (ground mask B ≥ 220, off the carriageway) gets
  strollers and groups; `standable()` is the check for anyone placed off a line.
- People: district/hour mix (office crowds by day, nightlife districts at night, delivery riders at meal times,
  joggers on park/waterfront paths at dawn and dusk), own pace and habits (window shopping, phone, tourist photos),
  gatherings at hotspots (shopfronts, hawker centres, bars, MRT exits, bus-stop benches, tourist photo groups at
  landmarks), umbrellas per person as rain passes. Crowd props are instanced pieces toggled by `look.acc` bits
  (umbrella / trolley pose the right arm in the shader); phone screens are emissive (`uNight`).
- Reactions: dive / run out of the player's car path with a bark; crashes, explosions (`events 'explosion'`),
  stunts and hits get filmed — event `'filmed' { count, pos, kind }` for anything that wants "filmed by N people".
- `world/streetlife.js`: the director stages one small scene every 20-40 s in view 25-60 m ahead (otters on a
  promenade, junglefowl crossing — traffic waits —, a jaywalking delivery rider, two uncles arguing with onlookers
  filming), recruiting people already there; critters are two instanced draws per species, only while out.
- Seating (`world/scenes.js`): posed members of the crowd at the builder's tables around the camera (diners at hawker
  centres and kopitiams by the hour, uncles over the void-deck xiangqi boards, wakes and weddings), the hawker behind
  each trading stall and a queue at each centre's famous one; within a budget (70 people on the phone), filled out of
  sight ahead of the camera and let go once behind it. Looks are never repeated within 30 m (same variant, print and
  colours) and a footpath gets at most a walker per 15 m of it at spawn, so sparse estates send out no processions.
- `node tests/scratch/pedcount.mjs --url ...` counts visible people per gallery view and the crowd's CPU per frame.

## Voice-over
- Every spoken line is a pre-rendered take in `public/vo/` (mp3 + `manifest.json`), rendered OFFLINE with Microsoft
  Edge's neural voices (`tools/vo/*`, see `tools/vo/README.md`). The game never calls a TTS service at runtime — a
  deployed build serves static files only; asset URLs follow `import.meta.env.BASE_URL`.
- A line is found by `voKey(role, text)` (`src/audio/vokey.js`): the speaker's role (`src/audio/cast.js` —
  `SPEAKER_ROLE`, `VOICE_CAST`, `DJ_BY_STATION`; every story character has a distinct voice) + the subtitle text.
  Lines built from runtime values are made finite in `src/missions/vodyn.js` (numbers spoken rounded, the exact figure
  stays on screen; long lines split so only the varying sentence is rendered per value; Claudia's places/vehicles and
  the kopi order vocabulary enumerated) — `node tools/vo/coverage.mjs` must report 0 missing.
- `src/audio/vo.js` plays takes through Web Audio: dialogue bus (music ducks), phone earpiece filter for callers,
  positional street barks, radio DJ/ads through the broadcast EQ in the radio chain. Mission/phone subtitles last as
  long as the recording; Enter stops the audio. A line without a take is subtitle-only (`window.__voMissing` in dev);
  `speechSynthesis` exists only behind `?ttsfallback`.
- Checks: `tests/scratch/vocheck.mjs` (playback, skip, fallback), `tests/scratch/vodyn.mjs` (minigame/Claudia lines).

## Test browser etiquette
All test scripts import `chromium` from `tests/lib/browser.mjs`, which rations headless browsers on this 8 GB machine
(2 shared slots; `exclusive: true` for frame-time measurements takes both, and new shared launches queue behind a
waiting exclusive one). Run frame-rate tests only exclusively.

## Module map
```
src/main.js                 entry → Game
src/game.js                 orchestrator: loading, main loop, wiring, pause/map, death/arrest, save
src/core/                   input, events, settings/save, camera rig, photo mode, visibility (BVH line-of-sight)
src/gfx/                    renderer + post (AO, auto-exposure, bloom, ACES, Vibe Vision), city materials/shaders
src/world/                  city (worker-built chunks), sky/sun/moon, water reflections, weather, vegetation,
                            road network (lanes/signals/routing), props, street props, markers, fx, spawns, ambient life,
                            street-life director (staged micro-scenes)
src/world/landmarks/        hand-built procedural landmarks (MBS, Flyer, Supertrees, Esplanade, Merlion, CBD towers, civic)
src/physics/                Rapier world wrapper (heightfield ground, trimesh city, fixed step, contact forces)
src/entities/               player, Vehicle (ray-cast car/bike), Boat (buoyancy), Aircraft (heli/drone), traffic AI,
                            pedestrians (+ walkways), wanted/police (+ air wing), PathDriver AI, Claudia autopilot
src/entities/humanoid/      procedural humans (Tommy, NPCs) + instanced crowd
src/entities/vehicles/      procedural vehicle/boat/aircraft models + instanced traffic renderer
src/audio/                  procedural radio stations, engines, SFX, ambience; voice-over playback (vo.js, voice.js,
                            cast.js, vokey.js) for the pre-rendered takes in public/vo
src/ui/                     HUD, radar, map, menus, dialogue, phone, stunt/taxi/photo overlays; spice.js: Fine City
                            ticket, cash floaters, filming view counter, one-line objective, drag-race lights
src/ui/minigames/           vibe-coding IDE, pitch, negotiation, kopi, chope rampage, Singlish quiz
src/missions/               mission framework (manager.js), story (8 missions), side activities, taxi, stunts,
                            cheats, services (respray/save/food/Claudia texts), claudia.js ("/" prompt),
                            firstdrive.js (mission 1's staged beats), finecity.js (cameras + fines), dragrace.js
                            (Ah Beng at night red lights)
tools/vo/                   offline voice-over pipeline (Edge neural TTS -> public/vo), coverage check
tests/                      play.mjs (scripted play-tests), regress.sh (all missions), look.mjs (look-dev views),
                            perf.mjs, soak.mjs, montage.mjs, missions/*.json
```
Test servers: `npm run dev` (5173, HMR) for development; `npx vite --config vite.test.config.js` (5174, no HMR) for
headless tests so edits don't reload pages mid-run.
