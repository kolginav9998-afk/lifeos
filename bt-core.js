// Ежедневная проверка: реестр тестов, планы, правила достоверности и запись результата.
// Тесты нужны для сравнения тебя с самим собой во времени, а не для оценки интеллекта или диагноза.
import { round } from './stats.js';

export const DOMAINS = {
  speed: 'Скорость', attention: 'Внимание', control: 'Самоконтроль', memory: 'Память',
  numeric: 'Счёт', reasoning: 'Логика', timing: 'Чувство времени', learning: 'Усвоение знаний',
};

// primary — главный показатель для динамики; better — что считать лучше; scale — множитель для показа (доли → %).
export const TESTS = [
  { id: 'reaction', title: 'Реакция', domain: 'speed', minutes: 1, desc: 'Нажми, как только экран позеленеет. Не раньше!',
    primary: { key: 'median', label: 'Время реакции', unit: 'мс', better: 'lower', digits: 0 },
    metrics: { n: 'Попыток', median: 'Медиана, мс', mean: 'Среднее, мс', sd: 'Разброс, мс', best: 'Лучшая, мс', lapses: 'Провалов (>500 мс)', falseStarts: 'Фальстартов' } },
  { id: 'gonogo', title: 'Жми / не жми', domain: 'control', minutes: 1, desc: 'Зелёный круг — жми, красный квадрат — не жми.',
    primary: { key: 'dPrime', label: 'Различение (d′)', unit: '', better: 'higher', digits: 2 },
    metrics: { n: 'Заданий', hits: 'Попаданий', omissions: 'Пропусков', commissions: 'Ошибочных нажатий', correctRejections: 'Верных «не жми»', accuracy: 'Точность', inhibition: 'Торможение', medianRT: 'Медиана реакции, мс', dPrime: 'd′' } },
  { id: 'stroop', title: 'Цвет слова', domain: 'control', minutes: 1, desc: 'Выбери цвет, которым написано слово, а не само слово.',
    primary: { key: 'interference', label: 'Помеха Струпа', unit: 'мс', better: 'lower', digits: 0 },
    metrics: { n: 'Заданий', correct: 'Верно', accuracy: 'Точность', meanCongruent: 'Среднее при совпадении, мс', meanIncongruent: 'Среднее при несовпадении, мс', interference: 'Помеха, мс', errorsIncongruent: 'Ошибок при несовпадении' } },
  { id: 'digits', title: 'Цифры по памяти', domain: 'memory', minutes: 2, desc: 'Запомни цифры и повтори их: сначала в том же порядке, потом задом наперёд.',
    primary: { key: 'total', label: 'Объём памяти', unit: '', better: 'higher', digits: 0 },
    metrics: { forward: 'Прямо', backward: 'Задом наперёд', total: 'Сумма', attempts: 'Попыток' } },
  { id: 'words', title: 'Слова: узнавание', domain: 'memory', minutes: 1, desc: 'Запомни слова в начале, а в конце скажи, какие из них были.',
    primary: { key: 'dPrime', label: 'Узнавание (d′)', unit: '', better: 'higher', digits: 2 },
    metrics: { n: 'Слов', hits: 'Узнано', misses: 'Пропущено', falseAlarms: 'Ложных «были»', correctRejections: 'Верных «не было»', accuracy: 'Точность', dPrime: 'd′' } },
  { id: 'math', title: 'Счёт в уме', domain: 'numeric', minutes: 1, desc: 'Решай примеры на время. Сложность подстраивается.',
    primary: { key: 'perMinute', label: 'Верных в минуту', unit: '', better: 'higher', digits: 1 },
    metrics: { n: 'Примеров', correct: 'Верно', accuracy: 'Точность', meanMs: 'Среднее время, мс', perMinute: 'Верных в минуту', maxLevel: 'Макс. уровень' } },
  { id: 'series', title: 'Числовые ряды', domain: 'reasoning', minutes: 2, desc: 'Найди закономерность и выбери следующее число.',
    primary: { key: 'score', label: 'Баллы за ряды', unit: '', better: 'higher', digits: 0 },
    metrics: { n: 'Рядов', correct: 'Верно', accuracy: 'Точность', meanMs: 'Среднее время, мс', score: 'Баллы (с учётом сложности)' } },
  { id: 'schulte', title: 'Таблица Шульте', domain: 'attention', minutes: 1, desc: 'Найди и нажми числа по порядку как можно быстрее.',
    primary: { key: 'meanPerNumber', label: 'Время на число', unit: 'мс', better: 'lower', digits: 0 },
    metrics: { n: 'Найдено', errors: 'Ошибок', totalMs: 'Всего, мс', meanPerNumber: 'На число, мс', fatigue: 'Усталость (вторая половина / первая)' } },
  { id: 'time', title: 'Чувство времени', domain: 'timing', minutes: 1, desc: 'Удерживай кнопку, пока, как тебе кажется, не пройдёт заданное время.',
    primary: { key: 'meanAbsErrorRel', label: 'Ошибка оценки', unit: '%', better: 'lower', digits: 1, scale: 100 },
    metrics: { n: 'Попыток', meanAbsErrorMs: 'Средняя ошибка, мс', meanAbsErrorRel: 'Средняя ошибка (доля)', biasMs: 'Смещение, мс (минус — торопишься)' } },
  { id: 'recall', title: 'Проверка знаний', domain: 'learning', minutes: 1, desc: 'Вопросы из твоих курсов: помнишь ли выученное.',
    primary: { key: 'accuracy', label: 'Верных ответов', unit: '%', better: 'higher', digits: 0, scale: 100 },
    metrics: { n: 'Вопросов', correct: 'Верно', accuracy: 'Точность', meanMs: 'Среднее время, мс' } },
];
export const TEST_BY_ID = Object.fromEntries(TESTS.map(t => [t.id, t]));

