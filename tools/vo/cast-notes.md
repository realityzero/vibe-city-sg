# Story cast voice-over notes

All story voices are Microsoft Edge neural voices rendered offline with `edge-tts`; the game ships the rendered files
and never calls a TTS service at runtime. Pipeline: `node tools/vo/story-lines.mjs && node tools/vo/gen-story.mjs && node tools/vo/build-manifest.mjs`.
Casting lives in `src/audio/cast.js` (`VOICE_CAST[role].edge`); changing a voice/rate/pitch there re-renders only the
affected lines (the manifest stores a signature per line).

## Audition (same Tommy line on 10 male voices; F0 measured with tools-free autocorrelation)

| voice | F0 median | p10 | p90/p10 | duration |
|---|---|---|---|---|
| en-US-AndrewMultilingualNeural | 115.5 Hz | 89.1 | 2.11 | 6.9 s |
| en-US-ChristopherNeural | 115.9 | 92.9 | 1.57 | 10.1 s |
| en-US-EricNeural | 111.9 | 94.1 | 1.57 | 10.2 s |
| en-US-AndrewNeural | 120.3 | 87.0 | 2.24 | 6.6 s |
| en-US-BrianNeural = BrianMultilingual (identical output) | 129.0 | 103.9 | 1.47 | 7.2 s |
| en-US-SteffanNeural | 126.0 | 106.0 | 1.62 | 8.5 s |
| en-US-RogerNeural | 140.4 | 110.7 | 1.72 | 9.1 s |
| en-GB-RyanNeural | 140.4 | 96.6 | 2.37 | 10.2 s |
| en-US-GuyNeural | 166.7 | 127.0 | 1.73 | 10.2 s |

## Cast (story)

| role | voice | rate / pitch | why |
|---|---|---|---|
| tommy | en-US-AndrewMultilingualNeural | -8% / -4Hz | deepest low register, most natural and expressive; mild slow-down for an unhurried, dry delivery (big pitch shifts sound robotic) |
| ken | en-US-GuyNeural | +12% / +3Hz | higher, energetic: fast, anxious lawyer |
| lance | en-US-SteffanNeural | +5% | smooth, younger hustler |
| kyle | en-US-BrianNeural | +6% / +2Hz | cocky young founder |
| chad | en-US-EricNeural | +6% | laid-back VC bro |
| priya | en-IN-NeerjaExpressiveNeural | +2% | Singaporean-Indian partner, crisp |
| auntiemei | en-SG-LunaNeural | +2% / -2Hz | Singapore English |
| mrtan | en-SG-WayneNeural | -8% / -3Hz | Singaporean dealmaker, measured |
| ahseng | en-HK-SamNeural | +4% | taxi uncle |
| jasmine | en-PH-RosaNeural | +6% | bubbly community manager |
| scout | en-GB-RyanNeural | +8% | preppy, out of breath |
| mc | en-PH-JamesNeural | +6% | event host |
| sonny | en-US-RogerNeural | -6% / -2Hz | (no story lines) |

## Lines

Mission dialogue and phone calls (story.js `{ speaker, text }`, incl. the three idea-name variants of "… Shipped."),
the scout's surrender quote, the Demo Day pitch (Tommy's slide lines, answers, buzzword QTE lines for every buzzword,
investor questions/reactions/verdicts, MC intro per idea) and the Mr. Tan negotiation (TAN lines, Tommy/Ken lines).
Skipped (runtime numbers): Mr. Tan's final "<raised> at <valuation>" line, the traction slide line, Priya's user-count
question and its weekly-actives answer, Tommy's "<users> users…" and "<raise> at <pre>…" negotiation lines.
Spoken text is cleaned for TTS (S$ amounts → dollars, acronyms dotted, shouted CAPS lower-cased, stage directions
in *asterisks* dropped); keys use the displayed text.
