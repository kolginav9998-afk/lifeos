// Дом: вещи и одежда. «Что у меня есть, где лежит, сколько раз надевал и стирал». Чистая логика: без интерфейса, хранилища и часов
// (сегодняшний день всегда приходит параметром, поэтому результат зависит только от данных).
// Записи: item — вещь (заменяется по id, как профиль), itemlog — отметка в истории вещи (id: ilog:<вещь>:<время>).
import { isYmd, daysBetween, todayStr } from './events.js';
import { MAX_MINOR, parseAmount, shiftMonth } from './money.js';
import { normalize } from './search.js';
import { vaccinesDue } from './pet.js';

export const KINDS = [['clothes', 'Одежда'], ['shoes', 'Обувь'], ['underwear', 'Бельё и носки'], ['bedding', 'Постельное бельё'], ['towels', 'Полотенца'], ['electronics', 'Техника'],
  ['kitchen', 'Кухня и посуда'], ['tools', 'Инструменты'], ['furniture', 'Мебель'], ['documents', 'Документы'], ['pantry', 'Кладовая и еда'], ['consumables', 'Расходники'], ['other', 'Другое']];
export const KIND_LABEL = Object.fromEntries(KINDS);
export const STATUS_LABEL = { active: 'В использовании', stored: 'Убрано на хранение', sold: 'Продано', gone: 'Выброшено или потеряно' };
export const HOW_LABEL = { machine: 'Машинная стирка', hand: 'Ручная стирка', dry: 'Химчистка', none: 'Не стирается' };
// Что можно отметить: кнопки на карточке зависят от вида вещи (одежду надевают, технику используют, мебель не отмечают).
export const LOG_NOUN = { wear: 'Надевание', wash: 'Стирка', use: 'Использование', repair: 'Ремонт', move: 'Перемещение', water: 'Полив', note: 'Заметка' };
const QUICK = { clothes: ['wear', 'wash'], shoes: ['wear', 'wash'], underwear: ['wear', 'wash'], towels: ['use', 'wash'], bedding: ['wash'], electronics: ['use'], kitchen: ['use'], tools: ['use'], furniture: [], documents: [], pantry: [], consumables: ['use'], other: ['use'] };
export const quickLogs = kind => QUICK[kind] ?? ['use'];
const BUTTON = { wear: 'Надел', use: 'Использовал', repair: 'Починил', move: 'Переложил', water: 'Полил', note: 'Заметка' };
export const logButton = (log, kind) => (log === 'wash' ? (kind === 'shoes' ? 'Почистил' : 'Постирал') : BUTTON[log] ?? LOG_NOUN[log]);
const KIND_WORDS = { clothes: 'одежда вещи гардероб', shoes: 'обувь ботинки', underwear: 'нижнее белье трусы', bedding: 'постель простыня одеяло наволочка', towels: 'полотенце', electronics: 'электроника гаджет', kitchen: 'посуда', tools: 'инструмент', furniture: 'интерьер', documents: 'бумаги', pantry: 'еда крупа запас кладовая', consumables: 'батарейки лампочки расходники', other: '' };
const TRACKED = new Set(['clothes', 'shoes', 'underwear', 'bedding', 'towels', 'electronics', 'kitchen', 'tools', 'other']);   // у мебели и документов «использование» не отмечают
const USE = new Set(['wear', 'use']);
export const NEVER_USED_DAYS = 60;
export const WARRANTY_DAYS = 30;

const clean = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const cleanText = (s, n) => String(s ?? '').replace(/\r/g, '').trim().slice(0, n);
export const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };
export const timesText = n => `${n} ${plural(n, 'раз', 'раза', 'раз')}`;
const ts36 = t => Math.floor(t).toString(36);
export const newItemId = now => `item:${ts36(now)}`;
export const newLogId = (itemId, now) => `ilog:${itemId}:${ts36(now)}`;

// ---------- правила ухода ----------
// Бельё, полотенца и постель получают разумные правила сами; у остальных вещей правил нет, пока их не задали.
const CARE = {
  underwear: { how: 'machine', temp: 40, washEveryWears: 1, washEveryDays: null },
  towels: { how: 'machine', temp: 60, washEveryWears: 3, washEveryDays: 7 },
  bedding: { how: 'machine', temp: 60, washEveryWears: null, washEveryDays: 14 },
};
export const defaultCare = kind => ({ how: kind === 'clothes' ? 'machine' : 'none', temp: null, washEveryWears: null, washEveryDays: null, ...CARE[kind] });
export const careOf = p => ({ ...defaultCare(p?.kind), ...(p?.care && typeof p.care === 'object' ? p.care : {}) });

