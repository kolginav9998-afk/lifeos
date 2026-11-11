// Привычки (по мотивам «Атомных привычек»): якорь «после чего», версия на 2 минуты,
// «не пропусти второй раз», регулярность за 30 дней вместо одной хрупкой серии.
import { todayStr, addDays, daysBetween, isYmd, newId } from './events.js';
import { sickDays } from './sick.js';

const clean = (s, n) => String(s ?? '').trim().slice(0, n);
export const habitLogId = (habitId, date) => `${habitId}:${date}`;   // одна отметка в день на привычку

// Расписание по дням недели: days — номера дней (0 — воскресенье … 6 — суббота); пусто — каждый день.
// Дни вне расписания не считаются пропуском и не рвут серию; отметка в такой день засчитывается как лишняя.
export const DAY_NAMES = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const dow = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d, 12).getDay(); };
export function cleanDays(days) {
  if (!Array.isArray(days)) return [];
  const set = [...new Set(days.map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
  return set.length === 7 ? [] : set;
}
export const isScheduled = (habit, date) => { const d = habit.payload.days; return !Array.isArray(d) || d.length === 0 || d.includes(dow(date)); };
export const daysText = days => (cleanDays(days).length ? WEEK_ORDER.filter(d => days.includes(d)).map(d => DAY_NAMES[d]).join(', ') : 'каждый день');

export function makeHabit({ name, anchor = '', minimum = '', full = '', identity = '', plan = '', days = [] }, now = Date.now()) {
  const n = clean(name, 120);
  if (!n) throw new Error('empty habit');
  return {
    id: newId(), type: 'habit', ts: now,
    payload: { name: n, anchor: clean(anchor, 200), minimum: clean(minimum, 200), full: clean(full, 200), identity: clean(identity, 120), plan: clean(plan, 200), days: cleanDays(days), startDate: todayStr(now), archived: false },
    source: 'manual', confidence: 1, evidence: [],
  };
}

export function updateHabit(ev, { name, anchor, minimum, full, identity, plan, days }, now = Date.now()) {
  const n = clean(name, 120);
  if (!n) throw new Error('empty habit');
  return { ...ev, payload: { ...ev.payload, name: n, anchor: clean(anchor, 200), minimum: clean(minimum, 200), full: clean(full, 200), identity: identity === undefined ? (ev.payload.identity ?? '') : clean(identity, 120), plan: plan === undefined ? (ev.payload.plan ?? '') : clean(plan, 200), days: days === undefined ? (ev.payload.days ?? []) : cleanDays(days), editedAt: now } };
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
  const sick = sickDays(events, today);                         // дни болезни: не срыв и не «зачёт»
  const doneToday = byDate.has(today);

  // текущая серия: если сегодня ещё не отмечено, серия не «сгорает» до конца дня; дни болезни серию не рвут
  const sched = d => isScheduled(habit, d);
  let cursor = doneToday ? today : addDays(today, -1);
  let streak = 0;
  for (let guard = 0; guard < 4000; guard++) {
    if (byDate.has(cursor)) { streak++; cursor = addDays(cursor, -1); }
    else if (sick.has(cursor) || !sched(cursor)) cursor = addDays(cursor, -1);          // болезнь и дни вне расписания серию не рвут
    else break;
  }

  // самая длинная серия
  const dates = [...byDate.keys()].sort();
  const bridged = (a, b) => { for (let x = addDays(a, 1); x < b; x = addDays(x, 1)) if (!sick.has(x) && sched(x)) return false; return true; };
  let longest = 0, run = 0, prev = null;
  for (const d of dates) { run = prev && bridged(prev, d) ? run + 1 : 1; longest = Math.max(longest, run); prev = d; }

  // регулярность за последние 30 дней (но не раньше старта привычки); дни болезни без отметки не считаются
  const start = habit.payload.startDate;
  const win = Math.min(30, Math.max(1, daysBetween(start, today) + 1));
  let hits = 0, counted = 0, pausedDays = 0;
  for (let i = 0; i < win; i++) {
    const d = addDays(today, -i);
    if (byDate.has(d)) { hits++; counted++; } else if (sick.has(d)) pausedDays++; else if (sched(d)) counted++;
  }
  const span = Math.max(1, counted);

  const yesterday = addDays(today, -1);
  const missedYesterday = daysBetween(start, yesterday) >= 0 && !byDate.has(yesterday) && !sick.has(yesterday) && sched(yesterday);
  // «не пропусти второй раз»: последний плановый день перед сегодняшним пропущен (болезнь обрывает проверку, дни вне расписания пропускаем)
  let missedPlanned = false;
  for (let k = 1; k <= 14; k++) { const d = addDays(today, -k); if (d < start || sick.has(d)) break; if (sched(d)) { missedPlanned = !byDate.has(d); break; } }
  const last = dates.length ? dates[dates.length - 1] : null;
  let gapDays = last ? daysBetween(last, today) : null;
  if (last) for (let x = addDays(last, 1); x <= today; x = addDays(x, 1)) if (sick.has(x) || !sched(x)) gapDays--;

  return {
    doneToday, level: byDate.get(today) ?? null, scheduledToday: sched(today), streak, longest,
    hits, span, pausedDays, consistency: hits / span, total: byDate.size,
    missedYesterday, neverMissTwice: missedPlanned && !doneToday && sched(today),
    gapDays, needsRecovery: gapDays !== null && gapDays >= 3 && !doneToday && !sick.has(today) && sched(today),
  };
}

// Последние n дней (старые -> новые) для мини-календаря.
export function habitCalendar(habit, events, today, n = 28) {
  const byDate = new Map(logsOf(events, habit.id).map(l => [l.payload.date, l.payload.level]));
  const start = habit.payload.startDate;
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    out.push({ date, level: byDate.get(date) ?? null, before: date < start, today: i === 0, off: !isScheduled(habit, date) });
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
  { name: 'Свет утром', anchor: 'после пробуждения', minimum: 'выйти на балкон на минуту', full: '10 минут на дневном свету' },
  { name: 'Растяжка', anchor: 'после работы', minimum: 'одно упражнение на 30 секунд', full: '10 минут растяжки' },
  { name: 'Час без экрана', anchor: 'за час до сна', minimum: 'убрать телефон на 10 минут', full: 'час без экрана перед сном' },
  { name: 'Одно замещение в день', anchor: 'за обедом', minimum: 'заменить один напиток водой', full: 'заменить одно переработанное блюдо простой едой' },
];

// Ежемесячный пересмотр: по регулярности за 30 дней предлагаем оставить, облегчить или убрать в архив.
export const REVIEW_TEXT = {
  keep: 'Работает: держи как есть.',
  ok: 'Нормально. Если пропуски повторяются, сделай минимум ещё меньше.',
  ease: 'Похоже, слишком тяжело. Уменьши минимум до двух минут или привяжи к другому «после чего».',
  archive: 'За месяц ни одной отметки. Либо вернись с минимума, либо убери в архив без вины.',
  few: 'Было мало обычных дней (болезнь или пауза). Оценишь привычку позже, когда режим наладится.',
};
export function habitReview(events, today) {
  return activeHabits(events, today).filter(({ st, h }) => daysBetween(h.payload.startDate, today) >= 14).map(({ h, st }) => {
    const advice = st.pausedDays > 0 && st.span < 7 ? 'few' : st.hits === 0 ? 'archive' : st.consistency >= 0.8 ? 'keep' : st.consistency >= 0.4 ? 'ok' : 'ease';
    return { h, st, advice, text: REVIEW_TEXT[advice] };
  });
}
// Первые семь дней месяца, если за этот месяц пересмотр ещё не делали.
export const reviewDue = (today, doneYm) => Number(today.slice(8)) <= 7 && doneYm !== today.slice(0, 7);
