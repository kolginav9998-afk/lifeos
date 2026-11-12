// Движок курсов «с нуля»: статусы уроков из журнала, допуск между курсами, интервалы с забыванием, проверки, неожиданные проверки.
import test from 'node:test';
import assert from 'node:assert/strict';
import { choose, typed, order, lessonIndex } from '../zero-kit.js';
import { TRACKS, searchAcademy } from '../academy.js';
import { todayStr } from '../events.js';
import { lessonSkillStatus, skillFromLesson } from '../skills.js';
import { makeLessonDone } from '../academy.js';
import { dayBrief, briefText } from '../daycards.js';
import {
  STATUS_LABEL, INTERVAL_DAYS, DAY_MS, lessonStatus, isUnlocked, routeProgress, nextLessons, reviewDue, pickSurprise, surpriseDoneToday, makeCheck, gradeCheck,
  makeZcheckEvent, placementTarget, statusMap, openLessonIds, proofText, masteredZero, lastRouteId,
} from '../curriculum.js';

// ---------- заготовки ----------
const T0 = new Date(2026, 0, 10, 12, 0, 0).getTime();            // полдень 10 января 2026 по местному времени
const at = (days, hours = 0) => T0 + days * DAY_MS + hours * 3600000;
const drills = () => [...Array.from({ length: 6 }, (_, i) => choose(`Вопрос ${i + 1}`, 'да', ['нет', 'не знаю'])), typed('Впиши «да»', 'да'), order('Собери', ['а', 'б', 'в'])];
const lesson = (id, o = {}) => ({ id, title: `Урок ${id}`, minutes: 3, stage: 'Этап А', needs: [], intro: '', drills: drills(), cards: [['в', 'о'], ['в', 'о2']], ...o });
const A = { id: 'tsta', zero: true, lang: 'english', lessons: [lesson('ez-01'), lesson('ez-02', { needs: ['ez-01'] }), lesson('ez-03', { needs: ['ez-02'], decay: 2, stage: 'Этап Б' }), lesson('ez-04', { needs: ['ez-02'], stage: 'Этап Б' })] };
const B = { id: 'tstb', zero: true, lang: 'hebrew', branch: 'biblical', lessons: [lesson('hb-01', { needs: ['ez-02'] }), lesson('hb-02', { needs: ['hb-01', 'ez-03'] })] };
const idx = lessonIndex([A, B]);
const seen = (id, t = T0) => ({ id: `lesson:${id}`, type: 'lesson', ts: t, payload: { lesson: id, track: 'x', date: todayStr(t), minutes: 3 }, source: 'manual', confidence: 1, evidence: [] });
const chk = (id, kind, ok, n, t, hints = 0) => makeZcheckEvent('tst', id, kind, { n, ok, hints }, t);
const st = (id, events, now, index = idx) => lessonStatus(id, events, now, index);
const status = (id, events, now) => st(id, events, now).status;

