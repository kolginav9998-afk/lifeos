// «Спиральная проверка» и «ошибки по видам заданий»: подмесь заданий из освоенных уроков этапа в повторную проверку,
// разбивка результата по видам (byKind в записи zcheck), слабые виды (weakKinds) и их приоритет при отборе заданий.
// Вся случайность детерминирована зерном: те же данные и зерно дают тот же набор.
import test from 'node:test';
import assert from 'node:assert/strict';
import { choose, typed, order, lessonIndex } from '../zero-kit.js';
import { todayStr } from '../events.js';
import {
  DAY_MS, KIND_LABEL, WEAK_MIN_N, WEAK_ERR, makeCheck, gradeCheck, makeZcheckEvent, pickSurprise, spiralPool, weakKinds,
} from '../curriculum.js';

// ---------- заготовки ----------
const T0 = new Date(2026, 0, 10, 12, 0, 0).getTime();            // полдень 10 января 2026 по местному времени
const at = (days, hours = 0) => T0 + days * DAY_MS + hours * 3600000;
const drills = tag => [...Array.from({ length: 6 }, (_, i) => choose(`${tag}: вопрос ${i + 1}`, 'да', ['нет', 'не знаю'])), typed(`${tag}: впиши «да»`, 'да'), order(`${tag}: собери`, ['а', 'б', 'в'])];
const lesson = (id, o = {}) => ({ id, title: `Урок ${id}`, minutes: 3, stage: 'Этап А', needs: [], intro: '', drills: drills(id), cards: [['в', 'о']], ...o });
const A = { id: 'tsta', zero: true, lang: 'english', lessons: [lesson('ez-01'), lesson('ez-02', { needs: ['ez-01'] }), lesson('ez-03', { needs: ['ez-02'], stage: 'Этап Б' })] };
const idx = lessonIndex([A]);
const seen = (id, t = T0) => ({ id: `lesson:${id}`, type: 'lesson', ts: t, payload: { lesson: id, track: 'tsta', date: todayStr(t), minutes: 3 }, source: 'manual', confidence: 1, evidence: [] });
const chk = (id, kind, ok, n, t, extra = {}, track = 'tsta') => makeZcheckEvent(track, id, kind, { n, ok, ...extra }, t);
const mastered = id => [seen(id, at(0)), chk(id, 'quiz', 6, 6, at(0, 1))];

// ---------- спиральный запас ----------
test('спиральный запас: только освоенные уроки того же этапа того же маршрута, без самого урока', () => {
  assert.deepEqual(spiralPool(A.lessons[1], [], at(1), idx), [], 'ничего не освоено — пусто');
  const ev = mastered('ez-01');
  const pool = spiralPool(A.lessons[1], ev, at(1), idx);
  assert.ok(pool.length >= 8, 'освоенный урок этапа даёт свои проверяемые задания');
  assert.ok(pool.every(d => A.lessons[0].drills.includes(d)), 'только задания освоенного урока');
  assert.ok(!A.lessons[1].drills.some(d => pool.includes(d)), 'сам урок не входит');
  assert.ok(!A.lessons[0].drills.filter(d => d.t === 'read').some(d => pool.includes(d)), 'самооценка (read) не входит');
  assert.deepEqual(spiralPool(A.lessons[0], ev, at(1), idx), [], 'для первого урока этапа пусто');
  assert.deepEqual(spiralPool(A.lessons[2], ev, at(1), idx), [], 'другой этап не входит');
  assert.deepEqual(spiralPool(A.lessons[1], [seen('ez-01', at(0))], at(1), idx), [], 'просмотренный (не освоенный) урок не входит');
  assert.deepEqual(spiralPool({ id: 'xx-99' }, ev, at(1), idx), [], 'неизвестный урок — пусто');
});

test('проверка со спиралью: до двух заданий из освоенного этапа, размер прежний, детерминизм по зерну', () => {
  const ev = mastered('ez-01');
  const spiral = spiralPool(A.lessons[1], ev, at(1), idx);
  const a = makeCheck(A.lessons[1], 'quiz', 5, { spiral });
  assert.equal(a.n, 6, 'размер проверки не изменился');
  const inside = a.items.filter(d => spiral.includes(d)).length;
  assert.ok(inside >= 1 && inside <= 2, `подмешано заданий из освоенного: ${inside}`);
  assert.ok(a.items.every(d => A.lessons[1].drills.includes(d) || spiral.includes(d)), 'только урок и освоенное');
  assert.deepEqual(makeCheck(A.lessons[1], 'quiz', 5, { spiral }).items, a.items, 'то же зерно — тот же набор');
  assert.ok(makeCheck(A.lessons[1], 'quiz', 5).items.every(d => !spiral.includes(d)), 'без спирали — как раньше');
});

