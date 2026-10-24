// Voice-over asset keys. A spoken line is identified by its voice role + normalised text, so the runtime can find
// the pre-rendered take for any say()/sayBark()/sayRadio() call without threading ids through the game code.
// Used by the offline generator (tools/vo/*) and the runtime (src/audio/vo.js) — keep both on this one function.
//
// public/vo/manifest.json:
//   { "v": 1, "lines": { "<key>": { "f": ["<file>.mp3", ...takes], "d": [seconds, ...], "e": "edge",
//     "voice": "<engine voice id/name>", "role": "<role>", "t": "<original text>" } } }

/** lower-case, markup and punctuation stripped, whitespace collapsed */
export function voNorm(text) {
  return String(text).toLowerCase()
    .replace(/<[^>]*>/g, ' ')          // <b>…</b> and other markup in subtitles
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/'/g, '')
    .trim().replace(/\s+/g, ' ');
}

/** 8 hex chars: FNV-1a of role|normalised text */
export function voKey(role, text) {
  const s = `${role}|${voNorm(text)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
