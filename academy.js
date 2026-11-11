// Академия: учебные программы (треки), карточки для повторения и прогресс. Содержимое лежит в файлах c-*.js.
import english from './c-english.js';
import hebrew from './c-hebrew.js';
import backend from './c-backend.js';
import data from './c-data.js';
import analyst from './c-analyst.js';
import engineer from './c-engineer.js';
import health from './c-health.js';
import ai from './c-ai.js';
import { summary, srsId, buildQueue, newState, isDue, MASTERED_BOX } from './srs.js';
import { daysBetween } from './events.js';
import { isSick } from './sick.js';
import { makeRng } from './stats.js';

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


// ---------- конспекты уроков ----------
export const lessonNoteId = lessonId => `ln:${lessonId}`;
export function makeLessonNote(lessonId, text, date, now = Date.now(), prev = null) {
  if (!lessonTitle(lessonId)) throw new Error('Урок не найден');
  const t = String(text ?? '').trim().slice(0, 2000);
  if (!t) throw new Error('Конспект пуст');
  return { id: lessonNoteId(lessonId), type: 'lessonnote', ts: prev?.ts ?? now, payload: { lesson: lessonId, text: t, date, ...(prev ? { editedAt: now } : {}) }, source: 'manual', confidence: 1, evidence: [] };
}
export const lessonNoteOf = (events, lessonId) => events.find(e => e.type === 'lessonnote' && e.id === lessonNoteId(lessonId)) ?? null;

// ---------- сложные карточки («пиявки»): часто забываются, пока не выучены ----------
export const LEECH_LAPSES = 3;
export function leeches(events, limit = 20) {
  const pool = new Map(cardPool(events).map(c => [c.id, c]));
  return statesOf(events).filter(s => (s.lapses || 0) >= LEECH_LAPSES && s.box < MASTERED_BOX && pool.has(s.card))
    .map(s => ({ card: pool.get(s.card), state: s })).sort((a, b) => b.state.lapses - a.state.lapses || a.card.q.localeCompare(b.card.q)).slice(0, limit);
}

// ---------- возвращение после пропуска ----------
// Не занимался несколько дней, а повторений накопилось много: предложить начать с малого, без «долга».
export function comebackInfo(events, today, { minDays = 3, minDue = 8 } = {}) {
  if (isSick(events, today)) return null;
  const dates = studyDates(events).sort();
  if (!dates.length) return null;
  const last = dates[dates.length - 1], gap = daysBetween(last, today);
  if (gap < minDays) return null;
  const load = todayLoad(events, today);
  return load.due >= minDue ? { days: gap, due: load.due, last } : null;
}

// ---------- режим «15 минут»: один урок и десяток карточек ----------
// Курс, которым занимался последним, идёт первым; если занятий не было, берём первый по порядку.
export function nextLesson(events) {
  const done = doneLessons(events), last = new Map();
  for (const e of events) if (e.type === 'lesson' && (!last.has(e.payload.track) || last.get(e.payload.track) < e.payload.date)) last.set(e.payload.track, e.payload.date);
  const order = [...TRACKS].sort((a, b) => (last.get(b.id) || '').localeCompare(last.get(a.id) || ''));
  for (const t of order) { const l = t.lessons.find(x => !done.has(x.id)); if (l) return { track: t, lesson: l }; }
  return null;
}
export function fifteenPlan(events, today, cardLimit = 10) {
  const next = nextLesson(events), load = todayLoad(events, today);
  return { next, cards: Math.min(cardLimit, load.due + load.fresh), minutes: (next?.lesson.minutes || 0) + Math.ceil(Math.min(cardLimit, load.due + load.fresh) / 2) };
}


// ---------- экзамен: случайные карточки без записи в расписание повторений ----------
// Берём то, что уже начато (иначе экзамен проверял бы незнакомое); если учил мало, то всё доступное.
export function examQueue({ events, trackId = null, n = 20, seed = Date.now() }) {
  const states = new Map(statesOf(events).map(s => [s.card, s]));
  let pool;
  if (trackId === 'my') pool = userCards(events);
  else if (trackId) { const t = trackById(trackId); pool = t ? availableCards(t, events) : []; }
  else pool = [...activeTracks(events).flatMap(t => availableCards(t, events)), ...userCards(events)];
  const started = pool.filter(c => states.has(c.id));
  const base = started.length >= Math.min(n, 10) ? started : pool;
  return makeRng(seed).shuffle(base).slice(0, n).map(card => ({ card, state: states.get(card.id) ?? null }));
}

// ---------- мини-квиз после урока: вопросы из карточек урока, ответы-пустышки из карточек курса ----------
export function quizFor(track, lesson, { seed = Date.now(), n = 3, options = 4 } = {}) {
  const rng = makeRng(seed);
  const own = lesson.cards.map(([q, a]) => ({ q, a }));
  const others = [...new Set(cardsOfTrack(track).filter(c => c.lesson !== lesson.id).map(c => c.a))];
  return rng.shuffle(own).slice(0, Math.min(n, own.length)).map(c => {
    const wrong = rng.shuffle(others.filter(a => a !== c.a)).slice(0, options - 1);
    const all = rng.shuffle([c.a, ...wrong]);
    return { q: c.q, options: all, answer: all.indexOf(c.a) };
  });
}

export { newState, isDue };

let lessonIndex = null;
export function lessonTitle(id) {
  if (!lessonIndex) { lessonIndex = new Map(); for (const t of TRACKS) for (const l of t.lessons) lessonIndex.set(l.id, { title: l.title, track: t.title }); }
  return lessonIndex.get(id) ?? null;
}

// Слово дня: детерминированно по дате, из колоды курса (английский и иврит).
export function wordOfDay(date, trackId) {
  const t = trackById(trackId);
  if (!t || !t.deck?.length) return null;
  const [y, m, d] = date.split('-').map(Number);
  const n = Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  const [front, back] = t.deck[((n % t.deck.length) + t.deck.length) % t.deck.length];
  return { track: trackId, title: t.title, front, back };
}

// Поиск по содержимому курсов: уроки (название, текст, задание) и слова/термины колод. Без индексов: данных немного.
const nrm = x => String(x ?? '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е');
export function searchAcademy(query, limit = 12) {
  const tokens = nrm(query).split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.join('').length < 2) return [];
  const lessons = [], words = [];
  for (const t of TRACKS) {
    for (const l of t.lessons) {
      const title = nrm(l.title), hay = nrm([l.title, ...l.body, l.task].join(' '));
      if (tokens.every(k => hay.includes(k))) lessons.push({ kind: 'Урок', title: `${l.title} · ${t.title}`, trackId: t.id, lessonId: l.id, score: tokens.every(k => title.includes(k)) ? 0 : 1 });
    }
    for (const [q, a] of t.deck || []) {
      const hay = nrm(`${q} ${a}`);
      if (tokens.every(k => hay.includes(k))) words.push({ kind: t.id === 'english' || t.id === 'hebrew' ? 'Слово' : 'Термин', title: `${q} — ${a}`, trackId: t.id, lessonId: null, score: 2 });
    }
  }
  lessons.sort((a, b) => a.score - b.score);
  return [...lessons, ...words].slice(0, limit);
}
