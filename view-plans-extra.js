// Дополнения к экрану «Планы»: отсрочка покупок на сутки, долги и займы, калькулятор автоматизации.
import { el, fill, toast, dateRu, moneyText } from './ui.js';
import { todayStr } from './events.js';
import * as store from './store.js';
import { parseAmount, monthOf, monthLabel } from './money.js';
import { makeWish, wishesOf, wishState, resolveWish, wishStats, hoursLeft } from './wishes.js';
import { makeDebt, repayDebt, debtLeft, debtsOf, debtTotals, isOverdue, DIRECTIONS } from './debts.js';
import { autoSavings, autoText } from './automation.js';

const ruHours = n => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? 'часов' : b === 1 ? 'час' : b >= 2 && b <= 4 ? 'часа' : 'часов'; };
const STATE_TEXT = { bought: 'нужно было', dropped: 'не понадобилось' };

export function createPlansExtras() {
  let events = [];

  // ---------- хочу купить: подожди сутки ----------
  const wText = el('input', { id: 'wish-text', type: 'text', maxLength: 120, placeholder: 'Что хочется купить?', autocomplete: 'off' });
  const wAmt = el('input', { id: 'wish-amt', type: 'text', inputMode: 'decimal', placeholder: 'Цена, ₽ (по желанию)', autocomplete: 'off' });
  const wErr = el('p', { class: 'error', id: 'wish-err' });
  const wForm = el('form', { class: 'form-stack' }, wText, wAmt, el('button', { type: 'submit', id: 'wish-add', class: 'primary', textContent: 'Отложить на сутки' }), wErr);
  wForm.onsubmit = async e => {
    e.preventDefault();
    try {
      await store.save(makeWish({ text: wText.value, amountMinor: wAmt.value.trim() ? parseAmount(wAmt.value) : null }));
      wText.value = ''; wAmt.value = ''; wErr.textContent = ''; toast('Записано. Вернись к этому через сутки.');
    } catch (x) { wErr.textContent = x.message; }
  };
  const wishCard = el('div', { id: 'wish-card', class: 'card' });
  async function decide(w, status) {
    try {
      const done = resolveWish(w, status);
      await store.save(done);
      toast(status === 'dropped' ? 'Хорошее решение: деньги остались при тебе' : 'Отмечено', { actionLabel: 'Отменить', onAction: () => store.save(w) });
    } catch (x) { toast(x.message); }
  }
  function wishRow(w, now) {
    const st = wishState(w, now), p = w.payload;
    const head = el('div', { class: 'row' }, el('strong', { class: 'grow', textContent: p.text }), el('span', { class: 'muted', textContent: p.amountMinor ? moneyText(p.amountMinor) : '' }));
    const del = el('button', { type: 'button', class: 'chip danger wish-del', 'aria-label': `Удалить: ${p.text}`, textContent: '✕', onclick: async () => { const old = await store.remove(w.id); toast('Удалено', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {}); } });
    if (st === 'wait') {
      const h = hoursLeft(w, now);
      return el('div', { class: 'wish-row wait', dataset: { id: w.id, state: st } }, head, el('div', { class: 'row wrap' }, el('span', { class: 'muted grow', textContent: `Подождём ещё ${h} ${ruHours(h)}` }), del));
    }
    if (st === 'ready') {
      return el('div', { class: 'wish-row ready', dataset: { id: w.id, state: st } }, head, el('p', { class: 'hint', textContent: 'Сутки прошли. Это всё ещё нужно?' }),
        el('div', { class: 'row wrap' },
          el('button', { type: 'button', class: 'chip wish-keep', textContent: 'Да, нужно', onclick: () => decide(w, 'bought') }),
          el('button', { type: 'button', class: 'chip wish-drop', textContent: 'Уже не нужно', onclick: () => decide(w, 'dropped') }), del));
    }
    return el('div', { class: `wish-row done ${st}`, dataset: { id: w.id, state: st } }, head, el('div', { class: 'row wrap' }, el('span', { class: 'muted grow', textContent: `${STATE_TEXT[st]} · ${dateRu(p.resolvedDate || p.date)}` }), del));
  }
  function renderWishes(today) {
    const now = Date.now(), all = wishesOf(events), open = all.filter(w => w.payload.status === 'wait'), closed = all.filter(w => w.payload.status !== 'wait').slice(0, 5);
    const ym = monthOf(today), s = wishStats(events, ym);
    fill(wishCard, el('h3', { textContent: 'Хочу купить: подожди сутки' }),
      el('p', { class: 'muted', textContent: 'Запиши желание вместо покупки. Через 24 часа реши, нужно ли это по-прежнему. Часто желание проходит, а деньги остаются.' }),
      ...open.map(w => wishRow(w, now)), open.length ? null : el('p', { class: 'muted', textContent: 'Сейчас ничего не ждёт решения.' }),
      closed.length ? el('details', { id: 'wish-closed' }, el('summary', { textContent: 'Решённые недавно' }), ...closed.map(w => wishRow(w, now))) : null,
      s.count ? el('p', { id: 'wish-stats', class: 'wish-saved', textContent: `${monthLabel(ym)}: отказов от покупок ${s.count}${s.savedMinor ? `, сохранено ${moneyText(s.savedMinor)}` : ''}` }) : null,
      el('strong', { textContent: 'Новое желание' }), wForm);
  }

  // ---------- долги и займы ----------
  const dWho = el('input', { id: 'debt-who', type: 'text', maxLength: 60, placeholder: 'Кто (имя)', autocomplete: 'off' });
  const dDir = el('select', { id: 'debt-dir', 'aria-label': 'Кто кому должен' }, ...Object.entries(DIRECTIONS).map(([v, t]) => el('option', { value: v, textContent: t })));
  const dAmt = el('input', { id: 'debt-amt', type: 'text', inputMode: 'decimal', placeholder: 'Сумма, ₽', autocomplete: 'off' });
  const dDue = el('input', { id: 'debt-due', type: 'date', 'aria-label': 'Срок возврата (по желанию)' });
  const dNote = el('input', { id: 'debt-note', type: 'text', maxLength: 120, placeholder: 'Комментарий (по желанию)', autocomplete: 'off' });
  const dErr = el('p', { class: 'error', id: 'debt-err' });
  const dForm = el('form', { class: 'form-stack' }, dWho, el('div', { class: 'row wrap' }, dDir, dAmt), el('label', {}, 'Срок (по желанию): ', dDue), dNote,
    el('button', { type: 'submit', id: 'debt-add', class: 'primary', textContent: 'Записать' }), dErr);
  dForm.onsubmit = async e => {
    e.preventDefault();
    try {
      if (!dWho.value.trim()) throw new Error('Укажи, кто это');                // имя проверяем раньше суммы: сообщение понятнее
      await store.save(makeDebt({ who: dWho.value, amountMinor: parseAmount(dAmt.value), direction: dDir.value, due: dDue.value || null, note: dNote.value }));
      dWho.value = ''; dAmt.value = ''; dDue.value = ''; dNote.value = ''; dErr.textContent = ''; toast('Записано');
    } catch (x) { dErr.textContent = x.message; }
  };
  const debtCard = el('div', { id: 'debt-card', class: 'card' });
  function debtRow(d, today) {
    const p = d.payload, left = debtLeft(d), late = isOverdue(d, today);
    const pay = el('input', { type: 'text', inputMode: 'decimal', class: 'debt-pay-amt', placeholder: 'Сумма возврата, ₽', 'aria-label': `Сумма возврата: ${p.who}`, autocomplete: 'off' });
    const repay = async minor => { try { const next = repayDebt(d, minor); await store.save(next); pay.value = ''; toast(next.payload.settled ? 'Долг закрыт' : 'Возврат записан', { actionLabel: 'Отменить', onAction: () => store.save(d) }); } catch (x) { toast(x.message); } };
    const del = el('button', { type: 'button', class: 'chip danger debt-del', 'aria-label': `Удалить: ${p.who}`, textContent: 'Удалить', onclick: async () => { const old = await store.remove(d.id); toast('Удалено', old ? { actionLabel: 'Вернуть', onAction: () => store.save(old) } : {}); } });
    return el('div', { class: `debt-row ${p.direction}${late ? ' late' : ''}${p.settled ? ' done' : ''}`, dataset: { id: d.id, dir: p.direction, state: p.settled ? 'closed' : late ? 'late' : 'open' } },
      el('div', { class: 'row' }, el('strong', { class: 'grow', textContent: p.who }), el('span', { class: 'muted', textContent: DIRECTIONS[p.direction] })),
      el('div', { class: 'muted', textContent: p.settled ? `Закрыт ${dateRu(p.settledDate || p.date)} · ${moneyText(p.amountMinor)}` : `Осталось ${moneyText(left)} из ${moneyText(p.amountMinor)}${p.due ? ` · срок ${dateRu(p.due)}` : ''}` }),
      late ? el('p', { class: 'warn debt-late', textContent: 'Срок прошёл. Напомни или договорись о новом сроке.' }) : null,
      p.note ? el('div', { class: 'muted', textContent: p.note }) : null,
      p.settled ? el('div', { class: 'row wrap' }, del) : el('div', { class: 'row wrap' }, pay,
        el('button', { type: 'button', class: 'chip debt-part', textContent: 'Внести возврат', onclick: () => { try { repay(parseAmount(pay.value)); } catch (x) { toast(x.message); } } }),
        el('button', { type: 'button', class: 'chip debt-all', textContent: 'Закрыть полностью', onclick: () => repay(left) }), del));
  }
  function renderDebts(today) {
    const all = debtsOf(events), open = all.filter(d => !d.payload.settled), closed = all.filter(d => d.payload.settled);
    const t = debtTotals(events, today);
    fill(debtCard, el('h3', { textContent: 'Долги и займы' }),
      t.open ? el('p', { id: 'debt-totals', textContent: `Мне должны: ${moneyText(t.owedToMe)} · Я должен: ${moneyText(t.iOwe)}` }) : el('p', { class: 'muted', textContent: 'Кто кому должен и когда вернуть. Возврат можно вносить частями.' }),
      ...open.map(d => debtRow(d, today)),
      closed.length ? el('details', { id: 'debt-closed' }, el('summary', { textContent: `Закрытые (${closed.length})` }), ...closed.map(d => debtRow(d, today))) : null,
      el('strong', { textContent: 'Новая запись' }), dForm);
  }

  // ---------- калькулятор автоматизации (ничего не сохраняет) ----------
  const aIn = {
    minutes: el('input', { id: 'auto-min', type: 'text', inputMode: 'decimal', placeholder: 'Минут на одну операцию', autocomplete: 'off', 'aria-label': 'Минут на одну операцию' }),
    perWeek: el('input', { id: 'auto-week', type: 'text', inputMode: 'decimal', placeholder: 'Сколько раз в неделю', autocomplete: 'off', 'aria-label': 'Сколько раз в неделю' }),
    people: el('input', { id: 'auto-people', type: 'text', inputMode: 'numeric', placeholder: 'Сколько человек (1)', autocomplete: 'off', 'aria-label': 'Сколько человек это делают' }),
    buildHours: el('input', { id: 'auto-build', type: 'text', inputMode: 'decimal', placeholder: 'Часов на настройку', autocomplete: 'off', 'aria-label': 'Часов на настройку автоматизации' }),
    hourlyRate: el('input', { id: 'auto-rate', type: 'text', inputMode: 'decimal', placeholder: 'Стоимость часа, ₽ (по желанию)', autocomplete: 'off', 'aria-label': 'Стоимость часа в рублях' }),
  };
  const aOut = el('p', { id: 'auto-result', class: 'hint', 'aria-live': 'polite' });
  function calc() {
    if (!aIn.minutes.value.trim() && !aIn.perWeek.value.trim()) { aOut.textContent = 'Заполни первые два поля: результат появится сразу.'; aOut.className = 'muted'; return; }
    try {
      const r = autoSavings({ minutes: aIn.minutes.value, perWeek: aIn.perWeek.value, people: aIn.people.value.trim() || 1, buildHours: aIn.buildHours.value.trim() || 0, hourlyRate: aIn.hourlyRate.value.trim() || 0 });
      aOut.textContent = autoText(r); aOut.className = 'hint';
    } catch (x) { aOut.textContent = x.message; aOut.className = 'error'; }
  }
  for (const i of Object.values(aIn)) i.addEventListener('input', calc);
  const autoCard = el('details', { id: 'auto-card', class: 'card' }, el('summary', { textContent: 'Калькулятор автоматизации' }),
    el('p', { class: 'muted', textContent: 'Стоит ли автоматизировать повторяющуюся операцию? Сколько времени и денег это сэкономит и когда окупится настройка. Ничего не сохраняется.' }),
    el('div', { class: 'form-stack' }, aIn.minutes, aIn.perWeek, aIn.people, aIn.buildHours, aIn.hourlyRate), aOut);
  calc();

  const root = el('div', { id: 'plan-extras', class: 'stack' }, wishCard, debtCard, autoCard);
  function render() { const today = todayStr(); renderWishes(today); renderDebts(today); }
  render();
  return { root, update(evs) { events = evs; render(); } };
}
