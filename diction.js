// Дикция: чистая логика тренажёров, без интерфейса и хранилища. Данные лежат в diction-*.js (скороговорки, ударения, разминка, тексты).
// Голос не записывается и не распознаётся: приложение считает время, повторы и самооценку. Не медицинский инструмент.
import { isYmd, addDays, todayStr, daysBetween } from './events.js';
import { makeRng } from './stats.js';
import { studyStreak } from './srs.js';
import { TWISTERS, twisterById } from './diction-twisters.js';
import { STRESS_WORDS, stressById, stressIndex } from './diction-stress.js';
import { WARMUP, WARMUP_GROUPS, warmupSeconds, BREATH_PRESETS } from './diction-warmup.js';
import { TEXTS, textById } from './diction-texts.js';

export { TWISTERS, twisterById, STRESS_WORDS, stressById, WARMUP, WARMUP_GROUPS, warmupSeconds, BREATH_PRESETS, TEXTS, textById };

// ---------- группы звуков ----------
export const SOUND_GROUPS = [
  { id: 'vowels', title: 'Гласные', letters: 'аоуыэиеёюя' },
  { id: 'labial', title: 'Губные П Б М В Ф', letters: 'пбмвф' },
  { id: 'whistling', title: 'Свистящие С З Ц', letters: 'сзц' },
  { id: 'hushing', title: 'Шипящие Ш Ж Ч Щ', letters: 'шжчщ' },
  { id: 'r', title: 'Звук Р', letters: 'р' },
  { id: 'l', title: 'Звук Л', letters: 'л' },
  { id: 'velar', title: 'Заднеязычные К Г Х', letters: 'кгх' },
  { id: 'cluster', title: 'Стечения согласных', letters: '' },
];
export const GROUP_IDS = SOUND_GROUPS.map(g => g.id);
export const groupById = id => SOUND_GROUPS.find(g => g.id === id) ?? null;
// Группы звуков по списку «звуков» скороговорки: сочетание из нескольких букв относится к стечениям.
export const groupsOfSounds = sounds => [...new Set(sounds.flatMap(s => (s.length > 1 ? ['cluster'] : SOUND_GROUPS.filter(g => g.letters.includes(s)).map(g => g.id))))];
export const groupsOfTwister = t => groupsOfSounds(t.sounds);

// Выбор скороговорок: group (id группы), sound (одна буква), level (1–3); пустое значение — любое.
export function filterTwisters({ group = '', sound = '', level = 0 } = {}) {
  return TWISTERS.filter(t => (!level || t.level === level) && (!sound || t.sounds.includes(sound) || (t.sounds.some(s => s.length > 1 && s.includes(sound)))) && (!group || groupsOfTwister(t).includes(group)));
}

// ---------- слоги, слова, темп речи ----------
const VOWEL_RE = /[аеёиоуыэюя]/gi;
export const syllables = text => (String(text ?? '').match(VOWEL_RE) ?? []).length;

// Скороговорка в трёх темпах: слогов в секунду и скорость модельного голоса. Целевое время — на REPS повторов подряд.
export const REPS = 3;
export const TEMPOS = [{ id: 1, title: 'Медленно', rate: 3, voice: 0.7 }, { id: 2, title: 'Нормально', rate: 5, voice: 0.95 }, { id: 3, title: 'Быстро', rate: 7, voice: 1.2 }];
export const tempoById = id => TEMPOS.find(t => t.id === id) ?? null;
export function tempoTarget(text, tempo, reps = REPS) {
  const t = tempoById(tempo);
  return t ? Math.max(1, Math.round((syllables(text) * reps) / t.rate)) : null;
}

