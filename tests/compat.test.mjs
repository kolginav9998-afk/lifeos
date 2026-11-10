// Совместимость «назад»: данные, записанные прошлыми версиями приложения, обязаны читаться новыми.
// Это защита от главного страха — «после обновления всё придётся вводить заново».
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseImport, serialize, groupTasks, completeTask, profileOf } from '../events.js';
import { habitStats, activeHabits } from '../habits.js';
import { summarizeMonth, budgetOf, moneyToCsv } from '../money.js';
import { sortedNotes } from '../notes.js';
import { searchEvents } from '../search.js';
import { weekReview } from '../review.js';
import { toMarkdown } from '../export.js';
import { dayLog } from '../journal.js';
import { planReminders } from '../reminders.js';

const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/old-formats.json', import.meta.url), 'utf8'));
const NOW = new Date(2026, 10, 10, 12).getTime();
const TODAY = '2026-11-10';
const all = [...fx.R0_export.events, ...fx.R1_events, ...fx.R2_events];

test('файл экспорта версии R0 импортируется без потерь', () => {
  const r = parseImport(JSON.stringify(fx.R0_export));
  assert.equal(r.skipped, 0); assert.equal(r.events.length, 2);
  assert.deepEqual(r.events.map(e => e.id), ['r0-task-1', 'r0-task-2']);
});

test('все записи прошлых версий проходят строгую проверку импорта', () => {
  const r = parseImport(serialize(all));
  assert.equal(r.skipped, 0); assert.equal(r.events.length, all.length);
});

test('задачи R0/R1 (без приоритета и срока) группируются, повторяющаяся создаёт следующую, ничего не падает', () => {
  const g = groupTasks(all, TODAY);
  assert.deepEqual(g.nodate.map(t => t.payload.text), ['задача из R0']);
  assert.deepEqual(g.today.map(t => t.payload.text), ['оплата жилья']);
  assert.deepEqual(g.done.map(t => t.payload.text).sort(), ['оплата жилья', 'сделано в R0']);
  const rent = g.today[0];
  const { next } = completeTask(rent, NOW);
  assert.equal(next.payload.due, '2026-12-10');
});

test('привычки, расходы, заметки, бюджет и профиль R2 читаются всеми расчётами', () => {
  const h = activeHabits(all, TODAY);
  assert.equal(h.length, 1);
  assert.equal(habitStats(h[0].h, all, TODAY).missedYesterday, false, 'вчера отмечено минимумом');
  assert.equal(summarizeMonth(all, '2026-11').total, 125050);
  assert.equal(budgetOf(all), 5000000);
  assert.equal(profileOf(all).payload.name, 'Имя');
  assert.equal(sortedNotes(all).length, 1);
  assert.equal(searchEvents(all, 'хлеб').length, 1);
  assert.ok(weekReview(all, TODAY).tasksDone >= 0);
  assert.ok(toMarkdown(all, NOW).includes('заметка из R2'));
  assert.ok(moneyToCsv(all).includes('Расход;2026-11-09;1250,50;Еда;хлеб'));
  assert.ok(Array.isArray(dayLog(all, '2026-11-09')));
  assert.ok(Array.isArray(planReminders(all, NOW)));
});

test('неизвестные будущие типы записей не ломают приложение (сохраняются при импорте, остаются в данных)', () => {
  const future = { id: 'f1', type: 'future_type', ts: 1, payload: { x: 1 } };
  const r = parseImport(JSON.stringify({ app: 'lifeos', events: [...all, future] }));
  assert.equal(r.events.length, all.length + 1);
  assert.doesNotThrow(() => groupTasks(r.events, TODAY));
  assert.doesNotThrow(() => searchEvents(r.events, 'x'));
  assert.doesNotThrow(() => toMarkdown(r.events, NOW));
});
