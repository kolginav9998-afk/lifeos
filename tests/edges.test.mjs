// Граничные случаи чистой логики: пустые и вырожденные данные, старые записи без новых полей, переходы через конец месяца и года.
// Основные сценарии каждого модуля проверяют их собственные тесты; здесь только то, что раньше нигде не проверялось.
import test from 'node:test';
import assert from 'node:assert/strict';
import { median, mad, pearson, linreg, slopeCI } from '../stats.js';
import { parseAmount, formatMoney, makeEntry, makeExpense, makeIncome, updateExpense, summarizeMonth, unusualExpense, unusualText, csvCell, moneyToCsv, makeBudget, budgetOf } from '../money.js';
import { makeLimit, limitStatus, makeGoal, makeGoalMove, goalProgress, makeSub, nextCharge, monthlyCost, subsTotals, forecast } from '../planning.js';
import { grade, newState, retention, buildQueue, studyStreak, summary as srsSummary } from '../srs.js';
import { parseQuick } from '../quick.js';
import { makeHabit, updateHabit } from '../habits.js';
import { repeatLabel, nextDue, addDays } from '../events.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const sp = s => s.replace(/[\u00a0\u202f]/g, ' ');                       // приложение ставит неразрывные пробелы между тысячами и перед ₽

// ---------- статистика ----------
test('статистика: пустые и вырожденные данные дают NaN или null, а не мусор', () => {
  assert.ok(Number.isNaN(median([])) && Number.isNaN(mad([])));
  assert.ok(Number.isNaN(pearson([1, 2], [3, 4])), 'меньше трёх пар');
  assert.ok(Number.isNaN(pearson([1, 2, 3], [1, 2])), 'ряды разной длины');
  assert.equal(linreg([1], [1]), null, 'одна точка');
  assert.equal(linreg([2, 2, 2], [1, 2, 3]), null, 'все x одинаковы: наклон не определён');
  assert.deepEqual(linreg([1, 2, 3], [5, 5, 5]), { slope: 0, intercept: 5, r2: 0, n: 3 }, 'горизонтальная линия: r² = 0, а не NaN');
});

test('интервал для наклона: воспроизводим, накрывает истинный наклон; при почти одинаковых x не строится', () => {
  const x = Array.from({ length: 12 }, (_, i) => i), noise = [0.4, -0.3, 0.2, -0.5, 0.1, 0.3, -0.2, 0.5, -0.4, 0.2, -0.1, 0.3];
  const y = x.map((v, i) => 2 * v + 1 + noise[i]);
  const ci = slopeCI(x, y);
  assert.ok(ci.lo < ci.slope && ci.slope < ci.hi && ci.lo > 1.8 && ci.hi < 2.2, JSON.stringify(ci));
  assert.deepEqual(slopeCI(x, y), ci, 'тот же результат при повторе (зерно фиксировано)');
  assert.equal(ci.n, 12); assert.equal(ci.level, 0.95);
  const wide = slopeCI(x, y, { level: 0.5 });
  assert.ok(wide.hi - wide.lo < ci.hi - ci.lo, 'меньший уровень уверенности — уже интервал');
  assert.equal(slopeCI(x.slice(0, 5), y.slice(0, 5)), null, 'меньше восьми точек');
  assert.equal(slopeCI(x, y.slice(1)), null, 'ряды разной длины');
  assert.equal(slopeCI(Array(10).fill(3), y.slice(0, 10)), null, 'все x одинаковы');
  assert.equal(slopeCI([0, 0, 0, 0, 0, 0, 0, 1], [1, 2, 1, 2, 1, 2, 1, 5]), null, 'в трети выборок все x одинаковы: интервалу верить нельзя');
});

