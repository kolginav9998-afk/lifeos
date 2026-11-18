// «Дом»: вещи, одежда и стирка. Чистая логика: проверки, счётчики, правила стирки, итоги, поиск по формам слов, детерминизм.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY } from '../registry.js';
import { dayBrief, briefText } from '../daycards.js';
import {
  KINDS, TEMPLATES, templateFields, defaultCare, careOf, makeItem, updateItem, fieldsOf, makeLog, moveItem, parsePrice, itemsOf, logsOf, lastLog, statsOf, homeModel, laundryOf, laundryGroups, laundryCount,
  summary, searchItems, placesOf, quickLogs, logButton, statsLine, washProgress, careText, ageText, plural, timesText, NEVER_USED_DAYS,
} from '../home.js';

const TODAY = '2026-11-16';
const at = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d, 12).getTime(); };
let seq = 0;                                                        // у вещей, созданных в одну миллисекунду, был бы один идентификатор
const mk = (fields, day = '2026-08-01', id) => makeItem({ kind: 'clothes', ...fields }, at(day) + (++seq), id);
const todayOf = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const log = (item, kind, day, ms = 0, extra = {}) => makeLog(item, kind, { date: day, ...extra }, at(day) + ms);

test('реестр: item и itemlog описаны, модуль существует, приватность и выгрузка как задумано', () => {
  assert.equal(REGISTRY.item.module, 'home.js'); assert.equal(REGISTRY.item.privacy, 'text'); assert.equal(REGISTRY.item.analytics, false);
  assert.equal(REGISTRY.itemlog.privacy, 'numbers'); assert.equal(REGISTRY.itemlog.analytics, true);
  assert.equal(REGISTRY.item.group, 'Дом');
});

test('вещь: нужны только название и вид; остальное получает умолчания', () => {
  const e = mk({ name: '  Куртка   зимняя ' });
  assert.match(e.id, /^item:[0-9a-z]+$/); assert.equal(e.type, 'item'); assert.equal(e.id, `item:${e.ts.toString(36)}`); assert.equal(todayOf(e.ts), '2026-08-01');
  assert.deepEqual(e.payload, { name: 'Куртка зимняя', kind: 'clothes', place: '', brand: '', color: '', size: '', material: '', qty: 1, bought: null, priceMinor: null, currency: 'RUB', warranty: null,
    validUntil: null, useBy: null, waterEveryDays: null, serviceEveryDays: null, lowAt: null,
    care: { how: 'machine', temp: null, washEveryWears: null, washEveryDays: null }, status: 'active', tags: [], note: '' });
  assert.equal(e.source, 'manual'); assert.equal(e.confidence, 1); assert.deepEqual(e.evidence, []);
  assert.equal(mk({ name: 'Х' }, '2026-08-01', 'item:fixed').id, 'item:fixed', 'идентификатор можно задать');
  assert.equal(mk({ name: 'Шкаф', kind: 'furniture' }).payload.care.how, 'none', 'мебель не стирается');
});

