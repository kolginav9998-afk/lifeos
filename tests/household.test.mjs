// Быт: растения, документы со сроком, ТО техники, кладовая, расходники, сезонные карточки, гардероб, гарантии, общий список. Чистая логика без DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeItem, makeLog, updateItem, homeModel, isPlant, waterState, waterText, plantsOf, plantsDue,
  docState, docsExpiring, docText, DOC_WARN_DAYS, DOC_SOON_DAYS,
  serviceState, serviceOf, serviceDue, serviceText,
  pantryState, supplyState, adjustQty, pantryOf, suppliesOf, PANTRY_SOON_DAYS,
  homeSeason, SEASON_CHORES, choreOpen, wardrobeSwap, storedClothes, WARDROBE_MONTHS,
  warrantiesExpiring, householdAlerts, templateFields,
} from '../home.js';
import { makePet, makeVac } from '../pet.js';
import { makeTask, completeTask } from '../events.js';

const TODAY = '2026-11-16';
const at = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d, 12).getTime(); };
let seq = 0;
const mk = (fields, day = '2026-08-01') => makeItem({ kind: 'other', ...fields }, at(day) + (++seq));
const log = (item, kind, day) => makeLog(item, kind, { date: day }, at(day));

// ---------- растения ----------
test('растение: правило «каждые N дней»; без отметок отсчёт от покупки/создания', () => {
  const ficus = mk({ name: 'Фикус', waterEveryDays: 7 }, '2026-11-10');
  assert.equal(isPlant(ficus), true); assert.equal(isPlant(mk({ name: 'Куртка' })), false);
  const m = homeModel([ficus], TODAY);
  const w = waterState(ficus, m.logs.get(ficus.id), TODAY);
  assert.deepEqual([w.every, w.last, w.since, w.left, w.due], [7, null, 6, 1, false]);
  assert.equal(waterText(w), 'Следующий полив через 1 день');
  const m2 = homeModel([ficus], '2026-11-17');
  assert.equal(waterState(ficus, m2.logs.get(ficus.id), '2026-11-17').due, true, 'на седьмой день — пора');
  assert.equal(waterText(waterState(ficus, m2.logs.get(ficus.id), '2026-11-20')), 'Полив просрочен на 3 дн.');
});

test('«полил» — отметка water, срок отсчитывается от неё; убранные на хранение не просят воды', () => {
  const ficus = mk({ name: 'Фикус', waterEveryDays: 7 }, '2026-10-01');
  const evs = [ficus, log(ficus, 'water', '2026-11-14')];
  const m = homeModel(evs, TODAY);
  const w = waterState(ficus, m.logs.get(ficus.id), TODAY);
  assert.deepEqual([w.last, w.since, w.left, w.due], ['2026-11-14', 2, 5, false]);
  assert.equal(waterText(w), 'Следующий полив через 5 дней');
  const due = plantsDue(homeModel([ficus, log(ficus, 'water', '2026-11-01')], TODAY));
  assert.deepEqual(due.map(r => r.item.payload.name), ['Фикус']);
  const stored = updateItem(ficus, { status: 'stored' });
  assert.equal(plantsOf(homeModel([stored], TODAY)).length, 0);
  // записи water не считаются надеванием/стиркой: счётчики вещи не меняются
  const st = m.stats.get(ficus.id);
  assert.deepEqual([st.wears, st.washes], [0, 0]);
});

test('полив: проверки поля (целое, 1–365 дней)', () => {
  assert.throws(() => mk({ name: 'X', waterEveryDays: 'часто' }), /Поливать/);
  assert.throws(() => mk({ name: 'X', waterEveryDays: 0 }), /Поливать/);
  assert.equal(mk({ name: 'X', waterEveryDays: '7' }).payload.waterEveryDays, 7, 'строка с числом принимается');
});

// ---------- документы со сроком ----------
test('документы: напоминание за 90 и 30 дней, просроченные первыми', () => {
  const pass = mk({ name: 'Паспорт', kind: 'documents', validUntil: '2027-02-10' });          // 86 дней — warn
  const drive = mk({ name: 'Права', kind: 'documents', validUntil: '2026-12-10' });            // 24 дня — soon
  const ins = mk({ name: 'Страховка', kind: 'documents', validUntil: '2026-11-01' });          // просрочена
  const ok = mk({ name: 'Свидетельство', kind: 'documents', validUntil: '2027-08-01' });       // далеко
  const rows = docsExpiring([pass, drive, ins, ok], TODAY);
  assert.deepEqual(rows.map(r => [r.item.payload.name, r.doc.level]), [['Страховка', 'expired'], ['Права', 'soon'], ['Паспорт', 'warn']]);
  assert.equal(DOC_WARN_DAYS, 90); assert.equal(DOC_SOON_DAYS, 30);
  assert.equal(docState(ok, TODAY).level, 'ok');
  assert.equal(docText(rows[0].doc), 'Срок вышел 15 дн. назад');
  assert.equal(docText(rows[1].doc), 'Действует ещё 24 дня');
  assert.equal(docText(docState(mk({ name: 'X', kind: 'documents', validUntil: TODAY }), TODAY)), 'Срок действия кончается сегодня');
  assert.equal(docState(mk({ name: 'Куртка' }), TODAY), null, 'без validUntil документом не считается');
  assert.throws(() => mk({ name: 'X', kind: 'documents', validUntil: 'скоро' }), /Действует до/);
});

