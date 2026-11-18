// Бережные правила учёбы, волна 5: гибкая серия «пять из семи» и болезнь, режим «разобрать» для «пиявок»,
// раннее перечитывание при доле подсказок выше 30 %, лучшие часы занятий, «закрытая книга», проверка переноса
// (choose ↔ typed), скорость как сигнал неуверенности, смешанная неожиданная проверка, каскадная входная
// проверка, пауза проверок в дни болезни и очень низкой энергии, карточки из промахов дикции.
import test from 'node:test';
import assert from 'node:assert/strict';
import { choose, typed, order, lessonIndex } from '../zero-kit.js';
import {
  TRACKS, makeLessonDone, makeUserCard, flexStudyStreak, studyStreakFlex, FLEX_NEED, FLEX_WINDOW,
  leechMode, unpackHint, LEECH_LAPSES, lessonHintShare, lessonToRevisit, HINT_REVISIT_DAYS, REVISIT_DAYS,
} from '../academy.js';
import { MASTERED_BOX } from '../srs.js';
import { addDays, todayStr } from '../events.js';
import { makeDiction } from '../diction.js';
import { missWordCards } from '../miss-cards.js';
import {
  DAY_MS, MIN_N, lessonStatus, makeCheck, gradeCheck, makeZcheckEvent, pickSurprise, pickMixedSurprise, surpriseBlock,
  placementTarget, placementChain, bestStudyHours, closedBookDue, transferKind, makeTransferCheck,
  SLOW_FLOOR_MS, MIX_MAX_LESSONS, MIX_PER_LESSON,
} from '../curriculum.js';

// ---------- заготовки ----------
const T0 = new Date(2026, 0, 10, 12, 0, 0).getTime();            // полдень 10 января 2026 по местному времени
const at = (days, hours = 0) => T0 + days * DAY_MS + hours * 3600000;
const TODAY = todayStr(T0);
const drills = tag => [...Array.from({ length: 5 }, (_, i) => choose(`${tag}: вопрос ${i + 1}`, 'да', ['нет', 'не знаю'])), typed(`${tag}: впиши «да»`, 'да'), order(`${tag}: собери`, ['а', 'б', 'в'])];
const lesson = (id, o = {}) => ({ id, title: `Урок ${id}`, minutes: 3, stage: 'Этап А', needs: [], intro: '', drills: drills(id), cards: [['в', 'о']], task: 'Опиши своими словами, что запомнил из урока', ...o });
const A = { id: 'tsta', zero: true, lang: 'english', lessons: [lesson('ez-01'), lesson('ez-02', { needs: ['ez-01'] }), lesson('ez-03', { needs: ['ez-02'] }), lesson('ez-04', { needs: ['ez-02'], stage: 'Этап Б' })] };
const idx = lessonIndex([A]);
const seen = (id, t = T0) => ({ id: `lesson:${id}`, type: 'lesson', ts: t, payload: { lesson: id, track: 'tsta', date: todayStr(t), minutes: 3 }, source: 'manual', confidence: 1, evidence: [] });
const chk = (id, kind, ok, n, t, extra = {}) => makeZcheckEvent('tsta', id, kind, { n, ok, ...extra }, t);
const mastered = (id, d = 0) => [seen(id, at(d)), chk(id, 'quiz', 6, 6, at(d, 1))];
const sickEv = (from, to = null) => ({ id: `sick:${from}`, type: 'sick', ts: T0, payload: { from, to }, source: 'manual', confidence: 1, evidence: [] });
const checkin = (date, energy) => ({ id: `ci:${date}:m`, type: 'checkin', ts: T0, payload: { date, slot: 'm', energy }, source: 'manual', confidence: 1, evidence: [] });

// ---------- 1–2. гибкая серия «пять из семи», болезнь серию не рвёт ----------
const lastDays = (today, count, skip = () => false) => { const out = []; for (let i = count - 1; i >= 0; i--) { const d = addDays(today, -i); if (!skip(i)) out.push(d); } return out; };

test('гибкая серия: каждый день — как обычная; сегодня можно ещё не заниматься', () => {
  const days = lastDays(TODAY, 10);
  assert.equal(flexStudyStreak(days, TODAY), 10);
  assert.equal(flexStudyStreak(days.filter(d => d !== TODAY), TODAY), 9, 'сегодняшний день ещё можно закрыть');
  assert.equal(flexStudyStreak([], TODAY), 0);
});

