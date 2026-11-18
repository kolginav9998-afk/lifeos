// Тесты гик-режима (w5): панель инженера, replay, отмена, diff, триггеры, watchdog, черновик дня, git-выгрузка, wake lock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sizeByType, formatBytes, debugBundle } from '../engineer.js';
import { endOfDayTs, snapshotAt, replaySummary } from '../replay.js';
import { diffStates, describeUndo, createUndoLog, undoAction, UNDO_WINDOW_MS } from '../undo.js';
import { stableStringify, fieldDiffs, diffRecords, diffSummary } from '../diff.js';
import { overdueDaysIn, dryRunTrigger, OVERDUE_SPLIT_RULE, watchdog, makeWatchdogTask } from '../triggers.js';
import { dayDraft, diaryToGitMarkdown } from '../export.js';
import { createWakeLock } from '../wakelock.js';

const ev = (id, type = 'note', payload = { text: id }, ts = 1000) => ({ id, type, ts, payload, source: 'manual', confidence: 1, evidence: [] });
const task = (id, text, { due = null, done = false, doneAt = null, ts = 1000 } = {}) =>
  ({ id, type: 'task', ts, payload: { text, done, doneAt, due, repeat: null, priority: 'normal' }, source: 'manual', confidence: 1, evidence: [] });

// ---------- engineer.js ----------
test('панель инженера: размер по видам записей и формат байтов', () => {
  const rows = sizeByType([ev('a', 'note', { text: 'привет' }), ev('b', 'note', { text: 'мир' }), task('t', 'дело')]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].type, 'note');
  assert.equal(rows[0].count, 2);
  assert.ok(rows[0].bytes > rows[1].bytes);
  assert.equal(sizeByType([]).length, 0);
  assert.equal(formatBytes(0), '0 Б');
  assert.equal(formatBytes(500), '500 Б');
  assert.equal(formatBytes(2048), '2,0 КБ');
  assert.equal(formatBytes(3 * 1024 * 1024), '3,00 МБ');
});

test('отладочный бандл: версия, счётчики и ошибки одним текстом', () => {
  const text = debugBundle({ version: 'R9.9', events: [task('t', 'дело'), ev('n')], errors: ['12:00 ошибка: бум'], extra: ['IndexedDB: 2 записей'], now: 0 });
  assert.match(text, /Версия: R9\.9/);
  assert.match(text, /Записей всего: 2/);
  assert.match(text, /- task: 1 шт/);
  assert.match(text, /IndexedDB: 2 записей/);
  assert.match(text, /ошибка: бум/);
  const empty = debugBundle({ events: [] });
  assert.match(empty, /Ошибок не записано/);
  assert.match(empty, /пока пусто/);
});

// ---------- replay.js ----------
test('replay: срез на дату отбирает записи и откатывает поздние отметки', () => {
  const ts = ymd => endOfDayTs(ymd);
  assert.ok(Number.isFinite(ts('2026-11-18')) && !Number.isFinite(ts('не дата')));
  const cut = ts('2026-11-10');
  const before = ts('2026-11-01'), after = ts('2026-11-15');
  const events = [
    task('old', 'старое', { ts: before, done: true, doneAt: before + 5 }),                       // сделано до среза — остаётся сделанным
    task('late', 'позднее', { ts: before, done: true, doneAt: after, due: '2026-11-09' }),      // сделано после среза — откат в «не сделано»
    ev('future', 'note', { text: 'будущее' }, after),                                           // создано после среза — отпадает
    { ...ev('edited', 'note', { text: 'новая правка', editedAt: after }, before) },
  ];
  const snap = snapshotAt(events, cut);
  assert.deepEqual(snap.map(e => e.id).sort(), ['edited', 'late', 'old']);
  const late = snap.find(e => e.id === 'late');
  assert.equal(late.payload.done, false);
  assert.equal(late.payload.doneAt, null);
  assert.equal(late.payload.due, '2026-11-09', 'остальные поля сохранены');
  assert.equal(snap.find(e => e.id === 'edited').payload.editedAt, undefined, 'метка поздней правки убрана');
  assert.equal(snap.find(e => e.id === 'edited').payload.text, 'новая правка', 'текст последний — честно предупреждаем на экране');
  assert.deepEqual(snapshotAt(events, NaN), []);
  const sum = replaySummary(snap);
  assert.equal(sum.total, 3);
  assert.deepEqual(sum.byType[0], { type: 'task', count: 2 });
});