// ---------- статусы: переходы ----------
test('статусы: подписи и путь урока от «Новый» до «Подтверждено» и «Пора повторить»', () => {
  assert.deepEqual(STATUS_LABEL, { seen: 'Просмотрено', mastered: 'Освоено', confirmed: 'Подтверждено', review: 'Пора повторить', locked: 'Закрыто', new: 'Новый' });
  assert.equal(status('ez-01', [], at(0)), 'new', 'вход маршрута открыт');
  assert.equal(status('ez-02', [], at(0)), 'locked', 'предпосылка не освоена');
  const e1 = [seen('ez-01', at(0))];
  assert.equal(status('ez-01', e1, at(0)), 'seen', 'запись урока — только «Просмотрено»');
  assert.equal(status('ez-02', e1, at(0)), 'locked', '«Просмотрено» урок следующий не открывает');
  const e2 = [...e1, chk('ez-01', 'quiz', 6, 6, at(0, 1))];
  const s = st('ez-01', e2, at(0, 2));
  assert.equal(s.status, 'mastered');
  assert.equal(s.best, 1); assert.equal(s.attempts, 1); assert.equal(s.passes, 1); assert.equal(s.lastAt, at(0, 1));
  assert.equal(status('ez-02', e2, at(0, 2)), 'new', 'освоено — следующий открылся');
  // неожиданная проверка не раньше чем через сутки после освоения подтверждает
  const e3 = [...e2, chk('ez-01', 'surprise', 3, 3, at(2))];
  assert.equal(status('ez-01', e3, at(2, 1)), 'confirmed');
  // срок вышел: освоено в день 0, повторять через 3 дня, подтверждение в день 2 сдвигает срок на 7 дней от неё
  assert.equal(st('ez-01', e3, at(2, 1)).dueAt, at(2) + 7 * DAY_MS, 'вторая успешная проверка подряд: 7 дней');
  assert.equal(status('ez-01', e3, at(9)), 'confirmed', 'срок ещё не вышел');
  assert.equal(status('ez-01', e3, at(9, 1)), 'review', 'срок вышел: пора повторить');
  assert.equal(status('ez-02', e3, at(9, 1)), 'new', '«Пора повторить» остаётся допуском для следующих уроков');
  assert.equal(status('ez-02', [...e1, ...e2], at(400)), 'new');
});

test('статусы: последняя проверка решает, провал возвращает в «Просмотрено»', () => {
  const base = [seen('ez-01', at(0)), chk('ez-01', 'quiz', 6, 6, at(0, 1))];
  assert.equal(status('ez-01', [...base, chk('ez-01', 'quiz', 3, 6, at(1))], at(1, 1)), 'seen', 'провал обычной проверки');
  assert.equal(status('ez-01', [...base, chk('ez-01', 'surprise', 2, 3, at(2))], at(2, 1)), 'seen', 'провал неожиданной проверки');
  const failed = [...base, chk('ez-01', 'surprise', 2, 3, at(2))];
  assert.equal(status('ez-02', failed, at(2, 1)), 'locked', 'без освоенной предпосылки следующий урок снова закрыт');
  assert.equal(st('ez-01', failed, at(2, 1)).passes, 0);
  assert.equal(st('ez-01', failed, at(2, 1)).dueAt, null);
  assert.equal(st('ez-01', failed, at(2, 1)).best, 1, 'лучший результат остаётся в истории');
  // после провала новая успешная проверка снова освоит, серия начинается заново
  const again = [...failed, chk('ez-01', 'quiz', 5, 6, at(3))];
  assert.equal(status('ez-01', again, at(3, 1)), 'mastered');
  assert.equal(st('ez-01', again, at(3, 1)).passes, 1);
  // подтверждение прежней серии не переносится через провал
  assert.notEqual(status('ez-01', [...base, chk('ez-01', 'surprise', 3, 3, at(2)), chk('ez-01', 'quiz', 1, 6, at(3)), chk('ez-01', 'quiz', 6, 6, at(4))], at(4, 1)), 'confirmed');
});