test('вещь: проверки и пределы', () => {
  const bad = (fields, re) => assert.throws(() => mk(fields), re);
  bad({ name: '   ' }, /название/); bad({}, /название/); bad({ name: 'А', kind: 'cat' }, /вид/); bad({ name: 'А', kind: undefined }, /вид/);
  bad({ name: 'А', qty: 0 }, /Количество/); bad({ name: 'А', qty: 10000 }, /Количество/); bad({ name: 'А', qty: '2.5' }, /Количество/);
  bad({ name: 'А', bought: '2026-13-40' }, /Дата покупки/); bad({ name: 'А', bought: '2026-09-01' }, /в будущем/);
  bad({ name: 'А', bought: '2026-05-10', warranty: '2026-05-01' }, /раньше покупки/); bad({ name: 'А', warranty: 'скоро' }, /Гарантия/);
  bad({ name: 'А', priceMinor: -1 }, /Цена/); bad({ name: 'А', priceMinor: 1.5 }, /Цена/); bad({ name: 'А', priceMinor: 1e12 }, /Цена/);
  bad({ name: 'А', status: 'lost' }, /состояние/); bad({ name: 'А', care: { how: 'iron' } }, /ухаживать/);
  bad({ name: 'А', care: { how: 'machine', temp: 120 } }, /Температура/); bad({ name: 'А', care: { how: 'machine', washEveryWears: 0 } }, /Стирать после/); bad({ name: 'А', care: { how: 'machine', washEveryDays: 400 } }, /Стирать раз в/);
  const long = mk({ name: 'я'.repeat(200), place: 'п'.repeat(200), brand: 'б'.repeat(99), color: 'ц'.repeat(99), size: 'р'.repeat(99), material: 'м'.repeat(99), note: 'з'.repeat(900) }).payload;
  assert.deepEqual([long.name.length, long.place.length, long.brand.length, long.color.length, long.size.length, long.material.length, long.note.length], [80, 60, 40, 30, 20, 40, 500]);
  const full = mk({ name: 'А', qty: '3', bought: '2026-07-01', warranty: '2027-07-01', priceMinor: 0, tags: '#Зима, зима ;  Работа,,' , care: { how: 'hand', temp: '30', washEveryWears: '5', washEveryDays: '' } }).payload;
  assert.deepEqual([full.qty, full.bought, full.warranty, full.priceMinor, full.tags, full.care], [3, '2026-07-01', '2027-07-01', 0, ['Зима', 'Работа'], { how: 'hand', temp: 30, washEveryWears: 5, washEveryDays: null }]);
  assert.equal(mk({ name: 'А', tags: Array.from({ length: 30 }, (_, i) => `м${i}`) }).payload.tags.length, 10);
});

test('правила стирки по умолчанию: бельё, полотенца и постель получают их сами', () => {
  assert.deepEqual(mk({ name: 'Трусы', kind: 'underwear' }).payload.care, { how: 'machine', temp: 40, washEveryWears: 1, washEveryDays: null });
  assert.deepEqual(mk({ name: 'Полотенце', kind: 'towels' }).payload.care, { how: 'machine', temp: 60, washEveryWears: 3, washEveryDays: 7 });
  assert.deepEqual(mk({ name: 'Простыня', kind: 'bedding' }).payload.care, { how: 'machine', temp: 60, washEveryWears: null, washEveryDays: 14 });
  assert.deepEqual(defaultCare('shoes'), { how: 'none', temp: null, washEveryWears: null, washEveryDays: null });
  assert.equal(mk({ name: 'Полотенце', kind: 'towels', care: { washEveryDays: null } }).payload.care.washEveryWears, 3, 'частично заданные правила дополняются умолчаниями');
  assert.equal(mk({ name: 'Носки', kind: 'underwear', care: { how: 'machine', temp: 40, washEveryWears: null, washEveryDays: null } }).payload.care.washEveryWears, null, 'правило можно убрать');
  assert.deepEqual(careOf({ kind: 'bedding' }), defaultCare('bedding'), 'у старой записи без ухода берутся умолчания');
});

test('шаблоны: название, вид и правила подставляются, у каждого шаблона вещь создаётся', () => {
  assert.ok(TEMPLATES.length >= 6 && new Set(TEMPLATES.map(t => t.key)).size === TEMPLATES.length);
  for (const t of TEMPLATES) { const f = templateFields(t.key); assert.ok(f.name && f.kind && f.care.how); assert.ok(makeItem(f, at('2026-08-01'))); }
  assert.deepEqual(templateFields('jeans').care, { how: 'machine', temp: 40, washEveryWears: 10, washEveryDays: null });
  assert.equal(templateFields('bedding').care.washEveryDays, 14); assert.equal(templateFields('socks').qty, 5);
  assert.equal(templateFields('нет'), null);
  const f = templateFields('tshirt'); f.care.how = 'hand'; assert.equal(templateFields('tshirt').care.how, 'machine', 'шаблон не портится правкой копии');
});

