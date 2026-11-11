// «Сегодня»: «Бриф на сегодня» (утром открыт) и «Итог дня» (вечером открыт). Каждый можно открыть и закрыть, скопировать текстом.
import { el, fill, copyText } from './ui.js';
import { todayStr } from './events.js';
import { getPref } from './prefs.js';
import { dayBrief, briefText, daySummary, summaryText, tenMinutes, tenText } from './daycards.js';

export function createDayCards() {
  let events = [];
  let briefOpen = null, summaryOpen = null, tenOpen = null;                         // выбор человека на время сессии; пока null — по времени суток
  const root = el('div', { id: 'day-cards' });
  const lines = text => text.split('\n').slice(1).map(t => el('p', { class: /^\d+\. /.test(t) ? 'brief-task' : '', textContent: t }));

  function render() {
    if (getPref('simple')) { root.replaceChildren(); return; }
    const today = todayStr(), hour = new Date().getHours();
    const bt = briefText(dayBrief(events, today)), st = summaryText(daySummary(events, today));
    const brief = el('details', { id: 'day-brief', class: 'card', open: briefOpen ?? hour < 12 }, el('summary', { textContent: 'Бриф на сегодня' }), ...lines(bt),
      el('button', { type: 'button', id: 'brief-copy', class: 'chip', textContent: 'Скопировать', onclick: () => copyText(bt, 'Бриф скопирован') }));
    const summary = el('details', { id: 'day-summary', class: 'card', open: summaryOpen ?? hour >= 18 }, el('summary', { textContent: 'Итог дня' }), ...lines(st),
      el('button', { type: 'button', id: 'summary-copy', class: 'chip', textContent: 'Скопировать', onclick: () => copyText(st, 'Итог скопирован') }));
    const ten = tenText(tenMinutes(events, today));
    const tenCard = ten.length ? el('details', { id: 'ten-min', class: 'card', open: tenOpen ?? false }, el('summary', { textContent: `Есть 10 минут? (${ten.length})` }),
      el('p', { class: 'muted', textContent: 'Что можно сделать в свободное окошко. Свои быстрые дела помечай в тексте задачи: #быстро или #10мин.' }), ...ten.map(t => el('p', { class: 'ten-row', textContent: t }))) : null;
    tenCard?.addEventListener('toggle', () => { tenOpen = tenCard.open; });
    brief.addEventListener('toggle', () => { briefOpen = brief.open; });
    summary.addEventListener('toggle', () => { summaryOpen = summary.open; });
    fill(root, brief, tenCard, summary);
  }
  return { root, update(evs) { events = evs; render(); } };
}
