import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../stats.js';
import { TESTS, TEST_BY_ID, PLANS, singlePlan, primaryOf, primaryShown, fmtPrimary, fmtMetric, fmtNum, validity, makeRun, makeRunEvent, runId, runsOf, packTrials, cleanState } from '../bt-core.js';
import { seriesOf, zSeries, analyzeRuns, dailyRows, correlations, fdr, groupDiff, timeOfDay, insights, MIN_BASELINE } from '../bt-analytics.js';
import { makeCheckin } from '../diary.js';

const DAY = 86400000;
const T0 = new Date(2026, 8, 1, 9, 0).getTime();          // 1 сентября 2026, 9:00 по местному времени
const iso = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// Метрики теста с заданным «качеством» (чем выше q, тем лучше результат).
function metrics(q) {
  return {
    reaction: { n: 5, median: Math.round(360 - 20 * q), mean: 380, sd: 40, best: 300, lapses: 0, falseStarts: 0 },
    gonogo: { n: 16, hits: 11, omissions: 1, commissions: 1, correctRejections: 3, accuracy: 0.87, inhibition: 0.75, medianRT: 400, dPrime: +(1.5 + 0.3 * q).toFixed(2) },
    stroop: { n: 12, correct: 11, accuracy: 0.92, meanCongruent: 700, meanIncongruent: 900, interference: Math.round(220 - 15 * q), errorsIncongruent: 1 },
    digits: { forward: 6, backward: 4, total: Math.round(10 + q), attempts: 8 },
    math: { n: 12, correct: 10, accuracy: 0.83, meanMs: 3000, perMinute: +(9 + q).toFixed(1), maxLevel: 3 },
    recall: { n: 6, correct: 5, accuracy: Math.min(1, 0.7 + 0.05 * q), meanMs: 4000, byCategory: { english: { n: 3, ok: 3 }, hebrew: { n: 3, ok: 1 } } },
  };
}
function run(i, q, { hour = 9, day = i, state = null } = {}) {
  const startedAt = T0 + day * DAY + (hour - 9) * 3600000;
  const m = metrics(q), results = {};
  for (const [id, mm] of Object.entries(m)) results[id] = { metrics: mm, ms: 30000, trials: [] };
  return makeRun({ mode: 'quick', startedAt, durationMs: 300000, state, results });
}
const ev = payload => makeRunEvent(payload, payload.startedAt);
const rng = makeRng(2024);
const noise = s => (rng() - 0.5) * s;

test('реестр: 11 тестов, у каждого главный показатель и описания метрик', () => {
  assert.equal(TESTS.length, 11);
  for (const t of TESTS) {
    assert.ok(t.title && t.desc && t.domain && t.primary.key && ['higher', 'lower'].includes(t.primary.better), t.id);
    assert.ok(t.primary.key in t.metrics, `${t.id}: главный показатель описан`);
  }
  assert.equal(new Set(TESTS.map(t => t.id)).size, 11);
});
test('планы: быстрая и полная; слова запоминаются в начале и проверяются в конце', () => {
  for (const p of [PLANS.quick, PLANS.full]) {
    assert.equal(p.steps[0].id, 'wordsLearn'); assert.equal(p.steps.at(-1).id, 'wordsRecall');
    for (const s of p.steps) assert.ok(['wordsLearn', 'wordsRecall', ...TESTS.map(t => t.id)].includes(s.id), s.id);
  }
  assert.ok(PLANS.full.steps.length > PLANS.quick.steps.length);
  assert.deepEqual(singlePlan('stroop').steps.map(s => s.id), ['stroop']);
  assert.deepEqual(singlePlan('words').steps.map(s => s.id), ['wordsLearn', 'digits', 'wordsRecall']);
  assert.throws(() => singlePlan('нет'), /unknown/);
});
test('форматирование: запятая, проценты, пустые значения', () => {
  assert.equal(fmtNum(1.234, 2), '1,23'); assert.equal(fmtNum(NaN), '—'); assert.equal(fmtNum(300), '300');
  assert.equal(fmtPrimary('recall', { accuracy: 0.8333 }), '83 %');
  assert.equal(fmtPrimary('reaction', { median: 312 }), '312 мс');
  assert.equal(fmtPrimary('time', { meanAbsErrorRel: 0.123 }), '12,3 %');
  assert.equal(fmtMetric('recall', 'accuracy', 0.5), '50%');
  assert.equal(fmtMetric('stroop', 'n', null), '—');
  assert.equal(primaryOf('digits', { total: 11 }), 11); assert.equal(primaryShown('recall', { accuracy: 0.5 }), 50);
  assert.equal(primaryOf('digits', {}), null);
});
test('достоверность: слишком быстрая реакция, мало ответов, случайные ответы', () => {
  assert.equal(validity('reaction', { n: 5, median: 250, falseStarts: 0 }).ok, true);
  assert.equal(validity('reaction', { n: 5, median: 60, falseStarts: 0 }).ok, false);
  assert.equal(validity('reaction', { n: 2, median: 250, falseStarts: 0 }).ok, false);
  assert.equal(validity('reaction', { n: 5, median: 250, falseStarts: 9 }).ok, false);
  assert.equal(validity('stroop', { n: 12, accuracy: 0.3 }).ok, false);
  assert.equal(validity('digits', { forward: 1 }).ok, false);
  assert.equal(validity('schulte', { n: 25 }).ok, true);
  assert.equal(validity('gonogo', { n: 16, hits: 3, omissions: 9 }).ok, false);
  assert.equal(validity('math', null).ok, false);
});
test('запись: структура, пропущенные тесты, компактные пробы, идентификатор', () => {
  const r = makeRun({ mode: 'quick', startedAt: T0, durationMs: 123456.7, state: cleanState({ sleepy: 2, energy: 9, noise: true, x: 1 }),
    results: { reaction: { metrics: metrics(0).reaction, ms: 5000.4, trials: [{ rt: 301.23456, falseStart: false }, { rt: 280, falseStart: true }] }, recall: { skipped: 'нет карточек' } } });
  assert.equal(r.date, iso(T0)); assert.equal(r.hour, 9); assert.equal(r.mode, 'quick'); assert.equal(r.durationMs, 123457);
  assert.deepEqual(r.state, { sleepy: 2, noise: true });
  assert.deepEqual(r.tests.reaction.trials, [{ rt: 301.235 }, { rt: 280, falseStart: 1 }]);
  assert.equal(r.tests.recall.skipped, 'нет карточек');
  assert.equal(r.tests.reaction.ok, true);
  const e = makeRunEvent(r, 5);
  assert.equal(e.type, 'testrun'); assert.equal(e.id, runId(T0)); assert.deepEqual(runsOf([e, { type: 'x', payload: {} }]).map(x => x.startedAt), [T0]);
  assert.equal(cleanState({ sleepy: 9 }), null); assert.equal(cleanState(null), null);
  assert.deepEqual(packTrials([{ a: null, b: 1.00004, c: true }]), [{ b: 1, c: 1 }]);
});

