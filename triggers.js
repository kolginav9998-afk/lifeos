// Триггеры с «сухим прогоном» и сторож тишины (watchdog). Чистая логика над списком записей.
import { makeTask, todayStr, addDays, daysBetween } from './events.js';

// Правило: задача просрочена N-й день подряд в периоде → предложить разбить её на шаги.
export const OVERDUE_SPLIT_RULE = {
  id: 'overdue-split',
  times: 3,
  text: 'задача просрочена 3-й день → предложить разбить на шаги',
};

// Сколько дней каждая задача была просрочена внутри периода [from, to] (даты 'YYYY-MM-DD', включительно).
// Для выполненной задачи просрочка кончается днём выполнения; для открытой тянется до конца периода.
// Записей о переносах срока нет, поэтому считаем по текущему сроку — это приближение, честное для сухого прогона.
export function overdueDaysIn(events, from, to) {
  if (!from || !to || from > to) return [];
  const out = [];
  for (const e of events || []) {
    if (e?.type !== 'task' || !e.payload?.due) continue;
    const start = addDays(e.payload.due, 1) > from ? addDays(e.payload.due, 1) : from;   // с дня после срока, но не раньше периода
    let end = to;
    if (e.payload.done && Number.isFinite(e.payload.doneAt)) {
      const doneDay = todayStr(e.payload.doneAt);
      if (doneDay < end) end = doneDay;
    }
    if (start > end) continue;
    out.push({ id: e.id, text: e.payload.text, days: daysBetween(start, end) + 1 });
  }
  return out.sort((a, b) => b.days - a.days);
}

// Сухой прогон правила за период: сколько раз оно сработало бы, ничего не меняя.
export function dryRunTrigger(events, { from, to }, rule = OVERDUE_SPLIT_RULE) {
  const rows = overdueDaysIn(events, from, to).filter(r => r.days >= rule.times);
  return { rule, from, to, hits: rows.length, tasks: rows };
}

// ---------- сторож тишины ----------
export const WATCHDOG_GAP_DAYS = 3;
export const WATCHDOG_TASK_TEXT = 'Проверь, всё ли живо: несколько дней без записей';

// Если последняя запись старше gapDays суток — вернуть описание проблемы, иначе null.
// Пустая база (только что установлено приложение) тишиной не считается.
export function watchdog(events, now = Date.now(), gapDays = WATCHDOG_GAP_DAYS) {
  const list = (events || []).filter(e => e && Number.isFinite(e.ts));
  if (!list.length) return null;
  const last = list.reduce((m, e) => Math.max(m, e.ts), 0);
  const idleDays = Math.floor((now - last) / 86400000);
  if (idleDays < gapDays) return null;
  return { idleDays, lastTs: last, text: `Записей не было ${idleDays} дн.` };
}

// Задача-напоминание на сегодня, которую предлагает сторож.
export function makeWatchdogTask(now = Date.now()) {
  return makeTask(WATCHDOG_TASK_TEXT, now, { due: todayStr(now) });
}
