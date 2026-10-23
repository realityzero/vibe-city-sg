// Flat SVG portraits for the minigames. Mouth/brow variants are toggled by a mood class on the wrapper
// (.mood-happy / .mood-neutral / .mood-sad / .mood-wow) — see minigames.css.

const MOUTHS = (y = 62, w = 7) => `
  <path class="mo mo-happy" d="M${50 - w} ${y} Q50 ${y + 7} ${50 + w} ${y}" stroke="#4a1f1f" stroke-width="2.2" fill="#7a2a2a" stroke-linecap="round"/>
  <path class="mo mo-neutral" d="M${50 - w + 1} ${y + 2} L${50 + w - 1} ${y + 2}" stroke="#4a1f1f" stroke-width="2.2" stroke-linecap="round"/>
  <path class="mo mo-sad" d="M${50 - w + 1} ${y + 4} Q50 ${y - 1} ${50 + w - 1} ${y + 4}" stroke="#4a1f1f" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <ellipse class="mo mo-wow" cx="50" cy="${y + 2}" rx="3.2" ry="4" fill="#4a1f1f"/>`;
const BROWS = (y = 37, c = '#1a1110') => `
  <g class="br br-up"><path d="M37 ${y - 2} Q42 ${y - 6} 46 ${y - 3}" stroke="${c}" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M54 ${y - 3} Q58 ${y - 6} 63 ${y - 2}" stroke="${c}" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>
  <g class="br br-flat"><path d="M37 ${y} L46 ${y - 1}" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/><path d="M54 ${y - 1} L63 ${y}" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/></g>
  <g class="br br-angry"><path d="M37 ${y - 3} L46 ${y + 1}" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/><path d="M54 ${y + 1} L63 ${y - 3}" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/></g>`;
const EYES = (y = 44) => `<g class="eyes"><ellipse cx="42" cy="${y}" rx="2.3" ry="2.6" fill="#1b1414"/><ellipse cx="58" cy="${y}" rx="2.3" ry="2.6" fill="#1b1414"/>
  <circle cx="42.8" cy="${y - 0.9}" r=".7" fill="#fff"/><circle cx="58.8" cy="${y - 0.9}" r=".7" fill="#fff"/></g>`;

