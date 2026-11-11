import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../events.js';
import { TRACKS, trackById, cardsOfTrack, cardFace, lessonToRevisit, markRevisited, makeLessonDone, makeUserCard, userCards, REVISIT_DAYS, fnv } from '../academy.js';
import { searchEvents } from '../search.js';
import { goalCheck, bmi } from '../health.js';
import { NOTE_TEMPLATES, templateText } from '../notes.js';
import { HABIT_TEMPLATES, makeHabit, makeHabitLog } from '../habits.js';
import { makeTask } from '../events.js';
import { startSick } from '../sick.js';
import { planDay, planText, rankTasks, taskRank } from '../planday.js';
import { makeRng } from '../stats.js';
import { makeRun } from '../bt-core.js';
import { weekdayEffect, weekdayInsight, normDrift, driftInsights, DRIFT_RECENT, DRIFT_BASE } from '../bt-analytics.js';

const en = trackById('english'), he = trackById('hebrew');
const deck = (t, q) => cardsOfTrack(t).find(c => c.kind === 'deck' && c.q === q);
const state = box => ({ card: 'x', box, due: '2026-11-14', first: '2026-11-01', last: null, reps: 3, lapses: 0, hist: [] });
// Ищем дату, на которую карточка идёт в нужную сторону (выбор детерминирован по карточке и дате).
const dateWhere = (card, st, pred) => { for (let i = 0; i < 40; i++) { const d = addDays('2026-11-01', i); if (pred(cardFace(card, st, d))) return d; } return null; };

test('вид карточки: новые и слабые слова не переворачиваются, выученные иногда идут в обратную сторону', () => {
  const word = deck(en, 'airport');
  assert.ok(word, 'слово из расширенной колоды на месте');
  for (const box of [0, 1]) for (let i = 0; i < 20; i++) assert.equal(cardFace(word, box ? state(box) : null, addDays('2026-11-01', i)).reversed, false);
  const rev = dateWhere(word, state(3), f => f.reversed), straight = dateWhere(word, state(3), f => !f.reversed);
  assert.ok(rev && straight, 'бывают оба направления');
  const f = cardFace(word, state(3), rev);
  assert.equal(f.front, word.a); assert.equal(f.back, 'airport');
  assert.deepEqual(cardFace(word, state(3), straight), { front: 'airport', back: word.a, reversed: false, translit: null });
  assert.deepEqual(cardFace(word, state(3), rev), cardFace(word, state(3), rev), 'один день — одно направление');
});

test('вид карточки: транскрипция иврита скрывается у хорошо выученных слов', () => {
  const c = deck(he, 'אני');
  assert.equal(c.a, 'ани — я');
  assert.deepEqual(cardFace(c, null, '2026-11-14'), { front: 'אני', back: 'ани — я', reversed: false, translit: null }, 'новое слово: всё как есть');
  assert.equal(cardFace(c, state(1), '2026-11-14').back, 'ани — я');
  const hidden = dateWhere(c, state(3), f => !f.reversed);
  assert.deepEqual(cardFace(c, state(3), hidden), { front: 'אני', back: 'я', reversed: false, translit: 'ани' });
  const reversed = dateWhere(c, state(3), f => f.reversed);
  assert.deepEqual(cardFace(c, state(3), reversed), { front: 'я', back: 'אני (ани)', reversed: true, translit: null }, 'при обратном направлении транскрипция идёт с ответом');
});

test('вид карточки: формы глаголов, корни, карточки уроков и свои остаются как есть', () => {
  const irregular = cardsOfTrack(en).find(c => c.kind === 'deck' && /^become /.test(c.q));
  const root = cardsOfTrack(he).find(c => c.kind === 'deck' && /^Корень כ-ת-ב/.test(c.q));
  assert.ok(irregular && root);
  for (let i = 0; i < 30; i++) {
    const d = addDays('2026-11-01', i);
    assert.equal(cardFace(irregular, state(4), d).reversed, false); assert.equal(cardFace(root, state(4), d).reversed, false);
    assert.deepEqual(cardFace(root, state(4), d), { front: root.q, back: root.a, reversed: false, translit: null });
  }
  const lessonCard = cardsOfTrack(en).find(c => c.kind === 'lesson');
  assert.deepEqual(cardFace(lessonCard, state(5), '2026-11-14'), { front: lessonCard.q, back: lessonCard.a, reversed: false, translit: null });
  const mine = userCards([makeUserCard('Столица Франции', 'Париж', 1, 'ucard:1')])[0];
  assert.deepEqual(cardFace(mine, state(5), '2026-11-14'), { front: 'Столица Франции', back: 'Париж', reversed: false, translit: null });
  assert.equal(fnv('a'), fnv('a'));
});

