// Личные эксперименты (N-of-1): две фазы — A «как обычно» и B «с изменением», блоками по неделе в случайном порядке.
// По итогам сравниваем выбранный показатель в фазах. Это подсказка для одного человека, а не доказательство.
import { addDays, daysBetween, isYmd, newId } from './events.js';
import { makeRng, mean, median, sd, round } from './stats.js';

export const METRICS = {
  composite: { label: 'Общий результат проверок', better: 'higher', unit: 'σ', source: 'проверки (Развитие → Тесты)' },
  sleepHours: { label: 'Сон, часов', better: 'higher', unit: 'ч', source: 'утренняя отметка' },
  sleepQuality: { label: 'Качество сна (1–5)', better: 'higher', unit: '', source: 'утренняя отметка' },
  moodMorning: { label: 'Настроение утром (1–5)', better: 'higher', unit: '', source: 'утренняя отметка' },
  energyMorning: { label: 'Энергия утром (1–5)', better: 'higher', unit: '', source: 'утренняя отметка' },
  moodEvening: { label: 'Настроение вечером (1–5)', better: 'higher', unit: '', source: 'вечерняя отметка' },
  energyEvening: { label: 'Энергия вечером (1–5)', better: 'higher', unit: '', source: 'вечерняя отметка' },
  stressEvening: { label: 'Стресс вечером (1–5)', better: 'lower', unit: '', source: 'вечерняя отметка' },
  focus: { label: 'Фокус (1–5)', better: 'higher', unit: '', source: 'вечерняя отметка' },
  productivity: { label: 'Продуктивность (1–5)', better: 'higher', unit: '', source: 'вечерняя отметка' },
};

export const PRESETS = [
  { id: 'caffeine14', title: 'Кофе только до 14:00', change: 'Последний кофе и чай с кофеином — до 14:00.', metric: 'sleepQuality', days: 14 },
  { id: 'sleep7', title: 'Спать не меньше 7 часов', change: 'Ложиться так, чтобы поспать не меньше 7 часов.', metric: 'composite', days: 28 },
  { id: 'walk20', title: 'Прогулка 20 минут днём', change: 'Каждый день выходить на прогулку на 20 минут (лучше на дневной свет).', metric: 'moodEvening', days: 14 },
  { id: 'noscreen', title: 'Без экрана за час до сна', change: 'За час до сна не пользоваться телефоном и телевизором.', metric: 'sleepQuality', days: 14 },
  { id: 'breath', title: 'Дыхание 4–6 вечером', change: 'Каждый вечер 5 минут дыхания 4–6 (раздел «Здоровье»).', metric: 'stressEvening', days: 14 },
  { id: 'morninglight', title: 'Утром 10 минут на свету', change: 'После пробуждения 10 минут побыть на улице или у окна.', metric: 'energyEvening', days: 14 },
];

export const SAFETY = 'Не меняй лекарства, не голодай и не нагружай себя при болезни. Эксперименты — только про обычные привычки; если сомневаешься, спроси врача.';
export const DAYS_OPTIONS = [14, 28];
const BLOCK = 7;

export function makeOrder(blocks, rng) {
  if (blocks < 2 || blocks % 2) throw new Error('bad blocks');
  return rng.shuffle([...Array(blocks / 2).fill('A'), ...Array(blocks / 2).fill('B')]);
}

export function makeExperiment({ title, change, metric, days = 14, startDate }, { rng = makeRng(Date.now()), now = Date.now(), id } = {}) {
  const t = String(title ?? '').trim().slice(0, 100), c = String(change ?? '').trim().slice(0, 300);
  if (!t) throw new Error('Назови эксперимент');
  if (!c) throw new Error('Опиши, что именно меняется в фазе B');
  if (!METRICS[metric]) throw new Error('Выбери показатель');
  if (!DAYS_OPTIONS.includes(days)) throw new Error('Длительность: 14 или 28 дней');
  if (!isYmd(startDate)) throw new Error('Дата начала указана неверно');
  return { id: id || `exp:${newId()}`, type: 'experiment', ts: now, source: 'manual', confidence: 1, evidence: [],
    payload: { title: t, change: c, metric, days, blockDays: BLOCK, startDate, order: makeOrder(days / BLOCK, rng), cancelled: false } };
}