test('статусы: меньше пяти заданий освоить не может, порог 80 %, подсказки не считаются', () => {
  const s0 = [seen('ez-01', at(0))];
  assert.equal(status('ez-01', [...s0, chk('ez-01', 'quiz', 4, 4, at(0, 1))], at(0, 2)), 'seen', 'n < 5: даже 4/4 не освоение');
  assert.equal(status('ez-01', [...s0, chk('ez-01', 'placement', 3, 3, at(0, 1))], at(0, 2)), 'seen');
  assert.equal(status('ez-01', [...s0, chk('ez-01', 'quiz', 5, 5, at(0, 1))], at(0, 2)), 'mastered');
  assert.equal(status('ez-01', [...s0, chk('ez-01', 'quiz', 4, 5, at(0, 1))], at(0, 2)), 'mastered', '4/5 = 80 %');
  assert.equal(status('ez-01', [...s0, chk('ez-01', 'quiz', 5, 6, at(0, 1))], at(0, 2)), 'mastered');
  assert.equal(status('ez-01', [...s0, chk('ez-01', 'quiz', 4, 6, at(0, 1))], at(0, 2)), 'seen', '4/6 ниже порога');
  assert.equal(status('ez-01', [...s0, chk('ez-01', 'quiz', 7, 10, at(0, 1))], at(0, 2)), 'seen');
  // неожиданная проверка (3–4 вопроса) освоить не может, только подтвердить уже освоенное
  assert.equal(status('ez-01', [...s0, chk('ez-01', 'surprise', 3, 3, at(0, 1))], at(0, 2)), 'seen');
  // подсказка: в gradeCheck такой ответ не засчитывается, поэтому в запись идёт меньшее ok
  const items = makeCheck(A.lessons[0], 'quiz', 1).items;
  const answers = items.map(d => (d.t === 'choose' ? 'да' : d.t === 'typed' ? 'да' : d.tiles));
  const clean = gradeCheck(items, answers, []);
  assert.deepEqual([clean.n, clean.ok, clean.hints, clean.passed], [6, 6, 0, true]);
  const hinted = gradeCheck(items, answers, [true, true, false, false, false, false]);
  assert.deepEqual([hinted.n, hinted.ok, hinted.hints, hinted.passed], [6, 4, 2, false], 'два ответа с подсказкой не считаются: 4/6 — не освоено');
  assert.equal(gradeCheck(items, answers, new Set([0])).ok, 5, 'подсказки можно передать множеством номеров');
  assert.equal(gradeCheck(items, answers, new Set([0])).passed, true);
  assert.equal(gradeCheck(items, [], []).ok, 0, 'без ответов — ноль');
  assert.equal(gradeCheck(items.slice(0, 4), answers.slice(0, 4), []).passed, false, 'четыре задания освоение не доказывают');
  assert.equal(gradeCheck(items.slice(0, 3), answers.slice(0, 3), [], { minN: 3 }).passed, true, 'неожиданная проверка: порог n = 3');
});

test('статусы: входная проверка освоит урок без записи «пройден», неудачная его просмотренным не делает', () => {
  assert.equal(status('ez-01', [chk('ez-01', 'placement', 2, 6, at(0))], at(0, 1)), 'new');
  const ok = [chk('ez-01', 'placement', 6, 6, at(0))];
  assert.equal(status('ez-01', ok, at(0, 1)), 'mastered');
  assert.equal(proofText(st('ez-01', ok, at(0, 1))), `входная проверка 6/6, ${todayStr(at(0))}`);
  const quiz = [seen('ez-01', at(0)), chk('ez-01', 'quiz', 6, 6, at(0, 2))];
  assert.equal(proofText(st('ez-01', quiz, at(0, 3))), `проверка 6/6, ${todayStr(at(0, 2))}`);
  assert.equal(proofText(st('ez-01', [], at(0))), '');
});

test('записи с неверными полями игнорируются, чужие типы и уроки не мешают', () => {
  const junk = [{ id: 'z1', type: 'zcheck', ts: at(0), payload: { lesson: 'ez-01', kind: 'exam', n: 6, ok: 6 } }, { id: 'z2', type: 'zcheck', ts: at(0), payload: { lesson: 'ez-01', kind: 'quiz', n: 6, ok: 9 } },
    { id: 'z3', type: 'zcheck', ts: at(0), payload: { lesson: 'ez-01', kind: 'quiz', n: 'шесть', ok: 6 } }, { id: 'z4', type: 'zcheck', ts: at(0), payload: null }, { id: 'n', type: 'note', ts: 1, payload: { text: 'x' } },
    chk('xx-99', 'quiz', 6, 6, at(0))];
  assert.equal(status('ez-01', junk, at(1)), 'new');
  assert.equal(lessonStatus('xx-99', junk, at(1), idx).status, 'locked', 'неизвестный урок всегда закрыт');
  assert.deepEqual(lessonStatus('xx-99', junk, at(1), idx).missing, []);
});

