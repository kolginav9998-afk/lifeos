// Производственный календарь России: нерабочие праздничные дни, сокращённые предпраздничные дни и рабочие субботы по переносам.
// Чистые функции плюс небольшой кэш на устройстве и загрузка из открытого API isdayoff.ru: один запрос на год возвращает строку цифр по дням года
// (0 — рабочий день, 1 — нерабочий, 2 — сокращённый (при pre=1), 4 — рабочий в особый период). Передаётся только номер года.
// Без интернета и без кэша календарь пуст: тогда график считается по дням недели, а праздники человек отмечает сам.
// Календарь применяется только к графикам «по дням недели» (5/2, 6/1 и свои): у сменных циклов (2/2, сутки через трое) праздники рабочие.

export const CAL_HOST = 'https://isdayoff.ru';
export const calUrl = year => `${CAL_HOST}/api/getdata?year=${year}&pre=1`;
export const CAL_MAX_AGE_MS = 30 * 86400000;         // кэш обновляем раз в месяц: переносы иногда утверждают среди года
const KEY = 'lifeos-cal-ru-';

const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInYear = y => (isLeap(y) ? 366 : 365);
const p2 = n => String(n).padStart(2, '0');
const dateAt = (year, i) => { const d = new Date(Date.UTC(year, 0, 1 + i)); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; };
const dowMon = (year, i) => (new Date(Date.UTC(year, 0, 1 + i)).getUTCDay() + 6) % 7;         // 0 = понедельник

// Ответ API: только цифры 0, 1, 2, 4 и ровно по одной на день года. Всё остальное (коды ошибок 100, 101, 199, мусор) отбрасывается.
export function parseYear(text, year) {
  const s = String(text ?? '').trim();
  return /^[0124]+$/.test(s) && s.length === daysInYear(year) ? s : null;
}

const YEARS = new Map();         // год → строка кодов
let version = 0, hydrated = false, memo = null, lastTry = 0;

export function setCalendar(year, codes) {
  const ok = Number.isInteger(year) && year >= 2000 && year <= 2100 && parseYear(codes, year);
  if (!ok) return false;
  if (YEARS.get(year) !== codes) { YEARS.set(year, codes); version++; memo = null; }
  return true;
}
export const getCalendar = year => YEARS.get(year) ?? null;
export const calendarYears = () => [...YEARS.keys()].sort();
export function clearCalendars(rehydrate = false) { YEARS.clear(); version++; memo = null; hydrated = !rehydrate; lastTry = 0; }       // для тестов; без rehydrate кэш с устройства после очистки не подтягивается

// Достаёт сохранённые календари с устройства (один раз за запуск).
export function hydrate(storage = globalThis.localStorage) {
  if (hydrated) return;
  hydrated = true;
  try {
    for (let i = 0; i < (storage?.length ?? 0); i++) {
      const k = storage.key(i);
      if (!k?.startsWith(KEY)) continue;
      const y = Number(k.slice(KEY.length)), rec = JSON.parse(storage.getItem(k) ?? 'null');
      if (Number.isInteger(y) && typeof rec?.codes === 'string') setCalendar(y, rec.codes);
    }
  } catch { /* кэш недоступен: работаем без праздников */ }
}

// Что календарь меняет в графике «по дням недели»: нерабочие дни, рабочие выходные (только для пятидневки) и сокращённые дни.
function derive(fiveDay) {
  const key = `${version}|${fiveDay ? 1 : 0}`;
  if (memo?.key === key) return memo.value;
  const off = [], on = [], short = [];
  for (const year of calendarYears()) {
    const codes = YEARS.get(year);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === '1') off.push(dateAt(year, i));
      else {
        if (c === '2') short.push(dateAt(year, i));
        if (fiveDay && dowMon(year, i) >= 5) on.push(dateAt(year, i));        // суббота или воскресенье, но рабочие по переносу
      }
    }
  }
  const value = { off, on, short };
  memo = { key, value };
  return value;
}

// Настройки графика + то, что подсказывает календарь (поля autoOff, autoOn, shortDays). Эти поля НЕ хранятся: при сохранении настроек
// их отбрасывает normalizeCfg, поэтому устаревший календарь не попадёт в записи человека.
export function withCalendar(cfg) {
  if (!cfg || cfg.calRu === false || cfg.pattern?.kind !== 'week') return cfg;
  hydrate();
  if (!YEARS.size) return cfg;
  const week = cfg.pattern.week, fiveDay = week.slice(0, 5).every(Boolean);
  const d = derive(fiveDay);
  return { ...cfg, autoOff: d.off, autoOn: d.on, shortDays: d.short };
}

// Состояние для экрана: сколько лет календаря есть и покрыт ли нужный год.
export const hasYear = year => { hydrate(); return YEARS.has(year); };

// Загрузка календарей на указанные годы. Не бросает ошибок. Возвращает { ok: [годы], failed: [годы] }.
// Свежий кэш (моложе месяца) не перезапрашивается; при сбое остаётся старый кэш, если он был.
export async function loadCalendars(years, { fetchImpl = globalThis.fetch, storage = globalThis.localStorage, now = Date.now(), timeoutMs = 8000 } = {}) {
  hydrate(storage);
  const ok = [], failed = [];
  for (const year of [...new Set(years)].filter(y => Number.isInteger(y))) {
    let rec = null;
    try { rec = JSON.parse(storage?.getItem(KEY + year) ?? 'null'); } catch { rec = null; }
    const fresh = rec && typeof rec.codes === 'string' && Number.isFinite(rec.at) && now - rec.at < CAL_MAX_AGE_MS && parseYear(rec.codes, year);
    if (fresh) { setCalendar(year, rec.codes); ok.push(year); continue; }
    let codes = null;
    try {
      if (typeof fetchImpl !== 'function') throw new Error('нет сети');
      const ctl = typeof AbortController === 'function' ? new AbortController() : null, timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : 0;
      try {
        const r = await fetchImpl(calUrl(year), ctl ? { signal: ctl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' } : undefined);
        codes = r?.ok ? parseYear(await r.text(), year) : null;
      } finally { clearTimeout(timer); }
    } catch { codes = null; }
    if (codes) {
      setCalendar(year, codes); ok.push(year);
      try { storage?.setItem(KEY + year, JSON.stringify({ codes, at: now })); } catch { /* нет места: останется до перезапуска */ }
    } else if (YEARS.has(year)) ok.push(year);        // старый кэш лучше, чем ничего
    else failed.push(year);
  }
  if (ok.length) { try { globalThis.dispatchEvent?.(new Event('lifeos:calendar')); } catch { /* вне браузера событий нет */ } }
  return { ok, failed };
}

// Подгрузка календаря для графика человека: текущий и следующий год, не чаще раза в 10 минут. Не бросает ошибок, ничего не ждёт.
export function ensureCalendar(cfg, { now = Date.now(), year = new Date().getFullYear(), force = false, ...opts } = {}) {
  if (!cfg || cfg.calRu === false || cfg.pattern?.kind !== 'week') return null;
  if (!force && now - lastTry < 10 * 60000) return null;
  lastTry = now;
  return loadCalendars([year, year + 1], { now, ...opts });
}
