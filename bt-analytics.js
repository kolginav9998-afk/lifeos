// Аналитика результатов проверок: личная норма, отклонения, домены, связи с образом жизни, подсказки.
// Принципы: сравнение только с самим собой; устойчивая статистика (медиана/MAD); поправка на множественные сравнения;
// формулировки осторожные — это наблюдения, а не диагнозы и не доказанные причины.
import { mean, median, mad, robustZ, spearmanTest, slopeCI, makeRng, round } from './stats.js';
import { TESTS, TEST_BY_ID, DOMAINS, primaryShown, runsOf, fmtNum, fmtPrimary } from './bt-core.js';
import { dailyTable } from './diary.js';
import { addDays, todayStr } from './events.js';
import { sickDays } from './sick.js';

export const MIN_BASELINE = 5;        // сколько прежних результатов нужно, чтобы считать «норму»
export const BASELINE_WINDOW = 30;    // норма считается по последним N результатам
export const MIN_PAIRS = 10;          // минимум дней для проверки связи
export const FDR_LIMIT = 0.25;        // принимаем связи с долей ложных открытий не больше 25%

const orient = (id, v) => (TEST_BY_ID[id].primary.better === 'lower' ? -v : v);
const clampZ = z => (z === null || !Number.isFinite(z) ? null : Math.max(-5, Math.min(5, z)));
const finite = a => a.filter(Number.isFinite);

// Достоверные результаты теста по порядку.
export function seriesOf(runs, testId) {
  const out = [];
  for (const r of runs) {
    const t = r.tests[testId];
    if (!t || t.skipped || !t.ok) continue;
    const v = primaryShown(testId, t.metrics);
    if (v === null) continue;
    out.push({ ts: r.startedAt, date: r.date, hour: r.hour, weekday: r.weekday, value: v });
  }
  return out;
}

// Отклонение каждого результата от личной нормы (по предыдущим). z > 0 — лучше обычного независимо от направления показателя.
export function zSeries(runs, testId) {
  const s = seriesOf(runs, testId);
  const o = s.map(p => orient(testId, p.value));
  return s.map((p, i) => ({ ...p, z: i >= MIN_BASELINE ? clampZ(robustZ(o[i], o.slice(Math.max(0, i - BASELINE_WINDOW), i))) : null }));
}

export function analyzeRuns(runs) {
  const perTest = {};
  const zByRun = new Map();
  for (const t of TESTS) {
    const series = zSeries(runs, t.id);
    const o = series.map(p => orient(t.id, p.value));
    const prev = o.slice(Math.max(0, o.length - 1 - BASELINE_WINDOW), Math.max(0, o.length - 1));
    perTest[t.id] = {
      series, n: series.length, latest: series.length ? series[series.length - 1] : null,
      baseline: prev.length >= MIN_BASELINE ? { n: prev.length, median: median(prev) * (t.primary.better === 'lower' ? -1 : 1), mad: mad(prev) } : null,
    };
    for (const p of series) if (p.z !== null) { if (!zByRun.has(p.ts)) zByRun.set(p.ts, {}); zByRun.get(p.ts)[t.id] = p.z; }
  }
  const perRun = runs.map(r => {
    const z = zByRun.get(r.startedAt) ?? {};
    const byDomain = {};
    for (const [id, v] of Object.entries(z)) (byDomain[TEST_BY_ID[id].domain] ??= []).push(v);
    const domains = Object.fromEntries(Object.entries(byDomain).map(([d, a]) => [d, mean(a)]));
    const ds = Object.values(domains);
    return { startedAt: r.startedAt, date: r.date, hour: r.hour, weekday: r.weekday, state: r.state ?? null, z, domains, composite: ds.length >= 3 ? mean(ds) : null };
  });
  return { perTest, perRun };
}

