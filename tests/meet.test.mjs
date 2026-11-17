// Встречи через переписку: проверка предложения и ответа, сборка состояния из сообщений, подписи, календарь (.ics).
// Всё детерминировано: «сегодня» передаётся явно.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MEET_TYPES, meetTypeById, timesFromSpec, datesIn, checkProposal, checkReply, proposalMessage, replyMessage, statusMessage, meetingsFromMessages, myTurn, isUpcoming,
  whenText, describeMeeting, meetingRecord, meetingToIcs, pickerWeeks, MAX_PLACES, MAX_WINDOW_DAYS, STATUS_TEXT } from '../meet.js';
import { chatKeyRecord, chatKeysOf } from '../chat-crypto.js';

const TODAY = '2026-11-17';
const raw = (over = {}) => ({ type: 'date', title: 'Ужин вдвоём', note: 'Давно не виделись', window: { from: '2026-11-20', to: '2026-11-29' }, times: { from: '18:00', to: '21:00', step: 60 },
  places: [{ name: 'Тихий ресторан', hint: 'у набережной' }, { name: 'Кино' }, { name: 'Парк' }], allowOther: true, duration: 150, ...over });
const proposal = (over) => ({ ...checkProposal(raw(over), TODAY), id: 'M1' });
// сообщение как его видит собеседник: { from, to, ts, seq, body }
const msg = (from, to, ts, body, seq = ts) => ({ from, to, ts, seq, body });

test('виды встреч: у каждого значок, название и настроение; неизвестный вид — «другая»', () => {
  assert.deepEqual(MEET_TYPES.map(t => t.key), ['date', 'business', 'friends', 'family', 'other']);
  for (const t of MEET_TYPES) assert.ok(t.title && t.icon && t.mood && t.ask && t.intro);
  assert.equal(meetTypeById('нет').key, 'other');
  assert.equal(meetTypeById('date').title, 'Свидание');
});

