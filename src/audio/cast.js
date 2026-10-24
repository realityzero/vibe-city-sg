// Voice casting (all Microsoft Edge neural voices; every story character has its own). SPEAKER_ROLE maps a dialogue speaker's display name to a voice role; the role is half of every
// voice-over key (see vokey.js), so the offline generators (tools/vo/*) and the runtime must agree on it.
// VOICE_CAST describes each role: the Microsoft neural voice(s) the Edge generator uses (edge = the main voice,
// takes = extra voices of the same family for ambient lines that get several takes), and Web Speech fallback
// preferences for text that has no pre-rendered take (substring matches on SpeechSynthesisVoice.name — Edge's
// "Online (Natural)" voices first, then Google/Siri-quality voices; never the old macOS Alex/Fred).
// Prosody stays small on purpose: big pitch/rate shifts are what make neural TTS sound robotic.

export const SPEAKER_ROLE = {
  Tommy: 'tommy', 'Tommy Vercetti': 'tommy', TOMMY: 'tommy',
  Ken: 'ken', 'Ken Rosenberg': 'ken', KEN: 'ken',
  Lance: 'lance', 'Lance Vance': 'lance',
  Kyle: 'kyle',
  Claudia: 'claudia',
  Priya: 'priya', 'Priya Raman': 'priya',
  Chad: 'chad', 'Chad Brogan': 'chad',
  'Mr. Tan': 'mrtan', 'Mr Tan': 'mrtan',
  'Auntie Mei': 'auntiemei',
  'Uncle Ah Seng': 'ahseng',
  Sonny: 'sonny', 'Sonny Forelli': 'sonny',
  Jasmine: 'jasmine',
  Scout: 'scout',
  MC: 'mc',
};

const FALLBACK_M = ['Andrew Online (Natural)', 'Brian Online (Natural)', 'Guy Online (Natural)', 'Christopher Online (Natural)', 'Google US English', 'Evan', 'Nathan', 'Aaron', 'Daniel'];
const FALLBACK_F = ['Ava Online (Natural)', 'Emma Online (Natural)', 'Jenny Online (Natural)', 'Aria Online (Natural)', 'Google US English', 'Samantha', 'Ava', 'Allison', 'Karen'];
const FALLBACK_SG_M = ['Wayne Online (Natural)', 'Prabhat Online (Natural)', 'Sam Online (Natural)', 'Google UK English Male', 'Rishi', 'Daniel'];
const FALLBACK_SG_F = ['Luna Online (Natural)', 'Neerja Online (Natural)', 'Yan Online (Natural)', 'Google UK English Female', 'Veena', 'Moira', 'Karen'];

const E = (voice, rate = '+0%', pitch = '+0Hz', volume = '+0%') => ({ voice, rate, pitch, volume });

