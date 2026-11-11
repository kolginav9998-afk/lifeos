// Ядро данных: журнал событий. Задача — это Event типа "task".
// Поля source/confidence/evidence есть с первого дня (контроль достоверности).
// Даты — локальные строки 'YYYY-MM-DD' (без часовых поясов, чтобы "10-е число" было 10-м).

import { MIGRATIONS, migrateEvents } from './migrate.js';
export const SCHEMA_VERSION = 1;
export const REPEAT_TYPES = ['daily', 'weekly', 'monthly'];
export const MAX_TEXT = 500;

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ---------- даты ----------
const pad = n => String(n).padStart(2, '0');
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

export function todayStr(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function isYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
}
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export function addDays(s, n) {
  const d = parse(s); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m: 1..12

export function nextDue(due, repeat) {
  if (!isYmd(due) || !repeat) throw new Error('bad nextDue args');
  if (repeat.type === 'daily') return addDays(due, 1);
  if (repeat.type === 'weekly') return addDays(due, 7);
  if (repeat.type === 'monthly') {
    const [y, m, d] = due.split('-').map(Number);
    const want = repeat.day ?? d;
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    return `${ny}-${pad(nm)}-${pad(Math.min(want, daysInMonth(ny, nm)))}`;
  }
  throw new Error('unknown repeat type');
}

export function dueLabel(due, today) {
  if (!due) return { text: '', cls: '' };
  const diff = daysBetween(today, due);
  if (diff < 0) {
    const n = -diff;
    return { text: `просрочено на ${n} дн.`, cls: 'overdue' };
  }
  if (diff === 0) return { text: 'сегодня', cls: 'today' };
  if (diff === 1) return { text: 'завтра', cls: '' };
  const [, m, d] = due.split('-').map(Number);
  return { text: `${d} ${MONTHS[m - 1]}`, cls: '' };
}
export function repeatLabel(repeat) {
  if (!repeat) return '';
  return { daily: 'каждый день', weekly: 'каждую неделю', monthly: 'каждый месяц' }[repeat.type] || '';
}

// ---------- задачи ----------
export function makeTask(text, now = Date.now(), opts = {}) {
  const clean = String(text ?? '').trim();
  if (!clean) throw new Error('empty task');
  let due = opts.due || null;
  if (due && !isYmd(due)) throw new Error('bad date');
  let repeat = null;
  if (opts.repeat) {
    if (!REPEAT_TYPES.includes(opts.repeat)) throw new Error('bad repeat');
    if (!due) due = todayStr(now);         // повтор без даты — начинаем с сегодня
    repeat = { type: opts.repeat };
    if (opts.repeat === 'monthly') repeat.day = Number(due.split('-')[2]);
  }
  if (clean.length > MAX_TEXT) throw new Error('text too long');
  return {
    id: newId(),
    type: 'task',
    ts: now,
    payload: { text: clean, done: false, doneAt: null, due, repeat, priority: opts.priority === 'high' ? 'high' : 'normal' },
    source: 'manual',   // manual | voice | ai | notification | import
    confidence: 1,      // 0..1
    evidence: [],
  };
}

// Изменить текст/срок/повтор открытой задачи. id, время создания и происхождение не меняются.
export function updateTask(ev, { text, due, repeat, priority }, now = Date.now()) {
  const clean = String(text ?? '').trim();
  if (!clean) throw new Error('empty task');
  let nd = due || null;
  if (nd && !isYmd(nd)) throw new Error('bad date');
  let rep = null;
  if (repeat) {
    if (!REPEAT_TYPES.includes(repeat)) throw new Error('bad repeat');
    if (!nd) nd = todayStr(now);
    rep = { type: repeat };
    if (repeat === 'monthly') rep.day = Number(nd.split('-')[2]);
  }
  if (clean.length > MAX_TEXT) throw new Error('text too long');
  const pr = priority === undefined ? (ev.payload.priority || 'normal') : (priority === 'high' ? 'high' : 'normal');
  return { ...ev, payload: { ...ev.payload, text: clean, due: nd, repeat: rep, priority: pr, editedAt: now } };
}

// Отметить сделанной. Для повторяющейся создаётся следующая задача.
export function completeTask(ev, now = Date.now()) {
  const updated = { ...ev, payload: { ...ev.payload, done: true, doneAt: now } };
  const { due, repeat } = ev.payload;
  if (!repeat || !due) return { updated, next: null };
  const today = todayStr(now);
  let nd = nextDue(due, repeat);
  while (nd <= today) nd = nextDue(nd, repeat);   // просроченное не плодит хвост из прошлого
  const next = {
    ...makeTask(ev.payload.text, now, {}),
    payload: { text: ev.payload.text, done: false, doneAt: null, due: nd, repeat },
  };
  updated.payload.spawnedId = next.id;
  return { updated, next };
}

// Вернуть в работу. Если выше была создана следующая — вернём её id, чтобы убрать.
export function reopenTask(ev) {
  const { spawnedId, ...rest } = ev.payload;
  return { updated: { ...ev, payload: { ...rest, done: false, doneAt: null } }, removeId: spawnedId || null };
}

const prio = e => (e.payload.priority === 'high' ? 0 : 1);
const byDue = (a, b) => (a.payload.due || '').localeCompare(b.payload.due || '') || prio(a) - prio(b) || a.ts - b.ts;

export function groupTasks(events, today) {
  const tasks = events.filter(e => e.type === 'task');
  const open = tasks.filter(e => !e.payload.done);
  const g = {
    overdue: open.filter(e => e.payload.due && e.payload.due < today).sort(byDue),
    today: open.filter(e => e.payload.due === today).sort(byDue),
    upcoming: open.filter(e => e.payload.due && e.payload.due > today).sort(byDue),
    nodate: open.filter(e => !e.payload.due).sort((a, b) => prio(a) - prio(b) || b.ts - a.ts),
    done: tasks.filter(e => e.payload.done).sort((a, b) => b.payload.doneAt - a.payload.doneAt),
  };
  g.openCount = open.length;
  return g;
}

// ---------- экспорт / импорт ----------
export function serialize(events, now = Date.now()) {
  return JSON.stringify({ app: 'lifeos', schema: SCHEMA_VERSION, exportedAt: now, events }, null, 2);
}

// ---------- профиль ----------
export const PROFILE_ID = 'profile';
export function makeProfile(name, now = Date.now(), prev = null, extra = {}) {
  const base = prev?.payload ?? {};
  const clean = String(name ?? base.name ?? '').trim().slice(0, 60);
  return {
    id: PROFILE_ID, type: 'profile', ts: prev?.ts ?? now,
    // accountId — задел под будущую синхронизацию; сейчас нигде не отправляется. Поля здоровья (рост, цель сна…) сохраняются при правках.
    payload: { ...base, ...extra, name: clean, accountId: base.accountId || newId(), updatedAt: now },
    source: 'manual', confidence: 1, evidence: [],
  };
}
export const profileOf = events => events.find(e => e.type === 'profile' && e.id === PROFILE_ID) || null;

// ---------- импорт: только проверенные события ----------
export const MAX_IMPORT_EVENTS = 200000;
const TYPE_RE = /^[a-z][a-z0-9_]{0,39}$/;
const isPlain = o => !!o && typeof o === 'object' && !Array.isArray(o);

export function cleanEvent(e) {
  if (!isPlain(e)) return null;
  if (typeof e.id !== 'string' || e.id.length < 1 || e.id.length > 100) return null;
  if (typeof e.type !== 'string' || !TYPE_RE.test(e.type)) return null;
  if (typeof e.ts !== 'number' || !Number.isFinite(e.ts)) return null;
  if (!isPlain(e.payload)) return null;
  return {
    id: e.id, type: e.type, ts: e.ts, payload: e.payload,
    source: typeof e.source === 'string' ? e.source.slice(0, 20) : 'import',
    confidence: typeof e.confidence === 'number' && e.confidence >= 0 && e.confidence <= 1 ? e.confidence : 1,
    evidence: Array.isArray(e.evidence) ? e.evidence.slice(0, 50) : [],
    ...(Number.isSafeInteger(e.u) && e.u >= 0 ? { u: e.u } : {}),
  };
}

// Возвращает только валидные события; мусор отбрасывает и считает. Копии старых схем приводятся к текущей (migrate.js).
// Параметры нужны тестам: подставить свою версию схемы и свои миграции.
export function parseImport(text, { schemaVersion = SCHEMA_VERSION, migrations = MIGRATIONS } = {}) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Это не JSON-файл'); }
  if (!data || data.app !== 'lifeos' || !Array.isArray(data.events)) {
    throw new Error('Это не резервная копия Life OS');
  }
  const from = Number.isFinite(data.schema) ? data.schema : 1;           // у самых первых копий поля schema нет
  if (from > schemaVersion) throw new Error('Копия сделана более новой версией Life OS. Обнови приложение и восстанови копию снова.');
  if (data.events.length > MAX_IMPORT_EVENTS) throw new Error('Слишком много записей в файле');
  const valid = [];
  let skipped = 0;
  for (const e of data.events) {
    const c = cleanEvent(e);
    if (c) valid.push(c); else skipped++;
  }
  if (from >= schemaVersion) return { events: valid, skipped, migrated: [] };
  let moved;
  try { moved = migrateEvents(valid, from, schemaVersion, migrations); } catch (e) { throw new Error(`Не удалось привести копию к текущему формату: ${e.message}`); }
  const events = [];
  for (const e of moved.events) {
    const c = cleanEvent(e);                                              // миграция не должна нарушить правила записей
    if (c) events.push(c); else skipped++;
  }
  return { events, skipped, migrated: moved.applied };
}