test('ряды: недостоверные и пропущенные тесты не попадают; z считается по прежним результатам', () => {
  const runs = [];
  for (let i = 0; i < 12; i++) runs.push(run(i, 0 + noise(0.2)));
  runs[3].tests.reaction = { metrics: { n: 5, median: 50, falseStarts: 0 }, ok: false, why: 'x' };
  runs[4].tests.reaction = { skipped: 'нет' };
  const s = seriesOf(runs, 'reaction');
  assert.equal(s.length, 10);
  const z = zSeries(runs, 'reaction');
  assert.equal(z.slice(0, MIN_BASELINE).every(p => p.z === null), true, 'без нормы z не считаем');
  assert.ok(z.slice(MIN_BASELINE).every(p => Math.abs(p.z) < 4));
  // направление: для «чем меньше — тем лучше» быстрая реакция даёт положительный z
  const fast = [...runs, run(12, 4)];
  const zf = zSeries(fast, 'reaction').at(-1).z;
  assert.ok(zf > 1, `быстрая реакция должна давать положительный z, получили ${zf}`);
  const slow = [...runs, run(12, -4)];
  assert.ok(zSeries(slow, 'reaction').at(-1).z < -1);
});
test('анализ: общий результат считается при данных минимум по трём областям; норма и последний результат', () => {
  const runs = [];
  for (let i = 0; i < 14; i++) runs.push(run(i, 0 + noise(0.3)));
  runs.push(run(14, 3));
  const an = analyzeRuns(runs);
  assert.ok(an.perRun.slice(0, MIN_BASELINE).every(r => r.composite === null));
  const last = an.perRun.at(-1);
  assert.ok(last.composite > 1, `композит ${last.composite}`);
  assert.ok(Object.keys(last.domains).length >= 4);
  assert.equal(an.perTest.reaction.latest.value, 300);
  assert.ok(an.perTest.reaction.baseline.n >= MIN_BASELINE);
  assert.ok(Math.abs(an.perTest.reaction.baseline.median - 360) < 15, 'норма — медиана прежних, в исходных единицах');
});