// ---------- undo.js ----------
test('отмена: разница состояний и шаги человеческими словами', () => {
  const a = ev('a', 'note', { text: 'первая' }), b = task('b', 'купить хлеб');
  const prev = [a, b];
  const b2 = { ...b, u: 2, payload: { ...b.payload, done: true } };
  const c = ev('c', 'task', { text: 'новое дело' });
  const steps = diffStates(prev, [a, b2, c]);
  assert.equal(steps.length, 2);
  const upd = steps.find(s => s.kind === 'updated');
  assert.equal(upd.id, 'b');
  assert.equal(upd.before.payload.done, false);
  const cre = steps.find(s => s.kind === 'created');
  assert.equal(cre.id, 'c');
  assert.match(describeUndo(upd), /Изменено: задача «купить хлеб»/i);
  assert.match(describeUndo(cre), /Добавлено: задача «новое дело»/i);
  assert.match(describeUndo({ kind: 'deleted', id: 'x', before: a, after: null }), /Удалено: заметка «первая»/i);
  // порядок ключей в записи различием не считается (когда нет логических часов u)
  const a2 = { id: 'a', type: 'note', ts: 1000, payload: { text: 'первая' }, source: 'manual', confidence: 1, evidence: [] };
  assert.equal(diffStates([a], [a2]).length, 0);
  // действие отмены: добавленное удаляем, изменённое и удалённое — записываем прежнюю версию
  assert.deepEqual(undoAction(cre), { save: null, remove: 'c' });
  assert.deepEqual(undoAction(upd), { save: b, remove: null });
});

test('отмена: журнал держит только окно в час и ограничен по размеру', () => {
  const log = createUndoLog(5);
  log.prime([]);
  const now = 1_000_000_000_000;
  log.observe([ev('a')], now);
  log.observe([ev('a'), ev('b')], now + 1000);
  assert.equal(log.recent(now + 2000).length, 2);
  assert.equal(log.recent(now + 2000)[0].after.id, 'b', 'свежие сверху');
  assert.equal(log.recent(now + 2000 + UNDO_WINDOW_MS).length, 0, 'за окном часа шагов нет');
  for (let i = 0; i < 10; i++) log.observe([ev('a'), ev('b'), ev(`x${i}`)], now + 3000 + i);
  assert.equal(log.size(), 5, 'журнал не разрастается');
});

// ---------- diff.js ----------
test('diff: стабильная сериализация, различия полей и сводка', () => {
  assert.equal(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] }), stableStringify({ a: [2, { c: 4, d: 3 }], b: 1 }));
  const cur = [ev('same'), task('chg', 'текущий текст', { due: '2026-11-20' }), ev('new', 'note', { text: 'после бэкапа' })];
  const bak = [ev('same'), task('chg', 'старый текст', { due: '2026-11-19' }), ev('gone', 'habit', { name: 'зарядка' })];
  const d = diffRecords(cur, bak);
  assert.deepEqual(d.onlyCurrent.map(e => e.id), ['new']);
  assert.deepEqual(d.onlyBackup.map(e => e.id), ['gone']);
  assert.equal(d.changed.length, 1);
  const fields = d.changed[0].fields;
  assert.ok(fields.some(f => f.field === 'text' && f.was === 'старый текст' && f.now === 'текущий текст'));
  assert.ok(fields.some(f => f.field === 'due' && f.was === '2026-11-19' && f.now === '2026-11-20'));
  assert.match(diffSummary(d), /только в бэкапе: 1 · новых после бэкапа: 1 · отличаются версии: 1/);
  assert.deepEqual(fieldDiffs({ payload: { a: 1, editedAt: 5 } }, { payload: { a: 1 } }), [], 'метка правки — не различие');
  assert.equal(diffRecords([], []).changed.length, 0);
});

