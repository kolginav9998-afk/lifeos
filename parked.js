// Отложенные мысли: записать тревожную мысль или дело «на завтра» и отпустить. Утром приложение вернёт это на экран.
import { isYmd, addDays, todayStr, newId } from './events.js';

const clean = (s, n) => String(s ?? '').trim().slice(0, n);

export function makePark({ text, forDate } = {}, now = Date.now()) {
  const t = clean(text, 300);
  if (t.length < 3) throw new Error('Напиши хотя бы несколько слов');
  const today = todayStr(now), f = forDate || addDays(today, 1);
  if (!isYmd(f)) throw new Error('Дата указана неверно');
  if (f < today) throw new Error('Вернуться можно не раньше сегодняшнего дня');
  return { id: `park:${newId()}`, type: 'parked', ts: now, payload: { date: today, forDate: f, text: t, done: false }, source: 'manual', confidence: 1, evidence: [] };
}
export const finishPark = (ev, now = Date.now()) => ({ ...ev, payload: { ...ev.payload, done: true, doneDate: todayStr(now) } });
export const parkedOf = events => events.filter(e => e.type === 'parked').sort((a, b) => a.payload.forDate.localeCompare(b.payload.forDate) || a.ts - b.ts);
// Пора разобрать: срок наступил и ещё не отмечено.
export const parkedDue = (events, today) => parkedOf(events).filter(e => !e.payload.done && e.payload.forDate <= today);
// Ждут своего дня.
export const parkedLater = (events, today) => parkedOf(events).filter(e => !e.payload.done && e.payload.forDate > today);
