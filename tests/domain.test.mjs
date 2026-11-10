import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTask, completeTask, todayStr, parseImport, serialize, cleanEvent, makeProfile, profileOf, groupTasks, updateTask } from '../events.js';
import { makeHabit, makeHabitLog, habitStats, habitCalendar, activeHabits, habitLogId, archiveHabit, updateHabit, logsOf } from '../habits.js';
import { makeIncome, makeEntry, balanceOfMonth, frequentEntries, INCOME_CATEGORIES, KINDS, monthTotals as monthTotals0 } from '../money.js';
import { parseAmount, formatMoney, makeExpense, updateExpense, summarizeMonth, shiftMonth, monthLabel, spentBetween, categoriesUsed,
  makeBudget, budgetOf, expensesToCsv, csvCell, DEFAULT_CATEGORIES } from '../money.js';
import { makeNote, updateNote, noteTitle, sortedNotes } from '../notes.js';
import { searchEvents, normalize } from '../search.js';
import { weekReview } from '../review.js';
import { dayLog } from '../journal.js';
import { HABIT_TEMPLATES } from '../habits.js';
import { passwordStrength, checkPassword } from '../vault.js';
import { parseQuick } from '../quick.js';
import { toMarkdown } from '../export.js';
import { encryptBackup, decryptBackup, readBackup, backupKind, BadBackupPasswordError, NeedPasswordError } from '../backup.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const NOW = at(2026, 11, 10);          // вторник
const TODAY = '2026-11-10';
const FAST = { iterations: 2000 };

// ---------- привычки ----------
const mkHabit = (start = at(2026, 11, 1)) => makeHabit({ name: 'Python', anchor: 'после завтрака', minimum: 'открыть редактор' }, start);
const logs = (h, dates, level = 'full') => dates.map(d => makeHabitLog(h, d, level));