// ---------- разбивка по видам ----------
test('разбивка byKind: gradeCheck считает верные/всего по каждому виду, подсказка не засчитывается', () => {
  const items = makeCheck(A.lessons[0], 'quiz', 1).items;
  const answers = items.map(d => (d.t === 'choose' ? 'да' : d.t === 'typed' ? 'да' : d.tiles));
  const clean = gradeCheck(items, answers, []);
  assert.equal(Object.values(clean.byKind).reduce((s, b) => s + b.n, 0), clean.n, 'разбивка покрывает все задания');
  assert.equal(Object.values(clean.byKind).reduce((s, b) => s + b.ok, 0), clean.ok, 'и все верные');
  assert.ok(Object.keys(clean.byKind).length >= 2, 'видов несколько');
  const hinted = gradeCheck(items, answers, [true, ...Array(items.length - 1).fill(false)]);
  const k0 = items[0].t;
  assert.equal(hinted.byKind[k0].ok, clean.byKind[k0].ok - 1, 'верный ответ с подсказкой в разбивке не засчитан');
  assert.equal(hinted.byKind[k0].n, clean.byKind[k0].n);
  assert.equal(gradeCheck(items, [], []).byKind[k0].ok, 0, 'без ответов верных нет, задания посчитаны');
});

test('запись zcheck: поле byKind добавляется и чистится, без него запись прежняя', () => {
  const withBk = makeZcheckEvent('tsta', 'ez-01', 'quiz', { n: 6, ok: 5, byKind: { choose: { ok: 4, n: 5 }, typed: { ok: 1, n: 1 } } }, T0);
  assert.deepEqual(withBk.payload.byKind, { choose: { ok: 4, n: 5 }, typed: { ok: 1, n: 1 } });
  const junk = makeZcheckEvent('tsta', 'ez-01', 'quiz', { n: 6, ok: 5, byKind: { read: { ok: 1, n: 1 }, choose: { ok: 9, n: 5 }, typed: { ok: 'x', n: 1 }, order: { ok: 0, n: 0 }, match: { ok: 2, n: 2 } } }, T0);
  assert.deepEqual(junk.payload.byKind, { match: { ok: 2, n: 2 } }, 'непроверяемые виды и неверные числа отброшены');
  const empty = makeZcheckEvent('tsta', 'ez-01', 'quiz', { n: 6, ok: 5, byKind: { read: { ok: 1, n: 1 } } }, T0);
  assert.ok(!('byKind' in empty.payload), 'пустая разбивка поля не создаёт');
  assert.ok(!('byKind' in makeZcheckEvent('tsta', 'ez-01', 'quiz', { n: 6, ok: 5 }, T0).payload), 'без параметра поля нет (старое поведение)');
});

// ---------- слабые виды ----------
test('слабые виды: минимум три ответа вида и доля ошибок больше 30 %, агрегация и сортировка', () => {
  const z = byKind => ({ type: 'zcheck', payload: { byKind } });
  assert.deepEqual(weakKinds([]), []);
  assert.deepEqual(weakKinds([z(null), { type: 'zcheck', payload: {} }, { type: 'lesson', payload: {} }]), [], 'записей без byKind недостаточно');
  assert.equal(WEAK_MIN_N, 3); assert.equal(WEAK_ERR, 0.3);
  const one = weakKinds([z({ listen: { ok: 1, n: 4 }, choose: { ok: 4, n: 4 } }), z({ listen: { ok: 0, n: 2 }, typed: { ok: 0, n: 2 } })]);
  assert.deepEqual(one.map(x => x.kind), ['listen'], 'typed: мало ответов; choose: ошибок мало');
  assert.deepEqual([one[0].ok, one[0].n], [1, 6], 'ответы по виду складываются');
  assert.ok(one[0].err > WEAK_ERR);
  const two = weakKinds([z({ listen: { ok: 0, n: 5 }, typed: { ok: 2, n: 5 }, order: { ok: 7, n: 10 }, choose: { ok: 1, n: 2 } })]);
  assert.deepEqual(two.map(x => x.kind), ['listen', 'typed'], 'по убыванию доли ошибок; ровно 30 % и меньше трёх ответов — не слабые');
  const bad = weakKinds([z({ listen: { ok: 5, n: 2 }, typed: { ok: 1.5, n: 3 }, bogus: { ok: 0, n: 9 }, order: { ok: 0, n: -1 }, match: 'x' })]);
  assert.deepEqual(bad, [], 'невалидные значения игнорируются');
});

