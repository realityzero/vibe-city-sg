// "Uncle's Singlish Quiz": the taxi uncle tests Tommy's Singlish during a ride. Good answers = better tips.
import { h, mountShell, runShell, pick, sleep, sfx, typeText } from './common.js';

const BANK = [
  ['paiseh', 'Eh boss, you know what "paiseh" means or not?', 'Embarrassed / sorry', ['A type of fish cake', 'Pay later', 'Very spicy']],
  ['shiok', '"Wah, this chicken rice damn shiok." Shiok means what?', 'Awesome, delicious, satisfying', ['Shocking', 'Too salty', 'Expensive']],
  ['bo jio', 'Your friends go makan without you. You say "bo jio!" — means?', 'You didn\'t invite me!', ['No problem', 'Bon appétit', 'Go away']],
  ['kiasu', 'People queue 3 hours for free bubble tea. Very "kiasu". Means?', 'Afraid of losing out', ['Very patient', 'Very thirsty', 'Rich']],
  ['chope', 'Put tissue packet on the seat — this one called?', 'Chope — reserving a seat', ['Littering', 'Feng shui', 'Tipping']],
  ['lepak', 'Weekend you go "lepak" at East Coast. Means?', 'Chill, hang out, relax', ['Jog', 'Fish', 'Protest']],
  ['sian', 'Monday morning, ERP jam, aircon spoil. Very "sian". Means?', 'Bored / fed up / tired', ['Happy', 'Cold', 'Late']],
  ['alamak', 'Uncle miss the exit: "Alamak!" Means?', 'Oh no! / Oh dear!', ['Let\'s go!', 'Turn left', 'Thank god']],
  ['makan', 'After this I go "makan". Means?', 'Eat', ['Sleep', 'Pray', 'Drive']],
  ['atas', 'Marina Bay Sands very "atas" one. Means?', 'Posh / high-class / snobbish', ['Tall', 'Haunted', 'Cheap']],
  ['blur', 'Your friend very "blur" today. Means?', 'Confused / clueless', ['Drunk', 'Invisible', 'Angry']],
  ['kena', 'Speed camera flash — confirm "kena" fine. Kena means?', 'Got hit by (something bad)', ['Avoided', 'Paid for', 'Won']],
  ['jialat', 'PIE jam until Changi. Jialat! Means?', 'Terrible / very bad situation', ['Lucky', 'Fast', 'Delicious']],
  ['tapau', '"Uncle, chicken rice tapau." Means?', 'Takeaway', ['Extra chilli', 'Less rice', 'Eat here']],
  ['kaypoh', 'Auntie at the void deck very "kaypoh". Means?', 'Busybody, nosy', ['Generous', 'Sleepy', 'Fashionable']],
  ['gostan', 'Wrong turn. Uncle "gostan" a bit. Means?', 'Reverse the car', ['Go to Stanford', 'Speed up', 'Honk']],
  ['ulu', 'Lim Chu Kang very "ulu". Means?', 'Remote, out of the way', ['Expensive', 'Crowded', 'Famous']],
  ['agak agak', 'How much fare? "Agak agak" twenty dollar. Means?', 'Roughly / estimate', ['Exactly', 'Free', 'Double']],
  ['lobang', 'I got good "lobang" for you — cheap condo. Means?', 'A good deal / opportunity', ['A pothole', 'A scam (definitely)', 'A secret']],
  ['steady', 'You answer correctly — "Steady lah!" Means?', 'Well done / cool / reliable', ['Slow down', 'Hold on', 'Boring']],
  ['abuden', 'Is durian smelly? "Abuden?" Means?', 'Obviously! / What else?', ['Maybe', 'Not at all', 'Bless you']],
  ['kancheong', 'Don\'t be so "kancheong", we reach on time. Means?', 'Anxious, nervous, panicky', ['Happy', 'Hungry', 'Loud']],
  ['can or not', 'Boss asks: "This one can or not?" Means?', 'Is it possible?', ['Can you open the can?', 'Recycling question', 'Rude insult']],
  ['wah lau', '"Wah lau eh!" Usually means?', 'An exclamation of disbelief', ['A greeting to elders', 'A Hokkien noodle', 'A taxi company']],
  ['siam', 'Uncle "siam" the ERP gantry. Means?', 'Avoid / dodge', ['Pay double', 'Crash into', 'Photograph']],
  ['zhun', 'Your GPS very "zhun". Means?', 'Accurate', ['Broken', 'Expensive', 'Loud']],
];
const RIGHT = ['Wah! You local already ah!', 'Steady lah, boss!', 'Correct! You sure you from America?', 'Power! Next time I charge you local price.', 'Ho seh bo! Correct!'];
const WRONG = ['Aiyoh… ang moh confirm.', 'Wrong lah, boss!', 'Hahaha, close… not really.', 'Wah lau, you stay here how long already?'];
const TIMEOUT = ['Hello? Sleeping ah?', 'Too slow, the ERP also faster than you.'];

