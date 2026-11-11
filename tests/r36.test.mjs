import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, todayStr } from '../events.js';
import { makeCheckin } from '../diary.js';
import { makeTask } from '../events.js';
import { lightDayHint, overloadHint } from '../hints.js';
import { searchEvents } from '../search.js';
import { dayLog } from '../journal.js';
import { makePerson } from '../people.js';
import { MAX_SICK_DAYS, startSick, endSick, activeSick, isSick, sickDays, sickCount } from '../sick.js';
import { makeHabit, makeHabitLog, habitStats, habitReview, REVIEW_TEXT } from '../habits.js';
import { addMonths, makeCheckup, markCheckup, updateCheckup, checkupsOf, checkupStatus, checkupsDue, CHECKUP_TEMPLATES } from '../prevent.js';
import { makeEmergency, emergencyOf, emergencyLines, BLOOD_TYPES, EMERGENCY_ID } from '../emergency.js';
import { bpProtocol, part } from '../bp.js';
import { makeMeasure } from '../health.js';
import { monthReport, doctorSummary } from '../reports.js';
import { planReminders, HABIT_ID_BASE, EVENING_ID_BASE, TASK_ID_BASE } from '../reminders.js';
import { dailyRows, insights } from '../bt-analytics.js';
import { TRACKS, cardsOfTrack, makeLessonDone, makeSrsEvent, makeLessonNote, lessonNoteOf, leeches, comebackInfo, nextLesson, fifteenPlan, searchAcademy } from '../academy.js';
import { newState } from '../srs.js';
import { toMarkdown } from '../export.js';
import { makeOkr } from '../okr.js';
import { makeThought } from '../thoughts.js';
import { makeMed } from '../meds.js';
import {
  weekStart, makeIntention, intentionOf, makeDayReview, dayReviewOf, DAY_QUESTIONS, makeWeekReflection, weekReflectionOf, weekReflections,
  makeDecision, closeDecision, reopenDecision, decisionsOf, decisionsDue, decisionStats, makeJoy, joysOf, pickJoy, makeCharger, chargersOf, lowMoodNotice, LOW_MOOD_TEXT,
} from '../reflect.js';

const T = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

test('неделя начинается с понедельника', () => {
  assert.equal(weekStart('2026-11-11'), '2026-11-09');   // среда
  assert.equal(weekStart('2026-11-09'), '2026-11-09');   // понедельник
  assert.equal(weekStart('2026-11-15'), '2026-11-09');   // воскресенье
  assert.equal(weekStart('2026-11-16'), '2026-11-16');
  assert.equal(weekStart('2026-01-01'), '2025-12-29');   // через границу года
  assert.throws(() => weekStart('вчера'), /bad date/);
});

test('намерение дня: одна строка, одна запись на дату, правка сохраняет время создания', () => {
  const a = makeIntention('2026-11-11', '  Сначала самое тяжёлое  ', 1000);
  assert.equal(a.type, 'intention'); assert.equal(a.id, 'intent:2026-11-11'); assert.equal(a.payload.text, 'Сначала самое тяжёлое');
  const b = makeIntention('2026-11-11', 'Только важное', 5000, a);
  assert.equal(b.id, a.id); assert.equal(b.ts, 1000); assert.equal(b.payload.editedAt, 5000);
  assert.throws(() => makeIntention('2026-11-11', ' '), /одну строку/);
  assert.throws(() => makeIntention('11.11', 'ок'), /bad date/);
  assert.equal(makeIntention('2026-11-11', 'я'.repeat(500)).payload.text.length, 160);
  assert.equal(intentionOf([a], '2026-11-11'), a); assert.equal(intentionOf([a], '2026-11-12'), null);
});

test('вечерний обзор: нужен хотя бы один ответ, пустые не хранятся', () => {
  assert.equal(DAY_QUESTIONS.length, 3);
  const r = makeDayReview('2026-11-11', { win: 'Сделал отчёт', miss: '  ', learn: '' }, 10);
  assert.deepEqual(Object.keys(r.payload).sort(), ['date', 'win']);
  assert.throws(() => makeDayReview('2026-11-11', { win: ' ', miss: '' }), /хотя бы на один/);
  assert.throws(() => makeDayReview('2026-11-11', undefined), /хотя бы на один/);
  const r2 = makeDayReview('2026-11-11', { win: 'Отчёт', learn: 'Вставать раньше' }, 20, r);
  assert.equal(r2.ts, 10); assert.equal(r2.payload.learn, 'Вставать раньше'); assert.equal(dayReviewOf([r2], '2026-11-11'), r2);
});

