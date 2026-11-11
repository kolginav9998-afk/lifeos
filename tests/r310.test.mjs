import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../events.js';
import { TRACKS, cardsOfTrack, makeLessonDone, makeSrsEvent, makeUserCard, lessonGoal } from '../academy.js';
import { LESSON_GOALS } from '../c-goals.js';
import { newState } from '../srs.js';
import { makeSpeak } from '../speaking.js';
import { makeCheckin } from '../diary.js';
import { makeFocus } from '../focus.js';
import { makeRun, makeRunEvent } from '../bt-core.js';
import { makeRng } from '../stats.js';
import { normBand, variability, variabilityTrend, CV_TESTS, comparePeriods, compareWeeks, compare90, topFactors, eventMarks } from '../bt-extra.js';
import { practiceBy, practiceWeek, makeLearnGoal, learnGoals, goalId, plateauInfo, CARD_SECONDS, GOAL_MIN, GOAL_MAX } from '../practice.js';

const TODAY = '2026-11-14', day = n => addDays(TODAY, n);
const english = TRACKS.find(t => t.id === 'english'), hebrew = TRACKS.find(t => t.id === 'hebrew');
const state = (cardId, first, hist) => ({ ...newState(cardId, first), reps: hist.length, last: hist.at(-1)?.[0] ?? null, hist });

// ---------- цели уроков ----------
test('цели уроков: у каждого урока есть цель, цели аккуратные и без лишних', () => {
  const lessonIds = new Set(TRACKS.flatMap(t => t.lessons.map(l => l.id)));
  const missing = [...lessonIds].filter(id => !LESSON_GOALS[id]);
  assert.deepEqual(missing, [], 'добавь цель в c-goals.js');
  assert.deepEqual(Object.keys(LESSON_GOALS).filter(id => !lessonIds.has(id)), [], 'цель без урока');
  for (const [id, g] of Object.entries(LESSON_GOALS)) {
    assert.ok(g.length >= 15 && g.length <= 120, `${id}: длина ${g.length}`);
    assert.ok(!/[.!?]$/.test(g) && !g.includes('null') && g === g.trim(), `${id}: «${g}»`);
    assert.ok(!/^После урока/i.test(g), `${id}: префикс добавляет интерфейс`);
  }
  for (const t of TRACKS) assert.equal(new Set(t.lessons.map(l => LESSON_GOALS[l.id])).size, t.lessons.length, `${t.id}: цели не повторяются`);
  assert.equal(lessonGoal('en-13'), 'заказать еду и напиток и попросить счёт по-английски'); assert.equal(lessonGoal('нет-такого'), '');
});

// ---------- дневник практики ----------
test('дневник практики: уроки по плану, говорение по записи, карточки по числу ответов', () => {
  const [c1, c2] = cardsOfTrack(english), [h1] = cardsOfTrack(hebrew);
  const lesson = english.lessons[0], hl = hebrew.lessons[0];
  const evs = [
    makeLessonDone(english, lesson, day(-2)), makeLessonDone(hebrew, hl, day(-10)),                     // второй — вне недели
    makeSpeak({ lang: 'english', seconds: 600, date: day(-1) }, 1), makeSpeak({ lang: 'hebrew', seconds: 300, date: day(0) }, 2),
    makeSrsEvent(state(c1.id, day(-5), [[day(-3), 2], [day(-2), 2], [day(-1), 1], [day(0), 2]])),         // 4 ответа
    makeSrsEvent(state(c2.id, day(-5), [[day(-9), 2], [day(-1), 0]])),                                      // 1 ответ в неделе
    makeSrsEvent(state(h1.id, day(-5), [[day(0), 2], [day(0), 1]])),
    makeUserCard('вопрос', 'ответ', 5, 'ucard:x'), makeSrsEvent(state('ucard:x', day(-1), [[day(0), 2]])),
  ];
  const by = practiceBy(evs, day(-6), TODAY);
  assert.equal(by.english.lessons, lesson.minutes); assert.equal(by.english.speak, 10); assert.equal(by.english.reps, 5);
  assert.equal(by.english.cards, Math.round((5 * CARD_SECONDS) / 60)); assert.equal(by.english.total, lesson.minutes + 10 + by.english.cards);
  assert.equal(by.hebrew.lessons, 0, 'урок иврита был десять дней назад'); assert.equal(by.hebrew.speak, 5); assert.equal(by.hebrew.reps, 2);
  assert.equal(by.my.reps, 1, 'свои карточки считаются отдельно');
  const w = practiceWeek(evs, TODAY);
  assert.deepEqual(w.rows.map(r => r.track), ['english', 'hebrew', 'my']); assert.equal(w.rows[2].title, 'Свои карточки');
  assert.equal(w.total, w.rows.reduce((s, r) => s + r.total, 0)); assert.equal(w.from, day(-6));
  assert.deepEqual(practiceWeek([], TODAY).rows, []);
  assert.deepEqual(practiceBy([makeSpeak({ lang: 'english', seconds: 600, date: day(-1) }, 1)], day(-6), TODAY).english.speak, 10);
});

