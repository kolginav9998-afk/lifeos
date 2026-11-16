// Дикция: данные (скороговорки, ударения, разминка, тексты) и логика (программа дня, викторина, темп речи, самооценка, серии, записи).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REGISTRY } from '../registry.js';
import {
  TWISTERS, STRESS_WORDS, WARMUP, WARMUP_GROUPS, BREATH_PRESETS, TEXTS, SOUND_GROUPS, GROUP_IDS, TEMPOS, RUBRIC, RUBRIC_IDS, WPM_BANDS,
  syllables, tempoTarget, groupsOfSounds, filterTwisters, parseMarkup, plainText, countWords, wpm, wpmBand, makeDiction, makeSelf, dictionOf, dictionStreak, bestStreak, weekSummary, kindsToday,
  cleanScores, scoreAverage, selfTrend, autoWeak, weakGroups, twisterBest, suggestLevel, pickWarmup, warmupSet, pickTwisters, buildRoutine, stressQuiz, missedStress, dayNumber, warmupSeconds, twisterById,
} from '../diction.js';
import { stressIndex } from '../diction-stress.js';

const root = path.resolve(import.meta.dirname, '..');
const T = '2026-11-12', day = n => { const d = new Date(Date.UTC(2026, 10, 12 + n)); return d.toISOString().slice(0, 10); };
const tw = (date, ref, rating, tempo, seconds = 40, groups = []) => makeDiction({ kind: 'twister', seconds, items: 3, rating, ref, tempo, date, groups }, Date.parse(`${date}T10:00:00Z`) + Math.floor(Math.random() * 1000));

// ---------- скороговорки ----------
test('скороговорки: не меньше 120, номера и тексты уникальны, уровни 1–3, звуки встречаются в тексте', () => {
  assert.ok(TWISTERS.length >= 120, `сейчас ${TWISTERS.length}`);
  assert.equal(new Set(TWISTERS.map(t => t.id)).size, TWISTERS.length);
  assert.equal(new Set(TWISTERS.map(t => t.text.toLowerCase())).size, TWISTERS.length, 'тексты не повторяются');
  TWISTERS.forEach((t, i) => assert.equal(t.id, `tw${String(i + 1).padStart(3, '0')}`));
  for (const t of TWISTERS) {
    assert.ok([1, 2, 3].includes(t.level), t.id);
    assert.ok(t.text.length >= 10 && /[.!?»]$/.test(t.text), `${t.id}: конец фразы`);
    assert.ok(t.sounds.length >= 1 && t.sounds.every(s => /^[а-яё]+$/.test(s) && t.text.toLowerCase().includes(s)), `${t.id}: звуки ${t.sounds}`);
  }
  const byLevel = l => TWISTERS.filter(t => t.level === l);
  for (const l of [1, 2, 3]) assert.ok(byLevel(l).length >= 20, `уровень ${l}: ${byLevel(l).length}`);
  const avg = l => byLevel(l).reduce((s, t) => s + syllables(t.text), 0) / byLevel(l).length;
  assert.ok(avg(1) < avg(2) && avg(2) < avg(3), 'чем выше уровень, тем длиннее фраза');
});
test('скороговорки: у каждой группы звуков есть из чего выбирать, выбор по звуку и уровню работает', () => {
  for (const g of SOUND_GROUPS) assert.ok(filterTwisters({ group: g.id }).length >= 6, `группа ${g.id}: ${filterTwisters({ group: g.id }).length}`);
  const sh = filterTwisters({ group: 'hushing', sound: 'щ', level: 2 });
  assert.ok(sh.length >= 2 && sh.every(t => t.level === 2 && t.sounds.includes('щ')));
  assert.equal(filterTwisters().length, TWISTERS.length);
  assert.deepEqual(groupsOfSounds(['р', 'ж']).sort(), ['hushing', 'r']);
  assert.deepEqual(groupsOfSounds(['стр']), ['cluster']);
});
test('скороговорки: слоги и целевое время в трёх темпах', () => {
  assert.equal(syllables('Мама мыла раму'), 6);
  assert.deepEqual(TEMPOS.map(t => t.id), [1, 2, 3]);
  const text = 'Мама мыла раму';
  assert.deepEqual([1, 2, 3].map(t => tempoTarget(text, t)), [6, 4, 3]);
  assert.ok(tempoTarget(text, 1) > tempoTarget(text, 2) && tempoTarget(text, 2) > tempoTarget(text, 3), 'быстрее — меньше времени');
  assert.equal(tempoTarget(text, 9), null);
});

