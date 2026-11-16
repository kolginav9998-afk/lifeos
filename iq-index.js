// «Условный индекс логики»: одно число по тестам на логику, считается ТОЛЬКО из твоих результатов. Чистая логика.
// ЧЕСТНОСТЬ: это не IQ и не диагноз. У приложения нет данных о других людях, набор заданий не проверялся на людях, поэтому число ничего не говорит о том,
// как ты выглядишь на фоне других. Оно показывает долю решённых заданий (трудные весят больше) за вычетом случайного угадывания и всегда идёт с широким диапазоном.
import { CHANCE } from './iq-core.js';

export const LOGIC_IDS = Object.keys(CHANCE);
export const MIN_ITEMS = 6;
export const WINDOW_DAYS = 90;

export const INDEX_TITLE = 'Условный индекс логики (для интереса, не медицинский IQ)';
export const INDEX_NOT_IQ = 'Это не IQ и не диагноз. Настоящий IQ вычисляют по нормам — результатам тысяч людей, а у приложения нет данных о других людях, и задания не проверялись на людях. Число сравнивает тебя только с самим собой.';
export const INDEX_HOW = [
  'Берём долю верных ответов в тестах на логику: трудные задания весят больше. Вычитаем то, что можно набрать случайным угадыванием. Получается число от 0 до 100: 0 — на уровне угадывания, 100 — решено всё.',
  'Диапазон — примерные границы, в которых число могло случайно оказаться из-за небольшого числа заданий. Он широкий, и настоящая неопределённость ещё больше: на результат влияют сон, усталость, внимание и привычка к заданиям.',
  'Смотри на динамику за много прохождений, а не на одно число. Если диапазоны двух прохождений пересекаются, считай, что разницы по этим данным не видно.',
];

// Доверительный интервал Уилсона для доли p при n заданиях (95%).
export function wilson(p, n, z = 1.96) {
  if (!(n > 0)) return null;
  const d = 1 + (z * z) / n, c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

// parts: [{ id, score, maxScore, n }] — набранные и возможные баллы и число заданий по каждому тесту.
export function indexOf(parts) {
  const ok = parts.filter(p => p.maxScore > 0 && p.n > 0 && Number.isFinite(p.score));
  const items = ok.reduce((s, p) => s + p.n, 0), W = ok.reduce((s, p) => s + p.maxScore, 0);
  if (!ok.length || items < MIN_ITEMS) return null;
  const P = ok.reduce((s, p) => s + p.score, 0) / W, g = ok.reduce((s, p) => s + (CHANCE[p.id] ?? 0.25) * p.maxScore, 0) / W;
  const [lo, hi] = wilson(P, items), c = x => Math.round(100 * Math.max(0, Math.min(1, (x - g) / (1 - g))));
  return { index: c(P), lo: c(lo), hi: c(hi), items, tests: ok.map(p => p.id), accuracy: Math.round(P * 1000) / 1000, chance: Math.round(g * 1000) / 1000 };
}

const partOf = (run, id) => {
  const t = run.tests?.[id], m = t?.metrics;
  return t && !t.skipped && t.ok && m && m.maxScore > 0 ? { id, score: m.score, maxScore: m.maxScore, n: m.n, date: run.date, ts: run.startedAt } : null;
};
export const runParts = run => LOGIC_IDS.map(id => partOf(run, id)).filter(Boolean);

// Сейчас: последний достоверный результат каждого теста на логику за последние WINDOW_DAYS дней, сложенные вместе.
export function logicIndexNow(runs, now = Date.now(), windowDays = WINDOW_DAYS) {
  const from = now - windowDays * 86400000, parts = [];
  for (const id of LOGIC_IDS) for (let i = runs.length - 1; i >= 0; i--) { if (runs[i].startedAt < from) break; const p = partOf(runs[i], id); if (p) { parts.push(p); break; } }
  const r = indexOf(parts);
  return r ? { ...r, parts: parts.map(p => ({ id: p.id, date: p.date })) } : null;
}
// Динамика: по одному значению на каждое прохождение, где были тесты на логику (в порядке времени).
export function logicProgress(runs) {
  return [...runs].sort((a, b) => a.startedAt - b.startedAt).map(run => { const r = indexOf(runParts(run)); return r ? { ts: run.startedAt, date: run.date, ...r } : null; }).filter(Boolean);
}
// Сравнение двух значений: 'up' / 'down' только если диапазоны не пересекаются, иначе 'same'.
export const compareIndex = (a, b) => (a.lo > b.hi ? 'up' : a.hi < b.lo ? 'down' : 'same');

export const indexShort = r => `Условный индекс логики: ${r.index} из 100 (примерно от ${r.lo} до ${r.hi}) — не IQ, только для сравнения с собой`;

// Сырые результаты словами: что именно получилось (верные ответы, время).
const sec = ms => `${Math.round(ms / 1000)} с`;
export function rawLine(id, m) {
  if (!m) return '';
  if (LOGIC_IDS.includes(id)) return `Верно ${m.correct} из ${m.n}${m.meanMs ? `; в среднем ${sec(m.meanMs)} на задание` : ''}`;
  if (id === 'corsi') return `Самая длинная верная последовательность: ${m.span}; верных попыток ${m.correct} из ${m.attempts}`;
  if (id === 'stroop40') return `Верно ${m.correct} из ${m.n}${m.interference != null ? `; помеха ${m.interference} мс` : ''}${m.medianRT ? `; медиана верных ${m.medianRT} мс` : ''}`;
  if (id === 'coding') return `Верно ${m.correct} из ${m.n} за 90 с${m.accuracy != null ? `; точность ${Math.round(m.accuracy * 100)}%` : ''}`;
  return '';
}