test('подписи видов: для строки «Чаще ошибаешься» в статусе маршрута', () => {
  assert.equal(KIND_LABEL.listen, 'на слух');
  assert.deepEqual(Object.keys(KIND_LABEL).sort(), ['choose', 'listen', 'match', 'order', 'typed']);
});

// ---------- приоритет слабых видов ----------
const mixedDrills = tag => [
  ...Array.from({ length: 4 }, (_, i) => choose(`${tag}: выбери ${i}`, 'да', ['нет', 'не знаю'])),
  ...Array.from({ length: 4 }, (_, i) => typed(`${tag}: впиши ${i}`, 'да')),
  ...Array.from({ length: 4 }, (_, i) => order(`${tag}: собери ${i}`, ['а', 'б'])),
];
const countKind = (items, kind) => items.filter(d => d.t === kind).length;

test('приоритет слабых видов: детерминирован зерном и смещает набор в сторону слабого вида', () => {
  const l = lesson('ez-09', { drills: mixedDrills('м') });
  const weak = [{ kind: 'typed', ok: 0, n: 5, err: 1 }];
  const a = makeCheck(l, 'quiz', 9, { weak });
  assert.equal(a.n, 6);
  assert.deepEqual(makeCheck(l, 'quiz', 9, { weak }).items, a.items, 'то же зерно и веса — тот же набор');
  assert.deepEqual(makeCheck(l, 'quiz', 9, { weak: [] }).items, makeCheck(l, 'quiz', 9).items, 'пустой список слабых — прежний отбор');
  let weightedTyped = 0, plainTyped = 0;
  for (let s = 1; s <= 40; s++) { weightedTyped += countKind(makeCheck(l, 'quiz', s, { weak }).items, 'typed'); plainTyped += countKind(makeCheck(l, 'quiz', s).items, 'typed'); }
  assert.ok(weightedTyped > plainTyped, `слабый вид чаще попадает в проверку: ${weightedTyped} против ${plainTyped}`);
});

test('приоритет слабых видов работает вместе со спиралью', () => {
  const ev = mastered('ez-01');
  const spiral = spiralPool(A.lessons[1], ev, at(1), idx);
  const weak = [{ kind: 'choose', ok: 0, n: 5, err: 1 }];
  const a = makeCheck(A.lessons[1], 'quiz', 3, { weak, spiral });
  assert.equal(a.n, 6);
  const inside = a.items.filter(d => spiral.includes(d)).length;
  assert.ok(inside >= 1 && inside <= 2, `спираль подмешана: ${inside}`);
  assert.deepEqual(makeCheck(A.lessons[1], 'quiz', 3, { weak, spiral }).items, a.items, 'детерминированно');
});

test('неожиданная проверка учитывает слабые виды маршрута и остаётся детерминированной', () => {
  const L = lesson('zz-01', { drills: mixedDrills('з') });
  const tidx = lessonIndex([{ id: 'tsts', zero: true, lang: 'english', lessons: [L] }]);
  const base = [seen('zz-01', at(0)), chk('zz-01', 'quiz', 6, 6, at(0, 1), {}, 'tsts')];
  const bk = { typed: { ok: 0, n: 5 }, choose: { ok: 5, n: 5 }, order: { ok: 5, n: 5 } };
  const ev = [...base, chk('zz-01', 'quiz', 6, 6, at(0, 2), { byKind: bk }, 'tsts')];
  const s1 = pickSurprise(ev, at(2), 3, tidx);
  assert.ok(s1 && s1.lesson === 'zz-01' && s1.kind === 'surprise');
  assert.deepEqual(pickSurprise(ev, at(2), 3, tidx).items, s1.items, 'то же зерно — тот же набор');
  assert.deepEqual(pickSurprise(base, at(2), 3, tidx).items, pickSurprise(base, at(2), 3, tidx).items, 'и без разбивки');
  let withWeak = 0, without = 0;
  for (let s = 1; s <= 30; s++) { withWeak += countKind(pickSurprise(ev, at(2), s, tidx).items, 'typed'); without += countKind(pickSurprise(base, at(2), s, tidx).items, 'typed'); }
  assert.ok(withWeak > without, `слабый вид чаще попадает в неожиданную проверку: ${withWeak} против ${without}`);
});
