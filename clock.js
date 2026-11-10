// Логические часы для слияния при синхронизации. u всегда растёт: даже если часы телефона отстали,
// новая правка получает метку больше любой уже виденной. Метки из далёкого будущего игнорируются.
const KEY = 'lifeos.hlc.v1';
const DAY = 24 * 3600 * 1000;
let storage = globalThis.localStorage;
let last = null;
export function useStorage(s) { storage = s; last = null; }   // для тестов

function load() {
  if (last === null) { try { last = Number(storage.getItem(KEY)) || 0; } catch { last = 0; } }
  return last;
}
function save() { try { storage.setItem(KEY, String(last)); } catch { /* не критично */ } }

export function tick(now = Date.now()) { last = Math.max(now, load() + 1); save(); return last; }
export function observe(u, now = Date.now()) {
  if (Number.isSafeInteger(u) && u <= now + DAY && u > load()) { last = u; save(); }
}
export const peek = () => load();
