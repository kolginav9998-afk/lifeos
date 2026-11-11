// Недельный протокол давления: что собрать для врача и что уже собрано. Только счёт и средние, без оценок и диагнозов.
import { addDays } from './events.js';
import { measuresOf } from './health.js';

export const BP_HOWTO = [
  'Утром (до кофе и таблеток) и вечером, примерно в одно время.',
  'Перед замером посиди спокойно 5 минут: спина опирается, ноги стоят на полу, рука лежит на уровне сердца.',
  'Сделай два замера подряд с паузой в одну минуту. Записывай оба.',
  'Обычно такой схемы придерживаются 7 дней подряд. Сколько и как именно мерить именно тебе, уточни у врача.',
];
export const part = time => { if (!time) return 'unknown'; const h = Number(String(time).split(':')[0]); return h < 12 ? 'morning' : h >= 17 ? 'evening' : 'day'; };
const avg = rows => (rows.length ? { n: rows.length, sys: Math.round(rows.reduce((s, e) => s + e.payload.value, 0) / rows.length), dia: Math.round(rows.reduce((s, e) => s + e.payload.value2, 0) / rows.length) } : null);

export function bpProtocol(events, today, days = 7) {
  const from = addDays(today, -(days - 1));
  const rows = measuresOf(events, 'bp').filter(e => e.payload.date >= from && e.payload.date <= today);
  if (!rows.length) return null;
  const byDay = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i), r = rows.filter(e => e.payload.date === date);
    const morning = r.filter(e => part(e.payload.time) === 'morning').length, evening = r.filter(e => part(e.payload.time) === 'evening').length;
    byDay.push({ date, n: r.length, morning, evening, complete: morning >= 2 && evening >= 2 });
  }
  const daysWithData = byDay.filter(d => d.n).length;
  return {
    from, to: today, readings: rows.length, daysWithData, completeDays: byDay.filter(d => d.complete).length, byDay,
    avgAll: avg(rows), avgMorning: avg(rows.filter(e => part(e.payload.time) === 'morning')), avgEvening: avg(rows.filter(e => part(e.payload.time) === 'evening')),
    untimed: rows.filter(e => part(e.payload.time) === 'unknown').length, enough: rows.length >= 12 && daysWithData >= 4,
  };
}