// Разметка текста для чтения: «/» короткая пауза, «//» длинная, «*слово*» логическое ударение. Возвращает строки, в строке — слова и паузы.
export function parseMarkup(markup) {
  return String(markup ?? '').split('\n').map(line => {
    const out = [];
    let open = false;
    for (const raw of line.split(/\s+/).filter(Boolean)) {
      if (raw === '/' || raw === '//') { out.push({ pause: raw.length }); continue; }
      let w = raw, stress = open;
      if (w.startsWith('*')) { open = true; stress = true; w = w.slice(1); }
      const m = /^(.*?)\*([^\p{L}\p{N}]*)$/u.exec(w);
      if (m) { w = m[1] + m[2]; open = false; stress = true; }
      if (w) out.push({ w, stress });
    }
    return out;
  });
}
export const plainText = markup => parseMarkup(markup).map(line => line.filter(t => t.w).map(t => t.w).join(' ')).join('\n');
export const countWords = markup => parseMarkup(markup).flat().filter(t => t.w && /[\p{L}\p{N}]/u.test(t.w)).length;
export function wpm(words, seconds) {
  if (!Number.isFinite(words) || !Number.isFinite(seconds) || words <= 0 || seconds <= 0) return null;
  return Math.round(words / (seconds / 60));
}
// Ориентиры, а не норма: темп зависит от длины слов, текста и слушателей. Для русского они ниже, чем в английских источниках.
export const WPM_BANDS = [
  { max: 80, id: 'very-slow', title: 'Очень медленно', note: 'Речь может звучать вяло или неуверенно, если пауз не задумано.' },
  { max: 110, id: 'slow', title: 'Неторопливо', note: 'Подходит для стихов, сложных текстов и важных мыслей.' },
  { max: 150, id: 'comfortable', title: 'Комфортно', note: 'Так большинству людей удобно слушать чтение и рассказ.' },
  { max: 180, id: 'fast', title: 'Быстро', note: 'Следи за чёткостью: на скорости первыми «съедаются» окончания.' },
  { max: Infinity, id: 'very-fast', title: 'Очень быстро', note: 'Слушателю трудно успевать. Попробуй добавить паузы.' },
];
export const WPM_NOTE = 'Это ориентиры, а не норма. Темп зависит от текста, длины слов и слушателей. Для стихов нужен темп медленнее.';
export const wpmBand = v => (Number.isFinite(v) && v > 0 ? WPM_BANDS.find(b => v < b.max) : null);
export const wpmRange = () => [110, 150];
export const readingSeconds = (words, perMinute = 120) => Math.round((words / perMinute) * 60);