test('рефлексия недели: ключ — понедельник, новые недели сверху', () => {
  const w1 = makeWeekReflection('2026-11-11', { went: 'Тренировки', change: 'Спать раньше' }, 1);
  assert.equal(w1.id, 'wkrev:2026-11-09'); assert.equal(w1.payload.week, '2026-11-09');
  const same = makeWeekReflection('2026-11-15', { went: 'Правка' }, 2, w1);
  assert.equal(same.id, w1.id, 'воскресенье той же недели — та же запись');
  const w0 = makeWeekReflection('2026-11-04', { blocked: 'Усталость' }, 3);
  assert.deepEqual(weekReflections([w0, w1]).map(x => x.payload.week), ['2026-11-09', '2026-11-02']);
  assert.equal(weekReflectionOf([w0, w1], '2026-11-12'), w1);
  assert.throws(() => makeWeekReflection('2026-11-11', {}), /хотя бы на один/);
});

test('журнал решений: срок возврата, подведение итога, статистика', () => {
  const now = T(2026, 11, 11);
  const d = makeDecision({ title: 'Перейти на сменный график', why: 'Больше времени на учёбу', expect: 'Успею курс по данным' }, now);
  assert.equal(d.type, 'decision'); assert.equal(d.payload.revisit, '2026-12-11', 'по умолчанию — через 30 дней'); assert.equal(d.payload.closed, null);
  assert.throws(() => makeDecision({ title: 'аб' }, now), /несколькими словами/);
  assert.throws(() => makeDecision({ title: 'Купить ноутбук', revisit: '2026-11-10' }, now), /не раньше сегодняшнего/);
  assert.throws(() => makeDecision({ title: 'Купить ноутбук', revisit: '2030-01-01' }, now), /до двух лет/);
  assert.throws(() => makeDecision({ title: 'Купить ноутбук', revisit: 'скоро' }, now), /неверно/);
  const soon = makeDecision({ title: 'Записаться к врачу', revisit: '2026-11-18' }, now);
  const state = decisionsOf([d, soon]);
  assert.deepEqual(state.open.map(x => x.payload.title), ['Записаться к врачу', 'Перейти на сменный график'], 'ближайший срок первым');
  assert.equal(decisionsDue([d, soon], '2026-11-17').length, 0);
  assert.deepEqual(decisionsDue([d, soon], '2026-11-18').map(x => x.id), [soon.id]);
  assert.throws(() => closeDecision(soon, { verdict: 'отлично' }), /как получилось/);
  const closed = closeDecision(soon, { verdict: 'better', outcome: '  Записался, всё в порядке ' }, T(2026, 11, 19));
  assert.equal(closed.payload.closed.verdict, 'better'); assert.equal(closed.payload.closed.outcome, 'Записался, всё в порядке'); assert.equal(closed.payload.closed.date, '2026-11-19');
  assert.equal(decisionsOf([d, closed]).open.length, 1); assert.equal(decisionsOf([d, closed]).closed.length, 1);
  assert.equal(decisionsDue([d, closed], '2026-12-30').length, 1, 'закрытое решение не напоминает о себе');
  assert.equal(decisionStats([d]), null);
  const worse = closeDecision(d, { verdict: 'worse' }, T(2026, 12, 12));
  assert.deepEqual(decisionStats([closed, worse]), { n: 2, better: 1, asExpected: 0, worse: 1 });
  assert.equal(reopenDecision(worse).payload.closed, null);
});

test('копилка радостей и «что меня заряжает»', () => {
  const now = T(2026, 11, 11);
  const j1 = makeJoy({ text: 'Закат над рекой' }, now), j2 = makeJoy({ text: 'Позвонила сестра', date: '2026-11-01' }, now + 5);
  assert.equal(j1.payload.date, '2026-11-11');
  assert.deepEqual(joysOf([j2, j1]).map(x => x.payload.text), ['Закат над рекой', 'Позвонила сестра']);
  assert.throws(() => makeJoy({ text: 'ха' }), /несколько слов/);
  assert.throws(() => makeJoy({ text: 'Хороший день', date: '1.1' }), /bad date/);
  assert.equal(pickJoy([], 3), null);
  assert.equal(pickJoy([j1, j2], 0).id, j1.id); assert.equal(pickJoy([j1, j2], 1).id, j2.id); assert.equal(pickJoy([j1, j2], 2).id, j1.id); assert.equal(pickJoy([j1, j2], -1).id, j2.id);
  const c = makeCharger('  Прогулка у воды ', 7);
  assert.equal(c.payload.text, 'Прогулка у воды'); assert.throws(() => makeCharger('а'), /заряжает/);
  assert.equal(chargersOf([makeCharger('Музыка', 9), c])[0].id, c.id, 'по порядку добавления');
});

