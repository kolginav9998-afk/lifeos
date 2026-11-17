import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../stats.js';
import { STROOP_COLORS } from '../bt-logic.js';
import { CORSI_BLOCKS, BLOCK_SIZE, SpanProcedure, makeCorsiSeq, checkCorsi, scoreCorsi, blockLabel } from '../iq-span.js';
import { makeStroop40, scoreStroop40, NEUTRAL_WORDS, SYMBOLS, makeCodingKey, makeCodingStream, scoreCoding, keyDescription, STROOP40_N } from '../iq-fast.js';

test('Корси: девять блоков помещаются в поле и не налезают друг на друга, подписи по порядку', () => {
  assert.equal(CORSI_BLOCKS.length, 9);
  for (const [x, y] of CORSI_BLOCKS) assert.ok(x >= 0 && y >= 0 && x + BLOCK_SIZE <= 100 && y + BLOCK_SIZE <= 100);
  for (let i = 0; i < 9; i++) for (let j = i + 1; j < 9; j++) {
    const [a, b] = [CORSI_BLOCKS[i], CORSI_BLOCKS[j]];
    assert.ok(Math.abs(a[0] - b[0]) >= BLOCK_SIZE + 4 || Math.abs(a[1] - b[1]) >= BLOCK_SIZE + 4, `блоки ${i + 1} и ${j + 1} не слипаются`);
  }
  assert.equal(blockLabel(0), 'Блок 1'); assert.equal(blockLabel(8), 'Блок 9');
  // нумерация идёт по строкам сверху вниз
  const rows = [CORSI_BLOCKS.slice(0, 3), CORSI_BLOCKS.slice(3, 6), CORSI_BLOCKS.slice(6, 9)];
  rows.forEach((r, i) => { if (i) assert.ok(Math.min(...r.map(b => b[1])) > Math.max(...rows[i - 1].map(b => b[1]))); });
});

test('Корси: последовательности из разных блоков нужной длины, не повторяют предыдущую; сверка и подсчёт', () => {
  const rng = makeRng(3);
  let prev = null;
  for (let len = 2; len <= 9; len++) for (let k = 0; k < 20; k++) {
    const s = makeCorsiSeq(rng, len, prev);
    assert.equal(s.length, len); assert.equal(new Set(s).size, len); assert.ok(s.every(b => b >= 0 && b < 9));
    if (prev && prev.length === len) assert.notDeepEqual(s, prev);
    prev = s;
  }
  assert.ok(checkCorsi([1, 4, 2], [1, 4, 2])); assert.ok(!checkCorsi([1, 4, 2], [1, 2, 4])); assert.ok(!checkCorsi([1, 4, 2], [1, 4]));
  const p = new SpanProcedure({ start: 2, max: 9 });
  p.record(true); p.record(true); p.record(false); p.record(true); p.record(false); p.record(false);
  assert.ok(p.finished);
  assert.deepEqual(scoreCorsi(p.history), { span: 4, attempts: 6, correct: 3, score: 12 });
  assert.deepEqual(scoreCorsi([{ len: 2, passed: false }, { len: 2, passed: false }]), { span: 0, attempts: 2, correct: 0, score: 0 });
});