// ---------- деньги ----------
test('сумма: пробелы разных видов, запятая, лишние знаки и пределы', () => {
  assert.equal(parseAmount(' 1 250,5 '), 125050, 'неразрывный пробел и запятая');
  assert.equal(parseAmount('12 000'), 1200000, 'узкий неразрывный пробел');
  assert.equal(parseAmount('0,01'), 1);
  for (const bad of [null, undefined, '', 'abc', '-5', '12.345', '1,2,3', '1 000 000 000,01']) assert.throws(() => parseAmount(bad), /Сумма|Слишком/, String(bad));
  assert.throws(() => parseAmount('0'), /больше нуля/);
  assert.throws(() => parseAmount('0,00'), /больше нуля/);
  assert.equal(parseAmount('1000000000'), 100_000_000_000, 'ровно миллиард допустим');
  assert.throws(() => parseAmount('1000000001'), /Слишком большая/);
});

test('формат суммы: копейки показываются только когда есть, минус и тысячи', () => {
  const f = n => sp(formatMoney(n));
  assert.equal(f(5), '0,05 ₽'); assert.equal(f(100), '1 ₽'); assert.equal(f(123456789), '1 234 567,89 ₽');
  assert.equal(f(-12345), '-123,45 ₽'); assert.equal(f(0), '0 ₽'); assert.equal(f(100000), '1 000 ₽');
  assert.ok(formatMoney(123456789).includes('\u00a0'), 'пробелы неразрывные: сумма не переносится на другую строку');
});

test('запись расхода или дохода: число — это копейки, пустая категория → «Другое», длинное обрезается, плохая дата и тип отклоняются', () => {
  const e = makeExpense({ amount: 15000, category: '   ', note: 'н'.repeat(300), date: '2026-11-11' }, 1);
  assert.equal(e.payload.amountMinor, 15000); assert.equal(e.payload.category, 'Другое'); assert.equal(e.payload.note.length, 200);
  assert.equal(makeExpense({ amount: '1', category: 'к'.repeat(60), date: '2026-11-11' }, 1).payload.category.length, 40);
  assert.equal(makeIncome({ amount: '5', category: 'Зарплата' }, at(2026, 11, 11)).payload.date, '2026-11-11', 'без даты — сегодня');
  for (const amount of [0, -1, 1.5, 100_000_000_001, NaN]) assert.throws(() => makeExpense({ amount, category: 'x', date: '2026-11-11' }), /вне допустимых пределов/, String(amount));
  assert.throws(() => makeExpense({ amount: 1, category: 'x', date: 'вчера' }), /bad date/);
  assert.throws(() => makeEntry('gift', { amount: 1, category: 'x' }), /bad kind/);
});

test('правка записи: доход остаётся доходом, пустая дата сохраняет прежнюю, id и время создания те же', () => {
  const inc = makeIncome({ amount: '1000', category: 'Зарплата', date: '2026-10-05' }, 111);
  const up = updateExpense(inc, { amount: '1500', category: 'Подработка', note: 'аванс', date: '' }, 222);
  assert.equal(up.type, 'income'); assert.equal(up.id, inc.id); assert.equal(up.ts, 111);
  assert.equal(up.payload.date, '2026-10-05'); assert.equal(up.payload.amountMinor, 150000); assert.equal(up.payload.editedAt, 222);
  assert.equal(inc.payload.amountMinor, 100000, 'исходная запись не меняется');
  assert.throws(() => updateExpense(inc, { amount: 'ноль', category: 'x' }), /Сумма/);
});

test('итоги месяца: порядок записей и категорий при равных значениях; бюджет можно снять', () => {
  const a = makeExpense({ amount: '100', category: 'Яблоки', date: '2026-11-03' }, 10);
  const b = makeExpense({ amount: '100', category: 'Арбузы', date: '2026-11-03' }, 20);
  const c = makeExpense({ amount: '300', category: 'Дом', date: '2026-11-01' }, 5);
  const other = makeIncome({ amount: '999', category: 'Зарплата', date: '2026-11-02' }, 6);
  const s = summarizeMonth([a, b, c, other], '2026-11');
  assert.deepEqual(s.items.map(e => e.payload.category), ['Арбузы', 'Яблоки', 'Дом'], 'новее по дате, при равной дате — позднее созданная');
  assert.deepEqual(s.byCategory.map(x => x.category), ['Дом', 'Арбузы', 'Яблоки'], 'равные суммы — по алфавиту');
  assert.equal(s.total, 50000); assert.equal(s.byCategory[0].share, 0.6);
  assert.deepEqual(summarizeMonth([], '2026-11'), { ym: '2026-11', items: [], total: 0, count: 0, byCategory: [] });
  assert.equal(budgetOf([makeBudget(700000, 1)]), 700000); assert.equal(budgetOf([makeBudget(null, 2)]), null, 'null снимает бюджет');
  assert.throws(() => makeBudget(0), /bad budget/); assert.throws(() => makeBudget(1.5), /bad budget/);
});

