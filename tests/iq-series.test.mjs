import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSeriesItem, makeSeriesSet, solveSeries, checkSeries, parseTyped, SERIES_COUNT, SERIES_DIFFICULTY, SERIES_LADDER } from '../iq-series.js';

const SEEDS = Array.from({ length: 200 }, (_, i) => 31 + i * 104729);

test('ряды: 12 заданий по возрастанию сложности, все нужные семейства представлены', () => {
  const set = makeSeriesSet(3);
  assert.equal(set.length, SERIES_COUNT);
  assert.deepEqual(set.map(x => x.level), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  for (let i = 1; i < set.length; i++) assert.ok(set[i].difficulty >= set[i - 1].difficulty);
  const fams = new Set(SERIES_LADDER.map(([f]) => f));
  for (const f of ['arith', 'geom', 'alt', 'squares', 'cubes', 'fib', 'second', 'grow']) assert.ok(fams.has(f), `есть семейство ${f}`);
  assert.ok(SERIES_DIFFICULTY[11] > SERIES_DIFFICULTY[0] * 4);
});

test('ряды: одно зерно — один набор; разные зёрна — разные ряды', () => {
  assert.deepEqual(makeSeriesSet(99), makeSeriesSet(99));
  const sig = set => set.map(x => x.terms.join(',')).join('|');
  assert.equal(new Set(SEEDS.slice(0, 60).map(s => sig(makeSeriesSet(s)))).size, 60);
});

test('ряды: решатель по показанным числам даёт ровно один ответ, он совпадает с отмеченным, а вариантов — шесть разных', () => {
  for (const seed of SEEDS) for (const item of makeSeriesSet(seed)) {
    const c = checkSeries(item);
    assert.ok(c.solvable, `решается: ${item.terms} (уровень ${item.level})`);
    assert.ok(c.answerMatches && c.correctIsSolution, `ответ совпал: ${item.terms}`);
    assert.ok(c.distinct && item.options.length === 6 && c.matches === 1, `варианты: ${item.options}`);
    assert.ok(item.options.every(o => Number.isInteger(o) && o > 0), 'варианты — целые положительные числа');
    assert.ok(item.terms.every(x => Number.isInteger(x) && x >= 0 && x <= 5000));
    assert.ok(item.rule.length > 10, 'правило словами есть');
  }
});

test('ряды: решатель распознаёт каждое семейство и отвергает неоднозначные и случайные ряды', () => {
  const cases = [
    [[2, 5, 8, 11, 14], 17], [[1, 2, 4, 8, 16], 32], [[1, 4, 9, 16, 25, 36], 49], [[1, 8, 27, 64, 125, 216], 343],
    [[1, 1, 2, 3, 5, 8], 13], [[3, 4, 6, 9, 13, 18], 24], [[1, 3, 7, 15, 31, 63], 127], [[5, 20, 7, 24, 9, 28], 11],
    [[3, 6, 18, 21, 63, 66], 198],
  ];
  for (const [terms, want] of cases) { const s = solveSeries(terms); assert.ok(s.ok && s.answer === want, `${terms} → ${s.answer} (${s.names})`); }
  assert.equal(solveSeries([3, 9, 4, 1, 7, 2]).ok, false, 'случайные числа: правила нет');
  assert.equal(solveSeries([1, 2]).ok, false, 'слишком короткий ряд: правила нет');
  // 1, 2, 4, 8: разные правила дали бы разные ответы, если бы мы не требовали длины ряда — на коротком ряду решатель не решает
  assert.equal(solveSeries([1, 2, 4]).ok, false);
});

test('ряды: ответ можно ввести цифрами; лишнее и нечисловое отвергается', () => {
  assert.equal(parseTyped('42'), 42); assert.equal(parseTyped(' 7 '), 7); assert.equal(parseTyped('4 2'), null);
  assert.equal(parseTyped(''), null); assert.equal(parseTyped('abc'), null); assert.equal(parseTyped('1234567'), null);
});

test('ряды: правильный ответ стоит на разных местах', () => {
  const pos = Array(6).fill(0); let n = 0;
  for (const seed of SEEDS) for (const it of makeSeriesSet(seed)) { pos[it.correct]++; n++; }
  for (const p of pos) assert.ok(p / n > 0.1 && p / n < 0.24, `доля места ${(p / n).toFixed(3)}`);
});

test('ряды: уровень 1 проще уровня 12 по сложности и по длине чисел', () => {
  const a = makeSeriesItem(5, 1), b = makeSeriesItem(5, 12);
  assert.ok(a.difficulty < b.difficulty);
  assert.ok(Math.max(...a.terms) < 120);
});