// ---------- ударения ----------
test('ударения: не меньше 150 слов, ровно одна заглавная гласная, ошибочная форма отличается, слова не повторяются', () => {
  assert.ok(STRESS_WORDS.length >= 150, `сейчас ${STRESS_WORDS.length}`);
  const V = 'АЕЁИОУЫЭЮЯ', marked = s => [...s].filter(c => V.includes(c));
  assert.equal(new Set(STRESS_WORDS.map(w => w.id)).size, STRESS_WORDS.length);
  for (const w of STRESS_WORDS) {
    assert.equal(marked(w.right).length, 1, `${w.id}: верная форма`);
    assert.equal(marked(w.wrong).length, 1, `${w.id}: ошибочная форма`);
    assert.notEqual(w.right, w.wrong);
    assert.equal(w.right.toLowerCase(), w.wrong.toLowerCase(), `${w.id}: это то же слово`);
    assert.notEqual(stressIndex(w.right), stressIndex(w.wrong), `${w.id}: ударение в другом месте`);
    assert.ok(/^[а-яёА-ЯЁ-]+$/.test(w.right) && w.hint.length >= 20 && w.hint.length <= 140, `${w.id}: подсказка`);
    assert.equal(w.id, w.right.toLowerCase());
  }
});
test('викторина: один seed — одни вопросы, верный ответ указан, варианты разные, ошибки прошлого попадают в викторину', () => {
  const a = stressQuiz({ seed: 7 }), b = stressQuiz({ seed: 7 }), c = stressQuiz({ seed: 8 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.map(q => q.id), c.map(q => q.id));
  assert.equal(a.length, 10);
  assert.equal(new Set(a.map(q => q.id)).size, 10);
  for (const q of a) {
    assert.ok(q.options.length >= 2 && q.options.length <= 3 && new Set(q.options).size === q.options.length);
    const w = STRESS_WORDS.find(x => x.id === q.id);
    assert.equal(q.options[q.answer], w.right);
    assert.ok(q.options.includes(w.wrong));
    assert.ok(q.options.every(o => o.toLowerCase() === q.word));
  }
  const miss = ['звонит', 'договор', 'алфавит', 'шарфы'];
  const q = stressQuiz({ seed: 3, n: 10, miss });
  assert.equal(miss.filter(id => q.some(x => x.id === id)).length, 4, 'ошибки прошлого попадают в викторину');
  assert.ok(stressQuiz({ seed: 3, n: 4, miss }).filter(x => miss.includes(x.id)).length >= 2, 'но не больше половины');
  const ev = [makeDiction({ kind: 'stress', seconds: 90, items: 10, ok: 7, miss: ['звонит', 'шарфы', 'нет-такого'], date: day(-3) }, 1), makeDiction({ kind: 'stress', seconds: 90, items: 10, ok: 9, miss: ['договор'], date: day(-2) }, 2)];
  assert.deepEqual(ev[0].payload.miss, ['звонит', 'шарфы'], 'неизвестные слова отбрасываются');
  assert.deepEqual(missedStress(ev, T), ['договор', 'звонит', 'шарфы'], 'сначала самые свежие ошибки');
  const later = makeDiction({ kind: 'stress', seconds: 90, items: 10, ok: 10, fixed: ['звонит', 'договор', 'алфавит'], date: day(-1) }, 3);
  assert.deepEqual(later.payload.fixed, ['звонит', 'договор', 'алфавит']);
  assert.deepEqual(missedStress([...ev, later], T), ['шарфы'], 'верный ответ после ошибки снимает слово с повторения');
  assert.deepEqual(missedStress(ev, day(60)), [], 'старые ошибки не считаются');
});

// ---------- разминка, дыхание, тексты ----------
test('разминка: около двадцати упражнений, у каждого шаги, повторы и типичные ошибки; дыхание — вдох и выдох', () => {
  assert.ok(WARMUP.length >= 20, `сейчас ${WARMUP.length}`);
  assert.equal(new Set(WARMUP.map(e => e.id)).size, WARMUP.length);
  for (const e of WARMUP) {
    assert.ok(Object.hasOwn(WARMUP_GROUPS, e.group), e.id);
    assert.ok(e.steps.length >= 2 && e.steps.every(s => s.length > 10) && e.mistakes.length >= 1 && e.reps >= 3 && e.hold >= 0, e.id);
    assert.ok(e.helps.length >= 1 && e.helps.every(g => GROUP_IDS.includes(g)), e.id);
    assert.ok(warmupSeconds(e) >= 20 && warmupSeconds(e) <= 90, `${e.id}: ${warmupSeconds(e)} с`);
  }
  for (const g of Object.keys(WARMUP_GROUPS)) assert.ok(WARMUP.filter(e => e.group === g).length >= 2, g);
  for (const b of BREATH_PRESETS) assert.ok(b.inhale >= 2 && b.exhale >= b.inhale && b.exhale <= 14 && b.hint.length > 20 && [1, 2, 3].includes(b.level), b.id);
  assert.equal(new Set(BREATH_PRESETS.map(b => b.id)).size, BREATH_PRESETS.length);
});
test('тексты для чтения: разметка парная, слов 10–120, номера уникальны', () => {
  assert.ok(TEXTS.length >= 10);
  assert.equal(new Set(TEXTS.map(t => t.id)).size, TEXTS.length);
  for (const t of TEXTS) {
    assert.equal((t.text.match(/\*/g) ?? []).length % 2, 0, `${t.id}: звёздочки парные`);
    const n = countWords(t.text);
    assert.ok(n >= 10 && n <= 120, `${t.id}: слов ${n}`);
    assert.ok([1, 2, 3].includes(t.level) && t.title && t.author && t.kind);
    assert.ok(!/[*/]/.test(plainText(t.text)), `${t.id}: в чистом тексте нет разметки`);
  }
});

// ---------- темп речи ----------
test('слова в минуту: подсчёт слов по тексту с разметкой, формула, границы ориентиров', () => {
  assert.equal(countWords('Мама мыла раму'), 3);
  assert.equal(countWords('*Мороз* и солнце; // день *чудесный*! //'), 5);
  assert.equal(countWords('Король-орёл, — орёл-король.'), 2, 'дефис внутри слова — одно слово, тире — не слово');
  assert.equal(countWords('  \n  '), 0);
  assert.equal(plainText('*Мороз* и солнце; // день *чудесный*! //\nЕщё / ты дремлешь'), 'Мороз и солнце; день чудесный!\nЕщё ты дремлешь');
  const mk = parseMarkup('Это *очень важно* и / нужно //')[0];
  assert.deepEqual(mk.map(t => t.w ? `${t.w}${t.stress ? '*' : ''}` : `|${t.pause}`), ['Это', 'очень*', 'важно*', 'и', '|1', 'нужно', '|2']);
  assert.equal(wpm(150, 60), 150); assert.equal(wpm(75, 30), 150); assert.equal(wpm(100, 90), 67); assert.equal(wpm(120, 120), 60);
  assert.equal(wpm(0, 60), null); assert.equal(wpm(100, 0), null); assert.equal(wpm(NaN, 5), null);
  assert.deepEqual([79, 80, 109, 110, 149, 150, 179, 180].map(v => wpmBand(v).id), ['very-slow', 'slow', 'slow', 'comfortable', 'comfortable', 'fast', 'fast', 'very-fast']);
  assert.equal(wpmBand(0), null);
  assert.ok(WPM_BANDS.every(b => b.note.length > 15));
});

// ---------- программа дня ----------
test('программа дня: влезает в заказанное время при любых слабых звуках и зёрнах', () => {
  const sets = [[], ['r'], ['hushing', 'whistling'], ['vowels'], ['cluster', 'velar', 'l'], GROUP_IDS];
  for (const minutes of [5, 10, 15]) for (const weak of sets) for (let seed = 0; seed < 40; seed++) for (const level of [1, 2, 3]) {
    const r = buildRoutine({ weak, minutes, seed, level });
    assert.ok(r.minutes <= minutes && r.minutes >= minutes - 1, `${minutes} мин, зерно ${seed}: ${r.minutes}`);
    assert.equal(r.minutes, r.blocks.reduce((s, b) => s + b.minutes, 0));
    for (const b of r.blocks) assert.ok(b.minutes >= 1 && b.title && ['breath', 'warmup', 'twister', 'reading', 'stress'].includes(b.kind));
    const w = r.blocks.find(b => b.kind === 'warmup');
    assert.ok(w.refs.length >= 2 && w.refs.every(id => WARMUP.some(e => e.id === id)));
    assert.ok(w.refs.reduce((s, id) => s + warmupSeconds(WARMUP.find(e => e.id === id)), 0) <= w.minutes * 60);
    const t = r.blocks.find(b => b.kind === 'twister');
    assert.ok(t.refs.length >= 1 && t.refs.every(id => twisterById(id)) && new Set(t.refs).size === t.refs.length);
  }
});
test('программа дня: при десяти минутах четыре блока; слабые звуки определяют скороговорки; зерно решает всё', () => {
  const r = buildRoutine({ weak: ['r'], minutes: 10, seed: 5, level: 1 });
  assert.deepEqual(r.blocks.map(b => b.kind).slice(0, 3), ['breath', 'warmup', 'twister']);
  assert.equal(r.blocks.length, 4);
  assert.equal(r.blocks[2].refs.length, 2);
  for (const seed of [1, 2, 3, 4]) for (const g of ['r', 'hushing', 'cluster']) {
    const t = buildRoutine({ weak: [g], seed }).blocks.find(b => b.kind === 'twister');
    assert.ok(t.refs.every(id => groupsOfSounds(twisterById(id).sounds).includes(g)), `${g}: все скороговорки на нужную группу`);
  }
  assert.deepEqual(buildRoutine({ weak: ['l'], seed: 9 }), buildRoutine({ weak: ['l'], seed: 9 }));
  const variety = new Set(Array.from({ length: 20 }, (_, s) => JSON.stringify(buildRoutine({ weak: [], seed: s }))));
  assert.ok(variety.size >= 10, 'программа меняется по дням');
  assert.deepEqual(new Set([1, 2, 3, 4].map(s => buildRoutine({ seed: s }).blocks[3].kind)), new Set(['reading', 'stress']), 'чтение и ударения чередуются');
  assert.equal(buildRoutine({ seed: 1, minutes: 7 }).minutes, 10, 'неизвестная длина — стандартные десять минут');
  assert.equal(dayNumber('1970-01-02'), 1); assert.ok(dayNumber('2026-11-13') - dayNumber('2026-11-12') === 1);
  const w = pickWarmup(180, { weak: ['r'], seed: 4 });
  assert.ok(w.seconds <= 180 && w.ids.some(id => WARMUP.find(e => e.id === id).helps.includes('r')));
  assert.deepEqual(pickWarmup(180, { seed: 2 }), pickWarmup(180, { seed: 2 }));
  assert.equal(warmupSet('nope'), null);
  assert.ok(warmupSet('tongue').ids.every(id => WARMUP.find(e => e.id === id).group === 'tongue'));
  assert.ok(warmupSet('min3', { seed: 1 }).ids.length >= 3);
  assert.equal(pickTwisters(3, { weak: ['r', 'l'], level: 2, seed: 1 }).length, 3);
});

// ---------- самооценка ----------
test('самооценка: шесть пунктов 1–5, среднее, запись по дате', () => {
  assert.deepEqual(RUBRIC_IDS, ['clarity', 'tempo', 'volume', 'intonation', 'pauses', 'fillers']);
  assert.ok(RUBRIC.every(r => r.title && r.ask && r.low && r.high));
  const all = n => Object.fromEntries(RUBRIC_IDS.map(id => [id, n]));
  assert.deepEqual(cleanScores(all(3)), all(3));
  assert.throws(() => cleanScores({ ...all(3), pauses: 0 }), /от 1 до 5/);
  assert.throws(() => cleanScores({ ...all(3), pauses: 2.5 }), /от 1 до 5/);
  assert.throws(() => cleanScores({ clarity: 3 }), /от 1 до 5/);
  assert.equal(scoreAverage({ clarity: 5, tempo: 4, volume: 3, intonation: 2, pauses: 1, fillers: 5 }), 3.3);
  const e = makeSelf({ scores: all(4), note: '  Хорошо  ', weak: ['r', 'нет', 'r'], date: day(-3) }, 5);
  assert.equal(e.id, `dictself:${day(-3)}`); assert.equal(e.type, 'dictself'); assert.equal(e.payload.note, 'Хорошо'); assert.deepEqual(e.payload.weak, ['r']);
  assert.equal(makeSelf({ scores: all(2), note: 'x'.repeat(500) }, 5).payload.note.length, 300);
  assert.equal(makeSelf({ scores: all(2) }, 5).payload.note, undefined);
  assert.throws(() => makeSelf({ scores: all(2), date: '2026-02-30' }, 5), /bad date/);
});
test('самооценка: динамика — последняя против предыдущей и первой, слабый и сильный пункты, ряд средних', () => {
  assert.equal(selfTrend([]), null);
  const sc = (c, t, v, i, p, f) => ({ clarity: c, tempo: t, volume: v, intonation: i, pauses: p, fillers: f });
  const mk = (date, scores) => makeSelf({ scores, date }, Date.parse(`${date}T12:00:00Z`));
  const one = selfTrend([mk(day(-20), sc(2, 3, 4, 2, 3, 1))]);
  assert.equal(one.n, 1); assert.equal(one.direction, 'none'); assert.equal(one.deltaPrev, null); assert.equal(one.weakest, 'fillers'); assert.equal(one.strongest, 'volume');
  const evs = [mk(day(-6), sc(3, 3, 4, 3, 3, 2)), mk(day(-20), sc(2, 3, 4, 2, 3, 1)), mk(day(0), sc(4, 3, 4, 4, 3, 3))];
  const tr = selfTrend([...evs, { id: 'x', type: 'task', ts: 1, payload: {} }]);
  assert.equal(tr.n, 3);
  assert.deepEqual(tr.avgs.map(a => a.date), [day(-20), day(-6), day(0)], 'по порядку дат');
  assert.deepEqual(tr.avgs.map(a => a.avg), [2.5, 3, 3.5]);
  assert.equal(tr.direction, 'up'); assert.equal(tr.overallDelta, 0.5);
  assert.deepEqual(tr.deltaPrev, { clarity: 1, tempo: 0, volume: 0, intonation: 1, pauses: 0, fillers: 1 });
  assert.deepEqual(tr.deltaFirst, { clarity: 2, tempo: 0, volume: 0, intonation: 2, pauses: 0, fillers: 2 });
  assert.equal(tr.weakest, 'tempo'); assert.equal(tr.strongest, 'clarity', 'при равенстве — первый пункт по порядку');
  assert.equal(selfTrend([mk(day(-6), sc(3, 3, 3, 3, 3, 3)), mk(day(0), sc(2, 2, 2, 2, 2, 2))]).direction, 'down');
  assert.equal(selfTrend([mk(day(-6), sc(3, 3, 3, 3, 3, 3)), mk(day(0), sc(3, 3, 3, 3, 3, 3))]).direction, 'same');
});

// ---------- занятия, серии, рекорды ----------
test('занятия: проверка полей, минуты и секунды, лишнее отбрасывается', () => {
  const e = makeDiction({ kind: 'twister', seconds: 95, items: 3, rating: 4, ref: 'tw001', groups: ['r', 'nope', 'r'], tempo: 2, ok: 9, miss: ['звонит'] }, 1000);
  assert.equal(e.type, 'diction'); assert.match(e.id, /^diction:/); assert.equal(e.ts, 1000);
  assert.deepEqual(e.payload, { date: e.payload.date, kind: 'twister', seconds: 95, minutes: 2, items: 3, rating: 4, ref: 'tw001', groups: ['r'], tempo: 2, miss: ['звонит'] });
  assert.equal(e.payload.ok, undefined, 'ok не больше числа заданий');
  assert.equal(makeDiction({ kind: 'warmup', seconds: 40, rating: 9, date: T }, 1).payload.rating, undefined);
  assert.equal(makeDiction({ kind: 'reading', seconds: 60, wpm: 123.6, date: T }, 1).payload.wpm, 124);
  assert.throws(() => makeDiction({ kind: 'warmup', seconds: 19 }), /20 секунд/);
  assert.equal(makeDiction({ kind: 'twister', seconds: 12, date: T }, 1).payload.seconds, 12, 'скороговорка в быстром темпе короче 20 секунд');
  assert.throws(() => makeDiction({ kind: 'twister', seconds: 2 }), /секундомер/);
  assert.equal(makeDiction({ kind: 'stress', seconds: 6, date: T }, 1).payload.seconds, 6);
  assert.throws(() => makeDiction({ kind: 'stress', seconds: 4 }), /5 секунд/);
  assert.throws(() => makeDiction({ kind: 'reading', seconds: 4 }), /5 секунд/);
  assert.throws(() => makeDiction({ kind: 'dance', seconds: 90 }), /вид/);
  assert.throws(() => makeDiction({ kind: 'warmup', seconds: 99999 }), /четырёх/);
  assert.throws(() => makeDiction({ kind: 'warmup', seconds: 60, date: '2026-13-01' }), /bad date/);
  assert.notEqual(makeDiction({ kind: 'warmup', seconds: 60 }, 5).id, makeDiction({ kind: 'warmup', seconds: 60 }, 5).id);
});
test('серия занятий: подряд идущие дни, сегодня ещё можно, лучшая серия, неделя', () => {
  const at = (n, kind = 'warmup', sec = 120) => makeDiction({ kind, seconds: sec, date: day(n) }, Date.parse(`${day(n)}T09:00:00Z`));
  assert.equal(dictionStreak([], T), 0);
  const evs = [at(0), at(-1), at(-2), at(-5), at(-6), at(-7), at(-8), at(-9)];
  assert.equal(dictionStreak(evs, T), 3);
  assert.equal(dictionStreak(evs.slice(1), T), 2, 'сегодня ещё не занимался: серия не сгорает');
  assert.equal(dictionStreak([at(-3)], T), 0);
  assert.equal(bestStreak(evs), 5);
  assert.equal(bestStreak([]), 0);
  const w = weekSummary([at(0, 'warmup', 120), at(0, 'twister', 90), at(-6, 'reading', 150), at(-7, 'reading', 600)], T);
  assert.deepEqual([w.minutes, w.sessions, w.days], [6, 3, 2]);
  assert.deepEqual(w.byKind, { warmup: 120, twister: 90, reading: 150 });
  assert.deepEqual([...kindsToday(evs, T)], ['warmup']);
  assert.equal(dictionOf([...evs, { id: 'q', type: 'task', ts: 1, payload: {} }]).length, evs.length);
});
test('рекорд по скороговорке: самый быстрый темп с чёткостью 4–5, при равном темпе — меньшее время', () => {
  assert.equal(twisterBest([], 'tw001'), null);
  assert.equal(twisterBest([tw(day(-1), 'tw001', 3, 3)], 'tw001'), null, 'чёткость ниже 4 рекордом не считается');
  const evs = [tw(day(-5), 'tw001', 4, 1, 30), tw(day(-4), 'tw001', 5, 2, 25), tw(day(-3), 'tw001', 4, 2, 21), tw(day(-2), 'tw001', 3, 3, 14), tw(day(-1), 'tw002', 5, 3, 12)];
  assert.deepEqual(twisterBest(evs, 'tw001'), { tempo: 2, seconds: 21, rating: 4, date: day(-3) });
  assert.equal(twisterBest(evs, 'tw002').tempo, 3);
});
test('уровень и слабые звуки: уровень растёт после трёх хороших занятий; слабые — выбор человека, затем самооценка, затем оценки', () => {
  const lv1 = TWISTERS.filter(t => t.level === 1).map(t => t.id), lv2 = TWISTERS.filter(t => t.level === 2).map(t => t.id);
  assert.equal(suggestLevel([]), 1);
  assert.equal(suggestLevel([tw(day(-3), lv1[0], 5, 1), tw(day(-2), lv1[1], 4, 1)]), 1);
  const three = [tw(day(-3), lv1[0], 5, 1), tw(day(-2), lv1[1], 4, 1), tw(day(-1), lv1[2], 4, 2)];
  assert.equal(suggestLevel(three), 2);
  assert.equal(suggestLevel([...three, tw(day(0), lv2[0], 5, 1), tw(day(0), lv2[1], 5, 1), tw(day(0), lv2[2], 4, 1)]), 3);
  assert.equal(suggestLevel([...three, tw(day(0), lv2[0], 5, 1), tw(day(0), lv2[1], 2, 1), tw(day(0), lv2[2], 5, 1)]), 2);
  const rated = [tw(day(-3), lv1[0], 2, 1, 40, ['r']), tw(day(-2), lv1[1], 3, 1, 40, ['r', 'l']), tw(day(-1), lv1[2], 5, 1, 40, ['l']), tw(day(-1), lv1[3], 5, 1, 40, ['hushing'])];
  assert.deepEqual(autoWeak(rated, T), ['r'], 'нужно хотя бы две оценки и среднее ниже 3,5');
  assert.deepEqual(autoWeak(rated, day(80)), [], 'старые оценки не считаются');
  const self = makeSelf({ scores: Object.fromEntries(RUBRIC_IDS.map(id => [id, 3])), weak: ['velar'], date: day(-1) }, 5);
  assert.deepEqual(weakGroups(rated, T), ['r']);
  assert.deepEqual(weakGroups([...rated, self], T), ['velar'], 'пометка в самооценке важнее вывода из оценок');
  assert.deepEqual(weakGroups([...rated, self], T, ['l', 'нет']), ['l'], 'выбор человека важнее всего');
  assert.deepEqual(weakGroups([], T), []);
});

// ---------- реестр и файлы ----------
test('типы записей diction и dictself описаны в реестре; файлы данных не больше 64 000 байт и без ключа type', () => {
  for (const t of ['diction', 'dictself']) { assert.ok(REGISTRY[t], t); assert.equal(REGISTRY[t].module, 'diction.js'); assert.equal(REGISTRY[t].privacy, 'learning'); }
  assert.equal(REGISTRY.diction.analytics, true); assert.equal(REGISTRY.dictself.analytics, false);
  const files = fs.readdirSync(root).filter(f => /^diction(-.*)?\.js$/.test(f));
  assert.ok(files.length >= 5);
  for (const f of files) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(Buffer.byteLength(s) <= 64000, `${f}: ${Buffer.byteLength(s)} байт`);
    if (f !== 'diction.js') assert.ok(!/\btype:/.test(s), `${f}: ключ type: только в записях`);
    assert.ok(!/https?:\/\//.test(s), `${f}: ссылки`);
  }
});

// ---------- курс «Дикция» ----------
import { TRACKS, validateTrack, lessonGoal, cardsOfTrack } from '../academy.js';
import { validateDrill, GRADED } from '../zero-kit.js';
import diction, { MODULES } from '../c-diction.js';

const course = TRACKS.find(t => t.id === 'diction');
const allText = o => (typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(allText) : o && typeof o === 'object' ? Object.values(o).flatMap(allText) : []);

test('курс: зарегистрирован, не «с нуля», проходит проверку структуры академии', () => {
  assert.equal(course, diction);
  assert.equal(course.zero, undefined, 'флага zero нет');
  assert.equal(course.icon, 'Дк');
  assert.deepEqual(validateTrack(course), []);
  assert.ok(course.mentor.principles.length >= 4 && course.mentor.prompts.length === 3 && course.plan.length === 4);
  assert.ok(course.mentor.prompts.every(p => p.length > 80), 'запросы для внешнего ИИ-тренера');
  assert.ok(!/https?:|www\./i.test(JSON.stringify(course)), 'ссылок нет');
});
test('курс: уроки di-NN идут подряд, модули по порядку, у каждого цель и честные границы', () => {
  const L = course.lessons;
  L.forEach((l, i) => assert.equal(l.id, `di-${String(i + 1).padStart(2, '0')}`));
  assert.deepEqual(MODULES.map(m => m.n), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(L.length, 32, 'уроков: 32');
  assert.deepEqual(MODULES.map(m => L.filter(l => l.module === m.n).length), [3, 3, 3, 8, 3, 3, 4, 5]);
  for (const l of L.filter(x => x.module === 4)) assert.ok(l.drills.some(d => d.t === 'read'), `${l.id}: в уроке про звуки есть чтение слогов, слов и фраз вслух`);
  let prev = 1;
  for (const l of L) { assert.ok(l.module >= prev && l.module <= 8 && MODULES.some(m => m.n === l.module), `${l.id}: модуль`); prev = l.module; }
  for (const l of L) {
    const g = lessonGoal(l.id);
    assert.ok(g.length >= 15 && g.length <= 120 && !/[.!?]$/.test(g) && !/^После урока/i.test(g), `${l.id}: цель «${g}»`);
    assert.ok(l.body.every(p => p.length <= 800), `${l.id}: абзац не длиннее 800 знаков`);
    assert.ok(l.cards.length >= 2 && l.cards.length <= 10);
  }
  assert.equal(new Set(L.map(l => lessonGoal(l.id))).size, L.length, 'цели не повторяются');
  const first = JSON.stringify(L[0]);
  for (const w of ['логопед', 'ЛОР', 'ИИ', 'боль', 'не записывает']) assert.ok(first.includes(w), `первый урок: «${w}»`);
});
test('курс: задания собраны конструкторами zero-kit и проходят проверку; проверяемых хватает', () => {
  for (const l of course.lessons) {
    assert.ok(l.drills.length >= 3, `${l.id}: заданий ${l.drills.length}`);
    l.drills.forEach((d, i) => assert.deepEqual(validateDrill(d), [], `${l.id}[${i}]`));
    assert.ok(l.drills.filter(d => GRADED.has(d.t)).length >= 2, `${l.id}: проверяемых заданий`);
    for (const d of l.drills) if (d.t === 'choose') assert.ok(d.wrong.length >= 2 && d.wrong.length <= 3);
  }
});
test('курс: без обещаний, диагнозов и лечения; карточки уникальны; файлы курса в пределах', () => {
  const text = allText(course).join(' ');
  assert.ok(!/вылеч|излеч|гарантир|за\s+\d+\s*(дн|недел|месяц)|заменяет врача|в совершенстве/i.test(text), 'опасное обещание');
  assert.ok(!/<script|javascript:/i.test(text));
  const cards = cardsOfTrack(course);
  assert.equal(new Set(cards.map(c => c.id)).size, cards.length);
  assert.equal(new Set(cards.map(c => c.q)).size, cards.length, 'вопросы карточек не повторяются');
  for (const f of ['c-diction.js', ...fs.readdirSync(root).filter(x => /^diction-les-/.test(x))]) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(Buffer.byteLength(s) <= 64000, `${f}: ${Buffer.byteLength(s)} байт`);
    assert.ok(!/\btype:/.test(s), `${f}: ключ type:`);
    for (const m of s.matchAll(/from\s*'\.\/([^']+)'/g)) assert.ok(m[1] === 'zero-kit.js' || /^diction-les-[a-z]\.js$/.test(m[1]), `${f} → ${m[1]}`);
  }
});
