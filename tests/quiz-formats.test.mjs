// Новые форматы заданий (quiz.js): генерация, проверка ответов, детерминизм и область допуска.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gradeItem, chooseItems, clozeOf, clozeItems, spotErrorItems, mixedLessonQuiz,
  dictationItems, dictationWordsOf, keywordsOfCards, checkExplain,
  BOTH_WRONG, CONTRAST_LATIN, CONTRAST_HEBREW, contrastPairsFor, contrastItems,
  stageNames, doneStages, stageLetters, stageReviewItems, microFromLessons,
} from '../quiz.js';
import { TRACKS, trackById, cardsOfTrack } from '../academy.js';

const CARDS = [
  ['Что закрепляет слово надолго?', 'Повторение с нарастающими интервалами'],
  ['Какие слова учить в первую очередь?', 'Самые частотные слова языка'],
  ['Как будет «Он студент»?', 'He is a student'],
  ['Какой артикль перед apple?', 'Артикль an перед гласным звуком'],
];
const OTHERS = [
  ['в1', 'Шэдоуинг улучшает произношение и беглость речи'],
  ['в2', 'Губы трубочкой, зубы губу не касаются'],
  ['в3', 'She works here every day'],
  ['в4', 'Понятный материал усваивается лучше'],
];

// ---------- проверка ответов ----------
test('gradeItem: выбор, ошибка и вписанный ответ', () => {
  assert.equal(gradeItem({ t: 'choice', options: ['а', 'б'], answer: 1 }, 1), true);
  assert.equal(gradeItem({ t: 'choice', options: ['а', 'б'], answer: 1 }, 0), false);
  assert.equal(gradeItem({ t: 'error', words: ['x', 'y'], wrong: 0 }, 0), true);
  assert.equal(gradeItem({ t: 'error', words: ['x', 'y'], wrong: 0 }, 1), false);
  assert.equal(gradeItem({ t: 'typed', ok: ['Кошка'] }, '  кошка! '), true, 'регистр и знаки не мешают');
  assert.equal(gradeItem({ t: 'typed', ok: ['кошка'] }, 'собака'), false);
  assert.equal(gradeItem(null, 0), null);
  assert.equal(gradeItem({ t: 'read' }, 'x'), null, 'незнакомый вид не оценивается');
});

// ---------- выбор варианта ----------
test('chooseItems: верный ответ среди вариантов, пустышки из других карточек', () => {
  const items = chooseItems(CARDS, OTHERS, { seed: 5, n: 3 });
  assert.equal(items.length, 3);
  for (const it of items) {
    assert.equal(it.t, 'choice');
    assert.ok(it.options.includes(CARDS.find(([q]) => q === it.q)[1]), 'верный ответ на месте');
    assert.equal(new Set(it.options).size, it.options.length, 'варианты не повторяются');
    assert.equal(gradeItem(it, it.answer), true);
  }
  assert.deepEqual(chooseItems(CARDS, OTHERS, { seed: 5 }), chooseItems(CARDS, OTHERS, { seed: 5 }), 'детерминизм по зерну');
});

// ---------- cloze ----------
test('clozeOf: скрывается самое длинное слово ответа, которого нет в вопросе', () => {
  const c = clozeOf('Что закрепляет слово надолго?', 'Повторение с нарастающими интервалами');
  assert.equal(c.key, 'нарастающими');
  assert.match(c.masked, /____/);
  assert.ok(!c.masked.includes('нарастающими'));
  assert.equal(clozeOf('Повторение и интервалы', 'Повторение'), null, 'нечего скрыть — задания нет');
});

test('clozeItems: дистракторы из других карточек, верный ответ находится', () => {
  const items = clozeItems(CARDS, OTHERS, { seed: 3, n: 3 });
  assert.ok(items.length >= 2);
  for (const it of items) {
    assert.match(it.q, /Закончи фразу: .*____/);
    assert.ok(it.explain.includes('Полная фраза'));
    assert.equal(gradeItem(it, it.answer), true);
    assert.equal(gradeItem(it, (it.answer + 1) % it.options.length), false);
  }
});

