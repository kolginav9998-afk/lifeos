// Проверка данных: находит похожее на ошибки ввода и пропуски, которые портят аналитику. Ничего не меняет — только подсказывает.
import { addDays, daysBetween } from './events.js';
import { checkinOf, sleepFromTimes } from './diary.js';
import { dailySeries } from './health.js';
import { activeHabits, logsOf } from './habits.js';
import { runsOf } from './bt-core.js';
import { unknownTypes } from './registry.js';

const list = (a, n = 5) => a.slice(0, n).join(', ') + (a.length > n ? ` и ещё ${a.length - n}` : '');
const fmt = x => String(Math.round(x * 10) / 10).replace('.', ',');

export function dataChecks(events, today) {
  const out = [];
  const add = (id, level, text) => out.push({ id, level, text });
  const morning = events.filter(e => e.type === 'checkin' && e.payload.slot === 'm');

  // сон: невозможные значения и расхождение со временем «лёг/встал»
  const odd = morning.filter(e => Number.isFinite(e.payload.sleepHours) && (e.payload.sleepHours < 2 || e.payload.sleepHours > 14)).map(e => `${e.payload.date} (${fmt(e.payload.sleepHours)} ч)`);
  if (odd.length) add('sleep-range', 'warn', `Необычная длительность сна (меньше 2 или больше 14 часов): ${list(odd)}. Проверь, не опечатка ли.`);
  const mismatch = morning.filter(e => { const c = sleepFromTimes(e.payload.bed, e.payload.wake); return c !== null && Number.isFinite(e.payload.sleepHours) && Math.abs(c - e.payload.sleepHours) > 1.5; }).map(e => e.payload.date);
  if (mismatch.length) add('sleep-times', 'info', `Сон не совпадает со временем «лёг/встал» больше чем на 1,5 часа: ${list(mismatch)}.`);

  // вес: резкие скачки
  const w = dailySeries(events, 'weight');
  const jumps = [];
  for (let i = 1; i < w.length; i++) if (daysBetween(w[i - 1].date, w[i].date) <= 2 && Math.abs(w[i].value - w[i - 1].value) > 3) jumps.push(`${w[i].date} (${fmt(w[i - 1].value)} → ${fmt(w[i].value)} кг)`);
  if (jumps.length) add('weight-jump', 'warn', `Резкие скачки веса за 1–2 дня (больше 3 кг): ${list(jumps)}. Возможна опечатка.`);

  // расходы: возможные дубли
  const seen = new Map();
  for (const e of events.filter(e => e.type === 'expense')) { const k = `${e.payload.date}|${e.payload.amountMinor}|${e.payload.category}|${e.payload.note}`; seen.set(k, (seen.get(k) || 0) + 1); }
  const dups = [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k.split('|')[0]} ${(Number(k.split('|')[1]) / 100).toLocaleString('ru')} ₽ ×${n}`);
  if (dups.length) add('expense-dups', 'info', `Возможные дубли расходов (одинаковые дата, сумма, категория и примечание): ${list(dups)}.`);

  // задачи и привычки
  const stale = events.filter(e => e.type === 'task' && !e.payload.done && e.payload.due && daysBetween(e.payload.due, today) > 60).length;
  if (stale) add('stale-tasks', 'info', `Задач, просроченных больше 60 дней: ${stale}. Выполни, перенеси или удали — они засоряют список.`);
  const idle = activeHabits(events, today).filter(({ h }) => {
    const last = logsOf(events, h.id).map(l => l.payload.date).sort().at(-1) ?? h.payload.startDate;
    return daysBetween(last, today) > 30;
  }).map(({ h }) => `«${h.payload.name}»`);
  if (idle.length) add('idle-habits', 'info', `Привычки без отметок больше 30 дней: ${list(idle)}. Оставь, измени или убери в архив.`);

  // пропуски отметок при наличии проверок
  const runDates = new Set(runsOf(events).map(r => r.date));
  const from = addDays(today, -29);
  const noMorning = [...runDates].filter(d => d >= from && !checkinOf(events, d, 'm')).length;
  if (noMorning >= 3) add('gaps', 'info', `Проверок без утренней отметки за 30 дней: ${noMorning}. Без отметок сна аналитика не найдёт связей.`);

  // записи незнакомых типов: чаще всего созданы более новой версией приложения
  const unk = unknownTypes(events);
  if (unk.length) add('unknown-types', 'info', `Есть записи незнакомых типов: ${list(unk.map(u => `${u.type} (${u.count})`))}. Скорее всего, их создала более новая версия приложения. Они сохраняются и ничему не мешают; после обновления приложения станут видны.`);

  if (!out.length) add('ok', 'ok', 'Подозрительного не найдено.');
  return out;
}