export const endDate = p => addDays(p.startDate, p.days - 1);
export function phaseOf(p, date) {
  const i = Math.floor(daysBetween(p.startDate, date) / p.blockDays);
  return i < 0 || i >= p.order.length ? null : p.order[i];
}
// planned — ещё не началось, active — идёт, ended — срок вышел, cancelled — остановлен
export function stateOf(p, today) {
  if (p.cancelled) return 'cancelled';
  if (today < p.startDate) return 'planned';
  return today > endDate(p) ? 'ended' : 'active';
}
export const experimentsOf = events => events.filter(e => e.type === 'experiment').sort((a, b) => b.payload.startDate.localeCompare(a.payload.startDate));
export const activeExperiments = (events, today) => experimentsOf(events).filter(e => stateOf(e.payload, today) === 'active');

// Сравнение фаз по строкам таблицы дней (dailyRows). Возвращает числа и осторожный вывод.
export function evaluate(p, rows, today, { permutations = 2000, seed = 7 } = {}) {
  const m = METRICS[p.metric];
  const A = [], B = [];
  for (const r of rows) {
    if (r.date > today) continue;
    const ph = phaseOf(p, r.date);
    const v = r[p.metric];
    if (!ph || !Number.isFinite(v)) continue;
    (ph === 'A' ? A : B).push(v);
  }
  const res = { metric: p.metric, nA: A.length, nB: B.length, meanA: A.length ? mean(A) : null, meanB: B.length ? mean(B) : null, diff: null, d: null, p: null, verdict: 'insufficient' };
  const note = 'Это один человек и короткий срок: результат — подсказка. Соседние дни похожи друг на друга, поэтому уверенность завышена.';
  if (A.length < 5 || B.length < 5) {
    res.text = `Пока мало дней с данными: нужно хотя бы по 5 в каждой фазе (сейчас A: ${A.length}, B: ${B.length}). Для показателя «${m.label}» нужны ежедневные данные: ${m.source}.`;
    return res;
  }
  const diff = mean(B) - mean(A);
  const sA = sd(A), sB = sd(B);
  const pooled = Math.sqrt(((A.length - 1) * sA ** 2 + (B.length - 1) * sB ** 2) / (A.length + B.length - 2));
  const d = pooled > 1e-9 ? diff / pooled : null;
  const rng = makeRng(seed);
  const all = [...A, ...B];
  let extreme = 0;
  for (let i = 0; i < permutations; i++) {
    const s = rng.shuffle(all);
    const mb = mean(s.slice(0, B.length)), ma = mean(s.slice(B.length));
    if (Math.abs(mb - ma) >= Math.abs(diff) - 1e-12) extreme++;
  }
  const pv = (extreme + 1) / (permutations + 1);
  Object.assign(res, { diff, d, p: pv });
  const good = m.better === 'higher' ? diff > 0 : diff < 0;
  const f = x => String(round(x, 2)).replace('.', ',');
  const nums = `Среднее в фазе A (как обычно): ${f(mean(A))}, в фазе B (с изменением): ${f(mean(B))}; разница ${diff > 0 ? '+' : diff < 0 ? '−' : ''}${f(Math.abs(diff))}. Дней: ${A.length} и ${B.length}.`;
  if (d === null || Math.abs(d) < 0.3 || pv >= 0.2) { res.verdict = 'none'; res.text = `${nums} Заметной разницы не видно. ${note}`; }
  else if (pv < 0.1 && Math.abs(d) >= 0.5) { res.verdict = good ? 'better' : 'worse'; res.text = `${nums} Похоже, что в фазе B показатель «${m.label}» ${good ? 'лучше' : 'хуже'} (размер эффекта ${f(Math.abs(d))}, p ≈ ${f(pv)}). ${note}`; }
  else { res.verdict = 'unclear'; res.text = `${nums} Есть намёк на ${good ? 'улучшение' : 'ухудшение'}, но данных недостаточно для уверенности (p ≈ ${f(pv)}). Можно продлить или повторить. ${note}`; }
  return res;
}
