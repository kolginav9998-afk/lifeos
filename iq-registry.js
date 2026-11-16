// Описание новых тестов (логика, память, скорость): добавляются к реестру из bt-core.js. Чистые данные и проверки достоверности.
// Принцип тот же, что и у прежних тестов: сравнение с самим собой во времени. Это не IQ-тест и не диагностика.

const ITEM_METRICS = { n: 'Заданий', correct: 'Верно', accuracy: 'Точность', meanMs: 'Среднее время на задание, мс', score: 'Баллы (с учётом сложности)', maxScore: 'Возможно баллов', maxLevel: 'Самое трудное из решённых' };

export const IQ_TESTS = [
  { id: 'matrices', title: 'Матрицы', domain: 'reasoning', minutes: 10, kind: 'logic', desc: 'Найди недостающую фигуру в таблице 3×3. 12 заданий от лёгких к трудным, время не ограничено.',
    primary: { key: 'correct', label: 'Верных ответов из 12', unit: '', better: 'higher', digits: 0 }, metrics: ITEM_METRICS },
];

// Параметры шагов для запуска отдельного теста и планов.
export const IQ_STEPS = {
  matrices: { id: 'matrices', n: 12 },
};

// Достоверность: что считать «лишь бы пройти». Возвращает строку-причину или null.
export const IQ_VALID = {
  matrices: m => (m.n >= 6 ? null : 'мало заданий'),
};

export const IQ_PLANS = {};
