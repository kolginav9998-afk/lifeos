import test from 'node:test';
import assert from 'node:assert/strict';
import { speakable, foreignSide, canSpeak, speak, LANG } from '../speech.js';
import { TOPICS, topicOfDay, makeSpeak, speaksOf, speakWeek, speakLeft, SPEAK_WEEK_GOAL, MIN_SPEAK_SECONDS } from '../speaking.js';
import { dayLog } from '../journal.js';
import { makeRng, olsSlope, slopeCI } from '../stats.js';
import { examQueue, quizFor, TRACKS as ACADEMY_TRACKS, cardsOfTrack as academyCards, makeLessonDone as lessonDone, makeSrsEvent as srsEvent } from '../academy.js';
import { newState } from '../srs.js';
import { slopeSentence, SLOPE_UNITS, insights } from '../bt-analytics.js';
import { makeNBack, scoreNBack, NBACK_LETTERS } from '../bt-logic.js';
import { TESTS, TEST_BY_ID, PLANS, singlePlan, validity, primaryOf, makeRun, makeRunEvent, setEffort, EFFORT_LABEL } from '../bt-core.js';
import { selfCompare } from '../bt-analytics.js';
import { buildTables } from '../bt-export.js';
import { makeCheckin, sleepReasons, SLOTS, FLAGS } from '../diary.js';
import { caffeineHint } from '../hints.js';
import { RITUAL_STEPS, makeRitual, ritualOf } from '../reflect.js';
import { HABIT_TEMPLATES } from '../habits.js';
import { NOTE_TEMPLATES, templateText } from '../notes.js';
import { MEASURES, makeMeasure } from '../health.js';
import { wordCount, diaryEntries, diaryStreak, diaryStats, appendFreeWrite, FREE_HEADER, yearBook, diaryYears } from '../writing.js';
import { makeDiary } from '../diary.js';

test('озвучка: что именно произносится', () => {
  assert.equal(speakable('go (идти, ехать)'), 'go');
  assert.equal(speakable('went — gone'), 'went');
  assert.equal(speakable('  take   off (взлетать) '), 'take off');
  assert.equal(speakable('I ___ (work) in a bank.'), 'I in a bank.');
  assert.equal(speakable(''), ''); assert.equal(speakable(null), '');
});

test('озвучка: сторона карточки на изучаемом языке', () => {
  assert.deepEqual(foreignSide({ q: 'schedule (расписание)', a: 'расписание' }, 'english'), { side: 'q', text: 'schedule' });
  assert.deepEqual(foreignSide({ q: 'Как сказать «я голоден»?', a: "I'm hungry" }, 'english'), { side: 'a', text: "I'm hungry" });
  assert.deepEqual(foreignSide({ q: 'She ___ (work) in a bank. (Present Simple)', a: 'works — he/she/it + s' }, 'english'), { side: 'a', text: 'She works in a bank.' });
  assert.deepEqual(foreignSide({ q: 'ראש', a: 'голова (рош)' }, 'hebrew'), { side: 'q', text: 'ראש' });
  assert.equal(foreignSide({ q: 'Что такое API?', a: 'интерфейс программирования' }, 'english'), null, 'русский текст не озвучиваем');
  assert.equal(foreignSide({ q: 'ראש', a: 'голова' }, 'english'), null, 'иврит не озвучиваем английским голосом');
  assert.equal(foreignSide({ q: 'x', a: 'y' }, 'klingon'), null);
});

test('озвучка: без поддержки в среде ничего не ломается', () => {
  assert.equal(canSpeak(), false, 'в Node синтеза речи нет');
  let err = null;
  assert.equal(speak('hello', 'english', e => { err = e; }), false);
  assert.equal(err, null, 'отсутствие синтеза не считается ошибкой голоса');
  assert.deepEqual(LANG, { english: 'en-US', hebrew: 'he-IL' });
  // с поддержкой: проверяем, что язык и скорость выставляются, а ошибки голоса доходят до обработчика
  const calls = [];
  globalThis.speechSynthesis = { cancel: () => calls.push('cancel'), speak: u => { calls.push(['speak', u.text, u.lang, u.rate]); u.onerror({ error: 'language-unavailable' }); } };
  globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  try {
    assert.equal(canSpeak(), true);
    const errs = [];
    assert.equal(speak('hello', 'english', e => errs.push(e)), true);
    assert.deepEqual(calls, ['cancel', ['speak', 'hello', 'en-US', 0.9]]); assert.deepEqual(errs, ['language-unavailable']);
    assert.equal(speak('', 'english'), false, 'пустой текст не произносим');
  } finally { delete globalThis.speechSynthesis; delete globalThis.SpeechSynthesisUtterance; }
});

