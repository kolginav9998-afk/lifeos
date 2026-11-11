// Большая база: 50 000 записей. Главные операции не должны становиться медленными (ловим случайную квадратичность).
import test from 'node:test';
import assert from 'node:assert/strict';
import { serialize, parseImport, groupTasks, makeTask, addDays } from '../events.js';
import { searchEvents } from '../search.js';
import { dataChecks } from '../datacheck.js';
import { toMarkdown } from '../export.js';
import { buildExport } from '../bt-export.js';
import { insights } from '../bt-analytics.js';
import { importPlan } from '../archive.js';
import { skillGroups, lessonSkillStatus, makeSkill } from '../skills.js';
import { activeHabits, makeHabit, makeHabitLog } from '../habits.js';
import { weekReview } from '../review.js';
import { planReminders } from '../reminders.js';
import { planDay } from '../planday.js';
import { todayLoad, makeSrsEvent, cardsOfTrack, TRACKS, makeLessonDone } from '../academy.js';
import { newState } from '../srs.js';
import { makeCheckin } from '../diary.js';
import { makeExpense } from '../money.js';
import { makeNote } from '../notes.js';
import { makeRun, makeRunEvent } from '../bt-core.js';
import { practiceWeek } from '../practice.js';
import { compareWeeks, topFactors } from '../bt-extra.js';
import { makeRng } from '../stats.js';

const TODAY = '2026-11-14', NOW = new Date('2026-11-14T12:00:00').getTime(), day = n => addDays(TODAY, -n);
const rng = makeRng(50000);
function build() {
  const out = [], pick = a => a[Math.floor(rng() * a.length)];
  for (let i = 0; i < 20000; i++) { const t = makeTask(`задача номер ${i} про ${pick(['работу', 'дом', 'учёбу', 'здоровье'])}`, NOW - i * 60000, { due: day(Math.floor(rng() * 400) - 30) }); if (i % 3) { t.payload.done = true; t.payload.doneAt = NOW - i * 1000; } out.push(t); }
  for (let i = 0; i < 8000; i++) out.push(makeNote(`заметка ${i}: ${pick(['идея', 'мысль', 'план', 'итог'])} #тег${i % 20}`, NOW - i * 3600000));
  for (let i = 0; i < 13000; i++) out.push(makeExpense({ amount: 10000 + Math.floor(rng() * 500000), category: pick(['Еда', 'Транспорт', 'Дом', 'Здоровье']), date: day(i % 700) }, NOW + i));
  const habits = Array.from({ length: 10 }, (_, i) => makeHabit({ name: `привычка ${i}`, days: i % 3 ? [] : [1, 3, 5] }, NOW - 800 * 86400000)); out.push(...habits);
  for (let d = 0; d < 700; d++) for (const h of habits) if (rng() < 0.6) out.push(makeHabitLog(h, day(d), rng() < 0.5 ? 'full' : 'min', NOW - d * 86400000));
  for (let d = 0; d < 1000; d++) { out.push(makeCheckin('m', day(d), { sleepHours: 5 + Math.round(rng() * 40) / 10, mood: 1 + Math.floor(rng() * 5), energy: 1 + Math.floor(rng() * 5), stress: 1 + Math.floor(rng() * 5) }, '', NOW - d * 86400000)); out.push(makeCheckin('e', day(d), { mood: 1 + Math.floor(rng() * 5), caffeine: Math.floor(rng() * 6), exercise: Math.floor(rng() * 60) }, '', NOW - d * 86400000 + 1)); }
  for (let d = 0; d < 400; d++) {
    const startedAt = new Date(`${day(d)}T09:00:00`).getTime(), q = rng() * 4 - 2, results = {};
    results.reaction = { metrics: { n: 5, median: Math.round(340 - 15 * q), mean: 360, sd: 30, best: 300, lapses: 0, falseStarts: 0 }, ms: 1, trials: [] };
    results.gonogo = { metrics: { n: 16, hits: 11, omissions: 1, commissions: 1, correctRejections: 3, accuracy: 0.87, inhibition: 0.75, medianRT: 400, dPrime: +(1.5 + 0.3 * q).toFixed(2) }, ms: 1, trials: [] };
    results.digits = { metrics: { forward: 6, backward: 4, total: Math.round(10 + q), attempts: 8 }, ms: 1, trials: [] };
    results.math = { metrics: { n: 12, correct: 10, accuracy: 0.83, meanMs: 3000, perMinute: +(9 + q).toFixed(1), maxLevel: 3 }, ms: 1, trials: [] };
    out.push(makeRunEvent(makeRun({ mode: 'quick', startedAt, durationMs: 300000, state: null, results }), startedAt));
  }
  const en = TRACKS[0], cards = cardsOfTrack(en);
  for (const l of en.lessons) out.push(makeLessonDone(en, l, day(100), NOW));
  for (const c of cards.slice(0, 900)) out.push(makeSrsEvent({ ...newState(c.id, day(90)), box: 1 + Math.floor(rng() * 6), reps: 5, last: day(2), due: day(-3), hist: [[day(2), 2], [day(9), 1]] }, NOW));
  for (let i = 0; i < 200; i++) out.push(makeSkill({ title: `навык ${i}`, area: `область ${i % 12}`, level: 1 + (i % 3), date: day(i) }, NOW));
  return out;
}
const events = build();
const time = fn => { const t0 = performance.now(); const r = fn(); return { r, ms: Math.round(performance.now() - t0) }; };
const times = {};
const check = (name, limit, fn, verify = () => {}) => test(`50 000 записей: ${name} быстрее ${limit} мс`, () => { const { r, ms } = time(fn); times[name] = ms; verify(r); assert.ok(ms < limit, `${name}: ${ms} мс (предел ${limit})`); });

