// График работы: шаблоны и циклы, план дня, норма часов, сетка месяца, отдых между сменами, таймер. Чистая логика (schedule.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { toMin, fmtTime, normTime, spanMin, netMin, fmtDur, nightMinutes, hhmm, isYm, daysIn, dowMon, dateLong, dayMonthText, shiftYm, normalizeCfg, checkCfg, makeWorkcfg, cfgOf, cfgFromTemplate, TEMPLATES,
  templateById, patternText, cycleLetters, dayPlan, monthDays, monthGrid, normMinutes, monthSummary, restWarnings, nextOffDays, makeWorkday, isNoop, workdaysOf, runningTimer, timerStart, timerStop, workLine, wdId } from '../schedule.js';

const cfgOfTpl = (tid, start = '2026-11-01', extra = {}) => normalizeCfg({ ...cfgFromTemplate(tid, start), ...extra });
const ov = (...list) => new Map(list.map(p => [p.date, p]));
const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();

test('время: разбор, форматирование, переход через полночь, сутки', () => {
  assert.equal(toMin('09:30'), 570); assert.equal(toMin('9:05'), 545); assert.equal(toMin('24:00'), null); assert.equal(toMin('12:60'), null); assert.equal(toMin('abc'), null); assert.equal(toMin(null), null);
  assert.equal(fmtTime(570), '09:30'); assert.equal(normTime('9:05'), '09:05'); assert.equal(normTime('x'), null);
  assert.equal(spanMin('09:00', '18:00'), 540); assert.equal(spanMin('22:00', '06:00'), 480); assert.equal(spanMin('08:00', '08:00'), 1440, 'одинаковое время — сутки'); assert.equal(spanMin('x', '08:00'), 0);
  assert.equal(netMin('09:00', '18:00', 60), 480); assert.equal(netMin('09:00', '09:30', 60), 0, 'перерыв не делает минуты отрицательными');
  assert.equal(fmtDur(0), '0 мин'); assert.equal(fmtDur(45), '45 мин'); assert.equal(fmtDur(120), '2 ч'); assert.equal(fmtDur(150), '2 ч 30 мин'); assert.equal(fmtDur(-5), '0 мин');
  assert.equal(hhmm(at(2026, 11, 16, 9, 3)), '09:03');
});
test('ночные минуты: окно 22:00–06:00 и своё окно', () => {
  assert.equal(nightMinutes('22:00', '06:00'), 480); assert.equal(nightMinutes('20:00', '08:00'), 480); assert.equal(nightMinutes('09:00', '18:00'), 0);
  assert.equal(nightMinutes('21:30', '23:00'), 60); assert.equal(nightMinutes('05:00', '07:00'), 60); assert.equal(nightMinutes('08:00', '08:00'), 480, 'сутки: ночь входит один раз');
  assert.equal(nightMinutes('10:00', '12:00', ['10:30', '11:00']), 30);
});
test('даты: месяцы, високосный год, дни недели, подписи', () => {
  assert.equal(daysIn('2024-02'), 29); assert.equal(daysIn('2026-02'), 28); assert.equal(daysIn('2026-11'), 30); assert.equal(daysIn('2026-12'), 31);
  assert.equal(dowMon('2026-11-16'), 0, 'понедельник'); assert.equal(dowMon('2026-11-22'), 6, 'воскресенье'); assert.equal(dowMon('2024-02-29'), 3, '29 февраля 2024 — четверг');
  assert.equal(isYm('2026-11'), true); assert.equal(isYm('2026-13'), false); assert.equal(isYm('2026-1'), false);
  assert.equal(dateLong('2026-11-18'), 'среда, 18 ноября 2026'); assert.equal(dayMonthText('2026-01-05'), '5 января');
  assert.equal(shiftYm('2026-12', 1), '2027-01'); assert.equal(shiftYm('2026-01', -1), '2025-12');
});

