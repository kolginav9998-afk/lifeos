import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCheckin, makeDiary, checkinId, diaryId, sleepFromTimes, hashtags, checkinOf, diaryOf, dayMood, dayDigest, recentDays, dailyTable, SLOTS } from '../diary.js';
import { makeMeasure, updateMeasure, parseNumber, measuresOf, measureKeys, dailySeries, movingAverage, linearTrend, changeOver, bmi, whtr, bmiNote, whtrNote,
  sleepStats, bpAverage, ageFromBirthYear, healthProfile, checkHealthProfile, measuresToCsv, formatMeasure, measureLabel } from '../health.js';
import { makeProfile } from '../events.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const NOW = at(2026, 11, 10);
const TODAY = '2026-11-10';

test('сон по времени «лёг/встал»: через полночь, ошибки', () => {
  assert.equal(sleepFromTimes('23:30', '07:00'), 7.5);
  assert.equal(sleepFromTimes('01:00', '09:15'), 8.25);
  assert.equal(sleepFromTimes('22:00', '22:00'), 24, 'одинаковое время — сутки (редкий случай, без ошибки)');
  for (const bad of [['25:00', '07:00'], ['23:00', '7'], ['', '07:00'], [null, null]]) assert.equal(sleepFromTimes(...bad), null);
});

test('отметка: валидация оценок и чисел, пустые поля пропускаются, id детерминирован', () => {
  const c = makeCheckin('m', TODAY, { sleepHours: '7,5', sleepQuality: 4, energy: 3, mood: '', stress: undefined }, ' бодро ', NOW);
  assert.equal(c.id, checkinId(TODAY, 'm'));
  assert.deepEqual(c.payload, { date: TODAY, slot: 'm', sleepQuality: 4, energy: 3, sleepHours: 7.5, note: 'бодро' });
  assert.throws(() => makeCheckin('m', TODAY, { mood: 6 }), /от 1 до 5/);
  assert.throws(() => makeCheckin('m', TODAY, { mood: 2.5 }), /от 1 до 5/);
  assert.throws(() => makeCheckin('e', TODAY, { caffeine: -1 }), /от 0 до 20/);
  assert.throws(() => makeCheckin('e', TODAY, { screen: 'много' }), /Экран/);
  assert.throws(() => makeCheckin('e', TODAY, {}), /хотя бы одно/);
  assert.throws(() => makeCheckin('x', TODAY, { mood: 3 }), /bad slot/);
  assert.throws(() => makeCheckin('e', '2026-02-30', { mood: 3 }), /bad date/);
  assert.equal(makeCheckin('m', TODAY, { sleepHours: 7, sleepQuality: 5 }, '', NOW, null).payload.note, undefined);
  const again = makeCheckin('m', TODAY, { sleepHours: 8 }, '', NOW + 1000, c);
  assert.equal(again.id, c.id); assert.equal(again.ts, c.ts, 'время создания сохраняется'); assert.equal(again.payload.editedAt, NOW + 1000);
  assert.ok(!('energy' in again.payload), 'правка заменяет поля целиком');
  assert.ok(SLOTS.e.ratings.includes('focus') && !SLOTS.m.ratings.includes('focus'));
  assert.ok(makeCheckin('e', TODAY, { alcohol: 0, caffeine: 0 }).payload.alcohol === 0, 'ноль — это значение, а не «пусто»');
});

test('дневник: теги, ограничения, пустая запись, правка сохраняет создание', () => {
  assert.deepEqual(hashtags('Был #работа и #Спорт, снова #работа; #a; не#тег #x_y1'), ['работа', 'спорт', 'x_y1']);
  const d = makeDiary(TODAY, { text: ' Хороший день #семья ', highlight: ' итог ', gratitude: ['а', '', 'б', 'в', 'г'] }, NOW);
  assert.equal(d.id, diaryId(TODAY));
  assert.deepEqual(d.payload, { date: TODAY, text: 'Хороший день #семья', highlight: 'итог', gratitude: ['а', 'б', 'в'], tags: ['семья'] });
  assert.throws(() => makeDiary(TODAY, { text: '  ' }), /пуст/);
  assert.throws(() => makeDiary(TODAY, { text: 'x'.repeat(20001) }), /длинная/);
  assert.ok(makeDiary(TODAY, { highlight: 'только главное' }).payload.highlight);
  const e = makeDiary(TODAY, { text: 'правка' }, NOW + 5, d);
  assert.deepEqual([e.ts, e.payload.editedAt], [d.ts, NOW + 5]);
});

