// Лекарства: список в аптеку (флаг runningOut) и курс с концом (endDate) — чистая логика без DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMed, medsOf, pharmacyList, pharmacyText, daysLeft, courseDone, travelList, travelText } from '../meds.js';

const T = 1763000000000; // фиксированный момент для стабильных id/дат

test('список в аптеку: только отмеченные «заканчивается», старые записи без флага не попадают', () => {
  const a = makeMed({ name: 'Витамин D', dose: '2000 МЕ' }, T);
  const b = makeMed({ name: 'Магний' }, T);                       // запись старого формата: поля runningOut нет
  const c = { ...makeMed({ name: 'Йод', dose: '150 мкг' }, T), payload: { ...makeMed({ name: 'Йод', dose: '150 мкг' }, T).payload, runningOut: true } };
  const flagged = { ...a, payload: { ...a.payload, runningOut: true } };
  const evs = [b, flagged, c];
  assert.deepEqual(pharmacyList(evs).map(m => m.payload.name), ['Витамин D', 'Йод']);
  // сняли флаг — ушло из списка
  const unflagged = { ...flagged, payload: { ...flagged.payload, runningOut: false } };
  assert.deepEqual(pharmacyList([b, unflagged, c]).map(m => m.payload.name), ['Йод']);
  assert.deepEqual(pharmacyList([]), []);
});

test('текст списка в аптеку: «Название — доза», без дозы — просто название', () => {
  const m1 = { ...makeMed({ name: 'Витамин D', dose: '2000 МЕ' }, T), payload: { ...makeMed({ name: 'Витамин D', dose: '2000 МЕ' }, T).payload, runningOut: true } };
  const m2 = { ...makeMed({ name: 'Магний' }, T), payload: { ...makeMed({ name: 'Магний' }, T).payload, runningOut: true } };
  assert.equal(pharmacyText([m1, m2]), '- Витамин D — 2000 МЕ\n- Магний');
  assert.equal(pharmacyText([]), '');
});

test('курс с концом: осталось дней считается с сегодняшним днём включительно', () => {
  const m = makeMed({ name: 'Курс', endDate: '2026-11-20' }, T);
  assert.equal(m.payload.endDate, '2026-11-20');
  assert.equal(daysLeft(m, '2026-11-18'), 3);
  assert.equal(daysLeft(m, '2026-11-20'), 1, 'в день конца курс ещё идёт');
  assert.equal(daysLeft(m, '2026-11-21'), 0, 'после даты курс завершён');
  assert.equal(courseDone(m, '2026-11-20'), false);
  assert.equal(courseDone(m, '2026-11-21'), true);
});

test('без endDate курс не определяется; старые записи читаются', () => {
  const m = makeMed({ name: 'Постоянное' }, T);
  assert.equal(m.payload.endDate, undefined, 'поле только добавляется: без даты его нет');
  assert.equal(daysLeft(m, '2026-11-18'), null);
  assert.equal(courseDone(m, '2026-11-18'), false);
  assert.equal(daysLeft(m, 'не-дата'), null);
});

test('makeMed: endDate необязателен и проверяется', () => {
  assert.throws(() => makeMed({ name: 'X', endDate: '20.11.2026' }, T), /ГГГГ-ММ-ДД/);
  assert.throws(() => makeMed({ name: 'X', endDate: '2026-13-01' }, T));
  assert.doesNotThrow(() => makeMed({ name: 'X', endDate: '' }, T));
});

test('medsOf и флаг: порядок сортировки не зависит от новых полей', () => {
  const a = makeMed({ name: 'Бета', when: 'evening', endDate: '2026-12-01' }, T);
  const b = { ...makeMed({ name: 'Альфа', when: 'morning' }, T), payload: { ...makeMed({ name: 'Альфа', when: 'morning' }, T).payload, runningOut: true } };
  assert.deepEqual(medsOf([a, b]).map(m => m.payload.name), ['Альфа', 'Бета']);
});

// Чек-лист «лекарства в дорогу»: активные, по времени приёма; неактивные и пустой список.
test('чек-лист в дорогу: активные лекарства по времени приёма, с дозами', () => {
  const a = makeMed({ name: 'Витамин D', dose: '2000 МЕ', when: 'morning' }, T);
  const b = makeMed({ name: 'Магний', when: 'evening' }, T);
  const c = makeMed({ name: 'Йод', dose: '150 мкг', when: 'morning' }, T);
  const off = { ...makeMed({ name: 'Курс прошёл', when: 'day' }, T), payload: { ...makeMed({ name: 'Курс прошёл', when: 'day' }, T).payload, active: false } };
  const prn = makeMed({ name: 'Обезбол', when: 'asneeded' }, T);
  const evs = [a, b, c, off, prn];
  const groups = travelList(evs);
  assert.deepEqual(groups.map(g => [g.when, g.meds.map(m => m.payload.name)]), [['morning', ['Витамин D', 'Йод']], ['evening', ['Магний']], ['asneeded', ['Обезбол']]],
    'на паузе не попадает; порядок — утро, день, вечер, в любое время, по необходимости');
  assert.equal(travelText(evs), 'Лекарства в дорогу:\n\nУтром:\n- Витамин D — 2000 МЕ\n- Йод — 150 мкг\n\nВечером:\n- Магний\n\nПо необходимости:\n- Обезбол');
  assert.equal(travelText([]), '');
  assert.equal(travelText([off]), '', 'все на паузе — чек-листа нет');
});