test('база собрана: порядка пятидесяти тысяч записей', () => { assert.ok(events.length > 45000 && events.length < 70000, String(events.length)); });
check('сохранение и чтение архива', 6000, () => parseImport(serialize(events, NOW, { version: 'R3.10' })), r => { assert.equal(r.events.length, events.length); assert.equal(r.skipped, 0); });
check('план загрузки того же архива', 3000, () => importPlan(events, events), p => { assert.equal(p.same, events.length); assert.equal(p.fresh.length, 0); });
check('список задач по группам', 1500, () => groupTasks(events, TODAY), g => assert.ok(g.openCount > 1000));
check('поиск по всем данным', 3000, () => searchEvents(events, 'заметка 4999'), r => assert.ok(r.length >= 1));
check('проверка данных', 5000, () => dataChecks(events, TODAY, NOW), r => assert.ok(Array.isArray(r) && r.length));
check('читаемая выгрузка (Markdown)', 6000, () => toMarkdown(events), md => assert.ok(md.length > 100000));
check('выгрузка для аналитики (ZIP)', 12000, () => buildExport(events, NOW), r => assert.ok(r.zip.length > 10000));
check('аналитика: подсказки и связи', 12000, () => insights(events, NOW), r => assert.ok(Array.isArray(r)));
check('привычки: серии и регулярность', 3000, () => activeHabits(events, TODAY), r => assert.equal(r.length, 10));
check('итоги недели', 3000, () => weekReview(events, TODAY), r => assert.ok(r.habits.length >= 1));
check('напоминания', 3000, () => planReminders(events, NOW, { habitHour: 20, taskHour: 9 }), r => assert.ok(Array.isArray(r)));
check('план дня', 3000, () => planDay(events, TODAY, { nowMinutes: 600 }), r => assert.ok(r.items));
check('нагрузка карточек', 2000, () => todayLoad(events, TODAY), r => assert.ok(r.due >= 0));
check('навыки: группы и готовые из уроков', 2000, () => ({ g: skillGroups(events), s: lessonSkillStatus(events) }), r => assert.equal(r.g.length, 12));
check('практика за неделю', 2000, () => practiceWeek(events, TODAY), r => assert.ok(r.rows.length >= 1));
check('сравнение недель и факторы месяца', 12000, () => ({ w: compareWeeks(events, TODAY), f: topFactors(events, TODAY) }), r => assert.ok(r.w.rows.length > 3));
test('время операций в сводке (для отчёта)', t => { t.diagnostic(Object.entries(times).map(([k, v]) => `${k}: ${v} мс`).join('; ')); assert.ok(Object.keys(times).length >= 15); });
