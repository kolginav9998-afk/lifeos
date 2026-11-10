import { el, toast } from './ui.js';
import { todayStr } from './events.js';
import { HABIT_TEMPLATES, makeHabit, updateHabit, archiveHabit, makeHabitLog, habitStats, habitCalendar, activeHabits, logsOf } from './habits.js';
import { getPref, setPref } from './prefs.js';
import * as store from './store.js';

const pct = x => Math.round(x * 100) + '%';

export function createHabitsView() {
  let events = [];
  let editingId = null;
  let editorEl = null;
  let hadAny = false;
  const root = el('section', { id: 'view-habits', class: 'view' });

  const intro = el('p', { class: 'muted', textContent: 'Привычка = «после чего» + маленький первый шаг. Если день тяжёлый, достаточно минимума. Главное — не пропускать второй раз подряд.' });

  const heavy = el('input', { id: 'heavy-day', type: 'checkbox', checked: !!getPref('heavyDay') });
  heavy.onchange = () => { setPref('heavyDay', heavy.checked); render(); };
  const heavyRow = el('label', { class: 'check-label card tight' }, heavy, ' Тяжёлый день: показывать только минимум');

  const name = el('input', { id: 'habit-name', type: 'text', placeholder: 'Привычка, например «Python»', maxLength: 120, required: true, autocomplete: 'off' });
  const anchor = el('input', { id: 'habit-anchor', type: 'text', placeholder: 'После чего? Например «после завтрака»', maxLength: 200, autocomplete: 'off' });
  const minimum = el('input', { id: 'habit-min', type: 'text', placeholder: 'Версия на 2 минуты: «открыть редактор»', maxLength: 200, autocomplete: 'off' });
  const full = el('input', { id: 'habit-full', type: 'text', placeholder: 'Полная версия: «20 минут практики»', maxLength: 200, autocomplete: 'off' });
  const templates = el('div', { id: 'habit-templates', class: 'chips' }, ...HABIT_TEMPLATES.map(t =>
    el('button', { type: 'button', class: 'chip tpl', textContent: t.name, onclick: () => { name.value = t.name; anchor.value = t.anchor; minimum.value = t.minimum; full.value = t.full; name.focus(); } })));
  const form = el('form', { id: 'habit-form', class: 'form-stack' }, el('span', { class: 'muted', textContent: 'Быстрый старт — выбери заготовку и поправь под себя:' }), templates, name, anchor, minimum, full,
    el('button', { type: 'submit', class: 'primary', textContent: 'Добавить привычку' }));
  const addBox = el('details', { id: 'habit-add', class: 'card habit-add' }, el('summary', { textContent: '＋ Новая привычка' }), form);
  form.onsubmit = async e => {
    e.preventDefault();
    try {
      await store.save(makeHabit({ name: name.value, anchor: anchor.value, minimum: minimum.value, full: full.value }));
      name.value = anchor.value = minimum.value = full.value = '';
      addBox.open = false;
    } catch (err) { toast('Не удалось добавить: ' + err.message); }
  };

  const list = el('div', { id: 'habit-list' });
  const empty = el('p', { class: 'muted', hidden: true, textContent: 'Привычек пока нет. Начни с одной маленькой.' });
  const archivedList = el('div', { id: 'habit-archive' });
  const archivedBlock = el('details', { hidden: true }, el('summary', { textContent: 'В архиве' }), archivedList);
  root.append(intro, addBox, heavyRow, list, empty, archivedBlock);

  async function mark(h, st, level) {
    const today = todayStr();
    if (st.level === level) {                              // повторное нажатие снимает отметку
      const old = events.find(e => e.id === makeHabitLog(h, today, level).id);
      await store.remove(makeHabitLog(h, today, level).id);
      if (old) toast('Отметка снята', { actionLabel: 'Вернуть', onAction: () => store.save(old) });
    } else {
      await store.save(makeHabitLog(h, today, level));
    }
  }

  async function removeHabit(h) {
    if (editingId === h.id) { editingId = null; editorEl = null; }
    const ids = [h.id, ...logsOf(events, h.id).map(l => l.id)];
    const old = await store.removeMany(ids);
    toast('Привычка удалена', { actionLabel: 'Отменить', onAction: () => store.saveMany(old) });
  }

  function stopEdit() { editingId = null; editorEl = null; render(); }

  function editor(h) {
    const p = h.payload;
    const n = el('input', { type: 'text', value: p.name, maxLength: 120, required: true, class: 'edit-name' });
    const a = el('input', { type: 'text', value: p.anchor, maxLength: 200, placeholder: 'После чего?' });
    const m = el('input', { type: 'text', value: p.minimum, maxLength: 200, placeholder: 'Версия на 2 минуты' });
    const f = el('input', { type: 'text', value: p.full, maxLength: 200, placeholder: 'Полная версия' });
    const f2 = el('form', { class: 'card form-stack editing', dataset: { id: h.id } }, n, a, m, f,
      el('div', { class: 'row' },
        el('button', { type: 'submit', class: 'primary save', textContent: 'Сохранить' }),
        el('button', { type: 'button', class: 'cancel', textContent: 'Отмена', onclick: () => stopEdit() })));
    f2.onsubmit = async e => {
      e.preventDefault();
      try { await store.save(updateHabit(h, { name: n.value, anchor: a.value, minimum: m.value, full: f.value })); stopEdit(); }
      catch (err) { toast('Не удалось сохранить: ' + err.message); }
    };
    queueMicrotask(() => n.focus());
    return f2;
  }

  function card(h, st, today, archived = false) {
    if (editingId === h.id) {
      if (!editorEl || editorEl.dataset.id !== h.id) editorEl = editor(h);
      return editorEl;
    }
    const p = h.payload;
    const heavyDay = !!getPref('heavyDay');
    const c = el('article', { class: 'card habit' + (st.doneToday ? ' is-done' : ''), dataset: { id: h.id } });
    c.append(el('div', { class: 'h-head' }, el('strong', { class: 'h-name', textContent: p.name }),
      p.anchor ? el('span', { class: 'muted', textContent: ' · после: ' + p.anchor }) : null));
    if (!archived) {
      const fullBtn = el('button', { type: 'button', class: 'h-full' + (st.level === 'full' ? ' on' : ''), textContent: (st.level === 'full' ? '✓ ' : '') + (p.full ? `Сделал: ${p.full}` : 'Сделал полностью'), onclick: () => mark(h, st, 'full') });
      const minBtn = el('button', { type: 'button', class: 'h-min' + (st.level === 'min' ? ' on' : ''), textContent: (st.level === 'min' ? '✓ ' : '') + (p.minimum ? `Минимум: ${p.minimum}` : 'Сделал минимум (2 минуты)'), onclick: () => mark(h, st, 'min') });
      c.append(el('div', { class: 'h-actions' }, heavyDay ? null : fullBtn, minBtn));
      if (st.neverMissTwice) c.append(el('p', { class: 'warn', textContent: 'Вчера пропуск — это нормально. Не пропусти второй раз: достаточно минимума.' }));
      else if (st.needsRecovery) c.append(el('p', { class: 'warn', textContent: `Перерыв ${st.gapDays} дн. Начинать с нуля не нужно — вернись с минимума.` }));
    }
    c.append(el('div', { class: 'h-stats muted', textContent: `Серия: ${st.streak} · Лучшая: ${st.longest} · Регулярность за 30 дн.: ${pct(st.consistency)} (${st.hits} из ${st.span})` }));
    const cal = el('div', { class: 'h-cal', 'aria-label': 'Последние 4 недели' }, ...habitCalendar(h, events, today, 28).map(d =>
      el('span', { class: `dot ${d.level || ''}${d.before ? ' before' : ''}${d.today ? ' today' : ''}`, title: d.date })));
    c.append(cal);
    const more = el('details', { class: 'more' }, el('summary', { textContent: 'Ещё' }),
      el('div', { class: 'row' },
        el('button', { type: 'button', class: 'edit', textContent: 'Изменить', onclick: () => { editingId = h.id; editorEl = null; render(); } }),
        el('button', { type: 'button', class: 'arch', textContent: archived ? 'Вернуть из архива' : 'В архив', onclick: () => store.save(archiveHabit(h, !archived)) }),
        el('button', { type: 'button', class: 'danger del-habit', textContent: 'Удалить', onclick: () => removeHabit(h) })));
    c.append(more);
    return c;
  }

  function render() {
    const today = todayStr();
    heavy.checked = !!getPref('heavyDay');
    const act = activeHabits(events, today);
    const any = events.some(e => e.type === 'habit');
    intro.hidden = any;
    heavyRow.hidden = !any;
    if (!any) addBox.open = true;
    else if (!hadAny) addBox.open = false;      // появились привычки (например, из копии) — прячем форму
    hadAny = any;
    list.replaceChildren(...act.map(({ h, st }) => card(h, st, today)));
    empty.hidden = act.length > 0 || any;
    const arch = events.filter(e => e.type === 'habit' && e.payload.archived);
    archivedBlock.hidden = arch.length === 0;
    archivedList.replaceChildren(...arch.map(h => card(h, habitStats(h, events, today), today, true)));
  }

  return { root, update(evs) { events = evs; render(); }, focusAdd() { name.focus(); } };
}
