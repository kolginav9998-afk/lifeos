import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatrixSet, checkMatrix, solveMatrix, ruleGrid, visKey, sameCell, layoutCell, describeCell, describeMatrix, describeOption, ruleText, MATRIX_DIFFICULTY, MATRIX_COUNT, KIND_ATTRS, ASYM_SHAPES } from '../iq-matrices.js';
import { scoreItems } from '../iq-core.js';

const SEEDS = Array.from({ length: 150 }, (_, i) => 1000 + i * 7919);

test('матрицы: набор из 12 заданий по возрастанию сложности, уровни 1…12', () => {
  const set = makeMatrixSet(5);
  assert.equal(set.length, MATRIX_COUNT);
  assert.deepEqual(set.map(x => x.level), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  for (let i = 1; i < set.length; i++) assert.ok(set[i].difficulty >= set[i - 1].difficulty, `сложность не убывает: ${i}`);
  assert.ok(set[11].difficulty > set[0].difficulty * 4, 'последнее заметно сложнее первого');
  assert.ok(new Set(MATRIX_DIFFICULTY).size >= 8, 'ступеней сложности достаточно много');
});

test('матрицы: одно зерно — один и тот же набор, другие зёрна — другие задания', () => {
  assert.deepEqual(makeMatrixSet(77), makeMatrixSet(77));
  assert.notDeepEqual(makeMatrixSet(77), makeMatrixSet(78));
  const sig = set => set.map(x => x.grid.map(c => visKey(c, x.kind)).join('/')).join('|');
  const sigs = new Set(SEEDS.slice(0, 40).map(s => sig(makeMatrixSet(s))));
  assert.equal(sigs.size, 40, 'наборы из разных зёрен не совпадают');
});

test('матрицы: решатель по восьми открытым клеткам даёт ровно один верный вариант из шести, варианты разные на вид', () => {
  let n = 0;
  for (const seed of SEEDS) for (const item of makeMatrixSet(seed)) {
    n++;
    assert.equal(item.options.length, 6);
    assert.equal(item.grid.length, 8);
    const c = checkMatrix(item);
    assert.ok(c.solvable, `решается: seed ${item.seed}, уровень ${item.level}`);
    assert.ok(c.distinct, `варианты различимы: seed ${item.seed}, уровень ${item.level}`);
    assert.equal(c.matches, 1, `ровно один подходящий вариант: seed ${item.seed}, уровень ${item.level}`);
    assert.ok(c.correctIsSolution, 'отмеченный верный вариант совпадает с решением');
    assert.ok(item.correct >= 0 && item.correct < 6);
  }
  assert.equal(n, SEEDS.length * 12);
});

test('матрицы: открытые клетки и ответ повторяют правила задания (проверка вперёд по формулам правил)', () => {
  for (const seed of SEEDS.slice(0, 60)) for (const item of makeMatrixSet(seed)) {
    const answer = item.options[item.correct];
    assert.ok(item.rules.length >= 1);
    for (const rule of item.rules) {
      const g = ruleGrid(rule);
      for (let i = 0; i < 8; i++) assert.equal(item.grid[i][rule.attr], g[Math.floor(i / 3)][i % 3], `клетка ${i}, ${rule.attr}, ${rule.type}`);
      assert.equal(answer[rule.attr], g[2][2], `ответ по правилу ${rule.attr}/${rule.type}`);
    }
    assert.ok(item.rules.every(r => ruleText(r).length > 8), 'у каждого правила есть описание словами');
  }
});

test('матрицы: решатель отвергает неоднозначные и бессмысленные таблицы', () => {
  const cell = (shape, count) => ({ shape, count, size: 1, fill: 0, rot: 0 });
  // шесть одинаковых клеток и две разные без видимой закономерности — решения нет
  const noise = [cell(0, 1), cell(1, 3), cell(2, 2), cell(3, 4), cell(4, 1), cell(5, 2), cell(0, 4), cell(1, 1)];
  assert.equal(solveMatrix(noise, 'a').ok, false);
  // чистый рост числа фигур 1-2-3 в каждой строке: ответ 3 при любом чтении (по строке и по столбцу)
  const grow = [1, 2, 3, 1, 2, 3, 1, 2].map(k => cell(0, k));
  const s = solveMatrix(grow, 'a');
  assert.ok(s.ok && s.cell.count === 3 && s.cell.shape === 0);
});

test('матрицы: правильный ответ стоит на разных местах, случайное угадывание даёт около одной шестой', () => {
  const pos = Array(6).fill(0);
  let total = 0, hit = 0;
  for (const seed of SEEDS) for (const item of makeMatrixSet(seed)) { pos[item.correct]++; total++; if (((seed + item.level) % 6) === item.correct) hit++; }
  for (const p of pos) assert.ok(p / total > 0.1 && p / total < 0.24, `доля места: ${(p / total).toFixed(3)}`);
  assert.ok(Math.abs(hit / total - 1 / 6) < 0.04);
});

test('матрицы: неверные варианты правдоподобны — отличаются от ответа немногим', () => {
  let near = 0, all = 0;
  for (const seed of SEEDS.slice(0, 60)) for (const item of makeMatrixSet(seed)) {
    const ans = item.options[item.correct], attrs = KIND_ATTRS[item.kind];
    for (const o of item.options) {
      if (o === ans) continue;
      const diff = attrs.filter(a => (a === 'rot' && item.kind === 'a' && !ASYM_SHAPES.includes(o.shape)) ? false : o[a] !== ans[a]).length;
      assert.ok(diff >= 1 || o.mask !== ans.mask, 'вариант отличается');
      all++; if (diff <= 2) near++;
    }
  }
  assert.ok(near / all > 0.85, `доля близких вариантов ${(near / all).toFixed(2)}`);
});

test('матрицы: фигуры в клетке не выходят за границы, поворот виден только у несимметричных фигур', () => {
  for (const seed of SEEDS.slice(0, 40)) for (const item of makeMatrixSet(seed)) for (const cell of [...item.grid, ...item.options]) {
    const { prims, dots } = layoutCell(cell, item.kind);
    for (const p of prims) {
      assert.ok(p.cx - p.r >= 0 && p.cx + p.r <= 100 && p.cy - p.r >= 0 && p.cy + p.r <= 100, `в пределах клетки: ${JSON.stringify(p)}`);
      if (!['triangle', 'arrow', 'half'].includes(p.shape)) assert.equal(p.rot, 0);
    }
    if (item.kind === 'a') assert.ok(prims.length >= 1 && prims.length <= 4 && dots.length === 0);
    else assert.equal(prims.length + dots.length, 6);
    // фигуры внутри клетки не слипаются
    for (let i = 0; i < prims.length; i++) for (let j = i + 1; j < prims.length; j++) assert.ok(Math.hypot(prims[i].cx - prims[j].cx, prims[i].cy - prims[j].cy) >= prims[i].r + prims[j].r - 1, 'фигуры не налезают друг на друга');
  }
});

test('матрицы: описание словами для экранного диктора есть у каждой клетки, без «undefined» и пустот', () => {
  for (const seed of SEEDS.slice(0, 40)) for (const item of makeMatrixSet(seed)) {
    const text = describeMatrix(item);
    assert.ok(/пропущена/.test(text) && /Первая строка/.test(text) && /Третья строка/.test(text));
    assert.ok(!/undefined|NaN|null/.test(text));
    for (let i = 0; i < 6; i++) { const d = describeOption(item, i); assert.ok(d.startsWith(`Вариант ${i + 1}: `) && d.length > 14 && !/undefined|NaN/.test(d)); }
    for (const c of item.grid) assert.ok(describeCell(c, item.kind).length > 3);
  }
  assert.equal(describeCell({ shape: 6, count: 2, size: 0, fill: 1, rot: 2 }, 'a'), 'две маленькие серые стрелки, направленные вправо');
  assert.equal(describeCell({ shape: 0, count: 1, size: 2, fill: 2, rot: 0 }, 'a'), 'один большой закрашенный круг');
  assert.equal(describeCell({ shape: 2, count: 3, size: 1, fill: 0, rot: 4 }, 'a'), 'три средних пустых треугольника, направленных вниз');
  assert.equal(describeCell({ shape: 1, fill: 2, mask: 0b100001 }, 's'), 'закрашенные квадраты в позициях: сверху слева, снизу справа');
  assert.equal(describeCell({ shape: 3, fill: 0, mask: 0 }, 's'), 'пусто');
});

test('матрицы: зрительно одинаковые клетки считаются одинаковыми (поворот круга не меняет вид)', () => {
  assert.ok(sameCell({ shape: 0, count: 2, size: 1, fill: 1, rot: 0 }, { shape: 0, count: 2, size: 1, fill: 1, rot: 5 }, 'a'));
  assert.ok(!sameCell({ shape: 2, count: 2, size: 1, fill: 1, rot: 0 }, { shape: 2, count: 2, size: 1, fill: 1, rot: 5 }, 'a'));
});

test('матрицы: подсчёт баллов — верный ответ на трудное задание весит больше', () => {
  const trials = [{ level: 1, correct: true, rt: 4000 }, { level: 2, correct: true, rt: 6000 }, { level: 12, correct: false, rt: 9000 }, { level: 11, correct: true, rt: 11000 }];
  const m = scoreItems(trials);
  assert.deepEqual([m.n, m.correct, m.accuracy, m.score, m.maxScore, m.maxLevel, m.meanMs], [4, 3, 0.75, 14, 26, 11, 7500]);
  assert.deepEqual(scoreItems([]), { n: 0, correct: 0, accuracy: null, meanMs: null, score: 0, maxScore: 0, maxLevel: 0 });
});
