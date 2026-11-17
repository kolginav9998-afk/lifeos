// «Самое полезное прямо сейчас»: выбор главной кнопки экрана «Сегодня» и тёплая карточка «Всё сделано».
import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, makeTask, completeTask } from '../events.js';
import { makeHabit, makeHabitLog } from '../habits.js';
import { makeCheckin } from '../diary.js';
import { makeJoy } from '../reflect.js';
import { startSick } from '../sick.js';
import { bestAction, warmCard, allDone } from '../today-action.js';

const TODAY = '2026-11-14', NOW = new Date('2026-11-14T08:00:00').getTime(), day = n => addDays(TODAY, n);   // 14 ноября 2026 — суббота
const morning = (date = TODAY) => makeCheckin('m', date, { mood: 4 }, '', NOW);
const evening = (date = TODAY) => makeCheckin('e', date, { mood: 4 }, '', NOW);

test('просроченные дела — самое срочное: предлагаем перенос, с счётом и склонением', () => {
  const evs = [makeTask('Сдать отчёт', NOW, { due: day(-2) }), makeTask('Важное', NOW + 1, { priority: 'high' })];
  const a = bestAction(evs, TODAY, { hour: 10 });
  assert.equal(a.kind, 'overdue'); assert.equal(a.count, 1); assert.equal(a.label, 'Перенести 1 просроченную задачу');
  assert.match(a.why, /ждут дольше всего/);
  const two = bestAction([makeTask('а', NOW, { due: day(-1) }), makeTask('б', NOW + 1, { due: day(-3) }), morning()], TODAY, { hour: 10 });
  assert.equal(two.label, 'Перенести 2 просроченные задачи');
  const five = bestAction(Array.from({ length: 5 }, (_, i) => makeTask(`д${i}`, NOW + i, { due: day(-1) })), TODAY, { hour: 10 });
  assert.equal(five.label, 'Перенести 5 просроченных задач');
});

test('без просрочки и без утренней отметки — «Отметить утро»', () => {
  const a = bestAction([makeTask('Купить хлеб', NOW, { due: TODAY }), morning(day(-1))], TODAY, { hour: 10 });
  assert.equal(a.kind, 'morning'); assert.equal(a.label, 'Отметить утро');
});

test('после отметки утра — главное дело дня (важная задача)', () => {
  const main = makeTask('Позвонить маме', NOW, { priority: 'high' });
  const evs = [morning(), main, makeTask('Разобрать почту', NOW + 1)];
  const a = bestAction(evs, TODAY, { hour: 10 });
  assert.equal(a.kind, 'main'); assert.equal(a.taskId, main.id); assert.equal(a.label, 'Главное дело: Позвонить маме');
  const long = makeTask('очень '.repeat(20) + 'длинное дело', NOW, { priority: 'high' });
  assert.ok(bestAction([morning(), long], TODAY, { hour: 10 }).label.endsWith('…'), 'длинный текст сокращаем');
});

test('минимум привычек: только если запланированы и ни одна не начата; болезнь ставит на паузу', () => {
  const h = makeHabit({ name: 'Вода' }, NOW - 40 * 86400000);
  const a = bestAction([morning(), h], TODAY, { hour: 10 });
  assert.equal(a.kind, 'habits'); assert.equal(a.count, 1);
  assert.equal(bestAction([morning(), h, makeHabitLog(h, TODAY, 'min', NOW)], TODAY, { hour: 10 }).kind, 'alldone', 'привычка уже начата — минимум не предлагаем');
  const sick = startSick([morning(), h], {}, NOW);
  assert.equal(bestAction([morning(), h, sick], TODAY, { hour: 10 }), null, 'в режиме болезни привычки не предлагаем');
  const mwf = makeHabit({ name: 'Зарядка', days: [1, 3, 5] }, NOW - 40 * 86400000);
  assert.equal(bestAction([morning(), mwf], TODAY, { hour: 10 }), null, 'не по расписанию сегодня — не предлагаем');
});

