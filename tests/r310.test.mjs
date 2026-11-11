import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../events.js';
import { TRACKS, cardsOfTrack, makeLessonDone, makeSrsEvent, makeUserCard, lessonGoal } from '../academy.js';
import { LESSON_GOALS } from '../c-goals.js';
import { newState } from '../srs.js';
import { makeSpeak } from '../speaking.js';
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
