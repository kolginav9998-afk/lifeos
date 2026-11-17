// Редакторы графика: типы смен; норма часов, дополнительные выходные и пределы отдыха. Дочерний блок экрана «График».
import { el, fill, toast, announce, icon } from './ui.js';
import { todayStr, isYmd } from './events.js';
import * as store from './store.js';
import { makeWorkcfg, cfgEvent, COLORS, dayMonthText } from './schedule.js';
import { monthLabel } from './money.js';

const lab = (text, input) => el('label', { class: 'work-f' }, el('span', { class: 'muted', textContent: text }), input);
const COLOR_NAMES = ['Фиолетовый', 'Синий', 'Бирюзовый', 'Оранжевый', 'Розовый', 'Зелёный'];
async function saveCfg(events, cfg, patch) { await store.save(makeWorkcfg({ ...cfg(), ...patch }, cfgEvent(events()))); }

// ---------- типы смен ----------
export function createShiftEditor({ events, cfg }) {
  let draft = [], lastSig = '';
  const list = el('div', { id: 'sch-shifts-list', class: 'form-stack' }), err = el('p', { id: 'sch-shifts-err', class: 'error' });
  const root = el('details', { id: 'sch-shifts', class: 'card' }, el('summary', { textContent: 'Типы смен' }),
    el('p', { class: 'muted', textContent: 'Название, время, перерыв и цвет смены. Буква показывается на календаре рядом с цветом. Нерабочий день (например, «Отсыпной») — это день без работы с собственным названием.' }), list, err,
    el('div', { class: 'row' }, el('button', { type: 'button', id: 'sch-shift-add', class: 'chip', textContent: 'Добавить тип смены', onclick: () => addShift() }),
      el('button', { type: 'button', id: 'sch-shifts-save', class: 'primary', textContent: 'Сохранить типы смен', onclick: () => save() })));
  const clone = s => ({ ...s });
  function rows() {
    fill(list, draft.map((s, i) => {
      const inp = (key, props = {}) => el('input', { ...props, value: s[key] ?? '', autocomplete: 'off', oninput: e => { s[key] = e.target.value; } });
      const chk = (key, text) => el('label', { class: 'check-label' }, el('input', { type: 'checkbox', checked: !!s[key], onchange: e => { s[key] = e.target.checked; if (key === 'off') rows(); } }), ` ${text}`);
      const color = el('select', { onchange: e => { s.color = Number(e.target.value); } }, ...COLOR_NAMES.map((n, k) => el('option', { value: String(k + 1), textContent: n, selected: s.color === k + 1 })));
      return el('fieldset', { class: 'work-shift-row' }, el('legend', { textContent: `Тип смены ${i + 1}: ${s.name || 'без названия'}` }),
        el('div', { class: 'two' }, lab('Название', inp('name', { type: 'text', maxLength: 30 })), lab('Буква на календаре', inp('letter', { type: 'text', maxLength: 2 }))),
        s.off ? null : el('div', { class: 'two' }, lab('Начало', inp('from', { type: 'time' })), lab('Конец', inp('to', { type: 'time' }))),
        el('div', { class: 'two' }, s.off ? null : lab('Перерыв, минут', inp('breakMin', { type: 'number', min: 0, max: 600, step: 5, inputMode: 'numeric' })), lab('Цвет', color)),
        s.off ? null : chk('night', 'Ночная смена'), chk('off', 'Нерабочий день (например, отсыпной)'),
        el('button', { type: 'button', class: 'chip danger', textContent: 'Удалить тип', 'aria-label': `Удалить тип смены ${s.name || i + 1}`, disabled: draft.length < 2, onclick: () => { draft.splice(i, 1); rows(); announce('Тип смены удалён из списка. Нажми «Сохранить типы смен»'); } }));
    }));
  }
  function addShift() {
    const used = new Set(draft.map(s => s.key));
    let n = 1; while (used.has(`k${n}`)) n++;
    draft.push({ key: `k${n}`, name: 'Новая смена', letter: 'Н', from: '09:00', to: '18:00', breakMin: 0, color: ((draft.length) % COLORS) + 1, night: false, off: false });
    rows(); list.lastElementChild?.querySelector('input')?.focus();
  }
  async function save() {
    try { err.textContent = ''; await saveCfg(events, cfg, { shifts: draft.map(s => ({ ...s, breakMin: s.breakMin === '' ? 0 : Number(s.breakMin) })) }); toast('Типы смен сохранены'); announce('Типы смен сохранены'); }
    catch (x) { err.textContent = x.message; announce(x.message, { assertive: true }); }
  }
  return { root, sync(c) { const sig = JSON.stringify(c.shifts); if (sig !== lastSig) { lastSig = sig; draft = c.shifts.map(clone); rows(); } } };
}

