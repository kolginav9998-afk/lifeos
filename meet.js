// Встречи (R4.3): предложение, ответ и подтверждение через переписку. Чистая логика: без интерфейса, сети и хранилища.
// Протокол (внутри зашифрованных сообщений, см. docs/SOCIAL_API.md, разделы 4 и 5):
//   kind 'meet'        { meet: { id, type, title, note?, window: { from, to }, times: ['18:00', …] | { from, to, step }, places: [{ id, name, hint?, icon? }], allowOther, duration? } }
//   kind 'meet-reply'  { meetId, status: 'accepted' | 'declined' | 'counter', date?, time?, placeId?, other?, comment? }   (отвечает приглашённый)
//   kind 'meet-status' { meetId, status: 'confirmed' | 'cancelled', note? }                                              (решает автор; отменить может и приглашённый)
// Каждое сообщение ещё содержит { v: 1, id, kind, ts }. Из упорядоченного списка сообщений meetingsFromMessages собирает текущее состояние
// каждой встречи; подделать чужой ответ нельзя: роль определяется по отправителю (его проверяет сервер), а содержимое сверяется с предложением.
import { todayStr, addDays, daysBetween, isYmd } from './events.js';
import { APP_NAME } from './config.js';
import { fold } from './ics.js';
import { dateLong, dayMonthText, normTime, toMin, fmtTime, WEEKDAYS_SHORT, dowMon } from './schedule.js';

export const MEET_TYPES = [
  { key: 'date', title: 'Свидание', short: 'Свидание', icon: 'heart', mood: 'romantic', ask: 'позвать на свидание', intro: 'Выбери места, где хочешь побывать вместе, и дни, когда тебе удобно.' },
  { key: 'business', title: 'Деловая встреча', short: 'Дело', icon: 'target', mood: 'business', ask: 'назначить деловую встречу', intro: 'Предложи несколько вариантов времени и места: собеседник выберет.' },
  { key: 'friends', title: 'Встреча с друзьями', short: 'Друзья', icon: 'users', mood: 'friends', ask: 'позвать на встречу', intro: 'Куда пойдём и когда соберёмся?' },
  { key: 'family', title: 'Семейная встреча', short: 'Семья', icon: 'home', mood: 'family', ask: 'позвать на семейную встречу', intro: 'Выбери день, время и место для семьи.' },
  { key: 'other', title: 'Другая встреча', short: 'Встреча', icon: 'calendar', mood: 'other', ask: 'назначить встречу', intro: 'Опиши встречу и предложи варианты.' },
];
export const meetTypeById = key => MEET_TYPES.find(t => t.key === key) ?? MEET_TYPES[MEET_TYPES.length - 1];

export const MAX_PLACES = 8, MAX_WINDOW_DAYS = 60, MAX_TIMES = 24, MAX_TITLE = 60, MAX_NOTE = 300, MAX_PLACE = 60, MAX_HINT = 100, MAX_COMMENT = 300;
export const DEFAULT_TIMES = { from: '17:00', to: '22:00', step: 30 };
export const STATUS_TEXT = { proposed: 'Ждёт ответа', answered: 'Ответ получен, ждёт подтверждения', confirmed: 'Подтверждена', declined: 'Отклонена', cancelled: 'Отменена' };

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const bad = msg => { throw new Error(msg); };

// Список времён из списка 'HH:MM' или из диапазона { from, to, step } (шаг в минутах: 15, 30, 60).
export function timesFromSpec(spec) {
  let out = [];
  if (Array.isArray(spec)) out = spec.map(normTime).filter(Boolean);
  else if (spec && typeof spec === 'object') {
    const a = toMin(spec.from), b = toMin(spec.to), step = Number(spec.step);
    if (a === null || b === null || !Number.isInteger(step) || step < 15 || step > 240 || b < a) return [];
    for (let m = a; m <= b; m += step) out.push(fmtTime(m));
  }
  return [...new Set(out)].sort();
}
export function datesIn(window) {
  if (!window || !isYmd(window.from) || !isYmd(window.to) || window.to < window.from) return [];
  const n = daysBetween(window.from, window.to);
  return Array.from({ length: Math.min(n, MAX_WINDOW_DAYS) + 1 }, (_, i) => addDays(window.from, i));
}

