// Люди и даты: дни рождения и «давно не общались». Данные личные: шифруются вместе со всем остальным и не попадают в выгрузку для анализа.
import { isYmd, addDays, daysBetween, todayStr, newId } from './events.js';

const clean = (s, n) => String(s ?? '').trim().slice(0, n);
export const CADENCES = [[0, 'не напоминать'], [7, 'раз в неделю'], [14, 'раз в 2 недели'], [30, 'раз в месяц'], [60, 'раз в 2 месяца'], [90, 'раз в 3 месяца']];

// «12.03», «12.03.1990», «1990-03-12» → { md: '03-12', year }
export function parseBirthday(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  let d, m, y = null, mt;
  if ((mt = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?$/.exec(s))) { d = +mt[1]; m = +mt[2]; y = mt[3] ? +mt[3] : null; }
  else if ((mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else throw new Error('Дата рождения: например 12.03 или 12.03.1990');
  const dim = new Date(2024, m, 0).getDate();                       // високосный год: 29 февраля допустим
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= dim)) throw new Error('Такой даты нет');
  if (y !== null && (y < 1900 || y > new Date().getFullYear())) throw new Error('Год рождения указан неверно');
  return { md: `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, year: y };
}

export function makePerson({ name, birthday = '', cadenceDays = 0, note = '' }, now = Date.now()) {
  const n = clean(name, 60);
  if (!n) throw new Error('Напиши имя');
  const b = parseBirthday(birthday);
  const c = Number(cadenceDays) || 0;
  if (!CADENCES.some(([v]) => v === c)) throw new Error('Выбери, как часто общаться');
  return { id: `pp:${newId()}`, type: 'person', ts: now, source: 'manual', confidence: 1, evidence: [],
    payload: { name: n, birthday: b?.md ?? null, birthYear: b?.year ?? null, cadenceDays: c, lastContact: null, note: clean(note, 500), createdDate: todayStr(now) } };
}
export const markContact = (p, date) => { if (!isYmd(date)) throw new Error('bad date'); return { ...p, payload: { ...p.payload, lastContact: date } }; };
export const updateNote = (p, note) => ({ ...p, payload: { ...p.payload, note: clean(note, 500) } });
export const peopleOf = events => events.filter(e => e.type === 'person').sort((a, b) => a.payload.name.localeCompare(b.payload.name));

// Ближайший день рождения не раньше today. 29 февраля в невисокий год отмечаем 28-го.
export function nextBirthday(p, today) {
  if (!p.birthday) return null;
  const [y] = today.split('-').map(Number);
  const [m, d] = p.birthday.split('-').map(Number);
  const at = yy => { const dim = new Date(yy, m, 0).getDate(); return `${yy}-${String(m).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`; };
  let date = at(y);
  if (date < today) date = at(y + 1);
  const yr = Number(date.slice(0, 4));
  return { date, inDays: daysBetween(today, date), age: p.birthYear ? yr - p.birthYear : null };
}
export function upcomingBirthdays(events, today, days = 14) {
  return peopleOf(events).map(e => ({ person: e, ...nextBirthday(e.payload, today) })).filter(x => x.date && x.inDays <= days).sort((a, b) => a.inDays - b.inDays || a.person.payload.name.localeCompare(b.person.payload.name));
}
// Кому пора написать: прошло не меньше периода с последнего контакта (или с добавления).
export function dueContacts(events, today) {
  return peopleOf(events).filter(e => e.payload.cadenceDays > 0).map(e => {
    const since = e.payload.lastContact || e.payload.createdDate;
    return { person: e, days: daysBetween(since, today), cadence: e.payload.cadenceDays, never: !e.payload.lastContact };
  }).filter(x => x.days >= x.cadence).sort((a, b) => b.days / b.cadence - a.days / a.cadence);
}
export { addDays };
