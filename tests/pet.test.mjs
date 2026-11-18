// Питомец и прививки: создание, правка, сроки следующей прививки (напоминание считается само). Чистая логика без DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY } from '../registry.js';
import { makePet, updatePet, petsOf, petLine, makeVac, vacsOf, vacState, vaccinesDue, vacChipText, VAC_SOON_DAYS } from '../pet.js';
import { plural } from '../home.js';

const T = Date.parse('2026-11-01T12:00:00');
const TODAY = '2026-11-18';

test('реестр: pet и petvac описаны, модуль существует', () => {
  assert.equal(REGISTRY.pet.module, 'pet.js'); assert.equal(REGISTRY.pet.group, 'Дом'); assert.equal(REGISTRY.pet.privacy, 'text');
  assert.equal(REGISTRY.petvac.module, 'pet.js'); assert.ok(REGISTRY.petvac.fields.includes('pet'));
});

test('питомец: имя обязательно, вид из списка, вес — положительное число; остальное необязательно', () => {
  const p = makePet({ name: '  Мурка ', kind: 'cat', weightKg: '4,5', vetName: 'Клиника «Лапа»', vetPhone: '+7 900 000-00-00' }, T);
  assert.match(p.id, /^pet:/); assert.equal(p.type, 'pet');
  assert.deepEqual(p.payload, { name: 'Мурка', kind: 'cat', weightKg: 4.5, vetName: 'Клиника «Лапа»', vetPhone: '+7 900 000-00-00', note: '' });
  assert.equal(petLine(p.payload), 'Кот · 4,5 кг');
  assert.equal(makePet({ name: 'Шарик', kind: 'dog' }, T).payload.weightKg, null, 'вес необязателен');
  assert.throws(() => makePet({ name: ' ' }, T), /Назови/);
  assert.throws(() => makePet({ name: 'X', kind: 'пони' }, T), /кто это/);
  assert.throws(() => makePet({ name: 'X', weightKg: '-2' }, T), /Вес/);
  assert.throws(() => makePet({ name: 'X', weightKg: 'много' }, T), /Вес/);
});

test('правка питомца: id и время создания сохраняются, поля проверяются заново', () => {
  const p = makePet({ name: 'Мурка', kind: 'cat' }, T);
  const u = updatePet(p, { weightKg: 5, vetName: 'Доктор Айболит' }, T + 1000);
  assert.equal(u.id, p.id); assert.equal(u.ts, p.ts); assert.equal(u.payload.editedAt, T + 1000);
  assert.equal(u.payload.weightKg, 5); assert.equal(u.payload.vetName, 'Доктор Айболит'); assert.equal(u.payload.name, 'Мурка');
  assert.throws(() => updatePet(p, { name: '' }), /Назови/);
});

test('прививка: нужны питомец, название и дата; «следующая» необязательна и проверяется', () => {
  const p = makePet({ name: 'Мурка' }, T);
  const v = makeVac(p, { name: 'Комплексная', date: '2026-10-01', nextDue: '2027-10-01' }, T);
  assert.match(v.id, /^petvac:/); assert.equal(v.type, 'petvac');
  assert.deepEqual(v.payload, { pet: p.id, name: 'Комплексная', date: '2026-10-01', nextDue: '2027-10-01' });
  assert.equal(makeVac(p.id, { name: 'Бешенство', date: '2026-10-01' }, T).payload.nextDue, undefined, 'без даты следующей — поля нет');
  assert.throws(() => makeVac(p, { name: '', date: '2026-10-01' }), /Назови/);
  assert.throws(() => makeVac(p, { name: 'X', date: 'скоро' }), /Дата прививки/);
  assert.throws(() => makeVac(p, { name: 'X', date: '2026-10-01', nextDue: '01.10.2027' }), /Следующая/);
  assert.throws(() => makeVac(null, { name: 'X', date: '2026-10-01' }), /питомца/);
  assert.throws(() => makeVac(p, { name: 'X', date: '2999-01-01' }, T), /в будущем/);
});

test('срок прививки: просрочена / сегодня / скоро / не скоро; без даты «следующая» напоминания нет', () => {
  const p = makePet({ name: 'Мурка' }, T);
  const v = makeVac(p, { name: 'Комплексная', date: '2026-01-01', nextDue: '2026-12-01' }, T);
  assert.deepEqual(vacState(v, TODAY), { due: '2026-12-01', left: 13, overdue: false, soon: true });
  assert.deepEqual(vacState(v, '2026-12-01'), { due: '2026-12-01', left: 0, overdue: false, soon: true }, 'в день срока — ещё не просрочена');
  assert.equal(vacState(v, '2026-12-02').overdue, true); assert.equal(vacState(v, '2026-12-02').left, -1);
  assert.equal(vacState(v, '2027-06-01').soon, false);
  assert.equal(vacState(makeVac(p, { name: 'Бешенство', date: '2026-01-01' }, T), TODAY), null);
  assert.equal(vacState(null, TODAY), null);
  assert.equal(VAC_SOON_DAYS, 30);
});

test('напоминание в «Доме»: просроченные первыми, с именем питомца; чужие и далёкие не попадают', () => {
  const a = makePet({ name: 'Мурка' }, T), b = makePet({ name: 'Шарик', kind: 'dog' }, T + 1);
  const overdue = makeVac(a, { name: 'Комплексная', date: '2025-11-01', nextDue: '2026-11-10' }, T);
  const soon = makeVac(b, { name: 'Бешенство', date: '2026-05-01', nextDue: '2026-11-30' }, T + 1);
  const far = makeVac(a, { name: 'Лишай', date: '2026-10-01', nextDue: '2027-10-01' }, T + 2);
  const due = vaccinesDue([a, b, overdue, soon, far], TODAY);
  assert.deepEqual(due.map(r => r.vac.payload.name), ['Комплексная', 'Бешенство'], 'только просроченные и ближайшие 30 дней');
  assert.equal(due[0].pet.payload.name, 'Мурка');
  assert.equal(vacChipText(due[0], plural), 'Мурка: Комплексная — просрочена на 8 дн.');
  assert.equal(vacChipText(due[1], plural), 'Шарик: Бешенство — через 12 дней');
  const orphan = makeVac('pet:нет-такого', { name: 'X', date: '2026-01-01', nextDue: '2026-11-18' }, T + 3);
  const rows = vaccinesDue([orphan], TODAY);
  assert.equal(rows.length, 1); assert.equal(rows[0].pet, null, 'прививка без питомца не ломает список');
  assert.equal(vacChipText(rows[0], plural), 'X — сегодня');
  assert.deepEqual(vaccinesDue([], TODAY), []);
});

test('списки: питомцы по времени создания, прививки свежие сверху и по питомцу', () => {
  const a = makePet({ name: 'Бета' }, T + 5), b = makePet({ name: 'Альфа' }, T);
  assert.deepEqual(petsOf([a, b]).map(p => p.payload.name), ['Альфа', 'Бета'], 'кто заведён раньше — выше');
  const v1 = makeVac(b, { name: 'Раз', date: '2026-01-01' }, T);
  const v2 = makeVac(b, { name: 'Два', date: '2026-06-01' }, T);
  const v3 = makeVac(a, { name: 'Три', date: '2026-09-01' }, T);
  assert.deepEqual(vacsOf([v1, v2, v3]).map(v => v.payload.name), ['Три', 'Два', 'Раз']);
  assert.deepEqual(vacsOf([v1, v2, v3], b.id).map(v => v.payload.name), ['Два', 'Раз']);
});
