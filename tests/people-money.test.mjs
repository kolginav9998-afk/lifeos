// Связки «люди × деньги»: журнал контактов и встречи, долги человека, дни без трат,
// отказы с ценой, черновики из покупок и продаж, цена надевания, аудит подписок, зарплатный ритуал.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makePerson, logContact, markMeet, contactsOf, contactSummary, lastTopic, lastMeetOf, dueMeets, personDebts, markContact, MAX_CONTACTS } from '../people.js';
import { makeExpense, makeIncome, noSpendDates, noSpendStreak, bestNoSpendWeek, noSpendSummary, refusalSavings, REFUSAL_TAG, expenseFromWish, wishDrafts, saleIncomeDraft, wearRating, subAuditList, auditComplete, cancelCandidates, isPayday, salaryChecklist, makeBudget } from '../money.js';

const NOW = new Date(2026, 10, 10, 12).getTime();          // 10 ноября 2026
const T = '2026-11-18';
const exp = (date, amount = 1000, category = 'Еда') => makeExpense({ amount, category, date }, NOW);
const person = (name, cadenceDays = 30) => makePerson({ name, cadenceDays }, NOW);

test('logContact: добавляет запись в журнал, поднимает lastContact, для встречи — lastMeet', () => {
  const p = person('Анна');
  const a = logContact(p, { date: '2026-11-01', channel: 'msg', topic: ' про работу ' });
  assert.equal(a.payload.lastContact, '2026-11-01');
  assert.equal(a.payload.contacts.length, 1);
  assert.equal(a.payload.contacts[0].topic, 'про работу', 'тема чистится');
  assert.equal(a.payload.lastMeet, undefined, 'сообщение — не встреча');
  const b = logContact(a, { date: '2026-11-10', channel: 'meet', topic: 'кафе' });
  assert.equal(b.payload.lastContact, '2026-11-10');
  assert.equal(b.payload.lastMeet, '2026-11-10');
  const c = logContact(b, { date: '2026-10-05', channel: 'call' });          // задним числом
  assert.equal(c.payload.lastContact, '2026-11-10', 'старая дата не откатывает lastContact');
  assert.equal(c.payload.contacts.length, 3);
  assert.throws(() => logContact(p, { date: '11.01', channel: 'msg' }), /bad date/);
  assert.throws(() => logContact(p, { date: '2026-11-01', channel: 'pigeon' }), /как общались/);
  assert.equal(p.payload.contacts, undefined, 'исходник не тронут');
});

test('журнал: contactsOf новые сверху, lastTopic — тема последнего разговора с темой, хранится не больше MAX_CONTACTS', () => {
  let p = person('Борис');
  p = logContact(p, { date: '2026-11-01', channel: 'call', topic: 'первый' });
  p = logContact(p, { date: '2026-11-05', channel: 'msg' });                 // без темы
  p = logContact(p, { date: '2026-11-08', channel: 'msg', topic: 'второй' });
  assert.deepEqual(contactsOf(p).map(c => c.date), ['2026-11-08', '2026-11-05', '2026-11-01']);
  assert.equal(lastTopic(p), 'второй');
  let q = person('Вера');
  for (let i = 0; i < MAX_CONTACTS + 5; i++) q = logContact(q, { date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, channel: 'msg' });
  assert.equal(q.payload.contacts.length, MAX_CONTACTS, 'журнал ограничен');
});

test('markMeet и lastMeetOf: встреча отдельно от «написал», читается и из поля, и из журнала', () => {
  const p = person('Глеб');
  const m = markMeet(p, '2026-11-12');
  assert.equal(m.payload.lastMeet, '2026-11-12');
  assert.equal(m.payload.lastContact, '2026-11-12', 'встреча — тоже контакт');
  assert.equal(lastMeetOf(m), '2026-11-12');
  assert.equal(lastMeetOf(person('Даша')), null, 'без встреч — null');
  const legacy = { payload: { name: 'Старый', lastMeet: '2026-10-01' } };
  assert.equal(lastMeetOf(legacy), '2026-10-01');
});

