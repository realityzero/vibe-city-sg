// Content for the Demo Day pitch: investors, slides, buzzword QTEs, questions & reactions.

import { pitchSlideSpeak, pitchPriyaSpeak, pitchWauSpeak } from '../../missions/vodyn.js'; // spoken forms (finite) of the user-count lines
export const INVESTORS = {
  merlion: { key: 'merlion', name: 'Priya Raman', firm: 'Merlion Ventures', role: 'Partner · data or it didn\'t happen', color: '#26e0ff' },
  sandhill: { key: 'sandhill', name: 'Chad Brogan', firm: 'Sandhill Partners', role: 'GP · flew in from Palo Alto, still jetlagged', color: '#ffb347' },
  auntie: { key: 'auntie', name: 'Auntie Mei', firm: 'Mei Family Office', role: 'Angel · owns 6 chicken rice stalls', color: '#ff3ea5' },
};

const by = (idea, o) => o[idea] ?? o.default;

export function slides(idea, { users }) {
  const u = Math.max(50, Math.round(users));
  return [
    {
      kind: 'problem', title: 'THE PROBLEM',
      headline: by(idea, { chopechain: '2.1M lunches. 0 APIs.', kopiai: 'Ordering kopi is a 14-variable problem.', duriandash: 'Durians are banned on the MRT. Demand is not.' }),
      stat: by(idea, { chopechain: '11 min', kopiai: '14', duriandash: '40 min' }),
      statLabel: by(idea, { chopechain: 'lost per day hunting seats', kopiai: 'variables before 9am', duriandash: 'average trip to Geylang' }),
      icon: by(idea, { chopechain: '🧻', kopiai: '☕', duriandash: '🚇' }),
      bullets: by(idea, {
        chopechain: ['Office workers chope seats with tissue packets', 'Tissue packets have no uptime SLA', 'S$ 1.4B/yr in lost productivity*'],
        kopiai: ['"Kopi-C kosong siew dai peng" is a lot before 9am', 'Uncles retire. Their knowledge dies with them.', '3 kopis/day × 6M people*'],
        duriandash: ['Taxis refuse durians (and Tommy)', 'Condos have WhatsApp groups', 'Smell is the last-mile problem*'],
      }),
      foot: '*Ken did the maths',
      line: by(idea, {
        chopechain: 'Every day, two million Singaporeans fight for a seat with a tissue packet. That ends today.',
        kopiai: 'Every morning, millions of Singaporeans whisper a 14-word kopi order to a tired uncle. That ends today.',
        duriandash: 'Durians: the king of fruits. Banned from trains, refused by taxis, hated by condos. That ends today.',
      }),
      buzz: ['PAIN POINT', 'TAM'],
    },
    {
      kind: 'solution', title: 'THE SOLUTION',
      headline: by(idea, { chopechain: 'Scan. Chope. Makan.', kopiai: 'Your kopi, predicted.', duriandash: 'Durians. From the sky. In 15.' }),
      phone: by(idea, {
        chopechain: ['Maxwell Food Centre', 'Table 12 · Seat B', 'CHOPED ✅', '20:00 left — enjoy your chicken rice'],
        kopiai: ['Lau Pa Sat · Stall 7', 'Predicted order', 'Kopi-C siew dai peng', '97% confidence ☕'],
        duriandash: ['Order #8841', 'Musang King × 2', 'ETA 14 min 🚁', 'cruising at 120 m (above smell range)'],
      }),
      bullets: by(idea, {
        chopechain: ['QR on every table', 'Seat held on-chain for 20 min', 'Auntie-proof (pending)'],
        kopiai: ['Learns from 30 days of orders', 'Sends order before you sit', 'Works in Singlish'],
        duriandash: ['Drones avoid MRT & condos', 'Sealed smell-proof pods', 'Cash on delivery (Auntie-approved)'],
      }),
      line: by(idea, {
        chopechain: 'ChopeChain. Scan the table, your seat is held on the blockchain, and you eat in peace. Like civilised people.',
        kopiai: 'Kopi.ai knows your order before you sit down. The uncle just nods. Respect, efficiency, caffeine.',
        duriandash: 'DurianDash. Fifteen minutes from tree to table. The MRT can\'t stop us if we\'re in the sky.',
      }),
      buzz: ['AI-NATIVE', 'PLATFORM'],
    },
    {
      kind: 'traction', title: 'TRACTION',
      headline: `${u.toLocaleString('en-SG')} users`,
      bullets: ['340% MoM growth*', 'NPS: "shiok"', `${Math.round(u * 0.38).toLocaleString('en-SG')} weekly actives`],
      foot: '*one month of data',
      users: u,
      line: `${u.toLocaleString('en-SG')} users, growing three hundred and forty percent month on month. Look at that line. That's the line investors dream about.`,
      speak: pitchSlideSpeak(u),
      buzz: ['HOCKEY STICK', 'FLYWHEEL'],
    },
    {
      kind: 'model', title: 'BUSINESS MODEL',
      headline: by(idea, { chopechain: 'S$ 0.30 per chope', kopiai: 'S$ 0.20 per prediction', duriandash: 'S$ 12 + S$ 3 smell surcharge' }),
      pie: by(idea, {
        chopechain: [['Chope fees', 55], ['ChopeChain Black', 30], ['Ads on tissue packets', 15]],
        kopiai: [['Predictions', 50], ['Uncle-as-a-Service', 35], ['Ads on the cup', 15]],
        duriandash: [['Delivery fees', 60], ['Durian Fridays (B2B)', 25], ['Carbon credits (?)', 15]],
      }),
      line: 'We make money every single time someone does the most Singaporean thing possible. And we take a little cut. Like the government, but friendlier.',
      buzz: ['UNIT ECONOMICS', 'MONETISATION'],
    },
    {
      kind: 'ask', title: 'THE ASK',
      headline: 'Raising S$ 5M @ S$ 50M pre',
      funds: [['GPUs', 40, '#26e0ff'], ['Growth (aunties outreach)', 25, '#7cff6b'], ['Legal (Ken)', 20, '#ffd23f'], ['Hawaiian shirts', 15, '#ff3ea5']],
      line: 'We\'re raising five million at fifty pre. The rocket is fuelled. All we need is you to light it.',
      buzz: ['10X', 'BLITZSCALE'],
    },
  ];
}

