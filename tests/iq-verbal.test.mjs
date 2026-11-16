import test from 'node:test';
import assert from 'node:assert/strict';
import { BANK, bankSize, evalSets, evalProp, evalSyl, evalOrder, evalCalendar, expectedAnswer, makeVerbalSet, VERBAL_COUNT, VERBAL_PLAN, SYL_OPTIONS, CANNOT, WEEK, KIND_LABEL } from '../iq-verbal.js';

const SEEDS = Array.from({ length: 300 }, (_, i) => 5 + i * 7727);
const all = Object.entries(BANK).flatMap(([kind, list]) => list.map(it => [kind, it]));

test('слова и логика: в наборе не меньше 40 заданий, у каждого вида не меньше 10, номера не повторяются', () => {
  assert.ok(bankSize() >= 40, `заданий: ${bankSize()}`);
  for (const [kind, list] of Object.entries(BANK)) assert.ok(list.length >= 10, `${kind}: ${list.length}`);
  const ids = all.map(([, it]) => it.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(Object.keys(BANK).every(k => KIND_LABEL[k]));
  // для плана на 15 заданий каждого вида и уровня хватает с запасом
  const need = {};
  for (const [k, lv] of VERBAL_PLAN) need[`${k}${lv}`] = (need[`${k}${lv}`] ?? 0) + 1;
  for (const [key, n] of Object.entries(need)) { const [k, lv] = [key.slice(0, -1), Number(key.slice(-1))]; assert.ok(BANK[k].filter(x => x.lv === lv).length >= n + 2, `хватает заданий: ${key}`); }
});

test('слова и логика: тексты аккуратные — без пустот и лишних пробелов, вопрос заканчивается знаком', () => {
  const strings = [];
  for (const [, it] of all) for (const s of [it.q, it.t, ...(it.o ?? []), ...(it.names ?? [])]) if (s !== undefined) strings.push([it.id, s]);
  for (const [id, s] of strings) { assert.ok(typeof s === 'string' && s.trim() === s && s.length > 0 && !/\s{2,}|undefined/.test(s), `${id}: «${s}»`); }
  for (const [, it] of all) if (it.q) assert.match(it.q, /[?…]$/, `${it.id}: вопрос`);
  for (const [, it] of all) if (it.t) assert.match(it.t, /\.$/, `${it.id}: условие`);
});

test('аналогии и «лишнее»: у каждого ровно один верный вариант из четырёх, варианты разные', () => {
  for (const list of [BANK.analogy, BANK.odd]) for (const it of list) {
    assert.equal(it.o.length, 4, it.id);
    assert.equal(new Set(it.o).size, 4, `${it.id}: варианты разные`);
    assert.ok(Number.isInteger(it.a) && it.a >= 0 && it.a < 4, it.id);
    assert.ok([1, 2, 3].includes(it.lv));
  }
});

test('рассуждения: формальная запись даёт тот же ответ, что написан, и он не зависит от допущения «все группы непусты»', () => {
  for (const it of BANK.syl) {
    assert.equal(evalSyl(it.m), it.a, `${it.id}: ответ по записи`);
    if (it.m.terms) assert.equal(evalSets(it.m, { allNonEmpty: true }), it.a, `${it.id}: устойчив к допущению непустоты`);
    assert.notEqual(evalSyl(it.m), null, `${it.id}: условия не противоречат друг другу`);
  }
  assert.deepEqual(['yes', 'no', 'maybe'].map(a => BANK.syl.filter(x => x.a === a).length > 0), [true, true, true], 'есть все три вида ответа');
  // отдельные проверки решателя на классических схемах
  assert.equal(evalProp({ atoms: ['p', 'q'], prem: [['imp', 'p', 'q'], 'p'], con: 'q' }), 'yes');
  assert.equal(evalProp({ atoms: ['p', 'q'], prem: [['imp', 'p', 'q'], ['not', 'q']], con: 'p' }), 'no');
  assert.equal(evalProp({ atoms: ['p', 'q'], prem: [['imp', 'p', 'q'], 'q'], con: 'p' }), 'maybe');
  assert.equal(evalSets({ terms: ['A', 'B', 'C'], prem: [['all', 'A', 'B'], ['all', 'B', 'C']], con: ['all', 'A', 'C'] }), 'yes');
  assert.equal(evalSets({ terms: ['A', 'B', 'C'], prem: [['some', 'A', 'B'], ['some', 'B', 'C']], con: ['some', 'A', 'C'] }), 'maybe');
  assert.equal(evalSets({ terms: ['A', 'B'], prem: [['all', 'A', 'B']], con: ['all', 'B', 'A'] }), 'maybe');
});

test('порядок: по условиям ответ определён однозначно и совпадает с написанным; задачи на дни недели сходятся', () => {
  for (const it of BANK.order) {
    if (it.cal) { assert.equal(evalCalendar(it), it.a, it.id); assert.ok(WEEK.includes(it.a)); continue; }
    const r = evalOrder(it);
    assert.ok(r.count >= 1, `${it.id}: условия совместны`);
    assert.equal(r.answer, it.a, `${it.id}: ответ по перебору расстановок`);
    if (it.ask[0] === 'pos') assert.ok(it.names.includes(it.a), `${it.id}: ответ среди имён`);
    for (const n of it.names) assert.ok(it.t.toLowerCase().includes(n.toLowerCase().slice(0, Math.max(2, n.length - 2))) || it.q.toLowerCase().includes(n.toLowerCase().slice(0, 3)), `${it.id}: «${n}» есть в условии`);
  }
  assert.ok(BANK.order.some(it => it.a === CANNOT), 'есть задание, где ответ «нельзя определить»');
  assert.equal(evalCalendar({ cal: { known: [0, 'воскресенье'], ask: 1 } }), 'понедельник');
});

test('набор из 15 заданий: уровни растут, виды 4+4+4+3, одно зерно — один набор, у каждого один верный вариант', () => {
  const kinds = {};
  for (const seed of SEEDS) {
    const set = makeVerbalSet(seed);
    assert.equal(set.length, VERBAL_COUNT);
    assert.equal(new Set(set.map(x => x.id)).size, VERBAL_COUNT, 'без повторов внутри набора');
    for (let i = 1; i < set.length; i++) assert.ok(set[i].level >= set[i - 1].level, 'уровни не убывают');
    for (const it of set) {
      assert.ok(it.options.length >= 3 && it.options.length <= 5, `${it.id}: вариантов ${it.options.length}`);
      assert.equal(new Set(it.options).size, it.options.length, `${it.id}: варианты разные`);
      assert.ok(it.correct >= 0, `${it.id}: верный вариант есть среди предложенных`);
      const raw = BANK[it.kind].find(x => x.id === it.id);
      assert.equal(it.options[it.correct], it.kind === 'syl' ? SYL_OPTIONS[['yes', 'no', 'maybe'].indexOf(raw.a)] : expectedAnswer(it.kind, raw), `${it.id}: верный вариант совпал с ответом по записи`);
    }
    for (const it of set) kinds[it.kind] = (kinds[it.kind] ?? 0) + 1;
  }
  assert.deepEqual(Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, v / SEEDS.length])), { odd: 4, analogy: 4, syl: 4, order: 3 });
  assert.deepEqual(makeVerbalSet(123), makeVerbalSet(123));
  assert.notDeepEqual(makeVerbalSet(123), makeVerbalSet(124));
  assert.ok(new Set(SEEDS.slice(0, 80).map(s => makeVerbalSet(s).map(x => x.id).join())).size > 70, 'наборы заметно различаются');
});

test('набор: верный ответ стоит на разных местах (у рассуждений порядок вариантов фиксирован)', () => {
  const pos = {}; let n = 0;
  for (const seed of SEEDS) for (const it of makeVerbalSet(seed)) if (it.kind === 'analogy' || it.kind === 'odd') { pos[it.correct] = (pos[it.correct] ?? 0) + 1; n++; }
  for (let k = 0; k < 4; k++) assert.ok(pos[k] / n > 0.18 && pos[k] / n < 0.32, `место ${k}: ${(pos[k] / n).toFixed(2)}`);
});
