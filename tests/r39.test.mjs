import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS, chainProblems, migrateEvents } from '../migrate.js';
import { TOLERANCE_MS, futureEvents, onOpen, clockHint } from '../devicetime.js';
import { storageStatus } from '../storageinfo.js';
import { dataChecks } from '../datacheck.js';
import { parseImport, serialize, SCHEMA_VERSION } from '../events.js';
import * as syncClock from '../clock.js';
import { addDays, makeTask } from '../events.js';
import { planReminders, allowedTime, HABIT_ID_BASE, EVENING_ID_BASE, BEDTIME_ID_BASE, TASK_ID_BASE, WEEKLY_ID_BASE } from '../reminders.js';
import { makePark, finishPark, parkedOf, parkedDue, parkedLater } from '../parked.js';
import { makeHabit } from '../habits.js';
import { searchEvents } from '../search.js';
import { toMarkdown } from '../export.js';
import { CHANGELOG, unseenChanges } from '../changelog.js';
import { VERSION } from '../version.js';
import { actionDates, activeDays } from '../review.js';
import { makeCheckin, makeDiary, moodHeat } from '../diary.js';
import { makeHabitLog } from '../habits.js';
import { makeRun } from '../bt-core.js';
import { bestResult } from '../bt-analytics.js';
import { restDayHint } from '../hints.js';
import { completeTask } from '../events.js';
import { parseCapture, captureLabel, buildCapture } from '../capture.js';
import { NOTE_TEMPLATES, templateText } from '../notes.js';
import { retentionByInterval, CURVE_BUCKETS, makeSrsEvent, TRACKS, cardsOfTrack } from '../academy.js';
import { newState, INTERVALS } from '../srs.js';
import { MAX_SICK_DAYS as SICK_DAYS } from '../sick.js';
import { daysNeeded, habitMoodLinks, habitMoodInsights } from '../bt-analytics.js';
import { monthReport } from '../reports.js';
import { makeRng } from '../stats.js';
import { makeWish, wishesOf, wishState, resolveWish, wishesReady, wishStats, hoursLeft, WAIT_MS } from '../wishes.js';
import { makeDebt, repayDebt, debtLeft, debtsOf, debtTotals, isOverdue } from '../debts.js';
import { autoSavings, autoText } from '../automation.js';
import { makeExpense, unusualExpense } from '../money.js';
import { updateHabit } from '../habits.js';
import { makeNote, pastNote } from '../notes.js';

const T = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const idKinds = list => [...new Set(list.map(r => (r.id >= WEEKLY_ID_BASE ? 'week' : r.id >= BEDTIME_ID_BASE ? 'bed' : r.id >= EVENING_ID_BASE ? 'evening' : r.id >= HABIT_ID_BASE ? 'habit' : 'task')))].sort();

test('напоминания: тихие часы через полночь, выходные дни, подготовка ко сну не глушится', () => {
  const now = T(2026, 11, 9, 6);                                    // понедельник, 06:00
  const task = makeTask('Позвонить', 1, { due: '2026-11-09' }), habit = { ...makeHabit({ name: 'Зарядка' }, 1), payload: { ...makeHabit({ name: 'Зарядка' }, 1).payload, startDate: '2026-11-01' } };
  const base = { taskHour: 8, habitHour: 20, eveningHour: 22, bedtimeMin: 23 * 60, weeklyHour: -1 };
  const all = planReminders([task, habit], now, base);
  assert.deepEqual(idKinds(all), ['bed', 'evening', 'habit', 'task']);
  const quiet = planReminders([task, habit], now, { ...base, quietFrom: 21, quietTo: 8 });
  assert.deepEqual(idKinds(quiet), ['bed', 'habit', 'task'], 'вечерняя отметка в 22:00 попала в тихие часы и молчит; задачи в 8:00 и привычки в 20:00 остаются; сон не глушится');
  const early = planReminders([task, habit], now, { ...base, taskHour: 7, quietFrom: 21, quietTo: 8 });
  assert.ok(!early.some(r => r.id === TASK_ID_BASE), 'в 7:00 ещё тихо');
  const off = planReminders([task, habit], now, { ...base, daysOff: [0, 6] });                // суббота и воскресенье без уведомлений
  const days = new Set(off.map(r => new Date(r.at).getDay()));
  assert.ok(!days.has(0) && !days.has(6) && days.has(1), 'на выходных ничего, в будни как обычно');
  assert.ok(planReminders([task, habit], now, { ...base, daysOff: [0, 1, 2, 3, 4, 5, 6] }).length === 0, 'выходные каждый день — тишина');
});

test('allowedTime: границы тихих часов', () => {
  const at = (h, m = 0) => ({ id: TASK_ID_BASE, at: T(2026, 11, 10, h, m) });
  const q = { quietFrom: 22, quietTo: 7 };
  assert.equal(allowedTime(at(21, 59), q), true); assert.equal(allowedTime(at(22), q), false); assert.equal(allowedTime(at(3), q), false);
  assert.equal(allowedTime(at(6, 59), q), false); assert.equal(allowedTime(at(7), q), true);
  assert.equal(allowedTime({ id: BEDTIME_ID_BASE + 2, at: T(2026, 11, 10, 23) }, q), true, 'подготовка ко сну исключение');
  assert.equal(allowedTime(at(12), { quietFrom: 1, quietTo: 5 }), true); assert.equal(allowedTime(at(2), { quietFrom: 1, quietTo: 5 }), false, 'тихие часы внутри суток');
  assert.equal(allowedTime(at(3), {}), true, 'без настроек всё разрешено');
  assert.equal(allowedTime({ id: BEDTIME_ID_BASE, at: T(2026, 11, 8, 23) }, { daysOff: [0] }), false, 'выходной глушит и подготовку ко сну');
});

