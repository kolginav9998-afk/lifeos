// Новые форматы заданий для учёбы: диктант на слух, cloze-карточки («закончи фразу»), «найди ошибку»,
// «объясни сам» (зачёт по опорным словам, без ИИ), контрастные пары похожих знаков, итог этапа и микро-урок.
// Чистый модуль: только генерация и проверка, без интерфейса и хранилища. Рисует всё view-learn.js.
// Единый вид задания (ключ `t`, как в zero-kit.js; ключ `type:` в заданиях не используется):
//   choice — { t:'choice', q, options:[...], answer:<индекс>, big?, say?, lang?, explain? }
//   typed  — { t:'typed', q, ok:[допустимые ответы], say?, lang?, explain? }   (если есть say — это диктант)
//   error  — { t:'error', q, words:[...], wrong:<индекс неверного слова>, right:<верное слово>, full:<фраза без ошибки> }
import { normAnswer, shuffled, rng } from './zero-kit.js';

const contentWords = s => String(s ?? '').match(/[A-Za-zА-Яа-яЁё]{4,}/g) ?? [];
const scriptOf = w => (/[А-Яа-яЁё]/.test(w) ? 'ru' : /[A-Za-z]/.test(w) ? 'en' : /[֐-׿]/.test(w) ? 'he' : 'x');

// Проверка ответа на задание любого вида: choice/error — выбранный индекс, typed — введённая строка.
export function gradeItem(item, answer) {
  if (!item) return null;
  if (item.t === 'choice') return answer === item.answer;
  if (item.t === 'error') return answer === item.wrong;
  if (item.t === 'typed') return (item.ok ?? []).some(x => normAnswer(x) === normAnswer(answer));
  return null;
}

// ---------- выбор варианта (классика мини-квиза): вопрос из карточки, пустышки — ответы других карточек ----------
export function chooseItems(own, others, { seed = 1, n = 3, options = 4 } = {}) {
  const answers = [...new Set((others ?? []).map(([, a]) => a))];
  return shuffled((own ?? []).map(([q, a]) => ({ q, a })), seed).slice(0, n).flatMap(({ q, a }, i) => {
    const wrong = shuffled(answers.filter(x => x !== a), seed + i).slice(0, options - 1);
    if (wrong.length < 2) return [];
    const opts = shuffled([a, ...wrong], seed + i + 500);
    return [{ t: 'choice', q, options: opts, answer: opts.indexOf(a) }];
  });
}

// ---------- cloze: «закончи фразу». Ключевое слово — самое длинное значимое слово ответа, которого нет в вопросе ----------
export function clozeOf(q, a) {
  const lower = normAnswer(q);
  const cands = contentWords(a).filter(w => !lower.includes(normAnswer(w)));
  if (!cands.length) return null;
  const key = cands.reduce((x, y) => (y.length > x.length ? y : x));
  return { masked: String(a).replace(key, '____'), key };
}
export function clozeItems(own, others, { seed = 1, n = 3, options = 4 } = {}) {
  const keys = [...new Set((others ?? []).map(([, a]) => clozeOf('', a)?.key).filter(Boolean))];
  const out = [];
  for (const [q, a] of shuffled([...(own ?? [])], seed)) {
    if (out.length >= n) break;
    const c = clozeOf(q, a);
    if (!c) continue;
    const distract = shuffled(keys.filter(k => normAnswer(k) !== normAnswer(c.key)), seed + out.length).slice(0, options - 1);
    if (distract.length < 2) continue;
    const opts = shuffled([c.key, ...distract], seed + out.length + 1000);
    out.push({ t: 'choice', q: `Закончи фразу: ${c.masked}`, options: opts, answer: opts.indexOf(c.key), explain: `Полная фраза: ${a}` });
  }
  return out;
}

// ---------- «найди ошибку»: фраза из карточки, одно слово подменено готовым дистрактором из другой карточки ----------
export function spotErrorItems(own, others, { seed = 1, n = 3 } = {}) {
  const dict = shuffled([...new Set((others ?? []).flatMap(([, a]) => contentWords(a)))], seed + 7);
  const out = [];
  for (const [, a] of shuffled([...(own ?? [])], seed)) {
    if (out.length >= n) break;
    const ws = String(a).split(/\s+/).filter(Boolean);
    if (ws.length < 3) continue;
    const spots = ws.map((w, i) => ({ w, i })).filter(x => (x.w.match(/[A-Za-zА-Яа-яЁё]{4,}/g) ?? []).length === 1);
    if (!spots.length) continue;
    const spot = spots[Math.floor(rng(seed + out.length)() * spots.length)];
    const clean = (spot.w.match(/[A-Za-zА-Яа-яЁё]{4,}/g) ?? [])[0];
    const cand = dict.find(d => scriptOf(d) === scriptOf(clean) && normAnswer(d) !== normAnswer(clean) && Math.abs(d.length - clean.length) <= 3);
    if (!cand) continue;
    const words = [...ws];
    words[spot.i] = spot.w.replace(clean, cand);
    out.push({ t: 'error', q: 'В этой фразе одно слово неверное. Найди его.', words, wrong: spot.i, right: spot.w, full: String(a), explain: `Верно так: ${a}` });
  }
  return out;
}

