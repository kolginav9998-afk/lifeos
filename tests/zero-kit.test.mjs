// Курсы «с нуля»: конструкторы заданий, проверка ответов, граф предпосылок и область допуска (что можно показывать в уроке).
// Тесты на настоящие маршруты (TRACKS с zero: true) — страж для авторов содержания: нарушение правил = красный тест.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  choose, listen, typed, order, match, read, validateDrill, gradeDrill, normAnswer, pickCheckItems, shuffled,
  lessonIndex, closureOf, graphProblems, scopeOf, validateZeroTrack, MIN_DRILLS, checkOf,
} from '../zero-kit.js';
import { TRACKS, validateTrack } from '../academy.js';

// ---------- заготовки ----------
const filler = n => Array.from({ length: n }, (_, i) => choose(`Вопрос номер ${i + 1}`, 'да', ['нет', 'не знаю']));
const lesson = (id, o = {}) => ({ id, title: id, minutes: 3, stage: 'Этап', needs: [], intro: '', drills: filler(MIN_DRILLS), cards: [['в', 'о'], ['в', 'о2']], ...o });
const route = (lang, lessons, extra = {}) => ({ id: 'tst', zero: true, lang, ...(lang === 'hebrew' ? { branch: 'modern' } : {}), lessons, ...extra });
const problems = (t, extraTracks = []) => validateZeroTrack(t, lessonIndex([t, ...extraTracks]));

// ---------- задания ----------
test('задания: правильные проходят проверку структуры, неправильные нет', () => {
  assert.deepEqual(validateDrill(choose('Какая буква?', 'b', ['d', 'p'])), []);
  assert.deepEqual(validateDrill(listen('cat', 'cat', ['cut', 'cot'])), []);
  assert.deepEqual(validateDrill(typed('Впиши', ['да', 'Да'])), []);
  assert.deepEqual(validateDrill(order('Собери', ['a', 'b', 'c'], { dir: 'rtl' })), []);
  assert.deepEqual(validateDrill(match('Соедини', [['a', '1'], ['b', '2'], ['c', '3']])), []);
  assert.deepEqual(validateDrill(read('cat')), []);
  assert.ok(validateDrill(choose('q', 'a', ['b'])).length, 'нужно минимум два неверных варианта');
  assert.ok(validateDrill(choose('q', 'a', ['a', 'b'])).length, 'правильный среди неверных');
  assert.ok(validateDrill(choose('q', 'a', ['b', 'b'])).length, 'повторы');
  assert.ok(validateDrill(choose('q', 'a', ['b', 'c', 'd', 'e', 'f', 'g'])).length, 'больше шести вариантов');
  assert.ok(validateDrill(listen('', 'a', ['b', 'c'])).length, 'нечего озвучить');
  assert.ok(validateDrill(typed('q', [])).length);
  assert.ok(validateDrill(order('q', ['a'])).length);
  assert.ok(validateDrill(order('q', ['a', 'b'], { dir: 'up' })).length);
  assert.ok(validateDrill(match('q', [['a', '1'], ['b', '2']])).length, 'меньше трёх пар');
  assert.ok(validateDrill(match('q', [['a', '1'], ['a', '2'], ['c', '3']])).length, 'повтор слева');
  assert.ok(validateDrill({ t: 'quiz' }).length);
  assert.ok(validateDrill(null).length);
});

test('ответы: проверка по видам заданий', () => {
  assert.equal(gradeDrill(choose('q', 'b', ['d', 'p']), 'b'), true);
  assert.equal(gradeDrill(choose('q', 'b', ['d', 'p']), 'd'), false);
  assert.equal(gradeDrill(typed('q', ['Ёж', 'ёжик']), '  ЕЖ! '), true, 'регистр, ё/е, знаки и пробелы не мешают');
  assert.equal(gradeDrill(typed('q', '26'), '27'), false);
  const o = order('q', ['א', 'ב', 'ג'], { dir: 'rtl' });
  assert.equal(gradeDrill(o, ['א', 'ב', 'ג']), true);
  assert.equal(gradeDrill(o, ['ב', 'א', 'ג']), false);
  assert.equal(gradeDrill(o, ['א', 'ב']), false);
  const m = match('q', [['a', '1'], ['b', '2'], ['c', '3']]);
  assert.equal(gradeDrill(m, [['c', '3'], ['a', '1'], ['b', '2']]), true, 'порядок пар не важен');
  assert.equal(gradeDrill(m, [['a', '2'], ['b', '1'], ['c', '3']]), false);
  assert.equal(gradeDrill(m, [['a', '1'], ['b', '2']]), false);
  assert.equal(gradeDrill(read('cat'), 'x'), null, 'чтение вслух не оценивается');
  assert.equal(normAnswer('  Привет,  МИР!'), 'привет мир');
});

