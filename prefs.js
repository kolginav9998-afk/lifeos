// Настройки интерфейса. Это не личные данные (тема, автоблокировка), поэтому хранятся открыто.
const KEY = 'lifeos.prefs.v1';
export const DEFAULTS = { theme: 'auto', autoLockMin: 5, parseDates: true, hideAmounts: false, heavyDay: false, onboardingDone: false, tab: 'today' };

let cache = null;
function load() {
  if (cache) return cache;
  let v = null;
  try { v = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* нет или повреждено */ }
  cache = { ...DEFAULTS, ...(v && typeof v === 'object' && !Array.isArray(v) ? v : {}) };
  return cache;
}
export const getPrefs = () => load();
export const getPref = k => load()[k];
export function setPref(k, v) {
  load()[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* не критично */ }
}
export function resetPrefsCache() { cache = null; }