// ---------- записи ----------
export const DICTION_KINDS = { warmup: 'Разминка', breath: 'Дыхание', twister: 'Скороговорки', stress: 'Ударения', reading: 'Чтение вслух' };
export const MIN_SESSION_SEC = 20, MIN_RUN_SEC = 3, MAX_SESSION_SEC = 4 * 3600;     // скороговорка в быстром темпе занимает секунд десять, поэтому для неё порог ниже
const okRating = v => Number.isInteger(v) && v >= 1 && v <= 5;
const id36 = (now, pre) => `${pre}:${Math.floor(now).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Занятие дикцией: вид, сколько секунд, сколько упражнений/слов/повторов, оценка 1–5 (по желанию), ссылка на материал, группы звуков, темп речи, темп скороговорки.
export function makeDiction({ kind, seconds, items = 0, rating = null, date, ref = '', groups = [], wpm: pace = null, tempo = null, ok = null, miss = [], fixed = [] } = {}, now = Date.now()) {
  if (!Object.hasOwn(DICTION_KINDS, kind)) throw new Error('Выбери вид занятия');
  const sec = Math.round(Number(seconds)), least = kind === 'twister' ? MIN_RUN_SEC : MIN_SESSION_SEC;
  if (!Number.isFinite(sec) || sec < least) throw new Error(kind === 'twister' ? 'Слишком быстро: проверь секундомер' : 'Меньше 20 секунд не записывается');
  if (sec > MAX_SESSION_SEC) throw new Error('Слишком долго: до четырёх часов');
  const d = date || todayStr(now);
  if (!isYmd(d)) throw new Error('bad date');
  const n = Math.max(0, Math.min(999, Math.round(Number(items) || 0)));
  const payload = { date: d, kind, seconds: sec, minutes: Math.round(sec / 60), items: n };
  if (okRating(rating)) payload.rating = rating;
  if (ref) payload.ref = String(ref).slice(0, 40);
  const g = [...new Set(groups)].filter(x => GROUP_IDS.includes(x)); if (g.length) payload.groups = g;
  if (Number.isFinite(pace) && pace > 0 && pace < 1000) payload.wpm = Math.round(pace);
  if (TEMPOS.some(t => t.id === tempo)) payload.tempo = tempo;
  if (Number.isInteger(ok) && ok >= 0 && ok <= n) payload.ok = ok;
  const m = [...new Set(miss)].filter(x => stressById(x)).slice(0, 12); if (m.length) payload.miss = m;
  const f = [...new Set(fixed)].filter(x => stressById(x) && !m.includes(x)).slice(0, 12); if (f.length) payload.fixed = f;
  return { id: id36(now, 'diction'), type: 'diction', ts: now, payload, source: 'manual', confidence: 1, evidence: [] };
}
export const dictionOf = events => events.filter(e => e.type === 'diction').sort((a, b) => a.payload.date.localeCompare(b.payload.date) || a.ts - b.ts);
const secOf = e => e.payload.seconds ?? (e.payload.minutes || 0) * 60;

// ---------- серия, неделя ----------
export const practiceDates = events => [...new Set(dictionOf(events).map(e => e.payload.date))];
export const dictionStreak = (events, today) => studyStreak(practiceDates(events), today);
export function bestStreak(events) {
  const days = practiceDates(events).sort();
  let best = 0, run = 0, prev = null;
  for (const d of days) { run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  return best;
}
export function weekSummary(events, today) {
  const from = addDays(today, -6);
  const list = dictionOf(events).filter(e => e.payload.date >= from && e.payload.date <= today);
  const byKind = {};
  for (const e of list) byKind[e.payload.kind] = (byKind[e.payload.kind] || 0) + secOf(e);
  const seconds = list.reduce((s, e) => s + secOf(e), 0);
  return { seconds, minutes: Math.round(seconds / 60), sessions: list.length, days: new Set(list.map(e => e.payload.date)).size, byKind };
}
export const kindsToday = (events, today) => new Set(dictionOf(events).filter(e => e.payload.date === today).map(e => e.payload.kind));

// ---------- самооценка ----------
export const RUBRIC = [
  { id: 'clarity', title: 'Чёткость', ask: 'Насколько понятно звучит каждое слово?', low: 'часть слов «съедается»', high: 'каждое слово слышно' },
  { id: 'tempo', title: 'Темп', ask: 'Подходит ли скорость речи слушателю?', low: 'тороплюсь или тяну', high: 'ровный удобный темп' },
  { id: 'volume', title: 'Громкость', ask: 'Слышно ли тебя без напряжения?', low: 'тихо или кричу', high: 'ровно и достаточно' },
  { id: 'intonation', title: 'Интонация', ask: 'Живая ли речь, или всё на одной ноте?', low: 'монотонно', high: 'выразительно и по смыслу' },
  { id: 'pauses', title: 'Паузы', ask: 'Есть ли паузы там, где этого требует смысл?', low: 'пауз нет или они случайные', high: 'паузы на своих местах' },
  { id: 'fillers', title: 'Слова-паразиты', ask: 'Как редко звучат «ну», «как бы», «э-э»?', low: 'почти в каждой фразе', high: 'почти нет' },
];
export const RUBRIC_IDS = RUBRIC.map(r => r.id);
export function cleanScores(scores) {
  const out = {};
  for (const id of RUBRIC_IDS) {
    const v = scores?.[id];
    if (!okRating(v)) throw new Error('Оцени все шесть пунктов от 1 до 5');
    out[id] = v;
  }
  return out;
}
export const scoreAverage = scores => Math.round((RUBRIC_IDS.reduce((s, id) => s + scores[id], 0) / RUBRIC_IDS.length) * 10) / 10;

export function makeSelf({ scores, note = '', weak = [], date } = {}, now = Date.now()) {
  const d = date || todayStr(now);
  if (!isYmd(d)) throw new Error('bad date');
  const payload = { date: d, scores: cleanScores(scores) };
  const t = String(note ?? '').trim().slice(0, 300); if (t) payload.note = t;
  const w = [...new Set(weak)].filter(x => GROUP_IDS.includes(x)); if (w.length) payload.weak = w;
  return { id: `dictself:${d}`, type: 'dictself', ts: now, payload, source: 'manual', confidence: 1, evidence: [] };
}
export const selfOf = events => events.filter(e => e.type === 'dictself').sort((a, b) => a.payload.date.localeCompare(b.payload.date) || a.ts - b.ts);

// Динамика: последняя оценка против предыдущей и против первой, ряд средних для графика, самые слабый и сильный пункты.
export function selfTrend(events) {
  const list = selfOf(events);
  if (!list.length) return null;
  const avgs = list.map(e => ({ date: e.payload.date, avg: scoreAverage(e.payload.scores) }));
  const latest = list.at(-1).payload, previous = list.length > 1 ? list.at(-2).payload : null, first = list[0].payload;
  const diff = (a, b) => Object.fromEntries(RUBRIC_IDS.map(id => [id, a.scores[id] - b.scores[id]]));
  const order = [...RUBRIC_IDS].sort((x, y) => latest.scores[x] - latest.scores[y] || RUBRIC_IDS.indexOf(x) - RUBRIC_IDS.indexOf(y)), top = Math.max(...RUBRIC_IDS.map(id => latest.scores[id]));
  const overall = previous ? Math.round((avgs.at(-1).avg - avgs.at(-2).avg) * 10) / 10 : 0;
  return { n: list.length, latest, previous, first, avgs, deltaPrev: previous ? diff(latest, previous) : null, deltaFirst: list.length > 1 ? diff(latest, first) : null,
    overallDelta: overall, direction: !previous ? 'none' : overall > 0 ? 'up' : overall < 0 ? 'down' : 'same', weakest: order[0], strongest: RUBRIC_IDS.find(id => latest.scores[id] === top) };
}

// ---------- слабые группы звуков ----------
// По оценкам чёткости скороговорок за последние дни: группа «слабая», если оценок не меньше minRatings, а среднее ниже below.
export function autoWeak(events, today, { days = 60, minRatings = 2, below = 3.5 } = {}) {
  const from = addDays(today, -days), by = {};
  for (const e of dictionOf(events)) {
    const p = e.payload;
    if (p.kind !== 'twister' || !p.rating || p.date < from) continue;
    for (const g of p.groups ?? []) (by[g] ??= []).push(p.rating);
  }
  return Object.entries(by).filter(([, r]) => r.length >= minRatings).map(([g, r]) => [g, r.reduce((a, b) => a + b, 0) / r.length]).filter(([, avg]) => avg < below)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([g]) => g);
}
// Что считать слабым: выбор человека (stored), иначе пометка в последней самооценке, иначе вывод из оценок.
export function weakGroups(events, today, stored = null) {
  const own = (stored ?? []).filter(g => GROUP_IDS.includes(g));
  if (own.length) return own;
  const last = selfOf(events).at(-1)?.payload.weak;
  if (last?.length) return last.filter(g => GROUP_IDS.includes(g));
  return autoWeak(events, today);
}

// ---------- рекорды по скороговоркам ----------
// Рекорд: самый быстрый темп, в котором чёткость оценена на 4–5; при равном темпе — меньшее время.
export function twisterBest(events, id) {
  const ok = dictionOf(events).filter(e => e.payload.kind === 'twister' && e.payload.ref === id && e.payload.rating >= 4 && e.payload.tempo);
  if (!ok.length) return null;
  const best = ok.sort((a, b) => b.payload.tempo - a.payload.tempo || a.payload.seconds - b.payload.seconds)[0].payload;
  return { tempo: best.tempo, seconds: best.seconds, rating: best.rating, date: best.date };
}
export function twisterBests(events) {
  const out = {};
  for (const e of dictionOf(events)) { const id = e.payload.ref; if (e.payload.kind === 'twister' && id && !(id in out)) out[id] = twisterBest(events, id); }
  return out;
}
// Уровень, с которого предложить скороговорки: поднимаем после трёх хороших занятий подряд на текущем уровне.
export function suggestLevel(events) {
  const list = dictionOf(events).filter(e => e.payload.kind === 'twister' && e.payload.rating && twisterById(e.payload.ref));
  let level = 1;
  for (let guard = 0; guard < 3; guard++) {
    const at = list.filter(e => twisterById(e.payload.ref).level === level).slice(-3);
    if (level < 3 && at.length >= 3 && at.every(e => e.payload.rating >= 4)) level++; else break;
  }
  return level;
}

// ---------- разминка ----------
const ORDER = ['jaw', 'lips', 'tongue', 'palate'];
export function pickWarmup(budgetSec, { weak = [], seed = 1 } = {}) {
  const rng = makeRng(seed + 101), pool = rng.shuffle(WARMUP);
  const chosen = [];
  let used = 0;
  const add = ex => { if (!ex || chosen.includes(ex)) return; const s = warmupSeconds(ex); if (used + s <= budgetSec) { chosen.push(ex); used += s; } };
  add(WARMUP.find(e => e.id === 'yawn'));
  for (const ex of pool.filter(e => weak.some(w => e.helps.includes(w)))) add(ex);
  for (const g of ORDER) if (!chosen.some(e => e.group === g)) add(pool.find(e => e.group === g && used + warmupSeconds(e) <= budgetSec));
  for (const ex of pool) add(ex);
  chosen.sort((a, b) => ORDER.indexOf(a.group) - ORDER.indexOf(b.group));
  return { ids: chosen.map(e => e.id), seconds: used };
}
// Готовые наборы для плеера разминки.
export const WARMUP_SETS = [{ id: 'min3', title: 'Быстрая, 3 минуты', sec: 180 }, { id: 'min6', title: 'Полная, 6 минут', sec: 360 }, ...Object.entries(WARMUP_GROUPS).map(([id, title]) => ({ id, title, group: id }))];
export function warmupSet(setId, { weak = [], seed = 1 } = {}) {
  const s = WARMUP_SETS.find(x => x.id === setId);
  if (!s) return null;
  if (s.group) return { ...s, ids: WARMUP.filter(e => e.group === s.group).map(e => e.id) };
  return { ...s, ids: pickWarmup(s.sec, { weak, seed }).ids };
}

// ---------- скороговорки в программе дня ----------
export function pickTwisters(n, { weak = [], level = 1, seed = 1 } = {}) {
  const rng = makeRng(seed + 202);
  const lists = (weak.length ? weak : [null]).map(g => rng.shuffle(TWISTERS.filter(t => !g || groupsOfTwister(t).includes(g))).sort((a, b) => Math.abs(a.level - level) - Math.abs(b.level - level)));
  const out = [];
  for (let i = 0; out.length < n && i < 200; i++) {
    const t = lists[i % lists.length].find(x => !out.includes(x));
    if (t) out.push(t);
    else if (lists.every(l => l.every(x => out.includes(x)))) break;
  }
  return out.map(t => t.id);
}

// ---------- программа дня ----------
export const ROUTINE_PLANS = {
  5: [['breath', 1], ['warmup', 2], ['twister', 2]],
  10: [['breath', 2], ['warmup', 3], ['twister', 3], ['extra', 2]],
  15: [['breath', 2], ['warmup', 4], ['twister', 4], ['reading', 3], ['stress', 2]],
};
export const dayNumber = date => { const [y, m, d] = date.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 86400000); };
const BREATH_BY_LEVEL = { 1: ['calm', 'belly'], 2: ['support', 'sound-s', 'sound-a'], 3: ['sound-s', 'long', 'sound-a'] };

// Программа на 5, 10 или 15 минут из слабых групп звуков. Один и тот же seed даёт ту же программу. Сумма минут блоков не больше заказанного.
export function buildRoutine({ weak = [], minutes = 10, seed = 1, level = 1 } = {}) {
  const plan = ROUTINE_PLANS[minutes] ?? ROUTINE_PLANS[10], rng = makeRng(seed + 7), blocks = [];
  const lv = Math.min(3, Math.max(1, level));
  for (const [kind0, min] of plan) {
    const kind = kind0 === 'extra' ? (seed % 2 ? 'stress' : 'reading') : kind0;
    if (kind === 'breath') {
      const id = weak.includes('vowels') && lv > 1 ? 'sound-a' : BREATH_BY_LEVEL[lv][Math.abs(seed) % BREATH_BY_LEVEL[lv].length];
      const p = BREATH_PRESETS.find(b => b.id === id);
      blocks.push({ kind, title: `Дыхание: ${p.title}`, minutes: min, refs: [id], note: p.hint });
    } else if (kind === 'warmup') {
      const w = pickWarmup(min * 60, { weak, seed });
      blocks.push({ kind, title: 'Разминка для губ, языка и челюсти', minutes: min, refs: w.ids, note: `Упражнений: ${w.ids.length}` });
    } else if (kind === 'twister') {
      const ids = pickTwisters(Math.max(1, Math.floor((min * 60) / 90)), { weak, level: lv, seed });
      blocks.push({ kind, title: weak.length ? `Скороговорки: ${weak.map(g => groupById(g)?.title).filter(Boolean).join(', ')}` : 'Скороговорки', minutes: min, refs: ids, note: `Скороговорок: ${ids.length}` });
    } else if (kind === 'reading') {
      const fit = TEXTS.filter(t => t.level <= lv + 1 && readingSeconds(countWords(t.text)) <= min * 60), t = rng.pick(fit.length ? fit : TEXTS.filter(x => x.level === 1));
      blocks.push({ kind, title: `Чтение вслух: ${t.title}`, minutes: min, refs: [t.id], note: 'Читай с паузами и выделяй главные слова.' });
    } else {
      blocks.push({ kind: 'stress', title: 'Ударения: 10 слов', minutes: min, refs: [], note: 'Слова, в которых часто ошибаются.' });
    }
  }
  return { minutes: blocks.reduce((s, b) => s + b.minutes, 0), blocks };
}

// ---------- ударения: викторина ----------
const mark = (lower, i) => lower.slice(0, i) + lower[i].toUpperCase() + lower.slice(i + 1);
function question(w, rng) {
  const lower = w.right.toLowerCase(), right = stressIndex(w.right), wrong = stressIndex(w.wrong);
  const extra = [...lower].map((c, i) => (/[аеёиоуыэюя]/.test(c) && i !== right && i !== wrong ? i : -1)).filter(i => i >= 0);
  const variants = [w.right, w.wrong];
  if (extra.length) variants.push(mark(lower, rng.pick(extra)));
  const options = rng.shuffle(variants);
  return { id: w.id, word: lower, options, answer: options.indexOf(w.right), hint: w.hint };
}
// Слова, в которых человек ошибался за последние дни и потом ещё не ответил верно (свежие ошибки первыми).
export function missedStress(events, today, days = 45) {
  const from = addDays(today, -days), last = new Map();
  for (const e of dictionOf(events)) {
    if (e.payload.kind !== 'stress' || e.payload.date < from) continue;
    for (const id of e.payload.fixed ?? []) last.delete(id);
    for (const id of e.payload.miss ?? []) { last.delete(id); last.set(id, e.payload.date); }
  }
  return [...last].sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => id);
}
export function stressQuiz({ seed = 1, n = 10, miss = [] } = {}) {
  const rng = makeRng(seed + 303), missed = miss.map(stressById).filter(Boolean);
  const first = rng.shuffle(missed).slice(0, Math.min(missed.length, Math.floor(n / 2)));
  const rest = rng.shuffle(STRESS_WORDS.filter(w => !first.includes(w))).slice(0, n - first.length);
  return rng.shuffle([...first, ...rest]).map(w => question(w, rng));
}