// ---------- таблица по дням ----------
const PREV = ['caffeine', 'alcohol', 'exercise', 'screen', 'water', 'outdoors', 'foodScore'];
export function dailyRows(events, runs = runsOf(events), analysis = analyzeRuns(runs)) {
  const diary = new Map(dailyTable(events).map(r => [r.date, r]));
  // сводки по дням из других разделов: фокус, тренировки, привычки, задачи
  const focusBy = {}, workBy = {}, habitBy = {}, taskBy = {};
  for (const e of events) {
    if (e.type === 'focus') focusBy[e.payload.date] = (focusBy[e.payload.date] || 0) + e.payload.minutes;
    else if (e.type === 'workout' && e.payload.done) workBy[e.payload.date] = (workBy[e.payload.date] || 0) + (e.payload.minutes || 0);
    else if (e.type === 'habit_log') habitBy[e.payload.date] = (habitBy[e.payload.date] || 0) + 1;
    else if (e.type === 'task' && e.payload.done && e.payload.doneAt) { const d = todayStr(e.payload.doneAt); taskBy[d] = (taskBy[d] || 0) + 1; }
  }
  const sick = sickDays(events, todayStr());                       // дни режима болезни: помечаем, в связях не учитываем
  const byDate = new Map();
  for (const r of analysis.perRun) { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(r); }
  const dates = [...new Set([...diary.keys(), ...byDate.keys()])].sort();
  return dates.map(date => {
    const d = diary.get(date) ?? {}, prev = diary.get(addDays(date, -1)) ?? {};
    const rs = byDate.get(date) ?? [];
    const comp = finite(rs.map(x => x.composite));
    const row = { ...d, date, runs: rs.length, composite: comp.length ? median(comp) : null };
    for (const dom of Object.keys(DOMAINS)) { const vs = finite(rs.map(x => x.domains[dom])); row['z_' + dom] = vs.length ? median(vs) : null; }
    for (const k of PREV) row['prev_' + k] = prev[k] ?? null;
    row.sick = sick.has(date) ? 1 : 0;
    row.focusMin = focusBy[date] ?? 0; row.workoutMin = workBy[date] ?? 0; row.habitsDone = habitBy[date] ?? 0; row.tasksDone = taskBy[date] ?? 0;
    row.prev_focusMin = focusBy[addDays(date, -1)] ?? 0; row.prev_workoutMin = workBy[addDays(date, -1)] ?? 0;
    return row;
  });
}