test('гибкая серия: два пропуска в неделю серию не рвут, третий подряд — рвёт', () => {
  const two = lastDays(TODAY, 21, i => i % FLEX_WINDOW >= FLEX_NEED);        // два выходных в каждой семидневке
  assert.equal(flexStudyStreak(two, TODAY), 19, 'пять из семи — серия жива и держится через выходные');
  const three = lastDays(TODAY, 12, i => i >= 1 && i <= 3);                  // три пропуска подряд после сегодняшнего занятия
  assert.equal(flexStudyStreak(three, TODAY), 1, 'третий пропуск обрывает: серия заново с сегодняшнего дня');
  assert.equal(flexStudyStreak(three, TODAY, { need: 6 }), 1, 'шесть из семи: второй пропуск подряд уже обрывает');
  const strict = lastDays(TODAY, 9, i => i === 2);                           // один пропуск
  assert.equal(flexStudyStreak(strict, TODAY, { need: 7 }), 2, 'семь из семи — как обычная серия подряд');
});

test('гибкая серия: день болезни считается днём занятия', () => {
  const days = lastDays(TODAY, 8, i => i === 2);                             // позавчера не занимались
  assert.equal(flexStudyStreak(days, TODAY), 8, 'один пропуск и так допустим');
  const tight = lastDays(TODAY, 14, i => i % 7 >= 5 || i === 2);             // два выходных в неделю и ещё один пропуск
  assert.equal(flexStudyStreak(tight, TODAY), 5, 'третий пропуск в окне обрывает серию');
  assert.equal(flexStudyStreak(tight, TODAY, { sick: new Set([addDays(TODAY, -2)]) }), 12, 'но это был день болезни — серия жива');
  const gap = lastDays(TODAY, 8, i => i >= 1 && i <= 3);                     // три пустых дня после сегодняшнего занятия
  assert.equal(flexStudyStreak(gap, TODAY), 1);
  assert.equal(flexStudyStreak(gap, TODAY, { sick: new Set([addDays(TODAY, -3)]) }), 8, 'один из них был днём болезни — серия дотянулась до занятий');
  assert.equal(flexStudyStreak([], TODAY, { sick: new Set([addDays(TODAY, -1)]) }), 0, 'болезнь без занятий серию не создаёт');
});

test('гибкая серия по журналу: уроки, карточки и дни болезни', () => {
  const t = TRACKS.find(x => !x.zero), l = t.lessons[0];
  // занимались сегодня и два дня до, затем три пустых дня, затем ещё три дня занятий
  const days = [...lastDays(TODAY, 3), ...lastDays(addDays(TODAY, -6), 3)];
  const events = days.map((d, i) => makeLessonDone(t, l, d, T0 - i * 3600000));
  assert.equal(studyStreakFlex(events, TODAY), 3, 'три пустых дня подряд оборвали старую серию, новая — с сегодняшнего дня');
  const ill = addDays(TODAY, -4);
  assert.equal(studyStreakFlex([...events, sickEv(ill, ill)], TODAY), 9, 'один из пустых дней был днём болезни — серия не оборвалась');
});

// ---------- 3. «пиявки»: режим «разобрать» ----------
test('пиявки: от трёх забываний — режим «разобрать», подсказка до ответа', () => {
  assert.equal(leechMode({ lapses: LEECH_LAPSES, box: 0 }), 'unpack');
  assert.equal(leechMode({ lapses: LEECH_LAPSES + 2, box: 1 }), 'unpack');
  assert.equal(leechMode({ lapses: LEECH_LAPSES, box: MASTERED_BOX }), null, 'выученная карточка — обычный режим');
  assert.equal(leechMode({ lapses: LEECH_LAPSES - 1, box: 0 }), null, 'пока рано');
  assert.equal(leechMode(null), null);
  assert.equal(leechMode({}), null);
  assert.equal(unpackHint({ a: 'каталог', hint: 'смотри на окончание' }), 'смотри на окончание', 'своя пометка важнее наброска');
  assert.equal(unpackHint({ a: 'каталог' }), 'Начинается на «к…», букв в первом слове: 7');
  assert.equal(unpackHint({ a: '' }), '');
  assert.equal(unpackHint(null), '');
});

