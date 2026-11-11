import test from 'node:test';
import assert from 'node:assert/strict';
import { findAmount, parseCapture, captureLabel, buildCapture, guessCategory } from '../capture.js';

const NOW = new Date(2026, 10, 11, 12).getTime();           // 11 ноября 2026
const ctx = { now: NOW, habits: [{ id: 'h1', name: 'Зарядка по утрам' }, { id: 'h2', name: 'Чтение книги' }] };
const P = s => parseCapture(s, ctx);

test('сумма: рубли, тысячи, пробелы, копейки, суффиксы; единицы и даты не принимаются за сумму', () => {
  const m = s => findAmount(s)?.minor;
  assert.equal(m('кофе 250'), 25000);
  assert.equal(m('такси 480 р'), 48000);
  assert.equal(m('такси 480р.'), 48000);
  assert.equal(m('потратил 1 200 ₽'), 120000);
  assert.equal(m('потратил 12 500 на аренду'), 1250000);
  assert.equal(m('потратил 1200,50 на еду'), 120050);
  assert.equal(m('зарплата 85к'), 8500000);
  assert.equal(m('бонус 1,5к'), 150000);
  assert.equal(m('телефон 2 тыс'), 200000);
  assert.equal(m('купил 2 кг яблок за 300'), 30000);
  assert.equal(m('купил хлеб за 60'), 6000);
  assert.equal(findAmount('позвонить 10 числа'), null);
  assert.equal(findAmount('встреча в 12:30'), null);
  assert.equal(findAmount('сделать 15 минут'), null);
  assert.equal(findAmount('пробежать 5 км'), null);
  assert.equal(findAmount('привет'), null);
});
test('расходы: слова-глаголы, категории, заметка и дата', () => {
  const a = P('потратил 350 на кофе');
  assert.equal(a.kind, 'expense'); assert.equal(a.data.amountMinor, 35000); assert.equal(a.data.category, 'Еда'); assert.equal(a.data.note, 'кофе'); assert.equal(a.data.date, '2026-11-11');
  const b = P('такси 480 р вчера');
  assert.equal(b.kind, 'expense'); assert.equal(b.data.category, 'Транспорт'); assert.equal(b.data.date, '2026-11-10'); assert.equal(b.data.note, 'такси');
  const c = P('заплатил 3200 за аптеку');
  assert.equal(c.data.category, 'Здоровье');
  const d = P('оплатил интернет 650');
  assert.equal(d.kind, 'expense'); assert.equal(d.data.category, 'Связь');
  assert.equal(P('кофе 250').confidence, 'mid', 'без глагола — предложение «средней» уверенности');
  assert.equal(P('купил хлеб за 60').data.category, 'Еда');
  assert.equal(P('потратил 5000 на что-то').data.category, 'Другое');
  assert.equal(P('позавчера потратил 700 на кино').data.date, '2026-11-09');
  assert.equal(guessCategory('Пятёрочка'), 'Еда'); assert.equal(guessCategory('подписка Netflix'), 'Подписки'); assert.equal(guessCategory('курс английского'), 'Образование');
});
test('доходы', () => {
  const a = P('получил зарплату 85 000');
  assert.equal(a.kind, 'income'); assert.equal(a.data.amountMinor, 8500000); assert.equal(a.data.category, 'Зарплата');
  const b = P('подработка 4500 р');
  assert.equal(b.kind, 'income'); assert.equal(b.data.category, 'Подработка');
  const c = P('пришло 1200 от мамы');
  assert.equal(c.kind, 'income'); assert.equal(c.data.category, 'Другое'); assert.match(c.data.note, /мамы/);
  assert.equal(P('подарили 3000 на день рождения').data.category, 'Подарок');
});
test('замеры здоровья', () => {
  assert.deepEqual(P('вес 72,4').data, { kind: 'weight', value: 72.4 });
  assert.deepEqual(P('взвесился 71.8 кг').data, { kind: 'weight', value: 71.8 });
  assert.deepEqual(P('давление 120/80').data, { kind: 'bp', value: 120, value2: 80 });
  assert.deepEqual(P('Давление 135 на 85').data, { kind: 'bp', value: 135, value2: 85 });
  assert.deepEqual(P('пульс 58').data, { kind: 'pulse', value: 58 });
  assert.deepEqual(P('температура 36,6').data, { kind: 'temp', value: 36.6 });
  assert.deepEqual(P('сахар 5,2').data, { kind: 'glucose', value: 5.2 });
  assert.deepEqual(P('талия 84').data, { kind: 'waist', value: 84 });
  assert.equal(P('давление'), null, 'без числа — не замер');
  assert.equal(P('вес'), null);
});
test('заметки и привычки', () => {
  assert.deepEqual(P('заметка: позвонить в банк про карту').data, { text: 'позвонить в банк про карту' });
  assert.equal(P('идея — приложение для склада').kind, 'note');
  assert.equal(P('запомни код домофона 1234').kind, 'note');
  const h = P('зарядка сделал');
  assert.equal(h.kind, 'habit'); assert.equal(h.data.habitId, 'h1'); assert.equal(h.data.level, 'full');
  assert.equal(P('сделал чтение по минимуму').data.level, 'min');
  assert.equal(P('сделал йогу'), null, 'нет такой привычки');
  assert.equal(parseCapture('зарядка сделал', { now: NOW }), null, 'без списка привычек — не распознаём');
});
test('обычные задачи не перехватываются', () => {
  for (const s of ['позвонить маме', 'оплатить жильё 10 числа каждого месяца', 'купить хлеб завтра', 'встреча в 12:30', 'сделать отчёт до пятницы', 'прочитать 20 страниц', 'пробежать 5 км', 'написать письмо', 'a', '']) assert.equal(P(s), null, s);
});
test('подписи и создание событий: данные проходят настоящие проверки', () => {
  const e = P('потратил 350 на кофе');
  const sp = s => s.replace(/[\u00a0\u202f]/g, ' ');
  assert.equal(sp(captureLabel(e)), 'расход 350 ₽ · Еда (кофе)');
  const ev = buildCapture(e, { now: NOW });
  assert.equal(ev.type, 'expense'); assert.equal(ev.payload.amountMinor, 35000); assert.equal(ev.payload.category, 'Еда'); assert.equal(ev.payload.date, '2026-11-11');
  assert.equal(sp(captureLabel(P('вес 72,4'))), 'замер: Вес 72,4 кг');
  assert.equal(buildCapture(P('вес 72,4'), { now: NOW }).payload.value, 72.4);
  assert.equal(buildCapture(P('давление 120/80'), { now: NOW }).payload.value2, 80);
  assert.throws(() => buildCapture(P('давление 80/120'), { now: NOW }), /Верхнее давление/);
  assert.throws(() => buildCapture(P('вес 9'), { now: NOW }), /Вес/);
  assert.equal(buildCapture(P('получил зарплату 85000'), { now: NOW }).type, 'income');
  assert.equal(buildCapture(P('заметка: проверить'), { now: NOW }).type, 'note');
  const hb = buildCapture(P('зарядка сделал'), { habits: ctx.habits, now: NOW });
  assert.equal(hb.type, 'habit_log'); assert.equal(hb.payload.date, '2026-11-11'); assert.equal(hb.payload.level, 'full');
  assert.throws(() => buildCapture(P('зарядка сделал'), { habits: [], now: NOW }), /не найдена/);
  assert.match(captureLabel(P('зарядка сделал')), /привычка «Зарядка по утрам»/);
  assert.match(captureLabel(P('идея: тест')), /заметка/);
});
