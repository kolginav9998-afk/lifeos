import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTask, completeTask, reopenTask, groupTasks, nextDue, dueLabel, addDays, daysBetween,
  todayStr, isYmd, serialize, parseImport } from '../events.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

test('makeTask: обрезает пробелы, ставит provenance', () => {
  const t = makeTask('  купить молоко  ', 1000);
  assert.equal(t.payload.text, 'купить молоко');
  assert.equal(t.source, 'manual');
  assert.equal(t.confidence, 1);
  assert.deepEqual(t.evidence, []);
  assert.equal(t.payload.due, null);
  assert.equal(t.payload.repeat, null);
});
test('makeTask: пустая задача, кривая дата и кривой повтор — ошибки', () => {
  assert.throws(() => makeTask('   '));
  assert.throws(() => makeTask(undefined));
  assert.throws(() => makeTask('a', 1, { due: '2026-02-30' }));
  assert.throws(() => makeTask('a', 1, { due: 'завтра' }));
  assert.throws(() => makeTask('a', 1, { repeat: 'yearly' }));
});
test('isYmd', () => {
  assert.ok(isYmd('2028-02-29'));
  assert.ok(!isYmd('2027-02-29'));
  assert.ok(!isYmd('2026-13-01'));
  assert.ok(!isYmd(null));
});
test('даты: addDays/daysBetween через границы месяца и года', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(daysBetween('2026-11-10', '2026-11-13'), 3);
  assert.equal(daysBetween('2026-11-10', '2026-11-08'), -2);
  assert.equal(todayStr(at(2026, 11, 10, 23)), '2026-11-10');
  assert.equal(todayStr(at(2026, 11, 10, 0)), '2026-11-10');
});
test('nextDue: каждый месяц 10-го, через конец года', () => {
  assert.equal(nextDue('2026-11-10', { type: 'monthly', day: 10 }), '2026-12-10');
  assert.equal(nextDue('2026-12-10', { type: 'monthly', day: 10 }), '2027-01-10');
});
test('nextDue: 31-е укорачивается в короткие месяцы и возвращается', () => {
  const r = { type: 'monthly', day: 31 };
  assert.equal(nextDue('2027-01-31', r), '2027-02-28');
  assert.equal(nextDue('2028-01-31', r), '2028-02-29');
  assert.equal(nextDue('2027-02-28', r), '2027-03-31');
});
test('nextDue: день и неделя', () => {
  assert.equal(nextDue('2026-12-31', { type: 'daily' }), '2027-01-01');
  assert.equal(nextDue('2026-11-28', { type: 'weekly' }), '2026-12-05');
});
test('makeTask: monthly без даты стартует с сегодня и запоминает число', () => {
  const t = makeTask('аренда', at(2026, 11, 10), { repeat: 'monthly' });
  assert.equal(t.payload.due, '2026-11-10');
  assert.deepEqual(t.payload.repeat, { type: 'monthly', day: 10 });
});
test('completeTask: обычная задача не плодит новых', () => {
  const t = makeTask('a', 1);
  const { updated, next } = completeTask(t, 50);
  assert.equal(updated.payload.done, true);
  assert.equal(updated.payload.doneAt, 50);
  assert.equal(next, null);
});
test('completeTask: оплата жилья 10-го создаёт следующую на 10-е след. месяца', () => {
  const t = makeTask('оплата жилья', at(2026, 11, 1), { due: '2026-11-10', repeat: 'monthly' });
  const { updated, next } = completeTask(t, at(2026, 11, 10));
  assert.equal(next.payload.due, '2026-12-10');
  assert.equal(next.payload.done, false);
  assert.equal(next.payload.text, 'оплата жилья');
  assert.equal(updated.payload.spawnedId, next.id);
  assert.notEqual(next.id, t.id);
});
test('completeTask: оплачено досрочно (5-го) — следующая всё равно 10-го след. месяца', () => {
  const t = makeTask('жильё', at(2026, 11, 1), { due: '2026-11-10', repeat: 'monthly' });
  const { next } = completeTask(t, at(2026, 11, 5));
  assert.equal(next.payload.due, '2026-12-10');
});
test('completeTask: сильно просроченная повторяющаяся не создаёт задачу в прошлом', () => {
  const t = makeTask('жильё', at(2026, 8, 1), { due: '2026-08-10', repeat: 'monthly' });
  const { next } = completeTask(t, at(2026, 11, 12));
  assert.equal(next.payload.due, '2026-12-10');
  const d = makeTask('зарядка', at(2026, 11, 1), { due: '2026-11-01', repeat: 'daily' });
  assert.equal(completeTask(d, at(2026, 11, 12)).next.payload.due, '2026-11-13');
});
test('reopenTask: возвращает id следующей, чтобы её убрать', () => {
  const t = makeTask('жильё', at(2026, 11, 1), { due: '2026-11-10', repeat: 'monthly' });
  const { updated, next } = completeTask(t, at(2026, 11, 10));
  const r = reopenTask(updated);
  assert.equal(r.updated.payload.done, false);
  assert.equal(r.updated.payload.doneAt, null);
  assert.equal(r.removeId, next.id);
  assert.equal('spawnedId' in r.updated.payload, false);
  assert.equal(reopenTask(completeTask(makeTask('x', 1), 5).updated).removeId, null);
});
test('groupTasks: просрочено / сегодня / скоро / без срока / сделано', () => {
  const today = '2026-11-10';
  const mk = (txt, due, ts) => makeTask(txt, ts, { due });
  const a = mk('вчера', '2026-11-09', 1), b = mk('сегодня', today, 2), c = mk('послезавтра', '2026-11-12', 3),
    d = mk('через неделю', '2026-11-17', 4), e = mk('без срока', null, 5), f = completeTask(mk('готово', today, 6), 9).updated;
  const g = groupTasks([d, c, a, e, b, f, { id: 'n', type: 'note', ts: 1, payload: {} }], today);
  assert.deepEqual(g.overdue.map(x => x.payload.text), ['вчера']);
  assert.deepEqual(g.today.map(x => x.payload.text), ['сегодня']);
  assert.deepEqual(g.upcoming.map(x => x.payload.text), ['послезавтра', 'через неделю']);
  assert.deepEqual(g.nodate.map(x => x.payload.text), ['без срока']);
  assert.deepEqual(g.done.map(x => x.payload.text), ['готово']);
  assert.equal(g.openCount, 5);
});
test('groupTasks: старые задачи без due/repeat (R0) не ломаются', () => {
  const old = { id: 'o', type: 'task', ts: 1, payload: { text: 'старая', done: false, doneAt: null } };
  const g = groupTasks([old], '2026-11-10');
  assert.equal(g.nodate.length, 1);
});
test('dueLabel', () => {
  const t = '2026-11-10';
  assert.deepEqual(dueLabel('2026-11-10', t), { text: 'сегодня', cls: 'today' });
  assert.deepEqual(dueLabel('2026-11-11', t), { text: 'завтра', cls: '' });
  assert.deepEqual(dueLabel('2026-12-10', t), { text: '10 дек', cls: '' });
  assert.deepEqual(dueLabel('2026-11-07', t), { text: 'просрочено на 3 дн.', cls: 'overdue' });
  assert.deepEqual(dueLabel(null, t), { text: '', cls: '' });
});
test('экспорт → импорт без потерь', () => {
  const evs = [makeTask('a', 1, { due: '2026-11-10', repeat: 'monthly' }), completeTask(makeTask('b', 2), 5).updated];
  const { events, skipped } = parseImport(serialize(evs, 9));
  assert.equal(skipped, 0);
  assert.deepEqual(events, evs);
});
test('импорт: битые записи пропускаются, чужой файл отклоняется', () => {
  const good = makeTask('ok', 1);
  const text = JSON.stringify({ app: 'lifeos', events: [good, { id: 1 }, null, { id: 'z', type: 'task' }] });
  const { events, skipped } = parseImport(text);
  assert.equal(events.length, 1);
  assert.equal(skipped, 3);
  assert.throws(() => parseImport('{"foo":1}'), /не резервная копия/);
  assert.throws(() => parseImport('не json'), /не JSON/);
});