export const VOICE_CAST = {
  // ---- story cast: one distinct voice each
  // Tommy: the Multilingual Andrew voice — the most natural conversational voice in the set with the deepest low register
  // (measured F0 median 115 Hz, p10 89 Hz, widest expressive range); Christopher is as deep but flat and slow
  tommy: { edge: E('en-US-AndrewMultilingualNeural', '-8%', '-4Hz'), female: false, prefer: ['Andrew Online (Natural)', 'Christopher Online (Natural)', ...FALLBACK_M], desc: 'Tommy Vercetti: 40s Italian-American from Liberty City by way of Vice City, low, gravelly, unhurried, dry menace and deadpan humour; now a startup founder in a Hawaiian shirt' },
  ken: { edge: E('en-US-GuyNeural', '+12%', '+3Hz'), female: false, prefer: ['Guy Online (Natural)', 'Steffan Online (Natural)', ...FALLBACK_M], desc: 'Ken Rosenberg: neurotic, fast-talking East Coast lawyer, nasal, anxious, over-explains, cracks under pressure' },
  lance: { edge: E('en-US-SteffanNeural', '+5%'), female: false, prefer: ['Steffan Online (Natural)', ...FALLBACK_M], desc: 'Lance Vance: smooth, cocky growth-hacker hustler, 30s, easy charm, slightly too much confidence' },
  kyle: { edge: E('en-US-BrianNeural', '+6%', '+2Hz'), female: false, prefer: ['Brian Online (Natural)', ...FALLBACK_M], desc: 'Kyle: rich-kid street racer and crypto bro, early 20s, smug, energetic' },
  claudia: { edge: E('en-US-AvaMultilingualNeural'), female: true, prefer: ['Ava Online (Natural)', 'Emma Online (Natural)', ...FALLBACK_F], desc: 'Claudia: the AI pair-programmer; warm, quick, wry, a little smug, crisp diction' },
  priya: { edge: E('en-IN-NeerjaExpressiveNeural', '+2%'), female: true, prefer: ['Neerja Online (Natural)', ...FALLBACK_SG_F, ...FALLBACK_F], desc: 'Priya Raman, Merlion Ventures partner: Singaporean-Indian, sharp, numbers-first, dry' },
  chad: { edge: E('en-US-EricNeural', '+6%'), female: false, prefer: ['Eric Online (Natural)', ...FALLBACK_M], desc: 'Chad Brogan, Sandhill Partners GP: Palo Alto VC bro, jet-lagged, buzzword-happy' },
  mrtan: { edge: E('en-SG-WayneNeural', '-8%', '-3Hz'), female: false, prefer: ['Wayne Online (Natural)', 'Thomas Online (Natural)', ...FALLBACK_SG_M], desc: 'Mr. Tan, Temasick Holdings: senior Singaporean dealmaker, calm, measured, polite steel' },
  auntiemei: { edge: E('en-SG-LunaNeural', '+2%', '-2Hz'), female: true, prefer: FALLBACK_SG_F, desc: 'Auntie Mei: owns six chicken rice stalls, angel investor, blunt Singlish auntie, sharp and funny' },
  ahseng: { edge: E('en-HK-SamNeural', '+4%'), female: false, prefer: ['Sam Online (Natural)', ...FALLBACK_SG_M], desc: 'Uncle Ah Seng: taxi uncle who joins the street race, Singlish, gruff but kind' },
  sonny: { edge: E('en-US-RogerNeural', '-6%', '-2Hz'), female: false, prefer: ['Roger Online (Natural)', ...FALLBACK_M], desc: 'Sonny Forelli: older Liberty City mob boss, menacing calm, on a bad phone line' },
  jasmine: { edge: E('en-PH-RosaNeural', '+6%'), female: true, prefer: ['Rosa Online (Natural)', ...FALLBACK_SG_F], desc: 'Jasmine: WeHustle co-working community manager, bubbly, fast' },
  scout: { edge: E('en-GB-RyanNeural', '+8%'), female: false, prefer: ['Ryan Online (Natural)', ...FALLBACK_M], desc: 'The Why Combinator scout: preppy, smug, out of breath' },
  mc: { edge: E('en-PH-JamesNeural', '+6%'), female: false, prefer: ['James Online (Natural)', ...FALLBACK_SG_M], desc: 'Demo Day MC: upbeat event host' },

  // ---- ambient (Edge, several takes per line for variety). Singapore English has only two voices (Luna, Wayne) and
  // both are story characters (Auntie Mei, Mr. Tan): they appear here only as secondary takes with different prosody,
  // never as a crowd role's lead voice, and no other story voice is used for a passer-by.
  auntie: { edge: E('en-HK-YanNeural', '+4%'), takes: [E('en-SG-LunaNeural', '+7%', '+3Hz'), E('en-IN-NeerjaNeural', '+4%', '-2Hz')], female: true, prefer: FALLBACK_SG_F, desc: 'hawker-centre aunties' },
  uncle: { edge: E('en-IN-PrabhatNeural', '+4%', '-2Hz'), takes: [E('en-SG-WayneNeural', '+6%', '+2Hz'), E('en-NZ-MitchellNeural', '+2%', '-3Hz')], female: false, prefer: FALLBACK_SG_M, desc: 'kopitiam uncles' },
  male: { edge: E('en-IN-PrabhatNeural', '+8%'), takes: [E('en-SG-WayneNeural', '+10%', '+3Hz'), E('en-US-ChristopherNeural', '+6%')], female: false, prefer: FALLBACK_SG_M, desc: 'men in the street (Singaporean, plus an expat take)' },
  female: { edge: E('en-HK-YanNeural', '+6%'), takes: [E('en-SG-LunaNeural', '+8%', '+3Hz'), E('en-GB-SoniaNeural', '+4%')], female: true, prefer: FALLBACK_SG_F, desc: 'women in the street (Singaporean, plus an expat take)' },
  tourist: { edge: E('en-US-AriaNeural', '+4%'), takes: [E('en-GB-LibbyNeural', '+2%'), E('en-AU-NatashaNeural', '+2%')], female: true, prefer: FALLBACK_F, desc: 'tourists (American, British, Australian)' },
  police: { edge: E('en-IN-PrabhatNeural', '+2%', '-3Hz'), takes: [E('en-SG-WayneNeural', '+6%', '+1Hz')], female: false, prefer: FALLBACK_SG_M, desc: 'SPF officers: firm, procedural' },
  dj: { edge: E('en-IE-ConnorNeural', '+6%'), female: false, prefer: FALLBACK_M, desc: 'radio DJs — the generator picks a voice per station (see DJ_BY_STATION)' },
  sgdj: { edge: E('en-SG-LunaNeural', '+4%', '+2Hz'), female: true, prefer: FALLBACK_SG_F, desc: 'KAYA 89.3 Singlish DJ (the only Singlish female voice: shares Luna with Auntie Mei, brighter prosody)' },
  mrt: { edge: E('en-SG-LunaNeural', '-4%', '+1Hz'), female: true, prefer: FALLBACK_SG_F, desc: 'MRT announcements' },
};

/** radio voices per station (idents and DJ chatter are spoken in role 'dj'/'sgdj'; the voice is per station) */
export const DJ_BY_STATION = {
  flash: E('en-IE-ConnorNeural', '+8%'),                 // 80s pop, bright and fast
  wave: E('en-GB-ThomasNeural', '-4%', '-2Hz'),          // darkwave, cool and low
  fever: E('en-ZA-LukeNeural', '+4%'),                   // disco, warm grin
  emotion: E('en-US-EmmaMultilingualNeural', '-6%'),     // power ballads, soft late-night
  lofi: E('en-AU-WilliamMultilingualNeural', '-8%'),     // lo-fi, sleepy and close
  vcpr: E('en-US-ChristopherNeural', '+6%'),             // VCPR talk host "Chad Lim"
  vcprAd: E('en-US-JennyNeural', '+6%'),                 // VCPR ad reads (role 'female')
  kaya: E('en-SG-LunaNeural', '+4%', '+2Hz'),            // KAYA 89.3 Singlish DJ (role 'sgdj', idents also 'dj')
};

export const roleOf = speaker => SPEAKER_ROLE[speaker] || SPEAKER_ROLE[String(speaker || '').trim()] || 'male';
