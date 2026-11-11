// Режим болезни: на время недомогания привычки и серии «на паузе», пропуски не считаются срывом.
// Выключается сам через 30 дней, чтобы пауза не затянулась навсегда по забывчивости.
import { isYmd, addDays, daysBetween, todayStr, newId } from './events.js';

export const MAX_SICK_DAYS = 30;

export const sickRanges = events => events.filter(e => e.type === 'sick').map(e => ({ id: e.id, from: e.payload.from, to: e.payload.to ?? null }));
// Конец периода: указанная дата, а у открытого — сегодня, но не позже чем через 30 дней от начала.
const lastDay = (r, today) => {
  const cap = addDays(r.from, MAX_SICK_DAYS - 1);
  const end = r.to ?? today;
  return end < cap ? end : cap;
};
export const isOpen = (r, today) => r.to === null && r.from <= today && daysBetween(r.from, today) < MAX_SICK_DAYS;

// Открытый период, который идёт сегодня (если есть).
export function activeSick(events, today) {
  const r = sickRanges(events).filter(x => isOpen(x, today)).sort((a, b) => b.from.localeCompare(a.from))[0];
  return r ? events.find(e => e.id === r.id) : null;
}
export const isSick = (events, today) => activeSick(events, today) !== null;

// Множество дат (YYYY-MM-DD), которые считаются днями болезни.
export function sickDays(events, today) {
  const out = new Set();
  for (const r of sickRanges(events)) {
    if (!isYmd(r.from) || r.from > today) continue;
    for (let d = r.from, end = lastDay(r, today); d <= end; d = addDays(d, 1)) out.add(d);
  }
  return out;
}

export function startSick(events, { from } = {}, now = Date.now()) {
  const today = todayStr(now);
  if (isSick(events, today)) throw new Error('Режим болезни уже включён');
  const f = from || today;
  if (!isYmd(f)) throw new Error('Дата начала указана неверно');
  if (f > today) throw new Error('Начало не может быть в будущем');
  if (daysBetween(f, today) >= MAX_SICK_DAYS) throw new Error('Слишком давно: максимум 30 дней назад');
  return { id: `sick:${newId()}`, type: 'sick', ts: now, payload: { from: f, to: null }, source: 'manual', confidence: 1, evidence: [] };
}
export function endSick(ev, now = Date.now()) {
  const d = todayStr(now);
  if (d < ev.payload.from) throw new Error('Дата окончания раньше начала');
  return { ...ev, payload: { ...ev.payload, to: d } };
}
// Для отчётов: сколько дней в режиме болезни в диапазоне.
export const sickCount = (events, from, to, today = to) => [...sickDays(events, today)].filter(d => d >= from && d <= to).length;