test('недельные цели по курсам: проверка ввода, прогресс, выполнение', () => {
  assert.throws(() => makeLearnGoal('нет', 60), /Выбери курс/);
  for (const bad of [0, 9, 1001, 'abc', '', null]) assert.throws(() => makeLearnGoal('english', bad), new RegExp(`от ${GOAL_MIN} до ${GOAL_MAX}`), String(bad));
  const g = makeLearnGoal('english', '60,7');
  assert.deepEqual([g.id, g.type, g.payload], [goalId('english'), 'learngoal', { track: 'english', minutes: 60 }]);
  assert.equal(makeLearnGoal('english', 90, 5).id, g.id, 'вторая цель заменяет первую (тот же id)');
  const lesson = english.lessons[0];
  const evs = [g, makeLearnGoal('hebrew', 10), makeLessonDone(english, lesson, day(-1)), makeSpeak({ lang: 'english', seconds: 1800, date: day(0) }, 1), makeSpeak({ lang: 'hebrew', seconds: 900, date: day(0) }, 2)];
  assert.deepEqual(learnGoals(evs), { english: 60, hebrew: 10 });
  const w = practiceWeek(evs, TODAY), en = w.rows.find(r => r.track === 'english'), he = w.rows.find(r => r.track === 'hebrew');
  assert.equal(en.goal, 60); assert.equal(en.total, lesson.minutes + 30); assert.equal(en.left, Math.max(0, 60 - en.total)); assert.ok(en.ratio > 0 && en.ratio <= 1);
  assert.equal(he.total, 15); assert.equal(he.left, 0); assert.equal(he.ratio, 1, 'выше цели — не больше 100%');
  const onlyGoal = practiceWeek([makeLearnGoal('data', 30)], TODAY).rows;
  assert.deepEqual(onlyGoal.map(r => [r.track, r.total, r.left]), [['data', 0, 30]], 'цель без занятий тоже видна');
  assert.deepEqual(learnGoals([{ id: 'learngoal:zzz', type: 'learngoal', ts: 1, payload: { track: 'zzz', minutes: 30 } }]), {}, 'цель неизвестного курса игнорируется');
});