// Быстрый старт: шаблоны подставляют название, вид и правила ухода (всё можно поправить).
export const TEMPLATES = [
  { key: 'tshirt', label: 'Футболка', name: 'Футболка', kind: 'clothes', care: { how: 'machine', temp: 40, washEveryWears: 1, washEveryDays: null } },
  { key: 'jeans', label: 'Джинсы', name: 'Джинсы', kind: 'clothes', care: { how: 'machine', temp: 40, washEveryWears: 10, washEveryDays: null } },
  { key: 'sweater', label: 'Свитер', name: 'Свитер', kind: 'clothes', care: { how: 'hand', temp: 30, washEveryWears: 5, washEveryDays: null } },
  { key: 'jacket', label: 'Куртка', name: 'Куртка', kind: 'clothes', care: { how: 'machine', temp: 30, washEveryWears: 30, washEveryDays: null } },
  { key: 'socks', label: 'Носки', name: 'Носки', kind: 'underwear', qty: 5 },
  { key: 'bedding', label: 'Постельное бельё', name: 'Комплект постельного белья', kind: 'bedding' },
  { key: 'towel', label: 'Полотенце', name: 'Полотенце', kind: 'towels' },
  { key: 'sneakers', label: 'Кроссовки', name: 'Кроссовки', kind: 'shoes' },
  { key: 'plant', label: 'Растение', name: 'Растение', kind: 'other', extra: { waterEveryDays: 7 } },
  { key: 'batteries', label: 'Батарейки', name: 'Батарейки AA', kind: 'consumables', extra: { qty: 4, lowAt: 2 } },
  { key: 'grains', label: 'Крупа в кладовую', name: 'Гречка', kind: 'pantry' },
];
export function templateFields(key) {
  const t = TEMPLATES.find(x => x.key === key);
  return t ? { name: t.name, kind: t.kind, qty: t.qty ?? 1, care: { ...(t.care ?? defaultCare(t.kind)) }, ...(t.extra ?? {}) } : null;
}