test('время: список и диапазон с шагом, без повторов и по порядку', () => {
  assert.deepEqual(timesFromSpec(['19:30', '18:00', '18:00', '9:5']), ['18:00', '19:30']);
  assert.deepEqual(timesFromSpec({ from: '17:00', to: '19:00', step: 30 }), ['17:00', '17:30', '18:00', '18:30', '19:00']);
  assert.deepEqual(timesFromSpec({ from: '19:00', to: '17:00', step: 30 }), []);
  assert.deepEqual(timesFromSpec({ from: '17:00', to: '19:00', step: 5 }), [], 'шаг меньше 15 минут не бывает');
  assert.deepEqual(timesFromSpec(null), []);
  assert.deepEqual(datesIn({ from: '2026-11-28', to: '2026-12-02' }), ['2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  assert.deepEqual(datesIn({ from: '2026-11-28', to: '2026-11-20' }), []);
});

test('предложение: нормализуется, места получают номера, лишнее отбрасывается', () => {
  const p = checkProposal(raw({ title: '  Ужин   вдвоём ', places: [{ name: ' Тихий  ресторан ', hint: 'у набережной', icon: 'heart' }, { name: '' }, { name: 'Кино' }] }), TODAY);
  assert.equal(p.title, 'Ужин вдвоём');
  assert.deepEqual(p.places.map(x => [x.id, x.name]), [['p1', 'Тихий ресторан'], ['p2', 'Кино']]);
  assert.equal(p.places[0].hint, 'у набережной'); assert.equal(p.places[0].icon, 'heart');
  assert.deepEqual(p.times, ['18:00', '19:00', '20:00', '21:00']);
  assert.equal(p.allowOther, true); assert.equal(p.duration, 150); assert.equal(p.note, 'Давно не виделись');
  assert.equal(checkProposal(raw({ note: '' }), TODAY).note, undefined);
});

test('предложение: понятные ошибки', () => {
  const err = (over, re) => assert.throws(() => checkProposal(raw(over), TODAY), re);
  err({ type: 'нет' }, /Выбери, что за встреча/);
  err({ title: '  ' }, /Назови встречу/);
  err({ window: null }, /из каких дат/);
  err({ window: { from: '2026-11-20', to: '2026-11-19' } }, /раньше первой/);
  err({ window: { from: '2026-11-10', to: '2026-11-19' } }, /уже прошла/);
  err({ window: { from: '2026-11-20', to: '2027-03-01' } }, /не длиннее 60 суток/);
  err({ times: [] }, /хотя бы одно время/);
  err({ times: { from: '00:00', to: '23:00', step: 15 } }, /Не больше 24/);
  err({ places: [] }, /хотя бы одно место/);
  err({ places: [{ name: 'Кино' }, { name: 'кино' }] }, /указано дважды/);
  err({ places: Array.from({ length: MAX_PLACES + 1 }, (_, i) => ({ name: `Место ${i}` })) }, /Не больше 8 мест/);
  err({ duration: 5 }, /Длительность/);
  assert.throws(() => checkProposal(null, TODAY), /Нет данных/);
  assert.ok(checkProposal(raw({ window: { from: '2026-11-17', to: '2026-11-17' } }), TODAY), 'можно выбрать сегодняшний день');
  assert.ok(checkProposal(raw({ window: { from: '2026-11-20', to: `2027-01-19` } }), TODAY), `ровно ${MAX_WINDOW_DAYS} суток можно`);
});

test('ответ «согласен»: только предложенные дата, время и место (или своё место, если автор разрешил)', () => {
  const p = proposal();
  assert.deepEqual(checkReply(p, { status: 'accepted', date: '2026-11-22', time: '19:00', placeId: 'p2', comment: ' Ура! ' }, TODAY), { status: 'accepted', date: '2026-11-22', time: '19:00', placeId: 'p2', comment: 'Ура!' });
  assert.deepEqual(checkReply(p, { status: 'accepted', date: '2026-11-22', time: '19:00', other: 'Дома у меня' }, TODAY), { status: 'accepted', date: '2026-11-22', time: '19:00', other: 'Дома у меня' });
  const err = (r, re) => assert.throws(() => checkReply(p, r, TODAY), re);
  err({ status: 'accepted', date: '2026-12-25', time: '19:00', placeId: 'p1' }, /вне предложенных/);
  err({ status: 'accepted', date: '2026-11-22', time: '19:30', placeId: 'p1' }, /не из предложенных/);
  err({ status: 'accepted', date: '2026-11-22', time: '19:00', placeId: 'p9' }, /Такого места нет/);
  err({ status: 'accepted', date: '2026-11-22', time: '19:00' }, /Выбери место/);
  err({ status: 'accepted', time: '19:00', placeId: 'p1' }, /Выбери дату/);
  err({ status: 'accepted', date: '2026-11-22', placeId: 'p1' }, /Выбери время/);
  err({ status: 'maybe' }, /Непонятный ответ/);
  const closed = proposal({ allowOther: false });
  assert.throws(() => checkReply(closed, { status: 'accepted', date: '2026-11-22', time: '19:00', other: 'Своё' }, TODAY), /одно из предложенных мест/);
  assert.deepEqual(checkReply(proposal(), { status: 'declined', comment: 'Не смогу' }, TODAY), { status: 'declined', comment: 'Не смогу' });
});

test('ответ «предложу своё»: любая будущая дата в пределах года и любое место', () => {
  const p = proposal({ allowOther: false });
  assert.deepEqual(checkReply(p, { status: 'counter', date: '2026-12-31', time: '10:00', other: 'Каток' }, TODAY), { status: 'counter', date: '2026-12-31', time: '10:00', other: 'Каток' });
  assert.throws(() => checkReply(p, { status: 'counter', date: '2026-11-01', time: '10:00', other: 'Каток' }, TODAY), /уже прошла/);
  assert.throws(() => checkReply(p, { status: 'counter', date: '2028-01-01', time: '10:00', other: 'Каток' }, TODAY), /не дальше года/);
});

test('полный путь: предложил → ответил → подтвердил; роли, порядок и подделки', () => {
  const p = proposal();
  const m = [
    msg('влад', 'аня', 100, proposalMessage(p, 'a1', 100, 'M1')),
    msg('аня', 'влад', 200, replyMessage('M1', { status: 'accepted', date: '2026-11-22', time: '19:00', placeId: 'p2' }, 'a2', 200)),
    msg('влад', 'аня', 300, statusMessage('M1', 'confirmed', 'a3', 300)),
  ];
  let [mt] = meetingsFromMessages(m.slice(0, 1));
  assert.deepEqual([mt.status, mt.host, mt.guest, mt.when, mt.place, myTurn(mt, 'аня'), myTurn(mt, 'влад')], ['proposed', 'влад', 'аня', null, null, 'answer', 'wait']);
  [mt] = meetingsFromMessages(m.slice(0, 2));
  assert.deepEqual([mt.status, mt.when, mt.place, myTurn(mt, 'влад'), myTurn(mt, 'аня')], ['answered', { date: '2026-11-22', time: '19:00' }, { id: 'p2', name: 'Кино' }, 'confirm', 'wait']);
  [mt] = meetingsFromMessages(m);
  assert.deepEqual([mt.status, myTurn(mt, 'влад'), isUpcoming(mt, TODAY), isUpcoming(mt, '2026-11-23')], ['confirmed', 'none', true, false]);
  // порядок прихода не важен: сообщения сортируются по времени
  assert.equal(meetingsFromMessages([...m].reverse())[0].status, 'confirmed');
  // подделки не действуют
  const forged = [
    msg('влад', 'аня', 100, proposalMessage(p, 'a1', 100, 'M1')),
    msg('влад', 'аня', 150, replyMessage('M1', { status: 'accepted', date: '2026-11-22', time: '19:00', placeId: 'p1' }, 'f1', 150)),       // отвечает автор вместо приглашённой
    msg('аня', 'влад', 160, statusMessage('M1', 'confirmed', 'f2', 160)),                                                                    // подтверждает приглашённая
    msg('аня', 'влад', 170, replyMessage('M1', { status: 'accepted', date: '2030-01-01', time: '19:00', placeId: 'p1' }, 'f3', 170)),       // дата вне окна
    msg('аня', 'влад', 180, replyMessage('M2', { status: 'accepted', date: '2026-11-22', time: '19:00', placeId: 'p1' }, 'f4', 180)),       // чужая встреча
    msg('аня', 'влад', 190, { v: 2, id: 'x', kind: 'meet-status', ts: 190, meetId: 'M1', status: 'cancelled' }),                              // другой формат
  ];
  assert.equal(meetingsFromMessages(forged)[0].status, 'proposed');
});

test('отказ, перепредложение, отмена и повторные ответы', () => {
  const p = proposal();
  const base = msg('влад', 'аня', 100, proposalMessage(p, 'a1', 100, 'M1'));
  let [mt] = meetingsFromMessages([base, msg('аня', 'влад', 200, replyMessage('M1', { status: 'declined', comment: 'Не получится' }, 'a2', 200))]);
  assert.deepEqual([mt.status, mt.reply.comment, mt.when], ['declined', 'Не получится', null]);
  assert.equal(myTurn(mt, 'влад'), 'none');
  // до подтверждения приглашённая может передумать
  [mt] = meetingsFromMessages([base,
    msg('аня', 'влад', 200, replyMessage('M1', { status: 'accepted', date: '2026-11-22', time: '19:00', placeId: 'p1' }, 'a2', 200)),
    msg('аня', 'влад', 210, replyMessage('M1', { status: 'counter', date: '2026-12-05', time: '12:00', other: 'Каток' }, 'a3', 210))]);
  assert.deepEqual([mt.status, mt.when, mt.place, mt.reply.status], ['answered', { date: '2026-12-05', time: '12:00' }, { name: 'Каток' }, 'counter']);
  // подтверждённую встречу отменяет любой из двоих; после отмены ничего не меняется
  const confirmed = [base, msg('аня', 'влад', 200, replyMessage('M1', { status: 'accepted', date: '2026-11-22', time: '19:00', placeId: 'p1' }, 'a2', 200)), msg('влад', 'аня', 300, statusMessage('M1', 'confirmed', 'a3', 300))];
  [mt] = meetingsFromMessages([...confirmed, msg('аня', 'влад', 400, statusMessage('M1', 'cancelled', 'a4', 400, 'Заболела'))]);
  assert.deepEqual([mt.status, mt.cancelledBy], ['cancelled', 'аня']);
  [mt] = meetingsFromMessages([...confirmed, msg('влад', 'аня', 400, statusMessage('M1', 'cancelled', 'a4', 400)), msg('влад', 'аня', 500, statusMessage('M1', 'confirmed', 'a5', 500))]);
  assert.equal(mt.status, 'cancelled', 'после отмены подтвердить нельзя');
  // после подтверждения ответы приглашённой уже не меняют встречу
  [mt] = meetingsFromMessages([...confirmed, msg('аня', 'влад', 350, replyMessage('M1', { status: 'declined' }, 'a6', 350))]);
  assert.equal(mt.status, 'confirmed');
  // повтор предложения с тем же номером игнорируется; несколько встреч сортируются: новые сверху
  const second = msg('влад', 'аня', 600, proposalMessage({ ...p, title: 'Кино' }, 'b1', 600, 'M2'));
  const all = meetingsFromMessages([base, msg('влад', 'аня', 110, proposalMessage({ ...p, title: 'Дубль' }, 'a9', 110, 'M1')), second]);
  assert.deepEqual(all.map(x => [x.id, x.title]), [['M2', 'Кино'], ['M1', 'Ужин вдвоём']]);
});

test('подписи: когда, где, статус и подсказка для каждой роли', () => {
  assert.equal(whenText({ date: '2026-11-22', time: '19:00' }), '22 ноября, воскресенье, 19:00');
  assert.equal(whenText(null), '');
  const p = proposal();
  const [mt] = meetingsFromMessages([msg('влад', 'аня', 100, proposalMessage(p, 'a1', 100, 'M1')), msg('аня', 'влад', 200, replyMessage('M1', { status: 'accepted', date: '2026-11-22', time: '19:00', placeId: 'p2' }, 'a2', 200))]);
  const host = describeMeeting(mt, 'влад'), guest = describeMeeting(mt, 'аня');
  assert.deepEqual([host.role, host.other, host.turn, host.hint, host.when, host.where, host.status, host.kind, host.icon], ['host', 'аня', 'confirm', 'Посмотри ответ и подтверди встречу.', '22 ноября, воскресенье, 19:00', 'Кино', STATUS_TEXT.answered, 'Свидание', 'heart']);
  assert.deepEqual([guest.role, guest.other, guest.turn, guest.hint], ['guest', 'влад', 'wait', 'Ждём подтверждения.']);
  for (const s of Object.values(STATUS_TEXT)) assert.ok(s.length > 5, 'у каждого состояния есть слова: не только цвет');
});

test('запись для журнала: id mt:<номер>, статус и время; без секретов', () => {
  const p = proposal();
  const [mt] = meetingsFromMessages([msg('влад', 'аня', 100, proposalMessage(p, 'a1', 100, 'M1'))]);
  const r = meetingRecord(mt, 'аня');
  assert.deepEqual([r.id, r.type, r.source, r.payload.with, r.payload.role, r.payload.status, r.payload.title, r.payload.duration], ['mt:M1', 'meeting', 'chat', 'влад', 'guest', 'proposed', 'Ужин вдвоём', 150]);
  assert.ok(!JSON.stringify(r).includes('priv'));
});

test('календарь: .ics с началом, концом, местом и напоминанием за час; без даты нельзя', () => {
  const p = proposal();
  const [open] = meetingsFromMessages([msg('влад', 'аня', 100, proposalMessage(p, 'a1', 100, 'M1'))]);
  assert.throws(() => meetingToIcs(open, 'влад'), /нет даты/);
  const [mt] = meetingsFromMessages([msg('влад', 'аня', 100, proposalMessage(p, 'a1', 100, 'M1')), msg('аня', 'влад', 200, replyMessage('M1', { status: 'accepted', date: '2026-11-22', time: '21:00', placeId: 'p2' }, 'a2', 200))]);
  const ics = meetingToIcs(mt, 'влад', { now: Date.UTC(2026, 10, 17, 12, 0, 0) });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  for (const line of ['UID:meet-M1@lifeos', 'DTSTAMP:20261117T120000Z', 'DTSTART:20261122T210000', 'DTEND:20261122T233000', 'TRIGGER:-PT1H']) assert.ok(ics.includes(line), line);
  assert.match(ics.replace(/\r\n /g, ''), /SUMMARY:Ужин вдвоём \(аня\)/);
  assert.match(ics.replace(/\r\n /g, ''), /LOCATION:Кино/);
  assert.match(ics.replace(/\r\n /g, ''), /DESCRIPTION:Давно не виделись/);
  assert.ok(ics.split('\r\n').every(l => new TextEncoder().encode(l).length <= 75), 'строки сложены по правилам календаря');
});

test('календарь выбора даты: недели с понедельника, пустые клетки по краям', () => {
  const w = pickerWeeks({ from: '2026-11-18', to: '2026-11-24' });            // среда … вторник
  assert.equal(w.length, 2);
  assert.deepEqual(w[0].map(c => c?.date ?? null), [null, null, '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
  assert.deepEqual(w[1].map(c => c?.date ?? null), ['2026-11-23', '2026-11-24', null, null, null, null, null]);
  assert.deepEqual(pickerWeeks({ from: '2026-11-24', to: '2026-11-18' }), []);
});

test('ключи чата в журнале: запись chatkey читается, чужие и неполные записи не подходят', () => {
  const k = { pub: 'AAA', priv: 'BBB' };
  const rec = chatKeyRecord(k, 5);
  assert.deepEqual([rec.id, rec.type, rec.payload], ['chatkey', 'chatkey', k]);
  assert.deepEqual(chatKeysOf([{ type: 'task', id: 'x', payload: {} }, rec]), k);
  assert.equal(chatKeysOf([]), null);
  assert.equal(chatKeysOf([{ type: 'chatkey', id: 'chatkey', payload: { pub: 'A' } }]), null);
  assert.equal(chatKeysOf([{ type: 'chatkey', id: 'другой', payload: k }]), null);
});
