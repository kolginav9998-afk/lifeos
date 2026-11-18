// Адаптация повторений: decay под реальное забывание (два подряд провала — чаще, два подряд успеха — как было)
// и режим «сегодня минимум» (очередь урезается до пяти карточек на повторение, новых нет, на один день).
import test from 'node:test';
import assert from 'node:assert/strict';
import { decayState, trimQueue, minDayActive, MIN_QUEUE, ADAPT_MIN, ADAPT_MAX } from '../adapt.js';
import { choose, typed, order, lessonIndex } from '../zero-kit.js';
import { lessonStatus, makeZcheckEvent, DAY_MS, INTERVAL_DAYS } from '../curriculum.js';

// ---------- decayState: чистая логика ----------
test('decayState: без истории и при одиночном провале decay исходный', () => {
  assert.deepEqual(decayState(1, []), { decay: 1, fails: 0, passes: 0, elevated: false });
  assert.deepEqual(decayState(1, null), { decay: 1, fails: 0, passes: 0, elevated: false });
  assert.deepEqual(decayState(2, [false]), { decay: 2, fails: 1, passes: 0, elevated: false });
  assert.equal(decayState(undefined, []).decay, 1, 'странный исходный decay читается как 1');
});

test('decayState: два подряд провала — повторять чаще (1.5–2), два подряд успеха — вернуться к исходному', () => {
  const up = decayState(1, [false, false]);
  assert.equal(up.elevated, true);
  assert.equal(up.decay, 1.5, 'исходный 1 × 1,5');
  assert.equal(up.fails, 2);
  assert.ok(up.decay >= ADAPT_MIN && up.decay <= ADAPT_MAX);
  const one = decayState(1, [false, false, true]);
  assert.equal(one.elevated, true, 'одиночный успех режим не снимает');
  assert.equal(one.passes, 1);
  const back = decayState(1, [false, false, true, true]);
  assert.deepEqual(back, { decay: 1, fails: 0, passes: 2, elevated: false }, 'два подряд успеха — как было');
  const again = decayState(1, [false, false, true, true, false, false]);
  assert.equal(again.elevated, true, 'новые два подряд провала снова поднимают');
});

test('decayState: границы 1.5–2 при любом исходном decay', () => {
  assert.equal(decayState(2, [false, false]).decay, ADAPT_MAX, 'исходный 2 × 1,5 упрётся в потолок');
  assert.equal(decayState(0.5, [false, false]).decay, ADAPT_MIN, 'исходный 0,5 × 1,5 поднимется до пола');
  assert.ok(Math.abs(decayState(1.2, [false, false]).decay - 1.8) < 1e-9, 'исходный 1,2 × 1,5');
});

// ---------- trimQueue и minDayActive: «сегодня минимум» ----------
test('trimQueue: остаются только карточки на повторение, не больше пяти; новых ноль', () => {
  const due = i => ({ card: { id: `c${i}` }, state: { card: `c${i}`, due: '2026-11-18' } });
  const fresh = i => ({ card: { id: `n${i}` }, state: null });
  const q = [due(1), fresh(1), due(2), due(3), fresh(2), due(4), due(5), due(6), fresh(3)];
  const t = trimQueue(q);
  assert.equal(t.length, MIN_QUEUE);
  assert.deepEqual(t.map(x => x.card.id), ['c1', 'c2', 'c3', 'c4', 'c5'], 'порядок повторений сохранён, новые убраны');
  assert.deepEqual(trimQueue([fresh(1), fresh(2)]), [], 'только новые — пустая очередь');
  assert.deepEqual(trimQueue([due(1), due(2)]).map(x => x.card.id), ['c1', 'c2'], 'повторений меньше пяти — новыми не добираем');
  assert.deepEqual(trimQueue([]), []);
  assert.deepEqual(trimQueue(null), []);
});

test('minDayActive: режим действует только в день отметки', () => {
  assert.equal(minDayActive('2026-11-18', '2026-11-18'), true);
  assert.equal(minDayActive('2026-11-18', '2026-11-19'), false, 'завтра всё как обычно');
  assert.equal(minDayActive('', '2026-11-18'), false, 'отметки нет');
  assert.equal(minDayActive(undefined, '2026-11-18'), false, 'старые настройки без поля читаются');
});

// ---------- интеграция: статус урока с адаптированным decay ----------
const T0 = new Date(2026, 0, 10, 12, 0, 0).getTime();
const at = (days, hours = 0) => T0 + days * DAY_MS + hours * 3600000;
const drills = () => [...Array.from({ length: 6 }, (_, i) => choose(`Вопрос ${i + 1}`, 'да', ['нет', 'не знаю'])), typed('Впиши «да»', 'да'), order('Собери', ['а', 'б', 'в'])];
const track = { id: 'tsta', zero: true, lang: 'english', lessons: [{ id: 'ez-01', title: 'Урок', minutes: 3, stage: 'Этап А', needs: [], drills: drills(), cards: [['в', 'о'], ['в', 'о2']] }] };
const idx = lessonIndex([track]);
const chk = (ok, n, t) => makeZcheckEvent('tsta', 'ez-01', 'quiz', { n, ok }, t);
const st = (events, now) => lessonStatus('ez-01', events, now, idx);

test('урок: после двух подряд провалов повторения срок короче, после двух подряд успехов — как раньше', () => {
  const pass = chk(6, 6, at(0));
  const s0 = st([pass], at(0, 1));
  assert.equal(s0.decay, 1); assert.equal(s0.decayBase, 1); assert.equal(s0.winStreak, 1); assert.equal(s0.failStreak, 0);
  assert.equal(s0.dueAt, at(0) + INTERVAL_DAYS[0] * DAY_MS, 'обычный срок: 3 дня');
  // два подряд провала повторения → decay 1,5
  const failed = [pass, chk(2, 6, at(4)), chk(2, 6, at(5))];
  const s1 = st(failed, at(5, 1));
  assert.equal(s1.failStreak, 2); assert.equal(s1.decay, 1.5);
  // новое освоение после провалов: интервал делится на поднятый decay
  const re = [...failed, chk(6, 6, at(6))];
  const s2 = st(re, at(6, 1));
  assert.equal(s2.passes, 1); assert.equal(s2.decay, 1.5, 'один успех режим ещё не снял');
  assert.equal(s2.dueAt, at(6) + (INTERVAL_DAYS[0] / 1.5) * DAY_MS, '3 дня ÷ 1,5 = 2 дня: повторим чаще');
  // второй подряд успех → исходный decay
  const ok2 = [...re, chk(6, 6, at(9))];
  const s3 = st(ok2, at(9, 1));
  assert.equal(s3.winStreak, 2); assert.equal(s3.decay, 1, 'два подряд успеха — вернулись к исходному');
  assert.equal(s3.dueAt, at(9) + INTERVAL_DAYS[1] * DAY_MS, 'вторая ступень снова 7 дней');
});

test('урок: повышенный decay урока (2) тоже адаптируется, не выходя за 2', () => {
  const idx2 = lessonIndex([{ ...track, lessons: [{ ...track.lessons[0], decay: 2 }] }]);
  const ev = [chk(6, 6, at(0)), chk(2, 6, at(4)), chk(2, 6, at(5)), chk(6, 6, at(6))];
  const s = lessonStatus('ez-01', ev, at(6, 1), idx2);
  assert.equal(s.decayBase, 2); assert.equal(s.decay, 2, '2 × 1,5 упрётся в потолок 2');
  assert.equal(s.dueAt, at(6) + (INTERVAL_DAYS[0] / 2) * DAY_MS);
});
