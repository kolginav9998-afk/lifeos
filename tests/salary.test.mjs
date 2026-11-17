// Зарплата: налог, переработки по минутам, оклад и ставка за час, надбавки, прогноз, выплаты, выводы. Чистая логика (salary.js, salary-tax.js, salary-insights.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCfg, cfgFromTemplate } from '../schedule.js';
import { TAX_PRESETS, presetTax, normalizeTax, checkTax, bracketsError, parsePercent, fmtPercent, taxOnAmount, monthTax, describeTax, MAX_RATE_BP } from '../salary-tax.js';
import { workCost, normalizePay, checkPay, makePaycfg, payOf, makePaymonth, paymonthsOf, parseMinor, parseMult, fmtMult, fmtMoney, minorToInput, splitOvertime, computeMonth, payoutPlan, upcomingPayouts, incomeDraft, plural, ROUNDING, roundingId, DISCLAIMER } from '../salary.js';
import { monthSeries, whatIf, insights } from '../salary-insights.js';
import { makeIncome, MAX_MINOR } from '../money.js';

const sp = s => s.replace(/[  ]/g, ' ');
const cfgM = (extra = {}) => normalizeCfg({ ...cfgFromTemplate('w52', '2026-11-01'), normMode: 'manual', normHours: 160, ...extra });      // норма 160 ч: час = 1000 ₽ при окладе 160 000 ₽
const cfgA = (extra = {}) => normalizeCfg({ ...cfgFromTemplate('w52', '2026-11-01'), ...extra });                                         // норма по графику: ноябрь 2026 — 168 ч
const pay0 = (extra = {}) => normalizePay({ mode: 'salary', baseMinor: 16_000_000, currency: 'RUB', tax: { kind: 'flat', rateBp: 1300 }, ...extra });
const day = (date, from, to, extra = {}) => [date, { date, kind: 'work', shift: 'd', actual: { from, to }, ...extra }];
const run = (o = {}) => computeMonth({ ym: '2026-11', cfg: cfgM(), pay: pay0(), days: new Map(), today: '2026-12-01', ...o });

