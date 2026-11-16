import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../stats.js';
import { CHANCE } from '../iq-core.js';
import { wilson, indexOf, runParts, logicIndexNow, logicProgress, compareIndex, indexShort, rawLine, INDEX_TITLE, INDEX_NOT_IQ, INDEX_HOW, LOGIC_IDS, MIN_ITEMS } from '../iq-index.js';

const DAY = 86400000, T0 = Date.UTC(2026, 5, 1, 9);
const part = (id, correctShare, n = 12) => { const maxScore = n * (n + 1) / 2; return { id, score: Math.round(maxScore * correctShare), maxScore, n }; };
const run = (i, tests) => ({ startedAt: T0 + i * DAY, date: new Date(T0 + i * DAY).toISOString().slice(0, 10), tests: Object.fromEntries(Object.entries(tests).map(([id, share]) => { const p = part(id, share); return [id, { ok: true, metrics: { n: p.n, correct: Math.round(p.n * share), score: p.score, maxScore: p.maxScore, meanMs: 30000 } }]; })) });

test('индекс: честные подписи есть и в названии, и в пояснении', () => {
  assert.match(INDEX_TITLE, /Условный индекс логики/); assert.match(INDEX_TITLE, /для интереса/); assert.match(INDEX_TITLE, /не медицинский IQ/);
  assert.match(INDEX_NOT_IQ, /не IQ и не диагноз/); assert.match(INDEX_NOT_IQ, /нет данных о других людях/); assert.match(INDEX_NOT_IQ, /только с самим собой/);
  assert.ok(INDEX_HOW.length >= 3 && INDEX_HOW.some(t => /угадыванием/.test(t)) && INDEX_HOW.some(t => /неопределённость/.test(t)));
  assert.match(indexShort({ index: 50, lo: 30, hi: 70 }), /50 из 100 \(примерно от 30 до 70\) — не IQ/);
});

test('индекс: интервал Уилсона известен, всегда содержит долю и сужается с числом заданий', () => {
  const [lo, hi] = wilson(0.5, 10); assert.ok(Math.abs(lo - 0.237) < 0.01 && Math.abs(hi - 0.763) < 0.01);
  for (const n of [6, 12, 30, 51]) for (const p of [0, 0.2, 0.5, 0.8, 1]) { const [a, b] = wilson(p, n); assert.ok(a <= p + 1e-9 && p <= b + 1e-9 && a >= 0 && b <= 1); }
  const w = n => { const [a, b] = wilson(0.5, n); return b - a; };
  assert.ok(w(12) > w(30) && w(30) > w(51));
  assert.equal(wilson(0.5, 0), null);
});

test('индекс: уровень угадывания даёт 0, всё верно — 100, больше верных — больше индекс; диапазон широкий', () => {
  const guess = indexOf([{ id: 'matrices', score: 13, maxScore: 78, n: 12 }]);        // 1/6 от 78 баллов — ровно угадывание
  assert.equal(guess.index, 0); assert.equal(guess.lo, 0);
  const all = indexOf([part('matrices', 1)]);
  assert.equal(all.index, 100); assert.equal(all.hi, 100); assert.ok(all.lo < 90, `нижняя граница при 12 из 12: ${all.lo}`);
  let prev = -1;
  for (const s of [0.2, 0.4, 0.6, 0.8, 1]) { const r = indexOf([part('matrices', s)]); assert.ok(r.index >= prev); prev = r.index; assert.ok(r.lo <= r.index && r.index <= r.hi); }
  const mid12 = indexOf([part('matrices', 0.6)]);
  assert.ok(mid12.hi - mid12.lo >= 40, `по 12 заданиям диапазон очень широкий: ${mid12.hi - mid12.lo}`);
  const mid51 = indexOf([part('matrices', 0.6), part('seq12', 0.6), part('verbal', 0.6, 15), part('rotation', 0.6)]);
  assert.equal(mid51.items, 51); assert.ok(mid51.hi - mid51.lo >= 20 && mid51.hi - mid51.lo < mid12.hi - mid12.lo, `по 51 заданию диапазон уже, но не узкий: ${mid51.hi - mid51.lo}`);
  assert.equal(indexOf([part('matrices', 0.9, 4)]), null, `меньше ${MIN_ITEMS} заданий — числа нет`);
  assert.equal(indexOf([]), null);
  assert.deepEqual(indexOf([{ id: 'matrices', score: 5, maxScore: 0, n: 12 }]), null);
});

