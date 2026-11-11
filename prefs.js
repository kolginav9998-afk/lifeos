// Настройки интерфейса. Это не личные данные (тема, автоблокировка), поэтому хранятся открыто.
const KEY = 'lifeos.prefs.v1';
export const DEFAULTS = { theme: 'auto', autoLockMin: 5, parseDates: true, hideAmounts: false, simple: false, heavyDay: false, onboardingDone: false, tab: 'today',
  fontScale: 1, habitReview: '', lowMoodUntil: '', lightDayAsked: '', overloadAsked: '', caffeineAsked: '', restAsked: '', remindersOn: false, taskHour: 9, habitHour: 20, eveningHour: 21, bedtimeMin: -1, weeklyHour: -1, quietFrom: -1, quietTo: 7, daysOff: [], lastSeenVersion: '', lastBackupAt: 0, lastOpenTs: 0, clockBackFrom: 0, clockAsked: '', storageAsked: '', integrityAsked: '', backupEveryDays: 14, updateCheckedAt: 0, updateNotified: '' };

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