test('своя карточка: ассоциация хранится, показывается и ищется', () => {
  const u = makeUserCard('  Quay ', ' набережная ', 7, 'ucard:q', '  Произносится «ки» — «ки-ай» ');
  assert.equal(u.payload.hint, 'Произносится «ки» — «ки-ай»');
  assert.equal(makeUserCard('q', 'a', 1, 'ucard:z').payload.hint, undefined, 'пустая ассоциация не хранится');
  assert.equal(makeUserCard('q', 'a', 1, 'ucard:z', 'x'.repeat(500)).payload.hint.length, 200);
  assert.equal(userCards([u])[0].hint, 'Произносится «ки» — «ки-ай»'); assert.equal(userCards([makeUserCard('q', 'a', 1, 'ucard:z')])[0].hint, '');
  const found = searchEvents([u], 'ки-ай');
  assert.equal(found.length, 1); assert.equal(found[0].kind, 'Карточка');
});

test('возвращение к пройденным урокам: через месяц, самый давний первым, отметка «повторил»', () => {
  const today = '2026-11-14', t = TRACKS[0];
  assert.equal(lessonToRevisit([], today), null);
  const l1 = makeLessonDone(t, t.lessons[0], addDays(today, -40), 1), l2 = makeLessonDone(t, t.lessons[1], addDays(today, -REVISIT_DAYS), 2), l3 = makeLessonDone(t, t.lessons[2], addDays(today, -10), 3);
  assert.equal(lessonToRevisit([l3], today), null, 'десять дней — рано');
  assert.equal(lessonToRevisit([l2], today).days, REVISIT_DAYS, 'ровно месяц — пора');
  const r = lessonToRevisit([l1, l2, l3], today);
  assert.equal(r.lesson, t.lessons[0].id); assert.equal(r.days, 40); assert.equal(r.count, 2); assert.equal(r.track, t.id);
  const done = markRevisited(l1, today);
  assert.equal(done.payload.revisited, today); assert.equal(l1.payload.revisited, undefined, 'исходная запись не меняется');
  const next = lessonToRevisit([done, l2, l3], today);
  assert.equal(next.lesson, t.lessons[1].id, 'после отметки очередь идёт дальше');
  assert.equal(lessonToRevisit([done, l3], today), null);
  const later = lessonToRevisit([done, l3], addDays(today, REVISIT_DAYS));
  assert.equal(later.count, 2, 'через месяц после повторения снова пора обоим');
  assert.equal(later.lesson, t.lessons[2].id, 'но сначала тот, к которому не возвращались дольше');
  assert.equal(lessonToRevisit([{ ...l1, payload: { ...l1.payload, lesson: 'zz-99' } }], today), null, 'урок, которого нет в курсах, не предлагаем');
});

