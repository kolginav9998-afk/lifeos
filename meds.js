// Лекарства и добавки: список и отметка «принял сегодня». Приложение не советует дозы и не заменяет назначения врача.
import { isYmd, addDays, newId } from './events.js';

export const WHEN = { morning: 'утром', day: 'днём', evening: 'вечером', any: 'в любое время', asneeded: 'по необходимости' };
const ORDER = ['morning', 'day', 'evening', 'any', 'asneeded'];
export const MEDS_NOTE = 'Приложение только напоминает и хранит список. Дозы и схемы назначает врач; не меняй и не отменяй лекарства без его согласия.';
const clean = (s, n) => String(s ?? '').trim().slice(0, n);

export function makeMed({ name, dose = '', when = 'any', note = '' }, now = Date.now()) {
  const n = clean(name, 60);
  if (!n) throw new Error('Назови лекарство или добавку');
  if (!WHEN[when]) throw new Error('Выбери время приёма');
  return { id: `med:${newId()}`, type: 'med', ts: now, source: 'manual', confidence: 1, evidence: [], payload: { name: n, dose: clean(dose, 40), when, note: clean(note, 120), active: true } };
}
export const medsOf = events => events.filter(e => e.type === 'med').sort((a, b) => ORDER.indexOf(a.payload.when) - ORDER.indexOf(b.payload.when) || a.payload.name.localeCompare(b.payload.name));
export const medLogId = (medId, date) => `ml:${medId}:${date}`;
export function makeMedLog(medId, date, now = Date.now()) {
  if (!isYmd(date)) throw new Error('bad date');
  return { id: medLogId(medId, date), type: 'medlog', ts: now, source: 'manual', confidence: 1, evidence: [], payload: { medId, date, takenAt: now } };
}
export const takenOn = (events, date) => new Set(events.filter(e => e.type === 'medlog' && e.payload.date === date).map(e => e.payload.medId));

// Приём по дням: для активных лекарств «не по необходимости» — сколько дней из последних n отмечено.
export function adherence(events, today, n = 14) {
  const from = addDays(today, -(n - 1));
  const logs = events.filter(e => e.type === 'medlog' && e.payload.date >= from && e.payload.date <= today);
  return medsOf(events).filter(m => m.payload.active && m.payload.when !== 'asneeded').map(m => {
    const start = new Date(m.ts), startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const first = startStr > from ? startStr : from;
    const span = Math.max(1, Math.round((Date.parse(today) - Date.parse(first)) / 86400000) + 1);
    const taken = new Set(logs.filter(l => l.payload.medId === m.id).map(l => l.payload.date)).size;
    return { med: m, taken: Math.min(taken, span), of: span };
  });
}