/**
 * @param {HTMLElement} root
 * @param {{audio?, count?: number, onEvent?, signal?: AbortSignal, destination?: string}} opts
 * @returns {Promise<{correct, total}>}
 */
export function runSinglishQuiz(root, opts = {}) {
  const ctx = mountShell(root, { kind: 'quiz', signal: opts.signal, onEvent: opts.onEvent });
  return runShell(play(ctx, opts), ctx);
}

async function play(ctx, opts) {
  const { scope, shell } = ctx;
  const { audio, onEvent } = opts;
  const total = opts.count ?? 5;
  const qs = [...BANK].sort(() => Math.random() - 0.5).slice(0, total);
  let correct = 0, fare = 4.1 + Math.random() * 3;

  const fareB = h('b', null, `S$ ${fare.toFixed(2)}`);
  const mirror = h('div', { class: 'tx-mirror' }, h('div', { class: 'tx-eyes' }, h('i'), h('i')), h('div', { class: 'tx-brows' }, h('i'), h('i')));
  const bubble = h('div', { class: 'tx-bubble' });
  const card = h('div', { class: 'tx-card' });
  const dots = h('div', { class: 'tx-dots' }, qs.map(() => h('i')));
  const stage = h('div', { class: 'tx' },
    h('div', { class: 'tx-view' }, h('div', { class: 'tx-sky' }), h('div', { class: 'tx-city' }), h('div', { class: 'tx-road' }, h('div', { class: 'tx-lines' })), h('div', { class: 'tx-lamps' }, h('i'), h('i'), h('i'), h('i'))),
    h('div', { class: 'tx-frame' }),
    mirror,
    h('div', { class: 'tx-dash' },
      h('div', { class: 'tx-meter' }, h('small', null, 'HIRED · FARE'), fareB),
      h('div', { class: 'tx-radio' }, '📻 987FM · "Traffic on the CTE is heavy, as usual"'),
      h('div', { class: 'tx-dest' }, `→ ${opts.destination || 'Marina Bay Sands'}`)),
    h('div', { class: 'tx-uncle' }),
    h('div', { class: 'tx-seat tx-seat--l' }),
    h('div', { class: 'tx-seat tx-seat--r' }),
    bubble, dots, card);
  shell.append(stage);
  // passing skyline: two identical strips so the scroll loops seamlessly
  const city = stage.querySelector('.tx-city');
  const strip = () => h('div', { class: 'tx-strip' }, Array.from({ length: 26 }, (_, i) => {
    const hgt = 18 + ((i * 37) % 11) * 6 + (i % 5 === 0 ? 30 : 0);
    return h('i', { style: { height: `${hgt}%`, width: `${2.2 + (i * 13 % 4)}%`, marginLeft: `${0.4 + (i * 7 % 3) * 0.5}%` } });
  }));
  city.append(h('div', { class: 'tx-scroll' }, strip(), strip()));

  scope.loop(dt => { fare += dt * 0.07; fareB.textContent = `S$ ${fare.toFixed(2)}`; });
  const uncle = async (text, mood = '') => {
    mirror.className = `tx-mirror ${mood}`;
    bubble.classList.add('is-on');
    await typeText(scope, bubble, text, 60, stage);
  };

  await uncle(pick(['Eh boss, long ride. I test your Singlish, can? Answer correct, I don\'t charge you the ERP.', 'Where you from? America ah? Okay, okay. I give you Singlish test. Pass already you can stay.']));
  await sleep(scope, 900);

  for (let i = 0; i < qs.length; i++) {
    const [word, q, ans, wrongs] = qs[i];
    [...dots.children].forEach((d, j) => { if (j === i) d.className = 'cur'; });
    await uncle(q);
    const opts4 = [ans, ...wrongs].sort(() => Math.random() - 0.5);
    const pickIdx = await new Promise(resolve => {
      let left = 12, done = false;
      const bar = h('i');
      const btns = opts4.map((t, n) => h('button', { class: 'tx-ans', onclick: () => choose(n), onmouseenter: () => sfx(audio, 'ui_hover') }, h('kbd', null, String(n + 1)), t));
      card.replaceChildren(h('div', { class: 'tx-q' }, h('span', null, `Q${i + 1}/${qs.length} · `), h('b', null, `"${word}"`)), h('div', { class: 'tx-ans-grid' }, btns), h('div', { class: 'tx-time' }, bar));
      card.classList.add('is-on');
      const choose = n => {
        if (done || scope.paused) return; done = true;
        stop(); window.removeEventListener('keydown', k, true);
        btns.forEach((b, j) => b.classList.add(opts4[j] === ans ? 'is-right' : j === n ? 'is-wrong' : 'is-dim'));
        resolve(n);
      };
      const k = e => { const n = +e.key; if (n >= 1 && n <= 4 && !e.repeat) { e.preventDefault(); choose(n - 1); } };
      window.addEventListener('keydown', k, true);
      scope.add(() => window.removeEventListener('keydown', k, true));
      const stop = scope.loop(dt => { left -= dt; bar.style.width = `${Math.max(0, left / 12) * 100}%`; if (left <= 0 && !done) { done = true; window.removeEventListener('keydown', k, true); btns.forEach((b, j) => b.classList.add(opts4[j] === ans ? 'is-right' : 'is-dim')); resolve(-1); return false; } });
    });
    const ok = pickIdx >= 0 && opts4[pickIdx] === ans;
    if (ok) { correct++; sfx(audio, 'checkpoint'); } else sfx(audio, 'ui_hover');
    dots.children[i].className = ok ? 'ok' : 'bad';
    onEvent?.({ type: 'quiz_answer', word, ok });
    await uncle(`${pickIdx < 0 ? pick(TIMEOUT) : ok ? pick(RIGHT) : pick(WRONG)} ${ok ? '' : `"${word}" means: ${ans.toLowerCase()}.`}`, ok ? 'is-happy' : 'is-sad');
    await sleep(scope, 1100);
    card.classList.remove('is-on');
    await sleep(scope, 250);
  }

  const result = { correct, total: qs.length };
  onEvent?.({ type: 'quiz_done', ...result });
  const verdict = correct === qs.length ? 'Wah, full marks! You sure you not from Ang Mo Kio?' : correct >= qs.length * 0.6 ? 'Not bad! Half local already.' : 'Aiyoh. Next time I take you on the long route.';
  await uncle(verdict, correct >= qs.length * 0.6 ? 'is-happy' : 'is-sad');
  sfx(audio, correct >= qs.length * 0.6 ? 'cash_register' : 'checkpoint');
  const res = h('div', { class: 'ng-res is-tx' },
    h('div', { class: 'ng-res-k' }, 'SINGLISH TEST'),
    h('div', { class: 'ng-res-big' }, `${correct} / ${qs.length}`, h('small', null, 'CORRECT')),
    h('div', { class: 'ng-res-q' }, `“${verdict}” — Uncle Lim, taxi #SH 1234 A`),
    h('button', { class: 'mg-btn mg-btn--primary mg-btn--big' }, 'Continue  ▸'));
  stage.append(h('div', { class: 'ng-res-wrap' }, res));
  requestAnimationFrame(() => res.classList.add('is-in'));
  await new Promise(resolve => {
    const fin = () => { if (scope.paused) return; sfx(audio, 'ui_select'); resolve(); };
    res.querySelector('button').onclick = fin;
    const k = e => { if (e.key === 'Enter' && !e.repeat) { e.preventDefault(); fin(); } };
    scope.timeout(() => { window.addEventListener('keydown', k, true); scope.add(() => window.removeEventListener('keydown', k, true)); }, 500);
  });
  return result;
}