test('долго низкое настроение: предупреждение только при достаточных данных и стабильно низких оценках', () => {
  const today = '2026-11-14';
  const evs = (moods, from = 0) => moods.map((m, i) => makeCheckin('m', addDays(today, -(from + i)), { mood: m }, '', 1));
  assert.equal(lowMoodNotice(evs([2, 2, 1, 2, 2, 2, 1]), today), null, 'меньше 8 дней отметок — молчим');
  const low = lowMoodNotice(evs([2, 2, 1, 2, 2, 2, 1, 2, 3, 2]), today);
  assert.ok(low && low.n === 10 && low.mean < 2.3 && low.low === 9);
  assert.equal(lowMoodNotice(evs([2, 3, 2, 4, 2, 3, 2, 4, 5, 3]), today), null, 'настроение смешанное — молчим');
  assert.equal(lowMoodNotice(evs([2, 2, 2, 2, 2, 2, 2, 2, 2, 2], 14), today), null, 'старые оценки вне окна в 14 дней не считаются');
  assert.ok(LOW_MOOD_TEXT.includes('психотерапевт') && /экстренную службу/.test(LOW_MOOD_TEXT) && !/диагноз:|депресс/i.test(LOW_MOOD_TEXT), 'текст без диагнозов, с адресом помощи');
  assert.equal(todayStr(T(2026, 11, 14)), today);
});

test('подсказки на «Сегодня»: мало сил и перегруз', () => {
  const today = '2026-11-14';
  assert.equal(lightDayHint([], today), null, 'без утренней отметки молчим');
  assert.equal(lightDayHint([makeCheckin('m', today, { energy: 3, sleepHours: 7 }, '', 1)], today), null);
  assert.equal(lightDayHint([makeCheckin('m', today, { energy: 2 }, '', 1)], today).reason, 'energy');
  const sl = lightDayHint([makeCheckin('m', today, { energy: 4, sleepHours: 4.5 }, '', 1)], today);
  assert.equal(sl.reason, 'sleep'); assert.match(sl.text, /4,5 ч/);
  assert.equal(lightDayHint([makeCheckin('m', addDays(today, -1), { energy: 1 }, '', 1)], today), null, 'вчерашняя отметка не считается');
  const mk = (n, due) => Array.from({ length: n }, (_, i) => makeTask(`дело ${i}`, i + 1, { due }));
  assert.equal(overloadHint(mk(7, today), today), null, 'семь дел — ещё нормально');
  const o = overloadHint([...mk(5, today), ...mk(3, addDays(today, -2))], today);
  assert.equal(o.count, 8); assert.match(o.text, /8 дел/);
  assert.equal(overloadHint(mk(9, addDays(today, 1)), today), null, 'дела на завтра не считаются');
  assert.equal(overloadHint(mk(9, null), today), null, 'без срока не считаются');
  const done = mk(9, today).map(e => ({ ...e, payload: { ...e.payload, done: true } }));
  assert.equal(overloadHint(done, today), null);
});

test('поиск и журнал дня видят новые записи', () => {
  const now = new Date(2026, 10, 11, 12).getTime(), day = '2026-11-11';
  const evs = [makeIntention(day, 'Сначала отчёт', now), makeDayReview(day, { win: 'Закрыл отчёт' }, now + 1), makeJoy({ text: 'Тёплый вечер на балконе', date: day }, now + 2),
    makeDecision({ title: 'Взять второй монитор', why: 'Удобнее учиться', expect: 'Ускорит работу' }, now + 3), makeWeekReflection(day, { went: 'Три тренировки' }, now + 4), makePerson({ name: 'Анна Петрова', note: 'любит шахматы' }, now + 5)];
  const find = q => searchEvents(evs, q).map(r => `${r.kind}:${r.tab}`);
  assert.deepEqual(find('отчёт').sort(), ['Намерение:today', 'Обзор дня:reflect']);
  assert.deepEqual(find('балконе'), ['Радость:reflect']);
  assert.deepEqual(find('монитор'), ['Решение:reflect']);
  assert.deepEqual(find('тренировки'), ['Итоги недели:reflect']);
  assert.deepEqual(find('шахматы'), ['Человек:people']);
  const kinds = dayLog(evs, day).map(x => x.kind);
  for (const k of ['Намерение', 'Обзор дня', 'Радость', 'Решение']) assert.ok(kinds.includes(k), k);
});