// Планы прохождения. Слова запоминаются в начале и проверяются в конце — получается отложенное узнавание.
export const PLANS = {
  quick: { id: 'quick', title: 'Быстрая проверка', about: 'около 5 минут', steps: [
    { id: 'wordsLearn', n: 8 }, { id: 'reaction', n: 5 }, { id: 'gonogo', n: 16 }, { id: 'stroop', n: 12 }, { id: 'digits', max: 7 },
    { id: 'math', seconds: 45 }, { id: 'recall', n: 6 }, { id: 'wordsRecall' }] },
  full: { id: 'full', title: 'Полная проверка', about: 'около 12 минут', steps: [
    { id: 'wordsLearn', n: 12 }, { id: 'reaction', n: 8 }, { id: 'gonogo', n: 32 }, { id: 'stroop', n: 24 }, { id: 'digits', max: 10 },
    { id: 'schulte', size: 25 }, { id: 'series', n: 8 }, { id: 'math', seconds: 90 }, { id: 'time', targets: [5000, 10000, 15000] }, { id: 'recall', n: 10 }, { id: 'wordsRecall' }] },
};
export function singlePlan(testId) {
  const full = PLANS.full.steps.find(s => s.id === testId);
  if (testId === 'words') return { id: `single:words`, title: 'Слова: узнавание', about: 'около 2 минут', steps: [{ id: 'wordsLearn', n: 10 }, { id: 'digits', max: 6 }, { id: 'wordsRecall' }] };
  if (!full || !TEST_BY_ID[testId]) throw new Error('unknown test');
  return { id: `single:${testId}`, title: TEST_BY_ID[testId].title, about: 'около минуты', steps: [{ ...full }] };
}

