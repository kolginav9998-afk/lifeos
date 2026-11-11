// Недельный обзор: что сделано, как с привычками, куда ушли деньги. Только факты из твоих данных.
import { addDays, todayStr } from './events.js';
import { activeHabits, isScheduled } from './habits.js';
import { spentBetween, sumBetween } from './money.js';
import { logsOf } from './habits.js';
import { checkinOf, dayMood } from './diary.js';
import { strengthDays } from './workouts.js';
import { focusWeek } from './focus.js';

const localDate = ts => todayStr(ts);

export function weekReview(events, today) {
  const from = addDays(today, -6);                  // последние 7 дней включая сегодня
  const prevFrom = addDays(today, -13), prevTo = addDays(today, -7);

  const done = events.filter(e => e.type === 'task' && e.payload.done && e.payload.doneAt);
  const doneDates = done.map(e => localDate(e.payload.doneAt));
  const perDay = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    perDay.push({ date: d, count: doneDates.filter(x => x === d).length });
  }
  const tasksDone = perDay.reduce((s, x) => s + x.count, 0);
  const prevDone = doneDates.filter(d => d >= prevFrom && d <= prevTo).length;

  const habits = activeHabits(events, today).map(({ h }) => {
    const logs = logsOf(events, h.id).filter(l => l.payload.date >= from && l.payload.date <= today);
    const start = h.payload.startDate;
    const span = Math.max(1, Math.min(7, Math.round((Date.parse(today) - Date.parse(start)) / 86400000) + 1));
    let planned = 0;                                      // сколько из этих дней по расписанию привычки
    for (let i = 0; i < span; i++) if (isScheduled(h, addDays(today, -i))) planned++;
    return { name: h.payload.name, hits: logs.length, of: Math.max(planned, logs.length, 1) };
  });

  // самочувствие и развитие за те же 7 дней
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, -6 + i));
  const sleeps = days.map(d => checkinOf(events, d, 'm')?.payload.sleepHours).filter(Number.isFinite);
  const minutes = days.map(d => checkinOf(events, d, 'e')?.payload.exercise).filter(Number.isFinite);
  const moods = days.map(d => dayMood(events, d)).filter(Number.isFinite);
  const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const inRange = d => d >= from && d <= today;
  const health = {
    sleepDays: sleeps.length, sleepAvg: avg(sleeps), sleepBest: sleeps.length ? Math.max(...sleeps) : null, sleepWorst: sleeps.length ? Math.min(...sleeps) : null,
    activityMinutes: minutes.reduce((x, y) => x + y, 0), activityDays: minutes.length, activityGoal: 150,
    moodAvg: avg(moods), strengthDays: strengthDays(events, today),
  };
  const focus = focusWeek(events, today);
  const growth = {
    lessons: events.filter(e => e.type === 'lesson' && inRange(e.payload.date)).length,
    reviews: events.filter(e => e.type === 'srs').reduce((n, e) => n + (e.payload.hist || []).filter(h => inRange(h[0])).length, 0),
    tests: events.filter(e => e.type === 'testrun' && inRange(e.payload.date)).length,
  };

  return {
    from, to: today, tasksDone, prevDone, perDay, habits, health, growth, focus, active: activeDays(events, today),
    spent: spentBetween(events, from, today),
    income: sumBetween(events, 'income', from, today),
    spentPrev: spentBetween(events, prevFrom, prevTo),
    notes: events.filter(e => e.type === 'note' && localDate(e.ts) >= from).length,
  };
}

// Главная метрика: сколько дней за последний месяц ты сделал хотя бы что-то из своего списка (минимум привычки, задача, фокус, урок, отметка…).
const ACTION_BY_DATE = ['habit_log', 'focus', 'lesson', 'checkin', 'diary', 'speak', 'thought', 'breath', 'dayreview', 'intention'];
export function actionDates(events) {
  const set = new Set();
  for (const e of events) {
    if (ACTION_BY_DATE.includes(e.type) && e.payload?.date) set.add(e.payload.date);
    else if (e.type === 'workout' && e.payload?.done && e.payload.date) set.add(e.payload.date);
    else if (e.type === 'task' && e.payload?.done && e.payload.doneAt) set.add(localDate(e.payload.doneAt));
  }
  return set;
}
export function activeDays(events, today, days = 30) {
  const set = actionDates(events);
  let count = 0;
  for (let i = 0; i < days; i++) if (set.has(addDays(today, -i))) count++;
  let d = set.has(today) ? today : addDays(today, -1), streak = 0;                  // сегодня можно ещё не делать: серия не сгорает до конца дня
  while (set.has(d)) { streak++; d = addDays(d, -1); }
  return { count, of: days, streak };
}