// ---------- норма часов, доп. выходные, пределы отдыха ----------
export function createNormEditor({ events, cfg, month }) {
  let lastSig = '';
  const mode = el('select', { id: 'sch-norm-mode', onchange: () => paint() }, el('option', { value: 'auto', textContent: 'По графику (считается сама)' }), el('option', { value: 'manual', textContent: 'Вручную: одно число на каждый месяц' }));
  const hours = el('input', { id: 'sch-norm-hours', type: 'number', min: 0, max: 744, step: 0.25, inputMode: 'decimal' }), hoursBox = lab('Часов в месяц', hours);
  const byMonth = el('input', { id: 'sch-norm-month', type: 'number', min: 0, max: 744, step: 0.25, inputMode: 'decimal', placeholder: 'как обычно' }), byLab = el('span', { class: 'muted' });
  const streak = el('input', { id: 'sch-max-streak', type: 'number', min: 2, max: 14, inputMode: 'numeric' }), rest = el('input', { id: 'sch-min-rest', type: 'number', min: 0, max: 24, inputMode: 'numeric' });
  const offDate = el('input', { id: 'sch-off-date', type: 'date', value: todayStr(), 'aria-label': 'Дата дополнительного выходного' }), offList = el('ul', { id: 'sch-off-list', class: 'chips work-offs' });
  const err = el('p', { id: 'sch-norm-err', class: 'error' });
  const calOn = el('input', { id: 'sch-cal-on', type: 'checkbox', onchange: async () => { await saveCfg(events, cfg, { calRu: calOn.checked }); announce(calOn.checked ? 'Праздники подставляются по производственному календарю' : 'Праздники по календарю выключены'); } });
  const root = el('details', { id: 'sch-norm', class: 'card' }, el('summary', { textContent: 'Норма часов, праздники и отдых' }),
    el('div', { class: 'form-stack' },
      el('label', { class: 'row', for: 'sch-cal-on' }, calOn, el('span', { textContent: 'Подставлять праздники и сокращённые дни по производственному календарю РФ (для графика по дням недели)' })),
      lab('Норма часов в месяц', mode), hoursBox, el('label', { class: 'work-f' }, byLab, byMonth),
      el('p', { class: 'muted', textContent: 'Норма нужна для расчёта зарплаты: из неё получается ставка за час, а «сверх нормы» считаются переработки. По графику норма = плановые часы рабочих дней месяца без праздников.' }),
      el('strong', { textContent: 'Праздники и дополнительные выходные' }), el('div', { class: 'row' }, offDate, el('button', { type: 'button', id: 'sch-off-add', class: 'chip', textContent: 'Добавить выходной', onclick: () => addOff() })), offList,
      el('strong', { textContent: 'Предупреждения об отдыхе' }), el('div', { class: 'two' }, lab('Рабочих дней подряд — не больше', streak), lab('Отдых между сменами — не меньше, часов (0 — не проверять)', rest)), err,
      el('button', { type: 'button', id: 'sch-norm-save', class: 'primary', textContent: 'Сохранить', onclick: () => save() })));
  const paint = () => { hoursBox.hidden = mode.value !== 'manual'; };
  function offs(c) {
    fill(offList, c.extraOff.slice(-60).map(d => el('li', { class: 'chip static' }, el('span', { textContent: `${dayMonthText(d)} ${d.slice(0, 4)}` }),
      el('button', { type: 'button', class: 'link', 'aria-label': `Убрать выходной ${dayMonthText(d)} ${d.slice(0, 4)}`, onclick: async () => { await saveCfg(events, cfg, { extraOff: c.extraOff.filter(x => x !== d) }); announce('Выходной убран'); } }, icon('x', 16)))));
    if (!c.extraOff.length) fill(offList, el('li', { class: 'muted', textContent: 'Пока нет' }));
  }
  async function addOff() {
    if (!isYmd(offDate.value)) { err.textContent = 'Выбери дату'; return; }
    const c = cfg(); err.textContent = '';
    await saveCfg(events, cfg, { extraOff: [...c.extraOff, offDate.value] }); announce(`Добавлен выходной: ${dayMonthText(offDate.value)}`);
  }
  async function save() {
    const c = cfg(), ym = month();
    try {
      const nh = hours.value.trim() === '' ? 0 : Number(hours.value), bm = byMonth.value.trim() === '' ? null : Number(byMonth.value);
      if (mode.value === 'manual' && !(nh > 0 && nh <= 744)) throw new Error('Норма: число часов в месяц больше 0 и не больше 744');
      if (bm !== null && !(bm >= 0 && bm <= 744)) throw new Error('Норма для месяца: число часов от 0 до 744');
      const map = { ...c.normByMonth }; if (bm === null) delete map[ym]; else map[ym] = bm;
      err.textContent = '';
      await saveCfg(events, cfg, { normMode: mode.value, normHours: nh, normByMonth: map, maxStreak: Number(streak.value), minRestH: Number(rest.value) });
      toast('Сохранено'); announce('Норма и пределы отдыха сохранены');
    } catch (x) { err.textContent = x.message; announce(x.message, { assertive: true }); }
  }
  return {
    root,
    sync(c) {
      const ym = month(), sig = JSON.stringify([c.normMode, c.normHours, c.normByMonth, c.maxStreak, c.minRestH, ym, c.calRu]);
      byLab.textContent = `Норма только для месяца «${monthLabel(ym).toLowerCase()}», часов (пусто — как обычно)`;
      if (sig !== lastSig) { lastSig = sig; mode.value = c.normMode; hours.value = c.normHours || ''; byMonth.value = c.normByMonth[ym] ?? ''; streak.value = c.maxStreak; rest.value = c.minRestH; calOn.checked = c.calRu !== false; paint(); }
      offs(c);
    },
  };
}