export const PORTRAITS = {
  merlion: () => `<svg viewBox="0 0 100 100" class="pt-face">
  <path d="M8 100 C12 79 28 71 50 71 C72 71 88 79 92 100Z" fill="#1f2c57"/>
  <path d="M41 71 L50 88 L59 71Z" fill="#f2f2f2"/><path d="M36 72 L44 100 M64 72 L56 100" stroke="#16204a" stroke-width="3"/>
  <rect x="43" y="57" width="14" height="16" rx="5" fill="#9b6444"/>
  <path d="M30 50 C27 26 40 17 52 17 C66 17 74 28 71 52 C70 60 67 64 66 66 L34 66 C32 62 31 57 30 50Z" fill="#160f0e"/>
  <ellipse cx="50" cy="45" rx="16.5" ry="19.5" fill="#a86f4c"/>
  <path d="M33 40 C34 27 43 23 51 23 C60 23 67 29 67 40 C62 31 56 29 49 29 C42 30 37 34 33 40Z" fill="#160f0e"/>
  <circle cx="51" cy="15" r="8" fill="#160f0e"/>
  ${BROWS(37)}${EYES(44)}
  <g fill="none" stroke="#26e0ff" stroke-width="1.8"><rect x="35" y="39" width="13" height="10" rx="3"/><rect x="52" y="39" width="13" height="10" rx="3"/><path d="M48 43 L52 43"/></g>
  <path d="M49 47 Q50 53 48 54" stroke="#7c4a30" stroke-width="1.3" fill="none"/>
  ${MOUTHS(58, 6)}
  <circle cx="34" cy="50" r="1.6" fill="#ffd23f"/><circle cx="66" cy="50" r="1.6" fill="#ffd23f"/></svg>`,

  sandhill: () => `<svg viewBox="0 0 100 100" class="pt-face">
  <path d="M8 100 C12 79 28 71 50 71 C72 71 88 79 92 100Z" fill="#7aa7dc"/>
  <path d="M10 100 C13 82 24 74 38 72 L44 100Z M90 100 C87 82 76 74 62 72 L56 100Z" fill="#8b919c"/>
  <path d="M42 72 L50 80 L58 72" stroke="#5c87bd" stroke-width="2" fill="none"/>
  <rect x="43" y="57" width="14" height="16" rx="5" fill="#e6b391"/>
  <ellipse cx="50" cy="45" rx="17" ry="19.5" fill="#f1c7a5"/>
  <path d="M32 42 C30 22 44 16 56 18 C68 20 74 28 70 40 C66 30 60 28 52 30 C46 31 44 26 40 30 C36 33 34 37 32 42Z" fill="#e8c26a"/>
  <path d="M40 30 C46 20 62 18 70 26" stroke="#f6dc94" stroke-width="2" fill="none"/>
  ${BROWS(37, '#b8913c')}${EYES(44)}
  <path d="M49 46 Q51 52 48 53" stroke="#c98d6c" stroke-width="1.3" fill="none"/>
  ${MOUTHS(58, 8)}
  <ellipse cx="33" cy="49" rx="2" ry="3" fill="#fff"/><ellipse cx="67" cy="49" rx="2" ry="3" fill="#fff"/>
  <rect x="32" y="51" width="1.8" height="5" rx=".9" fill="#fff"/><rect x="66.2" y="51" width="1.8" height="5" rx=".9" fill="#fff"/></svg>`,

  auntie: () => `<svg viewBox="0 0 100 100" class="pt-face">
  <defs><pattern id="vcmg-floral" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#c8324a"/><circle cx="3" cy="3" r="2.2" fill="#ffb3c1"/><circle cx="9" cy="9" r="1.8" fill="#ffe08a"/><circle cx="9" cy="3" r=".9" fill="#2f8f5b"/></pattern></defs>
  <path d="M8 100 C12 79 28 71 50 71 C72 71 88 79 92 100Z" fill="url(#vcmg-floral)"/>
  <path d="M38 73 Q50 86 62 73" stroke="#e8c15a" stroke-width="2.2" fill="none"/><circle cx="50" cy="84" r="3" fill="#e8c15a"/>
  <rect x="43" y="57" width="14" height="16" rx="5" fill="#dcaa80"/>
  <g fill="#3b3434"><circle cx="34" cy="38" r="7"/><circle cx="40" cy="28" r="7.5"/><circle cx="50" cy="24" r="8"/><circle cx="60" cy="28" r="7.5"/><circle cx="66" cy="38" r="7"/><circle cx="33" cy="48" r="5.5"/><circle cx="67" cy="48" r="5.5"/></g>
  <g fill="#8b8484"><circle cx="45" cy="23" r="3"/><circle cx="62" cy="31" r="2.6"/><circle cx="35" cy="36" r="2.4"/></g>
  <ellipse cx="50" cy="47" rx="16" ry="18.5" fill="#e8b98f"/>
  <path d="M35 40 C38 32 45 30 50 30 C56 30 62 32 65 40 C60 35 55 34 50 34 C44 34 39 36 35 40Z" fill="#3b3434"/>
  ${BROWS(40, '#3b3434')}${EYES(46)}
  <g fill="none" stroke="#d4a43a" stroke-width="1.6"><circle cx="42" cy="46" r="6"/><circle cx="58" cy="46" r="6"/><path d="M48 46 L52 46"/></g>
  <circle cx="38" cy="54" r="2.4" fill="#f29a9a" opacity=".55"/><circle cx="62" cy="54" r="2.4" fill="#f29a9a" opacity=".55"/>
  ${MOUTHS(59, 6)}
  <circle cx="34" cy="52" r="1.8" fill="#7cff6b"/><circle cx="66" cy="52" r="1.8" fill="#7cff6b"/></svg>`,

  mrtan: () => `<svg viewBox="0 0 100 100" class="pt-face">
  <path d="M6 100 C10 78 27 70 50 70 C73 70 90 78 94 100Z" fill="#3a3f4d"/>
  <path d="M40 70 L50 92 L60 70Z" fill="#f4f4f4"/><path d="M48 74 L52 74 L54 96 L50 100 L46 96Z" fill="#b5242f"/>
  <path d="M40 70 L46 84 L36 100 M60 70 L54 84 L64 100" stroke="#2c303b" stroke-width="2.4" fill="none"/>
  <rect x="43" y="56" width="14" height="16" rx="5" fill="#d7a77e"/>
  <ellipse cx="50" cy="44" rx="17" ry="20" fill="#e2b48a"/>
  <path d="M33 46 C31 34 33 28 37 26 C35 34 35 40 36 47Z M67 46 C69 34 67 28 63 26 C65 34 65 40 64 47Z" fill="#a3a3a3"/>
  <path d="M38 27 C44 22 56 22 62 27 C56 25 44 25 38 27Z" fill="#a3a3a3" opacity=".6"/>
  ${BROWS(36, '#6d6d6d')}${EYES(43)}
  <g fill="rgba(20,20,30,.25)" stroke="#1d1d24" stroke-width="2"><rect x="35" y="38.5" width="13" height="9" rx="1.5"/><rect x="52" y="38.5" width="13" height="9" rx="1.5"/></g><path d="M48 42 L52 42" stroke="#1d1d24" stroke-width="2"/>
  <path d="M38 55 Q41 57 43 56 M57 56 Q59 57 62 55" stroke="#b98a62" stroke-width="1" fill="none"/>
  <path d="M49 46 Q51 52 48 53" stroke="#b98a62" stroke-width="1.3" fill="none"/>
  ${MOUTHS(59, 6)}</svg>`,

  ken: () => `<svg viewBox="0 0 100 100" class="pt-face">
  <path d="M8 100 C12 79 28 71 50 71 C72 71 88 79 92 100Z" fill="#e9e1cf"/>
  <path d="M42 71 L50 84 L58 71" fill="#f5b5c9"/>
  <rect x="43" y="57" width="14" height="16" rx="5" fill="#e3b08c"/>
  <ellipse cx="50" cy="45" rx="16.5" ry="19.5" fill="#f0c3a0"/>
  <path d="M32 44 C29 20 46 16 56 18 C70 21 72 34 68 44 C66 30 58 26 50 27 C42 28 36 33 32 44Z" fill="#6b4a2b"/>
  ${BROWS(37, '#4a321c')}${EYES(44)}
  ${MOUTHS(58, 7)}</svg>`,
};