test('отложенные мысли: запись, срок, «разобрал», поиск и экспорт', () => {
  const now = T(2026, 11, 10, 22);
  assert.throws(() => makePark({ text: 'ab' }, now), /несколько слов/); assert.throws(() => makePark({ text: 'Позвонить маме', forDate: '2026-11-01' }, now), /не раньше сегодняшнего/); assert.throws(() => makePark({ text: 'Позвонить маме', forDate: 'завтра' }, now), /неверно/);
  const a = makePark({ text: '  Не забыть про справку  ' }, now), b = makePark({ text: 'Ответить Анне', forDate: '2026-11-13' }, now + 1), c = makePark({ text: 'Подумать про отпуск', forDate: '2026-11-10' }, now + 2);
  assert.equal(a.type, 'parked'); assert.equal(a.payload.text, 'Не забыть про справку'); assert.equal(a.payload.forDate, '2026-11-11', 'по умолчанию на завтра'); assert.equal(a.payload.done, false);
  const evs = [a, b, c];
  assert.deepEqual(parkedOf(evs).map(e => e.payload.forDate), ['2026-11-10', '2026-11-11', '2026-11-13']);
  assert.deepEqual(parkedDue(evs, '2026-11-10').map(e => e.id), [c.id], 'сегодня пора только то, что назначено на сегодня');
  assert.deepEqual(parkedDue(evs, '2026-11-11').map(e => e.id), [c.id, a.id]);
  assert.deepEqual(parkedLater(evs, '2026-11-11').map(e => e.id), [b.id]);
  const done = finishPark(c, T(2026, 11, 11, 9));
  assert.equal(done.payload.done, true); assert.equal(done.payload.doneDate, '2026-11-11'); assert.equal(c.payload.done, false, 'исходная запись не меняется');
  assert.deepEqual(parkedDue([a, b, done], '2026-11-11').map(e => e.id), [a.id], 'разобранное больше не напоминает');
  const found = searchEvents([a], 'справку'); assert.equal(found[0].kind, 'Отложено'); assert.equal(found[0].tab, 'reflect');
  assert.match(toMarkdown([a, done], now), /отложено на 2026-11-11: Не забыть про справку/); assert.match(toMarkdown([done], now), /\(разобрано\)/);
  assert.equal(addDays(a.payload.date, 1), a.payload.forDate);
});

test('что нового: первая запись совпадает с версией, показывается только новое и один раз', () => {
  assert.equal(CHANGELOG[0].version, VERSION, 'при выпуске добавь запись в changelog.js');
  assert.ok(CHANGELOG.every(c => c.items.length >= 2 && c.items.every(t => t.length > 10)));
  assert.equal(new Set(CHANGELOG.map(c => c.version)).size, CHANGELOG.length);
  const cur = CHANGELOG[0].version, prev = CHANGELOG[1].version, old = CHANGELOG.at(-1).version;
  assert.deepEqual(unseenChanges('', cur), [], 'первая установка: ничего не показываем');
  assert.deepEqual(unseenChanges(cur, cur), [], 'уже видел');
  assert.deepEqual(unseenChanges(prev, cur).map(c => c.version), [cur]);
  assert.deepEqual(unseenChanges(old, cur).map(c => c.version), CHANGELOG.slice(0, -1).map(c => c.version), 'пропустил несколько версий: все новые, от новой к старой');
  assert.deepEqual(unseenChanges('R0.1', cur).map(c => c.version), [cur], 'неизвестная прошлая версия: только текущая');
  assert.deepEqual(unseenChanges(prev, 'R9.9'), [], 'версии нет в списке — молчим');
});

test('главная метрика: дни, когда сделано хоть что-то', () => {
  const today = '2026-11-14';
  const h = { ...makeHabit({ name: 'Зарядка' }, 1), payload: { ...makeHabit({ name: 'Зарядка' }, 1).payload, startDate: '2026-11-01' } };
  const task = completeTask(makeTask('Дело', T(2026, 11, 12, 9), {}), T(2026, 11, 12, 10)).updated;
  const evs = [makeHabitLog(h, '2026-11-14', 'min', 1), makeHabitLog(h, '2026-11-13', 'full', 1), task, makeCheckin('m', '2026-11-10', { mood: 3 }, '', 1), makeDiary('2026-11-01', { text: 'х' }, 1), makeDiary('2026-09-01', { text: 'давно' }, 1)];
  assert.deepEqual([...actionDates(evs)].sort(), ['2026-09-01', '2026-11-01', '2026-11-10', '2026-11-12', '2026-11-13', '2026-11-14']);
  assert.deepEqual(activeDays(evs, today), { count: 5, of: 30, streak: 3 }, 'за 30 дней пять дней; подряд 12, 13, 14 ноября');
  assert.equal(activeDays(evs, '2026-11-15').streak, 3, 'сегодня ещё ничего не сделано: серия не сгорела');
  assert.equal(activeDays(evs, '2026-11-16').streak, 0, 'пропущен целый день');
  assert.deepEqual(activeDays([], today), { count: 0, of: 30, streak: 0 });
  assert.equal(activeDays([{ id: 'w', type: 'workout', ts: 1, payload: { date: today, done: false } }], today).count, 0, 'незавершённая тренировка не считается');
});

