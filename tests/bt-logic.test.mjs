import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../stats.js';
import * as L from '../bt-logic.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('реакция: медиана, разброс, ложные старты не считаются временем', () => {
  const r = L.scoreReaction([{ rt: 300 }, { rt: 280 }, { rt: 600 }, { rt: 310 }, { falseStart: true }, { rt: 290 }]);
  assert.deepEqual([r.n, r.median, r.best, r.lapses, r.falseStarts], [5, 300, 280, 1, 1]);
  assert.equal(r.mean, 356); assert.ok(r.sd > 100);
  assert.deepEqual(L.scoreReaction([]), { n: 0, median: null, mean: null, sd: null, best: null, lapses: 0, falseStarts: 0 });
});

test('go/no-go: доля «не жми», не более 3 подряд, начинается с «жми»; подсчёт ошибок и d′', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const seq = L.makeGoNoGo(makeRng(seed), 30);
    assert.equal(seq.length, 30); assert.equal(seq.filter(g => !g).length, 8, 'ровно 8 из 30 (≈25%)');
    assert.equal(seq[0], true);
    let run = 0, maxRun = 0; for (const g of seq) { run = g ? 0 : run + 1; maxRun = Math.max(maxRun, run); }
    assert.ok(maxRun <= 3, `серия ${maxRun} при seed ${seed}`);
  }
  const trials = [...Array(6).fill(0).map((_, i) => ({ go: true, responded: i < 5, rt: 300 + i * 10 })), ...Array(2).fill(0).map((_, i) => ({ go: false, responded: i === 0 }))];
  const s = L.scoreGoNoGo(trials);
  assert.deepEqual([s.hits, s.omissions, s.commissions, s.correctRejections], [5, 1, 1, 1]);
  assert.equal(s.inhibition, 0.5); assert.equal(s.accuracy, 0.75); assert.equal(s.medianRT, 320);
  assert.ok(Number.isFinite(s.dPrime));
});

test('Струп: половина совпадающих, слово не равно цвету в несовпадающих, нет повторов подряд; интерференция', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const t = L.makeStroop(makeRng(seed), 24);
    assert.equal(t.filter(x => x.congruent).length, 12);
    assert.ok(t.every(x => x.congruent === (x.word === x.ink)));
    for (let i = 1; i < t.length; i++) assert.ok(!(t[i].word === t[i - 1].word && t[i].ink === t[i - 1].ink), 'нет одинаковых подряд');
  }
  const trials = [{ congruent: true, correct: true, rt: 500 }, { congruent: true, correct: true, rt: 600 }, { congruent: false, correct: true, rt: 800 }, { congruent: false, correct: false, rt: 400 }, { congruent: false, correct: true, rt: 900 }];
  const s = L.scoreStroop(trials);
  assert.deepEqual([s.meanCongruent, s.meanIncongruent, s.interference, s.errorsIncongruent, s.correct], [550, 850, 300, 1, 4]);
  assert.equal(s.accuracy, 0.8);
  assert.equal(L.scoreStroop([{ congruent: true, correct: true, rt: 1 }]).interference, null);
});

test('цифровая память: цифры без повторов подряд; процедура: рост, две неудачи подряд, предел, обратный порядок', () => {
  const rng = makeRng(5);
  for (let len = 2; len <= 12; len++) { const d = L.makeDigits(rng, len); assert.equal(d.length, len); for (let i = 1; i < d.length; i++) assert.notEqual(d[i], d[i - 1]); assert.ok(d.every(x => x >= 0 && x <= 9)); }
  const p = new L.SpanProcedure({ start: 3 });
  assert.equal(p.current(), 3);
  p.record(true); assert.equal(p.current(), 4);
  p.record(false); assert.equal(p.current(), 4, 'вторая попытка на той же длине'); assert.equal(p.finished, false);
  p.record(true); assert.equal(p.current(), 5, 'успех сбрасывает неудачи');
  p.record(false); p.record(false);
  assert.equal(p.finished, true); assert.equal(p.best, 4); assert.equal(p.current(), null);
  const cap = new L.SpanProcedure({ start: 11, max: 12 }); cap.record(true); cap.record(true);
  assert.equal(cap.finished, true); assert.equal(cap.best, 12);
  assert.equal(L.checkSpan([1, 2, 3], [1, 2, 3], false), true); assert.equal(L.checkSpan([1, 2, 3], [3, 2, 1], true), true);
  assert.equal(L.checkSpan([1, 2, 3], [1, 2, 3], true), false); assert.equal(L.checkSpan([1, 2, 3], [1, 2], false), false);
  const f = new L.SpanProcedure({ start: 3 }); f.record(true); f.record(true); const b = new L.SpanProcedure({ start: 3 }); b.record(true);
  assert.deepEqual(L.scoreSpan(f, b), { forward: 4, backward: 3, total: 7, attempts: 3 });
});

