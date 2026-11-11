import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, makeTask, completeTask } from '../events.js';
import { makeHabit, makeHabitLog } from '../habits.js';
import { makeMed } from '../meds.js';
import { makePerson } from '../people.js';
import { makePark } from '../parked.js';
import { makeIntention } from '../reflect.js';
import { startSick } from '../sick.js';
import { makeCheckin } from '../diary.js';
import { makeFocus } from '../focus.js';
import { makeSkill } from '../skills.js';
import { TRACKS, makeLessonDone } from '../academy.js';
import { dayBrief, briefText, daySummary, summaryText, tenMinutes, tenText, QUICK_RE } from '../daycards.js';
import { variety, weekReview, VARIETY_AREAS } from '../review.js';
import { monthReport } from '../reports.js';
import { makeSpeak } from '../speaking.js';

const TODAY = '2026-11-14', NOW = new Date('2026-11-14T08:00:00').getTime(), day = n => addDays(TODAY, n);   // 14 ноября 2026 — суббота
const english = TRACKS[0];
const base = () => [
  makeTask('Сдать отчёт', NOW, { due: day(-2) }), makeTask('Купить хлеб', NOW + 1, { due: TODAY }), makeTask('Позвонить маме', NOW + 2, { priority: 'high' }),
  makeTask('Разобрать почту', NOW + 3), makeTask('Купить подарок', NOW + 4, { due: day(1) }),
];

test('бриф на день: главное по важности и срокам, привычки по расписанию, лекарства, люди, напоминания', () => {
  const daily = makeHabit({ name: 'Вода', minimum: 'один глоток' }, NOW - 40 * 86400000), mwf = makeHabit({ name: 'Зарядка', days: [1, 3, 5] }, NOW - 40 * 86400000);
  const evs = [...base(), daily, mwf, makeMed({ name: 'Витамин D', when: 'morning' }, NOW), makeMed({ name: 'От головы', when: 'asneeded' }, NOW), makePerson({ name: 'Анна', birthday: '15.11' }, NOW),
    makePark({ text: 'вернуться к мысли', forDate: TODAY }, NOW), makeIntention(TODAY, 'Спокойный день', NOW)];
  const b = dayBrief(evs, TODAY);
  assert.deepEqual(b.tasks.map(t => [t.text, t.overdue, t.high, t.due]), [['Позвонить маме', false, true, null], ['Сдать отчёт', true, false, day(-2)], ['Купить хлеб', false, false, TODAY]]);
  assert.equal(b.tasksTotal, 5); assert.equal(b.intention, 'Спокойный день');
  assert.deepEqual(b.habits, [{ name: 'Вода', minimum: 'один глоток' }], 'привычка пн-ср-пт в субботу не в списке');
  assert.deepEqual(b.meds, [{ name: 'Витамин D', when: 'morning' }], '«по необходимости» не включаем');
  assert.deepEqual(b.birthdays, [{ name: 'Анна', inDays: 1 }]); assert.equal(b.parked, 1);
  assert.equal(briefText(b), ['Бриф на 2026-11-14', 'Намерение дня: Спокойный день', 'Главное:', '1. ★ Позвонить маме', '2. Сдать отчёт (просрочено)', '3. Купить хлеб (сегодня)', 'И ещё дел в списке: 2',
    'Привычки на сегодня: Вода (минимум: один глоток)', 'Лекарства и добавки: Витамин D (утром)', 'День рождения: Анна (завтра)', 'Не забыть: отложенные мысли: 1'].join('\n'));
  assert.equal(briefText(dayBrief([], TODAY)), 'Бриф на 2026-11-14\nОткрытых задач нет.');
});

test('бриф в режиме болезни: привычки не предлагаем', () => {
  const h = makeHabit({ name: 'Вода' }, NOW - 40 * 86400000), evs = [...base(), h];
  const sick = startSick(evs, {}, NOW);
  const b = dayBrief([...evs, sick], TODAY);
  assert.equal(b.sick, true); assert.deepEqual(b.habits, []); assert.match(briefText(b), /Режим болезни: отдыхай/); assert.ok(!/Привычки на сегодня/.test(briefText(b)));
});