test('вечером (с 18:00) без вечерней отметки — «Подвести итог дня»', () => {
  const evs = [morning(), makeTask('Купить хлеб', NOW)];
  assert.equal(bestAction(evs, TODAY, { hour: 12 }), null, 'днём итог не предлагаем');
  assert.equal(bestAction(evs, TODAY, { hour: 18 }).kind, 'evening');
  assert.equal(bestAction([...evs, evening()], TODAY, { hour: 21 }), null, 'итог уже подведён');
});

test('«Всё сделано»: кольцо закрыто — ни дел, ни привычек на сегодня не осталось', () => {
  const t1 = makeTask('Купить хлеб', NOW, { due: TODAY }), t2 = makeTask('Позвонить маме', NOW + 1);
  const h = makeHabit({ name: 'Вода' }, NOW - 40 * 86400000);
  const done1 = completeTask(t1, NOW + 1000).updated, done2 = completeTask(t2, NOW + 2000).updated;
  const evs = [morning(), evening(), done1, done2, h, makeHabitLog(h, TODAY, 'full', NOW)];
  assert.equal(allDone(evs, TODAY), true);
  assert.equal(bestAction(evs, TODAY, { hour: 20 }).kind, 'alldone');
  assert.equal(bestAction(evs, TODAY, { hour: 10 }).kind, 'alldone', 'не только вечером');
  assert.equal(allDone([morning(), evening()], TODAY), false, 'нечего было закрывать — не «всё сделано»');
  assert.equal(allDone([...evs, makeTask('Осталось', NOW, { due: TODAY })], TODAY), false, 'осталось дело на сегодня');
  assert.equal(allDone([...evs, makeTask('На завтра', NOW, { due: day(1) })], TODAY), true, 'дело на завтра кольцо не держит');
});

test('тёплая карточка: радость из копилки — одна и та же весь день', () => {
  const evs = [makeJoy({ text: 'Тёплый чай на балконе', date: day(-5) }, NOW), makeJoy({ text: 'Звонок от старого друга', date: day(-2) }, NOW + 1), makeJoy({ text: 'Первый снег', date: day(-1) }, NOW + 2)];
  const w1 = warmCard(evs, TODAY), w2 = warmCard(evs, TODAY);
  assert.equal(w1.kind, 'joy'); assert.deepEqual(w1, w2, 'детерминированно по дате');
  assert.ok(['Тёплый чай на балконе', 'Звонок от старого друга', 'Первый снег'].includes(w1.text));
  assert.deepEqual(warmCard(evs, day(1)), warmCard(evs, day(1)), 'и на другой день тоже стабильно');
});

test('тёплая карточка без радостей: строка-факт дня с правильными склонениями', () => {
  const t1 = makeTask('Купить хлеб', NOW, { due: TODAY }), t2 = makeTask('Позвонить маме', NOW + 1), t3 = makeTask('Отчёт', NOW + 2, { due: TODAY }), t4 = makeTask('Почта', NOW + 3, { due: TODAY });
  const done = [t1, t2, t3, t4].map((t, i) => completeTask(t, NOW + 1000 + i).updated);
  const h1 = makeHabit({ name: 'Вода' }, NOW - 40 * 86400000), h2 = makeHabit({ name: 'Чтение' }, NOW - 40 * 86400000);
  const evs = [...done, h1, h2, makeHabitLog(h1, TODAY, 'full', NOW), makeHabitLog(h2, TODAY, 'min', NOW)];
  assert.equal(warmCard(evs, TODAY).text, 'Сегодня: 4 дела, 2 привычки — можно отдыхать');
  const one = [completeTask(t1, NOW + 1000).updated];
  assert.equal(warmCard(one, TODAY).text, 'Сегодня: 1 дело — можно отдыхать');
});

test('когда ничего явно полезного нет — кнопки нет, ничего не навязываем', () => {
  const evs = [morning(), evening(), makeTask('Обычное дело', NOW, { due: day(3) })];
  assert.equal(bestAction(evs, TODAY, { hour: 12 }), null);
  assert.equal(bestAction([], TODAY, { hour: 12 }).kind, 'morning', 'новичку полезна отметка утра');
});
