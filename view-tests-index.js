// Карточка «Условный индекс логики» на экране тестов: число, широкий диапазон, из чего собрано, динамика и честные пояснения.
// Число сравнивает человека только с ним самим: это не IQ и не диагноз (тексты — в iq-index.js, их проверяет автотест).
import { el, sparkline, dateRu } from './ui.js';
import { TEST_BY_ID } from './bt-core.js';
import { logicIndexNow, logicProgress, compareIndex, INDEX_TITLE, INDEX_NOT_IQ, INDEX_HOW } from './iq-index.js';

export function renderLogicIndex(runs, now = Date.now()) {
  const cur = logicIndexNow(runs, now), series = logicProgress(runs);
  const card = (...kids) => el('section', { class: 'card iq-card', id: 'bt-iq', 'aria-labelledby': 'iq-title' }, el('h3', { id: 'iq-title', textContent: INDEX_TITLE }), ...kids);
  const notIq = el('p', { class: 'warn', id: 'iq-not-iq', textContent: INDEX_NOT_IQ });
  if (!cur) return card(el('p', { class: 'muted', id: 'iq-empty', textContent: 'Пока числа нет. Пройди хотя бы один тест из группы «Логика» (матрицы, числовые ряды, слова и логика, вращение фигур): здесь появится условный индекс и диапазон.' }), notIq);

  const from = cur.parts.map(p => `${TEST_BY_ID[p.id]?.title ?? p.id} (${dateRu(p.date)})`).join(', ');
  const bar = el('div', { class: 'iq-bar', id: 'iq-bar', role: 'img', 'aria-label': `Шкала от 0 до 100: индекс ${cur.index}, примерный диапазон от ${cur.lo} до ${cur.hi}` },
    el('span', { class: 'iq-band', style: `left:${cur.lo}%;width:${Math.max(2, cur.hi - cur.lo)}%` }), el('span', { class: 'iq-dot', style: `left:${cur.index}%` }));

  let change = null;
  if (series.length >= 2) {
    const a = series.at(-1), b = series.at(-2), dir = compareIndex(a, b), arrow = `${b.index} → ${a.index}`;
    const text = dir === 'up' ? `Последнее прохождение выше предыдущего (${arrow}): диапазоны не пересекаются. Но привычка к заданиям тоже поднимает результат, поэтому это лишь ориентир.`
      : dir === 'down' ? `Последнее прохождение ниже предыдущего (${arrow}): диапазоны не пересекаются. Возможно, дело в усталости или невнимательности: проверь ещё раз в другой день.`
        : `Разница с предыдущим прохождением (${arrow}) в пределах случайного разброса: по этим данным нельзя сказать, что что-то изменилось.`;
    const spark = sparkline(series.map(p => p.index), { width: 140, height: 36 });
    spark.setAttribute('aria-label', `График индекса по прохождениям: ${series.map(p => p.index).join(', ')}`); spark.id = 'iq-spark';
    change = el('div', { class: 'iq-change' }, el('p', { id: 'iq-change', textContent: text }), spark);
  }
  return card(
    el('p', { class: 'iq-num', id: 'iq-value' }, el('strong', { textContent: String(cur.index) }), el('small', { textContent: ' из 100' })),
    el('p', { id: 'iq-range', textContent: `Примерный диапазон: от ${cur.lo} до ${cur.hi}. Он широкий: заданий в основе ${cur.items}.` }),
    bar, el('div', { class: 'iq-scale', 'aria-hidden': 'true' }, el('span', { textContent: '0' }), el('span', { textContent: '50' }), el('span', { textContent: '100' })),
    el('p', { class: 'muted', id: 'iq-from', textContent: `Собрано из последних результатов: ${from}.` }),
    cur.parts.length === 1 ? el('p', { class: 'muted', id: 'iq-narrow', textContent: 'Пока только один тест, поэтому диапазон очень широкий. Пройди остальные тесты логики: он сузится.' }) : null,
    change ?? el('p', { class: 'muted', id: 'iq-change', textContent: 'Динамика появится после второго прохождения тестов на логику.' }),
    notIq,
    el('details', { class: 'iq-how', id: 'iq-how' }, el('summary', { textContent: 'Как это считается' }), ...INDEX_HOW.map(t => el('p', { textContent: t }))));
}
