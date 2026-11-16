// Вкладка «Часы» экрана «Зарплата»: рабочие дни месяца с планом, фактом и сверхплановыми минутами; быстрая правка отметки времени. Дочерний блок.
import { el, fill, announce } from './ui.js';
import * as store from './store.js';
import { dayPlan, dayText, dateLong, fmtDur, makeWorkday, isNoop, workdayEvent, WEEKDAYS_SHORT, dowMon } from './schedule.js';

const lab = (text, input) => el('label', { class: 'work-f' }, el('span', { class: 'muted', textContent: text }), input);

export function createHoursPanel({ events }) {
  let st = null, editDate = '', pendingFocus = '';
  const list = el('ul', { id: 'sal-hours-list', class: 'list work-hours' }), totals = el('p', { id: 'sal-hours-totals' }), hiddenNote = el('p', { id: 'sal-hours-off', class: 'muted' });
  const eTitle = el('strong', { id: 'sal-he-title' }), ePlan = el('p', { id: 'sal-he-plan', class: 'muted' }), eErr = el('p', { id: 'sal-he-err', class: 'error' });
  const eFrom = el('input', { id: 'sal-he-from', type: 'time' }), eTo = el('input', { id: 'sal-he-to', type: 'time' });
  const editor = el('form', { id: 'sal-he', class: 'card form-stack', hidden: true }, eTitle, ePlan, el('div', { class: 'two' }, lab('Пришёл', eFrom), lab('Ушёл', eTo)), eErr,
    el('div', { class: 'row' }, el('button', { type: 'submit', id: 'sal-he-save', class: 'primary', textContent: 'Сохранить' }),
      el('button', { type: 'button', id: 'sal-he-plan-btn', class: 'chip', textContent: 'Как по плану', onclick: () => { const p = dayPlan(editDate, st.cfg, null); eFrom.value = p.from ?? ''; eTo.value = p.to ?? ''; } }),
      el('button', { type: 'button', id: 'sal-he-clear', class: 'chip', textContent: 'Убрать отметку', onclick: () => { eFrom.value = ''; eTo.value = ''; } }),
      el('button', { type: 'button', id: 'sal-he-close', textContent: 'Закрыть', onclick: () => { editDate = ''; editor.hidden = true; } })));
  const root = el('div', { id: 'sal-hours', class: 'form-stack' }, el('p', { class: 'muted', textContent: 'Здесь видно, сколько часов запланировано и сколько отмечено. Где отметки нет, считаю, что смена прошла по плану. Нажми «Изменить», чтобы поправить время прихода и ухода.' }),
    editor, el('div', { class: 'card form-stack' }, totals, list, hiddenNote));

  function open(date) {
    const p = workdayEvent(events(), date)?.payload, plan = dayPlan(date, st.cfg, p);
    editDate = date; eTitle.textContent = `Часы: ${dateLong(date)}`; ePlan.textContent = `По графику: ${dayText(dayPlan(date, st.cfg, null))}.`;
    eFrom.value = plan.actual?.from ?? ''; eTo.value = plan.actual?.to ?? ''; eErr.textContent = ''; editor.hidden = false;
    editor.scrollIntoView?.({ block: 'center' }); eFrom.focus();
  }
  editor.onsubmit = async e => {
    e.preventDefault();
    const prev = workdayEvent(events(), editDate), p = prev?.payload, plan = dayPlan(editDate, st.cfg, p);
    try {
      const ev = makeWorkday({ date: editDate, kind: plan.kind === 'off' ? 'off' : 'work', shift: p?.shift ?? plan.key, planned: p?.planned ?? null, breakMin: p?.breakMin ?? null, note: p?.note ?? '', actual: eFrom.value || eTo.value ? { from: eFrom.value, to: eTo.value } : null }, prev);
      const d = editDate; editDate = ''; editor.hidden = true; pendingFocus = d;                  // состояние правки сбрасываем до записи: сохранение перерисует экран
      if (isNoop(ev.payload, st.cfg)) { if (prev) await store.remove(prev.id); } else await store.save(ev);
      announce(`Сохранено: ${dateLong(d)}`);
    } catch (x) { eErr.textContent = x.message; announce(x.message, { assertive: true }); }
  };

  function render(s) {
    st = s;
    const days = s.res.days, show = days.filter(d => (d.kind === 'work' && d.plannedMin > 0) || d.actual || ['vacation', 'sick', 'unpaid'].includes(d.kind));
    let over = 0;
    fill(list, show.map(d => {
      const diff = d.recorded ? d.actualMin - d.plannedMin : 0; if (diff > 0) over += diff;
      const plan = d.kind === 'work' ? `${d.from ? `${d.from}–${d.to}, ` : ''}${fmtDur(d.plannedMin)}` : dayText(d);
      const fact = d.recorded ? `${d.actual.from}–${d.actual.to}, ${fmtDur(d.actualMin)}` : d.running ? `таймер идёт с ${d.actual.from}` : d.done && d.kind === 'work' ? 'отметки нет, считаю по плану' : '';
      const editable = d.kind === 'work' || d.kind === 'off';
      return el('li', { class: `item work-hrow${d.date > s.today ? ' future' : ''}`, dataset: { date: d.date } },
        el('div', { class: 'body' }, el('span', { class: 'text' }, el('strong', { textContent: `${WEEKDAYS_SHORT[dowMon(d.date)]} ${+d.date.slice(8)}` }), ` · план: ${plan}`), el('span', { class: 'meta', textContent: fact })),
        diff > 0 ? el('span', { class: 'chip static', textContent: `+${fmtDur(diff)} сверх плана` }) : diff < 0 ? el('span', { class: 'muted', textContent: `на ${fmtDur(-diff)} меньше плана` }) : null,
        editable ? el('button', { type: 'button', class: 'chip', textContent: 'Изменить', 'aria-label': `Изменить часы: ${dateLong(d.date)}`, onclick: () => open(d.date) }) : null);
    }));
    const m = s.res.month, rec = days.filter(d => d.recorded);
    totals.textContent = `План: ${fmtDur(days.reduce((a, d) => a + d.plannedMin, 0))} · отмечено: ${fmtDur(rec.reduce((a, d) => a + d.actualMin, 0))} (дней: ${rec.length}) · переработка к оплате: ${m.overtime.min >= 60 ? `${fmtDur(m.overtime.min)} (${m.overtime.min} мин)` : `${m.overtime.min} мин`}`;
    hiddenNote.textContent = days.length - show.length ? `Выходные без отметок не показываю: ${days.length - show.length}.` : '';
    if (pendingFocus) { list.querySelector(`[data-date="${pendingFocus}"] button`)?.focus(); pendingFocus = ''; }
  }
  return { root, render };
}
