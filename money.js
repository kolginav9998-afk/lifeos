// Расходы. Суммы — целые копейки (никаких дробных чисел), валюта пока одна — рубль.
import { todayStr, isYmd, newId } from './events.js';

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
