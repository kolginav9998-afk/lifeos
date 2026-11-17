// Экран «Зарплата»: расчёт месяца (оклад, налог, переработки по минутам, прогноз, запись дохода), часы, настройки, аналитика.
// Всё — оценка по настройкам человека; это не бухгалтерия и не налоговая консультация (текст DISCLAIMER виден на каждой вкладке с цифрами).
import { el, fill, icon, toast, announce, emptyState } from './ui.js';
import { todayStr } from './events.js';
import { getPref } from './prefs.js';
import * as store from './store.js';
import { monthLabel, makeIncome } from './money.js';
import { cfgOf, workdaysOf, shiftYm, fmtDur, dayMonthText, cfgFromTemplate, makeWorkcfg, autoWorkcfg } from './schedule.js';
import { ensureCalendar } from './calendar-ru.js';
import { httpFetch } from './platform.js';
import { workCost, payOf, paymonthsOf, computeMonth, payoutPlan, incomeDraft, makePaymonth, makePaycfg, normalizePay, pmId, fmtMoney, fmtMult, parseMinor, CURRENCIES, ROUNDING, roundingId, DISCLAIMER, plural } from './salary.js';
import { TAX_PRESETS, presetTax, fmtPercent, describeTax } from './salary-tax.js';
import { createHoursPanel } from './view-salary-hours.js';
import { createSettingsPanel } from './view-salary-settings.js';
import { createAnalyticsPanel } from './view-salary-analytics.js';

const TABS = [['calc', 'Расчёт'], ['hours', 'Часы'], ['settings', 'Настройки'], ['analytics', 'Аналитика']];
const lab = (text, input) => el('label', { class: 'work-f' }, el('span', { class: 'muted', textContent: text }), input);
const mins = n => (n >= 60 ? `${fmtDur(n)} (${n} мин)` : `${n} мин`);