// ---------- 4. доля подсказок выше 30 % — перечитать раньше ----------
test('подсказки: доля по проверкам урока; выше 30 % — вернуться к уроку через две недели вместо месяца', () => {
  const t = TRACKS.find(x => !x.zero), l = t.lessons[0];
  const zc = (ok, n, hints) => makeZcheckEvent(t.id, l.id, 'quiz', { n, ok, hints }, T0);
  assert.equal(lessonHintShare([], l.id), null);
  assert.deepEqual(lessonHintShare([zc(6, 6, 2)], l.id), { n: 6, hints: 2, share: 2 / 6 });
  assert.deepEqual(lessonHintShare([zc(6, 6, 2), zc(5, 6, 1)], l.id), { n: 12, hints: 3, share: 0.25 }, 'складываются все проверки');
  const done = makeLessonDone(t, l, addDays(TODAY, -20), T0);
  assert.equal(lessonToRevisit([done], TODAY), null, '20 дней без подсказок — рано (нужно 30)');
  assert.equal(lessonToRevisit([done, zc(5, 6, 2)], TODAY)?.days, 20, 'доля 2/6 > 30 %: раньше, срок две недели');
  assert.equal(lessonToRevisit([done, zc(7, 10, 3)], TODAY), null, 'ровно 30 % — ещё обычный срок');
  const doneLong = makeLessonDone(t, l, addDays(TODAY, -(REVISIT_DAYS + 1)), T0);
  assert.equal(lessonToRevisit([doneLong], TODAY)?.days, REVISIT_DAYS + 1, 'обычный срок — месяц');
  const doneHalf = makeLessonDone(t, l, addDays(TODAY, -HINT_REVISIT_DAYS), T0);
  assert.equal(lessonToRevisit([doneHalf, zc(5, 6, 2)], TODAY)?.days, HINT_REVISIT_DAYS, 'ровно две недели — уже пора');
});

// ---------- 5. лучшее окно занятий ----------
test('лучшие часы: по времени проверок, доля верных, минимум данных', () => {
  const atHour = (d, h) => new Date(2026, 0, 10 + d, h, 15, 0).getTime();
  const ev = [
    ...Array.from({ length: 5 }, (_, i) => chk('ez-01', 'quiz', 6, 6, atHour(i, 9))),    // утро: 30/30
    ...Array.from({ length: 5 }, (_, i) => chk('ez-01', 'quiz', 3, 6, atHour(i, 22))),   // поздний вечер: 15/30
    chk('ez-01', 'quiz', 6, 6, atHour(6, 14)),                                            // одна удачная проверка днём — данных мало
  ];
  const best = bestStudyHours(ev);
  assert.equal(best[0].hour, 9); assert.equal(best[0].rate, 1);
  assert.equal(best[1].hour, 22); assert.equal(best[1].rate, 0.5);
  assert.equal(best.length, 2, 'час с шестью ответами не проходит порог данных');
  assert.deepEqual(bestStudyHours(ev, { top: 1 }).map(x => x.hour), [9]);
  assert.deepEqual(bestStudyHours([]), []);
  assert.deepEqual(bestStudyHours(ev, { minN: 40 }), [], 'нет часов с достаточными данными — честно пусто');
  const junk = [{ id: 'j1', type: 'zcheck', ts: -5, payload: { lesson: 'ez-01', kind: 'quiz', n: 6, ok: 6 } },
    { id: 'j2', type: 'zcheck', ts: atHour(0, 8), payload: { lesson: 'ez-01', kind: 'exam', n: 6, ok: 6 } },
    { id: 'j3', type: 'lesson', ts: atHour(0, 8), payload: { lesson: 'ez-01', date: TODAY, minutes: 3 } }];
  assert.deepEqual(bestStudyHours(junk), [], 'неверные записи не считаются');
});

