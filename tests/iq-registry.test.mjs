import test from 'node:test';
import assert from 'node:assert/strict';
import { TESTS, TEST_BY_ID, PLANS, singlePlan, validity, makeRun, makeRunEvent, runsOf, primaryOf, fmtPrimary, DOMAINS } from '../bt-core.js';
import { analyzeRuns } from '../bt-analytics.js';
import { buildTables } from '../bt-export.js';
import { TEST_GROUPS, WHAT, groupOf } from '../bt-what.js';
import { IQ_TESTS, IQ_STEPS } from '../iq-registry.js';

const NEW = ['matrices', 'seq12', 'verbal', 'rotation', 'corsi', 'stroop40', 'coding'];

test('новые тесты: все семь в реестре, у каждого область, главный показатель, описания метрик и параметры запуска', () => {
  assert.deepEqual(IQ_TESTS.map(t => t.id), NEW);
  for (const id of NEW) {
    const t = TEST_BY_ID[id];
    assert.ok(t, id);
    assert.ok(t.title && t.desc && t.minutes >= 1 && DOMAINS[t.domain], id);
    assert.ok(['higher', 'lower'].includes(t.primary.better) && t.primary.key in t.metrics, `${id}: главный показатель описан`);
    assert.ok(IQ_STEPS[id] && IQ_STEPS[id].id === id, `${id}: шаг запуска`);
    assert.deepEqual(singlePlan(id).steps.map(s => s.id), [id]);
  }
  assert.equal(new Set(TESTS.map(t => t.title)).size, TESTS.length, 'названия тестов не повторяются');
});

test('новые тесты: планы «Проверка логики» и «Память и скорость» состоят из существующих тестов', () => {
  assert.deepEqual(PLANS.logic.steps.map(s => s.id), ['matrices', 'seq12', 'verbal', 'rotation']);
  assert.deepEqual(PLANS.speed.steps.map(s => s.id), ['corsi', 'stroop40', 'coding']);
  for (const p of [PLANS.logic, PLANS.speed]) { assert.ok(p.title && p.about); for (const s of p.steps) assert.ok(TEST_BY_ID[s.id], s.id); }
  assert.equal(PLANS.quick.steps.some(s => NEW.includes(s.id)) || PLANS.full.steps.some(s => NEW.includes(s.id)), false, 'быстрая и полная проверки остались прежними');
});

test('новые тесты: «лишь бы пройти» не засчитывается', () => {
  for (const id of ['matrices', 'seq12', 'rotation']) { assert.equal(validity(id, { n: 3 }).ok, false); assert.equal(validity(id, { n: 12 }).ok, true); }
  assert.equal(validity('verbal', { n: 5 }).ok, false); assert.equal(validity('verbal', { n: 15 }).ok, true);
  assert.equal(validity('corsi', { attempts: 1 }).ok, false); assert.equal(validity('corsi', { attempts: 5, span: 4 }).ok, true);
  assert.equal(validity('stroop40', { n: 10, accuracy: 1 }).ok, false); assert.equal(validity('stroop40', { n: 40, accuracy: 0.4 }).ok, false); assert.equal(validity('stroop40', { n: 40, accuracy: 0.9 }).ok, true);
  assert.equal(validity('coding', { n: 5, accuracy: 1 }).ok, false); assert.equal(validity('coding', { n: 60, accuracy: 0.3 }).ok, false); assert.equal(validity('coding', { n: 60, accuracy: 0.9 }).ok, true);
  assert.equal(validity('reaction', { n: 5, median: 300, falseStarts: 0 }).ok, true, 'прежние тесты не изменились');
});

test('группы и пояснения: у каждого теста есть группа и «Что измеряет», все id известны', () => {
  const grouped = TEST_GROUPS.flatMap(g => g.tests);
  assert.equal(new Set(grouped).size, grouped.length, 'тест не входит в две группы');
  for (const t of TESTS) { assert.ok(grouped.includes(t.id), `${t.id} есть в группе`); assert.ok(WHAT[t.id]?.what?.length > 20, `${t.id}: что измеряет`); assert.ok(TEST_GROUPS.some(g => g.key === groupOf(t.id))); }
  for (const id of grouped) assert.ok(TEST_BY_ID[id], `в группе неизвестный тест ${id}`);
  for (const id of Object.keys(WHAT)) assert.ok(TEST_BY_ID[id], `пояснение к неизвестному тесту ${id}`);
  assert.match(TEST_GROUPS.find(g => g.key === 'logic').note, /не настоящий IQ-тест/);
  for (const id of ['matrices', 'seq12', 'verbal', 'rotation']) assert.match(WHAT[id].note, /не проверялись на других людях|Время не ограничено/);
});

test('новые тесты работают в общем пути: запись прохождения, аналитика по личной норме и выгрузка', () => {
  const t0 = Date.UTC(2026, 4, 1, 9);
  const events = [];
  for (let i = 0; i < 9; i++) {
    const m = { n: 12, correct: 6 + (i % 3), accuracy: 0.5, meanMs: 30000, score: 40 + i, maxScore: 78, maxLevel: 7 };
    const payload = makeRun({ mode: 'single:matrices', startedAt: t0 + i * 86400000, durationMs: 600000, results: { matrices: { metrics: m, ms: 600000, trials: [{ i: 0, level: 1, correct: true, rt: 4000 }, { i: 1, level: 2, rt: 9000 }] }, corsi: { metrics: { span: 4 + (i % 2), attempts: 6, correct: 4, score: 16 }, ms: 90000, trials: [] }, coding: { skipped: 'пропущено по желанию' } } });
    events.push(makeRunEvent(payload, t0 + i * 86400000));
  }
  const runs = runsOf(events), a = analyzeRuns(runs);
  assert.equal(a.perTest.matrices.series.length, 9); assert.ok(a.perTest.matrices.baseline, 'после пяти прохождений есть личная норма');
  assert.equal(a.perTest.coding.series.length, 0, 'пропущенный тест в ряд не попал');
  assert.equal(primaryOf('matrices', runs[0].tests.matrices.metrics), 6); assert.equal(fmtPrimary('corsi', runs[0].tests.corsi.metrics), '4');
  const { T } = buildTables(events);
  assert.ok(T.runs.cols.includes('matrices_value') && T.runs.cols.includes('corsi_z') && T.runs.cols.includes('coding_valid'));
  assert.equal(T.runs.rows[0].matrices_value, 6);
  assert.ok(T.metrics.rows.some(r => r.test === 'matrices' && r.metric === 'maxScore' && r.value === 78), 'все метрики попали в выгрузку');
  assert.ok(T.trials.rows.some(r => r.test === 'matrices' && r.field === 'level'), 'пробы попали в выгрузку');
});
