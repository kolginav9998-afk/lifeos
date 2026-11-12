import test from 'node:test';
import assert from 'node:assert/strict';
import { serialize, parseImport, SCHEMA_VERSION } from '../events.js';
import { encryptBackup, decryptBackup, readBackup, backupKind } from '../backup.js';
import { MIN_ITER } from '../cryptoutil.js';
import { cleanPrefs, importPlan, planEvents, archiveName, looksLikeZip, PREF_RULES } from '../archive.js';
import { REGISTRY } from '../registry.js';
import { makeRng } from '../stats.js';

const ev = (id, type = 'note', payload = { text: id }, ts = 1000) => ({ id, type, ts, payload, source: 'manual', confidence: 1, evidence: [] });

test('настройки в архиве: берём только разрешённое и корректное', () => {
  const good = { theme: 'dark', autoLockMin: 15, parseDates: false, hideAmounts: true, simple: true, fontScale: 1.15, taskHour: 9, habitHour: -1, eveningHour: 21, weeklyHour: 18, bedtimeMin: 1380, quietFrom: 22, quietTo: 7, daysOff: [0, 6] };
  assert.deepEqual(cleanPrefs(good), good);
  const bad = cleanPrefs({ theme: 'розовая', autoLockMin: -5, parseDates: 'да', fontScale: 2, taskHour: 24, bedtimeMin: 1440, quietTo: -1, daysOff: [1, 1], hideAmounts: true });
  assert.deepEqual(bad, { hideAmounts: true }, 'некорректные значения отброшены');
  assert.deepEqual(cleanPrefs({ remindersOn: true, lastBackupAt: 5, lastOpenTs: 9, clockBackFrom: 7, tab: 'money', onboardingDone: true, heavyDay: true, lastSeenVersion: 'R1', tourDone: true, __proto__: { theme: 'dark' } }), {}, 'привязанное к устройству не переносим');
  assert.deepEqual(cleanPrefs(null), {}); assert.deepEqual(cleanPrefs([1, 2]), {}); assert.deepEqual(cleanPrefs('x'), {});
  assert.deepEqual(cleanPrefs({ daysOff: [0, 1, 2, 3, 4, 5, 6, 0] }), {}, 'слишком много дней');
  const copy = cleanPrefs({ daysOff: [1] }); assert.deepEqual(copy.daysOff, [1]);
  const deviceBound = ['remindersOn', 'lastBackupAt', 'lastOpenTs', 'clockBackFrom', 'clockAsked', 'storageAsked', 'integrityAsked', 'tab', 'onboardingDone', 'heavyDay', 'lastSeenVersion', 'updateCheckedAt', 'updateNotified', 'tourDone'];
  assert.deepEqual(Object.keys(PREF_RULES).filter(k => deviceBound.includes(k)), [], 'в архив не попадает то, что привязано к устройству');
});

test('план загрузки: новое, такое же, отличающееся; порядок ключей и время учитываются', () => {
  const local = [ev('a'), ev('b', 'note', { text: 'мой текст', tags: ['x'] }), ev('c', 'task', { text: 'c', done: false })];
  const incoming = [ev('a'), ev('b', 'note', { tags: ['x'], text: 'мой текст' }), ev('c', 'task', { text: 'c', done: true }), ev('d', 'habit', { name: 'д' }, 5000), ev('e', 'note', { text: 'e' }, 200)];
  const p = importPlan(local, incoming);
  assert.equal(p.total, 5); assert.equal(p.same, 2, 'a и b: порядок ключей в записи не важен'); assert.deepEqual(p.fresh.map(e => e.id), ['d', 'e']); assert.deepEqual(p.differ.map(d => d.incoming.id), ['c']);
  assert.deepEqual(p.byType, { note: 3, task: 1, habit: 1 }); assert.equal(p.types, 3); assert.deepEqual(p.range, { from: 200, to: 5000 });
  assert.equal(importPlan(local, [ev('a', 'note', { text: 'a' }, 1001)]).differ.length, 1, 'другое время создания — отличается');
  assert.deepEqual(planEvents(p, 'merge').map(e => e.id), ['d', 'e'], 'по умолчанию только новое');
  assert.deepEqual(planEvents(p, 'replace').map(e => e.id), ['d', 'e', 'c']);
  assert.deepEqual(importPlan([], []), { total: 0, fresh: [], same: 0, differ: [], byType: {}, types: 0, range: null });
  assert.equal(importPlan(local, local).same, 3, 'тот же набор — ничего нового');
});