test('режим болезни: период, автоокончание, повторное включение', () => {
  const now = T(2026, 11, 11);
  assert.throws(() => startSick([], { from: '2026-11-12' }, now), /в будущем/);
  assert.throws(() => startSick([], { from: '2026-09-01' }, now), /максимум 30 дней/);
  assert.throws(() => startSick([], { from: 'вчера' }, now), /неверно/);
  const a = startSick([], { from: '2026-11-09' }, now);
  assert.equal(a.type, 'sick'); assert.equal(a.payload.to, null);
  assert.equal(isSick([a], '2026-11-11'), true); assert.equal(activeSick([a], '2026-11-11').id, a.id);
  assert.throws(() => startSick([a], {}, now), /уже включён/);
  assert.deepEqual([...sickDays([a], '2026-11-11')].sort(), ['2026-11-09', '2026-11-10', '2026-11-11']);
  const closed = endSick(a, T(2026, 11, 12));
  assert.equal(closed.payload.to, '2026-11-12'); assert.equal(isSick([closed], '2026-11-13'), false);
  assert.deepEqual([...sickDays([closed], '2026-11-20')].sort(), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']);
  assert.equal(sickCount([closed], '2026-11-01', '2026-11-30', '2026-11-30'), 4);
  assert.equal(sickCount([closed], '2026-11-11', '2026-11-11', '2026-11-30'), 1);
  const startsLater = startSick([closed], { from: '2026-11-15' }, T(2026, 11, 15));
  assert.equal(sickDays([closed, startsLater], '2026-11-16').size, 4 + 2, 'второй период добавляется к первому');
  assert.throws(() => endSick({ ...a, payload: { from: '2026-12-01', to: null } }, now), /раньше начала/);
  // автоокончание: открытый период не тянется дольше 30 дней
  const old = { ...a, payload: { from: '2026-10-01', to: null } };
  assert.equal(isSick([old], '2026-10-30'), true); assert.equal(isSick([old], '2026-10-31'), false);
  assert.equal(sickDays([old], '2026-12-31').size, MAX_SICK_DAYS);
});

test('привычки: болезнь не рвёт серию и не считается пропуском', () => {
  const today = '2026-11-14';                                   // суббота
  const h = { ...makeHabit({ name: 'Зарядка' }, 1), payload: { ...makeHabit({ name: 'Зарядка' }, 1).payload, startDate: '2026-11-01' } };
  const logs = ds => ds.map(d => makeHabitLog(h, d, 'min', 1));
  const sickEv = (from, to) => ({ ...startSick([], { from }, T(2026, 11, 14)), payload: { from, to } });
  // отметки: 9, 10 ноября; болезнь 11–12; отметка 13 ноября
  const evs = [h, ...logs(['2026-11-09', '2026-11-10', '2026-11-13']), sickEv('2026-11-11', '2026-11-12')];
  const st = habitStats(h, evs, today);
  assert.equal(st.streak, 3, '13-е, (болезнь 11–12), 10-е и 9-е: сегодня ещё не отмечено, но серия не сгорает');
  const st2 = habitStats(h, [h, ...logs(['2026-11-09', '2026-11-10', '2026-11-13', '2026-11-14']), sickEv('2026-11-11', '2026-11-12')], today);
  assert.equal(st2.streak, 4, '9, 10, (болезнь), 13, 14');
  assert.equal(st2.longest, 4);
  const noSick = habitStats(h, [h, ...logs(['2026-11-09', '2026-11-10', '2026-11-13', '2026-11-14'])], today);
  assert.equal(noSick.streak, 2); assert.equal(noSick.longest, 2, 'без болезни пропуск рвёт серию');
  assert.equal(st2.pausedDays, 2); assert.equal(st2.span, 14 - 2, 'дни болезни не входят в расчёт регулярности');
  assert.equal(noSick.span, 14);
  // «не пропусти второй раз» молчит, если вчера была болезнь
  const y = habitStats(h, [h, ...logs(['2026-11-12'])], '2026-11-14');
  assert.equal(y.neverMissTwice, true);
  const ysick = habitStats(h, [h, ...logs(['2026-11-12']), sickEv('2026-11-13', '2026-11-13')], '2026-11-14');
  assert.equal(ysick.neverMissTwice, false); assert.equal(ysick.missedYesterday, false);
  // пока болеешь, «перерыв» не показывается
  const rec = habitStats(h, [h, ...logs(['2026-11-05']), { ...sickEv('2026-11-06', null) }], '2026-11-14');
  assert.equal(rec.needsRecovery, false);
  const rec2 = habitStats(h, [h, ...logs(['2026-11-05'])], '2026-11-14');
  assert.equal(rec2.needsRecovery, true);
  assert.equal(rec2.gapDays, 9);
});

test('пересмотр привычек: при долгой болезни оценка откладывается', () => {
  const today = '2026-11-28';
  const h = { ...makeHabit({ name: 'Чтение' }, 1), payload: { ...makeHabit({ name: 'Чтение' }, 1).payload, startDate: '2026-11-01' } };
  const sick = { ...startSick([], {}, T(2026, 11, 28)), payload: { from: '2026-11-02', to: '2026-11-26' } };
  const rv = habitReview([h, sick], today);
  assert.equal(rv[0].advice, 'few'); assert.equal(rv[0].text, REVIEW_TEXT.few);
  assert.equal(habitReview([h], today)[0].advice, 'archive', 'без болезни и без отметок — предложение убрать');
});

test('календарь профилактики: сроки, статусы, сдвиг месяцев', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28'); assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-11-15', 6), '2027-05-15'); assert.equal(addMonths('2026-12-31', 12), '2027-12-31'); assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  const now = T(2026, 11, 11);
  assert.throws(() => makeCheckup({ name: ' ', months: 6 }, now), /Назови/);
  assert.throws(() => makeCheckup({ name: 'Стоматолог', months: 0 }, now), /от 1 до 60/);
  assert.throws(() => makeCheckup({ name: 'Стоматолог', months: 6, last: '2027-01-01' }, now), /в будущем/);
  assert.throws(() => makeCheckup({ name: 'Стоматолог', months: 6, last: 'давно' }, now), /неверно/);
  const dent = makeCheckup({ name: 'Стоматолог', months: 6, last: '2026-02-01' }, now);        // срок 1 августа
  const eyes = makeCheckup({ name: 'Зрение', months: 12, last: '2025-12-01' }, now);           // срок 1 декабря: скоро
  const gp = makeCheckup({ name: 'Терапевт', months: 12, last: '2026-09-01' }, now);           // срок через год
  const nev = makeCheckup({ name: 'Анализы', months: 12 }, now);
  assert.equal(checkupStatus(dent, '2026-11-11').state, 'overdue'); assert.equal(checkupStatus(dent, '2026-11-11').due, '2026-08-01');
  assert.equal(checkupStatus(eyes, '2026-11-11').state, 'soon'); assert.equal(checkupStatus(eyes, '2026-11-11').daysLeft, 20);
  assert.equal(checkupStatus(gp, '2026-11-11').state, 'ok'); assert.equal(checkupStatus(nev, '2026-11-11').state, 'never');
  assert.deepEqual(checkupsDue([dent, eyes, gp, nev], '2026-11-11').map(x => x.ev.payload.name), ['Стоматолог', 'Анализы'], 'самые просроченные первыми');
  assert.equal(checkupsDue([dent, eyes, gp, nev], '2026-11-11').length, 2, 'в напоминаниях только просроченные и без отметки');
  const done = markCheckup(dent, '2026-11-11');
  assert.equal(checkupStatus(done, '2026-11-11').state, 'ok'); assert.equal(checkupStatus(done, '2026-11-11').due, '2027-05-11');
  assert.equal(updateCheckup(done, { name: 'Стоматолог (чистка)', months: 4 }).payload.months, 4);
  assert.throws(() => updateCheckup(done, { name: 'Х', months: 99 }), /от 1 до 60/);
  assert.deepEqual(checkupsOf([gp, dent]).map(e => e.payload.name), ['Стоматолог', 'Терапевт']);
  assert.ok(CHECKUP_TEMPLATES.length >= 4 && CHECKUP_TEMPLATES.every(t => t.months >= 1));
});

