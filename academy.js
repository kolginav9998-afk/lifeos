// Академия: учебные программы (треки), карточки для повторения и прогресс. Содержимое лежит в файлах c-*.js.
import english from './c-english.js';
import hebrew from './c-hebrew.js';
import backend from './c-backend.js';
import data from './c-data.js';
import analyst from './c-analyst.js';
import engineer from './c-engineer.js';
import health from './c-health.js';
import ai from './c-ai.js';
import { summary, srsId, buildQueue, newState, isDue } from './srs.js';

export const TRACKS = [english, hebrew, health, ai, backend, data, analyst, engineer];
export const trackById = id => TRACKS.find(t => t.id === id) || null;
export const MY_TRACK = { id: 'my', title: 'Свои карточки', icon: '★', color: '#a16207' };

// Короткий стабильный хэш (FNV-1a) для идентификаторов карточек колоды: порядок слов в колоде можно менять.
export function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

const cache = new Map();
// Карточки трека: сначала карточки уроков (по порядку), затем колода. kind: 'lesson' | 'deck'.
export function cardsOfTrack(track) {
  if (cache.has(track.id)) return cache.get(track.id);
  const out = [];
  for (const l of track.lessons) l.cards.forEach(([q, a], i) => out.push({ id: `${l.id}:${i}`, track: track.id, kind: 'lesson', lesson: l.id, q, a }));
  for (const [front, back] of track.deck || []) out.push({ id: `${track.id}:d:${fnv(front)}`, track: track.id, kind: 'deck', q: front, a: back });
  cache.set(track.id, out);
  return out;
}
export const allBuiltinCards = () => TRACKS.flatMap(cardsOfTrack);

// Карточки пользователя — события типа ucard.
export const userCards = events => events.filter(e => e.type === 'ucard')
  .map(e => ({ id: `u:${e.id}`, track: 'my', kind: 'user', q: e.payload.q, a: e.payload.a, evId: e.id }))
  .sort((a, b) => a.id.localeCompare(b.id));

export const cardPool = events => [...allBuiltinCards(), ...userCards(events)];
export const statesOf = events => events.filter(e => e.type === 'srs').map(e => e.payload);

// Какие карточки трека доступны для изучения: колода — сразу, карточки урока — после того как урок пройден.
export function availableCards(track, events) {
  const done = doneLessons(events);
  const started = new Set(statesOf(events).map(s => s.card));      // уже начатые карточки остаются в повторении, даже если отметку урока сняли
  return cardsOfTrack(track).filter(c => c.kind === 'deck' || done.has(c.lesson) || started.has(c.id));
}

export const lessonEventId = lessonId => `lesson:${lessonId}`;
export const doneLessons = events => new Set(events.filter(e => e.type === 'lesson').map(e => e.payload.lesson));

export function makeLessonDone(track, lesson, date, now = Date.now()) {
  return { id: lessonEventId(lesson.id), type: 'lesson', ts: now, payload: { lesson: lesson.id, track: track.id, date, minutes: lesson.minutes || 0 }, source: 'manual', confidence: 1, evidence: [] };
}
export function makeSrsEvent(state, now = Date.now()) {
  return { id: srsId(state.card), type: 'srs', ts: now, payload: state, source: 'manual', confidence: 1, evidence: [] };
}
export function makeUserCard(q, a, now = Date.now(), id = null) {
  const cq = String(q ?? '').trim().slice(0, 300), ca = String(a ?? '').trim().slice(0, 500);
  if (!cq || !ca) throw new Error('Заполни вопрос и ответ');
  return { id: id || `ucard:${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`, type: 'ucard', ts: now, payload: { q: cq, a: ca }, source: 'manual', confidence: 1, evidence: [] };
}

export function trackProgress(track, events, today) {
  const done = doneLessons(events);
  const lessons = track.lessons.filter(l => done.has(l.id)).length;
  const cards = cardsOfTrack(track);
  const st = summary(cards, statesOf(events), today);
  return { lessons, lessonsTotal: track.lessons.length, ...st };
}

// Дни, когда занимались (пройден урок или отвечали на карточки) — для серии занятий.
export function studyDates(events) {
  const set = new Set();
  for (const e of events) {
    if (e.type === 'lesson') set.add(e.payload.date);
    else if (e.type === 'srs') for (const [d] of e.payload.hist || []) set.add(d);
  }
  return [...set];
}

