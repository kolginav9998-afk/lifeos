// «Блоки Корси» (зрительно-пространственная память): девять блоков на поле, подсвечивается порядок, нужно повторить его. Чистая логика.
// Длина растёт на единицу после верного повтора; тест заканчивается после двух неудач подряд на одной длине (процедура та же, что у цифр).
import { SpanProcedure } from './bt-logic.js';

export { SpanProcedure };
// Левый верхний угол блока в процентах поля. Нумерация «Блок 1…9» идёт по строкам сверху вниз, слева направо: так блоки читает экранный диктор и так идёт Tab.
export const CORSI_BLOCKS = [[8, 10], [41, 4], [74, 12], [22, 36], [56, 40], [78, 50], [6, 64], [38, 70], [70, 78]];
export const BLOCK_SIZE = 18;
export const CORSI_START = 2, CORSI_MAX = 9;
export const blockLabel = i => `Блок ${i + 1}`;

// Последовательность из len разных блоков; не повторяет предыдущую (avoid).
export function makeCorsiSeq(rng, len, avoid = null) {
  for (let t = 0; t < 50; t++) {
    const seq = rng.shuffle(Array.from({ length: CORSI_BLOCKS.length }, (_, i) => i)).slice(0, len);
    if (!avoid || avoid.length !== seq.length || seq.some((b, i) => b !== avoid[i])) return seq;
  }
  return rng.shuffle(Array.from({ length: CORSI_BLOCKS.length }, (_, i) => i)).slice(0, len);
}
export const checkCorsi = (seq, taps) => seq.length === taps.length && seq.every((b, i) => b === taps[i]);

// history — записи процедуры { len, passed }. Корси-балл: объём × число верных попыток (как принято в литературе).
export function scoreCorsi(history) {
  const ok = history.filter(h => h.passed), span = ok.length ? Math.max(...ok.map(h => h.len)) : 0;
  return { span, attempts: history.length, correct: ok.length, score: span * ok.length };
}