// ---------- интервалы повторения ----------
test('интервалы: 3 / 7 / 16 / 35 / 77 дней, делятся на decay, в тот же день ступень не растёт', () => {
  assert.deepEqual(INTERVAL_DAYS, [3, 7, 16, 35, 77]);
  const run = (id, gaps) => { const ev = [seen(id, at(0))]; let t = 0; for (const g of gaps) { t += g; ev.push(chk(id, 'quiz', 6, 6, at(t))); } return { ev, last: at(t) }; };
  // ступени 1…6 с промежутками, каждый раз после срока
  const gaps = [0, 3, 7, 16, 35, 77];
  for (let k = 1; k <= 6; k++) {
    const { ev, last } = run('ez-01', gaps.slice(0, k));
    const s = st('ez-01', ev, last + 3600000);
    assert.equal(s.passes, k);
    assert.equal(s.dueAt, last + INTERVAL_DAYS[Math.min(k, 5) - 1] * DAY_MS, `ступень ${k}`);
    assert.equal(s.status, 'mastered');
    assert.equal(st('ez-01', ev, s.dueAt + 1).status, 'review');
    assert.equal(st('ez-01', ev, s.dueAt).status, 'mastered', 'ровно в срок — ещё нет');
  }
  // decay 2 делит срок пополам, decay 0.5 удваивает
  const half = [seen('ez-03', at(0)), chk('ez-03', 'quiz', 6, 6, at(0))];
  assert.equal(st('ez-03', half, at(0, 1), lessonIndex([{ ...A, lessons: A.lessons.map(l => ({ ...l, needs: [] })) }])).dueAt, at(0) + 1.5 * DAY_MS, '3 дня ÷ 2');
  const slow = lessonIndex([{ ...A, lessons: [lesson('ez-01', { decay: 0.5 })] }]);
  assert.equal(st('ez-01', [chk('ez-01', 'quiz', 6, 6, at(0))], at(0, 1), slow).dueAt, at(0) + 6 * DAY_MS, '3 дня ÷ 0,5');
  // повторы в тот же день не поднимают ступень (интервал не накрутить)
  const spam = [chk('ez-01', 'quiz', 6, 6, at(0)), chk('ez-01', 'quiz', 6, 6, at(0, 1)), chk('ez-01', 'quiz', 6, 6, at(0, 2)), chk('ez-01', 'quiz', 6, 6, at(0, 3))];
  const sp = st('ez-01', spam, at(0, 4));
  assert.equal(sp.passes, 1); assert.equal(sp.dueAt, at(0, 3) + 3 * DAY_MS);
  // после срока повторная проверка поднимает ступень и снова делает «Освоено»
  const rev = [...run('ez-01', [0]).ev, chk('ez-01', 'quiz', 6, 6, at(4))];
  assert.equal(st('ez-01', rev, at(4, 1)).passes, 2); assert.equal(status('ez-01', rev, at(4, 1)), 'mastered');
  // неважный порядок записей в журнале
  assert.equal(status('ez-01', [...rev].reverse(), at(4, 1)), 'mastered');
});

