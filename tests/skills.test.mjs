import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays } from '../events.js';
import { TRACKS, makeLessonDone, makeSrsEvent, lessonGoal } from '../academy.js';
import { newState, MASTERED_BOX } from '../srs.js';
import { skillFromTask, LEVELS, SOURCES, MASTERY_SHARE, OTHER_AREA, makeSkill, updateSkill, setLevel, skillsOf, skillGroups, skillStats, skillsText, lessonMastery, lessonSkillStatus, skillFromLesson, readySkillEvents, lessonSkillId, areaOf } from '../skills.js';
import { toMarkdown } from '../export.js';
import { searchEvents } from '../search.js';

const TODAY = '2026-11-14', NOW = new Date('2026-11-14T10:00:00').getTime(), day = n => addDays(TODAY, n);
const english = TRACKS.find(t => t.id === 'english'), L1 = english.lessons[0], L2 = english.lessons[1];
const st = (cardId, box) => makeSrsEvent({ ...newState(cardId, day(-40)), box, reps: 6, last: day(-1), due: day(10) }, NOW);
const cardsMastered = (lesson, n, box = MASTERED_BOX) => lesson.cards.slice(0, n).map((_, i) => st(`${lesson.id}:${i}`, box));

test('навык: создание, проверка ввода и обрезка', () => {
  const s = makeSkill({ title: '  Менять   колесо  ', area: '  Дом и быт ', level: 2, date: day(-3), note: 'в гараже' }, NOW);
  assert.equal(s.type, 'skill'); assert.match(s.id, /^skill:/);
  assert.deepEqual(s.payload, { title: 'Менять колесо', area: 'Дом и быт', level: 2, date: day(-3), source: 'manual', ref: null, evidence: '', note: 'в гараже' });
  assert.equal(s.confidence, 1); assert.equal(makeSkill({ title: 'Готовить борщ', source: 'lesson', ref: 'x' }, NOW).confidence, 0.9);
  assert.equal(makeSkill({ title: 'Готовить борщ' }, NOW).payload.area, OTHER_AREA); assert.equal(makeSkill({ title: 'Готовить борщ' }, NOW).payload.level, 1); assert.equal(makeSkill({ title: 'Готовить борщ' }, NOW).payload.date, TODAY);
  assert.throws(() => makeSkill({ title: 'ab' }, NOW), /нескольких словах/); assert.throws(() => makeSkill({}, NOW), /нескольких словах/);
  assert.throws(() => makeSkill({ title: 'Готовить борщ', level: 4 }, NOW), /Выбери уровень/); assert.throws(() => makeSkill({ title: 'Готовить борщ', level: 0 }, NOW), /Выбери уровень/);
  assert.throws(() => makeSkill({ title: 'Готовить борщ', date: 'вчера' }, NOW), /Дата указана неверно/); assert.throws(() => makeSkill({ title: 'Готовить борщ', date: day(1) }, NOW), /в будущем/);
  assert.throws(() => makeSkill({ title: 'Готовить борщ', source: 'x' }, NOW), /источник/);
  assert.equal(makeSkill({ title: 'я'.repeat(300), note: 'н'.repeat(500), area: 'о'.repeat(100) }, NOW).payload.title.length, 120);
  assert.equal(makeSkill({ title: 'Готовить борщ', note: 'н'.repeat(500) }, NOW).payload.note.length, 300); assert.equal(makeSkill({ title: 'Готовить борщ', area: 'о'.repeat(100) }, NOW).payload.area.length, 40);
  assert.deepEqual(LEVELS, { 1: 'Знаю', 2: 'Умею', 3: 'Уверенно' }); assert.ok(SOURCES.lesson && SOURCES.manual); assert.equal(MASTERY_SHARE, 0.8);
});