test('привычка: создание, валидация, одна отметка в день (детерминированный id)', () => {
  const h = mkHabit();
  assert.equal(h.payload.startDate, '2026-11-01');
  assert.throws(() => makeHabit({ name: '  ' }));
  const l1 = makeHabitLog(h, TODAY, 'full'), l2 = makeHabitLog(h, TODAY, 'min');
  assert.equal(l1.id, l2.id, 'повторная отметка перезаписывает, а не дублирует');
  assert.equal(l1.id, habitLogId(h.id, TODAY));
  assert.throws(() => makeHabitLog(h, '2026-02-30', 'full'));
  assert.throws(() => makeHabitLog(h, TODAY, 'super'));
});
test('привычка: серия не сгорает, пока день не кончился', () => {
  const h = mkHabit();
  const ev = [h, ...logs(h, ['2026-11-07', '2026-11-08', '2026-11-09'])];
  let st = habitStats(h, ev, TODAY);
  assert.equal(st.doneToday, false);
  assert.equal(st.streak, 3, 'сегодня ещё не отмечено, но серия жива');
  assert.equal(st.neverMissTwice, false, 'вчера выполнено');
  ev.push(...logs(h, [TODAY]));
  st = habitStats(h, ev, TODAY);
  assert.equal(st.streak, 4); assert.equal(st.doneToday, true); assert.equal(st.level, 'full');
});
test('привычка: «не пропусти второй раз», регулярность и самая длинная серия', () => {
  const h = mkHabit();
  const ev = [h, ...logs(h, ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-08'])];
  const st = habitStats(h, ev, TODAY);
  assert.equal(st.streak, 0, 'вчера (9-го) пропуск — серия 0');
  assert.equal(st.missedYesterday, true);
  assert.equal(st.neverMissTwice, true);
  assert.equal(st.longest, 4);
  assert.equal(st.span, 10, '1–10 ноября, привычка создана 1-го');
  assert.equal(st.hits, 5);
  assert.equal(st.consistency, 0.5);
  assert.equal(st.gapDays, 2);
  assert.equal(st.needsRecovery, false);
  ev.push(...logs(h, [TODAY]));
  assert.equal(habitStats(h, ev, TODAY).neverMissTwice, false, 'сегодня отметил — предупреждение снято');
});
test('привычка: в день создания нет «пропуска вчера»; окно — не больше 30 дней; перерыв ≥3 дней = возвращение', () => {
  const h = makeHabit({ name: 'x' }, NOW);
  assert.equal(habitStats(h, [h], TODAY).missedYesterday, false);
  assert.equal(habitStats(h, [h], TODAY).span, 1);
  const old = makeHabit({ name: 'y' }, at(2026, 6, 1));
  const st = habitStats(old, [old, ...logs(old, ['2026-11-05'])], TODAY);
  assert.equal(st.span, 30);
  assert.equal(st.gapDays, 5); assert.equal(st.needsRecovery, true);
});
test('привычка: чужие отметки не считаются; календарь; сортировка; архив; правка', () => {
  const a = mkHabit(), b = makeHabit({ name: 'Бег' }, at(2026, 11, 1));
  const ev = [a, b, ...logs(a, [TODAY]), ...logs(b, ['2026-11-09'])];
  assert.equal(habitStats(a, ev, TODAY).doneToday, true);
  assert.equal(habitStats(b, ev, TODAY).doneToday, false);
  const cal = habitCalendar(a, ev, TODAY, 28);
  assert.equal(cal.length, 28); assert.equal(cal.at(-1).date, TODAY); assert.equal(cal.at(-1).level, 'full'); assert.equal(cal.at(-1).today, true);
  assert.equal(cal[0].before, true, 'дни до создания помечены');
  assert.deepEqual(activeHabits(ev, TODAY).map(x => x.h.payload.name), ['Бег', 'Python'], 'невыполненные выше');
  assert.equal(activeHabits([archiveHabit(a), b], TODAY).length, 1);
  assert.equal(archiveHabit(archiveHabit(a), false).payload.archived, false);
  assert.equal(updateHabit(a, { name: 'Python 2', anchor: '', minimum: '', full: '' }).payload.name, 'Python 2');
  assert.throws(() => updateHabit(a, { name: ' ' }));
  assert.equal(logsOf(ev, a.id).length, 1);
});

// ---------- деньги ----------
test('сумма: форматы ввода, копейки, ошибки', () => {
  assert.equal(parseAmount('1250'), 125000);
  assert.equal(parseAmount('1 250,50'), 125050);
  assert.equal(parseAmount('1 250.5'), 125050);
  assert.equal(parseAmount('0,07'), 7);
  for (const bad of ['', 'abc', '-5', '0', '0,00', '1,234', '1e5', '12..5', '999999999999']) assert.throws(() => parseAmount(bad), bad);
});
test('формат денег без дробных артефактов', () => {
  assert.equal(formatMoney(125050), '1 250,50 ₽');
  assert.equal(formatMoney(100), '1 ₽');
  assert.equal(formatMoney(7), '0,07 ₽');
  assert.equal(formatMoney(123456789), '1 234 567,89 ₽');
  assert.equal(parseAmount('0,1') + parseAmount('0,2'), 30, 'вместо 0.1+0.2=0.30000000000000004');
});
test('расходы: создание, правка, месяц, категории, доли', () => {
  const e1 = makeExpense({ amount: '30000', category: 'Жильё', date: '2026-11-10' }, NOW);
  const e2 = makeExpense({ amount: '1 500,50', category: 'Еда', note: 'хлеб', date: '2026-11-02' }, NOW);
  const e3 = makeExpense({ amount: '700', category: 'Еда', date: '2026-11-05' }, NOW);
  const e4 = makeExpense({ amount: '999', category: 'Еда', date: '2026-10-31' }, NOW);
  assert.equal(e1.payload.amountMinor, 3000000);
  const s = summarizeMonth([e1, e2, e3, e4, { id: 'z', type: 'task', ts: 1, payload: {} }], '2026-11');
  assert.equal(s.count, 3);
  assert.equal(s.total, 3000000 + 150050 + 70000);
  assert.deepEqual(s.byCategory.map(c => c.category), ['Жильё', 'Еда']);
  assert.ok(Math.abs(s.byCategory.reduce((a, c) => a + c.share, 0) - 1) < 1e-9);
  assert.deepEqual(s.items.map(i => i.payload.date), ['2026-11-10', '2026-11-05', '2026-11-02'], 'новые сверху');
  assert.equal(spentBetween([e1, e2, e3, e4], '2026-11-01', '2026-11-05'), 150050 + 70000);
  const u = updateExpense(e2, { amount: '2000', category: 'Продукты', note: '', date: '2026-11-03' }, NOW + 1);
  assert.equal(u.id, e2.id); assert.equal(u.payload.amountMinor, 200000); assert.equal(u.payload.date, '2026-11-03');
  assert.equal(makeExpense({ amount: '5' }, NOW).payload.category, 'Другое');
  assert.throws(() => makeExpense({ amount: '5', date: '2026-13-01' }, NOW));
  assert.throws(() => makeExpense({ amount: 0 }, NOW));
  assert.deepEqual(categoriesUsed([e2, e3, e1]).slice(0, 2), ['Еда', 'Жильё']);
  assert.ok(categoriesUsed([]).length === DEFAULT_CATEGORIES.length);
});
test('месяцы: сдвиг через границу года, подписи', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-11', 14), '2028-01');
  assert.equal(monthLabel('2026-11'), 'Ноябрь 2026');
});
test('бюджет: запись и сброс', () => {
  assert.equal(budgetOf([makeBudget(5000000)]), 5000000);
  assert.equal(budgetOf([makeBudget(null)]), null);
  assert.equal(budgetOf([]), null);
  assert.throws(() => makeBudget(-1)); assert.throws(() => makeBudget(1.5));
});
test('CSV: разделитель, BOM, кавычки и защита от формул', () => {
  const ev = [makeExpense({ amount: '1500,5', category: 'Еда', note: '=HYPERLINK("http://x")', date: '2026-11-02' }, NOW),
    makeExpense({ amount: '10', category: 'A;B', note: 'строка\nвторая', date: '2026-11-01' }, NOW)];
  const csv = expensesToCsv(ev);
  assert.ok(csv.startsWith('\ufeffТип;Дата;Сумма;Категория;Комментарий\r\n'));
  assert.ok(csv.includes('Расход;2026-11-02;1500,50;Еда;'), 'строка расхода');
  assert.ok(csv.includes("'=HYPERLINK"), 'ячейка с «=» экранирована');
  assert.ok(csv.includes('"A;B"'));
  assert.ok(csv.includes('"строка\nвторая"'));
  assert.ok(csv.includes('1500,50'));
  assert.equal(csvCell('+1'), "'+1"); assert.equal(csvCell('@a'), "'@a"); assert.equal(csvCell('-2'), "'-2"); assert.equal(csvCell('ok'), 'ok');
});

// ---------- заметки и поиск ----------
test('заметки: создание, правка, заголовок, порядок', () => {
  const a = makeNote('  первая\nвторая строка ', 100), b = makeNote('вторая', 200);
  assert.equal(a.payload.text, 'первая\nвторая строка');
  assert.throws(() => makeNote('   ')); assert.throws(() => makeNote('x'.repeat(20001)));
  assert.equal(noteTitle('\n\nзаголовок\nтекст'), 'заголовок');
  assert.equal(noteTitle('x'.repeat(100)).length, 60);
  assert.deepEqual(sortedNotes([a, b]).map(n => n.payload.text), ['вторая', 'первая\nвторая строка'], 'новые сверху');
  const u = updateNote(a, 'правка', 300);
  assert.equal(u.id, a.id); assert.equal(u.payload.editedAt, 300);
  assert.deepEqual(sortedNotes([u, b]).map(n => n.payload.text), ['правка', 'вторая'], 'отредактированная поднимается наверх');
  assert.throws(() => updateNote(a, '  '));
});
test('поиск: регистр, ё/е, несколько слов, типы, пустой запрос', () => {
  const t = makeTask('Купить ЁЛКУ и хлеб', 1), n = makeNote('идея про ёлку\nвторая строка', 2),
    h = makeHabit({ name: 'Зарядка', anchor: 'после сна' }, 3), e = makeExpense({ amount: '120', category: 'Еда', note: 'хлеб', date: TODAY }, 4);
  const ev = [t, n, h, e];
  assert.equal(normalize('Ёж'), 'еж');
  assert.deepEqual(searchEvents(ev, 'елку').map(r => r.kind).sort(), ['Задача', 'Заметка']);
  assert.deepEqual(searchEvents(ev, 'ХЛЕБ').map(r => r.kind).sort(), ['Задача', 'Расход']);
  assert.deepEqual(searchEvents(ev, 'купить хлеб').map(r => r.kind), ['Задача'], 'все слова должны встретиться');
  assert.equal(searchEvents(ev, 'после сна')[0].tab, 'habits');
  assert.equal(searchEvents(ev, '120')[0].kind, 'Расход', 'ищет и по сумме');
  assert.deepEqual(searchEvents(ev, '   '), []);
  assert.deepEqual(searchEvents(ev, 'нет такого'), []);
  assert.equal(searchEvents([{ id: 'p', type: 'profile', ts: 1, payload: { name: 'ёлка' } }], 'елка').length, 0, 'профиль не ищется');
});

// ---------- разбор дат ----------
test('quick: относительные даты и дни недели', () => {
  const p = s => parseQuick(s, NOW);
  assert.deepEqual([p('купить хлеб завтра').text, p('купить хлеб завтра').due], ['купить хлеб', '2026-11-11']);
  assert.equal(p('на завтра сделать').due, '2026-11-11'); assert.equal(p('на завтра сделать').text, 'сделать');
  assert.equal(p('позвонить послезавтра').due, '2026-11-12');
  assert.equal(p('сегодня оплатить').due, TODAY);
  assert.equal(p('позвонить в пятницу маме').text, 'позвонить маме');
  assert.equal(p('позвонить в пятницу маме').due, '2026-11-13');
  assert.equal(p('в понедельник отчёт').due, '2026-11-16');
  assert.equal(p('во вторник встреча').due, '2026-11-17', 'сегодня вторник — берётся следующий');
  assert.equal(p('через 3 дня врач').due, '2026-11-13');
  assert.equal(p('через неделю звонок').due, '2026-11-17');
  assert.equal(p('через 2 недели отчёт').due, '2026-11-24');
});
test('quick: числа, месяцы и повторы', () => {
  const p = s => parseQuick(s, NOW);
  assert.equal(p('15 ноября встреча').due, '2026-11-15');
  assert.equal(p('5 ноября ДР').due, '2027-11-05', 'прошедшая дата — на следующий год');
  assert.equal(p('10 числа оплатить').due, TODAY);
  assert.equal(p('9 числа оплатить').due, '2026-12-09');
  assert.equal(p('до 31 числа сдать').due, '2026-11-30', 'в ноябре нет 31-го');
  const r = p('оплатить жильё 10 числа каждого месяца');
  assert.deepEqual([r.text, r.due, r.repeat], ['оплатить жильё', TODAY, 'monthly']);
  const w = p('каждую пятницу отчёт'); assert.deepEqual([w.text, w.due, w.repeat], ['отчёт', '2026-11-13', 'weekly']);
  const d = p('каждый день зарядка'); assert.deepEqual([d.text, d.repeat], ['зарядка', 'daily']);
  const m = p('каждого 5 числа аренда'); assert.deepEqual([m.text, m.due, m.repeat], ['аренда', '2026-12-05', 'monthly']);
  assert.equal(p('ежемесячно проверять счета').repeat, 'monthly');
});
test('quick: без уверенности ничего не меняет', () => {
  for (const s of ['завтра', 'версия 1.2 релиз', 'купить 3 яблока', 'позвонить', '  ', 'в 5 вечера', '32 числа', 'сегодняшний отчёт']) {
    const r = parseQuick(s, NOW);
    assert.equal(r.due, null, s); assert.equal(r.repeat, null, s); assert.equal(r.text, s.trim(), s);
  }
  assert.equal(parseQuick('сегодняшний отчёт', NOW).due, null, 'слово «сегодняшний» — не «сегодня»');
});
test('quick + makeTask: результат пригоден для создания задачи', () => {
  const q = parseQuick('оплатить жильё 10 числа каждого месяца', NOW);
  const t = makeTask(q.text, NOW, { due: q.due, repeat: q.repeat });
  assert.deepEqual(t.payload.repeat, { type: 'monthly', day: 10 });
  assert.equal(completeTask(t, NOW).next.payload.due, '2026-12-10');
});

// ---------- обзор недели ----------
test('обзор недели: сделанные задачи, привычки, расходы за 7 дней и за предыдущие 7', () => {
  const t1 = completeTask(makeTask('a', at(2026, 11, 1)), at(2026, 11, 9)).updated;
  const t2 = completeTask(makeTask('b', at(2026, 11, 1)), at(2026, 11, 10)).updated;
  const t3 = completeTask(makeTask('c', at(2026, 11, 1)), at(2026, 11, 2)).updated;     // предыдущая неделя (3–9 ноября? нет: 27 окт–2 ноя... 2 ноября = prev)
  const t4 = makeTask('открытая', NOW);
  const h = makeHabit({ name: 'Бег' }, at(2026, 11, 1));
  const ev = [t1, t2, t3, t4, h, ...['2026-11-08', '2026-11-09', TODAY].map(d => makeHabitLog(h, d, 'full')),
    makeExpense({ amount: '100', date: '2026-11-08' }, NOW), makeExpense({ amount: '50', date: '2026-11-02' }, NOW),
    makeNote('n', at(2026, 11, 9))];
  const r = weekReview(ev, TODAY);
  assert.equal(r.from, '2026-11-04');
  assert.equal(r.tasksDone, 2);
  assert.equal(r.prevDone, 1);
  assert.equal(r.perDay.length, 7); assert.equal(r.perDay.at(-1).count, 1); assert.equal(r.perDay.at(-2).count, 1);
  assert.equal(r.habits[0].hits, 3); assert.equal(r.habits[0].of, 7);
  assert.equal(r.spent, 10000); assert.equal(r.spentPrev, 5000);
  assert.equal(r.notes, 1);
});

// ---------- профиль ----------
test('профиль: имя, accountId сохраняется при правке', () => {
  const p = makeProfile('  Имя  ', 1);
  assert.equal(p.payload.name, 'Имя');
  const p2 = makeProfile('Другое', 2, p);
  assert.equal(p2.payload.accountId, p.payload.accountId);
  assert.equal(profileOf([p2]).payload.name, 'Другое');
  assert.equal(profileOf([]), null);
  assert.equal(makeProfile('x'.repeat(200), 1).payload.name.length, 60);
});

// ---------- задачи: приоритет ----------
test('задачи: приоритет «важное» поднимает задачу внутри группы, правка меняет приоритет', () => {
  const a = makeTask('обычная', 1, { due: TODAY }), b = makeTask('важная', 2, { due: TODAY, priority: 'high' });
  assert.deepEqual(groupTasks([a, b], TODAY).today.map(t => t.payload.text), ['важная', 'обычная']);
  assert.equal(updateTask(a, { text: 'обычная', due: TODAY, repeat: null, priority: 'high' }).payload.priority, 'high');
  assert.equal(updateTask(b, { text: 'важная', due: TODAY, repeat: null }).payload.priority, 'high', 'без указания приоритет сохраняется');
  const old = { id: 'o', type: 'task', ts: 1, payload: { text: 'старая', done: false, doneAt: null } };
  assert.equal(updateTask(old, { text: 'старая', due: null, repeat: null }).payload.priority, 'normal');
});

// ---------- импорт: строгая проверка ----------
test('импорт: отбрасывает мусор, нормализует поля, не принимает чужие ключи верхнего уровня', () => {
  const good = makeTask('ok', 1);
  const evil = JSON.parse('{"id":"e","type":"task","ts":1,"payload":{"__proto__":{"polluted":1},"text":"x"},"source":"' + 'a'.repeat(100) + '","confidence":7,"evidence":"no","extra":"drop"}');
  const text = JSON.stringify({ app: 'lifeos', events: [good, evil, { id: 'x'.repeat(101), type: 'task', ts: 1, payload: {} },
    { id: 'a', type: 'Bad Type', ts: 1, payload: {} }, { id: 'b', type: 'task', ts: NaN, payload: {} },
    { id: 'c', type: 'task', ts: 1, payload: [] }, 5, null, 'str'] });
  const { events, skipped } = parseImport(text);
  assert.equal(skipped, 7);
  assert.equal(events.length, 2);
  const e = events[1];
  assert.equal(e.source.length, 20); assert.equal(e.confidence, 1); assert.deepEqual(e.evidence, []); assert.equal('extra' in e, false);
  assert.equal({}.polluted, undefined, 'прототип Object не загрязнён');
  assert.equal(cleanEvent({ id: 'a', type: 'note', ts: 1, payload: {} }).source, 'import');
  assert.throws(() => parseImport(JSON.stringify({ app: 'lifeos', events: new Array(200001).fill(0) })), /Слишком много/);
});

// ---------- зашифрованные копии ----------
test('копия: шифрование, чтение с паролем, неверный пароль, подмена, понимает оба формата', async () => {
  const ev = [makeTask('секретная задача', 1), makeExpense({ amount: '500', date: TODAY }, NOW)];
  const file = await encryptBackup(ev, 'надёжный-пароль', FAST);
  assert.equal(backupKind(file), 'encrypted');
  assert.ok(!file.includes('секретная'), 'в файле нет открытого текста');
  const back = await decryptBackup(file, 'надёжный-пароль');
  assert.deepEqual(back.events, ev); assert.equal(back.skipped, 0);
  await assert.rejects(decryptBackup(file, 'другой-пароль-1'), BadBackupPasswordError);
  await assert.rejects(decryptBackup(file, ''), NeedPasswordError);
  const d = JSON.parse(file); d.ct = d.ct.slice(0, -4) + 'AAAA';
  await assert.rejects(decryptBackup(JSON.stringify(d), 'надёжный-пароль'), BadBackupPasswordError, 'подмена шифртекста обнаружена');
  await assert.rejects(decryptBackup(JSON.stringify({ ...JSON.parse(file), iter: 5 }), 'надёжный-пароль'), /параметры/);
  await assert.rejects(decryptBackup(JSON.stringify({ ...JSON.parse(file), iter: 999_999_999 }), 'надёжный-пароль'), /параметры/);
  await assert.rejects(encryptBackup(ev, 'short', FAST), /не короче/);
  assert.equal(backupKind(serialize(ev)), 'plain'); assert.equal(backupKind('{"a":1}'), 'unknown'); assert.equal(backupKind('мусор'), 'unknown');
  const plain = await readBackup(serialize(ev));
  assert.equal(plain.encrypted, false); assert.equal(plain.events.length, 2);
  const enc = await readBackup(file, 'надёжный-пароль');
  assert.equal(enc.encrypted, true);
  await assert.rejects(readBackup('{"x":1}'), /не резервная/);
  await assert.rejects(readBackup('x'.repeat(31 * 1024 * 1024)), /слишком большой/);
});

// ---------- Markdown ----------
test('Markdown-экспорт содержит все разделы и не ломается на пустых данных', () => {
  const md = toMarkdown([makeTask('задача', 1, { due: TODAY, priority: 'high' }), completeTask(makeTask('готово', 1), 5).updated,
    makeNote('текст заметки', NOW), makeExpense({ amount: '100', category: 'Еда', note: 'x\ny', date: TODAY }, NOW), makeHabit({ name: 'Бег' }, NOW)], NOW);
  for (const part of ['## Задачи', '- [ ] задача ★ (до 2026-11-10)', '- [x] готово', '## Привычки', '**Бег**', '## Заметки', 'текст заметки', '## Расходы', '100 ₽', 'x y']) assert.ok(md.includes(part), part);
  const empty = toMarkdown([], NOW);
  assert.equal((empty.match(/_нет_/g) || []).length, 7, 'задачи, привычки, заметки, расходы, доходы, дневник, замеры');
  for (const part of ['## Дневник', '## Замеры']) assert.ok(empty.includes(part), part);
});

// ---------- напоминания ----------
import { planReminders, atLocal, HORIZON_DAYS, TASK_ID_BASE, HABIT_ID_BASE } from '../reminders.js';
import { monthTotals } from '../money.js';

test('напоминания: по одному на день со сроками, общий текст без названий задач', () => {
  const now = at(2026, 11, 10, 7);                           // 7:00 — до 9:00
  const ev = [makeTask('секретное название', 1, { due: TODAY }), makeTask('ещё', 1, { due: TODAY }), makeTask('вчерашняя', 1, { due: '2026-11-09' }),
    makeTask('послезавтра', 1, { due: '2026-11-12' }), makeTask('без срока', 1)];
  const r = planReminders(ev, now, { taskHour: 9, habitHour: -1 });
  assert.equal(r.length, 2);
  assert.deepEqual(r.map(x => x.id), [TASK_ID_BASE, TASK_ID_BASE + 2]);
  assert.equal(r[0].at, atLocal(TODAY, 9));
  assert.equal(r[0].body, '2 задачи на сегодня, просрочено: 1');
  assert.equal(r[1].body, '1 задача на сегодня');
  assert.ok(r.every(x => !x.body.includes('секретное') && !x.body.includes('вчерашняя') && x.title === 'Life OS'), 'названий задач в уведомлениях нет');
});
test('напоминания: время уже прошло — на сегодня не планируем; выполненные и отключение часов', () => {
  const now = at(2026, 11, 10, 10);
  const ev = [makeTask('a', 1, { due: TODAY }), makeTask('b', 1, { due: '2026-11-11' }), completeTask(makeTask('c', 1, { due: '2026-11-12' }), 5).updated];
  const r = planReminders(ev, now, { taskHour: 9, habitHour: -1 });
  assert.deepEqual(r.map(x => x.id), [TASK_ID_BASE + 1], 'только завтра; готовая задача не напоминает');
  assert.equal(planReminders(ev, now, { taskHour: -1, habitHour: -1 }).length, 0);
});
test('напоминания: привычки — сегодня только если не отмечено; идентификаторы уникальны; горизонт ограничен', () => {
  const now = at(2026, 11, 10, 8);
  const h = makeHabit({ name: 'Бег' }, at(2026, 11, 1));
  const none = planReminders([h], now, { taskHour: -1, habitHour: 20 });
  assert.equal(none.length, HORIZON_DAYS);
  assert.equal(none[0].id, HABIT_ID_BASE);
  const done = planReminders([h, makeHabitLog(h, TODAY, 'min')], now, { taskHour: -1, habitHour: 20 });
  assert.equal(done.length, HORIZON_DAYS - 1, 'сегодня уже отмечено — без напоминания');
  assert.equal(done[0].id, HABIT_ID_BASE + 1);
  const many = Array.from({ length: 40 }, (_, i) => makeTask('t' + i, 1, { due: `2026-11-${String(10 + (i % 5)).padStart(2, '0')}` }));
  const all = planReminders([...many, h], now);
  assert.equal(new Set(all.map(x => x.id)).size, all.length, 'id не повторяются');
  assert.ok(all.every(x => x.at > now && x.id < 3000));
  assert.deepEqual(planReminders([], now), []);
  assert.deepEqual(planReminders([makeHabit({ name: 'x' }, at(2026, 11, 1)), ], now, { habitHour: 20, taskHour: -1 }).length, HORIZON_DAYS);
});
test('напоминания: склонение «задача/задачи/задач»', () => {
  const now = at(2026, 11, 10, 7);
  const mk = n => planReminders(Array.from({ length: n }, (_, i) => makeTask('t' + i, 1, { due: TODAY })), now, { taskHour: 9, habitHour: -1 })[0].body;
  assert.equal(mk(1), '1 задача на сегодня'); assert.equal(mk(3), '3 задачи на сегодня'); assert.equal(mk(5), '5 задач на сегодня');
  assert.equal(mk(11), '11 задач на сегодня'); assert.equal(mk(21), '21 задача на сегодня'); assert.equal(mk(22), '22 задачи на сегодня');
});
test('расходы по месяцам: шесть месяцев, нули там, где пусто', () => {
  const ev = [makeExpense({ amount: '100', date: '2026-11-03' }, NOW), makeExpense({ amount: '50', date: '2026-09-30' }, NOW), makeExpense({ amount: '7', date: '2025-12-31' }, NOW)];
  const r = monthTotals(ev, '2026-11', 6);
  assert.deepEqual(r.map(x => x.ym), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(r.map(x => x.total), [0, 0, 0, 5000, 0, 10000]);
  assert.equal(monthTotals(ev, '2026-01', 3)[0].ym, '2025-11', 'через границу года');
});

// ---------- доходы и баланс ----------
test('доходы: создание, правка сохраняет тип, баланс месяца, категории по типу', () => {
  const inc = makeIncome({ amount: '100 000', category: 'Зарплата', date: '2026-11-05' }, NOW);
  const ex = makeExpense({ amount: '34 540,50', category: 'Еда', date: '2026-11-06' }, NOW);
  const other = makeIncome({ amount: '5000', date: '2026-10-05' }, NOW);
  assert.equal(inc.type, 'income'); assert.equal(other.payload.category, 'Другое');
  assert.deepEqual(balanceOfMonth([inc, ex, other], '2026-11'), { income: 10000000, expense: 3454050, balance: 6545950 });
  assert.equal(balanceOfMonth([ex], '2026-11').balance, -3454050, 'отрицательный баланс');
  assert.equal(summarizeMonth([inc, ex], '2026-11', 'income').total, 10000000);
  assert.equal(summarizeMonth([inc, ex], '2026-11').total, 3454050, 'по умолчанию — расходы');
  const u = updateExpense(inc, { amount: '120000', category: 'Зарплата', note: 'премия', date: '2026-11-05' }, NOW + 1);
  assert.equal(u.type, 'income'); assert.equal(u.payload.amountMinor, 12000000);
  assert.deepEqual(categoriesUsed([inc], 'income').slice(0, 2), ['Зарплата', 'Подработка']);
  assert.ok(!categoriesUsed([], 'income').includes('Еда'));
  assert.equal(monthTotals0([inc, ex], '2026-11', 2, 'income')[1].total, 10000000);
  assert.throws(() => makeEntry('gift', { amount: '1' }));
  assert.equal(KINDS.income.categories, INCOME_CATEGORIES);
});
test('CSV и Markdown содержат и доходы, и расходы; поиск находит доходы', () => {
  const ev = [makeIncome({ amount: '1000', category: 'Зарплата', note: 'аванс', date: TODAY }, NOW), makeExpense({ amount: '50', category: 'Еда', date: TODAY }, NOW)];
  const csv = expensesToCsv(ev);
  assert.ok(csv.includes('Доход;' + TODAY + ';1000,00;Зарплата;аванс') && csv.includes('Расход;' + TODAY + ';50,00;Еда;'));
  const md = toMarkdown(ev, NOW);
  assert.ok(md.includes('## Доходы') && md.includes('аванс'));
  assert.equal(searchEvents(ev, 'аванс')[0].kind, 'Доход');
  assert.equal(searchEvents(ev, 'аванс')[0].tab, 'money');
  assert.equal(weekReview(ev, TODAY).income, 100000);
});
test('частые траты: пары «категория + сумма» от двух раз, по убыванию', () => {
  const mk = (c, a, d) => makeExpense({ amount: a, category: c, date: d }, at(2026, 11, Number(d.slice(-2))));
  const ev = [mk('Еда', '350', '2026-11-01'), mk('Еда', '350', '2026-11-02'), mk('Еда', '350', '2026-11-03'), mk('Транспорт', '60', '2026-11-04'), mk('Транспорт', '60', '2026-11-05'),
    mk('Еда', '700', '2026-11-06'), mk('Кино', '500', '2026-11-07')];
  const f = frequentEntries(ev, 'expense');
  assert.deepEqual(f.map(x => [x.category, x.amountMinor, x.count]), [['Еда', 35000, 3], ['Транспорт', 6000, 2]]);
  assert.deepEqual(frequentEntries(ev, 'income'), []);
  assert.equal(frequentEntries(ev, 'expense', 1).length, 1);
  assert.equal(frequentEntries(ev, 'expense', 4, 1).length, 4, 'порог можно снизить');
});

// ---------- журнал дня ----------
test('журнал дня: задачи, привычки, деньги, заметки — по времени, только за выбранный день', () => {
  const h = makeHabit({ name: 'Бег' }, at(2026, 11, 1));
  const t = completeTask(makeTask('отчёт', at(2026, 11, 9)), at(2026, 11, 10, 15)).updated;
  const old = completeTask(makeTask('вчера', at(2026, 11, 8)), at(2026, 11, 9, 15)).updated;
  const l = makeHabitLog(h, TODAY, 'min', at(2026, 11, 10, 8));
  const e = makeExpense({ amount: '120', category: 'Еда', note: 'кофе', date: TODAY }, at(2026, 11, 10, 12));
  const i = makeIncome({ amount: '500', category: 'Подарок', date: TODAY }, at(2026, 11, 10, 13));
  const n = makeNote('идея\nвторая строка', at(2026, 11, 10, 20));
  const other = makeNote('вчерашняя', at(2026, 11, 9, 20));
  const log = dayLog([h, t, old, l, e, i, n, other], TODAY);
  assert.deepEqual(log.map(x => x.kind), ['Привычка', 'Расход', 'Доход', 'Задача', 'Заметка']);
  assert.equal(log[0].text, 'Бег — минимум');
  assert.equal(log[1].text, '−120\u00a0₽ · Еда — кофе');
  assert.equal(log[2].text, '+500\u00a0₽ · Подарок');
  assert.equal(log[4].text, 'идея');
  assert.deepEqual(dayLog([h, t], '2026-11-12'), []);
});

// ---------- шаблоны привычек и пароли ----------
test('шаблоны привычек валидны (из них можно создать привычку)', () => {
  assert.ok(HABIT_TEMPLATES.length >= 4);
  for (const tpl of HABIT_TEMPLATES) { const h = makeHabit(tpl, NOW); assert.equal(h.payload.name, tpl.name); assert.ok(tpl.minimum && tpl.anchor); }
});
test('надёжность пароля: подсказка и отказ от самых известных', () => {
  assert.equal(passwordStrength('').score, 0);
  assert.equal(passwordStrength('password').score, 0);
  assert.ok(passwordStrength('abcdefgh').score <= 1);
  assert.ok(passwordStrength('длинная-надёжная-фраза-для-входа').score >= 3);
  assert.ok(passwordStrength('Ab1!Ab1!Ab1!Ab1!xY').score >= 3);
  assert.ok(passwordStrength('aaaaaaaaaaaaaaaaaaaa').score <= 2, 'длинный, но однообразный');
  for (const bad of ['password', 'PASSWORD', '12345678', 'qwertyui', 'йцукенгш', 'Password1']) assert.match(checkPassword(bad) || '', /известный/, bad);
  assert.equal(checkPassword('длинная-надёжная-фраза'), null);
  assert.match(checkPassword('коротк'), /не короче/);
});
