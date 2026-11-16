// «Матрицы» в духе Равена: сетка 3×3 из фигур, одна клетка пропущена, нужно выбрать её из шести вариантов.
// Чистая логика без интерфейса. Задания строятся по зерну, а ответ проверяет НЕЗАВИСИМЫЙ решатель: он видит только восемь открытых клеток,
// перебирает известные правила (одинаково / растёт / по кругу / сумма / «наложение» фигур по строкам и столбцам) и обязан выдать ровно одну клетку.
// Если правил подходит несколько и они дают разный ответ, задание отбрасывается. Так у каждого задания один верный вариант.
// Это не IQ-тест: набор не откалиброван на людях, результат нужен для сравнения себя с собой.
import { makeRng } from './stats.js';

export const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'cross', 'hexagon', 'arrow', 'half'];
export const SYM_SHAPES = [0, 1, 2, 3, 4, 5];            // обычные фигуры
export const ASYM_SHAPES = [2, 6, 7];                    // у них поворот виден: треугольник, стрелка, полукруг
const ASYM = new Set(ASYM_SHAPES);
const NUM = { count: [1, 4], size: [0, 2], fill: [0, 2], rot: [0, 7] };
export const KIND_ATTRS = { a: ['shape', 'count', 'size', 'fill', 'rot'], s: ['shape', 'fill', 'mask'] };
export const MATRIX_COUNT = 12;

// ---------- вид клетки ----------
export const normCell = (c, kind) => (kind === 'a' ? { ...c, rot: ASYM.has(c.shape) ? c.rot : 0 } : { ...c });
// Ключ зрительного отличия: два варианта с одним ключом выглядят одинаково.
export const visKey = (c, kind) => (kind === 'a' ? `a|${c.shape}|${c.count}|${c.size}|${c.fill}|${ASYM.has(c.shape) ? c.rot : 0}` : `s|${c.shape}|${c.fill}|${c.mask}`);
export const sameCell = (a, b, kind) => visKey(a, kind) === visKey(b, kind);
const pop = m => { let n = 0; for (let x = m; x; x &= x - 1) n++; return n; };

// ---------- правила ----------
// how: const | rowconst | colconst | prog | latin | sum | op
const W = { const: 0, rowconst: 0.5, colconst: 0.5, prog: 1, latin: 1.5, sum: 2, or: 3.5, xor: 4, and: 4, diff: 4.5 };
const LADDER = [
  { kind: 'a', rules: [['size', 'prog']] },
  { kind: 'a', rules: [['count', 'prog']] },
  { kind: 'a', rules: [['shape', 'latin']] },
  { kind: 'a', rules: [['fill', 'latin'], ['shape', 'rowconst']] },
  { kind: 'a', rules: [['count', 'prog'], ['shape', 'latin']] },
  { kind: 'a', rules: [['size', 'prog'], ['fill', 'latin'], ['shape', 'colconst']] },
  { kind: 'a', rules: [['count', 'sum'], ['shape', 'latin']] },
  { kind: 'a', rules: [['rot', 'prog'], ['count', 'prog'], ['fill', 'latin']] },
  { kind: 's', rules: [['mask', 'or']] },
  { kind: 's', rules: [['mask', 'xor']] },
  { kind: 's', rules: [['mask', 'and'], ['fill', 'latin']] },
  { kind: 's', rules: [['mask', 'diff'], ['shape', 'latin']] },
];
const difficultyOf = spec => spec.rules.reduce((s, [a, t]) => s + (a === 'mask' ? W[t] : t === 'prog' && a === 'rot' ? 1.5 : W[t]), 0) + 0.5 * (spec.rules.length - 1) + (spec.kind === 's' ? 1.5 : 0);
export const MATRIX_DIFFICULTY = LADDER.map(difficultyOf);

const OPS = { xor: (x, y) => x ^ y, and: (x, y) => x & y, or: (x, y) => x | y, diff: (x, y) => x & ~y & 63, rdiff: (x, y) => y & ~x & 63 };
const perm = (rng, arr) => rng.shuffle(arr);

