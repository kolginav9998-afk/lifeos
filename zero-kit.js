// Конструкторы заданий и проверки структуры курсов «с нуля» (английский, иврит). Чистый модуль: без интерфейса и хранилища.
// Контракт и правила: docs/CURRICULUM_ENGINE.md. Ключ `type:` в заданиях не используется (его ищет тест реестра): вид задания лежит в `t`.

export const DRILL_KINDS = ['choose', 'listen', 'typed', 'order', 'match', 'read'];
export const GRADED = new Set(['choose', 'listen', 'typed', 'order', 'match']);   // read — самооценка: практика, но не доказательство
export const MIN_DRILLS = 8;                                                      // заданий в уроке (из них проверяемых не меньше check.n + 2)
export const CHECK_DEFAULT = { n: 6, pass: 0.8 };
export const LANGS = ['english', 'hebrew'];
export const checkOf = lesson => ({ ...CHECK_DEFAULT, ...(lesson.check ?? {}) });

// ===== Конструкторы заданий. Обычные объекты без функций. Общие необязательные поля: big (крупный знак над вопросом),
// say (что озвучить кнопкой «Послушать»), lang ('english' | 'hebrew' | 'russian'), hint (подсказка; её использование = ответ не засчитан), explain (пояснение после ответа).
export const choose = (q, right, wrong, o = {}) => ({ t: 'choose', q, right, wrong: [...wrong], ...o });                       // выбери правильный вариант
export const listen = (say, right, wrong, o = {}) => ({ t: 'listen', q: 'Что ты услышал?', say, right, wrong: [...wrong], ...o }); // услышал и выбрал
export const typed = (q, ok, o = {}) => ({ t: 'typed', q, ok: [].concat(ok), ...o });                                          // впиши ответ (ok — допустимые)
export const order = (q, tiles, o = {}) => ({ t: 'order', q, tiles: [...tiles], dir: 'ltr', ...o });                            // собери из плиток; tiles — в порядке чтения; dir 'rtl' для иврита
export const match = (q, pairs, o = {}) => ({ t: 'match', q, pairs: pairs.map(p => [...p]), ...o });                            // соедини пары [левое, правое]
export const read = (text, o = {}) => ({ t: 'read', q: 'Прочитай вслух', text, ...o });                                         // прочитай и оцени себя (не засчитывается как проверка)

