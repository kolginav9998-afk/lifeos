// Рефлексия: намерение дня, вечерний обзор, рефлексия недели, журнал решений, копилка радостей.
// Всё это личные тексты: шифруются вместе с остальными данными и не попадают в выгрузку для аналитики.
import { isYmd, addDays, todayStr, newId, daysBetween } from './events.js';
import { dayMood } from './diary.js';

const clean = (s, n) => String(s ?? '').trim().slice(0, n);
const base = (id, type, payload, now, prev = null) => ({ id, type, ts: prev?.ts ?? now, payload: { ...payload, ...(prev ? { editedAt: now } : {}) }, source: 'manual', confidence: 1, evidence: [] });

// Понедельник недели, в которую входит дата: ключ рефлексии недели.
export function weekStart(date) {
  if (!isYmd(date)) throw new Error('bad date');
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay();                       // 0 — воскресенье
  return addDays(date, -((dow + 6) % 7));
}

// ---------- намерение дня ----------
export const intentionId = date => `intent:${date}`;
export function makeIntention(date, text, now = Date.now(), prev = null) {
  if (!isYmd(date)) throw new Error('bad date');
  const t = clean(text, 160);
  if (t.length < 2) throw new Error('Напиши одну строку: что сегодня зависит от тебя');
  return base(intentionId(date), 'intention', { date, text: t }, now, prev);
}
export const intentionOf = (events, date) => events.find(e => e.type === 'intention' && e.id === intentionId(date)) ?? null;

// ---------- вечерний обзор ----------
export const DAY_QUESTIONS = [['win', 'Что получилось сегодня?'], ['miss', 'Что не получилось или мешало?'], ['learn', 'Чему научился и что изменю завтра?']];
export const dayReviewId = date => `dayrev:${date}`;
export function makeDayReview(date, fields, now = Date.now(), prev = null) {
  if (!isYmd(date)) throw new Error('bad date');
  const payload = { date };
  for (const [k] of DAY_QUESTIONS) { const v = clean(fields?.[k], 500); if (v) payload[k] = v; }
  if (Object.keys(payload).length === 1) throw new Error('Ответь хотя бы на один вопрос');
  return base(dayReviewId(date), 'dayreview', payload, now, prev);
}
export const dayReviewOf = (events, date) => events.find(e => e.type === 'dayreview' && e.id === dayReviewId(date)) ?? null;

// ---------- рефлексия недели ----------
export const WEEK_QUESTIONS = [['went', 'Что получилось на этой неделе?'], ['blocked', 'Что мешало?'], ['change', 'Что я изменю на следующей неделе?']];
export const weekReflectionId = date => `wkrev:${weekStart(date)}`;
export function makeWeekReflection(date, fields, now = Date.now(), prev = null) {
  const week = weekStart(date);
  const payload = { week };
  for (const [k] of WEEK_QUESTIONS) { const v = clean(fields?.[k], 600); if (v) payload[k] = v; }
  if (Object.keys(payload).length === 1) throw new Error('Ответь хотя бы на один вопрос');
  return base(weekReflectionId(date), 'weekreflect', payload, now, prev);
}
export const weekReflectionOf = (events, date) => events.find(e => e.type === 'weekreflect' && e.id === weekReflectionId(date)) ?? null;
export const weekReflections = events => events.filter(e => e.type === 'weekreflect').sort((a, b) => b.payload.week.localeCompare(a.payload.week));

// ---------- журнал решений ----------
export const VERDICTS = { better: 'вышло лучше, чем ждал', asExpected: 'вышло примерно как ждал', worse: 'вышло хуже, чем ждал' };
export function makeDecision({ title, why = '', expect = '', revisit } = {}, now = Date.now()) {
  const t = clean(title, 120);
  if (t.length < 3) throw new Error('Опиши решение хотя бы несколькими словами');
  const today = todayStr(now);
  const r = revisit || addDays(today, 30);
  if (!isYmd(r)) throw new Error('Дата возврата указана неверно');
  if (r < today) throw new Error('Вернуться к решению можно не раньше сегодняшнего дня');
  if (daysBetween(today, r) > 730) throw new Error('Слишком далеко: выбери срок до двух лет');
  return base(`dec:${newId()}`, 'decision', { date: today, title: t, why: clean(why, 500), expect: clean(expect, 500), revisit: r, closed: null }, now);
}
export function closeDecision(ev, { verdict, outcome = '' } = {}, now = Date.now()) {
  if (!Object.hasOwn(VERDICTS, verdict)) throw new Error('Выбери, как получилось');
  return { ...ev, payload: { ...ev.payload, closed: { date: todayStr(now), verdict, outcome: clean(outcome, 500) } } };
}
export const reopenDecision = ev => ({ ...ev, payload: { ...ev.payload, closed: null } });
export function decisionsOf(events) {
  const all = events.filter(e => e.type === 'decision');
  return {
    open: all.filter(e => !e.payload.closed).sort((a, b) => a.payload.revisit.localeCompare(b.payload.revisit) || a.ts - b.ts),
    closed: all.filter(e => e.payload.closed).sort((a, b) => b.payload.closed.date.localeCompare(a.payload.closed.date) || b.ts - a.ts),
  };
}
export const decisionsDue = (events, today) => decisionsOf(events).open.filter(e => e.payload.revisit <= today);
export function decisionStats(events) {
  const { closed } = decisionsOf(events);
  if (!closed.length) return null;
  const by = { better: 0, asExpected: 0, worse: 0 };
  for (const e of closed) by[e.payload.closed.verdict]++;
  return { n: closed.length, ...by };
}

