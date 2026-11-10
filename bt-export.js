// Выгрузка данных для анализа: набор CSV + JSON в одном ZIP. Тексты дневника, заметки и деньги сюда не попадают.
import { runsOf, TEST_BY_ID, TESTS, DOMAINS, primaryShown } from './bt-core.js';
import { analyzeRuns, dailyRows } from './bt-analytics.js';
import { makeZip } from './zip.js';
import { todayStr } from './events.js';
import { SLOTS, RATINGS, NUMBERS } from './diary.js';
import { measureLabel } from './health.js';
import { statesOf } from './academy.js';

// Обычный CSV (RFC 4180): запятая, точка как десятичный разделитель, UTF-8 с BOM. Текстовые ячейки защищены от формул.
function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : '';
  if (typeof v === 'boolean') return v ? '1' : '0';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export function toCsv(columns, rows) {
  const lines = [columns.map(cell).join(',')];
  for (const r of rows) lines.push(columns.map(c => cell(r[c])).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
// Вариант для русского Excel: «;» и запятая как десятичный разделитель.
export function toCsvExcel(columns, rows) {
  const c = v => { const s = typeof v === 'number' ? String(Math.round(v * 1e6) / 1e6).replace('.', ',') : cell(v); return /[;]/.test(s) && !s.startsWith('"') ? '"' + s + '"' : s; };
  const lines = [columns.map(c).join(';')];
  for (const r of rows) lines.push(columns.map(k => c(r[k])).join(';'));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

const pad = n => String(n).padStart(2, '0');
const hhmm = ts => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export function buildTables(events) {
  const runs = runsOf(events);
  const an = analyzeRuns(runs);
  const T = {};

  // ----- дни -----
  const days = dailyRows(events, runs, an);
  const habitsByDate = {}, tasksByDate = {};
  for (const e of events) {
    if (e.type === 'habit_log') habitsByDate[e.payload.date] = (habitsByDate[e.payload.date] || 0) + 1;
    else if (e.type === 'task' && e.payload.done && e.payload.doneAt) { const d = todayStr(e.payload.doneAt); tasksByDate[d] = (tasksByDate[d] || 0) + 1; }
  }
  const wt = {};
  for (const e of events) if (e.type === 'measure' && e.payload.kind === 'weight') (wt[e.payload.date] ||= []).push(e.payload.value);
  const dayCols = ['date', 'runs', 'composite', ...Object.keys(DOMAINS).map(d => 'z_' + d),
    'sleepHours', 'sleepQuality', 'moodMorning', 'energyMorning', 'stressMorning', 'moodEvening', 'energyEvening', 'stressEvening', 'focus', 'productivity', 'social',
    'caffeine', 'alcohol', 'water', 'exercise', 'screen', 'outdoors', 'habitsDone', 'tasksDone', 'weightKg'];
  const dayRows = days.map(r => ({ ...r, habitsDone: habitsByDate[r.date] ?? 0, tasksDone: tasksByDate[r.date] ?? 0, weightKg: wt[r.date] ? wt[r.date].reduce((a, b) => a + b, 0) / wt[r.date].length : null }));
  T.daily = { cols: dayCols, rows: dayRows };

  // ----- проходы -----
  const runCols = ['run_id', 'date', 'time', 'weekday', 'mode', 'duration_s', 'aborted', 'state_sleepy', 'state_energy', 'state_mood', 'state_stress', 'state_caffeine3h', 'state_noise', 'composite_z',
    ...Object.keys(DOMAINS).map(d => 'z_' + d), ...TESTS.flatMap(t => [`${t.id}_value`, `${t.id}_z`, `${t.id}_valid`])];
  const runRows = runs.map((r, i) => {
    const a = an.perRun[i], o = { run_id: r.startedAt, date: r.date, time: hhmm(r.startedAt), weekday: r.weekday, mode: r.mode, duration_s: Math.round(r.durationMs / 1000), aborted: r.aborted, composite_z: a.composite };
    for (const k of ['sleepy', 'energy', 'mood', 'stress', 'caffeine3h', 'noise']) o['state_' + k] = r.state?.[k] ?? null;
    for (const d of Object.keys(DOMAINS)) o['z_' + d] = a.domains[d] ?? null;
    for (const t of TESTS) { const x = r.tests[t.id]; o[`${t.id}_value`] = x && !x.skipped ? primaryShown(t.id, x.metrics) : null; o[`${t.id}_z`] = a.z[t.id] ?? null; o[`${t.id}_valid`] = x && !x.skipped ? x.ok : null; }
    return o;
  });
  T.runs = { cols: runCols, rows: runRows };

  // ----- метрики (длинный формат) и пробы -----
  const metricRows = [], trialRows = [];
  for (const r of runs) for (const [id, t] of Object.entries(r.tests)) {
    if (t.skipped) continue;
    for (const [k, v] of Object.entries(t.metrics || {})) {
      if (v !== null && typeof v === 'object') { for (const [c, x] of Object.entries(v)) { metricRows.push({ run_id: r.startedAt, date: r.date, test: id, metric: `${k}.${c}.n`, value: x.n, valid: t.ok }); metricRows.push({ run_id: r.startedAt, date: r.date, test: id, metric: `${k}.${c}.ok`, value: x.ok, valid: t.ok }); } }
      else metricRows.push({ run_id: r.startedAt, date: r.date, test: id, metric: k, value: v, valid: t.ok });
    }
    (t.trials || []).forEach((tr, i) => { for (const [k, v] of Object.entries(tr)) trialRows.push({ run_id: r.startedAt, date: r.date, test: id, trial: i + 1, field: k, value: v }); });
  }
  T.metrics = { cols: ['run_id', 'date', 'test', 'metric', 'value', 'valid'], rows: metricRows };
  T.trials = { cols: ['run_id', 'date', 'test', 'trial', 'field', 'value'], rows: trialRows };

  // ----- отметки, замеры, привычки, обучение -----
  const ciCols = ['date', 'slot', ...Object.keys(RATINGS), ...Object.keys(NUMBERS), 'bed', 'wake'];
  T.checkins = { cols: ciCols, rows: events.filter(e => e.type === 'checkin').map(e => ({ ...e.payload, slot: SLOTS[e.payload.slot]?.label ?? e.payload.slot })).sort((a, b) => a.date.localeCompare(b.date) || String(a.slot).localeCompare(String(b.slot))) };
  T.measures = { cols: ['date', 'time', 'kind', 'name', 'value', 'value2', 'unit'], rows: events.filter(e => e.type === 'measure').map(e => ({ date: e.payload.date, time: e.payload.time ?? '', kind: e.payload.kind, name: measureLabel(e.payload), value: e.payload.value, value2: e.payload.value2 ?? null, unit: e.payload.unit ?? '' })).sort((a, b) => a.date.localeCompare(b.date)) };
  const hnames = Object.fromEntries(events.filter(e => e.type === 'habit').map(e => [e.id, e.payload.name]));
  T.habits = { cols: ['date', 'habit', 'level'], rows: events.filter(e => e.type === 'habit_log').map(e => ({ date: e.payload.date, habit: hnames[e.payload.habitId] ?? '', level: e.payload.level })).sort((a, b) => a.date.localeCompare(b.date)) };
  T.learning = { cols: ['card', 'box', 'reps', 'lapses', 'first', 'last', 'due', 'recall_rate'], rows: statesOf(events).map(s => ({ card: s.card, box: s.box, reps: s.reps, lapses: s.lapses, first: s.first, last: s.last ?? '', due: s.due, recall_rate: s.hist?.length ? s.hist.filter(h => h[1] > 0).length / s.hist.length : null })) };
  T.lessons = { cols: ['date', 'track', 'lesson', 'minutes'], rows: events.filter(e => e.type === 'lesson').map(e => ({ date: e.payload.date, track: e.payload.track, lesson: e.payload.lesson, minutes: e.payload.minutes })).sort((a, b) => a.date.localeCompare(b.date)) };
  return { T, runs, an };
}

export const README = `Выгрузка для анализа — Life OS
================================

Что внутри (все файлы — таблицы CSV в UTF-8, разделитель — запятая, десятичный — точка):

daily.csv        — одна строка на день: результаты проверок (composite — общий результат, z_* — по областям; в σ относительно твоей же нормы),
                   отметки утром и вечером (сон, настроение, энергия, стресс, кофе, нагрузка и т. д.), число привычек и задач, вес.
daily_excel.csv  — то же самое для русского Excel (разделитель «;», запятая в числах).
test_runs.csv    — одна строка на прохождение проверки: дата, время, режим, самооценка перед проверкой (state_*), главные показатели каждого теста, z и достоверность.
test_metrics.csv — все метрики всех тестов в «длинном» виде (run_id, test, metric, value, valid).
test_trials.csv  — все отдельные пробы: время реакции в каждой попытке, ответы и т. д. (run_id, test, trial, field, value).
checkins.csv     — утренние и вечерние отметки.
measures.csv     — замеры здоровья (вес, давление, пульс и др.).
habits.csv       — отметки привычек по дням.
lessons.csv      — пройденные уроки; learning.csv — состояние карточек для повторения.
testruns.json    — исходные записи проверок без изменений.

Как читать:
 • run_id — время начала проверки в миллисекундах (уникальный номер).
 • σ (z) — на сколько обычных отклонений результат лучше (+) или хуже (−) твоей нормы за последние ~30 прохождений. Чем больше z, тем лучше, независимо от показателя
   (для времени реакции «быстрее» тоже даёт плюс). Первые 5 прохождений z не считается.
 • valid / ok = 0 — тест признан недостоверным (слишком быстро, слишком мало ответов); такие результаты не входят в норму.
 • d′ (dPrime) — различение сигнала и шума: чем больше, тем лучше. Помеха Струпа — разница времени при несовпадении и совпадении цвета и слова.
 • Показатели нужны для сравнения с собой во времени. Это не медицинская диагностика и не IQ.

Чего нет в выгрузке: тексты дневника и заметок, суммы расходов и доходов, пароли и ключи. Они остаются только в резервной копии.
Связи (сон ↔ результат и т. п.) — это наблюдения. Для выводов о причинах нужен эксперимент: меняй одну вещь на 1–2 недели и сравнивай.
`;

export function buildExport(events, now = Date.now()) {
  const { T, runs } = buildTables(events);
  const files = [{ name: 'README.txt', data: README }];
  const names = { daily: 'daily.csv', runs: 'test_runs.csv', metrics: 'test_metrics.csv', trials: 'test_trials.csv', checkins: 'checkins.csv', measures: 'measures.csv', habits: 'habits.csv', lessons: 'lessons.csv', learning: 'learning.csv' };
  for (const [k, name] of Object.entries(names)) files.push({ name, data: toCsv(T[k].cols, T[k].rows) });
  files.push({ name: 'daily_excel.csv', data: toCsvExcel(T.daily.cols, T.daily.rows) });
  files.push({ name: 'testruns.json', data: JSON.stringify(runs, null, 1) });
  return { files, zip: makeZip(files, now), tables: T };
}
