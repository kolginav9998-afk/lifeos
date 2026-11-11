// Отсрочка покупок: «хочу купить» откладывается на 24 часа. Если через сутки всё ещё нужно, покупай спокойно; если нет, деньги сохранены.
import { todayStr, newId } from './events.js';
import { MAX_MINOR } from './money.js';

export const WAIT_MS = 24 * 3600 * 1000;
const clean = (s, n) => String(s ?? '').trim().slice(0, n);

export function makeWish({ text, amountMinor = null } = {}, now = Date.now()) {
  const t = clean(text, 120);
  if (t.length < 3) throw new Error('Напиши, что хочешь купить');
  if (amountMinor !== null && !(Number.isSafeInteger(amountMinor) && amountMinor > 0 && amountMinor <= MAX_MINOR)) throw new Error('Сумма больше нуля');
  return { id: `wish:${newId()}`, type: 'wish', ts: now, payload: { text: t, amountMinor, date: todayStr(now), until: now + WAIT_MS, status: 'wait' }, source: 'manual', confidence: 1, evidence: [] };
}
export const wishesOf = events => events.filter(e => e.type === 'wish').sort((a, b) => b.ts - a.ts);
// wait — ещё ждём; ready — сутки прошли, пора решить; bought — купил; dropped — передумал.
export const wishState = (w, now = Date.now()) => (w.payload.status === 'wait' ? (w.payload.until > now ? 'wait' : 'ready') : w.payload.status);
export function resolveWish(ev, status, now = Date.now()) {
  if (!['bought', 'dropped'].includes(status)) throw new Error('bad status');
  if (ev.payload.status !== 'wait') throw new Error('Уже решено');
  return { ...ev, payload: { ...ev.payload, status, resolvedDate: todayStr(now) } };
}
export const wishesReady = (events, now = Date.now()) => wishesOf(events).filter(w => wishState(w, now) === 'ready');
// Сколько денег сохранено отказами в месяце (YYYY-MM) и сколько раз передумал.
export function wishStats(events, ym) {
  const dropped = wishesOf(events).filter(w => w.payload.status === 'dropped' && (w.payload.resolvedDate || '').startsWith(ym));
  return { count: dropped.length, savedMinor: dropped.reduce((s, w) => s + (w.payload.amountMinor || 0), 0) };
}
// Осталось ждать, в часах (округляем вверх).
export const hoursLeft = (w, now = Date.now()) => Math.max(0, Math.ceil((w.payload.until - now) / 3600000));
