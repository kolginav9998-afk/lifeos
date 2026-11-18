import { el, fill, toast, dateRu, icon, moneyText, pressable, emptyState } from './ui.js';
import { todayStr } from './events.js';
import { makeEntry, updateExpense, summarizeMonth, shiftMonth, monthLabel, monthOf, categoriesUsed, makeBudget, budgetOf, parseAmount,
  monthTotals, balanceOfMonth, frequentEntries, KINDS, unusualExpense, unusualText,
  noSpendDates, noSpendStreak, bestNoSpendWeek, refusalSavings, REFUSAL_TAG, wishDrafts, expenseFromWish, saleIncomeDraft,
  wearRating, subAuditList, auditComplete, cancelCandidates, salaryChecklist } from './money.js';
import { payOf, workHoursText, plural } from './salary.js';
import { subsOf, monthlyCost, goalProgress, makeGoalMove } from './planning.js';
import { homeModel } from './home.js';
import { getPref, setPref } from './prefs.js';
import * as store from './store.js';

export function createMoneyView({ exportCsv }) {
  let events = [];
  let ym = monthOf(todayStr());
  let kind = 'expense';                  // что показываем: расходы или доходы
  let editing = null;                    // запись, которая сейчас правится

  const root = el('section', { id: 'view-money', class: 'view' });
  const K = () => KINDS[kind];

  // ----- переключатель и месяц -----
  const kindBtn = (id, key, text) => el('button', { type: 'button', id, class: 'seg', textContent: text, onclick: () => { kind = key; stopEdit(); render(); } });
  const segExp = kindBtn('kind-expense', 'expense', 'Расходы');
  const segInc = kindBtn('kind-income', 'income', 'Доходы');
  const seg = el('div', { class: 'seg-group', role: 'group', 'aria-label': 'Что показывать' }, segExp, segInc);

  const label = el('strong', { id: 'month-label', class: 'month-label' });
  const prev = el('button', { type: 'button', id: 'month-prev', 'aria-label': 'Прошлый месяц', onclick: () => { ym = shiftMonth(ym, -1); render(); } }, icon('chevL', 20));
  const next = el('button', { type: 'button', id: 'month-next', 'aria-label': 'Следующий месяц', onclick: () => { ym = shiftMonth(ym, 1); render(); } }, icon('chevR', 20));
  const eye = el('button', { type: 'button', id: 'hide-amounts', 'aria-label': 'Скрыть или показать суммы', title: 'Скрыть/показать суммы', onclick: () => { setPref('hideAmounts', !getPref('hideAmounts')); render(); } }, icon('eye', 20));
  const nav = el('div', { class: 'month-nav' }, prev, label, next, eye);

  // ----- сводка -----
  const caption = el('div', { id: 'kind-caption', class: 'muted' });
  const total = el('div', { id: 'month-total', class: 'big' });
  const balanceLine = el('div', { id: 'balance-line', class: 'muted' });
  const budgetLine = el('div', { id: 'budget-line', class: 'muted' });
  const budgetBar = el('div', { class: 'progress', hidden: true }, el('span'));
  const budgetInput = el('input', { id: 'budget-input', type: 'text', inputMode: 'decimal', placeholder: 'Бюджет на месяц, ₽', autocomplete: 'off' });
  const budgetForm = el('form', { id: 'budget-form', class: 'row', hidden: true }, budgetInput,
    el('button', { type: 'submit', class: 'primary', textContent: 'Сохранить' }),
    el('button', { type: 'button', textContent: 'Убрать', onclick: async () => { await store.save(makeBudget(null)); budgetForm.hidden = true; } }));
  budgetForm.onsubmit = async e => {
    e.preventDefault();
    try { await store.save(makeBudget(parseAmount(budgetInput.value))); budgetForm.hidden = true; budgetInput.value = ''; }
    catch (err) { toast(err.message); }
  };
  const budgetBtn = el('button', { type: 'button', id: 'budget-btn', class: 'link', textContent: 'Бюджет', 'aria-expanded': 'false', onclick: () => { budgetForm.hidden = !budgetForm.hidden; budgetBtn.setAttribute('aria-expanded', String(!budgetForm.hidden)); if (!budgetForm.hidden) budgetInput.focus(); } });
  const budgetRow = el('div', { class: 'row' }, budgetBtn);
  const cats = el('div', { id: 'cats', class: 'cats' });
  const chart = el('div', { id: 'month-chart', class: 'bars' });
  const summary = el('div', { class: 'card' }, caption, total, balanceLine, budgetLine, budgetBar, budgetRow, budgetForm, cats,
    el('p', { class: 'muted chart-title', textContent: 'Последние 6 месяцев' }), chart);

  // ----- форма -----
  const amount = el('input', { id: 'exp-amount', type: 'text', inputMode: 'decimal', placeholder: 'Сумма, например 1250,50', autocomplete: 'off', required: true });
  const hoursHint = el('p', { id: 'exp-hours', class: 'muted', 'aria-live': 'polite' });   // цена в часах работы, пока вводишь сумму
  amount.addEventListener('input', () => {
    let text = null;
    if (kind === 'expense' && !getPref('hideAmounts')) { try { text = workHoursText(parseAmount(amount.value), payOf(events)); } catch { text = null; } }
    hoursHint.textContent = text ?? '';
  });
  const category = el('input', { id: 'exp-category', type: 'text', placeholder: 'Категория', maxLength: 40, autocomplete: 'off' });
  category.setAttribute('list', 'exp-cats');
  const catList = el('datalist', { id: 'exp-cats' });
  const note = el('input', { id: 'exp-note', type: 'text', placeholder: 'Комментарий (необязательно)', maxLength: 200, autocomplete: 'off' });
  const date = el('input', { id: 'exp-date', type: 'date', value: todayStr(), 'aria-label': 'Дата' });
  const formTitle = el('strong');
  const submit = el('button', { type: 'submit', class: 'primary' });
  const cancel = el('button', { type: 'button', class: 'cancel', textContent: 'Отмена', hidden: true, onclick: () => { stopEdit(); render(); } });
  const quick = el('div', { id: 'quick-exp', class: 'chips', hidden: true });
  const form = el('form', { id: 'exp-form', class: 'card form-stack' }, formTitle, quick, amount, hoursHint, el('div', { class: 'two' }, category, date), catList, note, el('div', { class: 'row' }, submit, cancel));

  function resetForm() { amount.value = ''; note.value = ''; category.value = ''; date.value = todayStr(); hoursHint.textContent = ''; }
  function setFormLabels() {
    formTitle.textContent = editing ? `Изменить ${K().label.toLowerCase()}` : `Новый ${K().label.toLowerCase()}`;
    submit.textContent = editing ? 'Сохранить' : 'Добавить';
    cancel.hidden = !editing;
  }
  function stopEdit() { editing = null; resetForm(); }
  function startEdit(ev) {
    editing = ev;
    amount.value = String(ev.payload.amountMinor / 100).replace('.', ',');
    category.value = ev.payload.category; note.value = ev.payload.note; date.value = ev.payload.date;
    setFormLabels();
    form.scrollIntoView?.({ block: 'center' }); amount.focus();
  }
  form.onsubmit = async e => {
    e.preventDefault();
    try {
      const fields = { amount: amount.value, category: category.value, note: note.value, date: date.value };
      if (editing) await store.save(updateExpense(editing, fields));
      else {
        const ev = makeEntry(kind, fields);
        await store.save(ev);
        const odd = ev.type === 'expense' ? unusualExpense(events, ev) : null;      // мягкое предупреждение о возможной опечатке
        if (odd) toast(unusualText(odd, ev.payload.category), { actionLabel: 'Отменить', onAction: () => store.remove(ev.id) });
      }
      const month = monthOf(fields.date || todayStr());
      stopEdit();
      if (month !== ym) ym = month;
      render();
    } catch (err) { toast(err.message); }
  };

  const list = el('ul', { id: 'exp-list', class: 'list' });
  const empty = emptyState({ art: 'money', title: 'Пока без записей', text: 'Здесь будут траты и доходы месяца, а выше — сумма и график. Добавь первую запись: сумма, категория и дата.', action: { label: 'Добавить', icon: 'plus', onClick: () => amount.focus() } });
  empty.hidden = true;
  const csv = el('button', { type: 'button', id: 'csv-btn', textContent: 'Скачать таблицу для Excel (CSV)', onclick: () => exportCsv() });

  // ----- связки: зарплатный ритуал, дни без трат, отказы, покупки, вещи, подписки -----
  const ritualCard = el('div', { id: 'payday-ritual', class: 'card calm', hidden: true });
  const nospendCard = el('div', { id: 'nospend', class: 'card', hidden: true });
  const refusalCard = el('div', { id: 'refusals', class: 'card', hidden: true });
  const draftsCard = el('div', { id: 'wish-drafts', class: 'card', hidden: true });
  const soldCard = el('div', { id: 'sold-items', class: 'card', hidden: true });
  const auditCard = el('div', { id: 'sub-audit', class: 'card', hidden: true });
  const wearCard = el('div', { id: 'wear-rating', class: 'card', hidden: true });

  // Зарплатный ритуал: в день выплаты (salaryDay из настроек) — чек-лист распределения дохода.
  function renderRitual(today) {
    const r = salaryChecklist(events, today, payOf(events));
    ritualCard.hidden = !r.due || getPref('salaryRitualDone') === today;
    if (ritualCard.hidden) return;
    fill(ritualCard,
      el('h3', { textContent: 'Зарплата пришла' }),
      el('p', { class: 'muted', textContent: 'Минутка спокойствия: распределить доход по местам.' }),
      ...r.items.map(i => el('p', { class: 'muted ritual-item', textContent: `${i.done ? '✓' : '○'} ${i.text}` })),
      el('button', { type: 'button', class: 'chip', id: 'ritual-done', textContent: r.done === r.items.length ? 'Всё распределено' : 'Разобрались на сегодня', onclick: () => { setPref('salaryRitualDone', today); render(); } }));
  }

  // День без трат: автоопределение по журналу расходов, серия и лучшая неделя месяца.
  function renderNoSpend(today) {
    const has = events.some(e => e.type === 'expense');
    nospendCard.hidden = kind !== 'expense' || !has;
    if (nospendCard.hidden) return;
    const cur = ym === monthOf(today), until = cur ? today : `${ym}-31`;
    const count = noSpendDates(events, ym, until).length, bw = bestNoSpendWeek(events, ym, until);
    fill(nospendCard, el('h3', { textContent: 'Дни без трат' }),
      el('p', { class: 'muted', textContent: `За ${monthLabel(ym).toLowerCase()}: ${count} дн. без трат`
        + (cur ? ` · серия ${noSpendStreak(events, today)} дн.` : '')
        + (bw ? ` · лучшая неделя ${dateRu(bw.from)}–${dateRu(bw.to)}: ${bw.count} из 7` : '') }));
  }

  // Отказы с ценой: сэкономлено на передуманных покупках за месяц и кнопка «в копилку».
  function renderRefusals(today) {
    const r = refusalSavings(events, ym);
    refusalCard.hidden = kind !== 'expense' || r.savedMinor <= 0;
    if (refusalCard.hidden) return;
    const openGoal = goalProgress(events, today).find(g => !g.done);
    fill(refusalCard, el('h3', { textContent: 'Отказы с выгодой' }),
      el('p', { class: 'muted', textContent: `За ${monthLabel(ym).toLowerCase()} не куплено лишнего на ${moneyText(r.savedMinor)} (${r.count} ${plural(r.count, 'отказ', 'отказа', 'отказов')})`
        + (r.movedMinor ? ` · в копилке уже ${moneyText(r.movedMinor)}` : '') }),
      r.dueMinor > 0 && ym === monthOf(today) ? el('button', { type: 'button', class: 'chip', id: 'refusal-piggy', textContent: `В копилку ${moneyText(r.dueMinor)}`, onclick: async () => {
        if (!openGoal) { toast('Сначала создай копилку на экране «Планы»'); return; }
        await store.save(makeGoalMove(openGoal.goal.id, r.dueMinor, { note: REFUSAL_TAG }));
        toast(`В копилку «${openGoal.goal.payload.title}»: ${moneyText(r.dueMinor)}`);
      } }) : null);
  }

  // Список покупок → расход: отмеченная купленной отложенная покупка становится готовым черновиком расхода.
  function renderDrafts() {
    const drafts = kind === 'expense' ? wishDrafts(events) : [];
    draftsCard.hidden = drafts.length === 0;
    if (!drafts.length) return;
    fill(draftsCard, el('h3', { textContent: 'Купленное из отложенного' }),
      el('p', { class: 'muted', textContent: 'Покупка состоялась — запиши расход, сумма уже подставлена.' }),
      ...drafts.slice(0, 5).map(w => el('div', { class: 'row wish-draft', dataset: { id: w.id } },
        el('span', { class: 'grow', textContent: `${w.payload.text} · ${moneyText(w.payload.amountMinor)}` }),
        el('button', { type: 'button', class: 'chip wish-expense', textContent: 'Записать расход', onclick: async () => {
          try {
            const ev = expenseFromWish(w);
            await store.save(ev);
            toast(`Записано: ${moneyText(ev.payload.amountMinor)}`, { actionLabel: 'Отменить', onAction: () => store.remove(ev.id) });
          } catch (x) { toast(x.message); }
        } }))));
  }

  // Продал вещь → доход: вещи со статусом «продано» и ценой, по которым ещё нет дохода.
  function renderSold(today) {
    const linked = new Set(events.filter(e => e.type === 'income' && e.payload.itemId).map(e => e.payload.itemId));
    const rows = kind === 'income' ? homeModel(events, today).items.filter(i => i.payload.status === 'sold' && i.payload.priceMinor > 0 && !linked.has(i.id)) : [];
    soldCard.hidden = rows.length === 0;
    if (!rows.length) return;
    fill(soldCard, el('h3', { textContent: 'Проданные вещи' }),
      el('p', { class: 'muted', textContent: 'Вещь продана — запиши доход, цена подставлена из карточки вещи.' }),
      ...rows.slice(0, 5).map(i => el('div', { class: 'row sold-draft', dataset: { id: i.id } },
        el('span', { class: 'grow', textContent: `${i.payload.name} · ${moneyText(i.payload.priceMinor)}` }),
        el('button', { type: 'button', class: 'chip sold-income', textContent: 'Записать доход', onclick: async () => {
          try {
            const d = saleIncomeDraft({ name: i.payload.name, priceMinor: i.payload.priceMinor }, today);
            const ev = makeEntry('income', d);
            await store.save({ ...ev, payload: { ...ev.payload, itemId: i.id } });
            toast(`Записано: ${moneyText(ev.payload.amountMinor)}`, { actionLabel: 'Отменить', onAction: () => store.remove(ev.id) });
          } catch (x) { toast(x.message); }
        } }))));
  }

  // Аудит подписок по факту: раз в месяц вопрос «пользуешься?» по каждой активной подписке.
  function renderAudit(today) {
    const ymNow = monthOf(today);
    const subs = subsOf(events).filter(s => s.payload.active).map(s => ({ id: s.id, name: s.payload.name, monthlyMinor: monthlyCost(s.payload) }));
    auditCard.hidden = subs.length === 0;
    if (!subs.length) return;
    const saved = getPref('subAudit');
    const answers = saved && saved.ym === ymNow && saved.answers && typeof saved.answers === 'object' ? saved.answers : {};
    const answer = (id, v) => { setPref('subAudit', { ym: ymNow, answers: { ...answers, [id]: v } }); render(); };
    if (auditComplete(subs, answers)) {
      const cand = cancelCandidates(subs, answers);
      auditCard.hidden = cand.length === 0;
      if (!cand.length) return;
      const yearly = cand.reduce((s, c) => s + c.monthlyMinor * 12, 0);
      fill(auditCard, el('h3', { textContent: 'Аудит подписок' }),
        el('p', { class: 'muted', textContent: `Кандидаты на отмену: ${cand.map(c => c.name).join(', ')} — за год это ${moneyText(yearly)}. Подписки живут на экране «Планы».` }));
      return;
    }
    fill(auditCard, el('h3', { textContent: 'Аудит подписок: пользуешься?' }),
      el('p', { class: 'muted', textContent: 'Раз в месяц честно отмечаем, чем реально пользуемся.' }),
      ...subAuditList(subs, answers).map(s => el('div', { class: 'row audit-row', dataset: { id: s.id } },
        el('span', { class: 'grow', textContent: `${s.name} · ${moneyText(s.monthlyMinor)}/мес` }),
        s.verdict ? el('span', { class: 'muted audit-verdict', textContent: s.verdict === 'use' ? 'пользуюсь' : 'не пользуюсь' }) : null,
        el('button', { type: 'button', class: 'chip audit-use', textContent: 'Пользуюсь', onclick: () => answer(s.id, 'use') }),
        el('button', { type: 'button', class: 'chip audit-cancel', textContent: 'Не пользуюсь', onclick: () => answer(s.id, 'cancel') }))));
  }

  // Цена одного надевания: выгодные вещи (часто носят) и «мёртвые» (куплены и лежат).
  function renderWear(today) {
    const m = homeModel(events, today);
    const rows = m.items.filter(i => i.payload.status !== 'gone' && i.payload.priceMinor > 0)
      .map(i => ({ name: i.payload.name, priceMinor: i.payload.priceMinor, wears: m.stats.get(i.id).wears }));
    const r = wearRating(rows);
    wearCard.hidden = !r.worth.length && !r.dead.length;
    if (wearCard.hidden) return;
    fill(wearCard, el('h3', { textContent: 'Цена одного надевания' }),
      r.worth.length ? el('p', { class: 'muted wear-worth', textContent: 'Выгодные: ' + r.worth.map(x => `${x.name} — ${moneyText(x.costPerWear)} за раз`).join('; ') }) : null,
      r.dead.length ? el('p', { class: 'muted wear-dead', textContent: 'Лежат без дела: ' + r.dead.map(x => `${x.name} (${moneyText(x.priceMinor)}, ни разу)`).join('; ') }) : null);
  }

  root.append(seg, nav, ritualCard, summary, form, nospendCard, refusalCard, draftsCard, soldCard, auditCard, wearCard, list, empty, el('div', { class: 'row' }, csv));

  async function remove(ev) {
    const old = await store.remove(ev.id);
    if (editing && editing.id === ev.id) { stopEdit(); render(); }
    if (old) toast(`${K().label} удалён`, { actionLabel: 'Отменить', onAction: () => store.save(old) });
  }

  async function addQuick(f) {
    const ev = makeEntry(kind, { amount: f.amountMinor, category: f.category });
    await store.save(ev);
    toast(`Добавлено: ${f.category} ${moneyText(f.amountMinor)}`, { actionLabel: 'Отменить', onAction: () => store.remove(ev.id) });
  }

  function render() {
    const today = todayStr();
    const s = summarizeMonth(events, ym, kind);
    const pay = payOf(events);
    const isExp = kind === 'expense';
    segExp.setAttribute('aria-pressed', String(isExp)); segInc.setAttribute('aria-pressed', String(!isExp));
    label.textContent = monthLabel(ym);
    caption.textContent = isExp ? 'Расходы за месяц' : 'Доходы за месяц';
    total.textContent = moneyText(s.total);
    const b = balanceOfMonth(events, ym);
    balanceLine.textContent = b.income || b.expense ? `Доходы ${moneyText(b.income)} · Расходы ${moneyText(b.expense)} · Баланс ${b.balance < 0 ? '−' : '+'}${moneyText(Math.abs(b.balance))}` : '';
    // бюджет — только для расходов
    const budget = isExp ? budgetOf(events) : null;
    budgetRow.hidden = !isExp; if (!isExp) budgetForm.hidden = true;
    budgetLine.hidden = !isExp;
    if (budget) {
      const left = budget - s.total;
      // остаток бюджета — число-герой экрана: крупная цифра с градиентом (стили — в блоке polish)
      budgetLine.replaceChildren(
        document.createTextNode(`Бюджет ${moneyText(budget)} · ${left >= 0 ? 'осталось ' : 'превышен на '}`),
        el('strong', { class: 'budget-left', textContent: moneyText(Math.abs(left)) }));
      budgetBar.hidden = false;
      budgetBar.classList.toggle('over', left < 0);
      budgetBar.firstChild.style.setProperty('--w', Math.min(100, Math.round((s.total / budget) * 100)) + '%');
    } else { budgetLine.textContent = isExp && ym === monthOf(todayStr()) ? 'Бюджет не задан' : ''; budgetBar.hidden = true; }

    cats.replaceChildren(...s.byCategory.map(c => {
      const bar = el('div', { class: 'cat' },
        el('div', { class: 'cat-row' }, el('span', { textContent: c.category }), el('span', { class: 'muted', textContent: `${moneyText(c.total)} · ${Math.round(c.share * 100)}%` })),
        el('div', { class: 'progress thin' }, el('span')));
      bar.querySelector('.progress span').style.setProperty('--w', Math.round(c.share * 100) + '%');
      return bar;
    }));

    const mt = monthTotals(events, ym, 6, kind);
    const maxT = Math.max(1, ...mt.map(x => x.total));
    const compact = minor => { const r = minor / 100; return r >= 1000 ? `${Math.round(r / 100) / 10}к`.replace('.', ',') : String(Math.round(r)); };
    chart.replaceChildren(...mt.map(x => {
      const col = el('div', { class: 'bar-col' + (x.ym === ym ? ' current' : ''), title: `${monthLabel(x.ym)}: ${moneyText(x.total)}` },
        el('span', { class: 'bar-fill' }), el('span', { class: 'bar-n', textContent: getPref('hideAmounts') ? '•' : compact(x.total) }),
        el('span', { class: 'bar-d', textContent: monthLabel(x.ym).slice(0, 3).toLowerCase() }));
      col.firstChild.style.setProperty('--h', Math.round((x.total / maxT) * 100) + '%');
      return col;
    }));

    catList.replaceChildren(...categoriesUsed(events, kind).map(c => el('option', { value: c })));
    const freq = editing ? [] : frequentEntries(events, kind);
    quick.hidden = freq.length === 0;
    quick.replaceChildren(...freq.map(f => el('button', { type: 'button', class: 'chip quick', textContent: `${f.category} ${moneyText(f.amountMinor)}`, onclick: () => addQuick(f) })));
    setFormLabels();

    list.replaceChildren(...s.items.map(ev => {
      const p = ev.payload;
      const body = pressable(el('div', { class: 'body' },
        el('span', { class: 'text', textContent: p.category + (p.note ? ' — ' + p.note : '') }),
        el('span', { class: 'meta', textContent: dateRu(p.date) })), () => startEdit(ev));
      const amt = el('strong', { class: 'amount' + (isExp ? '' : ' plus'), textContent: (isExp ? '' : '+') + moneyText(p.amountMinor) });
      const hours = isExp && !getPref('hideAmounts') ? workHoursText(p.amountMinor, pay) : '';   // мелкая подпись у суммы, только если настройка зарплаты заполнена
      return el('li', { class: 'item exp' }, body,
        hours ? el('div', { class: 'amount-col' }, amt, el('span', { class: 'amount-hours', textContent: hours })) : amt,
        el('button', { class: 'del', type: 'button', 'aria-label': `Удалить ${K().label.toLowerCase()}`, onclick: () => remove(ev) }, icon('x', 18)));
    }));
    empty.hidden = s.items.length > 0;
    empty.msg.textContent = isExp ? 'В этом месяце расходов нет' : 'В этом месяце доходов нет';
    renderRitual(today); renderNoSpend(today); renderRefusals(today); renderDrafts(); renderSold(today); renderAudit(today); renderWear(today);
    document.documentElement.classList.toggle('amounts-hidden', !!getPref('hideAmounts'));
  }

  return { root, update(evs) { events = evs; render(); }, focusAdd() { amount.focus(); } };
}
