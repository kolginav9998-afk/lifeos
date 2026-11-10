import test from 'node:test';
import assert from 'node:assert/strict';
import { mean, sd, median, mad, quantile, robustZ, makeRng, ranks, pearson, spearman, spearmanTest, linreg, ewma, normInv, dPrime, clamp, round } from '../stats.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('среднее, разброс, квантили, медиана, MAD', () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5); assert.ok(Number.isNaN(mean([])));
  near(sd([2, 4, 4, 4, 5, 5, 7, 9]), 2.138089935); assert.ok(Number.isNaN(sd([1])));
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.25), 2); assert.equal(quantile([10], 0.9), 10);
  assert.equal(mad([1, 1, 2, 2, 4, 6, 9]), 1);
});

test('устойчивый z-score: выброс в базе почти не влияет; мало данных — null; нулевой разброс не делит на ноль', () => {
  const base = [300, 310, 295, 305, 300, 2000];
  const z = robustZ(350, base);
  assert.ok(z > 1 && z < 15, `z=${z}`);
  assert.equal(robustZ(1, [1, 2]), null);
  assert.ok(Number.isFinite(robustZ(10, [5, 5, 5, 5])), 'одинаковая база');
  assert.ok(robustZ(5, [5, 5, 5, 5]) === 0);
});

test('генератор случайных чисел: воспроизводим, равномерен, перемешивание — перестановка', () => {
  const a = makeRng(42), b = makeRng(42), c = makeRng(43);
  const sa = Array.from({ length: 5 }, a), sb = Array.from({ length: 5 }, b), sc = Array.from({ length: 5 }, c);
  assert.deepEqual(sa, sb); assert.notDeepEqual(sa, sc);
  const r = makeRng(7); const xs = Array.from({ length: 20000 }, r);
  assert.ok(xs.every(x => x >= 0 && x < 1)); near(mean(xs), 0.5, 0.01);
  const ints = Array.from({ length: 5000 }, () => r.int(3, 6)); assert.ok(ints.every(i => i >= 3 && i <= 6)); assert.ok(new Set(ints).size === 4, 'включая обе границы');
  const arr = [1, 2, 3, 4, 5, 6, 7, 8]; const sh = r.shuffle(arr);
  assert.deepEqual([...sh].sort((x, y) => x - y), arr); assert.deepEqual(arr, [1, 2, 3, 4, 5, 6, 7, 8], 'исходный не меняется');
});

test('ранги со связками, корреляции Пирсона и Спирмена', () => {
  assert.deepEqual(ranks([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
  assert.equal(pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1); assert.equal(pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1);
  assert.ok(Number.isNaN(pearson([1, 1, 1], [1, 2, 3])), 'нет разброса');
  assert.equal(spearman([1, 2, 3, 4, 5], [1, 4, 9, 16, 25]), 1, 'монотонная нелинейная связь');
  near(pearson([1, 2, 3, 4, 5], [2, 1, 4, 3, 5]), 0.8);
});

test('перестановочный тест: сильная связь значима, шум — нет, результат воспроизводим', () => {
  const rng = makeRng(1);
  const x = Array.from({ length: 40 }, (_, i) => i + rng());
  const y = x.map(v => v * 2 + rng() * 5);
  const strong = spearmanTest(x, y);
  assert.ok(strong.rho > 0.9 && strong.p < 0.01, JSON.stringify(strong));
  const noise = Array.from({ length: 40 }, () => rng());
  const weak = spearmanTest(x, noise);
  assert.ok(Math.abs(weak.rho) < 0.4 && weak.p > 0.05, JSON.stringify(weak));
  assert.deepEqual(spearmanTest(x, y), strong, 'тот же seed — тот же результат');
  assert.equal(spearmanTest([1, 1, 1, 1], [1, 2, 3, 4]).p, 1);
});

test('ложные срабатывания редки: на случайных данных значимых связей ≈ 5%', () => {
  const rng = makeRng(99); let hits = 0; const N = 200;
  for (let i = 0; i < N; i++) {
    const x = Array.from({ length: 20 }, () => rng()), y = Array.from({ length: 20 }, () => rng());
    if (spearmanTest(x, y, { permutations: 300, seed: i }).p < 0.05) hits++;
  }
  assert.ok(hits / N < 0.12, `доля ложных ${hits / N}`);
});

test('регрессия и сглаживание', () => {
  const r = linreg([0, 1, 2, 3], [1, 3, 5, 7]); near(r.slope, 2); near(r.intercept, 1); near(r.r2, 1);
  assert.equal(linreg([1, 1, 1], [1, 2, 3]), null); assert.equal(linreg([1], [1]), null);
  assert.deepEqual(ewma([10, 10, 10]), [10, 10, 10]); assert.equal(ewma([0, 10], 0.5)[1], 5);
});

test('обратная нормальная функция и d′', () => {
  near(normInv(0.5), 0); near(normInv(0.975), 1.959963985, 1e-6); near(normInv(0.8413447), 1, 1e-4); near(normInv(0.001), -3.090232306, 1e-5);
  assert.equal(normInv(0), -Infinity); assert.equal(normInv(1), Infinity);
  near(dPrime(10, 0, 0, 10), 3.3, 0.5);
  assert.ok(dPrime(10, 0, 0, 10) > dPrime(8, 2, 2, 8) && dPrime(8, 2, 2, 8) > dPrime(5, 5, 5, 5));
  near(dPrime(5, 5, 5, 5), 0, 1e-9);
  assert.ok(Number.isFinite(dPrime(20, 0, 0, 20)), 'идеальные ответы не дают бесконечность');
});

test('вспомогательные', () => { assert.equal(clamp(5, 0, 3), 3); assert.equal(clamp(-1, 0, 3), 0); assert.equal(round(1.2345, 2), 1.23); });