// ---------- 6. «закрытая книга» ----------
test('закрытая книга: через неделю после освоения — задание без текста урока', () => {
  const ev = [...mastered('ez-01', 0), ...mastered('ez-02', 5)];
  assert.deepEqual(closedBookDue(ev, at(5), idx), [], 'прошло пять и ноль дней — рано');
  const due = closedBookDue(ev, at(8), idx);
  assert.deepEqual(due.map(x => x.lesson.id), ['ez-01'], 'ez-01 освоен восемь дней назад');
  assert.equal(due[0].since, 7, 'полных дней с освоения: семь');
  assert.equal(due[0].track.id, 'tsta');
  const both = closedBookDue(ev, at(13), idx);
  assert.deepEqual(both.map(x => x.lesson.id), ['ez-01', 'ez-02'], 'самые давние первыми');
  const noTask = lessonIndex([{ ...A, lessons: A.lessons.map(l => { const { task, ...rest } = l; return rest; }) }]);
  assert.deepEqual(closedBookDue(ev, at(13), noTask), [], 'уроки без задания не участвуют');
  const failed = [...mastered('ez-01', 0), chk('ez-01', 'quiz', 1, 6, at(2))];
  assert.deepEqual(closedBookDue(failed, at(8), idx), [], 'после провала урок не освоен — задание не предлагаем');
});

// ---------- 7. проверка переноса ----------
test('перенос: освоенное через choose проверяем форматом typed (и наоборот)', () => {
  const by = byKind => chk('ez-01', 'quiz', 6, 6, at(0), { byKind });
  assert.equal(transferKind([by({ choose: { ok: 4, n: 4 }, typed: { ok: 0, n: 1 } })]), 'typed', 'choose освоен, typed почти не проверялся');
  assert.equal(transferKind([by({ typed: { ok: 3, n: 3 } })]), 'choose', 'и наоборот');
  assert.equal(transferKind([by({ choose: { ok: 3, n: 4 }, typed: { ok: 3, n: 3 } })]), 'choose', 'typed силён — проверяем choose');
  assert.equal(transferKind([by({ choose: { ok: 4, n: 4 }, typed: { ok: 3, n: 3 } })]), null, 'оба формата освоены');
  assert.equal(transferKind([by({ choose: { ok: 2, n: 4 } })]), null, 'исходный формат сам ещё слаб');
  assert.equal(transferKind([chk('ez-01', 'quiz', 6, 6, at(0))]), null, 'без разбивки byKind перенос не предлагаем');
  const typedOnly = lesson('ez-09', { drills: [...Array.from({ length: 5 }, (_, i) => typed(`впиши ${i}`, 'да')), choose('лишнее', 'да', ['нет', 'не знаю'])] });
  const zcs = [by({ choose: { ok: 5, n: 5 } })];
  const c = makeTransferCheck(typedOnly, zcs, 3);
  assert.ok(c && c.n >= MIN_N);
  assert.ok(c.items.every(d => d.t === 'typed'), 'вся проверка — в парном формате');
  assert.deepEqual(makeTransferCheck(typedOnly, zcs, 3), c, 'детерминированно по зерну');
  assert.equal(makeTransferCheck(A.lessons[0], zcs, 3), null, 'заданий typed меньше пяти — проверку не собрать');
  assert.equal(makeTransferCheck(typedOnly, [], 3), null);
});

// ---------- 8. скорость как сигнал ----------
test('скорость: верный, но очень медленный ответ — «неуверенный», не засчитывается', () => {
  const items = makeCheck(A.lessons[0], 'quiz', 1).items;
  const answers = items.map(d => (d.t === 'choose' ? 'да' : d.t === 'typed' ? 'да' : d.tiles));
  const base = gradeCheck(items, answers, []);
  assert.equal(base.slow, 0);
  assert.equal(base.ok, items.length, 'без длительностей всё как раньше');
  const durations = items.map(() => 5000);
  durations[0] = 60000;                                                      // медиана 5 с, порог max(20 с, 15 с) = 20 с
  const g = gradeCheck(items, answers, [], { durations });
  assert.equal(g.slow, 1);
  assert.equal(g.ok, items.length - 1);
  assert.equal(g.detail[0].slow, true);
  assert.equal(g.detail[0].counts, false);
  assert.equal(g.detail[1].slow, false);
  assert.equal(g.passed, true, '6 вопросов, засчитано 5 из 6: ровно порог 80 % — проходит');
  const fast = items.map(() => 1000);
  fast[0] = 5000;                                                            // быстрая проверка: 5 с — в пределах пола 20 с
  assert.equal(gradeCheck(items, answers, [], { durations: fast }).slow, 0, `пол ${SLOW_FLOOR_MS / 1000} с: свой темп не наказываем`);
  const withHint = gradeCheck(items, answers, [true, ...Array(items.length - 1).fill(false)], { durations });
  assert.equal(withHint.slow, 0, 'ответ с подсказкой и так не засчитан, отдельно медленным не метим');
});