// ---------- «нового давно нет» ----------
test('подсказка «нового давно нет»: занятия идут, но ни уроков, ни новых карточек за четыре недели', () => {
  const cards = cardsOfTrack(english), done = english.lessons.slice(0, 2);
  const oldLessons = done.map((l, i) => makeLessonDone(english, l, day(-60 + i)));
  const reviewDays = Array.from({ length: 10 }, (_, i) => day(-2 * i - 1));          // 10 разных дней за последние 20
  const reviewed = cards.slice(0, 6).map(c => makeSrsEvent(state(c.id, day(-50), reviewDays.map(d => [d, 2]))));
  const evs = [...oldLessons, ...reviewed];
  const p = plateauInfo(evs, 'english', TODAY);
  assert.equal(p.days, 10); assert.equal(p.window, 28); assert.equal(p.nextLesson.id, english.lessons[2].id);
  assert.match(p.text, /За последние 4 недели было 10 дней занятий, но ничего нового не появилось/); assert.match(p.text, new RegExp(`урок «${english.lessons[2].title}»`)); assert.match(p.text, /говорение вслух, экзамен по курсу/);
  // новое появилось — подсказки нет
  assert.equal(plateauInfo([...evs, makeLessonDone(english, english.lessons[2], day(-3))], 'english', TODAY), null, 'пройден новый урок');
  assert.equal(plateauInfo([...evs, makeSrsEvent(state(cards[7].id, day(-4), [[day(-4), 2]]))], 'english', TODAY), null, 'начата новая карточка');
  // мало занятий — это не топтание, а пауза
  const few = [...oldLessons, makeSrsEvent(state(cards[0].id, day(-50), [[day(-1), 2], [day(-9), 2]]))];
  assert.equal(plateauInfo(few, 'english', TODAY), null);
  // курс только начат внутри окна — рано судить
  assert.equal(plateauInfo([makeLessonDone(english, done[0], day(-3)), ...reviewed.map(e => makeSrsEvent({ ...e.payload, first: day(-3) }))], 'english', TODAY), null);
  // другой курс и неизвестный курс
  assert.equal(plateauInfo(evs, 'hebrew', TODAY), null); assert.equal(plateauInfo(evs, 'нет', TODAY), null);
  // занятия говорением тоже считаются занятиями
  const speakOnly = [...oldLessons, ...reviewDays.slice(0, 9).map((d, i) => makeSpeak({ lang: 'english', seconds: 600, date: d }, 100 + i)), makeSrsEvent(state(cards[0].id, day(-50), [[day(-1), 2]]))];
  assert.equal(plateauInfo(speakOnly, 'english', TODAY).days, 9, 'дни говорения и карточек объединяются без повторов');
  // курс закончен: все уроки пройдены и все карточки начаты
  const full = [...english.lessons.map((l, i) => makeLessonDone(english, l, day(-90 + i))), ...cards.map(c => makeSrsEvent(state(c.id, day(-80), reviewDays.map(d => [d, 2]))))];
  assert.equal(plateauInfo(full, 'english', TODAY), null, 'закончил курс — подсказка не нужна');
});

// ---------- аналитика: полоса нормы, разброс, сравнение периодов, факторы месяца, отметки ----------
const REACTION = { primary: { better: 'lower' } }, DIGITS = { primary: { better: 'higher' } };
test('полоса нормы: медиана ± устойчивый разброс, у «чем меньше, тем лучше» перевёрнута', () => {
  assert.deepEqual(normBand(DIGITS, { median: 10, mad: 2 }), { lo: 10 - 1.4826 * 2, hi: 10 + 1.4826 * 2 });
  const r = normBand(REACTION, { median: 300, mad: 20 });
  assert.ok(Math.abs(r.lo - (-300 - 29.652)) < 1e-9 && Math.abs(r.hi - (-300 + 29.652)) < 1e-9, 'линия графика перевёрнута, полоса тоже');
  assert.equal(normBand(DIGITS, null), null); assert.equal(normBand(DIGITS, { median: 10, mad: 0 }), null); assert.equal(normBand(DIGITS, { median: NaN, mad: 1 }), null);
});

test('разброс результатов: коэффициент вариации и его изменение', () => {
  assert.equal(variability([300, 310, 290]), null, 'меньше шести результатов');
  assert.equal(variability([-5, -4, -6, -5, -4, -6]), null, 'среднее не положительное');
  const steady = variability([300, 302, 298, 301, 299, 300]);
  assert.equal(steady.n, 6); assert.ok(steady.cv > 0 && steady.cv < 0.01);
  const flat = Array.from({ length: 10 }, (_, i) => 300 + (i % 2 ? 3 : -3)), wild = Array.from({ length: 10 }, (_, i) => 300 + (i % 2 ? 60 : -60));
  assert.equal(variabilityTrend([...wild, ...flat]).trend, 'steadier'); assert.equal(variabilityTrend([...flat, ...wild]).trend, 'noisier');
  assert.equal(variabilityTrend([...flat, ...flat]).trend, 'same'); assert.equal(variabilityTrend(flat).trend, null, 'нужны два окна по десять результатов');
  assert.deepEqual(CV_TESTS, ['reaction', 'digits', 'math', 'schulte']);
});