// Значения правила для всех девяти клеток: возвращает матрицу 3×3 чисел (по нему же строится задание, а автотест сверяет с ним открытые клетки).
export function ruleGrid(rule) {
  const g = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    switch (rule.how) {
      case 'const': g[r][c] = rule.v; break;
      case 'rowconst': g[r][c] = rule.vs[r]; break;
      case 'colconst': g[r][c] = rule.vs[c]; break;
      case 'prog': g[r][c] = rule.attr === 'rot' ? (rule.start + c * rule.d) % 8 : rule.start + c * rule.d; break;
      case 'latin': g[r][c] = rule.vs[(c + r * rule.s) % 3]; break;
      case 'sum': g[r][c] = c < 2 ? rule.pairs[r][c] : rule.pairs[r][0] + rule.pairs[r][1]; break;
      default: g[r][c] = c < 2 ? rule.pairs[r][c] : OPS[rule.op](rule.pairs[r][0], rule.pairs[r][1]);
    }
  }
  return g;
}

// Подбор параметров правила. rotOn — в задании есть поворот: тогда фигуры только такие, у которых поворот виден.
function pickRule(rng, attr, how, rotOn) {
  const pool = rotOn ? ASYM_SHAPES : SYM_SHAPES;
  if (attr === 'mask') {
    for (let tries = 0; tries < 300; tries++) {
      const pairs = [];
      for (let k = 0; k < 40 && pairs.length < 3; k++) {
        const a = rng.int(3, 62), b = rng.int(3, 62), res = OPS[how](a, b);
        if (pop(a) < 2 || pop(a) > 4 || pop(b) < 2 || pop(b) > 4 || !res || res === a || res === b || a === b) continue;
        pairs.push([a, b]);
      }
      if (pairs.length === 3 && new Set(pairs.map(p => OPS[how](p[0], p[1]))).size === 3) return { attr, how: 'op', op: how, pairs };
    }
    return null;
  }
  const dom = attr === 'shape' ? pool : attr === 'count' ? [1, 2, 3, 4] : attr === 'rot' ? [0, 2, 4, 6] : [0, 1, 2];
  switch (how) {
    case 'const': return { attr, how, v: attr === 'rot' ? 0 : rng.pick(dom) };
    case 'rowconst': case 'colconst': return { attr, how, vs: perm(rng, dom).slice(0, 3) };
    case 'latin': return { attr, how, vs: perm(rng, dom).slice(0, 3), s: rng.int(1, 2) };
    case 'prog': {
      if (attr === 'rot') return { attr, how, start: rng.pick([0, 1, 2, 3, 4, 5, 6, 7]), d: rng.pick([2, 2, 1]) };
      const d = rng.pick([1, -1]), lo = NUM[attr][0], hi = NUM[attr][1], starts = [];
      for (let s = lo; s <= hi; s++) if (s + 2 * d >= lo && s + 2 * d <= hi) starts.push(s);
      return { attr, how, start: rng.pick(starts), d };
    }
    default: {                                           // sum: слева направо «первое + второе = третье»
      const all = [[1, 1], [1, 2], [2, 1], [1, 3], [3, 1], [2, 2]];
      return { attr, how: 'sum', pairs: perm(rng, all).slice(0, 3) };
    }
  }
}

function buildCells(kind, rules, rng) {
  const rotOn = rules.some(([a]) => a === 'rot');
  const set = {};
  for (const [attr, how] of rules) { const rule = pickRule(rng, attr, how, rotOn); if (!rule) return null; set[attr] = rule; }
  for (const attr of KIND_ATTRS[kind]) if (!set[attr]) set[attr] = pickRule(rng, attr, 'const', rotOn) ?? { attr, how: 'const', v: 0 };
  const grids = Object.fromEntries(Object.entries(set).map(([a, r]) => [a, ruleGrid(r)]));
  const cells = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const cell = {};
    for (const a of KIND_ATTRS[kind]) cell[a] = grids[a][r][c];
    if (kind === 'a' && !ASYM.has(cell.shape)) cell.rot = 0;
    cells.push(cell);
  }
  return { cells, set };
}

