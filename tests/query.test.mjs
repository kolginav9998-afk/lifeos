// Консоль запросов (query.js): парсер, фильтры, регулярки с защитой, хроно-отчёт и explain.
// Интерфейс здесь не проверяется — только чистая логика (она же работает в браузере).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, compileRe, runQuery, queryToCsv, regexSearch, parseDatesInput, chronoReport, explainEvent, eventDate, conditions } from '../query.js';
import { formatMoney } from '../money.js';

// Фиксированное «сейчас»: вторник 10 ноября 2026, полдень.
const NOW = new Date(2026, 10, 10, 12).getTime();
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
let n = 0;
const ev = (type, payload, ts = at(2026, 11, 1)) => ({ id: `${type}-${++n}`, type, ts, payload, source: 'manual', confidence: 1, evidence: [] });

// ---------- парсер ----------

test('парсер: полный запрос из условий и текста', () => {
  const { ok, query, errors } = parseQuery('type:expense amount>1000 last:30d кофе');
  assert.ok(ok);
  assert.deepEqual(errors, []);
  assert.deepEqual(query.types, ['expense']);
  assert.deepEqual(query.amount, { op: '>', minor: 100000 });
  assert.equal(query.lastDays, 30);
  assert.deepEqual(query.text, ['кофе']);
});

test('парсер: несколько типов, amount с копейками, даты, id', () => {
  const { ok, query } = parseQuery('type:expense,income amount<500,50 from:2026-01-01 to:2026-02-01 id:abc-1');
  assert.ok(ok);
  assert.deepEqual(query.types, ['expense', 'income']);
  assert.deepEqual(query.amount, { op: '<', minor: 50050 });
  assert.equal(query.from, '2026-01-01');
  assert.equal(query.to, '2026-02-01');
  assert.equal(query.id, 'abc-1');
});

test('парсер: текст нормализуется (ё → е, регистр)', () => {
  const { query } = parseQuery('Ёжик КОФЕ');
  assert.deepEqual(query.text, ['ежик', 'кофе']);
});

test('парсер: re: со слэшами, с флагами, с пробелами в шаблоне', () => {
  assert.equal(parseQuery('re:/кофе|чай/i').query.re.source, 'кофе|чай');
  assert.ok(parseQuery('re:/кофе|чай/i').query.re.flags.includes('i'));
  assert.equal(parseQuery('re:/утренний кофе/').query.re.source, 'утренний кофе');
  assert.equal(parseQuery('re:кофе').query.re.source, 'кофе');
});

test('парсер: ошибки — неизвестный тип, плохая дата, last вне диапазона, from позже to', () => {
  assert.match(parseQuery('type:hologram').errors[0], /Неизвестный тип/);
  assert.match(parseQuery('from:2026-13-40').errors[0], /from:/);
  assert.match(parseQuery('to:вчера').errors[0], /to:/);
  assert.match(parseQuery('last:0d').errors[0], /last:/);
  assert.match(parseQuery('from:2026-05-01 to:2026-01-01').errors[0], /from: позже/);
});

test('парсер: пустой запрос и запрос только с ошибками — не ok', () => {
  assert.equal(parseQuery('').ok, false);
  assert.equal(parseQuery('   ').ok, false);
  assert.equal(parseQuery('type:hologram').ok, false);
});

// ---------- регулярки: безопасность ----------

test('регулярки: защита от катастрофического перебора и мусора', () => {
  assert.match(compileRe('(a+)+').error ?? '', /повтор внутри повтора/);
  assert.match(compileRe('(\\w+\\s?)*$').error ?? '', /повтор внутри повтора/);
  assert.match(compileRe('(a)\\1').error ?? '', /Обратные ссылки/);
  assert.match(compileRe('x'.repeat(121)).error ?? '', /Слишком длинное/);
  assert.match(compileRe('(a').error ?? '', /Ошибка в регулярном/);
  assert.equal(compileRe('').error, compileRe('   ').error);      // пустое
  // безопасные выражения проходят
  assert.ok(compileRe('кофе|чай').re);
  assert.ok(compileRe('(ab)+').re);                  // повтор группы без вложенного квантора — нормально
  assert.ok(compileRe('^\\d{4}').re);
});