// Единицы для оценки «на сколько меняется результат»: k — на сколько единиц фактора считаем шаг.
export const SLOPE_UNITS = {
  sleepHours: { k: 1, text: 'каждый дополнительный час сна' }, prev_caffeine: { k: 1, text: 'каждая лишняя чашка кофе накануне' }, prev_alcohol: { k: 1, text: 'каждая порция алкоголя накануне' },
  prev_exercise: { k: 30, text: 'каждые 30 минут нагрузки накануне' }, focusMin: { k: 30, text: 'каждые 30 минут фокуса' }, workoutMin: { k: 30, text: 'каждые 30 минут тренировки' },
  prev_focusMin: { k: 30, text: 'каждые 30 минут фокуса накануне' }, prev_workoutMin: { k: 30, text: 'каждые 30 минут тренировки накануне' },
};
// Фраза с оценкой и интервалом для связи c (или '' если данных мало или единица фактора неясна).
export function slopeSentence(rows, c) {
  const u = SLOPE_UNITS[c.x];
  if (!u) return '';
  const xs = [], ys = [];
  for (const r of rows) if (Number.isFinite(r[c.x]) && Number.isFinite(r[c.y])) { xs.push(r[c.x]); ys.push(r[c.y]); }
  const ci = slopeCI(xs, ys, { seed: 17 });
  if (!ci) return '';
  const sigma = c.y === 'composite' || c.y.startsWith('z_'), unit = sigma ? 'σ' : ' балла';
  const sg = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v * u.k), sigma ? 2 : 1)}`;
  return ` Грубая оценка: на ${u.text} в среднем ${sg(ci.slope)}${unit} (интервал от ${sg(ci.lo)} до ${sg(ci.hi)}${unit}). Интервал широкий, пока данных мало.`;
}

// ---------- связи ----------
export const FACTORS = [
  ['sleepHours', 'Сон, часов'], ['sleepQuality', 'Качество сна'], ['moodMorning', 'Настроение утром'], ['energyMorning', 'Энергия утром'], ['stressMorning', 'Стресс утром'],
  ['prev_caffeine', 'Кофе накануне'], ['prev_alcohol', 'Алкоголь накануне'], ['prev_exercise', 'Тренировка накануне'], ['prev_screen', 'Экран накануне'], ['prev_water', 'Вода накануне'], ['prev_outdoors', 'Прогулка накануне'],
  ['foodScore', 'Питание (овощи и белок минус сладкое)'], ['prev_foodScore', 'Питание накануне'], ['focusMin', 'Фокус, минут'], ['workoutMin', 'Тренировка (журнал), минут'], ['habitsDone', 'Выполнено привычек'], ['prev_focusMin', 'Фокус накануне'], ['prev_workoutMin', 'Тренировка (журнал) накануне'],
];
export const OUTCOMES = [['composite', 'общий результат'], ...Object.entries(DOMAINS).map(([k, l]) => ['z_' + k, `«${l.toLowerCase()}»`]),
  ['moodEvening', '«настроение вечером»'], ['energyEvening', '«энергия вечером»'], ['stressEvening', '«стресс вечером»'], ['focus', '«фокус»'], ['productivity', '«продуктивность»'], ['sleepQuality', '«качество сна»']];

// Поправка Бенджамини—Хохберга: доля ложных открытий (q) для каждого p.
export function fdr(ps) {
  const idx = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]);
  const m = ps.length, q = new Array(m);
  let prev = 1;
  for (let k = m - 1; k >= 0; k--) { prev = Math.min(prev, (idx[k][0] * m) / (k + 1)); q[idx[k][1]] = prev; }
  return q;
}

export function correlations(rows, { minPairs = MIN_PAIRS, permutations = 1000 } = {}) {
  const found = [];
  let seed = 7;
  for (const [xk, xl] of FACTORS) for (const [yk, yl] of OUTCOMES) {
    const xs = [], ys = [];
    for (const r of rows) if (Number.isFinite(r[xk]) && Number.isFinite(r[yk])) { xs.push(r[xk]); ys.push(r[yk]); }
    if (xs.length < minPairs || new Set(xs).size < 3 || new Set(ys).size < 3) continue;
    const t = spearmanTest(xs, ys, { permutations, seed: seed++ });
    if (Number.isFinite(t.rho)) found.push({ x: xk, y: yk, xLabel: xl, yLabel: yl, n: t.n, rho: t.rho, p: t.p });
  }
  const q = fdr(found.map(f => f.p));
  found.forEach((f, i) => { f.q = q[i]; });
  return found.sort((a, b) => a.p - b.p);
}

// Сравнение общего результата в днях с высоким и низким значением фактора.
export function groupDiff(rows, key, threshold, outcome = 'composite') {
  const hi = finite(rows.filter(r => Number.isFinite(r[key]) && r[key] >= threshold).map(r => r[outcome]));
  const lo = finite(rows.filter(r => Number.isFinite(r[key]) && r[key] < threshold).map(r => r[outcome]));
  if (hi.length < 3 || lo.length < 3) return null;
  return { nHi: hi.length, nLo: lo.length, hi: median(hi), lo: median(lo), diff: median(hi) - median(lo) };
}

const BUCKETS = [['утром', h => h < 12], ['днём', h => h >= 12 && h < 18], ['вечером', h => h >= 18]];
export function timeOfDay(perRun) {
  const out = [];
  for (const [label, test] of BUCKETS) {
    const v = finite(perRun.filter(r => test(r.hour)).map(r => r.composite));
    if (v.length >= 3) out.push({ label, n: v.length, median: median(v) });
  }
  return out;
}

// ---------- подсказки ----------
export const sign = v => (v > 0 ? '+' : v < 0 ? '−' : '');
export const zText = z => `${sign(z)}${fmtNum(Math.abs(z), 1)}σ`;
export const zWord = z => (z <= -2 ? 'заметно ниже обычного' : z <= -1 ? 'ниже обычного' : z >= 2 ? 'заметно выше обычного' : z >= 1 ? 'выше обычного' : 'в пределах обычного');

export function insights(events, now = Date.now()) {
  const runs = runsOf(events);
  const out = [];
  const days = new Set(runs.map(r => r.date)).size;
  if (runs.length === 0 && dailyTable(events).length < MIN_PAIRS) return [{ id: 'empty', kind: 'info', conf: 'high', title: 'Пока нет данных', text: 'Пройди быструю проверку (около 5 минут) или веди утренние и вечерние отметки в «Дневнике»: выводы появятся после нескольких дней данных.' }];
  if (runs.length > 0 && runs.length < MIN_BASELINE + 1) out.push({ id: 'need-more', kind: 'info', conf: 'high', title: 'Копим личную норму', text: `Прохождений: ${runs.length}. Чтобы сравнивать тебя с самим собой, нужно минимум ${MIN_BASELINE + 1}, лучше в разные дни, в похожих условиях (тишина, одно время суток).` });

  const an = analyzeRuns(runs);
  const last = an.perRun[an.perRun.length - 1];

  // 1. Сегодня против нормы
  if (last && last.composite !== null) {
    const doms = Object.entries(last.domains).map(([d, z]) => ({ d, z })).sort((a, b) => a.z - b.z);
    const low = doms.filter(x => x.z <= -1), high = doms.filter(x => x.z >= 1);
    const parts = [];
    if (low.length) parts.push('Ниже обычного: ' + low.map(x => DOMAINS[x.d].toLowerCase()).join(', '));
    if (high.length) parts.push((parts.length ? 'выше' : 'Выше') + ' обычного: ' + high.map(x => DOMAINS[x.d].toLowerCase()).join(', '));
    out.push({ id: 'latest', kind: last.composite <= -1 ? 'warn' : last.composite >= 1 ? 'good' : 'info', conf: 'mid',
      title: `Последняя проверка: ${zWord(last.composite)}`, text: `Общий результат ${zText(last.composite)} относительно твоей нормы.${parts.length ? ' ' + parts.join('; ') + '.' : ''}${sickDays(events, todayStr(now)).has(last.date) ? ' В этот день был включён режим болезни: результат мог снизиться из-за самочувствия.' : ''} Один день — не вывод: смотри на несколько дней подряд.` });
  }

  // 2. Резкие отклонения отдельных тестов в последнем прохождении
  if (last) {
    for (const [id, z] of Object.entries(last.z)) {
      if (z <= -2) {
        const t = TEST_BY_ID[id];
        const tip = last.state?.sleepy >= 4 ? ' Ты отметил сильную сонливость — это могло повлиять.' : last.state?.noise ? ' Ты отметил шум вокруг — возможно, он помешал.' : '';
        out.push({ id: `anomaly-${id}`, kind: 'warn', conf: 'mid', title: `«${t.title}»: сегодня заметно хуже нормы`, text: `Показатель «${t.primary.label}» — ${fmtPrimary(id, runs[runs.length - 1].tests[id].metrics)} (${zText(z)}). Такое бывает при недосыпе, усталости, стрессе или отвлечении.${tip} Если держится несколько дней, обрати внимание на сон и нагрузку.` });
      }
    }
  }

  // 3. Достоверность
  const recent = runs.slice(-10);
  const total = recent.reduce((s, r) => s + Object.values(r.tests).filter(t => !t.skipped).length, 0);
  const bad = recent.reduce((s, r) => s + Object.values(r.tests).filter(t => !t.skipped && t.ok === false).length, 0);
  if (total >= 10 && bad / total > 0.25) out.push({ id: 'validity', kind: 'warn', conf: 'mid', title: 'Часть тестов отмечена недостоверной', text: `За последние прохождения ${bad} из ${total} тестов признаны недостоверными (слишком быстрые ответы, мало заданий). Проходи в тишине, не торопись — иначе сравнение с нормой теряет смысл.` });

  // 4. Тренд по тестам (по исходным значениям: относительная норма скользит вместе с ростом и тренд «съедает»)
  const rows = dailyRows(events, runs, an);
  const up = [], down = [];
  for (const t of TESTS) {
    const s = seriesOf(runs, t.id).slice(-21);
    if (s.length < 10) continue;
    const tt = spearmanTest(s.map((_, i) => i), s.map(p => orient(t.id, p.value)), { permutations: 1000, seed: 99 });
    if (tt.p < 0.05 && Math.abs(tt.rho) >= 0.4) (tt.rho > 0 ? up : down).push(t.title.toLowerCase());
  }
  if (up.length >= 2 && !down.length) out.push({ id: 'trend', kind: 'good', conf: 'mid', title: 'Результаты растут', text: `По нескольким тестам (${up.join(', ')}) за последние прохождения устойчивый рост. Часть роста — привыкание к самим тестам; ещё лучший знак, если растёт и «усвоение знаний».` });
  if (down.length >= 2 && !up.length) out.push({ id: 'trend', kind: 'warn', conf: 'mid', title: 'Результаты снижаются', text: `По нескольким тестам (${down.join(', ')}) за последние прохождения устойчивое снижение. Проверь сон, нагрузку и стресс за эти дни; если усталость копится — запланируй отдых.` });

  // 4а. Дрейф нормы и дни недели
  out.push(...driftInsights(runs, todayStr(now)));

  // 5. Связи с образом жизни (с поправкой на множественные сравнения)
  const rowsOk = rows.filter(r => !r.sick);                         // болезнь искажает связи: такие дни не берём
  const cors = correlations(rowsOk).filter(c => c.q <= FDR_LIMIT && Math.abs(c.rho) >= 0.3);
  const byFactor = new Map();                       // по одному выводу на фактор: общий результат важнее частных областей
  for (const c of cors) { const cur = byFactor.get(c.x); if (!cur || (c.y === 'composite' && cur.y !== 'composite')) byFactor.set(c.x, c); }
  const picked = [...byFactor.values()].sort((a, b) => a.p - b.p || Math.abs(b.rho) - Math.abs(a.rho));
  for (const c of picked.slice(0, 4)) {
    let extra = '';
    if (c.x === 'sleepHours' && c.y === 'composite') {
      const g = groupDiff(rowsOk, 'sleepHours', 7);
      if (g) extra = ` В дни со сном от 7 часов (${g.nHi}) общий результат в среднем ${g.diff >= 0 ? 'выше' : 'ниже'} на ${fmtNum(Math.abs(g.diff), 1)}σ, чем в остальные (${g.nLo}).`;
    }
    extra += slopeSentence(rowsOk, c);
    out.push({ id: `rel-${c.x}-${c.y}`, kind: 'relation', conf: c.n >= 30 && c.q <= 0.1 ? 'high' : 'low',
      title: `${c.xLabel} ↔ ${c.yLabel}`,
      text: `${c.rho > 0 ? 'Когда выше' : 'Когда ниже'} «${c.xLabel}», обычно ${c.rho > 0 ? 'выше' : 'ниже'} ${c.yLabel} (ρ = ${fmtNum(c.rho, 2)}, дней: ${c.n}, ${c.q < 0.01 ? 'q < 0,01' : `q = ${fmtNum(c.q, 2)}`}).${extra} Это связь, а не доказанная причина: проверь её личным экспериментом на 1–2 недели (Аналитика → Эксперименты).` });
  }
  if (!cors.length && rowsOk.length >= 14) out.push({ id: 'no-relations', kind: 'info', conf: 'mid', title: 'Устойчивых связей пока нет', text: 'С отметками дня (сон, кофе, нагрузка) убедительных связей не найдено. Это нормально: чем дольше ведёшь отметки, тем точнее картина.' });
  if (runs.length > 0 && rowsOk.filter(r => Number.isFinite(r.composite) && Number.isFinite(r.sleepHours)).length < MIN_PAIRS && days >= 3) out.push({ id: 'need-checkins', kind: 'info', conf: 'high', title: 'Добавь утренние отметки сна', text: `Для поиска связей нужно хотя бы ${MIN_PAIRS} дней, где есть и проверка, и отметка сна (раздел «Дневник»). Сейчас таких дней: ${rows.filter(r => Number.isFinite(r.composite) && Number.isFinite(r.sleepHours)).length}.` });

  const wdIns = weekdayInsight(rowsOk);
  if (wdIns) out.push(wdIns);

  // 6. Время суток
  const tod = timeOfDay(an.perRun);
  if (tod.length >= 2) {
    const sorted = [...tod].sort((a, b) => b.median - a.median);
    const best = sorted[0], worst = sorted[sorted.length - 1];
    if (best.median - worst.median >= 0.4) out.push({ id: 'time-of-day', kind: 'info', conf: 'low', title: `Лучше всего получается ${best.label}`, text: `Результаты ${best.label} в среднем выше, чем ${worst.label} (на ${fmtNum(best.median - worst.median, 1)}σ; проверок: ${best.n} и ${worst.n}). Планируй сложную умственную работу на это время.` });
  }

  // 7. Усвоение знаний: слабый курс
  const lastRecall = [...runs].reverse().find(r => r.tests.recall?.metrics?.byCategory);
  if (lastRecall) {
    const cats = Object.entries(lastRecall.tests.recall.metrics.byCategory).filter(([, v]) => v.n >= 2).map(([k, v]) => ({ k, acc: v.ok / v.n })).sort((a, b) => a.acc - b.acc);
    if (cats.length && cats[0].acc < 0.6) out.push({ id: 'weak-course', kind: 'info', conf: 'low', title: 'Что стоит повторить', text: `В последней проверке знаний слабее всего курс «${cats[0].k}» (${Math.round(cats[0].acc * 100)}% верных). Открой «Учёба» и повтори его карточки.` });
  }
  return out;
}

// ---------- итоги для экрана ----------
export function summarize(events) {
  const runs = runsOf(events);
  const an = analyzeRuns(runs);
  const last = an.perRun[an.perRun.length - 1] ?? null;
  return { runs: runs.length, days: new Set(runs.map(r => r.date)).size, analysis: an, last };
}

export const round2 = x => round(x, 2);

// Сравнение с самим собой: последний день с проверкой против предыдущего и против лучшего дня (по общему результату).
export function selfCompare(events) {
  const an = analyzeRuns(runsOf(events));
  const byDay = new Map();
  for (const r of an.perRun) if (Number.isFinite(r.composite)) { if (!byDay.has(r.date)) byDay.set(r.date, []); byDay.get(r.date).push(r.composite); }
  const days = [...byDay].map(([date, v]) => ({ date, value: median(v) })).sort((a, b) => a.date.localeCompare(b.date));
  if (days.length < 2) return null;
  const last = days.at(-1), prev = days.at(-2), best = days.reduce((b, d) => (d.value > b.value ? d : b));
  return { last, prev, best, diff: last.value - prev.value, days: days.length, isBest: days.length >= 3 && last.date === best.date };
}

// ---------- дни недели ----------
const WD_IN = ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу'];
const wdOf = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
// Различается ли общий результат по дням недели. Критерий: размах медиан по дням против перемешанных меток (перестановки, зерно фиксировано).
export function weekdayEffect(rows, { minPerDay = 3, minDays = 4, permutations = 1000, seed = 21 } = {}) {
  const groups = new Map();
  for (const r of rows) {
    if (!Number.isFinite(r.composite)) continue;
    const wd = wdOf(r.date);
    if (!groups.has(wd)) groups.set(wd, []);
    groups.get(wd).push(r.composite);
  }
  const ok = [...groups].filter(([, v]) => v.length >= minPerDay);
  if (ok.length < minDays) return null;
  const sizes = ok.map(([, v]) => v.length), all = ok.flatMap(([, v]) => v);
  const spread = gs => { const m = gs.map(g => median(g)); return Math.max(...m) - Math.min(...m); };
  const obs = spread(ok.map(([, v]) => v));
  const rng = makeRng(seed);
  let ge = 0;
  for (let i = 0; i < permutations; i++) {
    const sh = rng.shuffle(all); let k = 0;
    if (spread(sizes.map(n => { const g = sh.slice(k, k + n); k += n; return g; })) >= obs - 1e-12) ge++;
  }
  const days = ok.map(([weekday, v]) => ({ weekday, n: v.length, median: median(v) })).sort((a, b) => b.median - a.median);
  return { p: (ge + 1) / (permutations + 1), spread: obs, best: days[0], worst: days[days.length - 1], days, n: all.length };
}
export function weekdayInsight(rows) {
  const w = weekdayEffect(rows);
  if (!w || w.n < 20 || w.p >= 0.05 || w.spread < 0.5) return null;
  const sg = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtNum(Math.abs(v), 1)}σ`;
  return { id: 'weekday', kind: 'info', conf: w.p < 0.01 ? 'mid' : 'low', title: 'Результат зависит от дня недели',
    text: `Лучше всего ${WD_IN[w.best.weekday]} (${sg(w.best.median)}, дней: ${w.best.n}), хуже всего ${WD_IN[w.worst.weekday]} (${sg(w.worst.median)}, дней: ${w.worst.n}). Это наблюдение по твоим данным (${w.p < 0.01 ? 'p < 0,01' : `p = ${fmtNum(w.p, 2)}`}): посмотри, чем эти дни отличаются по сну, нагрузке и режиму.` };
}