test('тепловая карта настроения: недели по столбцам, понедельник сверху', () => {
  const today = '2026-11-14';                                          // суббота
  const evs = [makeCheckin('m', '2026-11-14', { mood: 5 }, '', 1), makeCheckin('e', '2026-11-14', { mood: 4 }, '', 1), makeCheckin('m', '2026-11-09', { mood: 1 }, '', 1), makeCheckin('m', '2026-08-31', { mood: 3 }, '', 1)];
  const heat = moodHeat(evs, today);
  assert.equal(heat.length, 12); assert.ok(heat.every(col => col.length === 7));
  const last = heat.at(-1);
  assert.equal(last[0].date, '2026-11-09', 'столбец текущей недели начинается с понедельника'); assert.equal(last[0].level, 1);
  assert.equal(last[5].date, '2026-11-14'); assert.equal(last[5].mood, 4.5); assert.equal(last[5].level, 5, '4,5 округляется до 5');
  assert.ok(last[6].future && last[6].level === 0, 'воскресенье ещё не наступило');
  assert.equal(heat[0][0].date, '2026-08-24', 'первый понедельник — за 11 недель до текущего'); assert.equal(heat[1][0].date, '2026-08-31'); assert.equal(heat[1][0].level, 3);
  assert.equal(heat.flat().filter(c => c.level > 0).length, 3);
});

function runOn(date, median) {
  const [y, m, d] = date.split('-').map(Number);
  return makeRun({ mode: 'quick', startedAt: new Date(y, m - 1, d, 9).getTime(), durationMs: 1000, results: { reaction: { metrics: { n: 5, median, mean: 370, sd: 30, best: 300, lapses: 0, falseStarts: 0 }, ms: 1, trials: [] }, math: { metrics: { n: 12, correct: 10, accuracy: 0.83, meanMs: 3000, perMinute: median / 40, maxLevel: 3 }, ms: 1, trials: [] } } });
}
test('рекорды в тестах: лучший результат с учётом направления показателя', () => {
  assert.equal(bestResult([], 'reaction'), null);
  const runs = [runOn('2026-11-01', 400), runOn('2026-11-02', 330), runOn('2026-11-03', 360)];
  assert.deepEqual(bestResult(runs, 'reaction'), { value: 330, date: '2026-11-02', n: 3 }, 'реакция: чем меньше мс, тем лучше');
  assert.deepEqual(bestResult(runs, 'math'), { value: 10, date: '2026-11-01', n: 3 }, 'счёт: чем больше, тем лучше');
  assert.equal(bestResult(runs, 'stroop'), null, 'теста не было');
});

test('подсказка про день отдыха: несколько вечеров подряд низкий фокус', () => {
  const today = '2026-11-14';
  const ev = (d, focus) => makeCheckin('e', addDays(today, -d), { focus }, '', 1);
  const low = [ev(0, 2), ev(1, 1), ev(2, 2), ev(3, 2)];
  const h = restDayHint(low, today);
  assert.equal(h.days, 4); assert.match(h.text, /4 вечера подряд[\s\S]*усталость[\s\S]*Тяжёлый день/);
  assert.equal(restDayHint([ev(0, 2), ev(1, 3), ev(2, 2), ev(3, 2)], today), null, 'один нормальный день обрывает');
  assert.equal(restDayHint([ev(0, 2), ev(1, 1), ev(3, 2)], today), null, 'нет отметки за день — нет подсказки');
  assert.equal(restDayHint(low.slice(0, 3), today), null, 'мало дней');
  assert.equal(restDayHint([], today), null);
});

test('слово одной фразой: «слово: take off — взлетать» → карточка для повторения', () => {
  const c = parseCapture('слово: take off — взлетать');
  assert.deepEqual(c, { kind: 'card', data: { q: 'take off', a: 'взлетать' }, confidence: 'high' });
  assert.equal(captureLabel(c), 'карточку «take off» → «взлетать»');
  const ev = buildCapture(c, { now: 5 });
  assert.equal(ev.type, 'ucard'); assert.equal(ev.payload.q, 'take off'); assert.equal(ev.payload.a, 'взлетать');
  for (const phrase of ['слово: Quay = набережная', 'Слово - apple - яблоко', 'карточка: Столица Франции — Париж', 'word: cat — кошка']) assert.equal(parseCapture(phrase)?.kind, 'card', phrase);
  assert.notEqual(parseCapture('слово: apple')?.kind, 'card', 'без перевода это не карточка');
  assert.equal(parseCapture('потратил 350 на кофе').kind, 'expense', 'остальные правила не пострадали');
  assert.equal(parseCapture('заметка: купить хлеб').kind, 'note');
  assert.match(captureLabel(parseCapture('слово: ' + 'длинное'.repeat(10) + ' — ' + 'перевод'.repeat(10))), /…/);
});