test('сравнение недель: направление, «хорошо/плохо», слишком мало данных и режим болезни', () => {
  const evs = [];
  const put = (offset, sleep, stress, focus) => {
    const d = day(offset);
    evs.push(makeCheckin('m', d, { sleepHours: sleep, mood: 4, energy: 3, stress }, '', 1000 + offset), makeCheckin('e', d, { mood: 4, energy: 3, stress }, '', 2000 + offset));
    if (focus) evs.push(makeFocus({ date: d, minutes: focus, label: 'x' }, 3000 + offset));
  };
  for (let i = 0; i < 7; i++) put(-i, 6, 2, 30);               // эта неделя: сон 6 ч, стресс 2, фокус 210 мин
  for (let i = 7; i < 14; i++) put(-i, 7.5, 3, 20);            // прошлая: сон 7,5 ч, стресс 3, фокус 140 мин
  const c = compareWeeks(evs, TODAY), by = Object.fromEntries(c.rows.map(r => [r.key, r]));
  assert.equal(c.days, 7);
  assert.equal(by.sleep.dir, 'down'); assert.equal(by.sleep.good, false); assert.ok(Math.abs(by.sleep.delta + 1.5) < 1e-9);
  assert.equal(by.stress.dir, 'down'); assert.equal(by.stress.good, true, 'стресс ниже — это хорошо');
  assert.equal(by.mood.dir, 'same'); assert.equal(by.mood.good, null);
  assert.equal(by.focus.now, 210); assert.equal(by.focus.prev, 140); assert.equal(by.focus.dir, 'up'); assert.equal(by.focus.good, true);
  assert.ok(!by.composite && !by.tasks && !by.workout, 'нет данных — строки нет');
  // мало дней: среднее не считаем, остаётся только то, что есть в другом периоде
  const few = compareWeeks([makeCheckin('m', day(0), { sleepHours: 7 }, '', 1), makeCheckin('m', day(-8), { sleepHours: 7 }, '', 2), makeCheckin('m', day(-9), { sleepHours: 7 }, '', 3), makeCheckin('m', day(-10), { sleepHours: 8 }, '', 4)], TODAY);
  const sl = few.rows.find(r => r.key === 'sleep');
  assert.equal(sl.now, null); assert.equal(sl.prev, 7.333333333333333); assert.equal(sl.dir, null);
  assert.deepEqual(compareWeeks([], TODAY).rows, []);
  // 90 дней: те же правила, но нужно 10 дней
  const s90 = compare90(evs, TODAY).rows.find(r => r.key === 'sleep');
  assert.ok(Math.abs(s90.now - 6.75) < 1e-9 && s90.prev === null && s90.dir === null, 'за 90 дней есть 14 дней отметок, предыдущих 90 дней нет: показываем только значение');
  const wide = compare90(evs, TODAY).rows.find(r => r.key === 'focus');
  assert.equal(wide.now, 350); assert.equal(wide.prev, 0); assert.equal(wide.dir, 'up');
});

