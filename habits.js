// Привычки (по мотивам «Атомных привычек»): якорь «после чего», версия на 2 минуты,
// «не пропусти второй раз», регулярность за 30 дней вместо одной хрупкой серии.
import { todayStr, addDays, daysBetween, isYmd, newId } from './events.js';

const clean = (s, n) => String(s ?? '').trim().slice(0, n);
export const habitLogId = (habitId, date) => `${habitId}:${date}`;   // одна отметка в день на привычку

export function makeHabit({ name, anchor = '', minimum = '', full = '', identity = '' }, now = Date.now()) {
  const n = clean(name, 120);
  if (!n) throw new Error('empty habit');
  return {
    id: newId(), type: 'habit', ts: now,
    payload: { name: n, anchor: clean(anchor, 200), minimum: clean(minimum, 200), full: clean(full, 200), identity: clean(identity, 120), startDate: todayStr(now), archived: false },
    source: 'manual', confidence: 1, evidence: [],
  };
}

export function updateHabit(ev, { name, anchor, minimum, full, identity }, now = Date.now()) {
  const n = clean(name, 120);
  if (!n) throw new Error('empty habit');
  return { ...ev, payload: { ...ev.payload, name: n, anchor: clean(anchor, 200), minimum: clean(minimum, 200), full: clean(full, 200), identity: identity === undefined ? (ev.payload.identity ?? '') : clean(identity, 120), editedAt: now } };
}

export const archiveHabit = (ev, archived = true) => ({ ...ev, payload: { ...ev.payload, archived } });

export function makeHabitLog(habit, date, level, now = Date.now()) {
  if (!isYmd(date)) throw new Error('bad date');
  if (level !== 'full' && level !== 'min') throw new Error('bad level');
  return {
    id: habitLogId(habit.id, date), type: 'habit_log', ts: now,
    payload: { habitId: habit.id, date, level },
    source: 'manual', confidence: 1, evidence: [],
  };
}

export const logsOf = (events, habitId) => events.filter(e => e.type === 'habit_log' && e.payload.habitId === habitId);

export function habitStats(habit, events, today) {
  const byDate = new Map(logsOf(events, habit.id).map(l => [l.payload.date, l.payload.level]));
  const doneToday = byDate.has(today);

  // текущая серия: если сегодня ещё не отмечено, серия не «сгорает» до конца дня
  let cursor = doneToday ? today : addDays(today, -1);
  let streak = 0;
  while (byDate.has(cursor)) { streak++; cursor = addDays(cursor, -1); }

  // самая длинная серия
  const dates = [...byDate.keys()].sort();
  let longest = 0, run = 0, prev = null;
  for (const d of dates) { run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1; longest = Math.max(longest, run); prev = d; }

  // регулярность за последние 30 дней (но не раньше старта привычки)
  const start = habit.payload.startDate;
  const span = Math.min(30, Math.max(1, daysBetween(start, today) + 1));
  let hits = 0;
  for (let i = 0; i < span; i++) if (byDate.has(addDays(today, -i))) hits++;

  const yesterday = addDays(today, -1);
  const missedYesterday = daysBetween(start, yesterday) >= 0 && !byDate.has(yesterday);
  const last = dates.length ? dates[dates.length - 1] : null;
  const gapDays = last ? daysBetween(last, today) : null;

  return {
    doneToday, level: byDate.get(today) ?? null, streak, longest,
    hits, span, consistency: hits / span, total: byDate.size,
    missedYesterday, neverMissTwice: missedYesterday && !doneToday,
    gapDays, needsRecovery: gapDays !== null && gapDays >= 3 && !doneToday,
  };
}

// Последние n дней (старые -> новые) для мини-календаря.
export function habitCalendar(habit, events, today, n = 28) {
  const byDate = new Map(logsOf(events, habit.id).map(l => [l.payload.date, l.payload.level]));
  const start = habit.payload.startDate;
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    out.push({ date, level: byDate.get(date) ?? null, before: date < start, today: i === 0 });
  }
  return out;
}

export function activeHabits(events, today) {
  const hs = events.filter(e => e.type === 'habit' && !e.payload.archived);
  return hs.map(h => ({ h, st: habitStats(h, events, today) }))
    .sort((a, b) => Number(a.st.doneToday) - Number(b.st.doneToday) || a.h.ts - b.h.ts);
}

// Готовые заготовки для быстрого старта (подставляются в форму, ничего не сохраняют сами).
export const HABIT_TEMPLATES = [
  { name: 'Вода', anchor: 'после пробуждения', minimum: 'один глоток', full: 'стакан воды' },
  { name: 'Зарядка', anchor: 'после пробуждения', minimum: '5 приседаний', full: '10 минут зарядки' },
  { name: 'Чтение', anchor: 'перед сном', minimum: 'одна страница', full: '20 минут чтения' },
  { name: 'Прогулка', anchor: 'после обеда', minimum: 'выйти на улицу', full: '20 минут пешком' },
  { name: 'Английский', anchor: 'после завтрака', minimum: '5 слов', full: '15 минут практики' },
];

// Ежемесячный пересмотр: по регулярности за 30 дней предлагаем оставить, облегчить или убрать в архив.
export const REVIEW_TEXT = {
  keep: 'Работает: держи как есть.',
  ok: 'Нормально. Если пропуски повторяются, сделай минимум ещё меньше.',
  ease: 'Похоже, слишком тяжело. Уменьши минимум до двух минут или привяжи к другому «после чего».',
  archive: 'За месяц ни одной отметки. Либо вернись с минимума, либо убери в архив без вины.',
};
export function habitReview(events, today) {
  return activeHabits(events, today).filter(({ st, h }) => daysBetween(h.payload.startDate, today) >= 14).map(({ h, st }) => {
    const advice = st.hits === 0 ? 'archive' : st.consistency >= 0.8 ? 'keep' : st.consistency >= 0.4 ? 'ok' : 'ease';
    return { h, st, advice, text: REVIEW_TEXT[advice] };
  });
}
// Первые семь дней месяца, если за этот месяц пересмотр ещё не делали.
export const reviewDue = (today, doneYm) => Number(today.slice(8)) <= 7 && doneYm !== today.slice(0, 7);