test('заготовки заметок: план на 12 недель, правило тарелки, процесс, риски, портфолио', () => {
  for (const id of ['english12', 'plate', 'process', 'risks', 'portfolio']) assert.ok(NOTE_TEMPLATES.some(t => t.id === id), id);
  assert.equal(new Set(NOTE_TEMPLATES.map(t => t.id)).size, NOTE_TEMPLATES.length);
  const e = templateText('english12', '2026-11-14');
  assert.match(e, /^Английский на 12 недель: старт 2026-11-14/); for (const w of ['Недели 1–2', 'Недели 11–12', 'Контрольная точка (конец недели 4)', 'Контрольная точка (конец недели 12)']) assert.ok(e.includes(w), w);
  assert.match(templateText('plate', 'd'), /половина тарелки[\s\S]*не диета/); assert.match(templateText('risks', 'd'), /вероятность 1–5/); assert.match(templateText('portfolio', 'd'), /Результат в цифрах/); assert.match(templateText('process', 'd'), /#процесс/);
});

test('кривая забывания: промежутки между ответами и доля «помню»', () => {
  const en = TRACKS[0], cards = cardsOfTrack(en).filter(c => c.kind === 'deck').slice(0, 3);
  const st = (c, hist) => makeSrsEvent({ ...newState(c.id, '2026-10-01'), hist }, 1);
  const evs = [st(cards[0], [['2026-10-01', 0], ['2026-10-02', 2], ['2026-10-05', 2], ['2026-10-20', 1]]), st(cards[1], [['2026-10-01', 2], ['2026-10-02', 0], ['2026-12-10', 2]]), st(cards[2], [['2026-10-03', 2]])];
  const r = retentionByInterval(evs);
  const by = Object.fromEntries(r.map(b => [b.label, [b.n, b.ok]]));
  assert.deepEqual(by, { '1 день': [2, 1], '2–3 дня': [1, 1], '15–30 дней': [1, 1], 'больше месяца': [1, 1] });
  assert.equal(r.find(b => b.label === '1 день').rate, 0.5);
  assert.deepEqual(retentionByInterval([], 'english'), []); assert.deepEqual(retentionByInterval(evs, 'hebrew'), [], 'карточки другого курса не считаются');
  assert.equal(retentionByInterval(evs, 'english').reduce((n, b) => n + b.n, 0), 5, 'всего пять пар ответов');
  assert.equal(CURVE_BUCKETS.length, 6);
});

test('мощность вывода: сколько дней нужно для связи заданной силы', () => {
  assert.equal(daysNeeded(0.3), 85); assert.equal(daysNeeded(-0.3), 85, 'знак не важен'); assert.equal(daysNeeded(0.6), 20); assert.ok(daysNeeded(0.1) > 700);
  assert.equal(daysNeeded(0), null); assert.ok(daysNeeded(1) > 3, 'ρ = 1 не ломает расчёт');
});

test('привычки и настроение: связь находится, шум и малые группы нет', () => {
  const today = '2026-11-14', rng = makeRng(8);
  const h = { ...makeHabit({ name: 'Прогулка' }, 1), payload: { ...makeHabit({ name: 'Прогулка' }, 1).payload, startDate: '2026-08-01' } };
  const build = effect => { const evs = [h]; for (let i = 0; i < 50; i++) { const d = addDays(today, -i), did = i % 2 === 0; if (did) evs.push(makeHabitLog(h, d, 'min', 1)); evs.push(makeCheckin('m', d, { mood: Math.max(1, Math.min(5, Math.round(3 + (did ? effect : 0) + (rng() - 0.5)))) }, '', 1)); } return evs; };
  const strong = build(1.2);
  const [l] = habitMoodLinks(strong, today);
  assert.equal(l.name, 'Прогулка'); assert.equal(l.nWith, 25); assert.equal(l.nWithout, 25); assert.ok(l.diff > 0.7 && l.p < 0.01, `diff ${l.diff}, p ${l.p}`);
  const ins = habitMoodInsights(strong, today);
  assert.equal(ins.length, 1); assert.equal(ins[0].kind, 'relation'); assert.match(ins[0].text, /настроение в среднем выше на \d,\d из 5[\s\S]*дней: 25 и 25[\s\S]*а не причина/);
  assert.deepEqual(habitMoodInsights(build(0), today), [], 'без эффекта молчим');
  assert.deepEqual(habitMoodLinks([h, ...strong.filter(e => e.type === 'checkin').slice(0, 10)], today), [], 'мало дней в группах');
});

test('месячный отчёт: наблюдения аналитики с осторожным пояснением', () => {
  const now = T(2026, 11, 20), today = '2026-11-20', rng = makeRng(3);
  const evs = [];
  for (let i = 0; i < 20; i++) { const d = addDays(today, -i), sleep = 5 + rng() * 4; evs.push(makeCheckin('m', d, { sleepHours: Math.round(sleep * 4) / 4, mood: 3 }, '', 1)); }
  const md = monthReport(evs, '2026-11', { now });
  assert.doesNotMatch(md, /Что заметила аналитика/, 'без проверок выводов нет');
});

test('отсрочка покупок: сутки ожидания, решение, сохранённые деньги', () => {
  const now = T(2026, 11, 10, 20);
  assert.throws(() => makeWish({ text: 'ab' }, now), /что хочешь купить/); assert.throws(() => makeWish({ text: 'Наушники', amountMinor: 0 }, now), /Сумма больше нуля/);
  const w = makeWish({ text: '  Новые наушники ', amountMinor: 450000 }, now), free = makeWish({ text: 'Книга про данные' }, now + 1);
  assert.equal(w.type, 'wish'); assert.equal(w.payload.text, 'Новые наушники'); assert.equal(w.payload.until - now, WAIT_MS); assert.equal(w.payload.status, 'wait'); assert.equal(free.payload.amountMinor, null);
  assert.equal(wishState(w, now + 3600000), 'wait'); assert.equal(hoursLeft(w, now + 3600000), 23); assert.equal(wishState(w, now + WAIT_MS), 'ready'); assert.equal(hoursLeft(w, now + WAIT_MS + 1), 0);
  assert.deepEqual(wishesReady([w, free], now + WAIT_MS).map(x => x.id), [w.id], 'ровно через сутки готово только первое (второе создано на миллисекунду позже)');
  assert.deepEqual(wishesReady([w, free], now + WAIT_MS + 1).map(x => x.id), [free.id, w.id], 'потом оба, новые сверху'); assert.deepEqual(wishesOf([w, free]).map(x => x.id), [free.id, w.id]);
  const later = now + WAIT_MS + 5000;
  const dropped = resolveWish(w, 'dropped', later), bought = resolveWish(free, 'bought', later);
  assert.equal(wishState(dropped, later), 'dropped'); assert.equal(wishState(bought, later), 'bought'); assert.equal(w.payload.status, 'wait', 'исходная запись не меняется');
  assert.throws(() => resolveWish(dropped, 'bought'), /Уже решено/); assert.throws(() => resolveWish(w, 'maybe'), /bad status/);
  assert.deepEqual(wishStats([dropped, bought], '2026-11'), { count: 1, savedMinor: 450000 }); assert.deepEqual(wishStats([dropped], '2026-10'), { count: 0, savedMinor: 0 });
});

test('долги и займы: возвраты частями, итоги, просрочка', () => {
  const now = T(2026, 11, 10);
  assert.throws(() => makeDebt({ who: ' ', amountMinor: 100, direction: 'owe_me' }, now), /кто это/); assert.throws(() => makeDebt({ who: 'Анна', amountMinor: 0, direction: 'owe_me' }, now), /Сумма/);
  assert.throws(() => makeDebt({ who: 'Анна', amountMinor: 100, direction: 'x' }, now), /мне должны или я должен/); assert.throws(() => makeDebt({ who: 'Анна', amountMinor: 100, direction: 'owe_me', due: 'скоро' }, now), /Срок/);
  const a = makeDebt({ who: 'Анна', amountMinor: 500000, direction: 'owe_me', due: '2026-11-05', note: 'за билеты' }, now), b = makeDebt({ who: 'Борис', amountMinor: 200000, direction: 'i_owe', due: '2026-12-01' }, now + 1);
  assert.equal(debtLeft(a), 500000); assert.equal(a.payload.settled, false);
  const part = repayDebt(a, 150000, now); assert.equal(debtLeft(part), 350000); assert.equal(part.payload.settled, false);
  assert.throws(() => repayDebt(part, 400000), /Больше, чем осталось/); assert.throws(() => repayDebt(part, 0), /Сумма/);
  const closed = repayDebt(part, 350000, T(2026, 11, 12)); assert.equal(closed.payload.settled, true); assert.equal(closed.payload.settledDate, '2026-11-12'); assert.equal(debtLeft(closed), 0);
  const tot = debtTotals([part, b], '2026-11-10');
  assert.deepEqual([tot.owedToMe, tot.iOwe, tot.open, tot.overdue.map(d => d.payload.who)], [350000, 200000, 2, ['Анна']]);
  assert.equal(isOverdue(b, '2026-11-10'), false); assert.equal(isOverdue(closed, '2026-11-20'), false, 'закрытый не бывает просроченным');
  assert.deepEqual(debtsOf([closed, b, part]).map(d => d.payload.who), ['Анна', 'Борис', 'Анна'], 'открытые сначала, по сроку; закрытые в конце');
});

test('калькулятор автоматизации: часы, деньги, окупаемость, проверки ввода', () => {
  const r = autoSavings({ minutes: 15, perWeek: 10, people: 3, buildHours: 20, hourlyRate: 500 });
  assert.equal(r.hoursWeek, 7.5); assert.equal(r.hoursYear, 390); assert.equal(r.moneyYear, 195000); assert.ok(Math.abs(r.paybackWeeks - 20 / 7.5) < 1e-9); assert.equal(r.verdict, 'стоит делать');
  assert.equal(autoText(r), 'Экономия: 7,5 ч в неделю, 390 ч в год. В деньгах около 195 000 ₽ в год. Настройка (20 ч) окупится примерно за 3 нед. Вывод: стоит делать.');
  const slow = autoSavings({ minutes: 2, perWeek: 1, buildHours: 40 });
  assert.ok(slow.paybackWeeks > 52); assert.equal(slow.verdict, 'за год не окупится'); assert.match(autoText(slow), /за год не окупится/);
  assert.equal(autoSavings({ minutes: 10, perWeek: 6, buildHours: 0 }).paybackWeeks, 0); assert.match(autoText(autoSavings({ minutes: 10, perWeek: 6 })), /Настройка бесплатна/);
  assert.equal(autoSavings({ minutes: '7,5', perWeek: '4', people: '2' }).hoursWeek, 1);
  assert.throws(() => autoSavings({ minutes: 0, perWeek: 3 }), /Минут на операцию/); assert.throws(() => autoSavings({ minutes: 5, perWeek: 3, people: 0 }), /Сколько человек/); assert.throws(() => autoSavings({ minutes: 5, perWeek: 3, buildHours: -1 }), /Часов на настройку/);
  assert.equal(autoSavings({ minutes: 5, perWeek: 3, buildHours: 1 }).verdict, 'стоит делать');
});

test('необычно крупная трата: сравнение с обычным для категории', () => {
  const now = T(2026, 11, 14), mk = (amount, date, cat = 'Еда', k = 0) => makeExpense({ amount, category: cat, date }, now + k);
  const base = [30000, 35000, 40000, 32000, 38000, 36000].map((a, i) => mk(a, addDays('2026-11-14', -(i + 1) * 3), 'Еда', i));        // медиана около 357 ₽
  const big = mk(200000, '2026-11-14', 'Еда', 10), ok = mk(100000, '2026-11-14', 'Еда', 11);
  const u = unusualExpense([...base, big], big);
  assert.ok(u && u.count === 6 && u.median >= 35000 && u.median <= 36000, JSON.stringify(u));
  assert.equal(unusualExpense([...base, ok], ok), null, '1000 ₽ ещё в пределах трёх обычных трат');
  assert.equal(unusualExpense([...base.slice(0, 4), big], big), null, 'меньше пяти прежних трат — не судим');
  assert.equal(unusualExpense([...base, mk(200000, '2026-11-14', 'Транспорт', 20)], mk(200000, '2026-11-14', 'Транспорт', 20)), null, 'другая категория без истории');
  const small = mk(20000, '2026-11-14', 'Еда', 30);
  assert.equal(unusualExpense([...base, small], small), null);
  const old = [30000, 30000, 30000, 30000, 30000].map((a, i) => mk(a, addDays('2026-11-14', -200 - i), 'Еда', 40 + i));
  assert.equal(unusualExpense([...old, big], big), null, 'траты старше 90 дней не считаются');
});

test('привычка: план «если помешает — то», правка не стирает', () => {
  const h = makeHabit({ name: 'Зарядка', plan: '  Если нет времени, то хотя бы 5 приседаний  ' }, 1);
  assert.equal(h.payload.plan, 'Если нет времени, то хотя бы 5 приседаний'); assert.equal(makeHabit({ name: 'Чтение' }, 1).payload.plan, '');
  assert.equal(updateHabit(h, { name: 'Зарядка', anchor: '', minimum: '', full: '' }).payload.plan, h.payload.plan, 'без поля plan прежний план сохраняется');
  assert.equal(updateHabit(h, { name: 'Зарядка', anchor: '', minimum: '', full: '', plan: '' }).payload.plan, '', 'пустая строка очищает');
  assert.equal(makeHabit({ name: 'х', plan: 'я'.repeat(500) }, 1).payload.plan.length, 200);
});

test('случайная заметка из прошлого: только старше 30 дней, выбор по числу', () => {
  const now = T(2026, 11, 14);
  const n = (text, daysAgo) => makeNote(text, now - daysAgo * 86400000);
  const notes = [n('свежая', 3), n('месяц назад', 31), n('давно', 200), n('очень давно', 400)];
  assert.equal(pastNote([], now), null); assert.equal(pastNote([notes[0]], now), null, 'свежих не предлагаем');
  assert.deepEqual([0, 1, 2, 3, 4].map(i => pastNote(notes, now, i).payload.text), ['очень давно', 'давно', 'месяц назад', 'очень давно', 'давно']);
  assert.equal(pastNote(notes, now, -1).payload.text, 'давно', 'отрицательное число не ломает выбор');
});

// ---------- миграции формата ----------
const ev = (id, type = 'foo', payload = { x: 1 }, ts = 1) => ({ id, type, ts, payload, source: 'manual', confidence: 1, evidence: [] });
const M12 = { from: 1, to: 2, note: 'x → y', up: es => es.map(e => (e.type === 'foo' ? { ...e, payload: { y: e.payload.x } } : e)) };
const M23 = { from: 2, to: 3, note: 'y удвоен', up: es => es.map(e => (e.type === 'foo' ? { ...e, payload: { y: e.payload.y * 2 } } : e)) };

test('миграции: цепочка без дыр, текущая схема покрыта', () => {
  assert.deepEqual(chainProblems(MIGRATIONS, SCHEMA_VERSION), [], 'поднял SCHEMA_VERSION — напиши миграцию в migrate.js');
  assert.deepEqual(chainProblems([M12, M23], 3), []);
  assert.match(chainProblems([M12], 3).join(), /нет миграции 2→3/);
  assert.match(chainProblems([M12, { ...M12 }], 2).join(), /две миграции с версии 1/);
  assert.match(chainProblems([{ from: 1, to: 3, up: x => x }], 3).join(), /ровно на одну версию/);
  assert.match(chainProblems([{ from: 1, to: 2 }], 2).join(), /нет функции up/);
  assert.match(chainProblems([M12, M23], 2).join(), /с версии 2 лишняя/);
});

test('миграции: применяются по порядку, исходные записи не меняются', () => {
  const src = [ev('a'), ev('b', 'bar', { z: 1 })];
  const frozen = JSON.stringify(src);
  const r = migrateEvents(src, 1, 3, [M23, M12]);                      // порядок в списке не важен
  assert.deepEqual(r.events.map(e => e.payload), [{ y: 2 }, { z: 1 }]);
  assert.deepEqual(r.applied, [{ from: 1, to: 2, note: 'x → y' }, { from: 2, to: 3, note: 'y удвоен' }]);
  assert.equal(JSON.stringify(src), frozen, 'исходный массив не тронут');
  assert.deepEqual(migrateEvents(src, 2, 3, [M12, M23]).events[0].payload, { y: NaN }, 'с версии 2 применяется только вторая миграция');
  assert.deepEqual(migrateEvents(src, 3, 3, []).applied, [], 'та же версия — ничего не делаем');
  assert.deepEqual(migrateEvents(src, undefined, 2, [M12]).applied.length, 1, 'нет поля schema — считаем первой');
  assert.throws(() => migrateEvents(src, 4, 3, []), /новее приложения/);
  assert.throws(() => migrateEvents(src, 1, 3, [M12]), /нет миграции с версии 2 на 3/);
  assert.throws(() => migrateEvents(src, 1, 2, [{ ...M12, up: () => 'не список' }]), /вернула не список/);
});

test('импорт копии: старая схема приводится к текущей, мусор до и после миграции считается', () => {
  const file = (schema, events) => JSON.stringify({ app: 'lifeos', ...(schema === undefined ? {} : { schema }), exportedAt: 1, events });
  const evs = [ev('a'), { id: '', type: 'foo' }, ev('c', 'bar', { z: 3 })];
  const r = parseImport(file(1, evs), { schemaVersion: 3, migrations: [M12, M23] });
  assert.deepEqual(r.events.map(e => [e.id, e.payload]), [['a', { y: 2 }], ['c', { z: 3 }]]);
  assert.equal(r.skipped, 1); assert.equal(r.migrated.length, 2);
  assert.equal(parseImport(file(undefined, [ev('a')]), { schemaVersion: 2, migrations: [M12] }).events[0].payload.y, 1, 'самая первая копия без schema');
  const same = parseImport(file(3, [ev('a')]), { schemaVersion: 3, migrations: [M12, M23] });
  assert.deepEqual(same.migrated, []); assert.deepEqual(same.events[0].payload, { x: 1 }, 'текущая схема не трогается');
  assert.throws(() => parseImport(file(4, []), { schemaVersion: 3 }), /более новой версией/);
  assert.throws(() => parseImport(file(1, [ev('a')]), { schemaVersion: 3, migrations: [M12] }), /Не удалось привести копию к текущему формату: нет миграции с версии 2 на 3/);
  const broken = { from: 1, to: 2, up: es => [...es, { id: 'bad' }, { ...es[0], id: 'ok', type: 'Bad Type' }] };       // миграция нарушила правила записей
  const rb = parseImport(file(1, [ev('a')]), { schemaVersion: 2, migrations: [broken] });
  assert.deepEqual(rb.events.map(e => e.id), ['a']); assert.equal(rb.skipped, 2);
  assert.deepEqual(parseImport(serialize([ev('z')], 5)).migrated, [], 'обычная копия текущей версии');
});

// ---------- часы и место ----------
test('часы устройства: записи из будущего, откат времени назад, подсказка', () => {
  const now = Date.UTC(2026, 10, 10, 12), H = 3600000, D = 24 * H;
  const evs = [ev('a', 'x', {}, now - D), ev('b', 'x', {}, now + 5 * 60000), ev('c', 'x', {}, now + 3 * H), ev('d', 'x', {}, now + 3 * D)];
  assert.deepEqual(futureEvents(evs, now).map(e => e.id), ['c', 'd'], 'запас 10 минут на неточность часов');
  assert.equal(TOLERANCE_MS, 600000);
  assert.equal(clockHint({ events: evs.slice(0, 2), now }), null);
  const f = clockHint({ events: evs, now });
  assert.equal(f.kind, 'future'); assert.equal(f.count, 2); assert.equal(f.ms, 3 * D); assert.match(f.text, /записи из будущего: 2 \(самая дальняя — через 3 дн\.\)/); assert.match(f.text, /настройках телефона/);
  assert.match(clockHint({ events: [ev('c', 'x', {}, now + 3 * H)], now }).text, /через 3 ч\)/);
  // откат назад
  assert.deepEqual(onOpen({ lastOpenTs: now - H }, now), { lastOpenTs: now, backFrom: 0 }, 'время идёт вперёд');
  const back = onOpen({ lastOpenTs: now + 2 * H }, now);
  assert.deepEqual(back, { lastOpenTs: now, backFrom: now + 2 * H });
  assert.deepEqual(onOpen({ lastOpenTs: now, backFrom: now + 2 * H }, now + H), { lastOpenTs: now + H, backFrom: now + 2 * H }, 'отметка держится, пока часы не догонят');
  assert.deepEqual(onOpen({ lastOpenTs: now + H, backFrom: now + 2 * H }, now + 2 * H + 1), { lastOpenTs: now + 2 * H + 1, backFrom: 0 }, 'догнали — отметка снята');
  assert.deepEqual(onOpen({ lastOpenTs: now - 5 * 60000 + 1 }, now - 10 * 60000), { lastOpenTs: now - 10 * 60000, backFrom: 0 }, 'меньше десяти минут не считаем');
  const hb = clockHint({ events: [], now, backFrom: now + 5 * H });
  assert.equal(hb.kind, 'back'); assert.match(hb.text, /примерно на 5 ч раньше/);
  assert.equal(clockHint({ events: [], now, backFrom: now + 5 * 60000 }), null);
  // проверка данных тоже предупреждает
  const checks = dataChecks(evs, '2026-11-10', now);
  assert.equal(checks.find(c => c.id === 'clock-future').level, 'warn'); assert.match(checks.find(c => c.id === 'clock-future').text, /Записей «из будущего»: 2/);
  assert.equal(dataChecks(evs.slice(0, 2), '2026-11-10', now).some(c => c.id === 'clock-future'), false);
});

