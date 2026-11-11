// Экран «Планы»: прогноз месяца, лимиты по категориям, копилки и подписки.
import { el, toast, dateRu, moneyText } from './ui.js';
import { todayStr } from './events.js';
import * as store from './store.js';
import { parseAmount, categoriesUsed, monthLabel, monthOf } from './money.js';
import { limitStatus, makeLimit, limitId, makeGoal, makeGoalMove, goalProgress, makeSub, subsOf, subsTotals, nextCharge, monthlyCost, subPayment, forecast, DEFAULT_CATEGORIES } from './planning.js';

const pct = r => `${Math.round(r * 100)}%`;
const bar = (ratio, cls = '') => el('div', { class: `progress ${cls}`.trim(), role: 'img', 'aria-label': pct(ratio) }, el('span', { style: `--w:${Math.min(100, Math.round(ratio * 100))}%` }));

export function createPlansView() {
  let events = [];
  const root = el('section', { id: 'view-plans', class: 'view' });

  // формы создаются один раз, чтобы введённое не терялось при обновлении данных
  const limCat = el('select', { id: 'lim-cat', 'aria-label': 'Категория' });
  const limAmt = el('input', { id: 'lim-amt', type: 'text', inputMode: 'decimal', placeholder: 'Лимит на месяц, ₽', autocomplete: 'off' });
  const limErr = el('p', { class: 'error', id: 'lim-err' });
  const limForm = el('form', { class: 'row wrap' }, limCat, limAmt, el('button', { type: 'submit', id: 'lim-save', class: 'primary', textContent: 'Задать' }));
  limForm.onsubmit = async e => {
    e.preventDefault();
    try { await store.save(makeLimit(limCat.value, parseAmount(limAmt.value))); limAmt.value = ''; limErr.textContent = ''; toast('Лимит задан'); } catch (err) { limErr.textContent = err.message; }
  };

  const gTitle = el('input', { id: 'goal-title', type: 'text', maxLength: 80, placeholder: 'Например: отпуск', autocomplete: 'off' });
  const gTarget = el('input', { id: 'goal-target', type: 'text', inputMode: 'decimal', placeholder: 'Сколько нужно, ₽', autocomplete: 'off' });
  const gDue = el('input', { id: 'goal-due', type: 'date', 'aria-label': 'Срок (по желанию)' });
  const gErr = el('p', { class: 'error', id: 'goal-err' });
  const goalForm = el('form', { class: 'form-stack' }, gTitle, gTarget, el('label', {}, 'Срок (по желанию): ', gDue), el('button', { type: 'submit', id: 'goal-add', class: 'primary', textContent: 'Создать цель' }), gErr);
  goalForm.onsubmit = async e => {
    e.preventDefault();
    try { if (!gTitle.value.trim()) throw new Error('Назови цель'); await store.save(makeGoal({ title: gTitle.value, targetMinor: parseAmount(gTarget.value), dueDate: gDue.value || null })); gTitle.value = ''; gTarget.value = ''; gDue.value = ''; gErr.textContent = ''; } catch (err) { gErr.textContent = err.message; }
  };

  const sName = el('input', { id: 'sub-name', type: 'text', maxLength: 60, placeholder: 'Название подписки', autocomplete: 'off' });
  const sAmt = el('input', { id: 'sub-amt', type: 'text', inputMode: 'decimal', placeholder: 'Сумма, ₽', autocomplete: 'off' });
  const sPeriod = el('select', { id: 'sub-period', 'aria-label': 'Период' }, el('option', { value: 'month', textContent: 'в месяц' }), el('option', { value: 'year', textContent: 'в год' }));
  const sDay = el('input', { id: 'sub-day', type: 'number', min: '1', max: '31', value: '1', 'aria-label': 'День списания' });
  const sMonth = el('input', { id: 'sub-month', type: 'number', min: '1', max: '12', value: '1', 'aria-label': 'Месяц списания (для годовой)' });
  const sMonthLabel = el('label', { hidden: true }, 'Месяц: ', sMonth);
  sPeriod.onchange = () => { sMonthLabel.hidden = sPeriod.value !== 'year'; };
  const sErr = el('p', { class: 'error', id: 'sub-err' });
  const subForm = el('form', { class: 'form-stack' }, sName, el('div', { class: 'row wrap' }, sAmt, sPeriod), el('div', { class: 'row wrap' }, el('label', {}, 'День: ', sDay), sMonthLabel),
    el('button', { type: 'submit', id: 'sub-add', class: 'primary', textContent: 'Добавить подписку' }), sErr);
  subForm.onsubmit = async e => {
    e.preventDefault();
    try { if (!sName.value.trim()) throw new Error('Назови подписку'); await store.save(makeSub({ name: sName.value, amountMinor: parseAmount(sAmt.value), period: sPeriod.value, day: sDay.value, month: sMonth.value })); sName.value = ''; sAmt.value = ''; sErr.textContent = ''; } catch (err) { sErr.textContent = err.message; }
  };

  function renderForecast(today) {
    const f = forecast(events, today);
    const lines = [`Потрачено за ${monthLabel(f.ym).toLowerCase()}: ${moneyText(f.spent)} (день ${f.day} из ${f.days})`];
    if (f.projected !== null) lines.push(`При таком темпе к концу месяца: ≈ ${moneyText(f.projected)}${f.budget ? `, бюджет ${moneyText(f.budget)}` : ''}`);
    if (f.perDay !== null) lines.push(f.perDay >= 0 ? `Чтобы уложиться в бюджет, можно тратить около ${moneyText(f.perDay)} в день` : `Бюджет уже превышен на ${moneyText(-f.perDay * (f.daysLeft + 1))}`);
    if (f.subsLeft) lines.push(`Подписки, которые ещё спишутся в этом месяце: ${moneyText(f.subsLeft)}`);
    return el('div', { class: 'card', id: 'plan-forecast' }, el('h3', { textContent: 'Прогноз месяца' }), ...lines.map(t => el('p', { class: f.overBudget && t.startsWith('При таком') ? 'warn' : 'muted', textContent: t })),
      f.projected === null ? el('p', { class: 'muted', textContent: 'В первые дни месяца прогноз не строится: данных мало.' }) : null);
  }

  function renderLimits(today) {
    const ym = monthOf(today);
    const st = limitStatus(events, ym);
    const cats = [...new Set([...categoriesUsed(events, 'expense'), ...DEFAULT_CATEGORIES])];
    const prev = limCat.value;
    limCat.replaceChildren(...cats.map(c => el('option', { value: c, textContent: c })));
    if (prev && cats.includes(prev)) limCat.value = prev;
    const rows = st.map(x => el('div', { class: 'lim-row', dataset: { cat: x.category, status: x.status } },
      el('div', { class: 'row' }, el('strong', { class: 'grow', textContent: x.category }),
        el('span', { class: x.status === 'over' ? 'warn' : 'muted', textContent: x.limit ? `${moneyText(x.spent)} из ${moneyText(x.limit)}` : moneyText(x.spent) }),
        x.limit ? el('button', { type: 'button', class: 'chip', 'aria-label': `Убрать лимит: ${x.category}`, textContent: '✕', onclick: async () => { const old = await store.remove(limitId(x.category)); toast('Лимит убран', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {}); } }) : null),
      x.limit ? bar(x.ratio, x.status === 'over' ? 'over' : x.status === 'warn' ? 'warn' : '') : null,
      x.limit ? el('span', { class: 'muted', textContent: x.left >= 0 ? `осталось ${moneyText(x.left)} (${pct(x.ratio)})` : `превышен на ${moneyText(-x.left)}` }) : null));
    return el('div', { class: 'card', id: 'plan-limits' }, el('h3', { textContent: `Лимиты по категориям · ${monthLabel(ym)}` }),
      ...(rows.length ? rows : [el('p', { class: 'muted', textContent: 'Расходов за месяц пока нет. Задай лимит заранее.' })]), el('strong', { textContent: 'Новый лимит' }), limForm, limErr);
  }

  function renderGoals(today) {
    const goals = goalProgress(events, today);
    const items = goals.map(p => {
      const amt = el('input', { type: 'text', inputMode: 'decimal', class: 'goal-amt', placeholder: 'Сумма, ₽', 'aria-label': `Сумма для «${p.goal.payload.title}»`, autocomplete: 'off' });
      const move = sign => async () => { try { await store.save(makeGoalMove(p.goal.id, sign * parseAmount(amt.value))); amt.value = ''; } catch (e) { toast(e.message); } };
      const hint = p.done ? 'Цель достигнута 🎉' : p.perMonth ? `Нужно откладывать около ${moneyText(p.perMonth)} в месяц (осталось ${p.monthsLeft} мес.)` : p.overdue ? 'Срок прошёл — можно перенести срок или уменьшить цель' : `Осталось ${moneyText(p.remaining)}`;
      return el('div', { class: `goal${p.done ? ' done' : ''}`, dataset: { id: p.goal.id } },
        el('div', { class: 'row' }, el('strong', { class: 'grow', textContent: p.goal.payload.title }), el('span', { class: 'muted', textContent: p.goal.payload.dueDate ? `до ${dateRu(p.goal.payload.dueDate)}` : '' })),
        bar(p.ratio, p.done ? 'ok' : ''), el('span', { class: 'muted goal-line', textContent: `${moneyText(p.saved)} из ${moneyText(p.target)} (${pct(p.ratio)})` }), el('p', { class: 'hint', textContent: hint }),
        el('div', { class: 'row wrap' }, amt, el('button', { type: 'button', class: 'chip goal-plus', textContent: '+ Отложить', onclick: move(1) }), el('button', { type: 'button', class: 'chip goal-minus', textContent: '− Снять', onclick: move(-1) }),
          el('button', { type: 'button', class: 'chip danger', 'aria-label': 'Удалить цель', textContent: 'Удалить', onclick: async () => {
            const ids = [p.goal.id, ...events.filter(e => e.type === 'goalmove' && e.payload.goalId === p.goal.id).map(e => e.id)];
            const old = await store.removeMany(ids); toast('Цель удалена', { actionLabel: 'Вернуть', onAction: () => store.saveMany(old) });
          } })));
    });
    return el('div', { class: 'card', id: 'plan-goals' }, el('h3', { textContent: 'Копилки' }), ...(items.length ? items : [el('p', { class: 'muted', textContent: 'Цель накопления: отпуск, подушка безопасности, техника. Откладывай суммы и смотри прогресс.' })]), el('strong', { textContent: 'Новая цель' }), goalForm);
  }

  function renderSubs(today) {
    const subs = subsOf(events), t = subsTotals(events);
    const items = subs.map(s => {
      const p = s.payload, nc = nextCharge(p, today);
      return el('div', { class: `sub${p.active ? '' : ' off'}`, dataset: { id: s.id } },
        el('div', { class: 'row' }, el('strong', { class: 'grow', textContent: p.name }), el('span', { textContent: `${moneyText(p.amountMinor)} ${p.period === 'year' ? 'в год' : 'в месяц'}` })),
        el('span', { class: 'muted', textContent: p.active ? `следующее списание ${dateRu(nc)}${p.period === 'year' ? ` · ≈ ${moneyText(monthlyCost(p))} в месяц` : ''}` : 'приостановлена' }),
        el('div', { class: 'row wrap' },
          p.active ? el('button', { type: 'button', class: 'chip sub-pay', textContent: 'Записать платёж', onclick: async () => { const ev = subPayment(s, todayStr()); await store.save(ev); toast(`Записан расход: ${p.name}`, { actionLabel: 'Отменить', onAction: () => store.remove(ev.id) }); } }) : null,
          el('button', { type: 'button', class: 'chip sub-toggle', textContent: p.active ? 'Пауза' : 'Возобновить', onclick: () => store.save({ ...s, payload: { ...p, active: !p.active } }) }),
          el('button', { type: 'button', class: 'chip danger', textContent: 'Удалить', onclick: async () => { const old = await store.remove(s.id); toast('Подписка удалена', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {}); } })));
    });
    return el('div', { class: 'card', id: 'plan-subs' }, el('h3', { textContent: 'Подписки' }),
      t.count ? el('p', { id: 'sub-total', textContent: `Активных: ${t.count} · ${moneyText(t.monthly)} в месяц (${moneyText(t.yearly)} в год)` }) : el('p', { class: 'muted', textContent: 'Регулярные списания легко забыть. Запиши их и раз в три месяца решай, нужны ли они.' }),
      ...items, el('strong', { textContent: 'Новая подписка' }), subForm,
      t.count ? el('p', { class: 'muted', textContent: 'Совет: раз в три месяца проверь, чем из подписок реально пользуешься, и поставь лишнее на паузу.' }) : null);
  }

  function render() {
    const today = todayStr();
    root.replaceChildren(renderForecast(today), renderLimits(today), renderGoals(today), renderSubs(today));
  }
  return { root, update(evs) { events = evs; if (!root.hidden) render(); }, show() { render(); } };
}