test('contactSummary: честные «давно не писал» и «давно не виделись вживую»', () => {
  let p = person('Елена');
  p = logContact(p, { date: '2026-11-10', channel: 'msg', topic: 'планы' });
  p = markMeet(p, '2026-10-20');
  const s = contactSummary(p, T);
  assert.equal(s.daysSinceContact, 8);
  assert.deepEqual([s.lastMeet, s.daysSinceMeet], ['2026-10-20', 29]);
  assert.equal(s.lastTopic, 'планы');
  const empty = contactSummary(person('Женя'), T);
  assert.deepEqual([empty.daysSinceContact, empty.daysSinceMeet, empty.lastTopic], [null, null, null]);
});

test('dueMeets: напоминает по периоду со встречи; без встреч — от добавления, с пометкой never', () => {
  let a = person('Анна', 14), b = person('Борис', 7);
  a = markMeet(a, '2026-10-01');                                            // 48 дн. назад
  b = markContact(b, '2026-11-17');                                          // писали вчера, но встреч не было
  const due = dueMeets([a, b], T);
  assert.deepEqual(due.map(x => x.person.payload.name), ['Анна', 'Борис']);
  assert.equal(due[0].never, false);
  assert.equal(due[1].never, true, 'Борис: письма не засчитываются как встреча');
  const c = markMeet(person('Вера', 60), '2026-11-01');
  assert.deepEqual(dueMeets([c], T), [], '17 дней при периоде 60 — рано');
});

test('personDebts: долги человека по имени (и по personId), только открытые в суммах', () => {
  const p = person('Мама');
  const debt = (who, amountMinor, direction, extra = {}) => ({ id: `debt:${who}${direction}`, type: 'debt', ts: 1, payload: { who, amountMinor, direction, paidMinor: 0, settled: false, ...extra } });
  const ev = [
    debt('Мама', 500000, 'owe_me'),                                          // 5000 ₽ мне должны
    debt('мама ', 100000, 'i_owe'),                                          // регистр и пробелы не важны
    debt('Мама', 200000, 'owe_me', { settled: true }),                       // закрыт — в сумму не идёт
    debt('Папа', 900000, 'i_owe'),                                           // чужой
  ];
  const r = personDebts(ev, p);
  assert.equal(r.debts.length, 3);
  assert.equal(r.open.length, 2);
  assert.equal(r.oweMeMinor, 500000);
  assert.equal(r.iOweMinor, 100000);
  const byId = personDebts([{ id: 'debt:x', type: 'debt', ts: 1, payload: { who: 'Кто угодно', personId: p.id, amountMinor: 7000, paidMinor: 2000, settled: false, direction: 'owe_me' } }], p);
  assert.equal(byId.oweMeMinor, 5000, 'personId связывает независимо от имени');
});

test('день без трат: даты месяца без расходов, будущее не считается', () => {
  const ev = [exp('2026-11-01'), exp('2026-11-03'), exp('2026-10-15')];
  assert.deepEqual(noSpendDates(ev, '2026-11', '2026-11-04'), ['2026-11-02', '2026-11-04']);
  assert.equal(noSpendDates(ev, '2026-10', '2026-10-31').length, 30, 'в октябре трата одна');
  assert.equal(noSpendDates(ev, '2026-11').length, 28, 'без until считается весь месяц');
});

test('серия дней без трат: до первой траты не углубляемся, день с тратой обнуляет', () => {
  const ev = [exp('2026-11-15')];
  assert.equal(noSpendStreak(ev, '2026-11-18'), 3, '16, 17, 18 — без трат');
  assert.equal(noSpendStreak(ev, '2026-11-15'), 0, 'в день траты серии нет');
  assert.equal(noSpendStreak([], '2026-11-18'), 0, 'без журнала серию не считаем');
  assert.equal(noSpendStreak([exp('2026-11-18'), exp('2026-11-10')], '2026-11-18'), 0);
});

