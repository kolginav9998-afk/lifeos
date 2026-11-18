// Расходы. Суммы — целые копейки (никаких дробных чисел), валюта пока одна — рубль.
import { todayStr, isYmd, newId, addDays } from './events.js';

export const DEFAULT_CATEGORIES = ['Жильё', 'Еда', 'Транспорт', 'Здоровье', 'Связь', 'Подписки', 'Одежда', 'Развлечения', 'Образование', 'Другое'];
export const INCOME_CATEGORIES = ['Зарплата', 'Подработка', 'Подарок', 'Возврат', 'Другое'];
export const KINDS = {
  expense: { label: 'Расход', plural: 'Расходы', categories: DEFAULT_CATEGORIES },
  income: { label: 'Доход', plural: 'Доходы', categories: INCOME_CATEGORIES },
};
export const MAX_MINOR = 100_000_000_000;       // 1 млрд ₽ — разумный предел против опечаток
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const clean = (s, n) => String(s ?? '').trim().slice(0, n);

export function parseAmount(input) {
  const s = String(input ?? '').replace(/[\s  ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error('Сумма: например 1250 или 1250,50');
  const [r, k = ''] = s.split('.');
  const minor = Number(r) * 100 + Number((k + '00').slice(0, 2));
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error('Сумма должна быть больше нуля');
  if (minor > MAX_MINOR) throw new Error('Слишком большая сумма');
  return minor;
}

export function formatMoney(minor) {
  const neg = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const rub = Math.trunc(abs / 100), kop = abs % 100;
  const rs = String(rub).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${neg}${rs}${kop ? ',' + String(kop).padStart(2, '0') : ''} ₽`;
}

export function makeEntry(type, { amount, category, note = '', date }, now = Date.now()) {
  if (!KINDS[type]) throw new Error('bad kind');
  const amountMinor = typeof amount === 'number' ? amount : parseAmount(amount);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > MAX_MINOR) throw new Error('Сумма вне допустимых пределов');
  const d = date || todayStr(now);
  if (!isYmd(d)) throw new Error('bad date');
  return {
    id: newId(), type, ts: now,
    payload: { amountMinor, currency: 'RUB', category: clean(category, 40) || 'Другое', note: clean(note, 200), date: d },
    source: 'manual', confidence: 1, evidence: [],
  };
}
export const makeExpense = (fields, now) => makeEntry('expense', fields, now);
export const makeIncome = (fields, now) => makeEntry('income', fields, now);
// Правка расхода или дохода: тип записи сохраняется.
export function updateExpense(ev, fields, now = Date.now()) {
  const n = makeEntry(ev.type === 'income' ? 'income' : 'expense', { amount: fields.amount, category: fields.category, note: fields.note, date: fields.date || ev.payload.date }, now);
  return { ...ev, payload: { ...n.payload, editedAt: now } };
}

export const monthOf = date => date.slice(0, 7);
export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
export function monthLabel(ym) { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; }

export function summarizeMonth(events, ym, type = 'expense') {
  const items = events.filter(e => e.type === type && monthOf(e.payload.date) === ym)
    .sort((a, b) => b.payload.date.localeCompare(a.payload.date) || b.ts - a.ts);
  const total = items.reduce((s, e) => s + e.payload.amountMinor, 0);
  const map = new Map();
  for (const e of items) map.set(e.payload.category, (map.get(e.payload.category) || 0) + e.payload.amountMinor);
  const byCategory = [...map].map(([category, sum]) => ({ category, total: sum, share: total ? sum / total : 0 }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
  return { ym, items, total, count: items.length, byCategory };
}

export function monthTotals(events, endYm, n = 6, type = 'expense') {   // последние n месяцев, старые -> новые
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const ym = shiftMonth(endYm, -i);
    out.push({ ym, total: events.filter(e => e.type === type && monthOf(e.payload.date) === ym).reduce((s, e) => s + e.payload.amountMinor, 0) });
  }
  return out;
}

export function sumBetween(events, type, fromDate, toDate) {   // включительно
  return events.filter(e => e.type === type && e.payload.date >= fromDate && e.payload.date <= toDate)
    .reduce((s, e) => s + e.payload.amountMinor, 0);
}
export const spentBetween = (events, fromDate, toDate) => sumBetween(events, 'expense', fromDate, toDate);

export function balanceOfMonth(events, ym) {
  const income = summarizeMonth(events, ym, 'income').total, expense = summarizeMonth(events, ym, 'expense').total;
  return { income, expense, balance: income - expense };
}

// Частые пары «категория + сумма» — для повторения одним нажатием.
export function frequentEntries(events, type = 'expense', n = 4, minCount = 2) {
  const map = new Map();
  for (const e of events) {
    if (e.type !== type) continue;
    const key = `${e.payload.category}|${e.payload.amountMinor}`;
    const cur = map.get(key) || { category: e.payload.category, amountMinor: e.payload.amountMinor, count: 0, last: 0 };
    cur.count++; cur.last = Math.max(cur.last, e.ts);
    map.set(key, cur);
  }
  return [...map.values()].filter(x => x.count >= minCount).sort((a, b) => b.count - a.count || b.last - a.last).slice(0, n);
}

export function categoriesUsed(events, type = 'expense') {
  const cnt = new Map();
  for (const e of events) if (e.type === type) cnt.set(e.payload.category, (cnt.get(e.payload.category) || 0) + 1);
  const used = [...cnt].sort((a, b) => b[1] - a[1]).map(x => x[0]);
  return [...used, ...KINDS[type].categories.filter(c => !cnt.has(c))];
}

// Бюджет месяца — одна запись.
export const BUDGET_ID = 'budget';
export function makeBudget(amountMinor, now = Date.now()) {
  if (amountMinor !== null && (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > MAX_MINOR)) throw new Error('bad budget');
  return { id: BUDGET_ID, type: 'budget', ts: now, payload: { amountMinor }, source: 'manual', confidence: 1, evidence: [] };
}
export const budgetOf = events => events.find(e => e.type === 'budget' && e.id === BUDGET_ID)?.payload.amountMinor ?? null;

// CSV для Excel: разделитель «;», BOM, защита от формул (=, +, -, @ в начале ячейки).
export function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function moneyToCsv(events) {
  const rows = events.filter(e => e.type === 'expense' || e.type === 'income')
    .sort((a, b) => a.payload.date.localeCompare(b.payload.date) || a.ts - b.ts);
  const lines = [['Тип', 'Дата', 'Сумма', 'Категория', 'Комментарий'].join(';')];
  for (const e of rows) {
    const p = e.payload;
    lines.push([KINDS[e.type].label, p.date, (p.amountMinor / 100).toFixed(2).replace('.', ','), p.category, p.note].map(csvCell).join(';'));
  }
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}
export const expensesToCsv = moneyToCsv;

// Необычно крупная трата: сумма сильно выше обычной для категории (медиана за 90 дней, не меньше пяти прежних трат).
// Возвращает {median, count} или null. Только предупреждение, ничего не блокирует.
export function unusualExpense(events, expense, { days = 90, minCount = 5 } = {}) {
  const p = expense.payload, from = new Date(`${p.date}T12:00:00`).getTime() - days * 86400000;
  const prev = events.filter(e => e.type === 'expense' && e.id !== expense.id && e.payload.category === p.category && new Date(`${e.payload.date}T12:00:00`).getTime() >= from && e.payload.date <= p.date).map(e => e.payload.amountMinor).sort((a, b) => a - b);
  if (prev.length < minCount) return null;
  const mid = Math.floor(prev.length / 2), median = prev.length % 2 ? prev[mid] : Math.round((prev[mid - 1] + prev[mid]) / 2);
  return p.amountMinor >= Math.max(median * 3, median + 10000, 50000) ? { median, count: prev.length } : null;
}
export const unusualText = (u, category) => `Это заметно больше обычного для «${category}» (обычно около ${formatMoney(u.median)}). Если это опечатка, отмени запись.`;

// ---------- день без трат ----------
// Спокойный день — день без единой записи расхода. Будущие дни месяца не считаем: until — крайняя учитываемая дата.
export function noSpendDates(events, ym, until = null) {
  const spent = new Set(events.filter(e => e.type === 'expense' && monthOf(e.payload.date) === ym).map(e => e.payload.date));
  const dim = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0).getDate();
  const out = [];
  for (let d = 1; d <= dim; d++) {
    const date = `${ym}-${String(d).padStart(2, '0')}`;
    if (until && date > until) break;
    if (!spent.has(date)) out.push(date);
  }
  return out;
}
// Серия спокойных дней подряд, включая сегодня. До первой записанной траты не углубляемся — прошлое без журнала не считаем.
export function noSpendStreak(events, today) {
  const dates = events.filter(e => e.type === 'expense').map(e => e.payload.date).sort();
  if (!dates.length) return 0;
  const spent = new Set(dates), first = dates[0];
  let cursor = today, n = 0;
  while (cursor >= first && !spent.has(cursor)) { n++; cursor = addDays(cursor, -1); }
  return n;
}
// Лучшая неделя месяца: 7 дней подряд с наибольшим числом дней без трат (окно целиком не позже until).
export function bestNoSpendWeek(events, ym, until = null) {
  const free = new Set(noSpendDates(events, ym, until));
  const dim = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0).getDate();
  let best = null;
  for (let d = 1; d + 6 <= dim; d++) {
    const from = `${ym}-${String(d).padStart(2, '0')}`, to = addDays(from, 6);
    if (until && to > until) break;
    let count = 0;
    for (let x = from; x <= to; x = addDays(x, 1)) if (free.has(x)) count++;
    if (!best || count > best.count) best = { count, from, to };
  }
  return best && best.count > 0 ? best : null;
}
export const noSpendSummary = (events, ym, today) => ({ count: noSpendDates(events, ym, today).length, streak: noSpendStreak(events, today), bestWeek: bestNoSpendWeek(events, ym, today) });

// ---------- отказы с ценой ----------
// «Не купил кофе — 250 ₽»: отложенные желания (wish) со статусом «передумал» и суммой. За месяц — сэкономлено, кнопка «в копилку».
export const REFUSAL_TAG = 'из отказов';
export function refusalSavings(events, ym) {
  const dropped = events.filter(e => e.type === 'wish' && e.payload.status === 'dropped' && (e.payload.resolvedDate || '').startsWith(ym));
  const savedMinor = dropped.reduce((s, w) => s + (w.payload.amountMinor || 0), 0);
  const movedMinor = events.filter(e => e.type === 'goalmove' && e.payload.note === REFUSAL_TAG && monthOf(e.payload.date) === ym)
    .reduce((s, e) => s + Math.max(0, e.payload.amountMinor || 0), 0);
  return { count: dropped.length, savedMinor, movedMinor, dueMinor: Math.max(0, savedMinor - movedMinor) };
}

// ---------- список покупок → расход ----------
// Черновик расхода из купленного желания: сумма подставляется сама, записи связываются по wishId.
export function expenseFromWish(wish, now = Date.now()) {
  const p = wish.payload;
  if (p.status !== 'bought') throw new Error('Покупка ещё не отмечена купленной');
  if (!(Number.isSafeInteger(p.amountMinor) && p.amountMinor > 0 && p.amountMinor <= MAX_MINOR)) throw new Error('У покупки нет суммы');
  const ev = makeExpense({ amount: p.amountMinor, category: 'Другое', note: p.text, date: p.resolvedDate || todayStr(now) }, now);
  return { ...ev, payload: { ...ev.payload, wishId: wish.id } };
}
// Купленные желания с суммой, по которым ещё нет расхода.
export function wishDrafts(events) {
  const linked = new Set(events.filter(e => e.type === 'expense' && e.payload.wishId).map(e => e.payload.wishId));
  return events.filter(e => e.type === 'wish' && e.payload.status === 'bought' && Number.isSafeInteger(e.payload.amountMinor) && e.payload.amountMinor > 0 && !linked.has(e.id))
    .sort((a, b) => (b.payload.resolvedDate || '').localeCompare(a.payload.resolvedDate || ''));
}

// ---------- продал вещь → доход ----------
// Инвентарь живёт в home.js; здесь только предложение: поля для записи дохода, сумма подставлена из цены вещи.
export function saleIncomeDraft({ name, priceMinor = null } = {}, date = null) {
  const n = clean(name, 60);
  if (!n) throw new Error('Назови вещь');
  if (priceMinor !== null && !(Number.isSafeInteger(priceMinor) && priceMinor > 0 && priceMinor <= MAX_MINOR)) throw new Error('Сумма больше нуля');
  return { amount: priceMinor, category: 'Другое', note: `Продано: ${n}`, date: date || todayStr() };
}

// ---------- цена одного надевания ----------
// rows: [{name, priceMinor, wears}]. Выгодные — носят часто, цена надевания низкая; «мёртвые» — куплены и ни разу не надеты.
export function wearRating(rows, { minWears = 3, limit = 5 } = {}) {
  const priced = (Array.isArray(rows) ? rows : []).filter(r => Number.isSafeInteger(r.priceMinor) && r.priceMinor > 0);
  const used = priced.filter(r => r.wears > 0).map(r => ({ name: r.name, wears: r.wears, priceMinor: r.priceMinor, costPerWear: Math.round(r.priceMinor / r.wears) }));
  const worth = used.filter(r => r.wears >= minWears).sort((a, b) => a.costPerWear - b.costPerWear || b.wears - a.wears).slice(0, limit);
  const dead = priced.filter(r => !r.wears).map(r => ({ name: r.name, wears: 0, priceMinor: r.priceMinor, costPerWear: null }))
    .sort((a, b) => b.priceMinor - a.priceMinor || a.name.localeCompare(b.name)).slice(0, limit);
  return { worth, dead };
}

// ---------- аудит подписок по факту ----------
// Раз в месяц честный вопрос «пользуешься?». Ответы хранятся в настройках экрана (prefs), здесь — чистая логика.
// subs: [{id, name, monthlyMinor}], answers: {id: 'use' | 'cancel'}.
export const subAuditList = (subs, answers = {}) => subs.map(s => ({ ...s, verdict: answers[s.id] ?? null }));
export const auditComplete = (subs, answers = {}) => subs.length > 0 && subs.every(s => answers[s.id] === 'use' || answers[s.id] === 'cancel');
export const cancelCandidates = (subs, answers = {}) => subs.filter(s => answers[s.id] === 'cancel');

// ---------- зарплатный ритуал ----------
// В день выплаты (salaryDay из настроек зарплаты) — спокойный чек-лист распределения дохода.
export function isPayday(pay, today) {
  const day = Number(pay?.salaryDay) || 0;
  if (!day || !isYmd(today)) return false;
  const [y, m] = today.split('-').map(Number);
  const dim = new Date(y, m, 0).getDate();
  return Number(today.slice(8)) === Math.min(day, dim);
}
export function salaryChecklist(events, today, pay) {
  const ym = monthOf(today);
  const items = [
    { key: 'income', text: 'Записать пришедшую зарплату в доходы', done: events.some(e => e.type === 'income' && monthOf(e.payload.date) === ym && e.payload.category === 'Зарплата') },
    { key: 'budget', text: 'Проверить бюджет месяца', done: budgetOf(events) !== null },
    { key: 'goals', text: 'Отложить хоть немного в копилку', done: events.some(e => e.type === 'goalmove' && monthOf(e.payload.date) === ym && e.payload.amountMinor > 0) },
    { key: 'debts', text: 'Разобрать просроченные долги', done: !events.some(e => e.type === 'debt' && !e.payload.settled && e.payload.due && e.payload.due < today) },
  ];
  return { due: isPayday(pay, today), items, done: items.filter(i => i.done).length };
}
