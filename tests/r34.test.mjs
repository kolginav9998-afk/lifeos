import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFocus, focusMinutes, focusWeek, focusLeft, fmtClock, MIN_SAVE_MIN, PRESETS } from '../focus.js';

const D = n => { const d = new Date(2026, 10, 11 + n, 12); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('фокус: запись сессии, проверки, суммы за день и неделю', () => {
  const a = makeFocus({ date: D(0), minutes: 25, planned: 25, label: '  Отчёт  ' }, 1);
  assert.equal(a.type, 'focus'); assert.equal(a.payload.label, 'Отчёт'); assert.equal(a.payload.completed, true);
  assert.deepEqual(makeFocus({ date: D(0), minutes: 12.4, planned: 25, completed: false }, 2).payload, { date: D(0), minutes: 12, planned: 25, completed: false });
  assert.throws(() => makeFocus({ date: D(0), minutes: 0 }), /Минуты/); assert.throws(() => makeFocus({ date: D(0), minutes: 601 }), /Минуты/); assert.throws(() => makeFocus({ date: 'x', minutes: 5 }), /bad date/);
  const ev = [a, makeFocus({ date: D(0), minutes: 50, planned: 50 }, 3), makeFocus({ date: D(-2), minutes: 25, planned: 25 }, 4), makeFocus({ date: D(-9), minutes: 90, planned: 90 }, 5)];
  assert.equal(focusMinutes(ev, D(0)), 75); assert.equal(focusMinutes(ev, D(-1)), 0);
  assert.deepEqual(focusWeek(ev, D(0)), { minutes: 100, sessions: 3, days: 2 });
  assert.deepEqual(PRESETS, [25, 50, 90]); assert.equal(MIN_SAVE_MIN, 5);
});
test('фокус: оставшееся время считается по часам, а не по тикам', () => {
  const run = { startedAt: 1_000_000, minutes: 25 };
  assert.deepEqual(focusLeft(run, 1_000_000), { leftMs: 1_500_000, done: false, elapsedMin: 0 });
  assert.equal(focusLeft(run, 1_000_000 + 10 * 60000 + 500).elapsedMin, 10);
  const end = focusLeft(run, 1_000_000 + 25 * 60000);
  assert.equal(end.done, true); assert.equal(end.leftMs, 0); assert.equal(end.elapsedMin, 25);
  assert.equal(focusLeft(run, 1_000_000 + 99 * 60000).elapsedMin, 25, 'телефон был в кармане дольше срока — не больше длины сессии');
  assert.equal(fmtClock(1_500_000), '25:00'); assert.equal(fmtClock(61_000), '1:01'); assert.equal(fmtClock(0), '0:00'); assert.equal(fmtClock(59_100), '1:00');
});

import { sleepPanel, monthReport, doctorSummary, REGULARITY_TEXT } from '../reports.js';
import { makeCheckin, makeDiary } from '../diary.js';
import { makeMeasure } from '../health.js';
import { makeExpense, makeIncome } from '../money.js';
import { makeHabit, makeHabitLog } from '../habits.js';
import { makeTask, completeTask } from '../events.js';
import { makeProfile } from '../events.js';
import { startWorkout, addSet, finishWorkout } from '../workouts.js';

const NOW = new Date(2026, 10, 30, 21).getTime();          // 30 ноября 2026
const TODAY = '2026-11-30';
const day = n => { const d = new Date(2026, 10, 30 + n, 12); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

test('панель сна: среднее, долг, регулярность подъёма (и через полночь)', () => {
  const ev = [];
  for (let i = 0; i < 14; i++) ev.push(makeCheckin('m', day(-i), { bed: i % 2 ? '23:30' : '00:20', wake: i % 2 ? '07:00' : '07:10', sleepHours: i < 7 ? 6.5 : 8 }, '', NOW));
  const p = sleepPanel(ev, TODAY, 14, 7);
  assert.equal(p.nights, 14); assert.equal(p.days.length, 14); assert.ok(Math.abs(p.avg - 7.25) < 1e-9);
  assert.equal(p.best, 8); assert.equal(p.worst, 6.5); assert.equal(p.under, 7);
  assert.ok(Math.abs(p.debt - 3.5) < 1e-9, `долг ${p.debt}`);                   // 7 ночей по 6,5 ч при цели 7 ч
  assert.ok(p.wakeSd < 10 && p.regularity === 'stable', `разброс подъёма ${p.wakeSd}`);
  assert.ok(p.bedSd < 60, 'отбой 23:30 и 00:20 — разница 50 минут, а не 23 часа');
  const messy = [];
  for (let i = 0; i < 10; i++) messy.push(makeCheckin('m', day(-i), { wake: ['06:00', '09:30', '07:15', '10:00', '06:30'][i % 5], sleepHours: 7 }, '', NOW));
  assert.equal(sleepPanel(messy, TODAY, 14).regularity, 'irregular');
  const none = sleepPanel([], TODAY, 14);
  assert.equal(none.nights, 0); assert.equal(none.avg, null); assert.equal(none.regularity, null); assert.equal(none.debt, null);
  assert.ok(REGULARITY_TEXT.stable && REGULARITY_TEXT.mid && REGULARITY_TEXT.irregular);
});

function sampleMonth() {
  const ev = [makeProfile('Тест', NOW, null, { heightCm: 180, birthYear: 1990, goalWeight: 70 })];
  const h = makeHabit({ name: 'Зарядка' }, new Date(2026, 9, 1).getTime());
  ev.push(h);
  for (let i = 0; i < 30; i++) {
    const d = day(-i);
    if (i % 2 === 0) ev.push(makeHabitLog(h, d, 'full', NOW));
    ev.push(makeCheckin('m', d, { sleepHours: 7 + (i % 3) * 0.5, wake: '07:00', mood: 4, energy: 3 }, '', NOW));
    if (i % 3 === 0) ev.push(makeCheckin('e', d, { mood: 3, stress: 2, exercise: 30 }, '', NOW));
    if (i % 5 === 0) ev.push(makeDiary(d, { text: `день ${i} #работа #спорт` }, NOW));
    if (i % 4 === 0) ev.push(makeMeasure({ kind: 'weight', value: 73 - i * 0.05, date: d }, NOW));
    if (i % 6 === 0) ev.push(makeMeasure({ kind: 'bp', value: 120 + (i % 4), value2: 80, date: d }, NOW));
    if (i % 6 === 0) ev.push(makeMeasure({ kind: 'pulse', value: 60 + (i % 5), date: d }, NOW));
  }
  ev.push(makeExpense({ amount: '12000', category: 'Жильё', date: day(-3) }, NOW), makeExpense({ amount: '1500', category: 'Еда', date: day(-2) }, NOW), makeIncome({ amount: '90000', category: 'Зарплата', date: day(-5) }, NOW));
  ev.push(makeExpense({ amount: '800', category: 'Еда', date: '2026-10-20' }, NOW));
  ev.push(completeTask(makeTask('сделано 1', NOW), new Date(2026, 10, 15).getTime()).updated, completeTask(makeTask('сделано 2', NOW), new Date(2026, 9, 15).getTime()).updated, makeTask('открытая', NOW));
  let w = startWorkout({ templateId: 'home-a', date: day(-1), now: NOW - 3600000 }); w = addSet(w, 0, { reps: 10 }); ev.push(finishWorkout(w, { now: NOW - 1800000 }));
  return ev;
}
test('отчёт за месяц: разделы, числа, без текстов дневника', () => {
  const ev = sampleMonth();
  const md = monthReport(ev, '2026-11', { now: NOW });
  for (const part of ['# Мой месяц: Ноябрь 2026', '## Задачи', '- Сделано: 1 (в прошлом месяце: 1)', '- Открытых сейчас: 1', '## Привычки', '- Зарядка:', '## Деньги', 'Расходы: 13 500 ₽', 'Доходы: 90 000 ₽', 'Жильё', '## Сон и самочувствие', 'Сон: в среднем', 'Режим: стабильный', 'Настроение:',
    '## Здоровье и движение', 'Вес:', 'Давление: в среднем', 'Активность:', 'Тренировок: 1; силовых дней: 1', '## Дневник', '#работа', '## Мои выводы']) assert.ok(md.replace(/[  ]/g, ' ').includes(part), `нет «${part}»`);
  assert.ok(!md.includes('день 0'), 'тексты записей не попадают в отчёт');
  assert.ok(md.includes('(в прошлом месяце 800') || md.includes('в прошлом месяце 800'), 'сравнение с прошлым месяцем');
  const empty = monthReport([], '2026-11', { now: NOW });
  assert.ok(empty.includes('# Мой месяц: Ноябрь 2026') && empty.includes('- Сделано: 0') && !empty.includes('## Деньги') && !empty.includes('## Привычки'), 'пустые разделы не выводятся');
  const feb = monthReport([], '2026-02', { now: NOW });
  assert.ok(feb.includes('Февраль 2026'));
});
test('сводка для врача: вес, давление, пульс, сон, профиль и оговорка', () => {
  const ev = sampleMonth();
  const md = doctorSummary(ev, TODAY, { now: NOW }).replace(/[  ]/g, ' ');
  for (const part of ['# Сводка для врача: 30 дней до 2026-11-30', 'не диагноз', '## Профиль', 'рост 180 см', 'возраст 36', '## Вес', 'Тренд:', 'ИМТ', '## Давление и пульс', 'Давление: замеров', 'Последние замеры:', 'Пульс: замеров', '## Сон', 'Режим: стабильный', '## Самочувствие',
    '## Что я хочу обсудить', '## Лекарства и добавки']) assert.ok(md.includes(part), `нет «${part}»`);
  assert.ok(!md.includes('день 0'));
  const none = doctorSummary([], TODAY, { now: NOW });
  assert.ok(none.includes('Что я хочу обсудить') && !none.includes('## Вес') && !none.includes('## Сон'));
});

import { makeLimit, limitsOf, limitStatus, makeGoal, makeGoalMove, goalProgress, makeSub, subsOf, nextCharge, monthlyCost, subsTotals, subPayment, forecast, limitId } from '../planning.js';
import { makeBudget } from '../money.js';

const exp = (amount, category, date) => makeExpense({ amount, category, date }, NOW);

test('лимиты: статусы ok / warn / over, категории без лимита идут после', () => {
  const ev = [exp('7000', 'Еда', '2026-11-05'), exp('1500', 'Еда', '2026-11-09'), exp('300', 'Транспорт', '2026-11-03'), exp('900', 'Одежда', '2026-11-04'), exp('5000', 'Еда', '2026-10-30'),
    makeLimit('Еда', 10000_00, 1), makeLimit('Транспорт', 5000_00, 1), makeLimit('Одежда', 800_00, 1), makeLimit('Связь', 700_00, 1)];
  assert.equal(limitsOf(ev).get('Еда'), 1000000); assert.equal(limitId('Еда'), 'limit:Еда');
  const s = limitStatus(ev, '2026-11');
  const by = Object.fromEntries(s.map(x => [x.category, x]));
  assert.equal(by['Еда'].status, 'warn', '85% лимита — уже предупреждение'); assert.equal(by['Еда'].spent, 850000); assert.equal(by['Еда'].left, 150000);
  assert.equal(by['Транспорт'].status, 'ok'); assert.equal(by['Одежда'].status, 'over'); assert.equal(by['Одежда'].left, -10000);
  assert.equal(by['Связь'].spent, 0); assert.equal(by['Связь'].status, 'ok');
  assert.equal(limitStatus([exp('5000', 'Еда', '2026-11-05'), makeLimit('Еда', 10000_00, 1)], '2026-11')[0].status, 'ok');
  assert.equal(limitStatus([exp('8000', 'Еда', '2026-11-05'), makeLimit('Еда', 10000_00, 1)], '2026-11')[0].status, 'warn', 'ровно 80% — предупреждение');
  assert.equal(limitStatus([exp('100', 'Другое', '2026-11-05')], '2026-11')[0].status, 'none');
  assert.throws(() => makeLimit('', 100), /категорию/); assert.throws(() => makeLimit('Еда', 0), /больше нуля/);
  assert.equal(s[0].limit !== null, true, 'с лимитом — выше');
});
test('копилки: взносы и снятия, прогресс, нужная сумма в месяц, просрочка', () => {
  const g = makeGoal({ title: ' Отпуск ', targetMinor: 120000_00, dueDate: '2027-03-01' }, 1);
  const ev = [g, makeGoalMove(g.id, 30000_00, { date: '2026-11-01' }, 2), makeGoalMove(g.id, 10000_00, { date: '2026-11-05' }, 3), makeGoalMove(g.id, -5000_00, {}, 4)];
  const p = goalProgress(ev, '2026-11-30')[0];
  assert.equal(p.goal.payload.title, 'Отпуск'); assert.equal(p.saved, 35000_00); assert.equal(p.remaining, 85000_00); assert.ok(Math.abs(p.ratio - 35 / 120) < 1e-9);
  assert.equal(p.monthsLeft, 3); assert.equal(p.perMonth, Math.ceil(85000_00 / 3)); assert.equal(p.done, false); assert.equal(p.overdue, false);
  const done = goalProgress([g, makeGoalMove(g.id, 130000_00, {}, 2)], '2026-11-30')[0];
  assert.equal(done.done, true); assert.equal(done.ratio, 1); assert.equal(done.remaining, 0); assert.equal(done.perMonth, null);
  assert.equal(goalProgress([g], '2027-03-02')[0].overdue, true);
  assert.equal(goalProgress([makeGoal({ title: 'Без срока', targetMinor: 100 }, 1)], '2026-11-30')[0].perMonth, null);
  assert.equal(goalProgress([g, makeGoalMove(g.id, -999_00, {}, 2)], '2026-11-30')[0].saved, 0, 'ниже нуля не уходим');
  assert.throws(() => makeGoal({ title: '', targetMinor: 1 }), /Назови/); assert.throws(() => makeGoal({ title: 'a', targetMinor: 0 }), /больше нуля/); assert.throws(() => makeGoal({ title: 'a', targetMinor: 5, dueDate: '2026-02-30' }), /Срок/);
  assert.throws(() => makeGoalMove('x', 0), /не ноль/);
});
test('подписки: ближайший платёж, годовые, итоги, запись платежа', () => {
  const m = makeSub({ name: 'Музыка', amountMinor: 299_00, day: 31 }, 1).payload;
  assert.equal(nextCharge(m, '2026-11-10'), '2026-11-30', '31 → последний день месяца');
  assert.equal(nextCharge(m, '2026-11-30'), '2026-11-30'); assert.equal(nextCharge(m, '2026-12-01'), '2026-12-31'); assert.equal(nextCharge({ ...m, day: 30 }, '2027-01-31'), '2027-02-28');
  assert.equal(nextCharge({ ...m, day: 15 }, '2026-12-20'), '2027-01-15');
  const y = makeSub({ name: 'Облако', amountMinor: 1200_00, period: 'year', day: 5, month: 3 }, 2).payload;
  assert.equal(nextCharge(y, '2026-11-10'), '2027-03-05'); assert.equal(nextCharge(y, '2026-03-05'), '2026-03-05'); assert.equal(monthlyCost(y), 100_00);
  const ev = [makeSub({ name: 'Музыка', amountMinor: 299_00, day: 5 }, 1), makeSub({ name: 'Облако', amountMinor: 1200_00, period: 'year', day: 5, month: 3 }, 2), { ...makeSub({ name: 'Старое', amountMinor: 999_00 }, 3), payload: { ...makeSub({ name: 'Старое', amountMinor: 999_00 }, 3).payload, active: false } }];
  assert.deepEqual(subsOf(ev).map(s => s.payload.name), ['Музыка', 'Облако', 'Старое']);
  assert.deepEqual(subsTotals(ev), { count: 2, monthly: 399_00, yearly: 4788_00 });
  const pay = subPayment(ev[0], '2026-11-05', NOW);
  assert.equal(pay.type, 'expense'); assert.equal(pay.payload.category, 'Подписки'); assert.equal(pay.payload.note, 'Музыка'); assert.equal(pay.payload.amountMinor, 29900);
  assert.throws(() => makeSub({ name: '', amountMinor: 1 }), /Назови/); assert.throws(() => makeSub({ name: 'a', amountMinor: 1, day: 32 }), /День/); assert.throws(() => makeSub({ name: 'a', amountMinor: 1, period: 'week' }), /Период/);
  assert.throws(() => makeSub({ name: 'a', amountMinor: 1, period: 'year', month: 13 }), /Месяц/);
});
test('прогноз месяца: темп трат, остаток на день, подписки до конца месяца', () => {
  const ev = [makeBudget(30000_00, 1), exp('10000', 'Еда', '2026-11-05'), exp('5000', 'Еда', '2026-11-09'), makeSub({ name: 'Музыка', amountMinor: 299_00, day: 25 }, 1)];
  const f = forecast(ev, '2026-11-10');
  assert.equal(f.spent, 15000_00); assert.equal(f.day, 10); assert.equal(f.days, 30); assert.equal(f.daysLeft, 20);
  assert.equal(f.projected, 45000_00); assert.equal(f.projected % 100, 0, 'прогноз в целых рублях'); assert.equal(f.overBudget, true);
  assert.equal(f.perDay, Math.floor((30000_00 - 15000_00) / 21)); assert.equal(f.subsLeft, 299_00);
  assert.equal(forecast(ev, '2026-11-02').projected, null, 'в первые дни прогноз не строим');
  const noBudget = forecast([exp('100', 'Еда', '2026-11-05')], '2026-11-10');
  assert.equal(noBudget.budget, null); assert.equal(noBudget.perDay, null); assert.equal(noBudget.overBudget, false);
});

import { noteTags, tagCloud, noteLinks, findNoteByTitle, resolveLinks, backlinks, NOTE_TEMPLATES, templateText, makeNote, noteTitle } from '../notes.js';

test('заметки: теги, облако тегов, ссылки [[...]], упоминания', () => {
  const a = makeNote('Проект Склад\nПлан приёмки #работа #склад', 3), b = makeNote('Встреча с поставщиком\nСм. [[Проект склад]] и [[Нет такой]] #работа', 2), c = makeNote('Идея про [[проект Склад]] ёлка #идея', 1);
  const ev = [a, b, c];
  assert.deepEqual(noteTags(a.payload.text), ['работа', 'склад']);
  assert.deepEqual(tagCloud(ev), [['работа', 2], ['идея', 1], ['склад', 1]]);
  assert.deepEqual(noteLinks(b.payload.text), ['Проект склад', 'Нет такой']); assert.deepEqual(noteLinks('[[]] и [[ x ]] [[x]]'), ['x']);
  assert.equal(findNoteByTitle(ev, 'проект склад').id, a.id, 'регистр и ё не важны');
  assert.equal(findNoteByTitle(ev, 'Проект').id, a.id, 'по началу названия');
  assert.equal(findNoteByTitle(ev, 'Нет такой'), null); assert.equal(findNoteByTitle(ev, ''), null); assert.equal(findNoteByTitle(ev, 'Проект склад', a.id), null, 'себя исключаем');
  const rl = resolveLinks(ev, b);
  assert.equal(rl[0].target.id, a.id); assert.equal(rl[1].target, null);
  assert.deepEqual(backlinks(ev, a).map(n => n.id), [b.id, c.id]);
  assert.deepEqual(backlinks(ev, b), []);
  assert.equal(noteTitle('# Заголовок'), '# Заголовок');
  assert.equal(findNoteByTitle([makeNote('## Раздел заметки', 1)], 'раздел заметки').payload.text.startsWith('##'), true, 'решётки markdown в названии игнорируются');
});
test('шаблоны заметок: у каждого заголовок первой строкой, дата подставляется, теги разбираются', () => {
  assert.ok(NOTE_TEMPLATES.length >= 10); assert.equal(new Set(NOTE_TEMPLATES.map(t => t.id)).size, NOTE_TEMPLATES.length);
  for (const t of NOTE_TEMPLATES) {
    const txt = t.text('2026-11-11');
    assert.ok(txt.split('\n')[0].trim().length > 3 && txt.length > 20, t.id);
    assert.ok(txt.length < 1500);
  }
  assert.match(templateText('meeting', '2026-11-11'), /Дата: 2026-11-11/);
  assert.deepEqual(noteTags(templateText('incident', 'x')), ['работа', 'инцидент']);
  assert.deepEqual(noteTags(templateText('receiving', 'x')), ['работа', 'приёмка']);
  assert.equal(templateText('нет', 'x'), '');
  assert.ok(templateText('checklist', 'x').includes('- [ ]'));
});

import { tasksToIcs, fold } from '../ics.js';

test('календарь .ics: задачи со сроком и повтором, экранирование, складывание строк, подписки', () => {
  const t1 = makeTask('Позвонить, спросить; про договор\nвторая строка', 1, { due: '2026-11-15', priority: 'high' });
  const t2 = makeTask('Оплатить жильё', 1, { due: '2026-11-10', repeat: 'monthly' });
  const t3 = makeTask('Зарядка', 1, { due: '2026-11-12', repeat: 'daily' });
  const t4 = makeTask('Без срока', 1);
  const t5 = completeTask(makeTask('Сделанное', 1, { due: '2026-11-11' }), 2).updated;
  const t6 = makeTask('Конец месяца', 1, { due: '2026-11-30', repeat: 'monthly' });
  const sub = makeSub({ name: 'Музыка', amountMinor: 29900, day: 31 }, 1);
  const r = tasksToIcs([t1, t2, t3, t4, t5, t6, sub], { now: Date.UTC(2026, 10, 11, 12), today: '2026-11-11' });
  const txt = r.text.replace(/\r\n /g, '');                // для проверки содержимого склеиваем сложенные строки
  assert.equal(r.count, 5, 'четыре задачи со сроком и одна подписка');
  assert.ok(txt.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n') && txt.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!txt.includes('Без срока') && !txt.includes('Сделанное'), 'без срока и сделанные не выгружаются');
  assert.ok(txt.includes('SUMMARY:Позвонить\\, спросить\\; про договор\\nвторая строка'), 'запятая, точка с запятой и перевод строки экранированы');
  assert.ok(txt.includes('DTSTART;VALUE=DATE:20261115\r\nDTEND;VALUE=DATE:20261116') && txt.includes('PRIORITY:1'));
  assert.ok(txt.includes('RRULE:FREQ=MONTHLY;BYMONTHDAY=10') && txt.includes('RRULE:FREQ=DAILY'));
  assert.ok(txt.includes('DTSTART;VALUE=DATE:20261130') && txt.includes('RRULE:FREQ=MONTHLY;BYMONTHDAY=30'), 'месячный повтор по числу задачи');
  assert.ok(txt.includes('SUMMARY:Списание: Музыка') && txt.includes('RRULE:FREQ=MONTHLY;BYMONTHDAY=-1'), '31-е — последний день месяца');
  assert.ok(txt.includes('DTSTAMP:20261111T120000Z'));
  assert.equal(new Set(txt.match(/UID:[^\r]+/g)).size, 5, 'у каждого события свой UID');
  for (const line of r.text.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, `строка длиннее 75 байт: ${line.slice(0, 30)}`);
  assert.equal(tasksToIcs([], { now: 0, today: '2026-11-11' }).count, 0);
});
test('складывание строк: по байтам UTF-8, продолжение с пробела, без потери символов', () => {
  const long = 'SUMMARY:' + 'Очень длинное название задачи '.repeat(8);
  const folded = fold(long);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1 && parts.slice(1).every(p => p.startsWith(' ')));
  assert.equal(parts[0] + parts.slice(1).map(p => p.slice(1)).join(''), long, 'после склейки строка та же');
  assert.ok(parts.every(p => new TextEncoder().encode(p).length <= 75));
  assert.equal(fold('короткая'), 'короткая');
});

import { planReminders, BEDTIME_ID_BASE, WEEKLY_ID_BASE, atLocal } from '../reminders.js';

test('напоминания: подготовка ко сну (с минутами) и итоги недели по воскресеньям', () => {
  const now = new Date(2026, 10, 10, 8, 0).getTime();           // вторник 10 ноября
  const none = planReminders([], now, { taskHour: -1, habitHour: -1 });
  assert.equal(none.length, 0, 'по умолчанию выключено');
  const bed = planReminders([], now, { taskHour: -1, habitHour: -1, bedtimeMin: 22 * 60 + 30 });
  assert.equal(bed.length, 14); assert.equal(bed[0].id, BEDTIME_ID_BASE); assert.equal(bed[0].at, atLocal('2026-11-10', 22, 30));
  assert.ok(bed.every(x => /ко сну/.test(x.body) && x.title === 'Life OS'));
  const late = planReminders([], new Date(2026, 10, 10, 23, 0).getTime(), { taskHour: -1, habitHour: -1, bedtimeMin: 22 * 60 + 30 });
  assert.equal(late[0].id, BEDTIME_ID_BASE + 1, 'время уже прошло — сегодня не планируем');
  const week = planReminders([], now, { taskHour: -1, habitHour: -1, weeklyHour: 19 });
  assert.equal(week.length, 2, 'два воскресенья в ближайшие 14 дней');
  assert.deepEqual(week.map(x => x.at), [atLocal('2026-11-15', 19), atLocal('2026-11-22', 19)]);
  assert.equal(week[0].id, WEEKLY_ID_BASE + 5);
  const ids = planReminders([], now, { taskHour: -1, habitHour: -1, eveningHour: 21, bedtimeMin: 1350, weeklyHour: 19 }).map(x => x.id);
  assert.equal(new Set(ids).size, ids.length, 'идентификаторы не пересекаются');
});

import { dataChecks } from '../datacheck.js';
import { makeRun, makeRunEvent } from '../bt-core.js';

test('проверка данных: необычный сон, скачки веса, дубли расходов, старые задачи, брошенные привычки, пропуски отметок', () => {
  const ev = [];
  ev.push(makeCheckin('m', day(-1), { sleepHours: 15 }, '', NOW), makeCheckin('m', day(-2), { bed: '23:00', wake: '07:00', sleepHours: 4 }, '', NOW), makeCheckin('m', day(-3), { sleepHours: 7.5 }, '', NOW));
  ev.push(makeMeasure({ kind: 'weight', value: 72, date: day(-5) }, NOW), makeMeasure({ kind: 'weight', value: 78, date: day(-4) }, NOW), makeMeasure({ kind: 'weight', value: 72.5, date: day(-20) }, NOW));
  ev.push(makeExpense({ amount: '500', category: 'Еда', note: 'кофе', date: day(-1) }, NOW), makeExpense({ amount: '500', category: 'Еда', note: 'кофе', date: day(-1) }, NOW), makeExpense({ amount: '500', category: 'Еда', note: 'обед', date: day(-1) }, NOW));
  ev.push(makeTask('давнее', 1, { due: day(-90) }), makeTask('недавнее', 1, { due: day(-5) }));
  const h = makeHabit({ name: 'Старая привычка' }, new Date(2026, 5, 1).getTime()); ev.push(h);
  for (let i = 0; i < 4; i++) ev.push(makeRunEvent(makeRun({ mode: 'quick', startedAt: new Date(2026, 10, 20 + i, 9).getTime(), durationMs: 1, results: {} }), NOW));
  const r = dataChecks(ev, TODAY, NOW);
  const ids = r.map(x => x.id);
  for (const id of ['sleep-range', 'sleep-times', 'weight-jump', 'expense-dups', 'stale-tasks', 'idle-habits', 'gaps']) assert.ok(ids.includes(id), `нет проверки ${id}: ${ids}`);
  assert.ok(!ids.includes('ok'));
  assert.match(r.find(x => x.id === 'sleep-range').text, /15 ч/); assert.match(r.find(x => x.id === 'weight-jump').text, /72 → 78/);
  assert.match(r.find(x => x.id === 'expense-dups').text, /×2/); assert.match(r.find(x => x.id === 'stale-tasks').text, /: 1\./);
  const clean = dataChecks([makeCheckin('m', day(-1), { sleepHours: 7 }, '', NOW)], TODAY, NOW);
  assert.deepEqual(clean.map(x => x.id), ['ok']);
});

import { correlations, dailyRows as dRows, insights as insightsOf, OUTCOMES, FACTORS } from '../bt-analytics.js';
import { makeRng as rngOf } from '../stats.js';

test('аналитика самочувствия: настроение вечером связано со сном; фокус, тренировки и привычки попадают в таблицу дней', () => {
  const r = rngOf(31), ev = [];
  const h = makeHabit({ name: 'Зарядка' }, new Date(2026, 8, 1).getTime()); ev.push(h);
  for (let i = 0; i < 36; i++) {
    const d = day(-i), t = new Date(2026, 10, 30 - i, 20).getTime(), sleep = 5 + r() * 4;
    ev.push(makeCheckin('m', d, { sleepHours: Math.round(sleep * 4) / 4 }, '', t));
    ev.push(makeCheckin('e', d, { mood: Math.max(1, Math.min(5, Math.round(1 + (sleep - 5) * 1 + (r() - 0.5) * 1))), caffeine: Math.floor(r() * 4) }, '', t));
    if (i % 3 === 0) ev.push({ id: `fs:${i}`, type: 'focus', ts: t, payload: { date: d, minutes: 50, planned: 50, completed: true }, source: 'manual', confidence: 1, evidence: [] });
    if (i % 2 === 0) ev.push(makeHabitLog(h, d, 'full', t));
  }
  const rows = dRows(ev);
  const row = rows.find(x => x.date === day(-3));
  assert.equal(row.focusMin, 50); assert.equal(row.habitsDone, 0); assert.equal(rows.find(x => x.date === day(-2)).habitsDone, 1);
  assert.equal(rows.find(x => x.date === day(-2)).prev_focusMin, 50, 'накануне был фокус');
  assert.ok(FACTORS.some(f => f[0] === 'focusMin') && OUTCOMES.some(o => o[0] === 'moodEvening'));
  const c = correlations(rows).find(x => x.x === 'sleepHours' && x.y === 'moodEvening');
  assert.ok(c && c.rho > 0.5 && c.q < 0.05, JSON.stringify(c));
  const ins = insightsOf(ev, NOW).find(x => x.id.startsWith('rel-sleepHours'));
  assert.ok(ins && /настроение вечером/.test(ins.text), ins?.text);
});

import { makeMed, medsOf, makeMedLog, medLogId, takenOn, adherence, WHEN, MEDS_NOTE } from '../meds.js';

test('лекарства: список, отметка «принял», приём за период, сводка для врача', () => {
  const a = makeMed({ name: ' Витамин D ', dose: '2000 МЕ', when: 'morning' }, new Date(2026, 10, 20).getTime());
  const b = makeMed({ name: 'Магний', when: 'evening' }, new Date(2026, 10, 20).getTime());
  const c = makeMed({ name: 'Ибупрофен', when: 'asneeded' }, new Date(2026, 10, 20).getTime());
  assert.equal(a.payload.name, 'Витамин D'); assert.equal(a.payload.active, true);
  assert.throws(() => makeMed({ name: '' }), /Назови/); assert.throws(() => makeMed({ name: 'x', when: 'never' }), /время приёма/);
  assert.deepEqual(medsOf([c, b, a]).map(m => m.payload.name), ['Витамин D', 'Магний', 'Ибупрофен'], 'утро → вечер → по необходимости');
  const logs = [makeMedLog(a.id, day(-1), NOW), makeMedLog(a.id, day(0), NOW), makeMedLog(b.id, day(0), NOW)];
  assert.equal(logs[0].id, medLogId(a.id, day(-1)));
  assert.deepEqual([...takenOn([a, b, ...logs], day(0))].sort(), [a.id, b.id].sort()); assert.equal(takenOn(logs, day(-5)).size, 0);
  const adh = adherence([a, b, c, ...logs], TODAY, 14);
  assert.equal(adh.length, 2, 'лекарство «по необходимости» не учитывается');
  const va = adh.find(x => x.med.id === a.id);
  assert.equal(va.taken, 2); assert.equal(va.of, 11, 'считаем со дня добавления (20–30 ноября)');
  assert.throws(() => makeMedLog('x', 'bad'), /bad date/);
  assert.ok(WHEN.morning && /не меняй и не отменяй/.test(MEDS_NOTE));
  const md = doctorSummary([a, b, ...logs, makeMeasure({ kind: 'weight', value: 70, date: day(-1) }, NOW)], TODAY, { now: NOW });
  assert.match(md, /- Витамин D 2000 МЕ, утром \(отмечено 2 из 11 дн\.\)/); assert.match(md, /- Магний, вечером/);
  assert.ok(!doctorSummary([], TODAY, { now: NOW }).includes('- Витамин'));
});

import { parseBirthday, makePerson, markContact, updateNote as updatePersonNote, peopleOf, nextBirthday, upcomingBirthdays, dueContacts, CADENCES } from '../people.js';

test('люди: разбор даты рождения, ближайший день рождения (в т. ч. 29 февраля), возраст', () => {
  assert.deepEqual(parseBirthday('12.03'), { md: '03-12', year: null }); assert.deepEqual(parseBirthday('5.3.1990'), { md: '03-05', year: 1990 }); assert.deepEqual(parseBirthday('1990-03-12'), { md: '03-12', year: 1990 });
  assert.equal(parseBirthday(''), null); assert.deepEqual(parseBirthday('29.02'), { md: '02-29', year: null });
  assert.throws(() => parseBirthday('31.04'), /нет/); assert.throws(() => parseBirthday('abc'), /например/); assert.throws(() => parseBirthday('1.1.1800'), /Год/); assert.throws(() => parseBirthday('13.13'), /нет/);
  const p = makePerson({ name: ' Мама ', birthday: '25.11.1965', cadenceDays: 7 }, 1).payload;
  assert.equal(p.name, 'Мама'); assert.equal(p.birthday, '11-25'); assert.equal(p.birthYear, 1965);
  const nb = nextBirthday(p, '2026-11-20');
  assert.deepEqual(nb, { date: '2026-11-25', inDays: 5, age: 61 });
  assert.deepEqual(nextBirthday(p, '2026-11-25'), { date: '2026-11-25', inDays: 0, age: 61 });
  assert.deepEqual(nextBirthday(p, '2026-11-26'), { date: '2027-11-25', inDays: 364, age: 62 });
  assert.equal(nextBirthday({ birthday: '02-29', birthYear: null }, '2027-02-01').date, '2027-02-28', 'в невисокий год — 28 февраля');
  assert.equal(nextBirthday({ birthday: '02-29', birthYear: null }, '2028-02-01').date, '2028-02-29');
  assert.equal(nextBirthday({ birthday: null }, '2026-11-20'), null);
  assert.throws(() => makePerson({ name: '' }), /имя/); assert.throws(() => makePerson({ name: 'a', cadenceDays: 5 }), /часто/);
  assert.ok(CADENCES.length >= 6);
});
test('люди: ближайшие дни рождения и «давно не общались»', () => {
  const a = makePerson({ name: 'Анна', birthday: '14.11', cadenceDays: 14 }, new Date(2026, 9, 1).getTime());
  const b = makePerson({ name: 'Борис', birthday: '25.12', cadenceDays: 30 }, new Date(2026, 9, 1).getTime());
  const c = makePerson({ name: 'Вера', cadenceDays: 0 }, new Date(2026, 9, 1).getTime());
  const d = makePerson({ name: 'Глеб', cadenceDays: 7 }, new Date(2026, 10, 9).getTime());
  const ev = [b, c, a, d];
  assert.deepEqual(upcomingBirthdays(ev, '2026-11-11', 14).map(x => [x.person.payload.name, x.inDays]), [['Анна', 3]]);
  assert.equal(upcomingBirthdays(ev, '2026-11-11', 60).length, 2);
  const due = dueContacts(ev, '2026-11-11');
  assert.deepEqual(due.map(x => x.person.payload.name), ['Анна', 'Борис'], 'Анна: 41 день при периоде 14; Борис: 41 при 30; Глеб — рано, Вера — без напоминаний');
  assert.equal(due[0].never, true);
  const a2 = markContact(a, '2026-11-10');
  assert.equal(dueContacts([a2, b], '2026-11-11').map(x => x.person.payload.name).join(), 'Борис');
  assert.equal(updatePersonNote(a, ' идея: книга ').payload.note, 'идея: книга');
  assert.deepEqual(peopleOf([b, a, c]).map(x => x.payload.name), ['Анна', 'Борис', 'Вера']);
  assert.throws(() => markContact(a, 'x'), /bad date/);
});

import { quarterEnd, quarterLabel, makeOkr, updateKr, setOkrStatus, okrsOf, okrProgress, okrPace, krRatio } from '../okr.js';

test('цели: конец квартала, создание с проверками, обновление результатов, прогресс и темп', () => {
  assert.equal(quarterEnd('2026-11-11'), '2026-12-31'); assert.equal(quarterEnd('2026-02-10'), '2026-03-31'); assert.equal(quarterEnd('2026-04-01'), '2026-06-30'); assert.equal(quarterEnd('2026-09-30'), '2026-09-30');
  assert.equal(quarterLabel('2026-11-11'), '4-й квартал 2026');
  const now = new Date(2026, 9, 1, 12).getTime();                    // 1 октября
  const o = makeOkr({ title: ' Форма ', why: 'здоровье', krs: [{ text: 'Пробежать за месяц', target: '50', unit: 'км' }, { text: 'Вес', target: 5, unit: 'кг' }, { text: '', target: 1 }] }, now);
  assert.equal(o.type, 'okr'); assert.equal(o.payload.title, 'Форма'); assert.equal(o.payload.due, '2026-12-31'); assert.equal(o.payload.krs.length, 2, 'пустые результаты отбрасываются');
  assert.throws(() => makeOkr({ title: '', krs: [{ text: 'a', target: 1 }] }), /Назови/); assert.throws(() => makeOkr({ title: 'a', krs: [] }), /хотя бы один/);
  assert.throws(() => makeOkr({ title: 'a', krs: [{ text: 'x', target: 0 }] }), /больше нуля/); assert.throws(() => makeOkr({ title: 'a', krs: Array.from({ length: 6 }, (_, i) => ({ text: 'k' + i, target: 1 })) }), /Не больше 5/);
  assert.throws(() => makeOkr({ title: 'a', due: '2026-01-01', krs: [{ text: 'x', target: 1 }] }, now), /позже/); assert.throws(() => makeOkr({ title: 'a', due: '2026-02-30', krs: [{ text: 'x', target: 1 }] }, now), /неверно/);
  let k0 = o.payload.krs[0].id, k1 = o.payload.krs[1].id;
  let u = updateKr(o, k0, '25'); u = updateKr(u, k1, 5.5);
  assert.equal(u.payload.krs[0].current, 25); assert.equal(krRatio(u.payload.krs[1]), 1, 'сверх цели — не больше 100%'); assert.equal(okrProgress(u), 0.75);
  assert.equal(okrProgress(o), 0, 'исходная запись не меняется');
  assert.throws(() => updateKr(o, 'нет', 1), /Нет такого/); assert.throws(() => updateKr(o, k0, -1), /не меньше нуля/);
  // темп: 1 октября → 31 декабря (91 день)
  assert.equal(okrPace(o, '2026-10-01').state, 'on');
  assert.equal(okrPace(u, '2026-10-16').state, 'ahead');
  assert.equal(okrPace(o, '2026-11-15').state, 'behind');
  const half = updateKr(updateKr(o, k0, 25), k1, 2.5);
  assert.equal(okrPace(half, '2026-11-15').state, 'on');
  assert.equal(okrPace(o, '2027-01-05').state, 'overdue');
  assert.equal(okrPace(updateKr(updateKr(o, k0, 50), k1, 5), '2026-11-01').state, 'done');
  const done = setOkrStatus(u, 'done');
  assert.equal(done.payload.status, 'done'); assert.throws(() => setOkrStatus(u, 'x'), /bad status/);
  assert.deepEqual(okrsOf([done, o]).map(x => x.payload.status), ['done', 'active']); assert.equal(okrsOf([done, o], 'active').length, 1);
});

import { habitReview, reviewDue, REVIEW_TEXT, updateHabit } from '../habits.js';

test('привычки: «кем я становлюсь», ежемесячный пересмотр по регулярности', () => {
  const start = new Date(2026, 9, 1).getTime();
  const h1 = makeHabit({ name: 'Зарядка', identity: ' я человек, который двигается ' }, start);
  assert.equal(h1.payload.identity, 'я человек, который двигается');
  assert.equal(makeHabit({ name: 'x' }, start).payload.identity, '');
  const edited = updateHabit(h1, { name: 'Зарядка 2', anchor: '', minimum: '', full: '' });
  assert.equal(edited.payload.identity, 'я человек, который двигается', 'без поля identity при правке оно сохраняется');
  assert.equal(updateHabit(h1, { name: 'a', anchor: '', minimum: '', full: '', identity: '' }).payload.identity, '');
  const hs = ['Часто', 'Средне', 'Редко', 'Никогда', 'Новая'].map((n, i) => makeHabit({ name: n }, i === 4 ? new Date(2026, 10, 25).getTime() : start));
  const ev = [...hs];
  const TD = '2026-11-30';
  const dayN = n => { const d = new Date(2026, 10, 30 - n, 12); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  for (let i = 0; i < 30; i++) { if (i % 10 !== 0) ev.push(makeHabitLog(hs[0], dayN(i), 'full', 1)); if (i % 2 === 0) ev.push(makeHabitLog(hs[1], dayN(i), 'full', 1)); if (i === 3) ev.push(makeHabitLog(hs[2], dayN(i), 'min', 1)); }
  const r = habitReview(ev, TD);
  assert.deepEqual(Object.fromEntries(r.map(x => [x.h.payload.name, x.advice])), { Часто: 'keep', Средне: 'ok', Редко: 'ease', Никогда: 'archive' }, 'новая привычка (меньше 14 дней) в пересмотр не попадает');
  assert.equal(r.find(x => x.advice === 'archive').text, REVIEW_TEXT.archive);
  assert.equal(reviewDue('2026-12-03', '2026-11'), true); assert.equal(reviewDue('2026-12-03', '2026-12'), false); assert.equal(reviewDue('2026-12-08', ''), false, 'после седьмого числа — не навязываем');
});

import { makeThought, thoughtsOf, relief, reliefStats, EMOTIONS, THOUGHT_NOTE, PROMPTS } from '../thoughts.js';
import { FLAGS, SLOTS, dailyTable } from '../diary.js';

test('дневник мыслей: запись с проверками, облегчение, статистика', () => {
  const a = makeThought({ date: '2026-11-10', situation: ' Начальник не ответил ', thought: ' Он мной недоволен ', emotion: 'тревога', before: '8', alt: 'Он просто занят', after: 4 }, 1);
  assert.equal(a.type, 'thought'); assert.equal(a.payload.situation, 'Начальник не ответил'); assert.equal(a.payload.before, 8); assert.equal(a.payload.after, 4); assert.equal(relief(a), 4);
  assert.throws(() => makeThought({ thought: 'ab' }), /мысль/); assert.throws(() => makeThought({ thought: 'abc', emotion: 'восторг' }), /эмоцию/); assert.throws(() => makeThought({ thought: 'abc', before: 11 }), /от 0 до 10/);
  assert.equal(makeThought({ thought: 'abc' }, 2).payload.emotion, 'другое'); assert.equal(relief(makeThought({ thought: 'abc', before: 5 }, 2)), null);
  const b = makeThought({ date: '2026-11-11', thought: 'Я не справлюсь', before: 6, after: 7 }, 3);
  const ev = [a, b, makeThought({ date: '2026-11-09', thought: 'Всё плохо', before: 7, after: 7 }, 4)];
  assert.deepEqual(thoughtsOf(ev).map(t => t.payload.date), ['2026-11-11', '2026-11-10', '2026-11-09']);
  const st = reliefStats(ev); assert.equal(st.n, 3); assert.equal(st.helped, 1); assert.ok(Math.abs(st.avg - (4 - 1 + 0) / 3) < 1e-9);
  assert.equal(reliefStats([]), null);
  assert.ok(EMOTIONS.includes('тревога') && PROMPTS.length === 6 && /специалист|врач/.test(THOUGHT_NOTE));
});
test('быстрая отметка питания: флаги сохраняются только как «да», считается балл дня', () => {
  assert.deepEqual(SLOTS.e.flags, ['veg', 'protein', 'sweets']); assert.ok(FLAGS.veg && FLAGS.protein && FLAGS.sweets);
  const e1 = makeCheckin('e', '2026-11-10', { mood: 4, veg: true, protein: true, sweets: false }, '', 1);
  assert.equal(e1.payload.veg, true); assert.equal(e1.payload.protein, true); assert.equal('sweets' in e1.payload, false);
  assert.equal(makeCheckin('e', '2026-11-10', { veg: true }, '', 1).payload.veg, true, 'одной отметки питания достаточно для записи');
  assert.throws(() => makeCheckin('e', '2026-11-10', { veg: false }, '', 1), /хотя бы одно/);
  const e2 = makeCheckin('e', '2026-11-11', { mood: 3, sweets: true }, '', 1);
  const rows = dailyTable([e1, e2, makeCheckin('m', '2026-11-12', { mood: 3 }, '', 1)]);
  assert.equal(rows.find(r => r.date === '2026-11-10').foodScore, 2); assert.equal(rows.find(r => r.date === '2026-11-11').foodScore, -1);
  assert.equal(rows.find(r => r.date === '2026-11-12').foodScore, undefined, 'нет вечерней отметки — нет и балла');
});
