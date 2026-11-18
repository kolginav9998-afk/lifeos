// Режимы покоя (quiet.js): «день тишины» и «неделя без нового». Чистая логика дат и настроек, без экранов.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isQuietDay, isQuietWeek, toggleQuietDay, startQuietWeek, QUIET_WEEK_DAYS } from '../quiet.js';
import { getPref, getPrefs, resetPrefsCache } from '../prefs.js';
import { addDays } from '../events.js';

const TODAY = '2026-11-18';

// Каждый тест начинается с чистых настроек (кэш в памяти, localStorage в Node нет — prefs.js это переживает).
function reset() { resetPrefsCache(); }

test('isQuietDay: тишина только в точно указанный день', () => {
  assert.equal(isQuietDay({ quietDay: '' }, TODAY), false, 'по умолчанию выключена');
  assert.equal(isQuietDay({}, TODAY), false, 'поля нет — старые настройки читаются');
  assert.equal(isQuietDay(null, TODAY), false, 'без объекта настроек не падает');
  assert.equal(isQuietDay({ quietDay: TODAY }, TODAY), true, 'сегодня тихий день');
  assert.equal(isQuietDay({ quietDay: addDays(TODAY, -1) }, TODAY), false, 'вчерашняя дата уже не действует');
  assert.equal(isQuietDay({ quietDay: addDays(TODAY, 1) }, TODAY), false, 'завтрашняя ещё не началась');
});

test('isQuietWeek: действует до даты включительно', () => {
  assert.equal(isQuietWeek({ quietWeekUntil: '' }, TODAY), false, 'по умолчанию выключена');
  assert.equal(isQuietWeek(null, TODAY), false, 'без объекта настроек не падает');
  assert.equal(isQuietWeek({ quietWeekUntil: TODAY }, TODAY), true, 'последний день ещё действует');
  assert.equal(isQuietWeek({ quietWeekUntil: addDays(TODAY, 3) }, TODAY), true, 'середина срока');
  assert.equal(isQuietWeek({ quietWeekUntil: addDays(TODAY, -1) }, TODAY), false, 'срок вышел вчера');
});

test('toggleQuietDay: включает на сегодня и выключает повторным нажатием', () => {
  reset();
  assert.equal(toggleQuietDay(TODAY), true, 'включили');
  assert.equal(getPref('quietDay'), TODAY);
  assert.equal(isQuietDay(getPrefs(), TODAY), true);
  assert.equal(isQuietDay(getPrefs(), addDays(TODAY, 1)), false, 'завтра тишина сама кончается');
  assert.equal(toggleQuietDay(TODAY), false, 'выключили');
  assert.equal(getPref('quietDay'), '');
  assert.equal(isQuietDay(getPrefs(), TODAY), false);
});

test('startQuietWeek: 7 дней начиная с сегодня, повторный вызов отменяет', () => {
  reset();
  assert.equal(startQuietWeek(TODAY), true, 'включили');
  const until = getPref('quietWeekUntil');
  assert.equal(until, addDays(TODAY, QUIET_WEEK_DAYS - 1), 'последний день — седьмой');
  assert.equal(isQuietWeek(getPrefs(), TODAY), true, 'сегодня действует');
  assert.equal(isQuietWeek(getPrefs(), until), true, 'последний день действует');
  assert.equal(isQuietWeek(getPrefs(), addDays(until, 1)), false, 'на восьмой день кончилась');
  assert.equal(startQuietWeek(TODAY), false, 'повторный вызов отменил');
  assert.equal(getPref('quietWeekUntil'), '');
});

test('истекшая неделя включается заново, а не отменяется', () => {
  reset();
  startQuietWeek(addDays(TODAY, -10));                     // неделя была давно и кончилась
  assert.equal(isQuietWeek(getPrefs(), TODAY), false);
  assert.equal(startQuietWeek(TODAY), true, 'новая неделя началась');
  assert.equal(getPref('quietWeekUntil'), addDays(TODAY, QUIET_WEEK_DAYS - 1));
});

test('режимы независимы: день тишины не трогает неделю и наоборот', () => {
  reset();
  toggleQuietDay(TODAY);
  assert.equal(isQuietWeek(getPrefs(), TODAY), false);
  startQuietWeek(TODAY);
  assert.equal(isQuietDay(getPrefs(), TODAY), true, 'день тишины остался');
  toggleQuietDay(TODAY);
  assert.equal(isQuietWeek(getPrefs(), TODAY), true, 'неделя осталась');
});