test('английский: диалоги, расширенная колода и корни иврита на месте', () => {
  assert.equal(en.lessons.length, 16);
  for (const id of ['en-13', 'en-14', 'en-15', 'en-16']) assert.ok(en.lessons.some(l => l.id === id), id);
  assert.ok(en.lessons.slice(12).every(l => l.cards.length >= 4 && /^Диалог:/.test(l.title)));
  const words = en.deck.filter(([q]) => /^[A-Za-z][A-Za-z' -]*$/.test(q));
  assert.ok(words.length >= 1000, `слов в колоде: ${words.length}`);
  assert.ok(en.deck.filter(([, a]) => /^[a-z]+ — [a-z]+$/.test(a)).length >= 100, 'форм неправильных глаголов больше ста');
  assert.equal(en.deck.length, new Set(en.deck.map(([q]) => q)).size, 'в колоде нет повторов');
  const roots = he.deck.filter(([q]) => /^Корень /.test(q));
  assert.ok(roots.length >= 12 && roots.every(([, a]) => / · /.test(a) && /[֐-׿]/.test(a)));
});

test('цель по весу: мягкие предупреждения, а не запреты', () => {
  assert.equal(bmi(48, 175), 15.7);
  const low = goalCheck(75, 175, 48);
  assert.equal(low.goalBmi, 15.7); assert.match(low.warnings[0], /Цель 48 кг при росте 175 см даёт ИМТ 15,7: это ниже ориентира 18,5\. Такую цель стоит обсудить с врачом\./);
  assert.match(low.warnings[1], /больше 30%/, 'и цель слишком далека от текущего веса');
  assert.deepEqual(goalCheck(80, 175, 72).warnings, [], 'разумная цель без предупреждений');
  assert.equal(goalCheck(80, 175, 72).goalBmi, 23.5);
  const far = goalCheck(120, 180, 78);
  assert.equal(far.warnings.length, 1); assert.match(far.warnings[0], /5–10%/);
  assert.deepEqual(goalCheck(null, 175, 70).warnings, [], 'без текущего веса сравнивать не с чем');
  assert.deepEqual(goalCheck(70, null, 60), { goalBmi: null, warnings: [] }, 'без роста ИМТ цели не считаем');
});

test('заготовки: план «от дивана» и привычка замещения', () => {
  const tpl = NOTE_TEMPLATES.find(t => t.id === 'couch');
  assert.ok(tpl && /8 недель/.test(tpl.title));
  const txt = templateText('couch', '2026-11-14');
  for (let w = 1; w <= 8; w++) assert.match(txt, new RegExp(`Неделя ${w}:`));
  assert.match(txt, /согласуй нагрузку с врачом/); assert.match(txt, /остановись и обратись к врачу/); assert.match(txt, /#бег/);
  assert.ok(HABIT_TEMPLATES.some(h => h.name === 'Одно замещение в день' && h.minimum && h.full));
  assert.equal(HABIT_TEMPLATES.length, 9);
});

test('план дня: порядок, время, переносы и режим болезни', () => {
  const today = '2026-11-14';
  const mk = (text, opts = {}, ts = 1) => makeTask(text, ts, opts);
  assert.deepEqual(planDay([], today), { items: [], dropped: [] });
  const tasks = [mk('Без срока', {}, 1), mk('Важное', { due: today, priority: 'high' }, 2), mk('Просроченное', { due: '2026-11-10' }, 3), mk('На завтра', { due: '2026-11-15' }, 4), mk('Сегодняшнее', { due: today }, 5)];
  assert.deepEqual(rankTasks(tasks, today).map(e => e.payload.text), ['Важное', 'Просроченное', 'Сегодняшнее', 'На завтра', 'Без срока']);
  assert.equal(taskRank(tasks[1], today), 1, 'важное на сегодня'); assert.equal(taskRank(tasks[2], today), 4, 'обычное просроченное'); assert.equal(taskRank(tasks[0], today), 7, 'без срока в конце');
  const p = planDay(tasks, today, { nowMinutes: 8 * 60 });
  assert.deepEqual(p.items.map(i => [i.from, i.to, i.text]), [['09:00', '09:50', 'Важное'], ['10:00', '10:50', 'Просроченное'], ['11:00', '11:50', 'Сегодняшнее']]);
  // днём блоки начинаются с ближайших десяти минут и не вылезают за конец дня
  const late = planDay(tasks, today, { nowMinutes: 14 * 60 + 5 });
  assert.deepEqual(late.items.map(i => i.from), ['14:10', '15:10', '16:10']);
  const evening = planDay(tasks, today, { nowMinutes: 17 * 60 });
  assert.deepEqual(evening.items.map(i => [i.from, i.to]), [['17:00', '17:50']]); assert.deepEqual(evening.dropped, ['Просроченное', 'Сегодняшнее']);
  assert.match(planText(evening, today), /^План дня 2026-11-14\n17:00–17:50  Важное\nНе уместилось: Просроченное; Сегодняшнее$/);
  // привычки: минимум в конце, если они не отмечены; в болезни только задачи
  const h = { ...makeHabit({ name: 'Зарядка' }, 1), payload: { ...makeHabit({ name: 'Зарядка' }, 1).payload, startDate: '2026-11-01' } };
  const withHabit = planDay([...tasks.slice(0, 1), h], today, { nowMinutes: 8 * 60 });
  assert.deepEqual(withHabit.items.map(i => [i.kind, i.from]), [['task', '09:00'], ['habit', '10:00']]); assert.match(withHabit.items[1].text, /Зарядка/);
  const done = planDay([h, makeHabitLog(h, today, 'min', 1)], today, { nowMinutes: 8 * 60 });
  assert.deepEqual(done.items, [], 'отмеченная привычка не попадает в план');
  const sick = { ...startSick([], { from: today }, new Date(2026, 10, 14, 12).getTime()) };
  assert.deepEqual(planDay([...tasks.slice(0, 1), h, sick], today, { nowMinutes: 8 * 60 }).items.map(i => i.kind), ['task'], 'в болезни привычки не предлагаем');
});

const ymdDate = (today, back) => addDays(today, -back);
function rowsByWeekday(today, days, effect, noise = 0.2, seed = 3) {
  const rng = makeRng(seed);
  return Array.from({ length: days }, (_, i) => { const date = ymdDate(today, i); const [y, m, d] = date.split('-').map(Number); const wd = new Date(y, m - 1, d).getDay(); return { date, composite: (effect[wd] ?? 0) + (rng() - 0.5) * noise * 2 }; });
}

test('дни недели: заметная разница находится, случайный шум нет', () => {
  const today = '2026-11-14';
  const effect = { 1: -1, 5: 1 };                                    // понедельник плохой, пятница хорошая
  const rows = rowsByWeekday(today, 84, effect);
  const w = weekdayEffect(rows);
  assert.ok(w.p < 0.01, `p = ${w.p}`); assert.equal(w.best.weekday, 5); assert.equal(w.worst.weekday, 1); assert.equal(w.days.length, 7); assert.ok(w.spread > 1.5);
  const ins = weekdayInsight(rows);
  assert.equal(ins.id, 'weekday'); assert.match(ins.text, /Лучше всего в пятницу \(\+1,\dσ, дней: 12\), хуже всего в понедельник \(−1,\dσ, дней: 12\)/); assert.match(ins.text, /p < 0,01/);
  assert.deepEqual(weekdayEffect(rows), w, 'результат повторяется (зерно фиксировано)');
  const flat = rowsByWeekday(today, 84, {}, 0.5, 11);
  assert.equal(weekdayInsight(flat), null, 'без эффекта молчим');
  assert.equal(weekdayEffect(rowsByWeekday(today, 10, effect)), null, 'мало дней — не считаем');
  assert.equal(weekdayInsight(rowsByWeekday(today, 84, { 1: -0.2, 5: 0.2 }, 0.05)), null, 'разница меньше полусигмы не интересна');
  assert.equal(weekdayEffect([{ date: today, composite: null }]), null);
});

function reactionRuns(today, plan) {                                 // plan(back) → качество; чем выше, тем быстрее реакция
  const runs = [];
  for (let back = 60; back >= 0; back--) {
    const date = ymdDate(today, back), [y, m, d] = date.split('-').map(Number), q = plan(back);
    if (q === null) continue;
    runs.push(makeRun({ mode: 'quick', startedAt: new Date(y, m - 1, d, 9).getTime(), durationMs: 1000, results: { reaction: { metrics: { n: 5, median: Math.round(360 - 20 * q), mean: 370, sd: 30, best: 300, lapses: 0, falseStarts: 0 }, ms: 1, trials: [] } } }));
  }
  return runs;
}

test('дрейф нормы: сдвиг «обычного» за две недели против прежних тридцати', () => {
  const today = '2026-11-14', rng = makeRng(4);
  const noise = () => (rng() - 0.5) * 0.6;
  const improved = reactionRuns(today, back => (back < DRIFT_RECENT ? 2.5 + noise() : noise()));
  const d = normDrift(improved, 'reaction', today);
  assert.ok(d.shift > 0.7 && d.z > 2.5, `сдвиг ${d.shift}, z ${d.z}`); assert.equal(d.nRecent, DRIFT_RECENT); assert.ok(d.nBase >= 8 && d.nBase <= DRIFT_BASE);
  assert.ok(d.recent < d.base, 'реакция стала быстрее: время меньше');
  const ins = driftInsights(improved, today);
  assert.equal(ins.length, 1); assert.equal(ins[0].id, 'drift-reaction'); assert.equal(ins[0].kind, 'good'); assert.match(ins[0].title, /«Реакция»: обычный уровень вырос/); assert.match(ins[0].text, /мс против \d+ мс за предыдущие 30 дней/);
  const worse = driftInsights(reactionRuns(today, back => (back < DRIFT_RECENT ? -2.5 + noise() : noise())), today);
  assert.equal(worse[0].kind, 'warn'); assert.match(worse[0].title, /снизился/); assert.match(worse[0].text, /сон, нагрузку и стресс/);
  assert.deepEqual(driftInsights(reactionRuns(today, () => noise()), today), [], 'ровный ряд — дрейфа нет');
  assert.equal(normDrift(reactionRuns(today, back => (back < 3 ? 1 : back < 14 ? null : noise())), 'reaction', today), null, 'мало недавних результатов');
  assert.equal(normDrift(reactionRuns(today, back => (back < 14 ? 1 : back > 20 ? null : noise())), 'reaction', today), null, 'мало прежних результатов');
  assert.equal(normDrift([], 'reaction', today), null);
});
