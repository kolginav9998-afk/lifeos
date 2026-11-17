// «Числовые ряды: 12 заданий». Чистая логика: ряд строится по зерну, а ответ проверяет независимый решатель, который видит только показанные числа.
// Решатель перебирает известные правила (прибавляем, умножаем, разности, сумма двух предыдущих, два ряда вперемешку, чередование действий);
// если подошло несколько правил и они дают разные ответы, ряд отбрасывается. Так у каждого ряда один верный ответ.
import { makeRng } from './stats.js';

export const SERIES_COUNT = 12;
const diffs = a => a.slice(1).map((x, i) => x - a[i]);
const constant = a => a.length >= 2 && a.every(x => x === a[0]);
const last = a => a[a.length - 1];

// ---------- решатель ----------
// Возвращает { ok, answer, names }: ok — все подошедшие правила дали один и тот же ответ.
export function solveSeries(terms) {
  const t = terms, n = t.length, found = [];
  const d1 = diffs(t), d2 = diffs(d1), d3 = diffs(d2);
  if (n >= 4 && constant(d1)) found.push(['прибавляем', last(t) + d1[0]]);
  if (n >= 4 && t[0] !== 0 && t[1] !== 0 && t.slice(0, -1).every((x, i) => t[i + 1] * t[0] === x * t[1]) && (last(t) * t[1]) % t[0] === 0) found.push(['умножаем', (last(t) * t[1]) / t[0]]);
  if (n >= 5 && d1[0] !== 0 && d1.slice(0, -1).every((x, i) => d1[i + 1] * d1[0] === x * d1[1]) && (last(d1) * d1[1]) % d1[0] === 0) found.push(['разности умножаются', last(t) + (last(d1) * d1[1]) / d1[0]]);
  if (n >= 5 && constant(d2)) found.push(['вторая разность', last(t) + last(d1) + d2[0]]);
  if (n >= 6 && constant(d3)) found.push(['третья разность', last(t) + last(d1) + last(d2) + d3[0]]);
  if (n >= 5) { const ks = t.slice(2).map((x, i) => x - t[i + 1] - t[i]); if (constant(ks)) found.push(['сумма двух предыдущих', last(t) + t[n - 2] + ks[0]]); }
  if (n >= 6) {
    const ev = t.filter((_, i) => i % 2 === 0), od = t.filter((_, i) => i % 2 === 1);
    if (ev.length >= 3 && od.length >= 3 && constant(diffs(ev)) && constant(diffs(od))) found.push(['два ряда вперемешку', n % 2 === 0 ? last(ev) + diffs(ev)[0] : last(od) + diffs(od)[0]]);
    for (const addFirst of [true, false]) {                       // чередуем «прибавить p» и «умножить на q»
      const adds = [], muls = []; let okOps = true;
      for (let i = 1; i < n; i++) {
        const isAdd = addFirst ? i % 2 === 1 : i % 2 === 0;
        if (isAdd) adds.push(t[i] - t[i - 1]); else { if (t[i - 1] === 0 || t[i] % t[i - 1] !== 0) { okOps = false; break; } muls.push(t[i] / t[i - 1]); }
      }
      if (okOps && adds.length >= 2 && muls.length >= 2 && constant(adds) && constant(muls) && muls[0] > 1 && adds[0] !== 0) {
        const nextIsAdd = addFirst ? n % 2 === 1 : n % 2 === 0;
        found.push(['чередуем действия', nextIsAdd ? last(t) + adds[0] : last(t) * muls[0]]);
      }
    }
  }
  const values = [...new Set(found.map(f => f[1]))];
  return { ok: values.length === 1, answer: values.length === 1 ? values[0] : null, names: found.map(f => f[0]), values };
}

