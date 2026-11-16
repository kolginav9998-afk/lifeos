// Дом: вещи и одежда. «Что у меня есть, где лежит, сколько раз надевал и стирал». Чистая логика: без интерфейса, хранилища и часов
// (сегодняшний день всегда приходит параметром, поэтому результат зависит только от данных).
// Записи: item — вещь (заменяется по id, как профиль), itemlog — отметка в истории вещи (id: ilog:<вещь>:<время>).
import { isYmd, daysBetween, todayStr } from './events.js';
import { MAX_MINOR, parseAmount, shiftMonth } from './money.js';
import { normalize } from './search.js';

export const KINDS = [['clothes', 'Одежда'], ['shoes', 'Обувь'], ['underwear', 'Бельё и носки'], ['bedding', 'Постельное бельё'], ['towels', 'Полотенца'], ['electronics', 'Техника'],
  ['kitchen', 'Кухня и посуда'], ['tools', 'Инструменты'], ['furniture', 'Мебель'], ['documents', 'Документы'], ['other', 'Другое']];
export const KIND_LABEL = Object.fromEntries(KINDS);
export const STATUS_LABEL = { active: 'В использовании', stored: 'Убрано на хранение', sold: 'Продано', gone: 'Выброшено или потеряно' };
export const HOW_LABEL = { machine: 'Машинная стирка', hand: 'Ручная стирка', dry: 'Химчистка', none: 'Не стирается' };
// Что можно отметить: кнопки на карточке зависят от вида вещи (одежду надевают, технику используют, мебель не отмечают).
export const LOG_NOUN = { wear: 'Надевание', wash: 'Стирка', use: 'Использование', repair: 'Ремонт', move: 'Перемещение', note: 'Заметка' };
const QUICK = { clothes: ['wear', 'wash'], shoes: ['wear', 'wash'], underwear: ['wear', 'wash'], towels: ['use', 'wash'], bedding: ['wash'], electronics: ['use'], kitchen: ['use'], tools: ['use'], furniture: [], documents: [], other: ['use'] };
export const quickLogs = kind => QUICK[kind] ?? ['use'];
const BUTTON = { wear: 'Надел', use: 'Использовал', repair: 'Починил', move: 'Переложил', note: 'Заметка' };
export const logButton = (log, kind) => (log === 'wash' ? (kind === 'shoes' ? 'Почистил' : 'Постирал') : BUTTON[log] ?? LOG_NOUN[log]);
const KIND_WORDS = { clothes: 'одежда вещи гардероб', shoes: 'обувь ботинки', underwear: 'нижнее белье трусы', bedding: 'постель простыня одеяло наволочка', towels: 'полотенце', electronics: 'электроника гаджет', kitchen: 'посуда', tools: 'инструмент', furniture: 'интерьер', documents: 'бумаги', other: '' };
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
];
export function templateFields(key) {
  const t = TEMPLATES.find(x => x.key === key);
  return t ? { name: t.name, kind: t.kind, qty: t.qty ?? 1, care: { ...(t.care ?? defaultCare(t.kind)) } } : null;
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
  return {
    name, kind: f.kind, place: clean(f.place, 60), brand: clean(f.brand, 40), color: clean(f.color, 30), size: clean(f.size, 20), material: clean(f.material, 40),
    qty: intOrNull(f.qty ?? 1, 1, 9999, 'Количество: целое число от 1 до 9999') ?? 1, bought, priceMinor: price, currency: 'RUB', warranty,
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
