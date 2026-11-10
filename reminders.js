// План локальных напоминаний. Чистая функция: из данных получает список уведомлений на ближайшие дни.
// Текст уведомлений общий, без названий задач: уведомления видны на экране блокировки и лежат вне шифрования приложения.
import { todayStr, addDays } from './events.js';
import { activeHabits } from './habits.js';

export const HORIZON_DAYS = 14;
export const TASK_ID_BASE = 1000;       // 1000..1013 — задачи
export const HABIT_ID_BASE = 2000;      // 2000..2013 — привычки
export const TEST_ID = 9000;

export const atLocal = (ymd, hour) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d, hour, 0, 0).getTime(); };
const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };

export function planReminders(events, now, { taskHour = 9, habitHour = 20 } = {}) {
  const today = todayStr(now);
  const open = events.filter(e => e.type === 'task' && !e.payload.done && e.payload.due);
  const habits = activeHabits(events, today);
  const out = [];
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const day = addDays(today, i);
    if (taskHour >= 0) {
      const dueToday = open.filter(t => t.payload.due === day).length;
      const overdue = i === 0 ? open.filter(t => t.payload.due < today).length : 0;
      const at = atLocal(day, taskHour);
      if ((dueToday || overdue) && at > now) {
        const parts = [];
        if (dueToday) parts.push(`${dueToday} ${plural(dueToday, 'задача', 'задачи', 'задач')} на сегодня`);
        if (overdue) parts.push(`просрочено: ${overdue}`);
        out.push({ id: TASK_ID_BASE + i, at, title: 'Life OS', body: parts.join(', ') });
      }
    }
    if (habitHour >= 0 && habits.length) {
      const at = atLocal(day, habitHour);
      const pending = i === 0 ? habits.filter(h => !h.st.doneToday).length : habits.length;
      if (pending && at > now) out.push({ id: HABIT_ID_BASE + i, at, title: 'Life OS', body: 'Привычки на сегодня. Минимум тоже считается.' });
    }
  }
  return out;
}