test('необычная трата: нужно пять прежних в категории; чётное число прежних даёт среднюю пару; порог не ниже 500 ₽', () => {
  const mk = (cat, amount, date, id) => ({ ...makeExpense({ amount, category: cat, date }, 1), id });
  const past = [100, 120, 110, 130, 90, 140].map((rub, i) => mk('Еда', String(rub), `2026-10-${String(10 + i).padStart(2, '0')}`, `p${i}`));
  const big = mk('Еда', '600', '2026-11-11', 'big'), mid = mk('Еда', '400', '2026-11-11', 'mid');
  const u = unusualExpense([...past, big], big);
  assert.deepEqual(u, { median: 11500, count: 6 }, 'медиана шести: среднее двух средних (110 и 120 ₽)');
  assert.equal(unusualExpense([...past, mid], mid), null, '400 ₽ — не больше трёх медиан и не выше 500 ₽');
  assert.equal(unusualExpense([...past.slice(0, 4), big], big), null, 'прежних меньше пяти');
  assert.equal(unusualExpense([...past, mk('Транспорт', '9000', '2026-11-11', 'x')], mk('Транспорт', '9000', '2026-11-11', 'x')), null, 'другая категория не считается');
  const old = [100, 100, 100, 100, 100].map((rub, i) => mk('Еда', String(rub), `2026-05-0${i + 1}`, `o${i}`));
  assert.equal(unusualExpense([...old, big], big), null, 'траты старше 90 дней не считаются');
  assert.match(sp(unusualText(u, 'Еда')), /«Еда» \(обычно около 115 ₽\)/);
});

test('CSV: ячейки с формулой, кавычкой и переводом строки защищены; пустой список — только заголовок', () => {
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)"); assert.equal(csvCell('@x'), "'@x"); assert.equal(csvCell('-5'), "'-5");
  assert.equal(csvCell('а;б'), '"а;б"'); assert.equal(csvCell('он сказал "да"'), '"он сказал ""да"""'); assert.equal(csvCell(null), '');
  assert.equal(csvCell('строка\nвторая'), '"строка\nвторая"');
  assert.equal(moneyToCsv([]), '﻿Тип;Дата;Сумма;Категория;Комментарий\r\n');
});

// ---------- планирование ----------
test('лимиты: граница «внимание» на 80%, «превышен» только выше 100%, порядок — сначала с лимитом', () => {
  assert.throws(() => makeLimit('  ', 100), /категорию/); assert.throws(() => makeLimit('Еда', 0), /больше нуля/); assert.throws(() => makeLimit('Еда', 1.5), /больше нуля/);
  const ev = [makeLimit('Еда', 10000, 1), makeLimit('Дом', 10000, 1), makeLimit('Пусто', 5000, 1),
    makeExpense({ amount: '80', category: 'Еда', date: '2026-11-02' }, 2), makeExpense({ amount: '100', category: 'Дом', date: '2026-11-02' }, 2),
    makeExpense({ amount: '101', category: 'Здоровье', date: '2026-11-02' }, 2), makeExpense({ amount: '500', category: 'Без лимита', date: '2026-11-02' }, 2),
    makeExpense({ amount: '700', category: 'Еда', date: '2026-10-02' }, 2)];                                     // другой месяц не считается
  const st = limitStatus(ev, '2026-11');
  const by = Object.fromEntries(st.map(s => [s.category, s]));
  assert.equal(by['Еда'].status, 'warn'); assert.equal(by['Еда'].ratio, 0.8); assert.equal(by['Еда'].left, 2000);
  assert.equal(by['Дом'].status, 'warn', 'ровно 100% — ещё не «превышен»'); assert.equal(by['Дом'].left, 0);
  assert.equal(by['Пусто'].status, 'ok'); assert.equal(by['Пусто'].spent, 0);
  assert.equal(by['Здоровье'].status, 'none'); assert.equal(by['Здоровье'].limit, null); assert.equal(by['Здоровье'].left, null);
  assert.deepEqual(st.map(s => s.category), ['Дом', 'Еда', 'Пусто', 'Без лимита', 'Здоровье'], 'с лимитом вперёд; внутри — по расходу, при равенстве по алфавиту');
  const over = limitStatus([makeLimit('Еда', 10000, 1), makeExpense({ amount: '100,01', category: 'Еда', date: '2026-11-02' }, 2)], '2026-11')[0];
  assert.equal(over.status, 'over'); assert.equal(over.left, -1);
});

