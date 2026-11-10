// Ядро данных: журнал событий. Задача — это Event типа "task".
// Поля source/confidence/evidence есть с первого дня (контроль достоверности).
// Даты — локальные строки 'YYYY-MM-DD' (без часовых поясов, чтобы "10-е число" было 10-м).

export const SCHEMA_VERSION = 1;
export const REPEAT_TYPES = ['daily', 'weekly', 'monthly'];

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
  return {
    id: newId(),
    type: 'task',
    ts: now,
    payload: { text: clean, done: false, doneAt: null, due, repeat },
    source: 'manual',   // manual | voice | ai | notification | import
    confidence: 1,      // 0..1
    evidence: [],
  };
}

// Изменить текст/срок/повтор открытой задачи. id, время создания и происхождение не меняются.
export function updateTask(ev, { text, due, repeat }, now = Date.now()) {
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
  return { ...ev, payload: { ...ev.payload, text: clean, due: nd, repeat: rep, editedAt: now } };
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

const byDue = (a, b) => (a.payload.due || '').localeCompare(b.payload.due || '') || a.ts - b.ts;

export function groupTasks(events, today) {
  const tasks = events.filter(e => e.type === 'task');
  const open = tasks.filter(e => !e.payload.done);
  const g = {
    overdue: open.filter(e => e.payload.due && e.payload.due < today).sort(byDue),
    today: open.filter(e => e.payload.due === today).sort(byDue),
    upcoming: open.filter(e => e.payload.due && e.payload.due > today).sort(byDue),
    nodate: open.filter(e => !e.payload.due).sort((a, b) => b.ts - a.ts),
    done: tasks.filter(e => e.payload.done).sort((a, b) => b.payload.doneAt - a.payload.doneAt),
  };
  g.openCount = open.length;
  return g;
}

// ---------- экспорт / импорт ----------
export function serialize(events, now = Date.now()) {
  return JSON.stringify({ app: 'lifeos', schema: SCHEMA_VERSION, exportedAt: now, events }, null, 2);
}

// Возвращает только валидные события; мусор отбрасывает и считает.
export function parseImport(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Это не JSON-файл'); }
  if (!data || data.app !== 'lifeos' || !Array.isArray(data.events)) {
    throw new Error('Это не резервная копия Life OS');
  }
  const valid = [];
  let skipped = 0;
  for (const e of data.events) {
    const ok = e && typeof e.id === 'string' && typeof e.type === 'string'
      && typeof e.ts === 'number' && e.payload && typeof e.payload === 'object';
    if (ok) valid.push({ source: 'import', confidence: 1, evidence: [], ...e });
    else skipped++;
  }
  return { events: valid, skipped };
}