test('правка вещи: id и время создания те же, неизвестные поля сохраняются, проверки те же', () => {
  const e = mk({ name: 'Свитер', place: 'шкаф' }); const withFuture = { ...e, payload: { ...e.payload, hue: 'будущее поле' } };
  const u = updateItem(withFuture, { name: ' Свитер синий ', care: { washEveryWears: 5 } }, at('2026-09-01'));
  assert.equal(u.id, e.id); assert.equal(u.ts, e.ts); assert.equal(u.type, 'item');
  assert.equal(u.payload.name, 'Свитер синий'); assert.equal(u.payload.place, 'шкаф'); assert.equal(u.payload.hue, 'будущее поле'); assert.equal(u.payload.editedAt, at('2026-09-01'));
  assert.deepEqual(u.payload.care, { how: 'machine', temp: null, washEveryWears: 5, washEveryDays: null });
  assert.equal(e.payload.name, 'Свитер', 'исходная запись не меняется');
  assert.throws(() => updateItem(e, { name: '' }, at('2026-09-01')), /название/);
  assert.equal(updateItem(e, { status: 'sold' }).payload.status, 'sold');
  const f = fieldsOf(u); f.tags.push('х'); assert.deepEqual(u.payload.tags, [], 'поля формы — копия');
});

test('история: отметка, идентификатор, проверки; перемещение меняет место и пишет, что было', () => {
  const e = mk({ name: 'Куртка', place: 'шкаф' });
  const l = log(e, 'wear', '2026-11-10', 5, { note: ' в дождь ', place: '' });
  assert.equal(l.id, `ilog:${e.id}:${(at('2026-11-10') + 5).toString(36)}`); assert.equal(l.type, 'itemlog');
  assert.deepEqual(l.payload, { item: e.id, kind: 'wear', date: '2026-11-10', note: 'в дождь' });
  assert.equal(makeLog(e.id, 'wash', {}, at('2026-11-12')).payload.date, '2026-11-12', 'без даты — сегодня');
  assert.throws(() => makeLog(e, 'dance'), /отметить/); assert.throws(() => makeLog(e, 'wear', { date: '2026-02-30' }), /Дата/);
  assert.throws(() => makeLog(e, 'wear', { date: '2027-01-01' }, at(TODAY)), /сегодня или раньше/);
  const m = moveItem(e, 'балкон', at('2026-11-12'));
  assert.equal(m.item.payload.place, 'балкон'); assert.deepEqual([m.log.payload.kind, m.log.payload.place, m.log.payload.note], ['move', 'балкон', 'было: шкаф']);
});

test('чтение: вещи по названию, история от новых к старым, чужие и битые записи не мешают', () => {
  const a = mk({ name: 'Ремень' }), b = mk({ name: 'Арбуз', kind: 'other' }, '2026-08-02'), c = mk({ name: 'ёж', kind: 'other' }, '2026-08-03');
  const evs = [a, { id: 'x', type: 'item', ts: 1, payload: null }, { id: 'y', type: 'item', ts: 1, payload: { name: 7 } }, b, c, { id: 'z', type: 'task', ts: 1, payload: { text: 'я' } }];
  assert.deepEqual(itemsOf(evs).map(e => e.payload.name), ['Арбуз', 'ёж', 'Ремень']);
  const l1 = log(a, 'wear', '2026-11-01'), l2 = log(a, 'wear', '2026-11-05', 1), l3 = log(a, 'wash', '2026-11-05', 9), other = log(b, 'wear', '2026-11-05');
  assert.deepEqual(logsOf([l1, other, l2, l3], a.id).map(l => l.id), [l3.id, l2.id, l1.id]);
  assert.equal(lastLog(logsOf([l1, l2, l3], a.id)).id, l3.id); assert.equal(lastLog([]), null);
});

