// «Вращение фигур»: фигура из клеток (полимино) и варианты, среди которых одна — та же фигура, только повёрнутая; остальные — зеркальные или с переставленной клеткой.
// Чистая логика. Верный вариант определяется независимо: сравнением «канонического вида» (наименьшая запись среди четырёх поворотов); зеркальный вариант никогда не совпадает с поворотом,
// потому что для задания берутся только несимметричные («хиральные») фигуры. Первые два задания — «такая же или зеркальная?», остальные — выбор из четырёх.
import { makeRng } from './stats.js';

export const ROTATION_COUNT = 12;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const CELLS_BY_LEVEL = [5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8, 8];
export const MIRRORS_BY_LEVEL = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3];

// ---------- геометрия ----------
export const norm = cells => { const mx = Math.min(...cells.map(c => c[0])), my = Math.min(...cells.map(c => c[1])); return cells.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[1] - b[1] || a[0] - b[0]); };
export const keyOf = cells => norm(cells).map(c => c.join(',')).join(';');
export const rot90 = cells => cells.map(([x, y]) => [-y, x]);
export const mirror = cells => cells.map(([x, y]) => [-x, y]);
export const turn = (cells, k) => { let c = cells; for (let i = 0; i < ((k % 4) + 4) % 4; i++) c = rot90(c); return norm(c); };
export const canon = cells => [0, 1, 2, 3].map(k => keyOf(turn(cells, k))).sort()[0];
export const isRotation = (a, b) => canon(a) === canon(b);
export const isChiral = c => !isRotation(c, mirror(c));
export const bbox = cells => ({ w: Math.max(...cells.map(c => c[0])) + 1, h: Math.max(...cells.map(c => c[1])) + 1 });
export function connected(cells) {
  const set = new Set(cells.map(c => c.join())), seen = new Set([cells[0].join()]), stack = [cells[0]];
  while (stack.length) { const [x, y] = stack.pop(); for (const [dx, dy] of DIRS) { const k = `${x + dx},${y + dy}`; if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push([x + dx, y + dy]); } } }
  return seen.size === cells.length;
}

function randomShape(rng, n) {
  for (let t = 0; t < 400; t++) {
    const cells = [[0, 0]], set = new Set(['0,0']);
    while (cells.length < n) {
      const [x, y] = rng.pick(cells), [dx, dy] = rng.pick(DIRS), k = `${x + dx},${y + dy}`;
      if (!set.has(k)) { set.add(k); cells.push([x + dx, y + dy]); }
    }
    const c = norm(cells), { w, h } = bbox(c);
    if (w < 2 || h < 2 || w > 5 || h > 5 || !isChiral(c)) continue;
    return c;
  }
  throw new Error('фигура не собралась');
}
// Та же по числу клеток фигура, но одна клетка переставлена на новое место (не поворот исходной).
function movedCopy(rng, cells) {
  for (let t = 0; t < 300; t++) {
    const i = rng.int(0, cells.length - 1), gone = cells[i], rest = cells.filter((_, j) => j !== i);
    if (!connected(rest)) continue;
    const [x, y] = rng.pick(rest), [dx, dy] = rng.pick(DIRS), add = [x + dx, y + dy];
    if (rest.some(c => c[0] === add[0] && c[1] === add[1]) || (add[0] === gone[0] && add[1] === gone[1])) continue;
    const res = norm([...rest, add]);
    if (!connected(res) || isRotation(res, cells) || bbox(res).w > 5 || bbox(res).h > 5) continue;
    return res;
  }
  return null;
}

