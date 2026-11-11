// Дополнения к аналитике: полоса нормы на графиках, сравнение недель и 90 дней, ранжирование факторов за месяц,
// разброс результатов и отметки событий. Чистая логика; выводы осторожные: это наблюдения, а не причины.
import { mean, sd, spearmanTest } from './stats.js';
import { dailyRows, FACTORS, OUTCOMES, fdr, FDR_LIMIT } from './bt-analytics.js';
import { addDays } from './events.js';
import { practiceBy } from './practice.js';
import { trackById } from './academy.js';

const finite = a => a.filter(Number.isFinite);

// ---------- полоса нормы ----------
// Серая зона обычного: медиана ± один устойчивый разброс (1,4826·MAD) в тех же единицах, что и линия графика
// (у тестов «чем меньше, тем лучше» линия перевёрнута, поэтому полоса тоже).
export function normBand(testDef, baseline) {
  if (!baseline) return null;
  const sign = testDef.primary.better === 'lower' ? -1 : 1;
  const m = baseline.median * sign, w = 1.4826 * baseline.mad;
  return Number.isFinite(m) && Number.isFinite(w) && w > 0 ? { lo: m - w, hi: m + w } : null;
}

// ---------- разброс результатов ----------
export const CV_TESTS = ['reaction', 'digits', 'math', 'schulte'];            // показатели с нулём «ничего» (время, число): у остальных разброс относительно среднего не имеет смысла
// Коэффициент вариации (разброс относительно среднего) для положительных показателей. Нужно хотя бы 6 результатов.
export function variability(values, { min = 6 } = {}) {
  const v = finite(values);
  if (v.length < min) return null;
  const m = mean(v);
  return m > 0 ? { n: v.length, cv: sd(v) / m } : null;
}
// Последние 10 результатов против предыдущих 10: стал ли разброс заметно меньше или больше (на 25% и более).
export function variabilityTrend(values) {
  const v = finite(values), recent = variability(v.slice(-10)), prev = variability(v.slice(-20, -10));
  const trend = recent && prev && prev.cv > 0 ? (recent.cv <= prev.cv * 0.75 ? 'steadier' : recent.cv >= prev.cv * 1.25 ? 'noisier' : 'same') : null;
  return { recent, prev, trend };
}

// ---------- сравнение периодов ----------
const avg2 = (a, b) => { const v = finite([a, b]); return v.length ? mean(v) : null; };
export const METRICS = [
  { key: 'composite', label: 'Результат проверок', unit: 'σ', kind: 'mean', better: 'up', eps: 0.1, src: r => r.composite },
  { key: 'sleep', label: 'Сон', unit: 'ч', kind: 'mean', better: 'up', eps: 0.2, src: r => r.sleepHours },
  { key: 'mood', label: 'Настроение (1–5)', unit: '', kind: 'mean', better: 'up', eps: 0.2, src: r => avg2(r.moodMorning, r.moodEvening) },
  { key: 'energy', label: 'Энергия (1–5)', unit: '', kind: 'mean', better: 'up', eps: 0.2, src: r => avg2(r.energyMorning, r.energyEvening) },
  { key: 'stress', label: 'Стресс (1–5)', unit: '', kind: 'mean', better: 'down', eps: 0.2, src: r => avg2(r.stressMorning, r.stressEvening) },
  { key: 'runs', label: 'Проходов тестов', unit: '', kind: 'sum', better: 'up', src: r => r.runs },
  { key: 'habits', label: 'Отметок привычек', unit: '', kind: 'sum', better: 'up', src: r => r.habitsDone },
  { key: 'tasks', label: 'Выполнено задач', unit: '', kind: 'sum', better: 'up', src: r => r.tasksDone },
  { key: 'focus', label: 'Фокус', unit: 'мин', kind: 'sum', better: 'up', src: r => r.focusMin },
  { key: 'workout', label: 'Тренировки', unit: 'мин', kind: 'sum', better: 'up', src: r => r.workoutMin },
  { key: 'study', label: 'Учёба', unit: 'мин', kind: 'sum', better: 'up', src: null },       // считается отдельно (practice.js)
];

// Сводка за период [from, to]: средние (если есть данные хотя бы за minDays дней) и суммы.
export function periodStats(events, from, to, { rows = dailyRows(events), minDays = 3 } = {}) {
  const inside = rows.filter(r => r.date >= from && r.date <= to);
  const study = Object.values(practiceBy(events, from, to)).reduce((s, r) => s + r.total, 0);
  const m = {};
  for (const d of METRICS) {
    if (d.key === 'study') { m.study = { value: study, n: study ? 1 : 0 }; continue; }
    const vals = finite(inside.map(d.src));
    if (d.kind === 'mean') m[d.key] = vals.length >= minDays ? { value: mean(vals), n: vals.length } : null;
    else m[d.key] = { value: vals.reduce((s, x) => s + x, 0), n: vals.length };
  }
  return { from, to, days: inside.length, sick: inside.filter(r => r.sick).length, m };
}

