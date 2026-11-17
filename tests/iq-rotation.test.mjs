import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRotation, makeRotationSet, checkRotation, isRotation, isChiral, mirror, turn, canon, keyOf, connected, bbox, describeShape, describeRotationItem, describeRotationOption, frameSize, ROTATION_COUNT, CELLS_BY_LEVEL, MIRRORS_BY_LEVEL } from '../iq-rotation.js';

const SEEDS = Array.from({ length: 120 }, (_, i) => 77 + i * 6007);

test('вращение: 12 заданий, число клеток и число зеркальных вариантов не убывают с уровнем', () => {
  const set = makeRotationSet(8);
  assert.equal(set.length, ROTATION_COUNT);
  assert.deepEqual(set.map(x => x.level), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  for (let i = 1; i < 12; i++) { assert.ok(CELLS_BY_LEVEL[i] >= CELLS_BY_LEVEL[i - 1]); assert.ok(MIRRORS_BY_LEVEL[i] >= MIRRORS_BY_LEVEL[i - 1]); assert.ok(set[i].n >= set[i - 1].n); }
  assert.deepEqual(set.slice(0, 2).map(x => x.format), ['pair', 'pair']);
  assert.ok(set.slice(2).every(x => x.format === 'pick4' && x.options.length === 4));
  assert.ok(set[11].n > set[0].n);
});

test('вращение: одно зерно — один набор, разные зёрна — разные наборы', () => {
  assert.deepEqual(makeRotationSet(5), makeRotationSet(5));
  assert.equal(new Set(SEEDS.slice(0, 40).map(s => makeRotationSet(s).map(x => keyOf(x.ref)).join('|'))).size, 40);
});

test('вращение: ровно один вариант — поворот образца, варианты разные, фигуры связные и несимметричные', () => {
  for (const seed of SEEDS) for (const item of makeRotationSet(seed)) {
    const c = checkRotation(item);
    assert.ok(c.solvable && c.matches === 1 && c.correctIsSolution && c.distinct, `seed ${item.seed}, уровень ${item.level}: ${JSON.stringify(c)}`);
    assert.equal(item.ref.length, CELLS_BY_LEVEL[item.level - 1]);
    assert.ok(connected(item.ref) && isChiral(item.ref), 'образец связный и отличим от своего зеркала');
    const shapes = item.format === 'pair' ? [item.probe] : item.options;
    for (const o of shapes) { assert.ok(connected(o), 'вариант связный'); assert.equal(o.length, item.ref.length, 'число клеток одинаково'); const b = bbox(o); assert.ok(b.w <= 5 && b.h <= 5); }
    if (item.format === 'pick4') {
      const mirrors = item.options.filter(o => canon(o) === canon(mirror(item.ref)));
      const available = new Set([0, 1, 2, 3].map(k => keyOf(turn(mirror(item.ref), k)))).size;      // у фигуры с поворотной симметрией зеркальных положений меньше четырёх
      assert.ok(mirrors.length >= Math.min(MIRRORS_BY_LEVEL[item.level - 1], available) && mirrors.length <= 3, `зеркальных вариантов: ${mirrors.length}`);
      assert.notEqual(keyOf(item.options[item.correct]), keyOf(item.ref), 'верный вариант не копия образца в том же положении');
    }
  }
});

test('вращение: «такая же или зеркальная» — зеркальная никогда не получается поворотом', () => {
  const sameShare = [];
  for (const seed of SEEDS) for (const item of makeRotationSet(seed).slice(0, 2)) {
    const rotated = isRotation(item.probe, item.ref);
    assert.equal(item.correct, rotated ? 0 : 1);
    if (!rotated) assert.ok(isRotation(mirror(item.probe), item.ref), 'зеркальная — именно отражение образца');
    sameShare.push(rotated ? 1 : 0);
  }
  const share = sameShare.reduce((a, b) => a + b, 0) / sameShare.length;
  assert.ok(share > 0.35 && share < 0.65, `доля «такая же»: ${share.toFixed(2)}`);
});

test('вращение: геометрия — повороты и отражения ведут себя как положено', () => {
  const L = [[0, 0], [0, 1], [0, 2], [1, 2]];
  assert.ok(isRotation(L, turn(L, 1)) && isRotation(L, turn(L, 2)) && isRotation(L, turn(L, 3)));
  assert.equal(keyOf(turn(L, 4)), keyOf(L));
  assert.ok(isChiral(L), 'буква L отличима от зеркальной (J)');
  assert.ok(!isChiral([[0, 0], [1, 0], [2, 0], [1, 1]]), 'буква T зеркально симметрична');
  assert.ok(!isRotation(L, mirror(L)));
  assert.equal(canon(L), canon(turn(L, 3)));
});

test('вращение: правильный ответ стоит на разных местах, угадывание даёт около четверти', () => {
  const pos = Array(4).fill(0); let n = 0;
  for (const seed of SEEDS) for (const it of makeRotationSet(seed).slice(2)) { pos[it.correct]++; n++; }
  for (const p of pos) assert.ok(p / n > 0.18 && p / n < 0.32, `доля места ${(p / n).toFixed(3)}`);
});

test('вращение: описание словами для диктора — по рядам клеток, без пропусков', () => {
  for (const seed of SEEDS.slice(0, 30)) for (const item of makeRotationSet(seed)) {
    const d = describeRotationItem(item);
    assert.match(d, /Образец: Фигура из \d клеток, ряд 1:/);
    assert.ok(!/undefined|NaN/.test(d));
    if (item.format === 'pick4') for (let i = 0; i < 4; i++) assert.ok(describeRotationOption(item, i).startsWith(`Вариант ${i + 1}: Фигура из ${item.n} клеток`));
    assert.ok(frameSize(item) >= 2 && frameSize(item) <= 5);
  }
  assert.equal(describeShape([[0, 0], [1, 0], [1, 1]]), 'Фигура из 3 клеток, ряд 1: клетки 1, 2; ряд 2: клетка 2');
});