// ---------- 9. смешанная неожиданная проверка ----------
test('смешанная проверка: 1–2 вопроса с каждого из нескольких освоенных уроков', () => {
  const ev = [...mastered('ez-01', 0), ...mastered('ez-02', 0)];
  assert.equal(pickMixedSurprise(ev, at(0, 5), 1, idx), null, 'освоено меньше суток назад');
  const mix = pickMixedSurprise(ev, at(2), 5, idx);
  assert.ok(mix);
  assert.equal(mix.kind, 'surprise'); assert.equal(mix.mixed, true);
  assert.equal(mix.parts.length, 2);
  assert.deepEqual(mix.parts.map(p => p.lesson.id).sort(), ['ez-01', 'ez-02']);
  for (const p of mix.parts) assert.ok(p.items.length >= 1 && p.items.length <= MIX_PER_LESSON, `с урока ${p.items.length} вопроса`);
  assert.equal(mix.n, mix.items.length);
  assert.deepEqual(pickMixedSurprise(ev, at(2), 5, idx), mix, 'детерминированно по зерну');
  assert.equal(pickMixedSurprise(mastered('ez-01', 0), at(2), 5, idx), null, 'один урок — обычная проверка, не смешанная');
  const done = [...ev, chk('ez-01', 'surprise', 3, 3, at(2, 1))];
  assert.equal(pickMixedSurprise(done, at(2, 5), 5, idx), null, 'сегодня уже была');
  assert.equal(pickMixedSurprise([...ev, sickEv(todayStr(at(2)))], at(2), 5, idx), null, 'день болезни — без проверок');
  const many = [...ev, ...mastered('ez-04', 0)];
  assert.ok(pickMixedSurprise(many, at(2), 5, idx).parts.length <= MIX_MAX_LESSONS, 'не больше трёх уроков за раз');
});

test('смешанная проверка: сначала уроки, которым пора повторение; запись части не рвёт серию урока', () => {
  const ev = [...mastered('ez-01', 0), ...mastered('ez-02', 4)];             // ez-01 просрочен (срок 3 дня), ez-02 нет
  const mix = pickMixedSurprise(ev, at(6), 5, idx);
  assert.equal(mix.parts[0].lesson.id, 'ez-01', 'просроченное повторение первым');
  // часть смешанной проверки записывается с флагом mixed: статус урока она не меняет, даже неудачная
  const slice = makeZcheckEvent('tsta', 'ez-01', 'surprise', { n: 2, ok: 0, mixed: true }, at(6, 1));
  assert.equal(slice.payload.mixed, true);
  const st = lessonStatus('ez-01', [...ev, slice], at(6, 2), idx);
  assert.equal(st.status, 'review', 'статус не изменился: ни сброса, ни подтверждения');
  assert.equal(st.best, 1, 'короткий срез не портит и не улучшает лучший результат');
  assert.equal(st.failStreak, 0, 'в адаптации decay срез не участвует');
  assert.equal(makeZcheckEvent('tsta', 'ez-01', 'surprise', { n: 2, ok: 2, mixed: false }, at(6, 1)).payload.mixed, undefined, 'без флага — обычная запись');
});

// ---------- 10. каскадная входная проверка ----------
test('каскадный placement: вся цепочка предпосылок в порядке проверки', () => {
  assert.deepEqual(placementChain('ez-01', [], at(0), idx), [], 'урок открыт — проверять нечего');
  assert.deepEqual(placementChain('ez-03', [], at(0), idx), ['ez-01', 'ez-02']);
  assert.deepEqual(placementChain('ez-04', [], at(0), idx), ['ez-01', 'ez-02'], 'цепочка сквозь этапы');
  assert.equal(placementChain('ez-03', [], at(0), idx)[0], placementTarget('ez-03', [], at(0), idx), 'первый шаг — прежний placementTarget');
  const p1 = chk('ez-01', 'placement', 6, 6, at(0));
  assert.deepEqual(placementChain('ez-03', [p1], at(0, 1), idx), ['ez-02'], 'освоенное выпадает из цепочки');
  assert.deepEqual(placementChain('ez-03', [p1, chk('ez-02', 'placement', 6, 6, at(0, 1))], at(0, 2), idx), [], 'всё освоено — урок открыт');
  assert.deepEqual(placementChain('ez-03', [chk('ez-01', 'placement', 2, 6, at(0))], at(0, 1), idx), ['ez-01', 'ez-02'], 'неудачная проверка цепочку не сокращает');
});