test('проверка урока: n заданий, разные виды, порядок зависит от зерна и не повторяется внутри', () => {
  const drills = [...filler(6), typed('t1', 'a'), typed('t2', 'b'), order('o1', ['x', 'y']), read('r')];
  const l = lesson('ez-01', { drills });
  const a = pickCheckItems(l, 7), b = pickCheckItems(l, 7), c = pickCheckItems(l, 8);
  assert.equal(a.length, checkOf(l).n);
  assert.deepEqual(a, b, 'то же зерно — та же проверка');
  assert.notDeepEqual(a.map(d => d.q), c.map(d => d.q), 'другое зерно — другой набор или порядок');
  assert.equal(new Set(a).size, a.length);
  assert.ok(a.every(d => d.t !== 'read'), 'чтение вслух в проверку не попадает');
  assert.ok(new Set(a.map(d => d.t)).size >= 3, 'виды чередуются');
  assert.deepEqual(shuffled([1, 2, 3, 4, 5], 3), shuffled([1, 2, 3, 4, 5], 3));
  assert.equal(shuffled([1, 2, 3, 4, 5], 3).length, 5);
});

// ---------- граф ----------
test('граф: циклы и неизвестные предпосылки находятся, цепочка считается по всем курсам', () => {
  const a = route('english', [lesson('ez-01'), lesson('ez-02', { needs: ['ez-01'] }), lesson('ez-03', { needs: ['ez-02', 'xx-99'] })]);
  assert.match(graphProblems(lessonIndex([a])).join('|'), /нет урока xx-99/);
  const cyc = route('english', [lesson('ez-01', { needs: ['ez-02'] }), lesson('ez-02', { needs: ['ez-01'] })]);
  assert.match(graphProblems(lessonIndex([cyc])).join('|'), /цикл/);
  const b = route('hebrew', [lesson('hz-01', { needs: ['ez-02'] })]);
  assert.deepEqual([...closureOf('hz-01', lessonIndex([a, b]))].sort(), ['ez-01', 'ez-02', 'hz-01']);
  assert.ok(problems(route('english', [lesson('ez-01', { needs: ['ez-02'] }), lesson('ez-02')])).some(m => /должен стоять в списке раньше/.test(m)), 'предпосылка обязана стоять раньше в списке');
});

test('маршрут: обязательные поля урока', () => {
  assert.deepEqual(problems(route('english', [lesson('ez-01')])), []);
  assert.ok(problems(route('english', [lesson('ez-01', { stage: '' })])).some(m => /stage/.test(m)));
  assert.ok(problems(route('english', [lesson('ez-01', { drills: filler(3) })])).some(m => /drills/.test(m)));
  assert.ok(problems(route('english', [lesson('ez-01', { drills: [...filler(7), read('x')] })])).some(m => /проверяемых/.test(m)));
  assert.ok(problems(route('english', [lesson('ez-01', { check: { n: 2 } })])).some(m => /check/.test(m)));
  assert.ok(problems(route('english', [lesson('ez-01', { decay: 9 })])).some(m => /decay/.test(m)));
  assert.ok(problems({ ...route('english', [lesson('ez-01')]), zero: false }).some(m => /zero/.test(m)));
  assert.ok(problems({ ...route('hebrew', [lesson('hz-01')]), branch: 'x' }).some(m => /branch/.test(m)));
});

// ---------- область допуска: английский ----------
test('английский: нельзя показывать буквы и сочетания, которые ещё не введены', () => {
  const t = route('english', [
    lesson('ez-01', { intro: 'c a t', drills: [...filler(7), choose('Какая это буква?', 'c', ['a', 't'], { big: 'C' })] }),
    lesson('ez-02', { needs: ['ez-01'], intro: 's h sh', drills: [...filler(7), choose('Прочитай слово', 'cash', ['cat', 'at'])] }),
  ]);
  assert.deepEqual(problems(t), [], 'буквы введены раньше или в том же уроке');
  const early = route('english', [
    lesson('ez-01', { intro: 'c a t', drills: [...filler(7), choose('Прочитай', 'cash', ['cat', 'at'])] }),
    lesson('ez-02', { needs: ['ez-01'], intro: 's h sh' }),
  ]);
  assert.ok(problems(early).some(m => /буквы s, h ещё не введены/.test(m)), 'слово cash в первом уроке нельзя');
  const pattern = route('english', [
    lesson('ez-01', { intro: 'a s h' }),
    lesson('ez-02', { needs: ['ez-01'], drills: [...filler(7), choose('Прочитай', 'ash', ['as', 'a'])] }),
    lesson('ez-03', { needs: ['ez-02'], intro: 'sh' }),
  ]);
  assert.ok(problems(pattern).some(m => /сочетание «sh» ещё не введено/.test(m)), 'буквы известны, но «sh» ещё нет');
});