test('данные на экстренный случай: проверки полей и телефона', () => {
  assert.throws(() => makeEmergency({}), /хотя бы одно/);
  assert.throws(() => makeEmergency({ bloodType: 'Z' }), /группу крови/);
  assert.throws(() => makeEmergency({ contactPhone: 'позвони' }), /Телефон/);
  assert.throws(() => makeEmergency({ contactPhone: '12' }), /Телефон/);
  const e = makeEmergency({ bloodType: BLOOD_TYPES[3], allergies: ' пенициллин ', conditions: '', contactName: 'Анна', contactPhone: '+7 (900) 123-45-67' }, 100);
  assert.equal(e.id, EMERGENCY_ID); assert.equal(e.type, 'emergency'); assert.equal(e.payload.allergies, 'пенициллин'); assert.equal('conditions' in e.payload, false);
  assert.deepEqual(emergencyLines(e.payload).map(x => x[0]), ['Группа крови', 'Аллергии', 'Кому позвонить', 'Телефон']);
  const e2 = makeEmergency({ allergies: 'пенициллин, орехи' }, 200, e);
  assert.equal(e2.ts, 100); assert.equal(e2.payload.editedAt, 200); assert.equal('bloodType' in e2.payload, false, 'поля заменяются целиком');
  assert.equal(emergencyOf([e2]), e2); assert.equal(emergencyOf([]), null);
});

