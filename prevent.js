// Календарь профилактики: плановые осмотры и проверки. Частоту задаёшь сам; реальные сроки определяет твой врач.
import { isYmd, daysBetween, todayStr, newId } from './events.js';

const clean = (s, n) => String(s ?? '').trim().slice(0, n);
export const CHECKUP_TEMPLATES = [
  { name: 'Стоматолог: осмотр и чистка', months: 6 },
  { name: 'Общий осмотр у терапевта', months: 12 },
  { name: 'Проверка зрения', months: 12 },
  { name: 'Анализы крови (по назначению врача)', months: 12 },
  { name: 'Осмотр кожи и родинок', months: 12 },
];
export const CHECKUP_NOTE = 'Частота здесь только ориентир: реальные сроки определяет твой врач, особенно при хронических состояниях. Приложение ничего не диагностирует.';

// Сдвиг даты на n месяцев; день месяца укорачивается до длины месяца (31 января + 1 месяц = 28/29 февраля).
export function addMonths(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = m - 1 + n, yy = y + Math.floor(t / 12), mm = ((t % 12) + 12) % 12;
  const dim = new Date(yy, mm + 1, 0).getDate();
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`;
}

export function makeCheckup({ name, months, last = '' }, now = Date.now()) {
  const n = clean(name, 80);
  if (!n) throw new Error('Назови проверку');
  const m = Math.round(Number(months));
  if (!(m >= 1 && m <= 60)) throw new Error('Как часто: от 1 до 60 месяцев');
  const l = last ? String(last) : '';
  if (l && !isYmd(l)) throw new Error('Дата указана неверно');
  if (l && l > todayStr(now)) throw new Error('Последний раз не может быть в будущем');
  return { id: `chk:${newId()}`, type: 'checkup', ts: now, payload: { name: n, months: m, last: l || null, createdDate: todayStr(now) }, source: 'manual', confidence: 1, evidence: [] };
}
export function markCheckup(ev, date) {
  if (!isYmd(date)) throw new Error('bad date');
  return { ...ev, payload: { ...ev.payload, last: date } };
}
export function updateCheckup(ev, { name, months }) {
  const n = clean(name, 80), m = Math.round(Number(months));
  if (!n) throw new Error('Назови проверку');
  if (!(m >= 1 && m <= 60)) throw new Error('Как часто: от 1 до 60 месяцев');
  return { ...ev, payload: { ...ev.payload, name: n, months: m } };
}
export const checkupsOf = events => events.filter(e => e.type === 'checkup').sort((a, b) => a.payload.name.localeCompare(b.payload.name));

// never — отметки ещё не было (нужна первая дата); overdue — срок прошёл; soon — в ближайшие 30 дней; ok — всё в порядке.
export function checkupStatus(ev, today) {
  const p = ev.payload;
  if (!p.last) return { state: 'never', due: p.createdDate, daysLeft: daysBetween(today, p.createdDate) };
  const due = addMonths(p.last, p.months), left = daysBetween(today, due);
  return { state: left < 0 ? 'overdue' : left <= 30 ? 'soon' : 'ok', due, daysLeft: left };
}
export const checkupsDue = (events, today) => checkupsOf(events).map(e => ({ ev: e, ...checkupStatus(e, today) })).filter(x => x.state === 'never' || x.state === 'overdue')
  .sort((a, b) => a.daysLeft - b.daysLeft);