const T = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

test('говорение вслух: запись, проверки, недельный счётчик', () => {
  const now = T(2026, 11, 14);
  assert.throws(() => makeSpeak({ lang: 'klingon', seconds: 300 }, now), /язык/);
  assert.throws(() => makeSpeak({ lang: 'english', seconds: 30 }, now), /Меньше минуты/);
  assert.throws(() => makeSpeak({ lang: 'english', seconds: 99999 }, now), /до четырёх часов/);
  assert.throws(() => makeSpeak({ lang: 'english', seconds: 120, date: 'вчера' }, now), /bad date/);
  const a = makeSpeak({ lang: 'english', seconds: 90, topic: '  Расскажи о дне  ' }, now);
  assert.equal(a.type, 'speak'); assert.equal(a.payload.minutes, 2, '90 с — две минуты по округлению'); assert.equal(a.payload.topic, 'Расскажи о дне'); assert.equal(a.payload.date, '2026-11-14');
  assert.equal(makeSpeak({ lang: 'hebrew', seconds: MIN_SPEAK_SECONDS }, now).payload.minutes, 1);
  const b = makeSpeak({ lang: 'hebrew', seconds: 600, date: '2026-11-10' }, now + 1);
  const old = makeSpeak({ lang: 'english', seconds: 1200, date: '2026-11-01' }, now + 2);
  const w = speakWeek([a, b, old], '2026-11-14');
  assert.deepEqual([w.minutes, w.sessions, w.days], [12, 2, 2]); assert.deepEqual(w.byLang, { english: 2, hebrew: 10 });
  assert.equal(w.goal, SPEAK_WEEK_GOAL); assert.ok(Math.abs(w.ratio - 0.2) < 1e-9);
  assert.equal(speakWeek([], '2026-11-14').ratio, 0);
  assert.equal(speakWeek([makeSpeak({ lang: 'english', seconds: 7200 }, now)], '2026-11-14').ratio, 1, 'доля не больше единицы');
  assert.deepEqual(speaksOf([old, a, b]).map(e => e.payload.date), ['2026-11-14', '2026-11-10', '2026-11-01']);
  assert.ok(dayLog([a], '2026-11-14').some(x => x.kind === 'Говорение' && /2 мин \(английский\)/.test(x.text)));
});

test('говорение вслух: тема дня стабильна, «другая тема» сдвигает, таймер считает по часам', () => {
  assert.equal(TOPICS.english.length, 12); assert.equal(TOPICS.hebrew.length, 12);
  const t1 = topicOfDay('english', '2026-11-14'), t2 = topicOfDay('english', '2026-11-14'), t3 = topicOfDay('english', '2026-11-15');
  assert.equal(t1, t2); assert.notEqual(t1, t3); assert.notEqual(topicOfDay('english', '2026-11-14', 1), t1);
  assert.equal(topicOfDay('english', '2026-11-14', 12), t1, 'после полного круга тема повторяется');
  assert.equal(topicOfDay('klingon', '2026-11-14'), '');
  const run = { startedAt: 1_000_000, minutes: 5 };
  assert.deepEqual(speakLeft(run, 1_000_000 + 60_000), { leftMs: 240_000, done: false, elapsedSec: 60 });
  const end = speakLeft(run, 1_000_000 + 400_000);
  assert.deepEqual([end.leftMs, end.done, end.elapsedSec], [0, true, 300]);
  assert.equal(speakLeft(run, 999_000).elapsedSec, 0, 'часы назад не дают отрицательное время');
});

