// Архив данных: один файл со всеми записями и настройками. Чистая логика: что войдёт в архив, что внутри файла и что изменится при загрузке.
// Загрузка по умолчанию только добавляет (ничего не затирает); данные, отличающиеся от уже имеющихся, заменяются только по явному выбору.

// ---------- настройки в архиве ----------
// Только внешний вид и расписание напоминаний. Не переносим то, что привязано к устройству: разрешение на уведомления, состояние защиты, служебные отметки.
const HOUR = (lo, hi) => v => Number.isInteger(v) && v >= lo && v <= hi;
export const PREF_RULES = {
  theme: v => ['auto', 'light', 'dark'].includes(v),
  autoLockMin: HOUR(0, 1440),
  parseDates: v => typeof v === 'boolean',
  hideAmounts: v => typeof v === 'boolean',
  simple: v => typeof v === 'boolean',
  fontScale: v => [1, 1.15, 1.3].includes(v),
  taskHour: HOUR(-1, 23), habitHour: HOUR(-1, 23), eveningHour: HOUR(-1, 23), weeklyHour: HOUR(-1, 23),
  bedtimeMin: HOUR(-1, 1439),
  quietFrom: HOUR(-1, 23), quietTo: HOUR(0, 23),
  daysOff: v => Array.isArray(v) && v.length <= 7 && new Set(v).size === v.length && v.every(HOUR(0, 6)),
};
// Берём из настроек только разрешённое и корректное.
export function cleanPrefs(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, ok] of Object.entries(PREF_RULES)) if (Object.hasOwn(raw, k) && ok(raw[k])) out[k] = Array.isArray(raw[k]) ? [...raw[k]] : raw[k];
  return out;
}

// ---------- сравнение с тем, что уже есть ----------
const stable = v => (v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(stable).join(',')}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`);
const sameEvent = (a, b) => a.type === b.type && a.ts === b.ts && (JSON.stringify(a.payload) === JSON.stringify(b.payload) || stable(a.payload) === stable(b.payload));

// План загрузки: что в файле новое, что совпадает, что отличается. Ничего не меняет.
export function importPlan(existing, incoming) {
  const local = new Map(existing.map(e => [e.id, e]));
  const fresh = [], differ = [];
  let same = 0, from = Infinity, to = -Infinity;
  const byType = {};
  for (const e of incoming) {
    if (Number.isFinite(e.ts)) { if (e.ts < from) from = e.ts; if (e.ts > to) to = e.ts; }
    byType[e.type] = (byType[e.type] || 0) + 1;
    const have = local.get(e.id);
    if (!have) fresh.push(e);
    else if (sameEvent(have, e)) same++;
    else differ.push({ incoming: e, local: have });
  }
  return { total: incoming.length, fresh, same, differ, byType, types: Object.keys(byType).length, range: Number.isFinite(from) ? { from, to } : null };
}
// Какие записи сохранить: merge — только новые; replace — новые и отличающиеся (берём версию из архива).
export const planEvents = (plan, mode) => (mode === 'replace' ? [...plan.fresh, ...plan.differ.map(d => d.incoming)] : plan.fresh);

// ---------- имя файла и описание ----------
export const archiveName = (date, encrypted) => `lifeos-archive-${date}${encrypted ? '.enc' : ''}.json`;
export const looksLikeZip = bytes => bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