test('итог дня: сделано, осталось, на завтра — только факты', () => {
  const evs = base(), bread = evs[1];
  const { updated } = completeTask(bread, NOW + 5000);
  const h = makeHabit({ name: 'Вода' }, NOW - 40 * 86400000), mwf = makeHabit({ name: 'Зарядка', days: [1, 3, 5] }, NOW - 40 * 86400000);
  const lesson = english.lessons[0];
  const all = [evs[0], updated, evs[2], evs[3], evs[4], h, mwf, makeHabitLog(h, TODAY, 'full', NOW), makeLessonDone(english, lesson, TODAY, NOW), makeFocus({ date: TODAY, minutes: 25, label: 'отчёт' }, NOW),
    makeCheckin('e', TODAY, { mood: 4 }, '', NOW), makeSkill({ title: 'Менять колесо', date: TODAY }, NOW)];
  const s = daySummary(all, TODAY);
  assert.deepEqual([s.tasksDone, s.dueTotal, s.dueDone, s.overdue, s.left, s.tomorrow], [1, 1, 1, 1, 1, 1]);
  assert.deepEqual([s.habitsPlanned, s.habitsDone], [1, 1], 'привычка по расписанию в субботу не считается');
  assert.deepEqual([s.study, s.focus, s.skills, s.mood], [lesson.minutes, 25, 1, 4]);
  assert.equal(summaryText(s), ['Итог дня 2026-11-14', 'Задач сделано: 1 (из назначенных на сегодня: 1 из 1)', 'Привычки: 1 из 1', `Ещё: учёба ${lesson.minutes} мин, фокус 25 мин, новых навыков: 1`, 'Настроение: 4 из 5',
    'Осталось на сегодня и просрочено: 1 задача', 'На завтра назначено: 1 задача'].join('\n'));
  const empty = summaryText(daySummary([], TODAY));
  assert.equal(empty, 'Итог дня 2026-11-14\nЗадач сделано: 0\nСегодня ничего не отмечено. Это нормально: завтра новый день.');
  assert.match(summaryText(daySummary([makeTask('а', NOW, { due: day(-1) }), makeTask('б', NOW, { due: day(-3) }), makeTask('в', NOW, { due: TODAY })], TODAY)), /Осталось на сегодня и просрочено: 3 задачи/);
  assert.ok(!/null|undefined|NaN/.test(summaryText(s) + briefText(dayBrief(all, TODAY))));
});

test('«когда есть 10 минут»: быстрые дела по меткам, минимумы привычек, карточки', () => {
  assert.ok(QUICK_RE.test('Позвонить в банк #быстро') && QUICK_RE.test('#10мин оплатить') && QUICK_RE.test('ответить #5м') && !QUICK_RE.test('купить #быстрорастворимый') && !QUICK_RE.test('быстро сделать'));
  const evs = [makeTask('Позвонить в банк #быстро', NOW, { due: TODAY }), makeTask('Большой отчёт', NOW + 1), makeTask('#10мин Оплатить интернет', NOW + 2, { priority: 'high' }), makeHabit({ name: 'Вода', minimum: 'один глоток' }, NOW - 40 * 86400000)];
  const t = tenMinutes(evs, TODAY);
  assert.deepEqual(t.tasks, ['Оплатить интернет', 'Позвонить в банк'], 'метка убрана из текста, важное раньше'); assert.equal(t.tasksTotal, 2);
  assert.deepEqual(t.habits, [{ name: 'Вода', minimum: 'один глоток' }]);
  assert.deepEqual(tenText(t), ['Дело: Оплатить интернет', 'Дело: Позвонить в банк', 'Привычка, минимум: Вода (один глоток)']);
  assert.deepEqual(tenMinutes([], TODAY), { tasks: [], tasksTotal: 0, habits: [], cards: 0 });
  const sick = startSick(evs, {}, NOW);
  assert.deepEqual(tenMinutes([...evs, sick], TODAY).habits, [], 'в болезни привычки не предлагаем');
});

test('разнообразие недели: семь областей, достижение с четырёх', () => {
  const done = makeTask('сделано', NOW - 3 * 86400000), { updated } = completeTask(done, NOW - 2 * 86400000);
  const h = makeHabit({ name: 'Вода' }, NOW - 40 * 86400000);
  const evs = [updated, makeHabitLog(h, day(-1), 'full', NOW), makeLessonDone(english, english.lessons[0], day(-3), NOW), makeCheckin('e', day(-1), { mood: 4, exercise: 30 }, '', NOW)];
  const v = variety(evs, TODAY);
  assert.deepEqual(v.areas, ['Дела', 'Привычки', 'Учёба', 'Движение', 'Дневник']); assert.deepEqual(v.missing, ['Фокус', 'Люди']); assert.equal(v.count, 5); assert.equal(v.reached, true); assert.equal(v.total, VARIETY_AREAS.length);
  assert.deepEqual(variety([updated, makeSpeak({ lang: 'english', seconds: 600, date: day(-1) }, 1)], TODAY).areas, ['Дела', 'Учёба']); assert.equal(variety([updated], TODAY).reached, false);
  assert.equal(variety([makeCheckin('e', day(-9), { mood: 4 }, '', NOW)], TODAY).count, 0, 'старше недели не считается');
  assert.deepEqual(weekReview(evs, TODAY).variety, v);
  const focusAndPeople = variety([makeFocus({ date: day(0), minutes: 25, label: 'х' }, NOW), { id: 'p', type: 'person', ts: 1, payload: { name: 'А', lastContact: day(-2) } }], TODAY);
  assert.deepEqual(focusAndPeople.areas, ['Фокус', 'Люди']);
});

test('итоги месяца: время на учёбу, фокус и тренировки', () => {
  const lesson = english.lessons[0];
  const evs = [makeLessonDone(english, lesson, '2026-11-05', NOW), makeSpeak({ lang: 'english', seconds: 1200, date: '2026-11-06' }, 1), makeFocus({ date: '2026-11-07', minutes: 50, label: 'х' }, NOW), makeFocus({ date: '2026-10-07', minutes: 99, label: 'х' }, NOW)];
  const md = monthReport(evs, '2026-11', { now: NOW });
  assert.match(md, /## Время на главное/); assert.match(md, new RegExp(`- Учёба: ${lesson.minutes + 20} мин`)); assert.match(md, /- Фокус: 50 мин/); assert.match(md, /- Тренировки: 0 мин/);
  assert.ok(!/## Время на главное/.test(monthReport([], '2026-11', { now: NOW })));
});
