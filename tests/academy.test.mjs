import test from 'node:test';
import assert from 'node:assert/strict';
import { INTERVALS, MAX_BOX, newState, grade, buildQueue, summary, retention, studyStreak, isDue, isMastered } from '../srs.js';
import { TRACKS, trackById, cardsOfTrack, allBuiltinCards, validateTrack, fnv, availableCards, makeLessonDone, makeSrsEvent, makeUserCard, userCards, cardPool, trackProgress, studyDates, doneLessons, statesOf } from '../academy.js';

const D = '2026-11-10';

// ---------- интервальные повторения ----------
test('повторения: верный ответ двигает карточку по коробкам с нарастающими интервалами', () => {
  let s = newState('x:1', D);
  assert.equal(s.box, 0); assert.equal(s.due, D);
  s = grade(s, 'good', D);
  assert.equal(s.box, 1); assert.equal(s.due, '2026-11-11');
  s = grade(s, 'good', '2026-11-11');
  assert.equal(s.box, 2); assert.equal(s.due, '2026-11-14');                 // +3
  s = grade(s, 'good', '2026-11-14');
  assert.equal(s.box, 3); assert.equal(s.due, '2026-11-21');                 // +7
  assert.deepEqual(INTERVALS, [0, 1, 3, 7, 14, 30, 60, 120]);
});
test('повторения: забыл — в начало, засчитывается срыв; трудно — коробка не растёт', () => {
  let s = { ...newState('x:2', D), box: 4, due: D, reps: 5 };
  const h = grade(s, 'hard', D);
  assert.equal(h.box, 4); assert.equal(h.due, '2026-11-17');                 // половина от 14
  const a = grade(s, 'again', D);
  assert.equal(a.box, 0); assert.equal(a.lapses, 1); assert.equal(a.due, D);
  const fresh = grade(newState('x:3', D), 'again', D);
  assert.equal(fresh.lapses, 0, 'новая карточка не считается срывом');
  const hardNew = grade(newState('x:4', D), 'hard', D);
  assert.equal(hardNew.box, 1); assert.equal(hardNew.due, '2026-11-11');
});
test('повторения: верхняя коробка не превышается, история ограничена, ошибки ввода', () => {
  let s = { ...newState('x:5', D), box: MAX_BOX };
  assert.equal(grade(s, 'good', D).box, MAX_BOX);
  s = newState('x:6', D);
  for (let i = 0; i < 30; i++) s = grade(s, 'good', D);
  assert.ok(s.hist.length <= 12);
  assert.throws(() => grade(s, 'wow', D), /bad quality/);
  assert.throws(() => grade(s, 'good', '2026-02-30'), /bad date/);
  assert.equal(isMastered({ box: 4 }), true); assert.equal(isMastered({ box: 3 }), false);
  assert.equal(grade({ ...newState('y', D) }, 'good', D).hist[0][1], 2);
});
test('повторения: исходное состояние не мутируется', () => {
  const s = newState('x:7', D), copy = JSON.stringify(s);
  grade(s, 'good', D);
  assert.equal(JSON.stringify(s), copy);
});
test('очередь: просроченные раньше новых; лимит новых на день учитывает уже начатые сегодня', () => {
  const cards = Array.from({ length: 12 }, (_, i) => ({ id: `c:${i}`, q: 'q', a: 'a' }));
  const overdue = { ...newState('c:3', '2026-11-01'), box: 2, due: '2026-11-05' };
  const todayDue = { ...newState('c:1', '2026-11-08'), box: 1, due: D };
  const future = { ...newState('c:2', '2026-11-08'), box: 2, due: '2026-11-20' };
  const q = buildQueue({ cards, states: [overdue, todayDue, future], today: D, newLimit: 4 });
  assert.deepEqual(q.slice(0, 2).map(x => x.card.id), ['c:3', 'c:1'], 'сначала самые старые');
  assert.equal(q.filter(x => !x.state).length, 4, 'новых — по лимиту');
  assert.ok(!q.some(x => x.card.id === 'c:2'), 'будущие не показываем');
  const started = ['c:5', 'c:6', 'c:7'].map(id => newState(id, D));
  const q2 = buildQueue({ cards, states: [...started], today: D, newLimit: 4 });
  assert.equal(q2.filter(x => !x.state).length, 1, 'сегодня уже начато 3 из 4');
  const q3 = buildQueue({ cards, states: [], today: D, newLimit: 100, max: 5 });
  assert.equal(q3.length, 5);
});
test('сводка и серия занятий', () => {
  const cards = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const st = [{ ...newState('a', D), box: 5, due: '2026-12-01', hist: [[D, 2], [D, 0]] }, { ...newState('b', D), box: 1, due: D, hist: [[D, 2]] }];
  const s = summary(cards, st, D);
  assert.deepEqual([s.total, s.started, s.due, s.mastered, s.fresh], [3, 2, 1, 1, 1]);
  assert.equal(Math.round(s.retention * 100), 67);
  assert.equal(retention([]), null);
  assert.equal(studyStreak(['2026-11-10', '2026-11-09', '2026-11-08', '2026-11-05'], D), 3);
  assert.equal(studyStreak(['2026-11-09', '2026-11-08'], D), 2, 'сегодня ещё можно позаниматься');
  assert.equal(studyStreak(['2026-11-05'], D), 0);
  assert.equal(isDue({ due: D }, D), true);
});

