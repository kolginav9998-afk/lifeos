// Не гасить экран во время тренировки и фокус-таймера: Screen Wake Lock API с тихим запасным вариантом.
// Там, где API нет (часть браузеров, iOS), acquire() просто возвращает false — таймер работает как раньше.
// Чистый модуль: браузерные объекты приходят параметрами (по умолчанию — глобальные, читаются лениво).

export function createWakeLock({ nav = globalThis.navigator, doc = globalThis.document } = {}) {
  let sentinel = null;
  let wanted = false;

  const supported = () => typeof nav?.wakeLock?.request === 'function';

  async function acquire() {
    wanted = true;
    if (!supported()) return false;
    if (doc && doc.visibilityState === 'hidden') return false;          // скрытой странице замок не дадут
    try {
      sentinel = await nav.wakeLock.request('screen');
      sentinel.addEventListener?.('release', () => { sentinel = null; });   // система могла отнять замок сама
      return true;
    } catch { return false; }                                            // отказ (низкий заряд и т.п.) — не страшно
  }

  async function release() {
    wanted = false;
    try { await sentinel?.release(); } catch { /* уже отпущен */ }
    sentinel = null;
  }

  // Страница снова видима, а замок нужен: система отбирает его при сворачивании — просим заново.
  if (doc?.addEventListener) doc.addEventListener('visibilitychange', () => { if (!doc.hidden && wanted) acquire(); });

  return {
    supported,
    acquire,
    release,
    get active() { return !!sentinel; },
    get wanted() { return wanted; },
  };
}