// 60 дней проверок: результат зависит от сна той же ночи
function runFixture(days) {
  const rng = makeRng(77), out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = day(-i), startedAt = new Date(`${d}T09:00:00`).getTime(), sleep = 5 + Math.round(rng() * 40) / 10, q = (sleep - 7) * 2 + (rng() - 0.5);
    const m = {
      reaction: { n: 5, median: Math.round(360 - 20 * q), mean: 380, sd: 40, best: 300, lapses: 0, falseStarts: 0 },
      gonogo: { n: 16, hits: 11, omissions: 1, commissions: 1, correctRejections: 3, accuracy: 0.87, inhibition: 0.75, medianRT: 400, dPrime: +(1.5 + 0.3 * q).toFixed(2) },
      stroop: { n: 12, correct: 11, accuracy: 0.92, meanCongruent: 700, meanIncongruent: 900, interference: Math.round(220 - 15 * q), errorsIncongruent: 1 },
      digits: { forward: 6, backward: 4, total: Math.round(10 + q), attempts: 8 },
      math: { n: 12, correct: 10, accuracy: 0.83, meanMs: 3000, perMinute: +(9 + q).toFixed(1), maxLevel: 3 },
    }, results = {};
    for (const [id, mm] of Object.entries(m)) results[id] = { metrics: mm, ms: 30000, trials: [] };
    out.push(makeRunEvent(makeRun({ mode: 'quick', startedAt, durationMs: 300000, state: null, results }), startedAt), makeCheckin('m', d, { sleepHours: sleep, mood: 3 + (i % 3), stress: 1 + (i % 4) }, '', startedAt + 1000));
  }
  return out;
}
test('факторы месяца: сон выходит на первое место, слабые связи помечены осторожно', () => {
  const evs = runFixture(60), f = topFactors(evs, TODAY);
  assert.equal(f.days, 30); assert.equal(f.outcome, 'composite'); assert.equal(f.outcomeLabel, 'общий результат'); assert.ok(f.rows >= 25);
  assert.equal(f.list[0].key, 'sleepHours'); assert.ok(f.list[0].rho > 0.6, String(f.list[0].rho)); assert.equal(f.list[0].level, 'possible');
  assert.ok(f.list.length <= 5 && f.list.every((x, i, a) => i === 0 || Math.abs(a[i - 1].rho) >= Math.abs(x.rho) - 1e-12), 'отсортированы по силе связи');
  assert.ok(f.list.filter(x => x.key !== 'sleepHours' && x.key !== 'moodMorning' && x.key !== 'stressMorning').every(x => x.level === 'weak' || x.q <= 0.25));
  const thin = topFactors(runFixture(8), TODAY);
  assert.deepEqual(thin.list, []); assert.ok(thin.rows < thin.needed, 'мало дней — ничего не ранжируем');
  assert.deepEqual(topFactors([], TODAY).list, []);
});

test('отметки событий: болезнь, начало курса, эксперимент — по номеру точки ряда', () => {
  const series = Array.from({ length: 10 }, (_, i) => ({ date: day(-9 + i), value: i }));
  const evs = [
    { id: 's1', type: 'sick', ts: 1, payload: { from: day(-6), to: null } },
    makeLessonDone(english, english.lessons[0], day(-4)), makeLessonDone(english, english.lessons[1], day(-2)),   // начало курса — первый урок
    { id: 'e1', type: 'experiment', ts: 1, payload: { title: 'Без кофе', startDate: day(-3), cancelled: false } },
    { id: 'e2', type: 'experiment', ts: 1, payload: { title: 'Отменён', startDate: day(-5), cancelled: true } },
    { id: 's0', type: 'sick', ts: 1, payload: { from: day(-30), to: day(-25) } },                                        // до начала ряда
    makeLessonDone(hebrew, hebrew.lessons[0], day(5)),                                                                     // после конца ряда
  ];
  const m = eventMarks(evs, series);
  assert.deepEqual(m.map(x => [x.i, x.kind]), [[3, 'sick'], [5, 'course'], [6, 'exp']]);
  assert.match(m[1].label, /начат курс «Английский: быстро»/); assert.equal(m[2].label, 'эксперимент «Без кофе»');
  assert.deepEqual(eventMarks(evs, []), []);
  const gap = [{ date: day(-9), value: 1 }, { date: day(-1), value: 2 }];
  assert.equal(eventMarks([{ id: 's', type: 'sick', ts: 1, payload: { from: day(-5), to: null } }], gap)[0].i, 1, 'событие между замерами — на следующей точке');
});
