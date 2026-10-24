# Voice-over pipeline

Every spoken line is pre-rendered OFFLINE with Microsoft Edge's neural voices (the Read Aloud voices, through the
[`edge-tts`](https://github.com/rany2/edge-tts) client) and shipped as mp3 in `public/vo/`. The game never calls a TTS
service at runtime — a deployed build only needs the static files. It looks a take up by `voKey(role, text)`
(`src/audio/vokey.js`); a line without a take is subtitle-only (dev builds list it in `window.__voMissing`).

```
sh tools/vo/setup.sh && export EDGE_TTS=tools/vo/.venv/bin/edge-tts      # once (needs python3 + ffmpeg/ffprobe)
node tools/vo/extract.mjs          # inventory -> tools/vo/script.json (+ counts per kind/role)
node tools/vo/gen-edge.mjs         # barks, bubbles, radio, NPCs, Claudia, announcements -> manifest.edge.json
node tools/vo/dump-places.mjs      # Claudia's place names -> tools/vo/places.json (loads the game; needs the dev server)
node tools/vo/gen-dyn.mjs          # runtime-built lines (numbers, places, kopi orders) -> manifest.dyn.json
node tools/vo/build-manifest.mjs   # merge edge + dyn + story (story cast) -> public/vo/manifest.json
node tools/vo/coverage.mjs         # every line the game can say has a take? (exit 1 + list if not)
```

- **Casting**: `src/audio/cast.js` — `SPEAKER_ROLE` (dialogue speaker -> role) and `VOICE_CAST` (role -> Edge voice +
  small prosody offsets, extra `takes` voices for crowd roles); radio voices per station in `DJ_BY_STATION`. Every story
  character has a distinct voice; crowd roles mix Singapore, Hong Kong, Indian, Philippine and expat English.
- **Keys** use the original line text (subtitle markup and punctuation are ignored); what the voice *says* goes through
  `speakable()` in `gen-edge.mjs` (acronyms spelled, money read out, emoji and stage directions dropped, shouted caps
  said as words).
- **Takes**: street barks get three voices per role (`<key>_a/_b/_c.mp3`), speech-bubble barks two.
- **Post**: silence trimmed, 15 ms fade-in, EBU R128 loudness (-16 LUFS dialogue/radio, -18 NPCs, -19 barks), mono
  24 kHz mp3 (48 kbps; barks 40, NPC filler 32).
- **Cache**: `tools/vo/edge-cache.json` holds a hash of voice+prosody+spoken text per file; re-running only renders
  what changed. The endpoint rate-limits — the generator keeps 3 requests in flight and backs off on errors.
- **Runtime-built lines** (user counts, deal terms, clock times, spawn counts, place names, kopi orders) are made finite
  in `src/missions/vodyn.js` and `src/ui/minigames/kopi-lingo.js`: the subtitle keeps the exact figure, the voice says
  a finite form (users to the nearest 50, times to the quarter hour, term sheets as amount / pre-money / board clips,
  kopi orders as one clip per term). A spoken form can be several sentences played back to back (`playSeq`): the
  varying sentence is rendered per value, the fixed ones once. `gen-dyn.mjs` enumerates the same builders (32 kbps;
  Edge's raw output is cached in `/tmp/vc-tts/dyn` so re-encoding doesn't call Edge again).
- `tools/vo/script.json` also lists `dynamic` templates (the subtitles built from runtime values); `coverage.mjs`
  checks their spoken variants.