// Проверка и приведение предложения встречи. Возвращает чистую копию или бросает Error с понятным русским текстом.
// today = null: проверяются только форма и пределы, но не «не в прошлом» (так разбираются уже полученные сообщения).
export function checkProposal(raw, today = todayStr()) {
  if (!raw || typeof raw !== 'object') bad('Нет данных о встрече');
  const type = MEET_TYPES.some(t => t.key === raw.type) ? raw.type : bad('Выбери, что за встреча');
  const title = clean(raw.title, MAX_TITLE) || bad('Назови встречу');
  const note = clean(raw.note, MAX_NOTE);
  const w = raw.window;
  if (!w || !isYmd(w.from) || !isYmd(w.to)) bad('Укажи, из каких дат можно выбрать');
  if (w.to < w.from) bad('Последняя дата раньше первой');
  if (today !== null && w.from < today) bad('Первая дата уже прошла');
  if (daysBetween(w.from, w.to) > MAX_WINDOW_DAYS) bad(`Выбор дат не длиннее ${MAX_WINDOW_DAYS} суток`);
  const times = timesFromSpec(raw.times);
  if (!times.length) bad('Укажи хотя бы одно время');
  if (times.length > MAX_TIMES) bad(`Не больше ${MAX_TIMES} вариантов времени: увеличь шаг`);
  const places = [], seen = new Set();
  for (const p of Array.isArray(raw.places) ? raw.places : []) {
    const name = clean(p?.name, MAX_PLACE);
    if (!name) continue;
    if (seen.has(name.toLowerCase())) bad(`Место «${name}» указано дважды`);
    seen.add(name.toLowerCase());
    places.push({ id: `p${places.length + 1}`, name, ...(clean(p?.hint, MAX_HINT) ? { hint: clean(p.hint, MAX_HINT) } : {}), ...(clean(p?.icon, 20) ? { icon: clean(p.icon, 20) } : {}) });
  }
  if (!places.length) bad('Добавь хотя бы одно место');
  if (places.length > MAX_PLACES) bad(`Не больше ${MAX_PLACES} мест`);
  const duration = raw.duration === undefined || raw.duration === null || raw.duration === '' ? undefined : Number(raw.duration);
  if (duration !== undefined && !(Number.isInteger(duration) && duration >= 15 && duration <= 720)) bad('Длительность: от 15 минут до 12 часов');
  return { id: String(raw.id ?? ''), type, title, ...(note ? { note } : {}), window: { from: w.from, to: w.to }, times, places, allowOther: !!raw.allowOther, ...(duration ? { duration } : {}) };
}

// Ответ приглашённого, сверенный с предложением. accepted: дата, время и место только из предложенного (своё место, если разрешено);
// counter: своя дата и время (в пределах года вперёд) и место на выбор; declined: только комментарий.
export function checkReply(proposal, raw, today = todayStr()) {
  if (!raw || typeof raw !== 'object') bad('Нет ответа');
  const status = ['accepted', 'declined', 'counter'].includes(raw.status) ? raw.status : bad('Непонятный ответ');
  const comment = clean(raw.comment, MAX_COMMENT);
  if (status === 'declined') return { status, ...(comment ? { comment } : {}) };
  const date = isYmd(raw.date) ? raw.date : bad('Выбери дату');
  const time = normTime(raw.time) ?? bad('Выбери время');
  if (status === 'accepted') {
    if (!datesIn(proposal.window).includes(date)) bad('Эта дата вне предложенных');
    if (!proposal.times.includes(time)) bad('Это время не из предложенных');
  } else {
    if (today !== null && date < today) bad('Эта дата уже прошла');
    if (today !== null && daysBetween(today, date) > 366) bad('Слишком далёкая дата: не дальше года');
  }
  let placeId = null, other = '';
  if (raw.placeId) {
    placeId = proposal.places.some(p => p.id === raw.placeId) ? raw.placeId : bad('Такого места нет в списке');
  } else if (clean(raw.other, MAX_PLACE)) {
    if (!proposal.allowOther && status === 'accepted') bad('Выбери одно из предложенных мест');
    other = clean(raw.other, MAX_PLACE);
  } else bad('Выбери место');
  return { status, date, time, ...(placeId ? { placeId } : { other }), ...(comment ? { comment } : {}) };
}