test('индекс: случайные угадыватели получают около нуля, а ноль входит в их диапазон', () => {
  const rng = makeRng(11);
  let sum = 0, inside = 0; const N = 400;
  for (let k = 0; k < N; k++) {
    const parts = LOGIC_IDS.map(id => { const n = id === 'verbal' ? 15 : 12; let score = 0, maxScore = 0; for (let i = 1; i <= n; i++) { const w = id === 'verbal' ? Math.ceil(i / 5) : i; maxScore += w; if (rng() < CHANCE[id]) score += w; } return { id, score, maxScore, n }; });
    const r = indexOf(parts); sum += r.index; if (r.lo === 0) inside++;
  }
  assert.ok(sum / N < 8, `среднее у угадывающих: ${sum / N}`);
  assert.ok(inside / N > 0.9, `диапазон угадывающего включает 0: ${inside / N}`);
});

test('индекс сейчас: последний результат каждого теста, старше 90 дней не берём, пропущенные и недостоверные не считаем', () => {
  const runs = [run(0, { matrices: 0.2, seq12: 0.2 }), run(10, { matrices: 0.9 }), run(20, { verbal: 0.7, rotation: 0.5 }), run(30, { seq12: 0.8 })];
  runs[2].tests.rotation.ok = false;                                                // недостоверный
  runs[3].tests.verbal = { skipped: 'пропущено по желанию' };
  const now = T0 + 31 * DAY, r = logicIndexNow(runs, now);
  assert.deepEqual(r.parts.map(p => p.id).sort(), ['matrices', 'seq12', 'verbal']);
  assert.equal(r.parts.find(p => p.id === 'matrices').date, runs[1].date, 'берётся последний, а не первый результат');
  assert.equal(r.items, 12 + 12 + 12, 'слова — 12 заданий в этой пробе');
  assert.equal(logicIndexNow(runs, T0 + 400 * DAY), null, 'всё старше 90 дней — числа нет');
  assert.equal(logicIndexNow([], now), null);
  assert.deepEqual(runParts({ tests: { reaction: { ok: true, metrics: { median: 300 } } } }), [], 'другие тесты не входят');
});

test('динамика и сравнение: по точке на прохождение, «выше/ниже» только при непересекающихся диапазонах', () => {
  const runs = [run(2, { matrices: 0.5, seq12: 0.5, verbal: 0.5, rotation: 0.5 }), run(0, { matrices: 0.3 }), run(5, { matrices: 0.5, seq12: 0.55, verbal: 0.5, rotation: 0.5 }), run(9, { matrices: 1, seq12: 1, verbal: 1, rotation: 1 })];
  const s = logicProgress(runs);
  assert.deepEqual(s.map(p => p.ts), [...s.map(p => p.ts)].sort((a, b) => a - b), 'в порядке времени');
  assert.equal(s.length, 4);
  assert.equal(compareIndex(s[2], s[1]), 'same', 'почти одинаковые результаты — разницы не видно');
  assert.equal(compareIndex(s[3], s[2]), 'up');
  assert.equal(compareIndex(s[2], s[3]), 'down');
  assert.equal(compareIndex(s[0], s[0]), 'same');
});

test('сырые результаты словами: верные ответы, время, помеха', () => {
  assert.equal(rawLine('matrices', { correct: 9, n: 12, meanMs: 38400 }), 'Верно 9 из 12; в среднем 38 с на задание');
  assert.equal(rawLine('verbal', { correct: 13, n: 15 }), 'Верно 13 из 15');
  assert.equal(rawLine('corsi', { span: 5, correct: 4, attempts: 6 }), 'Самая длинная верная последовательность: 5; верных попыток 4 из 6');
  assert.equal(rawLine('stroop40', { correct: 37, n: 40, interference: 150, medianRT: 620 }), 'Верно 37 из 40; помеха 150 мс; медиана верных 620 мс');
  assert.equal(rawLine('coding', { correct: 55, n: 60, accuracy: 0.917 }), 'Верно 55 из 60 за 90 с; точность 92%');
  assert.equal(rawLine('reaction', { median: 300 }), ''); assert.equal(rawLine('matrices', null), '');
});
