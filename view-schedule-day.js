// Окно одного дня графика: тип дня, смена, плановое и фактическое время, перерыв, заметка. Дочерний блок экрана «График».
import { el, fill, toast, announce, focusNode } from './ui.js';
import * as store from './store.js';
import { dayPlan, shiftOf, DAY_KINDS, dateLong, dayText, makeWorkday, isNoop, workdayEvent, normTime } from './schedule.js';

const lab = (text, input, cls = '') => el('label', { class: `work-f ${cls}`.trim() }, el('span', { class: 'muted', textContent: text }), input);

// events() и cfg() — функции: окно берёт свежие данные в момент открытия и сохранения.
export function createDayWindow({ events, cfg }) {
  let date = '', kind = 'work', shift = '';
  const host = el('div', { id: 'sch-day', class: 'overlay', hidden: true, tabIndex: -1, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sch-day-title' });
  const title = el('h3', { id: 'sch-day-title', tabIndex: -1 }), plan = el('p', { id: 'sch-day-plan', class: 'muted' });
  const kindBox = el('div', { class: 'work-kinds', role: 'group', 'aria-label': 'Тип дня' }), shiftBox = el('div', { class: 'chips', role: 'group', 'aria-label': 'Смена' });
  const time = id => el('input', { id, type: 'time' });
  const pFrom = time('sch-day-pfrom'), pTo = time('sch-day-pto'), aFrom = time('sch-day-afrom'), aTo = time('sch-day-ato');
  const brk = el('input', { id: 'sch-day-break', type: 'number', min: 0, max: 600, step: 5, inputMode: 'numeric', placeholder: 'как в смене' });
  const note = el('input', { id: 'sch-day-note', type: 'text', maxLength: 200, autocomplete: 'off', placeholder: 'Например: подменил коллегу' });
  const err = el('p', { id: 'sch-day-err', class: 'error' });
  const planSec = el('div', { class: 'form-stack' }, el('strong', { textContent: 'План на этот день' }), shiftBox, el('div', { class: 'two' }, lab('Начало по плану', pFrom), lab('Конец по плану', pTo)));
  const actSec = el('div', { class: 'form-stack' }, el('strong', { textContent: 'Сколько отработано' }), el('div', { class: 'two' }, lab('Пришёл', aFrom), lab('Ушёл', aTo)),
    el('div', { class: 'row' }, el('button', { type: 'button', id: 'sch-day-asplan', class: 'chip', textContent: 'Отработал по плану', onclick: () => { aFrom.value = pFrom.value; aTo.value = pTo.value; } }),
      el('button', { type: 'button', id: 'sch-day-aclear', class: 'chip', textContent: 'Очистить', onclick: () => { aFrom.value = ''; aTo.value = ''; } })),
    lab('Перерыв в этот день, минут', brk));
  const reset = el('button', { type: 'button', id: 'sch-day-reset', textContent: 'Вернуть как в графике', onclick: () => undo() });
  const close = el('button', { type: 'button', id: 'sch-day-close', textContent: 'Закрыть', onclick: () => { host.hidden = true; } });
  const form = el('form', { id: 'sch-day-form', class: 'form-stack' }, el('strong', { textContent: 'Что это за день' }), kindBox, planSec, actSec, lab('Заметка', note), err,
    el('div', { class: 'row' }, el('button', { type: 'submit', id: 'sch-day-save', class: 'primary', textContent: 'Сохранить' }), reset, close));
  host.append(el('div', { class: 'sess-top' }, title), plan, form);

  // Кнопки типов дня создаются один раз, кнопки смен — при открытии (смены могли измениться); дальше меняются только пометки aria-pressed: фокус не теряется.
  const kindBtns = Object.entries(DAY_KINDS).map(([k, t]) => el('button', { type: 'button', class: 'seg', textContent: t, dataset: { kind: k },
    onclick: () => { kind = k; if (k === 'work' && !shift && !pFrom.value) pick(cfg().shifts.find(s => !s.off)?.key ?? ''); paint(); } }));
  fill(kindBox, kindBtns);
  let shiftBtns = [];
  function paint() {
    for (const b of kindBtns) b.setAttribute('aria-pressed', String(b.dataset.kind === kind));
    for (const b of shiftBtns) b.setAttribute('aria-pressed', String(b.dataset.shift === shift));
    planSec.hidden = kind !== 'work'; actSec.hidden = !(kind === 'work' || kind === 'off');
  }
  function pick(key) {
    shift = key; const s = shiftOf(cfg(), key);
    if (s) { pFrom.value = s.from; pTo.value = s.to; }
    paint();
  }
  async function undo() {
    const old = workdayEvent(events(), date); host.hidden = true;
    if (old) { await store.remove(old.id); toast('День снова как в графике', { actionLabel: 'Вернуть', onAction: () => store.save(old) }); }
  }
  form.onsubmit = async e => {
    e.preventDefault();
    const c = cfg(), prev = workdayEvent(events(), date), s = shiftOf(c, shift), pf = normTime(pFrom.value), pt = normTime(pTo.value), b = brk.value.trim() === '' ? null : Number(brk.value);
    try {
      const f = { date, kind, shift: kind === 'work' ? shift : (prev?.payload.shift ?? ''), breakMin: b !== null && b === (s?.breakMin ?? null) ? null : b, note: note.value,
        planned: kind === 'work' && pf && pt && !(s && s.from === pf && s.to === pt) ? { from: pf, to: pt } : null, actual: (kind === 'work' || kind === 'off') && (aFrom.value || aTo.value) ? { from: aFrom.value, to: aTo.value } : null };
      const ev = makeWorkday(f, prev);
      host.hidden = true;                                                                    // окно закрываем до записи: сохранение перерисует экран
      if (isNoop(ev.payload, c)) { if (prev) await store.remove(prev.id); announce('День как в графике'); }
      else { await store.save(ev); announce(`Сохранено: ${dateLong(date)}`); }
    } catch (x) { err.textContent = x.message; announce(x.message, { assertive: true }); }
  };
  return {
    root: host,
    open(d) {
      date = d; const c = cfg(), prev = workdayEvent(events(), d), p = dayPlan(d, c, prev?.payload);
      kind = p.kind; shift = p.kind === 'work' ? p.key : '';
      pFrom.value = p.from ?? ''; pTo.value = p.to ?? ''; aFrom.value = p.actual?.from ?? ''; aTo.value = p.actual?.to ?? ''; brk.value = prev?.payload.breakMin ?? ''; note.value = p.note; err.textContent = '';
      title.textContent = dateLong(d); plan.textContent = `По графику: ${dayText(dayPlan(d, c, null))}.`; reset.hidden = !prev;
      shiftBtns = [...c.shifts.filter(x => !x.off).map(x => el('button', { type: 'button', class: `chip work-shift sc${x.color}`, dataset: { shift: x.key }, textContent: `${x.letter} ${x.name} ${x.from}–${x.to}`, onclick: () => pick(x.key) })),
        el('button', { type: 'button', class: 'chip work-shift', dataset: { shift: '' }, textContent: 'Своё время', onclick: () => pick('') })];
      fill(shiftBox, shiftBtns); paint(); host.hidden = false; focusNode(title);
    },
  };
}
