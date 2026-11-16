// Список отдельных тестов по группам: последний результат, рекорд, график, кнопка «Пройти» и пояснение «Что измеряет этот тест».
import { el, sparkline, dateRu } from './ui.js';
import { normBand } from './bt-extra.js';
import { TESTS, TEST_BY_ID, fmtPrimary, singlePlan } from './bt-core.js';
import { bestResult } from './bt-analytics.js';
import { TEST_GROUPS, WHAT } from './bt-what.js';

const shown = (t, v) => fmtPrimary(t.id, { [t.primary.key]: v / (t.primary.scale ?? 1) });

function row(t, { runs, an, start }) {
  const s = an.perTest[t.id], w = WHAT[t.id], b = bestResult(runs, t.id);
  return el('div', { class: 'entry test-row', dataset: { test: t.id } },
    el('div', { class: 'grow' }, el('strong', { textContent: t.title }), el('div', { class: 'muted', textContent: t.desc }),
      s.latest ? el('div', { class: 'muted', textContent: `последний: ${shown(t, s.latest.value)}` }) : null,
      b && b.n >= 3 ? el('div', { class: 'muted test-record', textContent: `рекорд: ${shown(t, b.value)} (${dateRu(b.date)})` }) : null,
      w ? el('details', { class: 'what' }, el('summary', { textContent: 'Что измеряет этот тест' }), el('p', { textContent: w.what }), w.note ? el('p', { class: 'muted', textContent: w.note }) : null) : null,
      el('div', { class: 'muted tr-time', textContent: `около ${t.minutes} мин` })),
    s.series.length > 1 ? sparkline(s.series.map(p => (t.primary.better === 'lower' ? -p.value : p.value)), { width: 70, height: 28, band: normBand(t, s.baseline) }) : null,
    el('button', { type: 'button', class: 'chip', id: `bt-single-${t.id}`, textContent: 'Пройти', 'aria-label': `Пройти: ${t.title}`, onclick: () => start(singlePlan(t.id)) }));
}

// Возвращает узлы: заголовок «Отдельные тесты» и по группе на каждую область.
export function renderTestList(ctx) {
  const placed = new Set(), out = [el('h2', { textContent: 'Отдельные тесты' })];
  for (const g of TEST_GROUPS) {
    const tests = g.tests.map(id => TEST_BY_ID[id]).filter(Boolean);
    tests.forEach(t => placed.add(t.id));
    if (!tests.length) continue;
    out.push(el('h3', { class: 'tg-title', textContent: g.title }), g.note ? el('p', { class: 'muted tg-note', textContent: g.note }) : null, el('div', { class: 'list', dataset: { group: g.key } }, ...tests.map(t => row(t, ctx))));
  }
  const rest = TESTS.filter(t => !placed.has(t.id));
  if (rest.length) out.push(el('h3', { class: 'tg-title', textContent: 'Другие' }), el('div', { class: 'list' }, ...rest.map(t => row(t, ctx))));
  return out;
}
