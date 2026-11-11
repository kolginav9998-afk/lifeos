// Экран «Цели»: цели на период с измеримыми результатами, прогресс и сравнение с ходом времени.
import { el, toast, dateRu } from './ui.js';
import { todayStr } from './events.js';
import * as store from './store.js';
import { MAX_KRS, makeOkr, updateKr, setOkrStatus, okrsOf, okrProgress, okrPace, krRatio, quarterEnd, quarterLabel } from './okr.js';

const pct = r => `${Math.round(r * 100)}%`;
const f = v => String(Math.round(v * 100) / 100).replace('.', ',');

export function createOkrView() {
  let events = [];
  const root = el('section', { id: 'view-okr', class: 'view' });

  // форма создаётся один раз, чтобы введённое не терялось при обновлении данных
  const title = el('input', { id: 'okr-title', type: 'text', maxLength: 100, placeholder: 'Цель: чего хочу добиться', autocomplete: 'off' });
  const why = el('input', { id: 'okr-why', type: 'text', maxLength: 300, placeholder: 'Зачем это мне (по желанию)', autocomplete: 'off' });
  const due = el('input', { id: 'okr-due', type: 'date', 'aria-label': 'Срок' });
  const rows = Array.from({ length: 3 }, (_, i) => ({
    text: el('input', { type: 'text', class: 'kr-text', maxLength: 100, placeholder: `Результат ${i + 1}: что именно измерим`, autocomplete: 'off', 'aria-label': `Результат ${i + 1}` }),
    target: el('input', { type: 'text', inputMode: 'decimal', class: 'kr-target', placeholder: 'Цель', autocomplete: 'off', 'aria-label': `Целевое значение ${i + 1}` }),
    unit: el('input', { type: 'text', class: 'kr-unit', maxLength: 12, placeholder: 'ед.', autocomplete: 'off', 'aria-label': `Единица ${i + 1}` }),
  }));
  const err = el('p', { class: 'error', id: 'okr-err' });
  const form = el('form', { class: 'form-stack' }, title, why, el('label', {}, 'Срок: ', due),
    ...rows.map(r => el('div', { class: 'kr-row' }, r.text, r.target, r.unit)),
    el('p', { class: 'muted', textContent: `Хороший результат измеряется числом: «пробежать 50 км за месяц», «прочитать 3 книги», «накопить 30 000 ₽». До ${MAX_KRS} результатов на цель.` }),
    el('button', { type: 'submit', id: 'okr-add', class: 'primary', textContent: 'Создать цель' }), err);
  form.onsubmit = async e => {
    e.preventDefault();
    try {
      await store.save(makeOkr({ title: title.value, why: why.value, due: due.value || undefined, krs: rows.map(r => ({ text: r.text.value, target: r.target.value, unit: r.unit.value })).filter(k => k.text.trim() || k.target.trim()) }));
      title.value = ''; why.value = ''; due.value = ''; for (const r of rows) { r.text.value = ''; r.target.value = ''; r.unit.value = ''; } err.textContent = '';
    } catch (x) { err.textContent = x.message; }
  };
  const formCard = el('details', { class: 'card', id: 'okr-new' }, el('summary', { textContent: 'Новая цель' }), form);

  function okrCard(ev, today) {
    const p = ev.payload, pace = okrPace(ev, today), prog = okrProgress(ev);
    const krs = p.krs.map(k => {
      const inp = el('input', { type: 'text', inputMode: 'decimal', class: 'kr-now', value: String(k.current).replace('.', ','), 'aria-label': `Сейчас: ${k.text}` });
      const save = async () => { try { await store.save(updateKr(ev, k.id, inp.value)); } catch (e) { toast(e.message); } };
      inp.onchange = save;
      return el('div', { class: 'kr', dataset: { kr: k.id } }, el('div', { class: 'row' }, el('span', { class: 'grow', textContent: k.text }), el('span', { class: 'muted kr-line', textContent: `${f(k.current)} из ${f(k.target)} ${k.unit}`.trim() })),
        el('div', { class: `progress thin${krRatio(k) >= 1 ? ' ok' : ''}`, role: 'img', 'aria-label': pct(krRatio(k)) }, el('span', { style: `--w:${Math.round(krRatio(k) * 100)}%` })),
        el('div', { class: 'row' }, el('label', { class: 'muted' }, 'Сейчас: '), inp, el('button', { type: 'button', class: 'chip kr-save', textContent: 'Обновить', onclick: save })));
    });
    return el('div', { class: `card okr ${pace.state}`, dataset: { id: ev.id, state: pace.state } },
      el('div', { class: 'row' }, el('strong', { class: 'grow', textContent: p.title }), el('span', { class: `badge ${pace.state === 'behind' || pace.state === 'overdue' ? 'bad' : 'good'}`, textContent: pace.text })),
      p.why ? el('p', { class: 'muted', textContent: `Зачем: ${p.why}` }) : null,
      el('div', { class: `progress${prog >= 1 ? ' ok' : pace.state === 'behind' ? ' warn' : ''}`, role: 'img', 'aria-label': pct(prog) }, el('span', { style: `--w:${Math.round(prog * 100)}%` })),
      el('p', { class: 'muted okr-line', textContent: `Выполнено ${pct(prog)} · срок ${dateRu(p.due)}${pace.daysLeft >= 0 ? ` (осталось ${pace.daysLeft} дн.)` : ''}` }), ...krs,
      el('div', { class: 'row wrap' },
        el('button', { type: 'button', class: 'chip okr-done', textContent: 'Достигнута', onclick: async () => { await store.save(setOkrStatus(ev, 'done')); toast('Цель закрыта. Отличная работа!'); } }),
        el('button', { type: 'button', class: 'chip okr-drop', textContent: 'Отказаться', onclick: async () => { await store.save(setOkrStatus(ev, 'dropped')); toast('Цель снята', { actionLabel: 'Вернуть', onAction: () => store.save(ev) }); } })));
  }

  function render() {
    const today = todayStr();
    if (!due.value) due.value = quarterEnd(today);
    const active = okrsOf(events, 'active'), closed = okrsOf(events).filter(e => e.payload.status !== 'active').reverse();
    const parts = [el('div', { class: 'card' }, el('h3', { textContent: `Цели · ${quarterLabel(today)}` }),
      el('p', { class: 'muted', textContent: active.length ? 'Раз в неделю обновляй цифры: так видно, идёшь ли ты по графику.' : 'Выбери 1–3 главные цели на период и измеримые результаты. Меньше целей — больше шансов дойти.' })), formCard,
      ...active.map(e => okrCard(e, today))];
    if (closed.length) parts.push(el('details', { class: 'card', id: 'okr-closed' }, el('summary', { textContent: `Закрытые (${closed.length})` }),
      ...closed.map(e => el('p', { class: 'okr-closed-row' }, el('strong', { textContent: e.payload.title }), el('span', { class: 'muted', textContent: ` — ${e.payload.status === 'done' ? 'достигнута' : 'снята'}, ${pct(okrProgress(e))}` })))));
    root.replaceChildren(...parts);
  }
  return { root, update(evs) { events = evs; if (!root.hidden) render(); }, show() { render(); } };
}