test('лучшая неделя: окно из 7 дней с максимумом дней без трат', () => {
  const ev = [exp('2026-11-01'), exp('2026-11-02'), exp('2026-11-03'), exp('2026-11-20')];
  const bw = bestNoSpendWeek(ev, '2026-11', '2026-11-30');
  assert.equal(bw.count, 7, 'неделя 04–10 ноября без единой траты');
  assert.equal(bw.from, '2026-11-04');
  assert.equal(bw.to, '2026-11-10');
  assert.equal(bestNoSpendWeek([exp('2026-11-05'), exp('2026-11-06')], '2026-11', '2026-11-06'), null, 'ни одного полного окна — недели нет');
  const s = noSpendSummary(ev, '2026-11', '2026-11-18');
  assert.equal(s.count, 15, 'по 18-е включительно: 18 дней минус 3 с тратами');
  assert.equal(s.streak, 15, 'серия с 04.11 по 18.11');
});

test('отказы с ценой: сэкономлено за месяц, вычет уже ушедшего в копилку', () => {
  const wish = (amountMinor, resolvedDate, status = 'dropped') => ({ id: `wish:${resolvedDate}`, type: 'wish', ts: 1, payload: { text: 'кофе', amountMinor, status, resolvedDate } });
  const move = (amountMinor, date, note = REFUSAL_TAG) => ({ id: `gm:${amountMinor}`, type: 'goalmove', ts: 1, payload: { goalId: 'goal:g', amountMinor, date, note } });
  const ev = [wish(25000, '2026-11-03'), wish(120000, '2026-11-10'), wish(99900, '2026-10-31'), wish(50000, '2026-11-05', 'bought')];
  let r = refusalSavings(ev, '2026-11');
  assert.deepEqual([r.count, r.savedMinor, r.movedMinor, r.dueMinor], [2, 145000, 0, 145000], 'купленное и прошлый месяц не считаются');
  r = refusalSavings([...ev, move(100000, '2026-11-12'), move(3000, '2026-11-12', 'просто так')], '2026-11');
  assert.deepEqual([r.movedMinor, r.dueMinor], [100000, 45000], 'учитываются только взносы с пометкой «из отказов»');
});

test('покупка → расход: черновик с подставленной суммой, связь по wishId, повторно не предлагается', () => {
  const wish = { id: 'wish:w1', type: 'wish', ts: 1, payload: { text: 'Книга', amountMinor: 89000, status: 'bought', resolvedDate: '2026-11-15' } };
  const ev = expenseFromWish(wish, NOW);
  assert.equal(ev.type, 'expense');
  assert.equal(ev.payload.amountMinor, 89000);
  assert.equal(ev.payload.note, 'Книга');
  assert.equal(ev.payload.date, '2026-11-15');
  assert.equal(ev.payload.wishId, 'wish:w1');
  assert.deepEqual(wishDrafts([wish]), [wish]);
  assert.deepEqual(wishDrafts([wish, ev]), [], 'расход записан — черновик уходит');
  assert.deepEqual(wishDrafts([{ ...wish, payload: { ...wish.payload, amountMinor: null } }]), [], 'без суммы не предлагаем');
  assert.throws(() => expenseFromWish({ ...wish, payload: { ...wish.payload, status: 'wait' } }), /куплен/);
});

test('продал вещь → доход: предложение с ценой из карточки вещи', () => {
  assert.deepEqual(saleIncomeDraft({ name: 'Велосипед', priceMinor: 1500000 }, '2026-11-18'),
    { amount: 1500000, category: 'Другое', note: 'Продано: Велосипед', date: '2026-11-18' });
  assert.equal(saleIncomeDraft({ name: 'Кресло' }).amount, null, 'без цены сумму не выдумываем');
  assert.throws(() => saleIncomeDraft({ name: '  ' }), /Назови/);
  assert.throws(() => saleIncomeDraft({ name: 'x', priceMinor: -5 }), /больше нуля/);
});