test('n-back: последовательность корректна при любых зёрнах', () => {
  for (let seed = 1; seed <= 60; seed++) {
    for (const [n, len] of [[2, 24], [3, 20], [1, 12]]) {
      const seq = makeNBack(makeRng(seed), n, len, 0.3);
      assert.equal(seq.length, len);
      seq.forEach((x, i) => assert.equal(x.match, i >= n && x.letter === seq[i - n].letter, `зерно ${seed}, позиция ${i}: признак «совпало» согласован с буквами`));
      assert.ok(!seq.slice(0, n).some(x => x.match), 'в первых n буквах совпадений нет');
      assert.equal(seq.filter(x => x.match).length, Math.round((len - n) * 0.3), 'число совпадений задано точно');
      assert.ok(seq.every(x => NBACK_LETTERS.includes(x.letter)));
    }
  }
  assert.deepEqual(makeNBack(makeRng(7), 2, 24), makeNBack(makeRng(7), 2, 24), 'одно зерно — одна последовательность');
  assert.notDeepEqual(makeNBack(makeRng(7), 2, 24), makeNBack(makeRng(8), 2, 24));
});

test('n-back: подсчёт показателей и достоверность', () => {
  const rng = makeRng(11), seq = makeNBack(rng, 2, 24, 0.3);
  const play = respond => seq.map(s => { const r = respond(s); return { match: s.match, responded: r, rt: r ? 600 : null }; });
  const perfect = scoreNBack(play(s => s.match), 2);
  assert.equal(perfect.n, 22); assert.equal(perfect.hits, 7); assert.equal(perfect.misses, 0); assert.equal(perfect.falseAlarms, 0); assert.equal(perfect.accuracy, 1); assert.equal(perfect.medianRT, 600);
  assert.ok(perfect.dPrime > 2);
  const none = scoreNBack(play(() => false), 2);
  assert.equal(none.hits, 0); assert.equal(none.correctRejections, 15); assert.ok(none.dPrime < 0.5);
  const all = scoreNBack(play(() => true), 2);
  assert.equal(all.hits, 7); assert.equal(all.falseAlarms, 15); assert.ok(Math.abs(all.dPrime) < 0.5, 'нажимать на всё — не память');
  assert.ok(perfect.dPrime > all.dPrime && perfect.dPrime > none.dPrime);
  assert.equal(scoreNBack([], 2).dPrime, null);
  // достоверность: «лишь бы пройти» отсеивается
  assert.equal(validity('nback', perfect).ok, true);
  assert.equal(validity('nback', none).reason, 'не было ни одного нажатия');
  assert.equal(validity('nback', all).reason, 'нажато на каждую букву');
  assert.equal(validity('nback', { n: 4, hits: 1, falseAlarms: 0 }).reason, 'мало букв');
});

test('n-back: описан в реестре проверок, входит в полную проверку и в отдельные тесты', () => {
  const t = TEST_BY_ID.nback;
  assert.ok(t && t.domain === 'memory' && t.primary.key === 'dPrime' && t.primary.better === 'higher');
  for (const k of ['n', 'hits', 'misses', 'falseAlarms', 'correctRejections', 'accuracy', 'medianRT', 'dPrime']) assert.ok(t.metrics[k], k);
  assert.ok(PLANS.full.steps.some(s => s.id === 'nback' && s.n === 2 && s.length === 24));
  assert.ok(!PLANS.quick.steps.some(s => s.id === 'nback'), 'быстрая проверка остаётся короткой');
  assert.equal(singlePlan('nback').steps[0].id, 'nback');
  assert.equal(primaryOf('nback', { dPrime: 1.5 }), 1.5);
  assert.equal(TESTS.length, new Set(TESTS.map(x => x.id)).size, 'id тестов уникальны');
});

test('регрессия: наклон и интервал бутстрепом', () => {
  assert.equal(olsSlope([1, 2, 3, 4], [2, 4, 6, 8]), 2);
  assert.ok(Number.isNaN(olsSlope([1, 1, 1], [1, 2, 3])), 'нет разброса по x — наклона нет');
  assert.ok(Number.isNaN(olsSlope([1], [1])));
  const rng = makeRng(5), x = Array.from({ length: 60 }, () => 5 + rng() * 4), y = x.map(v => 0.3 * (v - 7) + (rng() - 0.5) * 0.6);
  const ci = slopeCI(x, y, { seed: 3 });
  assert.equal(ci.n, 60); assert.ok(ci.lo < ci.slope && ci.slope < ci.hi, 'оценка внутри интервала');
  assert.ok(ci.lo < 0.3 && 0.3 < ci.hi, `истинный наклон 0,3 в интервале: ${ci.lo.toFixed(2)}…${ci.hi.toFixed(2)}`);
  assert.deepEqual(slopeCI(x, y, { seed: 3 }), ci, 'то же зерно — тот же интервал');
  assert.equal(slopeCI(x.slice(0, 7), y.slice(0, 7)), null, 'меньше восьми пар — молчим');
  assert.equal(slopeCI([1, 2, 3], [1, 2]), null);
  const wide = slopeCI(x.slice(0, 10), y.slice(0, 10), { seed: 3 });
  assert.ok(wide.hi - wide.lo > ci.hi - ci.lo, 'меньше данных — интервал шире');
});