test('копилки: ошибки ввода, возвраты не уводят вклад ниже нуля, расчёт «сколько откладывать в месяц»', () => {
  assert.throws(() => makeGoal({ title: ' ', targetMinor: 100 }), /Назови цель/); assert.throws(() => makeGoal({ title: 'x', targetMinor: 0 }), /больше нуля/);
  assert.throws(() => makeGoal({ title: 'x', targetMinor: 100, dueDate: '31.12.2026' }), /Срок указан неверно/);
  const g = makeGoal({ title: 'Отпуск', targetMinor: 120000, dueDate: '2027-02-10' }, 1);
  assert.throws(() => makeGoalMove(g.id, 0), /не ноль/); assert.throws(() => makeGoalMove(g.id, 5, { date: 'завтра' }), /bad date/);
  const p0 = goalProgress([g], '2026-11-11')[0];
  assert.equal(p0.saved, 0); assert.equal(p0.monthsLeft, 3, '91 день ≈ 3 месяца'); assert.equal(p0.perMonth, 40000); assert.equal(p0.overdue, false);
  const withdraw = goalProgress([g, makeGoalMove(g.id, -5000, {}, 2)], '2026-11-11')[0];
  assert.equal(withdraw.saved, 0, 'снятий больше, чем вложено: вклад не отрицательный'); assert.equal(withdraw.ratio, 0);
  const full = goalProgress([g, makeGoalMove(g.id, 150000, { date: '2026-11-10' }, 2)], '2026-11-11')[0];
  assert.equal(full.done, true); assert.equal(full.ratio, 1); assert.equal(full.remaining, 0); assert.equal(full.perMonth, null, 'цель достигнута — откладывать нечего');
  const late = goalProgress([g], '2027-03-01')[0];
  assert.equal(late.overdue, true); assert.equal(late.monthsLeft, 0); assert.equal(late.perMonth, null, 'срок прошёл: «в месяц» не считаем');
  const noDue = goalProgress([makeGoal({ title: 'Без срока', targetMinor: 1000 }, 1)], '2026-11-11')[0];
  assert.equal(noDue.perMonth, null); assert.equal(noDue.monthsLeft, null);
});