test('цена надевания: выгодные по цене раза, мёртвые — куплены и ни разу не надеты', () => {
  const rows = [
    { name: 'Ботинки', priceMinor: 900000, wears: 90 },     // 100 ₽/раз
    { name: 'Куртка', priceMinor: 1200000, wears: 10 },     // 1200 ₽/раз
    { name: 'Шарф', priceMinor: 300000, wears: 1 },         // мало носили — не в выгодных
    { name: 'Пиджак', priceMinor: 800000, wears: 0 },       // мёртвый
    { name: 'Ремень', priceMinor: null, wears: 50 },        // без цены — вне рейтинга
  ];
  const r = wearRating(rows);
  assert.deepEqual(r.worth.map(x => x.name), ['Ботинки', 'Куртка']);
  assert.equal(r.worth[0].costPerWear, 10000);
  assert.deepEqual(r.dead.map(x => x.name), ['Пиджак']);
  assert.equal(r.dead[0].costPerWear, null);
  assert.deepEqual(wearRating([]), { worth: [], dead: [] });
});

test('аудит подписок: ответы по каждой, кандидаты на отмену', () => {
  const subs = [{ id: 'sub:1', name: 'Кино', monthlyMinor: 29900 }, { id: 'sub:2', name: 'Музыка', monthlyMinor: 19900 }];
  assert.equal(auditComplete(subs, {}), false);
  const list = subAuditList(subs, { 'sub:1': 'use' });
  assert.deepEqual(list.map(x => x.verdict), ['use', null]);
  assert.equal(auditComplete(subs, { 'sub:1': 'use', 'sub:2': 'cancel' }), true);
  assert.deepEqual(cancelCandidates(subs, { 'sub:1': 'use', 'sub:2': 'cancel' }).map(x => x.name), ['Музыка']);
  assert.equal(auditComplete([], {}), false, 'без подписок аудит не нужен');
});

test('зарплатный ритуал: в день salaryDay чек-лист с честными отметками', () => {
  const pay = { salaryDay: 18 };
  assert.equal(isPayday(pay, '2026-11-18'), true);
  assert.equal(isPayday(pay, '2026-11-19'), false);
  assert.equal(isPayday({ salaryDay: 31 }, '2026-11-30'), true, '31-е в коротком месяце — последний день');
  assert.equal(isPayday({ salaryDay: 0 }, T), false);
  assert.equal(isPayday(null, T), false);
  const ev = [makeIncome({ amount: 500000, category: 'Зарплата', date: '2026-11-18' }, NOW), makeBudget(300000, NOW)];
  const r = salaryChecklist(ev, T, pay);
  assert.equal(r.due, true);
  assert.deepEqual(r.items.map(i => [i.key, i.done]), [['income', true], ['budget', true], ['goals', false], ['debts', true]]);
  const overdue = [{ id: 'debt:o', type: 'debt', ts: 1, payload: { who: 'x', amountMinor: 100, paidMinor: 0, settled: false, direction: 'i_owe', due: '2026-11-01' } }];
  assert.equal(salaryChecklist(overdue, T, pay).items.find(i => i.key === 'debts').done, false, 'просроченный долг не даёт отметить пункт');
  const goal = [{ id: 'gm:1', type: 'goalmove', ts: 1, payload: { goalId: 'g', amountMinor: 10000, date: '2026-11-18', note: '' } }];
  assert.equal(salaryChecklist(goal, T, pay).items.find(i => i.key === 'goals').done, true);
});

test('старые записи без новых полей не ломают сводки', () => {
  const old = { id: 'pp:old', type: 'person', ts: 1, payload: { name: 'Старый', birthday: null, cadenceDays: 7, createdDate: '2026-10-01' } };
  assert.equal(contactSummary(old, T).daysSinceMeet, null);
  assert.equal(contactsOf(old).length, 0);
  assert.equal(dueMeets([old], T)[0].never, true);
  assert.equal(personDebts([], old).open.length, 0);
});