test('архив: записи и настройки переживают сохранение и чтение (открытый файл)', () => {
  const events = [ev('a'), ev('t1', 'task', { text: 'задача', done: false, due: '2026-11-20' }), ev('s1', 'skill', { title: 'Менять колесо', level: 2 })];
  const text = serialize(events, 1234567, { version: 'R3.10', prefs: { theme: 'dark', fontScale: 1.3 } });
  assert.equal(backupKind(text), 'plain');
  const raw = JSON.parse(text); assert.deepEqual(Object.keys(raw), ['app', 'schema', 'exportedAt', 'version', 'prefs', 'events']);
  const r = parseImport(text);
  assert.deepEqual(r.events, events); assert.deepEqual(r.meta, { exportedAt: 1234567, version: 'R3.10', schema: SCHEMA_VERSION }); assert.deepEqual(r.prefs, { theme: 'dark', fontScale: 1.3 });
  assert.equal(r.skipped, 0); assert.deepEqual(r.migrated, []);
  // файл старого вида (без версии и настроек) читается как раньше
  const old = parseImport(serialize(events, 5));
  assert.equal(old.meta.version, null); assert.equal(old.prefs, null); assert.equal(old.meta.exportedAt, 5);
  // чужие поля не ломают чтение; настройки не-объектом игнорируются
  assert.equal(parseImport(JSON.stringify({ app: 'lifeos', schema: 1, events: [], prefs: 'x', version: 7, exportedAt: 'вчера' })).prefs, null);
  assert.deepEqual(parseImport(JSON.stringify({ app: 'lifeos', schema: 1, events: [], version: 7, exportedAt: 'вчера' })).meta, { exportedAt: null, version: null, schema: 1 });
});

test('архив с паролем: настройки и версия внутри, неверный пароль отклоняется', async () => {
  const events = [ev('a'), ev('b', 'habit', { name: 'зарядка' })];
  const text = await encryptBackup(events, 'длинный-пароль-1', { iterations: MIN_ITER, now: 777, version: 'R3.10', prefs: { simple: true } });
  assert.equal(backupKind(text), 'encrypted'); assert.ok(!text.includes('зарядка') && !text.includes('simple'), 'в файле нет открытого текста');
  const r = await readBackup(text, 'длинный-пароль-1');
  assert.deepEqual(r.events, events); assert.equal(r.encrypted, true); assert.deepEqual(r.prefs, { simple: true }); assert.equal(r.meta.version, 'R3.10'); assert.equal(r.meta.exportedAt, 777);
  await assert.rejects(() => decryptBackup(text, 'другой-пароль-2'), /Неверный пароль/);
  await assert.rejects(() => decryptBackup(text, ''), /Нужен пароль/);
});

test('полный круг: каждый тип записей из реестра проходит через архив без потерь', () => {
  const rng = makeRng(11), types = Object.keys(REGISTRY);
  const events = types.flatMap((type, i) => [ev(`${type}:1`, type, { n: i, text: `текст ${type}`, nested: { a: [1, 2, { b: rng() }], c: null } }, 1_700_000_000_000 + i), ev(`${type}:2`, type, { text: 'второй' }, 1_700_000_001_000 + i)]);
  const r = parseImport(serialize(events, 9, { version: 'R3.10', prefs: {} }));
  assert.equal(r.events.length, events.length); assert.equal(r.skipped, 0);
  assert.deepEqual(r.events, events, 'ни одна запись не изменилась');
  // и план загрузки на пустое устройство: всё новое; на то же самое — ничего нового
  assert.equal(importPlan([], r.events).fresh.length, events.length); const same = importPlan(events, r.events);
  assert.deepEqual([same.fresh.length, same.same, same.differ.length], [0, events.length, 0]);
});

test('архив большой базы: план считается быстро', () => {
  const rng = makeRng(3), N = 30000;
  const local = Array.from({ length: N }, (_, i) => ev(`id${i}`, 'note', { text: `заметка ${i}`, n: i }, 1000 + i));
  const incoming = local.map((e, i) => (i % 1000 === 0 ? { ...e, payload: { ...e.payload, text: 'изменено' } } : e)).concat(Array.from({ length: 500 }, (_, i) => ev(`new${i}`, 'note', { text: String(rng()) }, 5)));
  const t0 = performance.now(), p = importPlan(local, incoming), ms = performance.now() - t0;
  assert.deepEqual([p.fresh.length, p.differ.length, p.same], [500, 30, N - 30]);
  assert.ok(ms < 1500, `план на 30 000 записей занял ${Math.round(ms)} мс`);
});

test('файл архива: имя, распознавание ZIP', () => {
  assert.equal(archiveName('2026-11-14', false), 'lifeos-archive-2026-11-14.json'); assert.equal(archiveName('2026-11-14', true), 'lifeos-archive-2026-11-14.enc.json');
  assert.equal(looksLikeZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9])), true); assert.equal(looksLikeZip(new Uint8Array([0x7b, 0x22])), false); assert.equal(looksLikeZip(new Uint8Array([0x50, 0x4b])), false);
});