test('счётчики вещи: надевания, стирки, после последней стирки, возраст и цена за надевание', () => {
  const jeans = mk({ name: 'Джинсы', priceMinor: 500000, bought: '2026-08-01', care: { how: 'machine', washEveryWears: 10 } });
  const logs = [...[1, 5, 9, 15, 20, 25].map(d => log(jeans, 'wear', `2026-08-${String(d).padStart(2, '0')}`)), log(jeans, 'wash', '2026-09-01'), ...[3, 8, 12].map(d => log(jeans, 'wear', `2026-09-${String(d).padStart(2, '0')}`)), log(jeans, 'use', '2026-10-02')];
  const s = statsOf(jeans, logs, TODAY);
  assert.deepEqual(s, { wears: 10, washes: 1, wearsSinceWash: 4, lastWorn: '2026-10-02', lastWashed: '2026-09-01', lastUsed: '2026-10-02', daysSinceWash: 76, progress: 0.4, ageDays: 107, costPerWear: 50000, needsWash: false, daysSinceUse: 45 });
  const empty = statsOf(jeans, [], TODAY);
  assert.deepEqual([empty.wears, empty.washes, empty.lastWorn, empty.lastWashed, empty.costPerWear, empty.daysSinceUse, empty.needsWash], [0, 0, null, null, null, null, false]);
  assert.equal(statsOf(mk({ name: 'Б' }, '2026-11-10'), [], TODAY).ageDays, 6, 'без даты покупки возраст считается со дня добавления');
  assert.equal(statsOf(mk({ name: 'Б', bought: '2026-11-16' }, '2026-11-16'), [], TODAY).ageDays, 0);
  assert.equal(statsOf(mk({ name: 'Б', priceMinor: 0 }), [log(jeans, 'wear', '2026-10-01')], TODAY).costPerWear, null, 'подарок: цены за надевание нет');
  assert.equal(statsOf(mk({ name: 'Б', priceMinor: 1000 }), [log(jeans, 'wear', '2026-10-01'), log(jeans, 'wear', '2026-10-02'), log(jeans, 'wear', '2026-10-03')], TODAY).costPerWear, 333, 'округление до копейки');
});

test('стирка обнуляет надевания по порядку: день, затем время записи; задним числом и в тот же день', () => {
  const e = mk({ name: 'Рубашка', care: { how: 'machine', washEveryWears: 3 } });
  const wearBefore = log(e, 'wear', '2026-11-10', 10), wash = log(e, 'wash', '2026-11-10', 20), wearAfter = log(e, 'wear', '2026-11-10', 30);
  assert.equal(statsOf(e, [wearBefore, wash, wearAfter], TODAY).wearsSinceWash, 1, 'утреннее надевание до стирки не считается, вечернее после — считается');
  assert.equal(statsOf(e, [wearAfter, wearBefore, wash], TODAY).wearsSinceWash, 1, 'порядок в списке не важен');
  const back = log(e, 'wear', '2026-11-01', 99999);                                     // записано позже, но задним числом: до стирки
  assert.equal(statsOf(e, [wash, back], TODAY).wearsSinceWash, 0);
  assert.equal(statsOf(e, [log(e, 'wear', '2026-11-02'), { id: 'bad', type: 'itemlog', ts: 1, payload: { item: e.id, kind: 'wear', date: 'вчера' } }], TODAY).wears, 1, 'запись с битой датой пропускается');
});

test('пора стирать: по надеваниям, по дням, любое из правил; граница включительно; «не стирается» не просится', () => {
  const rule = care => mk({ name: 'В', care: { how: 'machine', ...care } }, '2026-11-01');
  const wears = n => d => Array.from({ length: n }, (_, i) => log(d, 'wear', '2026-11-05', i));
  let e = rule({ washEveryWears: 3 });
  assert.equal(statsOf(e, wears(2)(e), TODAY).needsWash, false); assert.equal(statsOf(e, wears(3)(e), TODAY).needsWash, true, 'ровно столько, сколько указано');
  e = rule({ washEveryDays: 15 });
  assert.equal(statsOf(e, [], '2026-11-15').needsWash, false); assert.equal(statsOf(e, [], '2026-11-16').needsWash, true, '15 дней с добавления вещи');
  assert.equal(statsOf(e, [log(e, 'wash', '2026-11-10')], TODAY).needsWash, false, 'стирка начала отсчёт заново');
  e = rule({ washEveryWears: 5, washEveryDays: 10 });
  const s = statsOf(e, wears(2)(e), TODAY);
  assert.deepEqual([s.needsWash, s.progress], [true, 1.5], 'сработало правило по дням, хотя надето мало');
  assert.equal(statsOf(rule({}), wears(9)(rule({})), TODAY).needsWash, false, 'правил нет — не просится');
  assert.equal(statsOf(rule({}), [], TODAY).progress, null);
  const shoes = mk({ name: 'Ботинки', kind: 'shoes', care: { how: 'none', washEveryWears: 1 } });
  assert.equal(statsOf(shoes, [log(shoes, 'wear', '2026-11-05')], TODAY).needsWash, false, 'у обуви «не стирается»');
  const bed = mk({ name: 'Простыня', kind: 'bedding' }, '2026-11-01');
  assert.deepEqual([statsOf(bed, [], '2026-11-14').needsWash, statsOf(bed, [], '2026-11-15').needsWash], [false, true], 'постель: раз в 14 дней без отметок надеваний');
  const sock = mk({ name: 'Носки', kind: 'underwear' }, '2026-11-01');
  assert.equal(statsOf(sock, [log(sock, 'wear', '2026-11-05')], TODAY).needsWash, true, 'бельё: после каждого надевания');
});

