// Статистика для аналитики: устойчивые к выбросам оценки, ранговые корреляции и проверка на случайность.
// Всё детерминировано (свой генератор случайных чисел с seed), чтобы результаты были воспроизводимы и проверяемы.

export const sum = a => a.reduce((x, y) => x + y, 0);
export const mean = a => (a.length ? sum(a) / a.length : NaN);
export function sd(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - 1));
}
export function quantile(a, q) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const median = a => quantile(a, 0.5);
export const mad = a => { if (!a.length) return NaN; const m = median(a); return median(a.map(x => Math.abs(x - m))); };

// Устойчивая оценка отклонения от «обычного»: (x − медиана) / (1,4826·MAD). Если разброс почти нулевой, берём минимальный масштаб.
export function robustZ(x, baseline, minScaleFrac = 0.05) {
  if (baseline.length < 3) return null;
  const m = median(baseline);
  const scale = Math.max(1.4826 * mad(baseline), Math.abs(m) * minScaleFrac, 1e-9);
  return (x - m) / scale;
}

// Генератор псевдослучайных чисел mulberry32.
export function makeRng(seed = Date.now()) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));      // включительно
  rng.pick = arr => arr[Math.floor(rng() * arr.length)];
  rng.shuffle = arr => { const r = [...arr]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
  return rng;
}

// Ранги со средним значением для совпадающих.
export function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
export function pearson(x, y) {
  const n = x.length;
  if (n < 3 || y.length !== n) return NaN;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx === 0 || syy === 0 ? NaN : sxy / Math.sqrt(sxx * syy);
}
export const spearman = (x, y) => pearson(ranks(x), ranks(y));

// Перестановочная проверка: как часто случайное перемешивание даёт корреляцию не слабее наблюдаемой (двусторонняя p).
export function spearmanTest(x, y, { permutations = 2000, seed = 12345 } = {}) {
  const rho = spearman(x, y);
  if (!Number.isFinite(rho)) return { rho: NaN, p: 1, n: x.length };
  const rng = makeRng(seed);
  const rx = ranks(x);
  let ry = ranks(y), extreme = 0;
  for (let i = 0; i < permutations; i++) {
    ry = rng.shuffle(ry);
    if (Math.abs(pearson(rx, ry)) >= Math.abs(rho) - 1e-12) extreme++;
  }
  return { rho, p: (extreme + 1) / (permutations + 1), n: x.length };
}

// Линейная регрессия y = a + b·x.
export function linreg(x, y) {
  const n = x.length;
  if (n < 2) return null;
  const mx = mean(x), my = mean(y);
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); syy += (y[i] - my) ** 2; }
  if (sxx === 0) return null;
  const b = sxy / sxx;
  return { slope: b, intercept: my - b * mx, r2: syy === 0 ? 0 : (sxy * sxy) / (sxx * syy), n };
}

// Экспоненциальное сглаживание.
export function ewma(a, alpha = 0.3) {
  const out = [];
  let s = null;
  for (const v of a) { s = s === null ? v : alpha * v + (1 - alpha) * s; out.push(s); }
  return out;
}

// Обратная функция нормального распределения (приближение Эклама, ошибка ~1e-9) — нужна для d′.
export function normInv(p) {
  if (p <= 0 || p >= 1) return p <= 0 ? -Infinity : Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// d′ (различение сигнала и шума) с поправкой «+0,5», чтобы не получать бесконечность при идеальных ответах.
export function dPrime(hits, misses, falseAlarms, correctRejections) {
  const hr = (hits + 0.5) / (hits + misses + 1), far = (falseAlarms + 0.5) / (falseAlarms + correctRejections + 1);
  return normInv(hr) - normInv(far);
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