const R = (merlion, sandhill, auntie) => ({ merlion, sandhill, auntie });

export function questions(idea, { users }) {
  const wau = Math.round(Math.max(50, users) * 0.38).toLocaleString('en-SG');
  const big = users >= 2000;
  return [
    {
      from: 'auntie',
      text: by(idea, {
        chopechain: 'Last time people chope with tissue packet, free one. Why I pay you?',
        kopiai: 'The uncle at my kopitiam knows my order thirty years already. Why I need AI?',
        duriandash: 'I walk to Geylang, five minutes only. Why need drone?',
      }),
      answers: [
        { text: by(idea, { chopechain: 'Fair, Auntie. But office workers waste 11 minutes a day hunting seats. Time is money — your money, if you invest.', kopiai: 'Your uncle is retiring, Auntie. When he goes, who remembers your order? Kopi.ai does.', duriandash: 'Not everyone lives near Geylang, Auntie. And no taxi will take a durian. I checked. Personally.' }),
          fx: { cred: 8, hype: 2, ...R(6, 0, 10) }, react: R('Specific. I like specific.', null, 'Hmm. Ok, this one can talk.') },
        { text: 'With respect, Auntie — the old way is over. I\'m the new tissue packet.', fx: { hype: 10, cred: -2, ...R(0, 8, 4) }, react: R(null, 'Founder energy. Love it.', 'Wah, this one got guts.') },
        { text: 'We\'re disrupting the seat-as-a-service vertical with an AI-native, Web3 trust layer.', fx: { hype: 8, cred: -6, ...R(-10, 12, -12) }, react: R('That\'s four buzzwords and zero facts.', 'Say "trust layer" again.', 'Speak English can or not?') },
        { text: 'Because I said so.', fx: { hype: 3, cred: -8, ...R(-6, 2, -4) }, react: R('*writes something down*', null, 'Aiyoh.') },
      ],
    },
    {
      from: 'sandhill',
      text: 'Love the vision. But is it AI? Like… could it become AGI?',
      answers: [
        { text: 'It\'s a narrow model plus great UX. It doesn\'t need to be AGI to save people time.', fx: { cred: 10, hype: -2, ...R(10, -4, 4) }, react: R('Finally, an adult.', 'Narrow? Bro.', null) },
        { text: 'It\'s AGI-adjacent, agentic, multimodal and frankly sentient on weekends.', fx: { hype: 12, cred: -8, ...R(-12, 14, -2) }, react: R('It is not sentient.', 'I just got chills. Actual chills.', null) },
        { text: 'Chad, it\'s whatever you need it to be to sign the cheque.', fx: { hype: 6, cred: -2, ...R(-2, 8, 4) }, react: R(null, 'Ha! I like this guy.', 'Clever boy.') },
        { text: 'The AI is me. I\'m the AI.', fx: { hype: 4, cred: -6, ...R(-6, 4, -2) }, react: R('Please stop.', 'Founder-model fit.', null) },
      ],
    },
    {
      from: 'merlion',
      text: `Your slide says ${Math.max(50, Math.round(users)).toLocaleString('en-SG')} users. How many are weekly active — and how many are your relatives?`,
      speak: pitchPriyaSpeak(users),
      answers: [
        { text: `About ${wau} weekly actives. Zero relatives — I don't have any in Singapore. Yet.`, speak: pitchWauSpeak(users), fx: { cred: big ? 16 : 12, hype: 2, ...R(big ? 18 : 14, 0, 4) }, react: R(big ? 'Retention. Real retention. Good.' : 'Small, but honest. Good.', null, 'Honest boy.') },
        { text: 'All of them. Daily. Hourly, some of them.', fx: { hype: 8, cred: -12, ...R(-14, 6, 0) }, react: R('Your own dashboard says otherwise.', 'Hourly actives. Iconic.', null) },
        { text: 'Priya, the real metric is vibes per user, and ours are off the charts.', fx: { hype: 6, cred: -8, ...R(-10, 8, -2) }, react: R('That is not a metric.', 'VPU. Writing that down.', null) },
        { text: 'Ken counts as three users. He has three phones.', fx: { hype: 3, cred: -4, ...R(-4, 2, 6) }, react: R('Please tell me you\'re joking.', null, 'Hahaha, this Ken ah.') },
      ],
    },
    {
      from: 'auntie',
      text: 'Ok, ok. Can make money or not?',
      answers: [
        { text: by(idea, { chopechain: 'Yes. 30 cents a chope, 40% margins, profitable at 50,000 users.', kopiai: 'Yes. 20 cents a prediction, plus licensing to kopitiam chains. Profitable at 60,000 users.', duriandash: 'Yes. S$ 15 a delivery, 35% margin after drone batteries. Profitable at 20,000 orders a month.' }), fx: { cred: 12, hype: 0, ...R(8, 0, 16) }, react: R('Unit economics. Thank you.', null, 'Now we talking!') },
        { text: 'Not yet — we\'re optimising for growth. Profit is a 2030 problem.', fx: { hype: 6, cred: -2, ...R(-2, 10, -14) }, react: R(null, 'Growth at all costs. Classic.', '2030?! I want to see money before I die.') },
        { text: 'Money is a legacy metric, Auntie. We measure engagement.', fx: { hype: 2, cred: -8, ...R(-8, 6, -18) }, react: R('No.', 'Engagement is the new revenue.', 'Wah lau eh.') },
        { text: 'We make money the old-fashioned way, Auntie. Don\'t ask too many questions.', fx: { hype: 6, cred: -6, ...R(-10, 2, 6) }, react: R('We will be asking questions.', null, 'Okay, I like your style. But I will ask.') },
      ],
    },
    {
      from: 'merlion',
      text: 'S$ 5M at S$ 50M pre. Justify that valuation.',
      answers: [
        { text: 'Comparable SEA marketplaces trade at 10x forward ARR. Here\'s our path to S$ 5M ARR in 24 months.', fx: { cred: 12, hype: 2, ...R(14, 6, 6) }, react: R('Send me that model tonight.', 'Spreadsheets. Hot.', null) },
        { text: 'Let\'s just say my last investor, in Liberty City, wasn\'t the negotiating type.', fx: { hype: 8, cred: -6, ...R(-8, 6, 2) }, react: R('Is that… a threat?', 'Edgy. I respect it.', null) },
        { text: 'It\'s a vibe-based valuation. And the vibes are immaculate.', fx: { hype: 10, cred: -10, ...R(-12, 12, -6) }, react: R('I\'m going to need a stronger coffee.', 'Immaculate vibes confirmed.', 'What is vibe?') },
        { text: 'Fine. S$ 3M at S$ 30M if you commit today.', fx: { hype: -6, cred: 6, ...R(8, -4, 10) }, react: R('Pragmatic.', 'Wait, why are we going down?', 'Discount! Now we talking.') },
      ],
    },
  ];
}

