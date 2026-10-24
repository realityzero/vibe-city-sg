// Kopitiam order phrasing, shared by the Kopi Uncle minigame and the offline voice-over generator (tools/vo/gen-dyn.mjs
// enumerates every order through allOrders() and renders each term / English phrase as a clip, and every reaction).
const SUGAR_WORD = ['kosong', 'siew dai', '', 'ga dai'];
export const fresh = () => ({ base: null, milk: 'condensed', sugar: 2, strength: 'normal', ice: false, extra: 'none', dabao: false });

/** the words of a drink's kopitiam name, in the order uncles actually say them */
export function nameTerms(d) {
  if (!d.base) return [];
  const w = [];
  if (d.base === 'milo') {
    w.push(d.milk === 'condensed' ? 'Milo' : d.milk === 'none' ? 'Milo-O' : 'Milo-C');
    if (d.extra === 'dino') w.push('dinosaur');
  } else if (d.base === 'cham') {
    w.push(d.milk === 'condensed' ? 'Yuan Yang' : d.milk === 'none' ? 'Yuan Yang-O' : 'Yuan Yang-C');
  } else {
    const b = d.base === 'kopi' ? 'Kopi' : 'Teh';
    w.push(b + (d.milk === 'none' ? '-O' : d.milk === 'evap' ? '-C' : ''));
    if (d.extra === 'tarik') w.push('tarik');
  }
  if (d.strength !== 'normal') w.push(d.strength);
  if (SUGAR_WORD[d.sugar]) w.push(SUGAR_WORD[d.sugar]);
  if (d.ice && d.extra !== 'dino') w.push('peng');
  if (d.base !== 'milo' && d.extra === 'dino') w.push('+ dino?!');
  if (d.base !== 'teh' && d.extra === 'tarik') w.push('+ tarik?!');
  if (d.dabao) w.push('da bao');
  return w;
}
/** Kopitiam name for a drink, in the order uncles actually hear it. */
export function nameOf(d) { return d.base ? nameTerms(d).join(' ') : '…'; }

/** an English order as phrases: "Coffee with condensed milk", "extra strong", "iced" (then "please?") */
export function englishParts(d) {
  const base = { kopi: 'coffee', teh: 'tea', milo: 'Milo', cham: 'coffee-and-tea mix' }[d.base];
  const sugar = ['no sugar', 'a little sugar', 'sugar', 'lots of sugar'][d.sugar];
  const parts = [];
  if (d.milk === 'none') parts.push(d.base === 'kopi' ? `black coffee with ${sugar}`.replace('with no sugar', 'no sugar') : `${base}, no milk, ${sugar}`);
  else {
    parts.push(d.base === 'milo' ? 'Milo' : `${base} with ${d.milk === 'evap' ? 'evaporated' : 'condensed'} milk`);
    if (d.sugar !== 2) parts.push(['no sugar', 'less sweet', '', 'extra sweet'][d.sugar]);
  }
  if (d.strength === 'gao') parts.push('extra strong'); if (d.strength === 'po') parts.push('weak');
  if (d.extra === 'tarik') parts.push('the pulled frothy one');
  if (d.extra === 'dino') parts.push('iced, with a MOUNTAIN of Milo powder on top');
  else if (d.ice) parts.push('iced');
  if (d.dabao) parts.push('to go');
  return parts.filter(Boolean);
}
export function english(d) { return englishParts(d).join(', ').replace(/^./, c => c.toUpperCase()) + ', please?'; }

/** every order a customer can place (a superset of what genOrder() produces, plus the VIPs' fixed orders) */
export function allOrders() {
  const out = [];
  for (const base of ['kopi', 'teh', 'milo', 'cham'])
    for (const milk of ['condensed', 'none', 'evap'])
      for (const strength of ['po', 'normal', 'gao'])
        for (const sugar of [0, 1, 2, 3])
          for (const ice of [false, true])
            for (const extra of ['none', 'tarik', 'dino'])
              for (const dabao of [false, true]) {
                if ((base === 'milo' || base === 'cham') && (milk !== 'condensed' || strength !== 'normal')) continue;
                if (extra === 'tarik' && !(base === 'teh' && milk === 'condensed' && strength === 'normal')) continue;
                if (extra === 'dino' && !(base === 'milo' && ice)) continue;
                out.push({ base, milk, strength, sugar, ice, extra, dabao });
              }
  return out;
}

/** what customers say when served (or when they give up); VIPs have their own perfect-drink line */
export const LINES = {
  perfect: ['Shiok! 👍', 'Wah, uncle power!', 'This one correct. Steady!', 'Exactly like my ah ma made.', 'Power lah!', 'Swee!'],
  partial: ['Hmm… can lah.', 'Close enough, I\'m late already.', 'Not bad, next time listen properly.', 'Ok… I drink first.'],
  bad: ['Wah lau eh.', 'Uncle, you blur ah?', 'Aiyoh!'],
  walk: ['Too slow lah, I go other stall.', 'Aiyoh, I wait until my kopi also cold.', 'Bo jio, bo kopi. I go.'],
  vipPerfect: { 'Chad · Sandhill Partners': 'Bro. This is better than Blue Bottle.', 'Ken Rosenberg': 'Tommy, this is the best thing that\'s happened to me all week.', 'Priya · Merlion Ventures': 'Precise. I like precise.', 'Auntie Mei · investor': 'Good. Now go back to your startup.' },
};
/** the complaint about the first thing wrong with a drink */
export const complain = (field, want) => ({
  base: `Aiyoh, I order ${want.base === 'kopi' ? 'kopi' : want.base === 'teh' ? 'teh' : want.base === 'milo' ? 'Milo' : 'yuan yang'} leh!`,
  milk: want.milk === 'none' ? 'I said -O! No milk!' : want.milk === 'evap' ? 'Where my -C? Evaporated milk!' : 'Where the condensed milk?!',
  sugar: want.sugar === 0 ? 'I say KOSONG! You want me diabetes ah?' : want.sugar === 1 ? 'Siew dai means LESS sugar lah!' : want.sugar === 3 ? 'Ga dai! More sugar!' : 'Too much fiddling with my sugar!',
  strength: want.strength === 'gao' ? 'Gao lah! Strong strong one!' : want.strength === 'po' ? 'Po! I want it weak!' : 'Why so strong/weak? Normal can already!',
  ice: want.ice ? 'I said PENG! Hot like this how to drink?' : 'Why got ice? I never say peng!',
  extra: want.extra === 'tarik' ? 'Where the tarik? Must pull!' : want.extra === 'dino' ? 'Dinosaur means MOUNTAIN of Milo!' : 'What is this topping?!',
  dabao: want.dabao ? 'I said da bao! Plastic bag!' : 'I drink here lah, why bag?',
})[field];

/** every line a customer can react with: the fixed ones plus each complaint any order can produce */
export function reactionLines() {
  const s = new Set([...LINES.perfect, ...LINES.partial, ...LINES.bad, ...LINES.walk]);
  for (const d of allOrders()) for (const f of ['base', 'milk', 'sugar', 'strength', 'ice', 'extra', 'dabao']) s.add(complain(f, d));
  return [...s];
}
