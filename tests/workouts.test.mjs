import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, templateById, startWorkout, addExercise, addSet, removeSet, finishWorkout, workoutsOf, activeWorkout, doneWorkouts, strengthDays, volumeOf, setsOf, lastSets, suggestion, personalRecords, newRecords, workoutRows, cleanSet, WEEKLY_STRENGTH_GOAL } from '../workouts.js';

const D = n => { const d = new Date(2026, 10, 11 + n, 12); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const T = n => new Date(2026, 10, 11 + n, 18).getTime();

function done(day, sets, name = 'Приседания', kind = 'reps', extra = {}) {
  let w = startWorkout({ name: 'Тест', date: D(day), now: T(day) });
  w = addExercise(w, name, kind);
  for (const s of sets) w = addSet(w, 0, s);
  w = { ...w, payload: { ...w.payload, exercises: [{ ...w.payload.exercises[0], target: extra.target ?? null }] } };
  return finishWorkout(w, { now: T(day) + 30 * 60000 });
}

test('шаблоны: у каждого есть упражнения, подходы и диапазоны; id уникальны', () => {
  assert.ok(TEMPLATES.length >= 4); assert.equal(new Set(TEMPLATES.map(t => t.id)).size, TEMPLATES.length);
  for (const t of TEMPLATES) { assert.ok(t.title && t.about && t.exercises.length); for (const e of t.exercises) { assert.ok(['reps', 'time', 'cardio'].includes(e.kind) && e.sets >= 1, e.name); if (e.kind === 'reps') assert.ok(e.reps[0] < e.reps[1]); } }
  assert.equal(templateById('home-a').exercises.length, 5); assert.equal(templateById('нет'), null);
  assert.equal(WEEKLY_STRENGTH_GOAL, 2);
});
test('тренировка: старт из шаблона, подходы, проверки значений, завершение', () => {
  let w = startWorkout({ templateId: 'home-a', date: D(0), now: T(0) });
  assert.equal(w.type, 'workout'); assert.equal(w.payload.done, false); assert.equal(w.payload.exercises.length, 5); assert.equal(w.payload.name, 'Дом: всё тело A');
  assert.throws(() => finishWorkout(w), /хотя бы один подход/);
  w = addSet(w, 0, { reps: '10', kg: '' }); w = addSet(w, 0, { reps: 9 }); w = addSet(w, 4, { sec: 30 });
  assert.deepEqual(w.payload.exercises[0].sets, [{ reps: 10 }, { reps: 9 }]); assert.deepEqual(w.payload.exercises[4].sets, [{ sec: 30 }]);
  assert.throws(() => addSet(w, 0, { reps: 0 }), /повторений/); assert.throws(() => addSet(w, 0, { reps: 9999 }), /Повторения/); assert.throws(() => addSet(w, 0, { reps: 5, kg: -1 }), /Вес/);
  assert.throws(() => addSet(w, 4, { reps: 5 }), /секунды/i); assert.throws(() => addSet(w, 9, { reps: 5 }), /Нет такого/);
  w = removeSet(w, 0, 1); assert.equal(w.payload.exercises[0].sets.length, 1);
  w = addExercise(w, '  Подтягивания  '); assert.equal(w.payload.exercises.at(-1).name, 'Подтягивания'); assert.throws(() => addExercise(w, ' '), /Назови/);
  const f = finishWorkout(w, { rpe: 7, note: ' тяжело ', now: T(0) + 25 * 60000 });
  assert.equal(f.payload.done, true); assert.equal(f.payload.minutes, 25); assert.equal(f.payload.rpe, 7); assert.equal(f.payload.note, 'тяжело');
  assert.equal(f.payload.exercises.length, 2, 'упражнения без подходов не сохраняются');
  assert.throws(() => finishWorkout(w, { rpe: 11 }), /от 1 до 10/);
  assert.equal(w.payload.done, false, 'исходная запись не меняется');
  assert.equal(setsOf(f), 2); assert.equal(volumeOf(done(0, [{ reps: 10, kg: 20 }, { reps: 8, kg: 25 }])), 400);
  assert.deepEqual(cleanSet({ reps: '8,0', kg: '22,5' }), { reps: 8, kg: 22.5 });
});
test('недельная цель: уникальные дни силовых за 7 дней; ходьба не считается', () => {
  const ev = [done(0, [{ reps: 10 }]), done(0, [{ reps: 8 }]), done(-3, [{ reps: 10 }]), done(-8, [{ reps: 10 }])];
  assert.equal(strengthDays(ev, D(0)), 2);
  let walk = startWorkout({ templateId: 'walk', date: D(-1), now: T(-1) });
  walk = addSet(walk, 0, { sec: 1800 }); walk = finishWorkout(walk, { now: T(-1) + 1800000 });
  assert.equal(strengthDays([...ev, walk], D(0)), 2, 'ходьба — не силовая');
  assert.equal(strengthDays([], D(0)), 0);
  const active = startWorkout({ date: D(0), now: T(0) });
  assert.equal(activeWorkout([...ev, active]).id, active.id); assert.equal(doneWorkouts([...ev, active]).length, 4);
  assert.equal(strengthDays([active], D(0)), 0, 'идущая тренировка пока не в счёт');
  assert.deepEqual(workoutsOf(ev).map(w => w.payload.date)[0], D(0));
});
test('подсказки прогрессии', () => {
  const ex = { name: 'Приседания', kind: 'reps', target: [8, 12] };
  assert.match(suggestion([], ex), /Начни с комфортного/);
  const mid = [done(-2, [{ reps: 9 }, { reps: 10 }, { reps: 8 }])];
  assert.match(suggestion(mid, ex), /В прошлый раз: 9, 10, 8\. Сегодня попробуй 11 повт\./);
  const top = [done(-2, [{ reps: 12 }, { reps: 12 }, { reps: 12 }])];
  assert.match(suggestion(top, ex), /перейди к более сложному варианту/);
  const weighted = [done(-2, [{ reps: 12, kg: 20 }, { reps: 12, kg: 20 }])];
  assert.match(suggestion(weighted, ex), /\+2,5 кг/);
  assert.match(suggestion([done(-1, [{ sec: 40 }], 'Приседания', 'time')], { name: 'Приседания', kind: 'time', target: [20, 45] }), /Сегодня попробуй 45 с/);
  assert.match(suggestion([], { name: 'Ходьба', kind: 'cardio' }), /20–30 минут/);
  assert.equal(lastSets(mid, 'приседания').sets.length, 3, 'имя без учёта регистра');
  assert.equal(lastSets(mid, 'Приседания', mid[0].id), null, 'текущую тренировку из истории исключаем');
});
test('рекорды: вес, повторения без веса, секунды; первая тренировка — не рекорд', () => {
  const a = done(-10, [{ reps: 10, kg: 20 }, { reps: 8, kg: 25 }]);
  const b = done(-3, [{ reps: 8, kg: 27.5 }]);
  const recs = personalRecords([a, b]);
  assert.equal(recs.length, 1); assert.equal(recs[0].maxKg, 27.5); assert.equal(recs[0].maxKgDate, D(-3));
  assert.deepEqual(newRecords([a], b), ['Приседания: 27.5 кг']);
  assert.deepEqual(newRecords([], a), [], 'первая запись — точка отсчёта');
  assert.deepEqual(newRecords([a], done(0, [{ reps: 5, kg: 20 }])), [], 'ниже рекорда — ничего');
  const pu1 = done(-5, [{ reps: 10 }]), pu2 = done(-1, [{ reps: 12 }]);
  assert.deepEqual(newRecords([pu1], pu2), ['Приседания: 12 повт.']);
});
test('таблица подходов для выгрузки', () => {
  const rows = workoutRows([done(-2, [{ reps: 10, kg: 20 }, { reps: 8 }])]);
  assert.deepEqual(rows[0], { date: D(-2), workout: 'Тест', exercise: 'Приседания', set: 1, reps: 10, kg: 20, sec: null, rpe: null });
  assert.equal(rows.length, 2); assert.equal(rows[1].kg, null);
});