// ---------- независимый решатель ----------
const T3 = g => [0, 1, 2].map(r => [0, 1, 2].map(c => g[c][r]));
const setEq = (x, y) => x.length === y.length && x.every(v => y.includes(v));
function scalarFits(g, attr) {
  const out = [], [a, b, c] = g;
  const cyc = attr === 'rot' ? 8 : 0, num = attr !== 'shape';
  const df = (x, y) => (cyc ? (((x - y) % cyc) + cyc) % cyc : x - y);
  const inDom = v => !num || cyc || (v >= NUM[attr][0] && v <= NUM[attr][1]);
  if (a[0] === a[1] && a[1] === a[2] && b[0] === b[1] && b[1] === b[2] && c[0] === c[1]) out.push(c[0]);
  if (num) {
    const d = df(a[1], a[0]);
    if (d !== 0 && df(a[2], a[1]) === d && df(b[1], b[0]) === d && df(b[2], b[1]) === d && df(c[1], c[0]) === d) { const p = cyc ? (c[1] + d) % cyc : c[1] + d; if (inDom(p)) out.push(p); }
    if (!cyc && attr === 'count' && a[2] === a[0] + a[1] && b[2] === b[0] + b[1] && inDom(c[0] + c[1])) out.push(c[0] + c[1]);
  }
  if (a[0] !== a[1] && a[1] !== a[2] && a[0] !== a[2] && setEq([...a].sort(), [...b].sort()) && c[0] !== c[1] && a.includes(c[0]) && a.includes(c[1])) out.push(a.find(x => x !== c[0] && x !== c[1]));
  return out;
}
function maskFits(g) {
  const out = [], [a, b, c] = g;
  for (const op of Object.values(OPS)) if (a[2] === op(a[0], a[1]) && b[2] === op(b[0], b[1])) out.push(op(c[0], c[1]));
  if (a[0] === a[1] && a[1] === a[2] && b[0] === b[1] && b[1] === b[2] && c[0] === c[1]) out.push(c[0]);
  return out.filter(m => m > 0);
}
// Из восьми открытых клеток восстанавливает девятую. { ok, cell } или { ok:false, why }.
export function solveMatrix(grid8, kind) {
  const cell = {};
  for (const attr of KIND_ATTRS[kind]) {
    const g = [0, 1, 2].map(r => [0, 1, 2].map(c => (r * 3 + c < 8 ? grid8[r * 3 + c][attr] : undefined)));
    const preds = new Set([...(attr === 'mask' ? maskFits(g) : scalarFits(g, attr)), ...(attr === 'mask' ? maskFits(T3(g)) : scalarFits(T3(g), attr))]);
    if (preds.size === 0) return { ok: false, why: `нет правила: ${attr}` };
    if (preds.size > 1) return { ok: false, why: `неоднозначно: ${attr}` };
    cell[attr] = [...preds][0];
  }
  return { ok: true, cell: normCell(cell, kind) };
}

// ---------- варианты ответа ----------
function makeOptions(rng, kind, answer, grid8, set, level) {
  const attrs = KIND_ATTRS[kind], ruleAttrs = Object.keys(set).filter(a => set[a].how !== 'const');
  const seen = new Set([visKey(answer, kind)]), bag = { near: [], other: [], far: [], copy: [] };
  const push = (list, cell) => { const n = normCell(cell, kind), k = visKey(n, kind); if (!seen.has(k)) { seen.add(k); list.push(n); } };
  const domOf = a => (a === 'shape' ? (kind === 'a' && attrs.includes('rot') && set.rot.how !== 'const' ? ASYM_SHAPES : SYM_SHAPES) : a === 'count' ? [1, 2, 3, 4] : a === 'rot' ? [0, 2, 4, 6, 1, 3] : [0, 1, 2]);
  for (const a of attrs) {
    if (a === 'mask') {
      for (let i = 0; i < 6; i++) { const m = answer.mask ^ (1 << i); if (m) push(ruleAttrs.includes(a) ? bag.near : bag.other, { ...answer, mask: m }); }
      for (const op of Object.values(OPS)) { const m = op(grid8[6].mask, grid8[7].mask); if (m) push(bag.near, { ...answer, mask: m }); }
      continue;
    }
    if (kind === 'a' && a === 'rot' && !ruleAttrs.includes('rot')) continue;
    for (const v of rng.shuffle(domOf(a))) if (v !== answer[a]) push(ruleAttrs.includes(a) ? bag.near : bag.other, { ...answer, [a]: v });
  }
  const aa = attrs.filter(a => !(kind === 'a' && a === 'rot' && !ruleAttrs.includes('rot')));
  for (let i = 0; i < aa.length; i++) for (let j = i + 1; j < aa.length; j++) {
    if (aa[i] === 'mask' || aa[j] === 'mask') continue;
    const vi = rng.shuffle(domOf(aa[i])).find(v => v !== answer[aa[i]]), vj = rng.shuffle(domOf(aa[j])).find(v => v !== answer[aa[j]]);
    push(bag.far, { ...answer, [aa[i]]: vi, [aa[j]]: vj });
  }
  for (const i of [7, 5, 6, 2]) push(bag.copy, grid8[i]);
  const take = (list, n) => rng.shuffle(list).slice(0, n);
  const easy = level <= 4;
  const chosen = [...take(bag.copy, 1), ...take(bag.near, easy ? 2 : 3), ...take(bag.far, easy ? 2 : 1), ...take(bag.other, 1)];
  const rest = [...bag.near, ...bag.far, ...bag.other, ...bag.copy].filter(c => !chosen.includes(c));
  for (const c of rng.shuffle(rest)) { if (chosen.length >= 5) break; chosen.push(c); }
  if (chosen.length < 5) return null;
  const opts = rng.shuffle([answer, ...chosen.slice(0, 5)]);
  return { options: opts, correct: opts.findIndex(o => sameCell(o, answer, kind)) };
}

