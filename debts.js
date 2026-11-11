// Долги и займы: кому, сколько, до какого срока. Суммы в копейках. Возвраты можно вносить частями.
import { isYmd, todayStr, newId } from './events.js';
import { MAX_MINOR } from './money.js';

const clean = (s, n) => String(s ?? '').trim().slice(0, n);
export const DIRECTIONS = { owe_me: 'мне должны', i_owe: 'я должен' };

export function makeDebt({ who, amountMinor, direction, due = null, note = '' } = {}, now = Date.now()) {
  const w = clean(who, 60);
  if (!w) throw new Error('Укажи, кто это');
  if (!(Number.isSafeInteger(amountMinor) && amountMinor > 0 && amountMinor <= MAX_MINOR)) throw new Error('Сумма больше нуля');
  if (!Object.hasOwn(DIRECTIONS, direction)) throw new Error('Выбери: мне должны или я должен');
  if (due && !isYmd(due)) throw new Error('Срок указан неверно');
  return { id: `debt:${newId()}`, type: 'debt', ts: now, payload: { who: w, amountMinor, direction, due: due || null, note: clean(note, 120), date: todayStr(now), paidMinor: 0, settled: false }, source: 'manual', confidence: 1, evidence: [] };
}
export const debtLeft = d => Math.max(0, d.payload.amountMinor - d.payload.paidMinor);
// Внести возврат (частично или полностью). Лишнего не принимаем.
export function repayDebt(ev, amountMinor, now = Date.now()) {
  if (!(Number.isSafeInteger(amountMinor) && amountMinor > 0)) throw new Error('Сумма больше нуля');
  if (amountMinor > debtLeft(ev)) throw new Error('Больше, чем осталось');
  const paid = ev.payload.paidMinor + amountMinor;
  return { ...ev, payload: { ...ev.payload, paidMinor: paid, settled: paid >= ev.payload.amountMinor, ...(paid >= ev.payload.amountMinor ? { settledDate: todayStr(now) } : {}) } };
}
export const debtsOf = events => events.filter(e => e.type === 'debt').sort((a, b) => Number(a.payload.settled) - Number(b.payload.settled) || (a.payload.due || '9999').localeCompare(b.payload.due || '9999') || a.ts - b.ts);
export const isOverdue = (d, today) => !d.payload.settled && !!d.payload.due && d.payload.due < today;
export function debtTotals(events, today) {
  const open = debtsOf(events).filter(d => !d.payload.settled);
  const sum = dir => open.filter(d => d.payload.direction === dir).reduce((s, d) => s + debtLeft(d), 0);
  return { owedToMe: sum('owe_me'), iOwe: sum('i_owe'), overdue: open.filter(d => isOverdue(d, today)), open: open.length };
}
