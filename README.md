# Grand Theft Auto: Vibe City — Singapore

A browser-only, GTA Vice City–style open world set in a real-data recreation of central Singapore.
Tommy Vercetti lands in the Lion City, vibe-codes a startup with an AI pair-programmer, and raises a Series A.

Everything runs in the browser: Three.js (WebGL2) rendering, Rapier physics compiled to WebAssembly,
a Web Worker that builds the city geometry, and Web Audio synthesising all music, radio and sound effects.
No external art or music: everything is generated in code or from OpenStreetMap data. The voice acting — every
character, radio DJ, street bark and announcement, ~12,000 spoken variants — is pre-rendered with Microsoft's neural
voices (Singapore, Indian, Philippine, Hong Kong and US English) and shipped as audio files; nothing is synthesised
at runtime.

## Run it

```bash
npm install
npm run dev          # http://127.0.0.1:5173
```

Production build: `npm run build && npm run preview` (http://127.0.0.1:4173).
Chrome/Edge/Arc on a recent laptop recommended. Built for Apple M1/M2: it paces itself to a steady 60 fps (also on
120 Hz ProMotion screens), starts base M1/M2 GPUs at a lower pixel budget and adapts resolution if frames start to slip.

Useful URL flags: `?q=low|medium|high|ultra` · `?skipTitle&newgame` · `?mission=1..8` (jump to a mission) ·
`?freeroam=8` (all missions done) · `?t=21.5` (time of day) · `?rain=1` · `?stats` (fps / draw calls).

Regenerate the map from OpenStreetMap: `node tools/fetch-osm.mjs && node tools/build-city.mjs`.

## The city

- ~6 km × 4.2 km of central Singapore built from live OSM data: 8,500 real buildings with real heights and
  roof shapes, 15,000 road segments with lanes, bridges and flyovers, the coastline, Marina Bay, the Singapore
  River, parks and 60,000 trees. Plus procedural HDB estates on the horizon so the skyline doesn't end.
- Hand-modelled landmarks: Marina Bay Sands and the SkyPark (with the Spectra lasers), ArtScience Museum,
  Gardens by the Bay Supertrees (nightly light show with music) and domes, Singapore Flyer (rideable),
  Esplanade, the Merlion, Helix Bridge, CapitaSpring, Guoco Tower, Oasia, PARKROYAL Pickering,
  Pinnacle@Duxton, Marina One, Old Supreme Court, Victoria Theatre, St Andrew's, Sultan Mosque, Lau Pa Sat,
  Fullerton, Raffles Hotel, Clarke Quay, Chinatown temples, Marina Barrage and more.
- Procedural facades with interior-mapped rooms, HDB colour accents, shophouse shutters, glowing shop signs,
  Chinatown lantern strings, bus shelters, street lamps, working traffic lights, ERP gantries.
- Real time of day (sunset ~19:00), tropical thunderstorms with wet roads, planar water reflections.
- Tropical sky: fair-weather cumulus with sun-lit tops and self-shadowed bases, high cirrus, humid horizon haze,
  an orange light-pollution dome and city-lit clouds at night. Storms bring multi-stroke lightning (forked bolts
  on the horizon, clouds lighting up) with thunder delayed by the strike's distance.
- Photographic finish: physically-based bloom (no threshold halos), split toning and fine film grain, eye
  adaptation that won't blow a daytime sky out to white, and opens up in the golden hour.
- City-scale lighting: a height map of the whole city (rendered once at load) gives every street and tree far-field
  sun shadows out to ~1 km and darkens narrow street canyons; altitude-aware haze clears as you climb; ambient
  occlusion grounds cars, kerbs and columns. Water reflections are sunlit and blur with the chop; in the rain, roads
  reflect the street (lamp heads, windows and tail lights streak across the wet asphalt).
- Buildings by use: shophouses and HDB void decks get shops; hospitals, offices, hotels and condos get lit lobbies;
  HDB blocks have aircon units; offices empty out at night floor by floor. Footprints that OSM drew over the kerb are
  pushed back so no wall stands in the road.
- Night landmarks: Marina Bay Sands as a hotel at night (scattered warm rooms), Supertrees as dark steel lattices with
  LED points (colour waves during Garden Rhapsody), an underlit ArtScience lotus, Spectra lasers over the bay at 20:00
  and 21:00.
- 60,000 trees of nine Singapore species (rain trees arching over avenues, flame of the forest, tembusu, palms…) with
  pre-rendered impostors far away; fallen blossoms under flowering trees; trunks you can actually crash into.
- Left-hand traffic with lane changes at junctions, signals and car-following; pedestrians on the sidewalks
  who flee, get knocked over (then complain in Singlish) and wave down taxis.

## Driving

Fixed 60 Hz physics with interpolated rendering (no judder at any frame rate), a low centre of mass, speed-sensitive
steering with a grip budget and yaw-stability assist, ramped pedals, real brake force, a stable motorbike balance
controller, and a smooth chase camera. Respawns, MRT rides and Claudia's teleports always land you somewhere you can
walk out of.

Tommy can swim: fall off a quay, dive off a bridge, bail out of a boat mid-bay or sink a car and he surfaces and
treads water. **WASD** front crawl, **Shift** faster, swim into a low edge (or **Space** at one) to haul himself out,
**F** next to a boat to climb aboard. Every footbridge has stairs down on both ends that open onto the street.

## Story (8 missions)

1. **The Lion City** — land in a Chinatown capsule hotel, meet Ken Rosenberg at Lau Pa Sat.
2. **Vibe Coding** — pick a startup (ChopeChain, Kopi.ai, DurianDash) and vibe-code it with Claudia, the AI.
3. **Chope!** — Lance Vance's growth hack: hit four hawker centres before the lunch rush ends.
4. **Poached** — chase down the Why Combinator scout who stole the laptop.
5. **Demo Day** — race across town in the Infernus to the Marina Bay Sands Expo.
6. **The Pitch** — pitch Priya (Merlion Ventures), Chad (Sandhill) and Auntie Mei.
7. **Street Circuit** — two laps of the Marina Bay street circuit against Kyle and friends.
8. **Term Sheet** — negotiate with Temasick Holdings on the SkyPark. Fireworks.

## Free roam

- **Rides:** helicopters (rooftop helipad near Raffles Place), speedboats, jet skis, a river bumboat, delivery
  bikes, and anything you can carjack. MRT entrances work as fast travel (S$1.80, tap your EZ-Link).
- **Side jobs (green markers):** Snatch taxi duty (press **T** in any taxi, with a Singlish quiz for tips),
  DurianDash drone deliveries, pitch-deck courier, "ship a feature" vibe-coding sessions, Kopi Uncle and
  Chope Rampage hawker minigames, and a Singapore Flyer ride.
- **Collectibles & stunts:** 24 hidden kaya toasts, unique stunt jumps across the river (slow-mo replay).
- **City services:** Chope 'n' Spray respray garages (clears your wanted level), hawker stalls that heal,
  the capsule-hotel safehouse to save and sleep.
- **Law:** stars only come from crimes the police actually witness — a patrol car or the Air Wing with a line of
  sight, or one of the red-light/enforcement cameras on poles at busy junctions. SPF patrol cars chase you, and at 3+
  stars an Air Wing helicopter joins with a searchlight. Busted = S$500 fine.
- **Toughness:** Tommy has 150 health; a burning car gives you six seconds to bail before it blows, and the blast
  hurts less the further away you are. Cars differ in durability — bikes and sports cars give out first, SUVs,
  police cars, lorries and buses take a beating.
- **Ambience:** seven generative radio stations, bumboats on the river, airliners overhead, Supertree light show
  with music (19:45 & 20:45), Spectra lasers, fireworks over Marina Bay every night at 21:00, thunderstorms.
- **Living city:** Satay Street — Boon Tat Street beside Lau Pa Sat closes to cars every night from 19:00 and fills
  with tables, smoking grills and diners; tourists photographing the Merlion; office lunch crowds at Raffles Place;
  crowds for the Supertree show; district-appropriate pedestrians (aunties in Chinatown, suits in the CBD).
- **Hype economy:** stunts go viral and raise your startup's valuation; arrests and crashes make the news.
  **B** in a car = Kopi Gao boost (caffeine nitro).
- **Extras:** photo mode (**`**) with film filters, a rainbow after tropical storms, and Claudia texting you
  commentary on your life choices.

**Vibe-code the city:** press **/** and type to Claudia, your AI pair-programmer: *make it rain*, *sunset*,
*spawn a helicopter*, *3 taxis*, *take me to the Merlion*, *drive me to Lau Pa Sat* (autopilot), *fireworks*,
*durians*, *low gravity*, *synthwave mode*, *more traffic*. Press **Y** in a car for Claudia Autopilot to your waypoint.

## Controls

| On foot | | Driving | | Flying | |
|---|---|---|---|---|---|
| WASD | move | W / S | throttle / brake | Space / Shift | climb / descend |
| Mouse | look (click to lock) | A / D | steer | W / S | forward / back |
| Shift | sprint | Space | handbrake | A / D | turn |
| Space | jump | Q / E | radio station | Q / E | strafe |
| F | enter / jack vehicle | H | horn / siren | F | exit |

M map (right-click: waypoint) · Esc pause · ` photo mode · / prompt Claudia · Y autopilot · T taxi duty ·
Enter skip dialogue · V / mouse wheel camera distance · C look back · left click (mouse captured) punch.
Mouse look captures the mouse on click; where the browser won't allow that, click-and-drag looks around.

**Phones and tablets** (landscape) get on-screen controls: a floating move stick under the left thumb (it also
steers), drag anywhere else to look, pinch to zoom, and context buttons on the right — JUMP / RUN / PUNCH / ENTER on
foot, GAS / BRAKE / DRIFT / EXIT / HORN / RADIO / KOPI in a car, UP / DOWN in the air, CLIMB / BOARD in the water.
Tap the radar for the map (long-press sets a waypoint), and the top bar has pause, camera, Claudia and fullscreen.
The radar moves to the top-left so nothing the thumbs use covers it. Touch-first devices start on the Low preset.

## Cheats (type them while playing)

ASPIRINE · PRECIOUSPROTECTION · LEAVEMEALONE · FINECITY · SHIOK · CHOPPER · JETSKI · DURIANRAIN · SEAWAYS ·
COMEFLYWITHME · ALOVELYDAY · CATSANDDOGS · HAZESEASON · LIFEISPASSINGMEBY · BIGBANG · GREENLIGHT ·
KIASUDRIVERS · STILLLIKEDRESSINGUP · KACHING · NIGHTOWL · VICEVISION

## Credits

Map data © OpenStreetMap contributors, ODbL. Fonts under the SIL Open Font License (see `public/fonts`).
A fan-made parody; not affiliated with Rockstar Games. All companies and characters are fictional.
See `ARCHITECTURE.md` for the code layout.