// ---------- сообщения ----------
const envelope = (kind, id, ts) => ({ v: 1, id, kind, ts });
export const proposalMessage = (proposal, id, ts, meetId) => ({ ...envelope('meet', id, ts), meet: { ...proposal, id: meetId } });
export const replyMessage = (meetId, reply, id, ts) => ({ ...envelope('meet-reply', id, ts), meetId, ...reply });
export const statusMessage = (meetId, status, id, ts, note = '') => ({ ...envelope('meet-status', id, ts), meetId, status, ...(clean(note, MAX_COMMENT) ? { note: clean(note, MAX_COMMENT) } : {}) });

// Собирает состояние встреч из расшифрованных сообщений одной переписки.
// messages: [{ from, to, ts, seq?, body }], body — расшифрованный объект сообщения. Порядок: по ts, затем по seq. Некорректное и чужое молча пропускается.
// Возвращает массив встреч, новые сверху: { id, type, title, note, host, guest, proposal, status, reply, when: { date, time } | null, place: { id?, name } | null, updatedAt, ts }.
export function meetingsFromMessages(messages, today = todayStr()) {
  const list = [...messages].filter(m => m?.body && typeof m.body === 'object' && m.body.v === 1)
    .sort((a, b) => (a.ts - b.ts) || ((a.seq ?? 0) - (b.seq ?? 0)));
  const byId = new Map();
  for (const m of list) {
    const b = m.body;
    try {
      if (b.kind === 'meet') {
        const id = String(b.meet?.id ?? '');
        if (!id || byId.has(id)) continue;
        const p = checkProposal({ ...b.meet }, null);                      // проверка устройства автора уже была; здесь только форма
        byId.set(id, { id, type: p.type, title: p.title, note: p.note ?? '', host: m.from, guest: m.to, proposal: { ...p, id }, status: 'proposed', reply: null, when: null, place: null, updatedAt: m.ts, ts: m.ts });
      } else if (b.kind === 'meet-reply') {
        const mt = byId.get(String(b.meetId));
        if (!mt || m.from !== mt.guest || !['proposed', 'answered'].includes(mt.status)) continue;
        const r = checkReply(mt.proposal, b, null);
        mt.reply = r; mt.updatedAt = m.ts;
        if (r.status === 'declined') { mt.status = 'declined'; mt.when = null; mt.place = null; }
        else { mt.status = 'answered'; mt.when = { date: r.date, time: r.time }; mt.place = r.placeId ? { id: r.placeId, name: mt.proposal.places.find(p => p.id === r.placeId).name } : { name: r.other }; }
      } else if (b.kind === 'meet-status') {
        const mt = byId.get(String(b.meetId));
        if (!mt) continue;
        if (b.status === 'confirmed' && m.from === mt.host && mt.status === 'answered') { mt.status = 'confirmed'; mt.updatedAt = m.ts; }
        else if (b.status === 'cancelled' && (m.from === mt.host || m.from === mt.guest) && ['proposed', 'answered', 'confirmed'].includes(mt.status)) { mt.status = 'cancelled'; mt.updatedAt = m.ts; mt.cancelledBy = m.from; }
      }
    } catch { /* сообщение не по правилам: пропускаем */ }
  }
  return [...byId.values()].sort((a, b) => b.ts - a.ts);
}