test('сводка дня и история', () => {
  const ev = [makeCheckin('m', TODAY, { sleepHours: 7, mood: 4, energy: 3 }, '', NOW), makeCheckin('e', TODAY, { mood: 2, stress: 5 }, '', NOW), makeDiary(TODAY, { text: 'запись' }, NOW),
    makeCheckin('e', '2026-11-08', { mood: 5 }, '', NOW)];
  assert.equal(dayMood(ev, TODAY), 3);
  assert.equal(dayMood(ev, '2026-11-09'), null);
  assert.deepEqual(dayDigest(ev, TODAY), { date: TODAY, mood: 3, sleep: 7, energy: 3, stress: 5, text: 'запись', hasAny: true });
  const r = recentDays(ev, TODAY, 5);
  assert.deepEqual(r.map(x => x.date), ['2026-11-10', '2026-11-09', '2026-11-08', '2026-11-07', '2026-11-06']);
  assert.deepEqual(r.map(x => x.hasAny), [true, false, true, false, false]);
  assert.equal(checkinOf(ev, TODAY, 'm').payload.sleepHours, 7);
  assert.equal(diaryOf(ev, '2026-11-08'), null);
  const t = dailyTable(ev);
  assert.deepEqual(t.map(x => x.date), ['2026-11-08', '2026-11-10']);
  assert.equal(t[1].sleepHours, 7); assert.equal(t[1].moodEvening, 2); assert.equal(t[0].moodEvening, 5);
});

test('измерение: проверки, давление, свой показатель, формат, правка', () => {
  const w = makeMeasure({ kind: 'weight', value: '72,46', date: TODAY, time: '7:05', note: ' утром ' }, NOW);
  assert.deepEqual(w.payload, { kind: 'weight', date: TODAY, value: 72.5, unit: 'кг', time: '07:05', note: 'утром' });
  assert.equal(formatMeasure(w.payload), '72,5 кг');
  const bp = makeMeasure({ kind: 'bp', value: 120, value2: '80' }, NOW);
  assert.equal(formatMeasure(bp.payload), '120/80 мм рт. ст.');
  assert.throws(() => makeMeasure({ kind: 'bp', value: 80, value2: 120 }), /больше нижнего/);
  assert.throws(() => makeMeasure({ kind: 'weight', value: 5 }), /Вес: от/);
  assert.throws(() => makeMeasure({ kind: 'weight', value: 'много' }), /число/);
  assert.throws(() => makeMeasure({ kind: 'temp', value: 36.6, time: '25:00' }), /Время/);
  assert.throws(() => makeMeasure({ kind: 'nope', value: 1 }), /bad kind/);
  assert.throws(() => makeMeasure({ kind: 'custom', value: 5 }), /Назови/);
  const c = makeMeasure({ kind: 'custom', name: ' Страниц ', unit: 'стр', value: '12' }, NOW);
  assert.deepEqual([measureLabel(c.payload), c.payload.unit], ['Страниц', 'стр']);
  const u = updateMeasure(w, { value: 71.9, date: TODAY }, NOW + 5);
  assert.deepEqual([u.id, u.payload.value, u.payload.editedAt], [w.id, 71.9, NOW + 5]);
  assert.equal(parseNumber('1 234,5'), 1234.5);
});

const mk = (kind, vals, start = '2026-11-01') => vals.map((v, i) => {
  const d = new Date(2026, 10, 1 + i, 12);
  return makeMeasure({ kind, value: v, date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }, NOW + i);
});

test('ряды, скользящее среднее, тренд и изменение за период', () => {
  const ev = [...mk('weight', [80, 79.8, 79.6, 79.4, 79.2, 79.0, 78.8, 78.6, 78.4, 78.2]), makeMeasure({ kind: 'weight', value: 100, date: '2026-11-10' }, NOW + 99)];
  const s = dailySeries(ev, 'weight');
  assert.equal(s.length, 10);
  assert.equal(s.at(-1).value, 89.1, '[78.2 и 100] за один день усредняются');
  const clean = dailySeries(mk('weight', [80, 79.8, 79.6, 79.4, 79.2, 79.0, 78.8, 78.6, 78.4, 78.2]), 'weight');
  const tr = linearTrend(clean);
  assert.ok(Math.abs(tr.perWeek - -1.4) < 1e-9, 'падение 0,2 кг в день = −1,4 в неделю');
  assert.ok(tr.r2 > 0.999);
  assert.equal(linearTrend(clean.slice(0, 2)), null); assert.equal(linearTrend([{ date: '2026-11-01', value: 1 }, { date: '2026-11-02', value: 2 }, { date: '2026-11-03', value: 3 }]), null, 'меньше 3 дней охвата');
  const ma = movingAverage(clean, 3);
  assert.equal(ma[0].value, 80); assert.ok(Math.abs(ma[2].value - 79.8) < 1e-9);
  const ch = changeOver(clean, 7, TODAY);
  assert.ok(Math.abs(ch.delta - -1.4) < 1e-9 && ch.from === '2026-11-03');
  assert.equal(changeOver(clean, 100, TODAY), null, 'нет такой старой записи');
  assert.equal(changeOver([], 7, TODAY), null);
});

