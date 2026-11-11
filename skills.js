// Навыки: то, что ты точно изучил или научился делать. Запись `skill`: название, область, уровень, дата, откуда взялся (урок, вручную).
// Из уроков навык предлагается, когда урок пройден и большая часть его карточек выучена (интервал повторения 14 дней и больше).
// Это честный признак «точно изучил»: одной отметки «пройден» для него мало. Чистая логика.
import { isYmd, todayStr, newId } from './events.js';
import { TRACKS, trackById, doneLessons, lessonGoal, statesOf } from './academy.js';
import { MASTERED_BOX } from './srs.js';

export const LEVELS = { 1: 'Знаю', 2: 'Умею', 3: 'Уверенно' };
export const LEVEL_HINT = { 1: 'понимаю и могу объяснить своими словами', 2: 'могу сделать самостоятельно', 3: 'делаю свободно и могу научить другого' };
export const SOURCES = { lesson: 'урок и карточки', manual: 'вручную' };
export const MASTERY_SHARE = 0.8;                       // доля выученных карточек урока, после которой навык считается освоенным
export const OTHER_AREA = 'Другое';
export const AREA_SUGGESTIONS = ['Работа', 'Дом и быт', 'Спорт', 'Творчество', 'Общение', 'Техника', OTHER_AREA];

const clean = (s, n) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, n);
const cleanNote = (s, n) => String(s ?? '').trim().slice(0, n);
export const lessonSkillId = lessonId => `skill:lesson:${lessonId}`;

export function makeSkill({ title, area = OTHER_AREA, level = 1, date, note = '', evidence = '', source = 'manual', ref = null, id } = {}, now = Date.now()) {
  const t = clean(title, 120);
  if (t.length < 3) throw new Error('Напиши, что ты умеешь, хотя бы в нескольких словах');
  const lv = Number(level);
  if (!Object.hasOwn(LEVELS, lv)) throw new Error('Выбери уровень');
  if (!Object.hasOwn(SOURCES, source)) throw new Error('Неизвестный источник навыка');
  const d = date || todayStr(now);
  if (!isYmd(d)) throw new Error('Дата указана неверно');
  if (d > todayStr(now)) throw new Error('Дата не может быть в будущем');
  return { id: id || `skill:${newId()}`, type: 'skill', ts: now, payload: { title: t, area: clean(area, 40) || OTHER_AREA, level: lv, date: d, source, ref, evidence: cleanNote(evidence, 300), note: cleanNote(note, 300) }, source: 'manual', confidence: source === 'lesson' ? 0.9 : 1, evidence: [] };
}
// Правка не меняет источник, ссылку и подтверждение: только то, что человек может поправить сам.
export function updateSkill(ev, { title, area, level, date, note } = {}, now = Date.now()) {
  const p = ev.payload, next = makeSkill({ title: title ?? p.title, area: area ?? p.area, level: level ?? p.level, date: date ?? p.date, note: note ?? p.note, evidence: p.evidence, source: p.source, ref: p.ref, id: ev.id }, now);
  return { ...ev, payload: { ...next.payload, editedAt: now } };
}
export const setLevel = (ev, level, now = Date.now()) => updateSkill(ev, { level }, now);

export const skillsOf = events => events.filter(e => e.type === 'skill');
// По областям: области по алфавиту («Другое» последней), внутри — выше уровень, потом новее.
export function skillGroups(events) {
  const by = new Map();
  for (const e of skillsOf(events)) { if (!by.has(e.payload.area)) by.set(e.payload.area, []); by.get(e.payload.area).push(e); }
  return [...by].map(([area, items]) => ({ area, items: items.sort((a, b) => b.payload.level - a.payload.level || b.payload.date.localeCompare(a.payload.date) || a.payload.title.localeCompare(b.payload.title)) }))
    .sort((a, b) => (a.area === OTHER_AREA) - (b.area === OTHER_AREA) || a.area.localeCompare(b.area));
}
export function skillStats(events) {
  const all = skillsOf(events), byLevel = { 1: 0, 2: 0, 3: 0 };
  for (const e of all) byLevel[e.payload.level]++;
  return { total: all.length, byLevel, areas: new Set(all.map(e => e.payload.area)).size };
}