// ---------- мини-квиз после урока: смесь форматов из карточек урока ----------
export function mixedLessonQuiz(own, others, { seed = 1, n = 4 } = {}) {
  const classic = chooseItems(own, others, { seed, n });
  const mix = shuffled([...classic, ...clozeItems(own, others, { seed: seed + 11, n: 2 }), ...spotErrorItems(own, others, { seed: seed + 23, n: 1 })], seed + 3);
  return mix.slice(0, Math.max(n, Math.min(classic.length, n)));
}

// ---------- диктант на слух: услышал слово — вписал. Слова передаёт вызывающий код, только из области допуска ----------
export function dictationItems(words, { seed = 1, n = 8, lang } = {}) {
  const norm = w => (typeof w === 'string' ? { say: w, ok: [w] } : w);
  return shuffled((words ?? []).map(norm).filter(w => w && typeof w.say === 'string' && w.say.trim()), seed).slice(0, n)
    .map(w => ({ t: 'typed', q: 'Напиши слово, которое услышал', say: w.say, ok: [...new Set([w.say, ...(w.ok ?? [])])], lang, hint: w.hint }));
}
// Слова уроков «с нуля», которые уже можно диктовать: sight-слова, showcase и ответы заданий на слух и вписывание.
export function dictationWordsOf(lessons) {
  const out = new Map();
  const add = w => { const s = String(w ?? '').trim(); if (s && !/\s/.test(s)) out.set(s.toLowerCase(), s); };
  for (const l of lessons ?? []) {
    for (const w of [...(l.sight ?? []), ...(l.showcase ?? [])]) add(w);
    for (const d of l.drills ?? []) {
      if (typeof d.say === 'string') add(d.say);
      if (d.t === 'typed') for (const w of d.ok ?? []) add(w);
    }
  }
  return [...out.values()];
}

// ---------- «объясни сам»: пересказ двумя предложениями, зачёт по опорным словам из карточек урока ----------
const STOP = new Set(['который', 'которая', 'которые', 'которое', 'этот', 'эта', 'эти', 'можно', 'нужно', 'больше', 'меньше', 'после', 'перед', 'через', 'между', 'свой', 'своя', 'свои', 'своё', 'быть', 'есть', 'когда', 'потом', 'сначала', 'здесь', 'там', 'потому', 'если', 'чтобы', 'только', 'даже', 'именно', 'обычно', 'очень', 'просто']);
// Опорные слова урока: значимые слова из ответов его карточек (не стоп-слова, от пяти букв), по порядку карточек.
export function keywordsOfCards(cards, { max = 8 } = {}) {
  const out = [], seen = new Set();
  for (const [, a] of cards ?? []) {
    for (const w of contentWords(a)) {
      const key = normAnswer(w);
      if (seen.has(key) || STOP.has(key) || key.length < 5) continue;
      seen.add(key); out.push(w);
      if (out.length >= max) return out;
    }
  }
  return out;
}
// Зачёт по правилу: в пересказе нашлось не меньше need опорных слов. Формы слова засчитываем бережно (по началу слова).
export function checkExplain(text, keywords, { minHits = 2 } = {}) {
  const tokens = normAnswer(text).split(' ').filter(Boolean);
  const hit = k => {
    const kk = normAnswer(k);
    return tokens.some(t => t === kk || (kk.length >= 5 && t.length >= 4 && (t.startsWith(kk.slice(0, -2)) || kk.startsWith(t))));
  };
  const hits = (keywords ?? []).filter(hit);
  const need = Math.min(minHits, (keywords ?? []).length);
  const sentences = String(text ?? '').split(/[.!?…\n]+/).map(s => s.trim()).filter(s => contentWords(s).length > 0).length;
  return { ok: need > 0 && hits.length >= need, hits, missing: (keywords ?? []).filter(k => !hits.includes(k)), need, sentences };
}