export const TIMEOUT_ANSWER = {
  text: '…', line: 'Tommy stares into the middle distance.',
  fx: { hype: 2, cred: -5, ...R(-6, 4, -4) }, react: R('Hello? Mr. Vercetti?', 'Founder intensity. 🔥', 'Sleeping ah?'),
};

export const QTE_LINES = {
  perfect: w => `…and THAT is what we call a ${w}.`,
  good: w => `…it's basically a ${w.toLowerCase()}, you know?`,
  miss: () => pickOne(['…the… uh… kopi of things.', '…it\'s like Uber, but for… Uber.', '…and the blockchain… gets… synergised.', '…sorry, what was the question?']),
};
const pickOne = a => a[Math.floor(Math.random() * a.length)];

export const QTE_REACT = {
  perfect: R(null, '🔥 Say it louder.', null),
  good: R(null, 'Nice.', null),
  miss: R('*checks phone*', null, 'Aiyoh, stammer already.'),
};

export function verdict(key, v) {
  const L = {
    merlion: ['"We\'ll pass for now. Keep in touch."', '"Interesting. Let\'s do a follow-up with real data."', '"Send me the data room. Tonight."'],
    sandhill: ['"Not a fit for our thesis, which changes weekly."', '"Let me circle back with my partners (my therapist)."', '"I\'m in. I\'m so in. Can I get a hoodie?"'],
    auntie: ['"Aiyoh. Better go back to selling insurance."', '"Come my stall tomorrow, we talk again."', '"Can. I put 50k. Cash."'],
  }[key];
  return v >= 70 ? L[2] : v >= 45 ? L[1] : L[0];
}