/** Tommy at the podium (pitch). Arm group `.tv-arm` animates while talking. */
export const TOMMY_PODIUM = (logo = 'VIBE') => `<svg viewBox="0 0 220 330" class="tv-svg">
<defs>
  <pattern id="vcmg-hawaii" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(18)">
    <rect width="26" height="26" fill="#1aa6bf"/>
    <path d="M4 18 q6 -10 14 -2" stroke="#0f6f68" stroke-width="3" fill="none"/>
    <g transform="translate(8 8)"><circle r="3.4" fill="#ff5fa2"/><circle cx="3.6" cy="1" r="3" fill="#ff5fa2"/><circle cx="-3.4" cy="1.4" r="3" fill="#ff5fa2"/><circle cx="1" cy="-3.4" r="3" fill="#ff5fa2"/><circle cx="-1.6" cy="3.4" r="3" fill="#ff5fa2"/><circle r="1.4" fill="#ffd23f"/></g>
    <g transform="translate(20 21) scale(.7)"><circle r="3.4" fill="#ffd23f"/><circle cx="3.6" cy="1" r="3" fill="#ffd23f"/><circle cx="-3.4" cy="1.4" r="3" fill="#ffd23f"/><circle cx="1" cy="-3.4" r="3" fill="#ffd23f"/><circle r="1.3" fill="#ff7a59"/></g>
  </pattern>
  <linearGradient id="vcmg-pod" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2a2150"/><stop offset="1" stop-color="#120c2b"/></linearGradient>
</defs>
<ellipse cx="110" cy="322" rx="96" ry="8" fill="rgba(0,0,0,.45)"/>
<!-- torso -->
<path d="M62 132 C66 118 86 110 110 110 C134 110 154 118 158 132 L166 230 L54 230Z" fill="url(#vcmg-hawaii)"/>
<path d="M96 112 L110 140 L124 112Z" fill="#d49a72"/>
<path d="M92 110 L110 140 L100 150 L86 116Z M128 110 L110 140 L120 150 L134 116Z" fill="#17899e"/>
<!-- left arm on podium -->
<path d="M64 134 C52 150 50 176 58 196 L74 200 C70 180 72 160 78 146Z" fill="url(#vcmg-hawaii)"/>
<ellipse cx="68" cy="200" rx="10" ry="7" fill="#d49a72"/>
<!-- right arm gesturing -->
<g class="tv-arm" style="transform-origin:152px 136px">
  <path d="M150 130 C168 134 182 120 190 96 L178 90 C172 108 162 118 146 120Z" fill="url(#vcmg-hawaii)"/>
  <g transform="translate(186 86)"><ellipse rx="9" ry="10" fill="#d49a72"/><rect x="-3" y="-20" width="6" height="14" rx="3" fill="#d49a72"/></g>
</g>
<!-- neck & head -->
<rect x="99" y="92" width="22" height="24" rx="8" fill="#c98e67"/>
<g class="tv-head" style="transform-origin:110px 100px">
  <path d="M86 64 C86 40 98 30 112 30 C128 30 136 42 135 64 C135 84 126 100 110 101 C95 101 86 86 86 64Z" fill="#d9a37e"/>
  <path d="M84 62 C80 34 100 22 116 24 C132 26 140 38 137 60 C134 46 128 40 118 39 C106 38 96 40 90 50 C88 54 86 58 84 62Z" fill="#2b1a12"/>
  <path d="M86 58 L88 76 L91 76 L90 60Z M135 58 L133 76 L130 76 L131 60Z" fill="#2b1a12"/>
  <path d="M96 58 L105 56 M117 56 L126 58" stroke="#2b1a12" stroke-width="3" stroke-linecap="round"/>
  <ellipse cx="101" cy="64" rx="2.3" ry="2.6" fill="#1b1414"/><ellipse cx="121" cy="64" rx="2.3" ry="2.6" fill="#1b1414"/>
  <path d="M110 66 L108 78 L113 78" stroke="#a8734f" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path class="tv-mouth" d="M101 86 Q111 91 121 86" stroke="#6b2d22" stroke-width="2.6" fill="none" stroke-linecap="round"/>
  <path d="M92 84 Q110 104 130 84 Q126 98 110 100 Q94 98 92 84Z" fill="#2b1a12" opacity=".18"/>
</g>
<!-- podium -->
<path d="M34 214 L186 214 L176 330 L44 330Z" fill="url(#vcmg-pod)"/>
<path d="M30 206 L190 206 L190 216 L30 216Z" fill="#3b2f78"/>
<path d="M30 206 L190 206" stroke="#ff3ea5" stroke-width="2"/>
<rect x="64" y="246" width="92" height="34" rx="6" fill="none" stroke="#26e0ff" stroke-width="2" opacity=".8"/>
<text x="110" y="270" text-anchor="middle" font-family="Anton, Impact, sans-serif" font-size="18" fill="#26e0ff" letter-spacing="2">${logo}</text>
<path d="M142 206 L150 176" stroke="#999" stroke-width="2.5"/><ellipse cx="151" cy="172" rx="4" ry="6" fill="#222" stroke="#666"/>
</svg>`;

/** Tommy seated, back to us, for the SkyPark negotiation. */
export const TOMMY_BACK = `<svg viewBox="0 0 200 200" class="tv-back">
<path d="M30 200 C34 150 60 128 100 128 C140 128 166 150 170 200Z" fill="url(#vcmg-hawaii-b)"/>
<defs><pattern id="vcmg-hawaii-b" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(18)"><rect width="22" height="22" fill="#1aa6bf"/><circle cx="7" cy="7" r="4" fill="#ff5fa2"/><circle cx="7" cy="7" r="1.5" fill="#ffd23f"/><circle cx="17" cy="17" r="3" fill="#ffd23f"/><path d="M2 16 q5 -8 11 -2" stroke="#0f6f68" stroke-width="2.4" fill="none"/></pattern></defs>
<rect x="88" y="104" width="24" height="30" rx="8" fill="#c98e67"/>
<ellipse cx="100" cy="84" rx="28" ry="32" fill="#2b1a12"/>
<path d="M74 92 C74 70 84 58 100 58 C116 58 126 70 126 92 C120 80 112 76 100 76 C88 76 80 80 74 92Z" fill="#3a2418"/>
</svg>`;
