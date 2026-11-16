// Вкладка «Аналитика» экрана «Зарплата»: выводы простыми словами, сравнение месяцев, «а что если». Дочерний блок. Всё — оценки по настройкам человека.
import { el, fill, icon, emptyState } from './ui.js';
import { getPref } from './prefs.js';
import { monthLabel } from './money.js';
import { fmtDur } from './schedule.js';
import { monthSeries, whatIf, insights } from './salary-insights.js';
import { upcomingPayouts, fmtMoney, CURRENCIES, DISCLAIMER } from './salary.js';

const TONE = { good: 'checkCircle', warn: 'alert', info: 'info' };
const slider = (id, min, max, step) => { const r = el('input', { id, min, max, step }); r.setAttribute('type', 'range'); r.value = '0'; return r; };
const short = ym => `${monthLabel(ym).slice(0, 3).toLowerCase()} ${ym.slice(2, 4)}`;

export function createAnalyticsPanel() {
  let st = null;
  const money = v => (getPref('hideAmounts') ? `•••• ${CURRENCIES[st.pay.currency] ?? st.pay.currency}` : fmtMoney(v, st.pay.currency));
  const list = el('ul', { id: 'sal-insights', class: 'list work-insights' }), bars = el('ul', { id: 'sal-bars', class: 'work-bars' }), real = el('ul', { id: 'sal-real', class: 'plain' });
  const empty = emptyState({ art: 'growth', id: 'sal-an-empty', title: 'Пока нечего сказать', text: 'Укажи оклад в «Настройках» и отмечай часы в «Графике»: здесь появятся выводы и сравнение месяцев.' });
  const ot = slider('sal-wi-ot', 0, 40, 0.5), raise = slider('sal-wi-raise', 0, 50, 1), otVal = el('strong', { id: 'sal-wi-otv' }), raiseVal = el('strong', { id: 'sal-wi-raisev' });
  const out = el('p', { id: 'sal-wi-out', class: 'work-wi', 'aria-live': 'polite' });
  const realCard = el('div', { id: 'sal-real-card', class: 'card form-stack' }, el('h3', { textContent: 'Расчёт и то, что пришло' }), real);
  const body = el('div', { id: 'sal-an-body', class: 'form-stack' },
    el('div', { class: 'card form-stack' }, el('h3', { textContent: 'Что видно по твоим данным' }), list),
    el('div', { class: 'card form-stack' }, el('h3', { textContent: 'Сравнение месяцев (на руки, по расчёту)' }), bars, el('p', { class: 'muted', textContent: 'Для прошлых месяцев без отметок часов считаю по графику и по нынешним настройкам.' })),
    realCard,
    el('div', { class: 'card form-stack' }, el('h3', { textContent: 'А если…' }), el('p', { class: 'muted', textContent: 'Подвигай ползунки: как изменится сумма на руки в этом месяце, если больше работать сверх смены или если оклад вырастет.' }),
      el('label', { class: 'work-f' }, el('span', {}, 'Ещё переработок за месяц: ', otVal), ot), el('label', { class: 'work-f' }, el('span', {}, 'Прибавка к окладу или ставке: ', raiseVal), raise), out),
    el('p', { class: 'muted', textContent: DISCLAIMER }));
  const root = el('div', { id: 'sal-an', class: 'form-stack' }, empty, body);

  function calcWhatIf() {
    const h = Number(ot.value), r = Number(raise.value);
    otVal.textContent = `${String(h).replace('.', ',')} ч`; raiseVal.textContent = `${r} %`;
    ot.setAttribute('aria-valuetext', otVal.textContent); raise.setAttribute('aria-valuetext', raiseVal.textContent);
    if (!st?.pay) return;
    const w = whatIf(st.args, { extraOvertimeMin: Math.round(h * 60), raisePct: r }), d = w.dNet;
    out.textContent = h === 0 && r === 0 ? `Сейчас на руки около ${money(w.before.net)}. Подвинь ползунок.` : `На руки около ${money(w.after.net)} вместо ${money(w.before.net)}: ${d >= 0 ? 'больше' : 'меньше'} на ${money(Math.abs(d))}.`;
  }
  ot.oninput = raise.oninput = calcWhatIf;

  function render(s) {
    st = s;
    const ok = !!(s.pay && s.cfg && s.pay.baseMinor > 0);
    empty.hidden = ok; body.hidden = !ok;
    if (!ok) return;
    const series = monthSeries(s.ym, 6, s.mk), upcoming = upcomingPayouts(s.today, s.pay, ym => s.mk(ym).month.net);
    const items = insights({ cur: s.res, prev: s.prev, series, pay: s.pay, today: s.today, closed: s.closed, upcoming });
    fill(list, items.length ? items.map(i => el('li', { class: `insight ${i.tone}`, dataset: { id: i.id } }, icon(TONE[i.tone], 18), el('span', { textContent: ` ${i.text}` }))) : el('li', { class: 'muted', textContent: 'Выводов пока нет: добавь оклад и отмечай часы.' }));
    const top = Math.max(1, ...series.map(r => r.net));
    fill(bars, series.map(r => { const bar = el('i'); bar.style.width = `${Math.max(2, Math.round(r.net * 100 / top))}%`; return el('li', { class: `work-bar${r.ym === s.ym ? ' cur' : ''}` }, el('span', { class: 'lbl', textContent: short(r.ym) }), el('span', { class: 'bar', 'aria-hidden': 'true' }, bar), el('span', { class: 'val', textContent: `${money(r.net)}${r.otMin ? ` · переработки ${fmtDur(r.otMin)}` : ''}` })); }));
    const closed = [...s.closed.values()].filter(p => p.actualNetMinor !== null).sort((a, b) => b.ym.localeCompare(a.ym)).slice(0, 6);
    realCard.hidden = !closed.length;
    fill(real, closed.map(p => { const d = p.actualNetMinor - p.computed.netMinor; return el('li', { textContent: `${monthLabel(p.ym)}: расчёт ${money(p.computed.netMinor)}, пришло ${money(p.actualNetMinor)}${d ? ` (${d > 0 ? 'больше' : 'меньше'} на ${money(Math.abs(d))})` : ' (сошлось)'}` }); }));
    calcWhatIf();
  }
  return { root, render };
}
