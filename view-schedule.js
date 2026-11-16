// Экран «График работы»: календарь месяца со сменами (цвет и буква), рабочий таймер, итоги месяца, предупреждения об отдыхе, настройка графика.
// Календарь — сетка кнопок с полной датой в названии; по стрелкам можно ходить по дням, PageUp/PageDown — по месяцам.
import { el, fill, icon, toast, announce, emptyState } from './ui.js';
import { todayStr, addDays } from './events.js';
import * as store from './store.js';
import { monthLabel } from './money.js';
import { cfgOf, workdaysOf, monthGrid, monthSummary, restWarnings, nextOffDays, dayPlan, dayText, dayActualText, runningTimer, timerStart, timerStop, isNoop, fmtDur, dateLong, dayMonthText, shiftYm, daysIn, dowMon, patternText, WEEKDAYS_SHORT, WEEKDAYS_LONG } from './schedule.js';
import { createDayWindow } from './view-schedule-day.js';
import { createWizard } from './view-schedule-wizard.js';
import { createShiftEditor, createNormEditor } from './view-schedule-editors.js';

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export function createScheduleView(ctx = {}) {
  let events = [], ym = todayStr().slice(0, 7), fd = todayStr(), pendingFocus = null, ticker = 0;
  const cfg = () => cfgOf(events), evs = () => events;
  const root = el('section', { id: 'view-schedule', class: 'view' });
  const dayWin = createDayWindow({ events: evs, cfg }), wiz = createWizard({ events: evs });
  const shiftEd = createShiftEditor({ events: evs, cfg }), normEd = createNormEditor({ events: evs, cfg, month: () => ym });

  // ----- месяц -----
  const label = el('strong', { id: 'sch-month', class: 'month-label' });
  const step = d => { ym = shiftYm(ym, d); fd = `${ym}-01`; render(); announce(monthLabel(ym)); };
  const nav = el('div', { class: 'month-nav' }, el('button', { type: 'button', id: 'sch-prev', 'aria-label': 'Прошлый месяц', onclick: () => step(-1) }, icon('chevL', 20)), label,
    el('button', { type: 'button', id: 'sch-next', 'aria-label': 'Следующий месяц', onclick: () => step(1) }, icon('chevR', 20)));
  const nowBtn = el('button', { type: 'button', id: 'sch-now', class: 'chip', textContent: 'К сегодняшнему дню', onclick: () => { ym = todayStr().slice(0, 7); fd = todayStr(); render(); announce(`Сегодня, ${dateLong(fd)}`); } });

  // ----- блоки -----
  const stats = el('div', { id: 'sch-stats', class: 'work-stats' }), leaveLine = el('p', { id: 'sch-leave', class: 'muted' });
  const patLine = el('p', { id: 'sch-pattern', class: 'muted' });
  const timerBox = el('div', { id: 'sch-timer', class: 'card form-stack' }), warnBox = el('div', { id: 'sch-warn', class: 'card' });
  const gridEl = el('div', { id: 'sch-grid', class: 'cal', role: 'grid' }), legend = el('ul', { id: 'sch-legend', class: 'chips' }), offLine = el('p', { id: 'sch-offs', class: 'muted' });
  const main = el('div', { id: 'sch-main', class: 'view' }, nav, el('div', { class: 'row' }, nowBtn), el('div', { class: 'card form-stack' }, stats, leaveLine, patLine,
    el('button', { type: 'button', id: 'sch-wiz-open', class: 'chip', textContent: 'Изменить график', onclick: () => wiz.open() })), timerBox, warnBox,
  el('div', { class: 'card form-stack' }, el('h3', { textContent: 'Календарь' }), gridEl, legend, offLine, el('p', { class: 'muted', textContent: 'Нажми на день, чтобы поменять его: отпуск, больничный, другая смена, свои часы. Стрелки на клавиатуре двигают по дням.' })), shiftEd.root, normEd.root);
  const empty = emptyState({ art: 'calendar', id: 'sch-empty', title: 'График ещё не выбран', text: 'Выбери готовый график (например, пять через два или сутки через трое): я покажу рабочие дни на календаре и помогу считать часы и зарплату.', action: { label: 'Выбрать график', icon: 'calendar', onClick: () => wiz.open() } });
  root.append(empty, main, dayWin.root, wiz.root);

  // ----- сводка -----
  function renderStats(c, ov, today) {
    const s = monthSummary(ym, c, ov, today), diff = s.plannedMin - s.normMin;
    const stat = (t, v, sub) => el('div', { class: 'work-stat' }, el('span', { class: 'muted', textContent: t }), el('strong', { textContent: v }), el('span', { class: 'muted', textContent: sub }));
    fill(stats, stat('План на месяц', fmtDur(s.plannedMin), `Норма: ${fmtDur(s.normMin)}${diff ? ` (план ${diff > 0 ? 'больше' : 'меньше'} на ${fmtDur(Math.abs(diff))})` : ''}`),
      stat('Отмечено часов', fmtDur(s.actualMin), s.recorded ? `дней с отметкой: ${s.recorded}` : 'пока нет отметок'), stat('Рабочих дней осталось', String(s.left), `всего в месяце: ${s.workdays}`));
    const leave = [s.vacation && `отпуск: ${s.vacation} дн.`, s.sick && `больничный: ${s.sick} дн.`, s.unpaid && `за свой счёт: ${s.unpaid} дн.`].filter(Boolean);
    leaveLine.hidden = !leave.length; leaveLine.textContent = cap(leave.join(', '));
    patLine.textContent = `Мой график: ${patternText(c)}`;
  }

  // ----- таймер -----
  const elapsedMin = r => { const a = r.payload.actual; return Math.max(0, Math.floor((Date.now() - (Number.isFinite(a.startedAt) ? a.startedAt : new Date(`${r.payload.date}T${a.from}:00`).getTime())) / 60000)); };
  let elapsedEl = null;
  function renderTimer(c, ov, today) {
    const had = timerBox.contains(document.activeElement), run = runningTimer(events), td = dayPlan(today, c, ov.get(today));
    elapsedEl = null;
    const kids = [el('h3', { textContent: 'Рабочий таймер' })];
    if (!run) { clearInterval(ticker); ticker = 0; } else if (!ticker) ticker = setInterval(tick, 15000);          // обновление «Прошло: …» идёт, только пока таймер включён
    if (run) {
      const rp = dayPlan(run.payload.date, c, run.payload), n = elapsedMin(run);
      elapsedEl = el('p', { id: 'sch-elapsed', class: 'work-clock', textContent: `Прошло: ${fmtDur(n)}` });
      kids.push(el('p', { textContent: `Таймер идёт с ${rp.actual.from}${run.payload.date !== today ? ` (${dayMonthText(run.payload.date)})` : ''}.` }), elapsedEl,
        el('button', { type: 'button', id: 'sch-timer-stop', class: 'primary big-btn', onclick: () => stop() }, icon('check', 20), ' Закончить смену'),
        n >= 16 * 60 ? el('p', { class: 'warn', textContent: 'Таймер идёт очень долго. Если забыл его остановить, открой день и укажи время ухода вручную.' }) : null,
        el('button', { type: 'button', id: 'sch-timer-edit', class: 'chip', textContent: 'Изменить этот день', onclick: () => dayWin.open(run.payload.date) }));
    } else if (td.actualMin !== null) {
      kids.push(el('p', { id: 'sch-timer-done', textContent: `Сегодня отмечено: ${td.actual.from}–${td.actual.to}, ${fmtDur(td.actualMin)}.` }), el('button', { type: 'button', id: 'sch-timer-edit', class: 'chip', textContent: 'Изменить сегодняшний день', onclick: () => dayWin.open(today) }));
    } else {
      kids.push(el('p', { id: 'sch-timer-plan', textContent: `Сегодня: ${dayText(td)}.` }), el('button', { type: 'button', id: 'sch-timer-start', class: 'primary big-btn', onclick: () => start() }, icon('play', 20), ' Начать смену'),
        el('p', { class: 'muted', textContent: 'Нажми в начале смены и ещё раз в конце: время запишется само, переработки посчитаются по минутам.' }));
    }
    fill(timerBox, kids);
    if (had) (timerBox.querySelector('.primary') ?? timerBox.querySelector('button'))?.focus();
  }
  async function start() {
    try { const ev = timerStart(events, todayStr(), cfg(), Date.now()); await store.save(ev); announce(`Таймер запущен в ${ev.payload.actual.from}`); }
    catch (x) { toast(x.message); }
  }
  async function stop() {
    const r = runningTimer(events);
    if (!r) return;
    try {
      const { event, discarded } = timerStop(r, Date.now());
      if (discarded) { if (isNoop(event.payload, cfg())) await store.remove(event.id); else await store.save(event); toast('Меньше минуты: не записываю'); return; }
      await store.save(event);
      const m = dayPlan(event.payload.date, cfg(), event.payload).actualMin;
      toast(`Записано: ${fmtDur(m)}`); announce(`Смена закончена. Записано: ${fmtDur(m)}`);
    } catch (x) { toast(x.message); dayWin.open(r.payload.date); }
  }
  const tick = () => {
    if (!root.isConnected) { clearInterval(ticker); ticker = 0; return; }
    const r = elapsedEl && runningTimer(events);
    if (r && !root.hidden) elapsedEl.textContent = `Прошло: ${fmtDur(elapsedMin(r))}`;
  };

  // ----- предупреждения, календарь, подписи -----
  function renderWarn(c, ov) {
    const ws = restWarnings(`${ym}-01`, `${ym}-${String(daysIn(ym)).padStart(2, '0')}`, c, ov);
    warnBox.hidden = !ws.length;
    fill(warnBox, ws.length ? [el('h3', { textContent: 'Обрати внимание на отдых' }), el('ul', { class: 'plain work-warns' }, ...ws.map(w => el('li', {}, icon('alert', 16), ` ${w.text}`)))] : null);
  }
  function dayButton(d, today) {
    const lab = `${dateLong(d.date)}. ${d.date === today ? 'Сегодня. ' : ''}${cap(dayText(d))}${d.actual ? `. ${cap(dayActualText(d))}` : ''}${d.overridden && !d.actual ? '. Изменён вручную' : ''}.`;
    return el('button', { type: 'button', class: `cal-day ${d.color ? `sc${d.color}` : `k-${d.kind}`}${d.date === today ? ' today' : ''}${d.overridden ? ' ov' : ''}`, id: `sch-d-${d.date}`, dataset: { date: d.date }, tabIndex: d.date === fd ? 0 : -1, 'aria-label': lab, 'aria-current': d.date === today ? 'date' : false,
      onclick: () => { fd = d.date; dayWin.open(d.date); } },
    el('span', { class: 'cal-n', 'aria-hidden': 'true', textContent: String(+d.date.slice(8)) }), el('span', { class: 'cal-l', 'aria-hidden': 'true', dataset: { l: d.letter } }), el('span', { class: 'cal-mk', 'aria-hidden': 'true', textContent: d.actual?.to ? '✓' : d.running ? '…' : '' }));
  }
  function renderGrid(c, ov, today) {
    const g = monthGrid(ym, c, ov);
    if (!fd.startsWith(ym)) fd = today.startsWith(ym) ? today : `${ym}-01`;
    const had = pendingFocus || (gridEl.contains(document.activeElement) ? document.activeElement.dataset.date : null);
    gridEl.setAttribute('aria-label', `Календарь: ${monthLabel(ym).toLowerCase()}`);
    fill(gridEl, el('div', { role: 'row', class: 'cal-row cal-head' }, ...WEEKDAYS_SHORT.map((w, i) => el('span', { role: 'columnheader', class: 'cal-hd', textContent: w, 'aria-label': WEEKDAYS_LONG[i] }))),
      ...g.map(week => el('div', { role: 'row', class: 'cal-row' }, ...week.map(d => el('div', { role: 'gridcell', class: 'cal-cell' }, d ? dayButton(d, today) : null)))));
    if (had) gridEl.querySelector(`[data-date="${had}"]`)?.focus();
    pendingFocus = null;
  }
  function renderLegend(c) {
    fill(legend, c.shifts.map(s => el('li', { class: `chip static sc${s.color}`, textContent: `${s.letter} — ${s.name}${s.off ? '' : ` ${s.from}–${s.to}`}` })),
      ['вых — выходной', 'отп — отпуск', 'бол — больничный', 'б/с — за свой счёт', '✓ — часы отмечены'].map(t => el('li', { class: 'chip static', textContent: t })));
  }
  function renderOffs(c, ov, today) {
    const o = nextOffDays(today, c, ov, 3);
    offLine.textContent = o.length ? `Ближайшие выходные: ${o.map(d => (d.date === today ? 'сегодня' : dayMonthText(d.date))).join(', ')}` : 'Ближайших выходных в графике нет.';
  }
  gridEl.addEventListener('focusin', e => {
    const b = e.target.closest?.('.cal-day');
    if (!b) return;
    gridEl.querySelector('.cal-day[tabindex="0"]')?.setAttribute('tabindex', '-1'); b.setAttribute('tabindex', '0'); fd = b.dataset.date;
  });
  gridEl.addEventListener('keydown', e => {
    const b = e.target.closest?.('.cal-day');
    if (!b) return;
    const d = b.dataset.date, w = dowMon(d), mo = delta => { const t = shiftYm(d.slice(0, 7), delta); return `${t}-${String(Math.min(+d.slice(8), daysIn(t))).padStart(2, '0')}`; };
    const to = { ArrowLeft: addDays(d, -1), ArrowRight: addDays(d, 1), ArrowUp: addDays(d, -7), ArrowDown: addDays(d, 7), Home: addDays(d, -w), End: addDays(d, 6 - w), PageUp: mo(-1), PageDown: mo(1) }[e.key];
    if (!to) return;
    e.preventDefault(); fd = to;
    if (!to.startsWith(ym)) { ym = to.slice(0, 7); pendingFocus = to; render(); announce(monthLabel(ym)); } else gridEl.querySelector(`[data-date="${to}"]`)?.focus();
  });

  function render() {
    const c = cfg(), today = todayStr();
    empty.hidden = !!c; main.hidden = !c;
    if (!c) return;
    const ov = workdaysOf(events);
    label.textContent = monthLabel(ym); nowBtn.hidden = ym === today.slice(0, 7);
    renderStats(c, ov, today); renderTimer(c, ov, today); renderWarn(c, ov); renderGrid(c, ov, today); renderLegend(c); renderOffs(c, ov, today);
    shiftEd.sync(c); normEd.sync(c);
  }
  return { root, update(evs) { events = evs; if (!root.hidden) render(); }, show() { render(); } };
}