test('связи в аналитике: фраза с оценкой и интервалом', () => {
  const rng = makeRng(9);
  const rows = Array.from({ length: 40 }, (_, i) => { const sleep = 5.5 + rng() * 3; return { date: `d${i}`, sleepHours: sleep, composite: 0.4 * (sleep - 7) + (rng() - 0.5) * 0.5, moodEvening: Math.min(5, Math.max(1, 3 + 0.5 * (sleep - 7) + (rng() - 0.5))), caffeine: 2 }; });
  const a = slopeSentence(rows, { x: 'sleepHours', y: 'composite' });
  assert.match(a, /на каждый дополнительный час сна в среднем \+0,\d\dσ \(интервал от \+0,\d\d до \+0,\d\dσ\)/);
  const b = slopeSentence(rows, { x: 'sleepHours', y: 'moodEvening' });
  assert.match(b, /балла \(интервал/);
  assert.equal(slopeSentence(rows, { x: 'caffeine', y: 'composite' }), '', 'единица фактора неясна — не выдумываем');
  assert.equal(slopeSentence(rows.slice(0, 5), { x: 'sleepHours', y: 'composite' }), '', 'данных мало');
  assert.ok(SLOPE_UNITS.sleepHours.k === 1 && SLOPE_UNITS.workoutMin.k === 30);
});

const DAY = 86400000, T0 = new Date(2026, 8, 1, 9, 0).getTime();
function dayRun(day, q) {
  const m = {
    reaction: { n: 5, median: Math.round(360 - 20 * q), mean: 380, sd: 40, best: 300, lapses: 0, falseStarts: 0 },
    stroop: { n: 12, correct: 11, accuracy: 0.92, meanCongruent: 700, meanIncongruent: 900, interference: Math.round(220 - 15 * q), errorsIncongruent: 1 },
    math: { n: 12, correct: 10, accuracy: 0.83, meanMs: 3000, perMinute: +(9 + q).toFixed(1), maxLevel: 3 },
  };
  const results = Object.fromEntries(Object.entries(m).map(([id, mm]) => [id, { metrics: mm, ms: 30000, trials: [] }]));
  const startedAt = T0 + day * DAY;
  return makeRunEvent(makeRun({ mode: 'quick', startedAt, durationMs: 300000, results }), startedAt);
}

test('метрика усилия: от 1 до 5, хранится в записи, попадает в выгрузку', () => {
  const ev = dayRun(0, 0);
  assert.throws(() => setEffort(ev, 0), /от 1 до 5/); assert.throws(() => setEffort(ev, 6), /от 1 до 5/); assert.throws(() => setEffort(ev, 2.5), /от 1 до 5/);
  const e2 = setEffort(ev, 4);
  assert.equal(e2.payload.effort, 4); assert.equal(ev.payload.effort, undefined, 'исходная запись не меняется');
  assert.equal(EFFORT_LABEL.length, 5);
  const T = buildTables([e2, dayRun(1, 0)]);
  assert.ok(T.T.runs.cols.includes('effort'));
  assert.deepEqual(T.T.runs.rows.map(r => r.effort), [4, null]);
});

test('сравнение с собой: последний день против предыдущего и лучшего', () => {
  assert.equal(selfCompare([]), null);
  const qs = [0, 0.4, -0.3, 0.2, -0.1, 0.3, -0.2, 0.1, 1.8];
  const evs = qs.map((q, i) => dayRun(i, q));
  const c = selfCompare(evs);
  assert.ok(c.days >= 3 && c.last.date > c.prev.date);
  assert.ok(c.diff > 0 && c.isBest && c.best.date === c.last.date, 'после очень хорошего дня он лучший');
  const worse = selfCompare([...evs, dayRun(9, -2)]);
  assert.ok(worse.diff < 0 && !worse.isBest && worse.best.date === c.last.date);
  assert.equal(selfCompare(evs.slice(0, 6)), null, 'пока нормы нет, сравнивать нечего');
});

test('что мешало спать: отметки утром, счёт за месяц', () => {
  assert.deepEqual(SLOTS.m.flags, ['noise', 'worry', 'lateMeal', 'hot']);
  for (const k of SLOTS.m.flags) assert.ok(FLAGS[k], k);
  const m1 = makeCheckin('m', '2026-11-10', { sleepQuality: 2, noise: true, worry: true }, '', 1);
  assert.equal(m1.payload.noise, true); assert.equal('lateMeal' in m1.payload, false);
  assert.equal(makeCheckin('m', '2026-11-11', { noise: true }, '', 1).payload.noise, true, 'одной отметки достаточно для записи');
  const evs = [m1, makeCheckin('m', '2026-11-11', { noise: true, hot: true }, '', 1), makeCheckin('m', '2026-11-12', { sleepQuality: 4 }, '', 1), makeCheckin('m', '2026-09-01', { noise: true }, '', 1)];
  const r = sleepReasons(evs, '2026-11-14', 30);
  assert.equal(r.nights, 3, 'старше 30 дней не считаем');
  assert.deepEqual(r.reasons.map(x => [x.key, x.n]), [['noise', 2], ['hot', 1], ['worry', 1]]);
  assert.deepEqual(sleepReasons([], '2026-11-14'), { nights: 0, reasons: [] });
  // выгрузка: колонки признаков есть
  assert.ok(['noise', 'worry', 'lateMeal', 'hot', 'veg', 'protein', 'sweets'].every(c => buildTables(evs).T.checkins.cols.includes(c)));
});

test('подсказка про кофе: тяжёлая ночь после вечера с тремя и более чашками', () => {
  const today = '2026-11-14', yday = '2026-11-13';
  const night = (extra = {}) => makeCheckin('m', today, { sleepQuality: 2, ...extra }, '', 1);
  const eve = c => makeCheckin('e', yday, { caffeine: c }, '', 1);
  const h = caffeineHint([night(), eve(4)], today);
  assert.equal(h.cups, 4); assert.match(h.text, /4 чашки кофе или чая/); assert.match(h.text, /до 14:00/);
  assert.match(caffeineHint([night(), eve(5)], today).text, /5 чашек/); assert.match(caffeineHint([night(), eve(11)], today).text, /11 чашек/);
  assert.equal(caffeineHint([night(), eve(2)], today), null, 'две чашки — не повод');
  assert.equal(caffeineHint([makeCheckin('m', today, { sleepQuality: 4, sleepHours: 7.5 }, '', 1), eve(5)], today), null, 'спал хорошо — молчим');
  assert.ok(caffeineHint([makeCheckin('m', today, { sleepHours: 4.5, energy: 3 }, '', 1), eve(3)], today), 'короткая ночь тоже считается');
  assert.equal(caffeineHint([night()], today), null, 'нет вечерней отметки вчера');
  assert.equal(caffeineHint([], today), null);
});

test('вечерний ритуал: шаги, порядок и одна запись на день', () => {
  assert.equal(RITUAL_STEPS.length, 6); assert.deepEqual([...new Set(RITUAL_STEPS.map(x => x[2]))], ['Подготовка ко сну', 'Завершение дня']);
  assert.throws(() => makeRitual('2026-11-14', []), /хотя бы один/); assert.throws(() => makeRitual('2026-11-14', ['zzz']), /хотя бы один/); assert.throws(() => makeRitual('вчера', ['screen']), /bad date/);
  const a = makeRitual('2026-11-14', ['plan', 'screen', 'screen', 'bogus'], 10);
  assert.equal(a.id, 'ritual:2026-11-14'); assert.deepEqual(a.payload.steps, ['screen', 'plan'], 'порядок как в списке, без повторов и лишнего');
  const b = makeRitual('2026-11-14', ['screen', 'plan', 'prep'], 20, a);
  assert.equal(b.ts, 10); assert.equal(b.payload.editedAt, 20); assert.equal(ritualOf([b], '2026-11-14'), b); assert.equal(ritualOf([b], '2026-11-15'), null);
});

test('заготовки: привычки, заметка с покупками, шаги как замер', () => {
  const names = HABIT_TEMPLATES.map(t => t.name);
  for (const n of ['Свет утром', 'Растяжка', 'Час без экрана']) assert.ok(names.includes(n), n);
  assert.ok(HABIT_TEMPLATES.every(t => t.name && t.anchor && t.minimum && t.full));
  assert.equal(new Set(names).size, names.length);
  assert.ok(NOTE_TEMPLATES.some(t => t.id === 'groceries'));
  const g = templateText('groceries', '2026-11-14');
  assert.match(g, /^Покупки на неделю: /); assert.match(g, /Овощи и фрукты:/); assert.match(g, /#покупки/);
  assert.equal(MEASURES.steps.label, 'Шаги');
  assert.equal(makeMeasure({ kind: 'steps', value: '8 432' }, 1).payload.value, 8432);
  assert.throws(() => makeMeasure({ kind: 'steps', value: '-5' }, 1), /от 0 до/);
});

test('письмо: счёт слов', () => {
  assert.equal(wordCount(''), 0); assert.equal(wordCount(null), 0); assert.equal(wordCount('   '), 0);
  assert.equal(wordCount('Сегодня был хороший день.'), 4); assert.equal(wordCount('one-two three'), 2); assert.equal(wordCount("I'm fine, thanks!"), 3);
  assert.equal(wordCount('Привет,\nмир\t2026'), 3, 'числа тоже слова, переносы строк не мешают');
  assert.equal(wordCount('— … !!!'), 0);
});

test('письмо: серия записей и статистика', () => {
  const d = (date, text = 'текст', extra = {}) => makeDiary(date, { text, ...extra }, 1);
  const evs = [d('2026-11-10'), d('2026-11-11'), d('2026-11-12', '', { highlight: 'Главное' }), d('2026-11-08')];
  assert.equal(diaryStreak(evs, '2026-11-12'), 3, 'записи 10–12: главное тоже считается');
  assert.equal(diaryStreak(evs, '2026-11-13'), 3, 'сегодня ещё не писал: серия не сгорает');
  assert.equal(diaryStreak(evs, '2026-11-14'), 0, 'пропущен целый день');
  assert.equal(diaryStreak([], '2026-11-12'), 0);
  assert.equal(diaryEntries([makeDiary('2026-11-09', { text: 'х' }, 1), { ...makeDiary('2026-11-09', { text: 'х' }, 1), id: 'zz', payload: { date: '2026-11-07', text: '', highlight: '', gratitude: [] } }]).length, 1, 'пустые записи не считаются');
  const st = diaryStats([d('2026-11-12', 'раз два три'), d('2026-11-11', 'четыре пять'), d('2026-09-01', 'давно')], '2026-11-12');
  assert.deepEqual([st.wordsToday, st.streak, st.entries, st.words, st.total], [3, 2, 2, 5, 3]);
});

test('свободное письмо дописывается к записи дня и ничего не стирает', () => {
  const day = '2026-11-14';
  assert.throws(() => appendFreeWrite([], day, '   '), /Пусто/);
  const first = appendFreeWrite([], day, 'Просто пишу всё, что приходит в голову.', 100);
  assert.equal(first.id, `diary:${day}`); assert.match(first.payload.text, new RegExp(`^${FREE_HEADER} \\(7 слов\\):\n`));
  const prev = makeDiary(day, { text: 'Утренняя запись', highlight: 'Главное', gratitude: ['семья'] }, 50);
  const merged = appendFreeWrite([prev], day, 'Ещё немного текста', 200);
  assert.ok(merged.payload.text.startsWith('Утренняя запись\n\nСвободное письмо (3 слов'));
  assert.equal(merged.payload.highlight, 'Главное'); assert.deepEqual(merged.payload.gratitude, ['семья']); assert.equal(merged.ts, 50);
});

test('книга года: месяцы, дни, главное, благодарности, темы', () => {
  const evs = [
    makeDiary('2026-01-05', { text: 'Начало года #планы', highlight: 'Составил план', gratitude: ['здоровье', 'семья'] }, 1),
    makeDiary('2026-11-14', { text: 'Суббота. #планы и #семья\nВторая строка' }, 1), makeDiary('2025-12-31', { text: 'Прошлый год' }, 1),
  ];
  assert.deepEqual(diaryYears(evs), ['2026', '2025']);
  const b = yearBook(evs, 2026);
  for (const need of ['# Книга года 2026', 'Записей: 2, слов: ', 'Частые темы: #планы (2), #семья (1)', '## Январь 2026', '### 5 января, понедельник', '**Главное:** Составил план', 'Благодарность: здоровье; семья', '## Ноябрь 2026', '### 14 ноября, суббота', 'Вторая строка']) assert.ok(b.includes(need), need);
  assert.ok(!b.includes('Прошлый год'), 'чужой год не попадает');
  assert.ok(b.indexOf('Январь') < b.indexOf('Ноябрь'));
  assert.match(yearBook(evs, 2030), /_В этом году записей нет\._/);
});

test('экзамен: случайные начатые карточки, без повторов, воспроизводимо', () => {
  const en = ACADEMY_TRACKS[0], deck = academyCards(en).filter(c => c.kind === 'deck');
  assert.deepEqual(examQueue({ events: [], n: 20, seed: 1 }), [], 'без занятий экзамена нет');
  const started = deck.slice(0, 14).map(c => srsEvent({ ...newState(c.id, '2026-11-01'), box: 2, due: '2026-12-01' }, 1));
  const evs = [lessonDone(en, en.lessons[0], '2026-11-02', 1), ...started];
  const q = examQueue({ events: evs, trackId: 'english', n: 10, seed: 3 });
  assert.equal(q.length, 10); assert.equal(new Set(q.map(x => x.card.id)).size, 10, 'без повторов');
  assert.ok(q.every(x => x.state && x.state.box === 2), 'берём только начатые, если их достаточно');
  assert.deepEqual(examQueue({ events: evs, trackId: 'english', n: 10, seed: 3 }).map(x => x.card.id), q.map(x => x.card.id), 'то же зерно — тот же набор');
  assert.notDeepEqual(examQueue({ events: evs, trackId: 'english', n: 10, seed: 4 }).map(x => x.card.id), q.map(x => x.card.id));
  assert.equal(examQueue({ events: evs, n: 20, seed: 1 }).length, 14, 'по всем курсам: всё начатое, если меньше двадцати');
  // начато мало: экзамен по всему доступному в курсе
  const few = examQueue({ events: [lessonDone(en, en.lessons[0], '2026-11-02', 1), ...started.slice(0, 3)], trackId: 'english', n: 20, seed: 1 });
  assert.equal(few.length, 20); assert.ok(few.some(x => !x.state));
  assert.deepEqual(examQueue({ events: evs, trackId: 'nope', n: 5 }), []);
});

test('мини-квиз после урока: вопросы из карточек урока, ровно один верный вариант', () => {
  for (const track of ACADEMY_TRACKS.slice(0, 3)) {
    for (const lesson of track.lessons.slice(0, 4)) {
      const quiz = quizFor(track, lesson, { seed: 5 });
      assert.equal(quiz.length, Math.min(3, lesson.cards.length));
      for (const item of quiz) {
        const card = lesson.cards.find(([q]) => q === item.q);
        assert.ok(card, 'вопрос взят из карточек урока');
        assert.equal(item.options.length, 4); assert.equal(new Set(item.options).size, 4, 'варианты различаются');
        assert.equal(item.options[item.answer], card[1], 'верный вариант на указанном месте');
        assert.equal(item.options.filter(o => o === card[1]).length, 1);
      }
      assert.equal(new Set(quiz.map(x => x.q)).size, quiz.length, 'вопросы не повторяются');
    }
  }
  const t = ACADEMY_TRACKS[0], l = t.lessons[1];
  assert.deepEqual(quizFor(t, l, { seed: 9 }), quizFor(t, l, { seed: 9 }));
  assert.notDeepEqual(quizFor(t, l, { seed: 9 }), quizFor(t, l, { seed: 10 }));
  assert.equal(quizFor(t, { ...l, cards: [l.cards[0], l.cards[1]] }, { seed: 1 }).length, 2, 'в коротком уроке вопросов меньше трёх');
});