test('подписки: проверки ввода, день 31 в коротком месяце, годовая подписка, итоги без отключённых', () => {
  assert.throws(() => makeSub({ name: ' ', amountMinor: 100 }), /Назови/); assert.throws(() => makeSub({ name: 'x', amountMinor: 0 }), /больше нуля/);
  assert.throws(() => makeSub({ name: 'x', amountMinor: 100, period: 'week' }), /месяц или год/);
  assert.throws(() => makeSub({ name: 'x', amountMinor: 100, day: 0 }), /от 1 до 31/); assert.throws(() => makeSub({ name: 'x', amountMinor: 100, day: 32 }), /от 1 до 31/);
  assert.throws(() => makeSub({ name: 'x', amountMinor: 100, period: 'year', month: 13 }), /от 1 до 12/);
  assert.equal(makeSub({ name: 'x', amountMinor: 100, day: 5, month: 13 }).payload.month, undefined, 'у месячной подписки месяца нет');
  const monthly = { period: 'month', day: 31, amountMinor: 59900 }, yearly = { period: 'year', day: 29, month: 2, amountMinor: 120000 };
  assert.equal(nextCharge(monthly, '2026-02-10'), '2026-02-28', 'в феврале платёж 28-го');
  assert.equal(nextCharge(monthly, '2026-04-30'), '2026-04-30', 'сегодня и есть день платежа');
  assert.equal(nextCharge(monthly, '2026-12-31'), '2026-12-31'); assert.equal(nextCharge({ ...monthly, day: 15 }, '2026-12-20'), '2027-01-15', 'через конец года');
  assert.equal(nextCharge(yearly, '2026-03-01'), '2027-02-28', 'годовой платёж 29 февраля в обычный год — 28-го');
  assert.equal(nextCharge(yearly, '2027-12-01'), '2028-02-29', 'и 29-го в високосный');
  assert.equal(monthlyCost(yearly), 10000); assert.equal(monthlyCost(monthly), 59900);
  const a = makeSub({ name: 'Музыка', amountMinor: 29900 }, 1), b = makeSub({ name: 'Облако', amountMinor: 120000, period: 'year', month: 3 }, 1), off = makeSub({ name: 'Старая', amountMinor: 99900 }, 1);
  off.payload.active = false;
  assert.deepEqual(subsTotals([a, b, off]), { count: 2, monthly: 39900, yearly: 478800 });
});

test('прогноз месяца: первые дни без прогноза, подписки считаются только с сегодняшнего дня, дневной остаток и перерасход', () => {
  const sub = makeSub({ name: 'Связь', amountMinor: 50000, day: 20 }, 1), early = makeSub({ name: 'Раньше', amountMinor: 70000, day: 3 }, 1);
  const spend = (rub, date) => makeExpense({ amount: String(rub), category: 'Еда', date }, 1);
  const f2 = forecast([spend(500, '2026-11-02'), sub], '2026-11-02');
  assert.equal(f2.projected, null, 'на второй день месяца прогноз слишком шумный'); assert.equal(f2.budget, null); assert.equal(f2.perDay, null); assert.equal(f2.overBudget, false);
  const ev = [spend(3000, '2026-11-05'), spend(2000, '2026-11-08'), sub, early, makeBudget(1000000, 1)];
  const f = forecast(ev, '2026-11-10');
  assert.equal(f.spent, 500000); assert.equal(f.day, 10); assert.equal(f.days, 30); assert.equal(f.daysLeft, 20);
  assert.equal(f.projected, 1500000, '5000 ₽ за 10 дней → 15 000 ₽ за 30');
  assert.equal(f.subsLeft, 50000, 'платёж 3-го числа уже прошёл, 20-го ещё впереди');
  assert.equal(f.overBudget, true); assert.equal(f.perDay, Math.floor((1000000 - 500000) / 21));
  assert.equal(forecast([spend(10, '2026-11-30'), makeBudget(1000000, 1)], '2026-11-30').perDay, 999000, 'в последний день весь остаток — на сегодня');
});

// ---------- интервальные повторения ----------
test('повторения: старая запись без истории и счётчиков оценивается без ошибок; первый «забыл» не считается срывом', () => {
  const legacy = { card: 'c1', box: 3, due: '2026-11-10', first: '2026-10-01', last: '2026-11-03' };
  const g = grade(legacy, 'good', '2026-11-11');
  assert.equal(g.reps, 1); assert.deepEqual(g.hist, [['2026-11-11', 2]]); assert.equal(g.box, 4); assert.equal(g.due, '2026-11-25');
  const lapse = grade(legacy, 'again', '2026-11-11');
  assert.equal(lapse.lapses, 1); assert.equal(lapse.box, 0); assert.equal(lapse.due, '2026-11-11');
  assert.equal(grade(newState('c2', '2026-11-11'), 'again', '2026-11-11').lapses, 0, 'новая карточка: забыть первый раз — ещё не срыв');
  const hardTop = grade({ ...newState('c3', '2026-11-01'), box: 5 }, 'hard', '2026-11-11');
  assert.equal(hardTop.box, 5); assert.equal(hardTop.due, '2026-11-26', 'трудно: половина интервала (30 → 15 дней)');
  assert.equal(grade(newState('c4', '2026-11-11'), 'hard', '2026-11-11').due, '2026-11-12', 'в самой первой коробке — хотя бы день');
  assert.throws(() => grade(legacy, 'отлично', '2026-11-11'), /bad quality/); assert.throws(() => grade(legacy, 'good', '11.11.2026'), /bad date/);
  assert.equal(retention([{ card: 'a' }, { card: 'b', hist: [] }]), null, 'истории нет совсем');
  assert.equal(retention([{ card: 'a' }, { card: 'b', hist: [['2026-11-01', 2], ['2026-11-02', 0]] }]), 0.5);
});