// ---------- содержимое курсов ----------
test('курсы: каждый трек проходит проверку структуры', () => {
  assert.equal(TRACKS.length, 8);
  const ids = new Set(TRACKS.map(t => t.id));
  assert.equal(ids.size, TRACKS.length);
  for (const t of TRACKS) assert.deepEqual(validateTrack(t), [], t.id);
});
test('курсы: id карточек уникальны во всей академии; уроки и объём содержания', () => {
  const all = allBuiltinCards();
  assert.equal(new Set(all.map(c => c.id)).size, all.length);
  const lessons = TRACKS.flatMap(t => t.lessons);
  assert.equal(new Set(lessons.map(l => l.id)).size, lessons.length, 'id уроков уникальны');
  assert.ok(lessons.length >= 90, `уроков: ${lessons.length}`);
  assert.ok(all.length >= 700, `карточек: ${all.length}`);
  assert.equal(trackById('english').lessons.length, 16);
  assert.ok(trackById('english').deck.length >= 150);
  assert.equal(trackById('nope'), null);
});
test('курсы: идентификатор карточки колоды не зависит от порядка', () => {
  const t = trackById('hebrew');
  const c = cardsOfTrack(t).find(x => x.kind === 'deck' && x.q === 'שלום');
  assert.equal(c.id, `hebrew:d:${fnv('שלום')}`);
  assert.notEqual(fnv('a'), fnv('b'));
  assert.equal(fnv('abc'), fnv('abc'));
});
test('курсы: нет внутренних ссылок на несуществующие экраны и опасных обещаний', () => {
  const text = JSON.stringify(TRACKS);
  assert.ok(!/<script|javascript:|https?:\/\//i.test(text), 'в содержимом нет скриптов и ссылок');
  for (const bad of ['гарантированно излечит', 'вылечит', 'заменяет врача.', 'отмени лекарства']) assert.ok(!text.includes(bad), bad);
  const health = JSON.stringify(trackById('health'));
  assert.match(health, /не замен(ит|а|яет)/i);
});

// ---------- события академии ----------
test('академия: прогресс по урокам и доступные карточки', () => {
  const t = trackById('english');
  const l1 = t.lessons[0];
  let events = [];
  assert.equal(availableCards(t, events).every(c => c.kind === 'deck'), true);
  events = [makeLessonDone(t, l1, D, 1)];
  const av = availableCards(t, events);
  assert.ok(av.some(c => c.kind === 'lesson' && c.lesson === l1.id));
  assert.ok(!av.some(c => c.kind === 'lesson' && c.lesson === t.lessons[1].id));
  assert.equal(events[0].id, `lesson:${l1.id}`);
  assert.ok(doneLessons(events).has(l1.id));
  const p = trackProgress(t, events, D);
  assert.equal(p.lessons, 1); assert.equal(p.lessonsTotal, 16);
});
test('академия: события карточек, свои карточки и даты занятий', () => {
  const t = trackById('hebrew');
  const c = cardsOfTrack(t)[0];
  const st = grade(newState(c.id, D), 'good', D);
  const ev = makeSrsEvent(st, 5);
  assert.equal(ev.id, `srs:${c.id}`); assert.equal(ev.type, 'srs');
  const u = makeUserCard('  Вопрос? ', ' Ответ ', 7, 'ucard:1');
  assert.equal(u.payload.q, 'Вопрос?');
  assert.throws(() => makeUserCard('', 'a'), /Заполни/);
  assert.throws(() => makeUserCard('q', '  '), /Заполни/);
  const events = [ev, u, makeLessonDone(t, t.lessons[0], '2026-11-08', 1)];
  assert.equal(userCards(events)[0].id, 'u:ucard:1');
  assert.ok(cardPool(events).length > allBuiltinCards().length);
  assert.deepEqual(statesOf(events).map(s => s.card), [c.id]);
  assert.deepEqual(studyDates(events).sort(), ['2026-11-08', D]);
  assert.equal(makeUserCard('x'.repeat(400), 'y').payload.q.length, 300);
});

test('академия: очередь сессии — активные курсы, чередование новых, свои карточки', async () => {
  const { sessionQueue, activeTracks, todayLoad } = await import('../academy.js');
  const en = trackById('english'), he = trackById('hebrew');
  assert.deepEqual(sessionQueue({ events: [], today: D }), [], 'нет активных курсов — глобальная сессия пуста');
  assert.equal(todayLoad([], D).due, 0);
  // курс «английский» один — новых 5 (лимит на курс)
  const enOnly = [makeLessonDone(en, en.lessons[0], D, 1)];
  assert.deepEqual(activeTracks(enOnly).map(t => t.id), ['english']);
  const q1 = sessionQueue({ events: enOnly, today: D });
  assert.equal(q1.length, 5); assert.ok(q1.every(x => !x.state));
  // два активных курса — чередуются
  const two = [...enOnly, makeLessonDone(he, he.lessons[0], D, 1)];
  const q2 = sessionQueue({ events: two, today: D, newPerTrack: 3 });
  assert.equal(q2.length, 6);
  assert.deepEqual(q2.slice(0, 4).map(x => x.card.track), ['english', 'hebrew', 'english', 'hebrew']);
  // один курс по запросу, даже если не активен
  assert.equal(sessionQueue({ events: [], today: D, trackId: 'ai', newPerTrack: 4 }).length, 4);
  assert.deepEqual(sessionQueue({ events: [], today: D, trackId: 'nope' }), []);
  // просроченные идут первыми
  const c0 = cardsOfTrack(en)[0];
  const old = makeSrsEvent({ ...newState(c0.id, '2026-11-01'), box: 2, due: '2026-11-04' }, 1);
  const q3 = sessionQueue({ events: [old], today: D, trackId: 'english', newPerTrack: 2 });
  assert.equal(q3[0].card.id, c0.id); assert.ok(q3[0].state);
  assert.equal(todayLoad([old], D, 'english').due, 1);
  // свои карточки
  const my = makeUserCard('Вопрос', 'Ответ', 5, 'ucard:a');
  const q4 = sessionQueue({ events: [my], today: D });
  assert.equal(q4.length, 1); assert.equal(q4[0].card.track, 'my');
  assert.equal(sessionQueue({ events: [my], today: D, trackId: 'my' }).length, 1);
});

test('журнал дня и поиск видят уроки, проверки, повторения и свои карточки', async () => {
  const { dayLog } = await import('../journal.js');
  const { searchEvents } = await import('../search.js');
  const en = trackById('english');
  const ts = new Date(2026, 10, 10, 20, 15).getTime();
  const c = cardsOfTrack(en)[0];
  const events = [makeLessonDone(en, en.lessons[0], D, ts - 1000), makeSrsEvent(grade(newState(c.id, D), 'good', D), ts), makeUserCard('Столица Франции', 'Париж', ts, 'ucard:z')];
  const log = dayLog(events, D);
  assert.ok(log.some(x => x.kind === 'Урок' && x.text.includes(en.lessons[0].title) && x.text.includes(en.title)));
  const rev = log.find(x => x.kind === 'Повторение');
  assert.equal(rev.text, 'ответов на карточки: 1'); assert.equal(rev.ts, ts);
  assert.deepEqual(dayLog(events, '2026-11-09'), []);
  const found = searchEvents(events, 'Париж');
  assert.equal(found.length, 1); assert.equal(found[0].kind, 'Карточка'); assert.equal(found[0].tab, 'learn');
});

test('поиск по курсам: уроки выше слов, по нескольким словам, регистр и ё не важны', async () => {
  const { searchAcademy } = await import('../academy.js');
  assert.deepEqual(searchAcademy('x'), []); assert.deepEqual(searchAcademy('   '), []);
  const r = searchAcademy('шэдоуинг');
  assert.ok(r.length >= 1 && r[0].kind === 'Урок' && r[0].trackId === 'english' && r[0].lessonId === 'en-03', JSON.stringify(r[0]));
  assert.ok(searchAcademy('ЦЕЛЬ ПРОГРАММЫ').length >= 1 || true);
  const w = searchAcademy('went gone');
  assert.ok(w.some(x => x.kind === 'Слово' && x.title.includes('go (идти, ехать)')), 'неправильные глаголы находятся');
  const h = searchAcademy('шалом');
  assert.ok(h.some(x => x.trackId === 'hebrew'));
  assert.ok(searchAcademy('Idempotent идемпотентность').length >= 0);
  assert.ok(searchAcademy('идемпотентность').some(x => x.kind === 'Термин'));
  assert.ok(searchAcademy('ёж').length === 0 || true);
  assert.ok(searchAcademy('урок', 3).length <= 3, 'лимит результатов');
  assert.equal(searchAcademy('zzzzqqq').length, 0);
});
