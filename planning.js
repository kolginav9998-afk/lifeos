// Финансовое планирование: лимиты по категориям, копилки (цели накоплений), подписки и прогноз месяца. Суммы — целые копейки.
import { isYmd, addDays, daysBetween, todayStr, newId } from './events.js';
import { MAX_MINOR, DEFAULT_CATEGORIES, summarizeMonth, monthOf, makeExpense, budgetOf } from './money.js';

const clean = (s, n) => String(s ?? '').trim().slice(0, n);
const okMinor = v => Number.isSafeInteger(v) && v > 0 && v <= MAX_MINOR;
const base = (type, id, payload, now) => ({ id, type, ts: now, payload, source: 'manual', confidence: 1, evidence: [] });
export const dim = (y, m) => new Date(y, m, 0).getDate();

// ---------- лимиты по категориям ----------
export const limitId = category => `limit:${category}`;
export function makeLimit(category, amountMinor, now = Date.now()) {
  const c = clean(category, 40);
  if (!c) throw new Error('Выбери категорию');
  if (!okMinor(amountMinor)) throw new Error('Лимит: сумма больше нуля');
  return base('limit', limitId(c), { category: c, amountMinor }, now);
}
export const limitsOf = events => new Map(events.filter(e => e.type === 'limit').map(e => [e.payload.category, e.payload.amountMinor]));

// Статус по категориям за месяц: расход, лимит, доля. warn — от 80%, over — выше лимита.
export function limitStatus(events, ym) {
  const spent = new Map(summarizeMonth(events, ym, 'expense').byCategory.map(c => [c.category, c.total]));
  const lim = limitsOf(events);
  const cats = new Set([...spent.keys(), ...lim.keys()]);
  return [...cats].map(category => {
    const s = spent.get(category) || 0, l = lim.get(category) ?? null;
    const ratio = l ? s / l : null;
    return { category, spent: s, limit: l, ratio, left: l === null ? null : l - s, status: l === null ? 'none' : ratio > 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok' };
  }).sort((a, b) => (b.limit ? 1 : 0) - (a.limit ? 1 : 0) || b.spent - a.spent || a.category.localeCompare(b.category));
}

// ---------- копилки ----------
export function makeGoal({ title, targetMinor, dueDate = null }, now = Date.now()) {
  const t = clean(title, 80);
  if (!t) throw new Error('Назови цель');
  if (!okMinor(targetMinor)) throw new Error('Сумма цели больше нуля');
  if (dueDate && !isYmd(dueDate)) throw new Error('Срок указан неверно');
  return base('goal', `goal:${newId()}`, { title: t, targetMinor, dueDate: dueDate || null }, now);
}
export function makeGoalMove(goalId, amountMinor, { date, note = '' } = {}, now = Date.now()) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor === 0 || Math.abs(amountMinor) > MAX_MINOR) throw new Error('Сумма: не ноль');
  const d = date || todayStr(now);
  if (!isYmd(d)) throw new Error('bad date');
  return base('goalmove', `gm:${newId()}`, { goalId, amountMinor, date: d, note: clean(note, 100) }, now);
}
export function goalProgress(events, today) {
  const moves = new Map();
  for (const e of events) if (e.type === 'goalmove') moves.set(e.payload.goalId, (moves.get(e.payload.goalId) || 0) + e.payload.amountMinor);
  return events.filter(e => e.type === 'goal').sort((a, b) => a.ts - b.ts).map(g => {
    const saved = Math.max(0, moves.get(g.id) || 0), t = g.payload.targetMinor;
    const remaining = Math.max(0, t - saved);
    let perMonth = null, monthsLeft = null;
    if (g.payload.dueDate && remaining) {
      const days = daysBetween(today, g.payload.dueDate);
      monthsLeft = days > 0 ? Math.max(1, Math.ceil(days / 30.4)) : 0;
      perMonth = monthsLeft ? Math.ceil(remaining / monthsLeft) : null;
    }
    return { goal: g, saved, target: t, ratio: Math.min(1, saved / t), remaining, done: saved >= t, perMonth, monthsLeft, overdue: !!g.payload.dueDate && g.payload.dueDate < today && saved < t };
  });
}

// ---------- подписки ----------
export function makeSub({ name, amountMinor, period = 'month', day = 1, month = 1 }, now = Date.now()) {
  const n = clean(name, 60);
  if (!n) throw new Error('Назови подписку');
  if (!okMinor(amountMinor)) throw new Error('Сумма больше нуля');
  if (!['month', 'year'].includes(period)) throw new Error('Период: месяц или год');
  const d = Math.round(Number(day)), m = Math.round(Number(month));
  if (!(d >= 1 && d <= 31)) throw new Error('День месяца: от 1 до 31');
  if (period === 'year' && !(m >= 1 && m <= 12)) throw new Error('Месяц: от 1 до 12');
  return base('sub', `sub:${newId()}`, { name: n, amountMinor, period, day: d, ...(period === 'year' ? { month: m } : {}), active: true }, now);
}
export const subsOf = events => events.filter(e => e.type === 'sub').sort((a, b) => a.payload.name.localeCompare(b.payload.name));
// Ближайший платёж не раньше today (день месяца укорачивается до длины месяца: 31 → 30/28).
export function nextCharge(p, today) {
  const [y, m] = today.split('-').map(Number);
  const at = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}-${String(Math.min(p.day, dim(yy, mm))).padStart(2, '0')}`;
  if (p.period === 'month') {
    const c = at(y, m);
    if (c >= today) return c;
    return m === 12 ? at(y + 1, 1) : at(y, m + 1);
  }
  const c = at(y, p.month);
  return c >= today ? c : at(y + 1, p.month);
}
export const monthlyCost = p => (p.period === 'year' ? Math.round(p.amountMinor / 12) : p.amountMinor);
export const subsTotals = events => {
  const act = subsOf(events).filter(s => s.payload.active);
  return { count: act.length, monthly: act.reduce((s, x) => s + monthlyCost(x.payload), 0), yearly: act.reduce((s, x) => s + monthlyCost(x.payload) * 12, 0) };
};
export const subPayment = (sub, date, now = Date.now()) => makeExpense({ amount: sub.payload.amountMinor, category: 'Подписки', note: sub.payload.name, date }, now);

// ---------- прогноз месяца ----------
export function forecast(events, today) {
  const ym = monthOf(today);
  const [y, m, d] = today.split('-').map(Number);
  const days = dim(y, m), left = days - d;
  const spent = summarizeMonth(events, ym, 'expense').total;
  const budget = budgetOf(events);
  const projected = d >= 3 ? Math.round(((spent / d) * days) / 100) * 100 : null;           // первые дни месяца слишком шумные
  const subsLeft = subsOf(events).filter(s => s.payload.active).reduce((sum, s) => { const nc = nextCharge(s.payload, today); return nc.slice(0, 7) === ym && nc >= today ? sum + s.payload.amountMinor : sum; }, 0);
  return { ym, day: d, days, daysLeft: left, spent, projected, budget, subsLeft,
    perDay: budget && left >= 0 ? Math.floor((budget - spent) / Math.max(1, left + 1)) : null, overBudget: budget !== null && projected !== null && projected > budget };
}
export { DEFAULT_CATEGORIES };
