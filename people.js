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

export function makePerson({ name, birthday = '', cadenceDays = 0, note = '', importantDate = '', importantLabel = '' }, now = Date.now()) {
  const n = clean(name, 60);
  if (!n) throw new Error('Напиши имя');
  const b = parseBirthday(birthday);
  const c = Number(cadenceDays) || 0;
  if (!CADENCES.some(([v]) => v === c)) throw new Error('Выбери, как часто общаться');
  return { id: `pp:${newId()}`, type: 'person', ts: now, source: 'manual', confidence: 1, evidence: [],
    payload: { name: n, birthday: b?.md ?? null, birthYear: b?.year ?? null, cadenceDays: c, lastContact: null, note: clean(note, 500), createdDate: todayStr(now),
      importantDate: parseImportant(importantDate), importantLabel: clean(importantLabel, 60) } };
}

// Важная дата близкого: «12.03» — ежегодная (хранится 'MM-DD'), «12.03.2020» или «2020-03-12» — разовая. Пустая строка — null.
export function parseImportant(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  let d, m, y = null, mt;
  if ((mt = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?$/.exec(s))) { d = +mt[1]; m = +mt[2]; y = mt[3] ? +mt[3] : null; }
  else if ((mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else throw new Error('Важная дата: например 12.03 или 12.03.2020');
  const dim = new Date(2024, m, 0).getDate();                       // високосный год: 29 февраля допустим
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= dim)) throw new Error('Такой даты нет');
  const md = `${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (y === null) return md;
  if (y < 1900 || y > 2100) throw new Error('Год указан неверно');
  return `${y}-${md}`;
}
export const updateImportant = (p, date, label) => ({ ...p, payload: { ...p.payload, importantDate: parseImportant(date), importantLabel: clean(label, 60) } });
export const markContact = (p, date) => { if (!isYmd(date)) throw new Error('bad date'); return { ...p, payload: { ...p.payload, lastContact: date } }; };
export const updateNote = (p, note) => ({ ...p, payload: { ...p.payload, note: clean(note, 500) } });
export const peopleOf = events => events.filter(e => e.type === 'person').sort((a, b) => a.payload.name.localeCompare(b.payload.name));

// ---------- журнал контактов ----------
// Каждый контакт: {date, channel, topic} — «о чём говорили» помогает начать следующий разговор.
// Журнал живёт в записи человека (опциональное поле contacts), старые записи без него читаются как раньше.
export const CHANNELS = [['call', 'Звонок'], ['msg', 'Сообщение'], ['meet', 'Встреча вживую']];
export const CHANNEL_LABEL = Object.fromEntries(CHANNELS);
const CHANNEL_SET = new Set(CHANNELS.map(([k]) => k));
export const MAX_CONTACTS = 50;                                  // храним последние 50, старые стираются молча

// Записать контакт: дата, канал и тема. Поднимает lastContact, а для встречи ещё и lastMeet.
export function logContact(p, { date, channel, topic = '' }) {
  if (!isYmd(date)) throw new Error('bad date');
  if (!CHANNEL_SET.has(channel)) throw new Error('Выбери, как общались');
  const entry = { date, channel, topic: clean(topic, 200) };
  const prev = Array.isArray(p.payload.contacts) ? p.payload.contacts.filter(c => isYmd(c?.date) && CHANNEL_SET.has(c?.channel)) : [];
  const contacts = [...prev, entry].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_CONTACTS);
  const payload = { ...p.payload, contacts };
  if (!payload.lastContact || date > payload.lastContact) payload.lastContact = date;
  if (channel === 'meet' && (!payload.lastMeet || date > payload.lastMeet)) payload.lastMeet = date;
  return { ...p, payload };
}
// «Встретились вживую» — отдельно от «написал»: это другой вид близости.
export const markMeet = (p, date) => logContact(p, { date, channel: 'meet' });
// Журнал контактов, новые сверху.
export const contactsOf = p => (Array.isArray(p.payload?.contacts) ? p.payload.contacts : [])
  .filter(c => isYmd(c?.date) && CHANNEL_SET.has(c?.channel)).slice().sort((a, b) => b.date.localeCompare(a.date));
// Тема последнего разговора, в котором тему записали.
export const lastTopic = p => contactsOf(p).find(c => c.topic)?.topic ?? null;
// Последняя встреча вживую: из поля lastMeet или из журнала (что свежее).
export function lastMeetOf(p) {
  const fromLog = contactsOf(p).find(c => c.channel === 'meet')?.date ?? null;
  const field = p.payload?.lastMeet && isYmd(p.payload.lastMeet) ? p.payload.lastMeet : null;
  return [field, fromLog].filter(Boolean).sort().pop() ?? null;
}
// Сводка для карточки: когда писали, когда виделись вживую, о чём говорили в прошлый раз.
export function contactSummary(p, today) {
  const lc = p.payload?.lastContact && isYmd(p.payload.lastContact) ? p.payload.lastContact : null;
  const lm = lastMeetOf(p);
  return {
    lastContact: lc, daysSinceContact: lc ? daysBetween(lc, today) : null,
    lastMeet: lm, daysSinceMeet: lm ? daysBetween(lm, today) : null,
    lastTopic: lastTopic(p),
  };
}
// С кем давно не виделись вживую: прошло не меньше периода со встречи (или с добавления, если встреч не отмечали).
export function dueMeets(events, today) {
  return peopleOf(events).filter(e => e.payload.cadenceDays > 0).map(e => {
    const lm = lastMeetOf(e);
    return { person: e, days: daysBetween(lm || e.payload.createdDate, today), cadence: e.payload.cadenceDays, never: !lm };
  }).filter(x => x.days >= x.cadence).sort((a, b) => b.days / b.cadence - a.days / a.cadence);
}

// ---------- долги человека ----------
// Связка по имени (или по personId, если долг когда-нибудь получит такое поле): в карточке видны долги этого человека.
const normName = s => String(s ?? '').trim().toLowerCase();
export function personDebts(events, person) {
  const pid = person.id, nm = normName(person.payload?.name);
  const debts = events.filter(e => e.type === 'debt' && e.payload && (e.payload.personId === pid || (!e.payload.personId && normName(e.payload.who) === nm)));
  const left = d => Math.max(0, (d.payload.amountMinor || 0) - (d.payload.paidMinor || 0));
  const open = debts.filter(d => !d.payload.settled);
  const sum = dir => open.filter(d => d.payload.direction === dir).reduce((s, d) => s + left(d), 0);
  return { debts, open, oweMeMinor: sum('owe_me'), iOweMinor: sum('i_owe') };
}

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
// Ближайшая важная дата не раньше today: ежегодная 'MM-DD' повторяется (29 февраля в невисокий год — 28-го), разовая 'YYYY-MM-DD' — только если ещё впереди.
export function nextImportant(p, today) {
  const raw = p.importantDate;
  if (!raw) return null;
  const label = p.importantLabel || '';
  if (raw.length === 10) return raw >= today ? { date: raw, inDays: daysBetween(today, raw), label } : null;
  const [y] = today.split('-').map(Number);
  const [m, d] = raw.split('-').map(Number);
  const at = yy => { const dim = new Date(yy, m, 0).getDate(); return `${yy}-${String(m).padStart(2, '0')}-${String(Math.min(d, dim)).padStart(2, '0')}`; };
  let date = at(y);
  if (date < today) date = at(y + 1);
  return { date, inDays: daysBetween(today, date), label };
}
export function upcomingImportant(events, today, days = 14) {
  return peopleOf(events).map(e => ({ person: e, ...nextImportant(e.payload, today) })).filter(x => x.date && x.inDays <= days).sort((a, b) => a.inDays - b.inDays || a.person.payload.name.localeCompare(b.person.payload.name));
}
// Кому пора написать: прошло не меньше периода с последнего контакта (или с добавления).
export function dueContacts(events, today) {
  return peopleOf(events).filter(e => e.payload.cadenceDays > 0).map(e => {
    const since = e.payload.lastContact || e.payload.createdDate;
    return { person: e, days: daysBetween(since, today), cadence: e.payload.cadenceDays, never: !e.payload.lastContact };
  }).filter(x => x.days >= x.cadence).sort((a, b) => b.days / b.cadence - a.days / a.cadence);
}
export { addDays };