// ---------- triggers.js ----------
test('триггер «просрочена 3-й день»: сухой прогон за период', () => {
  // просрочена 5 дней внутри месяца
  const t1 = task('t1', 'большая задача', { due: '2026-10-10' });
  // просрочена 2 дня — меньше порога
  const t2 = task('t2', 'почти в срок', { due: '2026-11-16' });
  // выполнена через 4 дня просрочки
  const t3 = { ...task('t3', 'сделанная с опозданием', { due: '2026-11-01' }), payload: { ...task('x', 'y').payload, text: 'сделанная с опозданием', due: '2026-11-01', done: true, doneAt: endOfDayTs('2026-11-05') } };
  const rows = overdueDaysIn([t1, t2, t3], '2026-10-19', '2026-11-18');
  assert.equal(rows.find(r => r.id === 't1').days, 31);          // со 19.10 по 18.11 включительно
  assert.equal(rows.find(r => r.id === 't2').days, 2);           // 17.11–18.11
  assert.equal(rows.find(r => r.id === 't3').days, 4);           // 02.11–05.11: дальше уже сделана
  const dry = dryRunTrigger([t1, t2, t3], { from: '2026-10-19', to: '2026-11-18' });
  assert.equal(dry.rule, OVERDUE_SPLIT_RULE);
  assert.equal(dry.hits, 2, 'сработало бы для t1 и t3');
  assert.deepEqual(dry.tasks.map(r => r.id), ['t1', 't3']);
  const none = dryRunTrigger([t2], { from: '2026-10-19', to: '2026-11-18' });
  assert.equal(none.hits, 0);
  assert.deepEqual(overdueDaysIn([t1], '2026-11-18', '2026-11-01'), [], 'перевёрнутый период — пусто');
});

test('watchdog: три дня без событий → задача «проверь, всё ли живо»', () => {
  const now = Date.now();
  assert.equal(watchdog([], now), null, 'пустая база — не тишина, а новое приложение');
  assert.equal(watchdog([ev('a', 'note', { text: 'x' }, now - 3600_000)], now), null, 'свежие записи');
  const w = watchdog([ev('a', 'note', { text: 'x' }, now - 4 * 86400000)], now);
  assert.equal(w.idleDays, 4);
  assert.match(w.text, /4 дн/);
  const t = makeWatchdogTask(now);
  assert.equal(t.type, 'task');
  assert.match(t.payload.text, /всё ли живо/);
  assert.equal(t.payload.done, false);
});

// ---------- export.js: черновик итога дня и git-выгрузка ----------
test('черновик итога дня: факты дня одним текстом', () => {
  const day = '2026-11-18';
  const noon = endOfDayTs(day) - 12 * 3600_000;
  const events = [
    { ...task('t1', 'разобрать почту', { ts: noon - 1000 }), payload: { text: 'разобрать почту', done: true, doneAt: noon, due: null, repeat: null, priority: 'normal' } },
    task('t2', 'не сделанное', { ts: noon }),
    ev('h1', 'habit', { name: 'зарядка' }, noon),
    { id: 'hl:h1', type: 'habit_log', ts: noon, payload: { habitId: 'h1', date: day, level: 'full' }, source: 'manual', confidence: 1, evidence: [] },
    { id: 'f1', type: 'focus', ts: noon, payload: { date: day, minutes: 25, planned: 25, completed: true }, source: 'manual', confidence: 1, evidence: [] },
    { id: 'e1', type: 'expense', ts: noon, payload: { date: day, amountMinor: 25000, category: 'еда' }, source: 'manual', confidence: 1, evidence: [] },
    { id: 'd1', type: 'diary', ts: noon, payload: { date: day, text: 'длинный текст', highlight: 'спокойный день', gratitude: ['сон'], tags: [] }, source: 'manual', confidence: 1, evidence: [] },
    ev('n1', 'note', { text: 'мысль дня' }, noon),
  ];
  const text = dayDraft(events, day);
  assert.match(text, new RegExp(`Итог дня ${day}`));
  assert.match(text, /сделано: разобрать почту/);
  assert.doesNotMatch(text, /не сделанное/);
  assert.match(text, /привычка: зарядка \(полностью\)/);
  assert.match(text, /фокус: 25 мин/);
  assert.match(text, /расходы: 250/);
  assert.match(text, /главное: спокойный день/);
  assert.match(text, /благодарность: сон/);
  assert.match(text, /заметок за день: 1/);
  assert.match(text, /Моё впечатление:/);
  assert.match(dayDraft([], day), /Фактов за день пока нет/);
});

