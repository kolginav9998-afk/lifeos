// Календарь (iCalendar, .ics): открытые задачи со сроками и повторами, списания подписок. Файл можно открыть в любом календаре.
// Названия задач попадают в файл, поэтому делится им человек сам: приложение ничего не отправляет по сети.
import { APP_NAME } from './config.js';
import { addDays, isYmd } from './events.js';
import { subsOf, nextCharge } from './planning.js';

const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const dt = ymd => ymd.replace(/-/g, '');
const enc = new TextEncoder();
const monthDay = d => (d >= 31 ? -1 : d);        // «31 число» — это последний день месяца, иначе короткие месяцы пропускаются

// Складывание строк по правилам RFC 5545: не больше 75 байт в строке, продолжение начинается с пробела; символ UTF-8 не разрезается.
export function fold(line) {
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 75; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}
const stamp = now => new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

export function tasksToIcs(events, { now = Date.now(), today } = {}) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kompas//RU', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${APP_NAME}`];
  const ds = stamp(now);
  let n = 0;
  const open = events.filter(e => e.type === 'task' && !e.payload.done && isYmd(e.payload.due)).sort((a, b) => a.payload.due.localeCompare(b.payload.due) || a.ts - b.ts);
  for (const t of open) {
    const p = t.payload;
    L.push('BEGIN:VEVENT', `UID:task-${t.id}@lifeos`, `DTSTAMP:${ds}`, `DTSTART;VALUE=DATE:${dt(p.due)}`, `DTEND;VALUE=DATE:${dt(addDays(p.due, 1))}`, `SUMMARY:${esc(p.text)}`);
    if (p.repeat?.type === 'daily') L.push('RRULE:FREQ=DAILY');
    else if (p.repeat?.type === 'weekly') L.push('RRULE:FREQ=WEEKLY');
    else if (p.repeat?.type === 'monthly') L.push(`RRULE:FREQ=MONTHLY;BYMONTHDAY=${monthDay(p.repeat.day ?? Number(p.due.slice(8)))}`);
    if (p.priority === 'high') L.push('PRIORITY:1');
    L.push('TRANSP:TRANSPARENT', 'END:VEVENT');
    n++;
  }
  const day = today || new Date(now).toISOString().slice(0, 10);
  for (const s of subsOf(events).filter(x => x.payload.active)) {
    const p = s.payload, next = nextCharge(p, day);
    L.push('BEGIN:VEVENT', `UID:sub-${s.id}@lifeos`, `DTSTAMP:${ds}`, `DTSTART;VALUE=DATE:${dt(next)}`, `DTEND;VALUE=DATE:${dt(addDays(next, 1))}`, `SUMMARY:${esc('Списание: ' + p.name)}`,
      p.period === 'year' ? 'RRULE:FREQ=YEARLY' : `RRULE:FREQ=MONTHLY;BYMONTHDAY=${monthDay(p.day)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
    n++;
  }
  L.push('END:VCALENDAR');
  return { text: L.map(fold).join('\r\n') + '\r\n', count: n };
}