// Проверка содержимого треков (используется тестами): возвращает список проблем.
export function validateTrack(t) {
  const bad = [];
  const need = (cond, msg) => { if (!cond) bad.push(`${t.id}: ${msg}`); };
  need(/^[a-z]+$/.test(t.id), 'id');
  need(t.title && t.icon && t.color, 'title/icon/color');
  need(t.mentor?.principles?.length >= 4 && t.mentor?.prompts?.length >= 3, 'наставник');
  need(t.plan?.length >= 4, 'план');
  need(t.sources?.length >= 2, 'источники');
  const lessonIds = new Set();
  for (const l of t.lessons) {
    need(!lessonIds.has(l.id), `дубль урока ${l.id}`); lessonIds.add(l.id);
    need(/^[a-z]{2,3}-\d{2}$/.test(l.id), `id урока ${l.id}`);
    need(l.title && l.minutes >= 2 && l.minutes <= 10, `минуты ${l.id}`);
    need(l.body?.length >= 1 && l.body.every(p => typeof p === 'string' && p.length > 20), `текст ${l.id}`);
    need(l.task?.length > 10, `задание ${l.id}`);
    need(l.cards?.length >= 2 && l.cards.every(c => c.length === 2 && c[0] && c[1]), `карточки ${l.id}`);
  }
  const cards = cardsOfTrack(t);
  const ids = new Set(cards.map(c => c.id));
  need(ids.size === cards.length, 'уникальность id карточек');
  const fronts = new Set();
  for (const c of cards.filter(x => x.kind === 'deck')) { need(!fronts.has(c.q), `дубль в колоде: ${c.q}`); fronts.add(c.q); }
  need(cards.every(c => c.q.length <= 300 && c.a.length <= 500), 'длина карточек');
  return bad;
}

// Курс «активный», если по нему есть пройденные уроки или начатые карточки.
export function activeTracks(events) {
  const done = doneLessons(events);
  const started = new Set(statesOf(events).map(s => s.card));
  return TRACKS.filter(t => t.lessons.some(l => done.has(l.id)) || cardsOfTrack(t).some(c => started.has(c.id)));
}

// Очередь сессии: сначала просроченные повторения всех курсов, затем новые карточки по кругу из активных курсов.
// trackId — один курс (с новыми карточками), 'my' — свои карточки, null — все активные.
export function sessionQueue({ events, today, trackId = null, newPerTrack = 5, max = 30 }) {
  const states = statesOf(events);
  let scopes;
  if (trackId === 'my') scopes = [userCards(events)];
  else if (trackId) { const t = trackById(trackId); scopes = t ? [availableCards(t, events)] : []; }
  else {
    scopes = activeTracks(events).map(t => availableCards(t, events));
    const mine = userCards(events);
    if (mine.length) scopes.push(mine);
  }
  const dueAll = [], fresh = [];
  for (const cards of scopes) {
    const ids = new Set(cards.map(c => c.id));
    const q = buildQueue({ cards, states: states.filter(s => ids.has(s.card)), today, newLimit: newPerTrack, max: 100000 });
    dueAll.push(...q.filter(x => x.state));
    fresh.push(q.filter(x => !x.state));
  }
  dueAll.sort((a, b) => a.state.due.localeCompare(b.state.due) || a.state.box - b.state.box);
  const mixed = [];
  for (let i = 0; fresh.some(f => i < f.length); i++) for (const f of fresh) if (i < f.length) mixed.push(f[i]);
  return [...dueAll, ...mixed].slice(0, max);
}

// Сколько карточек сегодня к повторению и сколько новых можно взять (без ограничения размера сессии).
export function todayLoad(events, today, trackId = null) {
  const q = sessionQueue({ events, today, trackId, max: 100000 });
  return { due: q.filter(x => x.state).length, fresh: q.filter(x => !x.state).length };
}

export { newState, isDue };

let lessonIndex = null;
export function lessonTitle(id) {
  if (!lessonIndex) { lessonIndex = new Map(); for (const t of TRACKS) for (const l of t.lessons) lessonIndex.set(l.id, { title: l.title, track: t.title }); }
  return lessonIndex.get(id) ?? null;
}