// ---------- контрастные пары: похожие знаки вперемешку, иногда верный ответ — «оба неверных» ----------
export const BOTH_WRONG = 'Оба неверных';
export const CONTRAST_LATIN = [['b', 'd'], ['p', 'q'], ['m', 'w'], ['n', 'u'], ['i', 'l'], ['f', 't'], ['c', 's'], ['o', 'a']];
export const CONTRAST_HEBREW = [['ב', 'כ'], ['ד', 'ר'], ['ח', 'ת'], ['נ', 'ג'], ['ו', 'ז'], ['ס', 'ם'], ['ע', 'א'], ['ט', 'ת']];
// Пары, обе буквы которых уже введены (область допуска по буквам).
export function contrastPairsFor(letters, table = CONTRAST_LATIN) {
  const has = new Set([...(letters ?? [])].map(c => String(c).toLowerCase()));
  return table.filter(([a, b]) => has.has(a.toLowerCase()) && has.has(b.toLowerCase()));
}
export function contrastItems(pairs, { seed = 1, n = 4, bothWrongEvery = 3 } = {}) {
  const flat = [...new Set((pairs ?? []).flat())];
  const out = [];
  if (!pairs?.length) return out;
  const pool = shuffled(pairs.map((p, i) => ({ p, i })), seed);
  for (let k = 0; out.length < n; k++) {
    const { p } = pool[k % pool.length];
    let shown, answer;
    if (out.length % bothWrongEvery === bothWrongEvery - 1) {
      const cand = shuffled(flat.filter(x => !p.includes(x)), seed + k)[0];
      if (cand) { shown = cand; answer = BOTH_WRONG; } else { shown = p[k % 2]; answer = shown; }
    } else { shown = p[(k + seed) % 2]; answer = shown; }
    const options = [...shuffled([...p], seed + k + 100), BOTH_WRONG];
    out.push({ t: 'choice', big: shown, q: 'Что это за знак?', options, answer: options.indexOf(answer) });
  }
  return out;
}

// ---------- итог этапа: обзорный набор без нового материала из заданий уже освоенных уроков этапа ----------
export const stageNames = track => [...new Set((track?.lessons ?? []).map(l => l.stage).filter(Boolean))];
// Пройденные этапы по прогрессу маршрута (routeProgress из curriculum.js): все уроки этапа освоены.
export const doneStages = progress => (progress?.stages ?? []).filter(g => g.lessons.length > 0 && g.done === g.lessons.length).map(g => g.name);
// Буквы, которые вводит этап (из поля intro уроков) — область допуска для контрастных пар.
export function stageLetters(lessons) {
  const chars = new Set();
  for (const l of lessons ?? []) for (const tk of String(l.intro ?? '').toLowerCase().split(/\s+/).filter(Boolean)) for (const c of tk) if (c !== '_') chars.add(c);
  return chars;
}
// Обзор: задания уроков этапа (выбор/на слух/вписать), плюс до двух контрастных пар и до двух слов диктанта. Нового материала нет.
export function stageReviewItems(stageLessons, { seed = 1, n = 8, pairs = [], dictation = [], lang } = {}) {
  const convertible = (stageLessons ?? []).flatMap(l => l.drills ?? []).filter(d => ['choose', 'listen', 'typed'].includes(d.t));
  const byKind = new Map();
  for (const d of shuffled(convertible, seed)) { if (!byKind.has(d.t)) byKind.set(d.t, []); byKind.get(d.t).push(d); }
  const picked = [];
  while (picked.length < n && [...byKind.values()].some(v => v.length)) for (const v of byKind.values()) if (v.length && picked.length < n) picked.push(v.shift());
  const items = picked.map((d, i) => {
    if (d.t === 'typed') return { t: 'typed', q: d.q, ok: [...d.ok], say: d.say, lang: d.lang ?? lang, explain: d.explain, big: d.big };
    const options = shuffled([d.right, ...d.wrong], seed + i);
    return { t: 'choice', q: d.q, options, answer: options.indexOf(d.right), say: d.say, lang: d.lang ?? lang, explain: d.explain, big: d.big };
  });
  const extra = [...contrastItems(pairs, { seed: seed + 5, n: Math.min(2, n) }), ...dictationItems(dictation, { seed: seed + 9, n: 2, lang })];
  return shuffled([...items, ...extra], seed + 17);
}

// ---------- микро-урок на пару минут: один факт из пройденного урока и один вопрос по нему ----------
export function microFromLessons(lessons, { seed = 1 } = {}) {
  for (const l of shuffled((lessons ?? []).filter(x => (x.cards?.length ?? 0) >= 2), seed)) {
    const others = (lessons ?? []).filter(x => x !== l).flatMap(x => x.cards ?? []);
    const [factCard] = shuffled(l.cards, seed + 1);
    const [item] = chooseItems(shuffled(l.cards.filter(c => c !== factCard), seed + 2).slice(0, 1), others.length ? others : lessons.flatMap(x => x.cards ?? []), { seed: seed + 3, n: 1 });
    if (item) return { fact: { q: factCard[0], a: factCard[1], lesson: l.title, lessonId: l.id }, item, seconds: 90 };
  }
  return null;
}