// ---------- «найди ошибку» ----------
test('spotErrorItems: ровно одно слово подменено, и это слово — готовый дистрактор', () => {
  const items = spotErrorItems(CARDS, OTHERS, { seed: 9, n: 3 });
  assert.ok(items.length >= 1);
  for (const it of items) {
    assert.equal(it.t, 'error');
    const orig = it.full.split(/\s+/).filter(Boolean);
    assert.equal(it.words.length, orig.length, 'длина фразы не меняется');
    const diff = it.words.map((w, i) => (w === orig[i] ? 0 : 1));
    assert.equal(diff.reduce((s, x) => s + x, 0), 1, 'подменено ровно одно слово');
    assert.equal(diff[it.wrong], 1, 'индекс ошибки указывает на подмену');
    assert.equal(orig[it.wrong], it.right);
    assert.equal(gradeItem(it, it.wrong), true);
    assert.equal(gradeItem(it, (it.wrong + 1) % it.words.length), false);
  }
});

test('mixedLessonQuiz: смесь форматов, все задания проверяются', () => {
  const qs = mixedLessonQuiz(CARDS, OTHERS, { seed: 42 });
  assert.ok(qs.length >= 3);
  assert.ok(qs.some(q => q.t === 'choice'));
  for (const q of qs) assert.ok(gradeItem(q, q.t === 'typed' ? q.ok[0] : q.t === 'error' ? q.wrong : q.answer) === true);
  assert.deepEqual(mixedLessonQuiz(CARDS, OTHERS, { seed: 42 }), mixedLessonQuiz(CARDS, OTHERS, { seed: 42 }));
});

// ---------- диктант на слух ----------
test('dictationItems: только переданные слова, ответ вписывается', () => {
  const words = ['cat', { say: 'dog', ok: ['dog', 'Dog'] }];
  const items = dictationItems(words, { seed: 2, lang: 'english' });
  assert.equal(items.length, 2);
  for (const it of items) {
    assert.equal(it.t, 'typed');
    assert.ok(it.say && words.some(w => (typeof w === 'string' ? w : w.say) === it.say), 'слово только из области допуска');
    assert.equal(it.lang, 'english');
    assert.equal(gradeItem(it, it.say.toUpperCase()), true);
  }
  assert.equal(dictationItems([], { seed: 1 }).length, 0);
});

test('dictationWordsOf: слова из уроков «с нуля», только уже введённые', () => {
  const ez = trackById('enzero');
  const lessons = ez.lessons.filter(l => l.stage === 'Звуки');
  const words = dictationWordsOf(lessons);
  assert.ok(words.includes('think'), 'showcase-слово попало в диктант');
  assert.ok(words.every(w => !/\s/.test(w)), 'только отдельные слова');
  const later = dictationWordsOf(ez.lessons.filter(l => l.stage !== 'Звуки'));
  assert.ok(!later.includes('think') || words.includes('think'), 'слова других этапов не подмешиваются');
});

// ---------- «объясни сам» ----------
test('keywordsOfCards: опорные слова из ответов, без стоп-слов', () => {
  const kws = keywordsOfCards(CARDS);
  assert.ok(kws.length >= 3);
  assert.ok(kws.includes('Повторение'));
  assert.ok(!kws.includes('между'), 'стоп-слова не попадают');
  assert.ok(kws.every(w => w.length >= 5));
});

test('checkExplain: зачёт по опорным словам, формы слов засчитываются', () => {
  const kws = keywordsOfCards(CARDS);
  const good = checkExplain('Слово закрепляет повторение с интервалами. Частотные слова учат первыми.', kws);
  assert.equal(good.ok, true);
  assert.ok(good.hits.length >= good.need);
  assert.equal(good.sentences, 2);
  const bad = checkExplain('Я посмотрел урок.', kws);
  assert.equal(bad.ok, false);
  assert.ok(bad.missing.length > 0);
  assert.equal(checkExplain('', kws).ok, false);
  assert.equal(checkExplain('текст', []).ok, false, 'без опорных слов зачёта нет');
});

// ---------- контрастные пары ----------
test('contrastPairsFor: только пары, обе буквы которых введены', () => {
  const pairs = contrastPairsFor(new Set(['b', 'd', 'p']), CONTRAST_LATIN);
  assert.deepEqual(pairs, [['b', 'd']], 'p без q — пара не берётся');
  assert.ok(contrastPairsFor(new Set(['ב', 'כ', 'ד', 'ר']), CONTRAST_HEBREW).length === 2);
});

