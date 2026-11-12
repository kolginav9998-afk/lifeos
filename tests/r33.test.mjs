import { APP_NAME } from '../config.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { weekReview } from '../review.js';
import { planReminders, EVENING_ID_BASE, atLocal } from '../reminders.js';
import { makeCheckin } from '../diary.js';
import { makeLessonDone, makeSrsEvent, trackById } from '../academy.js';
import { newState, grade } from '../srs.js';
import { makeRun, makeRunEvent } from '../bt-core.js';

const TODAY = '2026-11-10';
const NOW = new Date(2026, 10, 10, 8, 0).getTime();
const day = n => { const d = new Date(2026, 10, 10 + n, 12); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('недельный обзор: сон, активность, настроение и развитие за 7 дней', () => {
  const ev = [
    makeCheckin('m', day(0), { sleepHours: 7.5, mood: 4 }, '', NOW), makeCheckin('m', day(-1), { sleepHours: 6, mood: 2 }, '', NOW), makeCheckin('m', day(-2), { sleepHours: 8 }, '', NOW),
    makeCheckin('m', day(-9), { sleepHours: 3 }, '', NOW),                                   // вне недели
    makeCheckin('e', day(0), { exercise: 40, mood: 4 }, '', NOW), makeCheckin('e', day(-3), { exercise: 60 }, '', NOW),
  ];
  const en = trackById('english');
  ev.push(makeLessonDone(en, en.lessons[0], day(-1), NOW), makeLessonDone(en, en.lessons[1], day(-10), NOW));
  ev.push(makeSrsEvent({ ...grade(grade(newState('c:1', day(-1)), 'good', day(-1)), 'good', day(0)) }, NOW));
  ev.push(makeRunEvent(makeRun({ mode: 'quick', startedAt: new Date(2026, 10, 9, 9).getTime(), durationMs: 1000, results: { reaction: { metrics: { n: 5, median: 300, falseStarts: 0 }, trials: [] } } }), NOW));
  const r = weekReview(ev, TODAY);
  assert.equal(r.health.sleepDays, 3);
  assert.ok(Math.abs(r.health.sleepAvg - 7.1667) < 1e-3);
  assert.equal(r.health.sleepBest, 8); assert.equal(r.health.sleepWorst, 6);
  assert.equal(r.health.activityMinutes, 100); assert.equal(r.health.activityDays, 2); assert.equal(r.health.activityGoal, 150);
  assert.ok(Math.abs(r.health.moodAvg - 3) < 1e-9, `настроение ${r.health.moodAvg}`);   // день 0: (4+4)/2 = 4; день −1: 2 → среднее 3
  assert.equal(r.growth.lessons, 1); assert.equal(r.growth.reviews, 2); assert.equal(r.growth.tests, 1);
});
test('недельный обзор: пустые данные не ломаются', () => {
  const r = weekReview([], TODAY);
  assert.equal(r.health.sleepAvg, null); assert.equal(r.health.moodAvg, null); assert.equal(r.health.sleepBest, null);
  assert.equal(r.health.activityMinutes, 0); assert.deepEqual(r.growth, { lessons: 0, reviews: 0, tests: 0 });
});
test('напоминания: вечерняя отметка и повторение; по умолчанию выключено; если отметка уже есть — сегодня молчим', () => {
  const none = planReminders([], NOW, { taskHour: -1, habitHour: -1 });
  assert.equal(none.length, 0);
  const on = planReminders([], NOW, { taskHour: -1, habitHour: -1, eveningHour: 21 });
  assert.equal(on.length, 14);
  assert.equal(on[0].id, EVENING_ID_BASE); assert.equal(on[0].at, atLocal(TODAY, 21));
  assert.ok(on.every(x => x.title === APP_NAME && !/\d{2}:\d{2}/.test(x.body)));
  const marked = planReminders([makeCheckin('e', TODAY, { mood: 4 }, '', NOW)], NOW, { taskHour: -1, habitHour: -1, eveningHour: 21 });
  assert.equal(marked.length, 13); assert.equal(marked[0].id, EVENING_ID_BASE + 1);
  const late = planReminders([], new Date(2026, 10, 10, 22).getTime(), { taskHour: -1, habitHour: -1, eveningHour: 21 });
  assert.equal(late[0].id, EVENING_ID_BASE + 1, 'время уже прошло — сегодня не планируем');
});

import { breathPhase, makeBreath, INHALE_MS, EXHALE_MS } from '../breathing.js';
import { QUESTIONS, questionOfDay, onThisDay, makeDiary } from '../diary.js';
import { wordOfDay, TRACKS, cardsOfTrack } from '../academy.js';

test('дыхание 4–6: фазы цикла, отрицательное время, запись', () => {
  assert.deepEqual(breathPhase(0), { phase: 'in', leftMs: 4000, cycle: 1 });
  assert.deepEqual(breathPhase(3999), { phase: 'in', leftMs: 1, cycle: 1 });
  assert.deepEqual(breathPhase(4000), { phase: 'out', leftMs: 6000, cycle: 1 });
  assert.deepEqual(breathPhase(9999), { phase: 'out', leftMs: 1, cycle: 1 });
  assert.deepEqual(breathPhase(10000), { phase: 'in', leftMs: 4000, cycle: 2 });
  assert.equal(INHALE_MS + EXHALE_MS, 10000); assert.ok(EXHALE_MS > INHALE_MS, 'выдох длиннее вдоха');
  const b = makeBreath('2026-11-10', 301.4, 4, 2, 5);
  assert.equal(b.type, 'breath'); assert.deepEqual(b.payload, { date: '2026-11-10', seconds: 301, before: 4, after: 2 });
  assert.deepEqual(makeBreath('2026-11-10', 60, 9, null, 5).payload, { date: '2026-11-10', seconds: 60 }, 'неверные оценки отбрасываются');
});
test('вопрос дня идёт по кругу без повторов подряд; «в этот день» находит прошлые записи', () => {
  assert.ok(QUESTIONS.length >= 30 && new Set(QUESTIONS).size === QUESTIONS.length);
  const a = questionOfDay('2026-11-10'), b = questionOfDay('2026-11-11');
  assert.notEqual(a, b); assert.equal(a, questionOfDay('2026-11-10'));
  assert.equal(questionOfDay(`2026-11-${10 + 0}`), QUESTIONS[Math.floor(Date.UTC(2026, 10, 10) / 86400000) % QUESTIONS.length]);
  assert.throws(() => questionOfDay('нет'), /bad date/);
  const ev = [makeDiary('2025-11-10', { text: 'Год назад был важный день\nвторая строка' }, 1), makeDiary('2026-10-11', { highlight: 'месяц назад: главное' }, 1),
    makeDiary('2026-08-12', { text: 'ровно 90 дней назад: ' + 'x'.repeat(300) }, 1), makeDiary('2026-11-09', { text: 'вчера — не считается' }, 1)];
  const r = onThisDay(ev, '2026-11-10');
  assert.deepEqual(r.map(x => x.label), ['30 дней назад', '3 месяца назад', 'Год назад']);
  assert.equal(r[0].text, 'месяц назад: главное'); assert.ok(r[1].text.endsWith('…') && r[1].text.length <= 160);
  assert.equal(r[2].text, 'Год назад был важный день');
  assert.deepEqual(onThisDay([], '2026-11-10'), []);
  assert.equal(onThisDay(ev, '2026-11-10', 1).length, 1);
  assert.deepEqual(onThisDay([makeDiary('2023-02-28', { text: 'x' }, 1)], '2024-02-29').map(x => x.label), [], 'високосный день: года без 29 февраля пропускаются');
});
test('слово дня: стабильно в пределах дня, меняется со днём, есть для английского и иврита', () => {
  for (const id of ['english', 'hebrew']) {
    const w = wordOfDay('2026-11-10', id), again = wordOfDay('2026-11-10', id), next = wordOfDay('2026-11-11', id);
    assert.deepEqual(w, again); assert.notEqual(w.front, next.front);
    assert.ok(w.front && w.back && w.title);
    assert.ok(cardsOfTrack(TRACKS.find(t => t.id === id)).some(c => c.kind === 'deck' && c.q === w.front), 'слово из колоды курса');
  }
  assert.equal(wordOfDay('2026-11-10', 'health').front.length > 0, true);
  assert.equal(wordOfDay('2026-11-10', 'нет'), null);
  const seen = new Set(Array.from({ length: 60 }, (_, i) => wordOfDay(`2026-12-${String(1 + (i % 28)).padStart(2, '0')}`, 'english').front));
  assert.ok(seen.size >= 28, 'за 28 дней слова не повторяются');
});

import { makeRng } from '../stats.js';
import { METRICS, PRESETS, SAFETY, makeOrder, makeExperiment, phaseOf, stateOf, endDate, evaluate, activeExperiments, experimentsOf } from '../experiments.js';

const exp = (over = {}, seed = 3) => makeExperiment({ title: 'Кофе до 14:00', change: 'Последний кофе до 14:00', metric: 'sleepQuality', days: 28, startDate: '2026-10-01', ...over }, { rng: makeRng(seed), now: 1, id: 'exp:t1' });

test('эксперименты: порядок фаз сбалансирован и случаен, проверка параметров', () => {
  for (let s = 1; s <= 20; s++) { const o = makeOrder(4, makeRng(s)); assert.equal(o.filter(x => x === 'A').length, 2); assert.equal(o.filter(x => x === 'B').length, 2); }
  const orders = new Set(Array.from({ length: 30 }, (_, s) => makeOrder(2, makeRng(s)).join('')));
  assert.deepEqual([...orders].sort(), ['AB', 'BA'], 'порядок действительно перемешивается');
  assert.throws(() => makeOrder(3, makeRng(1)), /bad blocks/);
  const e = exp();
  assert.equal(e.type, 'experiment'); assert.equal(e.payload.order.length, 4); assert.equal(e.payload.blockDays, 7); assert.equal(endDate(e.payload), '2026-10-28');
  assert.throws(() => exp({ title: ' ' }), /Назови/); assert.throws(() => exp({ change: '' }), /Опиши/); assert.throws(() => exp({ metric: 'x' }), /показатель/);
  assert.throws(() => exp({ days: 10 }), /14 или 28/); assert.throws(() => exp({ startDate: '2026-02-30' }), /Дата/);
  for (const pr of PRESETS) { assert.ok(METRICS[pr.metric], pr.id); assert.ok([14, 28].includes(pr.days)); }
  assert.match(SAFETY, /лекарства/);
});
test('эксперименты: фаза дня, состояния и отмена', () => {
  const e = exp({ days: 14 }, 5).payload;
  const [first, second] = e.order;
  assert.equal(phaseOf(e, '2026-10-01'), first); assert.equal(phaseOf(e, '2026-10-07'), first);
  assert.equal(phaseOf(e, '2026-10-08'), second); assert.equal(phaseOf(e, '2026-10-14'), second);
  assert.equal(phaseOf(e, '2026-10-15'), null); assert.equal(phaseOf(e, '2026-09-30'), null);
  assert.equal(stateOf(e, '2026-09-30'), 'planned'); assert.equal(stateOf(e, '2026-10-01'), 'active'); assert.equal(stateOf(e, '2026-10-14'), 'active'); assert.equal(stateOf(e, '2026-10-15'), 'ended');
  assert.equal(stateOf({ ...e, cancelled: true }, '2026-10-05'), 'cancelled');
  const evs = [exp({}, 1), { ...exp({ startDate: '2026-08-01' }, 2), id: 'exp:old' }];
  assert.equal(experimentsOf(evs)[0].payload.startDate, '2026-10-01');
  assert.deepEqual(activeExperiments(evs, '2026-10-05').map(x => x.id), ['exp:t1']);
});
function fill(p, effect, noise, seed, upTo = '2026-10-28') {
  const r = makeRng(seed), rows = [];
  for (let d = new Date(2026, 9, 1); ; d.setDate(d.getDate() + 1)) {
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (date > upTo) break;
    rows.push({ date, sleepQuality: 3 + (phaseOf(p, date) === 'B' ? effect : 0) + (r() - 0.5) * noise });
  }
  return rows;
}
test('эксперименты: оценка — эффект находится, пустышка не находится, мало данных честно признаётся', () => {
  const p = exp({}, 4).payload;
  const strong = evaluate(p, fill(p, 1, 0.8, 1), '2026-10-28');
  assert.equal(strong.verdict, 'better'); assert.ok(strong.diff > 0.7 && strong.p < 0.05, JSON.stringify(strong));
  assert.match(strong.text, /Похоже, что в фазе B/); assert.match(strong.text, /подсказка/);
  const worse = evaluate(p, fill(p, -1, 0.8, 2), '2026-10-28');
  assert.equal(worse.verdict, 'worse');
  const nothing = evaluate(p, fill(p, 0, 0.8, 3), '2026-10-28');
  assert.ok(['none', 'unclear'].includes(nothing.verdict), nothing.verdict);
  assert.notEqual(nothing.verdict, 'better');
  const early = evaluate(p, fill(p, 1, 0.5, 1, '2026-10-04'), '2026-10-04');
  assert.equal(early.verdict, 'insufficient'); assert.match(early.text, /нужно хотя бы по 5/);
  assert.equal(evaluate(p, [], '2026-10-28').verdict, 'insufficient');
  // для показателя «чем меньше, тем лучше» рост — это хуже
  const stress = exp({ metric: 'stressEvening' }, 4).payload;
  const rows = fill(stress, 1, 0.8, 5).map(r => ({ date: r.date, stressEvening: r.sleepQuality }));
  assert.equal(evaluate(stress, rows, '2026-10-28').verdict, 'worse');
  // дни после «сегодня» и без данных не учитываются
  const partial = fill(p, 1, 0.8, 1).map((r, i) => (i % 3 === 0 ? { date: r.date } : r));
  assert.ok(evaluate(p, partial, '2026-10-20').nA + evaluate(p, partial, '2026-10-20').nB < 20);
});
test('эксперименты: оценка воспроизводима', () => {
  const p = exp({}, 4).payload, rows = fill(p, 0.5, 1, 9);
  assert.deepEqual(evaluate(p, rows, '2026-10-28'), evaluate(p, rows, '2026-10-28'));
});
