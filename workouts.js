// Тренировки: журнал подходов, шаблоны, подсказки прогрессии, личные рекорды и недельная цель (силовые не меньше двух раз, как у ВОЗ).
// Тренировка хранится событием `workout`; пока она идёт, `done: false`, и каждый подход сразу записывается (данные переживают перезапуск).
import { isYmd, addDays, todayStr, newId } from './events.js';

export const WEEKLY_STRENGTH_GOAL = 2;
export const LIMITS = { reps: 500, kg: 1000, sec: 7200 };

// kind: 'reps' (повторения, при желании вес), 'time' (секунды), 'cardio' (минуты)
export const TEMPLATES = [
  { id: 'home-a', title: 'Дом: всё тело A', about: 'Без оборудования, около 25 минут. Останавливайся за 1–2 повтора до отказа.', exercises: [
    { name: 'Приседания', kind: 'reps', sets: 3, reps: [8, 15] }, { name: 'Отжимания (от стены, с колен или обычные)', kind: 'reps', sets: 3, reps: [6, 12] },
    { name: 'Тяга резинкой или рюкзаком', kind: 'reps', sets: 3, reps: [8, 12] }, { name: 'Подъём таза', kind: 'reps', sets: 3, reps: [10, 15] }, { name: 'Планка', kind: 'time', sets: 3, secs: [20, 45] }] },
  { id: 'home-b', title: 'Дом: всё тело B', about: 'Второй день недели: другие движения.', exercises: [
    { name: 'Выпады назад', kind: 'reps', sets: 3, reps: [8, 12] }, { name: 'Отжимания узким хватом или от стула', kind: 'reps', sets: 3, reps: [6, 12] },
    { name: 'Румынская тяга с рюкзаком', kind: 'reps', sets: 3, reps: [8, 12] }, { name: 'Супермен', kind: 'reps', sets: 3, reps: [10, 15] }, { name: 'Боковая планка', kind: 'time', sets: 2, secs: [15, 40] }] },
  { id: 'gym-base', title: 'Зал: базовая', about: 'Классическая схема 3×8–12. Вес подбирай так, чтобы оставалось 1–2 повтора в запасе.', exercises: [
    { name: 'Приседания со штангой', kind: 'reps', sets: 3, reps: [6, 10] }, { name: 'Жим лёжа', kind: 'reps', sets: 3, reps: [6, 10] }, { name: 'Тяга в наклоне', kind: 'reps', sets: 3, reps: [8, 12] },
    { name: 'Жим стоя', kind: 'reps', sets: 3, reps: [6, 10] }, { name: 'Планка', kind: 'time', sets: 3, secs: [30, 60] }] },
  { id: 'walk', title: 'Ходьба 30 минут', about: 'Быстрая ходьба: можно говорить, но не петь. Засчитывается как активность, не как силовая.', exercises: [{ name: 'Быстрая ходьба', kind: 'cardio', sets: 1 }] },
];
export const templateById = id => TEMPLATES.find(t => t.id === id) || null;

const clean = (s, n) => String(s ?? '').trim().slice(0, n);
const num = (v, max, label) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`${label}: от 0 до ${max}`);
  return Math.round(n * 100) / 100;
};
export function cleanSet(s, kind = 'reps') {
  const o = {};
  const reps = num(s.reps, LIMITS.reps, 'Повторения'), kg = num(s.kg, LIMITS.kg, 'Вес'), sec = num(s.sec, LIMITS.sec, 'Секунды');
  if (reps !== undefined) o.reps = Math.round(reps);
  if (kg !== undefined && kg > 0) o.kg = kg;
  if (sec !== undefined) o.sec = Math.round(sec);
  if (kind === 'reps' && !o.reps) throw new Error('Укажи число повторений');
  if (kind === 'time' && !o.sec) throw new Error('Укажи секунды');
  if (kind === 'cardio' && !o.sec && !o.reps) throw new Error('Укажи минуты');
  return o;
}

