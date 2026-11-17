// Цели на период (по мотивам OKR): цель с 1–5 измеримыми результатами. Прогресс считается по результатам и сравнивается с ходом времени.
import { isYmd, addDays, daysBetween, todayStr, newId } from './events.js';

const clean = (s, n) => String(s ?? '').trim().slice(0, n);
export const MAX_KRS = 5;

// Конец квартала, в котором находится дата.
export function quarterEnd(date) {
  const [y, m] = date.split('-').map(Number);
  const qm = Math.floor((m - 1) / 3) * 3 + 3;
  const d = new Date(y, qm, 0).getDate();
  return `${y}-${String(qm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function quarterLabel(date) { const [y, m] = date.split('-').map(Number); return `${Math.floor((m - 1) / 3) + 1}-й квартал ${y}`; }

const num = (v, label) => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[\s ]/g, '').replace(',', '.')); if (!Number.isFinite(n) || n <= 0 || n > 1e9) throw new Error(`${label}: число больше нуля`); return n; };


// ---------- автоподсчёт результата по журналу ----------
// У результата может быть необязательное правило auto: тогда значение считается запросом к журналу событий, руками не правится.
// Поле только добавляется: у старых записей auto нет, и они читаются как прежде (ADR-10).
export const AUTO_KINDS = { count: 'Количество записей', sum: 'Сумма по полю' };
// Приведение к единому виду; чужие или битые данные читаются как «без автоподсчёта» (null).
export function normalizeAuto(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = raw.kind === 'count' || raw.kind === 'sum' ? raw.kind : null;
  const type = clean(raw.type, 40);
  if (!kind || !/^[a-z][a-z0-9_]{0,39}$/.test(type)) return null;
  const field = clean(raw.field, 40);
  if (kind === 'sum' && !/^[A-Za-z][\w$]{0,39}$/.test(field)) return null;
  const has = v => v !== undefined && v !== null && v !== '';
  if ((has(raw.from) && !isYmd(raw.from)) || (has(raw.to) && !isYmd(raw.to))) return null;
  const from = has(raw.from) ? raw.from : null, to = has(raw.to) ? raw.to : null;
  if (from && to && from > to) return null;
  return { kind, type, ...(kind === 'sum' ? { field } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) };
}
// Описание правила человеческими словами: «количество записей workout» или «сумма amountMinor по записям goalmove».
export const autoText = a => !a ? '' : a.kind === 'count' ? `количество записей «${a.type}»` : `сумма ${a.field} по записям «${a.type}»`;
// Значение результата по журналу: записи нужного типа с датой в периоде (по умолчанию — период цели: от создания до срока).
export function krAutoValue(events, ev, k) {
  const a = k.auto;
  if (!a) return k.current;
  const from = a.from ?? ev.payload.created, to = a.to ?? ev.payload.due;
  let n = 0, sum = 0;
  for (const e of events) {
    if (e.type !== a.type) continue;
    const d = e.payload?.date;
    if (typeof d !== 'string' || d < from || d > to) continue;
    n++;
    if (a.kind === 'sum') { const v = Number(e.payload?.[a.field]); if (Number.isFinite(v)) sum += v; }
  }
  return a.kind === 'sum' ? sum : n;
}

export function makeOkr({ title, why = '', due, krs = [] }, now = Date.now()) {
  const t = clean(title, 100);
  if (!t) throw new Error('Назови цель');
  const list = krs.filter(k => clean(k.text, 100)).map(k => {
    const auto = normalizeAuto(k.auto);
    if (k.auto && !auto) throw new Error(`«${clean(k.text, 30)}»: проверь автоподсчёт — вид подсчёта, тип записи и поле суммы`);
    return { id: newId(), text: clean(k.text, 100), target: num(k.target, `«${clean(k.text, 30)}»`), unit: clean(k.unit, 12), current: 0, ...(auto ? { auto } : {}) };
  });
  if (!list.length) throw new Error('Добавь хотя бы один измеримый результат');
  if (list.length > MAX_KRS) throw new Error(`Не больше ${MAX_KRS} результатов`);
  const created = todayStr(now);
  const d = due || quarterEnd(created);
  if (!isYmd(d)) throw new Error('Срок указан неверно');
  if (d <= created) throw new Error('Срок должен быть позже сегодняшнего дня');
  return { id: `okr:${newId()}`, type: 'okr', ts: now, source: 'manual', confidence: 1, evidence: [], payload: { title: t, why: clean(why, 300), due: d, created, krs: list, status: 'active' } };
}
export function updateKr(ev, krId, current) {
  const kr = ev.payload.krs.find(k => k.id === krId);
  if (!kr) throw new Error('Нет такого результата');
  if (kr.auto) throw new Error('Это значение считается само по журналу, руками не правится');
  const v = typeof current === 'number' ? current : Number(String(current ?? '').replace(/[\s ]/g, '').replace(',', '.'));
  if (!Number.isFinite(v) || v < 0 || v > 1e9) throw new Error('Значение: число не меньше нуля');
  return { ...ev, payload: { ...ev.payload, krs: ev.payload.krs.map(k => (k.id === krId ? { ...k, current: Math.round(v * 100) / 100 } : k)) } };
}
export const setOkrStatus = (ev, status) => { if (!['active', 'done', 'dropped'].includes(status)) throw new Error('bad status'); return { ...ev, payload: { ...ev.payload, status, closedDate: status === 'active' ? null : todayStr() } }; };
export const okrsOf = (events, status = null) => events.filter(e => e.type === 'okr' && (!status || e.payload.status === status)).sort((a, b) => a.payload.due.localeCompare(b.payload.due) || a.ts - b.ts);

export const krRatio = k => Math.min(1, k.current / k.target);
export const okrProgress = ev => { const ks = ev.payload.krs; return ks.length ? ks.reduce((s, k) => s + krRatio(k), 0) / ks.length : 0; };
// Прогресс с учётом автоподсчёта: значение результата с auto берётся из журнала.
export const krLiveRatio = (events, ev, k) => Math.min(1, krAutoValue(events, ev, k) / k.target);
export const okrLiveProgress = (ev, events) => { const ks = ev.payload.krs; return ks.length ? ks.reduce((s, k) => s + krLiveRatio(events, ev, k), 0) / ks.length : 0; };
// Ход времени и темп: впереди, по графику или отстаёшь (допуск 10 процентных пунктов). events — журнал, если есть результаты с автоподсчётом.
export function okrPace(ev, today, events = null) {
  const p = ev.payload, total = Math.max(1, daysBetween(p.created, p.due)), elapsed = Math.max(0, Math.min(total, daysBetween(p.created, today)));
  const time = elapsed / total, prog = events ? okrLiveProgress(ev, events) : okrProgress(ev), daysLeft = daysBetween(today, p.due);
  const state = prog >= 1 ? 'done' : daysLeft < 0 ? 'overdue' : prog >= time + 0.1 ? 'ahead' : prog >= time - 0.1 ? 'on' : 'behind';
  return { time, progress: prog, daysLeft, state, text: { done: 'цель достигнута', overdue: 'срок прошёл', ahead: 'впереди графика', on: 'идёшь по графику', behind: 'отстаёшь от графика' }[state] };
}
export { addDays };
