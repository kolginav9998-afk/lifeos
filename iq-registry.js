// Описание новых тестов (логика, память, скорость): добавляются к реестру из bt-core.js. Чистые данные и проверки достоверности.
// Принцип тот же, что и у прежних тестов: сравнение с самим собой во времени. Это не IQ-тест и не диагностика.

const ITEM_METRICS = { n: 'Заданий', correct: 'Верно', accuracy: 'Точность', meanMs: 'Среднее время на задание, мс', score: 'Баллы (с учётом сложности)', maxScore: 'Возможно баллов', maxLevel: 'Самое трудное из решённых' };

export const IQ_TESTS = [
  { id: 'matrices', title: 'Матрицы', domain: 'reasoning', minutes: 10, kind: 'logic', desc: 'Найди недостающую фигуру в таблице 3×3. 12 заданий от лёгких к трудным, время не ограничено.',
    primary: { key: 'correct', label: 'Верных ответов из 12', unit: '', better: 'higher', digits: 0 }, metrics: ITEM_METRICS },
  { id: 'seq12', title: 'Числовые ряды: 12 заданий', domain: 'reasoning', minutes: 7, kind: 'logic', desc: 'Продолжи ряд: выбери число или введи своё. 12 заданий от лёгких к трудным, время не ограничено.',
    primary: { key: 'correct', label: 'Верных рядов из 12', unit: '', better: 'higher', digits: 0 }, metrics: { ...ITEM_METRICS, typed: 'Ответов, введённых самому' } },
  { id: 'verbal', title: 'Слова и логика', domain: 'reasoning', minutes: 7, kind: 'logic', desc: 'Аналогии, лишнее слово, рассуждения и порядок: 15 коротких заданий, время не ограничено.',
    primary: { key: 'correct', label: 'Верных ответов из 15', unit: '', better: 'higher', digits: 0 }, metrics: ITEM_METRICS },
  { id: 'rotation', title: 'Вращение фигур', domain: 'reasoning', minutes: 6, kind: 'logic', desc: 'Найди фигуру, которая получится, если повернуть образец, не отражая. 12 заданий, время не ограничено.',
    primary: { key: 'correct', label: 'Верных ответов из 12', unit: '', better: 'higher', digits: 0 }, metrics: ITEM_METRICS },
  { id: 'corsi', title: 'Блоки Корси', domain: 'memory', minutes: 4, kind: 'span', desc: 'Блоки подсвечиваются по очереди: запомни порядок и повтори его. Длина растёт, пока не собьёшься.',
    primary: { key: 'span', label: 'Объём (блоков)', unit: '', better: 'higher', digits: 0 }, metrics: { span: 'Объём, блоков', attempts: 'Попыток', correct: 'Верных попыток', score: 'Корси-балл (объём × верные попытки)' } },
  { id: 'stroop40', title: 'Струп: 40 проб', domain: 'control', minutes: 3, kind: 'fast', desc: 'Назови цвет, которым написано слово, а не само слово. 40 проб, важны и точность, и скорость.',
    primary: { key: 'interference', label: 'Помеха Струпа (против нейтрального слова)', unit: 'мс', better: 'lower', digits: 0 },
    metrics: { n: 'Проб', correct: 'Верно', accuracy: 'Точность', meanCongruent: 'Среднее при совпадении, мс', meanNeutral: 'Среднее на нейтральных словах, мс', meanIncongruent: 'Среднее при несовпадении, мс', interference: 'Помеха, мс', facilitation: 'Выигрыш при совпадении, мс', errorsIncongruent: 'Ошибок при несовпадении', medianRT: 'Медиана верных, мс' } },
  { id: 'coding', title: 'Кодирование символов', domain: 'speed', minutes: 2, kind: 'fast', desc: 'Каждому знаку соответствует цифра. Вводи цифры к знакам, пока идут 90 секунд.',
    primary: { key: 'correct', label: 'Верных за 90 секунд', unit: '', better: 'higher', digits: 0 }, metrics: { n: 'Ответов', correct: 'Верно', accuracy: 'Точность', meanMs: 'Среднее время верного ответа, мс', perMinute: 'Верных в минуту' } },
];

// Параметры шагов для запуска отдельного теста и планов.
export const IQ_STEPS = {
  matrices: { id: 'matrices', n: 12 },
  seq12: { id: 'seq12', n: 12 },
  verbal: { id: 'verbal', n: 15 },
  rotation: { id: 'rotation', n: 12 },
  corsi: { id: 'corsi', max: 9 },
  stroop40: { id: 'stroop40', n: 40 },
  coding: { id: 'coding', seconds: 90 },
};

// Достоверность: что считать «лишь бы пройти». Возвращает строку-причину или null.
export const IQ_VALID = {
  matrices: m => (m.n >= 6 ? null : 'мало заданий'),
  seq12: m => (m.n >= 6 ? null : 'мало заданий'),
  verbal: m => (m.n >= 8 ? null : 'мало заданий'),
  rotation: m => (m.n >= 6 ? null : 'мало заданий'),
  corsi: m => (m.attempts >= 2 ? null : 'мало попыток'),
  stroop40: m => (m.n >= 20 ? (m.accuracy >= 0.5 ? null : 'точность ниже половины') : 'мало проб'),
  coding: m => (m.n >= 10 ? (m.accuracy >= 0.5 ? null : 'точность ниже половины') : 'мало ответов'),
  selfprofile: m => (m.n >= 15 ? null : 'мало ответов'),      // самоописание: не тест, в TESTS его нет, в общую аналитику не входит
};

export const IQ_PLANS = {
  logic: { id: 'logic', title: 'Проверка логики', about: 'около 25 минут', steps: [IQ_STEPS.matrices, IQ_STEPS.seq12, IQ_STEPS.verbal, IQ_STEPS.rotation] },
  speed: { id: 'speed', title: 'Память и скорость', about: 'около 9 минут', steps: [IQ_STEPS.corsi, IQ_STEPS.stroop40, IQ_STEPS.coding] },
  selfprofile: { id: 'selfprofile', title: 'Профиль характера (ориентир)', about: 'около 5 минут', steps: [{ id: 'selfprofile' }] },
};