test('давление: пара значений, среднее за неделю, ключи и сортировка показателей', () => {
  const ev = [makeMeasure({ kind: 'bp', value: 120, value2: 80, date: '2026-11-09' }, NOW), makeMeasure({ kind: 'bp', value: 130, value2: 90, date: TODAY }, NOW),
    makeMeasure({ kind: 'bp', value: 150, value2: 95, date: '2026-10-01' }, NOW), makeMeasure({ kind: 'pulse', value: 60, date: '2026-11-05' }, NOW)];
  assert.deepEqual(bpAverage(ev, TODAY, 7), { n: 2, sys: 125, dia: 85 });
  assert.equal(bpAverage([], TODAY), null);
  assert.deepEqual(dailySeries(ev, 'bp', 'value2').map(p => p.value), [95, 80, 90]);
  assert.deepEqual(measureKeys(ev).map(k => k.key), ['bp', 'pulse']);
  assert.equal(measuresOf(ev, 'bp').length, 3);
});

test('ИМТ и отношение талии к росту: числа и нейтральные ориентиры', () => {
  assert.equal(bmi(72, 180), 22.2); assert.equal(bmi(0, 180), null); assert.equal(bmi(70, 50), null);
  assert.equal(whtr(85, 180), 0.47); assert.equal(whtr(100, 180), 0.56);
  assert.match(bmiNote(22.2), /в пределах/); assert.match(bmiNote(30), /выше/); assert.match(bmiNote(17), /ниже/);
  assert.match(whtrNote(0.47), /ниже порога/); assert.match(whtrNote(0.56), /не ниже/);
});

test('сон: среднее, разброс, «долг» относительно цели', () => {
  const ev = [7, 6, 8, 5.5].map((h, i) => makeCheckin('m', `2026-11-${String(7 + i).padStart(2, '0')}`, { sleepHours: h }, '', NOW));
  const s = sleepStats(ev, TODAY, 7, 8);
  assert.deepEqual([s.nights, s.avg], [4, 6.63]);
  assert.equal(s.debt, 5.5);
  assert.equal(sleepStats([], TODAY), null);
  assert.equal(sleepStats(ev, '2026-11-20', 7, 8), null, 'за последние 7 дней до 20 ноября ночей нет');
  assert.equal(sleepStats(ev, TODAY, 2, 8).nights, 2, 'окно в 2 дня захватывает две ночи');
});

test('профиль здоровья: чтение, проверка, возраст', () => {
  assert.deepEqual(healthProfile([]), { heightCm: null, birthYear: null, sex: '', sleepTarget: 8, goalWeight: null });
  const prof = { ...makeProfile('И', NOW), payload: { name: 'И', accountId: 'x', heightCm: 180, birthYear: 1990, sex: 'm', sleepTarget: 7.5, goalWeight: 75 } };
  assert.deepEqual(healthProfile([prof]), { heightCm: 180, birthYear: 1990, sex: 'm', sleepTarget: 7.5, goalWeight: 75 });
  assert.deepEqual(checkHealthProfile({ heightCm: '180,5', birthYear: '1990', sex: 'f', sleepTarget: '7', goalWeight: '' }), { heightCm: 180.5, birthYear: 1990, sex: 'f', sleepTarget: 7, goalWeight: null });
  assert.deepEqual(checkHealthProfile({ heightCm: '', birthYear: '', sex: 'x', sleepTarget: '', goalWeight: '' }), { heightCm: null, birthYear: null, sex: '', sleepTarget: 8, goalWeight: null });
  assert.throws(() => checkHealthProfile({ heightCm: 50 }), /Рост/);
  assert.throws(() => checkHealthProfile({ birthYear: 1800 }), /Год рождения/);
  assert.equal(ageFromBirthYear(1990, NOW), 36); assert.equal(ageFromBirthYear('abc', NOW), null); assert.equal(ageFromBirthYear(2100, NOW), null);
});

test('CSV измерений: разделитель, запятая в числах, защита от формул', () => {
  const ev = [makeMeasure({ kind: 'weight', value: 72.5, date: TODAY, time: '07:00', note: '=1+1' }, NOW), makeMeasure({ kind: 'bp', value: 120, value2: 80, date: '2026-11-09' }, NOW)];
  const csv = measuresToCsv(ev);
  assert.ok(csv.startsWith('﻿Дата;Время;Показатель;Значение;Значение 2;Единицы;Комментарий\r\n'));
  assert.ok(csv.includes('2026-11-09;;Давление;120;80;мм рт. ст.;'));
  assert.ok(csv.includes("2026-11-10;07:00;Вес;72,5;;кг;'=1+1"));
});