// ---------- обслуживание техники ----------
test('ТО: интервал от последнего ремонта; без ремонта — от покупки', () => {
  const washer = mk({ name: 'Стиралка', kind: 'electronics', bought: '2026-05-01', serviceEveryDays: 180 }, '2026-05-01');
  const s0 = serviceState(washer, [], TODAY);
  assert.deepEqual([s0.last, s0.since, s0.due], [null, 199, true], 'без ремонта — от покупки, срок вышел');
  const evs = [washer, log(washer, 'repair', '2026-11-10')];
  const m = homeModel(evs, TODAY);
  const s1 = serviceState(washer, m.logs.get(washer.id), TODAY);
  assert.deepEqual([s1.last, s1.since, s1.left, s1.due], ['2026-11-10', 6, 174, false], 'после ТО отсчёт пошёл заново');
  assert.deepEqual(serviceDue(m).map(r => r.item.payload.name), []);
  assert.deepEqual(serviceDue(homeModel([washer], TODAY)).map(r => r.item.payload.name), ['Стиралка']);
  assert.equal(serviceText(s1), 'Следующее ТО через 174 дня');
  assert.equal(serviceText(s0), 'Обслуживание просрочено на 19 дн.');
  assert.equal(serviceState(mk({ name: 'Стул', kind: 'furniture' }), [], TODAY), null, 'без интервала ТО — не отслеживается');
  assert.throws(() => mk({ name: 'X', serviceEveryDays: 3 }), /Обслуживание/);
});

// ---------- кладовая и расходники ----------
test('кладовая: «съесть до», остаток, ноль — «кончилось»; обычной вещи ноль не разрешён', () => {
  const grains = mk({ name: 'Гречка', kind: 'pantry', qty: 2, useBy: '2026-11-20' });
  const s = pantryState(grains, TODAY);
  assert.deepEqual([s.qty, s.left, s.expired, s.soon, s.out], [2, 4, false, true, false]);
  assert.equal(PANTRY_SOON_DAYS, 7);
  assert.equal(pantryState(mk({ name: 'Рис', kind: 'pantry' }), TODAY).left, null, 'без даты срока нет');
  assert.equal(pantryState(mk({ name: 'Куртка', kind: 'clothes' }), TODAY), null, 'не кладовая — null');
  assert.equal(mk({ name: 'Лампочки', kind: 'consumables', qty: 0 }).payload.qty, 0, 'у расходников 0 — законный остаток');
  assert.throws(() => mk({ name: 'X', kind: 'clothes', qty: 0 }), /Количество/, 'одежда без остатка не бывает');
  assert.throws(() => mk({ name: 'X', kind: 'pantry', useBy: '20.11.2026' }), /Съесть до/);
});

test('расходники: «кончается» по порогу lowAt, «кончилось» при нуле; пришло/ушло меняет остаток', () => {
  const aa = mk({ name: 'Батарейки AA', kind: 'consumables', qty: 2, lowAt: 2 });
  assert.deepEqual([supplyState(aa).low, supplyState(aa).out], [true, false]);
  const empty = adjustQty(adjustQty(aa, -1), -1);
  assert.equal(empty.payload.qty, 0);
  assert.deepEqual([supplyState(empty).low, supplyState(empty).out], [false, true]);
  assert.equal(adjustQty(empty, -1).payload.qty, 0, 'ниже нуля не уходит');
  assert.equal(adjustQty(aa, 3).payload.qty, 5, 'пришло');
  const jacket = mk({ name: 'Куртка', kind: 'clothes' });
  assert.equal(adjustQty(jacket, -5).payload.qty, 1, 'обычная вещь — минимум 1');
  assert.equal(supplyState(jacket), null);
  assert.throws(() => mk({ name: 'X', kind: 'consumables', lowAt: -1 }), /Кончается/);
  const grains = mk({ name: 'Гречка', kind: 'pantry', qty: 2, useBy: '2026-11-20' });
  assert.deepEqual(pantryOf([grains, aa]).map(i => i.payload.name), ['Гречка']);
  assert.deepEqual(suppliesOf([grains, aa]).map(i => i.payload.name), ['Батарейки AA']);
});