test('список стирки: только вещи «в использовании», сначала самые срочные, группы по способу ухода', () => {
  const shirt = mk({ name: 'Рубашка', care: { how: 'machine', washEveryWears: 1 } }), wool = mk({ name: 'Шерсть', care: { how: 'hand', washEveryWears: 2 } }), coat = mk({ name: 'Пальто', care: { how: 'dry', washEveryWears: 1 } });
  const old = mk({ name: 'Старая', care: { how: 'machine', washEveryWears: 1 }, status: 'sold' }), calm = mk({ name: 'Свитер', care: { how: 'machine', washEveryWears: 9 } }), idle = mk({ name: 'Шарф' });
  const evs = [shirt, wool, coat, old, calm, idle, log(shirt, 'wear', '2026-11-10'), log(shirt, 'wear', '2026-11-11'), log(wool, 'wear', '2026-11-10'), log(wool, 'wear', '2026-11-11'), log(coat, 'wear', '2026-11-10'),
    log(old, 'wear', '2026-11-10'), log(calm, 'wear', '2026-11-10')];
  const lo = laundryOf(homeModel(evs, TODAY));
  assert.deepEqual(lo.due.map(r => r.item.payload.name), ['Рубашка', 'Пальто', 'Шерсть'], 'по убыванию срочности, при равенстве по названию');
  assert.deepEqual(lo.soon.map(r => r.item.payload.name), ['Свитер'], 'носили, но срок не вышел');
  assert.deepEqual(laundryGroups(lo.due).map(g => [g.how, g.rows.length]), [['machine', 1], ['hand', 1], ['dry', 1]]);
  assert.equal(laundryCount(evs, TODAY), 3); assert.equal(laundryCount([], TODAY), 0);
  assert.equal(washProgress(wool, statsOf(wool, logsOf(evs, wool.id), TODAY)).text, 'Надето 2 из 2');
  assert.equal(washProgress(shirt, statsOf(shirt, logsOf(evs, shirt.id), TODAY)).text, 'Надето 2 (стирать после 1)', 'сверх нормы: без «2 из 1»');
  const bed = mk({ name: 'Простыня', kind: 'bedding' }, '2026-11-01');
  assert.deepEqual([washProgress(bed, statsOf(bed, [], '2026-11-08')).text, washProgress(bed, statsOf(bed, [], TODAY)).text], ['Прошло 7 из 14 дн.', 'Прошло 15 дн. (стирать раз в 14)']);
  assert.equal(washProgress(idle, statsOf(idle, [], TODAY)), null);
});