test('повторения: очередь не превышает лимит новых на день и общий предел, сводка и серия занятий', () => {
  const cards = Array.from({ length: 12 }, (_, i) => ({ id: `k${i}` }));
  const today = '2026-11-11';
  const started = [{ ...newState('k0', today), box: 1, due: '2026-11-12' }, { ...newState('k1', today), box: 1, due: '2026-11-12' }];
  const q = buildQueue({ cards, states: started, today, newLimit: 3 });
  assert.equal(q.filter(x => !x.state).length, 1, 'сегодня уже начаты две новые, значит осталось одно место из трёх');
  assert.equal(buildQueue({ cards, states: started, today, newLimit: 1 }).length, 0, 'лимит исчерпан и ничего не просрочено');
  const old = cards.slice(0, 5).map((c, i) => ({ ...newState(c.id, '2026-10-01'), box: 2, due: `2026-11-0${i + 1}` }));
  const q2 = buildQueue({ cards, states: old, today, newLimit: 8, max: 6 });
  assert.equal(q2.length, 6); assert.deepEqual(q2.slice(0, 5).map(x => x.card.id), ['k0', 'k1', 'k2', 'k3', 'k4'], 'сначала самые просроченные');
  const s = srsSummary(cards, old, today);
  assert.equal(s.total, 12); assert.equal(s.started, 5); assert.equal(s.due, 5); assert.equal(s.fresh, 7); assert.equal(s.mastered, 0); assert.equal(s.retention, null);
  assert.equal(studyStreak([], today), 0);
  assert.equal(studyStreak(['2026-11-10', '2026-11-09', '2026-11-07'], today), 2, 'сегодня ещё можно позаниматься: серия не сгорает');
  assert.equal(studyStreak(['2026-11-11', '2026-11-10'], today), 2);
  assert.equal(studyStreak(['2026-11-08'], today), 0, 'пропущен вчерашний день — серия началась заново');
});

// ---------- разбор фраз ----------
test('фразы с датой: конец года и месяца, несуществующие числа, повтор без даты, пустой ввод', () => {
  const dec20 = at(2026, 12, 20), nov11 = at(2026, 11, 11);
  assert.deepEqual(parseQuick('оплатить жильё 5 числа', dec20), { text: 'оплатить жильё', due: '2027-01-05', repeat: null, found: ['число месяца'] }, '5-е число уже прошло — январь следующего года');
  assert.equal(parseQuick('отчёт 31 числа', at(2026, 4, 10)).due, '2026-04-30', 'в апреле 31-го нет — 30-е');
  assert.equal(parseQuick('отчёт 31 числа', at(2026, 4, 30)).due, '2026-04-30', 'сегодня и есть ближайшее число');
  assert.equal(parseQuick('встреча 30 февраля', nov11).due, null, 'такой даты не бывает: ничего не угадываем');
  assert.equal(parseQuick('встреча 30 февраля', nov11).text, 'встреча 30 февраля');
  assert.equal(parseQuick('отчёт 32 числа', nov11).due, null);
  assert.equal(parseQuick('мероприятие 29 февраля', at(2027, 3, 1)).due, '2028-02-29', 'ближайший високосный год');
  assert.deepEqual(parseQuick('зарядка каждую неделю', nov11), { text: 'зарядка', due: null, repeat: 'weekly', found: ['каждую неделю'] }, 'повтор можно без даты');
  assert.equal(parseQuick('поливать цветы еженедельно', nov11).repeat, 'weekly');
  assert.equal(parseQuick('оплата каждого 15 числа', nov11).due, '2026-11-15'); assert.equal(parseQuick('оплата каждого 15 числа', nov11).repeat, 'monthly');
  assert.equal(parseQuick('в пятницу', nov11).due, null, 'одна дата без текста задачи — не разбираем');
  assert.equal(parseQuick('созвон в среду', at(2026, 11, 11)).due, '2026-11-18', 'в среду, когда сегодня среда, — через неделю');
  assert.deepEqual(parseQuick(null, nov11), { text: '', due: null, repeat: null, found: [] });
  assert.deepEqual(parseQuick('  завтра  ', nov11), { text: 'завтра', due: null, repeat: null, found: [] }, 'исходный текст возвращается обрезанным');
});