test('правка навыка: источник и подтверждение остаются, уровень поднимается', () => {
  const lesson = skillFromLesson(english, L1, [], NOW);
  const e = updateSkill(lesson, { title: 'Выбирать слова на день', level: 2 }, NOW + 5);
  assert.equal(e.id, lesson.id); assert.equal(e.payload.source, 'lesson'); assert.equal(e.payload.ref, L1.id); assert.equal(e.payload.evidence, lesson.payload.evidence, 'подтверждение не стирается');
  assert.equal(e.payload.title, 'Выбирать слова на день'); assert.equal(e.payload.level, 2); assert.equal(e.payload.editedAt, NOW + 5);
  assert.equal(setLevel(lesson, 3, NOW).payload.level, 3); assert.equal(updateSkill(lesson, {}, NOW).payload.title, lesson.payload.title, 'пустая правка ничего не меняет');
  assert.throws(() => updateSkill(lesson, { title: '' }, NOW), /нескольких словах/);
});

test('группы и счётчики: области по алфавиту, «Другое» последней, внутри выше уровень', () => {
  const evs = [makeSkill({ title: 'Готовить борщ', area: 'Дом и быт', level: 2, date: day(-5) }, NOW), makeSkill({ title: 'Менять колесо', area: 'Дом и быт', level: 3, date: day(-9) }, NOW),
    makeSkill({ title: 'Играть на гитаре', level: 1 }, NOW), makeSkill({ title: 'Печатать вслепую', area: 'Работа', level: 2, date: day(-2) }, NOW), { id: 'x', type: 'task', ts: 1, payload: {} }];
  assert.equal(skillsOf(evs).length, 4);
  const g = skillGroups(evs);
  assert.deepEqual(g.map(x => x.area), ['Дом и быт', 'Работа', OTHER_AREA]); assert.deepEqual(g[0].items.map(e => e.payload.title), ['Менять колесо', 'Готовить борщ']);
  assert.deepEqual(skillStats(evs), { total: 4, byLevel: { 1: 1, 2: 2, 3: 1 }, areas: 3 }); assert.deepEqual(skillStats([]), { total: 0, byLevel: { 1: 0, 2: 0, 3: 0 }, areas: 0 });
  assert.equal(skillsText(evs), 'Навыки\n\nДом и быт\n— Менять колесо (уверенно)\n— Готовить борщ (умею)\n\nРабота\n— Печатать вслепую (умею)\n\nДругое\n— Играть на гитаре (знаю)\n');
  assert.equal(skillsText([]), '');
});

test('навыки из уроков: готов, когда урок пройден и выучено не меньше 80% карточек', () => {
  const n = L1.cards.length, need = Math.ceil(n * MASTERY_SHARE);
  assert.ok(n >= 2 && need <= n);
  const done = makeLessonDone(english, L1, day(-30), NOW);
  // урок не пройден — ничего
  assert.deepEqual(lessonSkillStatus([...cardsMastered(L1, n)]), { ready: [], learning: [] });
  // пройден, карточки только начаты: «изучаю»
  const started = [done, ...cardsMastered(L1, need - 1, 1)];
  let s = lessonSkillStatus(started);
  assert.equal(s.ready.length, 0); assert.equal(s.learning.length, need > 1 ? 1 : 0);
  if (need > 1) assert.deepEqual([s.learning[0].lesson.id, s.learning[0].started, s.learning[0].mastered, s.learning[0].needed, s.learning[0].total], [L1.id, need - 1, 0, need, n]);
  // выучено на одну меньше нужного — ещё не готов; ровно нужное — готов
  assert.equal(lessonSkillStatus([done, ...cardsMastered(L1, need - 1)]).ready.length, 0);
  s = lessonSkillStatus([done, ...cardsMastered(L1, need)]);
  assert.equal(s.ready.length, 1); assert.equal(s.ready[0].lesson.id, L1.id); assert.equal(s.ready[0].mastered, need); assert.equal(s.ready[0].goal, lessonGoal(L1.id));
  assert.equal(lessonMastery(L1, [done, ...cardsMastered(L1, need)]).ready, true);
  assert.equal(lessonMastery(L1, [done, ...cardsMastered(L1, n, MASTERED_BOX - 1)]).mastered, 0, 'коробка ниже четвёртой — ещё не выучено');
  assert.equal(lessonMastery(L1, [done, ...cardsMastered(L1, n, MASTERED_BOX + 2)]).mastered, n, 'выше четвёртой — выучено');
  // навык из урока: детерминированный id, формулировка из цели урока, подтверждение
  const sk = skillFromLesson(english, L1, [done, ...cardsMastered(L1, n)], NOW);
  assert.equal(sk.id, lessonSkillId(L1.id)); assert.equal(sk.id, 'skill:lesson:en-01');
  assert.equal(sk.payload.title, 'Выбирать пять частотных слов на день и повторять их вечером'); assert.equal(sk.payload.area, english.title);
  assert.deepEqual([sk.payload.source, sk.payload.ref, sk.payload.level], ['lesson', L1.id, 1]);
  assert.equal(sk.payload.evidence, `Урок «${L1.title}» пройден; выучено карточек: ${n} из ${n} (повторение раз в две недели и реже)`);
  // уже добавленный навык из списка «готово» исчезает; повторное добавление — тот же id
  const have = lessonSkillStatus([done, ...cardsMastered(L1, n), sk]);
  assert.deepEqual([have.ready.length, have.learning.length], [0, 0]);
  assert.equal(skillFromLesson(english, L1, [done, ...cardsMastered(L1, n)], NOW + 99).id, sk.id);
  // несколько уроков; «изучаю» отсортировано по доле выученного
  const done2 = makeLessonDone(english, L2, day(-20), NOW), n2 = L2.cards.length;
  const two = [done, done2, ...cardsMastered(L1, n), ...cardsMastered(L2, Math.max(1, Math.floor(n2 / 2)), 1)];
  const st2 = lessonSkillStatus(two);
  assert.deepEqual(st2.ready.map(r => r.lesson.id), [L1.id]); assert.deepEqual(st2.learning.map(r => r.lesson.id), [L2.id]);
  assert.deepEqual(readySkillEvents(two, NOW).map(e => e.id), ['skill:lesson:en-01']);
  assert.equal(areaOf('english'), english.title); assert.equal(areaOf('нет'), OTHER_AREA);
});