test('место на устройстве: уровни по свободному месту и доле', () => {
  const MB = 1024 * 1024;
  assert.equal(storageStatus(), null); assert.equal(storageStatus({ usage: 5, quota: 0 }), null); assert.equal(storageStatus({ usage: -1, quota: 100 }), null); assert.equal(storageStatus({ usage: 1, quota: NaN }), null);
  const ok = storageStatus({ usage: 20 * MB, quota: 5000 * MB });
  assert.equal(ok.level, 'ok'); assert.equal(ok.text, ''); assert.equal(ok.line, 'Занято приложением: 20 МБ, свободно около 4980 МБ');
  assert.equal(storageStatus({ usage: 4900 * MB, quota: 5000 * MB }).level, 'low', 'свободно 100 МБ, но занято 98%');
  assert.equal(storageStatus({ usage: 100 * MB, quota: 250 * MB }).level, 'warn', 'свободно 150 МБ');
  assert.equal(storageStatus({ usage: 100 * MB, quota: 700 * MB }).level, 'ok');
  assert.equal(storageStatus({ usage: 8 * MB, quota: 40 * MB }).level, 'low', 'свободно меньше 50 МБ');
  assert.equal(storageStatus({ usage: 500 * MB, quota: 600 * MB }).level, 'warn', 'свободно 100 МБ, доля 83%');
  const low = storageStatus({ usage: 8 * MB, quota: 40 * MB });
  assert.match(low.text, /почти не осталось \(около 32 МБ\)/); assert.match(low.line, /Занято приложением: 8 МБ, свободно около 32 МБ/);
  assert.equal(storageStatus({ usage: 1.5 * MB, quota: 3 * MB }).line, 'Занято приложением: 1,5 МБ, свободно около 1,5 МБ', 'десятичная запятая');
  assert.equal(storageStatus({ usage: 3 * MB, quota: 2 * MB }).freeMb, 0, 'занято больше доступного — свободно ноль');
});