test('слова: пул без повторов, выбор исключает заданные, распознавание содержит свои и новые, d′', () => {
  assert.equal(new Set(L.WORD_POOL).size, L.WORD_POOL.length, 'слова в пуле не повторяются');
  assert.ok(L.WORD_POOL.length >= 150 && L.WORD_POOL.every(w => /^[а-яё]+$/.test(w) && w.length >= 2));
  const rng = makeRng(3);
  const learn = L.pickWords(rng, 10);
  assert.equal(new Set(learn).size, 10);
  const other = L.pickWords(rng, 10, learn);
  assert.ok(other.every(w => !learn.includes(w)));
  const rec = L.makeRecognition(rng, learn, ['чайник', 'шкаф']);
  assert.equal(rec.length, 20); assert.equal(rec.filter(x => x.old).length, 10);
  const olds = rec.filter(x => x.old).map(x => x.word).sort(); assert.deepEqual(olds, [...learn].sort());
  assert.ok(rec.filter(x => !x.old).every(x => !learn.includes(x.word) && !['чайник', 'шкаф'].includes(x.word)));
  const perfect = L.scoreRecognition(rec.map(x => ({ ...x, said: x.old })));
  assert.deepEqual([perfect.hits, perfect.falseAlarms, perfect.accuracy], [10, 0, 1]);
  const guess = L.scoreRecognition(rec.map(x => ({ ...x, said: true })));
  assert.deepEqual([guess.hits, guess.falseAlarms, guess.accuracy], [10, 10, 0.5]); near(guess.dPrime, 0, 1e-9);
  assert.ok(perfect.dPrime > 2.5 && guess.dPrime < perfect.dPrime);
});

test('счёт: ответы верны на всех уровнях, ответ неотрицателен, адаптация уровня', () => {
  const rng = makeRng(11);
  const calc = text => { const t = text.replace('×', '*').replace('÷', '/').replace('−', '-'); return Function(`"use strict";return (${t})`)(); };   // только в тесте
  for (let level = 1; level <= 5; level++) for (let i = 0; i < 300; i++) {
    const p = L.makeProblem(rng, level);
    assert.equal(calc(p.text), p.answer, p.text);
    assert.ok(Number.isInteger(p.answer) && p.answer >= 0, p.text);
    assert.equal(p.level, level);
  }
  assert.equal(L.makeProblem(rng, 99).level, 5); assert.equal(L.makeProblem(rng, -3).level, 1);
  const a = new L.AdaptiveLevel(2);
  assert.equal(a.update(true, 1000), 3); assert.equal(a.update(true, 99999), 3, 'верно, но медленно — без повышения'); assert.equal(a.update(false, 500), 2);
  assert.equal(a.max, 3);
  for (let i = 0; i < 10; i++) a.update(true, 1);
  assert.equal(a.level, 5);
  const s = L.scoreMath([{ correct: true, rt: 2000, level: 2 }, { correct: true, rt: 4000, level: 3 }, { correct: false, rt: 6000, level: 3 }]);
  assert.deepEqual([s.correct, s.accuracy, s.meanMs, s.maxLevel], [2, 0.667, 3000, 3]);
  assert.equal(s.perMinute, 10);
});