// ---------- сборка задания ----------
// level 1…12. Возвращает { v, seed, level, kind, difficulty, grid (8 клеток), options (6), correct, rules }.
export function makeMatrix(seed, level) {
  const spec = LADDER[Math.min(Math.max(level, 1), MATRIX_COUNT) - 1];
  const rng = makeRng((seed ^ Math.imul(level, 0x9e3779b1)) >>> 0);
  for (let attempt = 0; attempt < 200; attempt++) {
    const built = buildCells(spec.kind, spec.rules, rng);
    if (!built) continue;
    const grid8 = built.cells.slice(0, 8), answer = normCell(built.cells[8], spec.kind);
    const sol = solveMatrix(grid8, spec.kind);
    if (!sol.ok || !sameCell(sol.cell, answer, spec.kind)) continue;
    if (new Set(built.cells.map(c => visKey(c, spec.kind))).size < 3) continue;
    const opt = makeOptions(rng, spec.kind, answer, grid8, built.set, level);
    if (!opt) continue;
    return { v: 1, seed, level, kind: spec.kind, difficulty: MATRIX_DIFFICULTY[level - 1], grid: grid8, options: opt.options, correct: opt.correct, rules: Object.values(built.set).filter(r => r.how !== 'const') };
  }
  throw new Error(`матрица не собралась: seed ${seed}, level ${level}`);
}
// Полный набор из 12 заданий по возрастанию сложности. seed определяет весь набор.
export function makeMatrixSet(seed, n = MATRIX_COUNT) {
  const rng = makeRng(seed);
  return Array.from({ length: n }, (_, i) => makeMatrix(rng.int(1, 2 ** 30), i + 1));
}
// Все ли варианты разные на вид, и ровно ли один подходит под решатель (для автотестов).
export function checkMatrix(item) {
  const sol = solveMatrix(item.grid, item.kind);
  const keys = item.options.map(o => visKey(o, item.kind));
  return { solvable: sol.ok, distinct: new Set(keys).size === keys.length, matches: sol.ok ? item.options.filter(o => sameCell(o, sol.cell, item.kind)).length : 0, correctIsSolution: sol.ok && sameCell(item.options[item.correct], sol.cell, item.kind) };
}

// ---------- геометрия для рисования (в клетке 100×100) ----------
const POS = { 1: [[50, 50]], 2: [[30, 50], [70, 50]], 3: [[50, 27], [28, 70], [72, 70]], 4: [[30, 30], [70, 30], [30, 70], [70, 70]] };
const RAD = { 1: [14, 22, 32], 2: [10, 14, 18], 3: [9, 12, 15], 4: [8, 11, 14] };
export const SLOT_XY = [[22, 32], [50, 32], [78, 32], [22, 68], [50, 68], [78, 68]];
// { prims: [{ shape, cx, cy, r, fill, rot }], dots: [[cx, cy]] }: что нарисовать в клетке.
export function layoutCell(cell, kind) {
  if (kind === 'a') return { prims: POS[cell.count].map(([cx, cy]) => ({ shape: SHAPES[cell.shape], cx, cy, r: RAD[cell.count][cell.size], fill: cell.fill, rot: ASYM.has(cell.shape) ? cell.rot * 45 : 0 })), dots: [] };
  const prims = [], dots = [];
  SLOT_XY.forEach(([cx, cy], i) => { if (cell.mask & (1 << i)) prims.push({ shape: SHAPES[cell.shape], cx, cy, r: 11, fill: cell.fill, rot: 0 }); else dots.push([cx, cy]); });
  return { prims, dots };
}