test('шаблоны: у каждого есть смены, рисунок и уникальный код; смены в цикле существуют', () => {
  assert.ok(TEMPLATES.length >= 7); assert.equal(new Set(TEMPLATES.map(t => t.tid)).size, TEMPLATES.length);
  for (const t of TEMPLATES) {
    assert.ok(t.title && t.about && t.shifts.length, t.tid);
    const cfg = cfgOfTpl(t.tid); const keys = new Set(cfg.shifts.map(s => s.key)); assert.equal(cfg.shifts.length, t.shifts.length, t.tid);
    const steps = cfg.pattern.kind === 'cycle' ? cfg.pattern.cycle : cfg.pattern.week; assert.ok(steps.some(Boolean), `${t.tid}: есть рабочие шаги`); for (const k of steps) assert.ok(!k || keys.has(k));
    assert.doesNotThrow(() => checkCfg({ ...cfg }), t.tid);
  }
  assert.equal(templateById('нет'), null); assert.equal(templateById('c13').title, 'Сутки через трое');
});
test('5/2: рабочие дни, выходные, норма месяца (в том числе февраль и високосный год)', () => {
  const c = cfgOfTpl('w52');
  const mon = dayPlan('2026-11-16', c), sat = dayPlan('2026-11-14', c);
  assert.deepEqual([mon.kind, mon.key, mon.from, mon.to, mon.plannedMin, mon.letter], ['work', 'd', '09:00', '18:00', 480, 'Д']);
  assert.deepEqual([sat.kind, sat.plannedMin, sat.letter], ['off', 0, 'вых']);
  assert.equal(normMinutes('2026-11', c) / 60, 168); assert.equal(normMinutes('2026-12', c) / 60, 184); assert.equal(normMinutes('2026-02', c) / 60, 160); assert.equal(normMinutes('2024-02', c) / 60, 168);
  assert.equal(monthDays('2024-02', c).length, 29); assert.equal(monthDays('2024-02', c).at(-1).date, '2024-02-29');
  assert.equal(patternText(c), '5 через 2 (Пн–Пт)'); assert.deepEqual(cycleLetters(c), ['Д', 'Д', 'Д', 'Д', 'Д', 'В', 'В']);
});
test('норма: праздники уменьшают, вручную и «для месяца» заменяют', () => {
  const c = cfgOfTpl('w52', '2026-11-01', { extraOff: ['2026-11-04', '2026-11-04', 'плохая дата', '2026-11-04'] });
  assert.deepEqual(c.extraOff, ['2026-11-04']); assert.equal(dayPlan('2026-11-04', c).kind, 'off'); assert.equal(dayPlan('2026-11-04', c).holiday, true);
  assert.equal(normMinutes('2026-11', c) / 60, 160);
  const m = normalizeCfg({ ...c, normMode: 'manual', normHours: 165.5 }); assert.equal(normMinutes('2026-11', m), 9930); assert.equal(normMinutes('2026-12', m), 9930);
  const by = normalizeCfg({ ...m, normByMonth: { '2026-11': 150, 'плохо': 3, '2026-12': -1, '2027-01': 999 } }); assert.deepEqual(by.normByMonth, { '2026-11': 150 }); assert.equal(normMinutes('2026-11', by), 9000);
  assert.equal(normalizeCfg({ ...c, normMode: 'manual', normHours: -3 }).normMode, 'auto', 'отрицательная норма отбрасывается');
});
test('циклы: 2/2 до и после даты начала, граница года, сутки через трое, день-ночь-отсыпной', () => {
  const c = cfgOfTpl('c22', '2026-11-10');
  assert.deepEqual(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'].map(d => dayPlan(d, c).kind), ['work', 'work', 'off', 'off', 'work', 'work']);
  assert.deepEqual(['2026-11-09', '2026-11-08', '2026-11-07', '2026-11-06'].map(d => dayPlan(d, c).kind), ['off', 'off', 'work', 'work'], 'до начала цикл продолжается назад');
  assert.deepEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'].map(d => dayPlan(d, c).kind), ['off', 'off', 'work', 'work'].map((k, i) => dayPlan(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'][i], c).kind));
  assert.equal(dayPlan('2026-11-10', c).plannedMin, 660, '12 часов с перерывом час');
  const s = cfgOfTpl('c13', '2026-11-01'); const w = monthDays('2026-11', s).filter(d => d.kind === 'work');
  assert.deepEqual(w.map(d => +d.date.slice(8)), [1, 5, 9, 13, 17, 21, 25, 29]); assert.equal(w[0].plannedMin, 1440); assert.equal(w[0].letter, 'С'); assert.equal(normMinutes('2026-11', s), 8 * 1440);
  const n = cfgOfTpl('cdn', '2026-11-10');
  assert.deepEqual([10, 11, 12, 13, 14].map(d => dayPlan(`2026-11-${d}`, n)).map(p => [p.kind, p.label, p.letter]), [['work', 'День', 'Д'], ['work', 'Ночь', 'Н'], ['off', 'Отсыпной', 'О'], ['off', 'Выходной', 'вых'], ['work', 'День', 'Д']]);
  assert.equal(dayPlan('2026-11-11', n).night, true); assert.equal(dayPlan('2026-11-12', n).plannedMin, 0);
});
test('правка дня: отпуск, больничный, смена выходного, работа в выходной, свои часы', () => {
  const c = cfgOfTpl('w52');
  const v = dayPlan('2026-11-16', c, { date: '2026-11-16', kind: 'vacation' });
  assert.deepEqual([v.kind, v.plannedMin, v.patternMin, v.letter, v.overridden], ['vacation', 0, 480, 'отп', true], 'по графику был рабочий день: минуты для расчёта сохраняются');
  assert.equal(dayPlan('2026-11-16', c, { date: 'x', kind: 'sick' }).letter, 'бол'); assert.equal(dayPlan('2026-11-16', c, { date: 'x', kind: 'unpaid' }).letter, 'б/с');
  const swap = dayPlan('2026-11-14', c, { date: '2026-11-14', kind: 'work', shift: 'd' }); assert.deepEqual([swap.kind, swap.plannedMin, swap.patternMin], ['work', 480, 0], 'суббота стала рабочей');
  const bare = dayPlan('2026-11-14', c, { date: '2026-11-14', kind: 'work' }); assert.deepEqual([bare.kind, bare.plannedMin, bare.letter], ['work', 0, 'раб']);
  const own = dayPlan('2026-11-16', c, { date: 'x', kind: 'work', shift: 'd', planned: { from: '10:00', to: '16:00' }, breakMin: 30 }); assert.deepEqual([own.from, own.to, own.breakMin, own.plannedMin], ['10:00', '16:00', 30, 330]);
  assert.equal(dayPlan('2026-11-16', c, { date: 'x', kind: 'off' }).plannedMin, 0);
  assert.equal(dayPlan('2026-11-16', c, { date: 'x', kind: 'странный' }).kind, 'work', 'неизвестный тип правки игнорируется');
  const done = dayPlan('2026-11-16', c, { date: 'x', kind: 'work', shift: 'd', actual: { from: '09:03', to: '18:40' } }); assert.deepEqual([done.actualMin, done.running, done.actual.to], [517, false, '18:40']);
  const run = dayPlan('2026-11-16', c, { date: 'x', kind: 'work', shift: 'd', actual: { from: '09:03', to: null } }); assert.deepEqual([run.actualMin, run.running], [null, true]);
  const night = dayPlan('2026-11-11', cfgOfTpl('cdn', '2026-11-10'), { date: 'x', kind: 'work', shift: 'n', actual: { from: '20:00', to: '08:05' } }); assert.equal(night.actualMin, 12 * 60 + 5 - 60, 'ночная смена через полночь');
  const offWork = dayPlan('2026-11-14', c, { date: 'x', kind: 'off', actual: { from: '10:00', to: '12:00' } }); assert.deepEqual([offWork.actualMin, offWork.plannedMin], [120, 0]);
  assert.equal(dayPlan('2026-11-16', c, { date: 'x', kind: 'sick', actual: { from: '10:00', to: '12:00' } }).actual, null, 'у больничного часов не бывает');
});
test('сетка месяца: недели с понедельника, пустые клетки, число недель', () => {
  const c = cfgOfTpl('w52');
  const g = monthGrid('2026-11', c); assert.equal(g.length, 6); assert.ok(g.every(w => w.length === 7));
  assert.deepEqual(g[0].map(x => x?.date.slice(8) ?? null), [null, null, null, null, null, null, '01']); assert.equal(g[5][0].date, '2026-11-30'); assert.equal(g[5].filter(Boolean).length, 1);
  assert.equal(monthGrid('2027-02', c).length, 4, 'февраль 2027 ровно четыре недели'); assert.equal(monthGrid('2024-02', c).flat().filter(Boolean).length, 29);
});
test('сводка месяца: рабочие дни, остаток, факт, виды выходных', () => {
  const c = cfgOfTpl('w52');
  const o = ov({ date: '2026-11-17', kind: 'work', shift: 'd', actual: { from: '09:00', to: '18:30' } }, { date: '2026-11-18', kind: 'vacation' }, { date: '2026-11-19', kind: 'sick' }, { date: '2026-11-20', kind: 'unpaid' });
  const s = monthSummary('2026-11', c, o, '2026-11-17');
  assert.deepEqual([s.workdays, s.vacation, s.sick, s.unpaid, s.recorded, s.actualMin, s.normMin / 60], [18, 1, 1, 1, 1, 510, 168]);
  assert.equal(s.plannedMin, 18 * 480); assert.equal(s.patternMin, 21 * 480);
  assert.equal(s.left, 6, '17-го уже отмечено, 18–20 в отпуске и больничном; осталось 23–27 и 30-е');
  assert.equal(monthSummary('2026-11', c, o, '2026-11-23').left, 6, 'сегодня рабочий день без отметки — тоже «осталось»'); assert.equal(monthSummary('2026-11', c, o, '2026-11-30').left, 1); assert.equal(monthSummary('2026-12', c, o, '2026-11-30').left, 23);
});
test('отдых: дни подряд сверх предела и короткий промежуток между сменами', () => {
  const c = cfgOfTpl('w52', '2026-11-01', { maxStreak: 4 });
  const st = restWarnings('2026-11-02', '2026-11-08', c); assert.deepEqual(st.map(w => [w.kind, w.date, w.n]), [['streak', '2026-11-02', 5]]); assert.match(st[0].text, /Подряд рабочих дней: 5 \(с 2 ноября по 6 ноября\).*предела: 4/);
  assert.deepEqual(restWarnings('2026-11-02', '2026-11-08', normalizeCfg({ ...c, maxStreak: 5 })), [], 'ровно предел — предупреждения нет');
  const c2 = cfgOfTpl('c22', '2026-11-10');
  const o = ov({ date: '2026-11-10', kind: 'work', shift: 'd', planned: { from: '14:00', to: '23:00' } }, { date: '2026-11-11', kind: 'work', shift: 'd', planned: { from: '06:00', to: '14:00' } });
  const r = restWarnings('2026-11-10', '2026-11-11', c2, o); assert.equal(r.length, 1); assert.equal(r[0].kind, 'rest'); assert.equal(r[0].minutes, 420); assert.match(r[0].text, /отдых всего 7 ч: меньше 11 ч/);
  assert.deepEqual(restWarnings('2026-11-10', '2026-11-11', normalizeCfg({ ...c2, minRestH: 0 }), o), [], 'предел 0 выключает проверку');
  const act = ov({ date: '2026-11-10', kind: 'work', shift: 'd', actual: { from: '08:00', to: '22:30' } }, { date: '2026-11-11', kind: 'work', shift: 'd', actual: { from: '08:00', to: '17:00' } });
  assert.equal(restWarnings('2026-11-10', '2026-11-11', c2, act).length, 1, 'по факту отдыха 9,5 ч');
  const night = cfgOfTpl('cdn', '2026-11-10'); assert.deepEqual(restWarnings('2026-11-10', '2026-11-30', night), [], 'день-ночь-отсыпной: отдыха хватает');
  assert.deepEqual(restWarnings('2026-11-10', '2026-11-11', c2, ov({ date: '2026-11-10', kind: 'work', shift: 'd', planned: { from: '08:00', to: '20:00' } }, { date: '2026-11-11', kind: 'work', shift: 'd', planned: { from: '19:00', to: '23:00' } })), [], 'отдыха 23 часа — хватает');
  assert.equal(restWarnings('2026-11-10', '2026-11-11', c2, ov({ date: '2026-11-10', kind: 'work', shift: 'd', planned: { from: '08:00', to: '20:00' } }, { date: '2026-11-11', kind: 'work', shift: 'd', planned: { from: '06:00', to: '10:00' } }))[0].minutes, 600, 'отдых 10 часов');
});
test('ближайшие выходные: считает отпуск, пропускает рабочие', () => {
  const c = cfgOfTpl('w52');
  assert.deepEqual(nextOffDays('2026-11-16', c, new Map(), 3).map(d => d.date), ['2026-11-21', '2026-11-22', '2026-11-28']);
  assert.deepEqual(nextOffDays('2026-11-16', c, ov({ date: '2026-11-17', kind: 'vacation' }), 2).map(d => d.date), ['2026-11-17', '2026-11-21']);
  assert.equal(nextOffDays('2026-11-21', c, new Map(), 1)[0].date, '2026-11-21', 'сегодня выходной — это он и есть');
});