// ---------- семейства рядов по уровням ----------
// Каждое возвращает { terms (на одно больше показанных: последний — ответ), rule }.
const fam = {
  arith: (rng, show) => { const a = rng.int(1, 20), d = rng.int(2, 9); return { terms: Array.from({ length: show + 1 }, (_, i) => a + d * i), rule: `к каждому числу прибавляем ${d}` }; },
  down: (rng, show) => { const d = rng.int(3, 9), a = d * (show + 1) + rng.int(1, 12); return { terms: Array.from({ length: show + 1 }, (_, i) => a - d * i), rule: `из каждого числа вычитаем ${d}` }; },
  geom: (rng, show) => { const r = rng.pick([2, 3]), a = rng.int(1, r === 3 ? 2 : 4); return { terms: Array.from({ length: show + 1 }, (_, i) => a * r ** i), rule: `каждое число умножаем на ${r}` }; },
  squares: (rng, show) => { const s = rng.int(1, 4), c = rng.int(0, 5); return { terms: Array.from({ length: show + 1 }, (_, i) => (i + s) ** 2 + c), rule: c ? `квадраты чисел${' плюс ' + c}` : 'квадраты последовательных чисел' }; },
  alt: (rng, show) => { const a = rng.int(1, 9), b = rng.int(20, 40), da = rng.int(2, 5), db = rng.int(1, 4); return { terms: Array.from({ length: show + 1 }, (_, i) => (i % 2 === 0 ? a + da * (i / 2) : b + db * ((i - 1) / 2))), rule: `два ряда вперемешку: на нечётных местах прибавляем ${da}, на чётных — ${db}` }; },
  grow: (rng, show) => { const a = rng.int(1, 9), d0 = rng.int(1, 3); let v = a; const terms = [v]; for (let i = 0; i < show; i++) { v += d0 + i; terms.push(v); } return { terms, rule: `разность растёт на 1 (сначала +${d0}, потом +${d0 + 1}, …)` }; },
  fib: (rng, show) => { const t = [rng.int(1, 4), rng.int(1, 5)]; while (t.length < show + 1) t.push(t[t.length - 1] + t[t.length - 2]); return { terms: t, rule: 'каждое число — сумма двух предыдущих' }; },
  cubes: (rng, show) => { const s = rng.int(1, 2), c = rng.int(0, 3); return { terms: Array.from({ length: show + 1 }, (_, i) => (i + s) ** 3 + c), rule: c ? `кубы чисел плюс ${c}` : 'кубы последовательных чисел' }; },
  second: (rng, show) => { const k = rng.int(3, 4), d0 = rng.int(1, 4), a = rng.int(1, 9); return { terms: Array.from({ length: show + 1 }, (_, i) => a + d0 * i + (k * i * (i - 1)) / 2), rule: `разность растёт на ${k} (сначала +${d0}, потом +${d0 + k}, …)` }; },
  affine: (rng, show) => { const r = rng.pick([2, 3]), b = rng.pick([1, 2, -1]), t = [rng.int(2, 3)]; while (t.length < show + 1) t.push(t[t.length - 1] * r + b); return { terms: t, rule: `умножаем на ${r} и ${b > 0 ? 'прибавляем ' + b : 'вычитаем ' + -b}` }; },
  altop: (rng, show) => { const p = rng.int(2, 6), q = rng.pick([2, 3]), t = [rng.int(1, 5)]; for (let i = 1; i <= show; i++) t.push(i % 2 === 1 ? t[i - 1] + p : t[i - 1] * q); return { terms: t, rule: `по очереди: прибавляем ${p}, умножаем на ${q}` }; },
  fibk: (rng, show) => { const k = rng.int(1, 2), t = [rng.int(1, 3), rng.int(1, 4)]; while (t.length < show + 1) t.push(t[t.length - 1] + t[t.length - 2] + k); return { terms: t, rule: `сумма двух предыдущих плюс ${k}` }; },
};
export const SERIES_LADDER = [['arith', 5], ['down', 5], ['geom', 5], ['squares', 6], ['alt', 6], ['grow', 6], ['fib', 6], ['cubes', 6], ['second', 6], ['affine', 6], ['altop', 6], ['fibk', 6]];
export const SERIES_FAMILY_WEIGHT = { arith: 1, down: 1.5, geom: 2, squares: 3, alt: 3.5, grow: 4, fib: 4.5, cubes: 5, second: 6, affine: 7, altop: 7.5, fibk: 8 };
export const SERIES_DIFFICULTY = SERIES_LADDER.map(([f]) => SERIES_FAMILY_WEIGHT[f]);

// ---------- варианты ответа ----------
function makeOptions(rng, terms, answer) {
  const t = terms, n = t.length, d = t[n - 1] - t[n - 2];
  const naive = [t[n - 1] + d, t[n - 1] + d + 1, t[n - 1] + d - 1, t[n - 1] * 2, t[n - 1] + t[n - 2], t[n - 1] * Math.round(t[n - 1] / (t[n - 2] || 1)), t[n - 1] + (t[n - 2] - t[n - 3]), answer + d];
  const near = [answer + 1, answer - 1, answer + 2, answer - 2, answer + 10, answer - 10, answer + 5, answer - 5, answer * 2];
  const ok = v => Number.isInteger(v) && v > 0 && v !== answer && v < 100000;
  const chosen = [];
  const add = v => { if (ok(v) && !chosen.includes(v)) chosen.push(v); };
  for (const v of rng.shuffle(naive)) { if (chosen.length >= 3) break; add(v); }
  for (const v of rng.shuffle(near)) { if (chosen.length >= 5) break; add(v); }
  for (let k = 3; chosen.length < 5; k++) add(answer + k * 3);
  const opts = rng.shuffle([answer, ...chosen.slice(0, 5)]);
  return { options: opts, correct: opts.indexOf(answer) };
}

// level 1…12. Возвращает { v, seed, level, family, difficulty, terms (показаны), answer, options (6), correct, rule }.
export function makeSeriesItem(seed, level) {
  const [family, show] = SERIES_LADDER[Math.min(Math.max(level, 1), SERIES_COUNT) - 1];
  const rng = makeRng((seed ^ Math.imul(level, 0x85ebca6b)) >>> 0);
  for (let attempt = 0; attempt < 200; attempt++) {
    const { terms, rule } = fam[family](rng, show);
    const shown = terms.slice(0, show), answer = terms[show];
    if (shown.some(x => x < 0 || x > 5000) || answer > 20000 || answer < 0) continue;
    const sol = solveSeries(shown);
    if (!sol.ok || sol.answer !== answer) continue;
    const { options, correct } = makeOptions(rng, shown, answer);
    return { v: 1, seed, level, family, difficulty: SERIES_DIFFICULTY[level - 1], terms: shown, answer, options, correct, rule };
  }
  throw new Error(`ряд не собрался: seed ${seed}, level ${level}`);
}
export function makeSeriesSet(seed, n = SERIES_COUNT) {
  const rng = makeRng(seed);
  return Array.from({ length: n }, (_, i) => makeSeriesItem(rng.int(1, 2 ** 30), i + 1));
}
export function checkSeries(item) {
  const sol = solveSeries(item.terms);
  return { solvable: sol.ok, answerMatches: sol.ok && sol.answer === item.answer, distinct: new Set(item.options).size === item.options.length, matches: item.options.filter(o => sol.ok && o === sol.answer).length, correctIsSolution: sol.ok && item.options[item.correct] === sol.answer };
}
// Принимаем ответ, выбранный вариантом или введённый цифрами (пробелы по краям не мешают).
export const parseTyped = s => (/^\s*-?\d{1,6}\s*$/.test(String(s)) ? Number(s) : null);