export function createSalaryView(ctx = {}) {
  let events = [], ym = todayStr().slice(0, 7), tab = 'calc', st = null;
  const root = el('section', { id: 'view-salary', class: 'view' }), evs = () => events;
  const hours = createHoursPanel({ events: evs }), settings = createSettingsPanel({ events: evs, go: ctx.go }), analytics = createAnalyticsPanel();
  const money = v => { const c = st?.pay?.currency ?? 'RUB'; return getPref('hideAmounts') ? `•••• ${CURRENCIES[c]}` : fmtMoney(v, c); };

  // ----- вкладки и месяц -----
  const tabBtns = TABS.map(([k, t]) => el('button', { type: 'button', id: `sal-tab-${k}`, class: 'seg', textContent: t, dataset: { tab: k }, onclick: () => { tab = k; render(); announce(`Вкладка «${t}»`); } }));
  const label = el('strong', { id: 'sal-month', class: 'month-label' });
  const step = d => { ym = shiftYm(ym, d); render(); announce(monthLabel(ym)); };
  const nav = el('div', { class: 'month-nav' }, el('button', { type: 'button', id: 'sal-prev', 'aria-label': 'Прошлый месяц', onclick: () => step(-1) }, icon('chevL', 20)), label,
    el('button', { type: 'button', id: 'sal-next', 'aria-label': 'Следующий месяц', onclick: () => step(1) }, icon('chevR', 20)));
  const needSchedule = emptyState({ art: 'calendar', id: 'sal-need-sch', title: 'Сначала выбери график', text: 'От графика зависят норма часов, ставка за час и переработки.', action: { label: 'Открыть график', icon: 'calendar', onClick: () => ctx.go?.('schedule') } });

  // ----- первый запуск: оклад и налог -----
  const qMode = el('select', { id: 'sal-q-mode' }, el('option', { value: 'salary', textContent: 'Оклад в месяц' }), el('option', { value: 'hourly', textContent: 'Ставка за час' }));
  const qBase = el('input', { id: 'sal-q-base', type: 'text', inputMode: 'decimal', autocomplete: 'off', placeholder: 'Например, 100000' });
  const qCur = el('select', { id: 'sal-q-cur' }, ...Object.entries(CURRENCIES).map(([c, s]) => el('option', { value: c, textContent: `${s} ${c}` })));
  const qTax = el('select', { id: 'sal-q-tax' }, ...TAX_PRESETS.map(p => el('option', { value: p.pid, textContent: p.title, selected: p.pid === 'flat' })));
  const qErr = el('p', { id: 'sal-q-err', class: 'error' });
  const quick = el('form', { id: 'sal-quick', class: 'card form-stack' }, el('h3', { textContent: 'Расчёт зарплаты' }),
    el('p', { textContent: 'Введи оклад, и я посчитаю налог и сумму на руки. Переработки считаются по минутам: например, вдвое дороже обычного часа.' }),
    lab('Как платят', qMode), lab('Оклад или ставка, до налога', qBase), lab('Валюта', qCur), lab('Налог (готовые примеры, потом можно изменить)', qTax), qErr,
    el('p', { class: 'muted', textContent: 'Налог в списке — пример, а не справка: ставку или шкалу поменяй на вкладке «Настройки». Если графика ещё нет, поставлю «5 через 2»: его можно изменить в разделе «График».' }),
    el('button', { type: 'submit', id: 'sal-q-save', class: 'primary', textContent: 'Рассчитать' }), el('p', { class: 'muted', textContent: DISCLAIMER }));
  quick.onsubmit = async e => {
    e.preventDefault();
    try {
      qErr.textContent = '';
      const pay = normalizePay({ mode: qMode.value, baseMinor: parseMinor(qBase.value), currency: qCur.value, tax: presetTax(qTax.value) }), list = [makePaycfg(pay, null)];
      if (!cfgOf(events)) list.unshift(makeWorkcfg(cfgFromTemplate('w52', todayStr())));
      await store.saveMany(list); announce('Настройки сохранены, расчёт готов');
    } catch (x) { qErr.textContent = x.message; announce(x.message, { assertive: true }); }
  };

  // ----- расчёт -----
  const hero = el('div', { id: 'sal-hero', class: 'card hero form-stack' }), brk = el('div', { id: 'sal-brk', class: 'card form-stack' }), otCard = el('div', { id: 'sal-ot', class: 'card form-stack' }), fc = el('div', { id: 'sal-fc', class: 'card form-stack' });
  const incomeBtn = el('button', { type: 'button', id: 'sal-income', class: 'primary', textContent: 'Записать как доход', onclick: () => record() }), incomeNote = el('p', { id: 'sal-income-note', class: 'muted' });
  const actual = el('input', { id: 'sal-actual', type: 'text', inputMode: 'decimal', autocomplete: 'off', placeholder: 'Сколько пришло на руки' }), actualErr = el('p', { id: 'sal-actual-err', class: 'error' }), compare = el('p', { id: 'sal-compare' });
  const xName = el('input', { id: 'sal-x-name', type: 'text', maxLength: 40, autocomplete: 'off', placeholder: 'Например, премия за квартал' }), xAmt = el('input', { id: 'sal-x-amt', type: 'text', inputMode: 'decimal', autocomplete: 'off', placeholder: 'Сумма' });
  const xTax = el('input', { type: 'checkbox', id: 'sal-x-tax', checked: true }), xErr = el('p', { id: 'sal-x-err', class: 'error' }), xList = el('ul', { id: 'sal-x-list', class: 'plain' });
  const actions = el('div', { id: 'sal-actions', class: 'card form-stack' }, el('h3', { textContent: 'Записать и сверить' }), incomeBtn, incomeNote,
    el('form', { id: 'sal-close-form', class: 'form-stack', onsubmit: e => { e.preventDefault(); closeMonth(); } }, lab('Что пришло на самом деле (на руки)', actual), actualErr,
      el('button', { type: 'submit', id: 'sal-close-save', class: 'chip', textContent: 'Сохранить, что пришло' }), compare),
    el('form', { id: 'sal-x-form', class: 'form-stack', onsubmit: e => { e.preventDefault(); addExtra(); } }, el('strong', { textContent: 'Разовая премия или доплата за этот месяц' }), lab('Название', xName), lab('Сумма', xAmt),
      el('label', { class: 'check-label' }, xTax, ' Облагается налогом'), xErr, el('button', { type: 'submit', id: 'sal-x-add', class: 'chip', textContent: 'Добавить в расчёт' }), xList));
  const disclaimer = el('p', { id: 'sal-disclaimer', class: 'muted', textContent: DISCLAIMER });
  // «Сколько часов работы стоит покупка»: цена в часах твоей работы по ставке «на руки»
  const buyAmt = el('input', { id: 'sal-buy-amt', type: 'text', inputMode: 'decimal', autocomplete: 'off', placeholder: 'Цена покупки', 'aria-label': 'Цена покупки' });
  const buyOut = el('p', { id: 'sal-buy-out', class: 'muted', role: 'status' });
  const buyCard = el('div', { id: 'sal-buy', class: 'card form-stack' }, el('h3', { textContent: 'Сколько часов работы стоит покупка' }),
    el('p', { class: 'muted', textContent: 'Введи цену, и я переведу её в часы твоей работы по ставке «на руки». Помогает решить, нужна ли вещь.' }), buyAmt, buyOut);
  function paintBuy() {
    const v = buyAmt.value.trim();
    if (!v || !st?.res) { buyOut.textContent = ''; return; }
    let minor;
    try { minor = parseMinor(v); } catch { buyOut.textContent = 'Введи цену числом, например 4500'; return; }
    const c = workCost(minor, st.res.month.net, st.res.normMin, st.res.workdays);
    buyOut.textContent = c ? `Это около ${fmtDur(c.minutes)} работы${c.days >= 0.1 ? ` (примерно ${c.days.toFixed(1).replace('.', ',')} рабочего дня)` : ''}. Твоя ставка на руки около ${money(c.perHourMinor)} в час.` : 'Посчитать не получается: за этот месяц нет дохода или нормы часов.';
  }
  buyAmt.addEventListener('input', paintBuy);
  const calcBox = el('div', { id: 'sal-calc', class: 'form-stack' });

  function compute() {
    const cfg = cfgOf(events), pay = payOf(events), d = new Date(), today = todayStr(), closed = paymonthsOf(events);
    if (!cfg) return { cfg, pay, today, ym, closed, res: null };
    const use = pay ?? normalizePay({}), days = workdaysOf(events), nowMin = d.getHours() * 60 + d.getMinutes(), prior = new Map([...closed].map(([k, v]) => [k, v.computed.taxableMinor]));
    const mk = (m, adjust = null) => computeMonth({ ym: m, cfg, pay: use, days, today, nowMin, extras: closed.get(m)?.extras ?? [], prior, adjust });
    return { cfg, pay, today, ym, closed, days, mk, res: mk(ym), prev: mk(shiftYm(ym, -1)), args: { ym, cfg, pay: use, days, today, nowMin, extras: closed.get(ym)?.extras ?? [], prior } };
  }
  const row = (t, v, cls = '') => el('div', { class: `work-dr ${cls}`.trim() }, el('dt', { textContent: t }), el('dd', { textContent: v }));
  function renderCalc() {
    const { pay, res, today } = st, t = res.month, a = res.accrued, o = t.overtime, now = ym === today.slice(0, 7), mult = pay.ot.multMille;
    fill(hero, el('p', { class: 'muted', textContent: `${monthLabel(ym)}: на руки за месяц (оценка)` }), el('p', { id: 'sal-net', class: 'big', textContent: money(t.net) }),
      el('p', { id: 'sal-hero-sub', textContent: `Начислено до налога: ${money(t.gross)} · налог: ${money(t.tax)} (${fmtPercent(t.taxBp)})${t.preDed + t.postDed ? ` · удержания: ${money(t.preDed + t.postDed)}` : ''}` }),
      now && res.share < 1 ? el('p', { id: 'sal-accrued', class: 'muted', textContent: `К сегодняшнему дню: начислено ${money(a.gross)}, на руки ${money(a.net)}.` }) : null);
    fill(brk, el('h3', { textContent: 'Из чего складывается' }), el('dl', { id: 'sal-dl', class: 'work-dl' }, row(pay.mode === 'hourly' ? `Работа по ставке (${fmtDur(t.workedMin - o.raw)})` : 'Оклад за месяц', money(t.base), 'base'),
      o.min ? row(`Переработки: ${fmtDur(o.min)}`, money(o.pay), 'ot') : null, t.night ? row(`Ночные доплаты (${fmtDur(t.nightMin)})`, money(t.night), 'night') : null, t.allowances ? row('Надбавки и премии', money(t.allowances), 'allow') : null,
      row('Начислено до налога', money(t.gross), 'sum gross'), t.preDed ? row('Удержания до налога', `−${money(t.preDed)}`, 'pre') : null, row(`Налог: ${describeTax(pay.tax).toLowerCase()}`, `−${money(t.tax)}`, 'tax'), t.postDed ? row('Удержания после налога', `−${money(t.postDed)}`, 'post') : null,
      row('На руки', money(t.net), 'sum net')));
    const tier = pay.ot.tier1Min > 0 ? `, первые ${pay.ot.tier1Min} мин ${fmtMult(pay.ot.tier1MultMille)}` : '', rnd = ROUNDING.find(r => r.rid === roundingId(pay.ot)).label.toLowerCase();
    fill(otCard, el('h3', { textContent: 'Переработки по минутам' }), o.min ? el('p', { id: 'sal-ot-line', textContent: `Сверх ${pay.ot.basis === 'day' ? 'плановой смены каждого дня' : 'нормы месяца'}: ${mins(o.min)}. ${o.t1 ? `Первые ${o.t1} мин ${fmtMult(pay.ot.tier1MultMille)}, остальные ${o.t2} мин ${fmtMult(mult)}.` : `Каждая минута ${fmtMult(mult)}.`} Итого ${money(o.pay)}.` })
      : el('p', { id: 'sal-ot-line', textContent: 'В этом месяце переработок нет. Отмечай время прихода и ухода в «Графике» (или на вкладке «Часы»): минуты сверх смены посчитаются сами.' }),
    el('p', { class: 'muted', textContent: `Правило: минуты сверх ${pay.ot.basis === 'day' ? 'плановой смены каждого дня' : 'нормы часов месяца'}, коэффициент ${fmtMult(mult)}${tier}, округление: ${rnd}. Час по ставке: ${money(res.perHourMinor)}${pay.mode === 'salary' && !pay.hourlyMinor ? ` (оклад ÷ норма ${fmtDur(res.normMin)})` : ''}, минута переработки: ${money(Math.round(res.perHourMinor * mult / 60))}.` }),
    res.zeroNorm ? el('p', { class: 'warn', textContent: 'Норма часов этого месяца равна нулю, поэтому ставку за час вывести нельзя и переработки не считаются. Проверь график и норму часов.' }) : null);
    const plans = payoutPlan(ym, t.net, pay), word = { advance: 'Аванс', final: 'Остаток' };
    fill(fc, el('h3', { textContent: now ? 'Прогноз до конца месяца' : 'Итог месяца' }), now ? el('p', { id: 'sal-fc-line', textContent: `Осталось рабочих дней: ${res.left}. ${res.left ? `Если без новых переработок, на руки выйдет около ${money(t.net)}.` : `На руки около ${money(t.net)}.`}` }) : el('p', { id: 'sal-fc-line', textContent: `На руки около ${money(t.net)}.` }),
      ...plans.map(p => el('p', { class: 'sal-pay', textContent: `${word[p.kind]}: ${dayMonthText(p.date)}, около ${money(p.amountMinor)}` })),
      res.ytd.assumed ? el('p', { class: 'muted', textContent: `Налог по шкале «за год»: для ${res.ytd.assumed} ${plural(res.ytd.assumed, 'прошлого месяца', 'прошлых месяцев', 'прошлых месяцев')} года считаю доход таким же, как в этом. Если запишешь итоги прошлых месяцев, расчёт станет точнее.` }) : null);
    const draft = (() => { try { return incomeDraft(res, pay, today); } catch { return null; } })(), done = draft && events.some(e => e.type === 'income' && e.payload.note === draft.note);
    incomeBtn.disabled = !draft; incomeBtn.textContent = done ? 'Записать как доход ещё раз' : 'Записать как доход';
    incomeNote.textContent = done ? 'За этот месяц доход уже записан. Повторная запись добавит ещё одну строку.' : 'Запишу сумму на руки в раздел «Расходы и доходы», категория «Зарплата». Дату и сумму можно поправить там.';
    const pm = st.closed.get(ym), diff = pm && pm.actualNetMinor !== null ? pm.actualNetMinor - pm.computed.netMinor : null;
    compare.textContent = diff === null ? '' : `Расчёт был ${money(pm.computed.netMinor)}, пришло ${money(pm.actualNetMinor)}: ${diff ? `${diff > 0 ? 'больше' : 'меньше'} на ${money(Math.abs(diff))}` : 'сошлось'}.`;
    fill(xList, (pm?.extras ?? []).map((x, i) => el('li', {}, `${x.name}: ${money(x.amountMinor)}${x.taxable ? '' : ' (без налога)'} `, el('button', { type: 'button', class: 'link', textContent: 'убрать', 'aria-label': `Убрать из расчёта: ${x.name}`, onclick: () => savePm({ extras: pm.extras.filter((_, k) => k !== i) }) }))));
    fill(calcBox, hero, brk, otCard, fc, buyCard, actions, disclaimer);
    paintBuy();
  }
  const snap = r => ({ grossMinor: r.month.gross, taxMinor: r.month.tax, netMinor: r.month.net, taxableMinor: r.month.taxable, overtimeMin: r.month.overtime.min, overtimeMinor: r.month.overtime.pay, workedMin: r.month.workedMin });
  async function savePm(patch) {
    const prev = events.find(e => e.type === 'paymonth' && e.id === pmId(ym)) ?? null, extras = patch.extras ?? prev?.payload.extras ?? [], r = computeMonth({ ...st.args, extras });
    await store.save(makePaymonth({ ym, computed: snap(r), actualNetMinor: patch.actualNetMinor !== undefined ? patch.actualNetMinor : prev?.payload.actualNetMinor ?? null, extras, note: prev?.payload.note ?? '' }, prev));
  }
  async function closeMonth() {
    try { actualErr.textContent = ''; const v = parseMinor(actual.value); actual.value = ''; await savePm({ actualNetMinor: v }); toast('Итог месяца сохранён'); announce('Итог месяца сохранён'); }
    catch (x) { actualErr.textContent = x.message; announce(x.message, { assertive: true }); }
  }
  async function addExtra() {
    try {
      xErr.textContent = ''; const name = xName.value.trim(); if (!name) throw new Error('Назови премию или доплату');
      const x = { name, amountMinor: parseMinor(xAmt.value), taxable: xTax.checked }, prev = st.closed.get(ym);
      xName.value = ''; xAmt.value = ''; await savePm({ extras: [...(prev?.extras ?? []), x] }); announce(`В расчёт добавлено: ${name}`);
    } catch (x) { xErr.textContent = x.message; announce(x.message, { assertive: true }); }
  }
  async function record() {
    try {
      const ev = makeIncome(incomeDraft(st.res, st.pay, todayStr()));
      await store.save(ev); toast(`Записано в доходы: ${money(ev.payload.amountMinor)}`, { actionLabel: 'Отменить', onAction: () => store.remove(ev.id) }); announce('Доход записан');
    } catch (x) { toast(x.message); }
  }

  const noticeBox = el('div', { id: 'sal-notice' }, needSchedule);
  root.append(el('div', { class: 'work-tabs', role: 'group', 'aria-label': 'Разделы зарплаты' }, ...tabBtns), nav, noticeBox, calcBox, hours.root, settings.root, analytics.root);
  function render() {
    st = compute();
    label.textContent = monthLabel(ym);
    for (const b of tabBtns) b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
    const noCfg = !st.cfg, quickMode = tab === 'calc' && !st.pay;                          // нет графика — нечего считать; нет оклада — показываем быстрый ввод
    noticeBox.hidden = !(noCfg && tab !== 'settings' && !quickMode); nav.hidden = tab === 'settings' || quickMode || noCfg;
    calcBox.hidden = tab !== 'calc' || (noCfg && !quickMode); hours.root.hidden = tab !== 'hours' || noCfg; settings.root.hidden = tab !== 'settings'; analytics.root.hidden = tab !== 'analytics' || noCfg;
    if (tab === 'calc') { if (quickMode) fill(calcBox, quick); else if (!noCfg) renderCalc(); }
    else if (tab === 'hours') { if (!noCfg) hours.render(st); }
    else if (tab === 'analytics') { if (!noCfg) analytics.render(st); }
    else settings.render(st);
  }
  // Нет графика: «5 через 2» ставится сам (как на экране «График»), человек только исправляет отличия; календарь праздников подтягивается в фоне.
  let creating = false;
  async function autoDefault() {
    if (creating) return;
    creating = true;
    try { await store.save(autoWorkcfg(todayStr())); announce('Поставил график «5 через 2»: он нужен для расчёта часов. Изменить можно в «Графике».'); }
    catch (e) { console.error(e); } finally { creating = false; }
  }
  async function begin() { if (!cfgOf(events)) await autoDefault(); const c = cfgOf(events); if (c) ensureCalendar(c, { fetchImpl: httpFetch }); }
  addEventListener('lifeos:calendar', () => { if (!root.hidden) render(); });
  return { root, update(evs) { events = evs; if (!root.hidden) render(); }, show() { begin(); render(); } };
}