// Этот период против такого же предыдущего (неделя к неделе, 90 дней к 90 дням).
export function comparePeriods(events, today, days, { minDays = 3 } = {}) {
  const rows = dailyRows(events);
  const now = periodStats(events, addDays(today, -(days - 1)), today, { rows, minDays });
  const prev = periodStats(events, addDays(today, -(2 * days - 1)), addDays(today, -days), { rows, minDays });
  const out = [];
  for (const d of METRICS) {
    const a = now.m[d.key], b = prev.m[d.key];
    if (d.kind === 'sum' ? !(a?.value || b?.value) : !a && !b) continue;          // нечего показывать: нет данных ни там, ни там
    const eps = d.eps ?? Math.max(1, 0.05 * (b?.value || 0));
    const delta = a && b ? a.value - b.value : null;
    const dir = delta === null ? null : Math.abs(delta) < eps ? 'same' : delta > 0 ? 'up' : 'down';
    const good = dir === null || dir === 'same' ? null : (dir === 'up') === (d.better === 'up');
    out.push({ key: d.key, label: d.label, unit: d.unit, kind: d.kind, now: a?.value ?? null, prev: b?.value ?? null, delta, dir, good });
  }
  return { days, now, prev, rows: out };
}
export const compareWeeks = (events, today) => comparePeriods(events, today, 7, { minDays: 3 });
export const compare90 = (events, today) => comparePeriods(events, today, 90, { minDays: 10 });

// ---------- что влияло сильнее всего за месяц ----------
// Факторы, отсортированные по силе связи с результатом за последние `days` дней (дни режима болезни не берём).
// level: possible — связь выдержала поправку на множество сравнений; weak — скорее случайность.
export function topFactors(events, today, { days = 30, outcome = 'composite', minPairs = 12, limit = 5, permutations = 600 } = {}) {
  const from = addDays(today, -(days - 1));
  const rows = dailyRows(events).filter(r => r.date >= from && r.date <= today && !r.sick);
  const found = [];
  let seed = 31;
  for (const [key, label] of FACTORS) {
    if (key === outcome) continue;
    const xs = [], ys = [];
    for (const r of rows) if (Number.isFinite(r[key]) && Number.isFinite(r[outcome])) { xs.push(r[key]); ys.push(r[outcome]); }
    if (xs.length < minPairs || new Set(xs).size < 3 || new Set(ys).size < 3) continue;
    const t = spearmanTest(xs, ys, { permutations, seed: seed++ });
    if (Number.isFinite(t.rho)) found.push({ key, label, n: t.n, rho: t.rho, p: t.p });
  }
  const q = fdr(found.map(f => f.p));
  found.forEach((f, i) => { f.q = q[i]; f.level = f.q <= FDR_LIMIT ? 'possible' : 'weak'; });
  found.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
  return { days, outcome, outcomeLabel: OUTCOMES.find(o => o[0] === outcome)?.[1] ?? outcome, rows: rows.filter(r => Number.isFinite(r[outcome])).length, needed: minPairs, list: found.slice(0, limit) };
}

// ---------- отметки событий на графике ----------
// Для ряда результатов series = [{ date, … }] (по порядку): где на графике начался режим болезни, курс или эксперимент.
// Возвращает [{ i, kind, label, date }] — i это номер точки, с которой событие вступило в силу. События вне ряда пропускаем.
export function eventMarks(events, series) {
  if (!series.length) return [];
  const first = series[0].date, last = series.at(-1).date, marks = [], seen = new Set();
  const add = (date, kind, label) => {
    if (!date || date < first || date > last) return;
    const i = series.findIndex(p => p.date >= date);
    const key = `${i}:${kind}`;
    if (i >= 0 && !seen.has(key)) { seen.add(key); marks.push({ i, kind, label, date }); }
  };
  for (const e of events) if (e.type === 'sick') add(e.payload.from, 'sick', 'режим болезни');
  const starts = {};
  for (const e of events) if (e.type === 'lesson' && (!starts[e.payload.track] || e.payload.date < starts[e.payload.track])) starts[e.payload.track] = e.payload.date;
  for (const [track, date] of Object.entries(starts)) add(date, 'course', `начат курс «${trackById(track)?.title ?? track}»`);
  for (const e of events) if (e.type === 'experiment' && !e.payload.cancelled) add(e.payload.startDate, 'exp', `эксперимент «${e.payload.title}»`);
  return marks.sort((a, b) => a.i - b.i);
}