// ===== Разбор ответа
export const normAnswer = s => String(s ?? '').normalize('NFC').toLowerCase().replace(/ё/g, 'е').replace(/[.,!?;:«»"'()\-–—]/g, ' ').replace(/\s+/g, ' ').trim();

// answer: choose/listen — выбранная строка; typed — введённая строка; order — массив плиток в порядке, который собрал человек;
// match — массив выбранных пар [левое, правое]. Возвращает true/false; для read — null (не оценивается).
export function gradeDrill(d, answer) {
  switch (d.t) {
    case 'choose': case 'listen': return answer === d.right;
    case 'typed': return d.ok.some(x => normAnswer(x) === normAnswer(answer));
    case 'order': return Array.isArray(answer) && answer.length === d.tiles.length && answer.every((x, i) => x === d.tiles[i]);
    case 'match': {
      if (!Array.isArray(answer) || answer.length !== d.pairs.length) return false;
      const want = new Set(d.pairs.map(p => p.join('\u0000')));
      const got = new Set(answer.map(p => p.join('\u0000')));
      return got.size === want.size && [...got].every(x => want.has(x));
    }
    default: return null;
  }
}

// ===== Предсказуемое перемешивание (для проверки и порядка вариантов): одно и то же зерно даёт один и тот же порядок
export function rng(seed) {
  let a = (Math.abs(Math.floor(Number(seed) || 0)) + 0x9e3779b9) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffled(list, seed) {
  const r = rng(seed), a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// Задания для проверки: n штук из проверяемых заданий урока, виды чередуются, порядок зависит от seed.
export function pickCheckItems(lesson, seed, n = checkOf(lesson).n) {
  const pool = shuffled((lesson.drills ?? []).filter(d => GRADED.has(d.t)), seed);
  const byKind = new Map();
  for (const d of pool) { if (!byKind.has(d.t)) byKind.set(d.t, []); byKind.get(d.t).push(d); }
  const out = [];
  while (out.length < n && [...byKind.values()].some(v => v.length)) for (const v of byKind.values()) if (v.length && out.length < n) out.push(v.shift());
  return out;
}

// ===== Проверка структуры одного задания: список проблем (пусто — всё в порядке)
const str = v => typeof v === 'string' && v.trim().length > 0;
export function validateDrill(d) {
  const bad = [];
  const need = (c, m) => { if (!c) bad.push(m); };
  if (!d || !DRILL_KINDS.includes(d.t)) return ['вид задания (t) не из списка'];
  if (d.t === 'read') { need(str(d.text), 'read: text'); return bad; }
  need(str(d.q), `${d.t}: q`);
  if (d.t === 'choose' || d.t === 'listen') {
    need(str(d.right), `${d.t}: right`);
    need(Array.isArray(d.wrong) && d.wrong.length >= 2 && d.wrong.every(str), `${d.t}: wrong (две и больше непустые строки)`);
    if (Array.isArray(d.wrong)) {
      const all = [d.right, ...d.wrong];
      need(new Set(all).size === all.length, `${d.t}: варианты повторяются или right среди wrong`);
      need(all.length <= 6, `${d.t}: больше шести вариантов`);
    }
    if (d.t === 'listen') need(str(d.say), 'listen: say');
  }
  if (d.t === 'typed') need(Array.isArray(d.ok) && d.ok.length >= 1 && d.ok.every(str), 'typed: ok');
  if (d.t === 'order') {
    need(Array.isArray(d.tiles) && d.tiles.length >= 2 && d.tiles.length <= 10 && d.tiles.every(str), 'order: tiles (от 2 до 10 непустых)');
    need(d.dir === 'ltr' || d.dir === 'rtl', 'order: dir');
  }
  if (d.t === 'match') {
    const p = d.pairs;
    need(Array.isArray(p) && p.length >= 3 && p.length <= 6 && p.every(x => Array.isArray(x) && x.length === 2 && x.every(str)), 'match: pairs (от 3 до 6 пар)');
    if (Array.isArray(p) && p.every(x => Array.isArray(x) && x.length === 2)) need(new Set(p.map(x => x[0])).size === p.length && new Set(p.map(x => x[1])).size === p.length, 'match: пары повторяются');
  }
  return bad;
}

// ===== Граф уроков
export const lessonIndex = tracks => { const m = new Map(); for (const t of tracks) for (const l of t.lessons) m.set(l.id, { track: t, lesson: l }); return m; };

// Урок и всё, что нужно ему «по цепочке» (включая сам урок).
export function closureOf(id, index, seen = new Set()) {
  if (seen.has(id)) return seen;
  seen.add(id);
  const e = index.get(id);
  if (e) for (const n of e.lesson.needs ?? []) closureOf(n, index, seen);
  return seen;
}

// Циклы и ссылки на несуществующие уроки по всем курсам сразу.
export function graphProblems(index) {
  const bad = [], state = new Map();                       // 1 — в пути, 2 — готов
  const visit = (id, path) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) { bad.push(`цикл предпосылок: ${[...path, id].join(' → ')}`); return; }
    state.set(id, 1);
    for (const n of index.get(id)?.lesson.needs ?? []) { if (!index.has(n)) bad.push(`${id}: needs → нет урока ${n}`); else visit(n, [...path, id]); }
    state.set(id, 2);
  };
  for (const id of index.keys()) visit(id, []);
  return bad;
}

// ===== Область допуска: что уже можно показывать в уроке. Считается по цепочке предпосылок.
// intro (строка): новое, что вводит урок. Английский — буквы и сочетания через пробел: 'a b c', 'sh ch', 'a_e' (a + любая согласная + e).
// Иврит — буквы и огласовки подряд (пробелы игнорируются). sight — слова целиком, которые разрешено показывать без разбора (the, said).
// showcase — слова, намеренно показанные «на слух» в этом уроке. milestone — метка этапа ('niqqud': огласовки пройдены).
export function scopeOf(id, index) {
  const tokens = new Set(), chars = new Set(), sight = new Set(), milestones = new Set();
  for (const k of closureOf(id, index)) {
    const l = index.get(k)?.lesson; if (!l) continue;
    for (const tk of String(l.intro ?? '').toLowerCase().split(/\s+/).filter(Boolean)) { tokens.add(tk); for (const c of tk) if (c !== '_') chars.add(c); }
    for (const w of l.sight ?? []) sight.add(String(w).toLowerCase());
    if (l.milestone) milestones.add(l.milestone);
  }
  const own = index.get(id)?.lesson ?? {};
  return { tokens, chars, sight, milestones, showcase: new Set((own.showcase ?? []).map(w => String(w).toLowerCase())), plainOk: own.plain === true && milestones.has('niqqud') };
}

// Все тексты урока, которые проверяются на область допуска: задания, карточки, таблица, список слов. Текст урока (body) не проверяется.
export function textsOfLesson(l) {
  const out = [];
  const add = v => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(add); };
  for (const d of l.drills ?? []) {
    if (d.lang === 'russian') continue;
    for (const k of ['big', 'q', 'right', 'wrong', 'say', 'ok', 'tiles', 'text', 'hint', 'explain']) add(d[k]);
    if (d.pairs) d.pairs.forEach(add);
  }
  for (const c of l.cards ?? []) add(c);
  for (const row of l.table ?? []) add(row);
  add(l.words ?? []);
  return out;
}

const LAT_WORD = /[A-Za-z]+/g;
export function englishWordProblems(text, scope, patterns) {
  const out = [];
  const clean = String(text).replace(/\/[^/]*\//g, ' ').replace(/\[[^\]]*\]/g, ' ');       // транскрипция в /…/ и […] не считается чтением
  for (const m of clean.matchAll(LAT_WORD)) {
    const w = m[0].toLowerCase();
    if (scope.sight.has(w) || scope.showcase.has(w)) continue;
    const missing = [...new Set([...w].filter(c => !scope.chars.has(c)))];
    if (missing.length) { out.push(`«${m[0]}»: буквы ${missing.join(', ')} ещё не введены`); continue; }
    const p = [...patterns].find(x => w.includes(x) && !scope.tokens.has(x));
    if (p) out.push(`«${m[0]}»: сочетание «${p}» ещё не введено`);
  }
  return out;
}

const HEB_RUN = /[א-ת֑-ׇֽֿׁׂׅׄ]+/g;
const HEB_LETTER = /[א-ת]/g;
const HEB_VOWEL = /[ְ-ׇֻ]/;
export function hebrewWordProblems(text, scope) {
  const out = [];
  for (const m of String(text).matchAll(HEB_RUN)) {
    const w = m[0];
    if (scope.showcase.has(w.toLowerCase())) continue;
    const missing = [...new Set([...w].filter(c => !scope.chars.has(c)))];
    if (missing.length) { out.push(`«${w}»: знаки ${missing.map(c => `${c} (U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`).join(', ')} ещё не введены`); continue; }
    if ((w.match(HEB_LETTER) ?? []).length >= 2 && !HEB_VOWEL.test(w) && !scope.plainOk) out.push(`«${w}»: слово без огласовок (разрешено только в уроках с plain: true после этапа niqqud)`);
  }
  return out;
}

// ===== Проверка маршрута целиком. index — lessonIndex всех курсов приложения (нужен для предпосылок из других курсов).
export function validateZeroTrack(track, index) {
  const bad = [];
  const need = (c, m) => { if (!c) bad.push(`${track.id}: ${m}`); };
  need(track.zero === true, 'zero: true');
  need(LANGS.includes(track.lang), 'lang: english | hebrew');
  if (track.lang === 'hebrew') need(['modern', 'biblical'].includes(track.branch), 'branch для иврита: modern | biblical');
  const pos = new Map(track.lessons.map((l, i) => [l.id, i]));
  const patterns = new Set();                                                           // многобуквенные сочетания маршрута
  for (const l of track.lessons) for (const tk of String(l.intro ?? '').toLowerCase().split(/\s+/)) if (/^[a-z]{2,}$/.test(tk)) patterns.add(tk);
  for (const l of track.lessons) {
    const mine = [];
    const note = m => mine.push(`${l.id}: ${m}`);
    if (!(typeof l.stage === 'string' && l.stage.trim())) note('stage (название этапа)');
    if (!Array.isArray(l.needs ?? [])) note('needs должен быть массивом');
    for (const n of Array.isArray(l.needs) ? l.needs : []) {
      if (n === l.id) note('needs: урок зависит от самого себя');
      else if (!index.has(n)) note(`needs: нет урока ${n}`);
      else if (pos.has(n) && pos.get(n) > pos.get(l.id)) note(`needs: ${n} должен стоять в списке раньше`);
    }
    if (typeof (l.intro ?? '') !== 'string') note('intro должен быть строкой');
    const ck = checkOf(l);
    if (!(Number.isInteger(ck.n) && ck.n >= 3 && ck.n <= 12 && ck.pass >= 0.5 && ck.pass <= 1)) note('check: n от 3 до 12, pass от 0.5 до 1');
    if (!(l.decay === undefined || (l.decay >= 0.5 && l.decay <= 3))) note('decay от 0.5 до 3');
    if (l.plain === true && !(l.needs ?? []).some(n => scopeOf(n, index).milestones.has('niqqud'))) note('plain: true допустим только после урока с milestone: "niqqud" в цепочке предпосылок');
    const drills = l.drills ?? [];
    if (drills.length < MIN_DRILLS) note(`drills: нужно не меньше ${MIN_DRILLS}`);
    drills.forEach((d, i) => validateDrill(d).forEach(m => note(`drills[${i}]: ${m}`)));
    const graded = drills.filter(d => GRADED.has(d?.t)).length, minGraded = Math.max(MIN_DRILLS, ck.n + 2);
    if (graded < minGraded) note(`проверяемых заданий (не read) ${graded}, нужно не меньше ${minGraded}`);
    // область допуска
    const sc = scopeOf(l.id, index), seen = new Set();
    for (const t of textsOfLesson(l)) {
      const found = track.lang === 'english' ? englishWordProblems(t, sc, patterns) : hebrewWordProblems(t, sc);
      for (const f of found) if (!seen.has(f)) { seen.add(f); note(`допуск: ${f}`); }
    }
    bad.push(...mine.slice(0, 8), ...(mine.length > 8 ? [`${l.id}: … и ещё ${mine.length - 8}`] : []));
  }
  return bad;
}
