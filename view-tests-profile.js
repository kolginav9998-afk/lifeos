// «Профиль характера (ориентир)»: запуск (по одному утверждению на экране), карточка на экране тестов и итог. Это самоописание, а не тест и не диагноз.
import { el, dateRu, focusNode } from './ui.js';
import { ITEMS, SCALES, ANSWER_LABELS, PROFILE_TITLE, PROFILE_NOT, scoreProfile, scaleWord, compareScale, profileLine } from './iq-profile.js';

export const lastProfile = runs => [...runs].reverse().find(r => r.tests?.selfprofile && !r.tests.selfprofile.skipped && r.tests.selfprofile.ok) ?? null;
const fmt = v => (v === null || v === undefined ? '—' : String(v).replace('.', ','));

// Строки по шкалам: название, значение, слово по середине шкалы, полоса 1–5 (с числом и словом, не только цветом) и сравнение с прошлым разом.
function scaleRows(m, before) {
  return SCALES.map(s => {
    const v = m[s.key], cmp = before ? compareScale(v, before[s.key]) : null;
    const pct = v === null || v === undefined ? 0 : ((v - 1) / 4) * 100;
    return el('div', { class: 'pf-row', dataset: { scale: s.key } },
      el('div', { class: 'pf-head' }, el('strong', { textContent: s.title }), el('span', { class: 'pf-val', textContent: `${fmt(v)} из 5 · ${scaleWord(v)}` })),
      el('div', { class: 'pf-bar', role: 'img', 'aria-label': `${s.title}: ${fmt(v)} из 5, ${scaleWord(v)}` }, el('span', { class: 'pf-fill', style: `width:${pct}%` })),
      el('p', { class: 'muted pf-about', textContent: s.about }),
      cmp ? el('p', { class: 'muted pf-cmp', textContent: cmp === 'same' ? 'С прошлым разом: примерно так же.' : cmp === 'more' ? `С прошлым разом: стало ближе (было ${fmt(before[s.key])}).` : `С прошлым разом: стало дальше (было ${fmt(before[s.key])}).` }) : null);
  });
}

// Итог для окна проверки.
export function profileResultCard(payload, before) {
  const m = payload.tests.selfprofile.metrics;
  return el('div', { class: 'pf-result', id: 'pf-result' }, el('p', { id: 'pf-n', textContent: `Отвечено утверждений: ${m.n} из ${ITEMS.length}.` }), ...scaleRows(m, before),
    el('p', { class: 'warn', id: 'pf-not', textContent: PROFILE_NOT }));
}

// Карточка на экране тестов.
export function renderProfileCard(runs, start) {
  const last = lastProfile(runs), m = last?.tests.selfprofile.metrics;
  return el('section', { class: 'card pf-card', id: 'bt-profile-card', 'aria-labelledby': 'pf-title' },
    el('h3', { id: 'pf-title', textContent: PROFILE_TITLE }),
    el('p', { class: 'muted', textContent: 'Если хочется посмотреть на себя со стороны: 25 коротких утверждений, около 5 минут. Правильных ответов нет.' }),
    el('p', { class: 'warn', id: 'pf-card-not', textContent: PROFILE_NOT }),
    last ? el('p', { id: 'pf-last', textContent: `Последний раз (${dateRu(last.date)}): ${profileLine(m)}.` }) : null,
    el('button', { type: 'button', id: 'bt-profile', textContent: last ? 'Заполнить ещё раз' : 'Заполнить', onclick: start }));
}

export function profileRunner(api) {
  const { rng, now, waitFor, set, intro } = api;
  async function profile() {
    const go = await intro('selfprofile', PROFILE_TITLE, ['Тебе покажут 25 утверждений о привычках и поведении. Выбирай, насколько каждое про тебя. Правильных ответов нет, думай недолго.',
      'Можно пропустить утверждение, если не хочешь отвечать.', PROFILE_NOT], 'Начать');
    if (go === 'skip') return { skipped: 'пропущено по желанию' };
    const order = rng.shuffle(ITEMS), answers = {}, trials = [];
    for (let i = 0; i < order.length; i++) {
      const it = order[i], t0 = now();
      const r = await waitFor((done, h) => {
        const heading = el('h3', { id: 'pf-pos', tabIndex: -1, textContent: `Утверждение ${i + 1} из ${order.length}` });
        const opts = ANSWER_LABELS.map((label, k) => el('button', { type: 'button', class: 'series-opt wide', dataset: { v: String(k + 1) }, textContent: label }));
        opts.forEach(b => h.on(b, 'click', () => done({ v: Number(b.dataset.v), rt: now() - t0 })));
        const skip = el('button', { type: 'button', id: 'pf-skip', class: 'link', textContent: 'Пропустить утверждение' });
        h.on(skip, 'click', () => done({ v: null, rt: now() - t0 }));
        set('selfprofile', 'run', el('div', { id: 'pf-item', class: 'iq-item', dataset: { i: String(i), id: it.id } }, heading, el('p', { class: 'iq-q', id: 'pf-text', textContent: it.text }),
          el('div', { class: 'series-opts one-col', role: 'group', 'aria-label': 'Насколько это про тебя' }, ...opts), el('div', { class: 'row mx-actions' }, skip)));
        focusNode(heading);
      });
      answers[it.id] = r.v;
      trials.push({ i, id: it.id, v: r.v, rt: r.rt });
    }
    return { metrics: scoreProfile(answers), trials };
  }
  return { selfprofile: profile };
}
