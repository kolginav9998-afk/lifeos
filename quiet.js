// «День тишины» и «неделя без нового» — бережные режимы против перегрузки.
// День тишины прячет счётчики, серии и подсказки на сегодня: остаются только дела.
// Неделя без нового приостанавливает предложения новых курсов, экспериментов и функций; всё начатое работает как обычно.
// Здесь только чистая логика дат и настроек: экраны и документ сюда не подключаются.
import { getPref, setPref } from './prefs.js';
import { addDays } from './events.js';

export const QUIET_WEEK_DAYS = 7;

// prefs — объект настроек (getPrefs() или любой похожий), today — дата «ГГГГ-ММ-ДД».
export const isQuietDay = (prefs, today) => !!today && (prefs?.quietDay || '') === today;
// Неделя действует до даты quietWeekUntil включительно.
export const isQuietWeek = (prefs, today) => !!today && (prefs?.quietWeekUntil || '') >= today;

// Переключить тишину на сегодня. Возвращает, включена ли тишина после переключения.
export function toggleQuietDay(today) {
  const on = getPref('quietDay') !== today;
  setPref('quietDay', on ? today : '');
  return on;
}

// «Неделя без нового»: 7 дней начиная с сегодня (последний день — today + 6). Если уже активна — отменяет.
// Возвращает, включена ли неделя после вызова.
export function startQuietWeek(today) {
  const on = (getPref('quietWeekUntil') || '') < today;
  setPref('quietWeekUntil', on ? addDays(today, QUIET_WEEK_DAYS - 1) : '');
  return on;
}