// ---------- 11. проверки — не в дни болезни и очень низкой энергии ----------
test('бережность: неожиданную проверку не назначаем в день болезни и при энергии 1–2', () => {
  const ev = mastered('ez-01', 0);
  const day = todayStr(at(1, 2));
  assert.ok(pickSurprise(ev, at(1, 2), 1, idx), 'обычный день — проверка есть');
  assert.equal(surpriseBlock(ev, at(1, 2)), null);
  assert.equal(surpriseBlock([...ev, sickEv(day)], at(1, 2)), 'sick');
  assert.equal(pickSurprise([...ev, sickEv(day)], at(1, 2), 1, idx), null);
  assert.equal(surpriseBlock([...ev, sickEv(addDays(day, -3), addDays(day, -1))], at(1, 2)), null, 'болезнь уже закрылась');
  assert.equal(surpriseBlock([...ev, checkin(day, 1)], at(1, 2)), 'energy');
  assert.equal(pickSurprise([...ev, checkin(day, 2)], at(1, 2), 1, idx), null, 'энергия 2 — тоже пауза');
  assert.equal(surpriseBlock([...ev, checkin(day, 3)], at(1, 2)), null, 'энергия 3 — можно');
  assert.equal(surpriseBlock([...ev, checkin(addDays(day, -1), 1)], at(1, 2)), null, 'вчерашняя слабость сегодня не блокирует');
  const evening = { ...checkin(day, 1), payload: { ...checkin(day, 1).payload, slot: 'e' } };
  assert.equal(surpriseBlock([...ev, evening], at(1, 2)), null, 'смотрим только утреннюю отметку');
});

// ---------- 12. слова из промахов дикции — в свои карточки ----------
test('промахи дикции: одна функция собирает свои карточки, без дублей и исправленного', () => {
  const round = makeDiction({ kind: 'stress', seconds: 60, items: 10, ok: 8, miss: ['каталог', 'звонит'], date: TODAY }, T0);
  const cards = missWordCards([round], { today: TODAY, now: T0 });
  assert.equal(cards.length, 2);
  assert.ok(cards.every(c => c.type === 'ucard'));
  const cat = cards.find(c => c.payload.q.includes('каталог'));
  assert.equal(cat.payload.a, 'каталОг (не катАлог)');
  assert.ok(cat.payload.hint.length > 0, 'подсказка из орфоэпического минимума');
  const again = missWordCards([round, ...cards], { today: TODAY, now: T0 });
  assert.equal(again.length, 0, 'уже заведённые слова не дублируются');
  const fixed = makeDiction({ kind: 'stress', seconds: 60, items: 10, ok: 10, miss: [], fixed: ['звонит'], date: TODAY }, T0 + 1000);
  const before = makeDiction({ kind: 'stress', seconds: 60, items: 10, ok: 8, miss: ['каталог', 'звонит'], date: addDays(TODAY, -1) }, T0 - 1000);
  assert.deepEqual(missWordCards([before, fixed], { today: TODAY, now: T0 }).map(c => c.payload.q), [cat.payload.q], 'исправленное слово не предлагаем');
  const old = makeDiction({ kind: 'stress', seconds: 60, items: 10, ok: 8, miss: ['каталог'], date: addDays(TODAY, -60) }, T0);
  assert.equal(missWordCards([old], { today: TODAY, now: T0 }).length, 0, 'давние промахи не тащим');
  assert.equal(missWordCards([old], { today: TODAY, days: 90, now: T0 }).length, 1, 'но по широкому окну — предлагаем');
  assert.deepEqual(missWordCards([], { today: TODAY }), []);
  const mine = makeUserCard('Ударение в слове «каталог»', 'каталОг', T0);
  assert.equal(missWordCards([round, mine], { today: TODAY, now: T0 }).length, 1, 'своя карточка с таким же вопросом — дубль не нужен');
});