// ---------- описание словами (для экранного диктора) ----------
const NOUN = [['круг', 'круга', 'кругов', 'm'], ['квадрат', 'квадрата', 'квадратов', 'm'], ['треугольник', 'треугольника', 'треугольников', 'm'], ['ромб', 'ромба', 'ромбов', 'm'],
  ['крест', 'креста', 'крестов', 'm'], ['шестиугольник', 'шестиугольника', 'шестиугольников', 'm'], ['стрелка', 'стрелки', 'стрелок', 'f'], ['полукруг', 'полукруга', 'полукругов', 'm']];
const ADJ = { // [м.ед., ж.ед., мн. именительный, мн. родительный]
  size: [['маленький', 'маленькая', 'маленькие', 'маленьких'], ['средний', 'средняя', 'средние', 'средних'], ['большой', 'большая', 'большие', 'больших']],
  fill: [['пустой', 'пустая', 'пустые', 'пустых'], ['серый', 'серая', 'серые', 'серых'], ['закрашенный', 'закрашенная', 'закрашенные', 'закрашенных']],
  dir: [['направленный', 'направленная', 'направленные', 'направленных']],
};
const NUMW = { m: ['один', 'два', 'три', 'четыре'], f: ['одна', 'две', 'три', 'четыре'] };
const DIRS = ['вверх', 'вверх и вправо', 'вправо', 'вниз и вправо', 'вниз', 'вниз и влево', 'влево', 'вверх и влево'];
const SLOT_NAME = ['сверху слева', 'сверху в центре', 'сверху справа', 'снизу слева', 'снизу в центре', 'снизу справа'];
const PLURAL = ['круги', 'квадраты', 'треугольники', 'ромбы', 'кресты', 'шестиугольники', 'стрелки', 'полукруги'];
export function describeCell(cell, kind) {
  const [n1, n2, , g] = NOUN[cell.shape], gi = g === 'f' ? 1 : 0;
  if (kind === 's') {
    if (!cell.mask) return 'пусто';
    const pos = SLOT_NAME.filter((_, i) => cell.mask & (1 << i)), many = pos.length > 1;
    return `${ADJ.fill[cell.fill][many ? 2 : gi]} ${many ? PLURAL[cell.shape] : n1} ${many ? 'в позициях' : 'в позиции'}: ${pos.join(', ')}`;
  }
  const k = cell.count, one = k === 1, adjIdx = one ? gi : g === 'f' ? 2 : 3;
  let s = `${NUMW[g][k - 1]} ${ADJ.size[cell.size][adjIdx]} ${ADJ.fill[cell.fill][adjIdx]} ${one ? n1 : n2}`;
  if (ASYM.has(cell.shape)) s += SHAPES[cell.shape] === 'half' ? `, выпуклой стороной ${DIRS[cell.rot]}` : `, ${ADJ.dir[0][adjIdx]} ${DIRS[cell.rot]}`;
  return s;
}
const ROW_NAME = ['Первая', 'Вторая', 'Третья'];
export function describeMatrix(item) {
  const rows = [0, 1, 2].map(r => `${ROW_NAME[r]} строка: ${[0, 1, 2].map(c => { const i = r * 3 + c; return `клетка ${c + 1} — ${i < 8 ? describeCell(item.grid[i], item.kind) : 'пропущена, на её месте знак вопроса'}`; }).join('; ')}.`);
  return `Матрица три на три, одна клетка пропущена. ${rows.join(' ')}`;
}
export const describeOption = (item, i) => `Вариант ${i + 1}: ${describeCell(item.options[i], item.kind)}`;

// ---------- правило словами (для разбора после теста) ----------
const ATTR_NAME = { shape: 'вид фигуры', count: 'число фигур', size: 'размер', fill: 'закраска', rot: 'поворот', mask: 'расположение' };
export function ruleText(rule) {
  const a = ATTR_NAME[rule.attr];
  switch (rule.how) {
    case 'prog': return rule.attr === 'rot' ? `поворот меняется на ${rule.d * 45}° в каждой следующей клетке строки` : `${a} ${rule.d > 0 ? 'растёт' : 'убывает'} на 1 слева направо`;
    case 'latin': return `${a}: в каждой строке и в каждом столбце три разных значения, по одному`;
    case 'rowconst': return `${a} одинаково внутри строки`;
    case 'colconst': return `${a} одинаково внутри столбца`;
    case 'sum': return 'число фигур в третьей клетке равно сумме первых двух';
    default: return { or: 'третья клетка — все фигуры первой и второй вместе', xor: 'третья клетка — фигуры, которые есть только в одной из двух первых', and: 'третья клетка — только общие фигуры первых двух', diff: 'третья клетка — фигуры первой, которых нет во второй' }[rule.op];
  }
}