test('ряды: ответ следует правилу ряда, варианты уникальны и содержат ответ, уровень ограничен', () => {
  const rng = makeRng(21);
  for (let level = 1; level <= 5; level++) for (let i = 0; i < 200; i++) {
    const s = L.makeSeries(rng, level);
    assert.equal(s.terms.length, 5);
    assert.equal(new Set(s.options).size, 4); assert.ok(s.options.includes(s.answer));
    assert.ok(s.options.every(Number.isInteger));
    const t = [...s.terms, s.answer];
    // проверка правила по описанию
    if (s.rule.startsWith('прибавляем ')) { const d = t[1] - t[0]; assert.ok(t.every((v, k) => k === 0 || v - t[k - 1] === d)); }
    else if (s.rule.startsWith('умножаем')) { const r = t[1] / t[0]; assert.ok(t.every((v, k) => k === 0 || v === t[k - 1] * r)); }
    else if (s.rule === 'квадраты чисел') { const d2 = t.map((v, k) => (k ? v - t[k - 1] : 0)).slice(1); assert.ok(d2.every((v, k) => k === 0 || v - d2[k - 1] === 2)); }
    else if (s.rule === 'разность растёт на 1') { const d = t.map((v, k) => (k ? v - t[k - 1] : 0)).slice(1); assert.ok(d.every((v, k) => k === 0 || v - d[k - 1] === 1)); }
    else if (s.rule.startsWith('каждое число')) assert.ok(t.every((v, k) => k < 2 || v === t[k - 1] + t[k - 2]));
    else if (s.rule === 'прибавляемое удваивается') { const d = t.map((v, k) => (k ? v - t[k - 1] : 0)).slice(1); assert.ok(d.every((v, k) => k === 0 || v === 2 * d[k - 1])); }
    else if (s.rule === 'кубы чисел') assert.deepEqual(t, [1, 8, 27, 64, 125, 216]);
    else if (s.rule === 'n·(n+1)') { const d = t.map((v, k) => (k ? v - t[k - 1] : 0)).slice(1); assert.ok(d.every((v, k) => k === 0 || v - d[k - 1] === 2)); }
    else if (s.rule === 'два чередующихся ряда') { const odd = t.filter((_, k) => k % 2 === 0), even = t.filter((_, k) => k % 2 === 1); assert.ok(odd.every((v, k) => k === 0 || v - odd[k - 1] === odd[1] - odd[0])); assert.ok(even.every((v, k) => k === 0 || v - even[k - 1] === even[1] - even[0])); }
    else assert.fail('неизвестное правило ' + s.rule);
  }
  assert.equal(L.makeSeries(rng, 99).level, 5);
  const sc = L.scoreSeries([{ correct: true, rt: 3000, level: 1 }, { correct: true, rt: 5000, level: 3 }, { correct: false, rt: 9000, level: 4 }]);
  assert.deepEqual([sc.correct, sc.accuracy, sc.meanMs, sc.score], [2, 0.667, 4000, 4]);
});

test('Шульте: перестановка 1..N; темп и усталость', () => {
  const t = L.makeSchulte(makeRng(8)); assert.deepEqual([...t].sort((a, b) => a - b), Array.from({ length: 25 }, (_, i) => i + 1));
  assert.notDeepEqual(t, Array.from({ length: 25 }, (_, i) => i + 1));
  const times = Array.from({ length: 10 }, (_, i) => (i + 1) * 1000);                     // ровный темп: 1 с на число
  assert.deepEqual(L.scoreSchulte({ times, errors: 2 }), { n: 10, errors: 2, totalMs: 10000, meanPerNumber: 1000, fatigue: 1 });
  const slowing = [1000, 2000, 3000, 4000, 5000, 7000, 9000, 11000, 13000, 15000];
  assert.equal(L.scoreSchulte({ times: slowing, errors: 0 }).fatigue, 2, 'вторая половина вдвое медленнее');
  assert.deepEqual(L.scoreSchulte({ times: [], errors: 0 }), { n: 0, errors: 0, totalMs: null, meanPerNumber: null, fatigue: null });
});

test('чувство времени: ошибка и смещение (торопишься/тянешь)', () => {
  const s = L.scoreTime([{ targetMs: 5000, actualMs: 4500 }, { targetMs: 10000, actualMs: 9000 }, { targetMs: 15000, actualMs: 15600 }]);
  assert.deepEqual([s.meanAbsErrorMs, s.biasMs], [700, -300]);
  near(s.meanAbsErrorRel, 0.08);
  assert.equal(L.scoreTime([]).meanAbsErrorMs, null);
});

test('повторение: точность и разбивка по темам', () => {
  const s = L.scoreRecall([{ correct: true, rt: 2000, category: 'Иврит' }, { correct: false, rt: 4000, category: 'Иврит' }, { correct: true, rt: 3000, category: 'ИИ' }]);
  assert.deepEqual([s.n, s.correct, s.accuracy, s.meanMs], [3, 2, 0.667, 3000]);
  assert.deepEqual(s.byCategory, { Иврит: { n: 2, ok: 1 }, ИИ: { n: 1, ok: 1 } });
});