// ---------- сезоны ----------
test('сезонная карточка: весна — март и апрель, осень — сентябрь и октябрь; по пять дел', () => {
  assert.equal(homeSeason('2026-03-01'), 'spring'); assert.equal(homeSeason('2026-04-30'), 'spring');
  assert.equal(homeSeason('2026-09-15'), 'autumn'); assert.equal(homeSeason('2026-10-31'), 'autumn');
  assert.equal(homeSeason(TODAY), null, 'в ноябре карточки нет');
  assert.equal(SEASON_CHORES.spring.length, 5); assert.equal(SEASON_CHORES.autumn.length, 5);
});

test('дело в задачу: уже добавленное (открытое) не предлагается повторно', () => {
  const t = makeTask('Помыть окна', at(TODAY));
  assert.equal(choreOpen([t], 'Помыть окна'), true);
  const { updated } = completeTask(t, at(TODAY));
  assert.equal(choreOpen([updated], 'Помыть окна'), false, 'сделанная задача не мешает добавить дело снова');
  assert.equal(choreOpen([t], 'Помыть посуду'), false);
});

// ---------- гардероб ----------
test('смена гардероба: апрель и октябрь; список «на хранении» — одежда и обувь', () => {
  assert.equal(wardrobeSwap('2026-04-10'), 'spring'); assert.equal(wardrobeSwap('2026-10-10'), 'autumn');
  assert.equal(wardrobeSwap(TODAY), null); assert.deepEqual(WARDROBE_MONTHS, [4, 10]);
  const coat = updateItem(mk({ name: 'Пуховик', kind: 'clothes' }), { status: 'stored' });
  const boots = updateItem(mk({ name: 'Ботинки', kind: 'shoes' }), { status: 'stored' });
  const drill = updateItem(mk({ name: 'Дрель', kind: 'tools' }), { status: 'stored' });
  const tee = mk({ name: 'Футболка', kind: 'clothes' });
  assert.deepEqual(storedClothes([coat, boots, drill, tee]).map(i => i.payload.name), ['Ботинки', 'Пуховик'], 'инструменты — не гардероб');
});

// ---------- гарантии ----------
test('гарантии: истекающие первыми; просроченные и далёкие не попадают', () => {
  const a = mk({ name: 'Телевизор', kind: 'electronics', warranty: TODAY });
  const b = mk({ name: 'Дрель', kind: 'tools', warranty: '2026-11-30' });
  const far = mk({ name: 'Шкаф', kind: 'furniture', warranty: '2027-11-30' });
  const old = mk({ name: 'Утюг', kind: 'electronics', warranty: '2026-01-01' });
  assert.deepEqual(warrantiesExpiring([a, b, far, old], TODAY).map(r => [r.item.payload.name, r.daysLeft]), [['Телевизор', 0], ['Дрель', 14]]);
  assert.equal(warrantiesExpiring([far], TODAY, 400).length, 1, 'окно можно расширить');
});

// ---------- общий список ----------
test('общий бытовой список: всё одним проходом, счётчик — только горящее', () => {
  const ficus = mk({ name: 'Фикус', waterEveryDays: 7 }, '2026-11-01');                 // полив просрочен
  const drive = mk({ name: 'Права', kind: 'documents', validUntil: '2026-12-10' });   // soon
  const far = mk({ name: 'Паспорт', kind: 'documents', validUntil: '2027-02-10' });   // warn — в счётчик не идёт
  const washer = mk({ name: 'Стиралка', kind: 'electronics', serviceEveryDays: 30 }, '2026-09-01');
  const grains = mk({ name: 'Гречка', kind: 'pantry', qty: 1, useBy: '2026-11-20' }); // soon
  const aa = mk({ name: 'Батарейки AA', kind: 'consumables', qty: 1, lowAt: 2 });     // low
  const pet = makePet({ name: 'Мурка' }, at(TODAY));
  const vac = makeVac(pet, { name: 'Комплексная', date: '2026-01-01', nextDue: '2026-11-20' }, at(TODAY));
  const a = householdAlerts([ficus, drive, far, washer, grains, aa, pet, vac], TODAY);
  assert.deepEqual(a.plants.map(r => r.item.payload.name), ['Фикус']);
  assert.deepEqual(a.docs.map(r => r.item.payload.name), ['Права', 'Паспорт'], 'warn в списке есть, но…');
  assert.equal(a.count, 6, '…в счётчике только горящее: полив, права, ТО, гречка, батарейки, прививка');
  assert.equal(a.today, TODAY);
  assert.equal(householdAlerts([], TODAY).count, 0);
});

test('шаблоны: растение с поливом, батарейки с порогом; шаблон не портится правкой копии', () => {
  const plant = templateFields('plant');
  assert.equal(plant.waterEveryDays, 7); assert.equal(plant.kind, 'other');
  assert.doesNotThrow(() => makeItem(plant, at(TODAY)));
  const bat = templateFields('batteries');
  assert.deepEqual([bat.kind, bat.qty, bat.lowAt], ['consumables', 4, 2]);
  assert.equal(templateFields('grains').kind, 'pantry');
});
