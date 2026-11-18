// «Сегодня»: «Бриф на сегодня» (утром открыт) и «Итог дня» (вечером открыт). Каждый можно открыть и закрыть, скопировать текстом.
// Рядом с сухими сводками живут тёплые мелочи: «вчера одной строкой», микро-итог вечером, мост через неделю,
// тихая строка-годовщина, редкая открытка «первый раз за долгое время», подпись недели в трёх словах и вырезка месяца.
import { el, fill, copyText, toast, dateRu } from './ui.js';
import { addDays, todayStr } from './events.js';
import { getPref } from './prefs.js';
import * as store from './store.js';
import { dayBrief, briefText, daySummary, summaryText, tenMinutes, tenText, yesterdayLine, warmSummaryLine, weekBridge } from './daycards.js';
import { anniversaryLine, firstTimeSince, monthClip } from './review.js';
import { makeWeekWords, weekWordsOf, weekReflectionOf, yearRibbon, WEEK_WORD_IDEAS } from './reflect.js';
import { workLine } from './schedule.js';

export function createDayCards() {
  let events = [];
  let briefOpen = null, summaryOpen = null, tenOpen = null, wordsOpen = null, clipOpen = null;   // выбор человека на время сессии; пока null — по времени суток
  const root = el('div', { id: 'day-cards', class: 'quiet-hide' });       // в день тишины бриф и итоги с цифрами не показываем
  const lines = text => text.split('\n').slice(1).map(t => el('p', { class: /^\d+\. /.test(t) ? 'brief-task' : '', textContent: t }));
  const warm = text => (text ? el('p', { class: 'muted warm-line', textContent: text }) : null);

  // Карточка «неделя в трёх словах»: подпись уходящей недели и лента года из таких подписей.
  function wordsCard(today) {
    const current = weekWordsOf(events, today) ?? [];
    const inputs = [0, 1, 2].map(i => el('input', { type: 'text', maxLength: 24, autocomplete: 'off', value: current[i] ?? '', placeholder: `слово ${i + 1}`, 'aria-label': `Слово ${i + 1}`, class: 'week-word-input' }));
    const chips = WEEK_WORD_IDEAS.map(w => el('button', { type: 'button', class: 'chip', textContent: w, onclick: () => { const free = inputs.find(x => !x.value.trim()); if (free) free.value = w; } }));
    const ribbon = yearRibbon(events, today.slice(0, 4)).slice(0, 8);
    const save = el('button', { type: 'button', id: 'week-words-save', class: 'chip', textContent: current.length ? 'Обновить подпись' : 'Сохранить подпись', onclick: async () => {
      try {
        await store.save(makeWeekWords(today, inputs.map(x => x.value), Date.now(), weekReflectionOf(events, today)));
        toast('Подпись недели сохранена');
      } catch (err) { toast(err.message); }
    } });
    const card = el('details', { id: 'week-words', class: 'card', open: wordsOpen ?? true },
      el('summary', { textContent: 'Неделя в трёх словах' }),
      el('p', { class: 'muted', textContent: 'Какой была эта неделя? Три слова — свои или из подсказок. Так собирается лента года.' }),
      el('p', { class: 'week-word-inputs' }, ...inputs), el('p', {}, ...chips), save);
    if (ribbon.length) card.append(el('p', { id: 'week-ribbon', class: 'muted', textContent: 'Лента года: ' + ribbon.map(r => `${dateRu(r.week)} — ${r.words.join(', ')}`).join(' · ') }));
    card.addEventListener('toggle', () => { wordsOpen = card.open; });
    return card;
  }

  function render() {
    if (getPref('simple')) { root.replaceChildren(); return; }
    const today = todayStr(), hour = new Date().getHours();
    const bt = briefText(dayBrief(events, today)), s = daySummary(events, today), st = summaryText(s);
    const brief = el('details', { id: 'day-brief', class: 'card', open: briefOpen ?? hour < 12 }, el('summary', { textContent: 'Бриф на сегодня' }),
      warm(yesterdayLine(events, today)), ...lines(bt), warm(anniversaryLine(events, today)), warm(weekBridge(events, today)),
      el('button', { type: 'button', id: 'brief-copy', class: 'chip', textContent: 'Скопировать', onclick: () => copyText(bt, 'Бриф скопирован') }));
    const rare = firstTimeSince(events, today);
    const summary = el('details', { id: 'day-summary', class: 'card', open: summaryOpen ?? hour >= 18 }, el('summary', { textContent: 'Итог дня' }),
      warm(warmSummaryLine(s)), warm(rare?.text), ...lines(st),
      el('button', { type: 'button', id: 'summary-copy', class: 'chip', textContent: 'Скопировать', onclick: () => copyText(st, 'Итог скопирован') }));
    const ten = tenText(tenMinutes(events, today));
    const tenCard = ten.length ? el('details', { id: 'ten-min', class: 'card', open: tenOpen ?? false }, el('summary', { textContent: `Есть 10 минут? (${ten.length})` }),
      el('p', { class: 'muted', textContent: 'Что можно сделать в свободное окошко. Свои быстрые дела помечай в тексте задачи: #быстро или #10мин.' }), ...ten.map(t => el('p', { class: 'ten-row', textContent: t }))) : null;
    tenCard?.addEventListener('toggle', () => { tenOpen = tenCard.open; });
    brief.addEventListener('toggle', () => { briefOpen = brief.open; });
    summary.addEventListener('toggle', () => { summaryOpen = summary.open; });
    // подпись недели — в воскресенье (день итогов), вырезка ушедшего месяца — в первые дни нового
    const sunday = new Date().getDay() === 0;
    const words = sunday ? wordsCard(today) : null;
    let clip = null;
    if (Number(today.slice(8)) <= 3) {
      const text = monthClip(events, addDays(today, -15).slice(0, 7));
      if (text) {
        clip = el('details', { id: 'month-clip', class: 'card', open: clipOpen ?? false }, el('summary', { textContent: 'Тёплая вырезка месяца' }),
          ...text.split('\n').map(t => el('p', { textContent: t })),
          el('button', { type: 'button', id: 'clip-copy', class: 'chip', textContent: 'Скопировать', onclick: () => copyText(text, 'Вырезка скопирована') }));
        clip.addEventListener('toggle', () => { clipOpen = clip.open; });
      }
    }
    const wl = workLine(events, today);                                                  // «Сегодня смена 09:00–18:00» или «Сегодня выходной» (если график задан)
    fill(root, wl ? el('p', { id: 'work-today', class: 'card tight', textContent: wl }) : null, brief, words, clip, tenCard, summary);
  }
  return { root, update(evs) { events = evs; render(); } };
}
