// Тёплые мелочи: подпись недели в трёх словах, вырезка месяца, годовщина, редкая открытка, микро-итог, «вчера», мост через неделю.
import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, makeTask, completeTask } from '../events.js';
import { makePerson } from '../people.js';
import { makeCheckin } from '../diary.js';
import { makeJoy, makeDayReview, makeWeekReflection, makeWeekWords, weekWordsOf, weekReflectionOf, yearRibbon, WEEK_WORD_IDEAS } from '../reflect.js';
import { appAgeDays, anniversaryLine, firstTimeSince, monthClip } from '../review.js';
import { yesterdayLine, warmSummaryLine, weekBridge, daySummary } from '../daycards.js';

const SUN = '2026-11-15';                                        // воскресенье
const NOW = new Date('2026-11-15T12:00:00').getTime();
const day = n => addDays(SUN, n);
const atDay = (d, h = 12) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`).getTime();
const wo = (date, done = true) => ({ id: `w:${date}:${done}`, type: 'workout', ts: atDay(date), payload: { date, done, minutes: 30 }, source: 'manual', confidence: 1, evidence: [] });

test('неделя в трёх словах: ровно три слова, хранится в итогах недели, правки ничего не стирают', () => {
  assert.ok(WEEK_WORD_IDEAS.length >= 5, 'есть подсказки для выбора');
  const w = makeWeekWords(SUN, ['спокойная', 'тёплая', 'домашняя'], NOW);
  assert.equal(w.type, 'weekreflect'); assert.equal(w.payload.week, '2026-11-09', 'ключ — понедельник недели');
  assert.deepEqual(w.payload.words, ['спокойная', 'тёплая', 'домашняя']);
  assert.throws(() => makeWeekWords(SUN, ['одна', 'две'], NOW), /ровно три слова/);
  assert.throws(() => makeWeekWords(SUN, [], NOW), /ровно три слова/);
  assert.deepEqual(weekWordsOf([w], day(-2)), w.payload.words, 'та же неделя по любому её дню');
  // подпись после ответов на вопросы: ответы не теряются
  const prev = makeWeekReflection(SUN, { went: 'Закончил курс' }, NOW - 1000);
  const signed = makeWeekWords(SUN, ['быстрая', 'светлая', 'бодрая'], NOW, prev);
  assert.equal(signed.payload.went, 'Закончил курс'); assert.equal(signed.ts, prev.ts); assert.ok(signed.payload.editedAt);
  // и наоборот: правка ответов не стирает подпись
  const edited = makeWeekReflection(SUN, { blocked: 'Простуда' }, NOW + 1000, signed);
  assert.deepEqual(edited.payload.words, ['быстрая', 'светлая', 'бодрая']); assert.equal(edited.payload.blocked, 'Простуда');
  assert.equal(weekReflectionOf([signed], SUN), signed);
});

test('лента года: только подписанные недели указанного года, от новых к старым', () => {
  const a = makeWeekWords('2026-11-15', ['спокойная', 'тёплая', 'домашняя'], NOW);
  const b = makeWeekWords('2026-11-01', ['непростая', 'быстрая', 'благодарная'], NOW);
  const old = makeWeekWords('2025-12-28', ['особенная', 'тихая', 'светлая'], NOW);
  const plain = makeWeekReflection('2026-11-08', { went: 'без подписи' }, NOW);
  const ribbon = yearRibbon([a, b, old, plain], 2026);
  assert.deepEqual(ribbon.map(r => r.week), ['2026-11-09', '2026-10-26'], 'без подписи и другой год не входят');
  assert.deepEqual(yearRibbon([old], 2025).map(r => r.week), ['2025-12-22']);
  assert.deepEqual(yearRibbon([], 2026), []);
});

test('годовщина: дни с первой записи, строка — только с первого месяца', () => {
  assert.equal(appAgeDays([], SUN), null);
  assert.equal(anniversaryLine([], SUN), null);
  const evs = [makeTask('первая запись', atDay(day(-45)))];
  assert.equal(appAgeDays(evs, SUN), 45);
  assert.equal(anniversaryLine(evs, SUN), 'Ты ведёшь Компас уже 45 дней.');
  assert.equal(anniversaryLine([makeTask('свежее', atDay(day(-10)))], SUN), null, 'раньше месяца молчим');
  assert.equal(anniversaryLine([makeTask('год', atDay(day(-365)))], SUN), 'Ты ведёшь Компас уже 365 дней.');
});

test('редкая открытка: первый раз за долгое время — одна мягкая строка', () => {
  const evs = [wo(SUN), wo(day(-40))];
  const r = firstTimeSince(evs, SUN);
  assert.equal(r.days, 40); assert.match(r.text, /^Первая тренировка за 40 дней — здорово, что получилось вернуться\.$/);
  assert.equal(firstTimeSince([wo(day(-40))], SUN), null, 'сегодня не случилось — молчим');
  assert.equal(firstTimeSince([wo(SUN)], SUN), null, 'совсем первый раз не отмечаем: не с чем сравнивать');
  assert.equal(firstTimeSince([wo(SUN), wo(day(-10))], SUN), null, 'пауза меньше порога — молчим');
  const joy = makeJoy({ text: 'вкусный чай', date: SUN }, NOW), oldJoy = makeJoy({ text: 'рассвет', date: day(-90) }, NOW - 1);
  const best = firstTimeSince([wo(SUN), wo(day(-40)), joy, oldJoy], SUN);
  assert.match(best.text, /^Первая радость в копилке за 90 дней/, 'выбираем самую долгую паузу');
  const undone = { ...wo(SUN, false), id: 'w:neg' };
  assert.equal(firstTimeSince([undone, wo(day(-40))], SUN), null, 'незавершённая тренировка не считается');
});

test('тёплая вырезка месяца: до пяти моментов, сначала радости, потом «что получилось»', () => {
  assert.equal(monthClip([], '2026-11'), null);
  assert.throws(() => monthClip([], 'ноябрь'), /bad month/);
  const joys = [1, 2, 3, 4, 5, 6].map(i => makeJoy({ text: `радость ${i}`, date: `2026-11-${String(i).padStart(2, '0')}` }, NOW + i));
  const clip = monthClip(joys, '2026-11');
  assert.match(clip, /^Тёплые моменты ноября 2026:\n/);
  assert.equal(clip.trim().split('\n').length, 6, 'заголовок и ровно пять моментов');
  assert.match(clip, /— 02\.11: радость 2\n— 03\.11: радость 3\n— 04\.11: радость 4\n— 05\.11: радость 5\n— 06\.11: радость 6$/, 'самые свежие, по датам');
  const mixed = [makeJoy({ text: 'чай с другом', date: '2026-11-02' }, NOW), makeDayReview('2026-11-05', { win: 'догулял до парка' }, NOW), makeDayReview('2026-11-07', { win: 'выспался' }, NOW)];
  const clip2 = monthClip(mixed, '2026-11');
  assert.deepEqual(clip2.split('\n'), ['Тёплые моменты ноября 2026:', '— 02.11: чай с другом', '— 05.11: догулял до парка', '— 07.11: выспался']);
  assert.equal(monthClip([makeJoy({ text: 'вне месяца', date: '2026-10-31' }, NOW)], '2026-11'), null);
});

test('«вчера одной строкой»: факты вчерашнего дня, пустое вчера — молчим', () => {
  assert.equal(yesterdayLine([], SUN), null);
  const t = makeTask('Полить цветы', NOW - 90000);
  const { updated } = completeTask(t, atDay(day(-1), 18));
  const line = yesterdayLine([updated], SUN);
  assert.equal(line, 'Вчера: задач сделано: 1.');
  const withMood = yesterdayLine([updated, makeCheckin('e', day(-1), { mood: 4 }, '', NOW)], SUN);
  assert.equal(withMood, 'Вчера: задач сделано: 1, настроение: 4 из 5.');
});

test('тёплый микро-итог: одна человеческая фраза без давления', () => {
  const zero = daySummary([], SUN);
  assert.equal(warmSummaryLine(zero), 'Тихий день — тоже день. Хорошего вечера.');
  const base = { tasksDone: 0, habitsDone: 0, study: 0, focus: 0, workout: 0, mood: null, left: 0 };
  assert.equal(warmSummaryLine({ ...base, tasksDone: 1, mood: 2 }), 'Даже в непростой день кое-что получилось — это дорогого стоит.');
  assert.equal(warmSummaryLine({ ...base, tasksDone: 2 }), 'Всё назначенное на сегодня сделано — можно спокойно выдыхать.');
  assert.equal(warmSummaryLine({ ...base, focus: 25, left: 3 }), 'Сегодня кое-что получилось. Хорошего вечера.');
  assert.equal(warmSummaryLine({ ...base, mood: 1 }), 'Тихий день — тоже день. Хорошего вечера.', 'низкое настроение без дел — просто мягкость, без «но»');
});

test('мост через неделю: только в воскресенье, дни рождения и дела по срокам', () => {
  assert.equal(weekBridge([], SUN), null);
  assert.equal(weekBridge([makePerson({ name: 'Анна', birthday: '18.11' }, NOW)], day(-1)), null, 'в субботу молчим');
  const evs = [makePerson({ name: 'Анна', birthday: '18.11' }, NOW), makePerson({ name: 'Борис', birthday: '21.11' }, NOW),
    makePerson({ name: 'Далеко', birthday: '30.11' }, NOW), makeTask('Оплатить жильё', NOW, { due: day(3) }), makeTask('Сегодняшнее', NOW, { due: SUN })];
  const line = weekBridge(evs, SUN);
  assert.match(line, /^На следующей неделе тебя ждёт: /);
  assert.match(line, /2 дня рождения \(Анна, Борис\)/, 'только дни рождения следующей недели');
  assert.match(line, /1 задача по срокам/, 'только дела со сроком на следующей неделе');
  assert.ok(!line.includes('Сегодняшнее') && !line.includes('Далеко'));
  assert.equal(weekBridge([makePerson({ name: 'Анна', birthday: '18.11' }, NOW)], SUN), 'На следующей неделе тебя ждёт: 1 день рождения (Анна).');
});
