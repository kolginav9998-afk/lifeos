// Дневник практики: сколько минут по каждому курсу за неделю (уроки, карточки, говорение), недельные планки и подсказка
// «топчешься на месте». Чистая логика. Минуты карточек — оценка: один ответ ≈ 15 секунд (в приложении нет секундомера повторений).
import { addDays } from './events.js';
import { TRACKS, trackById, cardsOfTrack, statesOf, doneLessons } from './academy.js';

export const CARD_SECONDS = 15;
export const GOAL_MIN = 10, GOAL_MAX = 1000;
export const PLATEAU_DAYS = 28;                      // «долго без нового»: четыре недели
export const PLATEAU_MIN_ACTIVE = 8;                 // и при этом занятия были: не меньше восьми дней из двадцати восьми

let owners = null;                                   // id карточки → id курса (встроенные карточки)
const ownerOf = id => (owners ||= new Map(TRACKS.flatMap(t => cardsOfTrack(t).map(c => [c.id, t.id])))).get(id) ?? 'my';
const titleOf = id => (id === 'my' ? 'Свои карточки' : trackById(id)?.title ?? id);

// Минуты практики по курсам за период [from, to] включительно. lessons — длительность пройденных уроков по плану, speak — записанное
// говорение вслух (язык говорения совпадает с id курса), cards — оценка по числу ответов на карточки.
export function practiceBy(events, from, to) {
  const rows = {};
  const row = id => (rows[id] ||= { lessons: 0, speak: 0, reps: 0 });
  for (const e of events) {
    const p = e.payload;
    if (e.type === 'lesson' && p.date >= from && p.date <= to) row(p.track).lessons += p.minutes || 0;
    else if (e.type === 'speak' && p.date >= from && p.date <= to && trackById(p.lang)) row(p.lang).speak += p.minutes || 0;
    else if (e.type === 'srs') for (const [d] of p.hist || []) if (d >= from && d <= to) row(ownerOf(p.card)).reps++;
  }
  for (const r of Object.values(rows)) { r.cards = Math.round((r.reps * CARD_SECONDS) / 60); r.total = r.lessons + r.cards + r.speak; }
  return rows;
}

// ---------- недельные планки по курсам ----------
export const goalId = track => `learngoal:${track}`;
export function makeLearnGoal(track, minutes, now = Date.now()) {
  if (!trackById(track)) throw new Error('Выбери курс');
  const m = Math.trunc(Number(String(minutes ?? '').replace(',', '.')));
  if (!Number.isFinite(m) || m < GOAL_MIN || m > GOAL_MAX) throw new Error(`Цель на неделю: от ${GOAL_MIN} до ${GOAL_MAX} минут`);
  return { id: goalId(track), type: 'learngoal', ts: now, payload: { track, minutes: m }, source: 'manual', confidence: 1, evidence: [] };
}
export const learnGoals = events => Object.fromEntries(events.filter(e => e.type === 'learngoal' && trackById(e.payload.track)).map(e => [e.payload.track, e.payload.minutes]));

// Последние 7 дней включая сегодня (как и счётчик говорения). Строки: курсы с занятиями или с целью.
export function practiceWeek(events, today) {
  const from = addDays(today, -6), by = practiceBy(events, from, today), goals = learnGoals(events);
  const rows = [...TRACKS.map(t => t.id), 'my'].filter(id => by[id] || goals[id]).map(id => {
    const r = by[id] ?? { lessons: 0, speak: 0, reps: 0, cards: 0, total: 0 }, goal = goals[id] ?? null;
    return { track: id, title: titleOf(id), ...r, goal, ratio: goal ? Math.min(1, r.total / goal) : null, left: goal ? Math.max(0, goal - r.total) : null };
  });
  return { from, to: today, rows, total: rows.reduce((s, r) => s + r.total, 0) };
}

// ---------- «топчешься на месте» ----------
// Занятия идут (не меньше 8 дней за 28), но четыре недели нет ничего нового: ни пройденных уроков, ни начатых карточек.
// Курс, который начат раньше и не закончен. Только подсказка.
export function plateauInfo(events, trackId, today, days = PLATEAU_DAYS) {
  const t = trackById(trackId);
  if (!t) return null;
  const from = addDays(today, -(days - 1)), done = doneLessons(events);
  const ids = new Set(cardsOfTrack(t).map(c => c.id)), states = statesOf(events).filter(s => ids.has(s.card));
  const lessons = events.filter(e => e.type === 'lesson' && e.payload.track === trackId);
  const finished = t.lessons.every(l => done.has(l.id)) && states.length === ids.size;
  const everBefore = lessons.some(e => e.payload.date < from) || states.some(s => s.first < from);
  const fresh = lessons.filter(e => e.payload.date >= from).length + states.filter(s => s.first >= from).length;
  if (finished || !everBefore || fresh > 0) return null;
  const active = new Set();
  for (const e of lessons) if (e.payload.date >= from) active.add(e.payload.date);
  for (const s of states) for (const [d] of s.hist || []) if (d >= from) active.add(d);
  for (const e of events) if (e.type === 'speak' && e.payload.lang === trackId && e.payload.date >= from) active.add(e.payload.date);
  if (active.size < PLATEAU_MIN_ACTIVE) return null;
  const next = t.lessons.find(l => !done.has(l.id)) ?? null;
  const step = next ? `Сделай шаг: пройди урок «${next.title}».` : 'Сделай шаг: добавь свои карточки.';
  return { days: active.size, window: days, nextLesson: next ? { id: next.id, title: next.title } : null,
    text: `За последние ${days / 7} недели было ${active.size} дней занятий, но ничего нового не появилось: ни уроков, ни карточек. Так легко застрять на месте. ${step} Или смени способ: говорение вслух, экзамен по курсу.` };
}
