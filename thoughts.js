// Дневник мыслей (приём самопомощи из когнитивной терапии): ситуация → мысль → эмоция → другой взгляд → что изменилось.
// Это не лечение и не диагностика. При затяжной тревоге или подавленности нужна помощь специалиста.
import { isYmd, todayStr } from './events.js';

export const EMOTIONS = ['тревога', 'страх', 'злость', 'раздражение', 'грусть', 'обида', 'вина', 'стыд', 'усталость', 'другое'];
export const THOUGHT_NOTE = 'Это упражнение самопомощи, а не лечение. Если тревога или подавленность держатся больше двух недель и мешают жить, обратись к врачу или психотерапевту.';
export const PROMPTS = ['Что случилось? Где, когда, с кем?', 'Какая мысль пришла первой?', 'Что я почувствовал и насколько сильно (0–10)?', 'Какие факты за эту мысль и какие против?', 'Как на это посмотрел бы друг? Какая мысль точнее и добрее?', 'Что чувствую теперь (0–10)?'];
const clean = (s, n) => String(s ?? '').trim().slice(0, n);
const rate = (v, label) => { if (v === '' || v === null || v === undefined) return null; const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 10) throw new Error(`${label}: от 0 до 10`); return n; };

export function makeThought({ date, situation = '', thought, emotion = 'другое', before = null, alt = '', after = null }, now = Date.now()) {
  const d = date || todayStr(now);
  if (!isYmd(d)) throw new Error('bad date');
  const t = clean(thought, 600);
  if (t.length < 3) throw new Error('Запиши мысль (хотя бы несколько слов)');
  if (!EMOTIONS.includes(emotion)) throw new Error('Выбери эмоцию из списка');
  const b = rate(before, 'Сила эмоции сейчас'), a = rate(after, 'Сила эмоции после');
  const payload = { date: d, situation: clean(situation, 300), thought: t, emotion };
  if (b !== null) payload.before = b;
  if (clean(alt, 600)) payload.alt = clean(alt, 600);
  if (a !== null) payload.after = a;
  return { id: `th:${Math.floor(now).toString(36)}`, type: 'thought', ts: now, source: 'manual', confidence: 1, evidence: [], payload };
}
export const thoughtsOf = events => events.filter(e => e.type === 'thought').sort((a, b) => b.payload.date.localeCompare(a.payload.date) || b.ts - a.ts);
// Насколько стало легче (положительное число — легче). null, если нет двух оценок.
export const relief = t => (Number.isFinite(t.payload.before) && Number.isFinite(t.payload.after) ? t.payload.before - t.payload.after : null);
export function reliefStats(events, n = 20) {
  const r = thoughtsOf(events).slice(0, n).map(relief).filter(Number.isFinite);
  return r.length ? { n: r.length, avg: r.reduce((a, b) => a + b, 0) / r.length, helped: r.filter(x => x > 0).length } : null;
}
