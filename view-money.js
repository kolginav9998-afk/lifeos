import { el, toast, dateRu, icon, moneyText, pressable, emptyState } from './ui.js';
import { todayStr } from './events.js';
import { makeEntry, updateExpense, summarizeMonth, shiftMonth, monthLabel, monthOf, categoriesUsed, makeBudget, budgetOf, parseAmount,
  monthTotals, balanceOfMonth, frequentEntries, KINDS, unusualExpense, unusualText } from './money.js';
import { payOf, workHoursText } from './salary.js';
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
  root.append(seg, nav, summary, form, list, empty, el('div', { class: 'row' }, csv));

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
    document.documentElement.classList.toggle('amounts-hidden', !!getPref('hideAmounts'));
  }

  return { root, update(evs) { events = evs; render(); }, focusAdd() { amount.focus(); } };
}