// Что делать человеку сейчас: 'answer' (мне ответить), 'confirm' (мне подтвердить), 'wait' (ждать другого), 'none'.
export function myTurn(mt, me) {
  if (mt.status === 'proposed') return me === mt.guest ? 'answer' : 'wait';
  if (mt.status === 'answered') return me === mt.host ? 'confirm' : 'wait';
  return 'none';
}
// Встреча в календаре (подтверждённая и ещё не прошедшая).
export const isUpcoming = (mt, today = todayStr()) => mt.status === 'confirmed' && !!mt.when && mt.when.date >= today;

// ---------- подписи ----------
export const whenText = when => (when ? `${dayMonthText(when.date)}, ${['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'][dowMon(when.date)]}, ${when.time}` : '');
export function describeMeeting(mt, me) {
  const t = meetTypeById(mt.type), turn = myTurn(mt, me), other = me === mt.host ? mt.guest : mt.host;
  const status = STATUS_TEXT[mt.status];
  const hint = { answer: 'Выбери дату, время и место.', confirm: 'Посмотри ответ и подтверди встречу.', wait: me === mt.host ? 'Ждём ответа.' : 'Ждём подтверждения.', none: '' }[turn];
  return { title: mt.title, kind: t.title, icon: t.icon, mood: t.mood, other, status, statusKey: mt.status, turn, hint, when: whenText(mt.when), where: mt.place?.name ?? '', role: me === mt.host ? 'host' : 'guest' };
}

// Запись для журнала пользователя (тип meeting, id mt:<meetId>, заменяемая): по ней встреча видна в «Сегодня» и в календаре.
export function meetingRecord(mt, me) {
  const d = describeMeeting(mt, me);
  return { id: `mt:${mt.id}`, type: 'meeting', ts: mt.ts, payload: { meetId: mt.id, with: d.other, role: d.role, type: mt.type, title: mt.title, status: mt.status, when: mt.when ?? null, place: mt.place?.name ?? '', note: mt.note ?? '', duration: mt.proposal.duration ?? 0, updatedAt: mt.updatedAt }, source: 'chat', confidence: 1, evidence: [] };
}

// Календарь (.ics) для подтверждённой встречи: открывается в любом календаре. Время местное (плавающее), без часового пояса.
const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
export function meetingToIcs(mt, me, { now = Date.now() } = {}) {
  if (!mt.when) throw new Error('У встречи ещё нет даты');
  const d = describeMeeting(mt, me), start = `${mt.when.date.replace(/-/g, '')}T${mt.when.time.replace(':', '')}00`;
  const dur = mt.proposal.duration ?? 120, startMin = toMin(mt.when.time), endTotal = startMin + dur;
  const endDate = addDays(mt.when.date, Math.floor(endTotal / 1440)), end = `${endDate.replace(/-/g, '')}T${fmtTime(endTotal % 1440).replace(':', '')}00`;
  const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kompas//RU', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${APP_NAME}`, 'BEGIN:VEVENT', `UID:meet-${mt.id}@lifeos`, `DTSTAMP:${stamp}`,
    `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${esc(`${mt.title} (${d.other})`)}`];
  if (d.where) L.push(`LOCATION:${esc(d.where)}`);
  if (mt.note) L.push(`DESCRIPTION:${esc(mt.note)}`);
  L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(mt.title)}`, 'TRIGGER:-PT1H', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

// Предложенные даты по неделям для календаря выбора: [[{ date, enabled }|null × 7], …], неделя с понедельника.
export function pickerWeeks(window) {
  const dates = datesIn(window);
  if (!dates.length) return [];
  const lead = dowMon(dates[0]), cells = [...Array(lead).fill(null), ...dates.map(date => ({ date, enabled: true }))];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}
export { WEEKDAYS_SHORT, dateLong };
