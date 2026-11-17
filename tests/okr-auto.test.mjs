// Цели: автоподсчёт результатов по журналу (okr.js, поле auto у результата).
// Поле необязательное и только добавляется: записи без auto читаются как прежде (ADR-10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeOkr, updateKr, setOkrStatus, normalizeAuto, autoText, krAutoValue, krLiveRatio, okrLiveProgress, okrProgress, okrPace, AUTO_KINDS } from '../okr.js';

const NOW = new Date('2026-11-01T12:00:00').getTime();
const ev0 = (type, date, extra = {}) => ({ id: `${type}:${date}:${Math.random()}`, type, ts: NOW, payload: { date, ...extra }, source: 'manual', confidence: 1, evidence: [] });
const goal = (krs, extra = {}) => makeOkr({ title: 'Цель', due: '2026-12-31', krs, ...extra }, NOW);   // период цели: 2026-11-01 … 2026-12-31

test('normalizeAuto: приведение к единому виду, битые данные читаются как «без автоподсчёта»', () => {
  assert.deepEqual(normalizeAuto({ kind: 'count', type: 'workout' }), { kind: 'count', type: 'workout' });
  assert.deepEqual(normalizeAuto({ kind: 'sum', type: 'goalmove', field: 'amountMinor', from: '2026-11-01', to: '2026-12-31' }), { kind: 'sum', type: 'goalmove', field: 'amountMinor', from: '2026-11-01', to: '2026-12-31' });
  for (const bad of [null, undefined, 5, 'x', {}, { kind: 'zzz', type: 'workout' }, { kind: 'count' }, { kind: 'count', type: 'Bad' }, { kind: 'count', type: 'с трудом' },
    { kind: 'sum', type: 'goalmove' }, { kind: 'sum', type: 'goalmove', field: '' }, { kind: 'sum', type: 'goalmove', field: '1abc' }, { kind: 'count', type: 'workout', from: 'не дата' },
    { kind: 'count', type: 'workout', from: '2026-12-31', to: '2026-11-01' }]) assert.equal(normalizeAuto(bad), null, JSON.stringify(bad));
  assert.equal(normalizeAuto({ kind: 'count', type: 'workout', from: '2026-11-05' }).from, '2026-11-05');
  assert.deepEqual(Object.keys(AUTO_KINDS), ['count', 'sum']);
});

test('autoText: правило человеческими словами', () => {
  assert.equal(autoText({ kind: 'count', type: 'workout' }), 'количество записей «workout»');
  assert.equal(autoText({ kind: 'sum', type: 'goalmove', field: 'amountMinor' }), 'сумма amountMinor по записям «goalmove»');
  assert.equal(autoText(null), '');
});

test('makeOkr: auto сохраняется, невалидное правило отвергается, без auto — как прежде', () => {
  const o = goal([{ text: '40 тренировок', target: 40, unit: 'шт', auto: { kind: 'count', type: 'workout' } }, { text: 'Книги', target: 3, unit: 'кн' }]);
  assert.deepEqual(o.payload.krs[0].auto, { kind: 'count', type: 'workout' });
  assert.equal(o.payload.krs[0].current, 0, 'значение посчитается по журналу');
  assert.equal(o.payload.krs[1].auto, undefined, 'без auto поле не появляется');
  assert.throws(() => goal([{ text: 'Плохое', target: 1, auto: { kind: 'sum', type: 'goalmove' } }]), /проверь автоподсчёт/);
  assert.throws(() => goal([{ text: 'Плохое', target: 1, auto: { kind: 'zzz', type: 'workout' } }]), /проверь автоподсчёт/);
  // старая запись без auto (например, из резервной копии) читается и обновляется как прежде
  const old = { ...o, payload: { ...o.payload, krs: [{ id: 'k1', text: 'Книги', target: 3, unit: 'кн', current: 1 }] } };
  assert.equal(updateKr(old, 'k1', 2).payload.krs[0].current, 2);
  assert.equal(okrProgress(old) > 0, true);
});