test('регулярки: флаги чистятся до g и i', () => {
  assert.equal(compileRe('a', 'i').re.flags.includes('i'), true);
  assert.equal(compileRe('a', 'xyz').re.flags, '');
});

// ---------- фильтры ----------

const expense = ev('expense', { amountMinor: 150000, category: 'Кафе', note: 'кофе с другом', date: '2026-11-09' }, at(2026, 11, 9));
const expenseSmall = ev('expense', { amountMinor: 30000, category: 'Кафе', note: 'чай', date: '2026-10-01' }, at(2026, 10, 1));
const income = ev('income', { amountMinor: 500000, category: 'Зарплата', note: '', date: '2026-11-05' }, at(2026, 11, 5));
const note = ev('note', { text: 'Купить кофе в зёрнах' }, at(2026, 11, 8));
const noDate = ev('wish', { text: 'Кофемолка', status: 'waiting' }, at(2026, 11, 7));
const ALL = [expense, expenseSmall, income, note, noDate];

test('eventDate: поле date важнее, без него — день события', () => {
  assert.equal(eventDate(expense, NOW), '2026-11-09');
  assert.equal(eventDate(noDate, NOW), '2026-11-07');
});

test('runQuery: тип + сумма + период', () => {
  const { query } = parseQuery('type:expense amount>1000 last:30d');
  const { rows, total } = runQuery(ALL, query, { now: NOW });
  assert.equal(total, 1);
  assert.equal(rows[0].ev, expense);
  assert.equal(rows[0].kind, 'Расход');
  assert.equal(rows[0].date, '2026-11-09');
  assert.equal(rows[0].amountMinor, 150000);
});

test('runQuery: текст ищет по тем же полям, что и обычный поиск', () => {
  const { query } = parseQuery('кофе');
  const { rows } = runQuery(ALL, query, { now: NOW });
  assert.deepEqual(rows.map(r => r.ev), [expense, note, noDate]);   // новые сверху: 9-е, 8-е, 7-е
});

test('runQuery: from/to включительно; записи без суммы не проходят amount', () => {
  const { query } = parseQuery('from:2026-11-05 to:2026-11-09');
  assert.deepEqual(runQuery(ALL, query, { now: NOW }).rows.map(r => r.ev), [expense, note, noDate, income]);
  const { query: qa } = parseQuery('amount>100');
  assert.ok(runQuery(ALL, qa, { now: NOW }).rows.every(r => r.amountMinor !== null));
});

test('runQuery: re: как условие запроса', () => {
  const { query } = parseQuery('type:expense re:/кофе/');
  assert.deepEqual(runQuery(ALL, query, { now: NOW }).rows.map(r => r.ev), [expense]);
});

test('runQuery: re: с флагом g находит все подходящие записи, а не через одну', () => {
  // Регрессия: у регулярки с флагом g каждый test двигал lastIndex, и записи пропускались через одну.
  const many = [1, 2, 3, 4, 5].map(i => ev('note', { text: `кофе ${i}` }, at(2026, 11, 1) + i));
  const { query } = parseQuery('re:/кофе/g');
  assert.ok(query.re.global, 'флаг g сохраняется');
  const { rows, total } = runQuery(many, query, { now: NOW });
  assert.equal(total, 5, 'все подходящие записи найдены');
  assert.equal(rows.length, 5);
  // и повторный прогон тем же запросом даёт тот же результат
  assert.equal(runQuery(many, query, { now: NOW }).total, 5);
});

test('runQuery: лимит строк и полный total', () => {
  const many = Array.from({ length: 30 }, (_, i) => ev('note', { text: 'кофе ' + i }, at(2026, 11, 1) + i));
  const { query } = parseQuery('кофе');
  const { rows, total } = runQuery(many, query, { now: NOW, limit: 10 });
  assert.equal(rows.length, 10);
  assert.equal(total, 30);
});

