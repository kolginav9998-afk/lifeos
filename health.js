// Показатели здоровья: вес, давление, пульс и т. д. Только числа и динамика, без диагнозов:
// это инструмент наблюдения, а не медицинская помощь.
import { isYmd, newId, todayStr, addDays, daysBetween } from './events.js';

const clean = (s, n) => String(s ?? '').trim().slice(0, n);

export const MEASURES = {
  weight: { label: 'Вес', unit: 'кг', min: 20, max: 400, dec: 1 },
  waist: { label: 'Талия', unit: 'см', min: 30, max: 250, dec: 1 },
  bp: { label: 'Давление', unit: 'мм рт. ст.', min: 30, max: 320, dec: 0, two: true },
  pulse: { label: 'Пульс', unit: 'уд/мин', min: 20, max: 250, dec: 0 },
  temp: { label: 'Температура', unit: '°C', min: 30, max: 45, dec: 1 },
  glucose: { label: 'Глюкоза', unit: 'ммоль/л', min: 1, max: 40, dec: 1 },
  steps: { label: 'Шаги', unit: 'шагов', min: 0, max: 200000, dec: 0 },
  custom: { label: 'Свой показатель', unit: '', min: -1e9, max: 1e9, dec: 2 },
};

export function parseNumber(v) {
  const s = String(v ?? '').replace(/[\s ]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error('Введи число, например 72,5');
  return Number(s);
}
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

export function makeMeasure({ kind, value, value2, date, time = '', note = '', name = '', unit = '' }, now = Date.now()) {
  const spec = MEASURES[kind];
  if (!spec) throw new Error('bad kind');
  const d = date || todayStr(now);
  if (!isYmd(d)) throw new Error('bad date');
  const t = String(time ?? '').trim();
  if (t && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error('Время: ЧЧ:ММ');
  const v = typeof value === 'number' ? value : parseNumber(value);
  if (v < spec.min || v > spec.max) throw new Error(`${spec.label}: от ${spec.min} до ${spec.max}`);
  const payload = { kind, date: d, value: round(v, spec.dec) };
  if (spec.two) {
    const v2 = typeof value2 === 'number' ? value2 : parseNumber(value2);
    if (v2 < spec.min || v2 > spec.max) throw new Error(`${spec.label}: от ${spec.min} до ${spec.max}`);
    if (v2 >= v) throw new Error('Верхнее давление должно быть больше нижнего');
    payload.value2 = round(v2, spec.dec);
  }
  payload.unit = kind === 'custom' ? clean(unit, 20) : spec.unit;
  if (kind === 'custom') { payload.name = clean(name, 40); if (!payload.name) throw new Error('Назови показатель'); }
  if (t) payload.time = t.padStart(5, '0');
  const nt = clean(note, 300);
  if (nt) payload.note = nt;
  return { id: newId(), type: 'measure', ts: now, payload, source: 'manual', confidence: 1, evidence: [] };
}
export function updateMeasure(ev, fields, now = Date.now()) {
  const n = makeMeasure({ kind: ev.payload.kind, ...fields }, now);
  return { ...ev, payload: { ...n.payload, editedAt: now } };
}

export const measureLabel = p => (p.kind === 'custom' ? p.name : MEASURES[p.kind]?.label ?? p.kind);
export const measureKey = p => (p.kind === 'custom' ? `custom:${p.name.toLowerCase()}` : p.kind);
export const formatMeasure = p => (p.value2 !== undefined ? `${p.value}/${p.value2}` : String(p.value).replace('.', ',')) + (p.unit ? ` ${p.unit}` : '');

export function measuresOf(events, key) {
  return events.filter(e => e.type === 'measure' && measureKey(e.payload) === key)
    .sort((a, b) => a.payload.date.localeCompare(b.payload.date) || (a.payload.time || '').localeCompare(b.payload.time || '') || a.ts - b.ts);
}
export function measureKeys(events) {
  const map = new Map();
  for (const e of events) if (e.type === 'measure') { const k = measureKey(e.payload); const cur = map.get(k) || { key: k, label: measureLabel(e.payload), kind: e.payload.kind, last: '' }; if (e.payload.date >= cur.last) cur.last = e.payload.date; map.set(k, cur); }
  return [...map.values()].sort((a, b) => b.last.localeCompare(a.last) || a.label.localeCompare(b.label));
}

// Ряд по дням: среднее за день. field: 'value' | 'value2'.
export function dailySeries(events, key, field = 'value') {
  const by = new Map();
  for (const e of measuresOf(events, key)) {
    const v = e.payload[field];
    if (!Number.isFinite(v)) continue;
    const a = by.get(e.payload.date) || [];
    a.push(v); by.set(e.payload.date, a);
  }
  return [...by].map(([date, a]) => ({ date, value: a.reduce((x, y) => x + y, 0) / a.length }));
}

export function movingAverage(series, window = 7) {
  return series.map((p, i) => {
    const from = Math.max(0, i - window + 1);
    const part = series.slice(from, i + 1);
    return { date: p.date, value: part.reduce((s, x) => s + x.value, 0) / part.length };
  });
}

// Линейный тренд по дням (изменение в неделю). Нужны хотя бы 3 точки на промежутке не менее 3 дней.
export function linearTrend(series) {
  if (series.length < 3) return null;
  const x0 = series[0].date;
  const xs = series.map(p => daysBetween(x0, p.date)), ys = series.map(p => p.value);
  if (xs.at(-1) - xs[0] < 3) return null;
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { perWeek: slope * 7, perDay: slope, r2: syy === 0 ? 0 : (sxy * sxy) / (sxx * syy), n };
}

// Изменение относительно значения «около N дней назад» (ближайшая запись не позже этой даты).
export function changeOver(series, days, today) {
  if (!series.length) return null;
  const last = series.at(-1);
  const target = addDays(today, -days);
  const ref = [...series].reverse().find(p => p.date <= target);
  if (!ref || ref.date === last.date) return null;
  return { delta: last.value - ref.value, from: ref.date, days: daysBetween(ref.date, last.date) };
}

// Ориентиры (не диагноз): ИМТ и отношение талии к росту.
export function bmi(weightKg, heightCm) {
  if (!(weightKg > 0) || !(heightCm >= 100 && heightCm <= 250)) return null;
  return round(weightKg / (heightCm / 100) ** 2, 1);
}
export function whtr(waistCm, heightCm) {
  if (!(waistCm > 0) || !(heightCm >= 100 && heightCm <= 250)) return null;
  return round(waistCm / heightCm, 2);
}
export const bmiNote = v => (v === null ? '' : v < 18.5 ? 'ниже ориентира 18,5–24,9' : v <= 24.9 ? 'в пределах ориентира 18,5–24,9' : 'выше ориентира 18,5–24,9');
export const whtrNote = v => (v === null ? '' : v < 0.5 ? 'ниже порога 0,5' : 'не ниже порога 0,5');

// Сон за последние дни по утренним отметкам.
export function sleepStats(events, today, days = 7, target = 8) {
  const from = addDays(today, -(days - 1));
  const nights = events.filter(e => e.type === 'checkin' && e.payload.slot === 'm' && Number.isFinite(e.payload.sleepHours) && e.payload.date >= from && e.payload.date <= today).map(e => e.payload.sleepHours);
  if (!nights.length) return null;
  const avg = nights.reduce((a, b) => a + b, 0) / nights.length;
  const sd = Math.sqrt(nights.reduce((s, x) => s + (x - avg) ** 2, 0) / nights.length);
  return { nights: nights.length, avg: round(avg, 2), sd: round(sd, 2), debt: round(Math.max(0, (target - avg) * nights.length), 1), target };
}

// Среднее давление за последние дни (только число, без оценки).
export function bpAverage(events, today, days = 7) {
  const from = addDays(today, -(days - 1));
  const rows = measuresOf(events, 'bp').filter(e => e.payload.date >= from && e.payload.date <= today);
  if (!rows.length) return null;
  return { n: rows.length, sys: round(rows.reduce((s, e) => s + e.payload.value, 0) / rows.length, 0), dia: round(rows.reduce((s, e) => s + e.payload.value2, 0) / rows.length, 0) };
}

export function ageFromBirthYear(year, now = Date.now()) {
  const y = Number(year);
  const age = new Date(now).getFullYear() - y;
  return Number.isInteger(y) && age >= 0 && age <= 130 ? age : null;
}

// ---- профиль здоровья (в записи profile) ----
export function healthProfile(events) {
  const p = events.find(e => e.type === 'profile' && e.id === 'profile')?.payload ?? {};
  return { heightCm: p.heightCm ?? null, birthYear: p.birthYear ?? null, sex: p.sex ?? '', sleepTarget: p.sleepTarget ?? 8, goalWeight: p.goalWeight ?? null };
}
export function checkHealthProfile(f) {
  const out = {};
  const num = (v, lo, hi, label) => { if (v === '' || v === null || v === undefined) return null; const n = parseNumber(v); if (n < lo || n > hi) throw new Error(`${label}: от ${lo} до ${hi}`); return n; };
  out.heightCm = num(f.heightCm, 100, 250, 'Рост');
  out.birthYear = f.birthYear === '' || f.birthYear == null ? null : (() => { const n = parseNumber(f.birthYear); if (!Number.isInteger(n) || n < 1900 || n > new Date().getFullYear()) throw new Error('Год рождения указан неверно'); return n; })();
  out.sex = ['m', 'f', ''].includes(f.sex) ? f.sex : '';
  out.sleepTarget = num(f.sleepTarget, 4, 12, 'Цель сна') ?? 8;
  out.goalWeight = num(f.goalWeight, 20, 400, 'Целевой вес');
  return out;
}

// CSV всех измерений (для Excel).
export function measuresToCsv(events) {
  const rows = events.filter(e => e.type === 'measure').sort((a, b) => a.payload.date.localeCompare(b.payload.date) || (a.payload.time || '').localeCompare(b.payload.time || ''));
  const esc = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [['Дата', 'Время', 'Показатель', 'Значение', 'Значение 2', 'Единицы', 'Комментарий'].join(';')];
  for (const e of rows) { const p = e.payload; lines.push([p.date, p.time ?? '', measureLabel(p), String(p.value).replace('.', ','), p.value2 === undefined ? '' : String(p.value2).replace('.', ','), p.unit, p.note ?? ''].map(esc).join(';')); }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
