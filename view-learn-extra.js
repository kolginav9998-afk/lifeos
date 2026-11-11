// «Учёба»: дневник практики. Минуты по курсам за неделю (уроки, карточки, говорение) и недельные цели.
import { el, toast } from './ui.js';
import * as store from './store.js';
import { TRACKS } from './academy.js';
import { practiceWeek, makeLearnGoal, goalId, GOAL_MIN, GOAL_MAX, CARD_SECONDS } from './practice.js';

const bar = (value, total) => el('div', { class: 'bar', role: 'img', 'aria-label': `${value} из ${total}` }, el('span', { style: `width:${total ? Math.round((value / total) * 100) : 0}%` }));
const parts = r => [r.lessons && `уроки ${r.lessons}`, r.cards && `карточки ≈${r.cards}`, r.speak && `говорение ${r.speak}`].filter(Boolean).join(', ');

export function practiceCard(events, today) {
  const w = practiceWeek(events, today);
  const rows = w.rows.map(r => el('div', { class: 'prac-row', dataset: { track: r.track } },
    el('div', { class: 'row' }, el('strong', { class: 'grow', textContent: r.title }), el('span', { class: 'prac-sum', textContent: r.goal ? `${r.total} из ${r.goal} мин` : `${r.total} мин` }),
      r.goal ? el('button', { type: 'button', class: 'chip goal-del', 'aria-label': `Убрать цель: ${r.title}`, textContent: '✕', onclick: async () => { const old = await store.remove(goalId(r.track)); toast('Цель убрана', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {}); } }) : null),
    r.goal ? bar(Math.min(r.total, r.goal), r.goal) : null,
    el('span', { class: 'muted', textContent: parts(r) || 'пока без занятий' }),
    r.goal && r.left === 0 ? el('span', { class: 'prac-done', textContent: 'Цель недели выполнена ✓' }) : null));
  const sel = el('select', { id: 'goal-track', 'aria-label': 'Курс' }, ...TRACKS.map(t => el('option', { value: t.id, textContent: t.title })));
  const mins = el('input', { id: 'goal-minutes', type: 'number', inputMode: 'numeric', min: String(GOAL_MIN), max: String(GOAL_MAX), placeholder: 'Минут в неделю', autocomplete: 'off', 'aria-label': 'Минут в неделю' });
  const err = el('p', { class: 'error', id: 'goal-err' });
  const form = el('form', { class: 'form-stack' }, sel, mins, el('button', { type: 'submit', id: 'goal-save', class: 'primary', textContent: 'Задать цель' }), err);
  form.noValidate = true;                                  // сообщения об ошибке показываем сами, на русском
  form.onsubmit = async e => {
    e.preventDefault();
    try { await store.save(makeLearnGoal(sel.value, mins.value)); mins.value = ''; err.textContent = ''; toast('Цель на неделю задана'); } catch (x) { err.textContent = x.message; }
  };
  return el('div', { class: 'card', id: 'practice-card' }, el('strong', { textContent: 'Практика за неделю' }),
    w.rows.length ? el('p', { class: 'muted', id: 'practice-total', textContent: `Всего за 7 дней: ${w.total} мин` }) : el('p', { class: 'muted', textContent: 'Пока нет занятий за неделю. После первого урока, повторения карточек или говорения здесь появятся минуты по курсам.' }),
    ...rows,
    el('details', { id: 'goal-box' }, el('summary', { textContent: 'Задать недельную цель по курсу' }), form),
    el('p', { class: 'muted', textContent: `Уроки считаются по плану, говорение — по записанному времени, карточки — по ${CARD_SECONDS} секунд на ответ (оценка).` }));
}
