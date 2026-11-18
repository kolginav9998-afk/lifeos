// Важные даты близких (кроме дней рождения): ежегодная «MM-DD» (годовщина) и разовая «YYYY-MM-DD» (защита диплома).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImportant, makePerson, updateImportant, nextImportant, upcomingImportant } from '../people.js';

const NOW = new Date(2026, 10, 10, 12).getTime();          // 10 ноября 2026
const T = '2026-11-18';

test('важная дата: разбор «12.03» (ежегодная) и «12.03.2020» / «2020-03-12» (разовая), пустое — null', () => {
  assert.equal(parseImportant(''), null); assert.equal(parseImportant(null), null);
  assert.equal(parseImportant('12.03'), '03-12'); assert.equal(parseImportant('5.3'), '03-05');
  assert.equal(parseImportant('12.03.2020'), '2020-03-12'); assert.equal(parseImportant('2020-03-12'), '2020-03-12');
  assert.equal(parseImportant('29.02'), '02-29', '29 февраля допустимо для ежегодной');
  assert.throws(() => parseImportant('31.04'), /нет/);
  assert.throws(() => parseImportant('abc'), /например/);
  assert.throws(() => parseImportant('12.03.1800'), /Год/);
});

test('makePerson: новые поля добавляются; старые записи без них читаются и ничего не ломают', () => {
  const p = makePerson({ name: 'Анна' }, NOW).payload;
  assert.equal(p.importantDate, null); assert.equal(p.importantLabel, '');
  const q = makePerson({ name: 'Борис', importantDate: '14.11', importantLabel: '  годовщина свадьбы  ' }, NOW).payload;
  assert.equal(q.importantDate, '11-14'); assert.equal(q.importantLabel, 'годовщина свадьбы');
  assert.throws(() => makePerson({ name: 'x', importantDate: '32.01' }), /нет/);
  const old = { id: 'pp:old', type: 'person', ts: 1, payload: { name: 'Старый', birthday: null, cadenceDays: 0 } };   // запись до появления полей
  assert.equal(nextImportant(old.payload, T), null);
  assert.deepEqual(upcomingImportant([old], T, 30), []);
});

test('nextImportant: сегодня, завтра, через N дней; ежегодная переходит на следующий год; 29 февраля', () => {
  assert.deepEqual(nextImportant({ importantDate: '11-18', importantLabel: 'годовщина' }, T), { date: '2026-11-18', inDays: 0, label: 'годовщина' });
  assert.deepEqual(nextImportant({ importantDate: '11-19' }, T), { date: '2026-11-19', inDays: 1, label: '' });
  assert.equal(nextImportant({ importantDate: '11-23' }, T).inDays, 5);
  const passed = nextImportant({ importantDate: '11-10' }, T);
  assert.equal(passed.date, '2027-11-10', 'ежегодная, что уже была в этом году, — в следующем'); assert.ok(passed.inDays > 300);
  assert.equal(nextImportant({ importantDate: '02-29' }, '2027-02-01').date, '2027-02-28', 'в невисокий год — 28 февраля');
  assert.equal(nextImportant({ importantDate: '02-29' }, '2028-02-01').date, '2028-02-29');
  assert.equal(nextImportant({}, T), null);
});

test('nextImportant: разовая дата — сегодня и в будущем показывается, в прошлом нет', () => {
  assert.equal(nextImportant({ importantDate: '2026-11-18' }, T).inDays, 0);
  assert.deepEqual(nextImportant({ importantDate: '2026-11-25', importantLabel: 'защита диплома' }, T), { date: '2026-11-25', inDays: 7, label: 'защита диплома' });
  assert.equal(nextImportant({ importantDate: '2026-11-01' }, T), null, 'разовая дата в прошлом не напоминает');
});

test('upcomingImportant: окно в N дней, сортировка по сроку, потом по имени', () => {
  const ev = [
    makePerson({ name: 'Анна', importantDate: '19.11', importantLabel: 'годовщина' }, NOW),
    makePerson({ name: 'Борис', importantDate: '18.11' }, NOW),
    makePerson({ name: 'Вера' }, NOW),                                            // без даты — не участвует
    makePerson({ name: 'Глеб', importantDate: '25.11', importantLabel: 'защита' }, NOW),
    makePerson({ name: 'Даша', importantDate: '2026-11-20', importantLabel: 'переезд' }, NOW),
    makePerson({ name: 'Егор', importantDate: '2026-10-01', importantLabel: 'было' }, NOW),   // разовая в прошлом
  ];
  assert.deepEqual(upcomingImportant(ev, T, 7).map(x => [x.person.payload.name, x.inDays, x.label]),
    [['Борис', 0, ''], ['Анна', 1, 'годовщина'], ['Даша', 2, 'переезд'], ['Глеб', 7, 'защита']]);
  assert.deepEqual(upcomingImportant(ev, T, 1).map(x => x.person.payload.name), ['Борис', 'Анна']);
  assert.deepEqual(upcomingImportant(ev, T, 0).map(x => x.person.payload.name), ['Борис']);
  assert.deepEqual(upcomingImportant([], T, 30), []);
});

test('updateImportant: ставит и очищает дату с подписью, исходная запись не меняется', () => {
  const a = makePerson({ name: 'Анна' }, NOW);
  const b = updateImportant(a, '14.11', ' годовщина ');
  assert.equal(b.payload.importantDate, '11-14'); assert.equal(b.payload.importantLabel, 'годовщина');
  assert.equal(a.payload.importantDate, null, 'исходник не тронут');
  const c = updateImportant(b, '', '');
  assert.equal(c.payload.importantDate, null, 'пустая строка снимает напоминание');
  assert.throws(() => updateImportant(a, 'привет', ''), /например/);
});