function sample() {
  const jeans = mk({ name: 'Джинсы', priceMinor: 600000, care: { how: 'machine', washEveryWears: 10 } }), tee = mk({ name: 'Футболка', priceMinor: 100000, qty: 3 }, '2026-09-01');
  const drill = mk({ name: 'Дрель', kind: 'tools', priceMinor: 450000, warranty: '2026-12-10' }, '2026-02-01'), tv = mk({ name: 'Телевизор', kind: 'electronics', priceMinor: 3000000, warranty: '2026-11-16' }, '2025-01-01');
  const lamp = mk({ name: 'Лампа', kind: 'other' }, '2026-11-10'), couch = mk({ name: 'Диван', kind: 'furniture', priceMinor: 5000000 }, '2020-01-01'), coat = mk({ name: 'Пальто', status: 'sold', priceMinor: 900000 }, '2025-01-01');
  const stored = mk({ name: 'Пуховик', status: 'stored', warranty: '2026-12-16' }, '2025-10-01'), pan = mk({ name: 'Сковорода', kind: 'kitchen', warranty: '2026-12-17' }, '2026-01-01');
  const wears = (item, days) => days.map(d => log(item, 'wear', d));
  return [jeans, tee, drill, tv, lamp, couch, coat, stored, pan,
    ...wears(jeans, ['2026-11-01', '2026-11-05', '2026-10-20', '2026-10-21', '2026-09-30']), log(jeans, 'wash', '2026-10-25'),
    ...wears(tee, ['2026-11-02', '2026-11-03']), ...wears(drill, ['2026-06-01']), ...wears(coat, ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'])];
}

test('итоги: вещи, штуки, стоимость, виды, рейтинги, давно без дела, гарантии, надевания по месяцам', () => {
  const s = summary(sample(), TODAY);
  assert.deepEqual([s.count, s.qty, s.stored, s.valueMinor, s.priced, s.totalWears, s.totalWashes], [8, 10, 1, 600000 + 100000 + 450000 + 3000000 + 5000000, 5, 12, 1], 'проданное пальто не в счёте, но его надевания в истории');
  assert.deepEqual(s.byKind.map(k => [k.kind, k.count]), [['clothes', 3], ['electronics', 1], ['kitchen', 1], ['tools', 1], ['furniture', 1], ['other', 1]]);
  assert.deepEqual(s.byKind.find(k => k.kind === 'clothes'), { kind: 'clothes', label: 'Одежда', count: 3, qty: 5, valueMinor: 700000 });
  assert.deepEqual(s.mostWorn.map(r => [r.item.payload.name, r.stats.wears]), [['Джинсы', 5], ['Футболка', 2], ['Дрель', 1]]);
  assert.deepEqual(s.cheapest.map(r => [r.item.payload.name, r.stats.costPerWear]), [['Джинсы', 120000]], 'цена за надевание — от трёх надеваний');
  assert.deepEqual(s.neverUsed.map(r => [r.item.payload.name, r.stats.ageDays]), [['Телевизор', 684], ['Сковорода', 319]], 'мебель, хранение и проданное не в списке, у использованных нет');
  assert.deepEqual(s.warranties.map(r => [r.item.payload.name, r.daysLeft]), [['Телевизор', 0], ['Дрель', 24], ['Пуховик', 30]], 'до 30 дней включительно, на хранении тоже');
  assert.deepEqual(s.wearsByMonth.map(m => m.ym), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(s.wearsByMonth.map(m => m.wears), [1, 0, 0, 1, 2, 4]);
  assert.deepEqual(s.wearsByKind.map(k => [k.kind, k.wears]), [['clothes', 11], ['tools', 1]]);
  assert.equal(s.laundry.length, 0);
});

test('итоги: порог «давно без дела» (старше 60 дней), пустые данные, ничего не падает', () => {
  const day = d => { const t = new Date(2026, 10, 16 - d, 12); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  const a = mk({ name: 'Ровно' }, day(NEVER_USED_DAYS)), b = mk({ name: 'Старше' }, day(NEVER_USED_DAYS + 1));
  assert.deepEqual(summary([a, b], TODAY).neverUsed.map(r => r.item.payload.name), ['Старше']);
  const e = summary([], TODAY);
  assert.deepEqual([e.count, e.qty, e.valueMinor, e.byKind, e.mostWorn, e.cheapest, e.neverUsed, e.laundry, e.warranties, e.wearsByKind, e.wearsByMonth.length], [0, 0, 0, [], [], [], [], [], [], [], 6]);
  assert.equal(summary([], TODAY, { months: 3 }).wearsByMonth.length, 3);
  assert.doesNotThrow(() => summary([{ id: 'l', type: 'itemlog', ts: 1, payload: { item: 'нет', kind: 'wear', date: TODAY } }, { id: 'q', type: 'item', ts: 1, payload: {} }], TODAY));
});

test('итоги не зависят от порядка записей (детерминизм) и не меняют их', () => {
  const evs = sample(), snapshot = JSON.stringify(evs);
  const a = summary(evs, TODAY), b = summary([...evs].reverse(), TODAY), c = summary([...evs.slice(7), ...evs.slice(0, 7)], TODAY);
  assert.deepEqual(a, b); assert.deepEqual(a, c); assert.deepEqual(a, summary(evs, TODAY));
  assert.equal(JSON.stringify(evs), snapshot);
  const same = ['item:b', 'item:a'].map(id => makeItem({ kind: 'clothes', name: 'Одинаковое' }, at('2026-08-01'), id));
  assert.deepEqual(itemsOf(same).map(e => e.id), ['item:a', 'item:b'], 'одинаковые название и время — по идентификатору');
});

test('поиск: формы слов, ё и е, несколько слов, вид вещи, метки, место; пустой запрос — всё', () => {
  const items = [mk({ name: 'Куртка зимняя', place: 'Шкаф в прихожей', tags: ['пуховик'], brand: 'Columbia' }), mk({ name: 'Кроссовки белые', kind: 'shoes', color: 'белый' }, '2026-08-02'),
    mk({ name: 'Носки', kind: 'underwear', note: 'тёплые, шерстяной' }, '2026-08-03'), mk({ name: 'Постельное бельё', kind: 'bedding' }, '2026-08-04'), mk({ name: 'Чайник', kind: 'kitchen' }, '2026-08-05')];
  const names = q => searchItems(items, q).map(e => e.payload.name);
  assert.deepEqual(names('куртки'), ['Куртка зимняя']); assert.deepEqual(names('КУРТКУ'), ['Куртка зимняя']); assert.deepEqual(names('курт'), ['Куртка зимняя']);
  assert.deepEqual(names('кроссовок'), ['Кроссовки белые'], 'беглая гласная'); assert.deepEqual(names('носок'), ['Носки']); assert.deepEqual(names('носков'), ['Носки']); assert.deepEqual(names('тепл'), ['Носки'], 'ё и е не различаются');
  assert.deepEqual(names('зимние куртки'), []); assert.deepEqual(names('зимняя куртка'), ['Куртка зимняя']);
  assert.deepEqual(names('белья'), ['Постельное бельё', 'Носки'], 'название весит больше вида вещи'); assert.deepEqual(names('белый'), ['Кроссовки белые'], 'белый и бельё — разные слова');
  assert.deepEqual(names('обувь'), ['Кроссовки белые'], 'по виду вещи'); assert.deepEqual(names('пуховик'), ['Куртка зимняя'], 'по метке');
  assert.deepEqual(names('прихожей шкаф'), ['Куртка зимняя'], 'по месту'); assert.deepEqual(names('columbia'), ['Куртка зимняя']);
  assert.equal(names('').length, 5); assert.equal(names('   ').length, 5); assert.deepEqual(names('я'), items.map(e => e.payload.name), 'одна буква не ищется');
  assert.deepEqual(names('космолёт'), []);
  const byNote = mk({ name: 'Записка', kind: 'other', note: 'шерстяной' }), byName = mk({ name: 'Шерстяной свитер' }, '2026-08-02');
  assert.deepEqual(searchItems([byNote, byName], 'шерстяной').map(e => e.payload.name), ['Шерстяной свитер', 'Записка'], 'совпадение в названии выше, чем в заметке');
  assert.deepEqual(searchItems([byNote, byName], 'шерстяной').map(e => e.id), searchItems([byNote, byName], 'шерстяной').map(e => e.id));
});

test('места, подписи и тексты: подсказки мест, кнопки, строки счётчиков, возраст, склонения', () => {
  const items = ['шкаф', 'балкон', 'шкаф', '', 'антресоль', 'шкаф', 'балкон'].map((p, i) => mk({ name: `в${i}`, place: p }));
  assert.deepEqual(placesOf(items), ['шкаф', 'балкон', 'антресоль']);
  assert.deepEqual(quickLogs('clothes'), ['wear', 'wash']); assert.deepEqual(quickLogs('bedding'), ['wash']); assert.deepEqual(quickLogs('furniture'), []); assert.deepEqual(quickLogs('что-то'), ['use']);
  assert.deepEqual([logButton('wear', 'clothes'), logButton('wash', 'clothes'), logButton('wash', 'shoes'), logButton('use', 'tools')], ['Надел', 'Постирал', 'Почистил', 'Использовал']);
  const s = { wears: 12, washes: 3 };
  assert.equal(statsLine(s, 'clothes'), 'Надето 12 раз · Стирано 3 раза'); assert.equal(statsLine({ wears: 1, washes: 0 }, 'towels'), 'Использовано 1 раз · Стирано 0 раз');
  assert.equal(statsLine(s, 'tools'), 'Использовано 12 раз'); assert.equal(statsLine(s, 'bedding'), 'Стирано 3 раза'); assert.equal(statsLine(s, 'furniture'), ''); assert.equal(statsLine(s, 'shoes'), 'Надето 12 раз · Почищено 3 раза');
  assert.deepEqual([1, 2, 5, 11, 21, 22, 25].map(n => timesText(n)), ['1 раз', '2 раза', '5 раз', '11 раз', '21 раз', '22 раза', '25 раз']);
  assert.equal(plural(0, 'день', 'дня', 'дней'), 'дней');
  assert.deepEqual([0, 5, 29, 30, 200, 365, 400, 800].map(ageText), ['0 дн.', '5 дн.', '29 дн.', '1 мес.', '6 мес.', '1 г.', '1 г. 1 мес.', '2 г. 2 мес.']);
  assert.equal(careText({ how: 'machine', temp: 40, washEveryWears: 3, washEveryDays: 7 }), 'Машинная стирка, 40°, стирать после 3 надеваний или раз в 7 дней');
  assert.equal(careText({ how: 'hand', temp: null, washEveryWears: 1, washEveryDays: null }), 'Ручная стирка, стирать после каждого надевания');
  assert.equal(careText({ how: 'dry', temp: null, washEveryWears: null, washEveryDays: 21 }), 'Химчистка, стирать раз в 21 день'); assert.equal(careText({ how: 'none' }), 'Не стирается');
  assert.equal(parsePrice(' 1 250,50 '), 125050); assert.equal(parsePrice(''), null); assert.equal(parsePrice('0'), 0); assert.equal(parsePrice('0,00'), 0); assert.throws(() => parsePrice('много'), /Сумма/);
  assert.equal(KINDS.length, 13);
});

test('«Сегодня»: в брифе одна строка про стирку, только когда есть что стирать', () => {
  const shirt = mk({ name: 'Рубашка', care: { how: 'machine', washEveryWears: 1 } }), evs = [shirt, log(shirt, 'wear', '2026-11-10')];
  assert.match(briefText(dayBrief(evs, TODAY)), /\nСтирка: 1 вещь пора стирать/);
  const two = [...evs, mk({ name: 'Брюки', care: { how: 'machine', washEveryWears: 1 } }), mk({ name: 'Шарф', care: { how: 'hand', washEveryWears: 1 } })];
  two.push(log(two[2], 'wear', '2026-11-11'), log(two[3], 'wear', '2026-11-12'));
  assert.match(briefText(dayBrief(two, TODAY)), /Стирка: 3 вещи пора стирать/);
  assert.doesNotMatch(briefText(dayBrief([shirt], TODAY)), /Стирка/); assert.doesNotMatch(briefText(dayBrief([], TODAY)), /Стирка/);
  assert.doesNotMatch(briefText(dayBrief([...evs, log(shirt, 'wash', '2026-11-11')], TODAY)), /Стирка/, 'после стирки строки нет');
});