test('протокол давления: полные дни, средние по времени суток', () => {
  const today = '2026-11-14';
  const bp = (date, time, s, d) => makeMeasure({ kind: 'bp', value: s, value2: d, date, time }, 1);
  assert.equal(bpProtocol([], today), null);
  assert.equal(part('07:30'), 'morning'); assert.equal(part('12:00'), 'day'); assert.equal(part('20:15'), 'evening'); assert.equal(part(''), 'unknown');
  const evs = [bp(today, '07:30', 124, 80), bp(today, '07:31', 122, 78), bp(today, '20:00', 130, 84), bp(today, '20:02', 128, 82), bp('2026-11-13', '08:00', 120, 76), bp('2026-11-13', '', 118, 74), bp('2026-11-01', '08:00', 150, 95)];
  const p = bpProtocol(evs, today);
  assert.equal(p.readings, 6, 'замер старше 7 дней не входит'); assert.equal(p.daysWithData, 2); assert.equal(p.completeDays, 1);
  assert.equal(p.byDay.length, 7); assert.deepEqual(p.byDay.at(-1), { date: today, n: 4, morning: 2, evening: 2, complete: true });
  assert.deepEqual(p.avgMorning, { n: 3, sys: 122, dia: 78 }); assert.deepEqual(p.avgEvening, { n: 2, sys: 129, dia: 83 });
  assert.equal(p.avgAll.n, 6); assert.equal(p.untimed, 1); assert.equal(p.enough, false);
  const many = Array.from({ length: 12 }, (_, i) => bp(`2026-11-${String(14 - (i % 5)).padStart(2, '0')}`, '07:00', 120, 80));
  assert.equal(bpProtocol(many, today).enough, true, '12 замеров за 4+ дня — достаточно');
});