test('git-friendly выгрузка: разделы с заголовками-путями YYYY/MM/DD.md', () => {
  const events = [
    { id: 'd1', type: 'diary', ts: 1, payload: { date: '2026-11-17', text: 'первый день', highlight: 'старт', gratitude: ['а'], tags: ['тег'] }, source: 'manual', confidence: 1, evidence: [] },
    { id: 'd2', type: 'diary', ts: 2, payload: { date: '2026-11-18', text: 'второй день', highlight: '', gratitude: [], tags: [] }, source: 'manual', confidence: 1, evidence: [] },
    ev('n1', 'note', { text: 'не дневник' }, 3),
  ];
  const md = diaryToGitMarkdown(events);
  assert.match(md, /## 2026\/11\/17\.md/);
  assert.match(md, /## 2026\/11\/18\.md/);
  assert.ok(md.indexOf('2026/11/17.md') < md.indexOf('2026/11/18.md'), 'дни по порядку');
  assert.match(md, /первый день/);
  assert.match(md, /#тег/);
  assert.doesNotMatch(md, /не дневник/);
  assert.match(diaryToGitMarkdown([]), /Записей дневника пока нет/);
});

// ---------- wakelock.js ----------
test('wake lock: запрос, освобождение, повторный запрос при возвращении на страницу', async () => {
  const listeners = {};
  const doc = { visibilityState: 'visible', hidden: false, addEventListener: (k, fn) => { listeners[k] = fn; } };
  let requests = 0;
  const sentinel = () => { const cbs = []; return { release: async () => cbs.forEach(f => f()), addEventListener: (k, f) => cbs.push(f) }; };
  const nav = { wakeLock: { request: async () => { requests++; return sentinel(); } } };
  const wl = createWakeLock({ nav, doc });
  assert.equal(wl.supported(), true);
  assert.equal(wl.active, false);
  assert.equal(await wl.acquire(), true);
  assert.equal(wl.active, true);
  // страницу свернули и вернули: замок просим заново
  doc.visibilityState = 'hidden'; await wl.acquire();          // скрытой странице замок не даём
  doc.visibilityState = 'visible'; doc.hidden = false;
  listeners.visibilitychange();
  await new Promise(r => setTimeout(r, 0));
  assert.ok(requests >= 2, 'после возвращения на страницу замок запрошен снова');
  await wl.release();
  assert.equal(wl.active, false);
  assert.equal(wl.wanted, false);
});

test('wake lock: без API — тихий отказ, ничего не ломается', async () => {
  const wl = createWakeLock({ nav: {}, doc: null });
  assert.equal(wl.supported(), false);
  assert.equal(await wl.acquire(), false);
  await wl.release();
  const broken = createWakeLock({ nav: { wakeLock: { request: async () => { throw new Error('NotAllowedError'); } } }, doc: null });
  assert.equal(await broken.acquire(), false, 'отказ системы — не ошибка приложения');
});
