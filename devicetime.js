// Проверка часов устройства (не путать с clock.js: там логические часы для слияния при синхронизации): неверное время портит порядок записей, напоминания и синхронизацию. Только подсказка, ничего не меняет.
export const TOLERANCE_MS = 10 * 60 * 1000;
const DAY = 86400000;

// Записи «из будущего»: время создания позже текущего (запас на неточность часов — 10 минут).
export const futureEvents = (events, now = Date.now()) => events.filter(e => e.ts > now + TOLERANCE_MS);

// Что запомнить при запуске: время запуска и, если часы ушли назад относительно прошлого запуска, откуда (backFrom).
// Отметка backFrom живёт, пока часы не догонят её, и снимается сама.
export function onOpen({ lastOpenTs = 0, backFrom = 0 } = {}, now = Date.now()) {
  const back = lastOpenTs - now > TOLERANCE_MS ? Math.max(lastOpenTs, backFrom) : (backFrom - now > TOLERANCE_MS ? backFrom : 0);
  return { lastOpenTs: now, backFrom: back };
}

const span = ms => { const h = Math.max(1, Math.round(ms / 3600000)); return h < 48 ? `${h} ч` : `${Math.round(ms / DAY)} дн.`; };
const HOW = 'Проверь дату и время в настройках телефона и включи автоматическую настройку по сети.';

export function clockHint({ events = [], now = Date.now(), backFrom = 0 } = {}) {
  if (backFrom - now > TOLERANCE_MS) return { kind: 'back', ms: backFrom - now, text: `Часы устройства показывают время примерно на ${span(backFrom - now)} раньше, чем при прошлом запуске. ${HOW}` };
  const fut = futureEvents(events, now);
  if (fut.length) {
    const far = Math.max(...fut.map(e => e.ts)) - now;
    return { kind: 'future', count: fut.length, ms: far, text: `В данных есть записи из будущего: ${fut.length} (самая дальняя — через ${span(far)}). Возможно, часы устройства раньше спешили или сейчас отстают. ${HOW}` };
  }
  return null;
}
