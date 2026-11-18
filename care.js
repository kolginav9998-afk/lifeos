// Забота и анти-перегрузка: мягкая проверка себя раз в две недели, возвращение после болезни,
// перенос необязательных дел одним нажатием, ближайшие выходные и счётчик входящих задач.
// Чистая логика без DOM и без настроек: экран передаёт даты строками 'YYYY-MM-DD'.
import { isYmd, addDays, daysBetween, todayStr } from './events.js';
import { sickRanges } from './sick.js';

export const CHECKUP_EVERY_DAYS = 14;      // «проверь себя» — не чаще раза в две недели
export const EMERGENCY_EVERY_DAYS = 182;   // экстренные данные перепроверяем раз в полгода
export const SICK_LONG_DAYS = 3;           // болезнь дольше трёх дней — повод мягко предложить врача
export const INFLOW_NUDGE_FROM = 3;        // после третьей новой задачи за день — тихий вопрос
export const DOCTOR_TASK_TEXT = 'Записаться к врачу после болезни';
export const BAD_PLAN_MAX = 600;           // предел текста плана на плохой день

// ---------- «проверь себя»: три мягкие отметки без цифр ----------
export const CHECKUP_AREAS = [['body', 'Тело'], ['head', 'Голова'], ['things', 'Дела']];
export const CHECKUP_MARKS = ['ok', 'so', 'hard'];
export const CHECKUP_MARK_TEXT = { ok: 'в порядке', so: 'так себе', hard: 'тяжело' };

// Отметки либо заполнены все три и только известными значениями, либо не считаются.
export function cleanCheckupMarks(input) {
  const out = {};
  for (const [k] of CHECKUP_AREAS) { const v = input?.[k]; if (CHECKUP_MARKS.includes(v)) out[k] = v; }
  return Object.keys(out).length === CHECKUP_AREAS.length ? out : null;
}

// Пора спросить, если отметки ещё не было ни разу или прошло две недели.
export function checkupDue(lastDate, today) {
  if (!isYmd(today)) throw new Error('bad date');
  if (!lastDate) return true;
  if (!isYmd(lastDate)) return false;      // повреждённую дату не считаем поводом для напоминания
  return daysBetween(lastDate, today) >= CHECKUP_EVERY_DAYS;
}

// ---------- мягкое возвращение после болезни ----------
// Первый день после завершённого периода болезни: вчера период закрылся.
export function sickReturnDay(events, today) {
  if (!isYmd(today)) throw new Error('bad date');
  const r = sickRanges(events).filter(x => x.to && addDays(x.to, 1) === today).sort((a, b) => b.to.localeCompare(a.to))[0];
  return r ? events.find(e => e.id === r.id) ?? null : null;
}

// Долгая болезнь: от начала до конца больше трёх дней. Открытый период не считается завершённым.
export function sickLong(ev) {
  const p = ev?.payload;
  if (!p?.from || !p?.to) return false;
  return daysBetween(p.from, p.to) >= SICK_LONG_DAYS;
}

// ---------- экстренные данные: раз в полгода ----------
export function emergencyReviewDue(lastChecked, today) {
  if (!isYmd(today)) throw new Error('bad date');
  if (!lastChecked) return true;
  if (!isYmd(lastChecked)) return false;
  return daysBetween(lastChecked, today) >= EMERGENCY_EVERY_DAYS;
}

// ---------- «пережить день» ----------
// Необязательные (не важные) незакрытые дела, которые горят сегодня или просрочены.
export function surviveTasks(events, today) {
  return events.filter(e => e.type === 'task' && !e.payload.done && e.payload.priority !== 'high' && e.payload.due && e.payload.due <= today);
}

// ---------- чип «на выходные» ----------
// Ближайшая суббота; в субботу и воскресенье — следующая (чип про будущее, не про сегодня).
export function nextWeekend(today) {
  if (!isYmd(today)) throw new Error('bad date');
  const [y, m, d] = today.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();          // 0 — воскресенье … 6 — суббота
  return addDays(today, (6 - dow + 7) % 7 || 7);
}

// ---------- мягкий счётчик входящих ----------
// Сколько новых задач появилось сегодня (по дате создания записи).
export function newTasksToday(events, today) {
  return events.filter(e => e.type === 'task' && todayStr(e.ts) === today).length;
}