test('связи: сон определяет результат — связь находится; сравнение 7+ часов; без связи — не находится', () => {
  const events = [], rngS = makeRng(7);
  for (let i = 0; i < 40; i++) {
    const sleep = 5 + rngS() * 4;                                       // 5..9 ч
    const q = (sleep - 7) * 1.5 + (rngS() - 0.5) * 1.2;
    events.push(ev(run(i, q)));
    events.push(makeCheckin('m', iso(T0 + i * DAY), { sleepHours: Math.round(sleep * 4) / 4 }, '', T0 + i * DAY));
  }
  const rows = dailyRows(events);
  const cors = correlations(rows);
  const top = cors[0];
  assert.equal(top.x, 'sleepHours'); assert.ok(top.rho > 0.6, `rho=${top.rho}`); assert.ok(top.q < 0.05);
  const g = groupDiff(rows, 'sleepHours', 7);
  assert.ok(g.diff > 0.5, `diff=${g.diff}`); assert.ok(g.nHi >= 5 && g.nLo >= 5);
  const ins = insights(events, T0 + 41 * DAY);
  const rel = ins.find(x => x.id === 'rel-sleepHours-composite');
  assert.ok(rel, 'подсказка про сон найдена');
  assert.match(rel.text, /не доказанная причина/); assert.match(rel.text, /7 часов/);

  // контроль ложных срабатываний: независимые данные
  const nul = [], rr = makeRng(99);
  for (let i = 0; i < 40; i++) {
    nul.push(ev(run(i, (rr() - 0.5) * 3)));
    nul.push(makeCheckin('m', iso(T0 + i * DAY), { sleepHours: Math.round((5 + rr() * 4) * 4) / 4 }, '', T0 + i * DAY));
    nul.push(makeCheckin('e', iso(T0 + i * DAY), { caffeine: Math.floor(rr() * 5), exercise: Math.floor(rr() * 60) }, '', T0 + i * DAY));
  }
  const nulCors = correlations(dailyRows(nul)).filter(c => c.q <= 0.25 && Math.abs(c.rho) >= 0.3);
  assert.equal(nulCors.length, 0, `ложные связи: ${JSON.stringify(nulCors.map(c => [c.x, c.y, c.rho, c.q]))}`);
});
test('поправка FDR: монотонность и границы', () => {
  const q = fdr([0.001, 0.01, 0.04, 0.5, 0.9]);
  assert.ok(q.every(v => v >= 0 && v <= 1));
  assert.ok(q[0] <= q[1] && q[1] <= q[2]);
  assert.ok(Math.abs(q[0] - 0.005) < 1e-9);
  assert.deepEqual(fdr([]), []);
});
test('подсказки: пусто, мало данных, плохой день, тренд, время суток, слабый курс, недостоверность', () => {
  assert.equal(insights([], T0)[0].id, 'empty');
  const few = [0, 1, 2].map(i => ev(run(i, 0)));
  assert.ok(insights(few, T0).some(x => x.id === 'need-more'));

  const evs = [];
  const rr = makeRng(5);
  for (let i = 0; i < 16; i++) evs.push(ev(run(i, (rr() - 0.5) * 0.5, { hour: 9 })));
  evs.push(ev(run(16, -4, { hour: 9, state: { sleepy: 5 } })));
  const ins = insights(evs, T0 + 20 * DAY);
  const latest = ins.find(x => x.id === 'latest');
  assert.equal(latest.kind, 'warn'); assert.match(latest.title, /ниже обычного/);
  const an = ins.find(x => x.id.startsWith('anomaly-'));
  assert.ok(an, 'отклонение отдельного теста'); assert.match(an.text, /сонливость/);

  // растущий тренд
  const up = [];
  for (let i = 0; i < 20; i++) up.push(ev(run(i, i * 0.25 + (rr() - 0.5) * 0.4)));
  assert.ok(insights(up, T0 + 30 * DAY).some(x => x.id === 'trend' && x.kind === 'good'));

  // утро лучше вечера
  const tod = [];
  for (let i = 0; i < 20; i++) tod.push(ev(run(i, i % 2 === 0 ? 2 + (rr() - 0.5) * 0.3 : -2 + (rr() - 0.5) * 0.3, { hour: i % 2 === 0 ? 8 : 20 })));
  const pts = timeOfDay(analyzeRuns(runsOf(tod)).perRun);
  assert.equal(pts.length, 2);
  const todIns = insights(tod, T0 + 30 * DAY).find(x => x.id === 'time-of-day');
  assert.ok(todIns && /утром/.test(todIns.title), JSON.stringify(todIns));

  // слабый курс
  const weak = insights(evs, T0 + 20 * DAY).find(x => x.id === 'weak-course');
  assert.ok(weak && /hebrew/.test(weak.text));

  // недостоверные тесты
  const sloppy = [];
  for (let i = 0; i < 6; i++) { const r = run(i, 0); for (const t of Object.values(r.tests)) { t.ok = false; t.why = 'x'; } sloppy.push(ev(r)); }
  assert.ok(insights(sloppy, T0 + 10 * DAY).some(x => x.id === 'validity'));
});
test('подсказки не содержат медицинских утверждений', () => {
  const evs = [];
  for (let i = 0; i < 30; i++) evs.push(ev(run(i, (i % 5) - 2)));
  const all = JSON.stringify(insights(evs, T0 + 40 * DAY));
  for (const bad of ['диагноз', 'болезн', 'лечи', 'депресс', 'СДВГ', 'деменци']) assert.ok(!all.toLowerCase().includes(bad.toLowerCase()), bad);
});