test('Струп-40: 10 совпадений, 20 несовпадений, 10 нейтральных; цвета поровну; слово не равно цвету в несовпадениях', () => {
  const ids = STROOP_COLORS.map(c => c.id);
  for (let seed = 1; seed <= 60; seed++) {
    const t = makeStroop40(makeRng(seed));
    assert.equal(t.length, STROOP40_N);
    const by = k => t.filter(x => x.kind === k);
    assert.deepEqual([by('con').length, by('inc').length, by('neu').length], [10, 20, 10]);
    for (const x of by('con')) assert.equal(x.word, x.ink);
    for (const x of by('inc')) { assert.ok(x.word && x.word !== x.ink && ids.includes(x.word)); assert.equal(x.text, STROOP_COLORS.find(c => c.id === x.word).word); }
    for (const x of by('neu')) { assert.equal(x.word, null); assert.ok(NEUTRAL_WORDS.includes(x.text)); assert.ok(!STROOP_COLORS.some(c => c.word === x.text)); }
    for (const id of ids) assert.equal(t.filter(x => x.ink === id).length, 10, `цвет ${id}: по 10 проб`);
    for (let i = 1; i < t.length; i++) assert.ok(!(t[i].text === t[i - 1].text && t[i].ink === t[i - 1].ink), 'нет одинаковых подряд');
    let run = 1; for (let i = 1; i < t.length; i++) { run = t[i].kind === t[i - 1].kind ? run + 1 : 1; assert.ok(run <= 4, 'не более четырёх одного вида подряд'); }
  }
  assert.deepEqual(makeStroop40(makeRng(9)), makeStroop40(makeRng(9)));
  assert.notDeepEqual(makeStroop40(makeRng(9)), makeStroop40(makeRng(10)));
});

test('Струп-40: помеха = несовпадение минус нейтральная проба, выигрыш = нейтральная минус совпадение; ошибки не входят во время', () => {
  const trials = [
    { kind: 'con', correct: true, rt: 600 }, { kind: 'con', correct: true, rt: 640 },
    { kind: 'neu', correct: true, rt: 700 }, { kind: 'neu', correct: true, rt: 720 }, { kind: 'neu', correct: false, rt: 200 },
    { kind: 'inc', correct: true, rt: 900 }, { kind: 'inc', correct: true, rt: 880 }, { kind: 'inc', correct: false, rt: 1500 },
  ];
  const s = scoreStroop40(trials);
  assert.deepEqual([s.meanCongruent, s.meanNeutral, s.meanIncongruent, s.interference, s.facilitation, s.errorsIncongruent, s.n, s.correct], [620, 710, 890, 180, 90, 1, 8, 6]);
  assert.equal(s.accuracy, 0.75);
  assert.equal(scoreStroop40([{ kind: 'con', correct: true, rt: 500 }]).interference, null);
});

test('Кодирование: девять знаков с названиями и контурами, ключ — перестановка цифр 1…9, поток без повторов подряд', () => {
  assert.equal(SYMBOLS.length, 9);
  assert.equal(new Set(SYMBOLS.map(s => s.id)).size, 9); assert.equal(new Set(SYMBOLS.map(s => s.name)).size, 9); assert.equal(new Set(SYMBOLS.map(s => s.d)).size, 9);
  assert.ok(SYMBOLS.every(s => /^M[\d\sMLHVZvhlaAq.,-]+$/.test(s.d) && s.name.length > 3));
  for (let seed = 1; seed <= 40; seed++) {
    const rng = makeRng(seed), key = makeCodingKey(rng);
    assert.deepEqual([...key].sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const s = makeCodingStream(rng, 160);
    assert.equal(s.length, 160); for (let i = 1; i < s.length; i++) assert.notEqual(s[i], s[i - 1]);
    const counts = Array(9).fill(0); for (const x of s) counts[x]++;
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, 'знаки встречаются поровну (с точностью до одного)');
  }
  assert.notDeepEqual(makeCodingKey(makeRng(1)), makeCodingKey(makeRng(2)));
  assert.match(keyDescription([1, 2, 3, 4, 5, 6, 7, 8, 9]), /^Ключ: плюс — 1; крестик — 2;.*две черты — 9$/);
});

test('Кодирование: верные ответы за время, точность и скорость', () => {
  const trials = [{ correct: true, rt: 1500 }, { correct: true, rt: 1000 }, { correct: false, rt: 2000 }, { correct: true, rt: 1500 }];
  const s = scoreCoding(trials);
  assert.deepEqual([s.n, s.correct, s.accuracy, s.meanMs, s.perMinute], [4, 3, 0.75, 1333, 30]);
  assert.deepEqual(scoreCoding([]), { n: 0, correct: 0, accuracy: null, meanMs: null, perMinute: null });
});