// ---------- создание и правка ----------
function intOrNull(v, lo, hi, msg) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).trim().replace(',', '.'));
  if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(msg);
  return n;
}
function dateOrNull(v, msg) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!isYmd(s)) throw new Error(msg);
  return s;
}
// Цена из поля ввода: пусто — не указана, «0» — подарок, иначе как суммы в «Деньгах» (1250 или 1250,50), в копейках.
export function parsePrice(input) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  return /^0+([.,]0{1,2})?$/.test(s.replace(/\s/g, '')) ? 0 : parseAmount(s);
}
const tagsOf = v => {
  const list = Array.isArray(v) ? v : String(v ?? '').split(/[,;\n]+/);
  const seen = new Set(), out = [];
  for (const t of list) { const c = clean(String(t).replace(/^#+/, ''), 24); if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); out.push(c); } }
  return out.slice(0, 10);
};

// Приводит поля формы к записи: обрезает, проверяет, подставляет умолчания. Бросает Error с понятным текстом.
function itemPayload(f, now = Date.now()) {
  const name = clean(f.name, 80);
  if (!name) throw new Error('Напиши название вещи');
  if (!KIND_LABEL[f.kind]) throw new Error('Выбери вид вещи');
  const today = todayStr(now);
  const bought = dateOrNull(f.bought, 'Дата покупки: выбери день');
  if (bought && bought > today) throw new Error('Дата покупки не может быть в будущем');
  const warranty = dateOrNull(f.warranty, 'Гарантия до: выбери день');
  if (bought && warranty && warranty < bought) throw new Error('Гарантия не может кончиться раньше покупки');
  const price = f.priceMinor === undefined || f.priceMinor === null || f.priceMinor === '' ? null : Number(f.priceMinor);
  if (price !== null && !(Number.isSafeInteger(price) && price >= 0 && price <= MAX_MINOR)) throw new Error('Цена: число от 0');
  const c = f.care && typeof f.care === 'object' ? { ...defaultCare(f.kind), ...f.care } : defaultCare(f.kind);
  if (!HOW_LABEL[c.how]) throw new Error('Выбери, как ухаживать за вещью');
  const status = f.status === undefined || f.status === null || f.status === '' ? 'active' : f.status;
  if (!STATUS_LABEL[status]) throw new Error('Выбери состояние вещи');
  const validUntil = dateOrNull(f.validUntil, '«Действует до»: выбери день');
  const useBy = dateOrNull(f.useBy, '«Съесть до»: выбери день');
  const zeroOk = f.kind === 'pantry' || f.kind === 'consumables';                 // запас может кончиться: 0 — допустимый остаток
  return {
    name, kind: f.kind, place: clean(f.place, 60), brand: clean(f.brand, 40), color: clean(f.color, 30), size: clean(f.size, 20), material: clean(f.material, 40),
    qty: intOrNull(f.qty ?? 1, zeroOk ? 0 : 1, 9999, `Количество: целое число от ${zeroOk ? 0 : 1} до 9999`) ?? 1, bought, priceMinor: price, currency: 'RUB', warranty,
    validUntil, useBy,
    waterEveryDays: intOrNull(f.waterEveryDays, 1, 365, 'Поливать раз в: от 1 до 365 дней'),
    serviceEveryDays: intOrNull(f.serviceEveryDays, 7, 3650, 'Обслуживание раз в: от 7 до 3650 дней'),
    lowAt: intOrNull(f.lowAt, 0, 999, '«Кончается» при остатке: от 0 до 999'),
    care: { how: c.how, temp: intOrNull(c.temp, 0, 95, 'Температура: от 0 до 95 градусов'), washEveryWears: intOrNull(c.washEveryWears, 1, 365, 'Стирать после: от 1 до 365 надеваний'), washEveryDays: intOrNull(c.washEveryDays, 1, 365, 'Стирать раз в: от 1 до 365 дней') },
    status, tags: tagsOf(f.tags), note: cleanText(f.note, 500),
  };
}
export function makeItem(fields, now = Date.now(), id = newItemId(now)) {
  return { id, type: 'item', ts: now, payload: itemPayload(fields, now), source: 'manual', confidence: 1, evidence: [] };
}
// Правка: id, время создания и неизвестные поля (от более новой версии) сохраняются.
export function updateItem(ev, changes, now = Date.now()) {
  const care = changes.care ? { ...careOf(ev.payload), ...changes.care } : ev.payload.care;
  return { ...ev, payload: { ...ev.payload, ...itemPayload({ ...ev.payload, ...changes, care }, now), editedAt: now } };
}
// Значения полей для формы (копирование вещи и правка).
export const fieldsOf = ev => { const p = ev.payload; return { ...p, care: careOf(p), tags: [...(p.tags ?? [])] }; };

export function makeLog(itemRef, kind, { date, note = '', place = '' } = {}, now = Date.now()) {
  const item = typeof itemRef === 'string' ? itemRef : itemRef.id;
  if (!LOG_NOUN[kind]) throw new Error('Выбери, что отметить');
  const d = date || todayStr(now);
  if (!isYmd(d)) throw new Error('Дата: выбери день');
  if (d > todayStr(now)) throw new Error('Отметить можно сегодня или раньше');
  const payload = { item, kind, date: d }, n = cleanText(note, 200), pl = clean(place, 60);
  if (n) payload.note = n;
  if (pl) payload.place = pl;
  return { id: newLogId(item, now), type: 'itemlog', ts: now, payload, source: 'manual', confidence: 1, evidence: [] };
}
// Переложил: новое место в вещи и запись в истории (что было раньше).
export function moveItem(ev, place, now = Date.now(), { date, note = '' } = {}) {
  const was = ev.payload.place;
  return { item: updateItem(ev, { place }, now), log: makeLog(ev, 'move', { date, place, note: [was ? `было: ${was}` : '', cleanText(note, 100)].filter(Boolean).join('; ') }, now) };
}

// ---------- чтение ----------
const byName = (a, b) => a.payload.name.localeCompare(b.payload.name, 'ru') || a.ts - b.ts || (a.id < b.id ? -1 : 1);
export const itemsOf = events => events.filter(e => e.type === 'item' && e.payload && typeof e.payload.name === 'string').sort(byName);
const newest = (a, b) => (a.payload.date === b.payload.date ? b.ts - a.ts || (a.id < b.id ? 1 : -1) : a.payload.date < b.payload.date ? 1 : -1);
export const logsOf = (events, itemId) => events.filter(e => e.type === 'itemlog' && e.payload?.item === itemId).sort(newest);
export const lastLog = logs => (logs.length ? [...logs].sort(newest)[0] : null);

// ---------- счётчики вещи ----------
// Порядок отметок: по дню, внутри дня по времени записи (стирка вечером обнуляет надевания утром, а не наоборот).
const after = (a, b) => a.payload.date > b.payload.date || (a.payload.date === b.payload.date && a.ts > b.ts);
export function statsOf(item, logs, today) {
  const p = item.payload, care = careOf(p), created = Number.isFinite(item.ts) ? todayStr(item.ts) : today;
  let wears = 0, washes = 0, lastWorn = null, lastWashLog = null, first = created;
  const ok = logs.filter(l => isYmd(l.payload?.date));
  for (const l of ok) {
    const { kind, date } = l.payload;
    if (date < first) first = date;
    if (USE.has(kind)) { wears++; if (!lastWorn || date > lastWorn) lastWorn = date; }
    else if (kind === 'wash') { washes++; if (!lastWashLog || after(l, lastWashLog)) lastWashLog = l; }
  }
  const wearsSinceWash = ok.filter(l => USE.has(l.payload.kind) && (!lastWashLog || after(l, lastWashLog))).length;
  const lastWashed = lastWashLog ? lastWashLog.payload.date : null;
  const daysSinceWash = Math.max(0, daysBetween(lastWashed ?? first, today));
  const lastUsed = [lastWorn, lastWashed].filter(Boolean).sort().pop() ?? null;
  const w = care.washEveryWears, d = care.washEveryDays, washable = care.how !== 'none';
  const parts = washable ? [w ? wearsSinceWash / w : null, d ? daysSinceWash / d : null].filter(x => x !== null) : [];
  const progress = parts.length ? Math.max(...parts) : null;
  return {
    wears, washes, wearsSinceWash, lastWorn, lastWashed, lastUsed, daysSinceWash, progress,
    ageDays: Math.max(0, daysBetween(p.bought || created, today)),
    costPerWear: p.priceMinor > 0 && wears > 0 ? Math.round(p.priceMinor / wears) : null,
    needsWash: progress !== null && progress >= 1,
    daysSinceUse: lastUsed ? Math.max(0, daysBetween(lastUsed, today)) : null,
  };
}

// Всё нужное экрану за один проход: вещи, их история и счётчики.
export function homeModel(events, today = todayStr()) {
  const items = itemsOf(events), logs = new Map(items.map(i => [i.id, []])), stats = new Map();
  for (const e of events) if (e.type === 'itemlog' && logs.has(e.payload?.item)) logs.get(e.payload.item).push(e);
  for (const i of items) { const l = logs.get(i.id).sort(newest); logs.set(i.id, l); stats.set(i.id, statsOf(i, l, today)); }
  return { today, items, logs, stats, byId: new Map(items.map(i => [i.id, i])) };
}

// ---------- стирка ----------
// due — пора по правилам; soon — носили после последней стирки, но срок ещё не вышел. В стирку идут только вещи «в использовании».
export function laundryOf(m) {
  const due = [], soon = [];
  for (const item of m.items) {
    if (item.payload.status !== 'active') continue;
    const s = m.stats.get(item.id), row = { item, stats: s };
    if (s.needsWash) due.push(row); else if (s.wearsSinceWash > 0 && careOf(item.payload).how !== 'none') soon.push(row);
  }
  due.sort((a, b) => b.stats.progress - a.stats.progress);
  soon.sort((a, b) => b.stats.wearsSinceWash - a.stats.wearsSinceWash);
  return { due, soon };
}
export const laundryGroups = rows => ['machine', 'hand', 'dry', 'none'].map(how => ({ how, label: HOW_LABEL[how], rows: rows.filter(r => careOf(r.item.payload).how === how) })).filter(g => g.rows.length);
export const laundryCount = (events, today) => laundryOf(homeModel(events, today)).due.length;

// ---------- текст ----------
export const ageText = d => (d < 30 ? `${d} дн.` : d < 365 ? `${Math.floor(d / 30)} мес.` : `${Math.floor(d / 365)} г.${Math.floor((d % 365) / 30) ? ` ${Math.floor((d % 365) / 30)} мес.` : ''}`);
export function careText(c) {
  if (c.how === 'none') return HOW_LABEL.none;
  const rules = [c.washEveryWears ? (c.washEveryWears === 1 ? 'после каждого надевания' : `после ${c.washEveryWears} ${plural(c.washEveryWears, 'надевания', 'надеваний', 'надеваний')}`) : '',
    c.washEveryDays ? `раз в ${c.washEveryDays} ${plural(c.washEveryDays, 'день', 'дня', 'дней')}` : ''].filter(Boolean);
  return [HOW_LABEL[c.how], c.temp !== null && c.temp !== undefined ? `${c.temp}°` : '', rules.length ? `стирать ${rules.join(' или ')}` : ''].filter(Boolean).join(', ');
}
// «Надето 5 раз · Стирано 2 раза» (для вещей, которые не надевают: «Использовано 5 раз»; у мебели и документов строки нет).
export function statsLine(s, kind) {
  const q = QUICK[kind] ?? ['use'];
  const first = q.includes('wear') ? `Надето ${timesText(s.wears)}` : q.includes('use') ? `Использовано ${timesText(s.wears)}` : '';
  const wash = q.includes('wash') ? `${kind === 'shoes' ? 'Почищено' : 'Стирано'} ${timesText(s.washes)}` : '';
  return [first, wash].filter(Boolean).join(' · ');
}
// До стирки: «Надето 2 из 3» или «Прошло 9 из 7 дней» (по тому правилу, которое ближе к сроку).
export function washProgress(item, s) {
  const c = careOf(item.payload), fw = c.washEveryWears ? s.wearsSinceWash / c.washEveryWears : -1, fd = c.washEveryDays ? s.daysSinceWash / c.washEveryDays : -1;
  if (s.progress === null) return null;
  const text = fw >= fd ? (s.wearsSinceWash <= c.washEveryWears ? `Надето ${s.wearsSinceWash} из ${c.washEveryWears}` : `Надето ${s.wearsSinceWash} (стирать после ${c.washEveryWears})`)
    : (s.daysSinceWash <= c.washEveryDays ? `Прошло ${s.daysSinceWash} из ${c.washEveryDays} дн.` : `Прошло ${s.daysSinceWash} дн. (стирать раз в ${c.washEveryDays})`);
  return { fraction: s.progress, text };
}

// ---------- итоги ----------
export const summary = (events, today = todayStr(), opts) => summaryOf(homeModel(events, today), opts);
export function summaryOf(m, { months = 6 } = {}) {
  const today = m.today;
  const own = m.items.filter(i => i.payload.status === 'active' || i.payload.status === 'stored');
  const ranked = (rows, key, dir = -1) => rows.sort((a, b) => dir * (key(a) - key(b)) || byName(a.item, b.item));
  const kinds = new Map();
  for (const i of own) {
    const k = kinds.get(i.payload.kind) ?? kinds.set(i.payload.kind, { kind: i.payload.kind, label: KIND_LABEL[i.payload.kind] ?? i.payload.kind, count: 0, qty: 0, valueMinor: 0 }).get(i.payload.kind);
    k.count++; k.qty += i.payload.qty || 1; k.valueMinor += i.payload.priceMinor || 0;
  }
  const order = KINDS.map(k => k[0]);
  const byKind = [...kinds.values()].sort((a, b) => b.count - a.count || order.indexOf(a.kind) - order.indexOf(b.kind));
  const rows = own.map(item => ({ item, stats: m.stats.get(item.id) }));
  const ym = today.slice(0, 7), monthKeys = Array.from({ length: months }, (_, i) => shiftMonth(ym, i - months + 1));
  const perMonth = new Map(monthKeys.map(k => [k, 0])), perKind = new Map();
  let totalWears = 0, totalWashes = 0;
  for (const i of m.items) for (const l of m.logs.get(i.id)) {
    const d = l.payload.date;
    if (!isYmd(d)) continue;
    if (l.payload.kind === 'wash') totalWashes++;
    else if (USE.has(l.payload.kind)) { totalWears++; perKind.set(i.payload.kind, (perKind.get(i.payload.kind) || 0) + 1); if (perMonth.has(d.slice(0, 7))) perMonth.set(d.slice(0, 7), perMonth.get(d.slice(0, 7)) + 1); }
  }
  const active = rows.filter(r => r.item.payload.status === 'active');
  return {
    today, count: own.length, qty: own.reduce((s, i) => s + (i.payload.qty || 1), 0), stored: own.filter(i => i.payload.status === 'stored').length,
    valueMinor: own.reduce((s, i) => s + (i.payload.priceMinor || 0), 0), priced: own.filter(i => i.payload.priceMinor !== null && i.payload.priceMinor !== undefined).length,
    byKind, totalWears, totalWashes,
    mostWorn: ranked(rows.filter(r => r.stats.wears > 0), r => r.stats.wears).slice(0, 5),
    cheapest: ranked(rows.filter(r => r.stats.costPerWear !== null && r.stats.wears >= 3), r => r.stats.costPerWear, 1).slice(0, 5),
    neverUsed: ranked(active.filter(r => TRACKED.has(r.item.payload.kind) && r.stats.lastUsed === null && r.stats.ageDays > NEVER_USED_DAYS), r => r.stats.ageDays),
    laundry: laundryOf(m).due,
    warranties: own.map(item => ({ item, daysLeft: item.payload.warranty ? daysBetween(today, item.payload.warranty) : null })).filter(r => r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= WARRANTY_DAYS)
      .sort((a, b) => a.daysLeft - b.daysLeft || byName(a.item, b.item)),
    wearsByMonth: monthKeys.map(k => ({ ym: k, wears: perMonth.get(k) })),
    wearsByKind: [...perKind].map(([kind, wears]) => ({ kind, label: KIND_LABEL[kind] ?? kind, wears })).sort((a, b) => b.wears - a.wears || order.indexOf(a.kind) - order.indexOf(b.kind)),
  };
}

// ---------- поиск ----------
const wordsOf = s => normalize(s).split(/[^a-zа-я0-9]+/).filter(Boolean);
// Слова близки, если запрос — начало слова или совпадает с ним почти до конца («куртки» — «куртка», «носков» — «носки»).
// «Беглая» гласная: «носок» — «носки», «ботинок» — «ботинки» (у обоих слов пробуем вариант без гласной).
const forms = w => (w.length >= 5 && /[ое]к$/.test(w) ? [w, `${w.slice(0, -2)}к`] : [w]);
function close(q, w) {
  if (w.startsWith(q)) return true;
  const m = Math.min(q.length, w.length);
  let n = 0;
  while (n < m && q[n] === w[n]) n++;
  return (n >= 4 && n >= m - 1) || (n === w.length && n >= 3 && q.length - n <= 2);
}
export function searchItems(items, query) {
  const qs = wordsOf(query).filter(w => w.length >= 2);
  if (!qs.length) return [...items];
  const out = [];
  items.forEach((item, order) => {
    const p = item.payload;
    const fields = [[5, wordsOf(p.name)], [3, wordsOf(`${KIND_LABEL[p.kind] ?? ''} ${KIND_WORDS[p.kind] ?? ''} ${(p.tags ?? []).join(' ')}`)], [2, wordsOf([p.place, p.brand, p.color, p.size, p.material].join(' '))], [1, wordsOf(p.note)]];
    let score = 0;
    for (const q of qs) {
      const w = Math.max(0, ...fields.map(([weight, ws]) => (ws.some(x => forms(q).some(f => forms(x).some(g => close(f, g)))) ? weight : 0)));
      if (!w) return;
      score += w;
    }
    out.push({ item, score, order });
  });
  return out.sort((a, b) => b.score - a.score || a.order - b.order).map(x => x.item);
}
// Места, которые уже встречались (самые частые первыми): подсказки для поля «Где лежит».
export function placesOf(items) {
  const m = new Map();
  for (const i of items) if (i.payload.place) m.set(i.payload.place, (m.get(i.payload.place) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru')).map(([p]) => p);
}

// ---------- растения ----------
// Растение — вещь с правилом «поливать каждые N дней» (необязательное поле waterEveryDays). Отметка «полил» — запись itemlog вида water.
export const isPlant = item => Number.isInteger(item?.payload?.waterEveryDays);
export function waterState(item, logs, today) {
  const every = item?.payload?.waterEveryDays;
  if (!Number.isInteger(every) || !isYmd(today)) return null;
  const days = logs.filter(l => l.payload?.kind === 'water' && isYmd(l.payload.date)).map(l => l.payload.date);
  const last = days.length ? days.sort().pop() : null;
  const base = last ?? item.payload.bought ?? (Number.isFinite(item.ts) ? todayStr(item.ts) : today);   // без отметок — от покупки или создания записи
  const since = Math.max(0, daysBetween(base, today));
  const left = every - since;
  return { every, last, since, left, due: left <= 0 };
}
// Все растения с их состоянием: сначала те, что пора полить.
export function plantsOf(m) {
  const rows = [];
  for (const item of m.items) {
    if (item.payload.status !== 'active') continue;
    const water = waterState(item, m.logs.get(item.id) ?? [], m.today);
    if (water) rows.push({ item, water });
  }
  return rows.sort((a, b) => a.water.left - b.water.left || byName(a.item, b.item));
}
export const plantsDue = m => plantsOf(m).filter(r => r.water.due);
export function waterText(w) {
  if (w.due) return w.left < 0 ? `Полив просрочен на ${-w.left} дн.` : 'Полить сегодня';
  return `Следующий полив через ${w.left} ${plural(w.left, 'день', 'дня', 'дней')}`;
}

// ---------- документы со сроком действия ----------
// Необязательное поле validUntil (обычно у вида «Документы»: паспорт, права, страховка). Напоминания за 90 и за 30 дней:
// warn — «пора готовиться», soon — «срок близко», expired — срок вышел.
export const DOC_WARN_DAYS = 90, DOC_SOON_DAYS = 30;
export function docState(item, today) {
  const until = item?.payload?.validUntil;
  if (!until || !isYmd(until) || !isYmd(today)) return null;
  const left = daysBetween(today, until);
  return { left, until, level: left < 0 ? 'expired' : left <= DOC_SOON_DAYS ? 'soon' : left <= DOC_WARN_DAYS ? 'warn' : 'ok' };
}
export function docsExpiring(items, today, days = DOC_WARN_DAYS) {
  return items.filter(i => i.payload.status === 'active' || i.payload.status === 'stored')
    .map(item => ({ item, doc: docState(item, today) }))
    .filter(r => r.doc && r.doc.left <= days)
    .sort((a, b) => a.doc.left - b.doc.left || byName(a.item, b.item));
}
export function docText(d) {
  if (d.level === 'expired') return `Срок вышел ${-d.left} дн. назад`;
  if (d.left === 0) return 'Срок действия кончается сегодня';
  return `Действует ещё ${d.left} ${plural(d.left, 'день', 'дня', 'дней')}`;
}

// ---------- обслуживание техники ----------
// Интервал ТО (необязательное поле serviceEveryDays) считается от последней записи «ремонт» (itemlog repair) в истории вещи;
// если ремонта не было — от даты покупки или создания записи.
export function serviceState(item, logs, today) {
  const every = item?.payload?.serviceEveryDays;
  if (!Number.isInteger(every) || !isYmd(today)) return null;
  const days = logs.filter(l => l.payload?.kind === 'repair' && isYmd(l.payload.date)).map(l => l.payload.date);
  const last = days.length ? days.sort().pop() : null;
  const base = last ?? item.payload.bought ?? (Number.isFinite(item.ts) ? todayStr(item.ts) : today);
  const since = Math.max(0, daysBetween(base, today));
  const left = every - since;
  return { every, last, since, left, due: left <= 0 };
}
export function serviceOf(m) {
  const rows = [];
  for (const item of m.items) {
    if (item.payload.status !== 'active') continue;
    const service = serviceState(item, m.logs.get(item.id) ?? [], m.today);
    if (service) rows.push({ item, service });
  }
  return rows.sort((a, b) => a.service.left - b.service.left || byName(a.item, b.item));
}
export const serviceDue = m => serviceOf(m).filter(r => r.service.due);          // список «пора обслужить»
export function serviceText(s) {
  if (s.due) return s.left < 0 ? `Обслуживание просрочено на ${-s.left} дн.` : 'Обслужить сегодня';
  return `Следующее ТО через ${s.left} ${plural(s.left, 'день', 'дня', 'дней')}`;
}

// ---------- кладовая и расходники ----------
// Кладовая (вид pantry): остаток (qty, «пришло»/«ушло» меняет его на ±1) и «съесть до» (необязательное поле useBy).
// Расходники (вид consumables: батарейки, лампочки): остаток и порог «кончается» (необязательное поле lowAt). Ноль — «кончилось».
export const PANTRY_SOON_DAYS = 7;
export function pantryState(item, today) {
  if (item?.payload?.kind !== 'pantry') return null;
  const qty = item.payload.qty ?? 1;
  const useBy = item.payload.useBy && isYmd(item.payload.useBy) ? item.payload.useBy : null;
  const left = useBy && isYmd(today) ? daysBetween(today, useBy) : null;
  return { qty, useBy, left, out: qty === 0, expired: left !== null && left < 0, soon: left !== null && left >= 0 && left <= PANTRY_SOON_DAYS };
}
export function supplyState(item) {
  if (item?.payload?.kind !== 'consumables') return null;
  const qty = item.payload.qty ?? 1, lowAt = item.payload.lowAt;
  return { qty, lowAt: Number.isInteger(lowAt) ? lowAt : null, out: qty === 0, low: qty > 0 && Number.isInteger(lowAt) && qty <= lowAt };
}
// «Пришло»/«ушло»: остаток на ±1, не ниже нуля у запасов и не ниже единицы у обычных вещей.
export function adjustQty(ev, delta, now = Date.now()) {
  const zeroOk = ev.payload.kind === 'pantry' || ev.payload.kind === 'consumables';
  const qty = Math.max(zeroOk ? 0 : 1, (ev.payload.qty ?? 1) + Math.trunc(delta));
  return updateItem(ev, { qty }, now);
}
export const pantryOf = items => items.filter(i => i.payload.kind === 'pantry' && (i.payload.status === 'active' || i.payload.status === 'stored'));
export const suppliesOf = items => items.filter(i => i.payload.kind === 'consumables' && (i.payload.status === 'active' || i.payload.status === 'stored'));

// ---------- сезоны ----------
// Сезонная карточка дома: весной (март–апрель) и осенью (сентябрь–октябрь) — пять коротких дел, каждое превращается в задачу одним нажатием.
export function homeSeason(today) {
  const m = Number(String(today).slice(5, 7));
  return m === 3 || m === 4 ? 'spring' : m === 9 || m === 10 ? 'autumn' : null;
}
export const SEASON_LABEL = { spring: 'Весна', autumn: 'Осень' };
export const SEASON_CHORES = {
  spring: ['Помыть окна', 'Разобрать балкон и убрать зимнее', 'Проверить и помыть фильтры (вода, вытяжка)', 'Проверить аптечку и сроки лекарств', 'Подготовить велосипед и сезонную обувь'],
  autumn: ['Проверить обогреватели и увлажнитель', 'Поменять батарейки в датчиках и пультах', 'Достать тёплую одежду и одеяла', 'Проверить окна и уплотнители перед холодами', 'Запастись лампочками, батарейками и средством от наледи'],
};
// Дело уже в задачах (есть открытая задача с таким же текстом) — кнопка не нужна второй раз.
export const choreOpen = (events, text) => events.some(e => e.type === 'task' && !e.payload.done && e.payload.text === text);

// Смена гардероба: два раза в год (апрель и октябрь) — карточка со списком вещей «на хранении» и массовой сменой статуса.
export const WARDROBE_MONTHS = [4, 10];
export function wardrobeSwap(today) {
  const m = Number(String(today).slice(5, 7));
  return WARDROBE_MONTHS.includes(m) ? (m === 4 ? 'spring' : 'autumn') : null;
}
export const storedClothes = items => items.filter(i => (i.payload.kind === 'clothes' || i.payload.kind === 'shoes') && i.payload.status === 'stored').sort(byName);

// ---------- гарантии ----------
// Гарантии, которые истекают (по умолчанию — в ближайшие WARRANTY_DAYS дней): сначала самые короткие.
export function warrantiesExpiring(items, today, days = WARRANTY_DAYS) {
  return items.filter(i => i.payload.status === 'active' || i.payload.status === 'stored')
    .map(item => ({ item, daysLeft: item.payload.warranty && isYmd(item.payload.warranty) && isYmd(today) ? daysBetween(today, item.payload.warranty) : null }))
    .filter(r => r.daysLeft !== null && r.daysLeft >= 0 && r.daysLeft <= days)
    .sort((a, b) => a.daysLeft - b.daysLeft || byName(a.item, b.item));
}

// ---------- общий бытовой список ----------
// Всё, что просит внимания в доме, одним проходом: полив растений, документы, ТО техники, кладовая, расходники, прививки питомца.
// count — сколько дел горит (для счётчика на вкладке «Быт»): просроченное и близкое, без дальних предупреждений.
export function householdAlerts(events, today = todayStr()) {
  const m = homeModel(events, today);
  const plants = plantsOf(m);
  const docs = docsExpiring(m.items, today);
  const service = serviceOf(m);
  const pantry = pantryOf(m.items).map(item => ({ item, pantry: pantryState(item, today) }));
  const supplies = suppliesOf(m.items).map(item => ({ item, supply: supplyState(item) }));
  const vaccines = vaccinesDue(events, today);
  const count = plants.filter(r => r.water.due).length
    + docs.filter(r => r.doc.level === 'soon' || r.doc.level === 'expired').length
    + service.filter(r => r.service.due).length
    + pantry.filter(r => r.pantry.expired || r.pantry.soon || r.pantry.out).length
    + supplies.filter(r => r.supply.out || r.supply.low).length
    + vaccines.length;
  return { today, model: m, plants, docs, service, pantry, supplies, vaccines, count };
}