// Новая (идущая) тренировка из шаблона или пустая.
export function startWorkout({ templateId = null, name = '', date, now = Date.now() } = {}) {
  const t = templateId ? templateById(templateId) : null;
  const d = date || todayStr(now);
  if (!isYmd(d)) throw new Error('bad date');
  const title = clean(name, 80) || t?.title || 'Тренировка';
  return { id: `wk:${newId()}`, type: 'workout', ts: now, source: 'manual', confidence: 1, evidence: [],
    payload: { date: d, name: title, templateId: t?.id ?? null, startedAt: now, done: false,
      exercises: (t?.exercises ?? []).map(e => ({ name: e.name, kind: e.kind, target: e.reps ?? e.secs ?? null, plan: e.sets, sets: [] })) } };
}
export function addExercise(ev, name, kind = 'reps') {
  const n = clean(name, 80);
  if (!n) throw new Error('Назови упражнение');
  if (ev.payload.exercises.length >= 30) throw new Error('Слишком много упражнений');
  return { ...ev, payload: { ...ev.payload, exercises: [...ev.payload.exercises, { name: n, kind, target: null, plan: 3, sets: [] }] } };
}
export function addSet(ev, exIndex, set) {
  const ex = ev.payload.exercises[exIndex];
  if (!ex) throw new Error('Нет такого упражнения');
  if (ex.sets.length >= 20) throw new Error('Слишком много подходов');
  const s = cleanSet(set, ex.kind);
  const exercises = ev.payload.exercises.map((e, i) => (i === exIndex ? { ...e, sets: [...e.sets, s] } : e));
  return { ...ev, payload: { ...ev.payload, exercises } };
}
export function removeSet(ev, exIndex, setIndex) {
  const exercises = ev.payload.exercises.map((e, i) => (i === exIndex ? { ...e, sets: e.sets.filter((_, j) => j !== setIndex) } : e));
  return { ...ev, payload: { ...ev.payload, exercises } };
}
export function finishWorkout(ev, { rpe, note, now = Date.now() } = {}) {
  const logged = ev.payload.exercises.filter(e => e.sets.length);
  if (!logged.length) throw new Error('Запиши хотя бы один подход');
  const r = rpe === undefined || rpe === null || rpe === '' ? undefined : Number(rpe);
  if (r !== undefined && (!Number.isInteger(r) || r < 1 || r > 10)) throw new Error('Усилие: от 1 до 10');
  const minutes = Math.max(1, Math.min(300, Math.round((now - (ev.payload.startedAt || now)) / 60000)));
  const n = clean(note, 300);
  return { ...ev, payload: { ...ev.payload, exercises: logged, done: true, finishedAt: now, minutes, ...(r ? { rpe: r } : {}), ...(n ? { note: n } : {}) } };
}

export const workoutsOf = events => events.filter(e => e.type === 'workout').sort((a, b) => b.payload.date.localeCompare(a.payload.date) || b.ts - a.ts);
export const activeWorkout = events => workoutsOf(events).find(e => !e.payload.done) ?? null;
export const doneWorkouts = events => workoutsOf(events).filter(e => e.payload.done);
const isStrength = w => w.payload.exercises.some(e => e.kind !== 'cardio');