test('queryToCsv: заголовок, экранирование, сумма в рублях с запятой', () => {
  const { query } = parseQuery('кофе');
  const { rows } = runQuery(ALL, query, { now: NOW });
  const csv = queryToCsv(rows);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], 'Дата;Тип;Запись;Сумма;id');
  assert.match(csv, /Кафе — кофе с другом;1500,00/);
  assert.match(csv, /note-/);                                        // id попадает в выгрузку
  // записи без суммы — с пустой суммой
  const wishLine = lines.find(l => l.includes('Кофемолка'));
  assert.ok(wishLine && /;;/.test(wishLine));
});

// ---------- regexSearch ----------

test('regexSearch: совпадения со сниппетом и полным числом', () => {
  const r = regexSearch(ALL, 'кофе', 'i', { limit: 2 });
  assert.equal(r.total, 3);
  assert.equal(r.matches.length, 2);
  assert.ok(r.matches[0].snippet.includes('кофе'));
  const bad = regexSearch(ALL, '(a+)+');
  assert.match(bad.error, /повтор внутри повтора/);
  assert.equal(bad.total, 0);
});

// ---------- хроно-отчёт ----------

test('parseDatesInput: только настоящие даты, без повторов, по возрастанию', () => {
  assert.deepEqual(parseDatesInput('2026-11-05, 2026-11-01; вчера 2026-11-05 2026-13-99'), ['2026-11-01', '2026-11-05']);
  assert.deepEqual(parseDatesInput(''), []);
});

test('chronoReport: записи по дням в Markdown, пустые дни честно пустые', () => {
  const { md, count } = chronoReport(ALL, ['2026-11-09', '2026-11-02'], { now: NOW });
  assert.match(md, /# Записи за 2 дн\. \(2026-11-02 — 2026-11-09\)/);
  assert.ok(md.includes(`## 2026-11-09\n\n- Расход: Кафе — кофе с другом — ${formatMoney(150000)}`));
  assert.match(md, /## 2026-11-02\n\n_Записей нет\._/);
  assert.equal(count, 1);
  assert.equal(chronoReport(ALL, ['не дата'], { now: NOW }).md, '');
});

// ---------- explain ----------

test('explain: цепочка версий по id и условия запроса', () => {
  const v1 = { id: 'x1', type: 'task', ts: at(2026, 11, 1), payload: { text: 'старое', done: false, due: null }, source: 'manual', confidence: 1, evidence: [] };
  const v2 = { id: 'x1', type: 'task', ts: at(2026, 11, 2), payload: { text: 'новое', done: false, due: null, editedAt: at(2026, 11, 2) }, source: 'manual', confidence: 1, evidence: [] };
  const ex = explainEvent([v2, v1, expense], 'x1', parseQuery('type:task старое').query, { now: NOW });
  assert.ok(ex.found);
  assert.deepEqual(ex.chain.map(c => c.ev), [v1, v2]);               // от старой к новой
  assert.ok(ex.notes.some(t => /версий в журнале: 2/.test(t)));
  assert.ok(ex.notes.some(t => /отметка о правке/.test(t)));
  const byLabel = Object.fromEntries(ex.match.map(mo => [mo.label, mo.ok]));
  assert.equal(byLabel['тип: Задача'], true);
  assert.equal(byLabel['текст «старое»'], false);                    // видим «новое»: поэтому слово «старое» не подошло
});

test('explain: запись не найдена', () => {
  const ex = explainEvent(ALL, 'нет-такого');
  assert.equal(ex.found, false);
  assert.equal(ex.chain.length, 0);
  assert.equal(ex.match, null);
});

test('conditions: подписи условий по-русски', () => {
  const labels = conditions(parseQuery('type:expense amount>1000 last:7d from:2026-11-01 to:2026-11-10').query, NOW).map(c => c.label);
  assert.deepEqual(labels, ['тип: Расход', `сумма больше ${formatMoney(100000)}`, 'за последние 7 дн. (с 2026-11-04)', 'не раньше 2026-11-01', 'не позже 2026-11-10']);
});