test('навыки в читаемой выгрузке и в поиске', () => {
  const evs = [makeSkill({ title: 'Менять колесо', area: 'Дом и быт', level: 2, date: day(-9), note: 'в гараже' }, NOW), skillFromLesson(english, L1, [], NOW)];
  const md = toMarkdown(evs);
  assert.match(md, /## Навыки/); assert.match(md, /\*\*Дом и быт\*\*/); assert.match(md, /- Менять колесо — умею, с 2026-11-05\. в гараже/);
  assert.match(md, new RegExp(`\\*\\*${english.title}\\*\\*`)); assert.match(md, /Выбирать пять частотных слов на день.* — знаю, с 2026-11-14 \(Урок «/);
  assert.ok(!/## Навыки/.test(toMarkdown([])));
  const hit = searchEvents(evs, 'колесо');
  assert.equal(hit.length, 1); assert.equal(hit[0].kind, 'Навык'); assert.equal(hit[0].tab, 'skills');
  assert.equal(searchEvents(evs, 'гараже').length, 1, 'ищется и по заметке');
});

test('«задание выполнено»: навык «Умею» из урока, у готового навыка уровень поднимается', () => {
  const fresh = skillFromTask(english, L1, [], NOW);
  assert.equal(fresh.id, 'skill:lesson:en-01'); assert.equal(fresh.payload.level, 2); assert.equal(fresh.payload.evidence, `Задание урока «${L1.title}» выполнено`); assert.equal(fresh.payload.title, 'Выбирать пять частотных слов на день и повторять их вечером');
  const n = L1.cards.length, done = makeLessonDone(english, L1, day(-30), NOW);
  const known = skillFromLesson(english, L1, [done, ...cardsMastered(L1, n)], NOW);
  const up = skillFromTask(english, L1, [done, known], NOW + 10);
  assert.equal(up.id, known.id); assert.equal(up.payload.level, 2); assert.match(up.payload.evidence, new RegExp(`^Задание урока «${L1.title}» выполнено\\. Урок «`));
  assert.equal(skillFromTask(english, L1, [done, { ...up }], NOW + 20).payload.evidence, up.payload.evidence, 'повторное нажатие не дублирует подтверждение');
  const three = updateSkill(known, { level: 3 }, NOW);
  assert.equal(skillFromTask(english, L1, [three], NOW).payload.level, 3, 'уровень «Уверенно» не понижается');
});
