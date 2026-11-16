// Общий подсчёт для тестов из набора заданий (матрицы, ряды, слова и логика, вращение фигур). Чистая логика.
// Проба: { level, correct, rt }. Верный ответ на более трудное задание даёт больше баллов (вес = номер уровня).
import { mean, round } from './stats.js';

export const scoreItems = trials => {
  const ok = trials.filter(t => t.correct), times = trials.map(t => t.rt).filter(Number.isFinite);
  const w = t => t.level || 1;
  return {
    n: trials.length, correct: ok.length, accuracy: trials.length ? round(ok.length / trials.length, 3) : null,
    meanMs: times.length ? Math.round(mean(times)) : null,
    score: ok.reduce((s, t) => s + w(t), 0), maxScore: trials.reduce((s, t) => s + w(t), 0),
    maxLevel: ok.length ? Math.max(...ok.map(w)) : 0,
  };
};

// Доля случайных угадываний при выборе из k вариантов: на неё делается поправка в условном индексе логики.
export const CHANCE = { matrices: 1 / 6, seq12: 1 / 6, verbal: 1 / 4, rotation: 1 / 4 };