// ---------- допуск ----------
test('допуск: все предпосылки освоены, в том числе из другого курса; «Пора повторить» открывает, «Просмотрено» нет', () => {
  const m = id => [seen(id, at(0)), chk(id, 'quiz', 6, 6, at(0, 1))];
  assert.equal(status('hb-01', [], at(1)), 'locked');
  assert.deepEqual(st('hb-01', [], at(1)).missing, ['ez-02']);
  assert.equal(status('hb-01', [...m('ez-01'), seen('ez-02', at(0, 2))], at(1)), 'locked', 'предпосылка из другого курса только «Просмотрено»');
  assert.equal(status('hb-01', [...m('ez-01'), ...m('ez-02')], at(1)), 'new', 'освоена предпосылка из другого курса');
  assert.equal(isUnlocked('hb-01', [...m('ez-01'), ...m('ez-02')], at(1), idx), true);
  assert.equal(isUnlocked('hb-01', [], at(1), idx), false);
  assert.equal(status('hb-01', [...m('ez-01'), ...m('ez-02')], at(40)), 'new', 'срок вышел (review): допуск остаётся');
  // несколько предпосылок: нужны все
  const hb1 = [...m('ez-01'), ...m('ez-02'), ...m('ez-03'), ...m('hb-01')];
  assert.equal(status('hb-02', hb1.filter(e => e.payload.lesson !== 'ez-03'), at(1)), 'locked');
  assert.deepEqual(st('hb-02', hb1.filter(e => e.payload.lesson !== 'ez-03'), at(1)).missing, ['ez-03']);
  assert.equal(status('hb-02', hb1, at(1)), 'new');
  // начатый урок заново не закрывается, даже если его предпосылка потом провалена; не начатый — закрывается
  const fell = [...m('ez-01'), ...m('ez-02'), ...m('ez-04'), chk('ez-02', 'quiz', 1, 6, at(2))];
  assert.equal(status('ez-04', fell, at(2, 1)), 'mastered');
  assert.equal(status('ez-03', fell, at(2, 1)), 'locked');
  assert.deepEqual(st('ez-04', fell, at(2, 1)).missing, ['ez-02'], 'в списке недостающих видно, что подкачала предпосылка');
});

test('входная проверка: берётся самая ранняя недостающая предпосылка, каждая проверка открыта', () => {
  assert.equal(placementTarget('ez-01', [], at(0), idx), null, 'урок открыт — проверять нечего');
  assert.equal(placementTarget('ez-02', [], at(0), idx), 'ez-01');
  assert.equal(placementTarget('ez-03', [], at(0), idx), 'ez-01', 'вглубь: сначала то, у чего своих предпосылок нет');
  assert.equal(placementTarget('hb-02', [], at(0), idx), 'ez-01');
  const p1 = chk('ez-01', 'placement', 6, 6, at(0));
  assert.equal(placementTarget('hb-02', [p1], at(0, 1), idx), 'ez-02');
  const p2 = chk('ez-02', 'placement', 6, 6, at(0, 1));
  assert.equal(placementTarget('hb-02', [p1, p2], at(0, 2), idx), 'hb-01', 'порядок needs: сначала hb-01, потом ez-03');
  const p3 = chk('hb-01', 'placement', 6, 6, at(0, 2));
  assert.equal(placementTarget('hb-02', [p1, p2, p3], at(0, 3), idx), 'ez-03');
  assert.equal(placementTarget('hb-02', [p1, p2, p3, chk('ez-03', 'placement', 6, 6, at(0, 3))], at(0, 4), idx), null, 'всё освоено — урок открыт');
  // каждая цель сама открыта (иначе проверка раскрыла бы закрытое)
  for (const events of [[], [p1], [p1, p2], [p1, p2, p3]]) { const t = placementTarget('hb-02', events, at(1), idx); assert.notEqual(status(t, events, at(1)), 'locked', t); }
  // неудачная входная проверка цель не меняет
  assert.equal(placementTarget('ez-02', [chk('ez-01', 'placement', 2, 6, at(0))], at(0, 1), idx), 'ez-01');
  // освоенная предпосылка (в статусе review) цель не даёт
  assert.equal(placementTarget('ez-02', [chk('ez-01', 'quiz', 6, 6, at(0))], at(100), idx), null);
});