test('contrastItems: похожие знаки вперемешку и вариант «оба неверных»', () => {
  const items = contrastItems([['b', 'd'], ['p', 'q'], ['m', 'w']], { seed: 4, n: 6 });
  assert.equal(items.length, 6);
  assert.ok(items.some(it => it.options[it.answer] === BOTH_WRONG), 'есть задание с верным «оба неверных»');
  assert.ok(items.some(it => it.options[it.answer] !== BOTH_WRONG), 'есть обычные задания');
  for (const it of items) {
    assert.equal(it.options.length, 3);
    assert.equal(it.options.at(-1), BOTH_WRONG);
    assert.ok(it.big);
    assert.equal(gradeItem(it, it.answer), true);
  }
  assert.deepEqual(contrastItems([['b', 'd']], { seed: 4, n: 3 }), contrastItems([['b', 'd']], { seed: 4, n: 3 }), 'детерминизм');
  assert.equal(contrastItems([], { seed: 1 }).length, 0);
});

// ---------- итог этапа ----------
test('stageReviewItems: только задания уроков этапа, нового материала нет', () => {
  const ez = trackById('enzero');
  const stage = ez.lessons.filter(l => l.stage === 'Звуки');
  assert.deepEqual(stageNames(ez).slice(0, 2), ['Звуки', 'Алфавит']);
  const pairs = contrastPairsFor(stageLetters(stage), CONTRAST_LATIN);
  const items = stageReviewItems(stage, { seed: 7, n: 8, pairs, dictation: dictationWordsOf(stage), lang: 'english' });
  assert.ok(items.length >= 8);
  const drills = new Set(stage.flatMap(l => l.drills ?? []).map(d => d.q));
  for (const it of items) {
    assert.ok(['choice', 'typed', 'error'].includes(it.t));
    if (it.q !== 'Что это за знак?' && it.q !== 'Напиши слово, которое услышал') assert.ok(drills.has(it.q), `вопрос из уроков этапа: ${it.q}`);
    assert.equal(gradeItem(it, it.t === 'typed' ? it.ok[0] : it.answer), true);
  }
  const kinds = new Set(items.map(i => i.t));
  assert.ok(kinds.has('choice') && kinds.has('typed'), 'виды заданий перемешаны');
});

test('doneStages: этап считается пройденным, когда освоены все его уроки', () => {
  const progress = { stages: [{ name: 'Звуки', lessons: [1, 2], done: 2 }, { name: 'Алфавит', lessons: [1, 2], done: 1 }, { name: 'Пустой', lessons: [], done: 0 }] };
  assert.deepEqual(doneStages(progress), ['Звуки']);
});

// ---------- микро-урок ----------
test('microFromLessons: один факт из пройденного и один вопрос', () => {
  const lessons = [
    { id: 'l1', title: 'Урок один', cards: CARDS.slice(0, 2) },
    { id: 'l2', title: 'Урок два', cards: CARDS.slice(2) },
  ];
  const m = microFromLessons(lessons, { seed: 11 });
  assert.ok(m);
  assert.ok(lessons.some(l => l.id === m.fact.lessonId));
  assert.ok(m.fact.q && m.fact.a);
  assert.equal(m.item.t, 'choice');
  assert.equal(gradeItem(m.item, m.item.answer), true);
  assert.equal(microFromLessons([], { seed: 1 }), null);
  assert.equal(microFromLessons([{ id: 'x', title: 'x', cards: [['в', 'о']] }], { seed: 1 }), null, 'урок с одной карточкой не подходит');
});

// ---------- на настоящих данных курсов ----------
test('мини-квиз новых форматов строится для каждого урока каждого курса', () => {
  for (const t of TRACKS.filter(x => !x.zero)) {
    const others = cardsOfTrack(t).map(c => [c.q, c.a]);
    for (const l of t.lessons) {
      const qs = mixedLessonQuiz(l.cards, others, { seed: 13 });
      assert.ok(qs.length >= Math.min(2, l.cards.length), `${t.id}/${l.id}: квиз построился`);
      for (const q of qs) assert.equal(gradeItem(q, q.t === 'typed' ? q.ok[0] : q.t === 'error' ? q.wrong : q.answer), true, `${t.id}/${l.id}: верный ответ засчитывается`);
    }
    const kws = keywordsOfCards(t.lessons[0].cards);
    assert.ok(kws.length >= 2, `${t.id}: нашлись опорные слова для «объясни сам»`);
  }
});