// ---------- значения ----------
export const primaryOf = (testId, metrics) => {
  const p = TEST_BY_ID[testId]?.primary;
  const v = metrics?.[p?.key];
  return Number.isFinite(v) ? v : null;
};
export const primaryShown = (testId, metrics) => { const v = primaryOf(testId, metrics); const s = TEST_BY_ID[testId]?.primary.scale ?? 1; return v === null ? null : v * s; };
export function fmtNum(v, digits = 0) {
  if (!Number.isFinite(v)) return '—';
  const r = round(v, digits);
  return String(digits ? r.toFixed(digits) : Math.round(r)).replace('.', ',');
}
export function fmtPrimary(testId, metrics) {
  const t = TEST_BY_ID[testId]; const v = primaryShown(testId, metrics);
  if (!t || v === null) return '—';
  return `${fmtNum(v, t.primary.digits)}${t.primary.unit ? ' ' + t.primary.unit : ''}`;
}
export function fmtMetric(testId, key, v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${x.ok}/${x.n}`).join('; ');
  if (!Number.isFinite(v)) return '—';
  if (key === 'accuracy' || key === 'inhibition') return `${fmtNum(v * 100, 0)}%`;
  if (key === 'meanAbsErrorRel') return `${fmtNum(v * 100, 1)}%`;
  return fmtNum(v, Number.isInteger(v) ? 0 : 2);
}

// ---------- достоверность ----------
// Если тест явно выполнялся «лишь бы пройти» (случайные нажатия, мало ответов), он не должен портить личную норму.
export function validity(testId, m) {
  if (!m) return { ok: false, reason: 'нет данных' };
  const bad = reason => ({ ok: false, reason });
  switch (testId) {
    case 'reaction': if (!(m.n >= 3)) return bad('мало попыток'); if (m.median < 100) return bad('слишком быстро — похоже на угадывание'); if (m.falseStarts > 4) return bad('много фальстартов'); break;
    case 'gonogo': if (!(m.n >= 10)) return bad('мало заданий'); if (m.hits + m.omissions > 0 && m.hits / (m.hits + m.omissions) < 0.5) return bad('большинство «жми» пропущено'); break;
    case 'stroop': if (!(m.n >= 8)) return bad('мало заданий'); if (m.accuracy < 0.5) return bad('точность ниже половины'); break;
    case 'digits': if (!(m.forward >= 2)) return bad('не пройдена даже короткая последовательность'); break;
    case 'words': if (!(m.n >= 8)) return bad('мало слов'); break;
    case 'math': if (!(m.n >= 3)) return bad('мало примеров'); break;
    case 'series': if (!(m.n >= 3)) return bad('мало рядов'); break;
    case 'schulte': if (!(m.n >= 9)) return bad('таблица не пройдена'); break;
    case 'time': if (!(m.n >= 2)) return bad('мало попыток'); break;
    case 'recall': if (!(m.n >= 4)) return bad('мало вопросов'); break;
    default: break;
  }
  return { ok: true };
}

// ---------- запись результата ----------
export const RUN_VERSION = 1;
export const runId = startedAt => `tr:${Math.floor(startedAt).toString(36)}`;

const num = x => (typeof x === 'number' ? (Number.isInteger(x) ? x : Math.round(x * 1000) / 1000) : x);
// Данные проб в компактном виде: числа округлены, пустые поля убраны.
export function packTrials(trials) {
  return (trials || []).map(t => {
    const o = {};
    for (const [k, v] of Object.entries(t)) { if (v === null || v === undefined || v === false) continue; o[k] = typeof v === 'boolean' ? 1 : num(v); }
    return o;
  });
}
export function makeRun({ mode, startedAt, durationMs, state = null, results, aborted = false, env = {} }) {
  const date = (() => { const d = new Date(startedAt); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const d = new Date(startedAt);
  const tests = {};
  for (const [id, r] of Object.entries(results)) {
    if (r.skipped) { tests[id] = { skipped: r.skipped }; continue; }
    const v = validity(id, r.metrics);
    tests[id] = { metrics: r.metrics, ok: v.ok, ...(v.ok ? {} : { why: v.reason }), ms: Math.round(r.ms || 0), trials: packTrials(r.trials), ...(r.extra ? { extra: r.extra } : {}) };
  }
  return { v: RUN_VERSION, mode, date, startedAt, hour: d.getHours(), weekday: d.getDay(), durationMs: Math.round(durationMs), aborted: !!aborted, state, env, tests };
}
export function makeRunEvent(payload, now = Date.now()) {
  return { id: runId(payload.startedAt), type: 'testrun', ts: now, payload, source: 'manual', confidence: 1, evidence: [] };
}
export const runsOf = events => events.filter(e => e.type === 'testrun' && e.payload && e.payload.tests).map(e => e.payload).sort((a, b) => a.startedAt - b.startedAt);

// Состояние перед тестом (самооценка) — помогает отделять «плохой день» от «плохой формы».
export const STATE_FIELDS = { sleepy: 'Сонливость', energy: 'Энергия', mood: 'Настроение', stress: 'Стресс' };
export function cleanState(s) {
  if (!s) return null;
  const o = {};
  for (const k of Object.keys(STATE_FIELDS)) if (Number.isInteger(s[k]) && s[k] >= 1 && s[k] <= 5) o[k] = s[k];
  for (const k of ['caffeine3h', 'noise']) if (typeof s[k] === 'boolean') o[k] = s[k];
  return Object.keys(o).length ? o : null;
}