// level 1…12. Возвращает { v, seed, level, n, format: 'pair'|'pick4', ref, probe? (для pair), options (клетки), correct }.
export function makeRotation(seed, level) {
  const lv = Math.min(Math.max(level, 1), ROTATION_COUNT), n = CELLS_BY_LEVEL[lv - 1];
  const rng = makeRng((seed ^ Math.imul(lv, 0xc2b2ae35)) >>> 0);
  for (let attempt = 0; attempt < 200; attempt++) {
    const ref = randomShape(rng, n);
    if (lv <= 2) {
      const same = rng() < 0.5, probe = turn(same ? ref : mirror(ref), rng.int(1, 3));
      if (same && keyOf(probe) === keyOf(ref)) continue;
      return { v: 1, seed, level: lv, n, format: 'pair', ref, probe, options: ['Такая же, только повёрнута', 'Зеркальная'], correct: same ? 0 : 1 };
    }
    const right = turn(ref, rng.int(1, 3));
    if (keyOf(right) === keyOf(ref)) continue;
    const used = new Set([keyOf(right)]), distract = [];
    const mirrors = rng.shuffle([0, 1, 2, 3]).map(k => turn(mirror(ref), k));
    for (const m of mirrors) { if (distract.length >= MIRRORS_BY_LEVEL[lv - 1]) break; if (!used.has(keyOf(m))) { used.add(keyOf(m)); distract.push(m); } }
    for (let g = 0; distract.length < 3 && g < 60; g++) {
      const mv = movedCopy(rng, ref); if (!mv) break;
      const o = turn(mv, rng.int(0, 3));
      if (!used.has(keyOf(o))) { used.add(keyOf(o)); distract.push(o); }
    }
    if (distract.length < 3) continue;
    const options = rng.shuffle([right, ...distract]);
    return { v: 1, seed, level: lv, n, format: 'pick4', ref, options, correct: options.findIndex(o => keyOf(o) === keyOf(right)) };
  }
  throw new Error(`вращение не собралось: seed ${seed}, level ${level}`);
}
export function makeRotationSet(seed, n = ROTATION_COUNT) {
  const rng = makeRng(seed);
  return Array.from({ length: n }, (_, i) => makeRotation(rng.int(1, 2 ** 30), i + 1));
}
// Независимая проверка: сколько вариантов — повороты исходной фигуры, и совпадает ли это с отмеченным верным.
export function checkRotation(item) {
  if (item.format === 'pair') {
    const same = isRotation(item.probe, item.ref), mir = !same && isRotation(mirror(item.probe), item.ref);
    return { solvable: same !== mir, matches: 1, correctIsSolution: item.correct === (same ? 0 : 1), distinct: true };
  }
  const keys = item.options.map(keyOf), hits = item.options.map((o, i) => (isRotation(o, item.ref) ? i : -1)).filter(i => i >= 0);
  return { solvable: hits.length === 1, matches: hits.length, correctIsSolution: hits.length === 1 && hits[0] === item.correct, distinct: new Set(keys).size === keys.length };
}

// ---------- описание словами и рисунок ----------
// Ряды сверху вниз, клетки слева направо с единицы. Для экранного диктора и для проверки глазами.
export function describeShape(cells) {
  const c = norm(cells), { h } = bbox(c), rows = [];
  for (let y = 0; y < h; y++) { const xs = c.filter(p => p[1] === y).map(p => p[0] + 1); rows.push(xs.length ? `ряд ${y + 1}: ${xs.length === 1 ? 'клетка' : 'клетки'} ${xs.join(', ')}` : `ряд ${y + 1}: пусто`); }
  return `Фигура из ${c.length} клеток, ${rows.join('; ')}`;
}
export const describeRotationItem = item => (item.format === 'pair' ? `Образец: ${describeShape(item.ref)}. Вторая фигура: ${describeShape(item.probe)}.` : `Образец: ${describeShape(item.ref)}.`);
export const describeRotationOption = (item, i) => `Вариант ${i + 1}: ${describeShape(item.options[i])}`;
// Общий размер квадрата для рисования всех фигур задания в одном масштабе.
export function frameSize(item) {
  const all = [item.ref, ...(item.format === 'pair' ? [item.probe] : item.options)].map(bbox);
  return Math.max(...all.map(b => Math.max(b.w, b.h)));
}
