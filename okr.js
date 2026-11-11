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

export function makeOkr({ title, why = '', due, krs = [] }, now = Date.now()) {
  const t = clean(title, 100);
  if (!t) throw new Error('Назови цель');
  const list = krs.filter(k => clean(k.text, 100)).map(k => ({ id: newId(), text: clean(k.text, 100), target: num(k.target, `«${clean(k.text, 30)}»`), unit: clean(k.unit, 12), current: 0 }));
  if (!list.length) throw new Error('Добавь хотя бы один измеримый результат');
  if (list.length > MAX_KRS) throw new Error(`Не больше ${MAX_KRS} результатов`);
  const created = todayStr(now);
  const d = due || quarterEnd(created);
  if (!isYmd(d)) throw new Error('Срок указан неверно');
  if (d <= created) throw new Error('Срок должен быть позже сегодняшнего дня');
  return { id: `okr:${newId()}`, type: 'okr', ts: now, source: 'manual', confidence: 1, evidence: [], payload: { title: t, why: clean(why, 300), due: d, created, krs: list, status: 'active' } };
}
export function updateKr(ev, krId, current) {
  const v = typeof current === 'number' ? current : Number(String(current ?? '').replace(/[\s ]/g, '').replace(',', '.'));
  if (!Number.isFinite(v) || v < 0 || v > 1e9) throw new Error('Значение: число не меньше нуля');
  if (!ev.payload.krs.some(k => k.id === krId)) throw new Error('Нет такого результата');
  return { ...ev, payload: { ...ev.payload, krs: ev.payload.krs.map(k => (k.id === krId ? { ...k, current: Math.round(v * 100) / 100 } : k)) } };
}
export const setOkrStatus = (ev, status) => { if (!['active', 'done', 'dropped'].includes(status)) throw new Error('bad status'); return { ...ev, payload: { ...ev.payload, status, closedDate: status === 'active' ? null : todayStr() } }; };
export const okrsOf = (events, status = null) => events.filter(e => e.type === 'okr' && (!status || e.payload.status === status)).sort((a, b) => a.payload.due.localeCompare(b.payload.due) || a.ts - b.ts);

export const krRatio = k => Math.min(1, k.current / k.target);
export const okrProgress = ev => { const ks = ev.payload.krs; return ks.length ? ks.reduce((s, k) => s + krRatio(k), 0) / ks.length : 0; };
// Ход времени и темп: впереди, по графику или отстаёшь (допуск 10 процентных пунктов).
export function okrPace(ev, today) {
  const p = ev.payload, total = Math.max(1, daysBetween(p.created, p.due)), elapsed = Math.max(0, Math.min(total, daysBetween(p.created, today)));
  const time = elapsed / total, prog = okrProgress(ev), daysLeft = daysBetween(today, p.due);
  const state = prog >= 1 ? 'done' : daysLeft < 0 ? 'overdue' : prog >= time + 0.1 ? 'ahead' : prog >= time - 0.1 ? 'on' : 'behind';
  return { time, progress: prog, daysLeft, state, text: { done: 'цель достигнута', overdue: 'срок прошёл', ahead: 'впереди графика', on: 'идёшь по графику', behind: 'отстаёшь от графика' }[state] };
}
export { addDays };