test('updateKr: результат с автоподсчётом руками не правится', () => {
  const o = goal([{ text: '40 тренировок', target: 40, unit: 'шт', auto: { kind: 'count', type: 'workout' } }]);
  assert.throws(() => updateKr(o, o.payload.krs[0].id, 5), /считается само/);
  assert.throws(() => updateKr(o, 'нет-такого', 5), /Нет такого результата/);
});

test('krAutoValue: количество записей типа за период цели, даты за пределами не считаются', () => {
  const o = goal([{ text: '40 тренировок', target: 40, unit: 'шт', auto: { kind: 'count', type: 'workout' } }]);
  const k = o.payload.krs[0];
  const events = [
    ev0('workout', '2026-11-05'), ev0('workout', '2026-12-31'),            // в периоде (границы включительно)
    ev0('workout', '2026-10-31'), ev0('workout', '2027-01-01'),            // вне периода
    ev0('habit_log', '2026-11-05'),                                        // другой тип
    { id: 'w:nodate', type: 'workout', ts: NOW, payload: {}, source: 'manual', confidence: 1, evidence: [] },   // без даты не считается
  ];
  assert.equal(krAutoValue(events, o, k), 2);
  // свой период from/to вместо периода цели
  const o2 = goal([{ text: 'Тренировки ноября', target: 10, unit: 'шт', auto: { kind: 'count', type: 'workout', from: '2026-11-01', to: '2026-11-30' } }]);
  assert.equal(krAutoValue(events, o2, o2.payload.krs[0]), 1);
  // без auto возвращается ручное значение
  assert.equal(krAutoValue(events, o, { id: 'x', target: 5, current: 3 }), 3);
});

test('krAutoValue: сумма по числовому полю, нечисловые значения пропускаются', () => {
  const o = goal([{ text: 'Взносы 30 000', target: 3_000_000, unit: 'коп', auto: { kind: 'sum', type: 'goalmove', field: 'amountMinor' } }]);
  const events = [ev0('goalmove', '2026-11-05', { amountMinor: 1_000_000 }), ev0('goalmove', '2026-11-20', { amountMinor: 500_000 }),
    ev0('goalmove', '2027-01-05', { amountMinor: 9_000_000 }), ev0('goalmove', '2026-11-10', { note: 'без суммы' }), ev0('goalmove', '2026-11-11', { amountMinor: 'не число' })];
  assert.equal(krAutoValue(events, o, o.payload.krs[0]), 1_500_000);
});

test('живой прогресс: auto-результаты считаются по журналу, ручные — как прежде; темп учитывает журнал', () => {
  const o = goal([
    { text: '40 тренировок', target: 40, unit: 'шт', auto: { kind: 'count', type: 'workout' } },
    { text: 'Книги', target: 4, unit: 'кн' },
  ]);
  const o2 = updateKr(o, o.payload.krs[1].id, 2);
  const events = Array.from({ length: 20 }, (_, i) => ev0('workout', `2026-11-${String(i + 2).padStart(2, '0')}`));
  assert.equal(krLiveRatio(events, o2, o2.payload.krs[0]), 0.5);
  assert.equal(krLiveRatio(events, o2, o2.payload.krs[1]), 0.5, 'ручной результат без журнала');
  assert.equal(okrLiveProgress(o2, events), 0.5);
  assert.equal(okrProgress(o2), 0.25, 'старое чтение без журнала: auto-результат стоит на нуле');
  const pace = okrPace(o2, '2026-11-16', events);
  assert.equal(pace.progress, 0.5);
  assert.equal(['ahead', 'on'].includes(pace.state), true, `темп по журналу: ${pace.state}`);
  assert.equal(okrPace(o2, '2026-11-16').progress, 0.25, 'без журнала темп считается по ручным значениям');
});

test('закрытие цели с auto-результатом работает как прежде', () => {
  const o = goal([{ text: '40 тренировок', target: 40, unit: 'шт', auto: { kind: 'count', type: 'workout' } }]);
  const done = setOkrStatus(o, 'done');
  assert.equal(done.payload.status, 'done');
  assert.equal(done.payload.krs[0].auto.kind, 'count', 'правило сохраняется при смене статуса');
});