// ---------- прогресс маршрута ----------
test('прогресс маршрута: счётчики, доля для кольца, этапы, ближайшие уроки и «Пора повторить»', () => {
  const m = (id, d) => [seen(id, at(d)), chk(id, 'quiz', 6, 6, at(d, 1))];
  const ev = [...m('ez-01', 0), ...m('ez-02', 0), seen('ez-03', at(0, 3))];
  const p = routeProgress(A, ev, at(1), idx);
  assert.deepEqual(p.counts, { locked: 0, new: 1, seen: 1, mastered: 2, confirmed: 0, review: 0 });
  assert.equal(p.total, 4); assert.equal(p.done, 2); assert.equal(p.fraction, 0.5); assert.equal(p.due, 0);
  assert.deepEqual(p.stages.map(s => [s.name, s.lessons.length, s.done]), [['Этап А', 2, 2], ['Этап Б', 2, 0]]);
  assert.equal(p.next.id, 'ez-03', 'первый не освоенный открытый урок');
  assert.deepEqual(nextLessons(A, ev, at(1), idx).map(l => l.id), ['ez-03', 'ez-04']);
  assert.deepEqual(nextLessons(A, ev, at(1), idx, 1).map(l => l.id), ['ez-03']);
  assert.deepEqual(nextLessons(B, ev, at(1), idx).map(l => l.id), ['hb-01'], 'hb-02 закрыт');
  const later = routeProgress(A, ev, at(5), idx);
  assert.equal(later.counts.review, 2); assert.equal(later.due, 2); assert.equal(later.done, 2, 'повторение не снимает освоенность с кольца');
  assert.deepEqual(reviewDue(ev, at(5), idx).map(x => x.lesson.id), ['ez-01', 'ez-02'], 'самые давние первыми');
  assert.deepEqual(reviewDue(ev, at(1), idx), []);
  assert.equal(routeProgress({ ...A, lessons: [] }, [], at(0), idx).fraction, 0);
  assert.equal(lastRouteId(ev, idx), 'tsta'); assert.equal(lastRouteId([], idx), null);
  assert.deepEqual(masteredZero(ev, at(1), idx).map(x => x.lesson.id).sort(), ['ez-01', 'ez-02']);
  assert.deepEqual([...openLessonIds(ev, at(1), idx)].sort(), ['ez-01', 'ez-02', 'ez-03', 'ez-04', 'hb-01']);
  assert.equal(statusMap([], at(0), idx).size, 6);
});

// ---------- проверки ----------
test('проверка: набор зависит от зерна, виды чередуются, размер 6 и не меньше 5; запись по разделу 6', () => {
  const l = A.lessons[0];
  const a = makeCheck(l, 'quiz', 7), b = makeCheck(l, 'quiz', 7), c = makeCheck(l, 'quiz', 8);
  assert.deepEqual(a, b, 'то же зерно — та же проверка');
  assert.notDeepEqual(a.items.map(d => d.q), c.items.map(d => d.q));
  assert.equal(a.n, 6); assert.equal(a.minN, 5); assert.equal(a.pass, 0.8); assert.equal(a.kind, 'quiz'); assert.equal(a.lesson, 'ez-01');
  assert.ok(new Set(a.items.map(d => d.t)).size >= 2);
  assert.equal(makeCheck(lesson('ez-09', { check: { n: 3, pass: 0.8 } }), 'placement', 1).n, 5, 'меньше пяти освоения не доказывает');
  assert.equal(makeCheck(lesson('ez-09', { check: { n: 8 } }), 'quiz', 1).n, 8);
  assert.throws(() => makeCheck(l, 'exam', 1), /вид/);
  const ev = makeZcheckEvent({ id: 'enzero' }, l, 'quiz', { n: 6, ok: 5, hints: 1 }, 1700000000000);
  assert.deepEqual(ev, { id: `zc:ez-01:${(1700000000000).toString(36)}`, type: 'zcheck', ts: 1700000000000, payload: { track: 'enzero', lesson: 'ez-01', kind: 'quiz', n: 6, ok: 5, hints: 1, date: todayStr(1700000000000) },
    source: 'quiz', confidence: 5 / 6, evidence: [{ kind: 'test_result', ref: 'ez-01:5/6' }] });
  assert.equal(makeZcheckEvent('enzero', 'ez-01', 'placement', { n: 5, ok: 5 }, 5).source, 'placement');
  assert.throws(() => makeZcheckEvent('enzero', 'ez-01', 'exam', { n: 6, ok: 5 }), /вид/);
  assert.throws(() => makeZcheckEvent('enzero', 'ez-01', 'quiz', { n: 6, ok: 7 }), /Результат/);
  assert.throws(() => makeZcheckEvent('enzero', 'ez-01', 'quiz', { n: 0, ok: 0 }), /Результат/);
});

