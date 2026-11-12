// Курс «Английский с нуля» (enzero): проверки содержания. Допуск (что можно показывать) проверяет zero-kit; здесь добавлены ловушки для читающего:
// слова не по правилам, тихая e, нетронутые сочетания, смешение латиницы и кириллицы, размеры файлов, честность первого урока.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TRACKS, validateTrack } from '../academy.js';
import { lessonIndex, closureOf, graphProblems, scopeOf, textsOfLesson, englishWordProblems, validateZeroTrack, GRADED, checkOf } from '../zero-kit.js';

const COMPLETE = false;                          // true, когда написаны все этапы (1–7): тогда проверки полноты маршрута становятся обязательными
const track = TRACKS.find(t => t.id === 'enzero');
const L = track.lessons;
const index = lessonIndex(TRACKS);
const root = path.resolve(import.meta.dirname, '..');
const tokensOf = l => String(l.intro ?? '').toLowerCase().split(/\s+/).filter(Boolean);
const patterns = new Set(L.flatMap(tokensOf).filter(t => /^[a-z]{2,}$/.test(t)));
const latinWords = text => [...String(text).replace(/\/[^/]*\//g, ' ').replace(/\[[^\]]*\]/g, ' ').matchAll(/[A-Za-z]+/g)].map(m => m[0].toLowerCase());
const allStrings = o => typeof o === 'string' ? [o] : Array.isArray(o) ? o.flatMap(allStrings) : o && typeof o === 'object' ? Object.values(o).flatMap(allStrings) : [];

test('маршрут: поля курса и общая структура', () => {
  assert.equal(track.zero, true); assert.equal(track.lang, 'english'); assert.equal(track.after, 'english');
  assert.ok(track.resources.length >= 3 && track.resources.includes('british-council'));
  assert.deepEqual(validateTrack(track), []);
  assert.deepEqual(validateZeroTrack(track, index), []);
  assert.deepEqual(graphProblems(index), []);
});

test('уроки: идентификаторы ez-NN идут подряд с ez-01', () => {
  L.forEach((l, i) => assert.equal(l.id, `ez-${String(i + 1).padStart(2, '0')}`));
});

test('буквы: все 26 введены, каждая ровно один раз', () => {
  const singles = L.flatMap(tokensOf).filter(t => /^[a-z]$/.test(t));
  assert.equal(singles.length, 26, 'число вводов одиночных букв');
  assert.deepEqual([...new Set(singles)].sort().join(''), 'abcdefghijklmnopqrstuvwxyz');
  for (const l of L) if (tokensOf(l).some(t => /^[a-z]$/.test(t))) assert.equal(l.stage, 'Алфавит', `${l.id}: буквы вводятся только в этапе «Алфавит»`);
});

test('сочетания: полный список диграфов, магической e, пар гласных и r', () => {
  const all = new Set(L.flatMap(tokensOf));
  for (const t of ['sh', 'ch', 'th', 'wh', 'ck', 'ng', 'nk', 'qu', 'a_e', 'i_e', 'o_e', 'u_e', 'ee', 'ea', 'oo', 'ai', 'ay', 'oa', 'ow', 'ar', 'or', 'er', 'ir', 'ur']) assert.ok(all.has(t), `нет сочетания ${t}`);
  const seen = new Map();
  for (const l of L) for (const t of tokensOf(l)) { assert.ok(!seen.has(t), `${t} введено дважды: ${seen.get(t)} и ${l.id}`); seen.set(t, l.id); }
});

test('граф: вход только ez-01, остальные достижимы от него и опираются на более ранние уроки', () => {
  assert.deepEqual(L[0].needs, []);
  L.forEach((l, i) => {
    if (i === 0) return;
    assert.ok(l.needs.length >= 1, `${l.id}: нет предпосылок`);
    assert.ok(closureOf(l.id, index).has('ez-01'), `${l.id}: недостижим от ez-01`);
    for (const n of l.needs) assert.ok(L.findIndex(x => x.id === n) < i, `${l.id}: предпосылка ${n} должна быть раньше`);
  });
});

test('слова: каждое слово из words читается по уже введённому (допуск), без повторов', () => {
  for (const l of L) {
    const sc = scopeOf(l.id, index), words = l.words ?? [];
    assert.equal(new Set(words).size, words.length, `${l.id}: повтор в words`);
    for (const w of words) {
      assert.ok(/^[A-Za-z]+$/.test(w), `${l.id}: «${w}» — не одно английское слово`);
      assert.deepEqual(englishWordProblems(w, sc, patterns), [], `${l.id}: ${w}`);
    }
  }
});

test('цели: уникальны, 15–120 знаков, без точки на конце', () => {
  const goals = L.map(l => l.goal);
  assert.equal(new Set(goals).size, goals.length);
  for (const g of goals) assert.ok(g.length >= 15 && g.length <= 120 && !/[.!?]$/.test(g), g);
});

test('задания: не меньше 8 проверяемых, виды разные, слуховые задания есть там, где учим звуки', () => {
  for (const l of L) {
    const graded = l.drills.filter(d => GRADED.has(d.t));
    assert.ok(graded.length >= Math.max(8, checkOf(l).n + 2), `${l.id}: проверяемых ${graded.length}`);
    assert.ok(new Set(graded.map(d => d.t)).size >= 3, `${l.id}: меньше трёх видов заданий`);
    assert.ok(l.drills.some(d => d.t === 'read'), `${l.id}: нет задания «прочитай вслух»`);
    if (l.stage === 'Фоника') assert.ok(l.drills.filter(d => d.say).length >= 3, `${l.id}: мало заданий со звуком`);
    const qs = l.drills.map(d => `${d.t}|${d.q ?? d.text}|${d.big ?? ''}|${d.say ?? ''}|${d.right ?? ''}|${JSON.stringify([d.tiles, d.pairs])}`);
    assert.equal(new Set(qs).size, qs.length, `${l.id}: одинаковые задания`);
  }
});

test('тексты: абзацы не длиннее 1500 знаков, карточки в пределах', () => {
  for (const l of L) { for (const p of l.body) assert.ok(p.length <= 1500, `${l.id}: абзац ${p.length}`); assert.ok(l.body.length >= 2 && l.body.length <= 6, `${l.id}: число абзацев`); }
});

test('честность: первый урок говорит про ИИ и приблизительные подсказки; обещаний сроков нет', () => {
  const t = L[0].body.join(' ');
  assert.match(t, /написан с помощью ИИ/); assert.match(t, /не проверял учитель-носитель/); assert.match(t, /приблизительн/);
  const all = allStrings(track).join('\n');
  assert.ok(!/за\s+\d+\s*(дн|недел|месяц|час)/i.test(all), 'обещание срока');
  assert.ok(!/гарантир|выучишь за|быстро выучишь|в совершенстве/i.test(all));
});

// ---------- ловушки для читающего ----------
const IRREGULAR = ['the', 'of', 'to', 'you', 'was', 'is', 'his', 'has', 'as', 'said', 'are', 'they', 'have', 'one', 'two', 'do', 'does', 'who', 'what', 'where', 'there', 'here', 'were', 'come', 'some', 'put', 'pull', 'push', 'full', 'give', 'live', 'love', 'move', 'any', 'many', 'eye', 'friend', 'people', 'water', 'mother', 'father', 'brother', 'done', 'gone', 'none', 'once', 'only', 'other', 'another', 'ready', 'head', 'bread', 'dead', 'great', 'break', 'their', 'would', 'could', 'should', 'through', 'though', 'enough', 'very', 'every', 'again', 'because', 'woman', 'women', 'busy', 'heart', 'learn', 'early', 'earth', 'want', 'wash', 'watch', 'swan', 'swap', 'wasp', 'war', 'warm', 'word', 'work', 'world', 'worm', 'he', 'she', 'we', 'me', 'be', 'no', 'go', 'so', 'my', 'by', 'hi', 'why', 'try', 'blood', 'flood', 'door', 'floor', 'poor', 'wind', 'find', 'kind', 'mind', 'child', 'wild', 'cold', 'gold', 'hold', 'told', 'most', 'post', 'roll', 'bull', 'ball', 'all', 'call', 'fall', 'wall', 'tall', 'small', 'walk', 'talk', 'salt', 'son', 'ton', 'won', 'month', 'monkey', 'money', 'honey'];
const FORBIDDEN = ['ou', 'aw', 'au', 'oi', 'oy', 'ew', 'igh', 'ough', 'augh', 'ie', 'ei', 'ey', 'ue', 'ui', 'ph', 'gh', 'kn', 'wr', 'gn', 'tch', 'dge', 'tion', 'sion', 'ture', 'eau', 'ould', 'ear', 'ead'];
const HARD_G = new Set(['get', 'gets', 'gift', 'girl', 'begin', 'together']);
const SUFFIX_OK = new Set(['shed', 'sled', 'bled', 'fled', 'sped', 'shred', 'bring', 'thing', 'string', 'spring', 'swing', 'sting', 'fling', 'cling', 'sling']);

test('ловушки: тихая e, слова не по правилам, непройденные сочетания, мягкие c и g', () => {
  const bad = [];
  for (const l of L) {
    const sc = scopeOf(l.id, index);
    const seen = new Set();
    for (const t of textsOfLesson(l)) for (const w0 of latinWords(t)) {
      const w = w0.replace(/^qu/, 'q');
      if (w0.length < 2 || sc.sight.has(w0) || sc.showcase.has(w0) || sc.tokens.has(w0) || seen.has(w0)) continue;
      seen.add(w0);
      const note = m => bad.push(`${l.id}: «${w0}» — ${m}`);
      const m = /([aeiou])[bcdfghjklmnpqrstvwxyz]e$/.exec(w);
      if (m && !sc.tokens.has(`${m[1]}_e`)) note(`тихая e (${m[1]}_e) ещё не введена`);
      if (IRREGULAR.includes(w0)) note('слово не по правилам: нужно в sight или showcase');
      const f = FORBIDDEN.find(x => w.includes(x) && !sc.tokens.has(x) && !(/^reads?$/.test(w0) && x === 'ead'));
      if (f) note(`сочетание «${f}» не вводится курсом`);
      if (/c[eiy]/.test(w)) note('мягкая c не вводится');
      if (/g[eiy]/.test(w) && !HARD_G.has(w0)) note('мягкая g не вводится');
      if (/(?<=[^a])y/.test(w)) note('гласная y в слове не вводится');
      if (/ed$/.test(w) && w.length > 3 && !/eed$/.test(w) && !SUFFIX_OK.has(w0)) note('окончание -ed не вводится');
      if (/ing$/.test(w) && w.length > 6 && !SUFFIX_OK.has(w0)) note('окончание -ing не вводится');
    }
  }
  assert.deepEqual(bad, []);
});

test('письмо: латиница и кириллица не слипаются, say и words чисто латинские', () => {
  const bad = [];
  for (const l of L) {
    for (const s of allStrings(l)) if (/[A-Za-z][А-Яа-яЁё]|[А-Яа-яЁё][A-Za-z]/.test(s)) bad.push(`${l.id}: «${s.slice(0, 60)}»`);
    for (const w of l.words ?? []) if (/[^A-Za-z]/.test(w)) bad.push(`${l.id}: words «${w}»`);
    for (const d of l.drills) if (d.say && /[^A-Za-z .,!?]/.test(d.say)) bad.push(`${l.id}: say «${d.say}»`);
  }
  assert.deepEqual(bad, []);
});

test('ссылок и ключа type: в курсе нет', () => {
  const s = JSON.stringify(track);
  assert.ok(!/https?:|www\./i.test(s));
  for (const f of fs.readdirSync(root).filter(x => /^(c-zero-en|zero-en-.*)\.js$/.test(x))) assert.ok(!/\btype:/.test(fs.readFileSync(path.join(root, f), 'utf8')), `${f}: ключ type:`);
});

test('файлы курса: не больше 64 000 байт, части импортируют только zero-kit.js и друг друга', () => {
  const files = fs.readdirSync(root).filter(x => /^(c-zero-en|zero-en-.*)\.js$/.test(x));
  assert.ok(files.includes('c-zero-en.js') && files.length >= 3);
  for (const f of files) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(Buffer.byteLength(s) <= 64000, `${f}: ${Buffer.byteLength(s)} байт`);
    for (const m of s.matchAll(/from\s*'\.\/([^']+)'/g)) assert.ok(m[1] === 'zero-kit.js' || /^zero-en-[a-z]+\.js$/.test(m[1]), `${f} → ${m[1]}`);
  }
});

// ---------- полнота маршрута (включается, когда все этапы написаны) ----------
const todo = COMPLETE ? false : 'маршрут ещё дописывается';
test('маршрут полный: 30–45 уроков, семь этапов по порядку', { todo }, () => {
  assert.ok(L.length >= 30 && L.length <= 45, `уроков: ${L.length}`);
  const order = ['Звуки', 'Алфавит', 'Фоника', 'Слоги и слова', 'Предложения', 'Слух и речь', 'Дальше'];
  const stages = [...new Set(L.map(l => l.stage))];
  assert.deepEqual(stages, order);
  const rank = l => order.indexOf(l.stage);
  L.forEach((l, i) => { if (i) assert.ok(rank(l) >= rank(L[i - 1]), `${l.id}: этап идёт раньше времени`); });
});

test('первые 50 слов: не меньше 50 разных слов, у каждого есть перевод', { todo }, () => {
  const ls = L.filter(l => /^Первые слова/.test(l.title));
  assert.ok(ls.length >= 3, 'нужно три урока «Первые слова»');
  const words = new Set(ls.flatMap(l => l.words));
  assert.ok(words.size >= 50, `слов: ${words.size}`);
  for (const l of ls) for (const w of l.words) assert.ok([...l.table, ...l.cards].some(r => r[0] === w), `${l.id}: нет перевода для ${w}`);
});
