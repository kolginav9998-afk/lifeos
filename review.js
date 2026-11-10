// Недельный обзор: что сделано, как с привычками, куда ушли деньги. Только факты из твоих данных.
import { addDays, todayStr } from './events.js';
import { activeHabits } from './habits.js';
import { spentBetween } from './money.js';
import { logsOf } from './habits.js';

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
    const days = Math.max(1, Math.min(7, Math.round((Date.parse(today) - Date.parse(start)) / 86400000) + 1));
    return { name: h.payload.name, hits: logs.length, of: days };
  });

  return {
    from, to: today, tasksDone, prevDone, perDay, habits,
    spent: spentBetween(events, from, today),
    spentPrev: spentBetween(events, prevFrom, prevTo),
    notes: events.filter(e => e.type === 'note' && localDate(e.ts) >= from).length,
  };
}