test('настройки: приведение чужих данных, проверка ввода, запись и чтение', () => {
  const junk = normalizeCfg(null); assert.deepEqual([junk.shifts, junk.pattern.kind, junk.maxStreak, junk.minRestH, junk.normMode], [[], 'week', 6, 11, 'auto']);
  assert.equal(normalizeCfg({ shifts: [{ key: 'A b!', name: '  Смена  ', from: '8:00', to: '17:00', breakMin: 9999 }] }).shifts[0].breakMin, 540, 'перерыв не длиннее смены');
  assert.equal(normalizeCfg({ shifts: [{ key: 'a', name: 'x', from: '25:00', to: '17:00' }] }).shifts.length, 0, 'неверное время — смена отброшена');
  assert.equal(normalizeCfg({ shifts: Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, name: 'n', from: '08:00', to: '09:00' })) }).shifts.length, 12);
  assert.equal(normalizeCfg({ shifts: [{ key: 'a', name: 'A', from: '08:00', to: '09:00' }, { key: 'a', name: 'B', from: '08:00', to: '09:00' }] }).shifts.length, 1, 'повторяющийся код смены');
  assert.equal(normalizeCfg({ maxStreak: 99, minRestH: -4 }).maxStreak, 6); assert.equal(normalizeCfg({ maxStreak: 3, minRestH: 12 }).minRestH, 12);
  const good = cfgFromTemplate('w52', '2026-11-01');
  assert.throws(() => checkCfg(null), /Нет настроек/); assert.throws(() => checkCfg({ ...good, shifts: [] }), /хотя бы одна смена/);
  assert.throws(() => checkCfg({ ...good, shifts: [{ key: 'd', name: '', from: '09:00', to: '18:00' }] }), /Назови/);
  assert.throws(() => checkCfg({ ...good, shifts: [{ key: 'd', name: 'Д', from: '9', to: '18:00' }] }), /время указано неверно/);
  assert.throws(() => checkCfg({ ...good, shifts: [{ key: 'd', name: 'Д', from: '09:00', to: '10:00', breakMin: 90 }] }), /перерыв длиннее/);
  assert.throws(() => checkCfg({ ...good, pattern: { kind: 'cycle', cycle: [], start: '2026-11-01' } }), /хотя бы один день/); assert.throws(() => checkCfg({ ...good, pattern: { kind: 'cycle', cycle: ['d'], start: '2026-02-31' } }), /Дата первого дня/);
  assert.throws(() => checkCfg({ ...good, pattern: { kind: 'zzz' } }), /рисунок графика/);
  const ev = makeWorkcfg(good, null, 1000); assert.deepEqual([ev.id, ev.type, ev.ts, ev.source], ['workcfg', 'workcfg', 1000, 'manual']); assert.equal(ev.payload.editedAt, undefined);
  const ev2 = makeWorkcfg({ ...good, maxStreak: 5 }, ev, 5000); assert.deepEqual([ev2.ts, ev2.payload.editedAt, ev2.payload.maxStreak], [1000, 5000, 5]);
  assert.equal(cfgOf([ev2]).maxStreak, 5); assert.equal(cfgOf([]), null);
});
test('запись дня: проверка ввода, замена той же записи, пустые правки', () => {
  const ok = { date: '2026-11-16', kind: 'work', shift: 'd', actual: { from: '9:03', to: '18:40' }, breakMin: '45', note: '  ок  ' };
  const e = makeWorkday(ok, null, 1); assert.deepEqual([e.id, e.type, e.payload.actual, e.payload.breakMin, e.payload.note], ['wd:2026-11-16', 'workday', { from: '09:03', to: '18:40' }, 45, 'ок']); assert.equal(wdId('2026-11-16'), e.id);
  const e2 = makeWorkday({ ...ok, note: 'позже' }, e, 9); assert.deepEqual([e2.id, e2.ts, e2.payload.editedAt], [e.id, 1, 9]);
  assert.throws(() => makeWorkday({ ...ok, date: '2026-02-30' }), /Дата/); assert.throws(() => makeWorkday({ ...ok, kind: 'x' }), /тип дня/);
  assert.throws(() => makeWorkday({ ...ok, actual: { from: '25:00', to: '18:00' } }), /время указано неверно/); assert.throws(() => makeWorkday({ ...ok, actual: { from: '09:00', to: '09:00' } }), /совпадают/);
  assert.throws(() => makeWorkday({ ...ok, breakMin: -1 }), /Перерыв/); assert.throws(() => makeWorkday({ ...ok, breakMin: 601 }), /Перерыв/);
  assert.throws(() => makeWorkday({ ...ok, planned: { from: '09:00', to: '' } }), /План/);
  assert.equal(makeWorkday({ ...ok, kind: 'vacation' }).payload.actual, null, 'у отпуска часов нет'); assert.equal(makeWorkday({ ...ok, note: 'я'.repeat(500) }).payload.note.length, 200);
  const c = cfgOfTpl('w52'); assert.equal(isNoop({ date: '2026-11-16', kind: 'work', shift: 'd', planned: null, actual: null, breakMin: null, note: '' }, c), true);
  assert.equal(isNoop({ date: '2026-11-16', kind: 'vacation', planned: null, actual: null, breakMin: null, note: '' }, c), false); assert.equal(isNoop({ ...e.payload }, c), false);
  assert.equal(workdaysOf([e, { type: 'task', payload: {} }, e2]).get('2026-11-16').note, 'позже');
});
test('таймер: старт, остановка, случайное нажатие, забытый таймер, ночь через полночь', () => {
  const c = cfgOfTpl('w52'); let evs = [];
  const s = timerStart(evs, '2026-11-16', c, at(2026, 11, 16, 9, 3)); assert.deepEqual([s.payload.kind, s.payload.shift, s.payload.actual.from, s.payload.actual.to], ['work', 'd', '09:03', null]); evs = [s];
  assert.equal(runningTimer(evs).id, s.id); assert.throws(() => timerStart(evs, '2026-11-17', c, at(2026, 11, 16, 9, 5)), /уже идёт/);
  const run = dayPlan('2026-11-16', c, s.payload); assert.equal(run.running, true);
  const stop = timerStop(s, at(2026, 11, 16, 18, 40)); assert.deepEqual([stop.minutes, stop.discarded, stop.event.payload.actual], [577, false, { from: '09:03', to: '18:40' }]);
  assert.equal(dayPlan('2026-11-16', c, stop.event.payload).actualMin, 517); assert.equal(runningTimer([stop.event]), null);
  assert.throws(() => timerStart([stop.event], '2026-11-16', c, at(2026, 11, 16, 19)), /уже записано/); assert.throws(() => timerStop(stop.event), /не идёт/);
  const quick = timerStop(s, at(2026, 11, 16, 9, 3) + 30000); assert.deepEqual([quick.discarded, quick.minutes, quick.event.payload.actual], [true, 0, null], 'меньше минуты — не записываем');
  assert.throws(() => timerStop(s, at(2026, 11, 17, 9, 4)), /больше суток/);
  const n = cfgOfTpl('cdn', '2026-11-10'), ns = timerStart([], '2026-11-11', n, at(2026, 11, 11, 20, 0)); assert.equal(ns.payload.shift, 'n');
  const ne = timerStop(ns, at(2026, 11, 12, 8, 5)); assert.deepEqual([ne.minutes, ne.event.payload.actual], [725, { from: '20:00', to: '08:05' }]); assert.equal(dayPlan('2026-11-11', n, ne.event.payload).actualMin, 665);
  const off = timerStart([], '2026-11-14', c, at(2026, 11, 14, 10, 0)); assert.equal(off.payload.kind, 'off', 'в выходной таймер запускается как «работа в выходной»');
  const vac = timerStart([makeWorkday({ date: '2026-11-16', kind: 'vacation' })], '2026-11-16', c, at(2026, 11, 16, 10, 0)); assert.equal(vac.payload.kind, 'work', 'работа во время отпуска');
});
test('«Сегодня»: строка про смену', () => {
  const cfgEv = makeWorkcfg(cfgFromTemplate('w52', '2026-11-01'));
  assert.equal(workLine([cfgEv], '2026-11-16'), 'Сегодня смена «День» 09:00–18:00'); assert.equal(workLine([cfgEv], '2026-11-14'), 'Сегодня выходной');
  assert.equal(workLine([], '2026-11-16'), null);
  assert.equal(workLine([cfgEv, makeWorkday({ date: '2026-11-16', kind: 'vacation' })], '2026-11-16'), 'Сегодня отпуск');
  assert.match(workLine([cfgEv, makeWorkday({ date: '2026-11-16', kind: 'work', shift: 'd', actual: { from: '09:03', to: null } })], '2026-11-16'), /Таймер идёт с 09:03/);
  const dn = makeWorkcfg(cfgFromTemplate('cdn', '2026-11-10')); assert.equal(workLine([dn], '2026-11-12'), 'Сегодня отсыпной');
});
