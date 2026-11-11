// План локальных напоминаний. Чистая функция: из данных получает список уведомлений на ближайшие дни.
// Текст уведомлений общий, без названий задач: уведомления видны на экране блокировки и лежат вне шифрования приложения.
import { todayStr, addDays } from './events.js';
import { activeHabits } from './habits.js';
import { isSick } from './sick.js';

export const HORIZON_DAYS = 14;
export const TASK_ID_BASE = 1000;       // 1000..1013 — задачи
export const HABIT_ID_BASE = 2000;      // 2000..2013 — привычки
export const EVENING_ID_BASE = 3000;    // 3000..3013 — вечерняя отметка и повторение
export const BEDTIME_ID_BASE = 4000;   // 4000..4013 — подготовка ко сну
export const WEEKLY_ID_BASE = 5000;    // 5000..5013 — итоги недели (воскресенье)
export const TEST_ID = 9000;

export const atLocal = (ymd, hour, minute = 0) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d, hour, minute, 0).getTime(); };
const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };

export function planReminders(events, now, { taskHour = 9, habitHour = 20, eveningHour = -1, bedtimeMin = -1, weeklyHour = -1 } = {}) {
  const today = todayStr(now);
  const open = events.filter(e => e.type === 'task' && !e.payload.done && e.payload.due);
  const habits = activeHabits(events, today);
  const sickNow = isSick(events, today);                  // в режиме болезни молчат привычки и вечерняя отметка
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
    if (habitHour >= 0 && habits.length && !sickNow) {
      const at = atLocal(day, habitHour);
      const pending = i === 0 ? habits.filter(h => !h.st.doneToday).length : habits.length;
      if (pending && at > now) out.push({ id: HABIT_ID_BASE + i, at, title: 'Life OS', body: 'Привычки на сегодня. Минимум тоже считается.' });
    }
    if (bedtimeMin >= 0) {
      const at = atLocal(day, Math.floor(bedtimeMin / 60), bedtimeMin % 60);
      if (at > now) out.push({ id: BEDTIME_ID_BASE + i, at, title: 'Life OS', body: 'Пора готовиться ко сну: экран подальше, свет приглушить.' });
    }
    if (weeklyHour >= 0) {
      const [y, m, d] = day.split('-').map(Number);
      const at = atLocal(day, weeklyHour);
      if (new Date(y, m - 1, d, 12).getDay() === 0 && at > now) out.push({ id: WEEKLY_ID_BASE + i, at, title: 'Life OS', body: 'Воскресенье: итоги недели и план на следующую.' });
    }
    if (eveningHour >= 0 && !sickNow) {
      const at = atLocal(day, eveningHour);
      const marked = i === 0 && events.some(e => e.type === 'checkin' && e.payload.date === day && e.payload.slot === 'e');
      if (!marked && at > now) out.push({ id: EVENING_ID_BASE + i, at, title: 'Life OS', body: 'Вечер: отметка дня и пара карточек на повторение.' });
    }
  }
  return out;
}