// ---------- дрейф нормы ----------
// Сместилось ли «обычное»: медиана последних 14 дней против предыдущих 30. Размер сдвига измеряем в разбросе (MAD) прежних результатов.
export const DRIFT_RECENT = 14, DRIFT_BASE = 30;
export function normDrift(runs, testId, today) {
  const s = seriesOf(runs, testId);
  const from = addDays(today, -(DRIFT_RECENT - 1)), baseFrom = addDays(from, -DRIFT_BASE);
  const recent = s.filter(p => p.date >= from && p.date <= today), base = s.filter(p => p.date >= baseFrom && p.date < from);
  if (recent.length < 4 || base.length < 8) return null;
  const rb = recent.map(p => orient(testId, p.value)), bb = base.map(p => orient(testId, p.value));
  const bm = median(bb), scale = Math.max(1.4826 * mad(bb), Math.abs(bm) * 0.05, 1e-9);
  const shift = (median(rb) - bm) / scale;                               // в единицах разброса; > 0 — лучше прежнего
  const z = shift * Math.sqrt(recent.length);                           // медиана нескольких результатов шумит меньше одного
  return { testId, shift, z, nRecent: recent.length, nBase: base.length, recent: median(recent.map(p => p.value)), base: median(base.map(p => p.value)) };
}
export function driftInsights(runs, today, limit = 2) {
  const out = [];
  for (const t of TESTS) {
    const d = normDrift(runs, t.id, today);
    if (!d || Math.abs(d.shift) < 0.7 || Math.abs(d.z) < 2.5) continue;
    out.push({ d, t });
  }
  return out.sort((a, b) => Math.abs(b.d.z) - Math.abs(a.d.z)).slice(0, limit).map(({ d, t }) => ({
    id: `drift-${t.id}`, kind: d.shift > 0 ? 'good' : 'warn', conf: 'mid', title: `«${t.title}»: обычный уровень ${d.shift > 0 ? 'вырос' : 'снизился'}`,
    text: `За последние ${DRIFT_RECENT} дней типичный результат ${fmtPrimary(t.id, { [t.primary.key]: d.recent / (t.primary.scale ?? 1) })} против ${fmtPrimary(t.id, { [t.primary.key]: d.base / (t.primary.scale ?? 1) })} за предыдущие ${DRIFT_BASE} дней (сдвиг ${fmtNum(Math.abs(d.shift), 1)} от обычного разброса, результатов: ${d.nRecent} и ${d.nBase}). ${d.shift > 0 ? 'Похоже, что-то из режима работает: запомни, что менял.' : 'Проверь сон, нагрузку и стресс за эти недели: возможно, сместился режим.'}` }));
}