test('режим болезни в отчётах, напоминаниях и аналитике', () => {
  const now = T(2026, 11, 14, 8);
  const h = { ...makeHabit({ name: 'Зарядка' }, 1), payload: { ...makeHabit({ name: 'Зарядка' }, 1).payload, startDate: '2026-11-01' } };
  const task = makeTask('Позвонить врачу', now, { due: '2026-11-15' });
  const sick = { ...startSick([], { from: '2026-11-10' }, now), payload: { from: '2026-11-10', to: '2026-11-12' } };
  const m = monthReport([h, sick], '2026-11', { now });
  assert.match(m, /## Болезнь\n- Дней в режиме болезни: 3/);
  assert.doesNotMatch(monthReport([h], '2026-11', { now }), /## Болезнь/);
  assert.match(doctorSummary([h, sick], '2026-11-14', { now }), /Дней в режиме болезни за период: 3/);
  assert.doesNotMatch(doctorSummary([h], '2026-11-14', { now }), /режиме болезни/);
  // напоминания: пока болеешь, привычки и вечер молчат, задачи и сон остаются
  const opts = { taskHour: 9, habitHour: 20, eveningHour: 21, bedtimeMin: 23 * 60 };
  const open = { ...sick, payload: { from: '2026-11-13', to: null } };
  const ids = evs => planReminders(evs, now, opts).map(r => r.id);
  assert.ok(ids([h, task]).some(i => i >= HABIT_ID_BASE && i < HABIT_ID_BASE + 100));
  assert.ok(ids([h, task]).some(i => i >= EVENING_ID_BASE && i < EVENING_ID_BASE + 100));
  const quiet = ids([h, task, open]);
  assert.ok(!quiet.some(i => i >= HABIT_ID_BASE && i < HABIT_ID_BASE + 100), 'привычки молчат');
  assert.ok(!quiet.some(i => i >= EVENING_ID_BASE && i < EVENING_ID_BASE + 100), 'вечерняя отметка молчит');
  assert.ok(quiet.some(i => i >= TASK_ID_BASE && i < TASK_ID_BASE + 100), 'задачи остаются');
  assert.ok(quiet.some(i => i >= 4000 && i < 4100), 'подготовка ко сну остаётся');
  // аналитика: дни болезни помечены
  const rows = dailyRows([makeCheckin('m', '2026-11-11', { mood: 3 }, '', 1), makeCheckin('m', '2026-11-13', { mood: 4 }, '', 1), sick]);
  assert.deepEqual(rows.map(r => [r.date, r.sick]), [['2026-11-11', 1], ['2026-11-13', 0]]);
  assert.ok(Array.isArray(insights([sick], now)));
});

test('конспект урока: проверки, правка, поиск', () => {
  const lesson = TRACKS[0].lessons[0];
  assert.throws(() => makeLessonNote('zz-99', 'текст', '2026-11-11'), /Урок не найден/);
  assert.throws(() => makeLessonNote(lesson.id, '   ', '2026-11-11'), /Конспект пуст/);
  const a = makeLessonNote(lesson.id, '  Present Simple: he works  ', '2026-11-11', 10);
  assert.equal(a.id, `ln:${lesson.id}`); assert.equal(a.type, 'lessonnote'); assert.equal(a.payload.text, 'Present Simple: he works');
  const b = makeLessonNote(lesson.id, 'Правка', '2026-11-12', 20, a);
  assert.equal(b.ts, 10); assert.equal(b.payload.editedAt, 20); assert.equal(lessonNoteOf([b], lesson.id), b); assert.equal(lessonNoteOf([b], 'xx-01'), null);
  const found = searchEvents([a], 'works');
  assert.equal(found.length, 1); assert.equal(found[0].kind, 'Конспект'); assert.equal(found[0].tab, 'learn');
});

test('сложные карточки: забывались три раза и больше и ещё не выучены', () => {
  const cards = cardsOfTrack(TRACKS[0]).filter(c => c.kind === 'deck').slice(0, 5);
  const st = (c, lapses, box) => makeSrsEvent({ ...newState(c.id, '2026-11-01'), lapses, box }, 1);
  const evs = [st(cards[0], 4, 1), st(cards[1], 3, 0), st(cards[2], 2, 0), st(cards[3], 6, 4), st(cards[4], 3, 2)];
  const l = leeches(evs);
  assert.deepEqual(l.map(x => x.state.lapses), [4, 3, 3]);
  assert.equal(l.length, 3, 'выученная (коробка 4) и с двумя ошибками не входят');
  assert.equal(l[0].state.lapses, 4, 'сначала те, что забывались чаще всего');
  assert.ok(!l.some(x => x.card.id === cards[3].id) && !l.some(x => x.card.id === cards[2].id));
  assert.equal(leeches([]).length, 0);
});

test('возвращение после пропуска: подсказка только при большом «долге» и не в болезни', () => {
  const today = '2026-11-14';
  const t = TRACKS[0], deck = cardsOfTrack(t).filter(c => c.kind === 'deck').slice(0, 12);
  const due = (n, last) => deck.slice(0, n).map(c => makeSrsEvent({ ...newState(c.id, '2026-11-01'), box: 1, due: today, last, hist: [[last, 2]] }, 1));
  const lesson = makeLessonDone(t, t.lessons[0], '2026-11-09', 1);
  assert.equal(comebackInfo([], today), null, 'без занятий молчим');
  const info = comebackInfo([lesson, ...due(10, '2026-11-09')], today);
  assert.deepEqual([info.days, info.last], [5, '2026-11-09']); assert.ok(info.due >= 10);
  assert.equal(comebackInfo([lesson, ...due(10, '2026-11-12')], today), null, 'пропущено меньше трёх дней');
  assert.equal(comebackInfo([lesson, ...due(5, '2026-11-09')], today), null, 'повторений накопилось немного');
  const sick = { ...startSick([], { from: '2026-11-13' }, T(2026, 11, 14)) };
  assert.equal(comebackInfo([lesson, ...due(10, '2026-11-09'), sick], today), null, 'в болезни не торопим');
});

test('режим «15 минут»: следующий урок и число карточек', () => {
  const today = '2026-11-14', [en, he] = [TRACKS[0], TRACKS[1]];
  assert.equal(TRACKS[0].id, 'english'); assert.equal(TRACKS[1].id, 'hebrew');
  const first = nextLesson([]);
  assert.equal(first.track.id, 'english'); assert.equal(first.lesson.id, en.lessons[0].id);
  assert.equal(fifteenPlan([], today).cards, 0, 'пока нет активных курсов — карточек нет');
  const e1 = makeLessonDone(en, en.lessons[0], '2026-11-05', 1);
  assert.equal(nextLesson([e1]).lesson.id, en.lessons[1].id);
  const h1 = makeLessonDone(he, he.lessons[0], '2026-11-10', 2);
  const n2 = nextLesson([e1, h1]);
  assert.equal(n2.track.id, 'hebrew', 'курс с самым свежим занятием идёт первым'); assert.equal(n2.lesson.id, he.lessons[1].id);
  const plan = fifteenPlan([e1], today);
  assert.equal(plan.next.lesson.id, en.lessons[1].id); assert.equal(plan.cards, 5); assert.ok(plan.minutes >= 3 && plan.minutes <= 15);
  const all = TRACKS.flatMap(tr => tr.lessons.map(l => makeLessonDone(tr, l, '2026-11-01', 1)));
  assert.equal(nextLesson(all), null, 'всё пройдено');
});

test('Markdown-экспорт: новые разделы появляются только при наличии данных', () => {
  const now = T(2026, 11, 14), day = '2026-11-14';
  const empty = toMarkdown([], now);
  for (const h of ['Люди', 'Цели квартала', 'Мысли и эмоции', 'Рефлексия', 'Конспекты уроков', 'Профилактика', 'Лекарства и добавки', 'Режим болезни', 'Данные на экстренный случай']) assert.ok(!empty.includes(`## ${h}`), `${h}: пустой раздел не нужен`);
  const lesson = TRACKS[0].lessons[0];
  const closed = closeDecision(makeDecision({ title: 'Перейти на сменный график', expect: 'Успею учиться', revisit: '2026-12-01' }, now), { verdict: 'better', outcome: 'Стало больше времени' }, now);
  const evs = [
    makePerson({ name: 'Анна', birthday: '15.03.1990', cadenceDays: 14, note: 'любит шахматы' }, now),
    makeOkr({ title: 'Форма к лету', why: 'Здоровье', due: '2026-12-31', krs: [{ text: 'Пробежать', target: '50', unit: 'км' }] }, now),
    makeThought({ date: day, situation: 'Письмо без ответа', thought: 'Он недоволен', emotion: 'тревога', before: 8, alt: 'Он занят', after: 4 }, now),
    makeIntention(day, 'Сначала отчёт', now), makeDayReview(day, { win: 'Закрыл отчёт' }, now), makeWeekReflection(day, { went: 'Три тренировки' }, now), closed, makeJoy({ text: 'Тёплый вечер', date: day }, now),
    makeLessonNote(lesson.id, 'he works', day, now), makeCheckup({ name: 'Стоматолог', months: 6, last: '2026-02-01' }, now), makeMed({ name: 'Витамин D', dose: '1000 МЕ', when: 'morning' }, now),
    { ...startSick([], { from: '2026-11-10' }, now), payload: { from: '2026-11-10', to: '2026-11-12' } }, makeEmergency({ bloodType: 'A (II) Rh+', allergies: 'пенициллин' }, now),
  ];
  const md = toMarkdown(evs, now);
  for (const need of ['## Люди', '- Анна — день рождения 15.03.1990; связываться раз в 14 дн.; любит шахматы', '## Цели квартала', '**Форма к лету**', 'Пробежать: 0 из 50 км',
    '## Мысли и эмоции', 'тревога 8 → 4: Он недоволен (ситуация: Письмо без ответа); иначе: Он занят', '## Рефлексия', 'намерение: Сначала отчёт', 'обзор дня: получилось: Закрыл отчёт', 'неделя с 2026-11-09 — получилось: Три тренировки',
    'решение: Перейти на сменный график; ожидал: Успею учиться; вернуться 2026-12-01; итог (2026-11-14): вышло лучше, чем ждал, Стало больше времени', 'радость: Тёплый вечер',
    '## Конспекты уроков', 'he works', '## Профилактика', 'Стоматолог: раз в 6 мес.; последний раз 2026-02-01', '## Лекарства и добавки', 'Витамин D — 1000 МЕ', '## Режим болезни', 'с 2026-11-10 по 2026-11-12',
    '## Данные на экстренный случай', 'Группа крови: A (II) Rh+', 'Аллергии: пенициллин']) assert.ok(md.includes(need), need);
});