// ---------- привычки ----------
test('правка привычки из старой версии: поля, которых форма не передала, сохраняются; пустое имя запрещено', () => {
  const h = makeHabit({ name: 'Зарядка', anchor: 'после чая', identity: 'Я человек, который двигается', plan: 'Если устал — 1 минута', days: [1, 3, 5] }, 1);
  const legacy = { ...h, payload: { name: 'Зарядка', anchor: '', minimum: '', full: '', startDate: '2026-01-01', archived: false } };
  const up = updateHabit(legacy, { name: '  Зарядка 2  ', anchor: 'утром', minimum: '1 минута', full: '10 минут' }, 5);
  assert.equal(up.payload.identity, ''); assert.equal(up.payload.plan, ''); assert.deepEqual(up.payload.days ?? [], [], 'старой записи нечего сохранять');
  const kept = updateHabit(h, { name: 'Зарядка', anchor: 'утром', minimum: '', full: '' }, 5);
  assert.equal(kept.payload.identity, 'Я человек, который двигается'); assert.equal(kept.payload.plan, 'Если устал — 1 минута'); assert.deepEqual(kept.payload.days, [1, 3, 5]);
  const cleared = updateHabit(h, { name: 'Зарядка', identity: '', plan: '', days: [] }, 5);
  assert.equal(cleared.payload.identity, ''); assert.equal(cleared.payload.plan, ''); assert.deepEqual(cleared.payload.days, [], 'пустое значение — осознанная очистка, а не «не передано»');
  assert.throws(() => updateHabit(h, { name: '   ' }), /empty habit/);
  assert.equal(h.payload.anchor, 'после чая', 'исходная запись не меняется');
});

// ---------- повторы задач ----------
test('повтор задачи: подпись и следующий срок через конец месяца и года', () => {
  assert.equal(repeatLabel(null), ''); assert.equal(repeatLabel({ type: 'daily' }), 'каждый день'); assert.equal(repeatLabel({ type: 'weekly' }), 'каждую неделю');
  assert.equal(repeatLabel({ type: 'monthly', day: 10 }), 'каждый месяц'); assert.equal(repeatLabel({ type: 'yearly' }), '', 'незнакомый вид повтора не ломает экран');
  assert.equal(nextDue('2026-12-31', { type: 'daily' }), '2027-01-01'); assert.equal(nextDue('2026-12-28', { type: 'weekly' }), '2027-01-04');
  assert.equal(nextDue('2026-12-31', { type: 'monthly' }), '2027-01-31'); assert.equal(nextDue('2027-01-31', { type: 'monthly' }), '2027-02-28', 'в феврале — последний день');
  assert.equal(nextDue('2027-02-28', { type: 'monthly', day: 31 }), '2027-03-31', 'исходное число (31) возвращается, когда месяц позволяет');
  assert.throws(() => nextDue('2026-11-11', null), /bad nextDue/); assert.throws(() => nextDue('не дата', { type: 'daily' }), /bad nextDue/); assert.throws(() => nextDue('2026-11-11', { type: 'yearly' }), /unknown repeat/);
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});