export function strengthDays(events, today, days = 7) {
  const from = addDays(today, -(days - 1));
  return new Set(doneWorkouts(events).filter(w => isStrength(w) && w.payload.date >= from && w.payload.date <= today).map(w => w.payload.date)).size;
}
export const volumeOf = w => w.payload.exercises.reduce((s, e) => s + e.sets.reduce((a, x) => a + (x.reps || 0) * (x.kg || 0), 0), 0);
export const setsOf = w => w.payload.exercises.reduce((s, e) => s + e.sets.length, 0);

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
// Последние подходы по упражнению (до указанной даты не включая «идущую» тренировку).
export function lastSets(events, name, excludeId = null) {
  for (const w of doneWorkouts(events)) {
    if (w.id === excludeId) continue;
    const ex = w.payload.exercises.find(e => sameName(e.name, name));
    if (ex && ex.sets.length) return { date: w.payload.date, sets: ex.sets };
  }
  return null;
}
// Подсказка на сегодня: либо +1 повторение, либо усложнение, когда верх диапазона достигнут во всех подходах.
export function suggestion(events, ex, excludeId = null) {
  const last = lastSets(events, ex.name, excludeId);
  if (ex.kind === 'cardio') return last ? `В прошлый раз: ${last.sets.map(s => s.sec ? Math.round(s.sec / 60) : s.reps).join(' + ')} мин. Добавь 2–3 минуты, если самочувствие хорошее.` : 'Начни с комфортных 20–30 минут.';
  if (!last) return ex.kind === 'time' ? 'Начни с комфортного времени и остановись до дрожи.' : 'Начни с комфортного веса или лёгкого варианта; остановись за 1–2 повтора до отказа.';
  const top = Math.max(...last.sets.map(s => (ex.kind === 'time' ? s.sec : s.reps) || 0));
  const kg = Math.max(0, ...last.sets.map(s => s.kg || 0));
  const hi = ex.target?.[1];
  const line = last.sets.map(s => (ex.kind === 'time' ? `${s.sec} с` : `${s.reps}${s.kg ? '×' + s.kg + ' кг' : ''}`)).join(', ');
  if (hi && last.sets.every(s => ((ex.kind === 'time' ? s.sec : s.reps) || 0) >= hi))
    return `В прошлый раз: ${line}. Верх диапазона достигнут во всех подходах — ${ex.kind === 'time' ? 'добавь 5–10 секунд' : kg ? `добавь вес (+2,5 кг)` : 'перейди к более сложному варианту'}.`;
  return `В прошлый раз: ${line}. Сегодня попробуй ${ex.kind === 'time' ? top + 5 + ' с' : Math.min(top + 1, hi || top + 1) + ' повт.'} в лучшем подходе.`;
}

// Личные рекорды по упражнениям: максимальный вес, максимум повторений (в т. ч. без веса), максимум секунд.
export function personalRecords(events) {
  const rec = new Map();
  for (const w of [...doneWorkouts(events)].reverse()) for (const ex of w.payload.exercises) for (const s of ex.sets) {
    const key = ex.name.trim().toLowerCase();
    const r = rec.get(key) || { name: ex.name, maxKg: 0, maxReps: 0, maxRepsDate: null, maxKgDate: null, maxSec: 0 };
    if ((s.kg || 0) > r.maxKg) { r.maxKg = s.kg; r.maxKgDate = w.payload.date; }
    if (!s.kg && (s.reps || 0) > r.maxReps) { r.maxReps = s.reps; r.maxRepsDate = w.payload.date; }
    if ((s.sec || 0) > r.maxSec) r.maxSec = s.sec;
    rec.set(key, r);
  }
  return [...rec.values()];
}
// Рекорды, поставленные в этой тренировке (по сравнению со всеми предыдущими).
export function newRecords(events, workout) {
  const before = personalRecords(events.filter(e => e.type !== 'workout' || e.id !== workout.id));
  const map = new Map(before.map(r => [r.name.trim().toLowerCase(), r]));
  const out = [];
  for (const ex of workout.payload.exercises) {
    const prev = map.get(ex.name.trim().toLowerCase());
    if (!prev) continue;                                    // первое выполнение — не рекорд, а точка отсчёта
    const kg = Math.max(0, ...ex.sets.map(s => s.kg || 0)), reps = Math.max(0, ...ex.sets.filter(s => !s.kg).map(s => s.reps || 0)), sec = Math.max(0, ...ex.sets.map(s => s.sec || 0));
    if (kg > prev.maxKg && prev.maxKg > 0) out.push(`${ex.name}: ${kg} кг`);
    else if (reps > prev.maxReps && prev.maxReps > 0) out.push(`${ex.name}: ${reps} повт.`);
    else if (sec > prev.maxSec && prev.maxSec > 0) out.push(`${ex.name}: ${sec} с`);
  }
  return out;
}

// Для выгрузки: длинная таблица подходов.
export function workoutRows(events) {
  const rows = [];
  for (const w of doneWorkouts(events).reverse()) w.payload.exercises.forEach(ex => ex.sets.forEach((s, i) => rows.push({ date: w.payload.date, workout: w.payload.name, exercise: ex.name, set: i + 1, reps: s.reps ?? null, kg: s.kg ?? null, sec: s.sec ?? null, rpe: w.payload.rpe ?? null })));
  return rows;
}
