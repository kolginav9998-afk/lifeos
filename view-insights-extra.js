// «Аналитика»: сравнение недель, панель «90 дней» и ранжирование факторов за месяц. Только наблюдения.
import { el } from './ui.js';
import { compareWeeks, compare90, topFactors } from './bt-extra.js';

const num = (v, d) => String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ',').replace('-', '−');
const FORMAT = {
  composite: v => `${num(v, 2)} σ`, sleep: v => `${num(v, 1)} ч`, mood: v => num(v, 1), energy: v => num(v, 1), stress: v => num(v, 1),
};
const fmt = (row, v) => (v === null ? '—' : (FORMAT[row.key] ?? (x => `${Math.round(x)}${row.unit ? ` ${row.unit}` : ''}`))(v));
const ARROW = { up: ['↑', 'выше'], down: ['↓', 'ниже'], same: ['→', 'без изменений'] };

function rowNode(r) {
  const [sym, word] = ARROW[r.dir] ?? ['', 'нет сравнения'];
  const cls = r.dir === 'same' || r.dir === null ? 'same' : r.good ? 'good' : 'bad';
  return el('div', { class: 'cmp-row', dataset: { key: r.key, dir: r.dir ?? '' } },
    el('span', { class: 'cmp-label', textContent: r.label }),
    el('span', { class: 'cmp-val', textContent: r.prev === null ? fmt(r, r.now) : `${fmt(r, r.now)} против ${fmt(r, r.prev)}` }),
    r.dir ? el('span', { class: `cmp-arrow ${cls}`, role: 'img', 'aria-label': word, textContent: sym }) : null);
}
const sickNote = c => (c.now.sick || c.prev.sick ? el('p', { class: 'muted', textContent: `В этих периодах были дни режима болезни: ${c.now.sick + c.prev.sick}. Это объясняет часть различий.` }) : null);

export function weekCompareCard(events, today) {
  const c = compareWeeks(events, today);
  return el('div', { class: 'card', id: 'week-compare' }, el('h3', { textContent: 'Эта неделя и прошлая' }),
    c.rows.length ? el('p', { class: 'muted', textContent: 'Последние 7 дней против предыдущих 7. Стрелка — изменение; зелёная — в лучшую сторону, оранжевая — в худшую.' })
      : el('p', { class: 'muted', textContent: 'Пока мало данных для сравнения: нужны отметки и проверки хотя бы за 3 дня в каждой из двух недель.' }),
    ...c.rows.map(rowNode), sickNote(c));
}

export function panel90Card(events, today) {
  const c = compare90(events, today);
  return el('details', { class: 'card', id: 'panel90' }, el('summary', { textContent: 'Панель «90 дней»' }),
    c.rows.length ? el('p', { class: 'muted', textContent: 'Последние 90 дней против предыдущих 90.' }) : el('p', { class: 'muted', textContent: 'Для сравнения нужно хотя бы 10 дней с отметками или проверками.' }),
    ...c.rows.map(rowNode), sickNote(c));
}

export function topFactorsCard(events, today) {
  const f = topFactors(events, today);
  const body = f.rows < f.needed
    ? [el('p', { class: 'muted', textContent: `Нужно хотя бы ${f.needed} дней, где есть и результат проверок, и отметки (сейчас ${f.rows}). Продолжай отмечать утро и вечер.` })]
    : f.list.length ? [...f.list.map((x, i) => el('div', { class: 'factor-row', dataset: { key: x.key, level: x.level } },
      el('strong', { textContent: `${i + 1}. ${x.label}` }),
      el('div', { class: 'muted', textContent: `ρ = ${(x.rho > 0 ? '+' : x.rho < 0 ? '−' : '') + num(Math.abs(x.rho), 2)} · дней: ${x.n} · ` + (x.level === 'possible' ? `возможная связь: ${x.rho > 0 ? 'чем больше, тем выше' : 'чем больше, тем ниже'} ${f.outcomeLabel}` : 'связь слабая или случайная') }))),
      el('p', { class: 'muted', textContent: 'Это наблюдения за один месяц. Они подсказывают, что проверить экспериментом, и не доказывают причину.' })]
      : [el('p', { class: 'muted', textContent: 'Подходящих факторов пока нет: нужны отметки, которые меняются от дня к дню.' })];
  return el('div', { class: 'card', id: 'top-factors' }, el('h3', { textContent: 'Что связано с результатом за месяц' }), ...body);
}