// ---------- диаграммы состояний ----------
test('диаграммы состояний: файл на месте, у каждого блока свой источник в коде', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const md = fs.readFileSync(path.join(root, 'docs', 'STATES.md'), 'utf8');
  const blocks = [...md.matchAll(/```mermaid\n([\s\S]*?)```/g)].map(m => m[1]);
  assert.ok(blocks.length >= 10, `диаграмм: ${blocks.length}`);
  for (const b of blocks) { assert.match(b, /^stateDiagram-v2\n/); assert.match(b, /\[\*\] -->/, 'есть начальное состояние'); assert.ok((b.match(/-->/g) || []).length >= 4, 'не меньше четырёх переходов'); }
  const heads = [...md.matchAll(/^## (.+?) \(`([\w.-]+\.js)`(?:, `([\w.-]+\.js)`)?\)$/gm)];
  assert.ok(heads.length >= 8, 'у каждого раздела указан файл с логикой');
  for (const h of heads) for (const f of h.slice(2).filter(Boolean)) assert.ok(fs.existsSync(path.join(root, f)), `${h[1]}: нет файла ${f}`);
  for (const w of ['Задача', 'Привычка', 'Режим болезни', 'Карточка', 'Решение', 'Желание', 'Долг', 'Отложенная мысль', 'Навык', 'Загрузка архива']) assert.ok(heads.some(h => h[1].startsWith(w)), `нет раздела «${w}»`);
  // вычисляемые вещи в диаграммах не расходятся с кодом
  assert.ok(md.includes(`${INTERVALS.join(', ')} дней`), 'интервалы коробок в документе совпадают с кодом');
  assert.ok(md.includes('30 дней') && SICK_DAYS === 30, 'предел режима болезни совпадает');
});

// Урок R3.9: новый файл `clock.js` однажды затёр логические часы синхронизации. Теперь API проверяется отдельно.
test('логические часы синхронизации (clock.js): файл на месте и работает как раньше', () => {
  for (const k of ['tick', 'observe', 'peek', 'useStorage']) assert.equal(typeof syncClock[k], 'function', `clock.js: нет ${k}`);
  const mem = { m: new Map(), getItem(k) { return this.m.get(k) ?? null; }, setItem(k, v) { this.m.set(k, v); } };
  syncClock.useStorage(mem);
  assert.equal(syncClock.tick(1000), 1000); assert.equal(syncClock.tick(500), 1001, 'часы отстали, метка всё равно растёт');
  syncClock.observe(5000, 1000); assert.equal(syncClock.peek(), 5000);
  syncClock.observe(5000 + 2 * 86400000, 1000); assert.equal(syncClock.peek(), 5000, 'метки из далёкого будущего игнорируются');
  assert.equal(mem.getItem('lifeos.hlc.v1'), '5000', 'значение сохраняется');
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'devicetime.js'), 'utf8');
  assert.ok(!/export (function|const) tick\b/.test(src), 'проверка часов устройства живёт в devicetime.js и не подменяет clock.js');
});
