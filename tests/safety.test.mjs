// Защита данных: выборочная загрузка архива, проверка целостности, второе окно приложения.
import test from 'node:test';
import assert from 'node:assert/strict';
import { importPlan, planGroups, filterPlan, planEvents, groupOf, cleanPrefs, OTHER_GROUP } from '../archive.js';
import { integrityHint } from '../storageinfo.js';
import { createTabGuard, tabState } from '../tabguard.js';
import { DEFAULTS } from '../prefs.js';

const ev = (id, type, payload = { text: id }, ts = 1000) => ({ id, type, ts, payload, source: 'manual', confidence: 1, evidence: [] });
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('выборочная загрузка: группы данных, подсчёт и отбор', () => {
  const local = [ev('t1', 'task', { text: 'старый' }), ev('n1', 'note', { text: 'моя' })];
  const incoming = [ev('t1', 'task', { text: 'из архива' }), ev('t2', 'task'), ev('n1', 'note', { text: 'другая' }), ev('n2', 'note'), ev('e1', 'expense', { amountMinor: 100 }), ev('z1', 'zzz', { a: 1 }), ev('s1', 'skill', { title: 'х' })];
  const plan = importPlan(local, incoming);
  assert.equal(groupOf('task'), 'Дела'); assert.equal(groupOf('skill'), 'Учёба'); assert.equal(groupOf('zzz'), OTHER_GROUP); assert.equal(groupOf(undefined), OTHER_GROUP);
  const g = planGroups(plan);
  assert.deepEqual(g.map(x => [x.group, x.fresh, x.differ]), [['Дела', 1, 1], ['Деньги', 1, 0], ['Заметки и дневник', 1, 1], ['Учёба', 1, 0], [OTHER_GROUP, 1, 0]], 'по алфавиту, «Прочее» последним');
  const only = filterPlan(plan, new Set(['Дела', 'Учёба']));
  assert.deepEqual(only.fresh.map(e => e.id), ['t2', 's1']); assert.deepEqual(only.differ.map(d => d.incoming.id), ['t1']);
  assert.equal(only.total, plan.total, 'остальные поля плана сохраняются'); assert.equal(plan.fresh.length, 5, 'исходный план не меняется');
  assert.deepEqual(planEvents(only, 'merge').map(e => e.id), ['t2', 's1']); assert.deepEqual(planEvents(only, 'replace').map(e => e.id), ['t2', 's1', 't1']);
  assert.deepEqual(planEvents(filterPlan(plan, new Set()), 'replace'), [], 'ничего не выбрано — ничего не грузим');
  assert.deepEqual(planGroups(importPlan(local, local)), []);
});

test('настройка напоминаний об архиве: допустимые значения и значение по умолчанию', () => {
  assert.equal(DEFAULTS.backupEveryDays, 14);
  for (const v of [0, 7, 14, 30]) assert.deepEqual(cleanPrefs({ backupEveryDays: v }), { backupEveryDays: v });
  for (const v of [1, 15, -7, '7', null, 7.5]) assert.deepEqual(cleanPrefs({ backupEveryDays: v }), {}, String(v));
  assert.equal(DEFAULTS.integrityAsked, '');
});

test('целостность при запуске: хранилище не открылось, нечитаемые записи, всё в порядке', () => {
  assert.equal(integrityHint(), null); assert.equal(integrityHint({ idbOk: true, corrupt: [] }), null); assert.equal(integrityHint({ idbOk: null }), null, 'ещё не проверено');
  const bad = integrityHint({ idbOk: false, idbError: 'IndexedDB заблокирован' });
  assert.equal(bad.level, 'bad'); assert.equal(bad.kind, 'idb'); assert.match(bad.text, /Основное хранилище не открылось \(IndexedDB заблокирован\)/); assert.match(bad.text, /Сохрани архив сейчас/);
  assert.doesNotMatch(integrityHint({ idbOk: false }).text, /\(\)/);
  const warn = integrityHint({ idbOk: true, corrupt: ['a', 'b', 'c'] });
  assert.deepEqual([warn.level, warn.kind, warn.count], ['warn', 'corrupt', 3]); assert.match(warn.text, /Не удалось прочитать записей: 3\. Они не удалены/);
  assert.equal(integrityHint({ idbOk: false, corrupt: ['a'] }).kind, 'idb', 'недоступное хранилище важнее');
  assert.ok(integrityHint({ idbOk: false, idbError: 'я'.repeat(500) }).text.length < 400, 'длинный текст ошибки обрезается');
});

test('второе окно: соседи считаются, чужие записи сообщаются, уход замечается', async () => {
  const name = `lifeos-test-${Math.random().toString(36).slice(2)}`, got = { a: [], b: [], wroteA: 0, wroteB: 0 };
  const a = createTabGuard({ name, ttl: 5000, onOthers: n => got.a.push(n), onRemoteWrite: () => got.wroteA++ });
  assert.equal(a.count(), 0, 'пока окно одно');
  const b = createTabGuard({ name, ttl: 5000, onOthers: n => got.b.push(n), onRemoteWrite: () => got.wroteB++ });
  await sleep(60);
  assert.equal(a.count(), 1); assert.equal(b.count(), 1); assert.deepEqual(got.a, [1]); assert.deepEqual(got.b, [1]);
  b.announceWrite(); await sleep(40);
  assert.equal(got.wroteA, 1, 'первое окно узнало о записи во втором'); assert.equal(got.wroteB, 0, 'своё сообщение не приходит обратно');
  a.announceWrite(); a.announceWrite(); await sleep(40);
  assert.equal(got.wroteB, 2);
  const c = createTabGuard({ name, ttl: 5000, onOthers: () => {}, onRemoteWrite: () => {} });
  await sleep(60); assert.equal(a.count(), 2); assert.equal(c.count(), 2);
  c.stop(); await sleep(40); assert.equal(a.count(), 1, 'закрытое окно пропало из счёта'); assert.deepEqual(got.a.slice(-2), [2, 1]);
  b.stop(); await sleep(40); assert.equal(a.count(), 0); a.stop();
  assert.equal(tabState.others, 0);
});

test('второе окно: устаревшие соседи забываются, мусор в канале игнорируется, без BroadcastChannel тихо ничего не делает', async () => {
  const name = `lifeos-test-${Math.random().toString(36).slice(2)}`, seen = [];
  const a = createTabGuard({ name, ttl: 50, onOthers: n => seen.push(n), onRemoteWrite: () => seen.push('w') });
  const raw = new BroadcastChannel(name);
  raw.postMessage({ type: 'hello', id: 'призрак' }); raw.postMessage(null); raw.postMessage('строка'); raw.postMessage({ type: 'что-то', id: 'x' }); raw.postMessage({ id: 'y' });
  await sleep(40);
  assert.equal(a.count(), 1, 'только настоящий сосед'); assert.deepEqual(seen, [1]);
  await sleep(120);
  assert.equal(a.count(), 0, 'призрак без сигналов забыт через ttl');
  raw.close(); a.stop();
  const none = createTabGuard({ ChannelCtor: null });
  assert.equal(none.count(), 0); assert.doesNotThrow(() => { none.announceWrite(); none.stop(); });
});