test('неожиданная проверка: раз в сутки, 3–4 вопроса, из освоенного не меньше суток назад, сначала «Пора повторить»', () => {
  const m = (id, d, h = 1) => [seen(id, at(d)), chk(id, 'quiz', 6, 6, at(d, h))];
  assert.equal(pickSurprise([], at(5), 1, idx), null, 'проверять нечего');
  assert.equal(pickSurprise([seen('ez-01', at(0))], at(5), 1, idx), null, 'просмотренное не проверяем');
  const ev = [...m('ez-01', 0)];
  assert.equal(pickSurprise(ev, at(0, 5), 1, idx), null, 'освоено меньше суток назад');
  assert.ok(pickSurprise(ev, at(1, 2), 1, idx), 'прошло 25 часов с освоения: можно');
  // граница: ровно сутки после последней успешной проверки
  const s = pickSurprise(ev, at(1, 1), 2, idx);
  assert.ok(s, 'ровно сутки: можно'); assert.equal(s.lesson, 'ez-01'); assert.equal(s.kind, 'surprise');
  assert.ok(s.n >= 3 && s.n <= 4, `вопросов ${s.n}`); assert.equal(s.items.length, s.n);
  assert.deepEqual(new Set([2, 3, 4, 5, 6, 7, 8, 9].map(seed => pickSurprise(ev, at(2), seed, idx).n)), new Set([3, 4]), 'размер зависит от зерна: три или четыре');
  assert.deepEqual(pickSurprise(ev, at(2), 4, idx).items, pickSurprise(ev, at(2), 4, idx).items, 'детерминированно по зерну');
  assert.equal(s.track.id, 'tsta'); assert.equal(s.lessonRef.id, 'ez-01');
  // не чаще одной в сутки
  const done = [...ev, chk('ez-01', 'surprise', 3, 3, at(2, 3))];
  assert.equal(surpriseDoneToday(done, at(2, 5)), true);
  assert.equal(pickSurprise(done, at(2, 5), 1, idx), null, 'сегодня уже была');
  assert.equal(surpriseDoneToday(done, at(3, 5)), false);
  assert.ok(pickSurprise(done, at(3, 5), 1, idx), 'на следующий день снова можно');
  // приоритет: просроченное повторение важнее остальных
  const two = [...m('ez-01', 0), ...m('ez-02', 4), ...m('hb-01', 4)];
  const near = pickSurprise(two, at(5), 3, idx);
  assert.equal(near.lesson, 'ez-01', 'ez-01 пора повторять (срок 3 дня), остальные нет');
  assert.equal(near.reason, 'review');
  const fresh = pickSurprise([...m('ez-01', 4), ...m('ez-02', 4)], at(6), 3, idx);
  assert.equal(fresh.reason, 'random'); assert.ok(['ez-01', 'ez-02'].includes(fresh.lesson));
  // чужие, не «с нуля», маршруты не используются
  const plain = lessonIndex([{ ...A, zero: false }]);
  assert.equal(pickSurprise(ev, at(5), 1, plain), null);
});