// ---------- навыки из уроков ----------
// Прогресс урока: сколько карточек выучено (коробка 4 и выше: повторение раз в две недели и реже).
export function lessonMastery(lesson, events, states = new Map(statesOf(events).map(s => [s.card, s]))) {
  const total = lesson.cards.length;
  let mastered = 0, started = 0;
  for (let i = 0; i < total; i++) { const s = states.get(`${lesson.id}:${i}`); if (s) { started++; if (s.box >= MASTERED_BOX) mastered++; } }
  const needed = Math.max(1, Math.ceil(total * MASTERY_SHARE));
  return { total, started, mastered, needed, ready: total > 0 && mastered >= needed };
}
function evidenceText(track, lesson, m) { return `Урок «${lesson.title}» пройден; выучено карточек: ${m.mastered} из ${m.total} (повторение раз в две недели и реже)`; }
export function skillFromLesson(track, lesson, events, now = Date.now()) {
  const m = lessonMastery(lesson, events), goal = lessonGoal(lesson.id);
  return makeSkill({ title: goal ? goal.charAt(0).toUpperCase() + goal.slice(1) : lesson.title, area: track.title, level: 1, evidence: evidenceText(track, lesson, m), source: 'lesson', ref: lesson.id, id: lessonSkillId(lesson.id) }, now);
}
// «Задание урока выполнено»: навык «Умею». Если навык из урока уже есть, его уровень поднимается не ниже «Умею», подтверждение дополняется.
export function skillFromTask(track, lesson, events, now = Date.now()) {
  const have = events.find(e => e.id === lessonSkillId(lesson.id)), mark = `Задание урока «${lesson.title}» выполнено`;
  if (have) return updateSkill({ ...have, payload: { ...have.payload, evidence: have.payload.evidence.includes(mark) ? have.payload.evidence : `${mark}. ${have.payload.evidence}`.slice(0, 300) } }, { level: Math.max(2, have.payload.level) }, now);
  const goal = lessonGoal(lesson.id);
  return makeSkill({ title: goal ? goal.charAt(0).toUpperCase() + goal.slice(1) : lesson.title, area: track.title, level: 2, evidence: mark, source: 'lesson', ref: lesson.id, id: lessonSkillId(lesson.id) }, now);
}
// Готовы к добавлению: урок пройден, карточки выучены, навыка ещё нет. И те, до кого ещё идти (изучаю).
export function lessonSkillStatus(events) {
  const done = doneLessons(events), have = new Set(skillsOf(events).filter(e => e.payload.source === 'lesson').map(e => e.payload.ref));
  const states = new Map(statesOf(events).map(s => [s.card, s])), ready = [], learning = [];
  for (const track of TRACKS) for (const lesson of track.lessons) {
    if (!done.has(lesson.id) || have.has(lesson.id)) continue;
    const m = lessonMastery(lesson, events, states);
    (m.ready ? ready : learning).push({ track, lesson, ...m, goal: lessonGoal(lesson.id) });
  }
  learning.sort((a, b) => b.mastered / b.total - a.mastered / a.total || b.started - a.started);
  return { ready, learning: learning.filter(x => x.started > 0) };
}
export const readySkillEvents = (events, now = Date.now()) => lessonSkillStatus(events).ready.map(r => skillFromLesson(r.track, r.lesson, events, now));

// ---------- текст для резюме и копирования ----------
export function skillsText(events) {
  const groups = skillGroups(events);
  if (!groups.length) return '';
  return ['Навыки', '', ...groups.flatMap(g => [g.area, ...g.items.map(e => `— ${e.payload.title} (${LEVELS[e.payload.level].toLowerCase()})`), ''])].join('\n').trimEnd() + '\n';
}
export const areaOf = trackId => trackById(trackId)?.title ?? OTHER_AREA;