test('английский: слова целиком (sight), показ на слух (showcase) и транскрипция в слешах не нарушают допуск', () => {
  const t = route('english', [
    lesson('ez-01', { intro: 'a t', sight: ['the'], drills: [...filler(7), choose('Прочитай', 'the', ['at', 'a'])] }),
    lesson('ez-02', { needs: ['ez-01'], showcase: ['apple'], drills: [...filler(7), choose('Слово apple звучит как /æpl/', 'a', ['t', 'at'])] }),
  ]);
  assert.deepEqual(problems(t), []);
  const noShow = route('english', [lesson('ez-01', { intro: 'a t', drills: [...filler(7), choose('Слово apple', 'a', ['t', 'at'])] })]);
  assert.ok(problems(noShow).some(m => /apple/.test(m)));
});

// ---------- область допуска: иврит ----------
test('иврит: буквы и знаки только введённые; слова без огласовок только после этапа niqqud', () => {
  const ok = route('hebrew', [
    lesson('hz-01', { intro: 'א ב', drills: [...filler(7), choose('Какое слово написано?', 'אב', ['בא', 'אא'])] }),
  ]);
  assert.ok(problems(ok).some(m => /слово без огласовок/.test(m)), 'два согласных подряд без огласовок до этапа niqqud нельзя');
  const vowels = route('hebrew', [
    lesson('hz-01', { intro: 'א ב ַ', drills: [...filler(7), choose('Какое слово написано?', 'אַב', ['בַא', 'אַא'])] }),
  ]);
  assert.deepEqual(problems(vowels), [], 'с огласовкой — можно');
  const letterNotYet = route('hebrew', [
    lesson('hz-01', { intro: 'א', drills: [...filler(7), choose('Какая это буква?', 'א', ['ג', 'ד'])] }),
  ]);
  assert.ok(problems(letterNotYet).some(m => /ג/.test(m)), 'буква ג ещё не введена');
  const final = route('hebrew', [
    lesson('hz-01', { intro: 'מ ם', milestone: 'niqqud' }),
    lesson('hz-02', { needs: ['hz-01'], plain: true, drills: [...filler(7), choose('Какое слово написано?', 'מם', ['ממ', 'םם'])] }),
  ]);
  assert.deepEqual(problems(final), [], 'после milestone niqqud слова без огласовок разрешены в уроках plain: true');
  const plainEarly = route('hebrew', [lesson('hz-01', { plain: true })]);
  assert.ok(problems(plainEarly).some(m => /plain: true/.test(m)), 'plain без пройденного этапа niqqud нельзя');
});

test('область допуска считается по цепочке предпосылок через курсы', () => {
  const en = route('english', [lesson('ez-01', { intro: 'a b', sight: ['the'] }), lesson('ez-02', { needs: ['ez-01'], intro: 'c' })]);
  const other = route('english', [lesson('xz-01', { needs: ['ez-02'], intro: 'd' })]);
  const sc = scopeOf('xz-01', lessonIndex([en, other]));
  assert.deepEqual([...sc.chars].sort(), ['a', 'b', 'c', 'd']);
  assert.ok(sc.sight.has('the'));
});

// ---------- настоящие маршруты приложения ----------
test('настоящие курсы с нуля: структура, граф и допуск без нарушений', () => {
  const zero = TRACKS.filter(t => t.zero);
  assert.ok(zero.length >= 3, 'английский, иврит, библейский иврит');
  const index = lessonIndex(TRACKS);
  assert.deepEqual(graphProblems(index), []);
  for (const t of zero) {
    assert.deepEqual(validateTrack(t), [], `${t.id}: общая структура курса`);
    assert.deepEqual(validateZeroTrack(t, index), [], `${t.id}: маршрут с нуля`);
  }
  assert.ok(zero.some(t => t.lang === 'english') && zero.some(t => t.branch === 'modern') && zero.some(t => t.branch === 'biblical'));
});