// ---------- настоящие маршруты приложения ----------
test('настоящие курсы: в пустом журнале открыты только входы, всё остальное закрыто; поиск не раскрывает закрытое', () => {
  const zero = TRACKS.filter(t => t.zero);
  assert.ok(zero.length >= 3);
  const map = statusMap([], Date.now());
  for (const t of zero) for (const l of t.lessons) {
    const want = (l.needs ?? []).length ? 'locked' : 'new';
    assert.equal(map.get(l.id).status, want, l.id);
  }
  const open = openLessonIds([], Date.now());
  for (const t of zero) for (const l of t.lessons) assert.equal(open.has(l.id), !(l.needs ?? []).length);
  // поиск: закрытые уроки не выдаются вовсе, открытые — только по названию
  const entry = zero[0].lessons[0];
  assert.deepEqual(searchAcademy(entry.title).filter(r => r.lessonId === entry.id), [], 'без списка открытых уроков «с нуля» в поиске нет');
  const hit = searchAcademy(entry.title, 12, new Set([entry.id])).find(r => r.lessonId === entry.id);
  assert.ok(hit && hit.zero === true && hit.trackId === zero[0].id);
  const closed = zero.flatMap(t => t.lessons).find(l => (l.needs ?? []).length);
  if (closed) assert.equal(searchAcademy(closed.title, 12, new Set([entry.id])).filter(r => r.lessonId === closed.id).length, 0);
  const bodyWord = entry.body.join(' ').split(/\s+/).find(w => /^[а-яё]{9,}$/i.test(w));
  if (bodyWord) assert.equal(searchAcademy(bodyWord, 50, new Set([entry.id])).filter(r => r.lessonId === entry.id && !entry.title.toLowerCase().includes(bodyWord.toLowerCase())).length, 0, 'текст урока в поиске не светится');
});

// ---------- навыки ----------
test('навыки: освоенный урок «с нуля» предлагается с подтверждением «проверка 6/6, дата»', () => {
  const track = TRACKS.find(t => t.zero), lesson = track.lessons[0], t = at(0);
  const none = lessonSkillStatus([seen(lesson.id, t)]);
  assert.ok(!none.ready.some(r => r.lesson.id === lesson.id), 'просмотренный урок навыком не предлагается');
  const events = [makeLessonDone(track, lesson, todayStr(t), t), makeZcheckEvent(track, lesson, 'quiz', { n: 6, ok: 6 }, t + 1000)];
  const r = lessonSkillStatus(events).ready.find(x => x.lesson.id === lesson.id);
  assert.ok(r, 'освоенный урок готов к добавлению'); assert.equal(r.proof, `проверка 6/6, ${todayStr(t + 1000)}`);
  const skill = skillFromLesson(track, lesson, events, t + 2000);
  assert.equal(skill.payload.evidence, `проверка 6/6, ${todayStr(t + 1000)}`);
  assert.equal(skill.id, `skill:lesson:${lesson.id}`); assert.equal(skill.payload.source, 'lesson'); assert.equal(skill.payload.ref, lesson.id);
  assert.ok(!lessonSkillStatus([...events, skill]).ready.some(x => x.lesson.id === lesson.id), 'после добавления не предлагается снова');
  const placed = [makeZcheckEvent(track, lesson, 'placement', { n: 5, ok: 5 }, t)];
  assert.match(skillFromLesson(track, lesson, placed, t + 5).payload.evidence, /^входная проверка 5\/5, /, 'без записи «пройден» тоже предлагается');
});

// ---------- «Сегодня» ----------
test('бриф дня: строка «С нуля» появляется, когда пора повторять или ждёт быстрая проверка', () => {
  const track = TRACKS.find(t => t.zero), lesson = track.lessons[0], t = new Date(2026, 4, 10, 12).getTime();
  assert.doesNotMatch(briefText(dayBrief([], todayStr(t))), /С нуля/);
  const events = [makeLessonDone(track, lesson, todayStr(t), t), makeZcheckEvent(track, lesson, 'quiz', { n: 6, ok: 6 }, t)];
  assert.match(briefText(dayBrief(events, todayStr(t + 2 * DAY_MS))), /С нуля: есть быстрая проверка/, 'через два дня: освоено больше суток назад, повторять рано');
  assert.match(briefText(dayBrief(events, todayStr(t + 4 * DAY_MS))), /С нуля: пора повторить уроков: 1; есть быстрая проверка/);
  assert.doesNotMatch(briefText(dayBrief(events, todayStr(t))), /С нуля/, 'в день проверки ничего не ждёт');
});