// ---------- копилка радостей и «что меня заряжает» ----------
export function makeJoy({ text, date } = {}, now = Date.now()) {
  const t = clean(text, 200);
  if (t.length < 3) throw new Error('Напиши хотя бы несколько слов');
  const d = date || todayStr(now);
  if (!isYmd(d)) throw new Error('bad date');
  return base(`joy:${newId()}`, 'joy', { date: d, text: t }, now);
}
export const joysOf = events => events.filter(e => e.type === 'joy').sort((a, b) => b.payload.date.localeCompare(a.payload.date) || b.ts - a.ts);
// Случайная (но стабильная для одного числа) радость из копилки: для трудного дня.
export const pickJoy = (events, seed = 0) => { const l = joysOf(events); return l.length ? l[Math.abs(Math.trunc(seed)) % l.length] : null; };

export const CHARGER_IDEAS = ['Прогулка 15 минут', 'Позвонить другу', 'Тёплый душ', 'Любимая музыка', 'Выйти на дневной свет', 'Приготовить что-то вкусное', 'Убраться на 10 минут', 'Полежать с закрытыми глазами'];
export function makeCharger(text, now = Date.now()) {
  const t = clean(text, 80);
  if (t.length < 2) throw new Error('Напиши, что тебя заряжает');
  return base(`chg:${newId()}`, 'charger', { text: t }, now);
}
export const chargersOf = events => events.filter(e => e.type === 'charger').sort((a, b) => a.ts - b.ts);

// ---------- мягкое предупреждение о долго низком настроении ----------
// Не диагноз: только наблюдение по твоим отметкам. Показывается, если за 14 дней минимум 8 отметок и почти все низкие.
export const LOW_MOOD_TEXT = 'Последние две недели настроение в твоих отметках держится низким. Такое бывает, и это не слабость. Расскажи о самочувствии близкому человеку. Если это длится больше двух недель или мешает работать и спать, запишись к врачу или психотерапевту. Если приходят мысли навредить себе, сразу обратись в экстренную службу своей страны или к близким.';
export function lowMoodNotice(events, today, { days = 14, minDays = 8 } = {}) {
  const vals = [];
  for (let i = 0; i < days; i++) { const m = dayMood(events, addDays(today, -i)); if (Number.isFinite(m)) vals.push(m); }
  if (vals.length < minDays) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const low = vals.filter(v => v <= 2.5).length;
  return mean <= 2.3 && low / vals.length >= 0.7 ? { n: vals.length, mean, low } : null;
}

// ---------- вечерний ритуал: подготовка ко сну и завершение дня (отметки по дням) ----------
export const RITUAL_STEPS = [
  ['screen', 'Убрать экран за час до сна', 'Подготовка ко сну'], ['light', 'Приглушить свет', 'Подготовка ко сну'], ['breath', 'Пять минут дыхания 4–6 или спокойная музыка', 'Подготовка ко сну'],
  ['close', 'Закрыть или перенести незавершённые дела', 'Завершение дня'], ['plan', 'Выбрать три главных дела на завтра', 'Завершение дня'], ['prep', 'Приготовить вещи на утро', 'Завершение дня'],
];
export const ritualId = date => `ritual:${date}`;
export function makeRitual(date, steps, now = Date.now(), prev = null) {
  if (!isYmd(date)) throw new Error('bad date');
  const known = new Set(RITUAL_STEPS.map(x => x[0]));
  const list = [...new Set((steps ?? []).filter(k => known.has(k)))];
  if (!list.length) throw new Error('Отметь хотя бы один шаг');
  return base(ritualId(date), 'ritual', { date, steps: RITUAL_STEPS.map(x => x[0]).filter(k => list.includes(k)) }, now, prev);
}
export const ritualOf = (events, date) => events.find(e => e.type === 'ritual' && e.id === ritualId(date)) ?? null;
