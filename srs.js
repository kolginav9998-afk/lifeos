// Интервальные повторения (коробки Лейтнера): чистая логика без интерфейса.
// Состояние карточки хранится одной записью `srs:<id карточки>`. Даты — локальные строки 'YYYY-MM-DD'.
import { addDays, isYmd } from './events.js';

export const INTERVALS = [0, 1, 3, 7, 14, 30, 60, 120];   // дней до следующего показа для коробки с таким номером
export const MAX_BOX = INTERVALS.length - 1;
export const MASTERED_BOX = 4;                             // интервал 14 дней и больше — «выучено»
export const HIST_LIMIT = 12;
export const QUALITIES = ['again', 'hard', 'good'];

export const srsId = cardId => `srs:${cardId}`;

export function newState(cardId, today) {
  return { card: cardId, box: 0, due: today, first: today, last: null, reps: 0, lapses: 0, hist: [] };
}

// Оценить ответ: again — забыл, hard — вспомнил с трудом, good — помню.
export function grade(state, quality, today) {
  if (!QUALITIES.includes(quality)) throw new Error('bad quality');
  if (!isYmd(today)) throw new Error('bad date');
  const s = { ...state, hist: [...(state.hist || [])], reps: (state.reps || 0) + 1, last: today };
  if (quality === 'again') {
    s.lapses = (state.lapses || 0) + (state.box > 0 ? 1 : 0);
    s.box = 0; s.due = today;                              // вернуть в начало; сессия покажет ещё раз
  } else if (quality === 'hard') {
    s.box = Math.max(1, state.box);
    s.due = addDays(today, Math.max(1, Math.floor(INTERVALS[s.box] / 2)));
  } else {
    s.box = Math.min(MAX_BOX, state.box + 1);
    s.due = addDays(today, INTERVALS[s.box]);
  }
  s.hist.push([today, quality === 'again' ? 0 : quality === 'hard' ? 1 : 2]);
  if (s.hist.length > HIST_LIMIT) s.hist = s.hist.slice(-HIST_LIMIT);
  return s;
}

export const isDue = (s, today) => s.due <= today;
export const isMastered = s => s.box >= MASTERED_BOX;

// Доля вспомненных при показе за последние записи (0..1), null — данных нет.
export function retention(states) {
  let n = 0, ok = 0;
  for (const s of states) for (const [, q] of s.hist || []) { n++; if (q > 0) ok++; }
  return n ? ok / n : null;
}

// Очередь сессии: сначала просроченные (самые старые), затем новые (не больше лимита на день, с учётом уже начатых сегодня).
export function buildQueue({ cards, states, today, newLimit = 8, max = 30 }) {
  const byCard = new Map(states.map(s => [s.card, s]));
  const due = [];
  for (const c of cards) { const s = byCard.get(c.id); if (s && isDue(s, today)) due.push({ card: c, state: s }); }
  due.sort((a, b) => a.state.due.localeCompare(b.state.due) || a.state.box - b.state.box);
  const startedToday = states.filter(s => s.first === today).length;
  const room = Math.max(0, newLimit - startedToday);
  const fresh = [];
  for (const c of cards) { if (fresh.length >= room) break; if (!byCard.has(c.id)) fresh.push({ card: c, state: null }); }
  return [...due, ...fresh].slice(0, max);
}

export function summary(cards, states, today) {
  const ids = new Set(cards.map(c => c.id));
  const mine = states.filter(s => ids.has(s.card));
  return {
    total: cards.length,
    started: mine.length,
    due: mine.filter(s => isDue(s, today)).length,
    mastered: mine.filter(isMastered).length,
    fresh: cards.length - mine.length,
    retention: retention(mine),
  };
}

// Занятия подряд до сегодняшнего дня (сегодня можно ещё не заниматься: серия не сгорает до конца дня).
export function studyStreak(dates, today) {
  const set = new Set(dates);
  let day = set.has(today) ? today : addDays(today, -1), n = 0;
  while (set.has(day)) { n++; day = addDays(day, -1); }
  return n;
}