test('налог: плоская ставка, шкала за месяц, шкала за год с порогами', () => {
  assert.equal(monthTax({ kind: 'flat', rateBp: 1300 }, 1_000_000), 130_000); assert.equal(monthTax({ kind: 'flat', rateBp: 0 }, 1_000_000), 0); assert.equal(monthTax({ kind: 'flat', rateBp: 1350 }, 1_000_001), 135_000);
  const own = presetTax('own');                                                     // до 100 000 — 10 %, выше — 20 %
  assert.equal(monthTax(own, 10_000_000), 1_000_000); assert.equal(monthTax(own, 15_000_000), 2_000_000); assert.equal(monthTax(own, 0), 0); assert.equal(monthTax(own, -5), 0);
  const ru = presetTax('ru');
  assert.equal(monthTax(ru, 10_000_000, 0), 1_300_000);
  assert.equal(monthTax(ru, 10_000_000, 239_000_000), 1_000_000 * 0.13 + 9_000_000 * 0.15, 'месяц пересёк порог: часть по 13 %, часть по 15 %');
  assert.equal(monthTax(ru, 10_000_000, 245_000_000), 1_500_000, 'порог уже пройден: всё по 15 %');
  assert.equal(taxOnAmount(ru.brackets, 240_000_000), 31_200_000); assert.equal(taxOnAmount(ru.brackets, 500_000_000), 31_200_000 + 39_000_000);
  assert.equal(monthTax({ kind: 'brackets', basis: 'monthly', brackets: [{ upToMinor: null, rateBp: 500 }] }, 1_000_000), 50_000, 'одна открытая ступень');
});
test('налог: готовые наборы — примеры; проверка ступеней; приведение чужих данных', () => {
  assert.deepEqual(TAX_PRESETS.map(p => p.pid), ['none', 'flat', 'ru', 'own']); assert.match(TAX_PRESETS.find(p => p.pid === 'ru').title, /пример, проверь актуальные ставки/); assert.match(TAX_PRESETS.find(p => p.pid === 'flat').title, /пример/);
  for (const p of TAX_PRESETS) assert.doesNotThrow(() => checkTax(p.tax), p.pid);
  presetTax('ru').brackets.push({ upToMinor: 1, rateBp: 1 }); assert.equal(presetTax('ru').brackets.length, 5, 'набор нельзя испортить снаружи');
  assert.equal(bracketsError([]), 'Добавь хотя бы одну ступень'); assert.match(bracketsError([{ upToMinor: 5, rateBp: 100 }, { upToMinor: 5, rateBp: 100 }, { upToMinor: null, rateBp: 100 }]), /Ступень 2: порог должен быть больше/);
  assert.match(bracketsError([{ upToMinor: 5, rateBp: 20000 }, { upToMinor: null, rateBp: 100 }]), /ставка от 0 до 100/); assert.match(bracketsError(Array.from({ length: 13 }, () => ({ upToMinor: 1, rateBp: 1 }))), /не больше 12/);
  assert.match(bracketsError([{ upToMinor: -5, rateBp: 100 }, { upToMinor: null, rateBp: 100 }]), /порог/);
  assert.deepEqual(normalizeTax(null), { kind: 'flat', rateBp: 0 }); assert.deepEqual(normalizeTax({ kind: 'flat', rateBp: -5 }), { kind: 'flat', rateBp: 0 }); assert.deepEqual(normalizeTax({ kind: 'flat', rateBp: MAX_RATE_BP + 1 }), { kind: 'flat', rateBp: 0 });
  assert.deepEqual(normalizeTax({ kind: 'brackets', brackets: [{ upToMinor: 5, rateBp: 100 }, { upToMinor: 77, rateBp: 200 }] }), { kind: 'brackets', basis: 'annual', brackets: [{ upToMinor: 5, rateBp: 100 }, { upToMinor: null, rateBp: 200 }] }, 'у последней ступени порога нет');
  assert.throws(() => checkTax({ kind: 'flat', rateBp: 10001 }), /от 0 до 100/); assert.throws(() => checkTax({ kind: 'zzz' }), /Выбери/); assert.throws(() => checkTax({ kind: 'brackets', brackets: [] }), /хотя бы одну/);
  assert.equal(describeTax({ kind: 'flat', rateBp: 1300 }), 'Плоская ставка 13 %'); assert.equal(describeTax({ kind: 'flat', rateBp: 0 }), 'Без налога'); assert.equal(describeTax(presetTax('ru')), 'Шкала из 5 ступеней, пороги за год'); assert.equal(describeTax(presetTax('own')), 'Шкала из 2 ступени, пороги за месяц');
});
test('проценты, суммы и коэффициенты: ввод и вывод, отрицательные и огромные значения отвергаются', () => {
  assert.equal(parsePercent('13'), 1300); assert.equal(parsePercent('13,5 %'), 1350); assert.equal(parsePercent('0'), 0); assert.equal(parsePercent('100'), 10000);
  for (const bad of ['101', '-1', 'abc', '', '1,234', '13,5,1']) assert.throws(() => parsePercent(bad), /Процент/, bad);
  assert.equal(fmtPercent(1350), '13,5 %'); assert.equal(fmtPercent(10000), '100 %'); assert.equal(fmtPercent(0), '0 %'); assert.equal(fmtPercent(1325), '13,25 %');
  assert.equal(parseMinor('1 250,5'), 125_050); assert.equal(parseMinor('1250'), 125_000); assert.equal(parseMinor('0', true), 0);
  for (const bad of ['0', '-5', '12,345', 'abc', '', '1e5']) assert.throws(() => parseMinor(bad), /Сумма/, bad);
  assert.throws(() => parseMinor('-5', true), /Сумма/); assert.throws(() => parseMinor('99999999999999'), /Слишком большая/); assert.equal(parseMinor(String(MAX_MINOR / 100)), MAX_MINOR);
  assert.equal(parseMult('2'), 2000); assert.equal(parseMult('1,5'), 1500); assert.equal(parseMult('×2,25'), 2250); assert.equal(parseMult('10'), 10000);
  for (const bad of ['0,5', '11', '-2', 'x', '']) assert.throws(() => parseMult(bad), /Коэффициент/, bad);
  assert.equal(fmtMult(2000), '×2'); assert.equal(fmtMult(1500), '×1,5');
  assert.equal(sp(fmtMoney(123_456)), '1 234,56 ₽'); assert.equal(sp(fmtMoney(100)), '1 ₽'); assert.equal(sp(fmtMoney(0)), '0 ₽'); assert.equal(sp(fmtMoney(-5000, 'USD')), '−50 $'); assert.equal(sp(fmtMoney(1_234_567_890, 'ILS')), '12 345 678,90 ₪'); assert.equal(sp(fmtMoney(5, 'XXX')), '0,05 XXX');
  assert.equal(minorToInput(125_050), '1250,50'); assert.equal(minorToInput(125_000), '1250');
});
test('переработки по минутам: коэффициент ×2, ступени, округление', () => {
  const o = { roundMin: 1, roundDir: 'down', tier1Min: 0 };
  assert.deepEqual(splitOvertime([47], o), { min: 47, t1: 0, t2: 47, raw: 47 }); assert.deepEqual(splitOvertime([], o), { min: 0, t1: 0, t2: 0, raw: 0 }); assert.equal(splitOvertime([-5, 0], o).min, 0);
  assert.deepEqual(splitOvertime([47], { ...o, tier1Min: 30 }), { min: 47, t1: 30, t2: 17, raw: 47 }); assert.equal(splitOvertime([20], { ...o, tier1Min: 30 }).t1, 20, 'короткая переработка целиком по первой ступени');
  assert.equal(splitOvertime([47], { ...o, roundMin: 15 }).min, 45); assert.equal(splitOvertime([44], { ...o, roundMin: 15 }).min, 30); assert.equal(splitOvertime([14], { ...o, roundMin: 15 }).min, 0);
  assert.equal(splitOvertime([52], { ...o, roundMin: 15, roundDir: 'near' }).min, 45); assert.equal(splitOvertime([53], { ...o, roundMin: 15, roundDir: 'near' }).min, 60); assert.equal(splitOvertime([48], { ...o, roundMin: 5, roundDir: 'near' }).min, 50);
  assert.equal(splitOvertime([20, 20], { ...o, roundMin: 15, roundDir: 'near' }).min, 30, 'по дням: каждый день округляется отдельно'); assert.equal(splitOvertime([40], { ...o, roundMin: 15, roundDir: 'near' }).min, 45, 'за месяц: округляется сумма');
  assert.deepEqual(ROUNDING.map(r => r.rid), ['min', 'd5', 'd15', 'n5', 'n15']); assert.equal(roundingId({ roundMin: 15, roundDir: 'near' }), 'n15'); assert.equal(roundingId({ roundMin: 7, roundDir: 'up' }), 'min');
});
test('оклад 160 000 ₽, норма 160 ч: час = 1000 ₽; без переработок налог 13 %', () => {
  const r = run(), m = r.month;
  assert.deepEqual([r.normMin, r.perHourMinor, r.zeroNorm, r.share, r.left], [9600, 100_000, false, 1, 0]);
  assert.deepEqual([m.base, m.overtime.pay, m.gross, m.taxable, m.tax, m.net, m.taxBp], [16_000_000, 0, 16_000_000, 16_000_000, 2_080_000, 13_920_000, 1300]);
  assert.deepEqual(r.accrued, m, 'прошедший месяц: начислено = итог');
});
test('пример владельца: 47 минут переработки по ×2 считаются по минутам — 1566,67 ₽', () => {
  const r = run({ days: new Map([day('2026-11-17', '09:00', '18:47')]) }), m = r.month;                    // 09:00–18:47 минус час перерыва = 527 мин при плане 480
  assert.deepEqual([m.overtime.min, m.overtime.t2, m.overtime.pay], [47, 47, 156_667]); assert.equal(m.overtime.pay, Math.round(47 * 2 * (16_000_000 / 9600)));
  assert.deepEqual([m.gross, m.tax, m.net], [16_156_667, 2_100_367, 14_056_300]); assert.deepEqual([r.recordedDays, r.assumedDays], [1, 20]);
  const tier = run({ pay: pay0({ ot: { basis: 'day', multMille: 2000, tier1Min: 30, tier1MultMille: 1500 } }), days: new Map([day('2026-11-17', '09:00', '18:47')]) }).month.overtime;
  assert.deepEqual([tier.t1, tier.t2, tier.pay], [30, 17, 75_000 + 56_667], 'первые 30 минут ×1,5, остальные ×2');
  const r15 = n => run({ pay: pay0({ ot: { basis: 'day', multMille: 2000, roundMin: 15, roundDir: n } }), days: new Map([day('2026-11-17', '09:00', '18:47')]) }).month.overtime;
  assert.deepEqual([r15('down').min, r15('down').pay, r15('near').min], [45, 150_000, 45]);
  assert.equal(run({ pay: pay0({ ot: { basis: 'day', multMille: 3000 } }), days: new Map([day('2026-11-17', '09:00', '18:47')]) }).month.overtime.pay, 235_000, '×3 вместо ×2');
  assert.equal(run({ days: new Map([day('2026-11-16', '09:00', '18:00')]) }).month.overtime.pay, 0, 'ровно по плану — переработки нет');
  assert.equal(run({ days: new Map([day('2026-11-16', '09:00', '17:00')]) }).month.overtime.pay, 0, 'меньше плана не штрафуется');
  const off = run({ days: new Map([['2026-11-14', { date: '2026-11-14', kind: 'off', actual: { from: '10:00', to: '12:00' } }]]) }).month.overtime;
  assert.deepEqual([off.min, off.pay], [120, 400_000], 'работа в выходной: все минуты сверх плана; 2 часа ×2 = 4000 ₽');
});
test('переработки «за месяц сверх нормы»: недоработка одного дня гасит переработку другого', () => {
  const days = new Map([day('2026-11-17', '09:00', '18:47'), day('2026-11-18', '09:00', '17:30')]);
  const monthly = computeMonth({ ym: '2026-11', cfg: cfgA(), pay: pay0({ baseMinor: 16_800_000, ot: { basis: 'month', multMille: 2000 } }), days, today: '2026-12-01' });
  assert.equal(monthly.normMin, 10_080); assert.equal(monthly.month.overtime.min, 47 - 30); assert.equal(monthly.month.overtime.pay, Math.round(17 * 2 * (16_800_000 / 10_080)));
  const daily = computeMonth({ ym: '2026-11', cfg: cfgA(), pay: pay0({ baseMinor: 16_800_000 }), days, today: '2026-12-01' });
  assert.equal(daily.month.overtime.min, 47, 'по дням недоработка не гасит');
  assert.equal(computeMonth({ ym: '2026-11', cfg: cfgA(), pay: pay0({ baseMinor: 16_800_000, ot: { basis: 'month' } }), days: new Map(), today: '2026-12-01' }).month.overtime.min, 0, 'ровно норма — без переработок');
  const two = new Map([day('2026-11-17', '09:00', '18:20'), day('2026-11-18', '09:00', '18:20')]), mk = (basis, near) => computeMonth({ ym: '2026-11', cfg: cfgA(), pay: pay0({ baseMinor: 16_800_000, ot: { basis, roundMin: 15, roundDir: near } }), days: two, today: '2026-12-01' }).month.overtime.min;
  assert.deepEqual([mk('day', 'near'), mk('month', 'near'), mk('day', 'down'), mk('month', 'down')], [30, 45, 30, 30]);
});
test('отпуск, больничный и «за свой счёт»: удержание по минутам графика', () => {
  const d = (...dates) => new Map(dates.map(([date, kind]) => [date, { date, kind }]));
  assert.equal(run({ days: d(['2026-11-16', 'vacation']) }).month.base, 16_000_000, 'отпуск по умолчанию оплачивается полностью');
  assert.equal(run({ days: d(['2026-11-16', 'sick']) }).month.base, 15_200_000);
  assert.equal(run({ pay: pay0({ leavePct: { sick: 60 } }), days: d(['2026-11-16', 'sick']) }).month.base, 15_680_000, 'больничный оплачивается на 60 %');
  assert.equal(run({ days: d(['2026-11-16', 'unpaid'], ['2026-11-17', 'unpaid']) }).month.base, 14_400_000);
  assert.equal(run({ days: d(['2026-11-14', 'sick']) }).month.base, 16_000_000, 'больничный в выходной ничего не отнимает');
  assert.equal(run({ pay: pay0({ leavePct: { vacation: 50 } }), days: d(['2026-11-16', 'vacation']) }).month.base, 15_600_000);
});
test('ставка за час: часы по факту, отпуск оплачивается, переработки ×2', () => {
  const hp = (extra = {}) => pay0({ mode: 'hourly', baseMinor: 100_000, ...extra }), cfg = cfgA();
  const base = computeMonth({ ym: '2026-11', cfg, pay: hp(), days: new Map(), today: '2026-12-01' });
  assert.deepEqual([base.month.base, base.perHourMinor, base.month.workedMin], [16_800_000, 100_000, 10_080]);
  const ot = computeMonth({ ym: '2026-11', cfg, pay: hp(), days: new Map([day('2026-11-17', '09:00', '18:47')]), today: '2026-12-01' }).month;
  assert.deepEqual([ot.base, ot.overtime.min, ot.overtime.pay, ot.gross], [16_800_000, 47, 156_667, 16_956_667]);
  assert.equal(computeMonth({ ym: '2026-11', cfg, pay: hp(), days: new Map([['2026-11-16', { date: '2026-11-16', kind: 'vacation' }]]), today: '2026-12-01' }).month.base, 16_800_000, 'день отпуска оплачен как рабочий');
  assert.equal(computeMonth({ ym: '2026-11', cfg, pay: hp(), days: new Map([['2026-11-16', { date: '2026-11-16', kind: 'sick' }]]), today: '2026-12-01' }).month.base, 16_800_000 - 800_000, 'больничный не оплачен');
  const own = computeMonth({ ym: '2026-11', cfg, pay: pay0({ baseMinor: 16_800_000, hourlyMinor: 150_000 }), days: new Map([day('2026-11-17', '09:00', '18:47')]), today: '2026-12-01' });
  assert.deepEqual([own.perHourMinor, own.month.overtime.pay], [150_000, Math.round(47 * 2 * 150_000 / 60)], 'ставка за час для переработок задана вручную');
});
test('надбавки, вычеты, необлагаемая сумма, разовая премия месяца', () => {
  const p = pay0({ taxFreeMinor: 1_000_000, allowances: [{ name: 'Премия', amountMinor: 2_000_000, taxable: true }, { name: 'Проезд', pctBp: 500, taxable: false }], deductions: [{ name: 'Взнос', amountMinor: 100_000, when: 'before' }, { name: 'Кредит', amountMinor: 3_000_000, when: 'after' }] });
  const m = run({ pay: p }).month;
  assert.deepEqual([m.allowances, m.gross, m.preDed, m.postDed, m.taxable, m.tax, m.net], [2_800_000, 18_800_000, 100_000, 3_000_000, 16_900_000, 2_197_000, 13_503_000]);
  const pct = run({ pay: pay0({ deductions: [{ name: 'Профсоюз', pctBp: 100, when: 'after' }] }) }).month; assert.deepEqual([pct.postDed, pct.net], [160_000, 16_000_000 - 2_080_000 - 160_000], 'процент считается от начисленного');
  const ex = run({ extras: [{ name: 'Премия квартала', amountMinor: 1_000_000, taxable: true }, { name: 'Подарок', amountMinor: 500_000, taxable: false }] }).month; assert.deepEqual([ex.gross, ex.taxable, ex.tax], [17_500_000, 17_000_000, 2_210_000]);
  assert.equal(run({ pay: pay0({ deductions: [{ name: 'Большой', amountMinor: 99_999_999, when: 'after' }] }) }).month.net, 0, 'удержания больше суммы — на руки не отрицательно');
  assert.deepEqual(normalizePay({ allowances: [{ name: '', amountMinor: 5 }, { name: 'x' }, { name: 'ok', amountMinor: 10, pctBp: 5 }] }).allowances, [{ name: 'ok', amountMinor: 0, pctBp: 5, taxable: true }], 'пустые строки отбрасываются; процент важнее суммы');
});
test('ночная доплата: ночные минуты смен по ставке', () => {
  const cfg = normalizeCfg({ ...cfgFromTemplate('cdn', '2026-11-10'), normMode: 'manual', normHours: 160 }), m = computeMonth({ ym: '2026-11', cfg, pay: pay0({ nightPct: 20 }), days: new Map(), today: '2026-12-01' }).month;
  assert.deepEqual([m.nightMin, m.night], [7 * 480, 7 * 160_000], 'семь ночных смен (3, 7, 11, 15, 19, 23, 27 ноября)'); assert.equal(computeMonth({ ym: '2026-11', cfg, pay: pay0(), days: new Map(), today: '2026-12-01' }).month.night, 0);
});
test('прогноз: начислено на сегодня, остаток рабочих дней, будущий и прошлый месяцы', () => {
  const o = { cfg: cfgA(), pay: pay0({ baseMinor: 16_800_000 }), days: new Map() };
  const mid = computeMonth({ ym: '2026-11', today: '2026-11-16', ...o });
  assert.deepEqual([mid.left, mid.accrued.base, mid.month.base, mid.share], [11, 8_000_000, 16_800_000, 10 / 21]);
  assert.equal(computeMonth({ ym: '2026-11', today: '2026-11-16', nowMin: 18 * 60 + 5, ...o }).accrued.base, 8_800_000, 'смена сегодня закончилась'); assert.equal(computeMonth({ ym: '2026-11', today: '2026-11-16', nowMin: 12 * 60, ...o }).left, 11);
  const rec = computeMonth({ ym: '2026-11', today: '2026-11-16', cfg: o.cfg, pay: o.pay, days: new Map([day('2026-11-16', '09:00', '19:00')]) }); assert.equal(rec.left, 10, 'сегодняшний день отмечен как законченный'); assert.equal(rec.accrued.overtime.min, 60);
  const fut = computeMonth({ ym: '2026-12', today: '2026-11-16', ...o }); assert.deepEqual([fut.accrued.base, fut.accrued.net, fut.month.base, fut.left], [0, 0, 16_800_000, 23]);
  const past = computeMonth({ ym: '2026-10', today: '2026-11-16', ...o }); assert.deepEqual([past.left, past.share], [0, 1]);
  const a = computeMonth({ ym: '2026-11', today: '2026-11-16', cfg: o.cfg, pay: o.pay, days: new Map([day('2026-11-18', '09:00', '19:00')]) });
  assert.equal(a.accrued.overtime.min, 60, 'отмеченная переработка будущего дня уже учтена'); assert.equal(a.month.overtime.min, 60);
});
test('пустой график, нулевая норма и огромные значения: без NaN и без деления на ноль', () => {
  const none = normalizeCfg({ shifts: [{ key: 'd', name: 'День', from: '09:00', to: '18:00' }], pattern: { kind: 'week', week: ['', '', '', '', '', '', ''] } });
  const z = computeMonth({ ym: '2026-11', cfg: none, pay: pay0(), days: new Map([['2026-11-17', { date: '2026-11-17', kind: 'work', actual: { from: '09:00', to: '12:00' } }]]), today: '2026-12-01' });
  assert.deepEqual([z.zeroNorm, z.perHourMinor, z.month.overtime.pay, z.month.base], [true, 0, 0, 16_000_000]);
  for (const t of [z.month, z.accrued]) for (const v of Object.values(t)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `число: ${v}`);
  const m0 = computeMonth({ ym: '2026-11', cfg: normalizeCfg({ ...none, normMode: 'manual', normHours: 0 }), pay: pay0({ ot: { basis: 'month' } }), days: new Map(), today: '2026-12-01' }); assert.equal(m0.month.overtime.min, 0);
  const big = normalizePay({ baseMinor: 10 ** 15, ot: { multMille: 10000 } }); assert.equal(big.baseMinor, MAX_MINOR);
  const h = computeMonth({ ym: '2026-11', cfg: cfgM(), pay: big, days: new Map([day('2026-11-17', '09:00', '23:59')]), today: '2026-12-01', adjust: { extraOvertimeMin: 40_000, raisePct: 500 } }).month;
  for (const k of ['base', 'gross', 'net', 'tax']) assert.ok(h[k] <= MAX_MINOR && h[k] >= 0, k);
  const ng = normalizePay({ baseMinor: -5, nightPct: -3, advance: { day: -1, pct: 400 }, leavePct: { sick: 999 }, ot: { multMille: 1 } }); assert.deepEqual([ng.baseMinor, ng.nightPct, ng.advance, ng.leavePct.sick, ng.ot.multMille], [0, 0, { day: 0, pct: 40 }, 0, 2000]);
});
test('налог по шкале за год: прошлые месяцы из итогов или «как в этом месяце»', () => {
  const o = { ym: '2026-03', cfg: cfgM(), pay: pay0({ tax: presetTax('ru') }), days: new Map(), today: '2026-04-01' };
  const known = computeMonth({ ...o, prior: new Map([['2026-01', 100_000_000], ['2026-02', 100_000_000]]) }); assert.deepEqual([known.ytd, known.month.tax], [{ minor: 200_000_000, assumed: 0 }, 2_080_000]);
  const over = computeMonth({ ...o, prior: new Map([['2026-01', 230_000_000]]) }); assert.deepEqual([over.ytd, over.month.tax], [{ minor: 246_000_000, assumed: 1 }, 2_400_000], 'февраль неизвестен: считаем доход как в этом месяце');
  const none = computeMonth(o); assert.deepEqual([none.ytd, none.month.tax], [{ minor: 32_000_000, assumed: 2 }, 2_080_000]);
  assert.deepEqual(computeMonth({ ...o, ym: '2026-01' }).ytd, { minor: 0, assumed: 0 }); assert.deepEqual(computeMonth({ ...o, pay: pay0() }).ytd, { minor: 0, assumed: 0 }, 'плоская ставка: прошлые месяцы не нужны');
  assert.equal(computeMonth({ ...o, pay: pay0({ tax: { ...presetTax('ru'), basis: 'monthly' } }) }).ytd.minor, 0);
});
test('выплаты: аванс и остаток, конец короткого месяца, ближайшие', () => {
  const p = pay0({ advance: { day: 25, pct: 40 }, salaryDay: 10 });
  assert.deepEqual(payoutPlan('2026-11', 10_000_000, p), [{ kind: 'advance', ym: '2026-11', date: '2026-11-25', amountMinor: 4_000_000 }, { kind: 'final', ym: '2026-11', date: '2026-12-10', amountMinor: 6_000_000 }]);
  assert.deepEqual(payoutPlan('2026-02', 1000, pay0({ advance: { day: 31, pct: 50 }, salaryDay: 31 })).map(x => x.date), ['2026-02-28', '2026-03-31']); assert.equal(payoutPlan('2024-02', 1000, pay0({ advance: { day: 31 } }))[0].date, '2024-02-29');
  assert.deepEqual(payoutPlan('2026-11', 10_000_000, pay0({ salaryDay: 10 })).map(x => [x.kind, x.amountMinor]), [['final', 10_000_000]], 'без аванса остаток — всё'); assert.deepEqual(payoutPlan('2026-11', 100, pay0()), []);
  assert.deepEqual(upcomingPayouts('2026-11-16', p, () => 10_000_000).map(x => [x.kind, x.date]), [['advance', '2026-11-25'], ['final', '2026-12-10']]);
  assert.deepEqual(upcomingPayouts('2026-11-08', p, () => 10_000_000, 1).map(x => [x.kind, x.date]), [['final', '2026-11-10']], 'остаток прошлого месяца ещё впереди');
  assert.deepEqual(upcomingPayouts('2026-11-16', pay0(), () => 5), []);
});
test('запись как доход через money.js; настройки и итог месяца: проверка и чтение', () => {
  const r = run({ days: new Map([day('2026-11-17', '09:00', '18:47')]) }), ev = makeIncome(incomeDraft(r, pay0(), '2026-11-25'));
  assert.deepEqual([ev.type, ev.payload.amountMinor, ev.payload.category, ev.payload.date, ev.payload.note], ['income', 14_056_300, 'Зарплата', '2026-11-25', 'Зарплата за ноябрь 2026 (расчёт)']);
  assert.match(incomeDraft(r, pay0({ currency: 'ILS' }), '2026-11-25').note, /расчёт, ILS/); assert.throws(() => incomeDraft(run({ pay: pay0({ deductions: [{ name: 'x', amountMinor: 99_999_999, when: 'after' }] }) }), pay0(), '2026-11-25'), /нулевая/);
  const ok = { mode: 'salary', baseMinor: 5_000_000, currency: 'ILS', tax: presetTax('flat'), ot: { multMille: 2000 } };
  assert.doesNotThrow(() => checkPay(ok));
  for (const [bad, re] of [[{ baseMinor: 0 }, /больше нуля/], [{ baseMinor: -1 }, /больше нуля/], [{ baseMinor: MAX_MINOR + 1 }, /больше нуля/], [{ currency: 'XXX' }, /валюту/], [{ ot: { multMille: 500 } }, /Коэффициент/], [{ ot: { multMille: 2000, tier1MultMille: 99999 } }, /Коэффициент/],
    [{ tax: { kind: 'flat', rateBp: 20000 } }, /от 0 до 100/], [{ salaryDay: 40 }, /Проверь числа/], [{ nightPct: 150 }, /Проверь числа/], [{ leavePct: { sick: 200 } }, /от 0 до 100/], [{ advance: { day: 40, pct: 10 } }, /Аванс/]]) assert.throws(() => checkPay({ ...ok, ...bad }), re, JSON.stringify(bad));
  assert.throws(() => checkPay(null), /Нет настроек/);
  const e1 = makePaycfg(ok, null, 100), e2 = makePaycfg({ ...ok, baseMinor: 6_000_000 }, e1, 900); assert.deepEqual([e1.id, e1.type, e1.ts, e2.ts, e2.payload.editedAt, payOf([e2]).baseMinor, payOf([]), payOf([e1]).currency], ['paycfg', 'paycfg', 100, 100, 900, 6_000_000, null, 'ILS']);
  const pm = makePaymonth({ ym: '2026-10', computed: { grossMinor: 10, taxMinor: 1, netMinor: 9, taxableMinor: 10, overtimeMin: 5, overtimeMinor: 3, workedMin: 100, лишнее: 1 }, actualNetMinor: 8, extras: [{ name: 'Премия', amountMinor: 5, taxable: false }, { name: '', amountMinor: 5 }, { name: 'ноль', amountMinor: 0 }], note: ' ok ' }, null, 5);
  assert.deepEqual([pm.id, pm.type, pm.payload.actualNetMinor, pm.payload.extras, pm.payload.note, pm.payload.computed.лишнее], ['pm:2026-10', 'paymonth', 8, [{ name: 'Премия', amountMinor: 5, taxable: false }], 'ok', undefined]);
  assert.equal(makePaymonth({ ym: '2026-10', actualNetMinor: '' }).payload.actualNetMinor, null); assert.throws(() => makePaymonth({ ym: '2026-13' }), /Месяц/); assert.throws(() => makePaymonth({ ym: '2026-10', actualNetMinor: -1 }), /Сумма/);
  assert.equal(paymonthsOf([pm, { type: 'task', payload: {} }]).get('2026-10').actualNetMinor, 8);
});
test('аналитика: «а что если», ряд месяцев, выводы простыми словами', () => {
  const args = { ym: '2026-11', cfg: cfgM(), pay: pay0(), days: new Map(), today: '2026-12-01' };
  const w = whatIf(args, { extraOvertimeMin: 60 }); assert.deepEqual([w.dGross, w.dTax, w.dNet], [200_000, 26_000, 174_000]);
  const raise = whatIf(args, { raisePct: 10 }); assert.deepEqual([raise.before.base, raise.after.base, raise.dGross], [16_000_000, 17_600_000, 1_600_000]);
  const both = whatIf(args, { extraOvertimeMin: 60, raisePct: 10 }); assert.equal(both.after.overtime.pay, 220_000, 'после прибавки час тоже дороже');
  assert.deepEqual(whatIf(args, {}).dNet, 0);
  const s = monthSeries('2026-11', 3, ym => computeMonth({ ...args, ym })); assert.deepEqual(s.map(r => r.ym), ['2026-09', '2026-10', '2026-11']); assert.equal(s[2].net, 13_920_000);
  const cur = computeMonth({ ...args, days: new Map([day('2026-11-17', '09:00', '18:47')]) }), prev = computeMonth({ ...args, ym: '2026-10' });
  const texts = insights({ cur, prev, series: monthSeries('2026-11', 6, ym => computeMonth({ ...args, ym, days: ym === '2026-11' ? cur.days.length ? new Map([day('2026-11-17', '09:00', '18:47')]) : new Map() : new Map() })), pay: pay0(), today: '2026-12-01' }).map(i => sp(i.text));
  assert.ok(texts.some(t => /^Переработки дали 1 % дохода: 1 566,67 ₽ из 161 566,67 ₽ до налога \(47 мин\)\.$/.test(t)), texts.join(' | '));
  assert.ok(texts.some(t => /Налог по твоим настройкам — около 13 % от начисленного: 21 003,67 ₽/.test(t))); assert.ok(texts.some(t => /Час по ставке стоит около 1 000 ₽, час переработки — около 2 000 ₽/.test(t)));
  assert.ok(texts.some(t => /^Для 20 прошедших рабочих дней нет отметки часов/.test(t))); assert.ok(texts.some(t => /^По сравнению с месяцем «октябрь 2026» на руки больше на 1 363,00 ₽/.test(t) || /на руки больше на/.test(t)));
  assert.ok(texts.some(t => /^Лучший месяц из последних 6: ноябрь 2026/.test(t) || /^Этот месяц — лучший из последних 6/.test(t)));
  const now = computeMonth({ ...args, today: '2026-11-16', cfg: cfgA(), pay: pay0({ baseMinor: 16_800_000, advance: { day: 25, pct: 40 }, salaryDay: 10 }) });
  const t2 = insights({ cur: now, pay: pay0({ baseMinor: 16_800_000 }), today: '2026-11-16', upcoming: upcomingPayouts('2026-11-16', pay0({ baseMinor: 16_800_000, advance: { day: 25, pct: 40 }, salaryDay: 10 }), () => 10_000_000) }).map(i => sp(i.text));
  assert.ok(t2.some(t => /^До конца месяца 11 рабочих дней: прогноз на руки около 146 160 ₽ \(без новых переработок\)\.$/.test(t)), t2.join(' | ')); assert.ok(t2.some(t => /^На сегодня начислено около 80 000 ₽ до налога/.test(t)));
  assert.ok(t2.some(t => /^Ближайшая выплата: аванс 25 ноября, около 40 000 ₽\.$/.test(t)));
  const closed = new Map([['2026-10', { ym: '2026-10', computed: { netMinor: 14_000_000 }, actualNetMinor: 13_000_000 }]]);
  const real = insights({ cur, pay: pay0(), today: '2026-12-01', closed }).find(i => i.id === 'real'); assert.equal(real.tone, 'warn'); assert.match(sp(real.text), /За октябрь 2026 расчёт был 140 000 ₽, пришло 130 000 ₽: меньше на 10 000 ₽ \(7 %\)\. Проверь надбавки/);
  assert.equal(insights({ cur, pay: pay0(), today: '2026-12-01', closed: new Map([['2026-10', { ym: '2026-10', computed: { netMinor: 14_000_000 }, actualNetMinor: 14_000_000 }]]) }).find(i => i.id === 'real').text.includes('сошлось'), true);
  assert.deepEqual(insights({ cur: null, pay: pay0(), today: '2026-11-16' }), []); assert.deepEqual(insights({ cur, pay: pay0({ baseMinor: 0 }), today: '2026-11-16' }), []);
  const heavy = computeMonth({ ...args, days: new Map([day('2026-11-17', '09:00', '22:00'), day('2026-11-18', '09:00', '22:00')]) }); assert.ok(insights({ cur: heavy, pay: pay0(), today: '2026-12-01' }).some(i => i.id === 'ot-norm' && i.tone === 'warn'));
  assert.deepEqual([plural(1, 'день', 'дня', 'дней'), plural(2, 'день', 'дня', 'дней'), plural(5, 'день', 'дня', 'дней'), plural(11, 'день', 'дня', 'дней'), plural(21, 'день', 'дня', 'дней'), plural(22, 'день', 'дня', 'дней')], ['день', 'дня', 'дней', 'дней', 'день', 'дня']);
  assert.match(DISCLAIMER, /приблизительный.*не бухгалтерия и не налоговая консультация/);
});

test('сколько работы стоит покупка: цена делится на ставку на руки за час', () => {
  // на руки 140 000 ₽ за месяц при норме 160 ч: 875 ₽ в час; покупка за 8750 ₽ = 10 часов; в месяце 20 рабочих дней по 8 часов
  const c = workCost(875_000, 14_000_000, 160 * 60, 20);
  assert.equal(c.perHourMinor, 87_500); assert.equal(c.minutes, 600); assert.equal(c.hours, 10); assert.equal(c.days, 1.25);
  assert.equal(workCost(100, 14_000_000, 160 * 60).minutes, 0, 'копейки стоят меньше минуты');
  assert.equal(workCost(875_000, 14_000_000, 160 * 60).days, 600 / 480, 'без числа рабочих дней день равен 8 часам');
  for (const bad of [[0, 1, 1], [-5, 1, 1], [100, 0, 1], [100, 1, 0], ['x', 1, 1], [null, 1, 1], [100, NaN, 1]]) assert.equal(workCost(...bad), null, JSON.stringify(bad));
});
