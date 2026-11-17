// Производственный календарь и график «5 через 2» по умолчанию: разбор ответа, праздники, сокращённые и рабочие по переносу дни, загрузка и кэш,
// автоматический график, «отработано» по плану. Всё детерминировано: календарь собирается из строки цифр, сеть и хранилище подставные.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYear, setCalendar, getCalendar, clearCalendars, calendarYears, withCalendar, hasYear, loadCalendars, ensureCalendar, calUrl, daysInYear, hydrate } from '../calendar-ru.js';
import { cfgFromTemplate, normalizeCfg, makeWorkcfg, cfgOf, dayPlan, normMinutes, monthSummary, autoWorkcfg, isAutoCfg, workdaysOf, makeWorkday } from '../schedule.js';

// Календарь 2026 для теста: будни 0, суббота и воскресенье 1; особые дни ниже.
function yearCodes(year, special = {}) {
  const out = [];
  for (let i = 0; i < daysInYear(year); i++) {
    const d = new Date(Date.UTC(year, 0, 1 + i)), dow = d.getUTCDay();
    const key = `${year}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    out.push(special[key] ?? (dow === 0 || dow === 6 ? '1' : '0'));
  }
  return out.join('');
}
const SPECIAL = { '2026-11-04': '1', '2026-11-03': '2', '2026-11-14': '0' };     // среда: праздник; вторник: сокращённый; суббота: рабочая по переносу
const C26 = yearCodes(2026, SPECIAL);
const w52 = () => normalizeCfg(cfgFromTemplate('w52', '2026-11-02'));
const fresh = () => { clearCalendars(); setCalendar(2026, C26); };

test('разбор ответа API: только цифры 0, 1, 2, 4 и ровно по одной на день года', () => {
  assert.equal(parseYear(C26, 2026), C26);
  assert.equal(parseYear(`${C26}\n`, 2026), C26, 'пробелы по краям не мешают');
  assert.equal(parseYear('101', 2026), null, 'код ошибки сервиса');
  assert.equal(parseYear('100', 2026), null);
  assert.equal(parseYear(C26.slice(1), 2026), null, 'не хватает дня');
  assert.equal(parseYear(C26 + '0', 2026), null, 'лишний день');
  assert.equal(parseYear(C26.replace('0', '3'), 2026), null, 'неизвестный код');
  assert.equal(parseYear('<html>', 2026), null);
  assert.equal(parseYear(null, 2026), null);
  assert.equal(parseYear(yearCodes(2028), 2028)?.length, 366, 'високосный год');
  assert.equal(calUrl(2026), 'https://isdayoff.ru/api/getdata?year=2026&pre=1');
});

test('календарь не принимает неверный год и мусор', () => {
  clearCalendars();
  assert.equal(setCalendar(2026, 'abc'), false);
  assert.equal(setCalendar(1999, yearCodes(2026)), false);
  assert.equal(setCalendar(2026, C26), true);
  assert.deepEqual(calendarYears(), [2026]);
  assert.equal(hasYear(2026), true);
  assert.equal(hasYear(2027), false);
});

test('график по дням недели получает праздники, сокращённые дни и рабочую субботу', () => {
  fresh();
  const c = withCalendar(w52());
  assert.ok(c.autoOff.includes('2026-11-04'), 'праздник нерабочий');
  assert.ok(c.shortDays.includes('2026-11-03'));
  assert.ok(c.autoOn.includes('2026-11-14'), 'рабочая суббота по переносу');
  assert.ok(!c.autoOn.includes('2026-11-15'), 'воскресенье остаётся выходным');
  const hol = dayPlan('2026-11-04', c), shortDay = dayPlan('2026-11-03', c), sat = dayPlan('2026-11-14', c), usual = dayPlan('2026-11-02', c), sun = dayPlan('2026-11-15', c);
  assert.equal(hol.kind, 'off'); assert.equal(hol.holiday, true); assert.equal(hol.plannedMin, 0);
  assert.equal(shortDay.kind, 'work'); assert.equal(shortDay.plannedMin, 420, 'сокращённый день на час короче'); assert.equal(shortDay.to, '17:00'); assert.equal(shortDay.patternMin, 420);
  assert.equal(sat.kind, 'work'); assert.equal(sat.plannedMin, 480); assert.equal(sat.from, '09:00');
  assert.equal(usual.plannedMin, 480);
  assert.equal(sun.kind, 'off');
  // норма ноября: 21 будний день минус праздник плюс рабочая суббота = 21 рабочий день, минус час за сокращённый
  assert.equal(normMinutes('2026-11', c), 21 * 480 - 60);
  // без календаря норма считается по дням недели
  assert.equal(normMinutes('2026-11', w52()), 21 * 480);
});

test('календарь не затрагивает сменные циклы и выключается настройкой', () => {
  fresh();
  const cyc = normalizeCfg(cfgFromTemplate('c22', '2026-11-01'));
  assert.equal(withCalendar(cyc), cyc, 'у цикла праздники рабочие: ничего не добавляется');
  const off = { ...w52(), calRu: false };
  assert.equal(withCalendar(off).autoOff, undefined);
  assert.equal(dayPlan('2026-11-04', withCalendar(off)).kind, 'work', 'с выключенным календарём среда рабочая');
  clearCalendars();
  assert.equal(withCalendar(w52()).autoOff, undefined, 'календаря нет: график как по дням недели');
});

test('рабочая суббота только для пятидневки; у графика с рабочей субботой праздник тоже выходной', () => {
  fresh();
  const wcu = normalizeCfg({ ...cfgFromTemplate('wcu', '2026-11-02') });            // пн, ср, пт
  const c = withCalendar(wcu);
  assert.deepEqual(c.autoOn, [], 'перенос рабочей субботы нерелевантен графику не из пяти дней');
  assert.equal(dayPlan('2026-11-04', c).kind, 'off', 'праздничная среда выходная и у графика пн-ср-пт');
});

test('подсказки календаря не попадают в сохранённые записи', () => {
  fresh();
  const merged = withCalendar(w52());
  const ev = makeWorkcfg(merged);
  assert.equal(ev.payload.autoOff, undefined); assert.equal(ev.payload.autoOn, undefined); assert.equal(ev.payload.shortDays, undefined);
  assert.equal(ev.payload.calRu, true);
  assert.ok(JSON.stringify(ev.payload).length < 3000, 'запись графика не раздувается');
  const back = cfgOf([ev]);
  assert.ok(back.autoOff.includes('2026-11-04'), 'при чтении календарь подставляется снова');
});

test('график по умолчанию: «5 через 2», источник auto; сохранение настроек делает его обычным', () => {
  clearCalendars();
  const ev = autoWorkcfg('2026-11-16', 1000);
  assert.equal(ev.type, 'workcfg'); assert.equal(ev.source, 'auto'); assert.equal(ev.id, 'workcfg');
  assert.equal(ev.payload.tplId, 'w52');
  assert.deepEqual(ev.payload.pattern.week, ['d', 'd', 'd', 'd', 'd', '', '']);
  assert.equal(ev.payload.shifts[0].from, '09:00'); assert.equal(ev.payload.shifts[0].to, '18:00'); assert.equal(ev.payload.shifts[0].breakMin, 60);
  assert.equal(isAutoCfg([ev]), true);
  const saved = makeWorkcfg(cfgOf([ev]), ev);
  assert.equal(saved.source, 'manual');
  assert.equal(isAutoCfg([saved]), false);
  assert.equal(isAutoCfg([]), false);
});

test('«Отработано»: прошедшие рабочие дни считаются по плану, правки учитываются', () => {
  clearCalendars();
  const cfg = withCalendar(w52());
  const ev = [];
  // 16 ноября 2026 — понедельник; сегодня 18-е: прошли пн (16) и вт (17)
  const today = '2026-11-18', ym = '2026-11';
  let s = monthSummary(ym, cfg, workdaysOf(ev), today);
  // прошедшие рабочие дни ноября до 18-го: 2-6, 9-13, 16-17 = 12 дней
  assert.equal(s.assumed, 12); assert.equal(s.workedMin, 12 * 480); assert.equal(s.recorded, 0); assert.equal(s.corrected, 0);
  // человек поправил один день: ушёл позже на 47 минут; другой день — отпуск
  const w1 = makeWorkday({ date: '2026-11-10', kind: 'work', shift: 'd', actual: { from: '09:00', to: '18:47' } });
  const w2 = makeWorkday({ date: '2026-11-11', kind: 'vacation' });
  s = monthSummary(ym, cfg, workdaysOf([w1, w2]), today);
  assert.equal(s.assumed, 10, 'два дня больше не «по плану»');
  assert.equal(s.workedMin, 10 * 480 + (8 * 60 + 47), 'десять дней по плану и один с поправкой');
  assert.equal(s.recorded, 1); assert.equal(s.corrected, 1);
  // сегодняшний день по плану не засчитывается, пока не отмечен
  assert.equal(monthSummary(ym, cfg, new Map(), '2026-11-16').assumed, 10);
});

// ---------- загрузка и кэш ----------
function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { get length() { return m.size; }, key: i => [...m.keys()][i] ?? null, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, _m: m };
}
const okFetch = (map, log = []) => async url => { log.push(url); const y = Number(/year=(\d+)/.exec(url)[1]); return map[y] ? { ok: true, text: async () => map[y] } : { ok: true, text: async () => '101' }; };

test('загрузка: успешный ответ ставится в календарь и в кэш; год без данных не ломает остальное', async () => {
  clearCalendars(true);
  const st = fakeStorage(), log = [];
  const r = await loadCalendars([2030, 2031], { fetchImpl: okFetch({ 2030: yearCodes(2030) }, log), storage: st, now: 1_000_000 });
  assert.deepEqual(r.ok, [2030]); assert.deepEqual(r.failed, [2031]);
  assert.equal(log.length, 2);
  assert.ok(hasYear(2030) && !hasYear(2031));
  assert.deepEqual(JSON.parse(st.getItem('lifeos-cal-ru-2030')), { codes: yearCodes(2030), at: 1_000_000 });
  assert.equal(st.getItem('lifeos-cal-ru-2031'), null, 'неверный ответ в кэш не попадает');
});

test('загрузка: свежий кэш не запрашивается заново, старый обновляется, при сбое остаётся старый', async () => {
  const day = 86400000;
  clearCalendars(true);
  const st = fakeStorage({ 'lifeos-cal-ru-2026': JSON.stringify({ codes: C26, at: 5 * day }) });
  const log = [];
  let r = await loadCalendars([2026], { fetchImpl: okFetch({ 2026: yearCodes(2026) }, log), storage: st, now: 10 * day });
  assert.deepEqual(r.ok, [2026]); assert.equal(log.length, 0, 'кэш моложе месяца: сети нет');
  assert.ok(withCalendar(w52()).autoOff.includes('2026-11-04'), 'использован кэш');
  // кэш старше месяца: обновляем
  r = await loadCalendars([2026], { fetchImpl: okFetch({ 2026: yearCodes(2026) }, log), storage: st, now: 50 * day });
  assert.equal(log.length, 1);
  assert.ok(!withCalendar(w52()).autoOff?.includes('2026-11-04'), 'новый календарь без праздника 4 ноября');
  // сеть недоступна: остаётся прежний
  const bad = async () => { throw new Error('offline'); };
  r = await loadCalendars([2026], { fetchImpl: bad, storage: st, now: 100 * day });
  assert.deepEqual(r.ok, [2026]); assert.deepEqual(r.failed, []);
});

test('загрузка: подсаживается кэш с устройства, нет сети и нет кэша — год в failed, исключений нет', async () => {
  clearCalendars(true);
  const st = fakeStorage({ 'lifeos-cal-ru-2026': JSON.stringify({ codes: C26, at: 1 }), 'lifeos-cal-ru-2031': '{сломано', 'lifeos-other': 'x' });
  hydrate(st);
  assert.equal(getCalendar(2026), C26, 'кэш на устройстве важнее зашитого календаря');
  assert.ok(!calendarYears().includes(2031), 'битая запись и чужой ключ пропущены');
  clearCalendars();
  const r = await loadCalendars([2030], { fetchImpl: async () => ({ ok: false, text: async () => 'x' }), storage: fakeStorage() });
  assert.deepEqual(r.failed, [2030]);
  const none = await loadCalendars([2030], { fetchImpl: undefined, storage: fakeStorage() });
  assert.deepEqual(none.failed, [2030], 'нет fetch: тихо без календаря');
  // а у года с зашитым календарём (2026, 2027) без сети календарь всё равно есть
  clearCalendars(true);
  const offline = await loadCalendars([2026, 2027], { fetchImpl: undefined, storage: fakeStorage() });
  assert.deepEqual(offline.ok, [2026, 2027]); assert.deepEqual(offline.failed, []);
});

test('ensureCalendar: только для графика по дням недели с включённым календарём и не чаще раза в десять минут', async () => {
  clearCalendars();
  const log = [], f = okFetch({ 2026: C26 }, log), st = fakeStorage();
  assert.equal(ensureCalendar(null, { fetchImpl: f, storage: st }), null);
  assert.equal(ensureCalendar({ ...w52(), calRu: false }, { fetchImpl: f, storage: st }), null);
  assert.equal(ensureCalendar(normalizeCfg(cfgFromTemplate('c22', '2026-11-01')), { fetchImpl: f, storage: st }), null);
  const T0 = 1_000_000_000, p = ensureCalendar(w52(), { year: 2026, now: T0, fetchImpl: f, storage: st });
  assert.ok(p && typeof p.then === 'function');
  const r = await p;
  assert.deepEqual(r.ok, [2026]); assert.deepEqual(r.failed, [2027]);
  assert.equal(ensureCalendar(w52(), { year: 2026, now: T0 + 2000, fetchImpl: f, storage: st }), null, 'слишком часто');
  assert.ok(ensureCalendar(w52(), { year: 2026, now: T0 + 11 * 60000, fetchImpl: f, storage: st }), 'через десять минут можно');
});

test('зашитые календари 2026 и 2027 настоящие: праздники, сокращённые и рабочие по переносу дни', () => {
  clearCalendars(true);
  hydrate(fakeStorage());
  assert.deepEqual(calendarYears(), [2026, 2027]);
  const c = withCalendar(w52());
  for (const d of ['2026-01-01', '2026-02-23', '2026-03-09', '2026-05-01', '2026-05-11', '2026-06-12', '2026-11-04', '2026-12-31', '2027-02-22', '2027-03-08']) assert.ok(c.autoOff.includes(d), `праздник ${d}`);
  for (const d of ['2026-04-30', '2026-11-03', '2027-06-11']) assert.ok(c.shortDays.includes(d), `сокращённый ${d}`);
  assert.ok(c.autoOn.includes('2027-02-20'), 'рабочая суббота 20 февраля 2027');
  assert.ok(c.shortDays.includes('2027-02-20'), 'и она сокращённая');
  assert.equal(dayPlan('2027-02-20', c).plannedMin, 420, 'рабочая суббота перед праздником на час короче');
  // ноябрь 2026: 21 будний день, минус 4 ноября, минус час за 3 ноября
  assert.equal(normMinutes('2026-11', c), 20 * 480 - 60);
  // у календаря нет данных на 2028: график идёт по дням недели
  assert.equal(dayPlan('2028-05-01', c).kind, 'work');
});
